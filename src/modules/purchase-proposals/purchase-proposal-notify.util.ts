import { Logger } from '@nestjs/common';
import { PurchaseProposalStatus } from '../../generated/prisma/client';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const logger = new Logger('PurchaseProposalNotify');

/**
 * Best-effort NGOÀI transaction (cùng lý do đã ghi ở SkusService.notifySku()/
 * ProductionInvoicesService.notifyPi() - mục 14/15.2/16.2 changelog 2026-09-25/26: catch bên trong
 * 1 Prisma interactive transaction không cứu được transaction đó) - gọi SAU KHI 1 trong 3 nguồn
 * (CuttingProposalsService.approve(), ConsumableMaterialPurchaseService,
 * PieceMaterialYieldPurchaseService) đã commit xong việc tìm-hoặc-tạo `PurchaseProposal` CHUNG cho
 * 1 PI. Đứng ở đây (hàm thuần, không phải method riêng của từng service) vì 3 nguồn thuộc 3 class
 * khác nhau, không tiện inject chéo chỉ để gọi 1 hàm - cùng lý do `recomputeProposalStatus()` đứng
 * riêng `purchase-proposal-status.util.ts` thay vì là method của `PurchaseProposalsService`.
 *
 * Chỉ emit khi rollup CÒN vật tư cần Mua hàng xử lý (status khác PURCHASING/PURCHASED, xem
 * `recomputeProposalStatus`) - tính lại nhiều lần (mỗi SKU mới trong PI được Sếp duyệt, hoặc bấm
 * "Tính lại") không spam nhờ `dedupeKey` theo proposalId (xem `NotificationsService.emit()`), chỉ
 * cập nhật lại "n vật tư" trên cùng 1 dòng thông báo.
 */
export async function notifyPurchaseProposalCreated(
  prisma: PrismaServiceType,
  notifications: NotificationsService,
  proposalId: bigint,
  actorUserId?: string | null,
): Promise<void> {
  try {
    const proposal = await prisma.purchaseProposal.findUnique({
      where: { id: proposalId },
      include: { productionInvoice: { select: { code: true } } },
    });
    if (!proposal) return;
    if (
      proposal.status === PurchaseProposalStatus.PURCHASING ||
      proposal.status === PurchaseProposalStatus.PURCHASED
    ) {
      return;
    }
    const pendingCount = await prisma.purchaseProposalItem.count({
      where: { proposalId, status: { not: PurchaseProposalStatus.PURCHASED } },
    });
    if (pendingCount === 0) return;

    await notifications.emit('PURCHASE_PROPOSAL_CREATED', {
      entityId: proposalId.toString(),
      actorId: actorUserId ?? undefined,
      dedupeKey: `PURCHASE_PROPOSAL_CREATED:${proposalId}`,
      params: {
        piCode: proposal.productionInvoice?.code ?? `#${proposalId}`,
        count: pendingCount,
      },
    });
  } catch (error) {
    logger.error(
      `Failed to create purchase-proposal notification (proposal ${proposalId}): ${(error as Error).message}`,
    );
  }
}
