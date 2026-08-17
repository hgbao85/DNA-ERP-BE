# Changelog 2026-08-17 — Chuyển kho nội bộ cho mảnh (Phôi-Sơn-Hàn → Vật tư thành phẩm)

> Tổng kết phiên làm việc: review commit `sanxuat-stage-v16` (đổi trục báo sản lượng Hàn/Sơn từ
> `Part` sang `Piece`), 1 fix lỗ hổng `needsHan`/`needsSon` chưa có lực chặn, thiết kế + triển khai
> **tính năng chuyển kho nội bộ cho mảnh/vật tư thành phẩm** (chặng Phôi-Sơn-Hàn → Vật tư TP, cả
> BE lẫn FE, đã test qua trình duyệt thật), và điều tra chặng kế tiếp (Vật tư TP → Thành phẩm) —
> phát hiện lỗ hổng schema thật, tạm dừng chờ quyết định nghiệp vụ.
>
> Toàn bộ diễn biến/lý do quyết định chi tiết nằm ở
> [`docs/review-2026-08-17-sanxuat-stage-v16-va-chuyen-kho-manh.md`](review-2026-08-17-sanxuat-stage-v16-va-chuyen-kho-manh.md)
> (10 mục) — file này chỉ tóm tắt phần đã **code xong**.

Repo liên quan: `DNA-ERP-BE` (nhánh `main`), `DNA-ERP` (nhánh `demo`).

---

## 1. Bối cảnh

Review commit `sanxuat-stage-v16` phát hiện cờ `BomPiece.needsHan`/`needsSon` (mảnh nào cần qua
Hàn/Sơn) mới thêm chỉ được lưu DB + hiển thị badge, **chưa có tác dụng chặn**: `getBatchPlan()` vẫn
trả về toàn bộ mảnh trong BOM bất kể cờ, `assertPieceInBom()` không đối chiếu 2 cờ này — tick "mảnh
không cần Hàn" nhưng tổ Hàn vẫn báo sản lượng được bình thường.

Từ đó dẫn tới câu hỏi lớn hơn: sau khi mảnh vượt qua Sơn, hệ thống có tự động chuyển kho nội bộ
sang kho Vật tư thành phẩm không? Trả lời: **không** — `QcReviewsService.reviewProductionBatch()`
chỉ đổi `ProductionBatch.status`, không ghi `StockLedger`/chuyển kho nào cả, khác Phôi (tự động trừ
tồn đoạn sắt khi báo sản lượng). Đây là khoảng trống thật giữa nghiệp vụ và code, dẫn tới toàn bộ
phần thiết kế + code ở mục 2-3 dưới.

## 2. Fix `needsHan`/`needsSon` chưa có lực chặn

File: `src/modules/production-batches/production-batches.service.ts`

- `getBatchPlan()`: thêm filter `needsHan: true`/`needsSon: true` (tùy stage) trong query
  `bomPiece.findMany` — mảnh không cần qua công đoạn đó không còn hiện trong danh sách cần báo.
- `assertPieceInBom()`: nhận thêm tham số `stage`, đối chiếu đúng cờ theo stage đang báo — ném
  `BadRequestException` nếu mảnh không cần qua công đoạn này.
- Thêm helper `stageNeedsFilter()` dùng chung cho cả hai chỗ trên.
- 4 test case mới trong `production-batches.service.spec.ts`.

## 3. Chuyển kho nội bộ cho mảnh — thiết kế chốt trong phiên

Tóm tắt các quyết định (chi tiết + lý do ở review doc mục 4-7):

| Quyết định | Nội dung |
|---|---|
| Đơn vị xử lý | Theo **PO**, không theo PI — 1 PI có thể gồm nhiều PO tiến độ khác nhau (PI gộp `isMerged`) |
| Tên gọi | `needsHan=true` → **"mảnh"**; `needsHan=false` → **"vật tư thành phẩm"** — cả hai đều là bản ghi `Piece`, không phải 2 model khác nhau |
| Mốc "sẵn sàng chuyển" | `needsHan=true` (dù `needsSon` hay không): SUM `ProductionBatch.reportedQty` (`QC_DONE`, stage=SON nếu `needsSon` else HAN). `needsHan=false`: SUM cây sắt đã QC-pass (`SteelIssue.actualBarCount??barCount − QcReview.failedQty`, `status=QC_PASSED`, loại rework) — coi cắt sắt xong là mảnh xong, không chờ tín hiệu gia công nào khác (hệ thống chưa có tín hiệu đó) |
| Chống đếm trùng | `đề_xuất = mốc_sẵn_sàng − SUM(đã nằm trong phiếu PENDING hoặc CONFIRMED trước đó)` — ban đầu thiết kế chỉ trừ CONFIRMED, phát hiện lúc code đây là lỗ hổng race (2 phiếu PENDING tạo gần như đồng thời có thể cùng vượt số đã qua KCS vì piece không có `StockQuant` để khoá `FOR UPDATE` như vật tư), đã sửa trừ cả PENDING |
| Gộp phiếu vật tư tiêu hao + piece | **Không gộp** — tách hẳn 2 loại dòng/2 endpoint, tránh chồng chéo với luồng `MaterialIssue` sẵn có |
| Phân quyền | Dùng nguyên `WAREHOUSE_STAFF` + permission `WAREHOUSE_TRANSFER` hiện có, enforce theo `warehouseScope` — không thêm luật mới |

