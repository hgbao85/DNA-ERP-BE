# 19/11/2026 - KCS tự chuyển, chặn báo vượt, KCS ghi số thực có, KCS chọn bỏ / làm lại (BE)

Đi kèm FE: changelog cùng ngày `changelog-2026-11-19-kcs-tu-chuyen-chan-vuot.md` ở repo FE.
Có 2 migration: `20261118100000_kcs_short_scrap` (thêm cột, có CHECK) và `20261118100100_kcs_floor_report_view` (chỉ dữ liệu). Không biến
môi trường mới. API chủ yếu THÊM trường / route; 3 route "gửi KCS" của QLSX giữ đường dẫn nhưng trả 403; route hoàn tác đợt cắt
(`undo-last-batch`) bị bỏ (404). Xem "Lưu ý deploy": BE lên trước FE.

## Vì sao

Xác nhận nghiệp vụ 17/11 và 19/11 (sổ quyết định): công nhân bấm Lưu là số sang KCS ngay, QLSX không bấm "Gửi KCS" nữa; báo vượt số cần
của lệnh thì phần mềm chặn (trừ pat / chân nhôm được làm sẵn); KCS thấy số báo sai thì ghi "số thực có" - phần thiếu không tính là lỗi,
công nhân không phải làm bù; đoạn bị chấm lỗi ở công đoạn phụ (Uốn / Dập / Tán…) KCS chọn "bỏ, cắt lại" hay "làm lại được"; lỗi công
đoạn phụ chấm trước ngày đổi coi là "làm lại được".

## Thay đổi

### 1. Dữ liệu (migration)
- `20261118100000_kcs_short_scrap`: `qc_reviews.shortQty`; `qc_review_segments.shortQty`, `scrapQty` (mặc định 0, CHECK không âm,
  `scrapQty <= failedQty`). `failedQty` từ nay CHỈ là số lỗi (không gồm thiếu).
- `20261118100100_kcs_floor_report_view`: cấp `FLOOR_REPORT:VIEW` cho vai `KCS_STAFF` (xem đợt đang mở + nhận realtime phòng 'floor');
  đóng mọi tin `FLOOR_BATCH_STALE` còn mở (tin này ngừng phát). Chạy lại nhiều lần không đổi thêm gì.
- KHÔNG có migration đổi lỗi công đoạn phụ cũ: phiếu chấm cũ giữ `scrapQty = 0` = "làm lại được" (quyết định 19/11).

### 2. KCS tự chuyển
- `floor/floor.controller.ts` + `floor-review.service.ts`:
  - `GET /floor/review` cho cả KCS: mọi đợt ĐANG MỞ (đợt cắt CUTTING, nhóm công đoạn chưa gom, lô mảnh OPEN, nhóm pat, nhóm chân nhôm)
    kèm `waitingSince`, tên người báo, các lần báo, `stoppedPis` (`{ productionInvoiceId, code }[]`) và lý do khoá (`LENH_DUNG`,
    `CHUA_GAN_SKU`). KCS xem mọi xưởng (không lọc theo xưởng); QLSX vẫn lọc theo xưởng của mình.
  - 5 route KCS chốt đợt để chấm: `POST /floor/kcs/cut-bundles/:id/close`, `/floor/kcs/step-groups/close`,
    `/floor/kcs/production-batches/:id/close`, `/floor/kcs/piece-step-groups/close`, `/floor/kcs/material-yield-groups/close`. Gọi lại đúng
    hàm chốt cũ, KHÔNG phát tin `*_TO_KCS`. Hai người chốt cùng lúc: 1 người được, người kia 409 "… vừa được chốt để chấm - tải lại trang";
    đợt vừa bị QLSX hủy hết: 409 "… vừa bị QLSX hủy hết số - không còn gì để chấm, tải lại trang."; lệnh đang dừng: 409 câu "chốt để chấm".
  - 3 route gửi KCS cũ của QLSX trả 403 "Từ nay KCS tự chấm các đợt công nhân vừa báo - QLSX không cần gửi KCS nữa. Tải lại trang.". Các
    route báo cũ trả câu mới (`legacy-floor-report.constant.ts`).
  - QLSX hủy được lần báo (ghi lý do) tới lúc KCS bấm "Chấm"; sau đó 409 "KCS đã bắt đầu chấm đợt này - không hủy được nữa. Số sai thì
    báo KCS ghi “số thực có” khi chấm.".
- `floor/kcs-pending.util.ts` (mới): đếm số đỏ KCS / QLSX, bỏ dòng xám (lệnh dừng, dữ liệu cũ chưa gắn SKU).
- `floor/floor-admin.service.ts` summary theo tổ trả `{ open, awaitingKcs, stale }` (stale = đợt chờ KCS chấm quá 4 giờ).
- `floor/floor-alerts.service.ts`: tin mới `KCS_BATCH_STALE` (KCS + QLSX) theo tổ × xưởng, dùng lại `syncStageWorkshopAlerts`: số đổi thì
  sửa tin đang mở (không tạo tin mới), hết đợt quá hạn thì tự đóng. `FLOOR_BATCH_STALE` ngừng phát. Link: KCS mở màn KCS của tổ, QLSX mở
  "Sản lượng xưởng".
