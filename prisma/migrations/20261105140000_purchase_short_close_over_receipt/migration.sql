-- Đợt 5e (2026-11-05): "Đóng phần thiếu" (bản v8 7.13) + nhận vượt bắt buộc lý do (4.12).
ALTER TABLE "purchase_proposal_items" ADD COLUMN     "reorderOfItemId" BIGINT,
ADD COLUMN     "shortCloseReason" TEXT,
ADD COLUMN     "shortClosedAt" TIMESTAMP(3),
ADD COLUMN     "shortClosedById" TEXT,
ADD COLUMN     "shortClosedQty" DECIMAL(14,4);

ALTER TABLE "purchase_receipts" ADD COLUMN     "overFileUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "overQty" DECIMAL(14,4) NOT NULL DEFAULT 0,
ADD COLUMN     "overReason" TEXT;
