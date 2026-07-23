# DNA ERP Backend

Backend ERP xây dựng bằng **NestJS + PostgreSQL + Prisma**, chuẩn production: JWT auth + RBAC theo permission (module + action), soft delete, audit log, health check, Swagger, Docker, CI.

## 1. Yêu cầu hệ thống

- **Node.js >= 20**
- **pnpm** (cài qua `npm install -g pnpm` nếu chưa có)
- **Docker Desktop** (để chạy PostgreSQL, và tuỳ chọn chạy cả app trong container)

Kiểm tra nhanh:

```bash
node -v
pnpm -v
docker -v
```

## 2. Cài đặt dependencies

```bash
pnpm install
```

## 3. Cấu hình biến môi trường

Copy file mẫu và chỉnh sửa nếu cần (mặc định đã khớp với `docker-compose.yml`):

```bash
cp .env.example .env
```

Các biến quan trọng trong `.env`:

| Biến | Ý nghĩa |
|---|---|
| `DATABASE_URL` | Connection string tới Postgres |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Secret ký JWT, tối thiểu 32 ký tự |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Tài khoản admin được tạo khi chạy seed |
| `CORS_ORIGIN` | Origin FE được phép gọi API (`*` = cho phép tất cả) |

> Ứng dụng dùng Joi validate `.env` khi khởi động — thiếu hoặc sai biến bắt buộc sẽ **fail-fast** ngay khi start, kèm thông báo rõ biến nào lỗi.

## 4. Chạy PostgreSQL

Dùng Docker Compose (khuyến nghị, không cần cài Postgres thủ công):

```bash
docker compose up -d postgres
```

Kiểm tra container đã khỏe:

```bash
docker compose ps
```

## 5. Migrate database + seed dữ liệu mẫu

```bash
pnpm prisma:migrate:deploy   # áp dụng migrations có sẵn (bao gồm raw SQL CHECK constraints)
pnpm seed                    # tạo permissions, role SUPER_ADMIN/ADMIN và user admin
```

Nếu bạn **thay đổi** `prisma/schema.prisma` và muốn tạo migration mới:

```bash
pnpm prisma:migrate:dev --name ten_migration
```

Tài khoản admin sau khi seed: lấy theo `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` trong `.env` (mặc định `admin@dna-erp.local` / `ChangeMe123!`).

## 6. Chạy ứng dụng (dev mode, hot reload)

```bash
pnpm start:dev
```

Mặc định app chạy ở `http://localhost:3001` với prefix `/api`.

## 7. Kiểm tra nhanh

- **Health check**: `GET http://localhost:3001/api/health` → `{"data":{"status":"ok", ...}}`
- **Swagger UI**: mở `http://localhost:3001/api/docs`
- **Đăng nhập**:

```bash
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@dna-erp.local","password":"ChangeMe123!"}'
```

Response trả về `accessToken` (15 phút) + `refreshToken` (7 ngày). Dùng `accessToken` qua header `Authorization: Bearer <token>` để gọi các API còn lại (`/api/v1/users`, `/api/v1/roles`, `/api/v1/audit-logs`, ...).

- **Refresh token** (xoay vòng, token cũ sẽ bị thu hồi): `POST /api/v1/auth/refresh` với body `{ "refreshToken": "..." }`
- **Logout** (thu hồi refresh token): `POST /api/v1/auth/logout` với body `{ "refreshToken": "..." }`

## 8. Chạy test

### Unit test (không cần database)

```bash
pnpm test
pnpm test:cov      # kèm coverage
```

### Integration test + E2E test (cần một Postgres riêng cho test)

```bash
docker compose -f docker-compose.test.yml up -d
pnpm test:integration
pnpm test:e2e
```

Test tự động chạy migration lên database test trước khi test (`test/jest-global-setup.ts`), không ảnh hưởng tới database dev.

## 9. Lint & format

```bash
pnpm lint          # eslint --fix
pnpm lint:check    # chỉ kiểm tra, không tự sửa (dùng trong CI)
pnpm format        # prettier --write
```

Husky + lint-staged đã được cấu hình để tự động lint/format các file thay đổi khi `git commit`.

## 10. Build & chạy production (không dùng Docker)

```bash
pnpm build
pnpm start:prod
```

## 11. Chạy toàn bộ bằng Docker (app + Postgres)

```bash
docker compose up -d --build
```

Container `app` sẽ tự chạy `prisma migrate deploy` trước khi start server (xem `docker/Dockerfile`). Nhớ dừng app chạy bằng `pnpm start:dev` ở host trước để tránh xung đột cổng `3001`.

Dừng toàn bộ:

```bash
docker compose down
```

## 12. Một số lệnh hữu ích khác

```bash
pnpm prisma:studio     # mở Prisma Studio để xem/sửa dữ liệu trực quan
pnpm prisma:generate   # generate lại Prisma Client sau khi sửa schema
```

## 13. Xử lý sự cố thường gặp

- **Lỗi `EADDRINUSE` khi start**: cổng 3001 đang bị chiếm bởi tiến trình cũ, tắt tiến trình đó hoặc đổi `PORT` trong `.env`.
- **App lỗi 500 khi gọi API, DB chưa migrate**: chạy lại bước 5.
- **Config validation error khi start**: đọc kỹ thông báo lỗi — nó liệt kê chính xác biến `.env` nào thiếu/sai định dạng.
- **Docker Desktop chưa chạy**: mở Docker Desktop và đợi engine khởi động xong rồi mới `docker compose up`.
