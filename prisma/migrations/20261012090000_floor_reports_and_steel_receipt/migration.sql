-- Phần nền trước QR (changelog-2026-10-08-ke-hoach-tem-qr-bo-sat-phoi.md mục 21): sổ ghi từng lần báo
-- sản lượng xưởng (append-only) + số cây/người/giờ Phôi thực nhận sắt. CHỈ THÊM cột nullable + bảng mới,
-- không backfill, không đổi dữ liệu cũ - an toàn với DB đã có dữ liệu thật (bài học mục 22 changelog 2026-09-06).

-- CreateEnum
CREATE TYPE "FloorReportKind" AS ENUM ('CUT', 'STEP', 'PIECE');

-- AlterTable
ALTER TABLE "steel_issues" ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "receivedBarCount" INTEGER,
ADD COLUMN     "receivedById" TEXT;

-- CreateTable
CREATE TABLE "floor_reports" (
    "id" BIGSERIAL NOT NULL,
    "kind" "FloorReportKind" NOT NULL,
    "reportedById" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "cutBundleId" BIGINT,
    "stepBatchId" BIGINT,
    "productionBatchId" BIGINT,
    "reversalOfId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "floor_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floor_report_lines" (
    "id" BIGSERIAL NOT NULL,
    "floorReportId" BIGINT NOT NULL,
    "segmentSpecId" BIGINT,
    "pieceId" BIGINT,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "floor_report_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "floor_reports_idempotencyKey_key" ON "floor_reports"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "floor_reports_reversalOfId_key" ON "floor_reports"("reversalOfId");

-- CreateIndex
CREATE INDEX "floor_reports_cutBundleId_idx" ON "floor_reports"("cutBundleId");

-- CreateIndex
CREATE INDEX "floor_reports_stepBatchId_idx" ON "floor_reports"("stepBatchId");

-- CreateIndex
CREATE INDEX "floor_reports_productionBatchId_idx" ON "floor_reports"("productionBatchId");

-- CreateIndex
CREATE INDEX "floor_reports_reportedById_createdAt_idx" ON "floor_reports"("reportedById", "createdAt");

-- CreateIndex
CREATE INDEX "floor_report_lines_floorReportId_idx" ON "floor_report_lines"("floorReportId");

-- AddForeignKey
ALTER TABLE "steel_issues" ADD CONSTRAINT "steel_issues_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_reports" ADD CONSTRAINT "floor_reports_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_reports" ADD CONSTRAINT "floor_reports_cutBundleId_fkey" FOREIGN KEY ("cutBundleId") REFERENCES "cut_bundles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_reports" ADD CONSTRAINT "floor_reports_stepBatchId_fkey" FOREIGN KEY ("stepBatchId") REFERENCES "step_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_reports" ADD CONSTRAINT "floor_reports_productionBatchId_fkey" FOREIGN KEY ("productionBatchId") REFERENCES "production_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_reports" ADD CONSTRAINT "floor_reports_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "floor_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_report_lines" ADD CONSTRAINT "floor_report_lines_floorReportId_fkey" FOREIGN KEY ("floorReportId") REFERENCES "floor_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_report_lines" ADD CONSTRAINT "floor_report_lines_segmentSpecId_fkey" FOREIGN KEY ("segmentSpecId") REFERENCES "segment_spec"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_report_lines" ADD CONSTRAINT "floor_report_lines_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "piece"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Mỗi dòng đúng 1 trong 2: cỡ đoạn (CUT/STEP) hoặc mảnh (PIECE) - cùng kiểu CHECK XOR viết tay như qc_reviews_goods_xor_chk.
ALTER TABLE "floor_report_lines" ADD CONSTRAINT "floor_report_lines_target_xor_chk" CHECK (("segmentSpecId" IS NULL) <> ("pieceId" IS NULL));
