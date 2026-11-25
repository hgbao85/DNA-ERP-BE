import {
  PROCESS_STEPS,
  ProcessStepValue,
  processStepLabel,
} from '../../common/constants/process-steps.constant';

/**
 * Số cần / số đã tính / giới hạn vật lý của Phôi theo (SKU, cỡ đoạn, công đoạn) - P1 "KCS tự chuyển" (18/11/2026).
 * Hàm THUẦN, dùng chung cho 3 chỗ để mọi nơi cùng một con số: tiến độ (floor/review, floor/scan, phoi-progress), phép chặn
 * lúc báo (recordCutBatch / recordStepBatch) và phép kiểm khi hủy / gán SKU (X3), cộng tồn đoạn kho Phôi (segment-production).
 *
 * Công thức v1 (theo (SKU o, cỡ s, công đoạn T)):
 *  - base_T  = Σ qtyPerPiece × qtyPerUnit × SL SKU của các dòng định mức có T (Cắt: mọi dòng).
 *  - extra_CAT = Σ số BỎ (cắt lại) ở mọi công đoạn phụ.
 *    extra_T (T phụ) = Σ bỏ_U với U đứng SAU T (theo thứ tự nghiệp vụ) và có ít nhất 1 dòng định mức cần cả T lẫn U.
 *  - need_T  = base_T + extra_T + phần mở thêm (luôn 0 - chừa cho nút "mở chặn" sau này).
 *  - counted_T = thô_T - lỗi_T - thiếu_T;  room_T = need_T - counted_T.
 *  - Vật lý (T phụ): cutCap = thô_CAT - thiếu_CAT;  dùng_T = thô_T - thiếu_T - (lỗi_T - bỏ_T);  physicalLeft_T = cutCap - dùng_T.
 *  - maxNow = max(0, min(room, physicalLeft)); với Cắt: max(0, room). MỘT hàm cho cả tiến độ lẫn phép chặn.
 */

export type PhoiStep = ProcessStepValue;

/** Số đã ghi của 1 (SKU, cỡ, công đoạn). */
export interface PhoiStepCounts {
  /** Số thô công nhân đã báo (cộng cả dòng chờ / đang chấm). */
  raw: number;
  /** KCS chấm lỗi (gồm cả phần bỏ). */
  failed: number;
  /** KCS ghi thiếu (không tính lỗi, không làm bù). */
  short: number;
  /** Chỉ công đoạn phụ: số đoạn bỏ (cắt lại), nằm trong `failed`. */
  scrap: number;
}

export const EMPTY_PHOI_COUNTS: PhoiStepCounts = { raw: 0, failed: 0, short: 0, scrap: 0 };

/** Dữ liệu của 1 (SKU, cỡ đoạn). */
export interface PhoiNeedInput {
  /** base_T theo công đoạn (CAT = mọi dòng định mức). */
  baseByStep: Partial<Record<PhoiStep, number>>;
  /** processSteps của từng dòng định mức có số cần > 0 (để biết cặp công đoạn "cần cả T lẫn U"). */
  lineSteps: readonly (readonly string[])[];
  counts: Partial<Record<PhoiStep, PhoiStepCounts>>;
  /**
   * Đoạn DƯ theo phương án cắt đã duyệt (anh Nhân câu 12b/13a, 24/11/2026) theo công đoạn: được báo THÊM ngoài số cần (cắt + làm đủ
   * công đoạn của dòng định mức, KCS chấm, đạt vào phần dư chung). KHÔNG cộng vào `required` - tiến độ / "xong" vẫn theo số cần.
   */
  openedByStep?: Partial<Record<PhoiStep, number>>;
  /** Câu 14a (24/11/2026): đoạn dư lấy từ kho theo công đoạn - trừ khỏi số cần (không âm). */
  fromStockByStep?: Partial<Record<PhoiStep, number>>;
}

