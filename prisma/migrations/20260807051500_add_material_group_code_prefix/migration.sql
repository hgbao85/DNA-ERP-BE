-- Viết tay (không phải prisma migrate dev) để backfill xong rồi mới SET NOT NULL trong
-- cùng 1 lượt, tránh prompt "provide a default value" tương tác của migrate dev trên bảng
-- đã có dữ liệu (8 nhóm hệ thống). Xem material-group-code-prefix.constant.ts cho giá trị gốc.

-- AlterTable: thêm cột nullable trước để backfill được các dòng đã có
ALTER TABLE "material_groups" ADD COLUMN "codePrefix" TEXT;

-- Backfill 8 nhóm hệ thống theo systemKey (không theo name - admin có thể đã đổi tên hiển thị)
UPDATE "material_groups" SET "codePrefix" = 'SAT' WHERE "systemKey" = 'STEEL_BAR';
UPDATE "material_groups" SET "codePrefix" = 'DAY' WHERE "systemKey" = 'WIRE';
UPDATE "material_groups" SET "codePrefix" = 'DINH' WHERE "systemKey" = 'NAIL';
UPDATE "material_groups" SET "codePrefix" = 'SON' WHERE "systemKey" = 'PAINT';
UPDATE "material_groups" SET "codePrefix" = 'PK' WHERE "systemKey" = 'ACCESSORY';
UPDATE "material_groups" SET "codePrefix" = 'BB' WHERE "systemKey" = 'PACKAGING';
UPDATE "material_groups" SET "codePrefix" = 'TR' WHERE "systemKey" = 'RIVET';
UPDATE "material_groups" SET "codePrefix" = 'NN' WHERE "systemKey" = 'PLASTIC_BUTTON';

-- An toàn cho nhóm admin tự tạo đã tồn tại từ trước (systemKey NULL) mà chưa có prefix -
-- backfill tạm 1 giá trị duy nhất theo id để SET NOT NULL không vỡ; đi tới sẽ luôn có giá trị
-- thật do CreateMaterialGroupDto bắt buộc nhập.
UPDATE "material_groups" SET "codePrefix" = 'GRP' || id::text WHERE "codePrefix" IS NULL;

ALTER TABLE "material_groups" ALTER COLUMN "codePrefix" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "material_groups_codePrefix_key" ON "material_groups"("codePrefix");