## 4. Backend — đã triển khai

Migration `prisma/migrations/20260817063758_add_warehouse_transfer_piece_item/`:

| Thay đổi | Lý do |
|---|---|
| Model mới `WarehouseTransferPieceItem` (`transferId`, `productionOrderId`, `pieceId`, `quantity Int`, `note`) | Dòng piece trong phiếu chuyển kho — tách khỏi `WarehouseTransferItem` (vật tư, `Decimal`). Append-only, không update-in-place — cùng idiom `TransferCheckResult` |
| `WarehouseTransfer.pieceItems` + relation ngược ở `ProductionOrder`/`Piece` | — |

Không cần bảng/cột mới cho tồn kho mảnh theo kho — `StockLedger`/`StockQuant` đã có sẵn chân hàng
`pieceId` (XOR cùng `materialId`/`segmentSpecId`/`productVariantId`), chỉ chưa luồng nào dùng tới.

File chính (`src/modules/warehouse-transfers/`):

| File | Thay đổi |
|---|---|
| `warehouse-transfers.service.ts` | `getPieceTransferPlan(productionOrderIds)` — kế hoạch theo bảng mục 3; `createPieceTransfer()` — tạo phiếu, clamp theo kế hoạch tại thời điểm tạo; `confirm()` mở rộng ghi `StockLedger` (`refType=WAREHOUSE_TRANSFER`, chân `pieceId`) cho từng `pieceItems` |
| `warehouse-transfers.controller.ts` | `GET /warehouse-transfers/piece-transfer-plan?productionOrderIds=1,2,3`; `POST /warehouse-transfers/piece-transfer` (đặt **trước** `@Get(':id')` để tránh bị route wildcard nuốt) |
| DTO mới | `CreateWarehouseTransferPieceItemDto`, `CreatePieceWarehouseTransferDto`, `WarehouseTransferPieceItemResponseDto`, `PieceTransferPlanItemResponseDto` (có `productName` — thêm sau khi FE cần hiển thị tên sản phẩm) |
| `WarehouseTransferDetailResponseDto` | Thêm field `pieceItems` |

Test: 9 case mới trong `warehouse-transfers.service.spec.ts` (đủ cho `getPieceTransferPlan`,
`createPieceTransfer`, và `confirm()` ghi ledger cho piece item) — tổng **24/24 pass**.
`npx tsc --noEmit` và `npx eslint` sạch. `npx prisma migrate status` không lệch.

## 5. Frontend — đã triển khai

| File | Thay đổi |
|---|---|
| `services/warehouse-transfers-api.ts` | Thêm `getPieceTransferPlan()`, `createPieceWarehouseTransfer()`, export type `BePieceTransferPlanItem` |
| `services/api.ts` | Export 2 hàm trên qua barrel |
| `modules/pages/InboundWarehouse/WarehouseXuatPage.tsx` | Riêng `scope === 'phoi-son-han'`: bỏ `MOCK` data, lấy PO thật qua `listProductionOrdersForStage()` + kế hoạch thật qua `getPieceTransferPlan()`, map `readyQty/suggestedQty/transferredQty` vào field sẵn có `plannedQty/availableQty/confirmedQty` của `OrderLine` (đổi nhãn cột: "Kế hoạch"→"Đã qua KCS", "Thực có"→"Có thể chuyển", "Đã xuất"→"Đã chuyển", "ĐVT"→"Loại" hiện MANH/vật tư TP); nút "Xác nhận" gọi `createPieceWarehouseTransfer` + refetch kế hoạch. Scope `vat-tu-tp`/`thanh-pham` **không đổi gì** (vẫn mock, xem mục 6) |

