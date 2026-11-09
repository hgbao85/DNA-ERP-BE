-- Đợt 10b: kho thành phẩm xác nhận xuất hàng theo booking (phiếu XK + ảnh ký). Chỉ thêm cột.
-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "shipKey" TEXT,
ADD COLUMN     "shipSlipCode" TEXT,
ADD COLUMN     "shipSlipUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "shippedAt" TIMESTAMP(3),
ADD COLUMN     "shippedById" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "bookings_shipSlipCode_key" ON "bookings"("shipSlipCode");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_shipKey_key" ON "bookings"("shipKey");

