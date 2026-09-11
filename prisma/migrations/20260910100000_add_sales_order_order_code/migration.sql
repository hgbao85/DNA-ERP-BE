-- Thêm "orderCode" (mã đơn hàng Sales tự nhập tay) thay thế "code" (PO-{id} tự sinh) làm mã hiển
-- thị chính cho người dùng. Backfill đơn cũ bằng chính "code" hiện có - không cần dedup vì "code"
-- vốn đã unique. Mirror đúng mẫu 20260725100000_add_username_to_users (add nullable -> backfill ->
-- set NOT NULL -> add unique constraint).
ALTER TABLE "sales_orders" ADD COLUMN "orderCode" TEXT;

UPDATE "sales_orders" SET "orderCode" = "code" WHERE "orderCode" IS NULL;

ALTER TABLE "sales_orders" ALTER COLUMN "orderCode" SET NOT NULL;

ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_orderCode_key" UNIQUE ("orderCode");
