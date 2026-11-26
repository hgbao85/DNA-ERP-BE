-- Chuyền kiểm + Đóng gói bằng quét QR (24/11/2026 - docs THIET-KE-CHUYEN-KIEM-DONG-GOI-QR-2026-11-24, chốt C1-C4, D1-D4).
-- Chỉ thêm (giá trị enum, cột cho phép rỗng, bảng mới) - không ghi lại dữ liệu cũ. Công tắc CK_DG_QR_ENABLED tắt thì không luồng nào
-- ghi vào các bảng / cột này. Ràng buộc CHECK so sánh enum qua ::text để không dùng giá trị enum mới trong cùng transaction với ADD VALUE.

-- CreateEnum
CREATE TYPE "TransferCheckBatchStatus" AS ENUM ('AWAITING_KCS', 'KCS_DONE');

-- AlterEnum
ALTER TYPE "MfgRole" ADD VALUE IF NOT EXISTS 'CHUYEN_KIEM';
ALTER TYPE "MfgRole" ADD VALUE IF NOT EXISTS 'DONG_GOI';
ALTER TYPE "MfgRole" ADD VALUE IF NOT EXISTS 'KCS_CHUYEN_KIEM';

-- AlterEnum
ALTER TYPE "MfgStage" ADD VALUE IF NOT EXISTS 'CHUYEN_KIEM';
ALTER TYPE "MfgStage" ADD VALUE IF NOT EXISTS 'DONG_GOI';

-- AlterEnum
ALTER TYPE "WorkstationKind" ADD VALUE IF NOT EXISTS 'TRANSFER_CHECK';
ALTER TYPE "WorkstationKind" ADD VALUE IF NOT EXISTS 'PACKING';

-- AlterTable
ALTER TABLE "workstations" ADD COLUMN     "warehouseId" BIGINT;

