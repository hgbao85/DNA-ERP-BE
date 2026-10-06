-- Thuần THÊM giá trị enum (ALTER TYPE ... ADD VALUE) - không đổi/xoá dữ liệu. Dùng khi QC_PASSED
-- công đoạn CUỐI của MaterialYieldStepBundle (vd chân nhôm) để ghi StockLedger cộng tồn vật tư ra
-- vào kho thật (vat-tu-tp) - mirror FRAME_OUTPUT nhưng cho vật tư không gắn piece.
ALTER TYPE "StockLedgerRefType" ADD VALUE 'MATERIAL_YIELD_RECIPE_OUTPUT';
