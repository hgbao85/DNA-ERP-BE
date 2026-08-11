-- AlterTable
ALTER TABLE "plan_forms" ADD COLUMN     "bossApproveIdempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "plan_forms_bossApproveIdempotencyKey_key" ON "plan_forms"("bossApproveIdempotencyKey");
