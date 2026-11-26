-- Vị trí kho Thành phẩm có QR, tồn theo vị trí, soạn hàng theo booking, load từng cont (25/11/2026 - docs
-- THIET-KE-VI-TRI-KHO-LOAD-CONT-2026-11-25, chốt V1-V9). Chỉ thêm (enum mới, cột cho phép rỗng, bảng mới) - không ghi lại dữ liệu cũ.
-- Công tắc VI_TRI_KHO_ENABLED tắt thì không luồng nào ghi vào các bảng / cột này. CHECK so enum qua ::text (như các migration trước).
-- Số lượng tính theo BỘ (cùng đơn vị đóng gói / dòng booking).

-- CreateEnum
CREATE TYPE "LocationMovementKind" AS ENUM ('PUTAWAY', 'PUTAWAY_CANCEL', 'MOVE', 'PICK', 'UNPICK');

-- CreateEnum
CREATE TYPE "BookingContainerStatus" AS ENUM ('OPEN', 'LOADED');

-- AlterTable
ALTER TABLE "packing_reports" ADD COLUMN     "locationId" BIGINT;

-- CreateTable
CREATE TABLE "warehouse_locations" (
    "id" BIGSERIAL NOT NULL,
    "warehouseId" BIGINT NOT NULL,
    "code" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "aisle" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "qrToken" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_stocks" (
    "id" BIGSERIAL NOT NULL,
    "locationId" BIGINT NOT NULL,
    "productionInvoiceItemId" BIGINT NOT NULL,
    "mfgProductId" BIGINT NOT NULL,
    "salesOrderItemId" BIGINT,
    "qty" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "location_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_stock_movements" (
    "id" BIGSERIAL NOT NULL,
    "kind" "LocationMovementKind" NOT NULL,
    "fromLocationId" BIGINT,
    "toLocationId" BIGINT,
    "productionInvoiceItemId" BIGINT NOT NULL,
    "mfgProductId" BIGINT NOT NULL,
    "salesOrderItemId" BIGINT,
    "qty" INTEGER NOT NULL,
    "packingReportId" BIGINT,
    "bookingId" BIGINT,
    "bookingLineId" BIGINT,
    "containerId" BIGINT,
    "actorId" TEXT NOT NULL,
    "note" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_containers" (
    "id" BIGSERIAL NOT NULL,
    "bookingId" BIGINT NOT NULL,
    "containerNo" TEXT,
    "sealNo" TEXT,
    "photoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "BookingContainerStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "loadedAt" TIMESTAMP(3),
    "loadedById" TEXT,

    CONSTRAINT "booking_containers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_container_lines" (
    "id" BIGSERIAL NOT NULL,
    "containerId" BIGINT NOT NULL,
    "bookingLineId" BIGINT NOT NULL,
    "productionInvoiceItemId" BIGINT NOT NULL,
    "mfgProductId" BIGINT NOT NULL,
    "salesOrderItemId" BIGINT NOT NULL,
    "qty" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_container_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_locations_qrToken_key" ON "warehouse_locations"("qrToken");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_locations_warehouseId_code_key" ON "warehouse_locations"("warehouseId", "code");

-- CreateIndex
CREATE INDEX "location_stocks_productionInvoiceItemId_idx" ON "location_stocks"("productionInvoiceItemId");

-- CreateIndex
-- V9: 1 dòng / (ô, SKU, LSX, PO) - NULLS NOT DISTINCT để dòng không gắn PO (salesOrderItemId NULL) cũng không trùng.
CREATE UNIQUE INDEX "location_stocks_locationId_productionInvoiceItemId_mfgProdu_key" ON "location_stocks"("locationId", "productionInvoiceItemId", "mfgProductId", "salesOrderItemId") NULLS NOT DISTINCT;

-- CreateIndex
CREATE UNIQUE INDEX "location_stock_movements_idempotencyKey_key" ON "location_stock_movements"("idempotencyKey");

-- CreateIndex
CREATE INDEX "location_stock_movements_fromLocationId_createdAt_idx" ON "location_stock_movements"("fromLocationId", "createdAt");

-- CreateIndex
CREATE INDEX "location_stock_movements_toLocationId_createdAt_idx" ON "location_stock_movements"("toLocationId", "createdAt");

-- CreateIndex
CREATE INDEX "location_stock_movements_productionInvoiceItemId_createdAt_idx" ON "location_stock_movements"("productionInvoiceItemId", "createdAt");

-- CreateIndex
CREATE INDEX "location_stock_movements_bookingId_idx" ON "location_stock_movements"("bookingId");

-- CreateIndex
CREATE INDEX "location_stock_movements_containerId_idx" ON "location_stock_movements"("containerId");

-- CreateIndex
CREATE INDEX "booking_containers_bookingId_idx" ON "booking_containers"("bookingId");

-- CreateIndex
CREATE INDEX "booking_container_lines_bookingLineId_idx" ON "booking_container_lines"("bookingLineId");

-- CreateIndex
CREATE UNIQUE INDEX "booking_container_lines_containerId_bookingLineId_key" ON "booking_container_lines"("containerId", "bookingLineId");

-- AddForeignKey
ALTER TABLE "packing_reports" ADD CONSTRAINT "packing_reports_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "warehouse_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_locations" ADD CONSTRAINT "warehouse_locations_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_stocks" ADD CONSTRAINT "location_stocks_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "warehouse_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_stocks" ADD CONSTRAINT "location_stocks_productionInvoiceItemId_fkey" FOREIGN KEY ("productionInvoiceItemId") REFERENCES "production_invoice_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_stocks" ADD CONSTRAINT "location_stocks_mfgProductId_fkey" FOREIGN KEY ("mfgProductId") REFERENCES "mfg_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_stocks" ADD CONSTRAINT "location_stocks_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "sales_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_stock_movements" ADD CONSTRAINT "location_stock_movements_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "warehouse_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_stock_movements" ADD CONSTRAINT "location_stock_movements_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "warehouse_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_stock_movements" ADD CONSTRAINT "location_stock_movements_productionInvoiceItemId_fkey" FOREIGN KEY ("productionInvoiceItemId") REFERENCES "production_invoice_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_stock_movements" ADD CONSTRAINT "location_stock_movements_mfgProductId_fkey" FOREIGN KEY ("mfgProductId") REFERENCES "mfg_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_stock_movements" ADD CONSTRAINT "location_stock_movements_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "sales_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_stock_movements" ADD CONSTRAINT "location_stock_movements_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_stock_movements" ADD CONSTRAINT "location_stock_movements_bookingLineId_fkey" FOREIGN KEY ("bookingLineId") REFERENCES "booking_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_stock_movements" ADD CONSTRAINT "location_stock_movements_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "booking_containers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_stock_movements" ADD CONSTRAINT "location_stock_movements_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_containers" ADD CONSTRAINT "booking_containers_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_containers" ADD CONSTRAINT "booking_containers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_containers" ADD CONSTRAINT "booking_containers_loadedById_fkey" FOREIGN KEY ("loadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_container_lines" ADD CONSTRAINT "booking_container_lines_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "booking_containers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_container_lines" ADD CONSTRAINT "booking_container_lines_bookingLineId_fkey" FOREIGN KEY ("bookingLineId") REFERENCES "booking_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_container_lines" ADD CONSTRAINT "booking_container_lines_productionInvoiceItemId_fkey" FOREIGN KEY ("productionInvoiceItemId") REFERENCES "production_invoice_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_container_lines" ADD CONSTRAINT "booking_container_lines_mfgProductId_fkey" FOREIGN KEY ("mfgProductId") REFERENCES "mfg_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_container_lines" ADD CONSTRAINT "booking_container_lines_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "sales_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK: mã ô = khu-dãy-ô, không rỗng.
ALTER TABLE "warehouse_locations" ADD CONSTRAINT "warehouse_locations_code_chk"
  CHECK ("zone" <> '' AND "aisle" <> '' AND "slot" <> '' AND "code" = "zone" || '-' || "aisle" || '-' || "slot");

-- CHECK: tồn theo ô không âm.
ALTER TABLE "location_stocks" ADD CONSTRAINT "location_stocks_qty_chk" CHECK ("qty" >= 0);

-- CHECK: dịch chuyển luôn > 0 và đủ đầu đi / đầu đến theo loại.
ALTER TABLE "location_stock_movements" ADD CONSTRAINT "location_stock_movements_qty_chk" CHECK ("qty" > 0);
ALTER TABLE "location_stock_movements" ADD CONSTRAINT "location_stock_movements_kind_chk" CHECK (
  ("kind"::text = 'PUTAWAY' AND "toLocationId" IS NOT NULL AND "fromLocationId" IS NULL)
  OR ("kind"::text = 'PUTAWAY_CANCEL' AND "fromLocationId" IS NOT NULL AND "toLocationId" IS NULL)
  OR ("kind"::text = 'MOVE' AND "fromLocationId" IS NOT NULL AND "toLocationId" IS NOT NULL AND "fromLocationId" <> "toLocationId")
  OR ("kind"::text = 'PICK' AND "fromLocationId" IS NOT NULL AND "toLocationId" IS NULL AND "containerId" IS NOT NULL AND "bookingId" IS NOT NULL)
  OR ("kind"::text = 'UNPICK' AND "toLocationId" IS NOT NULL AND "fromLocationId" IS NULL AND "containerId" IS NOT NULL AND "bookingId" IS NOT NULL)
);

-- CHECK: hàng trong cont không âm.
ALTER TABLE "booking_container_lines" ADD CONSTRAINT "booking_container_lines_qty_chk" CHECK ("qty" >= 0);

-- CHECK (V7): cont đã đóng phải có số cont, số seal, ≥ 1 ảnh load, người + giờ đóng.
ALTER TABLE "booking_containers" ADD CONSTRAINT "booking_containers_loaded_chk" CHECK (
  "status"::text <> 'LOADED' OR (
    coalesce(btrim("containerNo"), '') <> '' AND coalesce(btrim("sealNo"), '') <> ''
    AND coalesce(cardinality("photoUrls"), 0) >= 1 AND "loadedAt" IS NOT NULL AND "loadedById" IS NOT NULL
  )
);

-- Số cont không trùng trong 1 booking (chưa nhập thì chưa tính).
CREATE UNIQUE INDEX "booking_containers_bookingId_containerNo_key" ON "booking_containers"("bookingId", "containerNo") WHERE "containerNo" IS NOT NULL;

-- Tra lần báo đóng gói theo ô.
CREATE INDEX "packing_reports_locationId_idx" ON "packing_reports"("locationId");
