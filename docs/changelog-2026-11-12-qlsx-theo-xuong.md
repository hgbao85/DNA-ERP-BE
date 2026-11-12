# Changelog 12/11/2026 - QLSX theo xưởng (giai đoạn 1)

## Yêu cầu (Sếp)
Thêm 1 tài khoản QLSX: mỗi xưởng (Phú An, Phước An) một QLSX, QLSX xưởng nào chỉ xem/làm tiến độ xưởng đó. KHSX xem tổng mọi
xưởng/kho. Chốt: KHSX chọn xưởng khi gửi lệnh sang QLSX; công đoạn Sơn của lệnh Phước An (sơn nhờ ở Phú An) do QLSX Phú An
theo dõi; phần quét QR (máy, hàng đợi tổ, công nhân), KCS, thủ kho giữ chung (giai đoạn 2 mới tách).

## Sửa
- Nền: cột `users.workshopId` (migration `20261112120000_user_workshop_scope`, chỉ thêm cột + index + khoá ngoại, NULL = không
  giới hạn nên tài khoản hiện có không đổi hành vi); `WorkshopScopeService` (`src/common/workshop-scope/`, module @Global):
  QLSX gắn xưởng W XEM lệnh của W + lệnh các xưởng sơn nhờ ở W, THAO TÁC chỉ lệnh của W; SKU chưa có xưởng ai cũng làm được.
- users: Admin đặt/bỏ `workshopId` qua `PATCH /users/:id/mfg-attributes` (chỉ cho mfgRole PRODUCTION_MANAGER; đổi vai khỏi
  QLSX thì tự bỏ gắn); phản hồi user có `workshopId`, `workshopName` (kể cả `/auth/me`).
- production-invoices: send-to-qlsx (lẻ + batch) nhận `workshopId`; danh sách/chi tiết lọc theo phạm vi XEM ở tầng truy vấn,
  mỗi lệnh có `canManage`, mỗi SKU có `workshopId`/`workshopName`; ngoài phạm vi → 404. Gửi Sếp / Từ chối / Đổi xưởng ngoài
  xưởng → 403; QLSX gắn xưởng gửi `workshopId` khác xưởng hiện tại → 400 (dùng Chuyển xưởng). Đổi xưởng cho thêm trạng thái
  WAITING_QLSX (Chuyển xưởng trước khi gửi Sếp) và phát lại thông báo "chờ QLSX" cho xưởng mới.
- production-orders: Bắt đầu / Tạm dừng / Kết thúc / Nạp lại định mức chặn 403 ngoài xưởng.
- milestone-board, piece-sync-board: lọc theo phạm vi XEM (bản tin sáng không lọc). production-capacity: QLSX gắn xưởng chỉ thấy
  khối xưởng mình + khối kho (khối kho vẫn cộng đủ mọi xưởng).
- work-queue: số đỏ "lệnh chờ QLSX" chỉ đếm xưởng mình + chưa có xưởng.
- notifications: lọc tập trung trong `emit()` - thông báo gắn được với 1 lệnh (qua `piCode`/`poNumber` hoặc entity
  PI / SKU / production order / cutting proposal) không gửi QLSX đã gắn xưởng khác; QLSX chưa gắn xưởng và vai khác giữ
  nguyên; lỗi lọc thì giữ nguyên người nhận. Không lọc: bản tin sáng, thông báo hệ thống, cảnh báo theo tổ (FLOOR_BATCH_STALE),
  đề xuất cắt chưa gắn lệnh.

## Kiểm tra
- `tsc` không lỗi trong `src` (2 lỗi seed có sẵn); `eslint` sạch; jest các module đã đổi: 32 suite / 792 test pass (có test mới
  cho từng mục).
- Thử thật ở local (DB clone, 2 tài khoản QLSX thử Phú An / Phước An, BE dev + FE dev):
  - KHSX thấy 7 lệnh, có ô lọc xưởng; QLSX Phú An thấy lệnh Phú An + lệnh Phước An (chỉ xem, nhãn "Sơn tại xưởng bạn");
    QLSX Phước An chỉ thấy 2 lệnh Phước An + lệnh chưa có xưởng; mở lệnh Phú An → 404.
  - Tạm dừng lệnh xưởng khác → 403 (cả 2 chiều). Bảng mốc: KHSX 7 dòng, Phước An 2 dòng.
  - KHSX gửi lệnh mới: nút Gửi khoá tới khi chọn xưởng; lệnh chỉ tới QLSX + thông báo của xưởng đã chọn.
  - QLSX Phú An "Chuyển xưởng" lệnh chờ sang Phước An: lệnh rời danh sách việc của Phú An, QLSX Phước An nhận lệnh + thông báo,
    hộp gửi Sếp khoá ô xưởng.

## Triển khai
- Migration tự chạy khi deploy, chỉ thêm cột. Sau deploy: Admin › Người dùng gắn "Xưởng phụ trách" = Phú An cho tài khoản QLSX
  hiện có, tạo tài khoản QLSX Phước An (vai Quản lý SX, xưởng Phước An). Chưa gắn thì QLSX vẫn thấy tất cả như trước.
