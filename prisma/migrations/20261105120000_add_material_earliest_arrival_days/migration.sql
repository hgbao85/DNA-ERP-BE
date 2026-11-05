-- Phần A – Đợt 4 (YC6, 2026-11-05): số ngày được về sớm nhất trước hạn chót vật tư (mặc định 4) - Admin sửa ở Cấu hình hệ thống.
ALTER TABLE "system_config" ADD COLUMN "materialEarliestArrivalDays" INTEGER NOT NULL DEFAULT 4;
