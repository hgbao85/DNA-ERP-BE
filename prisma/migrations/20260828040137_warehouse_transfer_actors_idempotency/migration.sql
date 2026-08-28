-- Vấn đề #7 audit 26/08/2026 - WarehouseTransfer trước đây không tự lưu ai tạo/xác nhận/từ chối,
-- chỉ tra được qua AuditLog riêng. Nullable, KHÔNG backfill: phiếu cũ (trước migration này) để
-- NULL là đúng - chưa từng ghi actor, không có gì để gán vào (cùng idiom
-- PurchaseProposalItem.approvalFileUrl, migration 20260827040000).
--
-- Vấn đề #11 audit 26/08/2026 (phần còn thiếu) - create()/createPieceTransfer() trước đây không
-- có cột nào để dedupe theo Idempotency-Key, khác material_issues/packaging_issues/steel_issues đã
-- có. Nullable + unique, cùng idiom MaterialIssue.idempotencyKey - nhiều dòng NULL không vi phạm
-- unique constraint.

-- AlterTable
ALTER TABLE "warehouse_transfers" ADD COLUMN "createdById" TEXT;
ALTER TABLE "warehouse_transfers" ADD COLUMN "confirmedById" TEXT;
ALTER TABLE "warehouse_transfers" ADD COLUMN "rejectedById" TEXT;
ALTER TABLE "warehouse_transfers" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_transfers_idempotencyKey_key" ON "warehouse_transfers"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "warehouse_transfers" ADD CONSTRAINT "warehouse_transfers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transfers" ADD CONSTRAINT "warehouse_transfers_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transfers" ADD CONSTRAINT "warehouse_transfers_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
