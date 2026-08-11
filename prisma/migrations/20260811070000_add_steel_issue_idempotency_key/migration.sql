-- AlterTable
ALTER TABLE "steel_issues" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "steel_issues_idempotencyKey_key" ON "steel_issues"("idempotencyKey");
