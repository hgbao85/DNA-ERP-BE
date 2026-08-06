-- AlterTable
ALTER TABLE "system_config" ALTER COLUMN "solverLengthStepMm" SET DEFAULT 10,
ALTER COLUMN "solverMaxLengthMm" SET DEFAULT 6000,
ALTER COLUMN "solverMinLengthMm" SET DEFAULT 5000;

-- DataMigration: SET DEFAULT chỉ áp cho hàng mới - dòng singleton (id=1) đã seed từ trước cần
-- cập nhật thủ công để phản ánh đúng dải dò 5000-6000 bước 10mm (yêu cầu nghiệp vụ 2026-08-06).
UPDATE "system_config" SET "solverMinLengthMm" = 5000, "solverMaxLengthMm" = 6000, "solverLengthStepMm" = 10 WHERE id = 1;
