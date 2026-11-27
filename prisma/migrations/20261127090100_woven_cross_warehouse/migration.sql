-- Nhân trả lời 26/11 câu 1: khung đã đan của SKU huỷ - lệnh xưởng nào cũng lấy được (không giới hạn cùng kho thành phẩm); lấy khác
-- kho thì phải có phiếu chuyển giữa 2 xưởng. Dòng lấy khác kho: receiveStatus PENDING tới khi thủ kho thành phẩm nơi nhận xác nhận
-- (kèm ảnh phiếu đã ký) -> RECEIVED. Cùng kho (và mọi dòng cũ): NULL = không cần chuyển.
-- Thuần cộng thêm: enum mới + 6 cột, không đổi dữ liệu.

-- CreateEnum
CREATE TYPE "CancelledGoodsReceiveStatus" AS ENUM ('PENDING', 'RECEIVED');

-- AlterTable
ALTER TABLE "cancelled_goods_transfers" ADD COLUMN "fromWarehouseCode" TEXT;
ALTER TABLE "cancelled_goods_transfers" ADD COLUMN "toWarehouseCode" TEXT;
ALTER TABLE "cancelled_goods_transfers" ADD COLUMN "receiveStatus" "CancelledGoodsReceiveStatus";
ALTER TABLE "cancelled_goods_transfers" ADD COLUMN "receivedById" TEXT;
ALTER TABLE "cancelled_goods_transfers" ADD COLUMN "receivedAt" TIMESTAMP(3);
ALTER TABLE "cancelled_goods_transfers" ADD COLUMN "signedSlipUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "cancelled_goods_transfers_receiveStatus_toWarehouseCode_idx" ON "cancelled_goods_transfers"("receiveStatus", "toWarehouseCode");
