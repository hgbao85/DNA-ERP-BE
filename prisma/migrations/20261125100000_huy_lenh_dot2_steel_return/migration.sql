-- Huỷ lệnh đợt 2 - Q3 (anh Nhân 24/11/2026): QLSX quyết sắt đã xuất chưa cắt của SKU đã huỷ - cho cắt tiếp hoặc ngưng + nhập trả
-- cây về kho Phôi. Chỉ thêm cột / bảng / giá trị enum, không đổi dữ liệu cũ.

-- AlterEnum
ALTER TYPE "StockLedgerRefType" ADD VALUE 'STEEL_RETURN';

-- CreateEnum
CREATE TYPE "ProductionOrderCutDecision" AS ENUM ('CONTINUE', 'STOP');

-- AlterTable
ALTER TABLE "production_order_cancel_requests" ADD COLUMN     "cutDecidedAt" TIMESTAMP(3),
ADD COLUMN     "cutDecidedById" TEXT,
ADD COLUMN     "cutDecision" "ProductionOrderCutDecision",
ADD COLUMN     "cutDecisionNote" TEXT;

-- CreateTable
CREATE TABLE "steel_returns" (
    "id" BIGSERIAL NOT NULL,
    "cancelRequestId" BIGINT NOT NULL,
    "productionInvoiceId" BIGINT NOT NULL,
    "materialId" BIGINT NOT NULL,
    "lengthMm" INTEGER NOT NULL,
    "bars" INTEGER NOT NULL,
    "warehouseId" BIGINT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "steel_returns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "steel_returns_productionInvoiceId_materialId_idx" ON "steel_returns"("productionInvoiceId", "materialId");

-- AddForeignKey
ALTER TABLE "steel_returns" ADD CONSTRAINT "steel_returns_cancelRequestId_fkey" FOREIGN KEY ("cancelRequestId") REFERENCES "production_order_cancel_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "steel_returns" ADD CONSTRAINT "steel_returns_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
