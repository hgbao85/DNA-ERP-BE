-- Huỷ lệnh theo SKU - đợt 1 (23/11/2026, anh Nhân trả lời 7 câu): bảng đề nghị huỷ (KHSX đề nghị, Sếp duyệt) + cột cancelledAt
-- trên dòng SKU đã huỷ. Không đổi dữ liệu cũ.


-- CreateEnum
CREATE TYPE "ProductionOrderCancelStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "production_invoice_items" ADD COLUMN     "cancelledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "production_order_cancel_requests" (
    "id" BIGSERIAL NOT NULL,
    "productionOrderId" BIGINT NOT NULL,
    "status" "ProductionOrderCancelStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "wipSnapshot" JSONB,
    "replacementItemId" BIGINT,

    CONSTRAINT "production_order_cancel_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "production_order_cancel_requests_productionOrderId_status_idx" ON "production_order_cancel_requests"("productionOrderId", "status");

-- CreateIndex
CREATE INDEX "production_order_cancel_requests_status_idx" ON "production_order_cancel_requests"("status");

-- AddForeignKey
ALTER TABLE "production_order_cancel_requests" ADD CONSTRAINT "production_order_cancel_requests_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_cancel_requests" ADD CONSTRAINT "production_order_cancel_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_cancel_requests" ADD CONSTRAINT "production_order_cancel_requests_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_cancel_requests" ADD CONSTRAINT "production_order_cancel_requests_replacementItemId_fkey" FOREIGN KEY ("replacementItemId") REFERENCES "production_invoice_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Mỗi lệnh SX chỉ có tối đa 1 đề nghị huỷ đang chờ (viết tay: Prisma không khai được unique index có WHERE).
CREATE UNIQUE INDEX "production_order_cancel_requests_one_pending_per_order" ON "production_order_cancel_requests"("productionOrderId") WHERE "status" = 'PENDING';
