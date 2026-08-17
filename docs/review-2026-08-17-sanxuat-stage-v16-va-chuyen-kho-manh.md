# Review sanxuat-stage-v16 & thảo luận chuyển kho nội bộ cho mảnh

**Ngày:** 2026-08-17
**Phạm vi:** Review commit `sanxuat-stage-v16` (FE + BE), 1 fix đã áp dụng ở BE, và thảo luận thiết kế cho tính năng chuyển kho nội bộ theo PI (chưa triển khai).

---

## 1. Review commit `sanxuat-stage-v16`

Commit đổi trục dữ liệu báo sản lượng Hàn/Sơn từ `Part` (model gần như chưa dùng thật) sang `Piece` (mảnh — đơn vị Phôi/Đan đang dùng), cộng thêm 2 tính năng nghiệp vụ:

- **BE** (`e3e76d3`, nhánh `main`): đổi `ProductionBatch.partId` → `pieceId` (rename cột DB + FK); thêm `BomPiece.needsHan`/`needsSon` (mảnh nào cần qua Hàn/Sơn); thêm enum `ProcessStep` (CAT/UON/DAP/DUC_LO/TAN/TOP_DAU/XE) + `PieceBom.processSteps` (công đoạn phôi chi tiết cho từng đoạn sắt).
- **FE** (`00a6692`, nhánh `demo` — nhánh chạy thật của dự án): đổi toàn bộ field `partId/partCode/partName` → `pieceId/pieceCode/pieceName` khắp các trang Hàn/Sơn/KCS; thêm UI chọn `needsHan`/`needsSon` và `processSteps` ở `SpecSteelPage.tsx`.

### Kiểm tra đã chạy
- BE: `npx jest` cho 4 module liên quan — 70/70 pass ban đầu (sau fix ở mục 2 là 75/75).
- BE + FE: `npx tsc --noEmit` sạch cả hai.
- `npx prisma migrate status`: DB khớp đủ 59 migration, không drift.
- Grep xác nhận không còn `partId`/`realPartId` sót lại trong đường đi Hàn/Sơn; các `partId` còn lại chỉ nằm trong module `BomPart`/`PartBom` cũ (đã ghi rõ trong comment schema là dead code, chưa từng có luồng UI thật dùng tới).

### Rủi ro migration (không phát sinh trong trường hợp này)
Migration `20260817020000_production_batch_by_piece` rename cột `partId` → `pieceId` trực tiếp trên DB, dựa trên giả định tự khai "bảng `production_batches` đang trống (0 dòng)". Nếu giả định sai sẽ có nguy cơ dữ liệu cũ bị diễn giải nhầm sang FK khác (silent data corruption) hoặc migration bị chặn khi apply. **Đã xác nhận với người dùng: hệ thống chưa đưa vào sử dụng thực tế, bảng này chắc chắn đang trống → rủi ro không áp dụng ở đợt deploy này.**

### Lỗ hổng phát hiện: `needsHan`/`needsSon` được lưu nhưng chưa có tác dụng chặn
Khi review kỹ, phát hiện cờ `needsHan`/`needsSon` mới thêm chỉ được lưu vào DB và hiển thị badge ở FE, nhưng **không được dùng để lọc/chặn** ở bước báo sản lượng thực tế:
- `getBatchPlan()` (API cho tổ Hàn/Sơn tra "còn phải báo bao nhiêu") vẫn trả về **toàn bộ mảnh trong BOM**, bất kể mảnh đó có `needsHan`/`needsSon = false` hay không.
- `assertPieceInBom()` (chặn khi báo sản lượng) cũng không đối chiếu 2 cờ này.

→ Hậu quả: tick "mảnh không cần Hàn" nhưng tổ Hàn vẫn thấy và báo sản lượng được bình thường — cờ chỉ mang tính hiển thị, chưa có lực chặn.

## 2. Fix đã áp dụng (chưa commit)

File: `src/modules/production-batches/production-batches.service.ts`

