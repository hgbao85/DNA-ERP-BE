-- CreateEnum
CREATE TYPE "ProductionOrderFloorStage" AS ENUM ('PENDING', 'ACTIVE', 'FINISHED');

-- AlterTable
ALTER TABLE "production_orders" ADD COLUMN     "floorFinishedAt" TIMESTAMP(3),
ADD COLUMN     "floorStage" "ProductionOrderFloorStage" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "floorStartedAt" TIMESTAMP(3);
