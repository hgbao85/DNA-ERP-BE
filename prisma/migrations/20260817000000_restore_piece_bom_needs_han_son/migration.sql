-- Khôi phục needsHan/needsSon trên piece_bom theo yêu cầu nghiệp vụ.
ALTER TABLE "piece_bom" ADD COLUMN "needsHan" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "piece_bom" ADD COLUMN "needsSon" BOOLEAN NOT NULL DEFAULT false;