- `getBatchPlan()`: thêm filter `needsHan: true` / `needsSon: true` (tùy stage) ngay trong query `bomPiece.findMany` — mảnh không cần qua công đoạn đó sẽ không còn hiện trong danh sách cần báo.
- `assertPieceInBom()`: nhận thêm tham số `stage`, đối chiếu `bomPiece.needsHan`/`needsSon` đúng stage đang báo — ném `BadRequestException` nếu mảnh không cần qua công đoạn này.
- Thêm helper `stageNeedsFilter()` dùng chung cho cả hai chỗ trên.
- Thêm 4 test case mới trong `production-batches.service.spec.ts` (chặn khi `needsHan=false` báo HAN, chặn khi `needsSon=false` báo SON, lọc đúng theo từng stage ở `getBatchPlan`).
- Kết quả: `npx jest` 75/75 pass, `tsc --noEmit` sạch. FE không cần sửa gì (chỉ hiển thị đúng danh sách BE đã lọc).

**Trạng thái:** đã sửa xong ở working tree, **chưa commit** — chờ người dùng xác nhận.

## 3. Thảo luận: luồng nghiệp vụ sau công đoạn Sơn

### Câu hỏi đặt ra
Sau khi mảnh vượt qua Sơn (công đoạn cuối của kho Phôi Sơn Hàn), mảnh có được tự động chuyển kho nội bộ sang kho Vật tư thành phẩm (`vat-tu-tp`) không?

### Hiện trạng hệ thống (đã xác nhận qua code)
- Chuỗi kho vật lý có thật: `phoi-son-han` → `vat-tu-tp` (Kho Vật tư thành phẩm) → `thanh-pham` (`transfer-routes.constant.ts`).
- Khi KCS duyệt đạt 1 lô Sơn (`QcReviewsService.reviewProductionBatch()`), hệ thống **chỉ đổi trạng thái** `ProductionBatch.status: AWAITING_QC → QC_DONE`. **Không ghi `StockLedger`/chuyển kho nào cả** — khác với Phôi (tự động trừ tồn đoạn sắt khi báo sản lượng, xem `postSegmentConsumeEntries()`).
- Cơ chế chuyển kho nội bộ (`WarehouseTransfer`, 2 bước: kho nguồn tạo phiếu "xuất" → kho đích bấm "xác nhận" mới thực sự ghi sổ) **chỉ áp dụng cho tồn vật tư (`Material`/`StockQuant`)**, không áp dụng cho mảnh (`Piece`) — vì mảnh hiện **không có khái niệm tồn kho theo warehouse** trong hệ thống, chỉ có trạng thái lô sản xuất.
- Module Đan có giả định ngầm (comment trong schema) rằng mảnh "coi như nằm ở kho vật tư thành phẩm" sau Sơn, nhưng đây chỉ là quy ước tham chiếu, không có bước ghi sổ nào đứng sau.
- Kết luận: đây là **khoảng trống thật giữa nghiệp vụ và code**, được xác nhận trong comment code là quyết định nghiệp vụ cố ý chưa làm ("Hàn/Sơn cấp lại bán-thành-phẩm nghĩa là gì chưa có quyết định nghiệp vụ").

## 4. Đề xuất của người dùng: chuyển kho nội bộ theo PI (mảnh + vật tư, lấy số từ định mức)

### Mô tả đề xuất
Chuyển kho nội bộ theo từng PI (Production Invoice), gồm cả mảnh và vật tư của từng SKU trong PI đó, số lượng lấy từ định mức (BOM).

### Điểm hợp lý
- Gom theo PI khớp đúng cấu trúc dữ liệu sẵn có: mỗi dòng SKU trong PI (`ProductionInvoiceItem`) map 1-1 với đúng 1 `ProductionOrder` — "theo PI" tương đương "theo tập hợp PO thuộc PI đó", không cần vẽ lại quan hệ.
- Gộp mảnh + vật tư trong 1 thao tác hợp lý về trải nghiệm người dùng.

