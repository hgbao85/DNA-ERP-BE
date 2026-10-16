-- AlterTable
ALTER TABLE "plan_forms"
  ADD COLUMN "manhDraft" JSONB,
  ADD COLUMN "manhDraftSavedAt" TIMESTAMP(3),
  ADD COLUMN "manhDraftSavedBy" TEXT,
  ADD COLUMN "detailDraft" JSONB,
  ADD COLUMN "detailDraftSavedAt" TIMESTAMP(3),
  ADD COLUMN "detailDraftSavedBy" TEXT;
