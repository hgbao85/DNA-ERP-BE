import type { PrismaTx } from '../../prisma/prisma.service';
import { PurchaseProposalStatus } from '../../generated/prisma/client';

/**
 * Tính lại PurchaseProposal.status (ROLLUP, không còn là nguồn sự thật - 2026-08-25 "duyệt riêng
 * từng người mua hàng") từ trạng thái TỪNG DÒNG PurchaseProposalItem. Dùng ở CUỐI mọi thao tác ghi
 * item.status - trong CÙNG transaction/khoá `purchase-proposal-mutate:<proposalId>` với thao tác
 * đó, để rollup không bao giờ "trễ nhịp" so với dữ liệu item thật.
 *
 * Dùng chung cho cả PurchaseProposalsService (acknowledge/submit/approve/reject/requote/
 * receiveItem) LẪN 3 service tạo/gộp đề xuất (CuttingProposalsService.approve(),
 * ConsumableMaterialPurchaseService, PieceMaterialYieldPurchaseService) - đứng riêng file này
 * (không phải method private của PurchaseProposalsService) vì 4 chỗ gọi thuộc 4 class khác nhau,
 * không tiện inject chéo chỉ để gọi 1 hàm thuần tính toán.
 *
 * Thứ tự ưu tiên (mọi item PURCHASED -> ... -> item nào cũng NEW): xem comment từng nhánh.
 */
export async function recomputeProposalStatus(tx: PrismaTx, proposalId: bigint): Promise<void> {
  const items = await tx.purchaseProposalItem.findMany({
    where: { proposalId },
    select: { status: true },
  });
  const statuses = items.map((i) => i.status);
  if (statuses.length === 0) return;

  const rollup: PurchaseProposalStatus = statuses.every(
    (s) => s === PurchaseProposalStatus.PURCHASED,
  )
    ? PurchaseProposalStatus.PURCHASED
    : // Mọi dòng đã ít nhất PURCHASING (không còn dòng nào NEW/QUOTING/SUBMITTED/REJECTED).
      statuses.every(
          (s) => s === PurchaseProposalStatus.PURCHASING || s === PurchaseProposalStatus.PURCHASED,
        )
      ? PurchaseProposalStatus.PURCHASING
      : // Có ít nhất 1 dòng bị từ chối - ưu tiên hiện REJECTED để cần chú ý xử lý (báo giá lại),
        // dù các dòng khác đã SUBMITTED/PURCHASING.
        statuses.some((s) => s === PurchaseProposalStatus.REJECTED)
        ? PurchaseProposalStatus.REJECTED
        : // Mọi dòng đã ít nhất SUBMITTED (không còn dòng nào NEW/QUOTING).
          statuses.every(
              (s) =>
                s === PurchaseProposalStatus.SUBMITTED ||
                s === PurchaseProposalStatus.PURCHASING ||
                s === PurchaseProposalStatus.PURCHASED,
            )
          ? PurchaseProposalStatus.SUBMITTED
          : // Có ít nhất 1 dòng đã rời NEW (đang báo giá/đã gửi/đã duyệt...) - hiện QUOTING để Mua
            // hàng biết đề xuất đang có người xử lý.
            statuses.some((s) => s !== PurchaseProposalStatus.NEW)
            ? PurchaseProposalStatus.QUOTING
            : PurchaseProposalStatus.NEW;

  await tx.purchaseProposal.update({ where: { id: proposalId }, data: { status: rollup } });
}
