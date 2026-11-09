-- AlterTable
ALTER TABLE "warehouse_transfer_items" ADD COLUMN     "sentQty" DECIMAL(16,4);

-- AlterTable
ALTER TABLE "warehouse_transfer_piece_items" ADD COLUMN     "sentQty" INTEGER;

-- AlterTable
ALTER TABLE "warehouse_transfers" ADD COLUMN     "signedSlipUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];

