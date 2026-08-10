-- Sơn/Phụ kiện/Bao bì dùng chung 1 nhóm vật tư hệ thống "Vật tư khác" (OTHER, xem migration
-- 20260810092552) nên không còn phân biệt được vật tư nào dùng cho tab nào qua nhóm vật tư
-- nữa. Thêm "detailKind" ngay trên Material để phân loại - chỉ có ý nghĩa với vật tư thuộc
-- nhóm OTHER, null với mọi nhóm khác. Nullable (không backfill được, đây là lựa chọn nghiệp
-- vụ của admin) - vật tư nào chưa gán sẽ vô hình ở cả 3 tab cho tới khi được gán ở Admin >
-- Vật tư.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "MaterialDetailKind" AS ENUM ('PAINT', 'ACCESSORY', 'PACKAGING');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "detailKind" "MaterialDetailKind";
