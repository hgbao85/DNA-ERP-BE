-- May laze: nhat cat cuoi phai ra 1 doan dai hon N mm, tinh ca phan cui (Sep chot 13/11/2026 cau 11, mac dinh 100 mm = 10 cm).
-- Kieu cat laze chi hop le khi doan dai nhat tren cay + cui > N. 0 = tat.

-- AlterTable
ALTER TABLE "system_config" ADD COLUMN "solverLaserMinTailMm" INTEGER NOT NULL DEFAULT 100;
