import { SteelReturnStatus } from '../../../generated/prisma/client';

/**
 * Sắt tổ cắt trả về khi ngưng cắt SKU đã huỷ - số cây đã RỜI tổ cắt của từng dòng (nghiệp vụ 28/11, phương án a):
 *  - dòng chờ thủ kho xác nhận (PENDING): số QLSX ghi - cây đã đem ra, đang chờ đếm;
 *  - dòng đã xác nhận: số thủ kho đếm (confirmedBars). Phần chênh (bars - confirmedBars) vẫn tính CÒN Ở TỔ CẮT, chờ QLSX tìm: tìm
 *    thấy thì "Ghi trả thêm" (dòng mới trỏ về dòng thiếu qua makeupForId - dòng đó tự tính theo 2 gạch trên), không thấy thì
 *    "Xác nhận mất" (shortLostAt) - phần thiếu còn treo lúc đó rời tổ cắt thành hao hụt (không ghi sổ kho).
 * Trước 28/11 mọi chỗ tính lấy `bars` (số QLSX ghi) nên thủ kho đếm thiếu thì cây chênh mất khỏi sổ.
 */
export interface SteelReturnBarsRow {
  id: bigint;
  status: SteelReturnStatus;
  bars: number;
  confirmedBars: number | null;
  makeupForId: bigint | null;
  shortLostAt: Date | null;
}

/** Trường cần select để tính - đặt cạnh các trường riêng của từng nơi đọc. */
export const STEEL_RETURN_BARS_SELECT = {
  id: true,
  status: true,
  bars: true,
  confirmedBars: true,
  makeupForId: true,
  shortLostAt: true,
} as const;

/** Số cây thủ kho đếm thiếu so với số QLSX ghi (0 nếu chưa xác nhận / đủ). */
export function shortBarsOf(
  r: Pick<SteelReturnBarsRow, 'status' | 'bars' | 'confirmedBars'>,
): number {
  if (r.status !== SteelReturnStatus.CONFIRMED) return 0;
  return Math.max(0, r.bars - (r.confirmedBars ?? r.bars));
}

/** Σ số cây QLSX đã ghi trả thêm cho từng dòng thiếu (theo id dòng thiếu). */
function makeupBarsById(rows: readonly SteelReturnBarsRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.makeupForId == null) continue;
    const k = r.makeupForId.toString();
    m.set(k, (m.get(k) ?? 0) + r.bars);
  }
  return m;
}

/** Phần thiếu còn treo của từng dòng (chưa ghi trả thêm đủ, chưa xác nhận mất) - QLSX phải xử lý. */
export function outstandingShortById(rows: readonly SteelReturnBarsRow[]): Map<string, number> {
  const makeups = makeupBarsById(rows);
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.shortLostAt) continue;
    const left = shortBarsOf(r) - (makeups.get(r.id.toString()) ?? 0);
    if (left > 0) out.set(r.id.toString(), left);
  }
  return out;
}

/** Số cây đã rời tổ cắt theo từng dòng (id) - dùng thay `bars` ở mọi chỗ tính sắt tổ cắt còn. */
export function barsLeftCutTeamById(rows: readonly SteelReturnBarsRow[]): Map<string, number> {
  const makeups = makeupBarsById(rows);
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.status !== SteelReturnStatus.CONFIRMED) {
      out.set(r.id.toString(), r.bars);
      continue;
    }
    const got = r.confirmedBars ?? r.bars;
    // Xác nhận mất: phần thiếu còn treo (trừ phần đã ghi trả thêm - các dòng đó tự tính) rời tổ cắt.
    const lost = r.shortLostAt
      ? Math.max(0, shortBarsOf(r) - (makeups.get(r.id.toString()) ?? 0))
      : 0;
    out.set(r.id.toString(), got + lost);
  }
  return out;
}
