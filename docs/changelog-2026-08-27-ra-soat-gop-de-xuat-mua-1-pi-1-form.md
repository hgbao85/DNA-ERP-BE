# 2026-08-27 — Rà soát cơ chế "gộp 1 PI = 1 đề xuất mua": 6 lỗi số liệu

## Bối cảnh

Tính năng **"gộp mọi nhu cầu mua của 1 PI vào ĐÚNG 1 PurchaseProposal"** (2026-08-25) về máy qua
nhánh git ngày 26/08. Rà soát toàn bộ luồng cắt sắt → đề xuất mua → nhập kho trước khi nó chạy thật
tìm ra **6 lỗi**, tất cả cùng một gốc:

> Một giá trị **dẫn xuất** (tổng nhu cầu, "SKU đã có kế hoạch chưa") bị lưu thành **con số sửa được
> tại chỗ**, thay vì tính lại từ nguồn.

Trước khi gộp, mỗi nguồn có đề xuất riêng nên vô hại. Từ khi 1 dòng có thể nhận nhu cầu từ N nguồn,
cả hai thiếu sót trên thành lỗi số liệu thật.

**Đối chiếu dữ liệu trước khi sửa:** 0/15 phiếu mua đã đi qua cơ chế gộp, 9 phương án cắt APPROVED
nằm trên 9 PI khác nhau, 0 phiếu có 2 dòng trùng vật tư. Tức **chưa lỗi nào kịp nổ** — sổ kho không
lệch, không có số liệu cũ phải đi vá. Đây là sửa phòng ngừa, không phải chữa cháy.

Riêng L7 chắc chắn chưa nổ vì `auto_scan` mới mở lại 26/08 — trước đó mọi phương án đều dùng cây
6000mm cố định nên không thể lệch cỡ. Nhưng đã có **10 dòng cắt dùng cây đặt riêng** (5600/5120/
5900mm), nên nó sẽ nổ ở PI hai-SKU đầu tiên.

---

## L7 — Một loại sắt trong 1 PI bị chốt 2 cỡ cây

**Quy tắc nghiệp vụ (Sếp chốt):** cùng một loại sắt trong cùng một đợt sản xuất thì **mua chung một
cỡ cây**. Mở dò cỡ tự động vì cây 6000mm không cắt tối ưu được thì cả phiếu cùng chuyển sang cỡ đó —
không có chuyện 1 phiếu đặt 2 cỡ cây cho cùng 1 loại sắt.

**Chỗ hệ thống chưa làm đúng:** duyệt từng SKU riêng thì solver được gọi **một lần riêng cho từng
SKU**, chỉ với cỡ đoạn của nó. Ghế A ra "5900mm tối ưu *cho Ghế A*", Bàn B ra "6200mm *cho Bàn B*" —
**không có bước nào đối chiếu hai kết quả**. Hệ thống ghi nhận cả hai, gộp thành một dòng "mua 35
cây", giữ lại con số đến trước (5900 của Ghế A). Mua hàng đặt 35 cây 5900mm mà không ai biết Bàn B
cần cỡ khác.

Hậu quả ngoài xưởng: đoạn 1550mm của Bàn B cắt trên cây 6200mm được 4 đoạn, hao 0%; trên cây 5900mm
chỉ được 3 đoạn, bỏ 1250mm — **21% hao hụt**, mà bảng hao hụt vẫn báo số đẹp vì nó tính theo cây
6200mm chứ không phải cây thật sự mua.

**Sửa:** `findConflictingStockLengthReason()` — đối chiếu `bestStockLengthMm` với mọi phương án
APPROVED khác của cùng PI (neo trực tiếp hoặc qua PO thành viên). Lệch cỡ → chặn, báo *"phải gộp đợt
cắt các SKU dùng chung loại sắt này"*. Gọi từ **cả hai** đường: `autoApproveBlockReason()` (nhánh
tự-duyệt) **và** `approve()` (đường thủ công `POST /cutting-proposals/:id/approve` — cổng kia không
bảo vệ đường này).

## L3 — Chiều dài cây biến mất khỏi đề xuất mua

Cả 3 đường ghi `PurchaseProposalItem` trong nhánh gộp-vào-đề-xuất-có-sẵn đều **quên mang theo**
`stockLengthMm`. Dòng sắt của SKU thứ 2 trở đi (hoặc khi VTTP/tiêu hao tạo đề xuất trước) luôn ra
NULL dù chính phương án của nó CÓ tính ra cỡ cây → Mua hàng không thấy badge "· cây 5900mm", mặc
định đặt cây 6000mm tiêu chuẩn. Dẫn thẳng tới hậu quả của L7 dù không ai bấm sai gì.

**Sửa:** `stockLengthMm` đi kèm mọi đường ghi.

## L5 — Sắt mua về bị đơn khác lấy mất

