# Changelog 2026-09-11 — Cảnh báo khi ProductionOrder đang chạy dùng BOM đã lỗi thời (đã bỏ banner FE, xem mục 7; lỗ hổng "sửa tại chỗ" mục 8 đã VÁ ở mục 9 - chốt DB + đường sửa chính thống)

## 1. Bối cảnh / triệu chứng người dùng báo

Người dùng báo: đã khai định mức "vật tư thành phẩm" (Sắt La/Thanh nhôm) cho 1 sản phẩm ở màn "Sửa
định mức", đã được Sếp duyệt — nhưng màn **"Phân phối nội bộ" > "Xuất vật tư TP"** vẫn không hiển
thị vật tư vừa khai cho lệnh sản xuất (PI) đang chạy của đúng sản phẩm đó.

## 2. Điều tra + tái hiện

Kiểm tra riêng lẻ, ban đầu nghi ngờ 1 lỗi FE (nuốt lỗi API) — có thật (mục 4 bên dưới) nhưng KHÔNG
phải nguyên nhân chính, vì người dùng xác nhận "đã khai định mức nhưng vẫn không có" (loại trừ
trường hợp BOM thực sự trống).

Đào sâu logic BE phát hiện: `ProductionOrder.bomRevisionId` được **ghim (snapshot) 1 lần duy nhất**
tại thời điểm Sếp duyệt sản xuất (`ProductionOrdersService.createFromApproval()` — chọn BomRevision
đang ACTIVE của `mfgProductId` TẠI THỜI ĐIỂM ĐÓ). Đây là thiết kế cố ý (lịch sử bất biến, tránh đổi
ngầm định mức của 1 lệnh đang chạy dở). Nhưng nếu SAU ĐÓ ai đó khai/sửa lại định mức cho CÙNG sản
phẩm (qua 1 `PlanForm`/SKU mới — vì sửa thẳng bản BOM đã ACTIVE bị chặn 409) và được Sếp duyệt lại,
hệ thống **activate 1 BomRevision mới, retire bản cũ** — nhưng **KHÔNG có cơ chế nào cập nhật lại
`bomRevisionId` của các `ProductionOrder` đang chạy dở đã ghim vào bản cũ**. Mọi màn đọc theo
`order.bomRevisionId` (Xuất sắt, Xuất vật tư TP/hàn/sơn, Xuất đan...) sẽ mãi mãi không thấy vật tư
mới khai cho lệnh đó, không có cảnh báo gì.

**Tái hiện thành công** trên DB dev local (PI-2026-001, sản phẩm E2E-BAN-01):
1. Tạo 1 SKU mới cho CÙNG `mfgProductId`, khai thêm 1 mảnh "Chân nhôm" dùng vật tư mới.
2. Cho Sếp duyệt SKU mới → activate BomRevision mới (revNo 2), retire bản cũ (revNo 1).
3. `ProductionOrder` của PI-2026-001 vẫn ghim `bomRevisionId=1` (đã RETIRED).
4. `GET /production-orders/1/material-yield-issue-plan` (màn "Xuất vật tư TP") **chỉ thấy vật tư cũ**
   ("Sắt lá E2E"), vật tư mới khai ("Chân nhôm"/E2E-SAT-25, đang ACTIVE cho sản phẩm) hoàn toàn không
   xuất hiện — khớp đúng triệu chứng người dùng báo.

## 3. Quyết định hướng fix

Bàn 3 phương án: (A) tự động đồng bộ lại `bomRevisionId` khi BOM sản phẩm đổi — **loại bỏ**, rủi ro
cao (đổi ngầm định mức 1 lệnh đang chạy dở, có thể làm sai số liệu đã xuất/đã cắt theo định mức cũ).
(B) thêm nút "Đồng bộ lại định mức" thủ công, chỉ Admin/QLSX/Sếp bấm, có xác nhận + audit log. (C)
chỉ cảnh báo, không tự sửa gì.

**Người dùng chọn: làm (C) trước (đợt này), (B) làm sau khi cần.**

