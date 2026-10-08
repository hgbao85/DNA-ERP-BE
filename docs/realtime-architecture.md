# Realtime (Socket.IO) — kiến trúc, hợp đồng và cách thêm sự kiện

Viết cho: kỹ sư BE/FE làm việc trên ERP, cần thêm một sự kiện realtime mới hoặc debug việc không nhận được cập nhật.

## 0. Tình trạng hiện tại (2026-10-08)

**Tạm ổn, dùng được.** Không có gì vỡ nghiệp vụ; mọi test tự động xanh (BE 1436 test, FE 71 test, tsc/eslint 2 phía sạch). **13/15 entity đã test sống 2 trình duyệt, PASS tất cả** — chỉ còn `PURCHASE_PROPOSAL` (chặn hạ tầng) và `MATERIAL_YIELD_RECIPE` (chưa có sản phẩm demo phù hợp) chưa live-test được.

- **Đã test sống 2 trình duyệt (chắc chắn nhất):** `TwoTierScreen` (Hàn/Sơn/KCS), `PRODUCTION_ORDER` (QLSX/KHSX, `ThongKePagePlan.tsx`), và 4 entity rà thêm 07-08/10 — `SKU` (Danh sách SKU, `khsx`), `WAREHOUSE_TRANSFER` (Chuyển kho ngoài đơn hàng → Nhập nội bộ, `khovttp`/`khotp`, tạo thật qua UI + từ chối dọn sạch), `SALES_ORDER` (Quản lí đơn hàng, 2 phiên tài khoản `sales`), `STOCK` (Quản lý kho - Sửa nhanh tồn kho, `admin` sửa 60→61→60, `boss` xem không F5). Tất cả đều PASS — dữ liệu test tạo ra đã xoá/trả lại sạch ngay sau, không để lại vết. Dọc đường tìm ra và sửa 3 lỗi thật: 4 method `/qc-reviews` thiếu publish event; `onReload` thiếu `refetchPis()`; `WORK_QUEUE_TOPICS` thiếu 6/12 topic.
- **Dựng 2 lệnh sản xuất mới từ đầu (PI-2026-006/007, mfgProduct có sẵn BOM ACTIVE) + đi FULL pipeline thật tới tận Đóng gói - PASS thêm 7 entity, tất cả còn lại trừ PURCHASE_PROPOSAL:** `addItem` → `send-to-qlsx` → `send-to-boss` → `approve` (không cần qua SKU/quota Spec) → floor-start → cắt sắt (4 loại, cut-batches+finish+QC) → Hàn (ProductionBatch+QC, cả 5 mảnh) → Sơn (4 mảnh có needsSon) → chuyển mảnh nội bộ phôi-sơn-hàn→vật-tư-TP (`POST /warehouse-transfers/piece-transfer` + confirm, mảnh có đan VÀ mảnh không đan đều cần, nguồn khác nhau cho `sumReceivedForPiece`) → Đan (xuất+nhận, 4 mảnh isWoven) → Chuyền kiểm (`transfer-check`, tất cả 5 mảnh, mốc chặn thật là MIN theo TỪNG mảnh) → Đóng gói. Mỗi bước chỉ cần SỐ LƯỢNG NHỎ (2 đơn vị, không cần đủ 80) vì các entity test không đòi hết cả lô.
  - **PRODUCTION_INVOICE, CUTTING_PROPOSAL, STEEL_ISSUE, MATERIAL_ISSUE, MATERIAL_YIELD_ISSUE**: PASS (xem chi tiết đợt trước - không đổi).
  - **WEAVING_ISSUE - GAP THẬT ĐÃ SỬA, round-trip PASS đầy đủ sau khi đi hết chuỗi:** rà soát phát hiện BE bắn event đúng nhưng **0 màn FE nào từng lắng topic `weaving-issues`** trước khi sửa. ĐÃ SỬA: thêm topic + `refetch()` vào `onReload` ở `KhoXuatDanPage.tsx`/`KhoNhapDanPage.tsx` (cùng bug `refetchPis()` y hệt trước đó). Sau khi mảnh qua Hàn→Sơn→piece-transfer CONFIRMED, xuất đan (`khovttp`, màn "Theo dõi xuất đan") VÀ nhận đan (`khotp`, màn "Theo dõi nhập đan") đều tự hiện banner không F5. PASS đầy đủ cả 2 chiều.
  - **PACKAGING_ISSUE - PASS sau khi đi hết Chuyền kiểm:** gate thật là MIN(checkedQty/qtyPerUnit) theo TỪNG mảnh trong BOM (không phải tổng) - phải Chuyền kiểm đủ cả 5 mảnh (kể cả mảnh không đan, đọc từ `warehouseTransferPieceItem` CONFIRMED khác nguồn với mảnh có đan). Vướng thêm 1 chỗ: vật tư đóng gói (Bì zipper) có `Material.warehouseId` TRÙNG đúng `productionInvoiceItem.warehouseCode` đã chọn lúc `send-to-boss` (cả 2 đều "thanh-pham") → lỗi "fromWarehouseId và toWarehouseId không được trùng nhau" - phải tạm đổi `Material.warehouseId` sang kho thành phẩm 2 (đã đổi lại sau khi test xong) để tránh trùng. Màn "Xuất theo đơn hàng" (`WarehouseXuatPage.tsx`, đã nối đúng từ trước) tự xoá dòng "chờ xử lý" không F5 khi xuất đủ. PASS.
