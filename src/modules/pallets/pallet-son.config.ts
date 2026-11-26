/**
 * Công tắc pallet Sơn (24/11/2026 - docs THIET-KE-PALLET-SON-2026-11-24): env PALLET_SON_ENABLED, mặc định TẮT. Bật thì:
 *  - thủ kho Sơn tạo pallet (tem QR cố định, dùng lại), xếp pallet theo lệnh + mảnh + số (chặn vượt số tổ Sơn còn báo được);
 *  - công nhân Sơn quét tem pallet -> "Sơn xong pallet này" / "Báo thiếu" = 1 lần báo Sơn bình thường (recordProductionBatch);
 *  - xuất đan quét pallet đã sơn vào phiếu XK (dòng WEAVING_PIECE), xác nhận phiếu -> pallet về Trống.
 * KCS không đổi gì (P8). Tắt công tắc: mọi API pallet trả `enabled: false` / 400, phiếu xuất và báo sản lượng như cũ.
 * Đọc mỗi lần gọi (không nhớ) để test bật / tắt được.
 */
export function isPalletSonEnabled(): boolean {
  return (process.env.PALLET_SON_ENABLED ?? '').trim().toLowerCase() === 'true';
}

export const PALLET_SON_DISABLED_MESSAGE =
  'Pallet Sơn chưa bật (PALLET_SON_ENABLED) - chưa xếp / báo / xuất đan theo pallet được';
