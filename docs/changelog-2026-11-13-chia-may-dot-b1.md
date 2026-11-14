# 13/11/2026 - Chia sắt cho máy cắt, đợt B1 (bảng "Chia máy cắt" của QLSX xưởng)

Theo "Quy tắc chia sắt cho máy cắt" (Sếp tổng hợp 07/11) và các câu Sếp chốt 13/11:
- câu 6: tạm chia theo tỉ lệ, chưa áp nửa ca;
- câu 7: cây có lỗ ô van không cắt máy tự động;
- câu 8: hệ thống tự chia, QLSX xưởng chỉnh linh hoạt;
- câu 10: lệnh sau đủ sắt thì kéo lên.

Bảng này chỉ là KẾ HOẠCH cho tổ Phôi: luồng quét QR và hàng đợi tổ không đổi. FE đi kèm: xem changelog cùng tên ở repo FE.

## Thay đổi

1. **Bảng chia** `cut_allocations` (model `CutAllocation`, enum `CutMachineClass` = `TU_DONG` | `LASER`).
   - Mỗi dòng giao một phần số cây của 1 kiểu cắt (phương án APPROVED) cho 1 máy cắt của xưởng.
   - Lưu: lớp máy, số cây, đoạn dập trên cây (chỉ LASER), thứ tự cắt `seq`, `isManual` (QLSX đã sửa tay).
2. **API `/floor/cut-allocation`** (FloorController, chỉ QLSX; mọi route trả cùng 1 bảng):
   - `GET ?workshopId=`: máy, dòng, "Chưa chia", "Chờ sắt", số dòng cũ, cảnh báo.
   - `POST auto {mode}`:
     - `append`: chia phần cây chưa có dòng;
     - `redo`: xoá dòng tự chia, giữ dòng sửa tay rồi chia lại.
     - Cả hai đều dọn dòng cũ trước và xếp lại thứ tự cắt trên mọi máy theo ưu tiên.
   - `POST add`: "Chia luôn" 1 cặp (lệnh, loại sắt) dù hệ thống chưa thấy đủ sắt. Dòng tạo ra có `isManual = true` nên "Chia lại" giữ nguyên.
   - `PATCH :id` (đổi máy / số cây), `POST :id/split` (tách), `POST reorder` (xếp lại 1 máy), `DELETE :id`. Sửa xong dòng thành `isManual`.
   - **Phạm vi:**
     - QLSX có xưởng chỉ thao tác xưởng mình (403).
     - QLSX chung phải gửi `workshopId` (400).
     - Xưởng không có máy cắt đang dùng: `auto` / `add` báo 400; `GET` chỉ cảnh báo.
   - **Chặn khi sửa tay:**
     - dòng đã cũ: 409;
     - máy đích không phải máy cắt đang dùng của đúng xưởng: 400;
     - dòng LASER sang máy tự động khi xưởng cho laze và có máy laze: 400;
     - số cây vượt phần còn trống của kiểu cắt: 400.