- `production-orders.service.ts`: Bắt đầu / Tạm dừng / Kết thúc lệnh phát thêm realtime `FLOOR_REPORT` (topic 'floor') để màn KCS (không
  có quyền xem lệnh nên không nhận topic 'production-orders') tô xám / mở lại đợt của lệnh ngay.
- `steel-issues.service.ts`: KCS chốt đợt cắt / gửi đợt công đoạn vẫn phát realtime `STEEL_ISSUE`.

### 3. Chặn báo vượt số cần
- `steel-issues/phoi-need.util.ts` (mới): số cần / số đã tính của từng (lệnh, SKU, cỡ đoạn, công đoạn). Cắt: số cần cộng thêm phần KCS
  chấm "bỏ" ở công đoạn phụ (`extraNeed`); đã tính = thô − lỗi − thiếu. Công đoạn phụ: không vượt số đoạn cắt thực có (`physicalLeft`,
  `cutCap`). `maxNow = max(0, min(còn cần, còn vật lý))`.
- Báo cắt / công đoạn phụ (`steel-issues`), mảnh Phôi / Hàn / Sơn (`production-batches`): kiểm trong khoá, vượt thì 400 câu có "tối đa N",
  "bạn nhập X", kết thúc "Số cần sai thì báo QLSX."; công đoạn phụ vượt số cắt thực có thì câu bảo cắt thêm đúng số đoạn.
- Pat (`recordPieceStepBatch`) và chân nhôm (`material-yield-recipe-production` `recordStepBatch`) KHÔNG chặn (quyết định 19/11) - vượt hoặc
  số cần 0 chỉ ghi log "Báo vượt … (cho phép, quyết định 19/11)".
- `floor/floor-scan.service.ts`: màn quét nhận nguyên `maxNow` / `physicalLeft` của BE (dùng chung `pieceMaxNow`); "Sản lượng của tôi" có
  `kcs { failedQty, shortQty }` (đợt đã chấm) và `batchKey` (`CUT:<id>` / `STEP:<id>` / `BATCH:<id>`).
- Gán SKU đợt cắt (ADMIN sửa SKU) kiểm lại công đoạn của SKU cũ (bỏ cả thô, thiếu, lỗi của đợt bị chuyển); câu lỗi riêng cho ca sửa SKU.

### 4. KCS chấm: số thực có, bỏ / làm lại
- `qc-reviews.service.ts` + DTO: `shortQty` (cắt / công đoạn theo cỡ, lô mảnh / pat / chân nhôm theo lô); công đoạn phụ có lỗi bắt buộc
  `scrapQty` (0 = làm lại hết), thiếu thì 400 "… chọn số đoạn lỗi phải bỏ (cắt lại), 0 nếu chỉ làm lại. Màn chấm chưa có ô này thì tải lại
  trang.". Thiếu + lỗi vượt số đã báo: 400 "Cỡ 441mm: thiếu 5 + lỗi 118 vượt số đã báo trong đợt (120)" / "Thiếu (10) + không đạt (55)
  vượt số đã báo (60)".
- Kết quả trả `notes[]` (câu vàng khi công đoạn sau đã báo nhiều hơn số đoạn cắt thực có) tính bằng hàm của `phoi-need.util`, dạng "Uốn
  cỡ 355mm đã báo nhiều hơn số đoạn cắt thực có (39) 2 đoạn - Uốn sẽ bị chặn tới khi cắt thêm hoặc KCS Uốn ghi thiếu".
- Tin `QC_FAILED` / `QC_PASSED` ghi "thiếu", tách "Bỏ N" / "Làm lại M".
- `production-batches.service.ts`: thứ tự trong transaction chấm lô mảnh: `lockBatchKeysInTx` -> updateMany (báo − thiếu, so count) ->
  `consumeSegmentsAtReviewInTx` (trừ đoạn LÚC CHẤM theo báo − thiếu, khoá chống trùng theo lô) -> cập nhật lô -> nhập kho mảnh công đoạn cuối
  -> tạo phiếu chấm. Pat / chân nhôm: đạt = báo − thiếu − lỗi.

### 5. Khoá, transaction, sửa nhỏ cùng file
- Thứ tự khoá: `production-batch-open:<lệnh>:<mảnh>:<tổ>` là câu đầu của báo / chốt / chấm; `cut-cap` -> `cut-report` -> FOR UPDATE lệnh;
  `segment-legacy-conversion` (khi bật) trước `production-batch-open`.
- Transaction giữ khoá cả lệnh có `maxWait 10s / timeout 20s` (báo mảnh, pat, công đoạn sắt, gán SKU đợt công đoạn, chân nhôm, hủy lần báo).
- `assignCutBundleOrder` trong transaction; `syncIssueStatusFromBundles` có khoá; Idempotency-Key đúng sau khi hủy hết; bỏ
  `undoLastCutBatch` (route + DTO); `work-queue` thêm topic 'floor' cho KCS.