### Rủi ro
1. **Nghiêm trọng nhất — lấy số theo định mức thay vì theo số liệu thực tế đã qua KCS.** Toàn bộ 3 luồng xuất vật tư hiện có (Phôi/Vật tư mảnh/Đan, qua `getIssuePlan()`) đều dùng định mức chỉ để tính **trần** (số tối đa được phép xuất), còn số ghi sổ thực luôn do người dùng **nhập tay**, không tự động bằng đúng định mức. Nếu tự động chuyển đúng bằng số định mức, tồn kho sẽ "khai khống" — ví dụ định mức cần 500 mảnh nhưng thực tế mới làm xong/qua KCS 300 mảnh, hệ thống vẫn ghi nhận 500 đã có trong kho VTTP → sai lệch dây chuyền, khó truy ngược lỗi. Nên dùng **`ProductionBatch.passedQty`** (số thực đã qua KCS) làm nguồn số liệu, định mức chỉ nên dùng để hiển thị/tham chiếu.
2. **Mảnh chưa có khái niệm tồn kho theo warehouse.** Đây không phải chỉnh sửa nhỏ mà là xây mới: cần thêm cơ chế tồn mảnh theo kho, nguồn số liệu đầu vào, rồi mới đến bước chuyển/xác nhận.
3. **Nguy cơ chồng chéo/ghi trùng với luồng xuất vật tư đang có.** Vật tư đã có luồng xuất riêng theo từng công đoạn, ghi `StockLedger` độc lập; nếu thêm 1 phiếu "chuyển theo PI" tự động ghi sổ song song mà không phân định rõ ranh giới, có thể ghi trùng 2 lần cho cùng 1 vật tư.
4. **Đơn vị "theo PI" có thể quá thô.** Một PI thường gồm nhiều SKU với tiến độ khác nhau; nếu bắt buộc đợi cả PI xong mới cho chuyển sẽ làm chậm dòng chảy (Đan phải chờ dù mảnh 1 SKU đã sẵn sàng từ lâu). Nên cân nhắc cho chuyển từng phần theo SKU/mảnh đã đạt, thay vì khóa cứng theo cả PI.

### Đề xuất điều chỉnh
Giữ hướng gom theo PI, nhưng đổi nguồn số liệu ghi sổ: định mức chỉ dùng để gợi ý/hiển thị (giống các luồng issue hiện có), số thực sự ghi vào phiếu chuyển kho lấy từ số liệu sản xuất thực tế đã qua KCS.

## 5. Việc còn mở / cần quyết định tiếp
- [ ] Xác nhận và commit fix `needsHan`/`needsSon` ở mục 2.
- [ ] Quyết định có triển khai chuyển kho nội bộ cho mảnh hay không, và theo hướng điều chỉnh nào (định mức làm trần + số liệu thực tế làm nguồn ghi sổ, theo đề xuất mục 4).
- [ ] Nếu triển khai: cần thiết kế thêm khái niệm tồn mảnh theo kho (chưa tồn tại), và làm rõ đơn vị chuyển tối thiểu (theo PI hay theo SKU/mảnh đã sẵn sàng).

## 6. Thiết kế sơ bộ (tiếp tục thảo luận 2026-08-17, sau khi thống nhất mục 4)

Người dùng lưu ý thêm: **1 PI có thể gồm nhiều SKU thuộc nhiều PO khác nhau** (không phải luôn 1 PI = 1 PO — điều này chỉ đúng cho PI thường, sai với PI gộp `isMerged`, xem comment `ProductionInvoiceItem.salesOrderId` trong schema). Điều này củng cố risk #4 ở mục 4: "theo PI" là đơn vị quá thô.

### Phát hiện: hạ tầng tồn mảnh theo kho đã có sẵn, không cần xây bảng mới cho phần này
`StockLedger`/`StockQuant` đã có sẵn field `pieceId` (1 trong 4 "chân hàng" XOR, ngang hàng `materialId`/`segmentSpecId`/`productVariantId`) — `StockLedgerService.postEntry()` dùng được ngay cho mảnh, hiện chỉ luồng `ADJUST` thủ công đang gọi tới. Đánh giá "cần xây mới hoàn toàn" ở risk #2 mục 4 cần điều chỉnh lại: **không cần bảng mới cho tồn kho mảnh**, chỉ cần một luồng nghiệp vụ gọi `postEntry()` với `pieceId`.

### Đề xuất đơn vị xử lý: theo PO, không theo cả PI
Vì PI có thể gồm nhiều PO tiến độ khác nhau, đơn vị tạo/xác nhận 1 `WarehouseTransfer` nên là 1 hoặc nhiều PO được chọn tay (không khóa cứng "đợi cả PI xong"). UI vẫn có thể gom hiển thị theo PI (liệt kê các PO con + trạng thái sẵn sàng từng PO) để tiện thao tác.

