-- DropIndex
DROP INDEX "office_supplies_code_key";

-- AlterTable
ALTER TABLE "office_supplies" ADD COLUMN     "warehouseId" BIGINT NOT NULL;

-- CreateIndex
CREATE INDEX "office_supplies_warehouseId_idx" ON "office_supplies"("warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "office_supplies_warehouseId_code_key" ON "office_supplies"("warehouseId", "code");

-- AddForeignKey
ALTER TABLE "office_supplies" ADD CONSTRAINT "office_supplies_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