3. **Luật chia** (`floor/cut-allocation.util.ts`, hàm thuần):
   - **Thứ tự lệnh:**
     - N1 (ngày "Bắt đầu Phôi", PHOI_START) sớm trước;
     - rồi booking gần nhất (DRAFT/CONFIRMED, `bookingDueDay`);
     - rồi hạn PI, rồi id.
   - **Chỉ tự chia (lệnh, loại sắt) đã ĐỦ SẮT** = đã xuất (`SteelIssue` gốc) + còn giữ chỗ ACTIVE ≥ số cây cần, cùng ngữ nghĩa `getIssuePlan`.
     Loại chưa đủ nằm ở "Chờ sắt".
   - **Lớp máy theo từng nhóm cây của kiểu cắt** (`classifyPatternMachines`):
     - LASER (có đoạn dập) → máy laze;
     - TU_DONG → máy tự động;
     - xưởng khoá máy tự động (Phước An) → mọi cây vào máy tự động;
     - xưởng thiếu 1 loại máy thì dồn sang loại còn lại, kèm cảnh báo.
   - **Số máy cho 1 lệnh** (theo từng nhóm máy):
     - Số quy cách < số máy: chia đều cây (máy chia theo D'Hondt, rồi rải cây cho tải các máy bằng nhau nhất).
     - Số quy cách ≥ số máy: quy cách lớn nhất r = ⌊lớn nhất / lớn nhì⌋ → 1 / 2 / 3 máy; các quy cách khác mỗi loại 1 máy, vào máy đang nhẹ nhất.
   - **Ràng buộc chung:**
     - kiểu cắt theo bó (MC Tự động, `bundles` khác null) không tách sang 2 máy;
     - không chia quá số cây của kiểu cắt (kể cả khi dòng sửa tay đã lấn sang lớp máy kia).
   - **Thứ tự cắt trên máy:** theo lệnh; trong lệnh gom theo loại sắt (loại có uốn trước); kiểu cắt có đoạn uốn (UON) cắt trước.
4. **Dòng cũ** (không hiện, dọn ở lần chia kế tiếp):
   - phương án không còn APPROVED;
   - lệnh DONE / CANCELLED / tổ Phôi đã "Chuyển PI tiếp";
   - lệnh không còn dòng thuộc xưởng;
   - máy ngừng, chuyển xưởng hoặc không còn là máy cắt.
5. **Thông tin mỗi dòng:**
   - lệnh + ngày ưu tiên, loại sắt, chiều dài cây, số cây;
   - kiểu cắt (đoạn × số đoạn) kèm bước Uốn / Dập / Khoan (DUC_LO) / Tán của từng đoạn (từ định mức mảnh của đúng phương án);
   - chi tiết ra (`pieceSummary`), đoạn dư cả loại sắt, bó.
6. **Tiến độ xấp xỉ** theo máy: đoạn đã báo CUT (chưa bị đảo) qua QR tại máy đó cho cùng (lệnh, loại sắt).
7. **Hàm dùng chung** `cutting-proposals/proposal-segment-info.util.ts`:
   - nguồn định mức + số bộ của phương án;
   - nhu cầu đoạn dập và bước công đoạn theo (loại sắt, chiều dài), chạy gộp cho nhiều phương án.

   `classifyProposalMachines` (chi tiết phương án) chuyển sang dùng hàm này, kết quả không đổi.
8. **Hiệu năng:**
   - GET tối đa 12 truy vấn dù xưởng nhiều lệnh.
   - `auto` / `add` / sửa tay chạy trong 1 giao dịch, khoá theo xưởng, hạn 30 giây.
   - Thứ tự cắt đặt bằng 1 câu UPDATE cho cả loạt.

## DB

Migration `20261113160000_cut_allocations`:
- enum `CutMachineClass`;
- bảng `cut_allocations` (CHECK `barCount > 0`);
- FK tới xưởng, máy, PI, phương án, kiểu cắt, người sửa;
- chỉ mục theo (xưởng, máy, seq), PI, phương án, kiểu cắt.

## Deploy

`prisma migrate deploy`, không cần seed. Trước khi dùng, QLSX khai máy cắt theo xưởng (đợt A, "Sản lượng xưởng → Máy & tem QR").

## Kiểm tra

- jest `floor` + `cutting-proposals`: 29 bộ, 739 test pass. Có test thuật toán đối chiếu vét cạn cho phần rải cây, và test GET ≤ 12 truy vấn.
- tsc chỉ còn 2 lỗi cũ ở `prisma/seed-*.ts`; `nest build` được; eslint 0 lỗi.
- Thử thật trên BE local (dữ liệu dump; máy thử `THU-*` tạo qua API như QLSX làm):
  - Phú An (4 laze + 1 tự động):
    - sắt hộp có đoạn dập rải 3/3/2/2 cho 4 máy laze; sắt phi không lỗ vào máy tự động, kiểu cắt có uốn xếp trước;
    - lệnh N1 10/11 trước lệnh N1 21/11.
  - Phước An: mọi dòng vào 2 máy tự động; lệnh N1 14/11 trước 15/11; tải 2 máy cân 8/8.
  - Các trường hợp chặn đều đúng câu báo:
    - QLSX Phú An xem Phước An: 403;
    - dòng có đoạn dập sang máy tự động: 400;
    - số cây vượt kiểu cắt: 400;
    - xếp lại thiếu dòng: 400.
  - Thao tác:
    - "Chia lại" giữ dòng sửa tay và dòng "Chia luôn";
    - tắt 1 máy laze thì dòng của nó thành dòng cũ, "Chia phần còn lại" chia lại đúng 3 cây cho các máy còn lại.
  - Tốc độ: GET 22–39 ms, chia lại 62 ms (dữ liệu local nhỏ, chưa đo trên production).

## Chưa làm / lưu ý

- Hàng đợi tổ Phôi vẫn chung 2 xưởng, mỗi tổ 1 lệnh chạy; màn quét QR chưa lọc theo xưởng / máy. Đổi cùng đợt "QR theo xưởng".
- Đợt C: theo dõi máy rảnh, tự kéo lệnh sau, báo người liên quan. Hiện QLSX bấm "Chia phần còn lại" khi có lệnh mới đủ sắt.
- Câu 9 (đoạn dư chia cho lệnh sau, chia ở bước mua hàng) chưa làm. Luật "dưới nửa ca thì không chia" chưa áp (câu 6).
- Các cách hiểu của IT:
  - N1 = ngày "Bắt đầu Phôi".
  - Một kiểu cắt có thể ra nhiều nhóm LASER khác đoạn dập: gộp 1 dòng, ghi đoạn dập của nhóm đông cây nhất.
  - "Đủ sắt" chỉ cộng phương án thuộc xưởng (lệnh trải 2 xưởng là ca hiếm).
- Tách dòng của kiểu cắt theo bó sang máy khác không bị chặn (QLSX chỉnh tay).
- Tiến độ chỉ xấp xỉ; báo cáo cắt cũ chưa gắn máy không được tính.
