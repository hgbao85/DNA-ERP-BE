-- Huỷ lệnh đợt 2 - Q5/Q6 (anh Nhân 24/11/2026): KHSX chuyển hàng đã đóng gói / khung đã đan của SKU đã huỷ sang SKU khác đang chạy.
-- Chỉ thêm bảng / cột, không đổi dữ liệu cũ.

-- CreateEnum
CREATE TYPE "CancelledGoodsKind" AS ENUM ('PACKED', 'WOVEN');

-- AlterTable
ALTER TABLE "packaging_records" ADD COLUMN     "transferId" BIGINT;

-- CreateTable
CREATE TABLE "cancelled_goods_transfers" (
    "id" BIGSERIAL NOT NULL,
    "cancelRequestId" BIGINT NOT NULL,
    "kind" "CancelledGoodsKind" NOT NULL,
    "sourceItemId" BIGINT NOT NULL,
    "targetItemId" BIGINT NOT NULL,
    "pieceId" BIGINT,
    "qty" INTEGER NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cancelled_goods_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cancelled_goods_transfers_sourceItemId_kind_idx" ON "cancelled_goods_transfers"("sourceItemId", "kind");

-- CreateIndex
CREATE INDEX "cancelled_goods_transfers_targetItemId_kind_idx" ON "cancelled_goods_transfers"("targetItemId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "packaging_records_transferId_key" ON "packaging_records"("transferId");

-- AddForeignKey
ALTER TABLE "packaging_records" ADD CONSTRAINT "packaging_records_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "cancelled_goods_transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancelled_goods_transfers" ADD CONSTRAINT "cancelled_goods_transfers_cancelRequestId_fkey" FOREIGN KEY ("cancelRequestId") REFERENCES "production_order_cancel_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

