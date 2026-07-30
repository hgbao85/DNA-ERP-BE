# Phase 2 — Hướng dẫn test (Danh mục / Master Data + BOM Revision)

Phạm vi: 20 bảng danh mục/BOM, 10 module —
`material-groups`, `suppliers`, `defect-reasons`, `weaving-points`, `warehouses`, `customers`,
`products` (+ `variants`/`pieces`/`parts`), `materials` (+ `suppliers` lồng), `segment-specs`,
`bom-revisions` (+ `bom-pieces`/`bom-parts`/`piece-boms`/`part-boms`/`consumable-boms`).

Chi tiết endpoint/body: xem mục 11 của
[changelog-2026-07-30-phase-2-danh-muc-bom.html](./changelog-2026-07-30-phase-2-danh-muc-bom.html).

## 1. Test tự động

```bash
npx tsc --noEmit        # type-check toàn bộ project
pnpm lint:check          # eslint + prettier
pnpm build               # nest build → dist/
```

Không cần Postgres cho 3 lệnh trên. Phase 2 hiện **chưa có unit test** riêng (guard/service
spec) — khác Phase 1 (`mfg-role.guard.spec.ts`...); toàn bộ đã được verify bằng script gọi
thẳng class service thật trên DB thật trong lúc code (xem changelog mục 10), không phải qua
`pnpm test`. Nếu muốn test tự động lâu dài, nên bổ sung `*.spec.ts` cho `BomRevisionsService`
trước tiên — đây là module rủi ro cao nhất (state machine + guard chéo product).

## 2. Chuẩn bị môi trường có DB

### 2.1. Bật Postgres (nếu dùng local, bỏ qua nếu đã trỏ `DATABASE_URL` tới DB pooled sẵn)

```bash
docker compose up -d postgres
docker compose ps        # đợi cột STATUS = healthy
```

### 2.2. Áp migration + seed

```bash
pnpm prisma migrate deploy   # áp thêm 1 migration: 20260730000000_add_phase2_master_data_and_bom
pnpm seed                    # sync permissions (10 module P2 mới) + role + seed 9 kho
```

> **Migration Phase 2 viết tay** (không qua `prisma migrate dev` vì `DATABASE_URL` trỏ tới
> Prisma Postgres pooled dùng chung, tránh chạy trực tiếp khi chưa xác nhận) — đã tự
> `prisma validate` + `prisma generate` + `migrate deploy` thật lên DB trong phiên code,
> không phải migration chưa kiểm chứng.

> **`pnpm seed` có thể báo lỗi ở bước cuối** (`SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must
> be set`) nếu `.env` chưa có 2 biến đó — **vô hại**, các bước trước (permissions/roles/9 kho)
> đã ghi DB xong trước khi tới bước đó. Chạy `pnpm seed` xong luôn kiểm tra nhanh:
> ```bash
> psql "$DATABASE_URL" -c "select code, name, \"isVirtual\" from warehouses order by id;"
> # kỳ vọng: đúng 9 dòng — 6 vật lý (phu-kien, sat, day, thanh-pham, vat-tu-tp, phoi-son-han)
> # + 3 ảo (SUPPLIER, PRODUCTION, SCRAP)
> ```

### 2.3. Chạy app

```bash
pnpm start:dev
```

Swagger UI: `http://localhost:3001/api/docs` — bấm **Authorize**, dán `accessToken` để gọi
thử trực tiếp thay vì gõ curl tay. Tất cả 10 module Phase 2 đều lên Swagger tự động (decorator
`@ApiTags` đã gắn sẵn ở từng controller).

## 3. Lấy token

```bash
BASE=http://localhost:3001/api/v1

TOKEN=$(curl -s -X POST $BASE/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<mật khẩu thật của admin@demo.com>"}' \
  | jq -r .data.accessToken)
```

> Response mọi endpoint đều bọc trong `{ success, data, timestamp, path, statusCode }` —
> luôn lấy field qua `.data...`, không lấy thẳng field gốc.

Role `ADMIN` được sync full quyền trên **mọi** module trong `PERMISSION_MODULES` (kể cả 10
module Phase 2 mới), nên token trên gọi được hết endpoint dưới đây.

## 4. Test theo module

Biến `$TOKEN`/`$BASE` dùng lại từ mục 3 xuyên suốt. Mỗi block dưới đây build state nối tiếp
nhau (ID của bước trước dùng cho bước sau) — chạy tuần tự từ 4.1.

### 4.1. Material Groups

```bash
GROUP_ID=$(curl -s -X POST $BASE/material-groups -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"__TEST Sắt ống__"}' | jq -r .data.id)

curl -s $BASE/material-groups -H "Authorization: Bearer $TOKEN" | jq '.data[] | select(.id=="'$GROUP_ID'")'
# kỳ vọng: thấy group vừa tạo

curl -s -X POST $BASE/material-groups -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"__TEST Sắt ống__"}' -w '\n%{http_code}\n'
# kỳ vọng: 409 (trùng name)
```

