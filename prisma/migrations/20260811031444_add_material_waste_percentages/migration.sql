-- AlterTable
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "maxCuttingWastePercentage" DECIMAL(6,3);
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "purchaseWastePercentage" DECIMAL(6,3);