### Đề xuất cơ chế chống đếm trùng qua nhiều đợt chuyển
`WarehouseTransferItem` hiện chỉ có dòng vật tư (`materialId`/`materialName`), chưa có dòng cho mảnh. Đề xuất thêm bảng con (tạm gọi `WarehouseTransferPieceItem`: `transferId`, `productionOrderId`, `pieceId`, `quantity`), và tính "đã chuyển trước đó" = SUM các dòng thuộc transfer đã `CONFIRMED` cho đúng cặp (PO, piece). Đây là tái dùng đúng idiom append-only + SUM đã áp dụng ở `TransferCheckResult` (schema dòng ~1140: mỗi lần ghi 1 dòng mới, không update-in-place, tránh race lost-update) — nên theo cùng pattern thay vì nghĩ cơ chế mới. Số gợi ý khi tạo phiếu = (số đã qua KCS tính tới mốc cuối của mảnh) − (đã chuyển trước đó), người dùng có thể sửa tay trước khi tạo phiếu, kho đích xác nhận vẫn theo đúng state machine 2 bước hiện có (`PENDING → CONFIRMED`).

### Đã chốt: mốc "sẵn sàng" cho mảnh không cần cả Hàn lẫn Sơn

Đính chính lại nhận định trước đó: Phôi **có** bước KCS theo mảnh, qua `SteelIssue.status` (`ISSUED → RECEIVED → AWAITING_QC → QC_PASSED`), KCS duyệt bằng đúng cơ chế `QcReviewsService.review()` (trừ `failedQty`/`scrapQty`) như Hàn/Sơn — không thiếu mốc "đạt" như đánh giá ban đầu.

Có vênh đơn vị: `SteelIssue`/`QcReview` (Phôi) tính theo **số cây sắt** (`barCount`), không trực tiếp theo "số mảnh" như `ProductionBatch.reportedQty` ở Hàn/Sơn — vì 1 mảnh có thể cần ghép nhiều đoạn sắt qua nhiều `ProcessStep` (CAT/UON/DAP/DUC_LO/TAN/TOP_DAU/XE). Hệ thống hiện không có tín hiệu nào xác nhận các bước gia công sau cắt đã xong (processSteps chỉ là checklist hiển thị, không có trạng thái hoàn thành).

**Quyết định (2026-08-17):** dùng phương án (a) — coi `SteelIssue` đạt `QC_PASSED` là mảnh đã xong, không chờ thêm tín hiệu gia công nào khác. Vậy với mảnh `needsHan=false, needsSon=false`: mốc cuối = SUM số cây đã QC-pass (`baseQty − failedQty`) của các `SteelIssue` gốc (loại `reworkOfId != null`) cho đúng (PO, piece) — cùng cách tính "đã xuất" hiện dùng ở `SteelIssuesService.getIssuePlan()`.

### Đã chốt: "vật tư" trong đề xuất mục 4 nghĩa là gì

**Quyết định (2026-08-17):** quy tắc gọi tên theo nghiệp vụ — mảnh có `needsHan=true` thì gọi là **"mảnh"**; mảnh `needsHan=false` thì gọi là **"vật tư thành phẩm"** (không phải nghĩa "vật tư tiêu hao" `Material`/`ConsumableBom` như luồng `MaterialIssue` Hàn/Sơn hiện có — 2 nghĩa "vật tư" khác nhau, cùng tồn tại trong hệ thống, cần phân biệt rõ khi trao đổi).

Hệ quả thiết kế: "mảnh + vật tư" trong đề xuất chuyển kho theo PI **thực chất đều là bản ghi `Piece`** — không phải 2 luồng dữ liệu tách biệt (`Piece` vs `Material`). Khác nhau chỉ ở tên gọi hiển thị và mốc "sẵn sàng":
- `needsHan=true` (dù có `needsSon` hay không): gọi là "mảnh", mốc sẵn sàng theo mục trên (SUM `reportedQty` batch Sơn nếu `needsSon=true`, batch Hàn nếu không).
- `needsHan=false`: gọi là "vật tư thành phẩm", mốc sẵn sàng = `SteelIssue.status=QC_PASSED` (theo quyết định (a) ở trên).

→ Cả 2 nhóm dùng chung đúng 1 cơ chế ghi sổ (`StockLedgerService.postEntry()` với `pieceId`) và chung 1 bảng dòng phiếu chuyển đề xuất ở trên (`WarehouseTransferPieceItem`) — không cần thiết kế riêng cho "vật tư" như lo ngại ban đầu.

