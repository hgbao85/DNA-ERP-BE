import { ConflictException } from '@nestjs/common';
import { ProductionOrderFloorStage } from '../../generated/prisma/client';
import type { PrismaTx } from '../../prisma/prisma.service';

/**
 * QLSX kiểm soát toàn chuỗi thực thi sản xuất qua nút "Bắt đầu"/"Kết thúc" ở Bảng thống kê
 * (2026-08-31) - MỌI hành động ghi trên xưởng (xuất sắt/vật tư, báo sản lượng, KCS duyệt, và các
 * công đoạn sau này như Đan/Chuyền kiểm/Đóng gói) đều phải qua gate này trước khi ghi bất cứ gì.
 *
 * Quy tắc PI-level xuyên suốt: chỉ cần ÍT NHẤT 1 SKU bất kỳ trong PI đang
 * ProductionOrder.floorStage=ACTIVE là đủ - KHÔNG bắt buộc CHÍNH SKU/order đang thao tác phải
 * ACTIVE (Phôi cắt sắt/gộp PI chung cho mọi SKU trong đó, không tách được theo từng SKU - cùng lý
 * do PiListBoard bên FE gộp theo PI, xem components/sanxuat/core.tsx).
 *
 * ĐỘC LẬP với ProductionOrder.status (vẫn RELEASED ngay khi Sếp duyệt như cũ, mua vật tư/xuất sắt
 * kích hoạt tự động không chờ QLSX) - xem enum ProductionOrderFloorStage (schema.prisma) tại sao 2
 * field này KHÔNG gộp làm 1.
 *
 * Được tách ra dùng chung (trước đó nhân bản y hệt ở SteelIssuesService/MaterialIssuesService/
 * ProductionBatchesService/QcReviewsService×2) vì đã lặp tới 5 lần và còn tiếp tục thêm (Đan/
 * Chuyền kiểm/Đóng gói) - qua ngưỡng "quy tắc đủ nhỏ để nhân bản rẻ hơn coupling" mà codebase này
 * thường áp dụng cho rule cục bộ 1 module. Cùng idiom hàm thuần nhận `prisma`/`tx` làm tham số đầu
 * như lockBusinessKey() (advisory-lock.util.ts) - không cần inject thêm service nào.
 */
export async function assertPiHasActiveFloor(
  prisma: PrismaTx,
  productionInvoiceId: bigint,
  actionLabel: string,
): Promise<void> {
  const activeOrder = await prisma.productionOrder.findFirst({
    where: {
      productionInvoiceItem: { productionInvoiceId },
      floorStage: ProductionOrderFloorStage.ACTIVE,
    },
    select: { id: true },
  });
  if (!activeOrder) {
    throw new ConflictException(
      `PI ${productionInvoiceId} chưa có SKU nào được QLSX bấm "Bắt đầu" (hoặc đã "Kết thúc") - chưa/không thể ${actionLabel}`,
    );
  }
}

/**
 * Cùng assertPiHasActiveFloor() nhưng đi từ productionInvoiceItemId (nơi gọi đã có sẵn
 * ProductionOrder trong tay - vd MaterialIssuesService/ProductionBatchesService.create() vừa
 * findOrderOrThrow() xong - dùng thẳng order.productionInvoiceItemId, KHÔNG fetch lại order) - tự
 * tra tiếp productionInvoiceItem -> PI rồi gọi hàm lõi ở trên.
 */
export async function assertItemPiHasActiveFloor(
  prisma: PrismaTx,
  productionInvoiceItemId: bigint,
  actionLabel: string,
): Promise<void> {
  const item = await prisma.productionInvoiceItem.findUniqueOrThrow({
    where: { id: productionInvoiceItemId },
    select: { productionInvoiceId: true },
  });
  await assertPiHasActiveFloor(prisma, item.productionInvoiceId!, actionLabel);
}

/**
 * Cùng assertItemPiHasActiveFloor() nhưng đi từ productionOrderId (nơi gọi CHỈ biết order id, chưa
 * có sẵn order trong tay - vd QcReviewsService.reviewProductionBatch() chỉ có batch.productionOrderId)
 * - tự tra ngược order -> productionInvoiceItem -> PI. Nếu nơi gọi đã có sẵn order object rồi thì
 * dùng assertItemPiHasActiveFloor(order.productionInvoiceItemId) thẳng, tránh 1 query thừa.
 */
