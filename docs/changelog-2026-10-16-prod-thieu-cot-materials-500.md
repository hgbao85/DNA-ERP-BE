# 2026-10-16 — Production 500 "Database error" ở /materials: thiếu 2 cột

## 1. Triệu chứng
FE production (erpdna.vercel.app) báo "Không tải được dữ liệu: Database error". `GET /api/v1/materials` trả
500. Local không lỗi.

## 2. Nguyên nhân (đã xác nhận bằng truy vấn chỉ-đọc lên DB production)
- `all-exceptions.filter.ts` gom mọi lỗi Prisma ngoài P2002/P2025/P2003 thành "Database error".
- Chạy thử `material.findMany()` trên production: **P2022 — cột `materials.purchaseUnit` không tồn tại**.
- `prisma migrate status` vẫn báo "up to date" vì bảng `_prisma_migrations` ghi migration
  `20260810120000_add_purchase_unit_conversion` đã áp dụng (22/08), nhưng cột thực tế không có. Cột
  `khoUnitFactor` (từ migration `20260730000000`) cũng thiếu. Tức DB production bị lệch schema so với
  lịch sử migration (nhiều khả năng bản restore/dump cũ hoặc migration bị đánh dấu applied mà không chạy).
  `migrate status` không phát hiện được kiểu lệch này; phải dùng `migrate diff`.
- `GET /material-yield-recipes` truy vấn lại chạy OK (1 dòng) — lỗi 500 của nó ở screenshot có thể do
  cùng request đó include materials; cần FE tải lại để xác nhận.

## 3. Đã làm
- Người dùng chọn "chỉ vá cột thiếu" (không restore backup `prod_20261015_1516_truoc-seed.dump`).
- Chạy trên production: `ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "khoUnitFactor" DECIMAL(14,4),
  ADD COLUMN IF NOT EXISTS "purchaseUnit" TEXT` (thêm cột nullable, không mất dữ liệu).
- Chưa tạo backup trước vì chỉ thêm cột nullable; DB cũ vẫn còn `backups/prod_20261015_1516_truoc-seed.dump`.

## 4. Kiểm tra
- Sau vá: `prisma migrate diff` (prod → schema.prisma) chỉ còn lệch bảng `purchase_receipt_logs`.
- Chưa gọi lại API/FE production để xem hết 500 (cần người dùng tải lại trang).

## 5. Còn treo
- Bảng `purchase_receipt_logs` tồn tại trên production nhưng không có trong schema.prisma — **không xóa**,
  cần hỏi người dùng đây là bảng gì (dữ liệu thật?) trước khi quyết định.
- Cần xác định vì sao DB production lệch migration để tránh lặp lại (chạy `migrate diff` sau mỗi lần
  restore/seed production).
