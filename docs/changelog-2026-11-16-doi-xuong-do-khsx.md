# 16/11/2026 - Đổi xưởng của lệnh do KHSX; hàng đợi tổ dời theo khi đổi xưởng

Đi kèm FE: changelog cùng tên ở repo FE.

## Vì sao

- **Quyết định 16/11:**
  - Người đổi xưởng của lệnh là KHSX, không phải QLSX.
  - QLSX không đổi xưởng nữa, kể cả lúc gửi Sếp.
  - Lệnh còn phiếu chuyển hàng chưa nhận thì cảnh báo KHSX lúc bấm đổi xưởng. API cảnh báo đã có từ nhóm B; FE gọi.
- **Lỗi QA V5 (từ review đợt 1 bỏ màn thống kê):** lệnh đã vào hàng đợi tổ Phôi rồi mới đổi xưởng thì hàng đợi không dời theo. Sắt hiện ở khu nhận sắt của xưởng mới, còn lệnh vẫn ở hàng đợi xưởng cũ, nên kẹt nhận sắt / báo cắt.

## Thay đổi

### Quyền đổi xưởng
`PATCH /production-invoices/:id/workshop` (`production-invoices.controller.ts`):
- Nay cần quyền `PRODUCTION_INVOICE:UPDATE` + vai KHSX (`PRODUCTION_PLANNER`) hoặc `ADMIN`.
- Trước đây cần `APPROVE` + mfgRole QLSX. QLSX gọi nay nhận 403.
- Admin không vào được màn Kế hoạch nên chỉ đổi qua API khi xử lý sự cố.
- Body và response không đổi.

### `changeWorkshop()`
Giữ mọi luật cũ:
- mọi SKU chờ QLSX / chờ Sếp / đã duyệt;
- chưa xuất sắt / vật tư;
- khác xưởng hiện tại;
- `lockPisForIssue`;
- cờ kiểm lại phương án cắt;
- đổi nơi nhận dòng mua.

Thêm:
- **Chặn đổi chồng:** sau khoá dòng lệnh, xưởng của lệnh phải còn thuộc tập xưởng lúc đọc. Không thì 409 "Lệnh … vừa được đổi xưởng bởi người khác - tải lại trang rồi thử lại".
- **Dời hàng đợi tổ** trong cùng transaction, sau khi đổi xưởng của SKU: gọi `moveOpenQueueEntriesToPiWorkshop` (file mới `floor/floor-queue-move.util.ts`).
  - Dòng đang chờ / đang chạy sang hàng đợi cùng tổ của xưởng mới, trạng thái chờ, cuối hàng, xoá giờ / người bắt đầu.
  - Tổ Sơn theo nơi sơn nhờ, nên giữa Phú An và Phước An dòng Sơn giữ nguyên.
  - Dòng đã xong giữ ở xưởng cũ.
  - Khoá hàng đợi cũ + mới tăng dần, đọc lại dòng sau khoá.
  - Không tự chạy lệnh kế ở xưởng cũ.
- **Realtime:** có dòng dời thì sau commit phát `FLOOR_REPORT` / `UPDATED`. Màn hàng đợi của QLSX tự tải lại.
- **Thông báo PI_WORKSHOP_CHANGED** có thêm:
  - `queueMoves` (tên xưởng);
  - `workshopIds` (xưởng cũ + mới + xưởng hàng đợi dời);
  - `approved` (lệnh có ít nhất 1 SKU đã duyệt).
  - Tra tên xưởng lỗi thì vẫn gửi thông báo, chỉ thiếu phần hàng đợi.

### QLSX gửi Sếp
Áp cho `sendItemToBoss` và `sendBatchToBoss`.
- **Luật áp cho mọi QLSX** (trước đây chỉ QLSX có gắn xưởng) và xét CẢ lệnh: mọi SKU đang chờ QLSX / chờ Sếp / đã duyệt có xưởng.
  - Gửi xưởng khác → 400 "Không đổi xưởng khi gửi Sếp - lệnh đang ở <xưởng> (vừa có thay đổi thì tải lại trang); cần sang xưởng khác thì báo KHSX đổi xưởng".
  - Lệnh chưa SKU nào có xưởng (dữ liệu cũ) vẫn chọn được.
- **Không ghi đè việc đổi xưởng chạy chồng:**
  - Lệnh ghi đổi trạng thái kèm điều kiện "xưởng như lúc đọc" và "đang chờ QLSX".
  - Gửi cả lệnh thì ghi trong transaction; đếm thiếu dòng thì huỷ cả lượt.
  - Câu 409: "Lệnh … vừa thay đổi (đổi xưởng hoặc đã được xử lý) trong lúc gửi Sếp - tải lại trang rồi thử lại".
- Nhánh bật cờ "kiểm lại phương án cắt" khi đổi xưởng lúc gửi Sếp nay không còn chạy tới. Vẫn giữ để phòng hờ, có ghi chú.

### Thông báo
**Lọc người nhận** (`notifications/recipient-resolver.service.ts`): `workshopsOfOrder` đọc `params.workshopIds` (mảng chuỗi số) trước khi tra theo mã lệnh. Lý do: thông báo phát sau commit, lúc đó mọi SKU đã ở xưởng mới, nên nếu tra theo mã lệnh thì QLSX gắn xưởng cũ bị loại.

