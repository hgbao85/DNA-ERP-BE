-- AlterEnum
ALTER TYPE "StockLedgerRefType" ADD VALUE 'PACKAGING_ISSUE';

-- CreateTable
CREATE TABLE "packaging_issues" (
    "id" BIGSERIAL NOT NULL,
    "productionOrderId" BIGINT NOT NULL,
    "materialId" BIGINT NOT NULL,
    "issuedQty" DECIMAL(14,4) NOT NULL,
    "idempotencyKey" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "packaging_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "packaging_issues_idempotencyKey_key" ON "packaging_issues"("idempotencyKey");

-- CreateIndex
CREATE INDEX "packaging_issues_productionOrderId_materialId_idx" ON "packaging_issues"("productionOrderId", "materialId");

-- AddForeignKey
ALTER TABLE "packaging_issues" ADD CONSTRAINT "packaging_issues_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packaging_issues" ADD CONSTRAINT "packaging_issues_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packaging_issues" ADD CONSTRAINT "packaging_issues_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
