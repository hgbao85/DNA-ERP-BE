-- AlterTable
ALTER TABLE "step_batches" ADD COLUMN     "productionOrderId" BIGINT;

-- AlterTable
ALTER TABLE "step_bundles" ADD COLUMN     "productionOrderId" BIGINT;

-- CreateIndex
CREATE INDEX "step_batches_productionOrderId_idx" ON "step_batches"("productionOrderId");

-- CreateIndex
CREATE INDEX "step_bundles_productionOrderId_idx" ON "step_bundles"("productionOrderId");

-- AddForeignKey
ALTER TABLE "step_batches" ADD CONSTRAINT "step_batches_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_bundles" ADD CONSTRAINT "step_bundles_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