## 7. Tổng hợp thiết kế (chốt 2026-08-17)

Toàn bộ nội dung mục 4-6 gộp lại thành 1 tính năng: **chuyển kho nội bộ `phoi-son-han → vat-tu-tp` cho mảnh, theo PO, số liệu lấy từ sản xuất thực tế.**

### 7.1. Mốc "sẵn sàng chuyển" cho 1 (PO, piece)
Tính theo tổ hợp cờ `BomPiece.needsHan`/`needsSon` (ghim theo `bomRevisionId` của PO):

| needsHan | needsSon | Tên gọi | Nguồn số lượng đã đạt |
|---|---|---|---|
| false | false | Vật tư thành phẩm | SUM (`SteelIssue.actualBarCount ?? barCount` − `QcReview.failedQty`) của các `SteelIssue` gốc (`reworkOfId=null`, `status=QC_PASSED`) |
| true | false | Mảnh | SUM `ProductionBatch.reportedQty` (`stage=HAN`, `status=QC_DONE`) |
| true | true | Mảnh | SUM `ProductionBatch.reportedQty` (`stage=SON`, `status=QC_DONE`) |
| false | true | *(tổ hợp không hợp lệ về nghiệp vụ — Sơn phải sau Hàn; không xử lý)* | — |

### 7.2. Số lượng đề xuất khi tạo phiếu
```
đề_xuất(PO, piece) = mốc_sẵn_sàng(PO, piece) − SUM(WarehouseTransferPieceItem.quantity
                        thuộc các WarehouseTransfer đã CONFIRMED, cùng PO+piece)
```
Người dùng có thể sửa tay số này trước khi tạo phiếu (giống các luồng issue hiện có — định mức/số đã đạt chỉ là gợi ý/trần, không ép cứng).

### 7.3. Thay đổi schema đề xuất
- Thêm model `WarehouseTransferPieceItem` (song song `WarehouseTransferItem` hiện có cho vật tư tiêu hao): `id`, `transferId`, `productionOrderId`, `pieceId`, `quantity`, `note`. Append-only, không update-in-place — cùng idiom `TransferCheckResult`.
- Không cần cột/bảng mới cho tồn kho mảnh — `StockQuant`/`StockLedger.pieceId` đã có sẵn.

### 7.4. Luồng API (bám theo state machine `WarehouseTransfer` hiện có: `PENDING → CONFIRMED|REJECTED`)
1. `GET .../piece-transfer-plan?productionOrderIds=...` — trả về danh sách piece kèm mốc sẵn sàng, đã chuyển, đề xuất (theo công thức 7.2), cho 1 hoặc nhiều PO được chọn (kể cả nhiều PO khác PI, vì đơn vị là PO — mục 6).
2. Tạo `WarehouseTransfer` (`fromWarehouseId=phoi-son-han`, `toWarehouseId=vat-tu-tp`) kèm danh sách `WarehouseTransferPieceItem` — validate mỗi dòng không vượt quá đề_xuất tại thời điểm tạo (chặn double-transfer y hệt cơ chế reservation vật tư hiện có).
3. Kho đích xác nhận (`confirm()`) — ghi `StockLedger` cho từng dòng piece qua `postEntry()` (`refType=WAREHOUSE_TRANSFER`, `pieceId` set, `materialId`/`segmentSpecId`/`productVariantId` đều null), đúng nơi duy nhất ghi sổ, giống hệt luồng vật tư hiện có.

### 7.5. Đã chốt: gộp phiếu và phân quyền

**Quyết định (2026-08-17):**

- **Không gộp** dòng vật tư tiêu hao (`WarehouseTransferItem`) và dòng piece (`WarehouseTransferPieceItem`) trong cùng 1 phiếu — tách riêng. Lý do: "vật tư" trong đề xuất ban đầu (mục 4) thực chất là piece `needsHan=false` (mục 6), không phải vật tư tiêu hao thật (CO₂/dây hàn/bột sơn — luồng đó đã có `MaterialIssue` riêng, không liên quan tới việc chuyển mảnh sang kho thành phẩm). Vậy tính năng này chỉ xử lý piece, không có lý do để gộp thêm dòng vật tư tiêu hao — gộp vào chỉ tăng rủi ro chồng chéo/ghi trùng đã nêu ở risk #3 mục 4.
- **Phân quyền: dùng nguyên cơ chế `WAREHOUSE_STAFF` + permission `WAREHOUSE_TRANSFER` hiện có**, không đặt luật riêng — enforce theo `warehouseScope` giống mọi phiếu chuyển kho khác trong hệ thống (xem comment `role-permissions.constant.ts:195-199`): người có quyền ở kho `phoi-son-han` tạo phiếu, người có quyền ở kho `vat-tu-tp` xác nhận.

