# Phase 8 — Hướng dẫn test (Mua hàng, rút gọn: chỉ vật tư sắt)

Phạm vi: `PurchaseProposal`/`PurchaseProposalItem`/`PurchaseProposalQuote` (module
`purchase-proposals`) + hook tự sinh trong `CuttingProposalsService.approve()`. **Không** bao
gồm `InspectionRequest`/đối chiếu tồn kho thật (`StockQuant`) — quyết định nghiệp vụ 2026-08-07,
xem đầu file `src/modules/purchase-proposals/purchase-proposals.service.ts`.

Quan hệ với các phase khác: `PurchaseProposal` tự sinh 1-1 theo `(cuttingProposalId,
warehouseCode)` **ngay khi** `POST /cutting-proposals/:id/approve` chạy (Phase 7) — không có
API tạo thủ công. Muốn có dữ liệu để test Phase 8, phải đi qua chuỗi Phase 2 (danh mục/BOM) →
Phase 5/6 (SKU/PI) → Phase 7 (Production Order + Cutting Proposal) trước; xem
[phase-2-testing-guide.md](./phase-2-testing-guide.md) và
[changelog-2026-08-06-phase-7-production-order-cutting-proposal.md](./changelog-2026-08-06-phase-7-production-order-cutting-proposal.md)
nếu cần dựng lại từ đầu.

## 1. Test tự động

```bash
npx tsc --noEmit
npx eslint "{src,test}/**/*.ts" --fix
npx jest purchase-proposals cutting-proposals
```

Không cần Postgres cho `tsc`/`eslint`. `jest` cũng không cần DB thật (toàn bộ mock
`PrismaServiceType`) — **21 test** cho `PurchaseProposalsService`
(`purchase-proposals.service.spec.ts`) + **2 test bổ sung** cho hook tự sinh trong
`CuttingProposalsService.approve()` (`cutting-proposals.service.spec.ts`, describe `approve`).

Ma trận coverage của `purchase-proposals.service.spec.ts` (mỗi state-machine transition đều có
cả đường đúng lẫn đường bị chặn sai trạng thái):

| Method | Happy path | Guard/negative |
| --- | --- | --- |
| `findOne` | map đúng nested items/quotes | 404 khi không tồn tại |
| `acknowledge` | NEW → QUOTING | 409 khi không phải NEW |
| `addQuote` | tạo quote dưới item | 409 sai trạng thái; 404 item không thuộc proposal |
| `submit` | QUOTING → SUBMITTED khi đủ báo giá | 400 khi có item chưa có báo giá hợp lệ (đơn giá > 0) |
| `approve` | set `isChosen`, SUBMITTED → PURCHASING | 400 thiếu NCC chọn cho 1 item; 400 quoteId không thuộc item |
| `reject` | SUBMITTED → REJECTED kèm lý do | 409 khi không phải SUBMITTED |
| `requote` | REJECTED → QUOTING | 409 khi không phải REJECTED |
| `receiveItem` | cộng dồn `receivedQty`, clamp ≤ `buyQty`, tự PURCHASED khi đủ mọi item | 409 khi không phải PURCHASING; 404 item không thuộc proposal |

`cutting-proposals.service.spec.ts` (describe `approve`) kiểm hook tự sinh: tạo đúng
`PurchaseProposal` với `items` chỉ gồm dòng `feasible=true && totalBars>0` (bỏ qua dòng
infeasible và dòng `totalBars=0`), và **không** tạo gì cả nếu không có dòng nào đạt điều kiện.

## 2. Chuẩn bị môi trường có DB

```bash
docker compose up -d postgres
docker compose ps                 # đợi STATUS = healthy
npx prisma migrate deploy         # áp thêm 20260807024100_add_purchase_proposal
npx prisma generate
npm run start:dev
```

Solver `cat_sat_iea` phải chạy thật (Phase 7 gọi HTTP thật, không mock) — xem
`docker ps` có `catsat_web` (cổng 18080) và `.env` có `SOLVER_BASE_URL`/`SOLVER_API_KEY` trỏ
đúng instance đó.

