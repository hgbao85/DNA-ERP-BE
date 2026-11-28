-- Nghiệp vụ 28/11 (phương án a, lỗi 1 chạy thử huỷ lệnh): thủ kho Phôi đếm thiếu cây trả về thì phần chênh vẫn tính còn ở tổ cắt.
-- QLSX tìm thấy thì ghi trả thêm 1 dòng trỏ về dòng thiếu (makeupForId); không tìm thấy thì xác nhận mất (shortLost*).
-- Thuần cộng thêm 4 cột + 1 khoá ngoại + 1 index, không đổi dữ liệu cũ.

-- AlterTable
ALTER TABLE "steel_returns" ADD COLUMN "makeupForId" BIGINT;
ALTER TABLE "steel_returns" ADD COLUMN "shortLostAt" TIMESTAMP(3);
ALTER TABLE "steel_returns" ADD COLUMN "shortLostById" TEXT;
ALTER TABLE "steel_returns" ADD COLUMN "shortLostNote" TEXT;

-- CreateIndex
CREATE INDEX "steel_returns_makeupForId_idx" ON "steel_returns"("makeupForId");

-- AddForeignKey
ALTER TABLE "steel_returns" ADD CONSTRAINT "steel_returns_makeupForId_fkey" FOREIGN KEY ("makeupForId") REFERENCES "steel_returns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