`receiveItem()` cộng hàng về vào giữ chỗ theo `proposal.cuttingProposalId` — con số này **bị ghi đè
thành phương án duyệt sau cùng** mỗi lần merge. `SteelIssuesService` lại tra giữ chỗ bằng `findFirst`
**không orderBy** trên các phương án của cùng PI. Hai quy tắc lệch nhau → SKU nào không trùng con số
`findFirst` chọn ngẫu nhiên thì giữ chỗ **không bao giờ lớn lên** dù hàng đã về kho, rồi kẹt cứng
khi Phôi xuất sắt.

**Sửa:** giữ chỗ chuyển sang **pool theo PI**.
- Schema: `StockReservation.productionInvoiceId` + enum `PRODUCTION_INVOICE`. Cột này **tách khỏi
  `refId`** có chủ đích — `refId` vẫn giữ nguyên `cuttingProposalId` gốc để `releaseByRef()`/
  `idempotencyKey` không đổi hành vi.
- `StockReservationsService`: thêm `loadPool` / `creditPool` / `drainPool`, gỡ `topUpFromReceipt`.
  Thứ tự ưu tiên trong pool = **hạn giao của SKU sở hữu từng dòng** (Sếp chốt: "ưu tiên theo PI, theo
  thứ tự hạn"). `drainPool` rút vắt qua nhiều dòng nếu dòng ưu tiên cao nhất không đủ.
- `receiveItem()` tra theo `proposal.productionInvoiceId` (ổn định, không bị ghi đè).
- Tiện thể sửa **cùng lỗi ở màn hiển thị**: `getIssuePlan()` dùng Map theo materialId nên khi 2 SKU
  chung vật tư chỉ thấy giữ chỗ của 1 SKU — "còn lại" hiện thiếu.

**Race tự phát hiện khi soát lại:** bản đầu của `drainPool` tính "còn lại bao nhiêu" từ dữ liệu đọc
**trước khi khoá dòng** — 2 lượt xuất gần nhau cùng tính từ một số cũ, ghi vượt quá thật. Đã sửa:
khoá **hết** các dòng liên quan trước (theo đúng thứ tự ưu tiên để tránh deadlock), đọc lại số mới
nhất ngay trong câu khoá, rồi mới quyết định lấy bao nhiêu từ dòng nào.

## L6 — Báo giá nhập dòng này lại gửi cho dòng kia

Một vật tư có thể có **2 dòng** trong cùng phiếu mua: dòng cũ đã mua đủ + dòng mới cho phần phát
sinh thiếu (hành vi cố ý, đúng nghiệp vụ — không được sửa số trên hồ sơ đã chốt). Nhưng FE phân biệt
các dòng bằng **`materialId`**, mà hai dòng này cùng mã → Map last-wins → báo giá/duyệt giá/nhận hàng
đều có thể ghi vào nhầm dòng.

Comment cũ ở `purchasing-api.ts` khẳng định *"materialId mới là định danh duy nhất trong 1 đề xuất"* —
**giả định đó đã sai từ khi có nhánh tách dòng thiếu**.

**Sửa (FE):** khoá theo `item.itemId` (PK thật) xuyên suốt. `toProposal()` build `quotes`/
`chosenSuppliers` theo `it.id`; **bỏ hẳn** `beItemIdsByMaterialId()` (không cần dịch nữa vì key giờ
chính là itemId); 6 trang đổi `itemKey`.

## L2 — Cùng một nhu cầu bị lập kế hoạch 2 lần

Hai đường duyệt (`approveItem` per-SKU / `approveBatch` cả cụm) vốn loại trừ nhau qua khoá trạng
thái, nhưng **cổng chặn chỉ có một chiều**: `approveBatch` có `assertMergedPi()`, còn `approveItem`
và route thô `POST /production-invoices/:id/cutting-proposals` **không kiểm `isMerged`**. Đi vòng qua
đó → 2 phương án cùng phủ 1 SKU → giữ chỗ tồn 2 lần + đề xuất mua trùng.

**Sửa 2 lớp:**

*Mức 1 — chặn đường vào:* PI gộp chỉ duyệt cả cụm; PI thường chỉ duyệt từng SKU. Đặt ở **service**
(không phải controller) vì route thô lẫn `approveBatch` đều gọi vào cùng chỗ, phải chịu chung một luật.

*Mức 2 — ép ở tầng dữ liệu:* bảng `CuttingPlanCoverage` với **khoá chính chính là bất biến** —
1 `ProductionOrder` không thể có 2 dòng phủ, bất kể ai gọi bằng đường nào. `claimCuttingPlanCoverage()`
chạy trong cùng transaction của `approve()`, sau bước supersede, trước mọi bút toán có hệ quả tiền bạc:

| Chủ cũ của SKU | Xử lý |
|---|---|
| Chính phương án này | Bỏ qua (gọi lại/retry, idempotent) |
| Đã SUPERSEDED | **Chuyển chủ** — đường đi hợp lệ của "Tính lại" |
| Còn APPROVED | **Chặn**, nêu rõ mã lệnh SX và phương án đang giữ |

Ca thứ 3 lẽ ra không tới được (mức 1 đã lọc) — tới được nghĩa là có đường lách qua, nên **nổ to thay
vì âm thầm ghi đè**.

## L1 — Số lượng mua phụ thuộc thứ tự bấm

Khi 2 SKU dùng chung 1 loại sắt, code phải quyết định con số mới là *cộng thêm* hay *thay thế*. Nó
đoán bằng `isRecomputeOfSameAnchor` — quy tắc **chỉ đúng khi dòng có 1 nguồn đóng góp**. Từ nguồn thứ
2 trở đi nó sai **cả hai chiều**:

| Tình huống | Cộng dồn | Thay thế | Đúng |
|---|---|---|---|
| Dòng đã gồm A(20)+B(15), tính lại A còn 12 | 47 (đếm đúp A) | 12 (mất trắng B) | **27** |

**Sửa — áp đúng công thức netting của MRP, bỏ hẳn heuristic:**

```
Nhu cầu gộp  = Σ buyBars của MỌI phương án cắt còn HIỆU LỰC (APPROVED) của PI
Nguồn đã có  = Σ phần đã CHỐT (≠ NEW) của mọi dòng mua thuộc PI
Nhu cầu ròng = max(0, gộp − đã có)      ← ghi vào dòng kế hoạch (NEW)
```

- Schema: `CuttingProposalLine.buyBars` — phần đóng góp của **từng dòng**, chốt lúc `approve()`.
  Đây chính là thứ trước đây không lưu nên mới phải đoán.
- **Ranh giới planned-order / firmed-order** (kinh điển của MRP): dòng `NEW` chưa ai động vào → ghi
  đè tự do; từ `QUOTING` trở đi người mua đã đi lấy báo giá / Sếp đã duyệt NCC / tiền đã đi → coi là
  **nguồn cung đã có**, chỉ phần chênh mới thành đơn kế hoạch mới. Không bao giờ sửa số dưới chân họ.
- Netting soi **MỌI** đề xuất của PI (không chỉ đề xuất đang mở): 1 đề xuất đã đóng hoàn toàn vẫn là
  hàng đã mua thật, bỏ qua nó sẽ mua lại lần 2 đúng số đã mua khi PI phát sinh SKU mới.
- **Nhu cầu tụt dưới phần đã chốt** (định mức/số lượng bị sửa giảm sau khi đã đặt hàng): không tự sửa
  dòng đã chốt, cũng không im lặng bỏ qua — ghi cảnh báo nêu rõ dư bao nhiêu. Đúng cơ chế *exception
  message* của MRP: hệ thống không tự quyết được thì để người xử lý.

Hệ quả: chạy lại bao nhiêu lần cũng ra một số (**idempotent** — yêu cầu bắt buộc của mọi lần chạy
MRP), và luôn truy được *"35 cây gồm 20 của A + 15 của B"*.

---

## Đã rút — không phải lỗi

Bản rà soát đầu có mục **L4**: *"2 SKU cùng loại sắt khác chiều dài thì phải tách thành 2 dòng mua
riêng"*. **Sai.** Cùng một loại sắt trong một đơn thì phải mua chung một cỡ cây — tách dòng là hợp
thức hoá cái sai. Hướng đúng là chặn ngay từ lúc duyệt, và đó chính là L7. Giữ lại mục này để số
hiệu các lỗi khác không xê dịch.

## Không đổi — DNA-DEXUAT (solver)

Solver đã trả đúng `best_stock_length` + `length_source` mỗi lần gọi (`api/views.py`). Toàn bộ vấn
đề nằm ở tầng lưu trữ ERP. Nếu sau này cần ghim chiều dài riêng cho loại sắt đã chốt thì thêm
`stock_lengths_by_material` theo đúng khuôn `max_waste_percentage_by_material` đã có sẵn — **chưa cần**,
cổng chặn L7 đã đủ.

---

## Migration & backfill

| Migration | Nội dung |
|---|---|
| `20260826150000_stock_reservation_production_invoice_pool` | `StockReservation.productionInvoiceId` + enum `PRODUCTION_INVOICE` (L5) |
| `20260827020000_cutting_proposal_line_buy_bars` | `CuttingProposalLine.buyBars` (L1) |
| `20260827030000_cutting_plan_coverage` | Bảng `CuttingPlanCoverage` (L2 mức 2) |

**3 script backfill — BẮT BUỘC chạy, và phải chạy TRƯỚC khi deploy code mới:**

| Script | Ghi vào | Kết quả trên máy dev |
|---|---|---|
| `npm run backfill:buy-bars` | `cutting_proposal_lines.buyBars` (cột mới, đang NULL) | 17 dòng, đối chiếu khớp 100% |
| `npm run backfill:cutting-plan-coverage` | `cutting_plan_coverage` (bảng mới, đang rỗng) | 9 phương án → 14 dòng phủ, 0 xung đột |
| `npm run backfill:stock-reservation-pi` | `stock_reservations.productionInvoiceId` (cột mới, đang NULL) | 11 dòng, 3 dòng RELEASED bỏ qua |

Cả ba **chỉ ghi vào cột/bảng vừa sinh ra trong đợt này** — không đụng số lượng mua, tồn kho, sổ cái
kho, trạng thái, báo giá, hay giữ chỗ đã có. Chạy lại nhiều lần vô hại. Hai script **tự dừng thay vì
đoán** khi giả định không đúng: `buy-bars` dừng nếu phát hiện phiếu mua đã qua cơ chế gộp (`buyQty`
lúc đó là tổng nhiều phương án, không tách ngược được); `coverage` dừng và liệt kê nếu phát hiện phủ
chồng có sẵn.

### ⚠ Thứ tự triển khai bắt buộc: `migrate` → `backfill` → mới deploy code mới

Nếu code mới lên sống trước khi backfill xong:

- **`buyBars` còn NULL** → nhu cầu gộp tính thiếu → lượt duyệt SKU tiếp theo **ghi đè dòng kế hoạch
  bằng con số hụt**. Đây đúng là lỗi L1, tái sinh qua đường dữ liệu — và sai **âm thầm**.
- `productionInvoiceId` còn NULL → Phôi xuất sắt bị chặn "không tìm thấy giữ chỗ". Nổ to, khó chịu
  nhưng không hỏng số liệu.
- `coverage` còn rỗng → cổng chặn phủ chồng chưa có gì để soi. Không hỏng gì, chỉ mất lớp bảo vệ.

Ca đầu nguy hiểm nhất vì nó sai lặng lẽ. **Đề xuất chưa làm:** đổi `l.buyBars ?? 0` thành **báo lỗi
rõ ràng** khi gặp NULL — chặn `approve()` với thông báo "chưa chạy backfill" thay vì lặng lẽ tính ra
số sai. Đánh đổi: trong cửa sổ chưa backfill thì không duyệt được phương án cắt cho PI đó, nhưng đó
là *dừng lại có lý do*, tốt hơn nhiều so với âm thầm mua thiếu bằng tiền thật.

---

## Xác minh

**BE:** `npx tsc --noEmit` sạch · `npx eslint` sạch trên toàn bộ file đã đụng · **752/752 test pass**
(46 suite, chạy với cache sạch) · 80 migration áp dụng đủ, `prisma migrate status` up to date ·
server thật khởi động 0 lỗi, auth guard trả 401 đúng.

**FE:** `npx tsc --noEmit` sạch · `npx eslint` sạch (chỉ còn 1 warning pre-existing không liên quan) ·
`npx vitest run` **47/47 pass** · `npm run build` (Next.js) thành công.

**Test mới đáng chú ý:**
- L1: dựng đúng ca mà heuristic cũ **không nhánh nào làm đúng được** (dòng đã gồm A+B rồi tính lại A
  → 27, trong khi cộng dồn ra 47 và thay thế ra 12).
- L1: dòng đã `QUOTING` **không bị đụng tới**, phần chênh tách thành dòng kế hoạch mới.
- L5: 2 SKU hạn khác nhau, id khác nhau → hàng về cộng đúng theo **hạn**, không theo thứ tự duyệt
  hay id.
- L6: 2 dòng **cùng materialId** (đã PURCHASED + shortfall mới) giữ được báo giá riêng cho từng dòng.
- L2: chặn đúng ca chủ cũ còn APPROVED, cho phép đúng ca chủ cũ đã SUPERSEDED.

**Đối chiếu DB sau backfill:** `cutting_plan_coverage` 14 dòng, 0 phủ chồng, 0 dòng trỏ tới phương án
đã chết. `buyBars` 0 dòng còn NULL, lệch 0. `stock_reservations` mọi dòng ACTIVE đều có
`productionInvoiceId`.

## Việc còn lại

- Chạy 3 script backfill **trên máy chủ thật** — cả ba tự kiểm điều kiện an toàn và dừng thay vì đoán
  nếu dữ liệu production khác giả định của máy dev.
- Chạy lại bộ truy vấn đối chiếu (chỉ đọc) trên production để xác nhận 6 lỗi cũng chưa nổ ở đó — số
  liệu trong tài liệu này lấy từ máy dev, có cả dữ liệu chạy thử.
- Cân nhắc đổi `buyBars ?? 0` thành báo lỗi rõ ràng (xem mục thứ tự triển khai ở trên).
