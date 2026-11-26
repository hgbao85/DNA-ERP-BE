-- Pallet Sơn (24/11/2026 - docs THIET-KE-PALLET-SON-2026-11-24, chốt P1-P8): pallet cố định của kho Sơn dán tem QR, lịch
-- sử xếp pallet (lệnh + mảnh + số, báo Sơn xong, phiếu xuất đan), sức chứa theo mảnh (chỉ để cảnh báo). Chỉ thêm (enum, cột cho
-- phép rỗng, bảng mới) - không ghi lại dữ liệu cũ. Công tắc PALLET_SON_ENABLED tắt thì không luồng nào ghi vào các bảng / cột này.

-- CreateEnum
CREATE TYPE "PalletStatus" AS ENUM ('EMPTY', 'LOADED', 'PAINTED', 'ON_SLIP');

-- AlterTable
ALTER TABLE "piece" ADD COLUMN     "palletCapacity" INTEGER;

-- CreateTable
CREATE TABLE "pallets" (
    "id" BIGSERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "qrToken" TEXT NOT NULL,
    "warehouseId" BIGINT NOT NULL,
    "status" "PalletStatus" NOT NULL DEFAULT 'EMPTY',
    "currentLoadId" BIGINT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pallet_loads" (
    "id" BIGSERIAL NOT NULL,
    "palletId" BIGINT NOT NULL,
    "productionInvoiceId" BIGINT NOT NULL,
    "productionOrderId" BIGINT NOT NULL,
    "pieceId" BIGINT NOT NULL,
    "qty" INTEGER NOT NULL,
    "loadedById" TEXT NOT NULL,
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paintedQty" INTEGER,
    "shortReason" TEXT,
    "paintedById" TEXT,
    "paintedAt" TIMESTAMP(3),
    "productionBatchId" BIGINT,
    "floorReportId" BIGINT,
    "issueSlipLineId" BIGINT,
    "clearedAt" TIMESTAMP(3),
    "clearedById" TEXT,
    "clearedReason" TEXT,

    CONSTRAINT "pallet_loads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pallets_code_key" ON "pallets"("code");

-- CreateIndex
CREATE UNIQUE INDEX "pallets_qrToken_key" ON "pallets"("qrToken");

-- CreateIndex
CREATE UNIQUE INDEX "pallets_currentLoadId_key" ON "pallets"("currentLoadId");

-- CreateIndex
CREATE INDEX "pallets_warehouseId_status_idx" ON "pallets"("warehouseId", "status");

-- CreateIndex
CREATE INDEX "pallet_loads_palletId_loadedAt_idx" ON "pallet_loads"("palletId", "loadedAt");

-- CreateIndex
CREATE INDEX "pallet_loads_productionOrderId_pieceId_idx" ON "pallet_loads"("productionOrderId", "pieceId");

-- CreateIndex
CREATE INDEX "pallet_loads_issueSlipLineId_idx" ON "pallet_loads"("issueSlipLineId");

-- AddForeignKey
ALTER TABLE "pallets" ADD CONSTRAINT "pallets_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pallets" ADD CONSTRAINT "pallets_currentLoadId_fkey" FOREIGN KEY ("currentLoadId") REFERENCES "pallet_loads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pallet_loads" ADD CONSTRAINT "pallet_loads_palletId_fkey" FOREIGN KEY ("palletId") REFERENCES "pallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pallet_loads" ADD CONSTRAINT "pallet_loads_productionInvoiceId_fkey" FOREIGN KEY ("productionInvoiceId") REFERENCES "production_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pallet_loads" ADD CONSTRAINT "pallet_loads_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pallet_loads" ADD CONSTRAINT "pallet_loads_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "piece"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pallet_loads" ADD CONSTRAINT "pallet_loads_productionBatchId_fkey" FOREIGN KEY ("productionBatchId") REFERENCES "production_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pallet_loads" ADD CONSTRAINT "pallet_loads_floorReportId_fkey" FOREIGN KEY ("floorReportId") REFERENCES "floor_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pallet_loads" ADD CONSTRAINT "pallet_loads_issueSlipLineId_fkey" FOREIGN KEY ("issueSlipLineId") REFERENCES "issue_slip_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Ràng buộc (service kiểm trước để trả 400 rõ ràng).
ALTER TABLE "piece" ADD CONSTRAINT "piece_pallet_capacity_chk" CHECK ("palletCapacity" IS NULL OR "palletCapacity" > 0);

ALTER TABLE "pallets" ADD CONSTRAINT "pallets_code_chk" CHECK (length(btrim("code")) > 0);
-- Trống <=> không có lượt xếp đang nằm trên pallet.
ALTER TABLE "pallets" ADD CONSTRAINT "pallets_status_load_chk"
  CHECK (("status" = 'EMPTY') = ("currentLoadId" IS NULL));

ALTER TABLE "pallet_loads" ADD CONSTRAINT "pallet_loads_qty_chk" CHECK ("qty" > 0);
ALTER TABLE "pallet_loads" ADD CONSTRAINT "pallet_loads_painted_qty_chk"
  CHECK ("paintedQty" IS NULL OR ("paintedQty" > 0 AND "paintedQty" <= "qty"));
-- Đã sơn thì phải có người / lúc báo; báo thiếu thì phải có lý do.
ALTER TABLE "pallet_loads" ADD CONSTRAINT "pallet_loads_painted_chk"
  CHECK ("paintedQty" IS NULL OR ("paintedById" IS NOT NULL AND "paintedAt" IS NOT NULL));
ALTER TABLE "pallet_loads" ADD CONSTRAINT "pallet_loads_short_reason_chk"
  CHECK ("paintedQty" IS NULL OR "paintedQty" = "qty" OR length(btrim(coalesce("shortReason", ''))) >= 3);
-- Chỉ pallet đã sơn mới lên phiếu xuất đan.
ALTER TABLE "pallet_loads" ADD CONSTRAINT "pallet_loads_slip_painted_chk"
  CHECK ("issueSlipLineId" IS NULL OR "paintedQty" IS NOT NULL);
ALTER TABLE "pallet_loads" ADD CONSTRAINT "pallet_loads_cleared_chk"
  CHECK ("clearedAt" IS NULL OR ("clearedReason" IN ('ISSUED', 'UNLOADED') AND "clearedById" IS NOT NULL));

-- Mỗi pallet tối đa 1 lượt xếp chưa giải phóng.
CREATE UNIQUE INDEX "pallet_loads_one_open_per_pallet" ON "pallet_loads"("palletId") WHERE "clearedAt" IS NULL;
