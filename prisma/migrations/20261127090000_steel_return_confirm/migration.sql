-- Nhân trả lời 26/11 câu 2: sắt tổ cắt trả về kho Phôi khi ngưng cắt SKU đã huỷ phải có thủ kho Phôi xác nhận số cây (QLSX bấm
-- chưa đủ). Dòng cũ đã ghi sổ kho lúc QLSX bấm -> CONFIRMED; dòng mới PENDING tới khi thủ kho xác nhận (lúc đó mới ghi sổ).
-- Thuần cộng thêm: enum mới + 4 cột, không đổi dữ liệu khác.

-- CreateEnum
CREATE TYPE "SteelReturnStatus" AS ENUM ('PENDING', 'CONFIRMED');

-- AlterTable
ALTER TABLE "steel_returns" ADD COLUMN "status" "SteelReturnStatus" NOT NULL DEFAULT 'CONFIRMED';
ALTER TABLE "steel_returns" ALTER COLUMN "status" SET DEFAULT 'PENDING';
ALTER TABLE "steel_returns" ADD COLUMN "confirmedBars" INTEGER;
ALTER TABLE "steel_returns" ADD COLUMN "confirmedById" TEXT;
ALTER TABLE "steel_returns" ADD COLUMN "confirmedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "steel_returns_warehouseId_status_idx" ON "steel_returns"("warehouseId", "status");
