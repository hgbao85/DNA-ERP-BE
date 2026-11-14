# 14/11/2026 - Đợt C3: máy cắt rảnh tự kéo lệnh kế tiếp

Làm theo các câu Sếp trả lời đợt C (14/11):
- **Câu 1:** máy rảnh thì hệ thống tự chia luôn rồi báo QLSX; QLSX vẫn sửa được.
- **Câu 2:** máy rảnh = đã cắt đủ số cây được chia.
- **Câu 4:** đủ sắt tính cả sắt đang giữ chỗ trong kho; kéo lệnh thì báo thủ kho xuất ngay.
- **Câu 6:** không chia bớt việc máy khác; máy rảnh kéo lệnh kế tiếp, lệnh gần nhất trước.

Câu 5 (báo thêm người khi kéo lệnh), chốt 14/11, không đổi code:
- KHSX và QLSX xưởng của máy nhận tin `CUT_ORDER_PULLED`;
- không thêm tin cho Tổ Hàn: QLSX đã nhận tin và là người xếp hàng đợi Hàn;
- Phước An nhận qua QLSX gắn xưởng Phước An (hoặc QLSX không gắn xưởng): cần có tài khoản đó.

Đi sau C2 (changelog `changelog-2026-11-14-dot-c2-tien-do-may-xong-phoi.md`). FE đi kèm: xem changelog cùng tên ở repo FE.

## Thay đổi

1. **Tải theo số cây còn lại** (`cut-allocation.util.ts` `remainingLoadByMachine`):
   - Mọi lần chia ("Chia phần còn lại", "Chia lại", và lúc kéo) tính tải máy = số cây CÒN phải cắt (ước như C2), thay cho tổng số cây.
   - Vì vậy máy đã cắt hết nhận việc mới trước.
   - "Chia lại" vẫn ước trên mọi dòng rồi chỉ cộng phần còn lại của dòng sửa tay.
2. **Máy rảnh tự kéo lệnh** (`CutAllocationService.autoPull`, 1 transaction, khoá `cut-allocation:<xưởng>`):
   - **Kích hoạt:** nhắc nền thấy máy IDLE hoặc EMPTY (chưa có dòng).
   - **Lệnh được kéo** phải đủ cả 4 điều kiện:
     - đủ sắt (đã xuất + giữ chỗ ở kho của xưởng này; sắt còn ở kho xưởng khác không tính - xem "Sửa sau thử đầu-cuối");
     - đã "Bắt đầu" (có lệnh SX ACTIVE thuộc xưởng);
     - KHÔNG đang chờ KHSX "Đã kiểm" lại phương án cắt (`cuttingRecheckRequired`, lệnh vừa đổi xưởng: chưa kiểm thì kho chưa chuyển / xuất sắt được);
     - có phần máy rảnh cắt được.
   - **Cách chọn:**
     - Duyệt lệnh theo ưu tiên (N1 → booking → hạn); mỗi lệnh chia thử lên mọi máy như bấm Chia.
     - Lệnh không có phần nào rơi vào máy rảnh thì để dành; lệnh được nhận thì nhận toàn bộ dòng của nó.
     - Dừng khi mọi máy rảnh đã có việc.
   - **Chỉ thêm dòng**, không xoá, không đảo dòng cũ:
     - dòng mới nối vào cuối việc của máy;
     - mỗi dòng ghi nhật ký `AUTO_PULL` (người làm: hệ thống).
   - `steelGapsByPi`: cặp (lệnh, loại sắt) có dòng chia mà sắt đã xuất < cần, kèm mã kho đang giữ sắt (chỉ kho của xưởng này hoặc kho không gắn xưởng).
3. **Hàng đợi Phôi:** lệnh vừa kéo mà chưa có ở hàng đợi tổ Phôi thì tự thêm vào cuối, trạng thái chờ (`FloorAdminService.ensurePhoiQueued`; `queuedById` cho phép rỗng = hệ thống thêm).
4. **Nhắc nền** (`floor-alerts.service.ts`):
   - Có máy rảnh và công tắc bật → kéo; lệnh vừa kéo vào hàng đợi Phôi → báo → phát realtime → tính lại tiến độ (máy vừa nhận việc không bị nhắc "máy rảnh").
   - Thông báo mới:
     - `CUT_ORDER_PULLED` (tin, KHSX + QLSX xưởng đó): "Máy rảnh kéo lệnh …", kèm loại sắt / số cây / máy.
     - `CUT_PULL_STEEL_TO_ISSUE` (cần xử lý, thủ kho của kho đang giữ sắt): "Xuất sắt lệnh … xuống Phôi ngay"; tự đóng khi đã xuất đủ.
   - `CUT_MACHINE_IDLE` khi công tắc bật thì nói rõ: không còn lệnh đủ sắt / đã Bắt đầu / không chờ kiểm lại / máy cắt được.
   - Tự đóng Phôi (C2) giờ cũng phát realtime để màn hàng đợi tự tải lại.
