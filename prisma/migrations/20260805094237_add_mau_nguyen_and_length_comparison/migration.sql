-- AlterTable
ALTER TABLE "cutting_proposal_lines" ADD COLUMN     "lengthComparison" JSONB,
ADD COLUMN     "mauNguyenMm" INTEGER DEFAULT 0;

-- AlterTable
ALTER TABLE "cutting_proposal_patterns" ADD COLUMN     "mauNguyenMm" INTEGER DEFAULT 0;
