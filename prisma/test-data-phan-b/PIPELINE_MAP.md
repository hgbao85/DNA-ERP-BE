# Bản đồ chuỗi xử lý (đã dò code 10/11/2026) — dùng chung cho các agent dựng dữ liệu thử PB

## Cách gọi service
- Script ts-node: `NestFactory.createApplicationContext(AppModule, { logger: ['error'] })`, `app.get(XService)`.
- Mọi lời gọi chạy trong `cls.run(() => { cls.set('userId', <id>); ... })` (lấy `ClsService` từ nestjs-cls). BookingsService.requireUserId và audit extension đọc cls userId.
- Guard vai trò chỉ ở controller: service chỉ kiểm tham số truyền vào (roles, mfgRole, warehouseScope). warehouseScope=null / mfgRole=null = quyền quản lý. roles có BOSS/ADMIN bỏ qua kiểm người mua.
- Route có `@CurrentUser('id')` -> tự truyền id user. Header Idempotency-Key -> tham số idempotencyKey.
- Cổng xưởng: xuất sắt, báo sản lượng, KCS, chuyền kiểm, đóng gói cần ít nhất 1 ProductionOrder của PI có floorStage=ACTIVE.
- Chạy: từ D:\DNA-ERP-BE: `NODE_PATH="D:/DNA-ERP-BE/node_modules" npx ts-node --transpile-only -P tsconfig.json <script>`; import service bằng đường dẫn tuyệt đối `D:/DNA-ERP-BE/src/...`; PrismaClient ở `src/generated/prisma/client`, PRISMA_SERVICE token ở `src/prisma/prisma.service`.
- KHÔNG chạy BE dev server (nest --watch) trong lúc này; KHÔNG tạo/xoá file .ts trong D:\DNA-ERP-BE\src khi dev server chạy.
- Lỗi BigInt khi JSON.stringify -> dùng replacer.