## 4. Đã làm (đợt này — chỉ (C), cảnh báo)

**BE**
- `ProductionOrderResponseDto`: thêm field `bomOutOfDate: boolean`.
- `ProductionOrdersService`: thêm `fetchActiveBomRevisionIds()` (1 query duy nhất, batch theo tập
  `mfgProductId` của cả trang kết quả — không lặp N+1 theo từng dòng), so sánh với `bomRevisionId` đã
  ghim của từng `ProductionOrder` để tính `bomOutOfDate`. Áp dụng cho cả `findAll()` (GET
  `/production-orders`, nguồn `fetchProductionOrdersCached()` bên FE mọi màn kho đang dùng chung) và
  `findOne()`/`startFloor()`/`pauseFloor()`/`finishFloor()`. `activeRevisionId` không tồn tại (sản
  phẩm không còn bản ACTIVE nào, hiếm) → coi như KHÔNG out-of-date, tránh cảnh báo sai khi không có
  gì để so sánh.
- Test: `production-orders.service.spec.ts` — thêm 3 case cho `bomOutOfDate` (true/false/không có
  bản ACTIVE), cập nhật mock `bomRevision.findMany` cho các test cũ.

**FE**
- `services/production-invoice-item.ts`: thêm `bomOutOfDate` vào `BeProductionOrderRaw` và
  `ProductionOrderInfo` (nguồn dùng chung cho `usePoInfoFloorGate()` — mọi màn "Phân phối nội bộ" đều
  đọc qua đây, nên có thể thêm cảnh báo cho các màn khác sau này mà không cần sửa BE thêm).
- `modules/pages/InboundWarehouse/XuatVatTuThanhPhamPage.tsx` ("Xuất vật tư TP", màn người dùng báo
  lỗi): hiện banner cảnh báo màu vàng khi `poInfoFor(selectedPf)?.bomOutOfDate` — *"Định mức (BOM)
  của sản phẩm này đã được sửa/duyệt lại SAU KHI lệnh sản xuất này được tạo — vật tư mới khai (nếu
  có) sẽ KHÔNG hiện ở đây... Báo QLSX/Sếp nếu cần áp dụng định mức mới."*
- Cùng file: sửa luôn bug phụ phát hiện lúc điều tra — `useFetch` cho kế hoạch xuất KHÔNG lấy
  `error`, nên lỗi API thật (403/500/mất mạng) bị hiển thị lẫn với thông báo "chưa khai định mức"
  (business-state hợp lệ) — giờ tách riêng, mirror đúng pattern đã có sẵn ở `XuatSatPage.tsx`.

## 5. Kiểm tra

- BE: `npx tsc --noEmit` sạch, `npx eslint --fix` không lỗi, `npx jest` — **47 suites / 1002 test
  pass** (tăng từ 999 do 3 test mới).
- FE: `npx tsc --noEmit` sạch, `npx eslint` không lỗi (1 warning pre-existing không liên quan).
- Live-test: dùng chính state đã tái hiện ở mục 2 (PI-2026-001 vẫn `bomOutOfDate=true` thật trên DB
  dev) — mở tài khoản `khopsh`, vào "Phân phối nội bộ" > "Xuất vật tư TP" > PI-2026-001: banner vàng
  hiện đúng nội dung, không lỗi console mới, dữ liệu vật tư cũ ("Sắt lá E2E") vẫn hiển thị bình
  thường bên dưới banner.

## 6. Bỏ banner FE (cùng ngày, sau khi người dùng xem thử)

Người dùng xem live-test xong quyết định: **không cần banner cảnh báo màu vàng này** ở màn "Xuất vật
tư TP". Đã xóa khối JSX hiện banner trong `XuatVatTuThanhPhamPage.tsx` (mục 4 ở trên).

**Giữ lại**: field `bomOutOfDate` ở BE (`ProductionOrderResponseDto`) và FE
(`ProductionOrderInfo`/`usePoInfoFloorGate()`) — đã test đầy đủ, không hại gì khi tồn tại mà không
dùng, và có thể tái sử dụng sau nếu cần hiển thị theo cách khác (badge nhỏ, cột riêng...) mà không
phải sửa lại BE. Bug phụ "nuốt lỗi API" (mục 4, tách `planError` riêng) vẫn giữ nguyên - không liên
quan tới quyết định bỏ banner.

