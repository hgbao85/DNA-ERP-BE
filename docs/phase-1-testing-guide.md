# Phase 1 — Hướng dẫn test (Mở rộng nền tảng)

Phạm vi: `User.mfgRole/phoiOperation/warehouseScope/isPurchaser/isProductPlanner/isSale`,
`@RequireMfgRole`/`@RequireWarehouseScope`, module `notifications`, module `system-config`,
12 role nghiệp vụ seed sẵn.

## 1. Test tự động

```bash
pnpm test              # jest — 6 suites / 27 tests, gồm mfg-role.guard.spec.ts và warehouse-scope.guard.spec.ts
npx tsc --noEmit        # type-check toàn bộ project, kể cả prisma/seed.ts và *.spec.ts
pnpm lint:check         # eslint + prettier
pnpm build              # nest build → dist/
```

Không cần Postgres cho 4 lệnh trên — `prisma generate`/`tsc`/`jest` (guard spec dùng mock
`Reflector`, không đụng DB) đều chạy off-line.

## 2. Chuẩn bị môi trường có DB

### 2.1. Bật Postgres

```bash
docker compose up -d postgres
docker compose ps        # đợi cột STATUS = healthy
```

### 2.2. Áp migration + seed

```bash
pnpm prisma migrate deploy   # áp 2 migration Phase 1: add_mfg_attributes_and_notifications, add_system_config_singleton_check
pnpm seed                    # seed permissions, SUPER_ADMIN/ADMIN + 10 role nghiệp vụ, admin user, system_config id=1
```

> **Lưu ý:** `prisma/seed.ts` cần `import 'dotenv/config'` ở đầu file để đọc được
> `DATABASE_URL` từ `.env` khi chạy `pnpm seed` trực tiếp (không qua `prisma migrate dev`,
> vốn tự load `.env` giúp). Nếu thấy lỗi
> `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string` nghĩa là dòng
> import đó bị thiếu hoặc `.env` không có `DATABASE_URL`.

Hai migration tay này **chưa từng chạy qua `prisma migrate dev` thật** (môi trường viết
code không có Postgres sống) — nếu `migrate deploy` báo lỗi cú pháp SQL, copy nguyên log
lại để sửa migration, đừng tự sửa DB bằng tay rồi bỏ qua migration.

### 2.3. Chạy app

```bash
pnpm start:dev
```

Swagger UI (chỉ bật khi `NODE_ENV != production`): `http://localhost:3001/api/docs` —
bấm **Authorize**, dán `accessToken` sau khi login để gọi thử trực tiếp trên UI thay vì
gõ curl tay.

## 3. Test thủ công qua API

```bash
BASE=http://localhost:3001/api/v1

TOKEN=$(curl -s -X POST $BASE/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@dna-erp.local","password":"ChangeMe123!"}' | jq -r .accessToken)
```

SUPER_ADMIN được seed full quyền trên mọi module trong `PERMISSION_MODULES`
(gồm `NOTIFICATION`, `SYSTEM_CONFIG` mới thêm), nên token trên gọi được hết các
endpoint dưới đây.

### 3.1. System Config

```bash
curl -s $BASE/system-config -H "Authorization: Bearer $TOKEN" | jq
# kỳ vọng: id=1, companyName="DNA ERP", defaultCurrency="VND"

curl -s -X PUT $BASE/system-config -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"companyName":"DNA ERP JSC","defaultCurrency":"VND"}' | jq
# kỳ vọng: companyName đã đổi
```

**Edge case:** nếu gọi `GET /system-config` **trước khi** `pnpm seed` chạy → phải trả
**404**, không tự tạo ngầm (đúng thiết kế "không có POST, luôn có sẵn từ seed").

### 3.2. Notifications

```bash
NOTI_ID=$(curl -s -X POST $BASE/notifications -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Test","message":"Hello","audience":"ALL"}' | jq -r .id)

curl -s $BASE/notifications -H "Authorization: Bearer $TOKEN" | jq
# kỳ vọng: thấy notification vừa tạo, isRead=false

curl -s -X POST $BASE/notifications/$NOTI_ID/read -H "Authorization: Bearer $TOKEN" | jq
curl -s -X POST $BASE/notifications/$NOTI_ID/read -H "Authorization: Bearer $TOKEN" -w '\n%{http_code}\n'
# gọi 2 lần liên tiếp: cả 2 đều 200, không lỗi trùng khóa (upsert theo PK kép)

curl -s $BASE/notifications -H "Authorization: Bearer $TOKEN" | jq '.data[0].isRead'
# kỳ vọng: true
```

**Edge case:** login bằng 1 user *không* có role `BOSS`/`WAREHOUSE_STAFF`, tạo notification
với `audience=BOSS` bằng admin, rồi `GET /notifications` bằng user đó → **không** được
thấy notification `audience=BOSS` (chỉ thấy `audience=ALL`).

### 3.3. User mfg-attributes

```bash
USER_ID=$(curl -s $BASE/users -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].id')

# Gán mfgRole=PHOI + phoiOperation hợp lệ
curl -s -X PATCH $BASE/users/$USER_ID/mfg-attributes -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"mfgRole":"PHOI","phoiOperation":"CAT"}' | jq
# kỳ vọng: 200, mfgRole=PHOI, phoiOperation=CAT

# Đổi role sang HAN mà không gửi phoiOperation
curl -s -X PATCH $BASE/users/$USER_ID/mfg-attributes -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"mfgRole":"HAN"}' | jq
# kỳ vọng: mfgRole=HAN, phoiOperation tự động về null (auto-clear vì hết nghĩa)

# Business rule: phoiOperation chỉ hợp lệ khi mfgRole=PHOI
curl -s -X PATCH $BASE/users/$USER_ID/mfg-attributes -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"mfgRole":"HAN","phoiOperation":"CAT"}' \
  -w '\n%{http_code}\n'
# kỳ vọng: 400 BadRequest
```

**Edge case:** gọi endpoint trên bằng JWT của user không có quyền `USER:UPDATE` → 403.

## 4. Checklist Definition-of-Done (đối chiếu roadmap P1)

- [ ] Migration chạy được, không phá `PATCH /users/:id` cũ (`firstName/lastName/isActive/roleIds` vẫn hoạt động bình thường).
- [ ] `MfgRoleGuard`/`WarehouseScopeGuard` có unit test riêng — đã có (`pnpm test`).
- [ ] Seed role nghiệp vụ idempotent — chạy `pnpm seed` 2 lần liên tiếp không lỗi, không tạo trùng role/permission.
- [ ] `GET /system-config` 404 khi seed thiếu, không tự tạo ngầm.
- [ ] `POST /notifications/:id/read` gọi lại không lỗi (idempotent qua PK kép).
