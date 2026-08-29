-- Tự kiểm chứng Bước 1 (kế hoạch "chiều dài cây sắt" 2026-08-29) - chạy ngay sau migration
-- 20260829072018_stock_length_bucket, TRƯỚC khi đổi bất kỳ code service nào.

-- (a) Không còn bucket khác 0 nào ngay sau migration (DEFAULT 0 áp dụng cho mọi dòng lịch sử).
SELECT 'stock_ledger bucket != 0' AS check_name, count(*) AS bad_rows
FROM "stock_ledger" WHERE "stockLengthMm" <> 0
UNION ALL
SELECT 'stock_quant bucket != 0', count(*)
FROM "stock_quant" WHERE "stockLengthMm" <> 0
UNION ALL
SELECT 'stock_reservations bucket != 0', count(*)
FROM "stock_reservations" WHERE "stockLengthMm" <> 0
UNION ALL
SELECT 'warehouse_transfer_reservations bucket != 0', count(*)
FROM "warehouse_transfer_reservations" WHERE "stockLengthMm" <> 0;

-- (b) quant khớp tuyệt đối Σledger theo từng bucket, chân materialId (chân duy nhất có bucket).
WITH ledger_sum AS (
  SELECT "toWarehouseId" AS "warehouseId", "materialId", "stockLengthMm", SUM("qty") AS qty
  FROM "stock_ledger" WHERE "materialId" IS NOT NULL
  GROUP BY "toWarehouseId", "materialId", "stockLengthMm"
  UNION ALL
  SELECT "fromWarehouseId", "materialId", "stockLengthMm", -SUM("qty")
  FROM "stock_ledger" WHERE "materialId" IS NOT NULL
  GROUP BY "fromWarehouseId", "materialId", "stockLengthMm"
),
ledger_net AS (
  SELECT "warehouseId", "materialId", "stockLengthMm", SUM(qty) AS ledger_qty
  FROM ledger_sum
  GROUP BY "warehouseId", "materialId", "stockLengthMm"
)
SELECT 'quant vs ledger mismatch (materialId)' AS check_name, count(*) AS bad_rows
FROM (
  SELECT COALESCE(q."warehouseId", l."warehouseId") AS "warehouseId",
         COALESCE(q."materialId", l."materialId") AS "materialId",
         COALESCE(q."stockLengthMm", l."stockLengthMm") AS "stockLengthMm",
         COALESCE(q.qty, 0) AS quant_qty,
         COALESCE(l.ledger_qty, 0) AS ledger_qty
  FROM "stock_quant" q
  FULL OUTER JOIN ledger_net l
    ON q."warehouseId" = l."warehouseId" AND q."materialId" = l."materialId" AND q."stockLengthMm" = l."stockLengthMm"
  WHERE q."materialId" IS NOT NULL OR l."materialId" IS NOT NULL
) diff
WHERE quant_qty <> ledger_qty;

-- (c) Trigger + function vẫn tồn tại và trỏ đúng.
SELECT tgname, tgrelid::regclass AS table_name, tgenabled
FROM pg_trigger WHERE tgname = 'trg_sync_stock_quant';

-- (d) Constraint + index mới thật sự có mặt.
SELECT conname FROM pg_constraint
WHERE conname IN ('stock_ledger_stock_length_mm_chk', 'stock_quant_stock_length_mm_chk');

-- 2 tên cuối đã đổi ngắn lại ở migration 20260829072458 (bản gốc >63 byte bị Postgres âm thầm cắt
-- ký tự cuối - xem comment trong migration đó).
SELECT indexname FROM pg_indexes
WHERE indexname IN (
  'stock_quant_warehouseId_materialId_stockLengthMm_key',
  'stock_ledger_toWarehouseId_materialId_stockLengthMm_idx',
  'stock_ledger_fromWarehouseId_materialId_stockLengthMm_idx',
  'stock_reservations_wh_mat_len_status_idx',
  'warehouse_transfer_reservations_wh_mat_len_idx'
);

-- (e) Index cũ đã bị drop đúng như dự kiến (không còn khoá kép (warehouseId, materialId) không kèm bucket).
SELECT indexname FROM pg_indexes WHERE indexname = 'stock_quant_warehouseId_materialId_key';
