-- Giữ chỗ theo kho (rà soát Mua hàng + Kho 14/11, nhóm B - 16/11/2026).
-- 4 loại dòng giữ chỗ tính lại / cộng thêm nhiều lần trên cùng refId nay có thêm đuôi ':wh:{warehouseId}' trong khoá, để cùng
-- 1 lệnh có hàng ở 2 kho (sau đổi xưởng) thì có 2 dòng. Chỉ nối đuôi cho dòng chưa có; không đổi số lượng nào. Chạy lại không
-- đổi gì. Dòng CUTTING_PROPOSAL (sắt) giữ khoá cũ. Xem reservationKey() ở src/modules/stock/stock-reservations.service.ts.
UPDATE "stock_reservations"
SET "idempotencyKey" = "idempotencyKey" || ':wh:' || "warehouseId"::text
WHERE "refType" IN (
    'CONSUMABLE_MATERIAL_PURCHASE',
    'PIECE_MATERIAL_YIELD_PURCHASE',
    'MATERIAL_YIELD_RECIPE_PURCHASE',
    'PRODUCTION_INVOICE'
  )
  AND "idempotencyKey" IS NOT NULL
  AND "idempotencyKey" !~ ':wh:[0-9]+$';