**Bug phát hiện lúc code (đã sửa):** `getStatus()` và cột "Xuất" tính "đủ" bằng
`confirmedQty >= plannedQty`. Khi mảnh chưa hề qua KCS lần nào, cả hai đều bằng 0 → `0 >= 0` vẫn
đúng → PO hiện nhầm badge "Hoàn thành" dù chưa làm gì. Đã thêm điều kiện `plannedQty > 0` vào cả
`getStatus()` (áp dụng chung mọi scope, an toàn vì mock data cũ luôn có `plannedQty > 0`) và biến
`done` trong bảng chi tiết.

`npx tsc --noEmit` và `npx eslint` sạch.

### Kiểm chứng qua trình duyệt thật

Đăng nhập tài khoản demo `khopsh` (`warehouseScope=phoi-son-han`) qua script Playwright/patchright
tự viết (chromium-cli không có sẵn trên máy Windows này) → tab "Xuất kho" → danh sách **24 PO thật**
từ BE → bấm vào 1 PO → bảng chi tiết hiển thị đúng 5 mảnh/vật tư TP với cột đã đổi nhãn, badge
"Chưa có hàng" đúng (vì dữ liệu seed hiện tại mọi mảnh đều `readyQty=0` — chưa qua KCS lần nào).
Không console error, không request lỗi.

**Chưa test được:** thao tác "Xác nhận" tạo phiếu thật với số khác 0, vì dữ liệu seed hiện tại
không có mảnh nào đã qua KCS. Logic tạo phiếu chỉ được phủ bởi unit test BE (9 case, xem mục 4).

## 6. Đã điều tra, tạm dừng: chặng Vật tư TP → Thành phẩm

Người dùng hỏi tiếp chặng thứ 2 trong chuỗi kho (`vat-tu-tp → thanh-pham`). Điều tra cho thấy đây
**không cùng dạng bài** với chặng vừa làm — không áp dụng lại được `WarehouseTransferPieceItem`.

- Chặng Phôi-Sơn-Hàn → Vật tư TP: cùng 1 đơn vị hàng đổi kho (Piece vẫn là Piece).
- Chặng Vật tư TP → Thành phẩm: bị gate bởi **Đóng gói** (`PackagingRecord`, đã có API thật qua
  `KhoDongGoiPage.tsx`), biến N mảnh thành 1 đơn vị SKU (`ProductVariant`) — **quy đổi đơn vị**,
  không phải chuyển nguyên trạng.
- `PackagingRecord.boxesPacked` đã chính là số lượng SKU thành phẩm (so 1:1 với
  `ProductionOrder.quantity`, không có hệ số quy đổi) — đơn giản hơn dự đoán ban đầu.
- Nhưng `PackagingRecord` **không ghi `StockLedger`**, và tra thực tế DB: **100% (24/24)**
  `ProductionInvoiceItem` hiện có đều `productVariantId = null` — nếu nối theo đúng chân
  `productVariantId` sẵn có của `StockLedger`, tính năng sẽ không áp dụng được cho bất kỳ SKU thật
  nào. Đây là lỗ hổng schema thật (thiếu cách biểu diễn "SKU thành phẩm không gắn variant"), không
  phải chỉ thiếu 1 bước ghi sổ như chặng vừa làm.

**Quyết định (2026-08-17): tạm dừng, chưa triển khai.** 3 hướng để cân nhắc sau (chưa chọn hướng
nào) — xem chi tiết ở review doc mục 10:
1. Bắt buộc mọi SKU phải có `ProductVariant` (tự tạo mặc định).
2. Thêm chân hàng `mfgProductId` vào `StockLedger` (mở XOR từ 4 lên 5 chân).
3. Không làm gì thêm cho tới khi có quyết định nghiệp vụ rõ ràng hơn.

## 7. Trạng thái cuối phiên / việc còn mở

- [x] Fix `needsHan`/`needsSon` (mục 2) — đã sửa xong, người dùng tự commit.
- [x] Chuyển kho nội bộ Phôi-Sơn-Hàn → Vật tư TP (mục 3-5) — code xong BE + FE, test qua browser.
- [ ] Chọn hướng xử lý chặng Vật tư TP → Thành phẩm (mục 6) khi có nhu cầu triển khai thật.
- [ ] Test thao tác "Xác nhận" tạo phiếu piece thật với dữ liệu sản xuất khác 0 (cần dữ liệu QC
      thật hoặc seed thêm).
