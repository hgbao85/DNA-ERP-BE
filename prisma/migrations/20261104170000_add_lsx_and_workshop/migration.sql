-- Phần A – Đợt 2 (V3-1, YC12 phần chọn, 2026-11-04): số LSX nhà máy cho từng dòng SKU + xưởng cơ khí.
-- Chỉ THÊM bảng/cột mới; dữ liệu cũ: dòng đang chờ Sếp / đã duyệt được gán mặc định Xưởng Phú An (người dùng chốt Q4 04/11),
-- QLSX đổi được khi lệnh chưa xuất sắt.

-- CreateEnum
CREATE TYPE "WorkshopCapacityMode" AS ENUM ('CONT_PER_DAY', 'DAYS_PER_CONT');

-- CreateTable
CREATE TABLE "workshops" (
    "id" BIGSERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacityMode" "WorkshopCapacityMode" NOT NULL,
    "paintWorkshopId" BIGINT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workshops_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workshops_code_key" ON "workshops"("code");

-- AddForeignKey
ALTER TABLE "workshops" ADD CONSTRAINT "workshops_paintWorkshopId_fkey" FOREIGN KEY ("paintWorkshopId") REFERENCES "workshops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2 xưởng có sẵn (production có ngay sau migrate deploy, không cần seed). Phước An sơn ở Phú An.
INSERT INTO "workshops" ("code", "name", "capacityMode", "sortOrder", "updatedAt")
VALUES ('PHU_AN', 'Xưởng Phú An', 'CONT_PER_DAY', 1, CURRENT_TIMESTAMP);
INSERT INTO "workshops" ("code", "name", "capacityMode", "paintWorkshopId", "sortOrder", "updatedAt")
SELECT 'PHUOC_AN', 'Xưởng Phước An', 'DAYS_PER_CONT', "id", 2, CURRENT_TIMESTAMP FROM "workshops" WHERE "code" = 'PHU_AN';

-- AlterTable
ALTER TABLE "production_invoice_items" ADD COLUMN     "lsxCode" TEXT,
ADD COLUMN     "workshopId" BIGINT;

-- CreateIndex
CREATE UNIQUE INDEX "production_invoice_items_lsxCode_key" ON "production_invoice_items"("lsxCode");

-- CreateIndex
CREATE INDEX "production_invoice_items_workshopId_idx" ON "production_invoice_items"("workshopId");

-- AddForeignKey
ALTER TABLE "production_invoice_items" ADD CONSTRAINT "production_invoice_items_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "workshops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Dòng đã qua QLSX (chờ Sếp / đã duyệt) trước khi có xưởng -> mặc định Xưởng Phú An.
UPDATE "production_invoice_items"
SET "workshopId" = (SELECT "id" FROM "workshops" WHERE "code" = 'PHU_AN')
WHERE "prodApprovalStatus" IN ('WAITING_BOSS', 'APPROVED') AND "workshopId" IS NULL;

-- AlterTable
ALTER TABLE "system_config" ADD COLUMN     "lsxPrefixes" TEXT[] DEFAULT ARRAY[]::TEXT[];
