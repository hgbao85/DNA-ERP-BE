-- CreateEnum
CREATE TYPE "ProcessStep" AS ENUM ('CAT', 'UON', 'DAP', 'DUC_LO', 'TAN');

-- AlterTable
ALTER TABLE "piece_bom" ADD COLUMN     "processSteps" "ProcessStep"[] DEFAULT ARRAY[]::"ProcessStep"[];
