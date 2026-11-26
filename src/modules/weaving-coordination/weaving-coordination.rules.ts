/**
 * Luật thuần của Điều phối đan (Đ1 / Đ2, 25/11/2026) - không đọc DB, service gom số rồi gọi vào đây.
 */
import { daysBetween } from '../milestone-board/milestone-board.rules';

/** Trạng thái 1 dòng bảng theo dõi (điểm đan × lệnh × mảnh). NO_DEADLINE: lệnh chưa đặt mốc "Nhập đan". */
export type WeavingRowStatus = 'LATE' | 'DUE_SOON' | 'ON_TRACK' | 'NO_DEADLINE' | 'DONE';

export const WEAVING_ROW_STATUSES: WeavingRowStatus[] = [
  'LATE',
  'DUE_SOON',
  'ON_TRACK',
  'NO_DEADLINE',
  'DONE',
];

/** "Sắp tới hạn" = còn từ 0 tới số ngày này (chốt ≤ 3 ngày, mô phỏng 25/11). */
export const WEAVING_DUE_SOON_DAYS = 3;

/** Xếp dòng: cần chú ý hơn lên trước. */
export const WEAVING_STATUS_RANK: Record<WeavingRowStatus, number> = {
  LATE: 0,
  DUE_SOON: 1,
  ON_TRACK: 2,
  NO_DEADLINE: 3,
  DONE: 4,
};

/**
 * Trạng thái dòng. `sent` = tổng mảnh đã xuất đan (phiếu xuất đan đã xác nhận), `returned` = tổng kho Thành phẩm đã nhập đan,
 * `dueDay` = mốc "Nhập đan" của dòng PI ('YYYY-MM-DD' giờ VN, null = chưa đặt), `today` = hôm nay giờ VN.
 * Đã trả đủ (còn giữ ≤ 0) thì DONE bất kể hạn.
 */
export function weavingRowStatus(
  sent: number,
  returned: number,
  dueDay: string | null,
  today: string,
): { status: WeavingRowStatus; held: number; daysLeft: number | null } {
  const held = Math.max(0, sent - returned);
  if (held <= 0)
    return { status: 'DONE', held: 0, daysLeft: dueDay ? daysBetween(today, dueDay) : null };
  if (!dueDay) return { status: 'NO_DEADLINE', held, daysLeft: null };
  const daysLeft = daysBetween(today, dueDay);
  if (daysLeft < 0) return { status: 'LATE', held, daysLeft };
  if (daysLeft <= WEAVING_DUE_SOON_DAYS) return { status: 'DUE_SOON', held, daysLeft };
  return { status: 'ON_TRACK', held, daysLeft };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' có phải 1 ngày lịch thật (không nhận 2026-02-30). */
export function isValidDay(day: string): boolean {
  if (!DAY_RE.test(day)) return false;
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export interface FollowUpInput {
  content: string;
  promisedQty?: number | null;
  promisedDate?: string | null;
}

/**
 * Kiểm 1 ghi chú làm việc (Đ2) trước khi ghi. Trả về lỗi (tiếng Việt) hoặc null. `held` = số điểm đan đang giữ của đúng
 * (điểm đan, lệnh, mảnh) tại lúc ghi; `sent` = tổng đã gửi (0 = điểm đan chưa từng nhận mảnh này của lệnh).
 */
export function validateFollowUp(
  input: FollowUpInput,
  ctx: { sent: number; held: number; today: string },
): string | null {
  if (!input.content || input.content.trim().length === 0) return 'Nội dung trao đổi bắt buộc';
  if (ctx.sent <= 0) return 'Điểm đan này chưa nhận mảnh này của lệnh - không ghi chú được';
  const hasQty = input.promisedQty !== undefined && input.promisedQty !== null;
  const hasDate = !!input.promisedDate;
  if (hasQty !== hasDate) return 'Hẹn trả cần đủ cả số mảnh và ngày hẹn (hoặc bỏ trống cả hai)';
  if (!hasQty) return null;
  const qty = input.promisedQty as number;
  if (!Number.isInteger(qty) || qty <= 0) return 'Số mảnh hẹn trả phải là số nguyên lớn hơn 0';
  if (ctx.held <= 0) return 'Điểm đan đã trả đủ - không còn mảnh nào để hẹn';
  if (qty > ctx.held) return `Số mảnh hẹn trả (${qty}) vượt số điểm đan đang giữ (${ctx.held})`;
  const day = input.promisedDate as string;
  if (!isValidDay(day)) return 'Ngày hẹn không hợp lệ (YYYY-MM-DD)';
  if (day < ctx.today) return 'Ngày hẹn không được trước hôm nay';
  return null;
}

/** Việc cần làm với 1 lời hẹn đang mở ở lượt nhắc nền. */
export type PromiseAction = 'KEEP_WAITING' | 'REMIND' | 'CLOSE_KEPT';

/**
 * Lời hẹn (OPEN / REMINDED): về thêm từ lúc ghi (`returnedSince`) đủ số hẹn -> đóng (KEPT); điểm đan không còn giữ gì cũng đóng.
 * Chưa đủ mà đã tới / qua ngày hẹn và chưa nhắc -> nhắc 1 lần. Còn lại chờ tiếp.
 */
export function promiseAction(p: {
  status: 'OPEN' | 'REMINDED';
  promisedQty: number;
  promisedDay: string;
  returnedSince: number;
  heldNow: number;
  today: string;
}): PromiseAction {
  if (p.returnedSince >= p.promisedQty || p.heldNow <= 0) return 'CLOSE_KEPT';
  if (p.status === 'OPEN' && p.today >= p.promisedDay) return 'REMIND';
  return 'KEEP_WAITING';
}

/** Khoá dòng (điểm đan, lệnh, mảnh) - trùng khoá advisory của nhập đan (weaving-issues.service.ts receive()). */
export const weavingRowLockKey = (orderId: bigint, pieceId: bigint, pointId: bigint): string =>
  `weaving-receipt:${orderId}:${pieceId}:${pointId}`;

/** Khoá dòng dùng làm id trên bảng / FE. */
export const weavingRowKey = (
  pointId: bigint | string,
  orderId: bigint | string,
  pieceId: bigint | string,
) => `${pointId}:${orderId}:${pieceId}`;