**Các loại thông báo** (`notifications/notification-types.ts`):
- **PI_WORKSHOP_CHANGED:**
  - Người nhận: Sếp + KHSX + QLSX các xưởng liên quan, trừ người bấm.
  - Câu trung lập, kèm phần hàng đợi (`buildPiWorkshopChangedMessage`). Ví dụ: "Lệnh MY-313 (2 SKU) đã đổi xưởng cơ khí. Lý do: …. Hàng đợi tổ Phôi, Hàn đã chuyển sang cuối hàng đợi Xưởng Phước An. Tổ Hàn ở Xưởng Phú An không còn lệnh đang chạy: QLSX Xưởng Phú An bấm "Bắt đầu lệnh đầu hàng đợi" nếu hàng đợi còn lệnh chờ."
  - Link:
    - lệnh đã có SKU duyệt: Sếp → "Tổng hợp lệnh SX" (boss); KHSX → "Tổng hợp lệnh SX" (production_plan); QLSX → "Sản lượng xưởng";
    - lệnh chưa SKU nào duyệt: chờ duyệt / màn lệnh SX.
- **PI_CUTTING_RECHECK_REQUIRED và PI_TIMELINE_NEEDS_REPLAN:** `notifyActor: true`.
  - KHSX tự bấm đổi xưởng vẫn nhận nhắc việc. Mặc định người bấm bị loại.
  - PI_CUTTING_RECHECK_REQUIRED: đóng bản còn mở của cùng lệnh trước khi phát bản mới, nên đổi xưởng nhiều lần không bị trùng.
  - Câu "QLSX đổi xưởng …" đổi thành "Lệnh đổi xưởng …".

### Câu lỗi khác
"Gửi QLSX khác xưởng của phương án cắt": đuôi "…rồi để QLSX chuyển xưởng" đổi thành "…rồi bấm "Đổi xưởng" ở lệnh".

Không đổi API contract, không có migration.

## Kiểm tra

- **jest** các thư mục `floor`, `production-invoices`, `notifications`: 34 bộ, 1052 test đạt.
  - Test mới:
    - `floor-queue-move.util.spec.ts`;
    - `recipient-resolver.service.spec.ts` (workshopIds);
    - `notifications.service.spec.ts` (notifyActor chạy thật qua `emit`);
    - `notification-links.spec.ts` (câu, người nhận, link 2 nhánh);
    - `production-invoices.service.spec.ts`: dời hàng đợi, workshopIds, realtime, chặn đổi chồng, lệnh lẫn 2 xưởng, gửi Sếp chồng (transaction riêng), luật gửi Sếp xét cả lệnh, đóng nhắc trùng;
    - `production-invoices.controller.spec.ts` (metadata quyền).
  - Test cũ đã sửa: 4 ca "QLSX đổi xưởng lúc gửi Sếp → bật cờ" thay bằng các ca "QLSX gửi Sếp không đổi xưởng", vì luật đã đổi.
- **tsc:** chỉ còn 2 lỗi cũ ở `prisma/seed-*`. `nest build` đạt. eslint 0 lỗi. prettier sạch. Các file đều LF.
- **QA vòng 1** (review độc lập + nghiệm thu trên bản sao DB local): Không đạt.
  - Lỗi C1 (Cao): QLSX xưởng cũ không nhận thông báo đổi xưởng, vì bộ lọc "QLSX theo xưởng" tra xưởng sau khi đã đổi. Đã sửa bằng `workshopIds`.
  - Các phần còn lại đạt: quyền, luật cũ, dời hàng đợi, gửi Sếp, khung phiếu chuyển, giao diện desktop / 375 px.
- **Kiểm lại** (3 góc soát code + nghiệm thu lại trên app thật, bản sao DB đã xoá): app đạt 6/6 kịch bản.
  - QLSX cả 2 xưởng nhận tin.
  - Link đúng từng vai.
  - 2 lần đổi xưởng song song: 1 lần 200, các lần còn lại 409; thông báo / nhật ký / hàng đợi chỉ ghi 1 lần.
  - Màn hàng đợi QLSX tự cập nhật khoảng 3 giây sau khi đổi.
  - Hồi quy đạt.
- **Các điểm phát hiện thêm lúc kiểm lại** (gửi Sếp chồng với đổi xưởng; luật gửi Sếp xét cả lệnh; link theo trạng thái duyệt; nhắc trùng; câu "nếu hàng đợi còn lệnh chờ") đã sửa. Phần này qua soát đối kháng và jest; chưa chạy lại trên app.

## Lưu ý deploy

- **Deploy BE và FE cùng lúc.** Lệch nhau thì:
  - BE trước: QLSX bấm nút cũ nhận 403;
  - FE trước: KHSX bấm nút mới nhận 403.
- **Báo trước:**
  - Báo QLSX + KHSX: từ nay KHSX đổi xưởng. QLSX thấy lệnh sai xưởng thì báo KHSX.
  - Lệnh đang chạy ở xưởng cũ mà bị đổi xưởng thì tổ đó không còn lệnh chạy: QLSX xưởng cũ bấm "Bắt đầu lệnh đầu hàng đợi" nếu hàng đợi còn lệnh chờ.
- Không migration, không biến môi trường mới.

## Còn lại (mức Thấp, để sau)

- **Khe đua hiếm ở `floor-admin.service.ts`:**
  - "Thêm lệnh" / tự thêm lệnh vào hàng Phôi tính xưởng ngoài transaction;
  - "Bỏ" dòng không khoá hàng đợi;
  - "Mở lại lệnh vừa chuyển" có thể mở lại dòng đã xong ở xưởng cũ của lệnh vừa đổi xưởng.
- Chặn đổi chồng so theo tập xưởng, nên lọt với lệnh dữ liệu cũ lẫn 2 xưởng.
- Lệnh dữ liệu cũ mọi SKU chưa có xưởng: QLSX xưởng khác không nhận tin đổi xưởng.
- Chưa có test tích hợp trên DB thật cho các ca đồng thời.
- Dọn nhánh `flagRecheckAfterSendToBoss` không còn chạy tới.
