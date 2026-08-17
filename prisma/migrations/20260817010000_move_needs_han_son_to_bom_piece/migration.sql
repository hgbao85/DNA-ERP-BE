-- needsHan/needsSon chuyển từ cấp "từng thanh sắt" (piece_bom) sang cấp "cả mảnh" (bom_piece)
-- theo yêu cầu nghiệp vụ: quyết định có Hàn/Sơn hay không áp dụng cho toàn bộ mảnh, không phải
-- từng đoạn sắt riêng lẻ bên trong mảnh đó.
ALTER TABLE "piece_bom" DROP COLUMN "needsHan";
ALTER TABLE "piece_bom" DROP COLUMN "needsSon";
ALTER TABLE "bom_piece" ADD COLUMN "needsHan" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "bom_piece" ADD COLUMN "needsSon" BOOLEAN NOT NULL DEFAULT false;
