-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IssueSlipLineKind" ADD VALUE 'PACKAGING';
ALTER TYPE "IssueSlipLineKind" ADD VALUE 'MATERIAL_YIELD';
ALTER TYPE "IssueSlipLineKind" ADD VALUE 'MATERIAL_YIELD_RECIPE';

-- AlterTable
ALTER TABLE "issue_slip_lines" ADD COLUMN     "materialYieldIssueId" BIGINT,
ADD COLUMN     "materialYieldRecipeIssueId" BIGINT,
ADD COLUMN     "packagingIssueId" BIGINT,
ADD COLUMN     "recipeId" BIGINT;

-- CreateIndex
CREATE UNIQUE INDEX "issue_slip_lines_packagingIssueId_key" ON "issue_slip_lines"("packagingIssueId");

-- CreateIndex
CREATE UNIQUE INDEX "issue_slip_lines_materialYieldIssueId_key" ON "issue_slip_lines"("materialYieldIssueId");

-- CreateIndex
CREATE UNIQUE INDEX "issue_slip_lines_materialYieldRecipeIssueId_key" ON "issue_slip_lines"("materialYieldRecipeIssueId");

