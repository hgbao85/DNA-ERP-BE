-- Đơn đặt hàng NCC + số đơn theo NCC/năm (bản v8 mục 4.10, 4.13) - 2026-11-04. Chỉ THÊM bảng/cột mới.

-- CreateEnum
CREATE TYPE "SupplierOrderStatus" AS ENUM ('DRAFT', 'APPROVED', 'CANCELLED');

-- AlterTable
ALTER TABLE "purchase_proposal_items" ADD COLUMN     "supplierOrderId" BIGINT;

-- CreateTable
CREATE TABLE "supplier_orders" (
    "id" BIGSERIAL NOT NULL,
    "supplierId" BIGINT NOT NULL,
    "year" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "status" "SupplierOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "approvalFileUrl" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_order_counters" (
    "supplierId" BIGINT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_order_counters_pkey" PRIMARY KEY ("supplierId","year")
);

-- CreateIndex
CREATE INDEX "supplier_orders_status_idx" ON "supplier_orders"("status");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_orders_supplierId_year_seq_key" ON "supplier_orders"("supplierId", "year", "seq");

-- CreateIndex
CREATE INDEX "purchase_proposal_items_supplierOrderId_idx" ON "purchase_proposal_items"("supplierOrderId");

-- AddForeignKey
ALTER TABLE "purchase_proposal_items" ADD CONSTRAINT "purchase_proposal_items_supplierOrderId_fkey" FOREIGN KEY ("supplierOrderId") REFERENCES "supplier_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_order_counters" ADD CONSTRAINT "supplier_order_counters_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

