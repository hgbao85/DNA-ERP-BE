-- AlterTable
ALTER TABLE "purchase_proposal_items" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "purchasedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "status" "PurchaseProposalStatus" NOT NULL DEFAULT 'NEW',
ADD COLUMN     "submittedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "purchase_proposal_items_status_idx" ON "purchase_proposal_items"("status");

-- AddForeignKey
ALTER TABLE "purchase_proposal_items" ADD CONSTRAINT "purchase_proposal_items_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DataMigration: backfill item.status từ parent PurchaseProposal.status - 2 trục (xem plan
-- "Duyệt riêng từng người mua hàng" 2026-08-25):
--   1) buyQty=0 hoặc đã nhận đủ (receivedQty>=buyQty) -> PURCHASED, bất kể status cha (receiveItem()
--      đã cộng dồn receivedQty theo TỪNG item từ trước, cha có thể còn PURCHASING dù 1 item cụ thể
--      đã nhận xong).
--   2) còn lại, nếu cha đang PURCHASING/PURCHASED -> PURCHASING (cha PURCHASED nhưng vẫn còn item
--      chưa nhận đủ là dữ liệu hỏng lý thuyết, không xảy ra trong thực tế theo audit DB dev
--      25/08/2026 - vẫn xử lý an toàn theo nhánh 1) ở trên nếu có).
--   3) còn lại (NEW/QUOTING/SUBMITTED/REJECTED) -> copy y nguyên status cha - an toàn vì trước
--      migration này, 1 proposal chỉ nhận thêm item khi đang NEW (xem 3 service tạo/gộp đề xuất),
--      nên mọi item trong 1 proposal ở các trạng thái này luôn đồng bộ với nhau.
UPDATE "purchase_proposal_items" i
SET "status" = CASE
    WHEN i."buyQty" = 0 THEN 'PURCHASED'
    WHEN i."receivedQty" >= i."buyQty" AND i."buyQty" > 0 THEN 'PURCHASED'
    WHEN p."status" IN ('PURCHASING', 'PURCHASED') THEN 'PURCHASING'
    ELSE p."status"
  END::"PurchaseProposalStatus",
  "submittedAt" = p."submittedAt",
  "approvedAt" = p."approvedAt",
  "approvedById" = p."approvedById",
  "rejectedAt" = p."rejectedAt",
  "rejectionReason" = p."rejectionReason",
  "purchasedAt" = CASE
    WHEN i."buyQty" = 0 OR i."receivedQty" >= i."buyQty" THEN COALESCE(p."purchasedAt", now())
    ELSE NULL
  END
FROM "purchase_proposals" p
WHERE i."proposalId" = p.id;
