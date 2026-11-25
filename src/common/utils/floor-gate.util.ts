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
    select: { productionInvoiceId: true, cancelledAt: true },
  });
  throwIfCancelled(item.cancelledAt, actionLabel);
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
  // Đọc lại SAU khi đã khoá dòng lệnh: lượt duyệt huỷ khoá cùng dòng (FOR UPDATE) nên tới đây đã thấy kết quả huỷ nếu có.
  await assertItemNotCancelled(tx, productionInvoiceItemId, actionLabel);
}

// ─── Huỷ lệnh theo SKU - đợt 1 (23/11/2026) ─────────────────────────────────────────────────────────────────────────────
// Cổng trên là theo PI (chỉ cần 1 SKU ACTIVE) nên KHÔNG chặn được ghi vào CHÍNH SKU đã huỷ khi SKU khác của lệnh còn chạy. Các bản
// đi từ dòng SKU / lệnh SX ở trên đã tự kiểm; nơi gọi bản theo PI mà vẫn ghi cho 1 SKU cụ thể (báo cắt, KCS, chuyền kiểm, đóng gói)
// gọi thêm 2 hàm dưới.

function throwIfCancelled(cancelledAt: Date | null, actionLabel: string): void {
  if (cancelledAt != null) {
    throw new ConflictException(
      `SKU này đã bị huỷ (Sếp duyệt huỷ lệnh) - không ${actionLabel} được nữa`,
    );
  }
}

export async function assertItemNotCancelled(
  prisma: PrismaTx,
  productionInvoiceItemId: bigint,
  actionLabel: string,
): Promise<void> {
  const item = await prisma.productionInvoiceItem.findUniqueOrThrow({
    where: { id: productionInvoiceItemId },
    select: { cancelledAt: true },
  });
  throwIfCancelled(item.cancelledAt, actionLabel);
}

export async function assertOrderNotCancelled(
  prisma: PrismaTx,
  productionOrderId: bigint,
  actionLabel: string,
): Promise<void> {
  const order = await prisma.productionOrder.findUniqueOrThrow({
    where: { id: productionOrderId },
    select: { status: true },
  });
  if (order.status === 'CANCELLED') throwIfCancelled(new Date(0), actionLabel);
}

/**
 * Câu 4 (anh Nhân 24/11/2026): KCS chấm nốt (và chốt để chấm) đợt của SKU đã huỷ - hàng đạt vào kho công đoạn như thường. Lệnh
 * đã huỷ luôn ở FINISHED (lệnh 1 SKU thì PI không còn SKU nào ACTIVE) nên cổng xưởng chặn mất - nơi gọi của KCS bỏ qua cổng khi
 * hàm này trả true. Huỷ không đảo lại được nên kiểm ngoài transaction là đủ. Công nhân vẫn không báo thêm được (cổng cũ).
 */
export async function isOrderCancelledById(
  prisma: PrismaTx,
  productionOrderId: bigint | null | undefined,
): Promise<boolean> {
  if (productionOrderId == null) return false;
  const order = await prisma.productionOrder.findUnique({
    where: { id: productionOrderId },
    select: { status: true },
  });
  return order?.status === 'CANCELLED';
}

/**
 * Huỷ lệnh đợt 2 - Q3 (anh Nhân 24/11/2026): QLSX cho tổ cắt "cắt tiếp" sắt đã xuất của SKU đã huỷ - đề nghị huỷ đã duyệt mang
 * cutDecision = CONTINUE. Khi đó báo cắt / báo cắt xong / xác nhận nhận sắt của SKU này được qua cổng xưởng; đoạn ra vào dư kho Phôi.
 */
export async function isCutContinuedForOrder(
  prisma: PrismaTx,
  productionOrderId: bigint,
): Promise<boolean> {
  const row = await prisma.productionOrderCancelRequest.findFirst({
    where: { productionOrderId, status: 'APPROVED', cutDecision: 'CONTINUE' },
    select: { id: true },
  });
  return row != null;
}

/**
 * Q3 theo PI: PI có SKU đã huỷ. Tổ cắt vẫn xác nhận nhận sắt đã xuất được (cắt tiếp hay nhập trả đều cần sắt đã về tổ) - trước đây
 * lệnh huỷ hết thì phiếu xuất chưa nhận kẹt mãi (cổng xưởng chặn).
 */
export async function piHasCancelledSku(
  prisma: PrismaTx,
  productionInvoiceId: bigint,
): Promise<boolean> {
  const row = await prisma.productionOrder.findFirst({
    where: { status: 'CANCELLED', productionInvoiceItem: { productionInvoiceId } },
    select: { id: true },
  });
  return row != null;
}

/** Cùng assertOrderNotCancelled nhưng trên lệnh nơi gọi đã đọc sẵn (khỏi 1 truy vấn). Thiếu status (dữ liệu cũ) = chưa huỷ. */
export function assertLoadedOrderNotCancelled(
  order: { status?: string | null },
  actionLabel: string,
): void {
  if (order.status === 'CANCELLED') throwIfCancelled(new Date(0), actionLabel);
}
