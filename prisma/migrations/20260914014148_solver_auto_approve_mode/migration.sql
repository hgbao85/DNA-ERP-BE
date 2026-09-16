-- CreateEnum
CREATE TYPE "SolverAutoApproveMode" AS ENUM ('FIXED_ONLY', 'ALLOW_EXPAND', 'ALLOW_OVER_THRESHOLD');

-- AlterTable
ALTER TABLE "system_config" ADD COLUMN     "solverAutoApproveMode" "SolverAutoApproveMode" NOT NULL DEFAULT 'ALLOW_EXPAND';
