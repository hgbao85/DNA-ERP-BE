// Đóng đường báo của màn thống kê tổ Phôi / Hàn / Sơn (16/11/2026, đợt 1): mọi số sản lượng do
// công nhân báo bằng quét mã QR tại máy. Đường QR gọi thẳng service nên không bị các câu này chặn.

/** Nhận sắt cây ở màn cũ của Phôi. */
export const LEGACY_STEEL_RECEIVE_CLOSED_MESSAGE =
  'Nhận sắt cây làm bằng quét mã QR "Khu nhận sắt" của xưởng có lô sắt đó.';

/** Báo cắt và công đoạn phụ ở màn cũ của Phôi. */
export const LEGACY_CUT_REPORT_CLOSED_MESSAGE =
  'Báo cắt và công đoạn phụ làm bằng quét mã QR tại máy. QLSX kiểm, hủy lần báo sai và gửi KCS ở "Sản lượng xưởng".';

/** Báo sản lượng Hàn / Sơn ở màn cũ (production-batches). */
export const LEGACY_HAN_SON_REPORT_CLOSED_MESSAGE =
  'Báo sản lượng Hàn / Sơn làm bằng quét mã QR tại máy. QLSX kiểm rồi gửi KCS ở "Sản lượng xưởng".';
