# 14/11/2026 - Đợt C2: ước tiến độ máy cắt, máy rảnh / sắp hết việc, xong Phôi tự tính

Làm theo các câu Sếp trả lời đợt C (14/11):
- **Câu 1:** máy làm theo bảng chia.
- **Câu 2:** máy rảnh = cắt đủ số cây; còn khoảng 20 cây thì báo KHSX + QLSX xưởng.
- **Câu 3:** công nhân vẫn báo theo đoạn.
- **Câu 8:** xong Phôi khi đoạn qua đủ công đoạn; hệ thống tự tính, không có nút.

Đi sau bước đầu đợt C (changelog 14/11 "hàng đợi xưởng, việc của máy"). FE đi kèm: xem changelog cùng tên ở repo FE.

## Thay đổi

1. **Ước số cây máy đã cắt** (`cut-allocation.util.ts`):
   - `estimateMachineProgress` tính từ số đoạn báo CUT tại chính máy (chưa bị đảo), theo (lệnh, loại sắt, cỡ đoạn):
     - duyệt dòng theo thứ tự cắt;
     - cây xong của dòng = min theo cỡ đoạn của floor(đoạn còn ÷ đoạn mỗi cây), không quá số cây của dòng;
     - phần đã dùng bị trừ để dòng sau ăn phần còn lại.
   - `cutMachineStatus` trả về:
     - EMPTY: máy không có dòng chia;
     - IDLE: đã cắt hết;
     - LOW: còn 1..20 cây (`CUT_MACHINE_LOW_WORK_BARS = 20`);
     - BUSY: còn nhiều hơn.
   - `GET /floor/cut-allocation`:
     - mỗi máy thêm `barsDoneEst`, `barsLeftEst`, `status`;
     - mỗi dòng thêm `barsDoneEst`;
     - truy vấn đoạn đã báo gom thêm theo cỡ đoạn.
2. **Màn quét làm theo bảng chia** (`floor-scan.service.ts`):
   - `GET /floor/scan/:token` thêm `allocationPis` (máy của tổ Phôi):
     - máy cắt: lệnh có dòng chia trên chính máy;
     - máy Uốn / Dập /...: lệnh có dòng chia trên mọi máy cắt cùng xưởng.
   - `machineWork` thêm `barsDoneEst`, `barsLeftEst`, `status`.
   - Lệnh báo được = lệnh đang chạy + lệnh làm bù + lệnh trong bảng chia. Lệnh khác vẫn 409.
   - Lệnh mặc định:
     - máy cắt: lệnh của dòng đầu còn cây, không có thì lệnh đang chạy;
     - máy công đoạn phụ: lệnh đang chạy, không có thì lệnh đầu bảng chia;
     - máy cắt hết việc mà hàng đợi chưa có lệnh chạy: không tự chọn lệnh.
3. **Xong Phôi tự tính** (`floor-alerts.service.ts`, `FloorAdminService.autoCompletePhoi`):
   - Nhắc nền chạy 10 phút một lần và sau mỗi thao tác `/floor`. Mỗi lần nó xét mọi dòng hàng đợi Phôi đang chạy / đang chờ.
   - Điều kiện xong: `required > 0 && passed >= required`, tức mọi cỡ đoạn × công đoạn và mảnh Phôi đã KCS đạt đủ.
   - Khi đủ, hệ thống tự đóng dòng (không ghi người bấm) và chạy lệnh kế trong hàng đợi (tổ, xưởng). Dùng cùng khoá với "Chuyển lệnh tiếp".
   - Thông báo mới `FLOOR_PHOI_DONE` (loại tin, gửi QLSX xưởng của lệnh).
   - Tổ Phôi thôi nhắc `FLOOR_STAGE_COMPLETE`; nhắc cũ đang mở tự đóng. Hàn / Sơn giữ như cũ.
