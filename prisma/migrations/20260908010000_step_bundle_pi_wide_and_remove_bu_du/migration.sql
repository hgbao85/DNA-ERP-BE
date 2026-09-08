-- Sếp Trương Văn Nhân (2026-09-07, sau khi xem UI thật): công đoạn phụ (Uốn/Dập/Đục lỗ/Tán/Tóp
-- đầu/Xẻ) phải làm được SONG SONG, không tuần tự, số liệu tính sẵn theo định mức - StepBundle
-- KHÔNG còn gắn với 1 CutBundle cụ thể, đổi sang scope PI + loại sắt (mirror PieceStepBundle).
-- Dev DB hiện KHÔNG có dữ liệu thật ở các bảng này (đã dọn sạch dòng test) - ALTER thẳng, không
-- backfill.

-- step_bundles: cutBundleId -> productionInvoiceId + materialId
ALTER TABLE "step_bundles" DROP CONSTRAINT "step_bundles_cutBundleId_fkey";
DROP INDEX "step_bundles_cutBundleId_step_idx";
ALTER TABLE "step_bundles" DROP COLUMN "cutBundleId";
ALTER TABLE "step_bundles" ADD COLUMN "productionInvoiceId" BIGINT NOT NULL;
ALTER TABLE "step_bundles" ADD COLUMN "materialId" BIGINT NOT NULL;
ALTER TABLE "step_bundles" ADD CONSTRAINT "step_bundles_productionInvoiceId_fkey"
  FOREIGN KEY ("productionInvoiceId") REFERENCES "production_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "step_bundles" ADD CONSTRAINT "step_bundles_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "step_bundles_productionInvoiceId_materialId_step_idx"
  ON "step_bundles" ("productionInvoiceId", "materialId", "step");

-- step_batches: steelIssueId/cutBundleId -> productionInvoiceId + materialId
ALTER TABLE "step_batches" DROP CONSTRAINT "step_batches_steelIssueId_fkey";
ALTER TABLE "step_batches" DROP CONSTRAINT "step_batches_cutBundleId_fkey";
DROP INDEX "step_batches_steelIssueId_step_idx";
DROP INDEX "step_batches_cutBundleId_step_idx";
ALTER TABLE "step_batches" DROP COLUMN "steelIssueId";
ALTER TABLE "step_batches" DROP COLUMN "cutBundleId";
ALTER TABLE "step_batches" ADD COLUMN "productionInvoiceId" BIGINT NOT NULL;
ALTER TABLE "step_batches" ADD COLUMN "materialId" BIGINT NOT NULL;
ALTER TABLE "step_batches" ADD CONSTRAINT "step_batches_productionInvoiceId_fkey"
  FOREIGN KEY ("productionInvoiceId") REFERENCES "production_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "step_batches" ADD CONSTRAINT "step_batches_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "step_batches_productionInvoiceId_materialId_step_idx"
  ON "step_batches" ("productionInvoiceId", "materialId", "step");

-- qc_review_segments: bỏ hẳn cơ chế report-done/recheck theo dòng cũ (Bù đủ giờ = đợt mới hoàn
-- toàn, xem changelog "Bù đủ dồn về bảng tổng") - failedQty là số lịch sử duy nhất còn lại.
ALTER TABLE "qc_review_segments" DROP COLUMN "resolvedQty";
ALTER TABLE "qc_review_segments" DROP COLUMN "phoiReportedAt";
ALTER TABLE "qc_review_segments" DROP COLUMN "phoiReportedQty";

-- qc_reviews: stepBundleId trở thành 1 leg THẬT trong XOR (mirror pieceStepBundleId) - review
-- StepBundle không còn kèm steelIssueId nữa vì StepBundle không thuộc đúng 1 SteelIssue nào.
ALTER TABLE "qc_reviews" DROP CONSTRAINT "qc_reviews_goods_xor_chk";
ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_goods_xor_chk"
  CHECK (num_nonnulls("steelIssueId", "productionBatchId", "pieceStepBundleId", "stepBundleId") = 1);
