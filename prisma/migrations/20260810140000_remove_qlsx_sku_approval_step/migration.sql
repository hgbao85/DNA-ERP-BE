-- Bỏ bước QLSX duyệt cục bộ khỏi pipeline duyệt SKU (PlanForm): KHSX duyệt xong -> Sếp duyệt
-- thẳng, không qua QLSX nữa.

-- 1. Đẩy các SKU đang chờ QLSX duyệt (nếu có) thẳng sang chờ Sếp duyệt, để không có bản ghi
--    nào bị "mắc kẹt" ở 1 trạng thái sắp bị xoá khỏi enum.
UPDATE "plan_forms" SET "status" = 'WAITING_BOSS_APPROVAL' WHERE "status" = 'WAITING_QLSX_APPROVAL';

-- 2. Postgres không cho xoá trực tiếp 1 giá trị enum - recreate lại type không có
--    WAITING_QLSX_APPROVAL rồi swap cột "status" sang type mới.
ALTER TYPE "PlanFormStatus" RENAME TO "PlanFormStatus_old";

CREATE TYPE "PlanFormStatus" AS ENUM ('WAITING_PARTS', 'APPROVED_PARTS', 'WAITING_DETAIL', 'APPROVED_DETAIL', 'WAITING_BOSS_APPROVAL', 'APPROVED');

ALTER TABLE "plan_forms" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "plan_forms" ALTER COLUMN "status" TYPE "PlanFormStatus" USING ("status"::text::"PlanFormStatus");
ALTER TABLE "plan_forms" ALTER COLUMN "status" SET DEFAULT 'WAITING_PARTS';

DROP TYPE "PlanFormStatus_old";

-- 3. qlsxReviewedAt chỉ phục vụ bước QLSX duyệt cục bộ đã bỏ - không còn nơi nào ghi/đọc cột này.
ALTER TABLE "plan_forms" DROP COLUMN "qlsxReviewedAt";
