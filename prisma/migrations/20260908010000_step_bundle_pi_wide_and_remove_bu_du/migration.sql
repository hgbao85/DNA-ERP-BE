-- Sếp Trương Văn Nhân (2026-09-07, sau khi xem UI thật): công đoạn phụ (Uốn/Dập/Đục lỗ/Tán/Tóp
-- đầu/Xẻ) phải làm được SONG SONG, không tuần tự, số liệu tính sẵn theo định mức - StepBundle
-- KHÔNG còn gắn với 1 CutBundle cụ thể, đổi sang scope PI + loại sắt (mirror PieceStepBundle).
--
-- SỬA LẠI 2026-09-08 (production trên Render deploy FAIL - P3018 "column productionInvoiceId of
-- relation step_batches contains null values"): bản đầu giả định "không có dữ liệu thật" nhưng chỉ
-- xác nhận trên DB dev local, KHÔNG xác nhận trên DB production (đã có dữ liệu thật từ trước khi
-- StepBundle/StepBatch lên production) - ADD COLUMN ... NOT NULL thẳng nên fail giữa chừng. Viết
-- lại AN TOÀN: ADD COLUMN nullable trước, BACKFILL từ cột cũ (steelIssueId/cutBundleId - cả 2 đều
-- NOT NULL/FK-constrained tại nguồn nên backfill phủ được 100% dòng, xem SteelIssue/CutBundle
-- schema), rồi mới SET NOT NULL - không mất dòng nào, không cần xoá dữ liệu.

-- step_bundles: cutBundleId -> productionInvoiceId + materialId. cutBundleId NOT NULL + FK tới
-- cut_bundles(id) từ lúc tạo bảng (20260907080000) nên JOIN dưới đây khớp được MỌI dòng.
ALTER TABLE "step_bundles" DROP CONSTRAINT "step_bundles_cutBundleId_fkey";
DROP INDEX "step_bundles_cutBundleId_step_idx";
ALTER TABLE "step_bundles" ADD COLUMN "productionInvoiceId" BIGINT;
ALTER TABLE "step_bundles" ADD COLUMN "materialId" BIGINT;
UPDATE "step_bundles" sb
  SET "productionInvoiceId" = si."productionInvoiceId",
      "materialId" = si."materialId"
  FROM "cut_bundles" cb
  JOIN "steel_issues" si ON cb."steelIssueId" = si."id"
  WHERE sb."cutBundleId" = cb."id";
ALTER TABLE "step_bundles" ALTER COLUMN "productionInvoiceId" SET NOT NULL;
ALTER TABLE "step_bundles" ALTER COLUMN "materialId" SET NOT NULL;
ALTER TABLE "step_bundles" DROP COLUMN "cutBundleId";
ALTER TABLE "step_bundles" ADD CONSTRAINT "step_bundles_productionInvoiceId_fkey"
  FOREIGN KEY ("productionInvoiceId") REFERENCES "production_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "step_bundles" ADD CONSTRAINT "step_bundles_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "step_bundles_productionInvoiceId_materialId_step_idx"
  ON "step_bundles" ("productionInvoiceId", "materialId", "step");

-- step_batches: steelIssueId/cutBundleId -> productionInvoiceId + materialId. steelIssueId NOT
-- NULL + FK tới steel_issues(id) từ lúc tạo bảng (20260827020117) - dùng làm nguồn backfill CHÍNH
-- (đủ cho MỌI dòng), không cần qua cutBundleId (nullable, chỉ có ở dữ liệu từ 2026-09-05 trở đi).
ALTER TABLE "step_batches" DROP CONSTRAINT "step_batches_steelIssueId_fkey";
ALTER TABLE "step_batches" DROP CONSTRAINT "step_batches_cutBundleId_fkey";
DROP INDEX "step_batches_steelIssueId_step_idx";
DROP INDEX "step_batches_cutBundleId_step_idx";
ALTER TABLE "step_batches" ADD COLUMN "productionInvoiceId" BIGINT;
ALTER TABLE "step_batches" ADD COLUMN "materialId" BIGINT;
UPDATE "step_batches" sbt
  SET "productionInvoiceId" = si."productionInvoiceId",
      "materialId" = si."materialId"
  FROM "steel_issues" si
  WHERE sbt."steelIssueId" = si."id";
ALTER TABLE "step_batches" ALTER COLUMN "productionInvoiceId" SET NOT NULL;
ALTER TABLE "step_batches" ALTER COLUMN "materialId" SET NOT NULL;
ALTER TABLE "step_batches" DROP COLUMN "steelIssueId";
ALTER TABLE "step_batches" DROP COLUMN "cutBundleId";
ALTER TABLE "step_batches" ADD CONSTRAINT "step_batches_productionInvoiceId_fkey"
  FOREIGN KEY ("productionInvoiceId") REFERENCES "production_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "step_batches" ADD CONSTRAINT "step_batches_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "step_batches_productionInvoiceId_materialId_step_idx"
  ON "step_batches" ("productionInvoiceId", "materialId", "step");

-- qc_review_segments: bỏ hẳn cơ chế report-done/recheck theo dòng cũ (Bù đủ giờ = đợt mới hoàn
-- toàn, xem changelog "Bù đủ dồn về bảng tổng") - failedQty là số lịch sử duy nhất còn lại. KHÔNG
-- cần backfill gì (chỉ mất 3 cột phụ, không có ràng buộc NOT NULL/CHECK nào phụ thuộc).
ALTER TABLE "qc_review_segments" DROP COLUMN "resolvedQty";
ALTER TABLE "qc_review_segments" DROP COLUMN "phoiReportedAt";
ALTER TABLE "qc_review_segments" DROP COLUMN "phoiReportedQty";

-- qc_reviews: stepBundleId trở thành 1 leg THẬT trong XOR (mirror pieceStepBundleId) - review
-- StepBundle không còn kèm steelIssueId nữa vì StepBundle không thuộc đúng 1 SteelIssue nào.
--
-- Dữ liệu CŨ (trước 2026-09-08, khi stepBundleId còn là "cột lọc PHỤ" như cutBundleId - xem
-- migration 20260907080000) có thể có dòng vừa ghi steelIssueId (leg XOR CHÍNH lúc đó) VỪA ghi
-- stepBundleId - nếu giữ nguyên, CHECK 4-cột dưới đây sẽ fail (num_nonnulls = 2) giống hệt lỗi
-- P3018 ở step_batches trên. Dọn TRƯỚC khi đổi CHECK: dòng nào đã có stepBundleId thì đó mới là
-- nguồn thật (StepBundle tự mang đủ productionInvoiceId/materialId rồi, không cần steelIssueId phụ
-- trợ nữa) - null hoá steelIssueId đi, không mất thông tin gì (suy ngược được qua stepBundleId).
UPDATE "qc_reviews" SET "steelIssueId" = NULL WHERE "stepBundleId" IS NOT NULL;
ALTER TABLE "qc_reviews" DROP CONSTRAINT "qc_reviews_goods_xor_chk";
ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_goods_xor_chk"
  CHECK (num_nonnulls("steelIssueId", "productionBatchId", "pieceStepBundleId", "stepBundleId") = 1);
