-- Phần A - Đợt 1 (YC9): thùng + load cont của SKU. Cột mới, nullable/có default - không đụng dữ liệu cũ.
ALTER TABLE "mfg_products"
  ADD COLUMN "boxLengthCm" DECIMAL(7,1),
  ADD COLUMN "boxWidthCm" DECIMAL(7,1),
  ADD COLUMN "boxHeightCm" DECIMAL(7,1),
  ADD COLUMN "boxesPerSet" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "loadContManual" INTEGER,
  ADD COLUMN "boxVolumeM3" DECIMAL(10,4),
  ADD COLUMN "loadContFormula" INTEGER,
  ADD COLUMN "loadCont" INTEGER,
  ADD COLUMN "containerLoadUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "containerLoadUpdatedById" TEXT;

ALTER TABLE "system_config" ADD COLUMN "containerVolumeM3" DECIMAL(6,2) NOT NULL DEFAULT 68;
