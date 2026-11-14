import { PurchaseProposalStatus } from '../../generated/prisma/client';
import type { PrismaTx } from '../../prisma/prisma.service';
import { lockBusinessKey } from './advisory-lock.util';

/**
 * Tìm đề xuất mua "còn mở" (khác PURCHASED) của 1 PI cho bước TÍNH LẠI dòng mua, rồi khoá `purchase-proposal-mutate:<id>` -
 * CÙNG khoá với mọi thao tác ghi trạng thái dòng mua (Giám đốc ký đơn, nhận hàng, đóng phần thiếu, gỡ/huỷ đơn...) - và
 * ĐỌC LẠI các dòng SAU khoá (rà soát 14/11/2026, lỗi MH3). Trước đây tính lại chỉ giữ khoá `purchase-proposal-merge:<pi>`
 * (khác khoá ký đơn) và dùng các dòng đọc trước đó, nên 1 dòng vừa được ký có thể bị ghi đè số hoặc bị đóng.
 *
 * Caller phải đang giữ `purchase-proposal-merge:<pi>` (thứ tự khoá: merge rồi mới mutate; không luồng ký/nhận nào lấy
 * khoá merge nên không có vòng chờ). Trả null khi PI chưa có đề xuất còn mở - caller tự tạo mới như trước.
 */
export async function findOpenProposalForRecompute(tx: PrismaTx, productionInvoiceId: bigint) {
  const head = await tx.purchaseProposal.findFirst({
    where: { productionInvoiceId, status: { not: PurchaseProposalStatus.PURCHASED } },
    select: { id: true },
  });
  if (!head) return null;
  await lockBusinessKey(tx, `purchase-proposal-mutate:${head.id}`);
  // Đọc lại theo id (đề xuất không bị xoá trong khi đang giữ khoá merge) - lấy dòng + trạng thái MỚI NHẤT sau khoá.
  return tx.purchaseProposal.findFirst({
    where: { id: head.id },
    include: { items: true },
  });
}