/** Kết quả tính cho 1 (SKU, cỡ đoạn, công đoạn). */
export interface PhoiStepNeed {
  step: PhoiStep;
  baseRequired: number;
  extraNeed: number;
  required: number;
  raw: number;
  failed: number;
  short: number;
  scrap: number;
  /** raw - failed - short. */
  counted: number;
  /** required - counted (có thể âm khi đã vượt). */
  room: number;
  /** max(0, counted - required): đã vượt bao nhiêu (gồm đoạn dư theo phương án đã báo). */
  over: number;
  /** Đoạn dư theo phương án được báo thêm ở công đoạn này (openedByStep), 0 khi không có. */
  planSurplus: number;
  /** Chỉ công đoạn phụ: cutCap - dùng; null với Cắt. */
  physicalLeft: number | null;
  /** Chỉ công đoạn phụ: số đoạn cắt thực có = thô Cắt - thiếu Cắt; null với Cắt. */
  cutCap: number | null;
  /** Chỉ công đoạn phụ: thô Cắt (để nói trong câu lỗi); null với Cắt. */
  cutRaw: number | null;
  /** Chỉ công đoạn phụ: số thiếu của Cắt; null với Cắt. */
  cutShort: number | null;
  /** Chỉ công đoạn phụ: số đoạn đã dùng = thô - thiếu - (lỗi - bỏ); null với Cắt. */
  used: number | null;
  /** Chỉ công đoạn phụ: số đoạn KCS cho "làm lại" (lỗi - bỏ); 0 với Cắt. */
  rework: number;
  maxNow: number;
}

const stepIndex = (step: string): number => (PROCESS_STEPS as readonly string[]).indexOf(step);

const countsOf = (input: PhoiNeedInput, step: PhoiStep): PhoiStepCounts =>
  input.counts[step] ?? EMPTY_PHOI_COUNTS;

/**
 * Số đoạn phải làm thêm ở công đoạn `step` vì KCS BỎ đoạn ở các công đoạn sau.
 * `scrapByStep`: Σ bỏ theo công đoạn phụ. `lineSteps`: processSteps của các dòng định mức của cỡ này.
 * Dùng chung với segment-production (mức cả PI: lineSteps của mọi dòng định mức trong PI).
 */
export function extraNeedOf(
  step: PhoiStep,
  scrapByStep: Partial<Record<string, number>>,
  lineSteps: readonly (readonly string[])[],
): number {
  let total = 0;
  if (step === 'CAT') {
    for (const [u, scrap] of Object.entries(scrapByStep)) {
      if (u !== 'CAT') total += scrap ?? 0;
    }
    return total;
  }
  const idx = stepIndex(step);
  for (const [u, scrap] of Object.entries(scrapByStep)) {
    if (!scrap || u === 'CAT' || stepIndex(u) <= idx) continue;
    if (lineSteps.some((l) => l.includes(step) && l.includes(u))) total += scrap;
  }
  return total;
}

/** Σ bỏ theo công đoạn phụ từ bộ đếm. */
export function scrapByStepOf(
  counts: Partial<Record<PhoiStep, PhoiStepCounts>>,
): Partial<Record<string, number>> {
  const out: Partial<Record<string, number>> = {};
  for (const [step, c] of Object.entries(counts)) {
    if (step === 'CAT' || !c || c.scrap === 0) continue;
    out[step] = c.scrap;
  }
  return out;
}

/** Tính số cần / còn báo được của 1 công đoạn. */
export function computePhoiStep(input: PhoiNeedInput, step: PhoiStep): PhoiStepNeed {
  const c = countsOf(input, step);
  const baseRequired = input.baseByStep[step] ?? 0;
  const extraNeed = extraNeedOf(step, scrapByStepOf(input.counts), input.lineSteps);
  const required = Math.max(0, baseRequired + extraNeed - (input.fromStockByStep?.[step] ?? 0));
  const planSurplus = Math.max(0, input.openedByStep?.[step] ?? 0);
  const counted = c.raw - c.failed - c.short;
  // room = còn báo được theo số cần + đoạn dư theo phương án.
  const room = required + planSurplus - counted;
  const over = Math.max(0, counted - required);
  if (step === 'CAT') {
    return {
      step,
      baseRequired,
      extraNeed,
      required,
      raw: c.raw,
      failed: c.failed,
      short: c.short,
      scrap: 0,
      counted,
      room,
      over,
      planSurplus,
      physicalLeft: null,
      cutCap: null,
      cutRaw: null,
      cutShort: null,
      used: null,
      rework: 0,
      maxNow: Math.max(0, room),
    };
  }
  const cut = countsOf(input, 'CAT');
  const cutCap = cut.raw - cut.short;
  const rework = c.failed - c.scrap;
  const used = c.raw - c.short - rework;
  const physicalLeft = cutCap - used;
  return {
    step,
    baseRequired,
    extraNeed,
    required,
    raw: c.raw,
    failed: c.failed,
    short: c.short,
    scrap: c.scrap,
    counted,
    room,
    over,
    planSurplus,
    physicalLeft,
    cutCap,
    cutRaw: cut.raw,
    cutShort: cut.short,
    used,
    rework,
    maxNow: Math.max(0, Math.min(room, physicalLeft)),
  };
}

