import { SupplierOrderStatus } from '../../generated/prisma/client';
import { PrismaTx } from '../../prisma/prisma.service';

/**
 * MUA5 19/11 (mục cũ MH6 sót): tính lại nhu cầu mà dòng "đủ tồn" -> PURCHASED + rời đơn đặt hàng nháp; dòng cuối rời đi thì đơn nháp
 * rỗng nằm lại mãi (người mua không in / duyệt được, không ai huỷ). Gọi SAU khi đã gỡ dòng, trong cùng transaction: khoá từng đơn
 * (theo id, FOR UPDATE như lockDraft của SupplierOrdersService), đơn vẫn DRAFT mà không còn dòng nào thì huỷ - giống "gỡ hết dòng
 * khỏi đơn" (removeItem).
 */
export async function cancelEmptiedDraftOrders(
  tx: PrismaTx,
  orderIds: readonly (bigint | null | undefined)[],
  cancelReason = 'Tính lại nhu cầu: mọi dòng đã đủ tồn',
): Promise<bigint[]> {
  const ids = [...new Set(orderIds.filter((id): id is bigint => id != null))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const cancelled: bigint[] = [];
  for (const id of ids) {
    const rows = await tx.$queryRaw<{ status: string }[]>`
      SELECT "status" FROM "supplier_orders" WHERE "id" = ${id} FOR UPDATE`;
    if (rows[0]?.status !== SupplierOrderStatus.DRAFT) continue;
    const left = await tx.purchaseProposalItem.count({ where: { supplierOrderId: id } });
    if (left > 0) continue;
    await tx.supplierOrder.update({
      where: { id },
      data: { status: SupplierOrderStatus.CANCELLED, cancelledAt: new Date(), cancelReason },
    });
    cancelled.push(id);
  }
  return cancelled;
}
