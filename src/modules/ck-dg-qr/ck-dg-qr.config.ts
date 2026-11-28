import { BadRequestException } from '@nestjs/common';

/**
 * Công tắc công nhân tự báo Chuyền kiểm + Đóng gói bằng quét QR (24/11/2026 - docs THIET-KE-CHUYEN-KIEM-DONG-GOI-QR-2026-11-24,
 * chốt C1-C4, D1-D4): env CK_DG_QR_ENABLED, mặc định TẮT. Bật thì:
 *  - tổ CHUYEN_KIEM quét tem điểm chuyền kiểm, báo đợt (SKU, mảnh, số đạt, số lỗi + nguyên nhân + ảnh), chặn theo "Hiện có" (C3);
 *  - KCS chuyền kiểm (mfgRole KCS_CHUYEN_KIEM) chấm đợt - chỉ khi chấm số đạt mới ghi vào TransferCheckResult ("đã qua chuyền kiểm");
 *  - tổ DONG_GOI quét tem khu đóng gói, báo số bộ đã đóng - tính luôn, chặn theo số bộ đã qua KCS chuyền kiểm (D2) và số lượng lệnh;
 *    thủ kho Thành phẩm huỷ lần báo sai có lý do (D4). Nhập tay đóng gói / chuyền kiểm cũ cũng chặn theo cùng quy tắc.
 * Xuất vật tư đóng gói (D3) không đổi. Tắt công tắc: mọi API mới trả `enabled: false` / 400, màn kho như cũ.
 * Đọc mỗi lần gọi (không nhớ) để test bật / tắt được.
 */
export function isCkDgQrEnabled(): boolean {
  return (process.env.CK_DG_QR_ENABLED ?? '').trim().toLowerCase() === 'true';
}

export const CK_DG_QR_DISABLED_MESSAGE =
  'Chuyền kiểm / đóng gói bằng quét QR chưa bật (CK_DG_QR_ENABLED) - vẫn nhập ở màn kho Thành phẩm như cũ';

/**
 * Câu 12 (chốt 25/11/2026, phương án a): bật QR thì khoá hẳn nhập tay chuyền kiểm / đóng gói ở kho Thành phẩm, kể cả Admin - trước
 * đây chỉ FE để màn chỉ xem, gọi thẳng API vẫn ghi được. Đường QR (recordPackagingEntry) không đi qua đây.
 */
export function assertManualCkDgAllowed(what: 'chuyền kiểm' | 'đóng gói'): void {
  if (isCkDgQrEnabled()) {
    throw new BadRequestException(
      `Đã bật ${what} bằng quét QR - công nhân báo qua QR, kho Thành phẩm không nhập tay ${what}`,
    );
  }
}