export async function assertOrderPiHasActiveFloor(
  prisma: PrismaTx,
  productionOrderId: bigint,
  actionLabel: string,
): Promise<void> {
  const order = await prisma.productionOrder.findUniqueOrThrow({
    where: { id: productionOrderId },
    select: { productionInvoiceItemId: true },
  });
  await assertItemPiHasActiveFloor(prisma, order.productionInvoiceItemId, actionLabel);
}

/**
 * Cùng assertPiHasActiveFloor() nhưng CHỐT được race hẹp giữa lúc đọc floorStage và lúc ghi thật
 * (TOCTOU) mà bản trên bỏ ngỏ - review 2026-09-03: QLSX bấm "Tạm dừng"/"Kết thúc" (production-
 * orders.service.ts pauseFloor/finishFloor/startFloor, mỗi hàm chỉ 1 UPDATE đơn) đúng lúc giữa 2
 * bước đọc-rồi-ghi của create() vẫn lọt được 1 lần ghi, dù gate "thấy" đúng ACTIVE lúc đọc.
 *
 * `SELECT ... FOR UPDATE` khoá đúng các dòng ProductionOrder của PI này NGAY TRONG transaction ghi
 * - 1 UPDATE đơn của pauseFloor/finishFloor/startFloor nhắm vào 1 trong các dòng đó sẽ tự BỊ CHẶN
 * (Postgres row lock) cho tới khi transaction này commit/rollback, thay vì chạy xen kẽ vô hại như
 * hiện nay. Ngược lại nếu UPDATE đó đã commit trước, câu SELECT FOR UPDATE này thấy đúng giá trị
 * mới nên vẫn ném lỗi bình thường - không có khe hở nào giữa 2 chiều.
 *
 * CHỈ dùng được trong `$transaction` (nhận `tx`, không phải `prisma` top-level) - gọi làm dòng ĐẦU
 * TIÊN trong callback, TRƯỚC bất kỳ ghi nào. Không thay thế assertPiHasActiveFloor()/
 * assertItemPiHasActiveFloor() ở trên - giữ nguyên bản không khoá đó làm fast-path early-exit
 * TRƯỚC khi mở transaction (khỏi tốn advisory lock/transaction cho ca đã biết chắc bị chặn), bản
 * có khoá này bổ sung làm nguồn đúng cuối cùng ngay trước khi ghi.
 */
export async function assertPiHasActiveFloorLocked(
  tx: PrismaTx,
  productionInvoiceId: bigint,
  actionLabel: string,
): Promise<void> {
  const rows = await tx.$queryRaw<{ floorStage: ProductionOrderFloorStage }[]>`
    SELECT po."floorStage"
    FROM "production_orders" po
    JOIN "production_invoice_items" pii ON po."productionInvoiceItemId" = pii."id"
    WHERE pii."productionInvoiceId" = ${productionInvoiceId}
    FOR UPDATE OF po
  `;
  if (!rows.some((r) => r.floorStage === ProductionOrderFloorStage.ACTIVE)) {
    throw new ConflictException(
      `PI ${productionInvoiceId} chưa có SKU nào được QLSX bấm "Bắt đầu" (hoặc đã "Kết thúc") - chưa/không thể ${actionLabel}`,
    );
  }
}

/** Cùng assertItemPiHasActiveFloorLocked() nhưng đi từ productionInvoiceItemId - xem
 *  assertItemPiHasActiveFloor() (bản không khoá) để biết khi nào dùng dạng nào. */
export async function assertItemPiHasActiveFloorLocked(
  tx: PrismaTx,
  productionInvoiceItemId: bigint,
  actionLabel: string,
): Promise<void> {
  const item = await tx.productionInvoiceItem.findUniqueOrThrow({
    where: { id: productionInvoiceItemId },
    select: { productionInvoiceId: true },
  });
  await assertPiHasActiveFloorLocked(tx, item.productionInvoiceId!, actionLabel);
}
