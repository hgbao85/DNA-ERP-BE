import { Prisma, ProductionOrderStatus } from '../../generated/prisma/client';

/**
 * Huỷ lệnh theo SKU - đợt 1 (23/11/2026): lệnh SX bị Sếp duyệt huỷ có status CANCELLED (+ floorStage FINISHED). Mọi chỗ cộng
 * nhu cầu / tiến độ theo "mọi lệnh của PI" phải bỏ lệnh đã huỷ - chèn điều kiện này vào `where` của productionOrder. Cột status
 * NOT NULL (mặc định RELEASED) nên `not` không có bẫy NULL.
 */
export const NOT_CANCELLED_ORDER = {
  status: { not: ProductionOrderStatus.CANCELLED },
} satisfies Prisma.ProductionOrderWhereInput;

/** Cùng điều kiện, dùng ở query đi từ ProductionInvoiceItem (dòng SKU đã huỷ có cancelledAt). */
export const NOT_CANCELLED_ITEM = {
  cancelledAt: null,
} satisfies Prisma.ProductionInvoiceItemWhereInput;

export function isCancelledOrder(order: { status: ProductionOrderStatus }): boolean {
  return order.status === ProductionOrderStatus.CANCELLED;
}

/**
 * Điều kiện cho dòng xưởng GẮN lệnh SX (đợt cắt, lô mảnh, nhóm công đoạn...): bỏ dòng của lệnh đã huỷ. Bản `Nullable` cho cột
 * productionOrderId nullable (dòng cũ chưa gắn SKU vẫn giữ) - `productionOrder: { status: { not } }` một mình loại mất dòng NULL.
 * Dùng ở danh sách / số đếm KCS (huỷ lệnh theo SKU, 23/11/2026): đợt của SKU đã huỷ KCS không chấm được (409) nên không hiện.
 */
export function orderNotCancelled() {
  return { productionOrder: { status: { not: ProductionOrderStatus.CANCELLED } } };
}

export function orderNotCancelledNullable() {
  return {
    OR: [
      { productionOrderId: null },
      { productionOrder: { status: { not: ProductionOrderStatus.CANCELLED } } },
    ],
  };
}
