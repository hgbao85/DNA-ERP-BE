-- AlterTable
ALTER TABLE "materials" ADD COLUMN     "warehouseId" BIGINT;

-- CreateIndex
CREATE INDEX "materials_warehouseId_idx" ON "materials"("warehouseId");

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
