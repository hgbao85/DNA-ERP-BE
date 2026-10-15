-- Công nhân tự đặt PIN lần đầu + khoá tạm sau 5 lần sai (2026-10-13). Chỉ THÊM cột có mặc định/NULL.
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "pinClaimExpiresAt" TIMESTAMP(3),
ADD COLUMN     "pinPending" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pinSetAt" TIMESTAMP(3);

