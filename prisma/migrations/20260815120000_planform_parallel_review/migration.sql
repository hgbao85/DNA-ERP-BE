-- Cho duyệt định mức mảnh và định mức chi tiết (PlanForm) tiến độc lập, song song - không còn
-- bắt buộc mảnh phải xong mới được nhập/duyệt chi tiết. Trước đây thứ tự này được mã hoá bằng vị
-- trí tuyến tính của PlanFormStatus (WAITING_PARTS -> APPROVED_PARTS -> WAITING_DETAIL ->
-- APPROVED_DETAIL); nay 2 nhánh có mốc "đã forward" riêng, status chỉ còn 3 giá trị tổng quát.

-- 1. Thêm 2 cột mốc "KHSX đã chốt xong nhánh này chưa" - null = chưa.
ALTER TABLE "plan_forms" ADD COLUMN "manhForwardedAt" TIMESTAMP(3);
ALTER TABLE "plan_forms" ADD COLUMN "detailForwardedAt" TIMESTAMP(3);

-- 2. Backfill cho các PlanForm đang dở dang: đọc status CŨ (trước khi enum bị đổi ở bước 3) để suy
--    ra nhánh nào KHSX đã từng forward xong. Dùng updatedAt làm mốc gần đúng thay vì NULL, để
--    những SKU đang ở giữa pipeline không bị coi như "chưa forward gì" (mất tiến độ thật).
UPDATE "plan_forms" SET "manhForwardedAt" = "updatedAt"
  WHERE "status" IN ('WAITING_DETAIL', 'APPROVED_DETAIL', 'WAITING_BOSS_APPROVAL', 'APPROVED');
UPDATE "plan_forms" SET "detailForwardedAt" = "updatedAt"
  WHERE "status" IN ('APPROVED_DETAIL', 'WAITING_BOSS_APPROVAL', 'APPROVED');

-- 3. Gộp 4 trạng thái trung gian (WAITING_PARTS/APPROVED_PARTS/WAITING_DETAIL/APPROVED_DETAIL)
--    thành 1 giá trị IN_PROGRESS duy nhất - Postgres không cho xoá/gộp giá trị enum trực tiếp nên
--    phải recreate type rồi swap cột "status" sang type mới qua USING + CASE mapping tay.
ALTER TYPE "PlanFormStatus" RENAME TO "PlanFormStatus_old";

CREATE TYPE "PlanFormStatus" AS ENUM ('IN_PROGRESS', 'WAITING_BOSS_APPROVAL', 'APPROVED');

ALTER TABLE "plan_forms" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "plan_forms" ALTER COLUMN "status" TYPE "PlanFormStatus" USING (
  CASE "status"::text
    WHEN 'WAITING_PARTS' THEN 'IN_PROGRESS'
    WHEN 'APPROVED_PARTS' THEN 'IN_PROGRESS'
    WHEN 'WAITING_DETAIL' THEN 'IN_PROGRESS'
    WHEN 'APPROVED_DETAIL' THEN 'IN_PROGRESS'
    ELSE "status"::text
  END
)::"PlanFormStatus";
ALTER TABLE "plan_forms" ALTER COLUMN "status" SET DEFAULT 'IN_PROGRESS';

DROP TYPE "PlanFormStatus_old";
