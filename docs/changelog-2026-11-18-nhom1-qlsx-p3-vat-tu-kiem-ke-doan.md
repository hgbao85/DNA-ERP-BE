# 18/11/2026 - Nhóm 1 quanh QLSX (N1) + vật tư Hàn / Sơn kho xuất là đã nhận, Admin kiểm kê đoạn (P3) (BE)

Đi kèm FE: changelog cùng ngày `changelog-2026-11-18-nhom1-qlsx-p3-vat-tu-kiem-ke-doan.md` ở repo FE.
Có 1 migration CHỈ DỮ LIỆU (`20261118080000_vat_tu_han_son_kho_xuat_la_da_nhan`), không đổi schema, không biến môi trường mới.
API chỉ THÊM trường / khoá; `POST /floor/queue/:stage/advance` nhận thêm `expectedRunningPiId` (xem Lưu ý deploy: BE lên trước FE).

## Vì sao

- Review QLSX + khung cơ khí 17/11 thấy 7 chỗ nối còn đứt quanh QLSX (gói N1, không cần hỏi nghiệp vụ): tin của tổ Sơn lệnh Phước An tới
  nhầm QLSX Phước An; nhắc "đợt chờ gửi KCS quá 4 giờ" gộp mọi xưởng; SKU đóng gói đủ không ai nhắc bấm Kết thúc; chia máy cắt tay không
  xếp hàng đợi Phôi và không báo thủ kho xuất sắt; mảnh Hàn Phước An chờ sang kho Sơn không ai nhắc; QLSX không có nút chuyển lệnh Phôi
  khi KCS đạt đủ mà hệ thống chưa tự chuyển; quét tem máy đang tắt nhận câu sai.
- Quyết định nghiệp vụ 17/11 (P3): thủ kho xác nhận phiếu xuất có chữ ký người nhận là vật tư Hàn / Sơn đã nhận, bỏ bước tổ bấm nhận; Admin
  được kiểm kê / điều chỉnh tồn (kiểm kê làm ngoài phần mềm).

## Thay đổi

### N1-1. Tin hàng đợi đi theo xưởng của hàng đợi; nhắc chờ lâu tách theo tổ × xưởng
- `floor/floor-stale.util.ts` (mới): `groupStaleByQueueWorkshop`, `staleBucketKey` - gom đợt chờ gửi KCS theo (tổ, xưởng của hàng đợi).
- `floor/floor-alerts.service.ts`:
  - `listStaleItems` (thay `countStaleByStage`) + `syncStageWorkshopAlerts(type, buckets)`: mỗi (tổ, xưởng) 1 tin `FLOOR_BATCH_STALE`,
    `entityId` = `<tổ>:<id xưởng | none>`. Số đổi thì cập nhật nội dung, GIỮ trạng thái đã đọc; về 0 thì tự đóng. Tin kiểu cũ (entityId
    `PHOI` / `HAN` / `SON`) tự đóng ở lượt nhắc đầu tiên. Hàm viết để P1 (KCS tự chuyển) dùng lại.
  - `FLOOR_STAGE_COMPLETE`, `FLOOR_PHOI_DONE` mang `params.workshopId` của dòng hàng đợi.
- `qc-reviews/qc-reviews.service.ts`: tin KCS đạt / lỗi của lô Sơn mang `workshopId` = xưởng nơi sơn (lệnh Phước An sơn ở Phú An -> QLSX
  Phú An nhận).
- `notifications/notification-types.ts`: `FLOOR_BATCH_STALE` thêm `workshopId` / `workshopName` vào tiêu đề; `FLOOR_STAGE_COMPLETE` ghi
  "Chuyển lệnh tiếp".
- `notifications/notifications.service.ts`:
  - emit gộp tin theo **(type, dedupeKey)** (trước đây chỉ dedupeKey, 2 loại tin dùng chung khoá có thể dẫm nhau);
  - thêm `updateOpenContent(type, dedupeKey, params, tx?)`: sửa tiêu đề / nội dung / link / data của tin đang mở, không đánh dấu chưa đọc
    lại, không phát realtime; trả `false` khi không có tin mở.

