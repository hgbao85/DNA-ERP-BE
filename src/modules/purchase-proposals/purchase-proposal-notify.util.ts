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

/**
 * Câu 3 với người A (anh Nhân chốt 07/11, câu 2b): phần TÍNH LẠI đề xuất mua (người A) gọi hàm này khi nhu cầu 1 vật tư của lệnh
 * giảm XUỐNG DƯỚI số đã có phiếu Giám đốc ký (`gross < firmed` trong CuttingProposalsService.computeNetRequirementByMaterial và
 * các luồng tính lại vật tư khác). Không sửa gì - chỉ báo người mua phụ trách vật tư + Giám đốc. Gọi SAU khi transaction tính lại
 * đã commit (best-effort, lỗi chỉ ghi log). Cùng (lệnh, vật tư) gộp vào 1 thông báo (dedupe), cập nhật số mới mỗi lần tính lại.
 */
export async function notifyPurchaseDemandDropped(
  prisma: PrismaServiceType,
  notifications: NotificationsService,
  input: { productionInvoiceId: bigint; materialId: bigint; neededQty: number; signedQty: number },
  actorUserId?: string | null,
): Promise<void> {
  if (input.neededQty >= input.signedQty) return;
  try {
    const [pi, material] = await Promise.all([
      prisma.productionInvoice.findUnique({
        where: { id: input.productionInvoiceId },
        select: { code: true },
      }),
      prisma.material.findUnique({
        where: { id: input.materialId },
        select: { code: true, unit: true, buyerId: true },
      }),
    ]);
    if (!pi || !material) return;
    await notifications.emit('PURCHASE_DEMAND_DROPPED', {
      entityId: input.productionInvoiceId.toString(),
      actorId: actorUserId ?? undefined,
      dedupeKey: `PURCHASE_DEMAND_DROPPED:${input.productionInvoiceId}:${input.materialId}`,
      params: {
        piCode: pi.code,
        materialCode: material.code,
        unit: material.unit ?? undefined,
        neededQty: input.neededQty,
        signedQty: input.signedQty,
        buyerIds: material.buyerId ? [material.buyerId] : [],
      },
    });
  } catch (error) {
    logger.error(
      `Failed to notify demand drop (PI ${input.productionInvoiceId}, material ${input.materialId}): ${(error as Error).message}`,
    );
  }
}