-- CreateTable
CREATE TABLE "transfer_check_batches" (
    "id" BIGSERIAL NOT NULL,
    "productionInvoiceItemId" BIGINT NOT NULL,
    "pieceId" BIGINT NOT NULL,
    "workstationId" BIGINT NOT NULL,
    "reportedById" TEXT NOT NULL,
    "passedQty" INTEGER NOT NULL,
    "defectQty" INTEGER NOT NULL,
    "defectReasonId" BIGINT,
    "photoUrls" TEXT[],
    "note" TEXT,
    "idempotencyKey" TEXT,
    "status" "TransferCheckBatchStatus" NOT NULL DEFAULT 'AWAITING_KCS',
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kcsPassedQty" INTEGER,
    "kcsReworkQty" INTEGER,
    "kcsScrapQty" INTEGER,
    "kcsDefectReasonId" BIGINT,
    "kcsPhotoUrl" TEXT,
    "kcsNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "transferCheckResultId" BIGINT,

    CONSTRAINT "transfer_check_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packing_reports" (
    "id" BIGSERIAL NOT NULL,
    "productionInvoiceItemId" BIGINT NOT NULL,
    "workstationId" BIGINT NOT NULL,
    "reportedById" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "note" TEXT,
    "idempotencyKey" TEXT,
    "packagingRecordId" BIGINT,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "packing_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transfer_check_batches_idempotencyKey_key" ON "transfer_check_batches"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_check_batches_transferCheckResultId_key" ON "transfer_check_batches"("transferCheckResultId");

-- CreateIndex
CREATE INDEX "transfer_check_batches_productionInvoiceItemId_pieceId_idx" ON "transfer_check_batches"("productionInvoiceItemId", "pieceId");

-- CreateIndex
CREATE INDEX "transfer_check_batches_status_reportedAt_idx" ON "transfer_check_batches"("status", "reportedAt");

-- CreateIndex
CREATE INDEX "transfer_check_batches_workstationId_idx" ON "transfer_check_batches"("workstationId");

-- CreateIndex
CREATE UNIQUE INDEX "packing_reports_idempotencyKey_key" ON "packing_reports"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "packing_reports_packagingRecordId_key" ON "packing_reports"("packagingRecordId");

-- CreateIndex
CREATE INDEX "packing_reports_productionInvoiceItemId_reportedAt_idx" ON "packing_reports"("productionInvoiceItemId", "reportedAt");

-- CreateIndex
CREATE INDEX "packing_reports_workstationId_idx" ON "packing_reports"("workstationId");

-- CreateIndex
CREATE INDEX "workstations_warehouseId_idx" ON "workstations"("warehouseId");

-- AddForeignKey
ALTER TABLE "transfer_check_batches" ADD CONSTRAINT "transfer_check_batches_productionInvoiceItemId_fkey" FOREIGN KEY ("productionInvoiceItemId") REFERENCES "production_invoice_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_check_batches" ADD CONSTRAINT "transfer_check_batches_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "piece"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_check_batches" ADD CONSTRAINT "transfer_check_batches_workstationId_fkey" FOREIGN KEY ("workstationId") REFERENCES "workstations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_check_batches" ADD CONSTRAINT "transfer_check_batches_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_check_batches" ADD CONSTRAINT "transfer_check_batches_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_check_batches" ADD CONSTRAINT "transfer_check_batches_defectReasonId_fkey" FOREIGN KEY ("defectReasonId") REFERENCES "defect_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_check_batches" ADD CONSTRAINT "transfer_check_batches_kcsDefectReasonId_fkey" FOREIGN KEY ("kcsDefectReasonId") REFERENCES "defect_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_check_batches" ADD CONSTRAINT "transfer_check_batches_transferCheckResultId_fkey" FOREIGN KEY ("transferCheckResultId") REFERENCES "transfer_check_results"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packing_reports" ADD CONSTRAINT "packing_reports_productionInvoiceItemId_fkey" FOREIGN KEY ("productionInvoiceItemId") REFERENCES "production_invoice_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packing_reports" ADD CONSTRAINT "packing_reports_workstationId_fkey" FOREIGN KEY ("workstationId") REFERENCES "workstations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packing_reports" ADD CONSTRAINT "packing_reports_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packing_reports" ADD CONSTRAINT "packing_reports_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packing_reports" ADD CONSTRAINT "packing_reports_packagingRecordId_fkey" FOREIGN KEY ("packagingRecordId") REFERENCES "packaging_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workstations" ADD CONSTRAINT "workstations_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Điểm chuyền kiểm / khu đóng gói: đúng tổ và bắt buộc kho Thành phẩm; loại khác không mang kho. Tổ CHUYEN_KIEM / DONG_GOI chỉ có 2 loại
-- điểm này (mở rộng workstations_stage_chk cũ: PIECE cho Phôi / Hàn / Sơn, CUT / STEP / STEEL_RECEIVE chỉ Phôi, không có tổ Đan).
ALTER TABLE "workstations" DROP CONSTRAINT IF EXISTS "workstations_stage_chk";
ALTER TABLE "workstations" ADD CONSTRAINT "workstations_stage_chk"
  CHECK (
    "stage"::text <> 'DAN' AND (
      ("kind"::text = 'PIECE' AND "stage"::text IN ('PHOI', 'HAN', 'SON'))
      OR ("kind"::text IN ('CUT', 'STEP', 'STEEL_RECEIVE') AND "stage"::text = 'PHOI')
      OR ("kind"::text = 'TRANSFER_CHECK' AND "stage"::text = 'CHUYEN_KIEM')
      OR ("kind"::text = 'PACKING' AND "stage"::text = 'DONG_GOI')
    )
  );
ALTER TABLE "workstations" ADD CONSTRAINT "workstations_fg_chk"
  CHECK (("kind"::text IN ('TRANSFER_CHECK', 'PACKING')) = ("warehouseId" IS NOT NULL));

-- Đợt chuyền kiểm: số không âm, có hàng; báo lỗi thì có nguyên nhân + ít nhất 1 ảnh; đã chấm thì đủ kết quả KCS, đạt KCS không quá
-- báo đạt, đạt + làm lại + bỏ = báo đạt + báo lỗi; chưa chấm thì chưa có kết quả.
ALTER TABLE "transfer_check_batches" ADD CONSTRAINT "transfer_check_batches_qty_chk"
  CHECK ("passedQty" >= 0 AND "defectQty" >= 0 AND "passedQty" + "defectQty" > 0);
ALTER TABLE "transfer_check_batches" ADD CONSTRAINT "transfer_check_batches_defect_chk"
  CHECK ("defectQty" = 0 OR ("defectReasonId" IS NOT NULL AND cardinality("photoUrls") >= 1));
ALTER TABLE "transfer_check_batches" ADD CONSTRAINT "transfer_check_batches_kcs_chk"
  CHECK (
    ("status" = 'AWAITING_KCS' AND "reviewedAt" IS NULL AND "kcsPassedQty" IS NULL AND "kcsReworkQty" IS NULL
      AND "kcsScrapQty" IS NULL AND "transferCheckResultId" IS NULL)
    OR ("status" = 'KCS_DONE' AND "reviewedAt" IS NOT NULL AND "reviewedById" IS NOT NULL
      AND "kcsPassedQty" >= 0 AND "kcsReworkQty" >= 0 AND "kcsScrapQty" >= 0
      AND "kcsPassedQty" <= "passedQty"
      AND "kcsPassedQty" + "kcsReworkQty" + "kcsScrapQty" = "passedQty" + "defectQty")
  );

-- Lần báo đóng gói: số dương; huỷ thì đủ người / giờ / lý do.
ALTER TABLE "packing_reports" ADD CONSTRAINT "packing_reports_qty_chk" CHECK ("qty" > 0);
ALTER TABLE "packing_reports" ADD CONSTRAINT "packing_reports_cancel_chk"
  CHECK (
    ("cancelledAt" IS NULL AND "cancelledById" IS NULL AND "cancelReason" IS NULL)
    OR ("cancelledAt" IS NOT NULL AND "cancelledById" IS NOT NULL AND length(trim("cancelReason")) > 0)
  );