### 4.2. Suppliers (soft-delete)

```bash
SUP_ID=$(curl -s -X POST $BASE/suppliers -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"__TEST Cty Thép__","phone":"0281234567"}' \
  | jq -r .data.id)

curl -s -X DELETE $BASE/suppliers/$SUP_ID -H "Authorization: Bearer $TOKEN" -w '%{http_code}\n' -o /dev/null
# kỳ vọng: 204

curl -s $BASE/suppliers/$SUP_ID -H "Authorization: Bearer $TOKEN" | jq '.data.isActive'
# kỳ vọng: false — record vẫn còn (soft-delete, không mất dữ liệu)
```

### 4.3. Defect Reasons

```bash
curl -s -X POST $BASE/defect-reasons -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"label":"__TEST Cong méo__","stageType":"HAN"}' | jq
# kỳ vọng: 201, stageType="HAN"
```

### 4.4. Weaving Points (decimal fields)

```bash
WP_ID=$(curl -s -X POST $BASE/weaving-points -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"code":"__TEST-DD__","fullName":"Test","dayDaiPercent":12.5}' | jq -r .data.id)

curl -s $BASE/weaving-points/$WP_ID -H "Authorization: Bearer $TOKEN" | jq '.data.dayDaiPercent'
# kỳ vọng: 12.5 (số, không phải string — xác nhận Decimal → number qua .toNumber() đúng)
```

### 4.5. Warehouses — guard bảo vệ 9 kho protected

```bash
SAT_ID=$(curl -s $BASE/warehouses -H "Authorization: Bearer $TOKEN" \
  | jq -r '.data[] | select(.code=="sat") | .id')

curl -s -X DELETE $BASE/warehouses/$SAT_ID -H "Authorization: Bearer $TOKEN" -w '\n%{http_code}\n'
# kỳ vọng: 403 — "sat" nằm trong PROTECTED_WAREHOUSE_CODES

curl -s -X PATCH $BASE/warehouses/$SAT_ID -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"code":"sat-moi"}' -w '\n%{http_code}\n'
# kỳ vọng: 403 — không đổi được code của kho protected

curl -s -X PATCH $BASE/warehouses/$SAT_ID -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"note":"ghi chú test"}' | jq '.data.note'
# kỳ vọng: 200, "ghi chú test" — sửa field KHÔNG phải code vẫn bình thường (guard chỉ chặn code/delete)

WH_ID=$(curl -s -X POST $BASE/warehouses -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"code":"__test-wh__","name":"Test WH"}' | jq -r .data.id)
curl -s -X DELETE $BASE/warehouses/$WH_ID -H "Authorization: Bearer $TOKEN" -w '%{http_code}\n' -o /dev/null
# kỳ vọng: 204 — kho KHÔNG protected xoá bình thường (soft)
```

### 4.6. Customers

```bash
CUST_ID=$(curl -s -X POST $BASE/customers -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"__TEST MEYING__","country":"US","market":"Amazon"}' | jq -r .data.id)
```

### 4.7. Products + Variants / Pieces / Parts (FK RESTRICT)

```bash
PRODUCT_ID=$(curl -s -X POST $BASE/products -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"factoryCode":"__TEST-P2__","name":"Ghế Test P2"}' \
  | jq -r .data.id)

VARIANT_ID=$(curl -s -X POST $BASE/products/$PRODUCT_ID/variants -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"customerId\":\"$CUST_ID\",\"colorCode\":\"BLACK\"}" \
  | jq -r .data.id)

PIECE_ID=$(curl -s -X POST $BASE/products/$PRODUCT_ID/pieces -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"code":"P1","groupNumber":1,"name":"Mảnh Tựa","isWoven":true,"weavingPrice":15000}' \
  | jq -r .data.id)

curl -s -X POST $BASE/products/$PRODUCT_ID/pieces -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"code":"P1","groupNumber":2,"name":"Trùng code"}' \
  -w '\n%{http_code}\n'
# kỳ vọng: 409 — unique (mfgProductId, code)

PART_ID=$(curl -s -X POST $BASE/products/$PRODUCT_ID/parts -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"code":"PT1","name":"Ráp khung tựa"}' | jq -r .data.id)

curl -s -X DELETE $BASE/products/$PRODUCT_ID -H "Authorization: Bearer $TOKEN" -w '\n%{http_code}\n'
# kỳ vọng: 400 — còn piece/part tham chiếu (RESTRICT FK → filter Prisma toàn cục)
```

