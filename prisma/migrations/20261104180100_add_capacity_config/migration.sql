-- Phần A – Đợt 3 (YC10 10.12, 10.16, 2026-11-04): năng lực chỉ để cảnh báo - Admin sửa ở Cấu hình hệ thống.
-- capacityContPerDay: cont/ngày của xưởng Phú An và mỗi kho đóng gói (mặc định 1,3). daysPerContPhuocAn: số ngày/cont ở Phôi, Hàn
-- của xưởng Phước An (mặc định 4).
ALTER TABLE "system_config" ADD COLUMN "capacityContPerDay" DECIMAL(4,2) NOT NULL DEFAULT 1.3;
ALTER TABLE "system_config" ADD COLUMN "daysPerContPhuocAn" INTEGER NOT NULL DEFAULT 4;
