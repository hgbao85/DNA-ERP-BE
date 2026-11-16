/**
 * Công tắc phía cộng tồn đoạn theo lệnh (env SEGMENT_STOCK_ENABLED, mặc định TẮT - xem src/config/env.validation.ts).
 * Tắt: KCS không ghi gì vào tồn đoạn, endpoint tính lại chỉ chạy được chế độ xem thử (dryRun). Bật khi phía trừ (Hàn/Sơn trừ
 * phần giữ của lệnh) đã xong - bật sớm thì tồn đoạn có công đoạn tăng mà phía trừ cũ vẫn trừ vào dòng trơn.
 * Đọc mỗi lần gọi (không nhớ) để test bật / tắt được.
 */
export function isSegmentStockEnabled(): boolean {
  return (process.env.SEGMENT_STOCK_ENABLED ?? '').trim().toLowerCase() === 'true';
}

/**
 * Khoá của lượt chuyển đổi dữ liệu tồn đoạn cũ (rà soát 14/11 TĐ5): SegmentLegacyConversionService giữ ĐỘC QUYỀN, phía trừ (Hàn / Sơn
 * gửi KCS - ProductionBatchesService.consumeSegmentsByCode) giữ DÙNG CHUNG, nên 2 việc không chạy chen nhau.
 */
export const SEGMENT_LEGACY_CONVERSION_LOCK = 'segment-legacy-conversion';
