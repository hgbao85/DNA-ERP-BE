-- KCS tu chuyen (P1, 18/11/2026): KCS_STAFF duoc xem cac dot dang mo (GET /floor/review) va nhan realtime phong 'floor'.
-- Migration CHI DU LIEU, khong doi schema. Ca 2 cau chay lai nhieu lan khong doi them gi.
-- role-permissions.constant.ts phai nam cung commit voi file nay (seed dong bo quyen bang cach xoa dong thua).

-- (1) Cap FLOOR_REPORT:VIEW cho vai KCS_STAFF. Khoa chinh la (roleId, permissionId) nen ON CONFLICT DO NOTHING chay lai duoc.
-- Dong permissions FLOOR_REPORT:VIEW da co vi QLSX duoc cap ALL; neu chua co thi cau nay khong chen gi.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" AS r
JOIN "permissions" AS p ON p."module" = 'FLOOR_REPORT' AND p."action" = 'VIEW'
WHERE r."name" = 'KCS_STAFF' AND r."deletedAt" IS NULL
ON CONFLICT DO NOTHING;

-- (2) Tin FLOOR_BATCH_STALE ("cho gui KCS qua lau") da ngung phat tu P1: dong cac dong tin con mo.
UPDATE "notification_recipients" AS nr
SET "resolvedAt" = CURRENT_TIMESTAMP
FROM "notifications" AS n
WHERE n."id" = nr."notificationId"
  AND n."type" = 'FLOOR_BATCH_STALE'
  AND nr."resolvedAt" IS NULL;
