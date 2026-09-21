-- AlterTable
ALTER TABLE "cut_bundles" ADD COLUMN     "productionOrderId" BIGINT;

-- CreateIndex
CREATE INDEX "cut_bundles_productionOrderId_idx" ON "cut_bundles"("productionOrderId");

-- AddForeignKey
ALTER TABLE "cut_bundles" ADD CONSTRAINT "cut_bundles_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
