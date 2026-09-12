-- AlterEnum
ALTER TYPE "StockLedgerRefType" ADD VALUE 'WEAVING_ISSUE_MATERIAL';

-- CreateTable
CREATE TABLE "weaving_issue_materials" (
    "id" BIGSERIAL NOT NULL,
    "weavingIssueId" BIGINT NOT NULL,
    "materialId" BIGINT NOT NULL,
    "qty" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "weaving_issue_materials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "weaving_issue_materials_weavingIssueId_materialId_key" ON "weaving_issue_materials"("weavingIssueId", "materialId");

-- AddForeignKey
ALTER TABLE "weaving_issue_materials" ADD CONSTRAINT "weaving_issue_materials_weavingIssueId_fkey" FOREIGN KEY ("weavingIssueId") REFERENCES "weaving_issues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weaving_issue_materials" ADD CONSTRAINT "weaving_issue_materials_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
