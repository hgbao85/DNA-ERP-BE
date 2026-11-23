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
export const NOT_CANCELLED_ITEM = { cancelledAt: null } satisfies Prisma.ProductionInvoiceItemWhereInput;

export function isCancelledOrder(order: { status: ProductionOrderStatus }): boolean {
  return order.status === ProductionOrderStatus.CANCELLED;
}
