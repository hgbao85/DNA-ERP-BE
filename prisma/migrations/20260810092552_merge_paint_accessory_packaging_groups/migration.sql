-- Gộp 3 nhóm vật tư hệ thống PAINT/ACCESSORY/PACKAGING (Sơn/Phụ kiện/Bao bì) thành 1 nhóm
-- "Vật tư khác" (systemKey OTHER) duy nhất, đưa tổng số nhóm hệ thống từ 8 xuống 6 (Sắt/Dây/
-- Đinh/Tán rút/Nút nhựa/Vật tư khác). Sơn vẫn phân biệt được qua ConsumableBom.stage=SON (không
-- nhóm nào khác dùng stage này); Phụ kiện/Bao bì giờ phân biệt qua cột "kind" mới trên
-- bom_accessory_items thay vì qua nhóm vật tư của material.
--
-- Mọi bước dưới đây viết idempotent (IF NOT EXISTS / bắt duplicate_object / SET NOT NULL lặp
-- vô hại) vì trên connection pooled (pooled.db.prisma.io) từng statement tự commit riêng
-- (không gộp 1 transaction duy nhất cho cả file) - migration có thể cần chạy lại sau khi 1
-- statement giữa file lỗi (vd đụng unique constraint) mà các statement trước đó đã commit rồi.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "AccessoryItemKind" AS ENUM ('ACCESSORY', 'PACKAGING');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable: thêm cột "kind" trước ở dạng nullable để backfill được từ dữ liệu hiện có.
ALTER TABLE "bom_accessory_items" ADD COLUMN IF NOT EXISTS "kind" "AccessoryItemKind";

-- Backfill "kind" từ nhóm vật tư hiện tại của material trên mỗi dòng.
UPDATE "bom_accessory_items" AS bai
SET "kind" = 'ACCESSORY'
FROM "materials" AS m, "material_groups" AS mg
WHERE bai."materialId" = m."id"
  AND m."materialGroupId" = mg."id"
  AND mg."systemKey" = 'ACCESSORY';

UPDATE "bom_accessory_items" AS bai
SET "kind" = 'PACKAGING'
FROM "materials" AS m, "material_groups" AS mg
WHERE bai."materialId" = m."id"
  AND m."materialGroupId" = mg."id"
  AND mg."systemKey" = 'PACKAGING';

-- An toàn cho dữ liệu lệch chuẩn (material đã đổi nhóm thủ công trước khi có ràng buộc này) -
-- mặc định ACCESSORY để NOT NULL bên dưới không bao giờ làm fail deploy thật; vận hành có thể
-- sửa lại "kind" thủ công cho đúng nếu phát hiện dòng nào bị mặc định sai.
UPDATE "bom_accessory_items" SET "kind" = 'ACCESSORY' WHERE "kind" IS NULL;

ALTER TABLE "bom_accessory_items" ALTER COLUMN "kind" SET NOT NULL;

-- Gộp PAINT/ACCESSORY/PACKAGING vào 1 nhóm OTHER duy nhất. Một số môi trường (vd DB dev hiện
-- tại) đã có sẵn 1 nhóm "Vật tư khác" do admin tự tạo tay (systemKey NULL) và đã gán vật tư
-- thật vào đó rồi - ưu tiên PROMOTE đúng row đó lên thành nhóm hệ thống OTHER (giữ nguyên
-- id/tên/codePrefix, không tạo nhóm trùng tên "Vật tư khác" gây vỡ unique constraint trên
-- `name`). Nếu chưa có sẵn (môi trường khác) thì tái sử dụng row PAINT làm nhóm OTHER mới.
-- Bọc trong điều kiện "chưa có nhóm OTHER" để chạy lại migration này (sau khi phần trên đã
-- commit ở lần chạy trước) không bị lỗi update 0 row / xoá nhầm nhóm đã promote.
DO $$
DECLARE
  other_id BIGINT;
BEGIN
  SELECT id INTO other_id FROM "material_groups" WHERE "systemKey" = 'OTHER';

  IF other_id IS NULL THEN
    SELECT id INTO other_id FROM "material_groups"
    WHERE "name" = 'Vật tư khác' AND "systemKey" IS NULL;

    IF other_id IS NOT NULL THEN
      UPDATE "material_groups" SET "systemKey" = 'OTHER' WHERE id = other_id;
    ELSE
      UPDATE "material_groups"
      SET "systemKey" = 'OTHER', "name" = 'Vật tư khác', "codePrefix" = 'VTK'
      WHERE "systemKey" = 'PAINT'
      RETURNING id INTO other_id;
    END IF;
  END IF;

  -- Chuyển toàn bộ material đang thuộc ACCESSORY/PACKAGING (và PAINT, nếu row đó không phải
  -- chính row vừa promote ở nhánh trên) sang nhóm OTHER vừa gộp.
  UPDATE "materials"
  SET "materialGroupId" = other_id
  WHERE "materialGroupId" IN (
    SELECT id FROM "material_groups" WHERE "systemKey" IN ('PAINT', 'ACCESSORY', 'PACKAGING')
  );

  -- Xoá các nhóm hệ thống không còn dùng (row vừa promote đã đổi systemKey nên không bị xoá
  -- nhầm ở đây).
  DELETE FROM "material_groups" WHERE "systemKey" IN ('PAINT', 'ACCESSORY', 'PACKAGING');
END $$;
