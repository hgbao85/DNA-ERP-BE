-- Chon may cat cho bo giai "De xuat thanh sat" (2026-10-23): MC Laser (mac dinh, cat tung cay) hay
-- MC Tu dong (cat theo bo). Mac dinh 'laser' o moi cho nen du lieu/hanh vi hien co KHONG doi.

-- CreateEnum
CREATE TYPE "SolverMachine" AS ENUM ('laser', 'tu_dong');

-- AlterTable
ALTER TABLE "system_config" ADD COLUMN     "solverBundleFactors" JSONB NOT NULL DEFAULT '[14,16,18,20]',
ADD COLUMN     "solverMachine" "SolverMachine" NOT NULL DEFAULT 'laser',
ADD COLUMN     "solverMaxManualCuts" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "solverMaxSizesPerPattern" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "solverMctdBladeWidthMm" DECIMAL(6,1) NOT NULL DEFAULT 2.5,
ADD COLUMN     "solverMctdTrimStartMm" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "production_invoices" ADD COLUMN     "solverMachine" "SolverMachine";

-- AlterTable
ALTER TABLE "cutting_proposal_lines" ADD COLUMN     "bundleSummary" JSONB,
ADD COLUMN     "machine" "SolverMachine";

-- AlterTable
ALTER TABLE "cutting_proposal_patterns" ADD COLUMN     "bundles" JSONB;
