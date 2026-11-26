/**
 * Hàm thuần của pallet Sơn (24/11/2026, docs THIET-KE-PALLET-SON-2026-11-24) - tách khỏi service để test không cần DB.
 */

/** Tiền tố mã pallet in trên tem (PL-001, PL-002...). */
export const PALLET_CODE_PREFIX = 'PL-';

/** Tối đa số pallet tạo 1 lần (in tem theo lô). */
export const MAX_PALLETS_PER_CREATE = 100;

export interface PalletLoadCapInput {
  /** Số cần của mảnh ở tổ Sơn = BomPiece.qtyPerUnit × SL lệnh. */
  plannedQty: number;
  /** Σ reportedQty mọi đợt Sơn của (lệnh, mảnh) - KCS chấm lỗi / thiếu đã trừ vào đây nên được báo bù. */
  reportedQty: number;
  /** Còn theo hàng tổ Sơn đã nhận (giao nhận giữa tổ). null = không áp dụng (công tắc tắt / mảnh không có cổng nhận). */
  receivedLeft: number | null;
  /** Σ số trên các pallet đã xếp CHƯA sơn (Chờ sơn) của (lệnh, mảnh). */
  pendingQty: number;
}

export interface PalletLoadCap {
  /** Tổ Sơn còn báo được (cùng số BE chặn lúc báo): min(còn theo kế hoạch, còn theo hàng đã nhận). */
  reportableQty: number;
  /** Còn xếp được lên pallet = còn báo được − đang chờ sơn trên pallet. */
  remainingQty: number;
}

/**
 * Trần xếp pallet (P3): tổng các pallet chờ sơn của (lệnh, mảnh) không được vượt số tổ Sơn còn báo được - pallet đã sơn đã nằm
 * trong `reportedQty` nên chỉ cộng phần chờ sơn.
 */
export function palletLoadCap(i: PalletLoadCapInput): PalletLoadCap {
  const byPlan = Math.max(0, i.plannedQty - i.reportedQty);
  const reportableQty =
    i.receivedLeft == null ? byPlan : Math.max(0, Math.min(byPlan, i.receivedLeft));
  return { reportableQty, remainingQty: Math.max(0, reportableQty - i.pendingQty) };
}

/** Cảnh báo vượt sức chứa (P2) - chỉ cảnh báo, không chặn. null = không vượt / chưa khai sức chứa. */
export function capacityWarning(qty: number, capacity: number | null | undefined): string | null {
  if (capacity == null || capacity <= 0 || qty <= capacity) return null;
  return `Pallet xếp ${qty} mảnh, vượt sức chứa ${capacity} mảnh / pallet của mảnh này - kiểm lại cho chắc pallet chịu được.`;
}

/** Số thứ tự của mã PL-NNN (mã khác dạng -> null). */
export function palletCodeNumber(code: string): number | null {
  const m = /^PL-(\d+)$/.exec(code.trim().toUpperCase());
  return m ? Number(m[1]) : null;
}

/** `count` mã kế tiếp sau mã lớn nhất đang có (đệm 3 chữ số: PL-001...PL-999, rồi PL-1000). */
export function nextPalletCodes(existing: readonly string[], count: number): string[] {
  const max = existing.reduce((m, c) => Math.max(m, palletCodeNumber(c) ?? 0), 0);
  return Array.from(
    { length: count },
    (_, i) => `${PALLET_CODE_PREFIX}${String(max + i + 1).padStart(3, '0')}`,
  );
}

export interface PaintQtyResult {
  qty: number;
  short: boolean;
  reason: string | null;
}

/**
 * Số báo Sơn xong của 1 pallet: không nhập = đủ số trên pallet. "Báo thiếu" = số nhỏ hơn + lý do bắt buộc (≥ 3 ký tự).
 * Lỗi trả câu tiếng Việt (service đổi thành 400).
 */
export function resolvePaintQty(
  loadQty: number,
  qty: number | null | undefined,
  reason: string | null | undefined,
): PaintQtyResult | { error: string } {
  const q = qty ?? loadQty;
  if (!Number.isInteger(q) || q <= 0)
    return { error: 'Số mảnh sơn xong phải là số nguyên lớn hơn 0' };
  if (q > loadQty) {
    return {
      error: `Pallet chỉ có ${loadQty} mảnh - không báo hơn số trên pallet được. Thừa mảnh thì báo thủ kho Sơn xếp lại.`,
    };
  }
  if (q === loadQty) return { qty: q, short: false, reason: null };
  const r = (reason ?? '').trim();
  if (r.length < 3) return { error: 'Báo thiếu phải ghi lý do (ít nhất 3 ký tự)' };
  return { qty: q, short: true, reason: r };
}

/** Pallet trên 1 dòng xuất đan: dòng chỉ được sửa GIẢM so với tổng số đã sơn của các pallet. */
export function weavingPalletLimit(pallets: readonly { paintedQty: number }[]): number {
  return pallets.reduce((s, p) => s + p.paintedQty, 0);
}