### 4.8. Materials + MaterialSuppliers

```bash
MAT_ID=$(curl -s -X POST $BASE/materials -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"code\":\"__TEST-SAT__\",\"name\":\"Ống sắt test\",\"kind\":\"STEEL_BAR\",\"unit\":\"cm\",\"materialGroupId\":\"$GROUP_ID\"}" \
  | jq -r .data.id)

MATSUP_ID=$(curl -s -X POST $BASE/materials/$MAT_ID/suppliers -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"supplierId\":\"$SUP_ID\",\"price\":15000,\"leadTimeDays\":7}" \
  | jq -r .data.id)

curl -s $BASE/materials/$MAT_ID/suppliers -H "Authorization: Bearer $TOKEN" | jq '.data[0].supplierName'
# kỳ vọng: "__TEST Cty Thép__" — response kèm tên NCC, không phải chỉ id

curl -s -X POST $BASE/materials/$MAT_ID/suppliers -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"supplierId\":\"$SUP_ID\",\"price\":1}" -w '\n%{http_code}\n'
# kỳ vọng: 409 — unique (materialId, supplierId)

PAINT_MAT_ID=$(curl -s -X POST $BASE/materials -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"code":"__TEST-SON__","name":"Sơn test","kind":"PAINT","unit":"kg"}' | jq -r .data.id)
```

### 4.9. Segment Specs (validate `kind=STEEL_BAR`)

```bash
SPEC_ID=$(curl -s -X POST $BASE/segment-specs -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"materialId\":\"$MAT_ID\",\"cutLengthMm\":930}" \
  | jq -r .data.id)

curl -s -X POST $BASE/segment-specs -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"materialId\":\"$PAINT_MAT_ID\",\"cutLengthMm\":500}" \
  -w '\n%{http_code}\n'
# kỳ vọng: 400 — PAINT không phải STEEL_BAR

curl -s -X POST $BASE/segment-specs -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"materialId\":\"$MAT_ID\",\"cutLengthMm\":930}" \
  -w '\n%{http_code}\n'
# kỳ vọng: 409 — trùng (materialId, cutLengthMm)
```

### 4.10. BomRevision — luồng đầy đủ + state machine

```bash
# --- Tạo revision đầu tiên (DRAFT, revNo=1) ---
REV_ID=$(curl -s -X POST $BASE/products/$PRODUCT_ID/bom-revisions -H "Authorization: Bearer $TOKEN" \
  | jq -r .data.id)
curl -s $BASE/bom-revisions/$REV_ID -H "Authorization: Bearer $TOKEN" | jq
# kỳ vọng: status="DRAFT", revNo=1

# --- Thêm dòng con khi còn DRAFT ---
BOMPIECE_ID=$(curl -s -X POST $BASE/bom-revisions/$REV_ID/bom-pieces -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"pieceId\":\"$PIECE_ID\",\"qtyPerUnit\":1}" | jq -r .data.id)

PIECEBOM_ID=$(curl -s -X POST $BASE/bom-revisions/$REV_ID/piece-boms -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"pieceId\":\"$PIECE_ID\",\"segmentSpecId\":\"$SPEC_ID\",\"qtyPerPiece\":2,\"needsHan\":true}" \
  | jq -r .data.id)
curl -s $BASE/bom-revisions/$REV_ID/piece-boms -H "Authorization: Bearer $TOKEN" | jq '.data[0].segmentSpecLabel'
# kỳ vọng: "__TEST-SAT__ @ 930mm"

curl -s -X POST $BASE/bom-revisions/$REV_ID/consumable-boms -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"stage\":\"SON\",\"materialId\":\"$MAT_ID\",\"qtyPerUnit\":0.25}" \
  -w '\n%{http_code}\n'
# kỳ vọng: 400 — MAT_ID là STEEL_BAR, consumable_bom cần CONSUMABLE/PAINT
curl -s -X POST $BASE/bom-revisions/$REV_ID/consumable-boms -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"stage\":\"SON\",\"materialId\":\"$PAINT_MAT_ID\",\"qtyPerUnit\":0.25}" | jq
# kỳ vọng: 201 — PAINT hợp lệ

# --- Guard chéo product: tạo product khác + piece khác, gắn vào REV_ID phải bị chặn ---
PRODUCT2_ID=$(curl -s -X POST $BASE/products -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"factoryCode":"__TEST-P2B__","name":"Ghế Test P2B"}' \
  | jq -r .data.id)
PIECE2_ID=$(curl -s -X POST $BASE/products/$PRODUCT2_ID/pieces -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"code":"X1","groupNumber":1,"name":"Mảnh product khác"}' \
  | jq -r .data.id)
curl -s -X POST $BASE/bom-revisions/$REV_ID/bom-pieces -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"pieceId\":\"$PIECE2_ID\",\"qtyPerUnit\":1}" -w '\n%{http_code}\n'
# kỳ vọng: 400 — piece thuộc PRODUCT2_ID, không cùng product với REV_ID (thuộc PRODUCT_ID)

# --- Activate: DRAFT → ACTIVE ---
curl -s -X POST $BASE/bom-revisions/$REV_ID/activate -H "Authorization: Bearer $TOKEN" | jq '.data.status'
# kỳ vọng: "ACTIVE"

# --- Không sửa/xoá được dòng con khi hết DRAFT ---
curl -s -X PATCH $BASE/bom-revisions/$REV_ID/bom-pieces/$BOMPIECE_ID -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"qtyPerUnit":99}' -w '\n%{http_code}\n'
# kỳ vọng: 409
curl -s -X DELETE $BASE/bom-revisions/$REV_ID/piece-boms/$PIECEBOM_ID -H "Authorization: Bearer $TOKEN" \
  -w '\n%{http_code}\n'
# kỳ vọng: 409
curl -s -X DELETE $BASE/bom-revisions/$REV_ID -H "Authorization: Bearer $TOKEN" -w '\n%{http_code}\n'
# kỳ vọng: 409 — không xoá được revision đã ACTIVE

# --- Tạo revision thứ 2 + activate → revision 1 tự động RETIRED ---
REV2_ID=$(curl -s -X POST $BASE/products/$PRODUCT_ID/bom-revisions -H "Authorization: Bearer $TOKEN" \
  | jq -r .data.id)
curl -s $BASE/bom-revisions/$REV2_ID -H "Authorization: Bearer $TOKEN" | jq '.data.revNo'
# kỳ vọng: 2

curl -s -X POST $BASE/bom-revisions/$REV2_ID/activate -H "Authorization: Bearer $TOKEN" | jq '.data.status'
# kỳ vọng: "ACTIVE"
curl -s $BASE/bom-revisions/$REV_ID -H "Authorization: Bearer $TOKEN" | jq '.data.status'
# kỳ vọng: "RETIRED" — activate REV2 tự retire REV_ID, đúng 1 ACTIVE/product tại 1 thời điểm

curl -s $BASE/products/$PRODUCT_ID/bom-revisions -H "Authorization: Bearer $TOKEN" \
  | jq '.data | map({revNo, status})'
# kỳ vọng: [{"revNo":2,"status":"ACTIVE"},{"revNo":1,"status":"RETIRED"}]
```

