-- AlterEnum
ALTER TYPE "SteelIssueStatus" ADD VALUE 'IN_PROCESS';

-- AlterTable
ALTER TABLE "steel_issues" ADD COLUMN     "completedSteps" "ProcessStep"[] DEFAULT ARRAY[]::"ProcessStep"[];
