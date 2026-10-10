-- Khôi phục lại đúng lịch sử migration cho drift có sẵn từ trước (không liên quan đợt sửa
-- purchaseRoundUp hôm nay): "notifications"."updatedAt" được tạo kèm DEFAULT CURRENT_TIMESTAMP ở
-- migration 20260925000000_notification_recipients_and_types (cần cho bước backfill NOT NULL lúc
-- đó), nhưng DB dev thực tế đã bỏ default này từ lúc nào đó ngoài migration history (xác nhận qua
-- `prisma migrate dev` báo "Drift detected" khi thử thêm cột purchaseRoundUp). Model Prisma hiện
-- tại (`updatedAt DateTime @updatedAt`, không `@default`) khớp đúng trạng thái "không default" -
-- migration này chỉ ghi lại đúng sự thật đó vào lịch sử, KHÔNG đổi gì thêm trên DB (migration được
-- apply bằng `prisma migrate resolve --applied`, không chạy SQL thật vì DB đã ở đúng trạng thái
-- này rồi).
ALTER TABLE "notifications" ALTER COLUMN "updatedAt" DROP DEFAULT;
