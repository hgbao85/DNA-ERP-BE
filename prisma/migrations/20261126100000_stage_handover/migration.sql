-- Giao nhận giữa tổ (24/11/2026 - docs THIET-KE-GIAO-NHAN-GIUA-TO-2026-11-24): phiếu XK giao đoạn Phôi -> Hàn / Sơn và mảnh
-- Hàn -> Sơn, QLSX mở chặn có lý do. Chỉ thêm (enum, cột cho phép rỗng / có mặc định, bảng
-- mới) - không ghi lại dữ liệu cũ. Công tắc STAGE_HANDOVER_ENABLED tắt thì không luồng nào ghi vào các bảng / giá trị này.

-- AlterEnum (IF NOT EXISTS: chạy lại được trên DB dev / test đã từng áp bản nháp của migration này)
ALTER TYPE "IssueSlipLineKind" ADD VALUE IF NOT EXISTS 'SEGMENT_HANDOVER';
ALTER TYPE "IssueSlipLineKind" ADD VALUE IF NOT EXISTS 'FRAME_HANDOVER';

-- AlterEnum
ALTER TYPE "SegmentReservationLogKind" ADD VALUE IF NOT EXISTS 'HANDOVER';

-- AlterEnum
ALTER TYPE "StockLedgerRefType" ADD VALUE IF NOT EXISTS 'SEGMENT_HANDOVER';
ALTER TYPE "StockLedgerRefType" ADD VALUE IF NOT EXISTS 'FRAME_HANDOVER';

-- AlterTable
ALTER TABLE "issue_slip_lines" ADD COLUMN     "segmentSpecId" BIGINT,
ADD COLUMN     "segmentSteps" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "stage_handover_overrides" (
    "id" BIGSERIAL NOT NULL,
    "productionInvoiceId" BIGINT NOT NULL,
    "productionOrderId" BIGINT,
    "stage" "MfgStage" NOT NULL,
    "pieceId" BIGINT,
    "materialId" BIGINT,
    "qty" DECIMAL(14,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stage_handover_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stage_handover_overrides_productionInvoiceId_stage_idx" ON "stage_handover_overrides"("productionInvoiceId", "stage");

-- CreateIndex
CREATE INDEX "issue_slip_lines_kind_productionInvoiceId_idx" ON "issue_slip_lines"("kind", "productionInvoiceId");

-- CreateIndex
CREATE INDEX "issue_slip_lines_kind_productionOrderId_pieceId_idx" ON "issue_slip_lines"("kind", "productionOrderId", "pieceId");

-- AddForeignKey
ALTER TABLE "issue_slip_lines" ADD CONSTRAINT "issue_slip_lines_segmentSpecId_fkey" FOREIGN KEY ("segmentSpecId") REFERENCES "segment_spec"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_handover_overrides" ADD CONSTRAINT "stage_handover_overrides_productionInvoiceId_fkey" FOREIGN KEY ("productionInvoiceId") REFERENCES "production_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ràng buộc (kiểm lại ở service để trả 400 rõ ràng). So kind::text - giá trị enum vừa thêm chưa dùng được trong cùng transaction.
ALTER TABLE "issue_slip_lines" ADD CONSTRAINT "issue_slip_lines_segment_steps_chk"
  CHECK ("segmentSteps" = '' OR "segmentSpecId" IS NOT NULL);
ALTER TABLE "issue_slip_lines" ADD CONSTRAINT "issue_slip_lines_segment_handover_chk"
  CHECK ("kind"::text <> 'SEGMENT_HANDOVER' OR (
    "productionInvoiceId" IS NOT NULL AND "segmentSpecId" IS NOT NULL AND "stage" IS NOT NULL AND "materialId" IS NULL
  ));
ALTER TABLE "issue_slip_lines" ADD CONSTRAINT "issue_slip_lines_frame_handover_chk"
  CHECK ("kind"::text <> 'FRAME_HANDOVER' OR (
    "productionOrderId" IS NOT NULL AND "pieceId" IS NOT NULL AND "materialId" IS NULL AND "segmentSpecId" IS NULL
  ));

ALTER TABLE "stage_handover_overrides" ADD CONSTRAINT "stage_handover_overrides_qty_chk" CHECK ("qty" > 0);
ALTER TABLE "stage_handover_overrides" ADD CONSTRAINT "stage_handover_overrides_reason_chk"
  CHECK (length(btrim("reason")) >= 3);
ALTER TABLE "stage_handover_overrides" ADD CONSTRAINT "stage_handover_overrides_target_chk"
  CHECK (
    ("stage" = 'PHOI' AND "materialId" IS NOT NULL AND "pieceId" IS NULL)
    OR ("stage" IN ('HAN', 'SON') AND "productionOrderId" IS NOT NULL AND "pieceId" IS NOT NULL AND "materialId" IS NULL)
  );

