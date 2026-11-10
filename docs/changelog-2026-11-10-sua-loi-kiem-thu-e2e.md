# Changelog 2026-11-10 — Sửa 2 lỗi phát hiện khi kiểm thử E2E trên trình duyệt

> Trạng thái (10/11): **đã commit** (BE `main`, FE `demo`), **chưa push**. Đã kiểm lại trên trình duyệt với DB local
> (bản clone production). Production cần đồng bộ quyền sau khi deploy BE (mục 2).

## Mục lục
1. FE – lệch cột ngày ở bảng SKU của lệnh khi màn hẹp
2. BE – KCS thiếu quyền xem lệnh xưởng (403 ở thanh "lệnh đang tạm dừng")
3. Kiểm tra đã chạy

## 1. FE – lệch cột ngày ở bảng SKU của lệnh khi màn hẹp
- **Triệu chứng:** ở màn duyệt của QLSX/Giám đốc và màn lệnh của KHSX, khi vùng nội dung hẹp (khoảng dưới 1200px:
  laptop nhỏ, tablet, chia đôi màn hình) tiêu đề "HẠN GIAO" nằm trên ngày Đóng gói, còn hạn giao thật bị cắt mất →
  người duyệt đọc sai hạn. Ở 1440px thì thẳng hàng.
- **Nguyên nhân:** `src/modules/pages/ProductionPlan/LenhSXPage.tsx` – hàng tiêu đề và từng dòng là các lưới CSS riêng,
  cột SKU khai `1fr` (= `minmax(auto, 1fr)`, tự nở theo nội dung). Khi tổng các cột ngày cố định lớn hơn bề rộng khung,
  cột SKU của dòng nở theo tên SKU còn của tiêu đề thì không → lệch một cột, cột cuối bị `overflow: hidden` cắt.
- **Sửa:** khai hằng `APPROVAL_COLS` / `PLAN_COLS` dùng chung cho tiêu đề và dòng, cột SKU có bề rộng tối thiểu cố định
  (`minmax(160px, 1fr)` / `minmax(180px, 1fr)`); tiêu đề và dòng có `minWidth` bằng tổng tối thiểu; khung ngoài đổi
  `overflow: hidden` → `overflowX: auto` để hẹp hơn thì cả khối cuộn ngang cùng nhau. Bố cục điện thoại (thẻ) không đổi.

## 2. BE – KCS thiếu quyền xem lệnh xưởng
- **Triệu chứng:** đăng nhập KCS, `GET /production-orders?limit=100` trả 403 (2 lần mỗi lần mở màn).
- **Nguyên nhân:** `MfgApp` hiện thanh "lệnh đang tạm dừng" (`FloorStoppedBanner`) cho cả Phôi/Hàn/Sơn/KCS; thanh này
  gọi `GET /production-orders`, nhưng `KCS_STAFF` chưa có `PRODUCTION_ORDER:VIEW`. Lỗi bị nuốt nên KCS không bao giờ thấy
  lệnh nào QLSX đang tạm dừng. Danh sách đợt chờ kiểm KHÔNG bị ảnh hưởng.
- **Sửa:** `src/common/constants/role-permissions.constant.ts` – cấp `PRODUCTION_ORDER:VIEW` (chỉ xem) cho `KCS_STAFF`.
  Bắt đầu / tạm dừng / kết thúc lệnh vẫn chỉ QLSX làm được.
- **Đồng bộ vào DB:** quyền lưu ở bảng `role_permissions`, không tự cập nhật khi deploy.
  - DB local: đã thêm đúng 1 dòng bằng SQL dưới đây.
  - Production (sau khi deploy BE): chạy `npm run seed` như các lần vá quyền trước. Lưu ý seed đồng bộ lại TOÀN BỘ quyền
    theo hằng số (xoá quyền chỉnh tay ngoài hằng số) và cập nhật tên kho hệ thống. Nếu chỉ muốn thêm đúng quyền này:
    ```sql
    INSERT INTO role_permissions ("roleId", "permissionId")
    SELECT r.id, p.id FROM roles r, permissions p
    WHERE r.name = 'KCS_STAFF' AND p.module = 'PRODUCTION_ORDER' AND p.action = 'VIEW'
    ON CONFLICT DO NOTHING;
    ```
  - Tài khoản KCS đang đăng nhập cần đăng xuất / đăng nhập lại để nhận quyền mới.

## 3. Kiểm tra đã chạy
- Trình duyệt (DB local), khung 1000×800:
  - KHSX, lệnh GP-9001: tiêu đề và ngày thẳng hàng, cuộn ngang thấy "Hạn giao 18/12/2026" đúng cột.
  - QLSX, màn duyệt lệnh mới GPGP-9002 (PO thử `TEST-E2E-1011B`, tạo riêng để kiểm bảng có cột PO): thẳng hàng, cuộn
    ngang thấy đúng hạn giao.
  - KCS đăng nhập lại: `GET /production-orders?limit=100` → 200.
- FE: `tsc --noEmit` sạch; eslint `LenhSXPage.tsx` 0 lỗi (cảnh báo `any` có sẵn); vitest `ProductionPlan` 2 file / 37 test xanh.
- BE: `tsc --noEmit` không lỗi trong `src` (còn 2 lỗi có sẵn ở `prisma/seed-*.ts`); eslint file hằng số sạch; jest
  `src/common`, `qc-reviews`, `work-queue`, `notifications` (`--maxWorkers=2`): 28 suite / 336 test xanh.
