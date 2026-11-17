# 17/11/2026 - Sửa 4 lỗi sót: số đỏ KCS Phôi, tin kết quả KCS, số đỏ "Sản lượng xưởng", tranh chấp đợt cắt

Chỉ BE. Không migration, không đổi API (route, body, dạng response giữ nguyên). FE không đổi.

## Vì sao

Lúc thiết kế "KCS theo ngoại lệ / gom kiểu báo / ghi thời gian" (17/11), soát chéo thấy 4 lỗi đang chạy:

1. Số đỏ "KCS Phôi" không đếm đợt chân nhôm (vật tư không gắn mảnh) đang chờ KCS, dù màn KCS chân nhôm nằm trong trang KCS Phôi.
2. KCS chấm 3 kiểu đợt sau mà không phát tin kết quả (chỉ đợt cắt và lô mảnh có):
   - công đoạn phụ sắt (Uốn / Dập / ...);
   - pat / Vật tư TP theo công đoạn;
   - chân nhôm.
3. Số đỏ menu "Sản lượng xưởng" đếm nhóm công đoạn phụ không tách theo người báo, nên lệch với số thẻ. Ví dụ A và B cùng báo Dập cho 1 SKU: danh sách 2 thẻ, số đỏ 1.
4. Đợt cắt bị tranh chấp khi nhiều việc chạy cùng lúc. Lúc báo cắt, phần mềm tìm đợt đang mở ở NGOÀI transaction rồi cộng số vào đợt đó mà không khoá:
   - Công nhân báo đúng lúc QLSX bấm "Gửi KCS": số rơi vào đợt vừa gửi KCS. Nếu KCS đã chấm thì số đó coi như đạt mà không ai chấm.
   - Công nhân báo đúng lúc QLSX hủy hết số của đợt (đợt bị xoá): công nhân nhận lỗi 500.
   - 2 lần "Gửi KCS" cùng lúc: cả 2 đều thành công, ghi đè giờ gửi, phát tin "chờ KCS" 2 lần.
   - "Gửi KCS" đúng lúc đợt bị hủy hết: lỗi 500.
   - Hoàn tác lần lưu cuối đúng lúc gửi KCS: trừ vào đợt đã gửi KCS.

## Thay đổi

### 1. Số đỏ KCS Phôi
`work-queue.service.ts` - `countKcs`: phần Phôi cộng thêm số đợt chân nhôm (`material_yield_step_bundles`) đang chờ KCS.

### 2. Tin kết quả KCS cho 3 kiểu đợt
`qc-reviews.service.ts` - `reviewStepBundle`, `reviewPieceStep`, `reviewMaterialYieldStep`: sau khi lượt chấm đã lưu, phát tin như đợt cắt / lô mảnh.
- Có lỗi: `QC_FAILED` tới tổ Phôi + QLSX. Không lỗi: `QC_PASSED` tới QLSX.
- Định nghĩa 2 loại tin không đổi (người nhận, câu chữ).
- Dùng mã PI thật để chỉ QLSX đúng xưởng của PI nhận tin.
- Best-effort: đọc mã PI hoặc tạo tin lỗi thì chỉ ghi log, lượt chấm vẫn thành công. Hàm mới `notifyQcResultForPi`.

### 3. Số đỏ "Sản lượng xưởng"
`floor-admin.service.ts` - `summary`: nhóm công đoạn phụ chờ gửi KCS tách thêm theo người báo, khớp danh sách (`floor-review.service.ts` `listOpen`) và cảnh báo chờ lâu (`floor-alerts.service.ts` `countStaleByStage`).

### 4. Đợt cắt chạy cùng lúc
`steel-issues.service.ts`:
- **`recordCutBatch` (báo cắt, gồm đường quét QR):** chọn đợt đang mở TRONG transaction.
  - Khoá theo (lô sắt, SKU, người báo), để cùng người báo 2 lần cùng lúc không mở 2 đợt.
  - Khoá các đợt ứng viên bằng `SELECT ... FOR UPDATE`, không `LIMIT`. Đợt vừa gửi KCS hoặc vừa bị xoá tự bị loại sau khi chờ khoá. Không còn đợt phù hợp thì mở đợt mới.
  - Luật cũ giữ nguyên: mỗi người 1 đợt; đợt cũ chưa có người mở thì người báo đầu tiên nhận.
  - Gửi lại cùng Idempotency-Key mà đợt của lần báo đó đã bị hủy hết thì trả 409 "Lần báo này đã ghi nhận trước đó và đã bị QLSX hủy - xem lý do ở "Sản lượng của tôi", cần thì báo lại". Trước đây ra 409 câu kỹ thuật về khoá trùng.
