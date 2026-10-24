-- Tồn kho tách theo QUY CÁCH (nệm: cùng 1 màu nhưng nhiều quy cách khác nhau - đôi 870x450x50, đơn 450x450x50...).
--
-- Thêm chiều "spec" (chuỗi, '' = không có quy cách riêng) cạnh stockLengthMm, đúng mẫu migration
-- 20260829072018_stock_length_bucket: sổ cái ghi spec, trigger fn_sync_stock_quant cộng/trừ đúng bucket
-- (kho, vật tư, độ dài, quy cách), giữ chỗ và phiếu chuyển kho cũng mang spec.
--
-- Mọi dòng hiện có nhận spec = '' (không quy cách) nên số liệu cũ KHÔNG đổi. Chỉ mở rộng - không xoá dữ liệu.
-- LƯU Ý (bài học 2026-09-04): đổi unique index của stock_quant mà quên cập nhật trigger sẽ làm hỏng MỌI luồng ghi
-- sổ kho (lỗi 42P10) - nên index và hàm trigger được đổi CÙNG migration này.

-- stock_ledger
ALTER TABLE "stock_ledger" ADD COLUMN "spec" TEXT NOT NULL DEFAULT '';
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_spec_chk"
  CHECK ("spec" = '' OR "materialId" IS NOT NULL);
CREATE INDEX "stock_ledger_toWarehouseId_materialId_spec_idx"
  ON "stock_ledger" ("toWarehouseId", "materialId", "spec");

-- stock_quant: unique theo (kho, vật tư, độ dài, quy cách)
ALTER TABLE "stock_quant" ADD COLUMN "spec" TEXT NOT NULL DEFAULT '';
ALTER TABLE "stock_quant" ADD CONSTRAINT "stock_quant_spec_chk"
  CHECK ("spec" = '' OR "materialId" IS NOT NULL);
DROP INDEX "stock_quant_warehouseId_materialId_stockLengthMm_key";
CREATE UNIQUE INDEX "stock_quant_wh_mat_len_spec_key"
  ON "stock_quant" ("warehouseId", "materialId", "stockLengthMm", "spec") WHERE ("materialId" IS NOT NULL);

-- giữ chỗ
ALTER TABLE "stock_reservations" ADD COLUMN "spec" TEXT NOT NULL DEFAULT '';
CREATE INDEX "stock_reservations_wh_mat_spec_status_idx"
  ON "stock_reservations" ("warehouseId", "materialId", "spec", "status");

ALTER TABLE "warehouse_transfer_reservations" ADD COLUMN "spec" TEXT NOT NULL DEFAULT '';

-- phiếu chuyển kho: dòng vật tư nói rõ lấy quy cách nào ('' = không quy cách)
ALTER TABLE "warehouse_transfer_items" ADD COLUMN "spec" TEXT NOT NULL DEFAULT '';

-- Trigger đồng bộ tồn: nhánh materialId đưa spec vào cả INSERT lẫn ON CONFLICT (3 nhánh còn lại không đổi).
CREATE OR REPLACE FUNCTION public.fn_sync_stock_quant()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."materialId" IS NOT NULL THEN
    INSERT INTO "stock_quant" ("warehouseId", "materialId", "stockLengthMm", "spec", "qty", "updatedAt")
      VALUES (NEW."toWarehouseId", NEW."materialId", NEW."stockLengthMm", NEW."spec", NEW."qty", now())
      ON CONFLICT ("warehouseId", "materialId", "stockLengthMm", "spec") WHERE "materialId" IS NOT NULL
      DO UPDATE SET "qty" = "stock_quant"."qty" + NEW."qty", "updatedAt" = now();
    INSERT INTO "stock_quant" ("warehouseId", "materialId", "stockLengthMm", "spec", "qty", "updatedAt")
      VALUES (NEW."fromWarehouseId", NEW."materialId", NEW."stockLengthMm", NEW."spec", -NEW."qty", now())
      ON CONFLICT ("warehouseId", "materialId", "stockLengthMm", "spec") WHERE "materialId" IS NOT NULL
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
$function$;
