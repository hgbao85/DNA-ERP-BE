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
    const pendingItems = await prisma.purchaseProposalItem.findMany({
      where: { proposalId, status: { not: PurchaseProposalStatus.PURCHASED } },
      select: { material: { select: { buyerId: true } } },
    });
    const pendingCount = pendingItems.length;
    if (pendingCount === 0) return;
    // N-4 (báo cáo 07/10): chỉ báo NGƯỜI MUA được giao các vật tư còn chờ (Material.buyerId) - trước đây báo mọi
    // PURCHASER nên muatp nhận "4 vật tư cần mua" dù đề xuất không có vật tư kho nào của họ. Có vật tư chưa giao
    // người mua (buyerId null) thì ai cũng xử lý được -> giữ nhóm PURCHASER như cũ.
    const buyerIds = pendingItems.map((i) => i.material.buyerId);
    const targeted = buyerIds.length > 0 && buyerIds.every((id): id is string => !!id);

    await notifications.emit('PURCHASE_PROPOSAL_CREATED', {
      entityId: proposalId.toString(),
      actorId: actorUserId ?? undefined,
      dedupeKey: `PURCHASE_PROPOSAL_CREATED:${proposalId}`,
      params: {
        piCode: proposal.productionInvoice?.code ?? `#${proposalId}`,
        count: pendingCount,
        ...(targeted ? { buyerIds: [...new Set(buyerIds)] } : {}),
      },
    });
  } catch (error) {
    logger.error(
      `Failed to create purchase-proposal notification (proposal ${proposalId}): ${(error as Error).message}`,
    );
  }
}