### N1-2. Nhắc QLSX "Kết thúc" khi SKU đóng gói đủ
- `production-invoices.service.ts` `recordPackaging`: vừa đóng đủ thì phát `PI_ITEM_READY_TO_FINISH` (có hay không có đơn bán; SKU đã
  Kết thúc thì không phát). Link mở thẳng bảng SKU của lệnh (`page: 'ke-hoach'`, `params.pi`, `focus`).
- `production-orders.service.ts` `finishFloor`: đóng tin đó.
- `work-queue.service.ts`: khoá đếm mới `qlsxAwaitingFinish` (số SKU đóng gói đủ chưa Kết thúc, trong phạm vi xưởng của QLSX; tính từ
  dữ liệu nên SKU cũ trước deploy cũng được đếm).

### N1-3. Chia máy cắt tay làm đủ việc như máy rảnh tự kéo
- `floor/cut-allocation.service.ts` (+ `cut-allocation-board.ts`, `cut-allocation-types.ts`):
  - không chia lệnh chưa Bắt đầu (không có SKU đang chạy ở xưởng): "Chia luôn" trả 400 câu lời thường; "Chia tự động / phần còn lại /
    lại" bỏ qua và ghi `board.warnings` "Chưa chia N lệnh chưa Bắt đầu: …";
  - bảng chia trả thêm `started` cho dòng chưa chia / đang chờ; `auto` / `add` trả `{ board, allocated }` cho controller.
- `floor/cut-allocation-follow-up.service.ts` (mới) `afterAllocated`: sau khi chia đã commit, xếp lệnh vào hàng đợi Phôi và báo thủ kho
  xuất sắt (`CUT_PULL_STEEL_TO_ISSUE`, thêm `source` MANUAL / AUTO_PULL). Lệnh đang chờ KHSX kiểm lại phương án cắt
  (`cuttingRecheckRequired`) thì không báo. Không bao giờ ném lỗi (lỗi chỉ ghi log).
- `floor.controller.ts`: route `cut-allocation/auto` và `/add` gọi follow-up; `floor-alerts.service.ts` `tryAutoPull` dùng chung follow-up.
- Lượt nhắc nền đối soát: lệnh đã Bắt đầu có dòng chia mà chưa có dòng hàng đợi Phôi thì xếp vào cuối hàng đợi Phôi.

### N1-4. Nhắc thủ kho Hàn Phước An chuyển mảnh sang kho Sơn
- `warehouse-transfers/paint-transfer-reminder.service.ts` (mới): số mảnh chờ chuyển = số thủ kho lập phiếu được thật ở "Xuất theo đơn
  hàng" (đã KCS Hàn đạt, chưa nằm trong phiếu, giới hạn theo tồn mảnh ở kho Hàn trừ phiếu chờ nhận). Mỗi lệnh 1 tin
  `PIECES_TO_PAINT_PENDING`: tăng thì hiện lại chưa đọc, giảm thì sửa số giữ trạng thái đã đọc, về 0 / lệnh xong thì tự đóng. Ghi tin dưới
  khoá `paint-pending:<id lệnh>`. Không tự lập phiếu.
- Gọi sau mỗi lượt KCS Hàn (`qc-reviews`) và ở lượt nhắc nền (`floor-alerts` bước `paintTransfer`). `FLOOR_ALERTS=off` thì không phát tin.
- `work-queue.service.ts`: khoá đếm mới `warehouseToPaintPending` (chỉ thủ kho gắn kho Hàn của xưởng không có kho Sơn).

### N1-5. Máy & tem QR
- `floor/floor-admin.service.ts` `updateWorkstation`: tắt máy cắt hoặc đổi xưởng máy cắt thì xoá các dòng chia của máy cùng transaction
  (khoá `cut-allocation:<xưởng cũ>`), mỗi dòng ghi 1 dòng nhật ký REMOVE kèm lý do.