## Kiểm tra (19/11)
- Làm trên BE `bc5171a` (đã gộp các commit 18-19/11 trên main; `steel-issues.service.ts` gộp 3 chiều với bản phát realtime lúc gửi KCS,
  `notification-types.ts` gộp với loại tin `PRESOLVED_CUTTING_APPROVE_FAILED`).
- Unit: toàn bộ BE 199 bộ / 4597 test đạt (1 bộ bỏ qua có sẵn), chạy lại sau pull cuối. tsc chỉ còn 2 lỗi cũ ở `prisma/seed-*.ts`. ESLint 0 lỗi. `nest build` đạt.
- Tích hợp (DB test): 15 bộ / 180 test đạt (chạy lại sau sửa cuối), gồm 6 bộ mới `p1-*`. HTTP quyền `p1-kcs-quyen`: 25 / 25.
- QA review độc lập (3 mảng, có phản biện): 0 Cao, 1 Vừa, 10 Thấp xác nhận - đã sửa hết trừ "Còn biết".
- E2E trên bản sao dữ liệu 17/11 (2 lượt, có lượt bật nhắc nền): KCS tự chuyển, chặn vượt, số thực có, bỏ / làm lại, hủy lần báo, lệnh dừng,
  tin quá 4 giờ, FE cũ chạy với BE mới - không lỗi Cao.
- QA nghiệm thu trên bản sao (đăng nhập form thật, desktop + 375 px, FE mới và FE cũ): **Đạt có điều kiện**, 52 / 52 AC đạt (AC chưa có dữ
  liệu trên app thì dựa vào test tích hợp / unit, có dẫn nguồn), 0 Cao, 0 Vừa. Đo AC40 trên DB local: chốt 78 ms, chấm lô mảnh ghép 2 cỡ
  207 ms. 5 lỗi Thấp đã sửa: câu vàng AC34 ghi cả số đoạn cắt thực có lẫn số vượt, câu đỏ FE cùng chữ câu 400 BE, Hướng dẫn 6 chỗ chữ cũ,
  tổng SL dòng xám ở KCS Hàn, số có dấu ngăn nghìn. Sau sửa: unit + tích hợp `p1-kcs-cham` chạy lại đạt.
- Hướng dẫn test tay: `docs/huong-dan-test-p1-kcs-tu-chuyen-2026-11-19.docx` (không commit).

## Còn biết, chưa sửa
- Vai KCS gọi `GET /production-orders` ở banner "lệnh dừng" và bị 403 (console có lỗi; màn vẫn chạy). Có từ trước, không thuộc gói này.
- Tiến độ / thanh % pat và chân nhôm có thể hiện trên 100% khi làm vượt (đúng thông tin, chấp nhận theo quyết định 19/11).
- Lỗi công đoạn phụ cũ coi là "làm lại": cỡ nào trước đây đã cắt thêm để bù thì máy cắt hiện "đã đủ (vượt N)" (rủi ro đã chấp nhận).
- "Còn lại" ở màn Vật tư TP chưa trừ số thiếu KCS ghi (làm cùng gói vật tư TP bằng QR).
- Tin KCS_BATCH_STALE của tổ Phôi luôn mở tab Cắt của KCS Phôi (Thấp).

## Lưu ý deploy
- **Deploy BE (main) trước, chờ Render chạy xong, rồi mới push FE (demo).** FE cũ vẫn chạy được với BE mới (đã thử): nút "Gửi KCS" của
  QLSX nhận câu 403 mới; KCS chấm lỗi công đoạn phụ ở màn cũ nhận câu bảo tải lại trang.
- **Trước deploy (chỉ đọc production):** đếm các cỡ đoạn sẽ hiện "đã đủ (vượt N)" vì lỗi Uốn / Dập cũ coi là làm lại - phiếu chấm công đoạn
  phụ (`qc_reviews.stepBundleId` có) với `failedQty > 0`, gom theo lệnh × SKU × cỡ, đối chiếu tiến độ Cắt. Gửi xưởng danh sách chỉ gồm số
  đếm. (Bản dump 17/11 có 0 dòng.)
- 2 migration tự chạy lúc container BE khởi động. Sau deploy kiểm (chỉ đọc): vai KCS_STAFF có FLOOR_REPORT:VIEW; không còn tin
  `FLOOR_BATCH_STALE` mở.
- **KCS phải đăng nhập lại** sau deploy (quyền xem đợt đang mở nằm trong phiên đăng nhập).
- Các đợt đang mở / đang chờ chấm từ trước deploy hiện ngay ở màn KCS, không cần chuyển đổi dữ liệu.
- Vùng có người khác đang sửa: `production-orders.service.ts` (thêm 1 lời phát realtime), `steel-issues.service.ts`, `qc-reviews` - báo
  người phụ trách trước khi gộp.
- Báo xưởng: xem "Báo người dùng" ở changelog FE.
