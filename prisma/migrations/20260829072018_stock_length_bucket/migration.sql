-- Kế hoạch "chiều dài cây sắt là 1 phần khoá tồn kho" (Phương án A, 2026-08-29) - Bước 1.
-- Thêm đúng 1 chiều dữ liệu mới (stockLengthMm) vào 4 bảng lõi kho, KHÔNG đổi lại bất kỳ logic
-- khoá/thứ tự/vòng lặp đã có. Viết tay theo đúng convention migration 20260805120000_add_stock_ledger_core
-- (DATABASE_URL trỏ Prisma Postgres pooled dùng chung - không chạy `prisma migrate dev` trực tiếp
-- lên đó mà không xác nhận trước với team).
--
-- 0 = "bucket chưa xác định cỡ cây", KHÔNG phải "cây dài 0mm" - DEFAULT 0 áp dụng cho MỌI dòng
-- lịch sử (cố ý không backfill/đoán dữ liệu, xem plan quyết định thiết kế #2). 3 chân hàng
-- segmentSpec/piece/productVariant vĩnh viễn ở bucket 0 - không đổi index/constraint của chúng.

-- AddColumn
ALTER TABLE "stock_ledger" ADD COLUMN "stockLengthMm" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "stock_quant" ADD COLUMN "stockLengthMm" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "stock_reservations" ADD COLUMN "stockLengthMm" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "warehouse_transfer_reservations" ADD COLUMN "stockLengthMm" INTEGER NOT NULL DEFAULT 0;

-- CheckConstraint - chỉ materialId (sắt) mới được phép có bucket khác 0; 3 chân hàng còn lại
-- luôn bucket 0 (enforce lại ở service để trả 400 rõ ràng thay vì để lộ lỗi CHECK constraint thô,
-- cùng idiom stock_ledger_goods_xor_chk).
ALTER TABLE "stock_ledger"
  ADD CONSTRAINT "stock_ledger_stock_length_mm_chk"
  CHECK ("stockLengthMm" >= 0 AND ("stockLengthMm" = 0 OR "materialId" IS NOT NULL));

ALTER TABLE "stock_quant"
  ADD CONSTRAINT "stock_quant_stock_length_mm_chk"
  CHECK ("stockLengthMm" >= 0 AND ("stockLengthMm" = 0 OR "materialId" IS NOT NULL));

-- Đổi khoá duy nhất stock_quant cho chân materialId: (warehouseId, materialId) -> (warehouseId,
-- materialId, stockLengthMm) - trong cùng migration, không có khoảng hở mất ràng buộc. 3 partial
-- unique index còn lại (segmentSpecId/pieceId/productVariantId) giữ nguyên không đụng.
DROP INDEX "stock_quant_warehouseId_materialId_key";

CREATE UNIQUE INDEX "stock_quant_warehouseId_materialId_stockLengthMm_key"
  ON "stock_quant"("warehouseId", "materialId", "stockLengthMm") WHERE "materialId" IS NOT NULL;

-- CreateIndex - index đọc mới theo bucket, giữ lại index cũ song song (không drop, tránh
-- regression kế hoạch truy vấn khác).
CREATE INDEX "stock_ledger_toWarehouseId_materialId_stockLengthMm_idx"
  ON "stock_ledger"("toWarehouseId", "materialId", "stockLengthMm");

CREATE INDEX "stock_ledger_fromWarehouseId_materialId_stockLengthMm_idx"
  ON "stock_ledger"("fromWarehouseId", "materialId", "stockLengthMm");

CREATE INDEX "stock_reservations_warehouseId_materialId_stockLengthMm_status_idx"
  ON "stock_reservations"("warehouseId", "materialId", "stockLengthMm", "status");

CREATE INDEX "warehouse_transfer_reservations_warehouseId_materialId_stockLengthMm_idx"
  ON "warehouse_transfer_reservations"("warehouseId", "materialId", "stockLengthMm");

-- Viết lại fn_sync_stock_quant(): copy nguyên văn cả 4 nhánh từ migration gốc
-- (20260805120000_add_stock_ledger_core), CHỈ nhánh materialId đổi - thêm stockLengthMm vào cột
-- INSERT + ON CONFLICT. 3 nhánh còn lại (segmentSpecId/pieceId/productVariantId) giữ nguyên từng
-- ký tự - luôn ghi/đọc bucket 0 cho các chân hàng đó (cột stockLengthMm nhận DEFAULT 0 của bảng).
-- CREATE TRIGGER không cần tạo lại (CREATE OR REPLACE FUNCTION giữ nguyên trigger đang trỏ tới).
CREATE OR REPLACE FUNCTION fn_sync_stock_quant() RETURNS trigger AS $$
BEGIN
  IF NEW."materialId" IS NOT NULL THEN
    INSERT INTO "stock_quant" ("warehouseId", "materialId", "stockLengthMm", "qty", "updatedAt")
      VALUES (NEW."toWarehouseId", NEW."materialId", NEW."stockLengthMm", NEW."qty", now())
      ON CONFLICT ("warehouseId", "materialId", "stockLengthMm") WHERE "materialId" IS NOT NULL
      DO UPDATE SET "qty" = "stock_quant"."qty" + NEW."qty", "updatedAt" = now();
    INSERT INTO "stock_quant" ("warehouseId", "materialId", "stockLengthMm", "qty", "updatedAt")
      VALUES (NEW."fromWarehouseId", NEW."materialId", NEW."stockLengthMm", -NEW."qty", now())
      ON CONFLICT ("warehouseId", "materialId", "stockLengthMm") WHERE "materialId" IS NOT NULL
      DO UPDATE SET "qty" = "stock_quant"."qty" - NEW."qty", "updatedAt" = now();

  ELSIF NEW."segmentSpecId" IS NOT NULL THEN
    INSERT INTO "stock_quant" ("warehouseId", "segmentSpecId", "qty", "updatedAt")
      VALUES (NEW."toWarehouseId", NEW."segmentSpecId", NEW."qty", now())
      ON CONFLICT ("warehouseId", "segmentSpecId") WHERE "segmentSpecId" IS NOT NULL
      DO UPDATE SET "qty" = "stock_quant"."qty" + NEW."qty", "updatedAt" = now();
    INSERT INTO "stock_quant" ("warehouseId", "segmentSpecId", "qty", "updatedAt")
      VALUES (NEW."fromWarehouseId", NEW."segmentSpecId", -NEW."qty", now())
      ON CONFLICT ("warehouseId", "segmentSpecId") WHERE "segmentSpecId" IS NOT NULL
      DO UPDATE SET "qty" = "stock_quant"."qty" - NEW."qty", "updatedAt" = now();

  ELSIF NEW."pieceId" IS NOT NULL THEN
    INSERT INTO "stock_quant" ("warehouseId", "pieceId", "qty", "updatedAt")
      VALUES (NEW."toWarehouseId", NEW."pieceId", NEW."qty", now())
      ON CONFLICT ("warehouseId", "pieceId") WHERE "pieceId" IS NOT NULL
      DO UPDATE SET "qty" = "stock_quant"."qty" + NEW."qty", "updatedAt" = now();
    INSERT INTO "stock_quant" ("warehouseId", "pieceId", "qty", "updatedAt")
      VALUES (NEW."fromWarehouseId", NEW."pieceId", -NEW."qty", now())
      ON CONFLICT ("warehouseId", "pieceId") WHERE "pieceId" IS NOT NULL
      DO UPDATE SET "qty" = "stock_quant"."qty" - NEW."qty", "updatedAt" = now();

  ELSIF NEW."productVariantId" IS NOT NULL THEN
    INSERT INTO "stock_quant" ("warehouseId", "productVariantId", "qty", "updatedAt")
      VALUES (NEW."toWarehouseId", NEW."productVariantId", NEW."qty", now())
      ON CONFLICT ("warehouseId", "productVariantId") WHERE "productVariantId" IS NOT NULL
      DO UPDATE SET "qty" = "stock_quant"."qty" + NEW."qty", "updatedAt" = now();
    INSERT INTO "stock_quant" ("warehouseId", "productVariantId", "qty", "updatedAt")
      VALUES (NEW."fromWarehouseId", NEW."productVariantId", -NEW."qty", now())
      ON CONFLICT ("warehouseId", "productVariantId") WHERE "productVariantId" IS NOT NULL
      DO UPDATE SET "qty" = "stock_quant"."qty" - NEW."qty", "updatedAt" = now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