/** Vế nào chặn lần báo `qty`: null = cho qua. Cả 2 vế cùng chặn thì lấy vế có số tối đa NHỎ hơn; bằng nhau thì vế số cần. */
export type PhoiBlockKind = 'NEED' | 'PHYSICAL';
export function pickPhoiBlock(n: PhoiStepNeed, qty: number): PhoiBlockKind | null {
  const needMax = Math.max(0, n.room);
  const physMax = n.physicalLeft == null ? Number.POSITIVE_INFINITY : Math.max(0, n.physicalLeft);
  const needBlocks = qty > needMax;
  const physBlocks = qty > physMax;
  if (!needBlocks && !physBlocks) return null;
  if (needBlocks && physBlocks) return physMax < needMax ? 'PHYSICAL' : 'NEED';
  return needBlocks ? 'NEED' : 'PHYSICAL';
}

export const PHOI_OVERUSE_SUFFIX = 'Số cần sai thì báo QLSX.';

export interface PhoiBlockContext {
  /** Số mm của cỡ đoạn (vd "441" hoặc "452.7"). */
  cutLengthMm: string;
  /** Mã SKU (nhãn người dùng thấy). */
  skuLabel: string;
  qty: number;
}

/** Câu 400 khi báo CẮT vượt số cần (hợp đồng v2 mục 11). */
export function buildCutBlockMessage(n: PhoiStepNeed, ctx: PhoiBlockContext): string {
  const extra =
    (n.extraNeed > 0 ? ` (gồm ${n.extraNeed} đoạn cắt lại cho đoạn KCS bỏ)` : '') +
    (n.planSurplus > 0 ? ` + ${n.planSurplus} đoạn dư theo phương án` : '');
  return (
    `Cỡ ${ctx.cutLengthMm}mm (SKU ${ctx.skuLabel}): cần ${n.required} đoạn${extra}, đã tính ${n.counted} - ` +
    `lần này báo được tối đa ${Math.max(0, n.room)} đoạn, bạn nhập ${ctx.qty}. ` +
    (n.planSurplus > 0
      ? `Đếm lại; đoạn cắt quá số này để riêng dưới xưởng, không báo. ${PHOI_OVERUSE_SUFFIX}`
      : `Đếm lại; đoạn cắt dư để riêng dưới xưởng, không báo. ${PHOI_OVERUSE_SUFFIX}`)
  );
}

/** Câu 400 khi báo công đoạn phụ vượt (vế số cần hoặc vế vật lý, theo `kind`). */
export function buildStepBlockMessage(
  n: PhoiStepNeed,
  kind: PhoiBlockKind,
  ctx: PhoiBlockContext,
): string {
  const label = processStepLabel(n.step);
  if (kind === 'NEED') {
    const extra =
      (n.extraNeed > 0 ? ` (gồm ${n.extraNeed} đoạn làm bù cho đoạn KCS bỏ)` : '') +
      (n.planSurplus > 0 ? ` + ${n.planSurplus} đoạn dư theo phương án` : '');
    return (
      `Cỡ ${ctx.cutLengthMm}mm (SKU ${ctx.skuLabel}): cần ${label} ${n.required} đoạn${extra}, đã tính ${n.counted} - ` +
      `lần này báo được tối đa ${Math.max(0, n.room)} đoạn, bạn nhập ${ctx.qty}. ` +
      `Đếm lại số đoạn. ${PHOI_OVERUSE_SUFFIX}`
    );
  }
  const left = n.physicalLeft ?? 0;
  const short = n.cutShort ? ` (KCS ghi thiếu ${n.cutShort} đoạn cắt)` : '';
  const rework = n.rework > 0 ? ` (không tính ${n.rework} đoạn KCS cho làm lại)` : '';
  return (
    `Cỡ ${ctx.cutLengthMm}mm (SKU ${ctx.skuLabel}): đã cắt ${n.cutRaw ?? 0} đoạn${short}, đã ${label} ${n.used ?? 0}${rework} - ` +
    `lần này báo được tối đa ${Math.max(0, left)}, bạn nhập ${ctx.qty}. ` +
    `Muốn ${label} thêm thì báo cắt thêm ${ctx.qty - left} đoạn ${ctx.cutLengthMm}mm ở máy cắt trước. ${PHOI_OVERUSE_SUFFIX}`
  );
}

/**
 * Các công đoạn phụ đang "đã dùng" nhiều hơn số đoạn cắt thực có (vì KCS ghi thiếu ở Cắt) của 1 (SKU, cỡ).
 * BE-1 dùng để dựng notes[] khi chấm Cắt có thiếu. `cutCap` = số đoạn cắt thực có (thô Cắt - thiếu Cắt) để câu ghi đủ số.
 */
