# 14/11/2026 - Đợt C bước đầu: hàng đợi tổ theo xưởng (C1), màn quét hiện việc của máy (C0), bảng chia theo câu 10 + câu 6

Sếp trả lời 10 câu của file xin xác nhận đợt C (14/11). Bước này làm các phần đã rõ:
- **C1:** hàng đợi tổ theo xưởng.
- **C0:** màn quét máy cắt hiện việc của máy.
- **Câu 10:** không tách kiểu cắt theo bó, trừ khi máy hư mới được chuyển; lưu các lệnh có điều chuyển.
- **Câu 6:** chia tay thì hệ thống thống kê lại các lần chia.

C2 / C3 / C4 làm bước sau. FE đi kèm: xem changelog cùng tên ở repo FE.

## Thay đổi

1. **Hàng đợi tổ theo xưởng (C1).** Mỗi xưởng một hàng đợi cho mỗi tổ; Phú An và Phước An chạy song song.
   - **Migration `20261114090000_floor_queue_by_workshop`:**
     - `floor_queue_entries.workshopId`, backfill dòng cũ theo quy tắc:
       - lấy xưởng của lệnh;
       - lệnh chưa có xưởng thì lấy xưởng mặc định (xưởng của kho `phoi-son-han`);
       - tổ Sơn theo nơi sơn `paintWorkshopId` (Phước An sơn ở Phú An).
     - Index "1 dòng RUNNING" đổi từ mỗi tổ thành mỗi (tổ, xưởng).
   - **`floor-queue-workshop.util.ts`:** quy tắc dùng chung (xưởng hàng đợi của lệnh, xưởng của máy khi quét, khoá theo (tổ, xưởng)).
   - **API hàng đợi** (danh sách, ứng viên, thêm, xếp lại, chuyển, mở lại, bỏ) chạy theo (tổ, xưởng):
     - QLSX gắn xưởng chỉ làm xưởng mình (403).
     - QLSX chưa gắn xưởng phải chọn xưởng khi Chuyển / Mở lại (400 "Chọn xưởng").
     - Dòng trả về `workshopId`, `workshopName` và `piWorkshopName` (xưởng của chính lệnh).
   - **Màn quét:** lệnh báo được = lệnh của hàng đợi (tổ, xưởng của máy); máy chưa gắn xưởng theo xưởng mặc định.
2. **Màn quét máy cắt hiện việc của máy (C0):**
   - `CutAllocationService.getMachineWork`.
   - `GET /floor/scan/:token` của máy cắt trả `machineWork.rows`: các dòng chia của máy theo thứ tự cắt, cùng dạng dòng bảng chia. Lỗi chỉ ghi log.
   - Không đổi cách báo: công nhân vẫn báo theo đoạn (câu 3).
3. **Bảng chia (câu 10 + câu 6):**
   - **Dòng kiểu cắt theo bó** (`pattern.bundles` có giá trị): tách → 400; đổi số cây → 400; đổi máy chỉ khi `reason = MACHINE_BROKEN`. Dòng thường như cũ, lý do tuỳ chọn.
   - **Migration `20261114093000_cut_allocation_log`:** bảng `cut_allocation_logs`.
     - Ghi trong cùng transaction: ADD ("Chia luôn"), SPLIT, MOVE, BARS, REMOVE.
     - Không ghi cho hệ thống tự chia và đổi thứ tự cắt.
   - **`GET /floor/cut-allocation/log?workshopId&productionInvoiceId&from&to`:** mặc định 30 ngày, tối đa 500 dòng. Trả `entries` + `byOrder` ("lệnh có điều chuyển": số lần đổi máy, tách, vì máy hư).
   - Dòng bảng chia có `isBundle`. `PATCH` và tách nhận `reason`, `note`.

## Kiểm tra

- Jest thư mục floor: 328 test đạt. tsc sạch (ngoài 2 lỗi cũ ở `prisma/seed-*`), eslint sạch, `nest build` đạt.
- **Backfill hàng đợi:** DB local chưa có dòng hàng đợi, nên thử bằng dòng giả trong transaction rồi rollback.
  - 5/5 trường hợp đúng: Phú An; Phước An tổ Phôi và Hàn; Phước An tổ Sơn vào Phú An; lệnh chưa có xưởng vào Phú An.
  - Index chặn dòng RUNNING thứ 2 cùng (tổ, xưởng).
- **Thử luồng thật qua API trên bản sao DB local (đã xoá): 23 bước đúng.**
  - Hàng đợi: QLSX Phú An / Phước An / QLSX chung; 2 xưởng chạy song song; phạm vi xưởng (403).
  - Màn quét: theo xưởng của máy; máy chưa gắn xưởng; báo lệnh xưởng khác ở máy Phước An bị chặn 409.
  - Dòng theo bó: tách 400, đổi số cây 400, đổi máy cần "Máy hư".
  - Nhật ký và "lệnh có điều chuyển" đúng.

## Lưu ý triển khai

- Backfill hàng đợi chưa chạy trên dữ liệu thật (local trống): nên chạy thử trên bản sao production trước khi deploy.
- Máy chưa gắn xưởng (local: `LASER`, `NHANTEST1`) được tính là Phú An. QLSX nên gắn xưởng cho mọi máy.
- QLSX Phước An không thấy và không thao tác hàng đợi Sơn, vì Sơn của Phước An làm ở Phú An: QLSX Phú An xếp.
- Admin / KHSX / Sếp vẫn không thao tác hàng đợi (vai trò như cũ).
- **Còn lại của đợt C:**
  - **C2:** đã làm cùng ngày - xem `changelog-2026-11-14-dot-c2-tien-do-may-xong-phoi.md`.
  - **C3:** máy rảnh tự kéo lệnh kế tiếp đủ sắt (tính cả sắt đã nhập kho cho lệnh); báo thủ kho xuất sắt; báo nhóm cần biết (câu 5 chốt 14/11: KHSX + QLSX xưởng của máy, không thêm Tổ Hàn).
  - **C4:** công cụ đo năng suất (C4a) đã làm cùng ngày - xem `changelog-2026-11-14-dot-c4a-do-nang-suat-may-cat.md`; luật nửa ca (C4b) chờ số đo sau 2–4 tuần chạy thật.