- **Chủ ý KHÔNG thử:** `PURCHASE_PROPOSAL` (đã bị chặn hẳn ở hạ tầng từ lượt trước).
- **Chưa live-test, lý do khác:** `MATERIAL_YIELD_RECIPE` (màn lắng duy nhất chỉ liệt kê PI CÒN THIẾU chân nhôm; không đáng dựng thêm 1 lệnh riêng).
- **Dữ liệu test còn lại trên DB dev (chủ ý giữ, không xoá):** PI-2026-006 (PO "NB-19", 2 CuttingProposal infeasible) + 2 item REJECTED mồ côi; PI-2026-007 (PO "NB-22", ACTIVE, đã đi hết pipeline tới Đóng gói cho 2/80 đơn vị - 4 SteelIssue, nhiều ProductionBatch HAN/SON, 4 WeavingIssue+Receipt, 2 phiếu chuyển kho nội bộ CONFIRMED, 5 TransferCheckResult, 1 PackagingIssue) + vật tư cấp tạm qua STOCK adjust (sắt, Sơn bột, Tấm sắt la, Bì zipper). 1 file test còn sót trên Cloudinary (không gắn bản ghi nào).
- **Đã nối đúng kỹ thuật, có test tự động, nhưng CHƯA live-test 2 trình duyệt:** 1 chỗ vừa vá ngày 07/10 (`products.controller.ts`).
- **Chủ ý KHÔNG nối** (không phải thiếu sót): 15 module master-data admin (customers, materials, suppliers, warehouses, segment-specs, material-groups, defect-reasons, weaving-points, office-supplies, system-config, users, roles, uploads, auth) + `bom-revisions` — đổi hiếm, không ai lắng.
- **Chưa làm:** chưa smoke-test trên production thật (Render/Vercel) — mới chạy trên máy dev.
- **Quan sát phụ, không phải lỗi:** 1 phiên trình duyệt mở lâu từng không nhận event (nghi do HMR/"Slow filesystem" của dev server) — không tái hiện được, không ảnh hưởng production.

## 1. Nguyên tắc

- **Push tín hiệu, không push dữ liệu.** Event chỉ chứa ID, `action`, `topics`. FE nhận tín hiệu rồi **refetch qua REST**. REST là nơi duy nhất áp phân quyền và warehouse scope, nên socket không bao giờ là đường lộ dữ liệu.
- **Chỉ phát sau commit.** `RealtimeService.publish*` được gọi sau `await prisma.$transaction(...)` (hoặc sau ghi đơn lẻ). Transaction rollback thì không có event.
- **Realtime là phần phụ.** Lỗi phát event được log kèm correlationId, không bao giờ ném ra ngoài làm hỏng request đã commit.
- **Một kết nối duy nhất mỗi trình duyệt** (`realtime` singleton ở FE). Component không tự gọi `io()`.

## 2. Kiến trúc

