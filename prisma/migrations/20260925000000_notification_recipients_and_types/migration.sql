-- Notification: fan-out theo người nhận + phân loại/mức độ, thay mô hình broadcast-4-audience.
-- Xem docs/changelog-2026-09-25-notification-review-va-plan.md (mục 5.1) cho bối cảnh đầy đủ.

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('ANNOUNCEMENT', 'ACTION_REQUIRED', 'RESULT', 'ALERT', 'INFO');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'CRITICAL');

-- AlterTable: audience trở thành optional (chỉ ANNOUNCEMENT còn dùng), thêm cột phân loại mới.
-- category mặc định ANNOUNCEMENT cho khớp dữ liệu cũ (mọi dòng hiện có đều là broadcast kiểu cũ);
-- UPDATE bên dưới sửa lại thành RESULT cho đúng 22 dòng do cutting-proposals tự phát (createdBy
-- NULL - xem CuttingProposalsService.notifyProductionManagers cũ).
ALTER TABLE "notifications"
  ALTER COLUMN "audience" DROP NOT NULL,
  ADD COLUMN "type" TEXT,
  ADD COLUMN "category" "NotificationCategory" NOT NULL DEFAULT 'ANNOUNCEMENT',
  ADD COLUMN "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
  ADD COLUMN "entityType" TEXT,
  ADD COLUMN "entityId" TEXT,
  ADD COLUMN "link" JSONB,
  ADD COLUMN "data" JSONB,
  ADD COLUMN "actorId" TEXT,
  ADD COLUMN "dedupeKey" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill: các dòng hiện có do cutting-proposals tự phát (createdBy NULL, không phải admin
-- broadcast) đổi sang category=RESULT/severity phù hợp nội dung - mirror đúng 3/4 biến thể cũ của
-- notifyProductionManagers (không phân biệt được biến thể nào trong dữ liệu lịch sử, xếp chung
-- RESULT/INFO cho an toàn; dữ liệu MỚI từ nay dùng NOTIFICATION_TYPES nên sẽ đúng ngay từ đầu).
UPDATE "notifications" SET "category" = 'RESULT' WHERE "createdBy" IS NULL;

-- CreateTable
CREATE TABLE "notification_recipients" (
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "notification_recipients_pkey" PRIMARY KEY ("notificationId","userId")
);

-- Data migration: fan-out mọi Notification cũ theo ĐÚNG luật audience cũ
-- (NotificationsService.getAudiencesForUser trước 2026-09-25) - ALL = mọi user active/chưa xoá,
-- 3 audience còn lại = user giữ role cùng tên (role_permissions/user_roles, xem prisma/seed.ts:
-- Role.name khớp 1-1 với 3 giá trị NotificationAudience đó). Copy readAt từ notification_reads cho
-- đúng user nếu có; user không có dòng notification_reads coi như chưa đọc (readAt NULL).
INSERT INTO "notification_recipients" ("notificationId", "userId", "createdAt", "readAt")
SELECT n."id", u."id", n."createdAt", nr."readAt"
FROM "notifications" n
JOIN "users" u ON (
  n."audience" = 'ALL'
  AND u."isActive" = true
  AND u."deletedAt" IS NULL
)
LEFT JOIN "notification_reads" nr ON nr."notificationId" = n."id" AND nr."userId" = u."id"
UNION
SELECT n."id", u."id", n."createdAt", nr."readAt"
FROM "notifications" n
JOIN "user_roles" ur ON true
JOIN "roles" r ON r."id" = ur."roleId" AND r."name" = n."audience"::TEXT
JOIN "users" u ON u."id" = ur."userId" AND u."isActive" = true AND u."deletedAt" IS NULL
LEFT JOIN "notification_reads" nr ON nr."notificationId" = n."id" AND nr."userId" = u."id"
WHERE n."audience" IN ('BOSS', 'WAREHOUSE_STAFF', 'PRODUCTION_MANAGER')
ON CONFLICT ("notificationId", "userId") DO NOTHING;

-- DropTable
DROP TABLE "notification_reads";

-- CreateIndex
CREATE INDEX "notifications_entityType_entityId_idx" ON "notifications"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "notifications_dedupeKey_idx" ON "notifications"("dedupeKey");

-- CreateIndex
CREATE INDEX "notification_recipients_userId_readAt_createdAt_idx" ON "notification_recipients"("userId", "readAt", "createdAt");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
