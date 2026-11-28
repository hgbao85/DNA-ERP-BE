-- Đợt 2 lượt 1 (28/11/2026, câu 2 cách 1): đầu kỳ ngày bật giao nhận giữa tổ. Dòng cũ đều là QLSX mở chặn (OVERRIDE).
CREATE TYPE "StageHandoverOverrideKind" AS ENUM ('OVERRIDE', 'OPENING_DONE', 'OPENING_WAITING');

ALTER TABLE "stage_handover_overrides"
  ADD COLUMN "kind" "StageHandoverOverrideKind" NOT NULL DEFAULT 'OVERRIDE';

-- Mỗi (SKU, mảnh, tổ) chỉ có 1 dòng đầu kỳ mỗi loại - ghi đầu kỳ chạy lại / 2 người cùng bấm không cộng đôi.
CREATE UNIQUE INDEX "stage_handover_overrides_opening_key"
  ON "stage_handover_overrides" ("productionOrderId", "pieceId", "stage", "kind")
  WHERE "kind" <> 'OVERRIDE';