Kiểm tra lại sau khi bỏ: `npx tsc --noEmit` sạch (cả FE), `npx eslint` không lỗi mới, live-test lại
đúng PI-2026-001 (tài khoản `khopsh`) - banner không còn hiện, phần còn lại của trang (danh sách vật
tư "Sắt lá E2E") vẫn hoạt động bình thường.

## 7. Còn treo

- Hiện KHÔNG còn cảnh báo nào hiển thị cho người dùng khi gặp tình huống "BOM đã lỗi thời" (đã bỏ
  banner ở mục 6) — nếu về sau muốn có lại dưới hình thức khác (badge nhỏ, cột riêng...), field
  `bomOutOfDate` đã sẵn có ở BE/`ProductionOrderInfo`, chỉ cần thêm phần hiển thị FE.
- **(B) chưa làm**: nút "Đồng bộ lại định mức" thủ công (Admin/QLSX/Sếp bấm, có audit log) — làm sau
  khi thấy tình huống này đủ thường xuyên trong thực tế cần công cụ tự xử lý thay vì xử lý ngoài hệ
  thống (huỷ + tạo lại lệnh).
- Data test dùng để tái hiện bug (SKU id=2, BomRevision revNo=2 cho sản phẩm E2E-BAN-01) **vẫn còn
  trên DB dev local** — cố ý giữ lại làm bằng chứng sống cho live-test ở mục 5. Nếu cần DB dev sạch
  lại, chạy `npx prisma migrate reset` (mất hết data hiện tại, sẽ seed lại từ đầu).

---

## 8. Lỗ hổng mới của chính cơ chế này: bản BOM đã ghim bị SỬA TẠI CHỖ (2026-09-21)

Phát hiện khi đối chiếu số cây ước tính với số cây solver giải thật (xem
`changelog-2026-09-16-chieu-dai-cay-theo-quy-cach.md` mục 18.7).

### 8.1 Hiện tượng

`SAT-TRON-FI4` trên proposal #2 (PO-GOPLUS-E2E-01, 300 ghế, APPROVED) lưu **1 cây / hao 30%**,
trong khi định mức hiện tại cần 2 đoạn 60mm mỗi bộ = 600 đoạn ≈ **7 cây**.

### 8.2 Nguyên nhân — KHÔNG phải lỗi tính toán

Có **2 `segment_spec` cho cùng `SAT-TRON-FI4`**: id 6 = `6.0mm`, id 8 = `60.0mm`.

| Proposal | Giờ (17/09) | spec dùng | Kết quả |
|---|---|---|---|
| #2 (PO 1) | 07:14 | **6** (6.0mm) | 1 cây, 30% — 600 đoạn × 6mm = 3600mm, đúng |
| #4 (PO 2) | 07:39 | **6** (6.0mm) | 1 cây, 65% |
| #6 (PO 3) | 09:07 | **8** (60.0mm) | 4 cây @5000mm, 0.935% |

Tức con số `1 cây / 30%` **đúng** với chiều dài đoạn 6mm — đây chính là ca đã ghi ở
`changelog-2026-09-17-reset-local-du-lieu-that-e2e.md` mục "còn treo": *"KÍCH THƯỚC=6 đọc từ Excel
CÓ THỂ không phải chiều dài cắt thật"*. Sau đó số được sửa lại thành 60mm.

**Vấn đề nằm ở chỗ sửa.** `piece_bom` của **BomRevision 1 (ACTIVE)** hiện trỏ spec 8, tức các dòng
của một bản đã ACTIVE, đã có proposal đã duyệt treo lên, **bị đổi nội dung tại chỗ**. Bằng chứng id
`piece_bom` 1-14 liền mạch (không có khoảng trống) → là các dòng insert gốc bị `UPDATE`, không phải
xoá-tạo-lại.

