# Sửa 403 danh mục xưởng / hàng SKU huỷ + cho FE đọc Retry-After (26/11/2026)

Lỗi gặp khi chạy thử toàn bộ màn theo vai trên bản sao production 23/11 (sau khi gộp 5 tính năng xưởng / kho). Không có migration.

## Thay đổi

- `GET /workshops` (danh mục xưởng đang dùng: id, tên, thứ tự): bỏ yêu cầu quyền `PRODUCTION_INVOICE:VIEW`, mọi người dùng ĐÃ ĐĂNG
  NHẬP đọc được (JwtAuthGuard toàn cục vẫn bắt đăng nhập, không token = 401). Trước đây tài khoản thống kê tổ Hàn / Sơn bị 403 mỗi
  lần mở khung Sản xuất. Quyền xem / sửa lệnh sản xuất không đổi.
- `GET /production-order-cancellations/goods` (hàng của SKU đã huỷ còn chuyển được): thêm vai Sếp (chỉ đọc). Trước đây Sếp mở màn
  "Hàng SKU đã huỷ" trong phân hệ Kế hoạch SX bị 403. `POST :id/transfer-goods` vẫn chỉ KHSX và Admin.
- CORS: `exposedHeaders: ['Retry-After']` để FE đọc được thời gian chờ khi bị 429 "Thao tác quá nhanh" (giới hạn 100 request / 60 giây
  mỗi người, tính riêng từng endpoint).

## Kiểm

- Test gác vai / quyền: `workshops.controller.spec.ts` (không đòi quyền module / vai), `order-cancellation.controller.spec.ts` mới
  (Sếp xem được, không chuyển được).
- Chạy thật trên bản sao: Sếp `GET goods` 200, `POST transfer-goods` 403; tài khoản tổ Hàn / Sơn `GET /workshops` 200; không token 401;
  trình duyệt đọc được `Retry-After`.
- jest 230 bộ / 5079 test đạt. QA review độc lập: Đạt có điều kiện, 0 Cao - guard toàn cục vẫn bắt đăng nhập cho route không khai quyền,
  danh mục xưởng chỉ trả id / mã / tên / cách tính công suất / xưởng sơn / thứ tự; Sếp có PRODUCTION_INVOICE:VIEW nên đọc được, chuyển
  hàng vẫn bị chặn 2 lớp (vai + quyền UPDATE).
- Còn biết (ngoài phần sửa): thư viện @nestjs/throttler 6.5 khi 1 người hết khoá thì xoá hẹn giờ giảm đếm của MỌI người cùng bộ chặn
  (`resetBlockdRequest` -> `clearExpirationTimes`), số đếm có thể không giảm -> 429 dù gọi chậm. Cần xử lý riêng.

## Lưu ý deploy

- Lên BE trước FE (FE ẩn nút Chuyển với Sếp và tự thử lại 429 dựa vào header này). Không biến môi trường mới.