5. **Công tắc** `CUT_AUTO_PULL` (mặc định bật, `off` để tắt; ghi ở `.env.example`).
6. **Migration `20261114120000_cut_auto_pull`:**
   - enum `CutAllocationLogAction` thêm `AUTO_PULL`;
   - `floor_queue_entries.queuedById` cho phép rỗng, khoá ngoại đổi sang `ON DELETE SET NULL`.

## Kiểm tra

- Jest floor + notifications: 463 test đạt. tsc sạch (ngoài 2 lỗi cũ ở `prisma/seed-*`), eslint sạch, `nest build` đạt, `prisma migrate status` khớp.
- **Thử thật qua API trên bản sao DB local (bật nhắc nền, đã xoá): 29 bước đúng.**
  - **Laze:**
    - QLSX bỏ 1 cây dập ở Laze 1 rồi báo đủ 3 cây ở Laze 2 → Laze 2 tự kéo cây đó về, nối cuối.
    - Nhật ký "Hệ thống kéo"; KHSX + QLSX Phú An nhận tin.
    - Lệnh đã xuất đủ sắt nên không báo thủ kho; lệnh tự vào hàng đợi Phôi.
  - **Máy tự động:**
    - Báo đủ phần còn lại → máy rảnh nhưng KHÔNG kéo PI-2026-005 vì đang chờ KHSX kiểm lại phương án cắt; có nhắc "máy rảnh".
    - KHSX bấm "Đã kiểm" → lượt kiểm sau máy kéo 5 cây của lệnh đó; nhắc máy rảnh tự đóng.
    - Thủ kho phụ trách kho đang giữ sắt nhận "Xuất sắt lệnh … xuống Phôi ngay".
    - Lệnh chờ sắt PI-2026-001 không bị kéo.
  - **Laze 3** hết việc mà không còn lệnh nào kéo được → nhắc "máy rảnh" với câu giải thích mới.
- **Thử đầu-cuối lần 2 (sau sửa đổi xưởng, cùng cách, bản sao đã xoá):** 28 bước đúng, 1 câu kiểm của script viết sai (đếm 2 dòng giữ chỗ cùng kho thành 2 kho; thực tế cả 2 dòng đều ở kho Phôi Phú An).
  - **Lệnh vừa đổi xưởng (PI-2026-005, Phước An → Phú An), sắt còn giữ ở kho Phôi Phước An:**
    - KHSX bấm "Đã kiểm" → lệnh nằm ở "Chờ sắt" (có 0 cây), máy Tự động 1 rảnh không kéo, thủ kho Phước An không bị báo "xuất ngay";
    - máy có nhắc "máy rảnh".
  - **Chuyển kho:** thủ kho Phước An lập phiếu chuyển đổi xưởng → thủ kho Phôi Phú An nhận đủ → giữ chỗ chuyển sang kho Phôi Phú An.
  - **Lượt kiểm kế tiếp:** máy kéo lệnh; tin "Xuất sắt lệnh … xuống Phôi ngay" tới đúng 2 thủ kho Phôi Phú An.
  - **Xuất sắt qua phiếu XK thật** (lập phiếu → xác nhận kèm ảnh phiếu ký):
    - xuất 4/5 cây → tin vẫn mở;
    - xuất nốt 1 cây → chưa có lượt kiểm thì tin chưa đóng; lượt kiểm kế tiếp → tin đóng với mọi người nhận;
    - Phôi nhận 2 tin "sắt đã xuất".
- `cut-allocation.service.spec`: 75 test đạt (thêm 4: bảng chia, máy rảnh kéo, mã kho nhận tin). tsc / eslint / `nest build` sạch.

## Sửa khi review

- Thợ kéo cả lệnh đang chờ KHSX kiểm lại phương án cắt (vừa đổi xưởng). Thủ kho bị yêu cầu xuất sắt mà chưa được phép chuyển / xuất. Sửa: bỏ qua lệnh có `cuttingRecheckRequired`.
- Checksum migration trong DB local lệch với file (file sửa sau khi áp). DB đã đúng nội dung file, nên chỉ cập nhật checksum cho khớp, tránh `migrate dev` đòi dựng lại DB local.

## Sửa sau thử đầu-cuối (14/11 trưa)

