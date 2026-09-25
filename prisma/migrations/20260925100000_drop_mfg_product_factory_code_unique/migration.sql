-- 2 khách có thể dùng cùng 1 mã SKU cho 2 kết cấu khác nhau -> bỏ unique, giữ index thường để tra cứu/tìm kiếm.
-- DropIndex
DROP INDEX "mfg_products_factoryCode_key";

-- CreateIndex
CREATE INDEX "mfg_products_factoryCode_idx" ON "mfg_products"("factoryCode");
