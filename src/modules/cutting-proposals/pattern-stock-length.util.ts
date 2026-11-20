/**
 * CS2 (anh Nhân 20/11/2026): 1 loại sắt trong 1 phương án có thể vừa cắt cây lẻ đang có ở kho Phôi vừa cắt cây chiều dài
 * mua - số cây phải tách theo TỪNG chiều dài (CuttingProposalPattern.stockLengthMm), không còn 1 chiều dài/dòng.
 *
 * Trả Map<chiều dài, số cây> tăng dần theo chiều dài. Kiểu cắt chưa lưu chiều dài (phương án tính trước 20/11) tính theo
 * `line.bestStockLengthMm`. Nếu tổng cây các kiểu cắt ít hơn `line.totalBars` (dòng không tải kiểu cắt / dữ liệu cũ) thì
 * phần chênh tính vào chiều dài mua (`bestStockLengthMm`) - giữ đúng hành vi cũ "cả dòng 1 chiều dài".
 */
export function barsByStockLength(
  line: { bestStockLengthMm: number | null; totalBars: number | null },
  patterns: ReadonlyArray<{ stockLengthMm: number | null; barCount: number }> | null | undefined,
): Map<number, number> {
  const byLen = new Map<number, number>();
  let counted = 0;
  for (const p of patterns ?? []) {
    const len = p.stockLengthMm ?? line.bestStockLengthMm;
    if (len == null || !(p.barCount > 0)) continue;
    byLen.set(len, (byLen.get(len) ?? 0) + p.barCount);
    counted += p.barCount;
  }
  const rest = (line.totalBars ?? 0) - counted;
  if (rest > 0 && line.bestStockLengthMm != null) {
    byLen.set(line.bestStockLengthMm, (byLen.get(line.bestStockLengthMm) ?? 0) + rest);
  }
  return new Map([...byLen].sort((a, b) => a[0] - b[0]));
}