```
User action → REST controller → Service → $transaction (commit)
                                               │
                              after commit ────┘
                                               ▼
                 RealtimeService.publishEntityChanged / publishNotificationCreated
                                               ▼
                 RealtimeGateway (Socket.IO, cùng cổng HTTP, path /socket.io)
                   rooms: user:<id>  |  perm:<MODULE>:VIEW
                                               ▼
   FE realtime (singleton) → eventBus (khử trùng eventId) → hooks
     useRealtimeRefetch(topics, refetch)  → refetch REST (debounce 400ms)
     useRealtimeEvent(name, handler)      → toast / badge
     resync khi kết nối lại               → refetch toàn bộ topic đang nghe
```

Thông báo (`NotificationsService.emit`) luôn chạy ngoài transaction nên phát ngay sau khi `create`/`update` xong. Không có caller nào truyền `tx` vào `emit`; nếu sau này có, caller phải tự phát sau commit (xem chú thích trong code).

## 3. Xác thực và phân quyền

- Handshake: `auth: { token, correlationId }`. Token không có, sai chữ ký, hoặc hết hạn → `connect_error: UNAUTHORIZED`. Không có cookie/query để tránh lộ token trong URL.
- Room do **server** tự join theo `permissions` trong JWT. Client không có API chọn room.
- Chỉ quyền `VIEW` mở kênh realtime. Quyền `CREATE`/`APPROVE` không nghe event.
- Token hết hạn → server ngắt socket (`io server disconnect`), FE refresh rồi kết nối lại. Phù hợp với REST: guard cũng chỉ tin token đến khi `exp`.
- Quyền thay đổi giữa phiên chỉ có hiệu lực sau khi token mới được cấp, giống REST.

## 4. Hợp đồng event

Nguồn sự thật: `src/realtime/realtime.contract.ts` (BE). Bản sao FE: `src/realtime/contract.ts`. Khi đổi một bên, đổi cả hai.

| Event | Room | Khi nào | Payload chính |
|---|---|---|---|
| `notification.created` | `user:<id>` | Thông báo mới hoặc thông báo được gộp (dedupe) | `notificationId, type, category, severity, title, message, link, merged, createdAt` |
| `entity.changed` | `perm:<MODULE>:VIEW` của các module trong route | Entity nghiệp vụ đổi trạng thái | `entity, entityId, action, topics` |

Envelope chung: `{ eventId, name, occurredAt, correlationId, payload }`. `eventId` là UUID để FE khử trùng.

Entity đã nối (`REALTIME_ENTITY_ROUTES`):

| Entity | Action đã phát | Module nhận | Topic FE |
|---|---|---|---|
| `WAREHOUSE_TRANSFER` | CREATED, CONFIRMED, REJECTED | WAREHOUSE_TRANSFER, STOCK | warehouse-transfers, stock |
| `PURCHASE_PROPOSAL` | APPROVED (Sếp duyệt), RECEIVED (thủ kho nhận) | PURCHASE_PROPOSAL | purchase-proposals |
| `STEEL_ISSUE` | CREATED (xuất sắt), RECEIVED (Phôi nhận) | STEEL_ISSUE, STOCK | steel-issues, stock |
| `PRODUCTION_BATCH` | CREATED, FINISHED | PRODUCTION_BATCH | production-batches |
| `QC_REVIEW` | QC_RECORDED (duyệt lô/đợt cắt/bước/mảnh/vật tư thành phẩm - mọi endpoint ghi của `/qc-reviews`) | QC_REVIEW | qc-reviews, production-batches |
| `MATERIAL_ISSUE` | CREATED (xuất cho Hàn/Sơn), RECEIVED | MATERIAL_ISSUE, STOCK | material-issues, stock |
| `PACKAGING_ISSUE` | CREATED (xuất đóng gói) | PACKAGING_ISSUE, STOCK | packaging-issues, stock |
| `MATERIAL_YIELD_ISSUE` | CREATED, RECEIVED (vật tư thành phẩm) | MATERIAL_YIELD_ISSUE, STOCK | material-yield-issues, stock |
| `WEAVING_ISSUE` | CREATED (xuất đan), RECEIVED (nhập đan) | WEAVING_ISSUE, STOCK | weaving-issues, stock |
| `STOCK` | ADJUSTED (điều chỉnh tồn kho thủ công) | STOCK | stock |
| `PRODUCTION_INVOICE` | APPROVED, REJECTED (Sếp / QLSX duyệt hoặc từ chối PI) | PRODUCTION_INVOICE | production-invoices |
| `CUTTING_PROPOSAL` | FINISHED (solver đã lưu kết quả, thành công hoặc lỗi) | CUTTING_PROPOSAL | cutting-proposals, production-invoices |
| `SALES_ORDER` | CREATED, UPDATED (sửa đơn / thêm-sửa dòng), DELETED, SHIPPED (xuất dòng) | SALES_ORDER | sales-orders |
| `MATERIAL_YIELD_RECIPE` | CREATED, UPDATED, DELETED (CRUD định mức) | MATERIAL_YIELD_RECIPE | material-yield-recipes |
| `PRODUCTION_ORDER` | UPDATED (floor-start/pause/finish, resync-bom) | PRODUCTION_ORDER | production-orders |
| `SKU` | CREATED, UPDATED (sửa, định mức), APPROVED, REJECTED, DELETED (mọi endpoint ghi của `/skus`; từ 2026-10-07 gắn thêm cho `/products` - xem mục "Đã làm tiếp") | SKU | skus |

