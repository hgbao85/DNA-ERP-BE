/*
  Tạo bằng tay (prisma migrate dev từ chối chạy non-interactive vì DB dev có 2 dòng materials còn
  giá trị purchaseUnit/khoUnitFactor - xem tiền lệ migration 20260819025542_segment_spec_and_waste_
  fields_decimal). Business xác nhận (chat Trương Văn Nhân/Gia Bảo, 2026-10-16): hệ số quy đổi cố
  định theo vật tư là SAI vì thực tế đổi theo từng lô/NCC - 2 cột này là metadata chết (không luồng
  buyQty/demand nào đọc), chấp nhận mất 2 giá trị cũ. Thay bằng PurchaseReceiptLog: 1 dòng/1 lần
  nhận hàng, Ô1 (unitRateQty) × Ô2 (supplierUnitQty) nhập tay mỗi lô.

  Warnings:

  - You are about to drop the column `khoUnitFactor` on the `materials` table. All the data in the column will be lost.
  - You are about to drop the column `purchaseUnit` on the `materials` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "materials" DROP COLUMN "khoUnitFactor";
ALTER TABLE "materials" DROP COLUMN "purchaseUnit";

-- CreateTable
CREATE TABLE "purchase_receipt_logs" (
    "id" BIGSERIAL NOT NULL,
    "itemId" BIGINT NOT NULL,
    "unitRateQty" DECIMAL(14,4) NOT NULL,
    "supplierUnitQty" DECIMAL(14,4) NOT NULL DEFAULT 1,
    "receivedQty" DECIMAL(14,4) NOT NULL,
    "receiptFileUrl" TEXT,
    "receivedById" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_receipt_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_receipt_logs_itemId_idx" ON "purchase_receipt_logs"("itemId");

-- AddForeignKey
ALTER TABLE "purchase_receipt_logs" ADD CONSTRAINT "purchase_receipt_logs_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "purchase_proposal_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipt_logs" ADD CONSTRAINT "purchase_receipt_logs_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
