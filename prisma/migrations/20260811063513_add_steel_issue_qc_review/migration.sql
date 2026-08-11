-- CreateEnum
CREATE TYPE "SteelIssueStatus" AS ENUM ('ISSUED', 'RECEIVED', 'AWAITING_QC', 'QC_PASSED');

-- CreateEnum
CREATE TYPE "ReplenishRequestStatus" AS ENUM ('OPEN', 'FULFILLED', 'REJECTED');

-- CreateTable
CREATE TABLE "steel_issues" (
    "id" BIGSERIAL NOT NULL,
    "productionOrderId" BIGINT NOT NULL,
    "pieceId" BIGINT NOT NULL,
    "materialId" BIGINT NOT NULL,
    "barLengthMm" INTEGER NOT NULL,
    "status" "SteelIssueStatus" NOT NULL DEFAULT 'ISSUED',
    "actualBarCount" INTEGER,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "reworkOfId" BIGINT,

    CONSTRAINT "steel_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cut_bundles" (
    "id" BIGSERIAL NOT NULL,
    "steelIssueId" BIGINT NOT NULL,
    "proposalPatternId" BIGINT,
    "barCount" INTEGER NOT NULL,
    "wastePerBarMm" INTEGER,

    CONSTRAINT "cut_bundles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cut_pattern_segments" (
    "id" BIGSERIAL NOT NULL,
    "cutBundleId" BIGINT NOT NULL,
    "segmentSpecId" BIGINT NOT NULL,
    "countPerBar" INTEGER NOT NULL,

    CONSTRAINT "cut_pattern_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_reviews" (
    "id" BIGSERIAL NOT NULL,
    "steelIssueId" BIGINT,
    "productionBatchId" BIGINT,
    "failedQty" INTEGER NOT NULL,
    "scrapQty" INTEGER,
    "defectReasonId" BIGINT,
    "reason" TEXT,
    "photoUrl" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT NOT NULL,

    CONSTRAINT "qc_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replenish_requests" (
    "id" BIGSERIAL NOT NULL,
    "qcReviewId" BIGINT NOT NULL,
    "status" "ReplenishRequestStatus" NOT NULL DEFAULT 'OPEN',
    "qty" INTEGER NOT NULL,
    "fulfilledByIssueId" BIGINT,
    "fulfilledAt" TIMESTAMP(3),
    "fulfilledById" TEXT,
    "rejectionReason" TEXT,

    CONSTRAINT "replenish_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "steel_issues_productionOrderId_pieceId_idx" ON "steel_issues"("productionOrderId", "pieceId");

-- CreateIndex
CREATE INDEX "steel_issues_status_idx" ON "steel_issues"("status");

-- CreateIndex
CREATE INDEX "cut_bundles_steelIssueId_idx" ON "cut_bundles"("steelIssueId");

-- CreateIndex
CREATE UNIQUE INDEX "cut_pattern_segments_cutBundleId_segmentSpecId_key" ON "cut_pattern_segments"("cutBundleId", "segmentSpecId");

-- CreateIndex
CREATE INDEX "qc_reviews_steelIssueId_idx" ON "qc_reviews"("steelIssueId");

-- CreateIndex
CREATE INDEX "qc_reviews_productionBatchId_idx" ON "qc_reviews"("productionBatchId");

-- CreateIndex
CREATE INDEX "replenish_requests_status_idx" ON "replenish_requests"("status");

-- AddForeignKey
ALTER TABLE "steel_issues" ADD CONSTRAINT "steel_issues_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "steel_issues" ADD CONSTRAINT "steel_issues_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "piece"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "steel_issues" ADD CONSTRAINT "steel_issues_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "steel_issues" ADD CONSTRAINT "steel_issues_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "steel_issues" ADD CONSTRAINT "steel_issues_reworkOfId_fkey" FOREIGN KEY ("reworkOfId") REFERENCES "steel_issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cut_bundles" ADD CONSTRAINT "cut_bundles_steelIssueId_fkey" FOREIGN KEY ("steelIssueId") REFERENCES "steel_issues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cut_bundles" ADD CONSTRAINT "cut_bundles_proposalPatternId_fkey" FOREIGN KEY ("proposalPatternId") REFERENCES "cutting_proposal_patterns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cut_pattern_segments" ADD CONSTRAINT "cut_pattern_segments_cutBundleId_fkey" FOREIGN KEY ("cutBundleId") REFERENCES "cut_bundles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cut_pattern_segments" ADD CONSTRAINT "cut_pattern_segments_segmentSpecId_fkey" FOREIGN KEY ("segmentSpecId") REFERENCES "segment_spec"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_steelIssueId_fkey" FOREIGN KEY ("steelIssueId") REFERENCES "steel_issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_defectReasonId_fkey" FOREIGN KEY ("defectReasonId") REFERENCES "defect_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replenish_requests" ADD CONSTRAINT "replenish_requests_qcReviewId_fkey" FOREIGN KEY ("qcReviewId") REFERENCES "qc_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replenish_requests" ADD CONSTRAINT "replenish_requests_fulfilledByIssueId_fkey" FOREIGN KEY ("fulfilledByIssueId") REFERENCES "steel_issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replenish_requests" ADD CONSTRAINT "replenish_requests_fulfilledById_fkey" FOREIGN KEY ("fulfilledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Constraint không diễn tả được trong schema.prisma - cùng "Reference pattern for future ERP
-- modules" đã dùng cho stock_ledger_goods_xor_chk (migration 20260805120000_add_stock_ledger_core):
-- qc_reviews dùng chung Phôi/Hàn-Sơn qua FK XOR, đúng 1 trong 2 khác NULL.
ALTER TABLE "qc_reviews"
  ADD CONSTRAINT "qc_reviews_goods_xor_chk"
  CHECK (num_nonnulls("steelIssueId", "productionBatchId") = 1);

ALTER TABLE "qc_reviews"
  ADD CONSTRAINT "qc_reviews_scrap_le_failed_chk"
  CHECK ("scrapQty" IS NULL OR "scrapQty" <= "failedQty");

ALTER TABLE "qc_reviews"
  ADD CONSTRAINT "qc_reviews_failed_qty_nonnegative_chk"
  CHECK ("failedQty" >= 0);
