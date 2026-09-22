-- AlterTable
ALTER TABLE "cutting_proposal_lines" ADD COLUMN     "solveSeconds" DECIMAL(8,2);

-- AlterTable
ALTER TABLE "cutting_proposals" ADD COLUMN     "totalSolveSeconds" DECIMAL(10,2);
