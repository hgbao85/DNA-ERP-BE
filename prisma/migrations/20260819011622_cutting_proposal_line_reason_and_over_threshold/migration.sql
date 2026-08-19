-- AlterTable
ALTER TABLE "cutting_proposal_lines" ADD COLUMN     "bestAchievable" JSONB,
ADD COLUMN     "maxWastePctThreshold" DECIMAL(6,3),
ADD COLUMN     "overThreshold" BOOLEAN,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "timedOut" BOOLEAN;

-- AlterTable
ALTER TABLE "cutting_proposals" ADD COLUMN     "hasInfeasibleLine" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hasOverThreshold" BOOLEAN NOT NULL DEFAULT false;
