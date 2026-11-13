import { PROCESS_STEPS, ProcessStepValue } from '../constants/process-steps.constant';

/**
 * MÃ ĐOẠN (13/11/2026, tồn đoạn kho Phôi theo lệnh - anh Nhân câu 4: "tách theo mã đoạn"): mã đoạn = (cỡ đoạn, bộ công đoạn phụ).
 * Cỡ đoạn = SegmentSpec (loại sắt + chiều dài cắt). Bộ công đoạn = các công đoạn phụ đoạn phải qua (Uốn/Dập/Đục lỗ/Tán/...),
 * KHÔNG gồm Cắt (đoạn nào cũng cắt). '' = TRƠN (chỉ cắt).
 *
 * Dạng lưu (cột segmentSteps của stock_ledger / stock_quant / segment_reservations / segment_productions): bỏ CAT, bỏ trùng, sắp
 * theo thứ tự nghiệp vụ PROCESS_STEPS, nối bằng dấu phẩy - vd "DAP", "UON,DAP,TAN". Mọi nơi ghi PHẢI đi qua
 * normalizeSegmentSteps(): mảng processSteps của PieceBom lưu theo thứ tự người dùng tick (xem process-steps.constant.ts), không
 * chuẩn hoá thì "CAT,TAN,NHAN" và "CAT,NHAN,TAN" thành 2 mã đoạn cho cùng 1 loại đoạn.
 */

/** Công đoạn phụ của đoạn. */
export type SegmentSubStep = Exclude<ProcessStepValue, 'CAT'>;

/** Công đoạn phụ theo đúng thứ tự nghiệp vụ. CÙNG danh sách với các CHECK *_segment_steps_chk của migration
 *  20261113180000_segment_stock_by_order (test đối chiếu) - thêm công đoạn mới phải sửa cả CHECK. */
export const SEGMENT_SUB_STEPS: readonly SegmentSubStep[] = PROCESS_STEPS.filter(
  (s): s is SegmentSubStep => s !== 'CAT',
);

/** Mã đoạn trơn (chỉ cắt). */
export const TRON_SEGMENT_STEPS = '';

const STEP_LABEL: Record<ProcessStepValue, string> = {
  CAT: 'Cắt',
  UON: 'Uốn',
  DAP: 'Dập',
  DUC_LO: 'Đục lỗ',
  TAN: 'Tán',
  TOP_DAU: 'Tóp đầu',
  XE: 'Xẻ',
  NHAN: 'Nhấn',
};

function isProcessStep(s: string): s is ProcessStepValue {
  return (PROCESS_STEPS as readonly string[]).includes(s);
}

/**
 * Chuẩn hoá bộ công đoạn thành chuỗi mã đoạn. [] / ['CAT'] / null -> '' (trơn). Công đoạn lạ -> lỗi: không lặng lẽ bỏ qua, vì
 * sai mã đoạn là sai tồn.
 */
export function normalizeSegmentSteps(steps: readonly string[] | null | undefined): string {
  const seen = new Set<string>();
  for (const raw of steps ?? []) {
    const s = raw.trim();
    if (!isProcessStep(s)) {
      throw new Error(`Công đoạn '${raw}' không có trong danh sách công đoạn phôi`);
    }
    if (s !== 'CAT') seen.add(s);
  }
  return SEGMENT_SUB_STEPS.filter((s) => seen.has(s)).join(',');
}

/** Chuỗi đã đúng dạng lưu chưa (đúng thứ tự, không trùng, không CAT, không khoảng trắng). '' hợp lệ (trơn). */
export function isNormalizedSegmentSteps(code: string): boolean {
  if (code === TRON_SEGMENT_STEPS) return true;
  const parts = code.split(',');
  if (!parts.every((p) => (SEGMENT_SUB_STEPS as readonly string[]).includes(p))) return false;
  return normalizeSegmentSteps(parts) === code;
}

/** Ngược lại của normalizeSegmentSteps: '' -> [], 'UON,DAP' -> ['UON', 'DAP']. Chuỗi sai dạng -> lỗi. */
export function parseSegmentSteps(code: string): SegmentSubStep[] {
  if (!isNormalizedSegmentSteps(code)) {
    throw new Error(`Bộ công đoạn '${code}' không đúng dạng mã đoạn`);
  }
  return code === TRON_SEGMENT_STEPS ? [] : (code.split(',') as SegmentSubStep[]);
}

/** Nhãn tiếng Việt của bộ công đoạn: '' -> 'Trơn', 'UON,DAP' -> 'Uốn + Dập'. */
export function segmentStepsLabel(code: string): string {
  const steps = parseSegmentSteps(code);
  return steps.length === 0 ? 'Trơn' : steps.map((s) => STEP_LABEL[s]).join(' + ');
}

/** Nhãn đầy đủ của 1 mã đoạn - cùng khuôn segmentSpecLabel cũ ("SAT-005 @ 460mm") thêm bộ công đoạn: "SAT-005 @ 460mm · Dập". */
export function segmentCodeLabel(
  materialCode: string,
  cutLengthMm: number,
  segmentSteps: string,
): string {
  return `${materialCode} @ ${cutLengthMm}mm · ${segmentStepsLabel(segmentSteps)}`;
}

/** 1 mã đoạn. */
export interface SegmentCodeRef {
  segmentSpecId: bigint;
  segmentSteps: string;
}

/** Khoá Map cho 1 mã đoạn (bigint không dùng trực tiếp làm khoá chuỗi được). */
export function segmentCodeKey(segmentSpecId: bigint | string, segmentSteps: string): string {
  return `${segmentSpecId.toString()}|${segmentSteps}`;
}

/** Thứ tự cố định giữa các mã đoạn (cỡ đoạn tăng dần, rồi bộ công đoạn) - khoá nhiều ô tồn trong 1 transaction PHẢI theo thứ tự
 *  này để 2 transaction không khoá chéo nhau (deadlock). */
export function compareSegmentCodes(a: SegmentCodeRef, b: SegmentCodeRef): number {
  if (a.segmentSpecId !== b.segmentSpecId) return a.segmentSpecId < b.segmentSpecId ? -1 : 1;
  if (a.segmentSteps === b.segmentSteps) return 0;
  return a.segmentSteps < b.segmentSteps ? -1 : 1;
}

/** Khoá advisory (lockBusinessKey) cho 1 ô tồn đoạn (kho, cỡ đoạn, bộ công đoạn). Mọi thao tác đọc "dư" rồi ghi (giữ / dùng /
 *  chia dư / phía cộng ghi sổ) của ô đó phải giữ khoá này trong transaction. */
export function segmentBucketLockKey(
  warehouseId: bigint,
  segmentSpecId: bigint,
  segmentSteps: string,
): string {
  return `segment-stock:${warehouseId.toString()}:${segmentSpecId.toString()}:${segmentSteps}`;
}

/** Khoá advisory cho 1 lần tính lại phía cộng của 1 lệnh (2 lượt KCS gần nhau của cùng lệnh chạy lần lượt). Thứ tự khoá: khoá
 *  lệnh trước, rồi các khoá ô tồn theo compareSegmentCodes. */
export function segmentProductionLockKey(productionInvoiceId: bigint): string {
  return `segment-production:${productionInvoiceId.toString()}`;
}
