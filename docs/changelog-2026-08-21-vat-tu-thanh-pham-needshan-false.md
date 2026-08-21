# Changelog 2026-08-21 — "Vật tư thành phẩm" (needsHan=false) không còn kẹt ở Phôi-Sơn-Hàn

> Tiếp nối `changelog-2026-08-18-xuat-sat-po-pi-vat-tu.md` mục 2.2 và memory
> `project_steel_issue_pi_redesign_paused.md` — cả 2 đều giả định (xác nhận với user lúc đó,
> 2026-08-19) **"mọi mảnh đều needsHan=true, không có vật tư thành phẩm nào tồn tại thật"**.
> Giả định này SAI, đã xác nhận lại với user ngày 2026-08-21: có ít nhất 1 loại vật tư thành phẩm
> thật — **chân nhôm** (mua thanh nhôm dài về, cắt ra là xong, không qua công đoạn Hàn).

## Vấn đề trước khi sửa

Từ redesign "Xuất sắt theo PI" (2026-08-19, `SteelIssue` bỏ `pieceId`), hệ thống mất khả năng đếm
"đã cắt xong bao nhiêu mảnh needsHan=false cụ thể" — vì nhiều mảnh có thể dùng chung 1
`segmentSpecId`/`materialId` trong cùng PI, không suy ngược được đoạn nào của mảnh nào. Fix Critical
C2 (2026-08-20, xem audit `docs/audit-2026-08-20-full-system-bug-audit.html`) chỉ ngăn 1 piece
needsHan=false làm sập cả response `getPieceTransferPlan()` (đổi `throw` thành `continue`) —
**không khôi phục chức năng**: piece needsHan=false hoàn toàn không có cách nào chuyển kho ra khỏi
"phoi-son-han", dù đã cắt xong và KCS duyệt đạt ở tầng `SteelIssue`.

## Hướng đã chọn: Phôi tự báo sản lượng, không khôi phục `pieceId` trên `SteelIssue`

User chốt: **Phôi tự báo số lượng cắt được cho từng piece needsHan=false, giống hệt cách Hàn/Sơn
báo sản lượng** (qua `ProductionBatch`) — thay vì đảo ngược redesign gộp-PI (rủi ro cao hơn nhiều,
đụng cả chuỗi Xuất→Nhận→Báo cắt→KCS→Cấp bù như đã phân tích ở changelog 2026-08-18 mục 2.2).

`MfgStage.PHOI` đã tồn tại sẵn trong enum (schema.prisma) nhưng trước đây bị
`ProductionBatchesService.assertConsumableStage()` chặn cứng chỉ nhận HAN/SON. Mở khoá đúng stage
này làm nguồn "sẵn sàng" thứ 3 — không đổi schema, không cần migration.

## Đã sửa

| File | Thay đổi |
|---|---|
| BE `production-batches/production-batches.service.ts` | `assertConsumableStage()` cho phép thêm `PHOI`; `stageNeedsFilter()` thêm nhánh `PHOI → {needsHan: false}`; `assertPieceInBom()` tính `needsStage` theo 3 nhánh; `assertMfgRoleMatchesStage()` thêm nhánh `PHOI → MfgRole.PHOI`. `create()`/`getBatchPlan()`/`postSegmentConsumeEntries()` không đổi — đã tổng quát theo `stage` tham số |
| BE `production-batches/production-batches.controller.ts` | `@RequireMfgRole` route `POST .../production-batches` thêm `MfgRole.PHOI` |
| BE `common/constants/role-permissions.constant.ts` | `PHOI_STAFF` thêm `PRODUCTION_BATCH:CREATE+VIEW` + `PRODUCTION_ORDER:VIEW` (cùng permission HAN_STAFF/SON_STAFF đã có, để tự tra `productionOrderId` báo sản lượng) |
| BE `warehouse-transfers/warehouse-transfers.service.ts` | `getPieceTransferPlan()`: nhánh needsHan=false đổi từ `continue` (bỏ qua) thành tính `readyQty` từ `ProductionBatch(stage=PHOI, status=QC_DONE)` — cùng công thức với nhánh needsHan=true, set `label: 'VAT_TU_THANH_PHAM'` (type đã có sẵn từ thiết kế gốc 2026-08-17, chưa từng được set) |
| FE `services/production-batches-api.ts` | `ProductionBatchStage` mở rộng `'HAN' \| 'SON'` → `'PHOI' \| 'HAN' \| 'SON'` |
| FE `components/sanxuat/core.tsx` | Thêm `VAT_TU_TP_CFG: StageCfg` (khác `PHOI_CFG` đã có — cái đó dùng cho theo dõi theo LOẠI SẮT/cây ở `ThongKePagePlan.tsx`, không phải theo piece) |
| FE `modules/pages/Phoi/LenhSanXuatVatTuThanhPham.tsx` (mới) | Trang Phôi báo sản lượng — tái dùng `TwoTierScreen` với `stage="PHOI"`, y hệt `LenhSanXuatHan.tsx`/`LenhSanXuatSon.tsx` |
| FE `modules/pages/Kcs/KcsVatTuThanhPhamPage.tsx` (mới) | Trang KCS duyệt — tái dùng `KcsStagePage` với `stage="PHOI"`, y hệt `KcsHanPage.tsx`/`KcsSonPage.tsx` |
| FE `modules/pages/Manufacturing/MfgApp.tsx` | Đăng ký 2 tab mới: `phoi-vat-tu-tp` (Phôi) và `kcs-vat-tu-tp` (KCS) |
| FE `modules/pages/InboundWarehouse/WarehouseXuatPage.tsx` | **Không cần sửa** — `pieceLabelToUnit()` đã tự xử lý cả `'MANH'` lẫn giá trị khác (fallback 'Vật tư TP') từ trước, chỉ chưa từng có `'VAT_TU_THANH_PHAM'` thực tế để hiển thị |

Test: BE 613/613 pass (thêm 8 test mới ở `production-batches.service.spec.ts` +
`warehouse-transfers.service.spec.ts`, sửa 1 test cũ đổi từ "PHOI bị chặn" sang test stage thật sự
invalid là `MfgStage.DAN`). `tsc --noEmit`/`next build`/`nest build` sạch cả 2 repo.

## Chưa làm / lưu ý cho lần sau

- **Chưa test qua UI thật với dữ liệu thật** (cần seed 1 `BomPiece.needsHan=false` + tài khoản
  `mfgRole=PHOI` + `mfgRole=KCS`) — mới verify qua unit test + build, chưa qua browser.
- Không đụng `qc-reviews.service.ts::fulfillReplenishRequest()` — cấp bù cho `ProductionBatch` vẫn
  chặn cứng nhánh `productionBatchId` (chưa có quyết định nghiệp vụ, xem comment gốc trong file) —
  áp dụng y hệt cho batch stage=PHOI mới, không phải quyết định riêng của thay đổi này.
- `PieceTransferLabel.VAT_TU_THANH_PHAM` giờ mới thực sự được set lần đầu tiên kể từ khi field này
  được định nghĩa (thiết kế gốc `review-2026-08-17-sanxuat-stage-v16-va-chuyen-kho-manh.md` mục 6).