- **Lỗi:** lệnh vừa đổi xưởng mà sắt còn giữ ở kho Phôi xưởng cũ vẫn được tính "đủ sắt". KHSX bấm "Đã kiểm" xong:
  - máy rảnh xưởng mới kéo lệnh;
  - tin "Xuất sắt … xuống Phôi ngay" gửi thủ kho kho cũ, nhưng thủ kho này bấm xuất thì bị chặn: sắt của lệnh chỉ xuất được từ kho Phôi xưởng mới, phải chuyển kho trước (phiếu chuyển đổi xưởng).
- **Sửa** (`cut-allocation.service.ts`, `heldInOtherWorkshop`):
  - "đủ sắt" chỉ cộng giữ chỗ ở kho của xưởng đang chia (hoặc kho không gắn xưởng);
  - mã kho trong tin thủ kho cũng chỉ lấy kho đó.
- **Hệ quả:**
  - lệnh đó nằm ở "Chờ sắt" ở cả bảng chia tay lẫn máy rảnh, tới khi kho xưởng mới nhận phiếu chuyển; sau đó máy rảnh kéo và báo đúng thủ kho xưởng mới;
  - đổi cả bảng chia đợt B (bảng này chưa deploy).

## Lưu ý triển khai

- **Có migration mới** (thêm giá trị enum, nới cột): an toàn, không đụng dữ liệu.
- Sau deploy, lượt kiểm đầu (khoảng 1 phút sau khi BE chạy) sẽ cho mọi máy rảnh / chưa có dòng kéo lệnh kế tiếp. Xưởng chưa ai bấm "Chia" sẽ có bảng chia tự lên.
  - Muốn tắt thì đặt `CUT_AUTO_PULL=off`.
  - Nhắc nền tắt (`FLOOR_ALERTS=off`) thì cũng không kéo.
- Thông báo thủ kho đi theo kho đang giữ sắt (đúng mã kho). Trước khi deploy cần đối chiếu production (chỉ đọc): mọi kho giữ sắt Phôi đều có thủ kho được gán. Kho không ai phụ trách thì không ai nhận tin.
- Lệnh vừa đổi xưởng mà sắt còn ở kho xưởng cũ nằm ở "Chờ sắt" ở cả bảng chia tay. Chỉ còn 1 trường hợp hiếm bảng chia tay vẫn chia lệnh đang chờ kiểm lại phương án cắt: sắt của lệnh đã nằm ở kho xưởng mới hoặc kho không gắn xưởng.
- Tin thủ kho "Xuất sắt …" tự đóng ở lượt kiểm nền kế tiếp: chậm nhất 10 phút, hoặc ngay sau thao tác kế tiếp ở xưởng (`/floor`). Xuất sắt không tự gọi lượt kiểm.
- **Rủi ro còn lại (giữ chỗ không theo kho, có từ trước đợt này, đang chờ thiết kế lại):** bản sửa "đủ sắt chỉ tính giữ chỗ ở kho của xưởng" tin vào `warehouseId` của dòng giữ chỗ, nhưng có 2 chỗ làm dòng giữ chỗ lệch kho với hàng thật:
  - `StockReservationsService.creditPool`: hàng mua về cộng vào dòng đầu tiên của pool (lệnh, vật tư, quy cách), không xét kho nhận; kho nhận chỉ dùng khi pool rỗng.
    - Lệnh vừa đổi xưởng mà hàng về kho xưởng mới thì phần đó bị cộng vào dòng còn ở kho xưởng cũ.
    - Hệ quả: lệnh kẹt "Chờ sắt" dù sắt đã ở kho mới; tin "Xuất sắt" không tới thủ kho kho mới; phiếu chuyển đổi xưởng còn đòi chuyển phần hàng không có ở kho cũ.
  - `reserveOrAdjust` (khoảng dòng 144–150): tính lại phương án ở kho khác thì dòng giữ chỗ chưa tiêu tự đổi `warehouseId` sang kho mới, không có phiếu chuyển.
    - Hệ quả ngược lại: lệnh được tính "đủ sắt" ở xưởng mới và máy rảnh có thể kéo, trong khi sắt thật còn ở kho cũ; thủ kho mới xuất thì thiếu tồn.
  - Tạm thời: QLSX dùng "Chia luôn" cho lệnh kẹt "Chờ sắt" khi đã thấy sắt thật; thủ kho đối chiếu tồn thật trước khi xuất. Sửa gốc theo thiết kế lại phần giữ chỗ theo kho.
- **Còn lại của đợt C:**
  - câu 5: đã chốt, không đổi code; Phước An cần có tài khoản QLSX gắn xưởng Phước An mới có người nhận tin máy cắt của xưởng đó;
  - C4: công cụ đo năng suất (C4a) đã làm cùng ngày - xem `changelog-2026-11-14-dot-c4a-do-nang-suat-may-cat.md`; luật nửa ca (C4b) chờ Sếp chốt số đo sau 2–4 tuần chạy thật.
