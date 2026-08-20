import type { PrismaTx } from '../../prisma/prisma.service';

/**
 * Khoá advisory Postgres theo 1 khoá nghiệp vụ tuỳ ý (vd `material-issue:900:HAN:10`) - tự nhả
 * khi transaction bao ngoài kết thúc (commit/rollback), không cần unlock tay. Dùng cho các luồng
 * "đọc số dư (SUM/aggregate) rồi ghi" mà không có sẵn 1 dòng để SELECT ... FOR UPDATE - lần ghi
 * đầu tiên cho 1 khoá composite (productionOrderId, stage, materialId, ...) chưa từng có dòng nào
 * để khoá, khác StockQuant/StockReservation đã luôn có sẵn dòng (xem
 * SteelIssuesService.consumeReservationAndDeduct). 2 transaction cùng khoá 1 key tự serialize:
 * transaction sau đợi tới khi cái trước commit/rollback mới đọc tiếp, không còn thấy "remaining"
 * cũ (H2/H3/H4, mục 13.x changelog - material-issues/packaging-issues/weaving-issues).
 *
 * hashtext() có thể trùng khoá cho 2 chuỗi khác nhau (birthday collision) - hậu quả DUY NHẤT là
 * serialize thừa (chờ nhau dù không cần), KHÔNG BAO GIỜ gây sai dữ liệu, nên chấp nhận được.
 */
export async function lockBusinessKey(tx: PrismaTx, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key})::bigint)`;
}