export function stepsOverCutCap(
  input: PhoiNeedInput,
): { step: PhoiStep; overBy: number; cutCap: number }[] {
  const out: { step: PhoiStep; overBy: number; cutCap: number }[] = [];
  for (const step of PROCESS_STEPS) {
    if (step === 'CAT') continue;
    const c = input.counts[step];
    if (!c || c.raw === 0) continue;
    const n = computePhoiStep(input, step);
    if (n.physicalLeft != null && n.physicalLeft < 0 && n.cutCap != null) {
      out.push({ step, overBy: -n.physicalLeft, cutCap: n.cutCap });
    }
  }
  return out;
}

// --------------------------------------------------------------------------------------------------------------------
// Dựng bộ đếm (SKU, cỡ) từ các dòng thô

export interface PhoiNeedRows {
  orders: readonly { id: bigint; bomRevisionId: bigint; quantity: number }[];
  /** Đoạn dư theo phương án đã duyệt, đã gán cho 1 SKU (loadPlanSurplus). Thiếu = không có. */
  planSurplus?: readonly PlanSurplusRow[];
  bomPieces: readonly { bomRevisionId: bigint; pieceId: bigint; qtyPerUnit: number }[];
  pieceBoms: readonly {
    bomRevisionId: bigint;
    pieceId: bigint;
    segmentSpecId: bigint;
    qtyPerPiece: number;
    processSteps: readonly string[];
  }[];
  cut: readonly { segmentSpecId: bigint; productionOrderId: bigint | null; qty: number }[];
  cutQc: readonly {
    segmentSpecId: bigint;
    productionOrderId: bigint | null;
    failedQty: number;
    shortQty?: number;
  }[];
  step: readonly {
    segmentSpecId: bigint;
    productionOrderId: bigint | null;
    step: string;
    qty: number;
  }[];
  stepQc: readonly {
    segmentSpecId: bigint;
    productionOrderId: bigint | null;
    step: string;
    failedQty: number;
    shortQty?: number;
    scrapQty?: number;
  }[];
}

/** Khoá SKU của 1 dòng: đợt chưa gắn SKU ở PI 1 SKU tính cho SKU duy nhất; ở PI nhiều SKU là 'none' (không tính cho SKU nào). */
export function phoiOrderKey(
  orders: readonly { id: bigint }[],
  id: bigint | null | undefined,
): string {
  const resolved = id ?? (orders.length === 1 ? orders[0].id : null);
  return resolved == null ? 'none' : resolved.toString();
}

/** 1 dòng đoạn dư theo phương án đã gán cho SKU (xem plan-surplus.util). */
export interface PlanSurplusRow {
  productionOrderId: bigint;
  segmentSpecId: bigint;
  qty: number;
  /**
   * Có mặt = dòng ĐOẠN DƯ LẤY TỪ KHO (câu 14a): `qty` đoạn đã làm đủ bộ công đoạn này (mã đoạn, '' = trơn) - GIẢM số cần Cắt và
   * các công đoạn trong bộ. Thiếu = dòng dư theo phương án (cho báo thêm).
   */
  fromStockSteps?: string;
}

/** Chỉ mục (SKU, cỡ đoạn) -> dữ liệu tính. Khoá `${orderKey}:${specKey}`. */
export class PhoiNeedIndex {
  readonly byKey = new Map<string, PhoiNeedInput>();

  private ensure(orderKey: string, specKey: string): PhoiNeedInput {
    const k = `${orderKey}:${specKey}`;
    let v = this.byKey.get(k);
    if (!v) {
      v = { baseByStep: {}, lineSteps: [], counts: {} };
      this.byKey.set(k, v);
    }
    return v;
  }

  get(orderKey: string, specKey: string): PhoiNeedInput | undefined {
    return this.byKey.get(`${orderKey}:${specKey}`);
  }

  /** Mọi khoá SKU có dữ liệu ở cỡ này (kể cả 'none'). */
  orderKeysOf(specKey: string): string[] {
    const out: string[] = [];
    for (const k of this.byKey.keys()) {
      const i = k.indexOf(':');
      if (k.slice(i + 1) === specKey) out.push(k.slice(0, i));
    }
    return out;
  }

  /** Cỡ đoạn có trong chỉ mục. */
  specKeys(): Set<string> {
    const out = new Set<string>();
    for (const k of this.byKey.keys()) out.add(k.slice(k.indexOf(':') + 1));
    return out;
  }

  /** @internal */
  add(orderKey: string, specKey: string, step: string, field: keyof PhoiStepCounts, qty: number) {
    const input = this.ensure(orderKey, specKey);
    const counts = (input.counts[step as PhoiStep] ??= { ...EMPTY_PHOI_COUNTS });
    counts[field] += qty;
  }

