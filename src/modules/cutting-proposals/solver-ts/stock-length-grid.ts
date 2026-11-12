/**
 * Xưởng chỉ dùng cây đặt riêng tròn 5 cm (changelog 2026-10-02), nên mọi chiều dài cây đặt riêng
 * (dò tự động hoặc KHSX chọn) đều là bội của lưới này. Cố định trong code, không theo cấu hình.
 */
export const STOCK_LENGTH_GRID_MM = 50;

export function roundUpToStockGrid(mm: number): number {
  return Math.ceil(mm / STOCK_LENGTH_GRID_MM - 1e-9) * STOCK_LENGTH_GRID_MM;
}

export function roundDownToStockGrid(mm: number): number {
  return Math.floor(mm / STOCK_LENGTH_GRID_MM + 1e-9) * STOCK_LENGTH_GRID_MM;
}

/** Chiều dài riêng KHSX chọn (làm tròn lên lưới) hoặc chiều dài chuẩn của công ty (giữ nguyên). */
export function resolveMaterialStockLengths(
  chosenMm: number | null | undefined,
  defaults: number[],
): number[] {
  return chosenMm != null && chosenMm > 0 ? [roundUpToStockGrid(chosenMm)] : defaults;
}