## 3. Lấy token

```bash
BASE=http://localhost:3000/api/v1
TOKEN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<mật khẩu thật>"}' | jq -r .data.accessToken)
```

`ADMIN`/`BOSS` có full quyền mọi module (kể cả `PURCHASE_PROPOSAL`) nên token trên gọi được hết
endpoint dưới đây. Muốn test đúng phân quyền `PURCHASER` (chỉ `PURCHASE_PROPOSAL`/`SUPPLIER`,
không `APPROVE`) thì tạo riêng 1 user gán role `PURCHASER` — `POST /purchase-proposals/:id/approve`
và `/reject` phải trả 403 với token đó (chỉ `BOSS` mới `APPROVE` được).

## 4. Dựng 1 CuttingProposal tới DRAFT (tiền đề bắt buộc)

Rút gọn tối đa từ chuỗi đầy đủ (xem 2 tài liệu dẫn ở đầu file nếu cần chi tiết từng bước) —
giả định đã có sẵn `$PRODUCT_ID`/`$PIECE_ID` với ≥1 `SegmentSpec` nhóm `STEEL_BAR` gắn trong
`BomRevision` đã `ACTIVE`, và 1 `ProductionInvoiceItem` đã `WAITING_BOSS`:

```bash
curl -s -X POST $BASE/production-invoices/$PI_ID/items/$ITEM_ID/approve \
  -H "Authorization: Bearer $TOKEN" | jq '.data'
# kỳ vọng: prodApprovalStatus=APPROVED - đồng thời NGẦM tạo ProductionOrder + gọi solver
# (fire-and-forget, không block response này)

sleep 5   # đợi solver trả kết quả (thường vài giây, tăng nếu auto_scan bật)

PO_ID=$(curl -s $BASE/production-orders -H "Authorization: Bearer $TOKEN" \
  | jq -r '.data[] | select(.productionInvoiceItemId=="'$ITEM_ID'") | .id')
CP_ID=$(curl -s $BASE/production-orders/$PO_ID/cutting-proposals -H "Authorization: Bearer $TOKEN" \
  | jq -r '.data[0].id')

curl -s $BASE/cutting-proposals/$CP_ID -H "Authorization: Bearer $TOKEN" | jq '.data.status, .data.lines'
# kỳ vọng: status=DRAFT, lines[] có ít nhất 1 dòng feasible=true, totalBars>0
```

Nếu `status=FAILED` (`errorMessage` có nội dung) — kiểm tra solver có chạy không
(`curl $SOLVER_BASE_URL/api/v1/de_xuat/propose/` phải trả lỗi 401 chứ không phải connection
refused), hoặc `SystemConfig.solverMaxWastePercentage` đang quá chặt so với BOM test.

## 5. Duyệt Cutting Proposal → xác nhận PurchaseProposal tự sinh

```bash
curl -s -X POST $BASE/cutting-proposals/$CP_ID/approve -H "Authorization: Bearer $TOKEN" \
  | jq '.data.status'
# kỳ vọng: "APPROVED"

PP_ID=$(curl -s $BASE/purchase-proposals -H "Authorization: Bearer $TOKEN" \
  | jq -r '.data[] | select(.cuttingProposalId=="'$CP_ID'") | .id')

curl -s $BASE/purchase-proposals/$PP_ID -H "Authorization: Bearer $TOKEN" | jq
# kỳ vọng: status="NEW", warehouseCode="phoi-son-han", items[] có buyQty khớp đúng
# totalBars của từng dòng feasible ở bước 4 (so trực tiếp 2 response để đối chiếu)

# --- Duyệt lại lần 2 phải bị chặn (đã APPROVED, không còn DRAFT) ---
curl -s -X POST $BASE/cutting-proposals/$CP_ID/approve -H "Authorization: Bearer $TOKEN" \
  -w '\n%{http_code}\n'
# kỳ vọng: 409
```

ITEM_ID_1 dùng cho các bước sau — lấy từ response trên:

