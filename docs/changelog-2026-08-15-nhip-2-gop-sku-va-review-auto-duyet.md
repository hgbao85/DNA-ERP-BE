# Changelog 2026-08-15 — Nhịp 2: Gộp SKU thành lệnh sản xuất + review luồng tự động duyệt

> Tổng kết phiên làm việc: hoàn tất tính năng **gộp nhiều SKU vào một đợt cắt chung** (Nhịp 2 của
> "Tối ưu cắt sắt"), 2 lỗi phát hiện khi chạy thật đã sửa, bộ 87 test case bàn giao, **review
> chuỗi solve → mua hàng** sau khi luồng chuyển sang tự động duyệt (**sửa 4/5 lỗ hổng**), và
> **review BE + FE theo chuẩn quy trình ERP** (15 phát hiện, chưa sửa).
>
> - [Mục 8](#8-review-chuỗi-solve--mua-hàng-sau-khi-bật-tự-động-duyệt) — review kỹ thuật chuỗi
>   solve → mua hàng: 5 lỗ, 4 đã sửa kèm test.
> - [Mục 9](#9-review-be--fe-theo-chuẩn-quy-trình--nghiệp-vụ-erp) — review nghiệp vụ ERP: 6 phát
>   hiện FE + 5 BE, **toàn bộ chưa sửa**.
> - [Mục 9.4](#94-đối-chiếu-lại-với-code--4-phát-hiện-bổ-sung) — đối chiếu lại mục 9 với code
>   thật: 11/11 phát hiện đúng, **4 chỗ cần chỉnh** + **4 phát hiện bổ sung (C1-C4)**. Bảng ưu
>   tiên ở [9.3](#93-xếp-ưu-tiên) đã bị bảng ở 9.4 thay thế.
> - [Mục 10](#10-trạng-thái-cuối-phiên--việc-còn-lại) — trạng thái cuối phiên.
> - [Mục 11](#11-kế-hoạch-sửa) — kế hoạch sửa 4 đợt cho toàn bộ mục 9 + 9.4, kèm cách sửa cụ thể
>   cho từng mục và lý do chọn cách đó.
> - [Mục 12](#12-kết-quả-thực-thi--1115-phát-hiện-đã-sửa-2026-08-15) — **kết quả thực thi**: 11/15
>   phát hiện đã sửa trong cùng phiên, 484/484 test pass, 3 chỗ thực tế khác kế hoạch ban đầu.

Repo liên quan: `DNA-ERP-BE` (nhánh `main`), `DNA-ERP` (nhánh `demo`), solver `cat_sat_iea`
(`D:\DNA-DEXUAT`, không đổi trong phiên này).

---

## 1. Tính năng làm gì

NCC chỉ bán cây sắt **6.000mm**. Có sản phẩm **không thể** đạt ngưỡng hao hụt khi cắt một mình —
Bàn J55 chỉ có duy nhất một cỡ đoạn 840mm, 7 đoạn/cây, thừa 113mm = **1,88%**, và đó đã là tối ưu
tuyệt đối. Gộp nhu cầu nhiều SKU thì thêm được cỡ đoạn khác vào cùng cây và giải được (thêm đoạn
460mm của Ghế tình yêu kéo sắt 20×20 xuống **0,53%**).

Luồng sau khi hoàn tất Nhịp 2:

1. KHSX vào màn **"Tối ưu cắt sắt"**, tick chọn các SKU muốn gộp, xem trước số cây bớt được.
2. Bấm **"Xác nhận gộp"** → tạo một `ProductionInvoice` gộp (`isMerged = true`) chứa các SKU đó,
   có thể đến từ **nhiều đơn hàng khác nhau**.
3. PI gộp hiện ở màn **"Lệnh sản xuất mới"**, KHSX review/đặt thời hạn rồi gửi Sếp duyệt như cũ.
4. **Sếp duyệt/từ chối cả cụm một lần**. Duyệt → solver tính **một bài toán chung cho cả nhóm**
   (đây chính là chỗ tiết kiệm sắt; tính riêng từng SKU rồi cộng lại cho ra kết quả y hệt lúc chưa
   gộp). Từ chối → bắt buộc nhập lý do, PI gộp bị **xoá hẳn**, các SKU quay lại màn "Tối ưu cắt
   sắt" kèm lý do để KHSX gộp tổ hợp khác.
5. Tính xong → tự duyệt phương án → tự trừ tồn kho → tự đẩy đề xuất mua sang **Mua hàng**.

Bước 5 chuyển sang **tự động** theo quyết định Sếp chốt 2026-08-15 ("duyệt lệnh sản xuất là xong,
không cần QLSX duyệt thêm bước nữa") — phần này do đồng đội thực hiện ở nhánh `sanxuat-stage-v13`,
xem [mục 8](#8-review-chuỗi-solve--mua-hàng-sau-khi-bật-tự-động-duyệt).

---

## 2. Thay đổi CSDL — 1 migration

`prisma/migrations/20260814063306_merged_production_invoice/`

| Thay đổi | Lý do |
|---|---|
| `ProductionInvoiceItem.salesOrderId BigInt?` + relation + `@@index` | Trước đây mã đơn hàng suy ngược qua `item.productionInvoice.salesOrder.code`. Gộp SKU từ nhiều đơn vào một PI sẽ **mất dấu SKU nào thuộc đơn nào** — hỏng đúng cây PI→PO→SKU nghiệp vụ cần. Mỗi SKU phải tự nhớ đơn gốc. |
| `ProductionInvoice.isMerged Boolean @default(false)` + `mergedAt`, `mergedById` | Tách PI gộp khỏi PI vỏ 1-1 do Sales tự sinh — hai loại có luồng duyệt khác nhau (cụm vs từng dòng). |
| `CuttingProposal.productionOrderId` → **nullable**; thêm `productionInvoiceId BigInt?` + relation + `@@index` | Một phương án cắt phủ cả nhóm thay vì một lệnh SX. |

**Backfill chạy cùng migration** (bắt buộc — không để dữ liệu cũ mất mã đơn hàng):

```sql
UPDATE production_invoice_items i
SET "salesOrderId" = pi."salesOrderId"
FROM production_invoices pi
WHERE pi.id = i."productionInvoiceId" AND pi."salesOrderId" IS NOT NULL;
```

Ràng buộc **"`CuttingProposal` neo vào đúng một trong hai"** (`productionOrderId` XOR
`productionInvoiceId`) kiểm ở tầng service, **không** dùng CHECK constraint — repo chưa có tiền lệ
CHECK viết tay ngoài `SystemConfig.id`. Xem [mục 8.1](#81-lỗ-1--supersede-quét-nhầm-toàn-hệ-thống)
vì sao quy ước-không-ràng-buộc này đang là nguồn của một lỗi thật.

---

## 3. Backend — commit `b939b78` (18 file)

### Gộp SKU

`POST /production-invoices/merge` — quyền `PRODUCTION_INVOICE:CREATE` (KHSX đã có sẵn), body
`{ productionInvoiceItemIds: string[] }`, chạy trong một transaction:

1. Chặn: dưới 2 item; item đã `APPROVED`; item đang thuộc PI gộp khác.
2. Tạo PI `isMerged = true`, `salesOrderId = null`, `deadline` = hạn FRAME **sớm nhất** trong nhóm
   (cả nhóm cắt cùng lúc nên phải theo đơn gấp nhất).
3. Chuyển `productionInvoiceId` của các item sang PI mới; `salesOrderId` trên item **giữ nguyên**.
4. PI nguồn nếu rỗng thì **không xoá** (còn `PlanForm.productionInvoiceId` trỏ tới) — lọc khỏi
   danh sách ở `findAll` bằng điều kiện "có ít nhất 1 item".

Trường hợp chỉ chọn 1 SKU: **không gọi API, không tạo PI mới** — SKU vốn đã nằm trong PI riêng của
nó, đi luồng thường; FE chỉ đổi nhãn nút và điều hướng.

### Sếp duyệt/từ chối cả cụm

Hai endpoint mới, `@RequireRole(BOSS)` + `@RequirePermissions(APPROVE)`, **chỉ nhận PI có
`isMerged = true`** (PI thường vẫn dùng nguyên hai endpoint per-item cũ, không đụng tới):

- **`POST /production-invoices/:id/approve-batch`** — mọi item phải đang `WAITING_BOSS`. Kiểm BOM
  của **mọi** SKU trước khi ghi bất cứ thứ gì (thiếu BOM một SKU là cả nhóm không cắt chung được —
  dừng sớm với 409 rõ ràng còn hơn duyệt được nửa nhóm rồi kẹt). Xong hết mới gọi **một lần**
  `requestForInvoice(pi.id)`.
- **`POST /production-invoices/:id/reject-batch`** body `{ reason }` — chặn nếu đã có item
  `APPROVED` (lúc đó đã sinh `ProductionOrder`, xoá PI sẽ để lại rác). Ghi `rejectReason` +
  `decidedAt/By` lên **mọi** item, trả item về PI của đơn hàng gốc theo `item.salesOrderId`, rồi
  xoá PI gộp.

Một chi tiết đã sửa từ phát hiện lúc đọc code: `approveItem()` cũ dùng `pi.salesOrderId` để tạo
`PlanForm`. PI gộp có `salesOrderId = null` → sẽ **âm thầm bỏ qua** bước tạo PlanForm, hỏng "Lệnh
kiểm tra vật tư" mà không báo lỗi gì. Đã đổi sang đọc `item.salesOrderId`.

### Giải chung cả nhóm — `requestForInvoice()`

Song song với `requestForOrder()` có sẵn, dùng lại toàn bộ phần gọi solver/lưu kết quả:

- Gom `ProductionOrder` của mọi item trong PI (mỗi cái đã ghim sẵn `bomRevisionId` + `quantity`).
- **Quy về nhu cầu tuyệt đối**: `qty_per_part = qty_per_set × qty_per_part × order.quantity`, gửi
  `num_sets: 1`. Bắt buộc — solver cũ nhận `num_sets = order.quantity` + BOM của đúng một sản
  phẩm, không biểu diễn được nhóm nhiều SKU khác số lượng.
- Gộp các `segmentSpecLookup` (khoá `materialId:cutLengthMm`, nên trùng khoá giữa 2 sản phẩm là
  **đúng ý** — cùng cỡ đoạn, cùng loại sắt, xếp chung được lên một cây).

### Nới hai chỗ hạ nguồn

| Chỗ | Thay đổi | Không sửa thì sao |
|---|---|---|
| Phôi xuất sắt — `SteelIssuesService.assertMaterialInApprovedProposal()` | Chấp nhận cả hai kiểu neo: `productionOrderId` **hoặc** `productionInvoiceId` của PI mà SKU là thành viên | Phôi **không xuất được sắt** cho mọi SKU đã gộp — phương án nằm ở cấp nhóm, không lệnh SX riêng lẻ nào "sở hữu" nó |
| Đề xuất mua — `CuttingProposalsService.approve()` | Bỏ giả định `productionOrderId != null` | Ném lỗi ngay khi duyệt phương án cấp nhóm |

Ngoài ra `toResponseDto()` đang đọc thẳng `proposal.productionOrderId.toString()` — cũng ném lỗi
khi null, đã sửa cùng lúc.

### Đưa SKU bị từ chối quay lại

`loadBatchContext()` lọc `prodApprovalStatus ∈ (null, WAITING_QLSX, WAITING_BOSS)` — **`REJECTED`
không nằm trong đó**, nên SKU bị Sếp từ chối sẽ không bao giờ quay lại màn "Tối ưu cắt sắt". Đã
thêm `REJECTED` vào bộ lọc và trả thêm `rejectReason` trong `CuttingBatchCandidateDto`.

---

## 4. Frontend — commit `272f667` (6 file, nhánh `demo`)

| File | Thay đổi |
|---|---|
| `services/cutting-batch-api.ts` | `mergeCuttingBatch(ids)`; thêm `rejectReason` vào `CuttingBatchCandidate` |
| `services/production-invoices-api.ts` | `approveBatch` / `rejectBatch` |
| `ProductionPlan/GomDotCatPage.tsx` | Nối `handleConfirm` (trước là chỗ trống có chủ đích): ≥2 SKU → gọi merge → điều hướng sang "Lệnh sản xuất mới"; 1 SKU → nút đổi nhãn **"Tiến hành cắt riêng"**, không gọi API; SKU có `rejectReason` → hiện dòng đỏ "Sếp từ chối: …" ngay trên dòng đó |
| `ProductionPlan/LenhSXPage.tsx` | `getDisplayCode` ưu tiên mã PI + hạn giao cho PI gộp; mở PI gộp thì **nhóm SKU theo đơn hàng**; Sếp thấy **1 nút Duyệt + 1 nút Từ chối (bắt buộc lý do)** cho cả cụm thay vì nút theo từng dòng |
| `ProductionPlan/ProductionPlanApp.tsx` | Nới bộ lọc danh sách (xem [mục 6](#6-chỉ-báo-đang-tính--đã-chạy-x-phút)) |

---

## 5. Hai lỗi phát hiện khi chạy thật — đã sửa

### 5.1. Trần timeout của circuit breaker thấp hơn timeout solver

`POST_BREAKER_TIMEOUT_MS` cứng ở 600s trong khi `SOLVER_TIMEOUT_SECONDS` có thể lớn hơn → một lần
solve dài hợp lệ bị breaker cắt và báo *"External service unavailable"* dù solver vẫn đang chạy
bình thường. Đã nới trần theo config. Kiểm chứng: một lần solve thật **>10 phút** chạy trọn không
tái hiện lỗi.

### 5.2. `nextProductionInvoiceCode()` dùng `COUNT(*)` thay vì `MAX+1`

**Triệu chứng:** `POST /sales-orders` trả `409 Duplicate value for: undefined` — không liên quan gì
tới nội dung đơn hàng, xuất hiện đột ngột sau khi test luồng từ chối.

**Nguyên nhân:** hàm sinh mã đếm số PI hiện có rồi `+1`. Nhưng `rejectBatch()` **xoá thật** PI gộp,
để lại lỗ hổng trong dãy số. Sau khi xoá `PI-2026-003/007/013`, DB còn 10 dòng → `COUNT = 10` →
sinh ra `PI-2026-011`, đúng một mã **vẫn đang tồn tại** → đụng unique constraint.

**Sửa** ([`src/common/utils/production-invoice-code.util.ts`](../src/common/utils/production-invoice-code.util.ts),
commit `d9b9e89`): đọc mọi mã cùng tiền tố, parse số thứ tự, lấy **MAX + 1**. Cùng dãy dữ liệu đó
giờ sinh đúng `PI-2026-013`. DB unique constraint vẫn giữ nguyên vai trò lưới chặn cuối cho race
hiếm gặp — cùng idiom đã dùng cho `WarehouseTransfer.code` / `BomRevision.revNo`.

Kéo theo: cập nhật mock trong `sales-orders.service.spec.ts` (`count` → `findMany`) và
`production-invoices.service.spec.ts` (thêm `findMany` mặc định).

---

## 6. Chỉ báo "Đang tính… (đã chạy X phút)"

Thời gian solve thật dao động rất lớn: **4,7 phút** cho một nhóm 3 SKU không có vật tư khó, so với
**>15 phút** cho tổ hợp chạm sắt 15×15. Người dùng không có cách nào biết hệ thống đang chạy hay
đã chết → cần chỉ báo, nhưng **không cần một màn hình riêng** để xem solver tới đâu (solver không
báo tiến độ từng bước; một màn như vậy sẽ chỉ hiển thị đúng cái badge này ở kích thước lớn hơn).

Đặt tại màn **"Lệnh sản xuất mới"**, ngay trên dòng PI, đếm từ `CuttingProposal.createdAt`.

Một vấn đề phải xử lý kèm: `approveBatch()` lật `PI.status` sang `PRODUCING` **đồng bộ, trước khi
solve bắt đầu**, trong khi danh sách chỉ hiện PI có `status === 'PLANNING'` → PI vừa duyệt biến mất
khỏi màn đúng lúc cần thấy badge nhất. Đã nới bộ lọc để hiện thêm PI `PRODUCING` **và** còn ít nhất
một item có `cuttingProposalStatus === 'CALCULATING'`.

---

## 7. Kiểm chứng

### Test tự động

| Mốc | Kết quả |
|---|---|
| Sau khi hoàn tất Nhịp 2 (commit `b939b78`) | **473/473 pass**, `tsc --noEmit` sạch cả 2 repo (thêm 22 test mới cho luồng gộp/duyệt cụm/từ chối) |
| Tại HEAD `14eea28` **trước** đợt sửa mục 8 | 431/433 pass — tổng số test giảm do đồng đội xoá module `material-inspection` (spec 468 dòng); 2 fail + 2 lỗi `tsc` là **có sẵn trên nhánh** |
| **Sau đợt sửa mục 8** | **438/438 pass** (+5 test mới, +2 test được vá mock), `tsc --noEmit` sạch **trừ** 2 lỗi `weaving-issues` có sẵn (xem 8.7 mục 5) |

Các ca bắt buộc đã phủ: gộp <2 item bị chặn; gộp xong item giữ đúng `salesOrderId` gốc; từ chối →
PI biến mất, item về đúng PI của đơn cũ, mang `rejectReason`, **và xuất hiện lại** ở
`getBatchCandidates`; duyệt PI gộp chỉ tạo **một** `CuttingProposal`.

### Chạy thật
- **Gộp 3 SKU qua BE đầy đủ**: thành công sau **282s**, cả 7 loại vật tư đều đạt ngưỡng.
- **Kiểm tra UI thật** (chrome-devtools): gộp, duyệt cụm, từ chối cụm — đều đúng, console sạch,
  badge trên menu khớp số dòng trên màn.
- **Kịch bản e2e hai nhóm độc lập** (`e2e-full-flow.mjs`): tạo song song Nhóm 1
  (`TEST-GHE-B` + `TEST-KE-C`, chung vật tư 30×30) và Nhóm 2 (`J55` + `TEST-BAN-A`, chung vật tư
  50×50), Sếp duyệt cả hai, chờ solve xong, rồi duyệt phương án của **riêng Nhóm 1**. Kết quả:
  `PurchaseProposal` của Nhóm 1 tạo đúng (`PI-2026-015`, `mfgProductCode: "TEST-GHE-B, TEST-KE-C"`,
  1 dòng vật tư `STL-VUONG-30X30` buyQty 4) — **nhưng** phương án của Nhóm 2 bị đổi trạng thái
  `DRAFT → SUPERSEDED` dù không liên quan gì. Đây là bằng chứng cho
  [lỗ 1](#81-lỗ-1--supersede-quét-nhầm-toàn-hệ-thống).

### Bộ test case bàn giao
File `test_cases_gop_sku.xlsx` — **87 test case / 15 module** (A→O), phủ trọn luồng từ Sales tạo
đơn → KHSX gộp → Sếp duyệt → solve → Mua hàng báo giá → Sếp duyệt mua → Thủ kho nhập kho. Mỗi ca
ghi rõ **tài khoản đăng nhập cụ thể** (theo `prisma/seed-demo.ts`: `sales`, `khsx`, `qlsx`, `boss`,
`muapsh`, `khopsh`, `phoi`…, mật khẩu chung `demo1234`), điều kiện tiên quyết, các bước, dữ liệu
test, kết quả mong đợi. Hai sheet: "Tổng quan" (thống kê `COUNTIF`) và "Test Cases".

> ⚠ Bộ test case này **chưa cập nhật** theo mục 8 — module L ("Duyệt phương án cắt") vẫn mô tả bước
> QLSX duyệt tay đã bị bỏ, và 5 lỗ hổng dưới đây chưa có ca nào phủ.

---

## 8. Review chuỗi solve → mua hàng sau khi bật tự động duyệt

Nhánh `sanxuat-stage-v13` (4 commit của đồng đội) đã nối đúng quyết định của Sếp: sau
`saveSuccess()`, `runSolverAndSave()` gọi thẳng `this.approve()` trong try/catch riêng (approve lỗi
không được biến một lần **tính thành công** thành FAILED), kèm thông báo QLSX đổi nội dung theo
kết quả. Đồng thời bỏ hằng số cứng `STEEL_WAREHOUSE_CODE = 'phoi-son-han'`, chuyển sang tra kho
**theo từng vật tư** (`Material.warehouseId`), và xoá module `material-inspection` (~1000 dòng).

Chuỗi hiện tại:

```
Sếp duyệt PI ─→ items APPROVED ─→ ProductionOrder ─→ PI = PRODUCING
                                        └→ requestForInvoice (best-effort, chạy ngầm)
                                              └→ solver (lần 1 → auto_scan lần 2 nếu cần)
                                                    └→ saveSuccess (DRAFT)
                                                          └→ approve()  ← TỰ ĐỘNG
                                                                ├→ supersede phương án khác
                                                                ├→ khoá stock_quant, trừ tồn
                                                                └→ PurchaseProposal (NEW) → Mua hàng
```

**Vấn đề gốc:** từ lúc Sếp bấm duyệt tới lúc tồn kho bị trừ và đề xuất mua nằm trên bàn Mua hàng
giờ **không còn một điểm dừng nào của con người**, nhưng phần lớn code bên trong `approve()` vẫn
viết theo giả định cũ *"có người nhìn bản DRAFT rồi mới bấm"*. Cả 5 lỗ dưới đây là hệ quả của
khoảng cách đó.

**Nguyên tắc khi sửa:** quyết định của Sếp là *"không bắt người bấm duyệt"*, **không phải** *"mọi
kết quả solver đều đúng"*. Nên giữ nguyên tự động duyệt, chỉ thêm **một cổng điều kiện** trước nó
— tự duyệt vẫn là đường mặc định, chỉ dừng lại đúng những ca mà trước đây mắt QLSX đang bắt.

| Lỗ | Trạng thái |
|---|---|
| 8.1 supersede quét nhầm toàn hệ thống | ✅ **Đã sửa** |
| 8.2 "Tính lại" trừ kho 2 lần + đề xuất mua trùng | ✅ **Đã sửa** |
| 8.3 phương án không cắt được vẫn tự duyệt, im lặng | ✅ **Đã sửa** (BE + chặn Phôi) |
| 8.4 người "duyệt" bị gán sai, quyền APPROVE đi vòng | ✅ **Đã sửa** (hệ quả của 8.2) |
| 8.5 bút toán kho ngoài transaction | ❌ **Chưa sửa** — cần đổi thiết kế `StockLedgerService`, xem 8.7 |

### 8.1. Lỗ 1 — supersede quét nhầm toàn hệ thống ✅

`cutting-proposals.service.ts:692-699` lọc `productionOrderId: proposal.productionOrderId`. Với
phương án của PI gộp, trường này **luôn null** → Prisma dịch thành `WHERE productionOrderId IS
NULL`, khớp **mọi** phương án gộp khác trong hệ thống chứ không chỉ anh em cùng nhóm.

Đã chứng minh bằng dữ liệu thật (xem mục 7). Trước đây cần người bấm duyệt; giờ tự chạy sau **mỗi**
lần solve xong.

**Đã sửa** — `approve()` tự phân nhánh theo đúng cái neo của chính phương án đó:

```ts
const siblingAnchor = proposal.productionOrderId
  ? { productionOrderId: proposal.productionOrderId }
  : proposal.productionInvoiceId
    ? { productionInvoiceId: proposal.productionInvoiceId }
    : null;
```

`siblingAnchor = null` (phương án không neo vào đâu — dữ liệu hỏng, không sinh ra được qua
`requestForOrder`/`requestForInvoice`) thì **bỏ qua hẳn bước supersede**, thà không làm gì còn hơn
quét trúng cả bảng.

*Test mới:* `phương án của đợt gộp chỉ supersede anh em CÙNG đợt…` — assert `where` chứa
`productionInvoiceId` và **`not.toHaveProperty('productionOrderId')`** (chính chỗ biến bộ lọc thành
`IS NULL`); `không supersede gì cả khi phương án không neo vào PO lẫn PI`.

### 8.2. Lỗ 2 — "Tính lại" trừ kho hai lần và đẻ hai đề xuất mua ✅

Nặng nhất, và **mới phát sinh do đúng thay đổi tự-động-duyệt này**:

- Nút "Tính lại" (`cutting-proposals-api.ts:82-88`) gửi `withIdempotencyKey()` **sinh key mới mỗi
  lần bấm** → luôn tạo một `CuttingProposal` mới.
- Proposal mới solve xong → tự `approve()` → trừ kho lần nữa. Khoá idempotency của bút toán là
  `cutting-proposal:{id}:steel-issue:{materialId}` — **khoá theo id phương án, không theo nhu
  cầu** → id khác thì trừ lại từ đầu.
- Proposal cũ bị đánh `SUPERSEDED`, nhưng grep toàn bộ `src/` cho thấy **`SUPERSEDED` được GHI
  đúng một chỗ và không được ĐỌC ở bất cứ đâu**. `PurchaseProposal` của phương án cũ vẫn sống
  nguyên ở Mua hàng, có thể đã `QUOTING`/`SUBMITTED`/`PURCHASING`.

Một cú bấm: tồn kho trừ đôi (có thể âm), Mua hàng thấy 2 đề xuất cùng một nhu cầu → mua thừa tiền
thật. Và **không có endpoint nào huỷ được `PurchaseProposal`** (chỉ có `reject` → `requote`), nên
không có đường lùi.

**Đã sửa** — nhánh (b) của cổng `autoApproveBlockReason()` mới: đếm phương án `APPROVED` khác cùng
neo, có thì **không tự duyệt**. Người thật vẫn duyệt tay được qua `POST
/cutting-proposals/:id/approve` sau khi đã xử lý đề xuất mua cũ — chặn ở đây chỉ chặn đường **tự
động**, không khoá nghiệp vụ.

*Test mới:* `KHÔNG tự duyệt lần 2 cho cùng một nhu cầu đã có phương án APPROVED…` — assert đúng
`where` của câu đếm, và assert `purchaseProposal.create` + `stockLedgerService.postEntry` **không
được gọi**.

### 8.3. Lỗ 3 — phương án "không cắt được" vẫn tự duyệt, và im lặng ✅

`buyableLines` lọc `feasible && totalBars > 0`, rồi toàn bộ phần tạo đề xuất mua nằm trong
`if (buyableLines.length > 0)`.

- Solver trả 200 kèm dòng `feasible: false` là chuyện bình thường — chính code ở dòng 880 đang xử
  lý ca đó để retry `auto_scan`. Nhưng **sau retry không kiểm lại lần nữa**.
- Nếu retry vẫn không ra: phương án vẫn `saveSuccess` → DRAFT → tự APPROVED; vật tư infeasible
  **không** vào đề xuất mua; QLSX nhận thông báo *"đã tính xong và tự động duyệt / Đã tự trừ tồn
  kho và chuyển đề xuất mua hàng"* — nội dung sai sự thật.
- Ca lẫn lộn tệ hơn (4 vật tư được, 1 không): đề xuất mua tạo cho 4 cái, cái thứ 5 biến mất không
  dấu vết, tới xưởng mới lòi ra thiếu sắt.
- Phôi **không bị chặn**: `steel-issues.service.ts:349-360` chỉ tìm `cuttingProposalLine` theo
  `materialId` + proposal `APPROVED`, **không lọc `feasible: true`** — mà `saveSuccess` tạo dòng
  cho cả vật tư infeasible.

Đây đúng là việc mà con mắt QLSX đang gánh và giờ bị bỏ trống.

**Đã sửa, 2 tầng:**

1. Nhánh (a) của `autoApproveBlockReason()`: còn bất kỳ dòng `feasible: false` nào thì **không tự
   duyệt**, báo QLSX kèm **mã vật tư** (đổi id → `Material.code`, vì "vật tư 201" không giúp được
   gì cho người đọc). Lưu ý solver **đã** tự retry `auto_scan` trước khi tới cổng này — còn
   infeasible ở bước này nghĩa là đã dò hết dải chiều dài mà vẫn không xếp được.
2. `SteelIssuesService.assertMaterialInApprovedProposal()` thêm `feasible: true` vào `where`, và
   sửa lời báo lỗi thành *"đã duyệt **và cắt được**"*. Không có bước này thì kể cả khi phương án
   được duyệt tay, Phôi vẫn xuất được sắt theo dòng không có pattern nào để làm theo.

*Test mới:* `KHÔNG tự duyệt khi còn vật tư feasible=false…` (assert vẫn lưu DRAFT bình thường —
**chặn duyệt khác với đánh hỏng lần tính** — không APPROVED, không tạo đề xuất mua, không post bút
toán, thông báo chứa mã `SAT-201` và cụm "Chưa trừ tồn kho"); `chỉ chấp nhận dòng phương án CẮT
ĐƯỢC…` bên `steel-issues.service.spec.ts`.

### 8.4. Lỗ 4 — người "duyệt" bị gán sai, quyền APPROVE bị đi vòng ✅

`approve(proposalId, requestedById ?? null)` ghi `approvedById = requestedById`. Ở luồng "Tính
lại", người bấm chỉ cần `CUTTING_PROPOSAL:CREATE`, trong khi endpoint `POST
/cutting-proposals/:id/approve` đòi `CUTTING_PROPOSAL:APPROVE` — đường tự động **bỏ qua hoàn toàn**
lớp kiểm quyền đó, và nhật ký ghi tên họ là người duyệt.

**Đã sửa — không cần code riêng**, đây là hệ quả tự nhiên của 8.2: sau khi chặn tự-duyệt-lần-2,
"Tính lại" **không bao giờ** tự duyệt được nữa (lần tính đầu đã sinh phương án APPROVED), nên
không còn đường nào để người chỉ có `CREATE` gây ra một lượt duyệt. Ở luồng Sếp duyệt PI thì
`approvedById = Sếp` vẫn đúng nghĩa — Sếp bấm duyệt là biết sẽ kéo theo trừ kho + mua hàng.

### 8.5. Lỗ 5 — bút toán kho nằm ngoài transaction ❌ (chưa sửa)

`cutting-proposals.service.ts:763-777`: transaction commit xong (proposal APPROVED +
`PurchaseProposal` đã tạo với `buyQty` tính theo giả định *sẽ* trừ kho) rồi mới post `StockLedger`.
Chết giữa chừng → đề xuất mua đã ra ngoài nhưng tồn chưa trừ. `idempotencyKey` khiến chạy lại an
toàn, nhưng **không có gì chạy lại**. Đây là thiết kế có sẵn từ trước; điều đổi là trước còn người
ngồi đó thấy lỗi, giờ chỉ còn một dòng log.

### 8.6. Tổng hợp thay đổi đã thực hiện

**3 file sản phẩm, 2 file test, 0 migration** — không đụng phần tự-động-duyệt/warehouse của đồng
đội, merge chung an toàn.

| File | Thay đổi |
|---|---|
| [`cutting-proposals.service.ts`](../src/modules/cutting-proposals/cutting-proposals.service.ts) | `approve()`: `siblingAnchor` phân nhánh theo neo (lỗ 1). `runSolverAndSave()`: gọi cổng `autoApproveBlockReason()` trước khi tự duyệt + thông báo QLSX tách 3 nhánh (lỗ 2/3/4). Thêm hàm `autoApproveBlockReason()` (~45 dòng kể cả docstring). |
| [`steel-issues.service.ts`](../src/modules/steel-issues/steel-issues.service.ts) | `assertMaterialInApprovedProposal()`: thêm `feasible: true`, sửa lời báo lỗi (lỗ 3, tầng Phôi). |
| `cutting-proposals.service.spec.ts` | Mock `cuttingProposal.findUniqueOrThrow` + mặc định `count = 0`; **4 test mới**. |
| `steel-issues.service.spec.ts` | **1 test mới**. |

**Thông báo QLSX — 3 nhánh riêng biệt** (trước chỉ có 2, và ca thành công luôn nói *"đã tự trừ tồn
kho và chuyển đề xuất mua hàng"* kể cả khi không có dòng nào mua được):

| Ca | Tiêu đề | Nội dung |
|---|---|---|
| Tự duyệt xong | `… đã tính xong và tự động duyệt` | Đã trừ tồn kho + chuyển đề xuất mua sang Mua hàng |
| **Bị cổng chặn** | `… đã tính xong - CẦN DUYỆT TAY` | Lý do cụ thể + **"Chưa trừ tồn kho, chưa tạo đề xuất mua hàng"** + việc cần làm |
| Lỗi kỹ thuật | `… tự động duyệt thất bại` | Thông điệp lỗi thật + hướng dẫn duyệt lại thủ công |

Tách 3 nhánh là **cố ý**: việc QLSX phải làm khác hẳn nhau — bị chặn thì xem lại phương án/gộp tổ
hợp khác, còn lỗi kỹ thuật thì duyệt lại tay.

### 8.7. Còn lại — chưa sửa

1. **Lỗ 5 (bút toán ngoài transaction)** — cần đổi `StockLedgerService.postEntry()` để nhận `tx`,
   ảnh hưởng cả `WarehouseTransfersService`/`PurchaseProposalsService` đang dùng chung idiom này.
   Không gộp vào đợt sửa này để giữ phạm vi hẹp.
2. **`PurchaseProposalStatus.CANCELLED` + endpoint huỷ** — hiện không có đường lùi nào cho một đề
   xuất mua đã ra sai; đây là lỗ hổng nghiệp vụ chứ không chỉ lỗi code. Cổng ở 8.2 chặn được
   nguyên nhân sinh ra đề xuất trùng, nhưng những bản đã lỡ sinh ra trước đó vẫn cần dọn tay.
3. **Khoá idempotency bút toán** đổi từ `cutting-proposal:{id}` sang khoá theo **nhu cầu**
   (`production-order:{id}` / `production-invoice:{id}`) — để trừ kho trùng bị **DB** chặn ở tầng
   cuối, không chỉ dựa vào cổng logic ở 8.2.
4. **`PurchaseProposalsService` không enforce warehouse scope** — bất kỳ tài khoản PURCHASER nào
   cũng thao tác được đề xuất của kho khác, dù hệ thống có sẵn 3 account phân kho
   (`muapsh`/`muavttp`/`muatp`). Chưa xác minh đây là cố ý hay thiếu sót.
5. **`weaving-issues.service.ts` không typecheck ở HEAD `14eea28`** — 2 lỗi `TS2339`/`TS2741` về
   `isWoven` (dòng 191 và 301), kéo theo `weaving-issues.service.spec.ts` không chạy được. Đã xác
   minh bằng cách stash thay đổi của mình rồi chạy lại `tsc`: **lỗi có sẵn trên nhánh, không phải
   do đợt sửa này**. Cần đồng đội xử lý — nhiều khả năng `bomPiece.findMany` thiếu `isWoven` trong
   `select`.

---

## 9. Review BE + FE theo chuẩn quy trình & nghiệp vụ ERP

Đợt review riêng, **chỉ đọc, chưa sửa gì**. Phạm vi: FE `purchasing-api.ts`, `purchasingRouting.ts`,
`InspectionContext.tsx`, `TheoDoiMuaHangPage`, `NhapKhoPage`, `LenhMuaNCCPage`; BE
`purchase-proposals`, `cutting-proposals`, `steel-issues`, `stock-ledger` + trigger
`trg_sync_stock_quant`.

Khác mục 8 (soi ranh giới transaction và tính đúng đắn của code), mục này soi **quy trình nghiệp
vụ**: chứng từ, truy vết, kiểm soát nội bộ, thời điểm ghi nhận.

### 9.1. Frontend

#### A1 — Mọi thao tác ghi đều nuốt lỗi 🔴

[`InspectionContext.tsx:150-204`](../../DNA-ERP/src/context/InspectionContext.tsx) — cả 5 mutation
(`submitProposalToDirector`, `approveProposal`, `rejectProposal`, `requoteProposal`,
`receiveProposalItem`) đều kết thúc bằng `.catch(err => console.error(...))`. Không toast, không
banner, không rollback state, không disable nút.

Thủ kho bấm "Xác nhận nhận hàng", BE trả 400 → ô nhập vẫn trống đi như bình thường (`setInputs`
chạy trước, `NhapKhoPage.tsx:64`), bảng không đổi, không ai biết gì. **Hàng đã nằm trong kho vật
lý, hệ thống không ghi nhận.**

Không phải rủi ro lý thuyết: đồng đội **vừa thêm** một đường ném lỗi mới vào đúng `receiveItem()`
(`Vật tư ... chưa được cấu hình Kho`) — mọi vật tư chưa gán kho sẽ rơi thẳng vào cái `console.error`
này, người dùng thấy thao tác "thành công".

Với ERP, thất bại im lặng trên chứng từ tiền/kho là lỗi UI nặng nhất — nặng hơn crash, vì crash ít
ra còn thấy.

#### A2 — Đơn giá hiển thị có thể sai người, sai giá 🟠

`TheoDoiMuaHangPage.tsx:33`:
```ts
const chosenQuote = offers.find(q => q.supplierName === ncc) ?? offers[0]
```
Hai vấn đề chồng nhau: (1) khớp báo giá **theo tên NCC** — đúng cái mà `approveProposal()` đã bỏ
(`D.h3-quote-id-not-name`, comment ghi rõ *"2 báo giá có thể trùng tên NCC (hợp lệ, BE không
cấm)"*), trùng tên thì `find()` trả bản đầu, có thể không phải bản Sếp duyệt; (2) `?? offers[0]` —
chưa chọn NCC nào thì hiện đại giá báo giá đầu tiên, **không dấu hiệu nào** cho biết đó không phải
giá được duyệt.

`ProposalQuote.id` đã có sẵn trong state và `isChosen` đã về từ BE — nên tra bằng `isChosen`.

#### A3 — Cột "Hạn giao"/"Deadline" vĩnh viễn rỗng 🟠

`purchasing-api.ts:11` ghi rõ *"`deadline` chưa có nguồn dữ liệu — luôn `undefined`"*. Nhưng **3
màn** đang render nó như thông tin thật, còn tô đỏ + in đậm: `TheoDoiMuaHangPage` (2 chỗ),
`NhapKhoPage:85`. Cột luôn hiện `—`.

Về nghiệp vụ đây là lỗ hổng thật chứ không chỉ lỗi hiển thị: **Mua hàng không có bất kỳ tín hiệu ưu
tiên nào** — không biết đơn nào giao tuần này, đơn nào tháng sau. Dữ liệu **đã có sẵn**: PI gộp lấy
hạn FRAME sớm nhất của cả nhóm làm `deadline` và `approveBatch()` chạy qua đúng nó, chỉ là chưa
truyền xuống `PurchaseProposal`.

#### A4 — Phân công mua hàng chỉ tồn tại ở trình duyệt 🟠

`purchasingRouting.ts` lọc đề xuất theo `Material.buyerId`, toàn bộ chạy **client-side**. BE
`PurchaseProposalsService` không có một dòng kiểm nào về buyer hay warehouse scope → nhân viên mua
hàng A gọi thẳng API vẫn `acknowledge`/`addQuote`/`submit` được đề xuất của B (đều chỉ đòi
`PURCHASE_PROPOSAL:UPDATE`, mà mọi PURCHASER đều có).

Hệ thống có sẵn 3 account phân kho `muapsh`/`muavttp`/`muatp` — sự phân chia đó hiện chỉ là trang
trí. Phân tách nhiệm vụ (segregation of duties) là yêu cầu kiểm soát nội bộ cốt lõi của ERP; lọc ở
FE là tiện dụng, không phải kiểm soát. *(Trùng với mục 8.7 ý 4, nay đã xác minh rõ.)*

#### A5 — N+1 request trên mọi màn Mua hàng 🟢

`purchasing-api.ts:181-185`: load danh sách = **1 + N** request (limit 100 → tối đa 101). Cộng
thêm `submitProposalToDirector`/`approveProposal`/`receiveProposalItem` mỗi cái gọi thêm một `GET
detail` chỉ để dịch `materialId → itemId`. Cách sửa rẻ nhất: BE cho `GET /purchase-proposals` trả
kèm `items` (`LIST_INCLUDE` đã có sẵn quan hệ), FE bỏ vòng lặp.

#### A6 — Comment mô tả sai hành vi thật, trên đường tiền 🟢

`InspectionContext.tsx:178-179` và `purchasing-api.ts:219-220` đều nói requote *"giữ báo giá cũ làm
lịch sử"*. BE thật thì ngược lại — `requote()` chạy `purchaseProposalQuote.deleteMany(...)` **xoá
sạch**, comment BE ghi rõ *"không giữ làm lịch sử nữa - đổi 2026-08-11"*. FE chưa cập nhật theo.

### 9.2. Backend — góc nhìn nghiệp vụ

#### B1 — `PurchaseProposal` không có số chứng từ riêng 🟡

Đề xuất mua hiển thị bằng `poNumber` — mã **lệnh sản xuất**, không phải mã của chính nó; không có
trường `code`. Hệ quả: hai đề xuất sinh từ cùng một PI (đúng kịch bản "Tính lại" ở lỗ 2) hiện **cùng
một "số PO"** — không phân biệt được trên màn hình, không truy vết được khi tranh chấp với NCC.

Mọi chứng từ khác đều có số riêng (`PI-2026-015`, `PO-9`) — riêng chứng từ dính tiền thì không.

#### B2 — Không có đường huỷ / đảo chứng từ 🟡

Vòng đời: `NEW → QUOTING → SUBMITTED → PURCHASING → PURCHASED`, nhánh phụ `SUBMITTED → REJECTED →
QUOTING`. `REJECTED` nghĩa là *"Sếp bác giá, báo lại đi"* — **không phải huỷ**. Không trạng thái nào
nghĩa là "đề xuất này sai, bỏ đi", và không có cách nào đảo bút toán `STEEL_ISSUE` đã trừ kho lúc
duyệt phương án cắt.

Một khi phương án cắt sai đã được duyệt (nay là **tự động**), không có đường lùi nào trong hệ thống
— phải sửa tay dưới DB. Khả năng đảo bút toán là yêu cầu nền của mọi ERP, không phải tính năng nâng
cao. *(Trùng mục 8.7 ý 2, nay có thêm ngữ cảnh vòng đời.)*

#### B3 — Nhận thừa bị cắt âm thầm 🔴

`purchase-proposals.service.ts:257`:
```ts
const nextReceivedQty = Math.min(buyQty, currentReceivedQty + dto.receivedQty);
```
Đặt 10 cây, NCC giao 12, thủ kho nhập 12 → hệ thống ghi **10**, hai cây kia biến mất khỏi sổ nhưng
vẫn nằm trong kho thật. Không cảnh báo, không log. **Tồn hệ thống lệch tồn thực ngay từ lúc nhập.**

Chuẩn ERP: khai báo dung sai giao thừa; vượt dung sai thì **chặn và báo**, trong dung sai thì ghi
nhận đủ số thật. Cắt im lặng là lựa chọn tệ nhất trong ba.

#### B4 — Ghi nhận tiêu hao ở thời điểm duyệt kế hoạch, không phải lúc xuất thật ⚪

**Câu hỏi thiết kế, không phải bug.** Sếp đã chốt 2026-08-07 (*"trừ tồn tự động, hiện qua mua hàng,
không hiện ở kho"*), và `SteelIssuesService` **cố ý không** ghi `StockLedger` để tránh trừ hai lần
(docstring dòng 43-46). Code nhất quán với quyết định đó.

Nhưng hệ quả kế toán kho nên được nói ra: sổ ghi *"sắt rời kho"* tại thời điểm **duyệt phương án
cắt**, trong khi Phôi thực sự lấy sắt vài ngày sau. Giữa hai mốc, sổ nói kho trống nhưng sắt vẫn
nằm trên giá — kiểm kê thực tế trong khoảng này **luôn lệch**, và lệch "đúng theo thiết kế" nên
không ai truy được.

Mô hình chuẩn tách hai khái niệm: **đặt giữ** (reservation — giảm khả dụng, không giảm tồn) lúc
duyệt kế hoạch, **tiêu hao** (issue — giảm tồn thật) lúc `SteelIssue`. Codebase đã có sẵn khái niệm
này ở `WarehouseTransferReservation`.

Không cần sửa gấp — nhưng nên là quyết định có ý thức của Sếp, không phải hệ quả phụ không ai để ý.

#### B5 — Mẫu nguyên không được nhập lại sổ ⚪

Solver trả `mau_nguyen_mm`, `saveSuccess()` lưu vào cả `CuttingProposalLine` lẫn
`CuttingProposalPattern`, nhưng không bút toán nào cộng phần sắt còn nguyên đó về kho.

Đây là **phạm vi đã chốt của Phase 9** (chỉ xuất/hiển thị cho Phôi, không tự động cộng/trừ kho) nên
ghi lại để không rơi mất, không tính là phát hiện mới. Lưu ý: kết hợp với B4, hao hụt sổ sách sẽ
**luôn lớn hơn** hao hụt thật và tích luỹ theo thời gian.

### 9.3. Xếp ưu tiên

| # | Vấn đề | Mức | Chi phí |
|---|---|---|---|
| 1 | **A1** thất bại im lặng trên nhập kho/duyệt mua | 🔴 Chặn deploy | Nhỏ — toast + rollback ở 5 chỗ |
| 2 | **B3** nhận thừa bị cắt âm thầm | 🔴 Cao | Nhỏ — đổi `Math.min` thành kiểm + ném lỗi |
| 3 | **A2** đơn giá hiển thị sai | 🟠 Cao | Rất nhỏ — dùng `isChosen` thay vì so tên |
| 4 | **A4** phân công mua hàng không được BE kiểm | 🟠 Cao | Vừa — thêm guard scope ở service |
| 5 | **A3** deadline không truyền xuống Mua hàng | 🟠 Vừa | Vừa — thêm cột + truyền từ PI |
| 6 | **B1** số chứng từ riêng cho đề xuất mua | 🟡 Vừa | Vừa — thêm field + migration |
| 7 | **B2** đường huỷ/đảo chứng từ | 🟡 Vừa | Lớn — trạng thái mới + bút toán đảo |
| 8 | **A5** N+1, **A6** comment lệch | 🟢 Thấp | Nhỏ |
| 9 | **B4** thời điểm ghi nhận tiêu hao | ⚪ Cần Sếp quyết | — |

Ba mục đầu nên xử lý **trước khi deploy** — đều rẻ, và cả ba đều dẫn tới **sai lệch số liệu mà không
ai biết**, là loại hỏng khó phát hiện nhất về sau.

> ⚠ Bảng trên **đã bị thay thế** bởi bảng ở cuối [9.4](#94-đối-chiếu-lại-với-code--4-phát-hiện-bổ-sung)
> sau khi đối chiếu lại với code — 4 mục đổi ước tính chi phí, 4 mục mới xen vào. Giữ lại nguyên
> văn để thấy đánh giá ban đầu.

### 9.4. Đối chiếu lại với code + 4 phát hiện bổ sung

Đợt kiểm lại toàn bộ mục 9 trên code thật ở HEAD (`14eea28` BE / `c21c19d` FE) — **vẫn chỉ đọc,
chưa sửa gì**. Kết quả: **11/11 phát hiện đúng và tái hiện được**. Bốn chỗ cần chỉnh so với bản
viết ban đầu, và bốn thứ mục 9 đã bỏ sót.

#### Bốn chỗ cần chỉnh

| Mục | Bản đầu nói | Thực tế trên code |
|---|---|---|
| **A1** | 5 mutation nuốt lỗi | **6** — sót `acknowledgeProposal` ([`InspectionContext.tsx:138-145`](../../DNA-ERP/src/context/InspectionContext.tsx)). Và FE **không có hạ tầng toast nào** (không dependency, không component trong `src/components/`) → ước tính "chi phí nhỏ" hơi lạc quan, phải tự dựng chỗ hiển thị |
| **A2** | "`isChosen` đã về từ BE nên tra bằng `isChosen`" | BE có trả (`BeQuote.isChosen`), nhưng **adapter đánh rơi** khi map sang `ProposalQuote` ([`purchasing-api.ts:143-150`](../../DNA-ERP/src/services/purchasing-api.ts)) — phải sửa cả adapter + type, không chỉ sửa trang |
| **A3** | "Vừa — thêm cột + truyền từ PI" | **Không cần migration.** `LIST_INCLUDE` đã kéo sẵn `productionInvoice` (có `deadline`), và nhánh lệnh SX đơn lẻ đi được `ProductionOrder → productionInvoiceItem → ProductionInvoiceItemStage(FRAME).deadline`. Thuần đọc, chỉ thêm `include` + field DTO → rẻ hơn hẳn |
| **B3** | 1 lỗi (`Math.min`) | Cùng hàm `receiveItem()` còn **2 lỗi nữa** — xem C2/C3 dưới |

#### C1 — Toàn bộ đường tiền không có audit trail ở server 🔴

`PurchaseProposal`, `PurchaseProposalItem`, `PurchaseProposalQuote`, `CuttingProposal` **đều không
có** trong `AUDITED_MODELS` ([`audit-log.extension.ts:13-54`](../src/prisma/extensions/audit-log.extension.ts)),
trong khi `SalesOrder`/`ProductionInvoice`/`WarehouseTransfer`/`SteelIssue`/`QcReview` đều có.

Phía FE thì `logAction()` ghi vào **mockStore trong trình duyệt**
([`lib/mock/services/audit-log.service.ts`](../../DNA-ERP/src/lib/mock/services/audit-log.service.ts))
— mất sạch khi F5, không bao giờ chạm tới BE.

Hệ quả: **ai duyệt báo giá nào, lúc mấy giờ, đổi từ giá nào sang giá nào — không tồn tại bản ghi
nào cả.** Hạ tầng đã có đủ (`writeAuditLog()` đã export sẵn, CLS đã gắn user/ip/correlationId),
chỉ là chưa bật cho đúng nhóm bảng dính tiền. Nặng hơn B1: số chứng từ giúp *gọi tên* tranh chấp,
vết duyệt mới là thứ *giải quyết* được nó.

#### C2 — `approve()` không kiểm giá 🟠

`submit()` bắt buộc mỗi vật tư có ≥1 báo giá `unitPrice > 0` (dòng 138-145). Nhưng `approve()`
([`purchase-proposals.service.ts:164-175`](../src/modules/purchase-proposals/purchase-proposals.service.ts))
chỉ kiểm báo giá được chọn **có thuộc đúng item** hay không — không kiểm giá. `unitPrice` là
`Decimal?` (nullable).

Nghĩa là: vật tư có 2 báo giá, một cái có giá (qua được cổng `submit`), một cái để trống — Sếp bấm
nhầm cái để trống là **duyệt xong một lệnh mua không có giá**. Màn Theo dõi mua hàng hiện `—` ở cột
Đơn giá, không cảnh báo gì.

#### C3 — `receiveItem()` race + bút toán không nguyên tử 🔴

Hai lỗi chồng nhau trong cùng một hàm, ngoài `Math.min` đã nêu ở B3:

1. **Read-modify-write không khoá dòng.** `currentReceivedQty` đọc từ `findDetailOrThrow()` ở đầu
   hàm, `nextReceivedQty` tính ngoài transaction, rồi mới `update`. Hai lần nhận hàng song song
   trên cùng item → cả hai cùng đọc `receivedQty = 0`, lần ghi sau đè lần trước, **mất một lần
   nhận** trên sổ đề xuất — nhưng **cả hai đều đã post bút toán kho** (mỗi lần một
   `Idempotency-Key` khác nhau, `withIdempotencyKey()` sinh mới mỗi lời gọi).
2. **Bút toán post NGOÀI transaction cập nhật.** Ledger ghi ở dòng 275-289, `receivedQty` cập nhật
   ở dòng 291-314 trong một `$transaction` riêng. Chết giữa hai đoạn (timeout, deploy, mất kết
   nối) → **kho đã cộng hàng, đề xuất vẫn ghi chưa nhận, vĩnh viễn**. Không có cơ chế nào phát
   hiện hay dọn.

Đây chính là phần mà ghi chú Lỗ 5 ở [mục 10](#10-trạng-thái-cuối-phiên--việc-còn-lại) nói *"chưa
đụng `receiveItem()`"* — nay đã xác minh là lỗ thật, không phải chỉ thiếu đối xứng về style.

#### C4 — Thủ kho có quyền báo giá 🟠

`WAREHOUSE_STAFF` được cấp `PURCHASE_PROPOSAL: [VIEW, UPDATE]`
([`role-permissions.constant.ts:207`](../src/common/constants/role-permissions.constant.ts)) để
`NhapKhoPage` gọi được `POST .../items/:itemId/receive`. Nhưng **cùng một action `UPDATE`** đang
gác luôn `acknowledge`, `items/:id/quotes`, `submit`, `requote`
([`purchase-proposals.controller.ts`](../src/modules/purchase-proposals/purchase-proposals.controller.ts)
dòng 50/56/62/84) → thủ kho gọi thẳng API là **tự báo giá và tự gửi Sếp duyệt** được.

Đúng loại lỗ mà comment ở dòng 427 của chính file đó đã cẩn thận vá cho `PURCHASER` (cố ý bỏ
`APPROVE`, ghi rõ *"lỗ hổng đã xác nhận, sửa 2026-08-11, D.h4-purchaser-approve"*) — nhưng để hở ở
chiều ngược lại. Cùng với A4, đây là mảng phân tách nhiệm vụ (segregation of duties) yếu nhất của
hệ thống hiện tại.

#### Trả lời câu hỏi gốc: BE/FE đã chuẩn nghiệp vụ ERP chưa?

**Phần luồng: chuẩn.** State machine rõ ràng và được `assertStatus()` gác thật, ledger bất biến +
trigger đồng bộ `stock_quant`, idempotency key trên mọi bút toán, RBAC 2 tầng (permission +
mfgRole/warehouseScope), audit log đã có hạ tầng đầy đủ.

**Phần kiểm soát nội bộ: chưa.** Bốn thứ nền của một ERP đang thiếu trên đúng nhánh dính tiền:
vết duyệt (C1), số chứng từ riêng (B1), đường huỷ/đảo (B2), và phân tách nhiệm vụ được enforce ở
server (A4 + C4).

**Về phạm vi:** module "Mua hàng" hiện là **phiếu đề nghị mua (PR)**, chưa phải PO — không có tổng
tiền, VAT, điều khoản thanh toán, phiếu nhập kho riêng (`receivedQty` chỉ là bộ đếm cộng dồn trên
dòng đề xuất, không có chứng từ nhập từng đợt), không đối chiếu 3 chiều PO/GRN/hoá đơn. Với quy mô
hiện tại điều đó **chấp nhận được** — miễn là không gọi nó là PO trong báo cáo cho Sếp.

#### Bảng ưu tiên (thay cho 9.3)

| # | Vấn đề | Mức | Chi phí | Đợt |
|---|---|---|---|---|
| 0 | 2 lỗi TS có sẵn ở `weaving-issues.service.ts` chặn cả `tsc`/`jest` — **thật ra là Prisma client cũ**, `npx prisma generate` là xong | 🔴 Chặn mọi verify | Rất nhỏ ✅ **đã xong** | [0](#đợt-0--gỡ-chốt-chặn) |
| 1 | **A1** thất bại im lặng trên nhập kho/duyệt mua | 🔴 Chặn deploy | Vừa (phải dựng chỗ hiển thị lỗi) | [1](#đợt-1--chặn-deploy-a1-b3-a2-c2) |
| 2 | **B3** nhận thừa bị cắt âm thầm | 🔴 Cao | Nhỏ | 1 |
| 3 | **C3** race + bút toán không nguyên tử khi nhận hàng | 🔴 Cao | Vừa (nối tiếp Lỗ 5) | [2](#đợt-2--kiểm-soát-nội-bộ-c1-c4-a4-c3) |
| 4 | **C1** không có vết duyệt trên đường tiền | 🔴 Cao | **Rất nhỏ** — thêm 2 tên vào `AUDITED_MODELS` | 2 |
| 5 | **A2** đơn giá hiển thị sai | 🟠 Cao | Rất nhỏ | 1 |
| 6 | **C2** duyệt được báo giá không có giá | 🟠 Cao | Rất nhỏ — 3 dòng | 1 |
| 7 | **C4** thủ kho báo giá được | 🟠 Cao | Nhỏ | 2 |
| 8 | **A4** phân công mua hàng không được BE kiểm | 🟠 Cao | Vừa | 2 |
| 9 | **A3** deadline không tới Mua hàng | 🟠 Vừa | **Nhỏ** — thuần đọc, không migration | [3](#đợt-3--cần-sếp-quyết-trước-khi-code) |
| 10 | **B1** số chứng từ riêng | 🟡 Vừa | Vừa — migration + backfill | 3 |
| 11 | **B2** đường huỷ/đảo chứng từ | 🟡 Vừa | Vừa — rẻ hơn dự tính, xem 11.4 | 3 |
| 12 | **A5** N+1, **A6** comment lệch | 🟢 Thấp | Nhỏ | [4](#đợt-4--dọn-dẹp-a5-a6) |
| 13 | **B4** thời điểm ghi nhận tiêu hao, **B5** mẫu nguyên | ⚪ Cần Sếp quyết | — | 3 |

---

## 10. Trạng thái cuối phiên & việc còn lại

| Hạng mục | Trạng thái |
|---|---|
| Tính năng gộp SKU (BE + FE) | ✅ Hoàn tất, đã commit & push |
| Migration `20260814063306_merged_production_invoice` | ✅ Đã chạy **local**, ⚠ **chưa chạy production** |
| Fix circuit breaker + `nextProductionInvoiceCode` | ✅ Đã commit (`d9b9e89`) |
| Chỉ báo "Đang tính…" | ✅ Xác nhận đúng trong trình duyệt thật |
| Kiểm chứng chạy thật (UI + API + e2e) | ✅ Đã chạy, kết quả ở mục 7 |
| **Lỗ 1-4 ở mục 8** | ✅ **Đã sửa**, 438/438 test pass — ⚠ **chưa commit**, đang nằm trong working tree |
| **Lỗ 5 ở mục 8** | ⚠ **Đang làm dở, CHƯA được duyệt** — xem ghi chú dưới bảng |
| **4 việc còn lại ở 8.7** | ❌ Chưa sửa — có chủ ý, để giữ phạm vi đợt sửa hẹp |
| **15 phát hiện ở mục 9 + 9.4** (A1-A6, B1-B5, C1-C4) | ✅ **11/15 đã sửa** (A1-A6, C1-C4) trong cùng phiên viết kế hoạch, 484/484 test pass — chi tiết ở [mục 12](#12-kết-quả-thực-thi--1115-phát-hiện-đã-sửa-2026-08-15). ⚠ **B1/B2/B4/B5 vẫn chờ Sếp quyết** (Đợt 3, cố ý chưa code) |
| **2 lỗi TS có sẵn ở `weaving-issues.service.ts`** | ✅ **Đã xong** — nguyên nhân là Prisma client cũ, `npx prisma generate` là hết; không đụng code ([Đợt 0](#đợt-0--gỡ-chốt-chặn)) |
| Chạy lại e2e 2 nhóm để nghiệm thu lỗ 1 trên dữ liệu thật | ⚠ **Chưa chạy lại** sau khi sửa (mới chỉ có test đơn vị) |
| Bộ 87 test case | ✅ Đã bàn giao, ⚠ chưa cập nhật theo mục 8 |
| Deploy BE/FE production | ⚠ Chưa deploy kể từ các thay đổi này |

> ⚠ **Ghi chú về Lỗ 5 — thay đổi chưa được duyệt.** Phần này được viết khi chưa xin phép (yêu cầu
> lúc đó là *review*, không phải sửa) và **đang dở**: đã đụng `prisma.service.ts` (thêm kiểu
> `PrismaTx`), `stock-ledger.service.ts` (`postEntry` nhận `tx`) và một phần `approve()` (khoá
> `FOR UPDATE` dòng phương án, sắp thứ tự `materialId`, gom bút toán vào cùng transaction, nới
> `timeout` 15s) — **chưa** đụng `receiveItem()`, và **chưa chạy `tsc`/`jest` lần nào** sau đó.
> Cần quyết định giữ hay gỡ trước khi commit bất cứ thứ gì.

**Việc tiếp theo nên làm ngay** (chi tiết cách làm ở [mục 11](#11-kế-hoạch-sửa)):
1. Sửa 2 lỗi TS ở `weaving-issues.service.ts` — không có bước này thì không verify được gì.
2. Chốt giữ hay gỡ phần Lỗ 5 đang dở ở trên. *Đề xuất: giữ và làm nốt — C3 cần chính nó.*
3. Chạy lại kịch bản `e2e-full-flow.mjs` (2 nhóm gộp độc lập) để nghiệm thu lỗ 1 trên dữ liệu thật
   — test đơn vị chứng minh `where` đã đúng, nhưng chính kịch bản đó là thứ phát hiện ra bug ban
   đầu nên cũng phải là thứ xác nhận nó đã hết.
4. Xử lý [Đợt 1](#đợt-1--chặn-deploy-a1-b3-a2-c2) (A1, B3, A2, C2) trước khi deploy.

**Không nằm trong phạm vi phiên này:** `ProductionOrder` vẫn 1-1 theo SKU (Phôi/Hàn/Sơn/KCS chạy y
như cũ); luồng duyệt per-item của PI thường không đụng tới; mẫu nguyên/hàn nối cây vẫn do thủ kho
tự tính, tự nhập tồn.

---

## 11. Kế hoạch sửa

Cách sửa cụ thể cho toàn bộ 15 phát hiện ở [mục 9](#9-review-be--fe-theo-chuẩn-quy-trình--nghiệp-vụ-erp)
+ [9.4](#94-đối-chiếu-lại-với-code--4-phát-hiện-bổ-sung). **Chưa code gì** — đây là kế hoạch chờ
duyệt.

Nguyên tắc xếp đợt: **không xếp theo độ rẻ, xếp theo "sai mà không ai biết"**. Một lỗi hiển thị sai
giá thì kế toán còn phát hiện được lúc đối chiếu; một lỗi trừ kho trùng thì không ai phát hiện cho
tới lúc kiểm kê cuối kỳ, và lúc đó không truy ngược được nữa.

### Đợt 0 — Gỡ chốt chặn

Không có bước này thì **không đợt nào verify được**: `tsc` đang đỏ ở HEAD nên `jest` cũng không
chạy được module đó.

1. **Sửa 2 lỗi TS có sẵn** ở `weaving-issues.service.ts`. ✅ **ĐÃ XONG** — và nguyên nhân **không
   phải** như hai lần phỏng đoán trước:
   - ❌ Không phải thiếu `select` (phỏng đoán ở [8.7 ý 5](#87-những-gì-cố-ý-chưa-làm)).
   - ❌ Không phải `isWoven` nằm nhầm trên `Piece` (phỏng đoán ở bản đầu mục 11). `BomPiece.isWoven`
     **có thật** trong [`schema.prisma:638`](../prisma/schema.prisma), có docstring mô tả rõ đây là
     snapshot cố ý, và có migration `20260814160000_add_bom_piece_is_woven_snapshot`.
   - ✅ **Nguyên nhân thật: Prisma client generated bị cũ.** Schema + migration đã có field, nhưng
     `src/generated/prisma/models/BomPiece.ts` chưa được sinh lại nên TS không thấy. Code ở dòng
     191 và 301 **viết đúng ngay từ đầu**, không phải sửa gì.
   - **Fix: `npx prisma generate`.** Không đụng một dòng code nào. `tsc --noEmit` sạch sau đó.
   - *Bài học: lỗi `TS2339` trên field vừa thêm bằng migration thì nghi client cũ trước, đừng nghi
     code. Cả hai phỏng đoán trước đều "sửa" code đang đúng — nếu làm theo sẽ phá đúng cái snapshot
     mà docstring dòng 633-637 dặn phải giữ.*
2. **Chốt số phận phần Lỗ 5 đang dở** trong working tree (xem ghi chú ở
   [mục 10](#10-trạng-thái-cuối-phiên--việc-còn-lại)).
   **Đề xuất: giữ và làm nốt.** Hướng của nó đúng, và C3 ở đợt 2 cần chính cái `postEntry(tx)` +
   kiểu `PrismaTx` mà nó đã thêm. Gỡ đi rồi viết lại là phí công hai lần.
3. Chạy `tsc` + `jest` xanh → mới bắt đầu đợt 1.

### Đợt 1 — Chặn deploy (A1, B3, A2, C2)

Bốn mục này chung một đặc điểm: **sai số liệu mà không ai biết**. Đó là lý do chúng đi trước —
không phải vì rẻ.

#### A1 — sửa hợp đồng của context, **đừng** dựng toast system

Gốc bệnh là 6 hàm `void` fire-and-forget, không phải thiếu toast. Dựng một thư viện toast là chữa
triệu chứng và kéo thêm dependency. Ba việc:

1. Đổi 6 mutation trong `InspectionContext.tsx` thành `async (...) => Promise<void>`:
   `.catch(console.error)` → `setError(msg)` **rồi `throw` tiếp** (để call site nào cần rollback
   thì `await` được).
2. Thêm đúng **một** `<ActionErrorBanner/>` render ngay trong `InspectionProvider` khi
   `error != null` — ~30 dòng, không thêm dependency. Một chỗ phủ cả 6 hành động.
3. [`NhapKhoPage.tsx:58-66`](../../DNA-ERP/src/modules/pages/Manufacturing/NhapKhoPage.tsx):
   `await receiveProposalItem(...)` **rồi mới** `setInputs('')`; thêm state `pending` để khoá nút
   trong lúc request đang bay.

Chỉ chỗ thứ 3 mới cần rollback thật (ô nhập đã bị xoá trước khi biết kết quả) — 5 chỗ còn lại
banner là đủ. **Không đụng call site nào khác** để giữ phạm vi hẹp.

#### B3 — không dùng `Math.min`, nhưng cũng đừng chặn cứng

Chặn cứng thì thủ kho cầm 12 cây mà chỉ ghi được 10 → họ sẽ bịa số ở chỗ khác, tệ hơn hiện tại.

- Đọc `purchase.overReceiptTolerancePercent` từ module `system-config` **đã có sẵn**, mặc định `0`.
- Trong dung sai → **ghi đúng số thật** (cho phép `receivedQty > buyQty`).
- Vượt dung sai → `BadRequestException` nêu rõ ba số: `buyQty` / đã nhận / đang nhập.
- `allReceived` đang dùng `>=` nên không phải sửa; FE `remaining` đã có `Math.max(0, …)` nên cũng
  không.

#### A2 — chuyển `isChosen` qua adapter rồi mới sửa trang

1. Thêm `isChosen: boolean` vào type `ProposalQuote`, map ở
   [`purchasing-api.ts:143`](../../DNA-ERP/src/services/purchasing-api.ts).
2. [`TheoDoiMuaHangPage.tsx:33`](../../DNA-ERP/src/modules/pages/Purchasing/TheoDoiMuaHangPage.tsx):
   `offers.find(q => q.isChosen)`, **bỏ hẳn `?? offers[0]`** — chưa duyệt thì hiện `—`, đó mới là
   sự thật.
3. Tiện thể hiện `expectedDate` của báo giá được chọn thành cột **"NCC hẹn giao"**: dữ liệu đã nằm
   sẵn trong state, **0 chi phí BE**, và nó giải quyết được phần lớn nhu cầu nghiệp vụ của A3 ngay
   lập tức (Mua hàng có tín hiệu ưu tiên để xếp việc, dù chưa phải hạn giao từ kế hoạch).

#### C2 — 3 dòng

Trong vòng lặp validate của `approve()` (dòng 164-175), thêm kiểm: báo giá được chọn phải có
`unitPrice != null && unitPrice > 0`, ném `BadRequestException` kèm mã vật tư nếu không.

### Đợt 2 — Kiểm soát nội bộ (C1, C4, A4, C3)

#### C1 — rẻ đến bất ngờ, giá trị cao nhất trong cả kế hoạch

- Thêm `'PurchaseProposal'` và `'CuttingProposal'` vào `AUDITED_MODELS`. **Xong** — mọi chuyển
  trạng thái đều đi qua `.update()` nên tự động có `oldValue`/`newValue` + actor + IP +
  correlationId. Không sửa service nào.
- Bảng con không auto-audit (đúng convention sẵn có, xem comment dòng 34-36 của extension) → gọi
  tay `writeAuditLog()` — hàm này **đã export sẵn cho đúng ca này**, `production-invoices.service.ts`
  là tiền lệ — ở **hai** chỗ:
  - `approve()`: ghi `chosenQuoteId` + đơn giá + NCC của từng item. Đây là quyết định tiền, và
    quote là bảng con nên không được auto-audit.
  - `requote()`: nó `deleteMany` toàn bộ báo giá cũ — tức là đang **xoá bằng chứng**. Phải chụp
    lại trước khi xoá.
- FE: bỏ 5 lời gọi `logAction` cho proposal trong `InspectionContext`, trỏ `AuditLogTimeline` sang
  `GET /audit-log`. Giữ mockStore lại là tự lừa mình — nó hiển thị một lịch sử trông như thật
  nhưng biến mất khi F5.

#### C4 — tách quyền nhận hàng khỏi quyền báo giá

Thêm module quyền `PURCHASE_RECEIPT` (VIEW/UPDATE), gắn vào route `/receive`, cấp cho
`WAREHOUSE_STAFF`, và **rút** `PURCHASE_PROPOSAL:UPDATE` khỏi role đó (giữ `VIEW` để `NhapKhoPage`
vẫn liệt kê được). Một constant + một decorator + một dòng seed.

#### A4 — mirror đúng luật FE, không phát minh luật mới

Một hàm private `assertActorMayHandle(proposal, userId)` gọi ở `acknowledge`/`addQuote`/`submit`/
`requote`. Luật **sao chép nguyên** từ
[`purchasingRouting.ts:17-30`](../../DNA-ERP/src/utils/purchasingRouting.ts): BOSS qua hết; ngược
lại phải có ≥1 item mà `material.buyerId` là `null` hoặc `=== userId`.

Giữ nguyên cả luật *"dòng chưa gán ai thì ai cũng thao tác được"* — đây là **vá lỗ gọi thẳng API**,
không phải đổi nghiệp vụ. Muốn siết luật đó thì là quyết định riêng của Sếp, làm sau.

#### C3 — gộp tất cả vào một transaction

`SELECT … FOR UPDATE` dòng item → tính lại `nextReceivedQty` **bên trong** tx → `postEntry(tx)` →
update item → chuyển `PURCHASED` nếu đủ. Tất cả một tx duy nhất.

Đây chính là phần Lỗ 5 chưa đụng tới; làm nốt theo đúng pattern nó đã dựng (`PrismaTx`,
`postEntry` nhận `tx`). Nhớ nới `timeout` như đã làm cho `approve()`.

### Đợt 3 — Cần Sếp quyết trước khi code

- **A3** (deadline): thuần đọc, không migration. Thêm `include` stages + field `deadline` vào
  `PurchaseProposalResponseDto`, lấy `cuttingProposal.productionInvoice.deadline` (nhánh PI gộp)
  ?? `productionOrder.productionInvoiceItem.stages` lọc `FRAME` (nhánh lệnh SX đơn). FE chỉ map
  thêm một field. **Nếu đã làm cột "NCC hẹn giao" ở đợt 1 thì độ gấp giảm hẳn** — cân nhắc gộp
  luôn vào đợt 4.
- **B1** (số chứng từ `PR-2026-NNN`): tái dùng idiom `nextProductionInvoiceCode` đã có. Migration
  + backfill cho dòng cũ. Nếu C1 đã xong thì độ gấp giảm — vết duyệt mới là thứ chặn tranh chấp,
  số chứng từ chỉ giúp *gọi tên* nó.
- **B2** (huỷ/đảo): **không thêm `REVERSAL` vào `StockLedgerRefType`.** Ledger vốn đã có hướng
  (`fromWarehouseId`/`toWarehouseId`) → chỉ cần post bút toán **ngược chiều**, giữ nguyên
  `refType`, `idempotencyKey = cancel:cutting-proposal:{id}`. Rẻ hơn (không đụng enum, không đụng
  trigger), và giữ được khả năng đối chiếu theo cặp thuận/nghịch.
  **Cần Sếp chốt:** ai được huỷ, và huỷ được tới trạng thái nào. *Đề xuất: chỉ tới trước
  `PURCHASING`; sau đó hàng đã đặt với NCC nên phải đảo bằng chứng từ riêng, không rút lệnh.*
- **B4** (đặt giữ vs tiêu hao) và **B5** (mẫu nguyên): thuần quyết định của Sếp, **chưa code**.
  Nếu chọn tách thì `WarehouseTransferReservation` đã có sẵn khái niệm để tái dùng.

### Đợt 4 — Dọn dẹp (A5, A6)

- **A5**: `LIST_INCLUDE` thêm `items: { include: ITEM_INCLUDE }` → FE bỏ vòng `Promise.all` ở
  [`purchasing-api.ts:181-185`](../../DNA-ERP/src/services/purchasing-api.ts) **và** bỏ luôn 3 lời
  gọi `getBeItemIdsByMaterialId` (itemId lúc đó đã có sẵn trong state). 101 request → 1.
- **A6**: sửa 2 comment ở `InspectionContext.tsx:178-179` và `purchasing-api.ts:219-220` cho khớp
  hành vi thật của `requote()` (xoá sạch, không giữ lịch sử).

---

## 12. Kết quả thực thi — 11/15 phát hiện đã sửa (2026-08-15)

Đã chạy tuần tự Đợt 0 → Đợt 4 theo [mục 11](#11-kế-hoạch-sửa) trong cùng phiên viết kế hoạch.
**Chỉ B1/B2/B4/B5 (Đợt 3, cần Sếp quyết trước) là chưa code** — đúng như kế hoạch đã định, không
phải bỏ sót. Toàn bộ đã qua `tsc --noEmit` (cả BE lẫn FE) + `jest` sạch ở mỗi bước, không dồn lại
verify 1 lần ở cuối.

**Trạng thái cuối cùng:** BE `tsc` sạch, FE `tsc` sạch, ESLint sạch, **484/484 test BE pass**
(461 gốc lúc bắt đầu phiên này, trong đó 9 đang fail vì Lỗ 5 chưa từng chạy qua `jest` - xem Đợt
0.2 dưới đây; +23 test mới viết trong phiên). Chưa chạy migration
`20260815060000_add_purchase_over_receipt_tolerance` lên DB thật (theo đúng quy ước "không tự
chạy migration") - schema.prisma và migration file đã sẵn sàng, chỉ còn `npx prisma migrate
deploy`.

### Ba chỗ thực tế khác kế hoạch ban đầu

| Việc | Kế hoạch nói | Thực tế làm |
|---|---|---|
| **Đợt 0** | Sửa `bp.isWoven` → `bp.piece.isWoven` (2 dòng code) | **Chẩn đoán sai.** `BomPiece.isWoven` có thật trong schema (migration `20260814160000` đã thêm) - lỗi TS chỉ vì Prisma client generated cũ. Fix thật: `npx prisma generate`, **0 dòng code đổi**. Đã sửa lại đoạn này trong mục 11 ngay khi phát hiện, xem ghi chú ở đó. |
| **C1 (FE)** | "Trỏ `AuditLogTimeline` sang `GET /audit-log`" | `AuditLogTimeline` dùng chung cho ~20 trang khác (SKU/User/KCS...) chưa có audit BE tương ứng - đổi component dùng chung sẽ phá các trang đó. Làm component riêng **`PurchaseProposalAuditTrail.tsx`** chỉ cho 2 chỗ (`BossApp.tsx`, `LenhMuaNCCPage.tsx`), tự resolve `userId → tên` qua `getUsers()` vì BE `audit_logs` chỉ lưu `userId`. `AuditLogTimeline` + mockStore giữ nguyên cho các trang khác. |
| **A3** | "Thêm `include` stages + field `deadline`, lấy `productionInvoice.deadline` ?? `stages` lọc FRAME" | Tìm thấy `ProductionInvoiceItem.materialDeadline` đã có sẵn trong schema (chưa module nào set/đọc) và một hàm `frameDeadlineOf()` **y hệt logic cần** đã tồn tại ở `ProductionInvoicesService`/`CuttingProposalsService` (`materialDeadline → mốc FRAME → hạn cả PI`). Nhân bản đúng 3 dòng đó theo convention đã có của repo (comment ở 2 chỗ kia: "trùng lặp rẻ hơn dựng ràng buộc giữa module"), không tự nghĩ ra query mới. |

### Việc phát sinh ngoài phạm vi 15 phát hiện gốc

- **Đợt 0.2** không chỉ "chạy lại test cho xanh" như dự tính - phần Lỗ 5 (khoá `FOR UPDATE` +
  transaction ở `CuttingProposalsService.approve()`) viết dở từ trước **chưa từng chạy qua
  `jest` một lần nào**. Sửa mock `$queryRaw` để phân biệt 2 câu SQL khác nhau nó gọi (khoá dòng
  phương án vs khoá `stock_quant`), và thêm 2 test mới phủ đúng race nó được sinh ra để chặn
  (2 lượt duyệt chèn nhau giữa cổng ngoài và lúc khoá được dòng).
- **C3** phát hiện thêm: sau khi sửa `postEntry()` nhận `tx`, mọi assertion cũ kiểm tham số của
  nó bị lệch arity (1 tham số → 2) - không phải lỗi logic, nhưng phải sửa toàn bộ assertion liên
  quan ở cả 2 spec file (`cutting-proposals`, `purchase-proposals`) để test tiếp tục xác nhận
  đúng nội dung bút toán, không chỉ đúng số tham số.
- Trong lúc chạy `tsc` giữa A4 và C3, gặp một loạt lỗi TS **hoàn toàn không liên quan**
  (`skus.service.ts`, field `manhForwardedAt`/`IN_PROGRESS`) - cùng loại nguyên nhân với Đợt 0
  (client Prisma cũ), nhưng lần này do `dist/.tsbuildinfo` (cache incremental build) giữ type
  cũ. Xoá cache là xong, không đụng code `skus.service.ts`.

### Việc còn lại thật sự (không phải quên)

1. **Chạy migration** `20260815060000_add_purchase_over_receipt_tolerance` lên DB dev/staging
   trước khi deploy - cột mới có `@default(0)` nên an toàn, không cần backfill.
2. **B1, B2, B4, B5** vẫn đang chờ Sếp quyết theo đúng lịch ở [Đợt 3](#đợt-3--cần-sếp-quyết-trước-khi-code)
   - không phải việc bị bỏ sót, mà là việc cố ý không code khi chưa có quyết định.
3. **Nghiệm thu qua UI thật chưa làm** trong phiên này - toàn bộ xác nhận ở trên là `tsc` +
   `jest` (unit test, prisma mock). Cần chạy `e2e-full-flow.mjs` hoặc thao tác tay qua trình
   duyệt trước khi coi các mục Đợt 1/2 là "xong" theo tiêu chuẩn đã đặt ở
   [mục 7](#7-kiểm-chứng) của changelog này.

### Cái nên chủ động KHÔNG làm bây giờ

Đừng dựng `PurchaseOrder` / `GoodsReceipt` / đối chiếu 3 chiều / VAT / điều khoản thanh toán. Đó là
đúng hướng ERP nhưng là **một phase riêng**, và 13 mục ở trên rẻ hơn nhiều lần mà bịt được trọn bộ
nhóm "sai số liệu âm thầm" — vốn là rủi ro đang có thật, không phải rủi ro giả định.
