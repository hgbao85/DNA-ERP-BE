/**
 * Công tắc phía cộng tồn đoạn theo lệnh (env SEGMENT_STOCK_ENABLED, mặc định TẮT - xem src/config/env.validation.ts).
 * Tắt: KCS không ghi gì vào tồn đoạn, endpoint tính lại chỉ chạy được chế độ xem thử (dryRun). Bật khi phía trừ (Hàn/Sơn trừ
 * phần giữ của lệnh) đã xong - bật sớm thì tồn đoạn có công đoạn tăng mà phía trừ cũ vẫn trừ vào dòng trơn.
 * Đọc mỗi lần gọi (không nhớ) để test bật / tắt được.
 */
export function isSegmentStockEnabled(): boolean {
  return (process.env.SEGMENT_STOCK_ENABLED ?? '').trim().toLowerCase() === 'true';
}