```bash
PP_ITEM_ID=$(curl -s $BASE/purchase-proposals/$PP_ID -H "Authorization: Bearer $TOKEN" \
  | jq -r '.data.items[0].id')
```

## 6. Luồng đầy đủ: NEW → QUOTING → SUBMITTED → PURCHASING → PURCHASED

```bash
# --- Purchasing tiếp nhận ---
curl -s -X POST $BASE/purchase-proposals/$PP_ID/acknowledge -H "Authorization: Bearer $TOKEN" \
  | jq '.data.status'
# kỳ vọng: "QUOTING"

curl -s -X POST $BASE/purchase-proposals/$PP_ID/acknowledge -H "Authorization: Bearer $TOKEN" \
  -w '\n%{http_code}\n'
# kỳ vọng: 409 - không acknowledge lại được lần 2

# --- Thêm 2 báo giá cho 1 vật tư ---
curl -s -X POST $BASE/purchase-proposals/$PP_ID/items/$PP_ITEM_ID/quotes \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"supplierName":"Minh Thành","unitPrice":45000}' | jq -r .data.id
Q1_ID=$(curl -s $BASE/purchase-proposals/$PP_ID -H "Authorization: Bearer $TOKEN" \
  | jq -r '.data.items[0].quotes[0].id')

curl -s -X POST $BASE/purchase-proposals/$PP_ID/items/$PP_ITEM_ID/quotes \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"supplierName":"An Phát","unitPrice":43500}' | jq
Q2_ID=$(curl -s $BASE/purchase-proposals/$PP_ID -H "Authorization: Bearer $TOKEN" \
  | jq -r '.data.items[0].quotes[1].id')

# --- Submit khi chưa đủ báo giá cho MỌI item (nếu có >1 item) phải bị chặn 400 - test thủ công
#     nếu proposal test của bạn có ≥2 item, bỏ qua nếu chỉ có 1 ---

curl -s -X POST $BASE/purchase-proposals/$PP_ID/submit -H "Authorization: Bearer $TOKEN" \
  | jq '.data.status'
# kỳ vọng: "SUBMITTED"

# --- Sếp duyệt, chọn NCC rẻ hơn (An Phát) ---
curl -s -X POST $BASE/purchase-proposals/$PP_ID/approve -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"chosenQuoteIdByItemId\":{\"$PP_ITEM_ID\":\"$Q2_ID\"}}" | jq '.data.status'
# kỳ vọng: "PURCHASING"

curl -s $BASE/purchase-proposals/$PP_ID -H "Authorization: Bearer $TOKEN" \
  | jq '.data.items[0].quotes | map({id, isChosen})'
# kỳ vọng: đúng Q2_ID isChosen=true, Q1_ID isChosen=false

# --- Nhận hàng 1 phần rồi đủ ---
BUY_QTY=$(curl -s $BASE/purchase-proposals/$PP_ID -H "Authorization: Bearer $TOKEN" \
  | jq -r '.data.items[0].buyQty')
HALF=$((BUY_QTY / 2))

curl -s -X POST $BASE/purchase-proposals/$PP_ID/items/$PP_ITEM_ID/receive \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"receivedQty\":$HALF}" | jq '.data.receivedQty, .data.buyQty'
# kỳ vọng: receivedQty=$HALF, buyQty không đổi

curl -s $BASE/purchase-proposals/$PP_ID -H "Authorization: Bearer $TOKEN" | jq '.data.status'
# kỳ vọng: vẫn "PURCHASING" - chưa nhận đủ

curl -s -X POST $BASE/purchase-proposals/$PP_ID/items/$PP_ITEM_ID/receive \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"receivedQty\":$BUY_QTY}" | jq '.data.receivedQty'
# kỳ vọng: receivedQty=$BUY_QTY (clamp đúng ở buyQty dù gửi thừa $HALF + $BUY_QTY > buyQty)

curl -s $BASE/purchase-proposals/$PP_ID -H "Authorization: Bearer $TOKEN" | jq '.data.status'
# kỳ vọng: "PURCHASED" - tự chuyển khi mọi item đã nhận đủ
```

