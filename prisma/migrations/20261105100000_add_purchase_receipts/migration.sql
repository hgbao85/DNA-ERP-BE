-- CreateEnum
CREATE TYPE "PurchaseReceiptStatus" AS ENUM ('RECEIVED', 'REJECTED');

-- AlterTable
ALTER TABLE "purchase_receipt_logs" ADD COLUMN     "receiptId" BIGINT;

-- CreateTable
CREATE TABLE "purchase_receipts" (
    "id" BIGSERIAL NOT NULL,
    "supplierOrderId" BIGINT,
    "materialId" BIGINT NOT NULL,
    "warehouseCode" TEXT NOT NULL,
    "spec" TEXT NOT NULL DEFAULT '',
    "stockLengthMm" INTEGER,
    "status" "PurchaseReceiptStatus" NOT NULL,
    "unitRateQty" DECIMAL(14,4) NOT NULL,
    "supplierUnitQty" DECIMAL(14,4) NOT NULL DEFAULT 1,
    "deliveredQty" DECIMAL(14,4) NOT NULL,
    "receivedQty" DECIMAL(14,4) NOT NULL,
    "supplierSlipUrls" TEXT[],
    "approvalFileUrls" TEXT[],
    "receiptSlipUrls" TEXT[],
    "weighSlipUrls" TEXT[],
    "rejectReason" TEXT,
    "rejectFileUrls" TEXT[],
    "autoAllocation" JSONB NOT NULL,
    "allocation" JSONB NOT NULL,
    "allocationAdjusted" BOOLEAN NOT NULL DEFAULT false,
    "idempotencyKey" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_receipts_idempotencyKey_key" ON "purchase_receipts"("idempotencyKey");

-- CreateIndex
CREATE INDEX "purchase_receipts_supplierOrderId_idx" ON "purchase_receipts"("supplierOrderId");

-- CreateIndex
CREATE INDEX "purchase_receipts_materialId_idx" ON "purchase_receipts"("materialId");

-- CreateIndex
CREATE INDEX "purchase_receipts_createdAt_idx" ON "purchase_receipts"("createdAt");

-- CreateIndex
CREATE INDEX "purchase_receipt_logs_receiptId_idx" ON "purchase_receipt_logs"("receiptId");

-- AddForeignKey
ALTER TABLE "purchase_receipt_logs" ADD CONSTRAINT "purchase_receipt_logs_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "purchase_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_supplierOrderId_fkey" FOREIGN KEY ("supplierOrderId") REFERENCES "supplier_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