Màn hình đã nghe (FE): trang Tồn kho Mfg và Kho Phôi (`stock`), Xác nhận vật tư (`material-issues`), Nhận sắt Phôi (`steel-issues`, `material-yield-issues`), KCS Phôi/Công đoạn (`qc-reviews`, `production-batches`), Đan/Sơn/Hàn (`production-batches`), Lệnh SX (`production-invoices`, `cutting-proposals`), Quản lý đề xuất cắt (`cutting-proposals`), danh sách PI admin (`production-invoices`), Theo dõi xuất đan/nhập đan (`weaving-issues`, thêm 2026-10-08 - trước đó BE bắn event nhưng chưa màn nào nghe). Màn Danh sách SKU và Duyệt SKU làm mới trực tiếp; màn Định mức mảnh (SPEC_STEEL) chỉ báo để không mất dữ liệu nhập. Form đang nhập không bị refetch tự động: trang Xuất sắt hiện thanh "Dữ liệu vừa được cập nhật" (`RealtimeUpdateNotice`), người dùng bấm để tải lại.

Cùng thêm (2026-10-07, rà soát toàn bộ `useFetch` còn lại): Danh sách/Duyệt SKU, Định mức mảnh/chi tiết (SPEC_STEEL + SPEC_ACCESSORY, `skus`), Chuyền kiểm/Đóng gói/Nhập-xuất đan/Xuất vật tư Phôi (`skus`), màn Hàn/Sơn/KCS dùng chung `TwoTierScreen` (`production-batches` + `qc-reviews`), Lệnh SX Phôi/Chân nhôm/Vật tư thành phẩm (`steel-issues` + `qc-reviews`), Gán SKU đợt cắt - Admin (`steel-issues`), KCS Chân nhôm/ảnh đính kèm Admin (`qc-reviews`), Quản lý/Lịch sử khách hàng (`sales-orders`), Hướng dẫn cắt/Tổng hợp PI Phôi - Admin (`steel-issues`, `production-invoices`). Đợt này cũng vá 4 method `/qc-reviews` trước đó KHÔNG phát event (`reviewCutBundle`, `reviewStepBundle`, `reviewPieceStep`, `reviewMaterialYieldStep`) - lỗi thật ở BE, không chỉ thiếu nối FE.