### 8.3 Không đường API nào làm được việc đó

Đã rà cả 2 đường ghi:
- `BomRevisionsService`: `assertDraft()` gọi ở **mọi** hàm mutate (21 chỗ) → 409 nếu không DRAFT.
- `SkusService.resolveDraftBomRevision()` ([skus.service.ts:596](src/modules/skus/skus.service.ts:596)):
  revision của PlanForm không còn DRAFT → 409.

Nên thay đổi này đến từ **script/SQL ngoài API**. Phù hợp với dấu vết audit: `audit_logs` không có
một dòng `SegmentSpec` nào (dù `SegmentSpec` NẰM TRONG `AUDITED_MODELS`) và không có
`BomRevision CREATE` cho id 1 — chỉ có id 2 lúc 08:52:20. Tức toàn bộ BOM rev 1 do script dựng,
không đi qua Prisma client có extension audit.

### 8.4 Lỗ hổng thật sự cần ghi nhận

1. **`bomOutOfDate` không thể phát hiện ca này.** Nó chỉ so **id**
   ([production-orders.service.ts:167](src/modules/production-orders/production-orders.service.ts:167)):
   id đã ghim = 1, bản ACTIVE = 1 → `false`. Nội dung đổi nhưng id không đổi nên cảnh báo dựng ở mục
   4 không bao giờ nổ. Cơ chế hiện tại chỉ bắt được ca "activate bản MỚI", không bắt được ca "sửa
   ruột bản CŨ".
2. **`PieceBom` không được audit** (cố ý, xem `audit-log.extension.ts:18-20`: dòng con của
   BomRevision đổi liên tục khi DRAFT). Lý do đó đúng **khi DRAFT**, nhưng khi đã ACTIVE thì dòng
   con lẽ ra bất biến — nên đây đúng là sự kiện đáng ghi nhất mà lại không để lại vết nào. Chính vì
   vậy không thể tái dựng chính xác ai/lúc nào đổi 6→60.
3. **Quy tắc DRAFT-only chỉ sống trong code service**, không có ràng buộc ở tầng DB. Script/SQL —
   đúng thứ đã dựng rev 1 — đi thẳng qua.

### 8.5 Hệ quả đã lan tới Mua hàng (đã kiểm chứng)

| Đề nghị mua | Nguồn | `buyQty` | Cây |
|---|---|---|---|
| #1 | proposal #2 (6mm) | **1** | 6000mm |
| #2 | proposal #4 (6mm) | **1** | 6000mm |
| #3 | proposal #6 (60mm) | 4 | 5000mm |

Cả 3 đã `PURCHASED`. Với định mức 60mm hiện tại, PO 1 lẽ ra cần ~7 cây → **thiếu 6 cây** nếu làm
thật. (Đây là DB dev, không có hậu quả thật, nhưng đường lan là thật.)

### 8.6 CHƯA làm (ĐÃ LÀM - xem mục 9)

Mới dừng ở điều tra, **chưa sửa gì**. Các hướng đã cân nhắc, chờ người dùng chọn:
- (a) `bomOutOfDate` so thêm **dấu vân nội dung** (hash các dòng `piece_bom`/`part_bom`) chứ không
  chỉ so id — bắt được cả ca sửa ruột.
- (b) Đưa `PieceBom`/`PartBom` vào `AUDITED_MODELS` **chỉ khi revision không còn DRAFT** (giữ nguyên
  lý do bỏ qua lúc DRAFT).
- (c) Ràng buộc tầng DB (trigger) chặn `UPDATE/DELETE` trên `piece_bom` khi revision cha không DRAFT.
- (d) Dọn dữ liệu dev: proposal #2/#4 và đề nghị mua #1/#2 đang mang số của định mức 6mm đã bỏ.

Không đề xuất tự đồng bộ lại `bomRevisionId` — đã loại ở mục 3 (phương án A) vì rủi ro đổi ngầm định
mức của lệnh đang chạy dở.

---

## 9. Vá lỗ hổng mục 8 — chốt DB + đường sửa chính thống (2026-09-21)

