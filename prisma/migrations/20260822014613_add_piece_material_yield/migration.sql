/*
  Warnings:

  - You are about to alter the column `solverBladeWidthMm` on the `system_config` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(6,1)`.
  - You are about to alter the column `solverMaxWastePercentage` on the `system_config` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(6,3)`.
  - You are about to alter the column `purchaseOverReceiptTolerancePercent` on the `system_config` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(6,3)`.

*/
-- AlterEnum
ALTER TYPE "PurchaseProposalSource" ADD VALUE 'PIECE_MATERIAL_YIELD';

-- AlterEnum
ALTER TYPE "StockLedgerRefType" ADD VALUE 'MATERIAL_YIELD_CONSUME';

-- DropForeignKey
ALTER TABLE "production_invoice_items" DROP CONSTRAINT "production_invoice_items_productionInvoiceId_fkey";

-- AlterTable
ALTER TABLE "purchase_proposals" ADD COLUMN     "productionInvoiceId" BIGINT;

-- AlterTable
ALTER TABLE "system_config" ALTER COLUMN "solverBladeWidthMm" SET DATA TYPE DECIMAL(6,1),
ALTER COLUMN "solverMaxWastePercentage" SET DATA TYPE DECIMAL(6,3),
ALTER COLUMN "purchaseOverReceiptTolerancePercent" SET DATA TYPE DECIMAL(6,3);

-- CreateTable
CREATE TABLE "piece_material_yield" (
    "id" BIGSERIAL NOT NULL,
    "bomRevisionId" BIGINT NOT NULL,
    "mfgProductId" BIGINT NOT NULL,
    "pieceId" BIGINT NOT NULL,
    "materialId" BIGINT NOT NULL,
    "piecesPerBar" INTEGER NOT NULL,

    CONSTRAINT "piece_material_yield_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "piece_material_yield_bomRevisionId_pieceId_key" ON "piece_material_yield"("bomRevisionId", "pieceId");

-- AddForeignKey
ALTER TABLE "piece_material_yield" ADD CONSTRAINT "piece_material_yield_bomRevisionId_mfgProductId_fkey" FOREIGN KEY ("bomRevisionId", "mfgProductId") REFERENCES "bom_revision"("id", "mfgProductId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_material_yield" ADD CONSTRAINT "piece_material_yield_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "piece"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_material_yield" ADD CONSTRAINT "piece_material_yield_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_invoice_items" ADD CONSTRAINT "production_invoice_items_productionInvoiceId_fkey" FOREIGN KEY ("productionInvoiceId") REFERENCES "production_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_proposals" ADD CONSTRAINT "purchase_proposals_productionInvoiceId_fkey" FOREIGN KEY ("productionInvoiceId") REFERENCES "production_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
