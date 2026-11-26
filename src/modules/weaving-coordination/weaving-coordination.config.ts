/**
 * Công tắc Điều phối đan (25/11/2026 - docs THIET-KE-DIEU-PHOI-DAN-2026-11-25, chốt Đ1-Đ4): env DIEU_PHOI_DAN_ENABLED,
 * mặc định TẮT. Bật thì:
 *  - tài khoản Điều phối đan (vai WEAVING_COORDINATOR) xem bảng theo dõi điểm đan (Đ1) + ghi chú / lời hẹn trả có nhắc (Đ2);
 *  - chỉ Điều phối đan và Admin được thêm / sửa / ngừng / xoá điểm đan; không trùng tên; không ngừng điểm đan còn giữ hàng (Đ3).
 * Tắt: API mới trả `enabled: false` / 400, quyền sửa điểm đan như cũ (Admin + thủ kho Phụ kiện). Đọc mỗi lần gọi (không nhớ) để
 * test bật / tắt được. Đ4 (tiền công đan) KHÔNG thuộc công tắc này - làm ở kế toán.
 */
export function isDieuPhoiDanEnabled(): boolean {
  return (process.env.DIEU_PHOI_DAN_ENABLED ?? '').trim().toLowerCase() === 'true';
}

export const DIEU_PHOI_DAN_DISABLED_MESSAGE =
  'Điều phối đan chưa bật (DIEU_PHOI_DAN_ENABLED) - điểm đan vẫn do kho Phụ kiện quản lý như cũ';
