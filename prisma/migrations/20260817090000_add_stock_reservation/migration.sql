-- Đợt 1 của thiết kế B4 (tách "đặt giữ" khỏi "tiêu hao"), xem
-- docs/changelog-2026-08-15-nhip-2-gop-sku-va-review-auto-duyet.md mục 13.
-- Thuần THÊM MỚI: 1 enum + 1 bảng, không đụng bảng/cột nào đang có, không cần backfill.
-- Chưa luồng nghiệp vụ nào ghi vào bảng này (Đợt 2 mới nối) - deploy trước để migration đi riêng,
-- tách khỏi đợt đổi hành vi.

-- CreateEnum
CREATE TYPE "StockReservationRefType" AS ENUM ('CUTTING_PROPOSAL', 'PURCHASE_PROPOSAL');

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" BIGSERIAL NOT NULL,
    "warehouseId" BIGINT NOT NULL,
    "materialId" BIGINT NOT NULL,
    "quantity" DECIMAL(16,4) NOT NULL,
    "consumedQty" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "refType" "StockReservationRefType" NOT NULL,
    "refId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_reservations_idempotencyKey_key" ON "stock_reservations"("idempotencyKey");

-- CreateIndex
CREATE INDEX "stock_reservations_warehouseId_materialId_status_idx" ON "stock_reservations"("warehouseId", "materialId", "status");

-- CreateIndex
CREATE INDEX "stock_reservations_refType_refId_idx" ON "stock_reservations"("refType", "refId");

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
