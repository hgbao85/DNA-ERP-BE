-- Số vật tư thành phẩm cần dùng cho 1 piece (mảnh) - vd 1 "pat" gồm 3 miếng sắt lá. Default 1 giữ
-- nguyên hành vi tính mua hàng hiện tại cho mọi dòng đã có (trước đây ngầm định 1 piece = 1 miếng).
ALTER TABLE "piece_material_yield" ADD COLUMN "qtyPerPiece" INTEGER NOT NULL DEFAULT 1;
