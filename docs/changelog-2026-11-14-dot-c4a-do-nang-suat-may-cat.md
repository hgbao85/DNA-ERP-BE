# 14/11/2026 - Đợt C4a: đo năng suất máy cắt

Câu 7 đợt C (Sếp chọn đề xuất của IT): chưa có số năng suất thì hệ thống tự đo từ giờ công nhân báo qua mã QR tại máy cắt trong 2–4 tuần chạy thật. IT gửi số đo để Sếp chốt, rồi mới áp luật "dưới nửa ca thì không chia".

Đợt này chỉ ĐO. C4b (luật nửa ca, báo trước giờ máy xong) chờ Sếp chốt số. FE đi kèm: xem changelog cùng tên ở repo FE.

## Thay đổi

1. **Endpoint chỉ đọc** `GET /floor/stats/cut-machines?workshopId=&from=&to=`:
   - file: `cut-machine-stats.service.ts`, `cut-machine-stats.util.ts` (phần tính thuần), `dto/cut-machine-stats.dto.ts`;
   - quyền như báo cáo sản lượng `/floor/stats`: QLSX, Sếp, Admin;
   - phạm vi xưởng như bảng chia máy: QLSX gắn xưởng chỉ xem xưởng mình (gửi xưởng khác → 403); người không gắn xưởng phải chọn xưởng (→ 400);
   - khoảng ngày giờ VN, mặc định 14 ngày tới hôm nay, tối đa 62 ngày.
2. **Nguồn số:** lần báo loại cắt ở máy cắt gắn xưởng, kể cả máy đã ngừng.
   - Bỏ lần báo đã Hoàn tác và cả dòng hoàn tác.
   - Máy chưa gắn xưởng không tính.
3. **Cách tính** (mỗi máy × ngày giờ VN):
   - số lần báo, giờ báo đầu / cuối, số đoạn, mét cắt;
   - **cây quy đổi** = Σ số đoạn × (cỡ đoạn + lưỡi cắt) ÷ (chiều dài cây − tề đầu):
     - chiều dài cây theo phương án cắt đã duyệt của (lệnh, loại sắt); không có thì lấy cây chuẩn đầu tiên trong cấu hình (6000 mm);
     - lưỡi cắt / tề đầu theo loại máy, lấy từ cấu hình;
   - **cây/giờ** chỉ tính khoảng thời gian giữa 2 lần báo liên tiếp trong ngày:
     - bỏ lần báo đầu ngày (chỉ đánh dấu bắt đầu);
     - bỏ khoảng dài hơn 120 phút (coi là nghỉ);
     - trừ nghỉ trưa 11:30–13:00;
     - tổng dưới 30 phút thì không có cây/giờ.
   - **Tổng hợp:**
     - theo máy và theo loại máy: số ngày có số, cây/ngày trung bình, trung vị, cây/giờ;
     - theo (loại máy, loại sắt), để sau này áp luật nửa ca theo quy cách. Lần báo có nhiều loại sắt thì chia cây theo từng loại, chia phút theo tỷ lệ cây.
4. **Không có migration**, không ghi dữ liệu.

## Kiểm tra

- **Jest:**
  - test mới: `cut-machine-stats.util.spec` 22 test, `cut-machine-stats.service.spec` 15 test, thêm 1 dòng vào ma trận quyền của `floor.controller.spec`;
  - mọi spec của file BE đang đổi (32 bộ): 1192 test đạt.
- tsc sạch (ngoài 2 lỗi cũ ở `prisma/seed-*`), eslint sạch, `nest build` đạt.
- **Thử thật qua API trên bản sao DB local (đã xoá): 37 bước đúng.**
  - Công nhân báo qua QR 3 lần ở máy tự động và 2 lần ở máy laze. Số lần báo, số đoạn, mét và cây quy đổi khớp tính tay. Chiều dài cây lấy đúng theo phương án (5030 / 5020 mm, không dùng 6000).
  - QLSX hoàn tác 1 lần báo: cả lần báo đó và dòng hoàn tác không tính.
  - **Phạm vi và quyền:**
    - QLSX Phú An xem Phước An → 403;
    - QLSX Phước An chỉ thấy máy Phước An;
    - Sếp không chọn xưởng → 400; chọn xưởng → 200;
    - KHSX → 403.
  - **Khoảng ngày:** 62 ngày → 200; 63 ngày → 400; ngày ngược hoặc sai dạng → 400.
  - Phần cây/giờ theo khoảng thời gian (nghỉ trưa, nghỉ dài, ngưỡng 30 phút) chỉ thử bằng unit test, vì các lần báo thử cách nhau vài giây.

## Lưu ý triển khai

- **Khi nào có số:** chỉ sau khi bảng chia máy (đợt A/B/C) lên hệ thống thật và QLSX đã gắn xưởng + loại máy cho từng máy cắt.
- **Gửi số cho Sếp:** sau 2–4 tuần, mở *Sản lượng xưởng → Báo cáo → Năng suất máy cắt*, chọn khoảng, bấm Tải Excel. Người mở là QLSX, hoặc Sếp / Admin (qua API, phải chọn xưởng).
- **Cây/giờ phụ thuộc cách công nhân báo:** báo thưa (vd cả ca 1 lần) thì chỉ có cây/ngày, không có cây/giờ.
- **Còn lại:** C4b (luật nửa ca + báo trước giờ máy xong), làm sau khi Sếp chốt số.
