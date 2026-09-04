-- Bug phát hiện 2026-09-04: migration 20260829072018_stock_length_bucket đã đổi unique index của
-- stock_quant từ (warehouseId, materialId) sang (warehouseId, materialId, stockLengthMm) NHƯNG
-- quên cập nhật fn_sync_stock_quant() - trigger nhánh materialId vẫn ON CONFLICT (warehouseId,
-- materialId) 2 cột, không khớp unique index 3 cột hiện có -> Postgres báo lỗi 42P10 "no unique or
-- exclusion constraint matching the ON CONFLICT specification" mỗi khi ghi StockLedger có
-- materialId (ẢNH HƯỞNG MỌI luồng, không riêng gì 1 module: MaterialIssuesService, giờ cả
-- MaterialYieldIssuesService mới thêm 2026-09-04). 3 nhánh còn lại (segmentSpecId/pieceId/
-- productVariantId) không đổi vì unique index của chúng vẫn đúng 2 cột như cũ.
--
-- stock_ledger.stockLengthMm đã có sẵn (INTEGER NOT NULL DEFAULT 0, cùng migration
-- 20260829072018) - chỉ cần đọc NEW."stockLengthMm" và đưa vào cả câu INSERT lẫn ON CONFLICT.
CREATE OR REPLACE FUNCTION public.fn_sync_stock_quant()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$;