  /**
   * @internal Đoạn dư theo phương án (câu 12b): cắt + làm đủ công đoạn của dòng định mức NHIỀU công đoạn nhất của cỡ này ở SKU
   * (đoạn dư nhập tồn đúng dạng đoạn của lệnh). Gọi SAU addBase; SKU không có cỡ này thì bỏ.
   */
  addOpened(orderKey: string, specKey: string, qty: number) {
    const input = this.byKey.get(`${orderKey}:${specKey}`);
    if (!input || qty <= 0 || input.lineSteps.length === 0) return;
    const steps = [...input.lineSteps].sort((a, b) => b.length - a.length)[0];
    const opened = (input.openedByStep ??= {});
    opened.CAT = (opened.CAT ?? 0) + qty;
    for (const st of PROCESS_STEPS)
      if (st !== 'CAT' && steps.includes(st)) opened[st] = (opened[st] ?? 0) + qty;
  }

  /** @internal Câu 14a: đoạn dư lấy từ kho (bộ công đoạn `steps` dạng mã 'UON,DAP') giảm số cần Cắt + các công đoạn trong bộ. */
  addFromStock(orderKey: string, specKey: string, steps: string, qty: number) {
    const input = this.byKey.get(`${orderKey}:${specKey}`);
    if (!input || qty <= 0) return;
    const list = steps === '' ? [] : steps.split(',');
    const m = (input.fromStockByStep ??= {});
    m.CAT = (m.CAT ?? 0) + qty;
    for (const st of PROCESS_STEPS)
      if (st !== 'CAT' && list.includes(st)) m[st] = (m[st] ?? 0) + qty;
  }

  /** @internal */
  addBase(orderKey: string, specKey: string, steps: readonly string[], qty: number) {
    const input = this.ensure(orderKey, specKey);
    (input.lineSteps as (readonly string[])[]).push(steps);
    const bump = (s: PhoiStep) => {
      input.baseByStep[s] = (input.baseByStep[s] ?? 0) + qty;
    };
    bump('CAT');
    for (const s of PROCESS_STEPS) if (s !== 'CAT' && steps.includes(s)) bump(s);
  }
}

export function buildPhoiNeedIndex(rows: PhoiNeedRows): PhoiNeedIndex {
  const index = new PhoiNeedIndex();
  const keyOf = (id: bigint | null) => phoiOrderKey(rows.orders, id);
  const qtyPerUnitByKey = new Map(
    rows.bomPieces.map((bp) => [`${bp.bomRevisionId}:${bp.pieceId}`, bp.qtyPerUnit]),
  );
  for (const order of rows.orders) {
    for (const pb of rows.pieceBoms) {
      if (pb.bomRevisionId !== order.bomRevisionId) continue;
      const qtyPerUnit = qtyPerUnitByKey.get(`${pb.bomRevisionId}:${pb.pieceId}`) ?? 0;
      const segments = pb.qtyPerPiece * qtyPerUnit * order.quantity;
      if (segments <= 0) continue;
      index.addBase(order.id.toString(), pb.segmentSpecId.toString(), pb.processSteps, segments);
    }
  }
  for (const r of rows.planSurplus ?? []) {
    if (r.fromStockSteps !== undefined)
      index.addFromStock(
        r.productionOrderId.toString(),
        r.segmentSpecId.toString(),
        r.fromStockSteps,
        r.qty,
      );
    else index.addOpened(r.productionOrderId.toString(), r.segmentSpecId.toString(), r.qty);
  }
  for (const r of rows.cut) {
    index.add(keyOf(r.productionOrderId), r.segmentSpecId.toString(), 'CAT', 'raw', r.qty);
  }
  for (const r of rows.cutQc) {
    const k = keyOf(r.productionOrderId);
    const s = r.segmentSpecId.toString();
    index.add(k, s, 'CAT', 'failed', r.failedQty);
    index.add(k, s, 'CAT', 'short', r.shortQty ?? 0);
  }
  for (const r of rows.step) {
    if (r.step === 'CAT') continue;
    index.add(keyOf(r.productionOrderId), r.segmentSpecId.toString(), r.step, 'raw', r.qty);
  }
  for (const r of rows.stepQc) {
    if (r.step === 'CAT') continue;
    const k = keyOf(r.productionOrderId);
    const s = r.segmentSpecId.toString();
    index.add(k, s, r.step, 'failed', r.failedQty);
    index.add(k, s, r.step, 'short', r.shortQty ?? 0);
    index.add(k, s, r.step, 'scrap', r.scrapQty ?? 0);
  }
  return index;
}