4. **Nhắc máy cắt** (`checkCutMachines`):
   - Hai loại nhắc gửi KHSX + QLSX xưởng của máy:
     - `CUT_MACHINE_LOW_WORK`: còn khoảng ≤ 20 cây;
     - `CUT_MACHINE_IDLE`: đã cắt hết việc được chia.
   - Lọc QLSX theo xưởng: `params.workshopId` → `recipient-resolver` bỏ QLSX xưởng khác.
   - Mỗi máy tối đa 1 nhắc đang mở cho mỗi loại.
   - LOW đóng khi máy hết LOW.
   - IDLE chỉ đóng khi máy có việc mới. Lệnh xong Phôi làm dòng chia biến mất thì máy vẫn tính là rảnh.
   - Máy ngưng dùng / bỏ xưởng thì đóng cả hai.

## Kiểm tra

- Jest floor + notifications: 431 test đạt (17 bộ). tsc sạch (ngoài 2 lỗi cũ ở `prisma/seed-*`), eslint sạch, `nest build` đạt.
- **Thử thật qua API trên bản sao DB local (bật nhắc nền, đã xoá): 12 bước đúng.**
  - **Trước khi báo:** máy TD1 Phú An 28 cây (BUSY), máy L2 3 cây (LOW).
  - **Quét TD1 khi hàng đợi Phôi trống:** lệnh mặc định là lệnh của dòng đầu; danh sách lệnh trong bảng chia đúng thứ tự.
  - **Báo 8 cây ở TD1:** báo cho lệnh trong bảng chia (không phải lệnh đang chạy) → 201. TD1 còn 20 cây → LOW, có thông báo.
  - **Báo đủ ở L2:** L2 → IDLE, có thông báo máy rảnh; nhắc LOW của L2 đã đóng.
  - **Người nhận đúng xưởng:** máy Phú An → KHSX + QLSX Phú An; máy Phước An → KHSX + QLSX Phước An.
  - **Lệnh xưởng khác:** báo lệnh Phước An ở máy Phú An → 409.
- **Đóng hàng đợi Phôi trên Postgres thật** (gọi `autoCompletePhoi` qua Nest context trên bản sao DB):
  - 2 lượt cùng lúc → đúng 1 lượt đóng và kéo lệnh kế lên;
  - dòng đóng không ghi người bấm;
  - gọi lại thì không làm gì;
  - đóng lệnh cuối → hàng đợi không còn dòng chạy.
- Phần "đủ KCS thì tự đóng" chỉ có unit test: dữ liệu local không có lệnh nào đủ KCS Phôi.

## Sửa khi review

- Nhắc máy rảnh bị đóng ngay khi lệnh xong Phôi (dòng chia biến mất → EMPTY). Sửa: giữ tới khi máy có việc mới.
- Chia thêm vài cây mà máy vẫn ≤ 20 cây thì phát thêm nhắc thứ 2 cho cùng máy. Sửa: mỗi máy 1 nhắc mở mỗi loại; dọn nhắc của máy ngưng dùng.

## Lưu ý triển khai

- Không có migration mới.
- Nhắc nền dựng bảng chia cho từng xưởng có máy cắt mỗi lần quét (10 phút + sau thao tác `/floor`, gom trong 3 giây). Nếu DB thật chậm thì cần xem lại.
- Sau deploy, lần quét đầu sẽ tự đóng các dòng hàng đợi Phôi (đang chạy hoặc đang chờ) đã đủ KCS; QLSX nhận tin "đã xong Phôi".
- Ước số cây chỉ tính đoạn báo ở chính máy: báo bù / đảo ở máy khác không cộng cho máy này.
- **Còn lại của đợt C:**
  - **C3:** đã làm cùng ngày - xem `changelog-2026-11-14-dot-c3-may-ranh-keo-lenh.md` (câu 5 chốt 14/11: báo KHSX + QLSX xưởng, không thêm Tổ Hàn, không đổi code).
  - **C4:** công cụ đo năng suất (C4a) đã làm cùng ngày - xem `changelog-2026-11-14-dot-c4a-do-nang-suat-may-cat.md`; luật nửa ca (C4b) chờ số đo.