- `floor/floor-scan.service.ts`: quét tem máy đang tắt -> 404 "Máy này đang tắt - báo QLSX bật lại máy ở “Máy & tem QR”".

### N1-6. "Chuyển lệnh tiếp" an toàn khi hệ thống vừa tự chuyển
- `floor/dto/floor-queue.dto.ts` `AdvanceQueueDto` + `floor-admin.service.ts` `advance`: nhận `expectedRunningPiId` (id lệnh màn QLSX
  đang thấy là đang chạy; `null` = màn thấy tổ chưa chạy lệnh nào). So SAU khoá hàng đợi (cùng khoá với tự đóng lệnh Phôi); lệch thì 409
  "Lệnh đang chạy của tổ … đã đổi (hệ thống có thể vừa tự chuyển) - tải lại màn rồi xem lại". Không gửi thì như cũ.

### P3-1. Vật tư Hàn / Sơn: kho xuất là đã nhận
- `material-issues/material-issues.service.ts`: dòng xuất vật tư tiêu hao (Hàn / Sơn) ghi `RECEIVED` ngay lúc tạo, `receivedQty` =
  `issuedQty`, `receivedAt` = `issuedAt`, không có người nhận riêng. Không còn phát `MATERIAL_ISSUE_TO_TEAM`; realtime `MATERIAL_ISSUE`
  `CREATED` giữ nguyên. `receive()` chỉ còn cho dòng `ISSUED` sót lại; dòng đã nhận trả 409 câu lời thường.
- Migration dữ liệu `20261118080000_vat_tu_han_son_kho_xuat_la_da_nhan` (3 câu UPDATE, chạy lại được nhiều lần, không ghi sổ kho):
  dòng `ISSUED` -> `RECEIVED` (số nhận = số xuất, lúc nhận = lúc xuất); đóng tin `MATERIAL_ISSUE_TO_TEAM` còn mở; tin cũ trỏ tab đã gỡ
  thì trỏ về "Lệnh sản xuất". Đổi cả dòng của lệnh Tạm dừng / Kết thúc; không sinh audit / realtime.

### P3-2. Admin kiểm kê đoạn kho Phôi, chặn khi chưa chuyển đổi
- `segment-stock/segment-stocktake.service.ts`: sau khoá dùng chung của lượt chuyển đổi dữ liệu đoạn, nếu `segment_reservations` và
  `segment_productions` cùng trống (dữ liệu đoạn cũ chưa chuyển sang cách quản theo lệnh) thì 409 "Chưa ghi kiểm kê đoạn được: …". Có
  chênh thì phát realtime `STOCK` `ADJUSTED` sau commit.
- `stock/stock-ledger.service.ts`: nhánh sửa tồn đoạn của `POST /stock-ledger/adjust` chặn giống hệt (cùng thứ tự khoá).

### Sửa theo QA review độc lập (18/11)
- Tin `CUT_PULL_STEEL_TO_ISSUE` (Vừa): tin gộp từng chỉ còn loại sắt vừa chia, mất loại sắt khác còn chưa xuất. Nay các cặp vừa chia chỉ
  quyết định có phát hay không; nội dung (`lines`, `warehouseCodes`) dựng từ TOÀN BỘ chỗ thiếu sắt hiện hành của lệnh
  (`buildPullSteelParams` trong `cut-allocation-follow-up.service.ts`, dùng chung với đối soát).