## Thứ tự
1. `SalesOrdersService.create(dto)` (sales-orders.service.ts:118): {orderCode, customerId, orderDate, items:[{mfgProductId, totalQty, deliveryDate, skuName?, wireMaterialId?, cushionMaterialId?}]}. Tạo ProductionInvoiceItem productionInvoiceId=null cho mỗi dòng. Có BomOption thì dòng phải chọn wire/cushion.
2. `CuttingProposalsService.requestForBatch({productionInvoiceItemIds}, actorUserId)` (cutting-proposals.service.ts:519) — solver HiGHS chạy NỀN trong BE process -> poll cuttingProposal.status tới DRAFT và hasInfeasibleLine=false. Cần BomRevision ACTIVE.
3. 1 SKU: `ProductionInvoicesService.claimSolo(itemId, {cuttingProposalId})` (:695). Gộp 2 SKU: requestForBatch trên 2 item rồi `mergeItems({productionInvoiceItemIds, cuttingProposalId}, actor)` (:545).
4. `updateItemLsx(piId, itemId, 'EE-123456', {id, roles})` (:1043) — tiền tố phải nằm trong SystemConfig.lsxPrefixes nếu danh sách khác rỗng.
5. `sendBatchToQlsx(piId, userId, itemIds?)` (:1736).
6. `sendBatchToBoss(piId, warehouseCode, warehouseName, workshopId, userId, itemIds?)` (:1810) — warehouseCode thanh-pham*, workshopId = id Workshop PHU_AN / PHUOC_AN.
7. Sếp duyệt: `approveItem(piId, itemId, bossUserId)` (:1890) cho PI 1 SKU; `approveBatch(piId, bossUserId)` (:2446) cho PI gộp. Tự gọi CuttingProposalsService.approve (giữ chỗ StockReservation + PurchaseProposal sắt) và computeNonSteelPurchaseProposals (PieceMaterialYield, PieceMaterialItem/ConsumableBom/BomAccessoryItem, MaterialYieldRecipe). Lỗi duyệt chỉ log -> kiểm proposal APPROVED.
8. Mua: `SupplierOrdersService.create({supplierId, itemIds}, actorUserId, actorRoles)` (supplier-orders.service.ts:96) -> `approve(id, approvalFileUrl, actor, roles)` (:271) -> dòng PURCHASING.
9. Nhận: `PurchaseReceiptsService.reserveSlipCode(userId)` (:401) -> `receive(dto, userId, idempotencyKey, warehouseScope)` (:92): {slipCode, itemIds, unitRateQty, deliveredQty, supplierSlipUrls[], receiptSlipUrls[], weighSlipUrls[] (sắt), allocation?, overReason?}.
10. `ProductionOrdersService.startFloor(productionOrderId)` (production-orders.service.ts:331).
11. (tuỳ) xuất sắt: SteelIssuesService.create/receive/recordCutBatch...
12. Báo sản lượng: `ProductionBatchesService.recordProductionBatch(poId, {pieceId, qty, stage:'PHOI'|'HAN'|'SON'}, reportedById, mfgRole|null, idemKey?)` (:260) -> `finishProductionBatch(batchId, reportedById, mfgRole, warehouseScope)` (:431) -> `QcReviewsService.reviewProductionBatch(batchId, {failedQty}, reviewedById)` (qc-reviews.service.ts:484) -> FRAME_OUTPUT vào kho công đoạn cuối (postPieceOutputIfFinal). PHOI cần needsHan=false hoặc PieceMaterialYield (và đã nhận material-yield issue). Mảnh VTTP: recordPieceStepBatch/submitPieceStep/reviewPieceStep.
13. Mảnh không đan sang kho TP: `WarehouseTransfersService.createPieceTransfer({fromWarehouseId, toWarehouseId (= warehouseCode của dòng lệnh), pieceItems:[{productionOrderId, pieceId, quantity}]}, warehouseScope, userId, idemKey?)` (:413) -> `confirm(id, {signedSlipUrls:[url], pieceItems?}, userId, warehouseScope)` (:711). Mảnh đan: WeavingReceipt (phiếu xuất đan + nhận đan).
14. Chuyền kiểm: `recordTransferCheck(piId, itemId, {pieceId, checkedQty}, userId)` (production-invoices.service.ts:2837) — checkedQty ≤ đã nhận − đã kiểm.
15. Đóng gói: `recordPackaging(piId, itemId, {boxesPacked}, userId)` (:3085).
16. Booking: trong cls có userId: `BookingsService.create({bookingNo, customerId, pod, warehouseCode:'thanh-pham', etd?, lines:[{productionInvoiceItemId, qty}]})` (bookings.service.ts:311); confirm(id) (:450) — để DRAFT nếu cần booking chưa xác nhận.

## Định mức
- Trigger bom_revision_draft_guard chặn sửa 8 bảng con khi revision không DRAFT: dựng dòng khi DRAFT rồi set ACTIVE cuối, hoặc `SET LOCAL "dna.bom_maintenance" = 'on'` trong cùng $transaction.
- Model: MfgProduct, BomRevision, Piece, BomPiece{qtyPerUnit, needsHan, needsSon, isWoven}, PieceBom{segmentSpecId, qtyPerPiece, processSteps}, SegmentSpec{materialId, cutLengthMm}, PieceMaterialItem (dây/đinh/nút/tán rút...), ConsumableBom{stage, materialId, qtyPerUnit}, BomAccessoryItem, PieceMaterialYield{pieceId, materialId, piecesPerBar, qtyPerPiece, processSteps}, MaterialYieldRecipe (output->input), BomOption (bỏ nếu không cần chọn màu).
- Mẫu tối giản: prisma/seed-e2e-golden-path-sku.ts; mẫu sắt nhiều mảnh: prisma/seed-ghe-j55-full-bom.ts.
- Tham khảo dây nối service thật: test/integration/reservation-own-pi.integration.spec.ts.

## Tài khoản demo (mật khẩu không cần, gọi service trực tiếp)
admin, boss, sales, khsx, qlsx, khopsh(phoi-son-han), khotp(thanh-pham), phoi, han, son, kcs; người mua: nhan (Nhàn), nghi (Nghi) — Material.buyerId đã gán 10/11; thủ kho thật: kieulinh (phoi-son-han + phoi-son-han-han-pa), hung (phoi-son-han-phoi-pha + phoi-son-han-han-pha), diem (phoi-son-han-son-pa + vat-tu-tp), quanh (vat-tu-tp), trinh (thanh-pham + thanh-pham-1788485485362), tuan (thanh-pham-1792489603061).
