-- Điều phối đan (phát hiện 28/11/2026): vai WEAVING_COORDINATOR (roles.constant.ts, 25/11) và quyền của vai
-- (role-permissions.constant.ts) chỉ được tạo khi chạy seed -> DB chung chưa có, bật DIEU_PHOI_DAN_ENABLED thì không gán được
-- tài khoản Điều phối đan. Migration CHỈ DỮ LIỆU, không đổi schema, chạy lại nhiều lần không thêm gì (name unique, khoá chính
-- (roleId, permissionId), ON CONFLICT DO NOTHING). Cùng bộ quyền seed sẽ đồng bộ: NOTIFICATION:VIEW (mọi vai nghiệp vụ),
-- WEAVING_ISSUE:VIEW, WEAVING_POINT: cả 5 quyền.
INSERT INTO "roles" ("id", "name", "description", "updatedAt")
VALUES (gen_random_uuid()::text, 'WEAVING_COORDINATOR', 'Business role: WEAVING_COORDINATOR', CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "permissions" ("id", "module", "action")
VALUES
  (gen_random_uuid()::text, 'NOTIFICATION', 'VIEW'),
  (gen_random_uuid()::text, 'WEAVING_ISSUE', 'VIEW'),
  (gen_random_uuid()::text, 'WEAVING_POINT', 'VIEW'),
  (gen_random_uuid()::text, 'WEAVING_POINT', 'CREATE'),
  (gen_random_uuid()::text, 'WEAVING_POINT', 'UPDATE'),
  (gen_random_uuid()::text, 'WEAVING_POINT', 'DELETE'),
  (gen_random_uuid()::text, 'WEAVING_POINT', 'APPROVE')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" AS r
JOIN "permissions" AS p
  ON (p."module" = 'NOTIFICATION' AND p."action" = 'VIEW')
  OR (p."module" = 'WEAVING_ISSUE' AND p."action" = 'VIEW')
  OR p."module" = 'WEAVING_POINT'
WHERE r."name" = 'WEAVING_COORDINATOR' AND r."deletedAt" IS NULL
ON CONFLICT DO NOTHING;
