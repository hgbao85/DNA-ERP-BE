-- Mạng công ty được phép đăng nhập (công nhân) - 2026-10-13. Thêm cột mảng, mặc định rỗng = không giới hạn.
-- AlterTable
ALTER TABLE "system_config" ADD COLUMN     "floorAllowedIps" TEXT[] DEFAULT ARRAY[]::TEXT[];