**Đã làm tiếp (2026-10-07, cùng ngày):**
- Viết 5 test tự động cho `reviewMaterialYieldStep` (trước đó chưa có test nào).
- Nối `MATERIAL_YIELD_RECIPE` (CRUD định mức, entity mới) và 2 controller liên quan tái dùng entity có sẵn: `material-yield-recipe-issues.controller.ts` dùng chung `MATERIAL_YIELD_ISSUE`, `material-yield-recipe-production.controller.ts` dùng chung `PRODUCTION_BATCH` (cả hai đã tự nhận trong comment code là "cùng nghiệp vụ" với 2 module quyền đó).
- **Test UI thật với 2 trình duyệt** (`han` và `kcs`, dữ liệu PI "E2E" - fixture test có sẵn): `han` báo sản lượng -> màn KCS tự hiện lô chờ duyệt KHÔNG CẦN F5; KCS duyệt -> màn `han` (đang mở, không F5) tự hiện thanh "Dữ liệu vừa được cập nhật", bấm Tải lại thì đúng dữ liệu mới (Đã duyệt: 1). Xác nhận `TwoTierScreen` hoạt động đúng ở cả 3 tầng (danh sách PI -> SKU -> dòng mảnh), 0 lỗi console trong suốt quá trình.
- **Rà soát toàn diện lần 2** (liệt kê MỌI controller BE có endpoint ghi, đối chiếu xem đã gắn realtime chưa): phát hiện `PRODUCTION_ORDER` (floor-start/pause/finish, resync-bom) - cổng gác trung tâm của QLSX, nhiều vai Hàn/Sơn/Phôi/KCS đều có quyền VIEW. Màn duy nhất hiển thị/thao tác (`ThongKePagePlan.tsx`, dùng chung bởi QLSX và KHSX) đã gắn thêm topic `production-orders`.
- Các module còn lại chưa gắn (customers, materials, suppliers, warehouses, segment-specs, material-groups, defect-reasons, weaving-points, office-supplies, system-config, users, roles, uploads, auth) là master-data admin thuần, đổi hiếm, ít cộng tác đồng thời - CHỦ Ý không nối, đúng nguyên tắc "không biến mọi API thành realtime". `bom-revisions` có API ghi nhưng không có trang FE nào hiển thị trực tiếp (quản lý qua luồng tạo SKU) nên nối sẽ không ai lắng nghe - cũng chủ ý bỏ qua.
- **Test UI thật cho `PRODUCTION_ORDER`** (`qlsx` bấm Bắt đầu/Tạm dừng, `khsx` xem cùng màn `ThongKePagePlan.tsx` qua module `production_plan`): phát hiện 1 lỗi thật - nút "Tải lại" trên banner chỉ gọi `refetchSkus()`, không gọi `refetchPis()` (fetch riêng giữ floor-stage hiển thị ở danh sách PI) - banner hiện đúng nhưng bấm Tải lại vẫn hiện dữ liệu cũ. ĐÃ SỬA: thêm `refetchPis()` vào `onReload`. Xác nhận lại bằng socket thô (bỏ qua trình duyệt) để tách lỗi FE khỏi BE trước khi tìm ra nguyên nhân thật.
- **Quan sát phụ (môi trường dev, không phải lỗi code):** một phiên trình duyệt mở lâu (nhiều phút) từng không nhận được event dù socket vẫn "kết nối", trong khi socket mới (sau F5) nhận đúng ngay. Trùng thời điểm dev server FE tự build lại nhiều lần không rõ lý do (có thể do cảnh báo "Slow filesystem" trên ổ dev đã thấy từ đầu). Không tái hiện được sau khi loại trừ bằng test có kiểm soát; không ảnh hưởng production (Next dev/HMR không chạy ở production).
- **Rà soát tiếp 2026-10-07 - badge "việc chờ tôi" (`useWorkQueue.ts`) thiếu quá nửa topic:** `WORK_QUEUE_TOPICS` chỉ có 6/12 topic thật sự ảnh hưởng tới các counter của `WorkQueueService` - thiếu `skus` (bossSkuApproval/khsxSkuReview/specSteelQuota/specDetailQuota, ghi qua skus.controller.ts), `production-invoices`/`cutting-proposals` (qlsxProductionQueue/bossProductionApproval/khsxProductionRejected), và `sales-orders`/`packaging-issues`/`production-orders` (salesReadyToShip - phụ thuộc cả 3). KHÔNG làm badge sai (polling 30-120s vẫn bắt kịp), chỉ chậm cập nhật - cùng loại lỗi với bug refetchPis() ở trên (tín hiệu tới nhưng thiếu, không phải tín hiệu sai). ĐÃ SỬA: thêm đủ 6 topic còn thiếu.
- **Rà soát tiếp 2026-10-07 - `products.controller.ts` (POST /products) chưa từng nối realtime:** FE gọi đường này (qua `products-api.ts::resolveMfgProduct`) để tự tạo MfgProduct mới khi Sales tạo đơn hàng tham chiếu SKU chưa tồn tại - CÙNG bảng MfgProduct mà SKUListPage.tsx đọc và chỉ lắng topic `skus`, nhưng ghi qua controller khác (PERMISSION_MODULES.PRODUCT, không phải SKU) nên trước giờ không đẩy `skus`. Người xem danh sách SKU không tự thấy SKU vừa phát sinh từ đơn hàng mới tạo. ĐÃ SỬA: gắn `@RealtimeEntityOn('SKU')` cho cả controller (4 route lồng variants/pieces/parts không FE nào gọi tới - xem products-api.ts - nên chỉ thừa emit vô hại).
- **Test UI thật 3 entity còn lại (07/10, cùng ngày):** theo yêu cầu "bấm thử tận mắt" thay vì chỉ tin test tự động.
  - **SKU** (Danh sách SKU, `khsx`): tạo 1 PlanForm tạm qua API (admin) trong lúc `khsx` đang mở màn - danh sách tự tăng 23→24 KHÔNG F5; xoá lại - tự giảm về 23. PASS.
  - **WAREHOUSE_TRANSFER** (Chuyển kho ngoài đơn hàng → Nhập nội bộ): `khovttp` tạo phiếu CK-2026-014 (vat-tu-tp→thanh-pham) bằng click UI thật (không qua API) - màn "Nhập nội bộ" của `khotp` (đang mở, không F5) tự hiện phiếu ngay; `khotp` bấm "Từ chối" (tồn kho không đổi, xác nhận lại qua DB) để dọn sạch. PASS.
  - **SALES_ORDER** (Quản lí đơn hàng): 2 phiên cùng tài khoản `sales` (khác tab/kết nối socket). Phiên A tạo PO "QA-REALTIME-TEST-001" bằng click UI thật (chọn khách GOPLUS + SKU có sẵn, không tạo SKU mới) - phiên B (không F5) tự hiện ngay 3→4 PO; xoá lại qua UI - cả 2 phiên về lại 3 PO. PASS.
  - **PURCHASE_PROPOSAL - CHỦ Ý BỎ QUA:** 2 hành động duy nhất bắn event (`boss-approve`, `receiveItem`) đều đẩy đề xuất đi KHÔNG THỂ LÙI LẠI (NEW→PURCHASING→PURCHASED, không có reject), và DB dev đang có 2 đề xuất thật (status NEW, proposalId 9) - không tạo fixture riêng (tốn công + rủi ro như đợt dọn E2E vừa rồi) cũng không động vào đề xuất thật. User xác nhận bỏ qua, chỉ dừng ở code-review + test tự động (giống các entity khác chưa live-test).