> **Race condition thật (2 request `activate()` đồng thời cho cùng 1 product) khó tái hiện
> đáng tin cậy bằng curl tuần tự** — cơ chế chặn nằm ở partial unique index
> `bom_revision_one_active_per_product` tại tầng DB, không phải lock ở code. Muốn test thật
> sự concurrency: bắn 2 request `POST .../activate` song song bằng `xargs -P2`/`ab`/k6 nhắm
> vào 2 revision DRAFT khác nhau của cùng 1 `mfgProductId`, kỳ vọng đúng 1 request 200 và 1
> request 409 (unique violation qua filter Prisma).

## 5. Checklist Definition-of-Done (đối chiếu roadmap P2)

- [ ] 7 module CRUD thuần (`material-groups`, `suppliers`, `defect-reasons`, `weaving-points`,
      `warehouses`, `customers`, `products`) pass CRUD + đúng loại xoá (soft/hard) + phân trang.
- [ ] `warehouses`: DELETE và đổi `code` bị chặn 403 cho đúng 9 mã protected, các field khác
      sửa bình thường.
- [ ] `products`/`pieces`/`parts`: unique `(mfgProductId, code)` hoạt động; xoá `product` còn
      con bị chặn 400.
- [ ] `materials`: unique `code`; `material-suppliers` unique `(materialId, supplierId)`.
- [ ] `segment-specs`: từ chối 400 khi `material.kind != STEEL_BAR`; unique
      `(materialId, cutLengthMm)`.
- [ ] `bom-revisions`: không sửa/xoá được dòng con khi `status != DRAFT` (409) — đã test ở 4.10.
- [ ] `bom-pieces`/`bom-parts`/`piece-boms`/`part-boms`: 400 khi piece/part thuộc product khác
      với `bomRevision.mfgProductId` — đã test ở 4.10.
- [ ] `activate()` đảm bảo đúng 1 `ACTIVE`/`mfgProductId` — verify tuần tự ở 4.10; nên bổ sung
      test tải song song thật trước khi P7 (production_order) bắt đầu phụ thuộc vào
      `bomRevisionId` ACTIVE.
- [ ] 6+3 kho seed đúng, idempotent (`pnpm seed` chạy lại không tạo trùng) — xem mục 2.2.
