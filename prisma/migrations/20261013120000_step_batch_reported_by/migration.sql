-- Công đoạn phụ tách đợt theo công nhân (2026-10-13, mục 26). Thêm cột nullable + backfill StepBatch.reportedById từ sổ floor_reports.
-- AlterTable
ALTER TABLE "step_batches" ADD COLUMN     "reportedById" TEXT;

-- AlterTable
ALTER TABLE "step_bundles" ADD COLUMN     "reportedById" TEXT;

-- AddForeignKey
ALTER TABLE "step_batches" ADD CONSTRAINT "step_batches_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_bundles" ADD CONSTRAINT "step_bundles_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: người báo = người của lần báo STEP gốc (không phải dòng đảo) đầu tiên của đợt.
UPDATE "step_batches" sb SET "reportedById" = fr."reportedById"
  FROM (
    SELECT DISTINCT ON ("stepBatchId") "stepBatchId", "reportedById"
    FROM "floor_reports"
    WHERE "kind" = 'STEP' AND "reversalOfId" IS NULL AND "stepBatchId" IS NOT NULL
    ORDER BY "stepBatchId", "createdAt" ASC
  ) fr
  WHERE fr."stepBatchId" = sb."id" AND sb."reportedById" IS NULL;
