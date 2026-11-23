// Đóng đường báo của màn thống kê tổ Phôi / Hàn / Sơn (16/11/2026, đợt 1): mọi số sản lượng do
// công nhân báo bằng quét mã QR tại máy. Đường QR gọi thẳng service nên không bị các câu này chặn.

/** Nhận sắt cây ở màn cũ của Phôi. */
export const LEGACY_STEEL_RECEIVE_CLOSED_MESSAGE =
  'Nhận sắt cây làm bằng quét mã QR "Khu nhận sắt" của xưởng có lô sắt đó.';

/** Báo cắt và công đoạn phụ ở màn cũ của Phôi. */
export const LEGACY_CUT_REPORT_CLOSED_MESSAGE =
  'Báo cắt và công đoạn phụ làm bằng quét mã QR tại máy. KCS tự chấm; báo sai số thì KCS sửa bằng “Thực có” lúc chấm.';

/** Báo sản lượng Hàn / Sơn ở màn cũ (production-batches). */
export const LEGACY_HAN_SON_REPORT_CLOSED_MESSAGE =
  'Báo sản lượng Hàn / Sơn làm bằng quét mã QR tại máy. KCS tự chấm; báo sai số thì KCS sửa bằng “Thực có” lúc chấm.';

/** Ba route gửi KCS cũ của QLSX (P1, 18/11/2026): KCS tự chấm nên không còn bước gửi. Route giữ nguyên, trả 403 câu này. */
export const SEND_KCS_REMOVED_MESSAGE =
  'Từ nay KCS tự chấm các đợt công nhân vừa báo - QLSX không cần gửi KCS nữa. Tải lại trang.';

/** Hủy lần báo của QLSX đã bỏ (23/11/2026): route /floor/reports/:id/reverse giữ lại, trả 403 câu này. */
export const REVERSE_REMOVED_MESSAGE =
  'QLSX không còn hủy lần báo của công nhân. Báo sai số thì KCS sửa bằng “Thực có” lúc chấm. Tải lại trang.';
