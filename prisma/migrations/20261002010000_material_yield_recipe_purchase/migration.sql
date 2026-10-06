-- Thuần THÊM giá trị enum (ALTER TYPE ... ADD VALUE) - không đổi/xoá dữ liệu. Dùng bởi
-- MaterialYieldRecipePurchaseService (2026-10-02): tính + tạo PurchaseProposal cho nguyên liệu đầu
-- vào (vd thanh nhôm) của MaterialYieldRecipe - phần "Mua hàng" còn thiếu của tính năng "vật tư
-- thành phẩm" (2026-10-01), mirror PieceMaterialYieldPurchaseService đã có sẵn cho "pat".
ALTER TYPE "PurchaseProposalSource" ADD VALUE 'MATERIAL_YIELD_RECIPE';
ALTER TYPE "StockReservationRefType" ADD VALUE 'MATERIAL_YIELD_RECIPE_PURCHASE';