- **Test tiếp 2026-10-08 (dev server đã tắt qua đêm, khởi động lại BE+FE trước khi test):**
  - **STOCK** (Quản lý kho → Sửa nhanh tồn kho): `admin` sửa tồn Đinh F 10 đen tại Kho Vật tư thành phẩm 60→61 ngay trên bảng (click span "Bấm để sửa" → nhập số → modal xin lý do → Xác nhận) - `boss` (đang mở cùng màn qua `Tổng hợp kho`, không F5) tự hiện 61 ngay. Trả lại 60 - `boss` tự hiện lại 60. PASS.
  - **MATERIAL_YIELD_RECIPE / CUTTING_PROPOSAL / 5 entity Issue (steel/material/material-yield/packaging/weaving) / PRODUCTION_INVOICE - dừng, không ép live-test:** rà kỹ `create()` của cả 5 module Issue xác nhận KHÔNG CÓ endpoint cancel/reverse nào (grep "cancel|huỷ|đảo|reverse" ra 0 kết quả cả 5 file) - cùng mức rủi ro PURCHASE_PROPOSAL (ghi StockLedger thật ngay khi tạo). PRODUCTION_INVOICE (duyệt/từ chối PI) là quyết định kinh doanh thật trên dữ liệu thật, không phải chỗ AI tự quyết. CUTTING_PROPOSAL cần chạy solver thật (thiết lập quá nặng). MATERIAL_YIELD_RECIPE màn lắng duy nhất (`LenhSanXuatPhoi.tsx`) chỉ hiện banner khi Phôi đang mở đúng 1 PI đã qua "Nhận sắt" - không có đường tắt tới đúng màn. Tất cả dừng ở code-review + test tự động (đã xác nhận đủ qua kiến trúc giống các entity đã test sống khác).

