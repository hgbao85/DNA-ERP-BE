-- Đợt C3 (14/11/2026): máy cắt rảnh tự kéo lệnh kế tiếp.
-- Nhật ký chia máy có thêm hành động AUTO_PULL; dòng hàng đợi tổ do hệ thống tự thêm thì không có người xếp (queuedById null).

ALTER TYPE "CutAllocationLogAction" ADD VALUE 'AUTO_PULL';

ALTER TABLE "floor_queue_entries" ALTER COLUMN "queuedById" DROP NOT NULL;

-- Quan hệ tùy chọn: Prisma dùng ON DELETE SET NULL.
ALTER TABLE "floor_queue_entries" DROP CONSTRAINT "floor_queue_entries_queuedById_fkey";
ALTER TABLE "floor_queue_entries" ADD CONSTRAINT "floor_queue_entries_queuedById_fkey" FOREIGN KEY ("queuedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
