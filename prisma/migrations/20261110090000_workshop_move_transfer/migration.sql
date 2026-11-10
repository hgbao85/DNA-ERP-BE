-- AlterTable
ALTER TABLE "warehouse_transfer_items" ADD COLUMN     "stockLengthMm" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "warehouse_transfers" ADD COLUMN     "productionInvoiceId" BIGINT;

-- AddForeignKey
ALTER TABLE "warehouse_transfers" ADD CONSTRAINT "warehouse_transfers_productionInvoiceId_fkey" FOREIGN KEY ("productionInvoiceId") REFERENCES "production_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

