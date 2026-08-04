-- AlterTable
-- Đã xác nhận trước khi chạy: SELECT count(*) FROM materials = 0 trên DB dùng chung, nên
-- DROP COLUMN "kind" không mất dữ liệu. Phân loại vật tư chuyển hoàn toàn sang
-- material_groups.systemKey (seed 6 nhóm cố định, xem prisma/seed.ts) - "name" vẫn đổi tự
-- do được vì logic nghiệp vụ không còn match theo tên nữa.
DROP INDEX "materials_kind_idx";
ALTER TABLE "materials" DROP COLUMN "kind";
DROP TYPE "MaterialKind";

-- AlterTable
ALTER TABLE "material_groups" ADD COLUMN "systemKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "material_groups_systemKey_key" ON "material_groups"("systemKey");
