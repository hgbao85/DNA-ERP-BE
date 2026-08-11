-- AlterEnum
ALTER TYPE "ProdItemStageType" ADD VALUE 'TRANSFER_CHECK';

-- CreateTable
CREATE TABLE "transfer_check_results" (
    "id" BIGSERIAL NOT NULL,
    "productionInvoiceItemId" BIGINT NOT NULL,
    "pieceId" BIGINT NOT NULL,
    "checkedQty" INTEGER NOT NULL,
    "note" TEXT,
    "checkedById" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_check_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_check_defects" (
    "id" BIGSERIAL NOT NULL,
    "transferCheckResultId" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "imageUrl" TEXT,

    CONSTRAINT "transfer_check_defects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transfer_check_results_productionInvoiceItemId_pieceId_idx" ON "transfer_check_results"("productionInvoiceItemId", "pieceId");

-- CreateIndex
CREATE INDEX "transfer_check_defects_transferCheckResultId_idx" ON "transfer_check_defects"("transferCheckResultId");

-- AddForeignKey
ALTER TABLE "transfer_check_results" ADD CONSTRAINT "transfer_check_results_productionInvoiceItemId_fkey" FOREIGN KEY ("productionInvoiceItemId") REFERENCES "production_invoice_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_check_results" ADD CONSTRAINT "transfer_check_results_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "piece"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_check_results" ADD CONSTRAINT "transfer_check_results_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_check_defects" ADD CONSTRAINT "transfer_check_defects_transferCheckResultId_fkey" FOREIGN KEY ("transferCheckResultId") REFERENCES "transfer_check_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
