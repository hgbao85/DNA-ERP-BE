/**
 * Công tắc vị trí kho Thành phẩm + soạn hàng theo booking + load từng cont (25/11/2026 - docs
 * THIET-KE-VI-TRI-KHO-LOAD-CONT-2026-11-25, chốt V1-V9): env VI_TRI_KHO_ENABLED, mặc định TẮT. Bật thì:
 *  - thủ kho Thành phẩm khai ô (khu - dãy - ô) + in tem QR (V1);
 *  - công nhân đóng gói phải quét ô khi báo - báo đóng gói = cất vào ô, cùng transaction cộng tồn theo ô (V2);
 *  - tồn theo ô luôn theo bộ 3 SKU - LSX - PO (V9), nhắc khi cất vào ô đã có bộ 3 khác (V3); chuyển ô có lịch sử (V4);
 *  - soạn hàng theo booking: quét ô khi lấy, sai ô / sai mã thì báo (V6); hàng lấy vào từng cont, đóng cont cần số cont + seal + ≥ 1
 *    ảnh + ≥ 1 dòng (V7); xác nhận xuất booking: số thực xuất = hàng đã đóng cont (đi đúng đường xuất cũ, ghi shippedQty như cũ).
 * Tắt công tắc: API mới trả `enabled: false` / 400, báo đóng gói + xuất booking y như cũ. Đọc mỗi lần gọi (không nhớ) để test bật / tắt.
 */
export function isViTriKhoEnabled(): boolean {
  return (process.env.VI_TRI_KHO_ENABLED ?? '').trim().toLowerCase() === 'true';
}

export const VI_TRI_KHO_DISABLED_MESSAGE =
  'Vị trí kho Thành phẩm chưa bật (VI_TRI_KHO_ENABLED) - kho Thành phẩm vẫn làm như cũ';
