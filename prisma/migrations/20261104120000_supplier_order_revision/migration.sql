-- THAY PHIẾU đơn đặt hàng NCC (bản v8 mục 7.2, 7.11) - 2026-11-04. Chỉ THÊM cột.

-- AlterTable
ALTER TABLE "supplier_orders" ADD COLUMN     "reviseReason" TEXT,
ADD COLUMN     "revisedAt" TIMESTAMP(3),
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