Thông báo nghiệp vụ (mọi `NOTIFICATION_TYPES`) đi qua `notification.created` tự động, không cần làm gì thêm.

## 5. Cách thêm một entity mới

1. Thêm entity vào `RealtimeEntity` và một dòng vào `REALTIME_ENTITY_ROUTES` (BE contract), đồng thời cập nhật bản sao FE.
   Với controller có nhiều endpoint ghi, không cần gọi publish từng method: gắn `@RealtimeEntityOn('X')` và `@UseInterceptors(RealtimeMutationInterceptor)` lên controller. Interceptor phát sau mỗi request ghi thành công (action suy ra từ method và URL). Controller SKU đang dùng cách này.
2. Trong service, **sau khi transaction commit** gọi:
   ```ts
   this.realtime.publishEntityChanged({ entity: 'X', entityId: row.id, action: 'CONFIRMED', actorId: userId });
   ```
   Đặt SAU `await this.prisma.$transaction(...)`, không đặt bên trong callback.
   Bỏ qua các nhánh idempotent replay (không ghi thêm gì thì không phát).
3. Ở FE, màn hình nghe topic tương ứng:
   ```ts
   useRealtimeRefetch(['x-topic'], refetch);
   ```
   Với danh sách dùng `AdminReadOnlyList`, khai `realtimeTopics: ['x-topic']` trong config.

## 6. Mất kết nối và fallback

- Khi `realtime` không ở trạng thái `connected`, các hook thông báo và work queue quay về polling 30 giây (hiện là 120 giây khi đang kết nối). Các hook này chỉ gọi API khi đã có token, nên trên trang đăng nhập không có request nào tới `/me/work-queue` hay `/notifications/unread-count`.
- Kết nối lại (sau lần connect đầu tiên) phát `resync` → mọi `useRealtimeRefetch` refetch. Event phát trong lúc mất mạng không được replay, nên dữ liệu thật luôn lấy từ REST.
- **Khi đang connected:** mỗi 5 phút màn hình đang nghe tự refetch một lần (`safetyTick`), để bắt các event có thể bị lỡ mà không mất kết nối (vd Redis lỗi tạm). Tín hiệu này không bật banner "đã cập nhật".
- Refresh token bị 401 → dừng realtime; luồng REST/AuthContext đăng xuất như cũ.
- Lỗi mạng khi refresh → thử lại sau 5 giây.

## 7. Giới hạn đã biết

- **Nhiều instance cần `REDIS_URL`.** Mặc định Socket.IO lưu room trong bộ nhớ một tiến trình. Đặt `REDIS_URL` để bật `@socket.io/redis-adapter`: event lan truyền giữa các instance. Đã kiểm chứng với Redis 7 thật (`realtime-io.redis.integration.spec.ts`, chạy khi có `REDIS_TEST_URL`); đối chứng với Redis không tồn tại thì event không tới.
- **Không lọc theo warehouse scope ở socket.** Người xem kho A có thể nhận tín hiệu "kho B có phiếu đổi" (chỉ có ID và topic). Chấp nhận có chủ đích: payload không chứa dữ liệu nghiệp vụ, REST vẫn chặn đúng scope khi refetch. Nếu cần lọc tín hiệu, phải đưa warehouse vào payload và lọc ở gateway.
- **`actorId` không còn được phát** (chỉ ghi log server). Payload `entity.changed` chỉ có entity, entityId, action, topics.
- **Token và socket:** socket sống tới khi access token hết hạn (tối đa 15 phút) rồi buộc phải xác thực lại. Đăng xuất ở FE dừng realtime ngay.
- **Đồng bộ giữa các tab/thiết bị** (`notification.changed`): đã đọc, đọc tất cả, lưu trữ và đóng thông báo (`resolve`, khi không nằm trong transaction) đều được đẩy tới room `user:<id>`.
- Form đang nhập không bị refetch tự động (ví dụ form chuyển kho không nghe topic `stock` để tránh đổi danh sách vật tư đang chọn). Tồn kho trên form được BE kiểm lại khi xác nhận.

