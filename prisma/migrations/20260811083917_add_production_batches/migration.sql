-- CreateEnum
CREATE TYPE "ProductionBatchStatus" AS ENUM ('AWAITING_QC', 'QC_DONE');

-- CreateTable
CREATE TABLE "production_batches" (
    "id" BIGSERIAL NOT NULL,
    "stage" "MfgStage" NOT NULL,
    "productionOrderId" BIGINT NOT NULL,
    "partId" BIGINT NOT NULL,
    "reportedQty" INTEGER NOT NULL,
    "status" "ProductionBatchStatus" NOT NULL DEFAULT 'AWAITING_QC',
    "idempotencyKey" TEXT,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportedById" TEXT NOT NULL,
    "reworkOfId" BIGINT,

    CONSTRAINT "production_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_batches_idempotencyKey_key" ON "production_batches"("idempotencyKey");

-- CreateIndex
CREATE INDEX "production_batches_productionOrderId_partId_idx" ON "production_batches"("productionOrderId", "partId");

-- CreateIndex
CREATE INDEX "production_batches_stage_status_idx" ON "production_batches"("stage", "status");

-- AddForeignKey
ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_productionBatchId_fkey" FOREIGN KEY ("productionBatchId") REFERENCES "production_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_partId_fkey" FOREIGN KEY ("partId") REFERENCES "part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_reworkOfId_fkey" FOREIGN KEY ("reworkOfId") REFERENCES "production_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
