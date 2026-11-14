-- 13/11/2026: sổ báo vượt tồn đoạn (anh Nhân: Hàn / Sơn báo vượt không chặn, lưu lại để QLSX xử lý; lưu số lấy thêm khi làm lại).
-- 1 dòng = 1 đợt báo × 1 mã đoạn. Chỉ thêm bảng mới, không đổi dữ liệu cũ.
-- CreateEnum
CREATE TYPE "SegmentOverageKind" AS ENUM ('OVER_REPORT', 'REWORK');

-- CreateTable
CREATE TABLE "segment_overages" (
    "id" BIGSERIAL NOT NULL,
    "productionInvoiceId" BIGINT NOT NULL,
    "productionOrderId" BIGINT NOT NULL,
    "productionBatchId" BIGINT NOT NULL,
    "pieceId" BIGINT NOT NULL,
    "stage" "MfgStage" NOT NULL,
    "warehouseId" BIGINT NOT NULL,
    "segmentSpecId" BIGINT NOT NULL,
    "segmentSteps" TEXT NOT NULL DEFAULT '',
    "neededQty" DECIMAL(16,4) NOT NULL,
    "takenQty" DECIMAL(16,4) NOT NULL,
    "shortageQty" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "overPieces" INTEGER NOT NULL DEFAULT 0,
    "extraQty" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "extraKind" "SegmentOverageKind",
    "reportedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolveReason" TEXT,

    CONSTRAINT "segment_overages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "segment_overages_productionInvoiceId_idx" ON "segment_overages"("productionInvoiceId");

-- CreateIndex
CREATE INDEX "segment_overages_resolvedAt_idx" ON "segment_overages"("resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "segment_overages_productionBatchId_segmentSpecId_segmentSte_key" ON "segment_overages"("productionBatchId", "segmentSpecId", "segmentSteps");

-- AddForeignKey
ALTER TABLE "segment_overages" ADD CONSTRAINT "segment_overages_productionInvoiceId_fkey" FOREIGN KEY ("productionInvoiceId") REFERENCES "production_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_overages" ADD CONSTRAINT "segment_overages_productionBatchId_fkey" FOREIGN KEY ("productionBatchId") REFERENCES "production_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_overages" ADD CONSTRAINT "segment_overages_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_overages" ADD CONSTRAINT "segment_overages_segmentSpecId_fkey" FOREIGN KEY ("segmentSpecId") REFERENCES "segment_spec"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

