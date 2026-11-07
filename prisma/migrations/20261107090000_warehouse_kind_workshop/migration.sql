-- Đợt 7 - chia 9 kho (bản v8 12.4, YC12): loại kho + xưởng sở hữu kho, tạo 4 kho mới của nhóm Phôi-Hàn-Sơn.
-- Chỉ THÊM: kho gốc 'phoi-son-han' giữ nguyên mã (đổi tên thành Kho Phôi Phú An); chuyển tồn vật tư Hàn/Sơn sang kho mới
-- làm bằng script prisma/split-warehouses.ts vào ngày kiểm kê, KHÔNG làm ở đây.

-- CreateEnum
CREATE TYPE "WarehouseKind" AS ENUM ('PHOI', 'HAN', 'SON', 'PHU_KIEN', 'THANH_PHAM');

-- AlterEnum
ALTER TYPE "StockLedgerRefType" ADD VALUE 'WAREHOUSE_SPLIT';

-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN     "kind" "WarehouseKind",
ADD COLUMN     "workshopId" BIGINT;

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_workshopId_kind_key" ON "warehouses"("workshopId", "kind");

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "workshops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Phân loại kho đang có
UPDATE "warehouses"
SET "kind" = 'PHOI',
    "workshopId" = (SELECT "id" FROM "workshops" WHERE "code" = 'PHU_AN'),
    "name" = 'Kho Phôi Phú An'
WHERE "code" = 'phoi-son-han';

UPDATE "warehouses" SET "kind" = 'PHU_KIEN', "name" = 'Kho Phụ kiện' WHERE "code" = 'vat-tu-tp';
UPDATE "warehouses" SET "kind" = 'PHU_KIEN' WHERE "code" LIKE 'vat-tu-tp-%' AND "isVirtual" = false;
UPDATE "warehouses" SET "kind" = 'THANH_PHAM'
WHERE ("code" = 'thanh-pham' OR "code" LIKE 'thanh-pham-%') AND "isVirtual" = false;

-- 4 kho mới (mã giữ tiền tố 'phoi-son-han-' để các kiểm tra theo nhóm kho cũ vẫn nhận ra)
INSERT INTO "warehouses" ("code", "name", "isVirtual", "isActive", "kind", "workshopId")
SELECT v.code, v.name, false, true, v.kind::"WarehouseKind", w."id"
FROM (VALUES
  ('phoi-son-han-han-pa',   'Kho Hàn Phú An',     'HAN',  'PHU_AN'),
  ('phoi-son-han-son-pa',   'Kho Sơn Phú An',     'SON',  'PHU_AN'),
  ('phoi-son-han-phoi-pha', 'Kho Phôi Phước An',  'PHOI', 'PHUOC_AN'),
  ('phoi-son-han-han-pha',  'Kho Hàn Phước An',   'HAN',  'PHUOC_AN')
) AS v(code, name, kind, workshop)
JOIN "workshops" w ON w."code" = v.workshop
ON CONFLICT ("code") DO NOTHING;
