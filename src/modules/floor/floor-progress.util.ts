/**
 * Định nghĩa SỐ DUY NHẤT của tiến độ tổ (2026-10-16, changelog-2026-10-08-ke-hoach-tem-qr-bo-sat-phoi.md mục 45).
 * Mỗi dòng (cỡ đoạn × công đoạn của Phôi, hoặc mảnh của Hàn/Sơn) có:
 *   Đã báo = Chưa gửi KCS + Chờ KCS + KCS đã chấm (Đạt + Lỗi)
 *   Đạt/được tính = Đã báo − Lỗi      Còn thiếu = max(0, Cần − Đạt/được tính)
 * Tiến độ tổ = Σ min(Đã báo − Lỗi, Cần) / Σ Cần trên MỌI dòng tổ phải làm — dòng báo vượt không che dòng còn thiếu.
 * Dùng ở FloorAdminService.computeProgress (thẻ PI của tổ, nhắc "đủ số"). FE (D:\DNA-ERP
 * src/modules/pages/Floor/progressModel.ts) là bản sao đúng công thức này cho màn "Tổng hợp lệnh SX" — sửa 1 bên
 * thì sửa cả bên kia.
 */

/** Số liệu gốc của 1 dòng. `done` là TỔNG đã báo (gồm cả open, awaiting và đã chấm); `failed` là số KCS chấm lỗi. */
export interface ProgressLineInput {
  required: number;
  done: number;
  failed: number;
  /** Phần của `done` chưa gửi KCS. */
  open: number;
  /** Phần của `done` đã gửi KCS, chờ chấm. */
  awaiting: number;
}

/** Số đã chặn trần ở `required`: passed + awaiting + open = reported ≤ required. */
export interface ProgressBuckets {
  required: number;
  reported: number;
  /** KCS đã chấm và còn được tính (Đã báo − Lỗi − chờ − chưa gửi). */
  passed: number;
  awaiting: number;
  open: number;
  /** Số KCS chấm lỗi (không chặn trần — để hiện "Lỗi n"). */
  failed: number;
}

export const emptyBuckets = (): ProgressBuckets => ({
  required: 0,
  reported: 0,
  passed: 0,
  awaiting: 0,
  open: 0,
  failed: 0,
});

/** Số được tính của dòng (đã trừ lỗi, chưa chặn trần). */
export function goodQty(line: Pick<ProgressLineInput, 'done' | 'failed'>): number {
  return Math.max(0, line.done - line.failed);
}

/** Dòng còn thiếu = số được tính chưa đủ số cần. */
export function isShort(line: ProgressLineInput): boolean {
  return line.required > 0 && goodQty(line) < line.required;
}

/**
 * Chia 1 dòng vào 3 ngăn theo thứ tự ưu tiên đạt → chờ KCS → chưa gửi, rồi chặn trần ở `required`
 * (báo vượt thì phần vượt bỏ đi, ngăn "chưa gửi" bị cắt trước).
 */
export function bucketLine(line: ProgressLineInput): ProgressBuckets {
  const good = goodQty(line);
  // Tổng 3 ngăn = min(Đã báo − Lỗi, Cần) - kể cả khi dữ liệu lệch (lỗi lớn hơn phần đã chấm) cũng không vượt.
  const cap = Math.min(good, line.required);
  // KCS đã chấm còn được tính = phần còn lại sau khi trừ đợt chưa chấm; lỗi chỉ trừ vào phần đã chấm.
  const passedRaw = Math.max(0, good - line.open - line.awaiting);
  const passed = Math.min(passedRaw, cap);
  const awaiting = Math.min(line.awaiting, cap - passed);
  const open = Math.min(line.open, cap - passed - awaiting);
  return {
    required: line.required,
    reported: passed + awaiting + open,
    passed,
    awaiting,
    open,
    failed: line.failed,
  };
}

export function addBuckets(into: ProgressBuckets, b: ProgressBuckets): void {
  into.required += b.required;
  into.reported += b.reported;
  into.passed += b.passed;
  into.awaiting += b.awaiting;
  into.open += b.open;
  into.failed += b.failed;
}

/**
 * % nguyên, cùng quy tắc với `pctOf` của FE "Tổng hợp lệnh SX" (audit T1) để 2 màn ra cùng số: làm tròn XUỐNG (chưa
 * đủ thì không bao giờ hiện 100), đã có làm dù rất ít thì tối thiểu 1% (0% đọc như "chưa làm gì").
 */
export function percentOf(reported: number, required: number): number {
  if (required <= 0) return 0;
  const done = Math.min(reported, required);
  return Math.min(100, Math.max(done > 0 ? 1 : 0, Math.floor((done / required) * 100)));
}