- **`finishCutBundle` (QLSX "Gửi KCS" đợt cắt):** đổi trạng thái CÓ ĐIỀU KIỆN (đang cắt). Chỉ 1 lời gọi thắng; lời gọi thua nhận 409, không ghi đè giờ gửi, không phát tin lần 2:
  - đợt vừa bị hủy hết: "Đợt cắt … vừa bị hủy hết số - không còn gì để gửi KCS, tải lại trang";
  - đợt đã / vừa gửi KCS: "Đợt cắt … đã được gửi KCS rồi / vừa được gửi KCS (trạng thái …) - tải lại trang".
- **`undoLastCutBatch` (hoàn tác lần lưu cuối):**
  - Khoá dòng đợt rồi kiểm lại trạng thái trong transaction, giống `reverseCut`. Đợt đã gửi KCS hoặc không còn thì 409.
  - Đọc số đoạn hiện tại trong transaction.
  - Route của hàm này đã đóng (403) từ đợt 1; sửa để không còn lỗ nếu mở lại.

Thứ tự khoá: chỉ báo cắt lấy khoá theo người rồi mới khoá dòng đợt. Gửi KCS / hủy / hoàn tác chỉ khoá 1 dòng đợt, nên không có vòng chờ.

## Kiểm tra

- Test tích hợp mới `test/integration/cut-bundle-race.integration.spec.ts`, chạy trên Postgres test thật:
  - Một kết nối thứ hai giữ khoá chưa commit để ép xen kẽ chắc chắn.
  - Code cũ: 5 ca tranh chấp đỏ đúng vì lỗi (cộng vào đợt đã gửi KCS, lỗi khoá ngoại, lỗi "không tìm thấy dòng", gửi KCS 2 lần, hoàn tác trên đợt đã gửi). Sau khi sửa: xanh.
  - Kèm các ca hồi quy: cộng dồn cùng đợt, nhận đợt chưa có người mở, mở đợt mới sau khi gửi KCS, gửi KCS bình thường.
  - Sau soát độc lập thêm:
    - dữ liệu gây nhiễu (đợt của người khác, lô khác, SKU khác, đợt đã gửi KCS không được chọn);
    - cùng người báo 2 lần cùng lúc thì chỉ 1 đợt;
    - QLSX hủy một phần đúng lúc báo thì cộng vào đúng đợt;
    - mỗi ca tranh chấp khẳng định đã thật sự chờ khoá;
    - dọn dữ liệu chỉ xoá theo id đã có.
  - Tổng 12 ca, chạy 3 lần liên tiếp đều xanh.
  - Cố ý làm hỏng bản sửa 5 cách, test đều đỏ: bỏ khoá dòng lúc báo cắt; bỏ khoá theo người; gửi KCS không điều kiện; đổi sang `SKIP LOCKED`; hoàn tác không khoá.
- Unit: thêm test cho từng lỗi. Lỗi 1 và 3 chạy đỏ trước khi sửa; lỗi 2 đỏ khi chạy với bản cũ của file.
  - Thêm test: tin phát sau khi transaction xong; đọc mã PI đúng PI; đọc mã PI lỗi thì không phát tin; gửi lại khoá sau khi đợt bị hủy.
  - 9 bộ liên quan (work-queue, qc-reviews, floor-admin, steel-issues service + controller, floor-review, floor-review-list, floor-scan, floor-alerts): 450 test đạt.
  - eslint + prettier sạch; `tsc --noEmit -p tsconfig.build.json` sạch.
- Soát độc lập 3 góc (đồng thời, hồi quy hành vi, độ phủ test), mỗi điểm có 2 người thử bác bỏ. Không còn điểm mức Cao / Vừa. Các điểm Thấp đã sửa: bọc lỗi đọc mã PI, câu 409 khi gửi lại khoá, câu 409 gửi KCS, làm chặt test. Các điểm có từ trước thì ghi để sau.

## Lưu ý deploy

- Không migration, không biến môi trường mới. Push `main` là Render tự deploy.
- Báo KCS: số đỏ "KCS Phôi" sẽ tăng vì đếm thêm đợt chân nhôm đang chờ. Đây không phải lỗi.
- Báo QLSX và tổ Phôi: sẽ có thêm tin kết quả KCS cho công đoạn phụ sắt, pat theo công đoạn và chân nhôm. QLSX nhận thêm tin "KCS duyệt đạt" cho mỗi đợt loại này.
- Số đỏ "Sản lượng xưởng" có thể tăng nhẹ khi 2 người cùng báo 1 công đoạn của 1 SKU, khớp với số thẻ.