## 8. Trạng thái tổng thể
Thiết kế mục 4-7 đã chốt đầy đủ trên giấy. Việc còn mở duy nhất trước đây: xác nhận và commit fix `needsHan`/`needsSon` (mục 2) — người dùng cho biết sẽ tự commit.

## 9. Đã triển khai (2026-08-17)

Migration `20260817063758_add_warehouse_transfer_piece_item`, model `WarehouseTransferPieceItem` (`quantity Int`, không phải `Decimal` như `WarehouseTransferItem` - số mảnh luôn nguyên). File chính:
- `warehouse-transfers.service.ts`: `getPieceTransferPlan()`, `createPieceTransfer()`, `confirm()` mở rộng ghi ledger cho `pieceItems`.
- `warehouse-transfers.controller.ts`: `GET /warehouse-transfers/piece-transfer-plan?productionOrderIds=1,2,3`, `POST /warehouse-transfers/piece-transfer` (đặt trước `@Get(':id')` để không bị route wildcard nuốt mất).
- DTO mới: `CreateWarehouseTransferPieceItemDto`, `CreatePieceWarehouseTransferDto`, `WarehouseTransferPieceItemResponseDto`, `PieceTransferPlanItemResponseDto`; `WarehouseTransferDetailResponseDto` thêm field `pieceItems`.
- Test: 9 case mới trong `warehouse-transfers.service.spec.ts` (tổng 24/24 pass), cùng `npx tsc --noEmit` và `npx eslint` sạch.

**1 điều chỉnh so với thiết kế mục 7.2 khi code thực tế:** công thức "đã chuyển trước đó" ban đầu chỉ trừ phiếu `CONFIRMED`. Lúc code phát hiện đây là 1 lỗ hổng race thật (2 phiếu `PENDING` tạo gần như đồng thời có thể cùng đọc thấy 1 số dư sẵn sàng rồi cùng tạo, vượt tổng số đã qua KCS) - piece không có `StockQuant`/khoá `FOR UPDATE` như vật tư để chặn ở tầng ghi, nên đã đổi thành trừ **cả `PENDING` lẫn `CONFIRMED`** ngay ở bước tính kế hoạch. Không loại bỏ hoàn toàn race (vẫn có thể lệch nếu 2 request đọc kế hoạch cùng một khắc), nhưng thu hẹp đáng kể so với thiết kế gốc.

Permission `WAREHOUSE_STAFF` cho 2 endpoint mới dùng nguyên `WAREHOUSE_TRANSFER` CREATE/VIEW như đã quyết định mục 7.5 - không cần sửa `role-permissions.constant.ts`.

### FE (2026-08-17, cùng đợt)
- `services/warehouse-transfers-api.ts`: thêm `getPieceTransferPlan()`, `createPieceWarehouseTransfer()`, export qua `services/api.ts`.
- `WarehouseXuatPage.tsx`: riêng scope `phoi-son-han` lấy PO + kế hoạch thật từ BE thay MOCK (map `readyQty/suggestedQty/transferredQty` vào đúng field `plannedQty/availableQty/confirmedQty` sẵn có của `OrderLine`, đổi nhãn cột cho đúng ngữ cảnh mảnh/vật tư TP); nút "Xác nhận" gọi `createPieceWarehouseTransfer`. Scope `vat-tu-tp`/`thanh-pham` không đổi (vẫn mock, xem mục 10).
- Bug phát hiện lúc code: `getStatus()`/`done` tính "đủ" bằng `confirmedQty >= plannedQty` - khi cả 2 đều 0 (mảnh chưa qua KCS lần nào) thì `0>=0` vẫn đúng, khiến PO hiện nhầm "Hoàn thành". Đã thêm điều kiện `plannedQty > 0`.
- Đã test qua trình duyệt thật (đăng nhập tài khoản demo `khopsh`, warehouseScope=phoi-son-han): đăng nhập → tab Xuất kho → danh sách 24 PO thật từ BE → bảng chi tiết đúng dữ liệu, không console error/failed request. Chưa test được thao tác "Xác nhận" tạo phiếu thật vì dữ liệu seed hiện tại mọi mảnh đều `readyQty=0` (chưa qua KCS lần nào) - logic tạo phiếu chỉ được phủ bởi unit test BE (24/24 pass), chưa qua UI với số khác 0.