## 8. Test thủ công giữa nhiều client

1. Mở 2 trình duyệt, đăng nhập 2 tài khoản khác quyền: A là thủ kho kho đích, B là người tạo phiếu chuyển kho.
2. Ở A, mở `Chuyển kho → Nhận`. Ở B, tạo phiếu mới tới kho của A. Trong vài giây danh sách chờ ở A tự xuất hiện và chuông thông báo tăng số, không cần F5.
3. Ở A, xác nhận phiếu. Ở B, màn danh sách chuyển kho tự cập nhật trạng thái.
4. Tắt mạng máy A vài giây rồi bật lại. Dữ liệu phải tự làm mới (resync). Khi tắt hẳn server, trạng thái phải chuyển sang `disconnected` và polling dự phòng vẫn chạy.
5. Kiểm tra log BE: mỗi event có `eventId` và `correlationId` trùng với header `x-correlation-id` của request REST gốc.

Kiểm tra tự động:

```bash
cd D:/DNA-ERP-BE && pnpm exec jest src/realtime src/modules/notifications
cd D:/DNA-ERP && npx vitest run src/realtime
```

## 9. Các file chính

BE: `src/realtime/` (`realtime.contract.ts`, `realtime.gateway.ts`, `realtime.service.ts`, `realtime.module.ts`, `realtime-io.adapter.ts`, spec), `src/main.ts` (adapter CORS), `src/app.module.ts`, `src/modules/notifications/notifications.service.ts`, các service warehouse-transfers, purchase-proposals, steel-issues, production-batches, qc-reviews.

FE: `src/realtime/` (`contract.ts`, `eventBus.ts`, `realtimeClient.ts`, `hooks.ts`, `RealtimeProvider.tsx`, `eventBus.test.ts`), `src/app/layout.tsx`, `src/services/core/http.ts` (`refreshSession`), `src/hooks/useNotifications.ts`, `src/hooks/useWorkQueue.ts`, `src/context/InspectionContext.tsx`, `src/modules/pages/InboundWarehouse/*`, `src/modules/pages/Admin/shared/AdminReadOnlyList.tsx`, `src/modules/pages/Admin/businessData/WarehouseTransfersPage.tsx`.

## 10. Triển khai production

Không cần migration DB: realtime không đổi schema. Trước khi đưa lên production:

- **BE (Render):** `CORS_ORIGIN` phải chứa đúng domain FE (socket dùng chung danh sách này). `JWT_ACCESS_SECRET` là giá trị thật. `REDIS_URL` để trống khi chạy một instance; đặt khi chạy nhiều instance hoặc deploy không gián đoạn (xem `render.yaml`).
- **FE (Vercel):** `NEXT_PUBLIC_API_BASE_URL` trỏ tới BE. Socket tự suy ra origin từ biến này. Chỉ đặt `NEXT_PUBLIC_REALTIME_URL` khi socket đi qua host khác REST. Biến `NEXT_PUBLIC_*` được nhúng lúc build, đổi xong phải deploy lại.
- **Gói Free (Render):** service ngủ khi không có truy cập, socket bị ngắt; FE tự kết nối lại, nhưng lần đánh thức đầu có thể mất vài chục giây. Trong lúc đó FE dùng polling dự phòng.
- **Deploy chồng instance:** khi instance cũ và mới chạy song song, event không tới được client nối vào instance kia (nếu chưa có `REDIS_URL`). Client resync khi kết nối lại.
- **Log:** mỗi event ghi ở mức `debug`; production dùng `LOG_LEVEL=info` không bị đầy log.
- **Chưa kiểm chứng trên production:** WebSocket qua proxy của Render và tải nhiều socket đồng thời. Socket không chịu rate limit như HTTP; cần thêm giới hạn nếu mở public.

Smoke test sau deploy: mở FE production, đăng nhập; trong DevTools → Network lọc WS thấy kết nối tới `dna-erp-be.onrender.com/socket.io` ở trạng thái 101. Mở hai phiên khác tài khoản, thao tác một phiếu chuyển kho, xem phiên còn lại có tự cập nhật không.
