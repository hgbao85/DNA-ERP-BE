-- KCS xem lenh xuong (Sang bao 23/11/2026): role-permissions.constant.ts da cap PRODUCTION_ORDER:VIEW cho KCS_STAFF tu
-- 10/11 (commit 3368dc5, thanh "lenh dang tam dung" FloorStoppedBanner goi GET /production-orders) nhung quyen trong DB chi
-- dong bo khi chay seed -> DB dev chua co, tai khoan KCS bi 403. Migration CHI DU LIEU, khong doi schema, chay lai nhieu
-- lan khong doi them gi (khoa chinh (roleId, permissionId) + ON CONFLICT DO NOTHING).
-- Dong permissions PRODUCTION_ORDER:VIEW da co vi QLSX / Sep duoc cap; neu chua co thi tao truoc (id uuid do Prisma sinh -> tu sinh o day).
INSERT INTO "permissions" ("id", "module", "action")
VALUES (gen_random_uuid()::text, 'PRODUCTION_ORDER', 'VIEW')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" AS r
JOIN "permissions" AS p ON p."module" = 'PRODUCTION_ORDER' AND p."action" = 'VIEW'
WHERE r."name" = 'KCS_STAFF' AND r."deletedAt" IS NULL
ON CONFLICT DO NOTHING;
