import {
  isNormalizedSegmentSteps,
  parseSegmentSteps,
  SEGMENT_SUB_STEPS,
  SegmentSubStep,
  TRON_SEGMENT_STEPS,
} from '../../common/utils/segment-code.util';

/**
 * Hàm THUẦN tính đích phía cộng tồn đoạn theo lệnh cho 1 cỡ đoạn (13/11/2026): từ "đã cắt KCS đạt" + "đã qua từng công đoạn phụ
 * KCS đạt" của CẢ lệnh, ra mỗi mã đoạn có bao nhiêu đoạn ĐỦ công đoạn (giữ cho lệnh, trần = số cần) và bao nhiêu vượt (dư).
 *
 * Mô hình "vật lý": 1 đoạn đủ công đoạn của mã có bộ S khi đã cắt và mọi công đoạn trong S đã đạt KCS. Không biết từng đoạn cụ
 * thể nên đếm theo số: ghép cắt + từng công đoạn, ưu tiên mã nhiều công đoạn trước (đoạn đã đi qua nhiều công đoạn không thể
 * làm đoạn trơn), lượt 1 giữ cho lệnh tới trần số cần, lượt 2 mới tính phần dư.
 */

export interface SegmentTargetsInput {
  /** Số đoạn đã cắt + KCS đạt của cỡ đoạn trong lệnh. */
  cutPassedQty: number;
  /** Số đoạn đã qua từng công đoạn phụ + KCS đạt. */
  stepPassedQty: Partial<Record<SegmentSubStep, number>>;
  /** Số cần theo bộ công đoạn (gộp mọi SKU / mảnh của lệnh); '' = trơn. */
  variants: { segmentSteps: string; needQty: number }[];
}

export interface SegmentTargetVariant {
  segmentSteps: string;
  needQty: number;
  heldQty: number;
  surplusQty: number;
}

export interface SegmentTargetsResult {
  variants: SegmentTargetVariant[];
  /** Đoạn đã cắt nhưng còn phải chờ công đoạn của lệnh (chưa đủ công đoạn). */
  wipQty: number;
  /** Số đoạn đã qua công đoạn nhưng không ghép được vào mã nào (chỉ để báo lệch số liệu). Chỉ gồm công đoạn khác 0. */
  leftoverStepQty: Partial<Record<SegmentSubStep, number>>;
}

const nonNeg = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);

export function computeSegmentTargets(input: SegmentTargetsInput): SegmentTargetsResult {
  // 0. Kẹp về >= 0, gộp mã trùng, bỏ số cần <= 0.
  const cutQty = nonNeg(input.cutPassedQty);
  const remP: Record<string, number> = {};
  for (const t of SEGMENT_SUB_STEPS) remP[t] = nonNeg(input.stepPassedQty[t] ?? 0);

  const needByCode = new Map<string, number>();
  for (const v of input.variants) {
    if (!isNormalizedSegmentSteps(v.segmentSteps)) {
      throw new Error(`Bộ công đoạn '${v.segmentSteps}' không đúng dạng mã đoạn`);
    }
    const need = nonNeg(v.needQty);
    if (need <= 0) continue;
    needByCode.set(v.segmentSteps, (needByCode.get(v.segmentSteps) ?? 0) + need);
  }

  // 1. Mã có công đoạn: nhiều công đoạn trước, cùng số công đoạn thì segmentSteps tăng dần.
  const stepVariants = [...needByCode.entries()]
    .filter(([code]) => code !== TRON_SEGMENT_STEPS)
    .map(([code, need]) => ({ segmentSteps: code, steps: parseSegmentSteps(code), need }))
    .sort((a, b) =>
      a.steps.length !== b.steps.length
        ? b.steps.length - a.steps.length
        : a.segmentSteps < b.segmentSteps
          ? -1
          : a.segmentSteps > b.segmentSteps
            ? 1
            : 0,
    );
  const needTron = needByCode.get(TRON_SEGMENT_STEPS) ?? 0;

  const minStep = (steps: SegmentSubStep[]): number =>
    steps.reduce((m, t) => Math.min(m, remP[t]), Infinity);

  // 2-3. Lượt 1: giữ cho lệnh, trần = số cần.
  let remCut = cutQty;
  const held = new Map<string, number>();
  for (const v of stepVariants) {
    const k = Math.min(v.need, remCut, minStep(v.steps));
    held.set(v.segmentSteps, k);
    remCut -= k;
    for (const t of v.steps) remP[t] -= k;
  }

  // 4. Lượt 2: dư của mã có công đoạn (đủ công đoạn vượt số cần).
  const surplus = new Map<string, number>();
  for (const v of stepVariants) {
    const s = Math.min(remCut, minStep(v.steps));
    surplus.set(v.segmentSteps, s);
    remCut -= s;
    for (const t of v.steps) remP[t] -= s;
  }

  // 5-7. Đoạn đang mang công đoạn dở (cận dưới), đoạn còn phải chờ công đoạn của lệnh, đoạn trơn thật.
  const partial = Math.min(Math.max(0, ...SEGMENT_SUB_STEPS.map((t) => remP[t])), remCut);
  const noStep = remCut - partial;
  const wip = stepVariants.reduce(
    (sum, v) => sum + Math.max(0, v.need - (held.get(v.segmentSteps) ?? 0)),
    0,
  );
  const tronComplete = Math.max(0, noStep - Math.max(0, wip - partial));

  // 8. Trơn.
  const tronHeld = Math.min(needTron, tronComplete);
  const tronSurplus = tronComplete - tronHeld;

  const variants: SegmentTargetVariant[] = stepVariants.map((v) => ({
    segmentSteps: v.segmentSteps,
    needQty: v.need,
    heldQty: held.get(v.segmentSteps) ?? 0,
    surplusQty: surplus.get(v.segmentSteps) ?? 0,
  }));
  if (needTron > 0 || tronSurplus > 0) {
    variants.push({
      segmentSteps: TRON_SEGMENT_STEPS,
      needQty: needTron,
      heldQty: tronHeld,
      surplusQty: tronSurplus,
    });
  }

  // 9.
  const leftoverStepQty: Partial<Record<SegmentSubStep, number>> = {};
  for (const t of SEGMENT_SUB_STEPS) {
    if (remP[t] !== 0) leftoverStepQty[t] = remP[t];
  }
  return { variants, wipQty: Math.min(wip, remCut), leftoverStepQty };
}
