-- Đảo ngược quyết định nghiệp vụ 2026-08-22 ("luôn đúng 1 material/piece") theo yêu cầu người dùng
-- 2026-10-03: 1 piece (vd "Pat") giờ được phép có NHIỀU dòng PieceMaterialYield (khác material),
-- mirror đúng cách PieceBom đã cho phép ghép nhiều loại sắt từ trước. Chỉ còn chặn trùng ĐÚNG 1
-- material trên cùng 1 piece.
DROP INDEX "piece_material_yield_bomRevisionId_pieceId_key";
CREATE UNIQUE INDEX "piece_material_yield_bomRevisionId_pieceId_materialId_key"
  ON "piece_material_yield"("bomRevisionId", "pieceId", "materialId");
