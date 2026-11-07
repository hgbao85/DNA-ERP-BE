-- Đợt 7: 1 tài khoản giữ nhiều kho (đổi "kho đang làm" không phải đăng xuất). Chỉ thêm cột.
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "warehouseScopes" TEXT[] DEFAULT ARRAY[]::TEXT[];
