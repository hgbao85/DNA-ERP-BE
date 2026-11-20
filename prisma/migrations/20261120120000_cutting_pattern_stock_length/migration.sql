-- CS2 (20/11/2026): chiều dài cây theo từng kiểu cắt (cây lẻ trong kho + chiều dài mua trong cùng 1 loại sắt).
-- Chỉ thêm cột cho phép NULL: dữ liệu cũ giữ nguyên, NULL = dùng chiều dài của dòng phương án như trước.
ALTER TABLE "cutting_proposal_patterns" ADD COLUMN "stockLengthMm" INTEGER;
