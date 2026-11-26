import { isSegmentStockEnabled } from '../segment-stock/segment-stock.config';

/**
 * Công tắc giao nhận giữa tổ (24/11/2026 - docs THIET-KE-GIAO-NHAN-GIUA-TO): env STAGE_HANDOVER_ENABLED, mặc định TẮT.
 * Bật thì:
 *  - kho Phôi giao đoạn cho Hàn, kho Hàn Phú An giao mảnh cho Sơn bằng phiếu XK (dòng SEGMENT_HANDOVER / FRAME_HANDOVER);
 *  - Hàn / Sơn chỉ báo trong số đã nhận theo phiếu (+ phần QLSX mở chặn), không vượt kế hoạch (maxNow);
 *  - Phôi báo cắt bị chặn khi mm đoạn đã báo > 102% mm sắt đã nhận (trước: chỉ cảnh báo).
 * Cần tồn đoạn (SEGMENT_STOCK_ENABLED) - bật công tắc này mà tồn đoạn tắt thì coi như tắt.
 * Đọc mỗi lần gọi (không nhớ) để test bật / tắt được.
 */
export function isStageHandoverEnabled(): boolean {
  return (
    isSegmentStockEnabled() &&
    (process.env.STAGE_HANDOVER_ENABLED ?? '').trim().toLowerCase() === 'true'
  );
}

/** Dung sai Phôi: mm đoạn đã báo không vượt quá 102% mm sắt đã nhận (chốt 24/11/2026). */
export const PHOI_STEEL_TOLERANCE = 0.02;
