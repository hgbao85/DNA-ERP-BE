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
> - [Mục 13](#13-thiết-kế-b4--tách-đặt-giữ-khỏi-tiêu-hao-cho-vật-tư-sắt-2026-08-17) — **thiết kế
>   B4** sau khi Sếp chốt hướng (2026-08-17): tách đặt giữ khỏi tiêu hao. Gồm một cái bẫy nghiêm
>   trọng nếu làm ẩu, 6 lỗ hổng phải vá kèm, kế hoạch 3 đợt. **Đã code xong cả 3 đợt (2026-08-18),
>   2 câu hỏi nghiệp vụ đều đã có trả lời của Sếp** — xem [13.7](#137-câu-hỏi-treo).
> - [Mục 14](#14-bỏ-auto_scan--solver-chỉ-tính-trên-cây-6000mm-2026-08-18) — **bỏ `auto_scan`**:
>   solver chỉ tính trên cây 6000mm, không tự dò cỡ đặt riêng nữa. Đảo ngược quyết định 2026-08-06;
>   lý do: cỡ cây tìm ra không mua được, và hao hụt báo cáo sai ~9 lần so với thực tế.
> - [Mục 15](#15-review-không-khả-thi-của-solver--trạng-thái-màn-cắt-sắt-2026-08-18--67-mục-xong) —
>   **6/7 MỤC XONG**. `feasible: false` gộp 3 nghĩa khác nhau, BE vứt bỏ lý do solver gửi kèm - đã
>   vá: chặn tự-duyệt khi vượt ngưỡng (lỗ hổng đang chạy: phương án vượt ngưỡng từng tự duyệt → trừ
>   kho → mua, không cảnh báo), chặn sớm khi ngân sách thời gian solver vượt timeout HTTP client,
>   migration lưu lý do solver trả về, 3 chip hiển thị (Đang tính/Đạt/Cần xử lý) thay 5 trạng thái
>   DB, route "Tính lại" cho phiếu gộp (trước đây không tồn tại, luôn lỗi), poll có điều kiện +
>   chống treo `CALCULATING`, cảnh báo "nhu cầu nhỏ, cận dưới không đáng tin" trên màn gộp. Rút lại
>   đề xuất "nới ngưỡng" (vòng review 3) vì tái tạo lại đúng lỗi `auto_scan`. Còn thiếu duy nhất:
>   trần số SKU gộp (mục 6b - cần spike dữ liệu UAT để chọn ngưỡng).
> - [Mục 16](#16-cutlengthmm-và-các-field-hao-hụt-phái-sinh-int---decimal-2026-08-19) — đổi
>   `SegmentSpec.cutLengthMm` (+ 5 field hao hụt phái sinh) từ `Int` sang `Decimal(...,1)`, KHÔNG
>   phải `Float` (solver cố ý tránh số thực nhị phân, xem 16.2). Phát hiện qua đối chiếu với BOM gốc
>   trong code solver: 2 giá trị đã bị làm tròn mất 0,3-0,5mm. Sửa 1 rủi ro thầm lặng (khoá `Map`
>   dựng từ `Decimal` không khớp khoá tra cứu từ số JSON thường) + 1 blind spot `tsc` không bắt được
>   (field `unknown` khiến response trả chuỗi thay vì số). Phát hiện thêm 1 bug 500 thật (hệ quả của
>   việc dọn `CuttingProposal` test - `purchase-proposals.service.ts` ép kiểu non-null sai), đã sửa
>   + test hồi quy. 562/562 test pass, live-test qua trình duyệt xác nhận. **Cập nhật 2026-08-20
>   (16.8)**: giải conflict thủ công với commit của đồng nghiệp làm schema.prisma khai trùng field -
>   chặn prisma generate/tsc toàn repo. Đã dọn field trùng, xác nhận không có xung đột thật với phần
>   redesign SteelIssue của đồng nghiệp. 563/563 test pass.

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

> **Cập nhật 2026-08-17:** Sếp đã chọn hướng tách hai khái niệm. Bản thiết kế đầy đủ (kèm một cái
> bẫy nghiêm trọng phát hiện khi review lại code) nằm ở
> [mục 13](#13-thiết-kế-b4--tách-đặt-giữ-khỏi-tiêu-hao-cho-vật-tư-sắt-2026-08-17).

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
   *(Cập nhật 2026-08-17: **B4 đã có hướng của Sếp** - bản thiết kế đầy đủ ở
   [mục 13](#13-thiết-kế-b4--tách-đặt-giữ-khỏi-tiêu-hao-cho-vật-tư-sắt-2026-08-17), vẫn chưa code
   vì còn 2 câu hỏi phải chốt. **B1 cũng đã có hướng** - "mua theo mã PI" - và đã sửa xong ở
   `PurchaseProposalsService.toResponseDto()`, chưa commit.)*
3. **Nghiệm thu qua UI thật chưa làm** trong phiên này - toàn bộ xác nhận ở trên là `tsc` +
   `jest` (unit test, prisma mock). Cần chạy `e2e-full-flow.mjs` hoặc thao tác tay qua trình
   duyệt trước khi coi các mục Đợt 1/2 là "xong" theo tiêu chuẩn đã đặt ở
   [mục 7](#7-kiểm-chứng) của changelog này.

### Cái nên chủ động KHÔNG làm bây giờ

Đừng dựng `PurchaseOrder` / `GoodsReceipt` / đối chiếu 3 chiều / VAT / điều khoản thanh toán. Đó là
đúng hướng ERP nhưng là **một phase riêng**, và 13 mục ở trên rẻ hơn nhiều lần mà bịt được trọn bộ
nhóm "sai số liệu âm thầm" — vốn là rủi ro đang có thật, không phải rủi ro giả định.

---

## 13. Thiết kế B4 — Tách "đặt giữ" khỏi "tiêu hao" cho vật tư sắt (2026-08-17)

> **Trạng thái: bản thiết kế, CHƯA code.** Phần "Cần Sếp chốt" ở cuối mục này phải có câu trả lời
> trước khi bắt đầu Đợt 2. Đợt 1 không phụ thuộc vào các câu trả lời đó, làm trước được.

### 13.1. Quyết định của Sếp

Sếp chốt hướng xử lý cho [B4](#b4--ghi-nhận-tiêu-hao-ở-thời-điểm-duyệt-kế-hoạch-không-phải-lúc-xuất-thật-):

> *"Event sắt từ kho sắt qua Phôi thì thủ kho Phôi Sơn Hàn nhập số lượng sắt rồi bên kia chỉ việc
> thực hiện."*

Nghĩa là: mốc ghi sổ *"sắt rời kho"* chuyển từ **lúc duyệt phương án cắt** sang **lúc thủ kho thực
sự xuất sắt** — đúng mô hình đặt giữ/tiêu hao đã nêu ở B4.

Bối cảnh cần nhớ khi đọc mục này: Kho sắt và xưởng cắt là **cùng một chỗ vật lý** (kho
`phoi-son-han`, xem `prisma/seed.ts:45-50`) — hệ thống chỉ có 1 kho, không có bước chuyển kho nào ở
giữa. Vì cùng một chỗ nên **không có mốc vật lý tự nhiên nào** để bám (khác nhánh mua hàng: xe giao
tới là mốc rõ ràng), buộc phải chọn một mốc thao tác làm quy ước — và đó chính là thứ đang được
chọn lại ở đây.

### 13.2. Phát hiện quan trọng nhất — "dời chỗ trừ tồn" là một cái bẫy

Việc trừ tồn ở `CuttingProposalsService.approve()` **không chỉ là ghi sổ kế toán** — nó đang kiêm
luôn vai trò **giành chỗ (allocation)**. Nếu chỉ bê bút toán từ `approve()` sang
`SteelIssuesService.create()`, sẽ tạo ra một bug **nặng hơn** vấn đề đang sửa:

| Bước | Tồn kho | Phương án A (cần 100) | Phương án B (cần 100) |
|---|--:|---|---|
| Đầu | 100 | | |
| Duyệt A | 100 (chưa trừ) | thấy 100 → dùng kho 100, **mua 0** | |
| Duyệt B | 100 (**vẫn nguyên**) | | thấy 100 → dùng kho 100, **mua 0** |
| Phôi lấy sắt cho A | 0 | ✅ | |
| Phôi lấy sắt cho B | **−100** | | ❌ không có sắt — mà Mua hàng đã báo "không cần mua gì" |

Đây **không phải rủi ro giả định**: chính comment ở `cutting-proposals.service.ts:805-810` mô tả
đúng ca này như một lỗi đã gặp và đã vá (*"hai lượt duyệt gần nhau cùng đọc một số dư, cùng tiêu một
lô sắt, tồn xuống âm và cả hai đều báo Mua hàng không cần mua gì"*). Cặp `FOR UPDATE` trên
`stock_quant` (dòng 756-766) + bút toán nằm **trong cùng transaction** (dòng 811-825) tồn tại chính
là để chặn nó.

> **Hệ quả bắt buộc:** muốn dời mốc trừ tồn thì **phải** thay thế bằng cơ chế **đặt giữ
> (reservation)**. Đây không phải phần "làm cho đẹp" có thể cắt bớt để tiết kiệm — bỏ nó đi là mở
> lại đúng lỗ hổng vừa vá xong.

### 13.3. Tài sản đã có sẵn — không phải làm từ đầu

| Thứ đã có | Ở đâu | Dùng được gì |
|---|---|---|
| **Bản thiết kế logic đầy đủ** | `DNA-ERP/docs/thiet-ke-giu-cho-khau-tru-ton-kho.md` (2026-06-27, *"chưa triển khai"*) | Chốt sẵn `onHand`/`reserved`/`available`/`onOrder`, 3 phép toán, vòng đời phiếu giữ chỗ, ví dụ 4 PO. **QĐ-1 của tài liệu trùng khớp quyết định của Sếp**. Tài liệu nằm ở repo FE dù là logic BE — lịch sử để lại, không phải nhầm chỗ |
| **Code mẫu chạy thật** | `WarehouseTransfersService.createTransfer()` dòng 104-121 | Đúng pattern `available = onHand − reserved` với `FOR UPDATE`; giải phóng ở `confirm()` (455-458) và `reject()` (487-490) |
| **Bảng giữ chỗ** | `WarehouseTransferReservation` (`schema.prisma:1737-1752`), enum `ReservationStatus` ACTIVE/RELEASED | Khuôn mẫu cột + index `[warehouseId, materialId]` |
| **Màn hình thủ kho xuất sắt** | FE `XuatSatPage.tsx` — đã nối BE thật từ 2026-08-12 (M3) | Thủ kho `phoi-son-han` đã nhập số cây theo từng mảnh, gọi `POST /production-orders/:id/steel-issues`. **Không cần dựng màn hình mới** |
| **Tiền lệ trừ tồn đúng mốc** | `MaterialIssuesService.postLedgerEntry()` (238-253) | Nhánh vật tư tiêu hao (sơn/dây) **đã** trừ tồn lúc thủ kho thực xuất. Sắt đang là nhánh duy nhất lệch chuẩn này |

### 13.4. Sáu lỗ hổng phải vá kèm

Không vá kèm thì đổi mốc trừ tồn sẽ để lại hậu quả:

| # | Vấn đề | Vị trí | Vì sao nguy hiểm sau khi đổi |
|---|---|---|---|
| 1 | **Không chặn xuất thừa** | `SteelIssuesService.create()` (100-113) | `barCount` không đối chiếu gì với phương án cắt. `getIssuePlan()` (254-310) có số liệu tham chiếu nhưng `create()` không dùng. Hiện tại gõ nhầm 100 thay vì 10 là vô hại; sau khi đổi sẽ **âm kho im lặng** |
| 2 | **`postEntry()` không chặn tồn âm** | `stock-ledger.service.ts:77-79` | Chỉ kiểm `qty > 0`, không kiểm số dư sau bút toán. Không có lưới an toàn tầng dưới cho #1 |
| 3 | **Sắt mua về không có chủ** | `PurchaseProposalsService.receiveItem()` | Hàng về vào tồn chung; phương án khác duyệt xen giữa có thể "mượn" mất phần đã mua đích danh cho đơn này (mục 3.2 tài liệu thiết kế đã tính, code chưa) |
| 4 | **Giữ chỗ mồ côi khi SUPERSEDED** | `approve()` dòng 724-733 | Duyệt phương án mới sẽ supersede phương án cũ. Giữ chỗ của bản cũ phải được giải phóng, nếu không kho bị **khoá ảo vĩnh viễn** (available tụt mà không ai tiêu) |
| 5 | **Dữ liệu cũ bị trừ hai lần** | migration | Phương án đã APPROVED trước mốc đổi **đã trừ tồn** theo cách cũ. Nếu Phôi chưa xuất hết, sau khi đổi mỗi lần xuất sẽ trừ **lần nữa** |
| 6 | **Hai bảng giữ chỗ = bẫy tương lai** | thiết kế | Nếu thêm bảng mới mà công thức `available` chỉ cộng một bảng, luồng chuyển kho và luồng cắt sắt sẽ **giành nhau cùng lô hàng** mà không ai phát hiện |

### 13.5. Thiết kế

**Nguyên tắc: một sự kiện — một ý nghĩa.** `approve()` = *"hứa"*, `SteelIssue` = *"lấy thật"*.

```
Duyệt phương án cắt        →  reserved += min(cần, available)   [onHand KHÔNG đổi]
                           →  phần thiếu → PurchaseProposal      [onOrder]
Mua hàng nhận sắt về       →  onHand += q,  reserved += q        [available không đổi — hàng có chủ]
Thủ kho xuất sắt cho Phôi  →  onHand -= q,  reserved -= q        [StockLedger STEEL_ISSUE ghi ở ĐÂY]
Phương án supersede/huỷ    →  reserved -= phần chưa xuất         [trả hàng về available]
```

**Chọn bảng giữ chỗ.** Ba phương án đã cân nhắc:

| Phương án | Đánh giá |
|---|---|
| Mở rộng `WarehouseTransferReservation` (cho `transferId` nullable + thêm `cuttingProposalId`) | ❌ Bảng thành đa hình nửa vời, tên bảng nói dối nội dung |
| Bảng `StockReservation` mới, **migrate** luôn warehouse-transfer sang | ⚠ Sạch nhất về lâu dài, nhưng bắt phải sửa code chuyển kho đang chạy tốt — rủi ro không đáng lúc này |
| ✅ **Bảng `StockReservation` mới, chưa migrate transfer** | Dùng cho cắt sắt ngay; giữ nguyên code chuyển kho. **Bắt buộc kèm điều kiện dưới đây** |

> **Điều kiện bắt buộc của phương án đã chọn (vá lỗ #4 trong bảng 13.4 → #6):** công thức tính
> available phải nằm ở **đúng một hàm dùng chung** `getAvailableQty(tx, warehouseId, materialId)`,
> cộng tổng **cả hai bảng** giữ chỗ. Không nơi nào được tự viết lại phép trừ này. Migrate
> warehouse-transfer sang bảng chung là việc dọn dẹp riêng, làm sau, không chặn Đợt 2.

`StockReservation` đi theo idiom `refType`/`refId` sẵn có của `StockLedger` (không FK cứng đa bảng —
xem `schema.prisma:1605-1607`), thêm `consumedQty` để hỗ trợ Phôi lấy sắt làm nhiều đợt (giữ chỗ 100
cây, xuất 30/40/30), tự chuyển RELEASED khi `consumedQty >= quantity`.

### 13.6. Phân đợt — mỗi đợt tự đứng vững

**Đợt 1 — Nền giữ chỗ** *(không đổi hành vi người dùng nhìn thấy)*
Thêm bảng `StockReservation` + hàm `getAvailableQty()` dùng chung. `approve()` vừa trừ tồn như cũ,
**vừa** ghi giữ chỗ song song — chưa ai đọc số liệu giữ chỗ đó. Deploy an toàn tuyệt đối, để quan
sát dữ liệu thật xem giữ chỗ có khớp thực tế không trước khi tin vào nó.

**Đợt 2 — Đảo mốc trừ tồn** *(đợt thật sự đổi nghiệp vụ)*
- `approve()`: bỏ `postEntry`, chỉ còn tạo giữ chỗ; `buyQty` tính theo `available` thay vì `onHand`.
- `SteelIssuesService.create()`: thêm `postEntry` + giảm giữ chỗ, trong **một** transaction có
  `FOR UPDATE` (bê nguyên pattern `approve()` đang dùng).
- Vá lỗ #1 (chặn xuất thừa) và #2 (chặn tồn âm).
- Vá lỗ #5: backfill dữ liệu — đánh dấu mọi phương án duyệt **trước** mốc đổi là "đã tiêu thụ",
  không sinh giữ chỗ cho chúng.
- Cập nhật docstring `SteelIssuesService` (42-47) và comment schema (`schema.prisma:1761-1764`) —
  cả hai đang ghi *"cố ý KHÔNG ghi StockLedger"*, sẽ thành sai ngay khi Đợt 2 xong.

**Đợt 3 — Khép vòng**
- Vá lỗ #3 (hàng mua về gắn chủ) và #4 (giải phóng giữ chỗ khi supersede/huỷ).
- FE: `XuatSatPage` hiện cột tồn khả dụng (hiện **không hiện tồn gì cả** — thủ kho đang nhập mù);
  đổi nhãn cột "Tồn" ở màn Mua hàng sang `available` (đúng mục 10 tài liệu thiết kế).

### 13.7. Câu hỏi treo

**Cả 2 câu đã có trả lời (2026-08-18) — mục này không còn gì chặn.**

1. ✅ **ĐÃ CHỐT 2026-08-18 — Đơn đã mua sắt rồi mà khách huỷ: cứ để sắt đó trong kho, thành tồn
   chung.** Nguyên văn Sếp: *"thì cứ để đó thôi chứ sao anh, mua rồi đâu trả được"*.

   Đây là OQ-1 trong tài liệu thiết kế `DNA-ERP/docs/thiet-ke-giu-cho-khau-tru-ton-kho.md` (mục 6)
   — treo từ 2026-06-27 tới nay. Tài liệu đó nêu 3 lựa chọn (trả về tồn chung / chuyển đích danh
   sang đơn khác / để riêng có nhãn "từ đơn huỷ"); Sếp chọn **phương án 1**, với lý do thực tế:
   không có đường trả hàng lại NCC nên sắt chắc chắn nằm trong kho, không cần cơ chế gì phức tạp
   hơn "ai cần thì dùng".

   **Hệ quả cho code — KHÔNG phải sửa gì, hành vi hiện tại đã đúng:**
   - `receiveItem()` gọi `postEntry(PURCHASE)` trước → sắt vào `stock_quant` thật, luôn luôn.
   - `topUpFromReceipt()` gặp giữ chỗ `RELEASED` (phương án đã chết) → **bỏ qua**, không giữ cho
     ai → `available` = full → đơn khác dùng được ngay. Đúng nghĩa "cứ để đó".
   - **KHÔNG** xây: luồng trả hàng NCC, nhãn "hàng từ đơn huỷ", bảng theo dõi sắt mồ côi riêng.
   - Truy vết vẫn còn nguyên dù không gắn nhãn: dòng `StockLedger` refType=PURCHASE giữ `refId` =
     đề xuất mua gốc, tra ngược ra được đơn nào đã mua lô sắt đó.

   **Lưu ý khi xây tính năng "huỷ đơn"** (hiện chưa có): chỉ cần `releaseByRef()` giữ chỗ của
   phương án cắt tương ứng - đúng cùng cách supersede đang làm, không cần thêm luật mới.

2. ✅ **ĐÃ CHỐT 2026-08-18 — Xuất thừa so với phương án cắt: CHẶN CỨNG, không dung sai.**

   Câu hỏi này bị đặt sai ngay từ đầu (bởi Claude), do suy diễn máy móc "Mua hàng có dung sai thì
   Xuất sắt chắc cũng cần" mà không xét lại bản chất 2 việc khác nhau. Sếp chỉ ra đúng chỗ sai:
   **định mức sinh ra chính là để giải quyết việc này** - cho vượt định mức là tự vô hiệu hoá lý do
   nó tồn tại, biến toàn bộ BOM/solver/hao hụt phía trước thành con số trang trí.

   | | Nhận hàng NCC (`purchaseOverReceiptTolerancePercent`) | Xuất sắt cho Phôi |
   |---|---|---|
   | Nguồn sai số | **Bên ngoài** - NCC đóng gói theo lô/cân, không khớp tuyệt đối số đặt | **Không có** - `totalBars` từ solver đã tính sẵn cả hao hụt cắt |
   | Kiểm soát được không | Không (không ép được NCC cân chính xác từng cây) | Có (nội bộ, định mức đã chốt) |
   | Vượt số dự kiến nghĩa là | Chuyện bình thường của mua bán | **Có vấn đề**: gõ nhầm, cắt hỏng ngoài kế hoạch, hoặc lấy sắt cho việc khác núp bóng đơn này |

   → Hai chỗ trông giống nhau ("vượt số dự kiến") nhưng khác bản chất, KHÔNG dùng chung logic dung
   sai. Code đã đúng sẵn từ Đợt 2 (`SteelIssuesService.consumeReservationAndDeduct`), không phải
   sửa gì - chỉ nâng từ "mặc định an toàn tạm thời" lên "nguyên tắc đã chốt".

### 13.8. Nhật ký quyết định

| Mã | Quyết định | Phương án khác đã cân nhắc | Lý do chọn |
|---|---|---|---|
| B4-1 | Tách đặt giữ khỏi tiêu hao; mốc trừ tồn = lúc thủ kho xuất sắt | Giữ nguyên trừ tồn lúc duyệt | Quyết định của Sếp 2026-08-17; đưa sổ sách khớp thực tế vật lý, hết lệch kiểm kê |
| B4-2 | **Bắt buộc** kèm cơ chế giữ chỗ, không dời bút toán suông | Chỉ dời `postEntry` sang `SteelIssue` | Trừ tồn hiện kiêm vai trò giành chỗ — bỏ suông sẽ mở lại lỗ tồn âm/không báo mua đã vá ở mục 8 |
| B4-3 | Bảng `StockReservation` mới, chưa migrate warehouse-transfer | Mở rộng bảng cũ; migrate luôn | Không đụng code chuyển kho đang chạy tốt; đổi lại phải gom công thức `available` vào 1 hàm dùng chung |
| B4-4 | Chia 3 đợt, Đợt 1 ghi giữ chỗ song song mà chưa dùng | Làm một lần cho xong | Đợt 1 deploy được ngay không rủi ro, cho dữ liệu thật để đối chiếu trước khi tin vào giữ chỗ ở Đợt 2 |
| B4-5 | Tái dùng `XuatSatPage` hiện có | Dựng màn hình xuất sắt mới | Màn hình đã nối BE thật từ 2026-08-12, thủ kho đã nhập số cây đúng như luồng cần — chỉ thiếu cột tồn khả dụng |
| B4-6 | **Xuất sắt vượt định mức: chặn cứng, KHÔNG dung sai** (Sếp chốt 2026-08-18) | Cho vượt trong X% giống `purchaseOverReceiptTolerancePercent` bên Mua hàng | Định mức sinh ra chính là để kiểm soát việc này; `totalBars` đã gồm sẵn hao hụt cắt nên vượt = có vấn đề thật (gõ nhầm/cắt hỏng/lấy cho việc khác), phải bị chặn để hỏi. Dung sai bên Mua hàng tồn tại vì sai số **từ NCC bên ngoài** - bản chất khác, không dùng chung logic |
| B4-7 | **Sắt đã mua mà khách huỷ đơn: để lại thành tồn chung** (Sếp chốt 2026-08-18, chốt OQ-1 treo từ 2026-06-27) | Chuyển đích danh sang đơn khác đang thiếu; để riêng có nhãn "từ đơn huỷ" | *"Mua rồi đâu trả được"* - không có đường trả NCC nên sắt chắc chắn nằm trong kho; thêm nhãn/bảng theo dõi riêng là phức tạp thừa, trong khi truy vết đã có sẵn ở `StockLedger.refId`. Code hiện tại đã đúng, không phải sửa |

---

## 14. Bỏ `auto_scan` — solver chỉ tính trên cây 6000mm (2026-08-18)

**ĐẢO NGƯỢC quyết định 2026-08-06** (khi đó Sếp yêu cầu tự động dò chiều dài đặt riêng). Nên báo
lại người đã yêu cầu tính năng cũ, để không ai bất ngờ vì "mất tính năng tôi từng yêu cầu".

### 14.1. Vì sao bỏ

Cơ chế cũ: giải lần 1 trên `stock_lengths` cố định (6000mm); nếu có vật tư vượt ngưỡng hao hụt thì
tự gọi solver **lần 2** với `auto_scan: true`, dò dải 5000-6000mm bước 10mm để tìm "chiều dài đặt
riêng". Ba vấn đề, lộ ra khi truy nguyên câu hỏi *"sao solver lại chọn cây 5900?"*:

| # | Vấn đề | Bằng chứng |
|---|---|---|
| 1 | **Cỡ cây tìm ra không mua được** | Chính `SystemConfig.solverStockLengths = [6000]` có ghi chú "NCC không bán cỡ khác". auto_scan lại trả 5900/5600/5380/5120mm |
| 2 | **Chiều dài đó không chảy tới Mua hàng** | `PurchaseProposalItem` chỉ có `materialId` + `buyQty`; `Material.spec` chỉ là tiết diện ("20x20") - không field nào mang chiều dài. Người mua vẫn đặt cây 6000 như thường |
| 3 | **Con số hao hụt thành không thật** | Sắt 20x20 đoạn 840mm: solver báo **0,203%** (giả định cây 5900) nhưng mua cây 6000 thì thực tế **1,88%** - chênh ~9 lần. Đo trên dữ liệu thật 2026-08-18: 23/46 dòng đang dùng chiều dài đặt riêng |

Điểm thứ 4, quan trọng nhất về nghiệp vụ: auto_scan **che mất tín hiệu cần gộp SKU**. Phương án lẽ
ra phải bị chặn tự-duyệt để QLSX đi gộp đợt cắt (cách xử lý đúng, đã có sẵn `getBatchSuggestions`)
thì lại được "cứu" bằng một cỡ cây ảo. Nguyên văn quyết định: *"loại bỏ yêu cầu này giờ chỉ làm
6000, vì mục đích làm gộp SKU để xử lý vấn đề này"*.

### 14.2. Đã sửa gì

- `runSolverAndSave()`: luôn `auto_scan: false`, **bỏ hẳn** nhánh gọi solver lần 2.
- `autoApproveBlockReason()`: thông báo cho QLSX đổi từ *"không cắt được kể cả sau khi dò hết dải
  chiều dài (auto_scan)"* thành *"không cắt được trong ngưỡng hao hụt với cây 6000mm - thử gộp đợt
  cắt với SKU khác dùng chung loại sắt này"* (nói luôn hướng xử lý).
- Doc-comment `any_over_threshold` / `over_threshold`: giờ thuần chẩn đoán, không kích hoạt gì.
- Test: 3 test phủ nhánh retry thay bằng 2 test khẳng định "gọi solver ĐÚNG 1 lần, luôn
  `auto_scan: false`, kể cả khi vượt ngưỡng / có dòng infeasible".
- **Giữ nguyên** 3 cột `solverMinLengthMm/MaxLengthMm/LengthStepMm` trong `SystemConfig` và vẫn gửi
  trong request body - solver bỏ qua khi `auto_scan: false`, không cần migration, bật lại dễ.

### 14.3. Hệ quả vận hành - cần biết trước

Các ca trước đây được auto_scan "cứu" giờ quay về đúng trạng thái thật (vượt ngưỡng / không cắt
được) nên **không tự động duyệt nữa**, chuyển QLSX xử lý tay hoặc gộp đợt cắt. Đây là hành vi mong
muốn chứ không phải hồi quy: hệ thống nói thật thay vì giấu vấn đề sau một cỡ cây không mua được.

Lợi ích kèm theo: màn "Gợi ý gộp đợt cắt" (`best-fill.util.ts`, tính cận dưới trên 6000mm) và solver
giờ **cùng chấm trên một tập chiều dài** - 2 con số khớp nhau trở lại, hết cảnh gợi ý báo 1,88% mà
solver báo 0,203%.

---

## 15. Review "Không khả thi" của solver + trạng thái màn Cắt sắt (2026-08-18) — **6/7 MỤC XONG**

> **Trạng thái: Bước 0-1-2-3-4-5-6a-7 đã CODE XONG (2026-08-19), 557/557 test pass, migration đã
> áp dụng vào DB local.** Chỉ còn **mục 6b** (trần số SKU gộp) chờ spike dữ liệu UAT - xem
> [15.10](#1510-điểm-chưa-xác-minh--chặn-mục-1-2-migration-và-mục-6b). Mục này ghi lại phát hiện
> và phương án đã qua 3 vòng review (vòng 2 tìm ra 4 lỗi trong phương án vòng 1; vòng 3 - Sếp phản
> biện bằng chính ví dụ Bàn J55 trong mục 1 - **loại bỏ hẳn mục "nới ngưỡng"** vì nó tái tạo lại
> đúng lỗi `auto_scan` vừa gỡ, xem
> [15.8](#158-vòng-review-3--nới-ngưỡng-là-tái-tạo-lại-lỗi-auto_scan)). Kết quả thực thi ở
> [15.9](#159-kết-quả-thực-thi-bước-0-bước-1--bước-2-2026-08-19) (Bước 0-2, migration) và
> [15.11](#1511-kết-quả-thực-thi-bước-3-7-2026-08-19--mục-156-hoàn-tất-trừ-mục-6b) (Bước 3-7, hiển
> thị + retry + poll + cảnh báo nhu cầu nhỏ), gồm 1 lần tự phát hiện + tự sửa migration sai giữa
> chừng (cột `patternsTruncated` hoá ra không tồn tại trong response solver thật).

### 15.1. Ba câu hỏi khởi nguồn

1. *"Sao bỏ status Đã duyệt rồi mà vẫn còn? Boss duyệt thì PI chuyển Đang tính ngay, tính xong 1
   case không khả thi thì báo lỗi, tất cả khả thi thì để Đạt."*
2. *"Tối ưu cắt sắt đã đề xuất rồi nghĩa là hao hụt <1% chứ, sao qua solve mới báo không khả thi?
   Tối ưu cắt sắt quét ra có cắt được hay không mà phải không?"*
3. *"Gộp 3 SKU thành 1 PI thì solver nhận thế nào, hệ thống có xử lý tốt chỗ này không?"*

### 15.2. Trả lời câu 2 — "Tối ưu cắt sắt" KHÔNG quét được/không cắt được

`best-fill.util.ts` tính **cận dưới**: *"nếu có vô hạn đoạn mỗi cỡ thì lấp đầy một cây tới đâu"*.
Header file đã ghi rõ điều này và FE cũng hiện `>= 0,17%` chứ không phải `0,17%` — nên về hợp đồng
là đúng, nhưng **nó không trả lời được câu người dùng cần trả lời**. Hai thứ nó cố ý bỏ qua:

- **Số lượng nhu cầu thật** — giả định cây nào cũng cắt theo pattern đẹp nhất. Nhu cầu ít thì không
  đủ đoạn để lặp lại pattern đó, cây cuối chi phối toàn bộ con số.
- **`max_surplus = 10`** — solver không được dư quá 10 đoạn mỗi cỡ; pattern lấp đầy nhất thường đòi
  dư nhiều hơn thế nên bị loại.

Khoảng cách cận-dưới ↔ thực tế **lớn nhất đúng ở vật tư nhu cầu ít** — đúng ca đang gặp.

### 15.3. Phát hiện chính — `feasible: false` đang gộp 3 nghĩa khác nhau

Đọc `D:\DNA-DEXUAT\api\views.py:262-278` và `cat_sat\de_xuat_logic.py::_no_solution/_unsolved`:

| Thực chất | Ý nghĩa | Hành động đúng | Hiện ra |
|---|---|---|---|
| Vượt ngưỡng 1% | **Cắt được bình thường**, solver kèm `best_achievable` = *"tốt nhất 2,4% với cây 6000 x 5 cây"* | Gộp thêm SKU / nới ngưỡng | Không khả thi |
| `timed_out` | **Chưa kết luận được gì** — solver chưa chạy xong | Tính lại / tăng time limit | Không khả thi |
| Vô nghiệm thật | Đoạn dài hơn cây, hoặc `max_surplus` quá chặt | Sửa thiết kế đoạn cắt | Không khả thi |

**BE đang vứt bỏ toàn bộ lời giải thích.** Solver trả đủ `reason`, `best_achievable`, `timed_out`,
`patterns_truncated`, `max_waste_pct_threshold` cho mỗi dòng hỏng — nhưng type
`SolverProposeResponse` (`cutting-proposals.service.ts:70-91`) **không khai báo field nào trong đó**,
`saveSuccess()` không lưu, `cutting_proposal_lines` không có cột. Solver nói rõ *"nâng ngưỡng lên
>= 2,4% nếu chấp nhận được"* — ta ném đi rồi hiển thị một dấu gạch ngang.

### 15.4. Trả lời câu 3 — solver nhận PI gộp thế nào, và 4 rủi ro

`buildInvoiceJob()` (`cutting-proposals.service.ts:1308-1358`): lấy `ProductionOrder` từng SKU ->
bung BOM -> quy về số tuyệt đối `absoluteQty = qty_per_set * qty_per_part * order.quantity` -> **gom
theo `(materialId, cutLengthMm)`** -> gửi `num_sets: 1`, mỗi dòng `qty_per_set: 1`,
`qty_per_part: absoluteQty`.

Solver `explode_bom` tính `demand = 1 * absoluteQty * 1`. **Khớp chính xác.** Khoá gom nhóm hai bên
cũng trùng nhau. `SegmentSpec` có `@@unique([materialId, cutLengthMm])` nên `segmentSpecLookup`
dùng chung giữa các SKU không đụng id. **Phần tính toán đúng.**

Điểm phải biết: `views.py` chạy `for group in material_groups` — **giải từng loại sắt riêng biệt**.
Gộp SKU chỉ có tác dụng *trong phạm vi một loại sắt*; vật tư nào chỉ 1 SKU dùng thì bài toán y hệt
lúc cắt riêng.

| # | Rủi ro | Chi tiết |
|---|---|---|
| **1** | **Gộp càng nhiều SKU, solver càng dễ báo "không khả thi" vì lý do kỹ thuật** | `generate_patterns` phải liệt kê tổ hợp cỡ đoạn trên một cây. Thêm SKU -> thêm cỡ đoạn -> nổ tổ hợp. Chốt chặn cứng: `MAX_SIZES_PER_BAR = 4`, `ENUM_TIME_LIMIT = 30s`. Hết giờ -> `timed_out + patterns_truncated`. **Nghịch lý: gộp để chữa hao hụt, nhưng gộp lại làm solver bó tay** — rồi báo bằng đúng cái nhãn khiến người đọc tưởng sắt không cắt được |
| **2** | **`time_limit_seconds` là ngân sách CHO MỖI LOẠI SẮT** | `views.py` truyền vào `optimize_one_material()` bên trong vòng lặp. DB đang để 60s -> phiếu 7 loại sắt = xấu nhất 420s. Env hiện tại `SOLVER_TIMEOUT_SECONDS=1700` nên an toàn, nhưng **mặc định trong code là 300s** (`configuration.ts:58`) -> deploy quên set env là phiếu gộp lớn `FAILED` oan trong khi solver vẫn chạy đúng |
| **3** | **Không có trần số SKU gộp** | `mergeItems` chỉ chặn `< 2`. Không giới hạn trên, không cảnh báo khi tổ hợp đẩy số cỡ đoạn lên quá cao — không gì ngăn KHSX tự tạo ra ca rủi ro 1 |
| **4** | **Nhãn `part` mất dấu vết sau khi gộp** (nhẹ) | Comment dòng 1340 nói *"tên gộp để biết đoạn này của sản phẩm nào"*, nhưng khi SKU thứ 2 cộng vào key đã có, code chỉ `existing.qty_per_part += absoluteQty` và **giữ tên SKU đầu tiên**. `rawResponse` ghi 120 đoạn thuộc SKU A trong khi thật ra là A+B+C. Chỉ ảnh hưởng audit, nhưng comment mô tả sai hành vi |

### 15.5. Vòng review 2 — 4 lỗi trong chính phương án vòng 1

Phương án vòng 1 (giữ enum DB, thêm `displayStatus` dẫn xuất 4 chip: Đang tính / Đạt / Cần duyệt
tay / Lỗi) **có 4 lỗi**, trong đó 1 lỗi đủ nặng để phải sửa trước khi code:

**(a) Nhãn "Đạt" sẽ nói dối.** Quy tắc *`APPROVED` + mọi dòng `feasible` -> Đạt* bỏ sót field
`over_threshold`: **cắt được nhưng vượt ngưỡng hao hụt của chính loại sắt đó**. Comment hiện tại
(`:73-75`) ghi *"thuần chẩn đoán — không kích hoạt hành động nào"*, và `autoApproveBlockReason()`
**không kiểm tra nó**. Nghĩa là hôm nay hệ thống đã và đang: tự duyệt phương án vượt ngưỡng -> trừ
kho thật -> đẩy đề xuất mua thật, không một lời cảnh báo; `saveSuccess()` cũng **không lưu
`over_threshold`** nên dấu vết biến mất. Phương án vòng 1 sẽ tô cái đó **màu xanh** — sai nguy hiểm
hơn hẳn cái sai hiện tại, vì dòng đỏ oan thì người ta còn mở ra xem, **dòng xanh thì không ai kiểm
tra bao giờ**.

**(b) Mục "displayStatus" và mục "lưu reason" mâu thuẫn — làm cái trước là chắc chắn đập đi làm
lại.** Quy tắc *"có dòng `feasible=false` -> Lỗi"* tô đỏ cả ca `timed_out`, phạm đúng điều tác giả
solver cảnh báo bằng chữ trong `_unsolved()`: *"Gộp chung hai ca này sẽ âm thầm loại bỏ những chiều
dài TỐT chỉ vì solver chưa kịp chạy xong, mà người dùng lại đọc thành 'không dùng được' — sai hoàn
toàn về bản chất."*

**(c) Vòng 1 viết "không đụng tới `autoApproveBlockReason()`" — sai.** Thông báo hiện tại *"không
cắt được trong ngưỡng hao hụt với cây 6000mm - thử gộp đợt cắt"* (chính là câu vừa sửa ở
[mục 14.2](#142-đã-sửa-gì)) **sai hẳn** khi lý do thật là hết giờ — bảo người ta gộp thêm, mà gộp
thêm chính là thứ làm solver hết giờ (rủi ro 15.4-1). Hàm này phải rẽ nhánh theo lý do, và phải
chặn thêm ca `over_threshold`.

**(d) Hai nguồn lý do.** Bản tính lại tại chỗ và bản solver gửi. Phải chốt: **luôn dùng bản solver;
chỉ tính lại cho bản ghi cũ trước migration.**

#### Rủi ro kỹ thuật về sau

- **TTL chống treo `CALCULATING` — con số cứng là bẫy.** TTL phải lớn hơn `solverTimeLimitSeconds *
  số loại sắt`. Hôm nay 60s x 7 = 420s nên TTL 25 phút ổn; nhưng nâng `solverTimeLimitSeconds` lên
  300 với phiếu 10 loại sắt = 50 phút > TTL -> **hệ thống báo lỗi cho những lần solve đang chạy bình
  thường**, tệ hơn bug đang chữa (người dùng bấm "Tính lại" chồng lên, nhân đôi tải, bản cũ vẫn về
  đích và sống lại). -> **Neo TTL vào `SOLVER_TIMEOUT_SECONDS`**, vì đó chính xác là mốc mà không
  tiến trình BE nào còn có thể đang chờ.
- **`displayStatus` tính lúc đọc thì không lọc/phân trang được bằng SQL.** Màn hình hiện lọc
  client-side trên 100 bản ghi đã tải nên **bộ đếm trên chip đã sai sẵn** khi vượt 100; thêm trạng
  thái dẫn xuất sẽ khoá luôn đường sửa. -> Đằng nào cũng migration, lưu thêm cờ
  `hasInfeasibleLine` / `hasOverThreshold` trên `cutting_proposals` (là **sự kiện**, không phải từ
  vựng hiển thị), ghi lúc `saveSuccess`. Quan trọng vì màn này sẽ poll 20s/lần.
- **Nháy trạng thái.** Giữa `DRAFT` và `APPROVED` có khoảng trống (approve trừ kho + tạo đề xuất mua
  trong transaction). Poll rơi đúng đó sẽ hiện "cần xử lý" rồi 20s sau nhảy "đạt". -> Coi `DRAFT` có
  `completedAt` trong vòng ~60s là "đang hoàn tất".
- **Bản ghi cũ** có `reason = NULL` sau migration -> phải hiện *"bản ghi cũ, không lưu lý do"*, không
  để trống nhìn như hỏng.

#### Rủi ro lớn nhất: làm lỗi **dễ đọc hơn**, không làm lỗi **ít đi**

Sau khi ship, KHSX thấy dòng cam ghi rõ *"hao hụt 2,4% > ngưỡng 1% - gộp thêm SKU"*, rồi quay lại
màn gộp, gộp thêm, và đâm vào bức tường liệt kê pattern (rủi ro 15.4-1). **Nguy cơ xây một ngõ cụt
rất giàu thông tin.** Đòn bẩy thật chỉ có ba: (a) nới `Material.maxCuttingWastePercentage` cho loại
sắt mà 1% là phi thực tế, (b) gộp, (c) sửa thiết kế đoạn cắt. Solver **đã tự tính sẵn con số cho
(a)** và gửi trong `best_achievable`.

#### Đã rút lại: "siết cận dưới `bestFill` cho sát thực tế"

Cho `bestFill` biết số lượng nhu cầu và `max_surplus` **chính là bài toán NP-hard mà CP-SAT đang
giải**. Nó phá đúng tính chất khiến hàm đó tồn tại: `getBatchCandidates` gọi O(số SKU x số vật tư),
`getBatchSuggestions` gọi O(số vật tư x số mức gộp) — mỗi lần từ ~1ms lên ~100ms là màn gộp không
dùng được. Tệ hơn: làm sai một chút là **nó thôi không còn là cận dưới đúng**, mà toàn bộ logic
*"loại sớm tổ hợp chắc chắn không đạt"* dựa vào tính chất đó — cận sai lên trên sẽ vứt nhầm tổ hợp
tốt. -> Thay bằng cảnh báo rẻ và thành thật: *"nhu cầu nhỏ (< N cây) - cận dưới này không đáng tin"*
cạnh con số `>= x%`.

### 15.6. Phương án đã sửa — thứ tự thực hiện

| # | Việc | Trạng thái | Ghi chú |
|---|---|---|---|
| 0 | Chặn tự-duyệt khi `over_threshold` | Đã code (15.9) | ~5 dòng, không cần migration - đây là chỗ chặn tiền đi ra sai, xem 15.5-(a) |
| 1 | **Migration** + lưu 5 field solver trả (bỏ `patterns_truncated` - không thật sự có trong response, xem 15.9): `reason`, `best_achievable`, `timed_out`, `max_waste_pct_threshold`, `over_threshold` | Đã code (15.9) | Kèm cờ `hasInfeasibleLine`/`hasOverThreshold` trên `cutting_proposals` để lọc bằng SQL |
| 2 | Rẽ nhánh `autoApproveBlockReason()` theo lý do thật (không tô đỏ ca `timed_out`) | Chưa làm | Phụ thuộc mục 1 (cần cột lưu lý do) |
| 3 | Thiết kế hiển thị **một lần**: 3 chip (Đang tính / Đạt / Cần xử lý) + câu lý do & hành động cụ thể trên dòng | Chưa làm | Giữ đúng "3 trạng thái" đã yêu cầu. **Không build trước mục 1** |
| 4 | Nút "Tính lại" theo trạng thái dẫn xuất + **route retry cho phiếu gộp** | Chưa làm | Hiện gãy: FE gọi `retryCuttingProposal(p.productionOrderId)` nhưng phương án neo PI gộp có `productionOrderId = null` và BE không có route retry cho PI |
| 5 | Poll có điều kiện (20s, tự tắt khi hết `CALCULATING`) + đồng hồ đếm phút + TTL neo vào `SOLVER_TIMEOUT_SECONDS` | Chưa làm | Dùng lại pattern đã chạy ở `LenhSXPage.tsx:68-77` và component `CalculatingBadge`. **Không làm SSE/WebSocket** |
| 6a | Chặn sớm khi timeout HTTP client < timeLimit x số loại sắt (ngân sách xấu nhất) | Đã code (15.9) | Chặn nguyên nhân gốc 15.4-2 - không cần migration, tính trực tiếp từ `distinctMaterialIds.length` đã có sẵn |
| 6b | Trần số SKU gộp / cảnh báo số cỡ đoạn khi tổ hợp đẩy `MAX_SIZES_PER_BAR`/`ENUM_TIME_LIMIT` vào vùng nguy hiểm | Chưa làm | Cần dữ liệu thật (15.10) để chọn ngưỡng - không đoán số |
| 7 | Cảnh báo "nhu cầu nhỏ, cận dưới không đáng tin" trên màn gộp | Chưa làm | Thay cho phương án siết cận dưới đã rút lại |
| ~~8~~ | ~~Nút "nới ngưỡng vật tư này lên x%"~~ | Đã rút lại | Xem [15.8](#158-vòng-review-3--nới-ngưỡng-là-tái-tạo-lại-lỗi-auto_scan) - tái tạo đúng lỗi `auto_scan` vừa gỡ |

**Không đụng tới:** enum `CuttingProposalStatus` (`APPROVED` đang gánh chống-trừ-kho-2-lần ở
`autoApproveBlockReason` và tra pattern cho Phôi ở `steel-issues.service.ts:625,743`), logic
auto-duyệt, module `steel-issues`.

### 15.8. Vòng review 3 — "nới ngưỡng" là tái tạo lại lỗi `auto_scan`

Ví dụ ngay trong [mục 1](#1-tính-năng-làm-gì) của chính changelog này: Bàn J55 cắt một mình, 7 đoạn
840mm/cây, thừa 113mm = **1,88%**, "và đó đã là tối ưu tuyệt đối". Sếp chỉ ra: đưa qua Tối ưu cắt
sắt để **gộp** với SKU khác (Ghế tình yêu, đoạn 460mm) mới là đường đúng - kéo xuống được **0,53%**.

Mục 8 (nút "nới ngưỡng vật tư lên x%") ở vòng review 1-2 đề xuất chính là con đường ngược lại: thay
vì gộp, nới ngưỡng cho J55 lên ~2% để nó "đạt". Đó **đúng bằng** thứ `auto_scan` từng làm - tìm
cách khiến con số trông chấp nhận được thay vì đi gộp (xem lý do bỏ `auto_scan` ở
[14.1](#141-vì-sao-bỏ), và quyết định nguyên văn: *"loại bỏ yêu cầu này giờ chỉ làm 6000, vì mục
đích làm gộp SKU để xử lý vấn đề này"*). Ngưỡng 1% là **chính sách**, không phải tham số cho người
vận hành vặn khi thấy vướng.

**Hệ quả cho phần còn lại của kế hoạch:**

- Mục 0 (chặn tự-duyệt khi vượt ngưỡng) quan trọng hơn ban đầu nghĩ: nếu không chặn, hệ thống âm
  thầm mua sắt ở 1,88% thay vì buộc đi gộp - tính năng gộp bị vô hiệu hoá trên thực tế vì không ai
  bị bắt buộc dùng.
- Rủi ro [15.4-1](#154-trả-lời-câu-3--solver-nhận-pi-gộp-thế-nào-và-4-rủi-ro) (gộp làm solver hết
  giờ vì `MAX_SIZES_PER_BAR`/`ENUM_TIME_LIMIT`) lên mức ưu tiên cao hơn: nếu gộp là câu trả lời
  **duy nhất** được phép, gộp hỏng vì lý do kỹ thuật là bế tắc hoàn toàn, không còn đường lui.
- Ca thật sự không gộp được (loại sắt chỉ 1 SKU đang chờ, không ai để gộp cùng) vẫn tồn tại - xử lý
  bằng quyết định của Sếp trên từng ca cụ thể (chờ đơn khác / chấp nhận hao hụt lần này / sửa thiết
  kế đoạn cắt), **không phải một cái nút cho KHSX tự bấm**.

### 15.9. Kết quả thực thi Bước 0, Bước 1 + Bước 2 (2026-08-19)

**Bước 0 - chặn tự-duyệt khi vượt ngưỡng** (`cutting-proposals.service.ts`, hàm
`autoApproveBlockReason()`):

- Thêm nhánh (c): quét `purchase_plan[]` tìm dòng `feasible=true && over_threshold=true`, chặn
  tự-duyệt nếu có - thông báo QLSX nêu đúng mã vật tư, nói rõ "KHÔNG tự nới ngưỡng".
  `any_over_threshold`/`over_threshold` trước đó "thuần chẩn đoán, không kích hoạt hành động nào" -
  đã sửa comment cho khớp hành vi mới.
- 3 test mới: chặn đúng khi `over_threshold=true`, vẫn tự duyệt bình thường khi `over_threshold=false`
  (đối trọng chống chặn nhầm), và giữ nguyên toàn bộ 34 test cũ (không phá hành vi nhánh infeasible/
  priorApproved đã có).

**Bước 1 - chặn sớm khi ngân sách thời gian solver vượt timeout HTTP client** (cùng file, ngay
trước lời gọi solver):

- `time_limit_seconds` là ngân sách **cho mỗi loại sắt** (`api/views.py` truyền vào bên trong vòng
  lặp `material_groups`), không phải cho cả request. Tính `distinctMaterialIds.length x
  config.solverTimeLimitSeconds`, so với `timeoutSeconds` (config `solver.timeoutSeconds`) - vượt
  thì throw NGAY trước khi gọi solver, đánh `FAILED` với lý do cụ thể (số loại sắt, ngân sách xấu
  nhất, timeout hiện tại) thay vì để axios tự ngắt giữa chừng rồi báo lỗi mạng không ai hiểu vì sao.
- 1 test mới: 2 loại sắt x 200s = 400s > timeout mock 300s, chặn trước khi gọi
  `externalApiService.post` (assert `not.toHaveBeenCalled()`), `errorMessage` chứa đủ 3 con số.

**Bước 2 - migration + lưu 6 field lý do solver trả** (local DB, đã xác nhận với Sếp trước khi
chạy):

- Migration `20260819011622_cutting_proposal_line_reason_and_over_threshold`: `CuttingProposalLine`
  += `reason` (String?), `bestAchievable` (Json?), `timedOut` (Boolean?), `maxWastePctThreshold`
  (Decimal(6,3)?), `overThreshold` (Boolean?); `CuttingProposal` += `hasInfeasibleLine`,
  `hasOverThreshold` (Boolean, default false) - cờ tổng hợp để LỌC ĐƯỢC BẰNG SQL khi màn Cắt sắt
  poll định kỳ (mục 3), không phải kéo `lines[]` về rồi lọc ở code.
- **Phát hiện + tự sửa giữa chừng**: kế hoạch ban đầu (15.3/15.6) liệt kê 6 field gồm cả
  `patterns_truncated`, đọc từ `cat_sat/de_xuat_logic.py` (nơi solver TÍNH ra cờ này nội bộ). Đọc
  lại nguyên văn `api/views.py` lúc code phần lưu mới phát hiện field đó **không hề được forward ra
  JSON response** - chỉ `timed_out`/`best_achievable`/`reason`/`max_waste_pct_threshold` thật sự
  lọt tới client. Đã xoá cột này khỏi thiết kế TRƯỚC khi tạo migration đầu tiên bị áp nhầm (revert
  bằng SQL thủ công trên DB local + xoá dòng lịch sử migration + tạo lại migration đúng) - migration
  cuối cùng áp dụng chỉ có 5+2 cột, không có cột thừa nào tồn tại trên DB.
- `SolverProposeResponse` (type nội bộ): thêm `max_waste_pct_threshold` (cả 2 nhánh),
  `timed_out`/`best_achievable`/`reason` (chỉ nhánh infeasible).
  `saveSuccess()`: lưu NGUYÊN VĂN 5 field vào từng dòng, tính 2 cờ tổng hợp từ chính
  `response.purchase_plan` trước khi ghi. Câu tiếng Việt hiển thị cho người dùng CHƯA dựng ở đây -
  để dành cho mục 3 (tầng response DTO/FE), tránh trùng lặp logic diễn giải.
- 2 test mới: dòng infeasible lưu đúng cả 4 field + `hasInfeasibleLine=true`/`hasOverThreshold=false`;
  dòng feasible vượt ngưỡng lưu đúng `overThreshold`/`maxWastePctThreshold` + 2 cờ đảo ngược lại,
  xác nhận không lẫn giữa 2 nhóm field.

**Không làm trong đợt này:** mục 3-5, 7 (hiển thị/poll/retry - dùng dữ liệu vừa lưu được, làm sau
khi có UI); mục 6b (trần SKU gộp) - cần dữ liệu thật để chọn ngưỡng, xem 15.10.

Kết quả: `npx tsc --noEmit` sạch, `npx jest` **42/42 test suite, 541/541 test pass** (536 đầu phiên
+ 5 test mới: 2 Bước 0, 1 Bước 1, 2 Bước 2).

### 15.10. Điểm chưa xác minh — chặn mục 1-2 (migration) và mục 6b

`over_threshold = true` cùng `feasible = true` xảy ra trong điều kiện nào và tần suất bao nhiêu:
**suy ra từ code, chưa quan sát được trên dữ liệu thật** (DB local là bộ dữ liệu khác — vật tư
`STL-*`, không có `SAT-*` như trên UAT). Cần một câu query trên DB UAT trước khi làm mục 2, vì nội
dung mục đó phụ thuộc hoàn toàn vào câu trả lời này.

Tương tự cho mục 6b: cần replay `requestParams` (đã lưu nguyên văn, audit/replay - xem model
`CuttingProposal`) của vài phiếu "không khả thi" thật trên UAT thẳng vào solver, đọc `reason` trả
về, để biết phân bố thật giữa 3 nhóm (vượt ngưỡng / hết giờ `timed_out` / vô nghiệm thật) trước khi
chọn ngưỡng cảnh báo số cỡ đoạn - không đoán số khi chưa có dữ liệu.

---

### 15.11. Kết quả thực thi Bước 3-7 (2026-08-19) — mục 15.6 hoàn tất, trừ mục 6b

> **Trạng thái cuối: 6/7 mục (0, 1, 3, 4, 5, 6a, 7) đã code xong. Chỉ còn mục 6b (trần SKU gộp)
> chờ dữ liệu UAT. Mục 8 (nới ngưỡng) đã rút hẳn - xem 15.8.**

**Mục 3 - hiển thị 3 chip** (`cutting-proposal-response.dto.ts` + `cutting-proposals.service.ts`):

- Thêm `CuttingProposalDisplayStatus` (`CALCULATING | OK | NEEDS_ACTION | SUPERSEDED`) + field
  `displayStatus`/`displayReason` trên `CuttingProposalResponseDto`; line thêm 5 field raw (`reason`,
  `bestAchievable`, `timedOut`, `maxWastePctThreshold`, `overThreshold`) + `displayReason` riêng cho
  từng dòng.
- `computeDisplayStatus()` dẫn xuất từ `status` + `hasInfeasibleLine`/`hasOverThreshold` (đã lưu ở
  Bước 2, KHÔNG kéo `lines[]`) + `completedAt`/`requestedAt` - **không lưu ở DB**, tính lại mỗi lần
  map response. `lineDisplayReason()` dựng câu tiếng Việt cho từng dòng, tách bạch `timedOut` khỏi
  "vô nghiệm thật" đúng như 15.5-(b) yêu cầu (không gộp chung 1 câu).
- FE (`CuttingProposalsPage.tsx`): 5 chip DB → 3 chip hiển thị (`Đang tính`/`Đạt`/`Cần xử lý`),
  SUPERSEDED ẩn khỏi danh sách mặc định. Mỗi dòng NEEDS_ACTION hiện luôn `displayReason` (list-level
  ở bảng, đầy đủ hơn ở panel chi tiết theo từng vật tư) - không phải mở modal mới biết lý do.
- 15 test mới (13 cho `computeDisplayStatus`/`lineDisplayReason`, phủ đủ mọi nhánh: CALCULATING,
  SUPERSEDED, FAILED, OK, DRAFT+infeasible, DRAFT+overThreshold, DRAFT đang hoàn tất <60s vs
  priorApproved >60s, timedOut ưu tiên trước best_achievable, v.v).

**Mục 4 - nút "Tính lại" theo trạng thái dẫn xuất + route retry cho phiếu gộp**
(`cutting-proposals.controller.ts` + `.service.ts` + FE `cutting-proposals-api.ts`):

- Route mới `POST /production-invoices/:id/cutting-proposals` (mirror route PO có sẵn) - trước đây
  KHÔNG TỒN TẠI nên bấm "Tính lại" trên phương án neo PI gộp (`productionOrderId=null`) luôn lỗi.
- `requestForInvoice()` thêm hỗ trợ `idempotencyKey` (đối xứng `requestForOrder`) để chặn double-click
  tạo trùng - trước đây thiếu, chỉ nhánh PO có.
- FE: `retryCuttingProposalForInvoice()` mới; `retryProposal()` chọn đúng route theo neo nào khác
  null; nút "Tính lại" bám `displayStatus === 'NEEDS_ACTION'` thay vì `status === 'FAILED'` (trước
  đây ca "DRAFT nhưng bị chặn tự-duyệt" không có nút nào bấm được).
- 2 test mới cho `requestForInvoice` (idempotency short-circuit + tạo CALCULATING đúng anchor).

**Mục 5 - poll có điều kiện + đồng hồ đếm phút + chống treo `CALCULATING`**:

- FE: poll 20s khi còn dòng `CALCULATING`, tự tắt khi hết (mirror pattern đã chạy ở
  `LenhSXPage.tsx:68-77`); `CalculatingBadge` hiện "đã chạy X phút" (mirror
  `LenhSXPage.tsx::CalculatingBadge`, đổi tên chung chung hơn vì màn Admin này còn quản cả PI đơn lẻ
  lẫn PI gộp).
- BE: **chống treo vĩnh viễn** ngay trong `computeDisplayStatus()` - `CALCULATING` quá
  `solver.timeoutSeconds + 60s` (neo vào chính config timeout HTTP client gọi solver, KHÔNG phải số
  cứng) → tự chuyển `NEEDS_ACTION` với lý do "Nghi treo". Không cần cron riêng vì tính lại mỗi lần
  đọc là đủ - đường DUY NHẤT kẹt `CALCULATING` mãi mãi là tiến trình BE chết giữa lúc solve (không
  cron dọn nào tồn tại từ trước, xem `phantich/page.tsx` cảnh báo cũ).
- 1 test mới: `requestedAt` quá `(300+60)s` (mock `solver.timeoutSeconds=300`) → `NEEDS_ACTION`.

**Mục 6a - đã code ở đợt trước (Bước 1)**, không có gì thêm.

**Mục 7 - cảnh báo "nhu cầu nhỏ, cận dưới không đáng tin"** (`cutting-batch-candidate.dto.ts` +
`.service.ts` + FE `cutting-batch-api.ts` + `GomDotCatPage.tsx`):

- `CandidateMaterialDto` += `standaloneMinBars` (cận dưới số cây khi SKU cắt một mình) - tính bằng
  `minBarsFor()` đã có sẵn (dùng chung với `buildBatchLevel()`/`CuttingBatchPreviewLineDto`, vốn đã
  có `minBars` từ trước, không cần thêm gì). Không cần migration - field tính tại chỗ, không lưu DB.
  1 test mới xác nhận field có mặt trong response (công thức đã được kiểm bởi test của
  `minBarsFor()` qua `buildBatchLevel`, chỉ cần bắt lỗi wiring/serialization).
- FE: `isLowConfidence(minBars) = minBars > 0 && minBars < 3` (ngưỡng kinh nghiệm chọn, KHÔNG phải
  số đo được - lý do: 1-2 cây thì cây cuối gần như quyết định cả %, không đủ lặp lại pattern lý
  tưởng để cận dưới có ý nghĩa). Cảnh báo hiện ở CẢ hai bảng: `MaterialChip` (per-SKU đứng riêng) và
  bảng "Loại sắt dùng chung" (mức đã gộp) - dấu "?" màu vàng + tooltip, kèm chú thích ở ô thông tin
  đầu trang để không ai phải đoán ký hiệu nghĩa gì.

**Đã rút gọn khỏi phạm vi mục 15.6, không làm:** mục 1-2 (migration + rẽ nhánh
`autoApproveBlockReason` theo `timedOut`) - **đã làm ở Bước 2**, xem 15.9, chỉ còn thiếu phần rẽ
nhánh `autoApproveBlockReason()` theo lý do thật (hiện thông báo QLSX vẫn dùng câu chung chung
"không cắt được trong ngưỡng hao hụt" cho cả ca `timed_out` lẫn vô nghiệm thật - **CHƯA SỬA**, vẫn
đúng như cảnh báo ở 15.5-(c); cần làm khi có dữ liệu UAT xác nhận tần suất ca `timed_out` đáng để
ưu tiên).

**Kết quả cuối:** BE `npx tsc --noEmit` sạch, `npx jest` **42/42 test suite, 557/557 test pass**
(536 đầu phiên → 541 sau Bước 0-2 → 557 sau Bước 3-7, +21 test mới trong đợt này). FE
`npx tsc --noEmit` sạch trên cả 2 project (`DNA-ERP-BE`, `DNA-ERP`). ESLint: 2 warning không đổi từ
trước (`Date.now()` impure trong `CalculatingBadge` - mirror pattern có sẵn ở `LenhSXPage.tsx`;
`setState` trong effect ở `GomDotCatPage.tsx:111,117` - code cũ, ngoài phạm vi diff của đợt này).

Toàn bộ thay đổi (BE + FE) **chưa commit**. Migration đã áp dụng vào DB **local** duy nhất.

---

## 16. `cutLengthMm` và các field hao hụt phái sinh: `Int` -> `Decimal` (2026-08-19)

### 16.1. Phát sinh từ đâu

Khi dọn `CuttingProposal` test cũ cho SKU J55/Ghế tình yêu, Sếp gửi kèm 2 ảnh chụp màn hình định
mức GỐC từ chính solver (`dna-dexuat.onrender.com/cat_sat/de_xuat/` - trang demo BOM của cat_sat_iea,
KHÔNG phải dữ liệu do ai tự bịa). Đối chiếu với dữ liệu đang lưu trong `segment_spec` phát hiện lệch
đúng 2 chỗ:

| Mảnh | Vật tư | Solver gốc (`cat_sat/de_xuat_views.py::PRODUCT_CATALOG`) | DB đang lưu |
|---|---|---|---|
| chân ghế | sắt Fi Ø21 | **590,5mm** | 591mm |
| tựa lớn | sắt hộp 10x20 | **452,7mm** | 453mm |

Nguyên nhân: `SegmentSpec.cutLengthMm` là `Int`, không lưu được số thập phân - mỗi lần nhập giá trị
lẻ thì bị làm tròn âm thầm, không báo lỗi gì.

### 16.2. Vì sao `Decimal`, không phải `Float`

Solver **cố ý tránh** số thực nhị phân. Nguyên văn `cat_sat/de_xuat_logic.py`:

> `SCALING_FACTOR = 10: mọi phép tính chạy trên số nguyên đã nhân 10 -> giữ được [độ chính xác thập
> phân hệ 10]`

Toàn bộ solver quy đổi chiều dài về số nguyên nhân 10 để tính (tránh sai số tích luỹ của float nhị
phân qua nhiều phép cộng/trừ trong bài toán tối ưu - giống lý do 0.1+0.2 ≠ 0.3 ở hầu hết ngôn ngữ).
Đổi DB sang `Float` sẽ đưa đúng thứ solver đã né tránh có chủ đích vào tầng lưu trữ. `Decimal` là số
thập phân cố định hệ 10, chính xác tuyệt đối, khớp đúng độ phân giải solver đang dùng (1 chữ số thập
phân).

### 16.3. Phạm vi thay đổi

Không chỉ `cutLengthMm` - mọi field hao hụt/mẩu nguyên TÍNH TỪ nó cũng đổi theo, nếu không thì độ
chính xác vừa lấy lại ở đầu vào lại mất ngay ở đầu ra:

| Field | Model | Kiểu mới |
|---|---|---|
| `cutLengthMm` | `SegmentSpec` | `Decimal(7,1)` |
| `totalWasteMm` | `CuttingProposal` | `Decimal(8,1)` |
| `totalWasteMm`, `mauNguyenMm` | `CuttingProposalLine` | `Decimal(7,1)` |
| `wastePerBarMm` | `CuttingProposalPattern` | `Decimal(6,1)` |
| `mauNguyenMm` | `CuttingProposalPattern` | `Decimal(7,1)` |

**Cố ý không đụng:** `bestStockLengthMm`, `SystemConfig.solver*LengthMm/TrimStartMm/LengthStepMm`
(số cây/cấu hình mua hàng - luôn nguyên, NCC không bán 5850,5mm), `SteelIssue.barLengthMm` (cây đã
mua, luôn nguyên), `CutBundle.wastePerBarMm` (Phôi tự đo báo cáo thật bằng thước sau khi cắt - khác
bản chất với số solver TÍNH TOÁN, không phải thiếu sót).

Migration `20260819025542_segment_spec_and_waste_fields_decimal` - `ALTER COLUMN ... USING
...::numeric`, cast an toàn không mất dữ liệu hiện có (mọi Int cũ thành `X.0`). **Tạo bằng tay** vì
`prisma migrate dev` từ chối chạy ở môi trường non-interactive khi có cảnh báo đổi kiểu cột trên bảng
có dữ liệu - viết `migration.sql` khớp đúng nội dung Prisma đã in ra cảnh báo, áp trực tiếp, rồi
`prisma migrate resolve --applied` để đồng bộ lịch sử.

⚠️ **Migration chỉ sửa CẤU TRÚC cột, không sửa 2 giá trị đã sai từ trước** (591→590.5, 453→452.7) -
việc đó làm bằng `UPDATE ... WHERE id = 13/29` chạy tay riêng, ID cụ thể của DB local, **không nằm
trong migration.sql**. Áp migration này lên môi trường khác sẽ lên đúng cấu trúc, nhưng KHÔNG tự sửa
dữ liệu sai tương ứng ở đó (ID hàng khác/dữ liệu khác) - cần soát lại thủ công riêng nếu cần đúng
tuyệt đối.

### 16.4. Sửa code theo (12 file BE) - không chỉ đổi kiểu suông

- **1 rủi ro thầm lặng nghiêm trọng nhất**: `cutting-proposals.service.ts` dùng `cutLengthMm` làm
  khoá `Map` (gom nhu cầu theo cỡ đoạn) và ghép vào chuỗi tra cứu `segmentSpecLookup`. 2 `Decimal`
  cùng giá trị KHÔNG `===` nhau, và `Decimal.toString()` giữ số 0 ở cuối (`"930.0"`) trong khi phía
  đọc lại JSON response solver luôn là số thường (`"930"`) - ghép sai định dạng làm 2 khoá KHÔNG
  khớp, tra cứu miss ÂM THẦM (rơi vào nhánh `continue` tưởng là ca hiếm "shouldn't happen"). Đã
  chuẩn hoá `.toNumber()` ở MỌI nơi dựng khoá, cả 2 đầu SET/GET.
- **2 validator `@IsInt()` chặn nhầm input hợp lệ**: `CreateSegmentSpecDto`, `QuotaSegmentDto`
  (module SKU/định mức - đường nhập BOM thật) đổi sang `@IsNumber({maxDecimalPlaces:1})`.
- **1 blind spot mà `tsc` không bắt được**: `skus.service.ts` có field `manhData: unknown` (JSON
  tái dựng cho tương thích ngược) - gán `Decimal` thẳng vào không báo lỗi biên dịch, nhưng
  `JSON.stringify` sẽ gọi `Decimal.toJSON()` trả về CHUỖI thay vì số, phá FE đang mong đợi
  `number`. Phát hiện bằng quét tay (`grep` toàn bộ `.cutLengthMm`/`.totalWasteMm`/...), không
  phải nhờ `tsc` - nhắc rằng kiểu `unknown`/`any` là điểm mù thật của việc "chỉ chạy tsc là đủ".
- 4 chỗ dựng nhãn hiển thị (`@ ${cutLengthMm}mm`) đổi sang `Number(...)` trước khi ghép chuỗi,
  tránh hiện "@ 930.0mm" thay vì "@ 930mm".

### 16.5. Bug thật phát hiện khi live-test (hệ quả của việc dọn dữ liệu ở mục trước, không phải của
việc đổi kiểu)

Sau khi xóa 14 `CuttingProposal` test của J55/Ghế tình yêu (đúng thiết kế `ON DELETE SET NULL`),
`GET /purchase-proposals` bắt đầu trả **500** thật trên trình duyệt: `purchase-proposals.service.ts`
có `row.cuttingProposal!.productionOrder` - ép kiểu non-null trong khi schema cho phép null
(`PurchaseProposal.cuttingProposalId BigInt?`), và trước đây trạng thái null chưa từng xảy ra nên
chưa ai chạm phải. Phần còn lại của hàm đã tự xử lý `productionOrder`/`mergedPi` null sẵn (`?.`, `??
'—'`) - chỉ cần sửa đúng 2 dòng ép kiểu gốc. Thêm 1 test hồi quy khoá lại ca này.

### 16.6. Kiểm tra tác động toàn hệ thống (theo yêu cầu review riêng)

- Quét toàn bộ `src/modules` cho mọi file chạm `SegmentSpec`/`cutLengthMm` - không sót file nào
  ngoài 12 file đã sửa (`materials.service.ts`, `production-batches.service.ts` chỉ chạm
  `segmentSpecId` là khoá ngoại, không chạm `cutLengthMm`).
- 7 file dùng `$queryRaw`/`$executeRaw` trong toàn hệ thống - chỉ 1 câu chạm bảng
  `cutting_proposals` và chỉ `SELECT "status"`, không đụng field nào đã đổi.
- `prisma/seed.ts`/`seed-demo.ts` không tham chiếu `cutLengthMm` trực tiếp.
- FE: không cần sửa gì - JSON output vẫn `number` y hệt trước (đã convert `Number(...)` ở mọi DTO
  output). Quét riêng FE tìm phép toán giả định số nguyên (`Math.floor`, bitwise, `parseInt`) trên
  4 field liên quan - không có chỗ nào.
- Input validation: đổi `@IsInt()` → `@IsNumber({maxDecimalPlaces:1})` là NỚI RỘNG, không siết -
  không breaking cho input số nguyên cũ.

### 16.7. Kết quả

`npx tsc --noEmit` sạch (cả BE lẫn FE), `npx jest` **42/42 test suite, 562/562 test pass** (thêm 6
test: 3 file spec cần cập nhật fixture Decimal-stub + 1 test hồi quy cho bug 16.5). Live-test qua
trình duyệt thật (đăng nhập admin, đọc network request/response): xác nhận `GET /purchase-proposals`
từ 500 → 200, response chứa đúng `"—"`/`null` cho các dòng mồ côi thay vì crash; giá trị 590.5/452.7
đã lưu đúng trong DB.

### 16.8. `schema.prisma` bị hỏng sau khi merge với commit của đồng nghiệp (2026-08-20)

Sau khi `git stash pop` bản vá mục 16 lên trên commit `0ec2a9d` ("sanxuat-stage-v21", redesign
`SteelIssue` theo `productionInvoiceId`) của đồng nghiệp (ohey), thao tác giải conflict thủ công qua
Fork đã **xóa 3 cặp dấu `<<<<<<<`/`=======`/`>>>>>>>` mà không chọn bên nào** trên
`CuttingProposalLine` - để lại đồng thời cả field `Int?` cũ (`totalWasteMm`, `wastePercentage`,
`mauNguyenMm`) lẫn field `Decimal?` mới cùng tên. `npx prisma validate`/`generate` báo lỗi khai trùng
field (`Validation Error Count: 3`), khiến Prisma Client không generate lại được và kéo theo ~20 lỗi
`tsc` giả (`Property 'productionInvoiceId' does not exist...`) - xác nhận qua diff trực tiếp
`SteelIssue` hiện tại với bản trong commit `0ec2a9d`: **giống nhau từng byte**, không phải xung đột
thật với phần redesign của đồng nghiệp.

Xóa 6 dòng field `Int?` cũ + comment trùng, giữ nguyên khối `Decimal?` (đúng quyết định mục 16.2-16.3
- không có gì đổi ngược). Xác nhận lại toàn bộ:

- `npx prisma validate` + `generate`: sạch.
- `npx tsc --noEmit`: **0 lỗi** (20 lỗi giả biến mất hoàn toàn sau khi generate lại Client).
- `npx jest`: **42/42 test suite, 563/563 test pass** (không đổi hành vi, chỉ dọn field trùng).
- `eslint`: ~1.447 lỗi CRLF (`prettier/prettier`, "Delete `␍`") xuất hiện trên diện rộng nhưng xác
  nhận **có từ trước, không liên quan thay đổi này** - `src/prisma/prisma.module.ts` (file không đụng
  tới) đã có lỗi này từ chính commit khởi tạo repo (`fd7a858`), do line-ending Windows/`core.autocrlf`
  chứ không phải nội dung code sai. `src/generated` (Prisma Client output) bị eslint ignore đúng như
  cấu hình.

Chưa commit - theo quy ước người dùng tự làm phần đó.
