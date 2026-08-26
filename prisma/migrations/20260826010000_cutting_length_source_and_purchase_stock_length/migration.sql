-- Sếp mở lại auto_scan (2026-08-26): cần phân biệt "cây chuẩn" (fixed) với "cây đặt riêng"
-- (scan) trên phương án cắt, và cần chảy đúng chiều dài đó tới đề xuất mua.
ALTER TABLE "cutting_proposal_lines" ADD COLUMN "lengthSource" TEXT;
ALTER TABLE "purchase_proposal_items" ADD COLUMN "stockLengthMm" INTEGER;
