-- AlterTable
ALTER TABLE "materials" ADD COLUMN     "purchaseUnit" TEXT;

-- AlterTable
ALTER TABLE "purchase_proposal_items" ADD COLUMN     "receivedQtyPurchaseUnit" DECIMAL(14,4);
