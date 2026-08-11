-- AlterTable
ALTER TABLE "system_config" ALTER COLUMN "solverStockLengths" SET DEFAULT '[5850, 6000]';

-- CreateTable
CREATE TABLE "weaving_issues" (
    "id" BIGSERIAL NOT NULL,
    "productionOrderId" BIGINT NOT NULL,
    "pieceId" BIGINT NOT NULL,
    "weavingPointId" BIGINT NOT NULL,
    "qty" INTEGER NOT NULL,
    "idempotencyKey" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT NOT NULL,

    CONSTRAINT "weaving_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weaving_receipts" (
    "id" BIGSERIAL NOT NULL,
    "productionOrderId" BIGINT NOT NULL,
    "pieceId" BIGINT NOT NULL,
    "weavingPointId" BIGINT NOT NULL,
    "qty" INTEGER NOT NULL,
    "idempotencyKey" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedById" TEXT NOT NULL,

    CONSTRAINT "weaving_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "weaving_issues_idempotencyKey_key" ON "weaving_issues"("idempotencyKey");

-- CreateIndex
CREATE INDEX "weaving_issues_productionOrderId_pieceId_weavingPointId_idx" ON "weaving_issues"("productionOrderId", "pieceId", "weavingPointId");

-- CreateIndex
CREATE UNIQUE INDEX "weaving_receipts_idempotencyKey_key" ON "weaving_receipts"("idempotencyKey");

-- CreateIndex
CREATE INDEX "weaving_receipts_productionOrderId_pieceId_weavingPointId_idx" ON "weaving_receipts"("productionOrderId", "pieceId", "weavingPointId");

-- AddForeignKey
ALTER TABLE "weaving_issues" ADD CONSTRAINT "weaving_issues_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weaving_issues" ADD CONSTRAINT "weaving_issues_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "piece"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weaving_issues" ADD CONSTRAINT "weaving_issues_weavingPointId_fkey" FOREIGN KEY ("weavingPointId") REFERENCES "weaving_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weaving_issues" ADD CONSTRAINT "weaving_issues_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weaving_receipts" ADD CONSTRAINT "weaving_receipts_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weaving_receipts" ADD CONSTRAINT "weaving_receipts_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "piece"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weaving_receipts" ADD CONSTRAINT "weaving_receipts_weavingPointId_fkey" FOREIGN KEY ("weavingPointId") REFERENCES "weaving_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weaving_receipts" ADD CONSTRAINT "weaving_receipts_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