Người dùng yêu cầu làm theo hướng "chuẩn ERP": bản định mức đã phát hành là bất biến, muốn sửa thì
phát hành bản mới qua đường chính thống, không sửa thẳng ruột bản cũ. Ba việc, làm theo đúng thứ tự
phụ thuộc (dọn dữ liệu cần seed đã sửa; seed sửa cần trigger đã có; đường sửa chính thống chỉ có ý
nghĩa khi cửa sau đã khoá).

### 9.1 Việc 2 — Bất biến "chỉ DRAFT mới sửa được dòng con", đặt ở tầng DB

**Không làm theo (a)/(b) đã liệt kê ở mục 8.6.** Lý do loại (b) (đưa `PieceBom` vào audit khi
không DRAFT): rà lại thấy **không khả thi** — mọi đường ghi định mức thật
(`SkusService.replacePieces()`) dùng `deleteMany`+`createMany`, mà cả 2 đều KHÔNG được
`audit-log.extension.ts` tự động ghi (giới hạn đã ghi rõ trong chính file đó). Thêm `PieceBom` vào
`AUDITED_MODELS` sẽ cho ra **đúng 0 dòng audit** — không giải quyết gì. Chọn thẳng (c): chặn ở tầng
DB, chặt hơn ghi-lại-sau.

**Migration `20260921030000_bom_line_items_immutable_when_published`:**
- Hàm `assert_bom_revision_draft()` (PL/pgSQL, `BEFORE INSERT OR UPDATE OR DELETE`): đọc `status`
  của `bom_revision` cha qua `bomRevisionId` của dòng con, raise exception (`ERRCODE='IE001'`) nếu
  khác `DRAFT`.
- Gắn cho ĐỦ 8 bảng con có cột `bomRevisionId` (tra `information_schema.columns` xác nhận, không
  đoán): `bom_piece`, `bom_part`, `piece_bom`, `part_bom`, `piece_material_item`,
  `piece_material_yield`, `consumable_bom`, `bom_accessory_items`.
- Escape hatch: `SET LOCAL "dna.bom_maintenance" = 'on'` trong đúng 1 transaction (seed/khôi phục
  dữ liệu) — không rò sang connection khác.
- **Thực nghiệm xác nhận** (không đoán): một lệnh Prisma thường (không phải `$queryRaw`) khi trigger
  raise exception trả về `PrismaClientKnownRequestError` code `P2039`, mã Postgres gốc nằm ở
  `meta.driverAdapterError.cause.originalCode`.

**Migration `20260921023030_bom_revision_content_hash`:** thêm `BomRevision.contentHash String?`
(chưa dùng ở đợt này — chỗ để dành cho lớp phát hiện thứ 2 nếu sau này cần, xem doc comment field).

**`prisma/seed-cutting-fixture.ts`** (script duy nhất từng tạo `BomRevision` thẳng `ACTIVE`, đúng
kiểu trigger mới chặn): viết lại theo thứ tự ĐÚNG — mở `rawPrisma.$transaction`, `SET LOCAL` escape
hatch (hợp lệ vì đây chính là ca "seed/khôi phục dữ liệu"), toàn bộ upsert piece_bom/bom_piece chạy
trong đó. Tiện thể sửa luôn 1 bug có sẵn không liên quan (hard-code `KHSX_USER_ID` từ 1 lần seed DB
khác, không khớp DB hiện tại → 409 FK) thành tra theo `username: 'khsx'`.

**Test:** `test/integration/bom-revision-immutability.integration.spec.ts` (real Postgres, KHÔNG
mock Prisma — unit test mock sẽ luôn pass dù trigger có tồn tại hay không) — 5 case: chặn
INSERT/UPDATE/DELETE trên revision ACTIVE, vẫn sửa được khi DRAFT, escape hatch hoạt động và không
rò ra ngoài transaction của nó. Cả 5 pass.

### 9.2 Việc 1 — Dọn dữ liệu sai trên DB dev

