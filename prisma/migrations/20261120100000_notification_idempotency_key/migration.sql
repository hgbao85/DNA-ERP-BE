-- 20/11/2026 (T1-9): khoá chống trùng cho thông báo chung. Cột tuỳ chọn, không đổi dữ liệu cũ.
ALTER TABLE "notifications" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "notifications_idempotencyKey_key" ON "notifications"("idempotencyKey");