- `FLOOR_ALERTS=off`: follow-up vẫn xếp hàng đợi Phôi nhưng không phát tin xuất sắt (chỉ lượt nền mới đóng tin này, giống nhắc chuyển mảnh).
- Đối soát tin xuất sắt ở lượt nền (`floor-alerts.service.ts` bước `pullSteelReconcile`): lệnh đã chạy, có dòng chia, còn thiếu sắt có kho
  giữ, không chờ KHSX kiểm lại mà chưa có tin mở thì phát (`source: 'RECONCILE'`, câu "Lệnh này đã chia cho máy cắt mà sắt chưa xuống
  Phôi"); tin đang mở mà thêm kho thì gộp (thêm người nhận), chỉ đổi danh sách thì sửa nội dung giữ trạng thái đã đọc.
- Câu "Chưa chia N lệnh chưa Bắt đầu" (Vừa): dựng trong `buildBoard` từ dữ liệu bảng nên có ở MỌI route trả bảng, kể cả GET (trước đây màn
  tự tải lại qua realtime sau 1,5 giây là mất câu). Bỏ chỗ thêm cũ trong `runPlan`.
- `floor-admin.service.ts`: transaction tắt / đổi xưởng máy cắt chờ khoá với `maxWait 10s / timeout 30s` (như các chỗ khác giữ khoá chia
  máy); bật lại máy cắt thì dọn dòng chia cũ còn sót của máy (nhật ký "Dọn dòng cũ khi bật lại máy"); `ensurePhoiQueued` bắt lỗi từng
  lệnh, lệnh lỗi không cản lệnh sau.
- Nhắc chuyển mảnh sang Sơn: tính lại số mảnh của lệnh SAU khi lấy khoá `paint-pending:<lệnh>` (trước đây lượt nền cầm số tính trước nên có
  thể đóng nhầm / hạ số tin vừa phát).

### Sửa theo QA nghiệm thu (18/11)
- `production-batches`: mỗi mảnh trong kế hoạch mảnh (`GET /production-orders/:id/production-batch-plan`, `.../batch`,
  `GET /floor/queue/:stage/detail/:piId`) THÊM `failedQty` = Σ `QcReview.failedQty` của các đợt đã KCS chấm (QC_DONE) theo (lệnh, stage,
  mảnh) - lỗi cộng dồn, bất biến; `passedQty` giữ nghĩa cũ (đã trừ lỗi). Một truy vấn gộp (`getFailedQtyByOrderPiece`), không N+1.
  Mảnh Phôi có khai công đoạn (vd pat Cắt -> Dập, chấm theo PieceStepBundle) cộng thêm lỗi KCS của MỌI công đoạn (mảnh hỏng ở công đoạn
  nào cũng phải làm lại). Vật tư TP (`materialYieldItems`) chưa có trường này.
- `floor/floor-admin.service.ts` `progressFrom`: dòng mảnh dùng `failedQty` (đã báo gồm lỗi, lỗi = failedQty) để thẻ lệnh của QLSX ghi số
  Lỗi khớp ngăn chi tiết; % và còn thiếu không đổi.

## Kiểm tra (18/11)
- Làm trên BE `80b4420` (đã gộp các commit 17-18/11 trên main; `material-issues.service.ts` gộp 3 chiều: `receive()` dùng update có điều
  kiện + P2025 của bản main với câu 409 của P3).
- Unit: toàn bộ BE 180 bộ / 3988 test đạt (1 bộ bỏ qua có sẵn). tsc chỉ còn 2 lỗi cũ ở `prisma/seed-*.ts`. ESLint 0 lỗi. `nest build` đạt.
- Tích hợp (DB test): toàn bộ 10 bộ / 76 test đạt, gồm 2 bộ mới `n1-nhom1` (21 test) và `p3-vat-tu-kiem-ke` (20 test).
- QA review độc lập (4 phần, mỗi lỗi có người phản biện): 0 Cao, 2 Vừa, 15 Thấp xác nhận; đã sửa hết trừ các mục ở "Còn biết".
- QA nghiệm thu trên bản sao dữ liệu 17/11 (desktop + 375 px): P3 22 đạt / 1 không đạt (Hướng dẫn admin, đã sửa) / 5 chưa kiểm (4 cần dữ
  liệu đoạn đã chuyển đổi - test tích hợp phủ; 1 là việc chạy trên production); N1 31 đạt / 3 chưa kiểm (1 unit phủ, 1 cần BE tắt nhắc
  nền, 1 cần đợt cắt Phôi). 2 lỗi Thấp mới (hộp "Chuyển lệnh tiếp" khi tổ chưa đủ số, tab "Bất thường" Hàn / Sơn) đã sửa; QA đọc lại
  code (Đạt có điều kiện) và thử lại trên app (Đạt: hộp giữ lệnh lúc mở, máy chủ 409, không đóng nhầm; Bất thường / Còn thiếu / thẻ /
  Tổng hợp lệnh SX đúng số ở Hàn và mảnh pat Phôi; desktop + 375 px).
- Hướng dẫn test tay: `docs/huong-dan-test-n1-p3-2026-11-18.docx` (không commit).

## Còn biết, chưa sửa
- Kiểm kê đoạn: trên dữ liệu production 17/11 hai bảng đoạn theo lệnh đều trống, nên sau deploy Admin / thủ kho **chưa ghi được** kiểm kê
  hay sửa tồn đoạn tới khi IT chạy chuyển đổi dữ liệu đoạn (đúng quyết định P3 Q1). Lượt chuyển đổi không để dấu riêng: nếu chuyển xong mà 2
  bảng vẫn 0 dòng thì vẫn bị chặn.
- Kiểm kê đúng lúc lượt chuyển đổi đang chạy (giữ khoá tới 600 giây) thì người kiểm nhận lỗi hết giờ chung chung. Có từ trước.
- Tắt máy cắt xoá cả dòng chia đã cắt dở (số đã báo vẫn nằm ở báo cáo); "Chưa chia" không trừ phần máy đó đã cắt, nên chia lại phải bớt
  tay (hộp hỏi lại đã nhắc). Gốc lỗi có từ trước (máy tắt trước đây cũng làm dòng thành dòng cũ).
- Cảnh báo khác của lượt chia (của bộ giải) vẫn mất khi bảng tự tải lại. Có từ trước.
- Lệnh nhiều SKU ở tổ Phôi: số lỗi chưa bù có thể lệch khi xem cả lệnh (mức Thấp, không sửa theo chốt).
- "Chuyển lệnh tiếp": máy chủ chỉ kiểm lệnh đang chạy, không kiểm lệnh kế; nếu đúng lúc đó có người đổi thứ tự hàng đợi, lệnh được chạy có
  thể khác tên ghi trong hộp (Thấp, ít gặp).
- Thẻ "Chờ gửi KCS" của QLSX còn ghi mã PI thay mã lệnh (đã biết từ 17/11, ngoài phạm vi).
- Tổ Phôi: chú giải "Lỗi N" trên thẻ lệnh cộng chung đoạn lỗi với mảnh lỗi (như cột Cần vốn cộng chung); tab "Bất thường" thì tách
  "đoạn" / "cái". Chờ chốt cách hiển thị.

## Lưu ý deploy
- **Deploy BE (main) trước, chờ Render chạy xong, rồi mới push FE (demo).** FE mới gửi `expectedRunningPiId`; BE cũ chặn trường lạ
  (`forbidNonWhitelisted`) nên sẽ trả 400 ở nút "Chuyển lệnh tiếp".
- Migration P3 tự chạy lúc container BE khởi động. Sau deploy kiểm (chỉ đọc): không còn `material_issues` ISSUED, không còn tin
  `MATERIAL_ISSUE_TO_TEAM` mở.
- Lượt nhắc nền đầu tiên sau deploy: đóng tin chờ lâu kiểu cũ, xếp lệnh đã chia tay vào hàng đợi Phôi nếu thiếu, phát tin chuyển mảnh cho
  lệnh Phước An đang dở, phát tin xuất sắt (RECONCILE) cho lệnh đã chia mà chưa có tin (dữ liệu production 17/11 chưa có dòng chia nào nên
  không phát hàng loạt).
- Vùng có người khác đang sửa: `warehouse-transfers.module.ts`, `production-invoices`, `production-orders`, `production-batches` (chỉ thêm
  provider / đoạn mới) - báo người phụ trách trước khi gộp.
- Báo xưởng: xem "Báo người dùng" ở changelog FE.