**Đổi quyết định so với đề xuất ban đầu.** Dự định "reset toàn bộ + seed lại" hoá ra không khả thi:
rà lại thấy `seed-cutting-fixture.ts` (BAN-J55/GHE-J55 họ "sắt vuông 50×50") KHÔNG PHẢI nguồn tạo ra
`GHE-J55-GOPLUS` (sản phẩm thật duy nhất đang có dữ liệu workflow) — sản phẩm đó dựng qua đường
khác không để lại script tái tạo. Reset sạch sẽ xoá luôn toàn bộ dữ liệu test đa-module (SalesOrder,
PurchaseProposal, SteelIssue, QcReview, ProductionBatch...) không có gì dựng lại ngoài gõ tay qua
UI.

Chuyển sang: **dùng đúng nút "Tính lại" có sẵn** (`POST /production-orders/:id/cutting-proposals`,
role `qlsx`) để hệ thống tự tính lại phương án cắt theo định mức ĐÃ ĐÚNG (60mm) — tôn trọng đúng
nguyên tắc "không tự tay vá số, để hệ thống tự làm qua đường thật" mà mục 9.1 vừa dựng.
- **PO 1** (300 ghế): tính lại ra đúng **7 cây/8.617%** cho SAT-TRON-FI4 (khớp tay tính trước đó:
  600 đoạn×61mm=36600mm÷6000≈7 cây) — duyệt thành công (proposal mới #7, cũ #2 tự SUPERSEDED).
- **PO 2**: tính lại (#8) phát hiện **xung đột nghiệp vụ thật, KHÔNG tự ý xử lý**: chặn bởi luật có
  sẵn "không được mua 2 cỡ cây cho cùng 1 loại sắt trong 1 đợt sản xuất" — PO 3 (đã APPROVED trước
  đó, cũng tính lại với 60mm) chốt SAT-TRON-FI4 ở cây **5000mm** (`auto_scan`), PO 1 vừa duyệt lại
  chốt **6000mm** (`fixed`). Đây là quyết định nghiệp vụ (gộp đợt cắt hay chuẩn hoá 1 cỡ cây),
  không phải lỗi kỹ thuật — để nguyên #8 ở DRAFT, chưa duyệt, chờ KHSX/QLSX xử lý qua đúng luồng
  "Tối ưu cắt sắt".
- 2 chứng từ mua hàng cũ sai (`purchase_proposal_items` #1/#2, `buyQty=1` cho SAT-TRON-FI4, đã
  `PURCHASED`/`PURCHASING`) **giữ nguyên, không sửa lại** — cùng nguyên tắc "không rewrite chứng từ
  đã chốt" mà mục 9.1 vừa lắp cho định mức; coi là chênh lệch lịch sử đã biết, không phải nhu cầu
  mua đang mở (không có PO nào còn cần mua thêm TRON-FI4 lúc này).

### 9.3 Việc 3b — "Nạp lại định mức", đường sửa chính thống

**3a (phát hành bản định mức mới) đã có sẵn**, không cần code thêm:
`BomRevisionsService.activateInTransaction()` đã bắt buộc đi qua PlanForm → Sếp duyệt.

**3b (mới)**: `POST /production-orders/:id/resync-bom` (`ProductionOrdersService.resyncBom()`,
`@RequireRole(PRODUCTION_MANAGER)` — cùng quyền với floor-start/pause/finish trên chính resource
này). Đủ 4 điều kiện mới cho đổi, trượt cái nào báo đúng lý do đó:
1. `status = RELEASED`.
2. `floorStage = PENDING` — **cổng DUY NHẤT** cần kiểm cho "xưởng đã đụng vào lệnh chưa": đây là cờ
   kiểm soát hiển thị bên Phôi/Hàn/Sơn (3 xưởng đó KHÔNG THẤY được lệnh khi còn PENDING), nên không
   cần dò riêng SteelIssue/MaterialIssue/WeavingIssue/ProductionBatch — tất cả đều nằm SAU
   floor-start.
3. Không có `CuttingProposal` APPROVED neo vào lệnh (solo) hoặc PI chứa nó (gộp) — `PurchaseProposal`
   chỉ tạo SAU approve() nên điều kiện này tự bao luôn "chưa mua gì".
4. Sản phẩm có bản ACTIVE KHÁC bản đang ghim.

Ghi `AuditLog` thủ công (`ProductionOrder` không nằm trong `AUDITED_MODELS` — dòng nghiệp vụ đổi
liên tục theo vòng đời) — `oldValue`/`newValue.bomRevisionId` + `reason` (bắt buộc, trim trước khi
validate — đúng bài học `solverOverrideReason` 2026-09-14).

**FE**: `bomOutOfDate` (đã có ở `GET /production-orders`) nay thêm cả vào
`ProductionInvoiceItemResponseDto` (tái dùng `ProductionOrdersService.fetchActiveBomRevisionIds()`
đã hết `private`, tránh chép lại cùng 1 query ở 2 module) → `ThongKePagePlan.tsx`
(`FloorStageCell`): nút "Nạp lại định mức" (tím, cạnh Bắt đầu/Tạm dừng/Kết thúc) chỉ hiện khi
`bomOutOfDate=true` VÀ `floorStage=PENDING` (khớp đúng điều kiện 2 ở BE — hiện nút ở floorStage khác
chắc chắn sẽ 409). Bấm hỏi lý do qua `prompt()` (cùng mức nhẹ UI với các hành động khác ở bảng này,
không có modal riêng).

### 9.4 Kiểm tra

- BE: `npx tsc --noEmit` sạch; `npx eslint` sạch (2 dòng cần
  `eslint-disable-next-line no-unsafe-assignment` — cùng idiom đã dùng ở
  `purchase-proposals.service.spec.ts:1417` cho lỗi kiểu suy diễn qua `jest.Mock` lồng
  `expect.objectContaining`).
- `npx jest`: **1105/1105 pass** (thêm 7 test `resyncBom` + 2 test `bomOutOfDate` cho
  production-invoices, cộng 2 fixture có sẵn phải bổ sung `mfgProductId`/`bomRevisionId` để không
  crash ở field mới).
- `npm run test:integration`: **5/5 pass** (trigger, thật trên Postgres).
- **Live qua HTTP thật** (BE+FE chạy local): `POST /production-orders/2/resync-bom` với dữ liệu
  thật trả đúng 409 "đã có phương án cắt 4 được duyệt" (khớp DB); thiếu `reason` trả 400 đúng 2 lỗi
  validate; id không tồn tại trả 404. `GET /production-invoices` trả đúng `bomOutOfDate` cho cả 3
  PO của GHE-J55-GOPLUS (đều `false`, khớp thực tế chưa có bản định mức nào lệch).
- **Live qua FE thật** (`qlsx`, "Tổng hợp lệnh SX"): cột XƯỞNG render đúng 3 nút cũ, nút mới không
  hiện (đúng vì `bomOutOfDate` đều false lúc này) — chưa dựng được ca `true` thật (cần phát hành 1
  bản định mức mới qua UI, không nằm trong ca dữ liệu dev hiện có) nên chưa chụp được ảnh nút đang
  hiện; bù lại bằng 2 unit test `bomOutOfDate` (true/false) + toàn bộ nhánh `resyncBom` đã test qua
  Postgres thật ở tầng trigger.

### 9.5 CHƯA làm / còn treo

- PO 2 (proposal #8): xung đột cỡ cây với PO 3 chưa xử lý — cần KHSX/QLSX quyết định gộp đợt cắt
  hay chuẩn hoá 1 cỡ cây, qua đúng màn "Tối ưu cắt sắt".
- `BomRevision.contentHash`: cột đã thêm, CHƯA có code tính/dùng — dự phòng cho lớp phát hiện thứ 2
  nếu sau này cần (vd rà soát định kỳ phát hiện ai bypass trigger bằng `pg_restore
  --disable-triggers`).
- Chưa chụp ảnh thật nút "Nạp lại định mức" đang HIỆN (cần dựng 1 kịch bản BOM mới qua UI thật).
