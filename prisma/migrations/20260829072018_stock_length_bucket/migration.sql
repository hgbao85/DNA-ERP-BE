-- Reconstructed 2026-09-01: migration đã ÁP DỤNG THẬT trên DB (xem _prisma_migrations,
-- started_at=2026-08-29T07:21:42Z) nhưng file migration.sql + phần schema.prisma tương ứng bị
-- thất lạc khỏi git (chưa rõ nguyên nhân - phát hiện lúc migrate dev báo drift khi thêm
-- ProductionOrderFloorStage.PAUSED). Nội dung dưới đây dựng lại CHÍNH XÁC từ introspect DB thật
-- (cột/CHECK/index hiện có) - không đổi gì thêm, chỉ để migration history khớp lại thực tế.
--
-- Bucket tồn kho sắt cây theo ĐỘ DÀI (mm) - trước đây stock_ledger/stock_quant/stock_reservations/
-- warehouse_transfer_reservations gộp chung mọi cây cùng material bất kể dài ngắn, trong khi PO
-- mua sắt theo từng độ dài riêng (PurchaseProposalItem.stockLengthMm, migration 20260826010000).
-- stockLengthMm=0 cho mọi loại hàng không phải sắt cây bán theo chiều dài (materialId NULL, hoặc
-- piece/segmentSpec/productVariant).

-- StockLedger
ALTER TABLE "stock_ledger" ADD COLUMN "stockLengthMm" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_stock_length_mm_chk"
  CHECK ("stockLengthMm" >= 0 AND ("stockLengthMm" = 0 OR "materialId" IS NOT NULL));
CREATE INDEX "stock_ledger_fromWarehouseId_materialId_stockLengthMm_idx"
  ON "stock_ledger" ("fromWarehouseId", "materialId", "stockLengthMm");
CREATE INDEX "stock_ledger_toWarehouseId_materialId_stockLengthMm_idx"
  ON "stock_ledger" ("toWarehouseId", "materialId", "stockLengthMm");

-- StockQuant - gộp stockLengthMm vào khoá unique (warehouseId, materialId) sẵn có (migration
-- 20260805120000_add_stock_ledger_core), thay vì mỗi độ dài chỉ được 1 dòng số dư cho cả material.
DROP INDEX "stock_quant_warehouseId_materialId_key";
ALTER TABLE "stock_quant" ADD COLUMN "stockLengthMm" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "stock_quant" ADD CONSTRAINT "stock_quant_stock_length_mm_chk"
  CHECK ("stockLengthMm" >= 0 AND ("stockLengthMm" = 0 OR "materialId" IS NOT NULL));
CREATE UNIQUE INDEX "stock_quant_warehouseId_materialId_stockLengthMm_key"
  ON "stock_quant" ("warehouseId", "materialId", "stockLengthMm") WHERE ("materialId" IS NOT NULL);

-- StockReservation
ALTER TABLE "stock_reservations" ADD COLUMN "stockLengthMm" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "stock_reservations_wh_mat_len_status_idx"
  ON "stock_reservations" ("warehouseId", "materialId", "stockLengthMm", "status");

-- WarehouseTransferReservation
ALTER TABLE "warehouse_transfer_reservations" ADD COLUMN "stockLengthMm" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "warehouse_transfer_reservations_wh_mat_len_idx"
  ON "warehouse_transfer_reservations" ("warehouseId", "materialId", "stockLengthMm");