## 7. Nhánh từ chối → báo giá lại (test riêng, cần 1 PurchaseProposal khác ở SUBMITTED)

Lặp lại mục 4-6 tới bước `submit` với 1 Cutting Proposal khác (`$PP_ID_2`), rồi:

```bash
curl -s -X POST $BASE/purchase-proposals/$PP_ID_2/reject -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"rejectionReason":"Giá quá cao so với thị trường"}' \
  | jq '.data.status, .data.rejectionReason'
# kỳ vọng: "REJECTED", đúng lý do

curl -s -X POST $BASE/purchase-proposals/$PP_ID_2/approve -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"chosenQuoteIdByItemId":{}}' -w '\n%{http_code}\n'
# kỳ vọng: 409 - REJECTED không approve trực tiếp được, phải requote trước

curl -s -X POST $BASE/purchase-proposals/$PP_ID_2/requote -H "Authorization: Bearer $TOKEN" \
  | jq '.data.status'
# kỳ vọng: "QUOTING" - quotes cũ vẫn còn (không bị xoá, xem lại GET chi tiết để xác nhận)
```

## 8. Test phân quyền (dùng token của user role `PURCHASER`, không phải ADMIN/BOSS)

```bash
curl -s -X POST $BASE/purchase-proposals/$PP_ID/approve -H "Authorization: Bearer $PURCHASER_TOKEN" \
  -H 'Content-Type: application/json' -d '{"chosenQuoteIdByItemId":{}}' -w '\n%{http_code}\n'
# kỳ vọng: 403 - PURCHASER không có PURCHASE_PROPOSAL:APPROVE, chỉ BOSS/ADMIN mới duyệt được

curl -s -X POST $BASE/purchase-proposals/$PP_ID/acknowledge -H "Authorization: Bearer $PURCHASER_TOKEN" \
  -w '\n%{http_code}\n'
# kỳ vọng: 200/409 tuỳ trạng thái hiện tại - KHÔNG phải 403 (PURCHASER có UPDATE)
```

## 9. Checklist Definition-of-Done

- [ ] `POST /cutting-proposals/:id/approve` tự sinh đúng 1 `PurchaseProposal` với `items[]` khớp
      chính xác các `CuttingProposalLine` `feasible=true && totalBars>0` — đã verify tự động
      (mục 1), verify lại thủ công 1 lần ở mục 5.
- [ ] Không tạo `PurchaseProposal` nào khi mọi dòng đều infeasible hoặc `totalBars=0` — verify
      tự động (mục 1).
- [ ] Duyệt lại Cutting Proposal đã `APPROVED` bị chặn 409 (không tạo thêm `PurchaseProposal`
      trùng — unique `(cuttingProposalId, warehouseCode)` cũng là lưới an toàn thứ 2 ở DB).
- [ ] Toàn bộ state machine `NEW→QUOTING→SUBMITTED→PURCHASING→PURCHASED` chạy đúng thứ tự, mỗi
      bước sai thứ tự đều bị 409 — mục 6.
- [ ] `submit` chặn 400 khi có vật tư chưa đủ báo giá hợp lệ (đơn giá > 0).
- [ ] `approve` set đúng `isChosen`, bỏ chọn NCC khác của cùng item — mục 6.
- [ ] Nhánh `REJECTED → QUOTING` (requote) giữ nguyên báo giá cũ, không mất lịch sử — mục 7.
- [ ] `receiveItem` cộng dồn đúng qua nhiều lần, clamp không vượt `buyQty`, tự chuyển
      `PURCHASED` đúng lúc mọi item đủ hàng (không sớm hơn) — mục 6.
- [ ] Phân quyền `PURCHASER` (UPDATE, không APPROVE) vs `BOSS`/`ADMIN` (APPROVE) — mục 8.
- [ ] `npx jest purchase-proposals cutting-proposals` xanh, `npx tsc --noEmit` sạch.
