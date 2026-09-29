-- Sửa sót của migration 20260925000000: backfill UPDATE ở đó chỉ đổi `category` sang RESULT cho
-- 21 dòng do cutting-proposals tự phát (createdBy NULL) nhưng QUÊN null luôn `audience` cũ
-- (PRODUCTION_MANAGER) - vi phạm đúng bất biến tự đặt "audience chỉ có giá trị khi
-- category=ANNOUNCEMENT" (xem doc comment Notification.audience trong schema.prisma). Phát hiện
-- bằng live-test thật trên DB dev (docs/changelog-2026-09-25-notification-review-va-plan.md mục
-- 11 phần kiểm thử Phase 2) - không sửa lại migration cũ đã apply (đổi checksum migration đã chạy
-- là thực hành xấu), thêm migration mới để dọn nốt.
UPDATE "notifications" SET "audience" = NULL WHERE "category" != 'ANNOUNCEMENT';
