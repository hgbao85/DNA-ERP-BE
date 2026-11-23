-- Tin KCS_BATCH_STALE chi gui KCS tu 23/11/2026 (QLSX khong con man xem dot cho KCS): dong cac dong tin con mo cua nguoi nhan la QLSX.
-- Khong dung toi nguoi nhan la KCS. Chay lai nhieu lan khong doi them gi.
UPDATE "notification_recipients" AS nr
SET "resolvedAt" = CURRENT_TIMESTAMP
FROM "notifications" AS n
WHERE n."id" = nr."notificationId"
  AND n."type" = 'KCS_BATCH_STALE'
  AND nr."resolvedAt" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "user_roles" AS ur
    JOIN "roles" AS r ON r."id" = ur."roleId"
    WHERE ur."userId" = nr."userId" AND r."name" = 'PRODUCTION_MANAGER'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "user_roles" AS ur2
    JOIN "roles" AS r2 ON r2."id" = ur2."roleId"
    WHERE ur2."userId" = nr."userId" AND r2."name" = 'KCS_STAFF'
  );
