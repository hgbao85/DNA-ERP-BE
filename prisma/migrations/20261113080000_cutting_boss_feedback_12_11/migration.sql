-- Toi uu cat sat theo gop y cua Sep Nhan 12/11/2026 (da chot 4 cau hoi):
--  - MC Tu dong: te dau luon 10 mm (truoc 0).
--  - Khung gop moc can sat: 5 ngay tinh ca 2 dau = cach nhau toi da 4 ngay (truoc 3).
--  - Dai do cay dat rieng: 4000..6500 mm (truoc 5000..6000).
--  - So co doan toi da tren 1 cay theo xuong: Phuoc An = 2 (khoa = workshops.code).
--  - Dong loai sat: ghi chu khi phai noi so co doan/cay.
-- Cac gia tri duoi la Sep chot nen cap nhat ca dong cau hinh dang dung, khong chi doi mac dinh.

-- AlterTable
ALTER TABLE "system_config"
  ALTER COLUMN "solverMctdTrimStartMm" SET DEFAULT 10,
  ALTER COLUMN "solverMergeWindowDays" SET DEFAULT 5,
  ALTER COLUMN "solverMinLengthMm" SET DEFAULT 4000,
  ALTER COLUMN "solverMaxLengthMm" SET DEFAULT 6500,
  ADD COLUMN "solverMaxSizesPerBarByWorkshop" JSONB NOT NULL DEFAULT '{"PHUOC_AN":2}';

UPDATE "system_config"
SET "solverMctdTrimStartMm" = 10,
    "solverMergeWindowDays" = 5,
    "solverMinLengthMm" = 4000,
    "solverMaxLengthMm" = 6500;

-- AlterTable
ALTER TABLE "cutting_proposal_lines" ADD COLUMN "sizesRelaxNote" TEXT;
