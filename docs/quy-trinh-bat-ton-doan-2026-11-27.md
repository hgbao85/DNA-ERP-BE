# Quy trình bật tồn đoạn (`SEGMENT_STOCK_ENABLED`) — 27/11/2026

Gom từ quản lý chốt câu 10 (26/11) và quy trình bật đã chốt 16/11 (`docs/changelog-2026-11-14-ton-doan-phia-tru.md`, mục
"Trước khi bật"). Không cần code thêm. Hai chỗ hở ở cuối file, tuỳ quyết định.

**Thứ tự bắt buộc:**
- Chuyển đổi dữ liệu cũ chạy thật **chỉ được khi công tắc đã bật**.
- Chuyển đổi chỉ chạy được **một lần, khi chưa có dữ liệu tồn đoạn theo lệnh**. Nếu đã bật mà có người báo Hàn / Sơn gửi KCS
  hoặc KCS chấm trước khi chuyển đổi chạy, chuyển đổi sẽ bị từ chối.
- Chuyển đổi đưa mọi ô tồn đoạn cũ về 0, nên **kiểm kê phải làm SAU chuyển đổi**. Kiểm kê trước thì số đếm bị xoá.

## A. Trước ngày bật

| # | Việc | Ai | Ghi chú |
|---|---|---|---|
| A1 | Hỏi quản lý ngày xưởng nghỉ để kiểm kê | IT | Câu 10 file hỏi 26/11, chưa có ngày |
| A2 | Chạy thử 1 tuần trên bản thử (bản sao DB): bật công tắc, chạy chuyển đổi, cho Phôi / Hàn / Sơn / KCS báo như thật, kiểm kê thử | IT | Quản lý chốt 26/11 |
| A3 | Trên production (công tắc còn tắt): chạy chuyển đổi **xem thử** `POST /api/v1/segment-stock/legacy-conversion` `{ "dryRun": true }` bằng tài khoản Admin. Đối chiếu báo cáo với sổ thủ kho Phôi | IT + thủ kho Phôi | Xem thử chạy rồi rollback, không ghi gì |
| A4 | Báo trước cho QLSX, tổ trưởng Phôi / Hàn / Sơn, KCS: ngày nghỉ đó không báo sản lượng, không gửi KCS, không chấm KCS | Quản lý / QLSX | Hệ thống chưa có khoá, chỉ dựa vào dặn |
| A5 | Không đổi xưởng lệnh đã có đoạn cắt dư từ giờ tới lúc sửa | KHSX | Hạn chế đã biết TĐ7 (16/11): phần dư bị ghi sang kho mới |
| A6 | Chuẩn bị người có quyền sửa biến môi trường BE trên Render | IT | |

## B. Ngày xưởng nghỉ

| # | Việc | Ai | Ghi chú |
|---|---|---|---|
| B1 | Xác nhận không còn ai báo sản lượng / gửi KCS / chấm KCS | QLSX | |
| B2 | Render: đặt `SEGMENT_STOCK_ENABLED=true` cho BE, chờ server khởi động lại xong | IT | |
| B3 | **Ngay sau khi server lên:** chạy chuyển đổi **thật** `{ "dryRun": false }`. Lưu báo cáo trả về | IT | Báo "Đã có dữ liệu tồn đoạn theo lệnh" = có người báo chen vào: tắt công tắc, dọn dữ liệu vừa sinh rồi làm lại B2–B3 |
| B4 | Thủ kho Phôi từng xưởng đếm đoạn theo mã đoạn. Nhập số đếm tại kho Phôi, tab **Tồn đoạn**, nút **Kiểm kê** từng mã | Thủ kho Phôi | Nhập SỐ ĐẾM, không phải số chênh; hệ thống tự ghi phần chênh |
| B5 | Kế toán hoặc KCS kiểm lại số đếm | Kế toán / KCS | Quản lý chốt 26/11 |
| B6 | Đếm hàng dở giữa các tổ (đoạn đã giao Hàn / Sơn chưa xong) | Thủ kho / tổ trưởng | **Chưa có màn nhập**, xem chỗ hở 2 |
| B7 | Báo các tổ báo sản lượng lại bình thường | QLSX | |

## C. Sau khi bật

| # | Việc | Ai | Ghi chú |
|---|---|---|---|
| C1 | Chạy song song 3–5 ngày: so tồn đoạn trên hệ thống với sổ thủ kho Phôi mỗi ngày | Thủ kho Phôi + IT | Quy trình 16/11 |
| C2 | Theo dõi tab "Sổ báo vượt đoạn" và thông báo báo vượt của QLSX | QLSX | |
| C3 | Lệch nhiều, không giải thích được: báo IT xem trước, đừng tắt công tắc ngay | IT | Tắt lại sau khi đã chạy thì Hàn / Sơn quay về trừ kiểu cũ vào dòng trơn, tồn đoạn theo lệnh đã ghi đứng yên - bật lại sẽ lệch |

## Chỗ hở (chưa có code, tuỳ quyết định)

1. **Không có khoá báo sản lượng lúc kiểm kê.** B1 chỉ dựa vào dặn miệng. Lỡ có người báo giữa B2 và B3 thì chuyển đổi bị từ
   chối, phải dọn rồi làm lại. Lỡ báo trong lúc B4 thì số đếm lệch. Có thể thêm công tắc "đang kiểm kê" chặn báo sản lượng.
2. **Kiểm kê chỉ đếm đoạn trong kho Phôi.** Quản lý chốt đếm cả hàng dở giữa các tổ, nhưng chưa có màn nhập phần này. Hỏi lại
   quản lý chỉ đếm kho Phôi có đủ không, hay cần làm thêm màn.
