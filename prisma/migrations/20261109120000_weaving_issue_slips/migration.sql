-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IssueSlipLineKind" ADD VALUE 'WEAVING_PIECE';
ALTER TYPE "IssueSlipLineKind" ADD VALUE 'WEAVING_MATERIAL';

-- AlterEnum
ALTER TYPE "StockLedgerRefType" ADD VALUE 'WEAVING_ISSUE';

-- DropForeignKey
ALTER TABLE "issue_slip_lines" DROP CONSTRAINT "issue_slip_lines_materialId_fkey";

-- DropForeignKey
ALTER TABLE "weaving_issue_materials" DROP CONSTRAINT "weaving_issue_materials_weavingIssueId_fkey";

-- AlterTable
ALTER TABLE "issue_slip_lines" ADD COLUMN     "pieceId" BIGINT,
ADD COLUMN     "weavingIssueId" BIGINT,
ADD COLUMN     "weavingIssueMaterialId" BIGINT,
ALTER COLUMN "materialId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "issue_slips" ADD COLUMN     "pairedSlipId" BIGINT,
ADD COLUMN     "weavingPointId" BIGINT;

-- AlterTable
ALTER TABLE "weaving_issue_materials" ADD COLUMN     "pieceId" BIGINT,
ADD COLUMN     "productionOrderId" BIGINT,
ADD COLUMN     "weavingPointId" BIGINT,
ALTER COLUMN "weavingIssueId" DROP NOT NULL;

-- Backfill: dòng cũ lấy lệnh / mảnh / điểm đan từ lần xuất mảnh đi cùng.
UPDATE "weaving_issue_materials" m
SET "productionOrderId" = w."productionOrderId", "pieceId" = w."pieceId", "weavingPointId" = w."weavingPointId"
FROM "weaving_issues" w
WHERE w."id" = m."weavingIssueId";

ALTER TABLE "weaving_issue_materials" ALTER COLUMN "pieceId" SET NOT NULL,
ALTER COLUMN "productionOrderId" SET NOT NULL,
ALTER COLUMN "weavingPointId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "issue_slip_lines_weavingIssueId_key" ON "issue_slip_lines"("weavingIssueId");

-- CreateIndex
CREATE UNIQUE INDEX "issue_slip_lines_weavingIssueMaterialId_key" ON "issue_slip_lines"("weavingIssueMaterialId");

-- CreateIndex
CREATE INDEX "weaving_issue_materials_productionOrderId_materialId_idx" ON "weaving_issue_materials"("productionOrderId", "materialId");

-- AddForeignKey
ALTER TABLE "weaving_issue_materials" ADD CONSTRAINT "weaving_issue_materials_weavingIssueId_fkey" FOREIGN KEY ("weavingIssueId") REFERENCES "weaving_issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weaving_issue_materials" ADD CONSTRAINT "weaving_issue_materials_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weaving_issue_materials" ADD CONSTRAINT "weaving_issue_materials_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "piece"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weaving_issue_materials" ADD CONSTRAINT "weaving_issue_materials_weavingPointId_fkey" FOREIGN KEY ("weavingPointId") REFERENCES "weaving_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_slips" ADD CONSTRAINT "issue_slips_weavingPointId_fkey" FOREIGN KEY ("weavingPointId") REFERENCES "weaving_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_slips" ADD CONSTRAINT "issue_slips_pairedSlipId_fkey" FOREIGN KEY ("pairedSlipId") REFERENCES "issue_slips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_slip_lines" ADD CONSTRAINT "issue_slip_lines_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_slip_lines" ADD CONSTRAINT "issue_slip_lines_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "piece"("id") ON DELETE SET NULL ON UPDATE CASCADE;

