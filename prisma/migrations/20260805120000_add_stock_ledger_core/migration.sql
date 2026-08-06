-- Phase 3 — Kho vận lõi (Ledger Core): stock_ledger (sổ cái kép), stock_quant (cache số dư,
-- đồng bộ bằng trigger DB), warehouse_transfers + 2 bảng con.
-- Nguồn: docs/dna-erp-db-schema.html mục 1.8, docs/dna-erp-backend-implementation-plan.html
-- Phase 3. Viết tay theo đúng convention Prisma sinh ra (đối chiếu migration
-- 20260730000000_add_phase2_master_data_and_bom) vì DATABASE_URL trỏ tới Prisma Postgres
-- pooled dùng chung — không chạy `prisma migrate dev` trực tiếp lên đó mà không xác nhận
-- trước với team.

-- CreateEnum
CREATE TYPE "StockLedgerRefType" AS ENUM ('PURCHASE', 'STEEL_ISSUE', 'QC_SCRAP', 'SURPLUS_POSTING', 'SEGMENT_CONSUME', 'FRAME_OUTPUT', 'FINISHED', 'MATERIAL_ISSUE', 'WAREHOUSE_TRANSFER', 'ADJUST');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'RELEASED');

-- CreateTable
CREATE TABLE "stock_ledger" (
    "id" BIGSERIAL NOT NULL,
    "fromWarehouseId" BIGINT NOT NULL,
    "toWarehouseId" BIGINT NOT NULL,
    "materialId" BIGINT,
    "segmentSpecId" BIGINT,
    "pieceId" BIGINT,
    "productVariantId" BIGINT,
    "qty" DECIMAL(16,4) NOT NULL,
    "refType" "StockLedgerRefType" NOT NULL,
    "refId" TEXT,
    "idempotencyKey" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "stock_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_quant" (
    "id" BIGSERIAL NOT NULL,
    "warehouseId" BIGINT NOT NULL,
    "materialId" BIGINT,
    "segmentSpecId" BIGINT,
    "pieceId" BIGINT,
    "productVariantId" BIGINT,
    "qty" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_quant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_transfers" (
    "id" BIGSERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "fromWarehouseId" BIGINT NOT NULL,
    "toWarehouseId" BIGINT NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
    "planFormId" BIGINT,
    "rejectionReason" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),

    CONSTRAINT "warehouse_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_transfer_items" (
    "id" BIGSERIAL NOT NULL,
    "transferId" BIGINT NOT NULL,
    "materialId" BIGINT,
    "materialName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(16,4) NOT NULL,
    "note" TEXT,

    CONSTRAINT "warehouse_transfer_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_transfer_reservations" (
    "id" BIGSERIAL NOT NULL,
    "transferId" BIGINT NOT NULL,
    "warehouseId" BIGINT NOT NULL,
    "materialId" BIGINT,
    "quantity" DECIMAL(16,4) NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouse_transfer_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (stock_ledger - 1 cặp to/from theo mỗi chân hàng, phục vụ tổng hợp tồn kho)
CREATE INDEX "stock_ledger_toWarehouseId_materialId_idx" ON "stock_ledger"("toWarehouseId", "materialId");

-- CreateIndex
CREATE INDEX "stock_ledger_fromWarehouseId_materialId_idx" ON "stock_ledger"("fromWarehouseId", "materialId");

-- CreateIndex
CREATE INDEX "stock_ledger_toWarehouseId_segmentSpecId_idx" ON "stock_ledger"("toWarehouseId", "segmentSpecId");

-- CreateIndex
CREATE INDEX "stock_ledger_fromWarehouseId_segmentSpecId_idx" ON "stock_ledger"("fromWarehouseId", "segmentSpecId");

-- CreateIndex
CREATE INDEX "stock_ledger_toWarehouseId_pieceId_idx" ON "stock_ledger"("toWarehouseId", "pieceId");

-- CreateIndex
CREATE INDEX "stock_ledger_fromWarehouseId_pieceId_idx" ON "stock_ledger"("fromWarehouseId", "pieceId");

-- CreateIndex
CREATE INDEX "stock_ledger_toWarehouseId_productVariantId_idx" ON "stock_ledger"("toWarehouseId", "productVariantId");

-- CreateIndex
CREATE INDEX "stock_ledger_fromWarehouseId_productVariantId_idx" ON "stock_ledger"("fromWarehouseId", "productVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_ledger_idempotencyKey_key" ON "stock_ledger"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_transfers_code_key" ON "warehouse_transfers"("code");

-- CreateIndex
CREATE INDEX "warehouse_transfers_status_idx" ON "warehouse_transfers"("status");

-- CreateIndex
CREATE INDEX "warehouse_transfers_toWarehouseId_status_idx" ON "warehouse_transfers"("toWarehouseId", "status");

-- CreateIndex
CREATE INDEX "warehouse_transfer_items_transferId_idx" ON "warehouse_transfer_items"("transferId");

-- CreateIndex
CREATE INDEX "warehouse_transfer_reservations_warehouseId_materialId_idx" ON "warehouse_transfer_reservations"("warehouseId", "materialId");

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_segmentSpecId_fkey" FOREIGN KEY ("segmentSpecId") REFERENCES "segment_spec"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "piece"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_quant" ADD CONSTRAINT "stock_quant_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_quant" ADD CONSTRAINT "stock_quant_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_quant" ADD CONSTRAINT "stock_quant_segmentSpecId_fkey" FOREIGN KEY ("segmentSpecId") REFERENCES "segment_spec"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_quant" ADD CONSTRAINT "stock_quant_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "piece"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_quant" ADD CONSTRAINT "stock_quant_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transfers" ADD CONSTRAINT "warehouse_transfers_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transfers" ADD CONSTRAINT "warehouse_transfers_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transfers" ADD CONSTRAINT "warehouse_transfers_planFormId_fkey" FOREIGN KEY ("planFormId") REFERENCES "plan_forms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transfer_items" ADD CONSTRAINT "warehouse_transfer_items_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "warehouse_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transfer_items" ADD CONSTRAINT "warehouse_transfer_items_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transfer_reservations" ADD CONSTRAINT "warehouse_transfer_reservations_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "warehouse_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transfer_reservations" ADD CONSTRAINT "warehouse_transfer_reservations_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transfer_reservations" ADD CONSTRAINT "warehouse_transfer_reservations_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Constraint không diễn tả được trong schema.prisma (XOR 4 chân hàng - đúng 1 trong 4 khác NULL).
-- Cùng "Reference pattern for future ERP modules" đã ghi sẵn ở migration
-- 20260723021500_add_check_constraints, dùng num_nonnulls() thay vì chuỗi OR/AND dài cho 4 chân.
ALTER TABLE "stock_ledger"
  ADD CONSTRAINT "stock_ledger_goods_xor_chk"
  CHECK (num_nonnulls("materialId", "segmentSpecId", "pieceId", "productVariantId") = 1);

ALTER TABLE "stock_ledger"
  ADD CONSTRAINT "stock_ledger_from_ne_to_chk"
  CHECK ("fromWarehouseId" <> "toWarehouseId");

ALTER TABLE "stock_ledger"
  ADD CONSTRAINT "stock_ledger_qty_positive_chk"
  CHECK ("qty" > 0);

ALTER TABLE "stock_quant"
  ADD CONSTRAINT "stock_quant_goods_xor_chk"
  CHECK (num_nonnulls("materialId", "segmentSpecId", "pieceId", "productVariantId") = 1);

ALTER TABLE "warehouse_transfers"
  ADD CONSTRAINT "warehouse_transfers_from_ne_to_chk"
  CHECK ("fromWarehouseId" <> "toWarehouseId");

-- Constraint không diễn tả được trong schema.prisma (partial unique index): đúng 1 dòng
-- stock_quant cho mỗi (kho, hàng) - Postgres coi nhiều NULL là phân biệt nhau nên 1 UNIQUE
-- constraint duy nhất trên cả 5 cột không đủ, cần 4 index riêng theo từng chân (xem
-- dna-erp-db-schema.html mục 1.8, cùng lý do bom_revision_one_active_per_product ở Phase 2).
CREATE UNIQUE INDEX "stock_quant_warehouseId_materialId_key"
  ON "stock_quant"("warehouseId", "materialId") WHERE "materialId" IS NOT NULL;

CREATE UNIQUE INDEX "stock_quant_warehouseId_segmentSpecId_key"
  ON "stock_quant"("warehouseId", "segmentSpecId") WHERE "segmentSpecId" IS NOT NULL;

CREATE UNIQUE INDEX "stock_quant_warehouseId_pieceId_key"
  ON "stock_quant"("warehouseId", "pieceId") WHERE "pieceId" IS NOT NULL;

CREATE UNIQUE INDEX "stock_quant_warehouseId_productVariantId_key"
  ON "stock_quant"("warehouseId", "productVariantId") WHERE "productVariantId" IS NOT NULL;

-- Trigger đồng bộ stock_quant từ stock_ledger (quyết định đã chốt ở implementation-plan Phase 3
-- §3.9: trigger DB, không phải ghi kép ở tầng ứng dụng - không phụ thuộc dev nhớ ghi đúng 2 nơi
-- trong mọi service khác nhau đụng tới kho). ON CONFLICT theo đúng 1 trong 4 partial unique index
-- ở trên tuỳ chân hàng nào khác NULL trên dòng stock_ledger vừa insert.
CREATE OR REPLACE FUNCTION fn_sync_stock_quant() RETURNS trigger AS $$
BEGIN
  IF NEW."materialId" IS NOT NULL THEN
    INSERT INTO "stock_quant" ("warehouseId", "materialId", "qty", "updatedAt")
      VALUES (NEW."toWarehouseId", NEW."materialId", NEW."qty", now())
      ON CONFLICT ("warehouseId", "materialId") WHERE "materialId" IS NOT NULL
      DO UPDATE SET "qty" = "stock_quant"."qty" + NEW."qty", "updatedAt" = now();
    INSERT INTO "stock_quant" ("warehouseId", "materialId", "qty", "updatedAt")
      VALUES (NEW."fromWarehouseId", NEW."materialId", -NEW."qty", now())
      ON CONFLICT ("warehouseId", "materialId") WHERE "materialId" IS NOT NULL
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

CREATE TRIGGER "trg_sync_stock_quant"
AFTER INSERT ON "stock_ledger"
FOR EACH ROW EXECUTE FUNCTION fn_sync_stock_quant();