## 10. Chặng `vat-tu-tp → thanh-pham` (Vật tư TP → Thành phẩm) - ĐÃ ĐIỀU TRA, TẠM DỪNG

Người dùng hỏi tiếp "chặng thứ 2" (sau khi xong chặng Phôi-Sơn-Hàn → Vật tư TP). Điều tra cho thấy đây **không phải cùng dạng bài** với chặng vừa làm — không thể áp dụng lại `WarehouseTransferPieceItem`/`getPieceTransferPlan`.

### Khác biệt bản chất
- Chặng Phôi-Sơn-Hàn → Vật tư TP: **cùng 1 đơn vị hàng đổi kho** (1 Piece vẫn là 1 Piece, chỉ đổi kho) → đúng khuôn `WarehouseTransfer`.
- Chặng Vật tư TP → Thành phẩm: bị gate bởi **Đóng gói** (`PackagingRecord` - đã có API thật, `KhoDongGoiPage.tsx`), biến N mảnh thành 1 đơn vị SKU thành phẩm (`ProductVariant`) - **quy đổi đơn vị**, không phải chuyển nguyên trạng.

### Hiện trạng đã xác nhận qua code
- `PackagingRecord.boxesPacked` **đã chính là số lượng SKU thành phẩm** (so trực tiếp 1:1 với `ProductionOrder.quantity` ở `recordPackaging()`, không có hệ số "SL/thùng") - không cần quy đổi thêm từ BOM/mảnh như dự đoán ban đầu. Điểm này đơn giản hơn lo ngại lúc đầu.
- Nhưng `PackagingRecord` **không ghi `StockLedger`** - chỉ là bộ đếm tiến độ, không đụng tồn kho.
- `StockLedgerRefType.FINISHED`/`FRAME_OUTPUT` có sẵn trong enum nhưng **chưa từng được dùng ở đâu** trong code.
- Chặng `vat-tu-tp → thanh-pham` ở `WarehouseXuatPage.tsx` (`scope==='vat-tu-tp'`) vẫn dùng nguyên luồng cũ (`MOCK` + `createWarehouseTransfer` vật tư tự do) - không đổi gì trong đợt này.

### Lỗ hổng chặn thật: `StockLedger` không có "chân hàng" cho SKU không gắn variant
`StockLedger` chỉ ghi được hàng thành phẩm qua chân `productVariantId` (1 trong 4 chân XOR). Tra thực tế DB: **toàn bộ 24/24 `ProductionInvoiceItem` hiện có đều `productVariantId = null`**. Nghĩa là nếu nối `PackagingRecord` → `StockLedger` theo đúng chân sẵn có, tính năng sẽ **không áp dụng được cho bất kỳ SKU thật nào** - đây không phải thiếu 1 bước ghi sổ (như chặng Hàn/Sơn), mà là thiếu hẳn cách biểu diễn "SKU thành phẩm không gắn variant" trong schema.

### Quyết định (2026-08-17)
**Tạm dừng, chưa triển khai chặng này.** 3 hướng đã đưa ra để cân nhắc sau, chưa hướng nào được chọn:
1. Bắt buộc mọi SKU phải có `ProductVariant` (tự tạo mặc định khi tạo `ProductionOrder` nếu SKU chưa có) - giữ nguyên 4 chân `StockLedger`, nhưng cần thêm logic tự tạo/gán variant.
2. Thêm chân hàng `mfgProductId` vào `StockLedger` (mở XOR từ 4 lên 5 chân) - đụng bảng dùng chung toàn hệ thống, rủi ro cao hơn.
3. Không làm gì thêm ở chặng này cho tới khi có quyết định nghiệp vụ rõ ràng hơn về việc bắt buộc variant hay mở schema.

### Việc còn mở
- [ ] Chọn hướng 1/2/3 ở trên khi có nhu cầu triển khai thật chặng Vật tư TP → Thành phẩm.
