# 19/11/2026 - Chỉ Sales và Admin được tạo / sửa / xoá đơn hàng bán (BE)

Nguồn: đợt test toàn hệ thống 19/11, lỗi C1 (mức Cao), phương án B người dùng chốt. Không đổi FE, không migration.

## Lỗi
- 3 route ghi của đơn hàng bán (`PATCH /sales-orders/:id`, `POST /sales-orders/:id/items`, `PATCH /sales-orders/:id/items/:itemId`) chỉ
  đòi quyền `SALES_ORDER:UPDATE`. Quyền này cấp cho vai `WAREHOUSE_STAFF` từ 19/08 để thủ kho thành phẩm xuất hàng (nay xuất hàng qua
  `/booking-shipments`, vẫn đòi đúng quyền này). `WAREHOUSE_STAFF` lại là vai nền của mọi tài khoản văn phòng (người mua, KHSX, quản lý
  vật tư, mọi thủ kho), nên họ gọi thẳng API được để sửa số lượng / ngày giao / cờ đã nhận cọc / trạng thái / dây - nệm của dòng và thêm
  dòng SKU mới (dòng mới hiện ngay ở "Tối ưu cắt sắt"). Giao diện không có nút cho các vai này; lỗi chỉ ở API.

## Thay đổi
- `sales-orders.controller.ts`: 5 route ghi (tạo, sửa, xoá đơn; thêm, sửa dòng) thêm `@RequireRole(SALES_STAFF, ADMIN)` chồng lên
  `@RequirePermissions` cũ - cùng cách `bookings.controller.ts` (đợt 10a). Route đọc (danh sách, chi tiết) giữ nguyên, chỉ cần
  `SALES_ORDER:VIEW`. Vai khác gọi route ghi nhận 403 "Tài khoản không có vai trò được làm việc này (cần: SALES_STAFF, ADMIN)".
- `role-permissions.constant.ts`: chỉ sửa chú thích khối `WAREHOUSE_STAFF` / `SALES_ORDER` (bỏ ý "POST .../ship" đã gỡ ở đợt 10b; ghi rõ
  UPDATE giữ cho `/booking-shipments`, không được bỏ). Quyền không đổi.
- Không đổi: xuất hàng theo booking của thủ kho thành phẩm; Giám đốc vẫn chỉ xem đơn (vốn chỉ có VIEW + APPROVE).

## Kiểm
- Test mới `sales-orders.controller.spec.ts` (metadata quyền + vai 7 route) và `test/sales-orders-quyen.e2e-spec.ts` (HTTP thật, DB test:
  bảng vai x route ghi - Sales, Admin (đúng mã 201 / 200 / 204), thủ kho thành phẩm, người mua, KHSX, quản lý vật tư, Giám đốc, và một
  vai tự tạo có đủ mọi quyền SALES_ORDER nhưng không phải SALES_STAFF / ADMIN (bị chặn vai ở cả 5 route, kể cả tạo / xoá); đọc lại đơn
  trong DB sau mỗi lần bị chặn; danh sách / chi tiết vẫn 200 cho 7 vai; thủ kho thành phẩm lấy số phiếu xuất booking vẫn 200).
- Trên controller cũ: test HTTP 9 đỏ / 20 xanh (đúng các ô chặn theo vai). Sau sửa: 30/30; hồi quy quyền P1 25/25; jest đơn vị cả bộ
  4616 đạt; nest build đạt; eslint / prettier sạch. QA review độc lập: Đạt có điều kiện, 0 Cao / 0 Vừa; không còn route nào khác ghi bảng
  đơn hàng bán ngoài 5 route trên và xuất hàng theo booking (có kiểm kho, số còn, số đã đóng gói).

## Sửa CI sau push (cùng ngày)
- CI `test` đỏ ở commit `843dde8`: trên DB trống của CI, các file e2e chạy song song; suite quyền P1 và suite mới cùng tạo rồi xoá cứng vai
  hệ thống nên suite này mất vai BOSS giữa chừng (Giám đốc xem đơn nhận 403). Lỗi ở cách chạy test, không ở code sản phẩm.
- `test/jest-e2e.json`: `"maxWorkers": 1` - e2e dùng chung 1 DB test nên chạy tuần tự (giống integration `--runInBand`). Tái hiện trên DB
  mới tinh + chạy cả bộ như CI: trước sửa 1 đỏ / 58 xanh; sau sửa 59/59 (2 lần).

## Deploy
- Chỉ BE. Không migration, không seed, không cần đăng nhập lại (guard vai đọc vai từ token / DB như các route booking).
- Trước deploy: SELECT chỉ đọc trên production - (a) vai `SALES_STAFF` và `ADMIN` còn đúng tên, chưa xoá mềm (chặn so theo TÊN vai);
  (b) tài khoản đang hoạt động có cờ Sales mà thiếu vai SALES_STAFF = 0 (nếu có sẽ bị chặn sửa đơn / đổi cọc). Bản sao 17/11: đúng tên, 0
  tài khoản thiếu.
- Sau deploy thử nhanh: Sales đổi cọc một đơn thử không bị 403; thủ kho thành phẩm "In phiếu xuất" ở màn xuất hàng booking không bị 403.
- Ghi chú: DB test chung còn thêm dòng `audit_logs` sau mỗi lần chạy e2e (các suite khác cũng vậy); không ảnh hưởng production.
- Việc sau (chưa làm): quyền riêng cho xuất hàng (module mới, migration dữ liệu, 2 lần deploy) để rút hẳn `SALES_ORDER:UPDATE` khỏi vai
  thủ kho; ghi nhật ký ai sửa đơn hàng bán.
