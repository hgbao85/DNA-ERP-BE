-- CreateEnum
CREATE TYPE "ProductionOrderStatus" AS ENUM ('DRAFT', 'RELEASED', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CuttingProposalStatus" AS ENUM ('CALCULATING', 'DRAFT', 'APPROVED', 'SUPERSEDED', 'FAILED');

-- AlterTable
ALTER TABLE "system_config" ADD COLUMN     "solverBladeWidthMm" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
ADD COLUMN     "solverLengthStepMm" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "solverMaxLengthMm" INTEGER NOT NULL DEFAULT 12000,
ADD COLUMN     "solverMaxSurplus" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "solverMaxWastePercentage" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
ADD COLUMN     "solverMinLengthMm" INTEGER NOT NULL DEFAULT 4000,
ADD COLUMN     "solverStockLengths" JSONB NOT NULL DEFAULT '[5850, 6000, 7000]',
ADD COLUMN     "solverTimeLimitSeconds" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "solverTrimStartMm" INTEGER NOT NULL DEFAULT 10;

-- CreateTable
CREATE TABLE "production_orders" (
    "id" BIGSERIAL NOT NULL,
    "poNumber" TEXT NOT NULL,
    "productionInvoiceItemId" BIGINT NOT NULL,
    "mfgProductId" BIGINT NOT NULL,
    "bomRevisionId" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "ProductionOrderStatus" NOT NULL DEFAULT 'RELEASED',
    "releasedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cutting_proposals" (
    "id" BIGSERIAL NOT NULL,
    "productionOrderId" BIGINT NOT NULL,
    "status" "CuttingProposalStatus" NOT NULL DEFAULT 'CALCULATING',
    "idempotencyKey" TEXT,
    "requestParams" JSONB,
    "rawResponse" JSONB,
    "totalBarsAll" INTEGER,
    "totalWasteMm" INTEGER,
    "wastePercentage" DECIMAL(6,3),
    "errorMessage" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,

    CONSTRAINT "cutting_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cutting_proposal_lines" (
    "id" BIGSERIAL NOT NULL,
    "cuttingProposalId" BIGINT NOT NULL,
    "materialId" BIGINT NOT NULL,
    "feasible" BOOLEAN NOT NULL DEFAULT true,
    "bestStockLengthMm" INTEGER,
    "totalBars" INTEGER,
    "totalWasteMm" INTEGER,
    "wastePercentage" DECIMAL(6,3),

    CONSTRAINT "cutting_proposal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cutting_proposal_patterns" (
    "id" BIGSERIAL NOT NULL,
    "lineId" BIGINT NOT NULL,
    "patternIndex" INTEGER NOT NULL,
    "barCount" INTEGER NOT NULL,
    "wastePerBarMm" INTEGER,

    CONSTRAINT "cutting_proposal_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cutting_proposal_pattern_segments" (
    "id" BIGSERIAL NOT NULL,
    "patternId" BIGINT NOT NULL,
    "segmentSpecId" BIGINT NOT NULL,
    "countPerBar" INTEGER NOT NULL,

    CONSTRAINT "cutting_proposal_pattern_segments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_orders_poNumber_key" ON "production_orders"("poNumber");

-- CreateIndex
CREATE UNIQUE INDEX "production_orders_productionInvoiceItemId_key" ON "production_orders"("productionInvoiceItemId");

-- CreateIndex
CREATE INDEX "production_orders_mfgProductId_idx" ON "production_orders"("mfgProductId");

-- CreateIndex
CREATE UNIQUE INDEX "cutting_proposals_idempotencyKey_key" ON "cutting_proposals"("idempotencyKey");

-- CreateIndex
CREATE INDEX "cutting_proposals_productionOrderId_status_idx" ON "cutting_proposals"("productionOrderId", "status");

-- CreateIndex
CREATE INDEX "cutting_proposal_lines_cuttingProposalId_idx" ON "cutting_proposal_lines"("cuttingProposalId");

-- CreateIndex
CREATE INDEX "cutting_proposal_lines_materialId_idx" ON "cutting_proposal_lines"("materialId");

-- CreateIndex
CREATE INDEX "cutting_proposal_patterns_lineId_idx" ON "cutting_proposal_patterns"("lineId");

-- CreateIndex
CREATE INDEX "cutting_proposal_pattern_segments_patternId_idx" ON "cutting_proposal_pattern_segments"("patternId");

-- CreateIndex
CREATE INDEX "cutting_proposal_pattern_segments_segmentSpecId_idx" ON "cutting_proposal_pattern_segments"("segmentSpecId");

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_productionInvoiceItemId_fkey" FOREIGN KEY ("productionInvoiceItemId") REFERENCES "production_invoice_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_mfgProductId_fkey" FOREIGN KEY ("mfgProductId") REFERENCES "mfg_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_bomRevisionId_mfgProductId_fkey" FOREIGN KEY ("bomRevisionId", "mfgProductId") REFERENCES "bom_revision"("id", "mfgProductId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_proposals" ADD CONSTRAINT "cutting_proposals_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_proposals" ADD CONSTRAINT "cutting_proposals_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_proposals" ADD CONSTRAINT "cutting_proposals_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_proposal_lines" ADD CONSTRAINT "cutting_proposal_lines_cuttingProposalId_fkey" FOREIGN KEY ("cuttingProposalId") REFERENCES "cutting_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_proposal_lines" ADD CONSTRAINT "cutting_proposal_lines_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_proposal_patterns" ADD CONSTRAINT "cutting_proposal_patterns_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "cutting_proposal_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_proposal_pattern_segments" ADD CONSTRAINT "cutting_proposal_pattern_segments_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "cutting_proposal_patterns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_proposal_pattern_segments" ADD CONSTRAINT "cutting_proposal_pattern_segments_segmentSpecId_fkey" FOREIGN KEY ("segmentSpecId") REFERENCES "segment_spec"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
