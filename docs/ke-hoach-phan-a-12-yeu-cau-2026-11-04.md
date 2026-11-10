# Kế hoạch chi tiết PHẦN A – 12 yêu cầu (Kế hoạch & Sản xuất)

> Người làm: phần A của `docs/ke-hoach-ky-thuat-12-yeu-cau-2026-11-04.html` (bản 2 người, commit `29a288a`). Nguồn nghiệp vụ:
> `docs/lam-ro-12-yeu-cau-thay-doi-ERP-v8-2026-11-04.docx` (gọi tắt **v8**). Phần B (Mua hàng & Kho) do người khác làm.
> Trạng thái: **PLAN – đã qua 3 vòng tự đánh giá (mục 12), chưa code.** Ngày 04/11/2026.

Phần A gồm: **Đợt 1** Load cont (YC9) · **Đợt 2** Mã LSX + chọn xưởng (V3-1, YC12 phần chọn) · **Đợt 3** Mốc, năng lực, cảnh báo
(YC10) · **Đợt 4** Vật tư cần về (YC6) · **Đợt 9** Sửa kế hoạch + Excel (YC2) · **Đợt 8** Sắt cắt bằng phần mềm (7.12, 7.14,
7.15, 7.17) · **Đợt 10a** Booking / Lịch xuất hàng (YC5 phần Sales). **Đợt 11** (máy cắt theo quy cách, 7.16) chờ anh Nhân trả lời
V7-1..V7-4 - ngoài phạm vi plan này.

---

## 0. Quy tắc làm (người dùng chốt 04/11)

- **Mỗi đợt 1 nhánh** ở cả 2 repo: BE `dot-<n>-<ten>` tách từ `main`, FE cùng tên tách từ `demo`. Đợt sau phụ thuộc đợt trước chưa gộp
  thì tách từ nhánh đợt trước (nhánh chồng), gộp theo thứ tự. Commit trên nhánh đợt **chỉ gồm file của đợt**. Gộp vào `main`/`demo` và
  push: **hỏi người dùng từng lần** (push nhánh chính có thể kích hoạt deploy Render/Vercel).
- **Không kéo theo việc dở của phiên khác (sửa ở vòng 4):** làm trong **git worktree riêng ngoài thư mục chính** - BE
  `D:\DNA-ERP-BE-parta`, FE `D:\DNA-ERP-parta` - mỗi đợt là 1 nhánh trong worktree đó. Thư mục chính (đang có thay đổi chưa commit của
  bảng đồng bộ, `app.module.ts`, `core.tsx`, `ThongKePagePlan.tsx`, `GomDotCatPage.tsx`, `CuttingSolvePanel.tsx`, Hướng dẫn
  `productionPlan.ts`, e2e…) và các phiên khác đang dùng nó **không bị đổi nhánh**. `node_modules` nối (junction) về thư mục chính,
  `.env` chép riêng trỏ `dna_erp_parta`, `prisma generate` trong worktree. Thợ sửa file theo đường dẫn worktree.
  - Module BE mới vẫn import vào module nghiệp vụ dùng nó (vd `WorkshopsModule` vào `ProductionInvoicesModule`) cho gọn `app.module.ts`.
  - Changelog của phần A ghi ở file riêng `docs/changelog-2026-11-04-phan-a-12-yeu-cau.md` (commit cùng nhánh đợt).
- **Migration:** kéo `main` mới nhất trước khi tạo; tên `2026110x...`; không sửa migration đã gộp. Enum Postgres thêm giá trị bằng
  migration riêng (`ALTER TYPE ... ADD VALUE`).
- **DB dev riêng:** `dna_erp_parta` trên Postgres localhost, dựng từ `backups/prod_20261026_0951_truoc-deploy-solver.dump` (bản
  production mới nhất có trong máy), `prisma migrate deploy` rồi mới thêm migration của đợt. Không chạy migration trên DB dùng chung.
  BE chạy thử cổng 3032 (`DAILY_JOBS=off` trừ khi thử việc hằng ngày), FE cổng 3132.
- **File dùng chung** (`schema.prisma`, `SystemConfig`, sidebar FE, trang Hướng dẫn, `notification-types.ts`, `role-permissions`):
  chỉ THÊM phần mới, đặt gọn trong khối có chú thích `// Phần A – Đợt n`; chỗ nào phải sửa phần đã có thì ghi vào mục "Đụng file dùng
  chung" của changelog và báo người dùng.
- **Kiểm tra mỗi đợt:** BE `jest` (module liên quan + toàn bộ trước khi commit), `tsc --noEmit` (chỉ còn 2 lỗi seed cũ),
  `nest build`, eslint file đổi; FE `tsc`, eslint file đổi, `vitest` (không chạy prettier); chạy thử thật BE 3032 + FE 3132 trên
  `dna_erp_parta` (API + trình duyệt, cả màn hẹp). Quy trình thợ: Opus viết hợp đồng (type/DTO) trước, thợ BE và thợ FE chạy song song
  trên tập file rời nhau, Opus đọc diff thật + chạy lại kiểm tra, Opus ghi changelog.

---

## 1. Đợt 1 – Load cont (YC9) · nhánh `dot-1-load-cont`

**v8:** 9.1 mỗi SKU mặc định 1 thùng, ô "số thùng trên 1 bộ" (mặc định 1); SKU cũ chưa có kích thước để trống, KHSX nhập tay ·
9.2 chỉ cont 40HC 68 m³ (Cấu hình) · 9.3 load cont = 68 ÷ thể tích, làm tròn xuống · cho nhập tay load cont thực tế (ưu tiên số nhập
tay) · hiện ở định mức, đơn hàng, lệnh SX. Kế hoạch kỹ thuật: 68 ÷ (thể tích thùng × số thùng/bộ) - ghi rõ trong Hướng dẫn.

**Hiện trạng:** `MfgProduct` chỉ có `factoryCode/name/description`; không có trường kích thước/thể tích nào. `MfgProduct` không bị
trigger khoá định mức (chỉ 8 bảng con của `BomRevision`) → sửa được cả sau khi Sếp duyệt. `SystemConfig` là 1 dòng nhiều cột kiểu
rõ ràng, Admin sửa ở `SystemConfigPage.tsx` (FE gửi danh sách trường tường minh ở `system-config-api.ts`).

**Thiết kế**
- DB (migration `20261105100000_add_mfg_product_container_load`): `MfgProduct` thêm `boxLengthCm Decimal(7,1)?`,
  `boxWidthCm Decimal(7,1)?`, `boxHeightCm Decimal(7,1)?`, `boxesPerSet Int @default(1)`, `loadContManual Int?`,
  `containerLoadUpdatedAt DateTime?`, `containerLoadUpdatedById String?`. `SystemConfig` thêm `containerVolumeM3 Decimal(6,2) @default(68)`.
- Hàm thuần `src/common/utils/container-load.util.ts`:
  `containerLoadOf({boxLengthCm, boxWidthCm, boxHeightCm, boxesPerSet, loadContManual}, containerVolumeM3)` →
  `{ boxVolumeM3 (4 số lẻ) | null, formulaLoadCont | null, loadCont | null, source: 'MANUAL'|'FORMULA'|null }`.
  `formulaLoadCont = floor(containerVolume / (boxVolume × boxesPerSet))`, chỉ khi đủ 3 kích thước > 0; `loadCont = loadContManual ?? formulaLoadCont`.
  Kèm `contEquivalentOf(qty, loadCont)` = qty ÷ loadCont (null khi chưa có load cont) - dùng lại ở Đợt 3, 10a.
- API: `PATCH /skus/:id/container-load` (id = PlanForm như mọi route `/skus`), body `{boxLengthCm?, boxWidthCm?, boxHeightCm?,
  boxesPerSet?, loadContManual?}` (null = xoá; số dương; boxesPerSet 1–20; loadContManual 1–10000). Ghi vào `MfgProduct` của SKU, ghi
  `auditEvent` (cũ → mới). Quyền: `@RequirePermissions(SKU:VIEW)` + `@RequireRole(ADMIN, PRODUCTION_PLANNER,
  SPEC_ACCESSORY_PACKAGING_STAFF)` - không thêm quyền mới nên không phải seed production. Không chặn theo trạng thái định mức.
  `GET /system-config/container` (quyền SKU:VIEW) trả `{containerVolumeM3}` cho người không phải Admin (FE tính thử khi đang gõ).
- Trả ra: thêm khối `containerLoad` (kiểu `ContainerLoadDto` = các trường trên + kết quả tính) vào `SkuResponseDto`,
  `ProductionInvoiceItemResponseDto`, `SalesOrderItemResponseDto`. Mỗi lần trả danh sách đọc `SystemConfig` 1 lần.
- FE:
  - `SpecDetailQuotaPage.tsx` (NV định mức, tab Bao bì): khối "Thùng & load cont" - 3 ô kích thước (cm), số thùng/bộ, load cont nhập
    tay (tuỳ chọn), dòng kết quả "Thể tích 0,844 m³ · Load cont = 68 ÷ 0,844 = 80 bộ/cont" (hoặc "theo số nhập tay"); nút Lưu riêng
    (lưu thẳng, không qua nháp/gửi duyệt, vẫn sửa được khi định mức đã nộp).
  - `SKUDetail.tsx` (KHSX, Kế hoạch SX): cùng khối (component dùng chung `ContainerLoadEditor.tsx`).
  - Hiển thị: `OrderManagementPage.tsx` (Sales - dòng SKU: "Load cont 80 · 200 bộ ≈ 2,5 cont"), `LenhSXPage.tsx` (dòng SKU + hộp Sếp
    duyệt), `SKUListPage.tsx` (cột load cont). SKU chưa có → "Chưa có load cont" (màu nhạt, có gợi ý ai nhập).
  - `SystemConfigPage.tsx`: ô "Thể tích cont 40HC (m³)".
  - Hướng dẫn: thêm 1 bài "Load cont của SKU" (công thức, ví dụ J55, số thùng/bộ, số nhập tay).
- Test: util (đủ/thiếu kích thước, số thùng/bộ 2, nhập tay thắng, làm tròn xuống, 0/âm bị chặn); service (ghi đúng MfgProduct của
  PlanForm, audit, 404, quyền theo vai trò ở controller spec); FE util/component test (định dạng số kiểu VN).
- Chia thợ: **BE** (schema, migration, util, DTO, service, controller, 3 response, system-config) · **FE** (editor, 4 màn, system
  config, api types, Hướng dẫn). Hợp đồng `ContainerLoadDto` Opus viết trước.

## 2. Đợt 2 – Mã lệnh LSX + chọn xưởng (V3-1, YC12 phần chọn) · nhánh `dot-2-lsx-xuong`

**v8:** mã lệnh chính = số LSX nhà máy (MY-313, GP-176); KHSX gõ khi lập kế hoạch, **bắt buộc trước khi gửi duyệt, không trùng**;
tiền tố Admin cấu hình; lệnh gộp hiện đủ số 2 lệnh gốc; lệnh cũ giữ PI-2026-xxx, bổ sung LSX khi cần, tìm theo cả hai. YC12: QLSX chọn
xưởng cơ khí (Phú An, Phước An) cạnh kho đóng gói từng SKU, "áp dụng nhanh cho tất cả", bắt buộc đủ 2 ô mới gửi Sếp; 11.4 lệnh gộp
cùng 1 xưởng; 12.2 1 SKU 1 xưởng; 12.3/12.5 đổi xưởng sau duyệt chỉ khi chưa xuất sắt, báo Sếp.

**Hiện trạng:** dòng SKU (`ProductionInvoiceItem`) sinh lúc Sales lưu đơn (chưa có PI); KHSX gom ở "Tối ưu cắt sắt": `claimSolo` (PI
1 SKU) hoặc `mergeItems` (PI gộp ≥ 2 SKU, tối đa 2). "Lệnh gốc" trong v8 = 1 dòng SKU. QLSX chọn kho TP ở hộp "Chọn kho thành phẩm"
(`LenhSXPage.tsx` ~1191) đã có "Áp dụng nhanh"; BE `sendItemToBoss`/`sendBatchToBoss` lưu `warehouseCode/Name`. Xuất sắt theo PI ×
vật tư (`SteelIssue`), không theo dòng SKU. Không có khái niệm xưởng.

**Thiết kế**
- DB (migration `20261106100000_add_lsx_and_workshop`):
  - `ProductionInvoiceItem.lsxCode String?` + **unique index** (không trùng toàn hệ thống). Chuẩn hoá in hoa, dạng `^[A-Z]{1,6}-\d{1,6}$`.
  - `SystemConfig.lsxPrefixes String[] @default([])` (Admin nhập MY, GP…; rỗng = chấp nhận mọi tiền tố đúng dạng).
  - Bảng `Workshop { id, code @unique, name, capacityMode (CONT_PER_DAY | DAYS_PER_CONT), paintWorkshopId?, sortOrder, isActive }`;
    migration chèn sẵn `PHU_AN` "Xưởng Phú An" (CONT_PER_DAY) và `PHUOC_AN` "Xưởng Phước An" (DAYS_PER_CONT, sơn ở PHU_AN) - production
    có ngay sau `migrate deploy`, không phải seed.
  - `ProductionInvoiceItem.workshopId BigInt?` (FK).
- Hàm hiển thị (điểm ghép ①, A làm ngày đầu): BE `src/common/utils/lenh-code.util.ts` `lenhDisplayCode(pi, items)` = các `lsxCode` khác
  nhau của dòng trong PI nối " + " (giữ thứ tự dòng), chưa có thì mã PI; FE `src/utils/lenhCode.ts` cùng luật. PI response thêm
  `displayCode`, `lsxCodes[]`; item response thêm `lsxCode`, `workshop {id, code, name}`.
- API:
  - `PATCH /production-invoices/:id/items/:itemId/lsx` `{lsxCode|null}` - KHSX/Admin. Sửa được khi dòng chưa được Sếp duyệt; đã
    duyệt thì chỉ được **điền khi đang trống** (bổ sung cho lệnh cũ), muốn đổi phải Admin. Trùng → 409 nêu lệnh đang dùng số đó. Audit.
  - Bắt buộc LSX: `sendItemToQlsx`/`sendBatchToQlsx` (bước "gửi duyệt" đầu tiên của KHSX) chặn dòng thiếu LSX (400 liệt kê SKU). Dòng
    đang chờ QLSX/Sếp từ trước không bị chặn ở bước sau (lệnh cũ).
  - Tìm kiếm: `findAll(search)` tìm `code` HOẶC `items.lsxCode`; FE lọc theo cả hai ở LenhSXPage, ThongKePagePlan, MilestoneBoardView.
  - `GET /workshops` (quyền PRODUCTION_INVOICE:VIEW) cho các ô chọn.
  - Gửi Sếp: `SendToBossDto`/`SendBatchToBossDto` thêm `workshopId` **bắt buộc** (FE và BE lên cùng lúc). Kiểm: xưởng tồn tại, đang
    dùng; PI gộp → mọi dòng cùng 1 xưởng (so cả dòng đã gửi trước). FE nhóm lần gọi theo (kho, xưởng).
  - Đổi xưởng: `PATCH /production-invoices/:id/workshop` `{workshopId, reason}` - QLSX (mfgRole PRODUCTION_MANAGER) - đổi cho MỌI dòng
    của PI (vì xuất sắt và giữ chỗ theo PI; 11.4/12.2 bảo đảm PI chỉ 1 xưởng) khi dòng đang WAITING_BOSS hoặc APPROVED và **PI chưa có
    `SteelIssue` nào**; có xuất sắt → 409 "đã xuất sắt, không đổi xưởng được". Thông báo mới `PI_WORKSHOP_CHANGED` tới BOSS (+ KHSX).
- FE: ô "Số LSX" (chọn tiền tố + gõ số) ở chi tiết PI của KHSX từng dòng SKU, nút "Gửi QLSX" báo thiếu LSX trước khi gọi API; hộp QLSX
  thêm cột "Xưởng cơ khí" + "Áp dụng nhanh" chung cho cả kho và xưởng; hộp Sếp duyệt hiện xưởng; nút "Đổi xưởng" cho QLSX ở lệnh đã
  gửi/duyệt (ẩn khi đã xuất sắt - BE vẫn chặn); thay mã hiển thị bằng `displayCode` ở các màn chính: LenhSXPage, ThongKePagePlan (Theo
  lệnh, Bảng mốc), GomDotCatPage (danh sách lệnh vừa tạo), BossApp (qua LenhSXPage). Các màn còn lại (xưởng, kho, thông báo…) giữ mã PI
  ở đợt này - ghi vào danh sách còn lại (người B dùng `lenhDisplayCode` khi in phiếu).
- Admin `SystemConfigPage`: ô "Tiền tố số LSX" (nhập nhiều, cách nhau dấu phẩy).
- Hướng dẫn: bài "Số LSX và xưởng cơ khí".
- Test: util hiển thị; service LSX (dạng, tiền tố, trùng → 409, đã duyệt chỉ điền khi trống), sendToQlsx thiếu LSX, sendToBoss thiếu /
  sai xưởng / PI gộp khác xưởng, đổi xưởng (chưa xuất sắt OK, có SteelIssue → 409, đổi mọi dòng, thông báo), search theo LSX.
- Chia thợ: **BE** (migration, util, service/DTO/controller production-invoices, workshops module, system-config, notification type)
  · **FE** (LenhSXPage, ThongKePagePlan/MilestoneBoard lọc + hiển thị, GomDotCat hiển thị, SystemConfigPage, api, util + test,
  Hướng dẫn).

## 3. Đợt 3 – Mốc, năng lực, cảnh báo (YC10) · nhánh `dot-3-moc-nang-luc` (sau Đợt 1, 2)

**v8 (tóm tắt):** 4 mốc neo M1 VT Phôi-Sơn-Hàn về đủ, M2 Bắt đầu Phôi, M3 VT còn lại về đủ, M4 Bắt đầu Đóng gói · bộ mốc: Mua VT khung &
đan, Phôi, Hàn, Sơn, Khung, **Nhập đan** (đổi tên "Đan"), **Chuyền kiểm** (thêm ô), Mua VT còn lại, Đóng gói, Hạn giao · số ngày Phôi
= ⌈số cont ÷ 1,3⌉, xong ngày M2 + X − 1, Hàn/Sơn mỗi công đoạn bắt đầu sau công đoạn trước 1 ngày và làm X ngày; Phước An 4 ngày ×
số cont · đề xuất mặc định Nhập đan N+12, Chuyền kiểm N+13, Đóng gói N+14, không tự lùi theo số ngày Phôi · năng lực chỉ CẢNH BÁO
(1,3 cont/ngày, Cấu hình), cộng cont mọi lệnh trong ngày theo xưởng và công đoạn; Sơn Phú An tính chung lệnh 2 xưởng; Nhập đan /
Chuyền kiểm / Đóng gói theo kho đóng gói · cảnh báo: tới M1/M3 chưa đủ vật tư; tới M2/M4 chưa bắt đầu; cuối ngày công đoạn chưa đủ 1 cont
(hoặc chưa đủ kế hoạch ngày nếu ngày đó < 1 cont); Phước An kiểm mỗi 4 ngày · không tự bỏ ngày nghỉ.

**Hiện trạng:** mỗi công đoạn chỉ 1 ngày hạn (`ProductionInvoiceItemStage`: FRAME, WEAVING, TRANSFER_CHECK, PACKAGING, FRAME_PHOI/
HAN/SON) + cột `materialDeadline` (M1), `finishedMaterialDeadline` (M3), `deliveryDeadline`. Công thức Phú An chỉ ở FE
(`phuAnTimeline.ts`: N = Khung − 2 hoặc hạn giao − 17; Phôi/Hàn/Sơn N/N+1/N+2; Đan N+12; Đóng gói N+14; M3 = ĐG − 7). Bảng mốc BE
(`milestone-board`) chấm trễ theo hạn ĐÃ LƯU; việc hằng ngày (`daily-jobs`, 10 phút/lần, khoá advisory) gửi tin sáng 7h. Dữ liệu làm
được theo ngày: Hàn/Sơn `FloorReport` PIECE, Nhập đan `WeavingReceipt.receivedAt`, Chuyền kiểm `TransferCheckResult.checkedAt`, Đóng
gói `PackagingRecord.packedAt`; Phôi báo theo đoạn (chỉ ước tính ra bộ).

**Thiết kế**
- **Ý nghĩa ngày (giữ dữ liệu cũ không đổi nghĩa):** các ngày công đoạn đang có vẫn là **ngày phải XONG** (Bảng mốc đang chấm theo
  nghĩa này). Thêm 2 loại mốc NGÀY BẮT ĐẦU: `PHOI_START` (= M2) và `PACKAGING_START` (= M4) vào enum `ProdItemStageType` (migration
  riêng). M1 = `materialDeadline`, M3 = `finishedMaterialDeadline` (không đổi). TRANSFER_CHECK đưa lên form với tên "Chuyền kiểm";
  WEAVING đổi nhãn "Nhập đan" (chỉ nhãn FE + tên mốc ở Bảng mốc/thông báo).
- **Công thức đề xuất chuyển về BE** `src/common/utils/timeline-suggest.util.ts` (hàm thuần, có test; FE `phuAnTimeline.ts` thành lớp
  gọi API + giữ hàm định dạng):
  - Vào: số lượng, load cont (Đợt 1), xưởng (Đợt 2), N (= M2; mặc định như cũ: Khung đã lưu − 2, chưa có thì hạn giao − 17), M4 tuỳ chọn.
  - X (Phú An) = ⌈cont ÷ capacityContPerDay⌉, tối thiểu 1; X (Phước An) = ⌈4 × cont⌉ (số ngày/cont ở Cấu hình); chưa có load cont → X = 1
    và trả cờ `missingLoadCont` (form hiện "SKU chưa có load cont, số ngày tạm tính 1").
  - Ra: M1 = N − 1; Phôi xong = N + X − 1; Hàn xong = N + X; Sơn xong = N + X + 1 (Phước An: Hàn nối sau Phôi; Sơn ở Phú An - vẫn +1);
    Khung = Sơn xong; Nhập đan = N + 12; Chuyền kiểm = N + 13; M4 = N + 14; Đóng gói xong = M4 + Xđg − 1 (Xđg = ⌈cont ÷ 1,3⌉);
    M3 = M4 − 7. Kèm cảnh báo thứ tự (10.14): mốc Nhập đan/Chuyền kiểm/Đóng gói sớm hơn ngày xong công đoạn trước → chuỗi cảnh báo,
    không chặn; Đóng gói xong > Hạn giao → cảnh báo.
  - API `POST /production-invoices/:id/timeline-suggest` `{items:[{itemId, n?, packagingStart?}]}` → đề xuất từng dòng. Form "Sửa thời
    hạn" gọi khi mở và khi KHSX đổi N/M4.
- **Năng lực (chỉ cảnh báo)** - module mới `production-capacity` (import vào `ProductionInvoicesModule`):
  - Tải: mọi dòng SKU đã có xưởng (đã qua QLSX), PI chưa huỷ, lệnh chưa Kết thúc. Mỗi công đoạn một **khoảng ngày** lấy từ ngày ĐÃ LƯU:
    Phôi [PHOI_START, FRAME_PHOI], Hàn [PHOI_START+1, FRAME_HAN], Sơn [PHOI_START+2, FRAME_SON]; Nhập đan / Chuyền kiểm: [ngày − X + 1,
    ngày]; Đóng gói [PACKAGING_START, PACKAGING]. Thiếu ngày bắt đầu → suy từ ngày xong − X + 1. Mỗi ngày trong khoảng nhận cont ÷ số ngày.
  - Gom: Phôi/Hàn theo xưởng; Sơn theo xưởng sơn (Phước An → Phú An); Nhập đan / Chuyền kiểm / Đóng gói theo kho đóng gói
    (`warehouseCode`). Vượt `capacityContPerDay` (1,3) → cảnh báo. Xưởng `DAYS_PER_CONT` (Phước An, Phôi + Hàn): 2 lệnh có khoảng chồng
    nhau → cảnh báo "2 lệnh cùng chiếm ngày …".
  - API `GET /production-capacity?from&to` (bảng ngày × xưởng/kho × công đoạn, kèm lệnh gây vượt) và
    `POST /production-capacity/check` (thử với ngày đang sửa, chưa lưu) - form "Sửa thời hạn" và hộp QLSX chọn xưởng hiện cảnh báo vàng.
  - FE: tab "Năng lực" trong "Tổng hợp lệnh SX" (bảng 14 ngày tới, ô đỏ khi vượt, bấm xem lệnh).
- **Cảnh báo hằng ngày** - thêm bước vào `daily-jobs` (giữ khoá advisory + dedupeKey theo ngày):
  - (a) Tới M1/M3 mà vật tư nhóm tương ứng chưa nhận đủ → `MATERIAL_ANCHOR_MISSED` tới Mua hàng (người mua của vật tư) + thủ kho nhận +
    KHSX (dùng phần `missing` Bảng mốc đã tính).
  - (b) Tới M2 mà lệnh chưa bắt đầu Phôi (`floorStage = PENDING` và chưa có báo cắt) / tới M4 chưa có `PackagingRecord` →
    `STAGE_NOT_STARTED` tới QLSX + KHSX.
  - (c) Sau giờ chốt ngày (`END_OF_DAY_HOUR_VN = 18`, hằng số như `DIGEST_HOUR_VN`) với mỗi (xưởng hoặc kho đóng gói, công đoạn) có kế
    hoạch trong ngày: làm được (cont tương đương) < min(1 cont, kế hoạch ngày) → `DAILY_OUTPUT_LOW` tới QLSX + KHSX. Làm được: Hàn/Sơn =
    Σ mảnh báo trong ngày (bỏ lần huỷ) ÷ Σ mảnh của 1 bộ × 1 bộ ÷ load cont; Nhập đan, Chuyền kiểm tương tự; Đóng gói = thùng đóng
    ÷ load cont; **Phôi = (số đoạn cắt đạt trong ngày ÷ tổng đoạn của lệnh) × số bộ ÷ load cont** (ước tính, ghi rõ trên tin).
    Phước An (DAYS_PER_CONT): kiểm cuối mỗi khối 4 ngày tính từ PHOI_START: luỹ kế < số khối × 1 cont → báo.
  - Lệnh trễ hẳn (hết số ngày mà chưa xong) đã được Bảng mốc báo LATE trong tin sáng - không thêm loại mới (đúng ý "hết số ngày kế
    hoạch" của review mục 16).
  - Gom 1 tin/người/ngày cho (a)(b)(c) để không bắn hàng chục thông báo.
- Cấu hình (`SystemConfig`): `capacityContPerDay Decimal(4,2) @default(1.3)`, `daysPerContPhuocAn Int @default(4)` (Admin sửa).
- Bảng mốc: thêm cột Chuyền kiểm, đổi nhãn Nhập đan, hiện M2/M4 (ngày bắt đầu) dưới Phôi/Đóng gói.
- Test: util đề xuất (ví dụ v8: 160 bộ load 80 → 2 ngày; 240 → 3; 400 → 4; Phước An 1,5 cont → 6 ngày; thiếu load cont; cảnh báo thứ
  tự), capacity (chia đều, gom theo xưởng/kho, Sơn Phước An về Phú An, chồng lệnh Phước An), daily output (từng nguồn, bỏ lần huỷ, ngày
  VN), dedupe thông báo.
- Chia thợ: **BE-1** (util đề xuất + endpoint suggest + enum/migration + form DTO nhận 2 mốc mới) · **BE-2** (module capacity + daily
  jobs + notification types) · **FE** (form Sửa thời hạn, tab Năng lực, Bảng mốc, Hướng dẫn). BE-1 và BE-2 rời file; BE-2 cần hợp đồng
  khoảng ngày từ BE-1 (Opus viết trước).

## 4. Đợt 4 – Vật tư cần về (YC6) · nhánh `dot-4-vat-tu-can-ve` (sau Đợt 3)

**v8:** 6.1 một danh sách mọi ngày có vật tư cần về · 6.2/6.3 khoảng được về = [hạn chót − 4 (Cấu hình), hạn chót] · 6.4 dây đan, đinh,
nút thuộc M1; M3 chỉ thùng, nệm/vải, phụ kiện, nhãn · lọc Quá hạn / Hôm nay / Theo ngày · mỗi dòng: từ – hạn chót, vật tư, cần, đã
nhận, còn thiếu, lệnh SX, NCC, người mua · badge = quá hạn + hôm nay · sáng gửi tin · nhận đủ tự ẩn.

**Hiện trạng:** hạn dòng mua = `itemDeadlineOf` (`purchase-proposals.service.ts`, đã theo SKU chọn dây/nệm, còn lại SKU gấp nhất) dựa
`purchaseDeadlineOf` (M1/M3 theo `detailKind`). Dòng mua KHÔNG gắn dòng SKU (chỉ gắn PI); NCC chỉ nằm trong file Sếp ký; người mua =
`Material.buyerId`. Badge qua `GET /me/work-queue`. Tin sáng `MORNING_MATERIALS_DIGEST` đang có.

**Thiết kế**
- Điểm ghép ②: `src/common/utils/material-need-date.util.ts` `materialNeedDateOf(item, group)` (M1/M3 theo từng dòng SKU) - thay ruột
  `purchaseDeadlineOf` gọi qua hàm này; người B dùng khi chia hàng theo SKU (5d).
- Kiểm lại phân nhóm với 6.4: `purchaseGroupOf` hiện xếp mọi thứ không phải ACCESSORY/CUSHION/PACKAGING vào M1 (gồm dây đan, đinh,
  nút) - khớp; "nhãn, thùng" là PACKAGING - khớp. Không đổi.
- Cấu hình `SystemConfig.materialEarliestArrivalDays Int @default(4)`; FE thôi dùng số 4 cứng ở `phuAnTimeline.ts`.
- Module mới `materials-due` (import vào `PurchaseProposalsModule`? - KHÔNG: module đó thuộc người B → import vào `MilestoneBoardModule`
  của A): `GET /materials-due?view=overdue|today|date&date=` trả dòng mua chưa nhận đủ (NEW, PURCHASING; received < **số mua** =
  `effectiveOrderQty(buyQty, orderQty)` của B - Đợt 5a, không dùng buyQty) với hạn chót,
  ngày được về từ, vật tư, cần/đã nhận/thiếu, mã lệnh (`displayCode`), người mua, kho nhận, NCC (để trống tới khi người B thêm NCC vào
  dòng mua - 5b). Người mua chỉ thấy vật tư mình phụ trách, thủ kho thấy kho mình (dùng lại `buildBuyerByMaterialId` / phạm vi kho).
  Quyền: PURCHASE_PROPOSAL:VIEW (Mua hàng, Kho đã có - kiểm lại khi làm).
- Badge: `work-queue` thêm `materialsDueNow` (quá hạn + hôm nay) theo người mua / theo kho. **Đụng file của B** (`work-queue.service.ts`
  dùng chung) → chỉ thêm 1 khối, báo người dùng.
- Tin sáng: đổi nội dung `MORNING_MATERIALS_DIGEST` thành "Quá hạn N dòng · Hôm nay M dòng" + link màn mới (giữ dedupe/người nhận).
- FE: màn `VatTuCanVePage.tsx` dùng chung, gắn vào sidebar Mua hàng (`PurchasingApp.tsx`) và Kho (`InboundWarehouseApp.tsx`) - **đụng
  sidebar dùng chung** → chỉ thêm 1 mục, báo người dùng.
- Test: khoảng ngày, lọc 3 chế độ, phạm vi người mua/kho, ẩn khi nhận đủ, badge, nội dung tin sáng.

### 4b. Đợt 4 – thiết kế bản 2 (05/11, rà lại code sau khi Đợt 3 + 5a–5c đã vào `main` `e95b28c`)

**Rà code - khác bản 1:**
- Bảng mốc (`milestone-board.service.ts`, của A) ĐÃ tính theo từng dòng SKU đã duyệt: dòng mua còn thiếu ở 2 mốc mua (`missing.MUA_VT_KHUNG`
  / `MUA_VT_CON_LAI`: id dòng mua, vật tư + chiều dài cây/quy cách, đơn vị, người mua `Material.buyerId`, kho nhận `receiveWarehouseCode ??
  Material.warehouse`), gán dây/nệm riêng của SKU đúng như màn mua (`own` / `siblings`). Tin sáng `MORNING_MATERIALS_DIGEST` ("Vật tư cần
  về: N phải về hôm nay, M đã trễ", mỗi người mua / mỗi kho 1 tin) dựng từ đó, link "Theo dõi mua hàng". → Đợt 4 dùng lại đúng logic
  gán dòng mua ↔ dòng SKU này, KHÔNG viết thứ 3.
- Nhưng Bảng mốc chấm "đủ" theo `buyQty` (cần mua) còn dòng mua chỉ đóng (`PURCHASED`) khi nhận ≥ **số mua** = `effectiveOrderQty(buyQty,
  orderQty)` của B (5a). Bảng mốc tải dòng qua `proposal.productionInvoiceId` (đề xuất từ phương án cắt cũng ghim PI -
  `resolveTargetProductionInvoiceId`), chỉ dòng SKU đã duyệt + có lệnh sản xuất.
- NCC có sẵn: `PurchaseProposalItem.supplierOrder.supplier.name` (đơn đặt hàng 5b/5c) hoặc báo giá `isChosen`; chưa có thì "chưa đặt".
- Badge (`work-queue`) bị gọi 30–120 s/người → phải tính nhẹ (không dựng cả Bảng mốc), có nhớ tạm.
- "về từ" ở form Sửa thời hạn = hạn − 4 viết cứng (`LenhSXPage.tsx`).
- Điểm ghép ②: hàm chung đã có là `purchaseDeadlineOf` (`frame-deadline.util.ts`) - không cần hàm mới. Dự phòng của Đợt 3 đưa vào đây:
  M1 = materialDeadline ?? (Bắt đầu Phôi − 1) ?? Khung ?? hạn PI; M3 = finishedMaterialDeadline ?? (Bắt đầu đóng gói − 7) ?? Đóng gói ??
  hạn PI. `frameDeadlineOf` (xếp cắt, luật gộp) KHÔNG đổi. Đổi hàm chung → "Theo dõi mua hàng" của B đổi theo (chỉ lệnh cũ chưa lưu M1/M3).

**Thiết kế:**
- Đơn vị dòng = **1 dòng mua** (số lượng chung - chia theo SKU là 5d của B), kèm danh sách **SKU dùng nó, mỗi SKU 1 hạn riêng** (YC11 11.1):
  "MY-313 hạn 10/11 · MY-314 hạn 12/11". Hạn chót của dòng = hạn SKU gấp nhất CÒN CHẠY; ngày được về từ = hạn chót − `materialEarliestArrivalDays`.
- Dòng có mặt khi: trạng thái chưa đóng (NEW / QUOTING / SUBMITTED / PURCHASING - gồm cả dòng chưa đặt NCC), PI chưa huỷ, còn ít nhất 1
  SKU chưa Kết thúc. Còn thiếu = số mua − đã nhận. **Đã nhận đủ số CẦN, chỉ còn chờ phần mua dư** → vẫn hiện, ghi "còn chờ mua dư", không
  đỏ, không tính badge (sản xuất không bị chặn). Nhận đủ số mua → dòng đóng → tự biến mất.
- Lọc: **Quá hạn** (hạn chót < hôm nay) · **Hôm nay** (xem câu hỏi Q4-1) · **Theo ngày** (chọn ngày D) · **Tất cả**; xếp theo ngày được về
  từ; dòng chưa có hạn xếp cuối "Chưa có hạn". Cột: được về từ – hạn chót, vật tư, số mua (cần / mua dư), đã nhận, còn thiếu, lệnh (LSX
  từng SKU + hạn), NCC, người mua, kho nhận.
- Ai thấy: người mua mặc định "Vật tư của tôi" + chuyển "Tất cả"; thủ kho = kho mình (`warehouseScope`); KHSX, Sếp, Admin xem tất cả.
- Cấu hình `SystemConfig.materialEarliestArrivalDays Int @default(4)` (0–30, Admin) + `planning-params`; FE "về từ" đọc số này.
- BE module mới `materials-due` (A): `MaterialsDueService.list(user, view, date)` + `countDueNow(user)` (badge, nhớ tạm 60 s cho cả bảng
  rồi lọc theo người); `GET /materials-due?view=overdue|today|date|all&date=&scope=mine|all`. Quyền: `PURCHASE_PROPOSAL:VIEW` (Mua hàng,
  Kho, KHSX, Sếp đã có - kiểm lại seed khi làm).
- Badge: `work-queue` thêm `materialsDueNow` cho PURCHASER (vật tư mình) và WAREHOUSE_STAFF (kho mình) - **file dùng chung với B**, chỉ thêm 1 khối.
- Tin sáng: `MORNING_MATERIALS_DIGEST` lấy số từ `MaterialsDueService` (cùng định nghĩa Quá hạn / Hôm nay với màn), link sang màn mới, giữ
  người nhận + dedupe. Tiêu đề "Vật tư cần về: X quá hạn · Y hôm nay".
- FE: `VatTuCanVePage.tsx` (bảng + thẻ điện thoại), mục sidebar "Vật tư cần về" ở Mua hàng (`PurchasingApp.tsx`), Kho (`InboundWarehouseApp.tsx`)
  - **sidebar dùng chung với B** - và (Q4-3) KHSX; ô Cấu hình; bài Hướng dẫn Mua hàng + Kho.
- Chia thợ: BE (schema + migration + config + util + module + work-queue + daily-jobs + test) · FE (màn + sidebar + config + hướng dẫn +
  test); Opus viết hợp đồng `MaterialsDueRow` trước. Nhánh `dot-4-vat-tu-can-ve` cắt từ `main` `e95b28c` / `demo` `ebd83f5`; DB riêng
  `dna_erp_dot4` (bản sao `dna_erp_full`) + dữ liệu thử `PA4-` có đề xuất mua (sắt, sơn, dây, nệm, thùng; 1 lệnh gộp 2 SKU; 1 dòng mua dư;
  1 dòng đã có đơn NCC).

**Tự đánh giá:**
- V5-1 (cao) Badge gọi dày → nhớ tạm 60 s + truy vấn theo chỉ mục `status`; không dựng Bảng mốc. Thử với 500 dòng mua.
- V5-2 (cao) "Còn thiếu" theo số mua khác "đã về đủ" của Bảng mốc (theo cần mua) → tách "còn chờ mua dư" (không đỏ) để 2 màn không nói
  ngược nhau về việc sản xuất có bị chặn.
- V5-3 (vừa) Đổi `purchaseDeadlineOf` đụng màn của B → chỉ ảnh hưởng lệnh cũ chưa lưu M1/M3; báo B + test hồi quy "Theo dõi mua hàng".
- V5-4 (vừa) Lệnh gộp dùng chung dòng mua: chưa có số theo SKU → hiện số chung + hạn từng SKU; ghi rõ chờ 5d.
- V5-5 (vừa) Dòng mua thuộc SKU đã Kết thúc (dư) → ẩn, như `itemDeadlineOf`.
- V5-6 (thấp) "Đóng phần thiếu" (7.13 của B) chưa có → khi B làm, dòng đóng phần thiếu tự ra khỏi danh sách nếu B đặt trạng thái đóng.

### 4c. Đợt 4 – chốt theo câu trả lời của Sếp (05/11, file `TRA_LOI_DOT_4_VAT_TU_CAN_VE_IT_05-11-2026.docx`)

| Câu | Sếp chọn | Thiết kế chốt (thay chỗ tương ứng ở 4b) |
|---|---|---|
| 1 "Hôm nay" | **A + C** | Lọc Hôm nay = mọi dòng có về từ ≤ hôm nay ≤ hạn chót; ngày hạn chót ghi nổi bật **"HẠN CHÓT HÔM NAY"** (đỏ). Tới hạn chót chưa về đủ → ĐỎ + thông báo mới `MATERIALS_DEADLINE_ALERT` (CRITICAL → tự thêm Sếp = vai trò BOSS, tài khoản Sếp; người dùng xác nhận) cho **KHSX**, ngoài tin sáng người mua + thủ kho. |
| 2 Lệnh gộp | A | 1 dòng mua + từng SKU kèm hạn riêng, hạn chót dòng = hạn SKU sớm nhất (như 4b). |
| 3 Mua dư | **B** + ý kiến | Theo dõi theo **SỐ CHỐT MUA** = `effectiveOrderQty(buyQty, orderQty)`: chưa về đủ số chốt mua là còn thiếu, đỏ + tính badge như dòng khác. **Bỏ** ngoại lệ "còn chờ mua dư" của 4b (V5-2 không còn). |
| 4 KHSX | A | Mục "Vật tư cần về" ở menu Kế hoạch SX, cùng danh sách, chỉ xem, không badge. |

- Trạng thái dòng (BE tính): `OVERDUE` (hạn < hôm nay) · `DEADLINE_TODAY` · `IN_WINDOW` (về từ ≤ hôm nay < hạn) · `UPCOMING` · `NO_DEADLINE`. Lọc: Quá
  hạn = OVERDUE; Hôm nay = DEADLINE_TODAY + IN_WINDOW; Theo ngày D = về từ ≤ D ≤ hạn; Tất cả. Badge = OVERDUE + DEADLINE_TODAY + IN_WINDOW
  (người mua theo vật tư của mình, thủ kho theo kho; người vừa mua vừa thủ kho tính theo người mua).
- Tin sáng `MORNING_MATERIALS_DIGEST` (người mua + thủ kho) dựng từ `MaterialsDueService` (bỏ phần dựng từ Bảng mốc): "Vật tư cần về: X quá hạn,
  Y hạn chót hôm nay, Z trong hạn về", câu theo **mã lệnh (LSX)**, link màn mới. `MATERIALS_DEADLINE_ALERT`: 1 tin/ngày từ 07:00 khi toàn hệ thống
  có dòng quá hạn / hạn chót hôm nay; tự đóng trong ngày khi hàng về hết; tin hôm trước đóng khi gửi tin mới.
- Bảng mốc giữ nguyên cách chấm "đủ" theo cần mua (sản xuất có bị chặn không) - khác nghĩa với màn mới (theo số chốt mua); ghi trong Hướng dẫn.
- Dự phòng hạn vật tư (V4-3) vào `purchaseDeadlineOf`: M1 = materialDeadline ?? (Bắt đầu Phôi − 1) ?? Khung ?? hạn PI; M3 = finishedMaterialDeadline ??
  (Bắt đầu đóng gói − 7) ?? Đóng gói ?? hạn PI. Hàm gán dòng mua ↔ SKU tách thành `purchase-line-sku.util.ts` dùng chung với Bảng mốc.
- Hợp đồng: BE `src/modules/materials-due/materials-due.types.ts`, FE `src/services/materials-due-api.ts`. Nhánh `dot-4-vat-tu-can-ve`
  (worktree `D:\DNA-ERP-BE-dot4` từ `main` `e95b28c`, `D:\DNA-ERP-dot4` từ `demo` `ebd83f5`), DB `dna_erp_dot4` (bản sao `dna_erp_full`), dữ liệu thử
  `.claude/tools/huong-dan-test-phan-a/pa4-seed.sql` (5 lệnh PA4-PI-A..E = MY-9401..9406, ngày tính theo ngày chạy, 3 người mua demo
  muapsh / muavttp / muatp). Cổng chạy thử BE 3037 / FE 3137.

## 5. Đợt 9 – Sửa kế hoạch + Excel (YC2) · nhánh `dot-9-sua-ke-hoach` (sau Đợt 3)

**v8:** KHSX sửa mốc ở mọi giai đoạn trước Kết thúc · Excel tải xuống (lệnh đang chạy, 1 dòng/SKU) và tải lên (bảng cũ → mới, báo dòng
lỗi, Xác nhận mới ghi) · chỉ ngày mốc, **không gồm Hạn giao** · lệnh chưa duyệt sửa thẳng; Sếp đã duyệt → "Chờ Sếp duyệt lại", Sếp duyệt
cả lô, từ chối giữ mốc cũ · chỉ KHSX · lịch sử + thông báo bộ phận sau khi Sếp duyệt.

**Hiện trạng:** BE `PATCH :id/items-deadlines` không chặn trạng thái nhưng FE KHSX chỉ thấy PI đang PLANNING; quyền PRODUCTION_INVOICE:
UPDATE có cả WAREHOUSE_STAFF; audit đã ghi nhưng không có màn xem; chưa có cơ chế "thay đổi chờ duyệt"; FE có `xlsx` (chỉ xuất), BE
không có thư viện Excel.

**Thiết kế**
- DB: `DeadlineChangeBatch { id, source (MANUAL|EXCEL), status (PENDING|APPROVED|REJECTED|CANCELLED), requestedById, requestedAt,
  decidedById?, decidedAt?, decisionNote? }` + `DeadlineChangeRequest { id, batchId, productionInvoiceItemId, oldValues Json,
  newValues Json }`; mỗi dòng SKU tối đa 1 yêu cầu PENDING (kiểm trong transaction).
- Luật ghi: dòng chưa APPROVED → ghi thẳng như hiện nay. Dòng APPROVED → tạo lô chờ duyệt (không ghi mốc). Bỏ qua/không nhận
  `deliveryDeadline` với dòng đã duyệt (2.4). Dòng có lệnh Kết thúc (`floorStage FINISHED`) hoặc PI huỷ → 400. Dòng đang có yêu cầu
  chờ → 409 "đang chờ Sếp duyệt lại" (KHSX có nút Huỷ yêu cầu). Luật gộp (`assertMergedPiDeadlineRule`) chạy cả lúc tạo yêu cầu (báo
  sớm) và lúc Sếp duyệt (dữ liệu có thể đã đổi).
- Chặn vai trò: thêm `@RequireRole(PRODUCTION_PLANNER, ADMIN)` cho 2 route sửa hạn (hiện WAREHOUSE_STAFF cũng gọi được) - **đụng hành vi
  có sẵn** → kiểm FE kho không gọi route này, báo người dùng.
- Sếp: `GET /deadline-change-batches?status=PENDING`, `POST /:id/approve` (áp mốc mới bằng `applyItemDeadlines`, audit, thông báo
  `PI_ITEM_DEADLINE_CHANGED` như hiện nay), `POST /:id/reject` (giữ cũ, báo KHSX). BossApp mục "Chờ duyệt" thêm nhóm "Đổi mốc lệnh SX"
  (bảng cũ → mới theo lệnh/SKU, duyệt/từ chối cả lô). Badge Sếp + thông báo `DEADLINE_CHANGE_PENDING` (ACTION_REQUIRED).
- Excel (FE `xlsx`, đọc/ghi ở FE, BE nhận JSON): "Tải Excel kế hoạch" xuất lệnh đang chạy (cột: mã lệnh, SKU, tên, SL, mã dòng (ẩn,
  dùng để khớp), M1, Bắt đầu Phôi, Phôi, Hàn, Sơn, Khung, Nhập đan, Chuyền kiểm, M3, Bắt đầu Đóng gói, Đóng gói, Hạn giao (chỉ xem));
  "Tải lên" → FE đọc file → `POST /production-invoices/deadline-import/preview` (BE kiểm: mã dòng tồn tại, ngày hợp lệ, luật gộp, trạng
  thái, đang chờ) → bảng cũ → mới + dòng lỗi → Xác nhận → `POST .../deadline-import/commit` (Idempotency-Key; ghi thẳng dòng chưa duyệt,
  gom dòng đã duyệt thành 1 lô chờ Sếp).
- FE KHSX: thêm bộ lọc "Đang chạy" ở LenhSXPage để mở "Sửa thời hạn" cho PI PRODUCING; nhãn "Chờ Sếp duyệt lại" trên dòng; "Lịch sử đổi
  mốc" (đọc audit qua `GET /production-invoices/items/:itemId/deadline-history` có tên người sửa).
- Test: luật ghi theo trạng thái, 1 yêu cầu chờ/dòng, Hạn giao bị loại, Sếp duyệt/từ chối, luật gộp lúc duyệt, preview lỗi từng dòng,
  commit idempotent, quyền vai trò; FE: đọc/ghi Excel (vòng xuất → đọc lại khớp).

### 5b. Đợt 9 – thiết kế bản 2 (05/11, rà lại code ở `main` `59f828c` = đã có Đợt 3, 4, 5d)

**Rà code - khác / thêm so với bản 1:**
- 2 route sửa mốc: `PATCH /production-invoices/:id/items-deadlines` (cả PI, 1 giao dịch, kèm `deadline` của PI) và `PATCH :id/items/:itemId`
  (1 SKU) - KHÔNG kiểm trạng thái, ghi cả `deliveryDeadline`; quyền `PRODUCTION_INVOICE:UPDATE` có ở KHSX **và WAREHOUSE_STAFF** (thủ kho
  TP được cấp để gọi transfer-check / packaging); Sếp, QLSX không có UPDATE. FE chỉ gọi route cả PI từ `LenhSXPage` (form "Sửa thời hạn"),
  danh sách chỉ hiện PI `PLANNING`.
- Ghi mốc: `applyItemDeadlines` (item + upsert `production_invoice_item_stages`); lệnh gộp: `assertMergedPiDeadlineRule` (luật gộp ≤ N
  ngày); sau khi ghi: `auditAndNotifyDeadlineChange` = audit `ProductionInvoiceItem` (old/new theo trường) + `PI_ITEM_DEADLINE_CHANGED` tới
  Mua hàng (mốc vật tư), tổ Phôi/Hàn/Sơn (mốc công đoạn), thủ kho (Nhập đan / Chuyền kiểm / Đóng gói), Sales (hạn giao), luôn thêm QLSX
  (Đợt 3). → Đợt 9 DÙNG LẠI đúng 3 hàm này khi áp mốc (sửa thẳng và khi Sếp duyệt), không viết lại.
- Mọi nơi đọc mốc đều đọc trực tiếp giá trị đã lưu (Bảng mốc, Năng lực, Vật tư cần về, chia hàng nhận theo phiếu của B, xếp cắt, giữ chỗ)
  → áp mốc mới xong là các màn tự đổi; trong lúc chờ Sếp duyệt mọi màn vẫn chạy theo mốc cũ (đúng v8).
- Lịch sử: audit đã ghi nhưng không có màn xem (`GET /audit-logs` cần quyền AUDIT_LOG). Thứ tự mốc: luật có sẵn ở `MILESTONE_ORDER`
  (data-health, Đợt 3) - dùng lại thứ tự đó cho cảnh báo.
- Sếp: BossApp "Tổng hợp chờ duyệt" có 2 nút lọc (SKU mới / Lệnh SX) + badge `bossSkuApproval + bossProductionApproval` → thêm nút thứ 3.
- Excel: FE có `xlsx` 0.18.5 (bản npm cuối, có lỗi bảo mật khi ĐỌC file lạ - CVE-2023-30533 / CVE-2024-22363); BE có `exceljs` (Đợt 5c).
  → **Cả xuất và đọc file làm ở BE bằng `exceljs`** (khoá ô không được sửa, ẩn cột mã dòng, định dạng ngày), không đọc Excel ở FE.

**Thiết kế:**
- **Luật ghi (1 hàm `planDeadlineChanges`):** dòng SKU chưa `APPROVED` (chưa gửi, chờ QLSX, chờ Sếp, bị trả) → ghi thẳng như hiện nay.
  Dòng `APPROVED` → không ghi mốc, tạo yêu cầu trong 1 **lô chờ Sếp duyệt lại**; `deliveryDeadline` / hạn PI của dòng đã duyệt bị bỏ qua (2.4).
  Dòng có lệnh Kết thúc (`floorStage FINISHED`) hoặc PI huỷ → lỗi. Dòng đang có yêu cầu chờ → lỗi "đang chờ Sếp duyệt lại" (KHSX Huỷ yêu
  cầu rồi sửa lại). Luật gộp chạy lúc tạo yêu cầu (trên giá trị dự kiến) và lúc Sếp duyệt. 1 lần bấm Lưu / 1 lần Xác nhận Excel = 1 lô.
- **DB:** enum `DeadlineChangeSource { MANUAL, EXCEL }`, `DeadlineChangeStatus { PENDING, APPROVED, REJECTED, CANCELLED }`;
  `DeadlineChangeBatch { id, source, status, requestedById, requestedAt, decidedById?, decidedAt?, decisionNote?, note? }`;
  `DeadlineChangeRequest { id, batchId, productionInvoiceItemId, oldValues Json, newValues Json }` (khoá: `materialDeadline`,
  `finishedMaterialDeadline`, `stage.<TYPE>` → 'YYYY-MM-DD'); chỉ mục `(productionInvoiceItemId, status)`; "mỗi dòng ≤ 1 yêu cầu PENDING" kiểm
  trong giao dịch + khoá nghiệp vụ theo dòng.
- **Sếp duyệt:** `GET /deadline-change-batches?status=` (Sếp, KHSX xem của mình), `POST /:id/approve` (kiểm giá trị hiện tại vẫn = `oldValues`,
  lệch → 409 "mốc đã đổi từ lúc gửi"; áp bằng `applyItemDeadlines` + luật gộp trong 1 giao dịch; rồi audit + `PI_ITEM_DEADLINE_CHANGED` như
  sửa thẳng, ghi rõ "Sếp đã duyệt"), `POST /:id/reject` (bắt buộc lý do, giữ mốc cũ), `POST /:id/cancel` (KHSX huỷ lô của mình khi còn PENDING).
  Duyệt / từ chối **cả lô** (v8). Thông báo mới: `DEADLINE_CHANGE_PENDING` (ACTION_REQUIRED → Sếp, tự đóng khi lô đã quyết) và
  `DEADLINE_CHANGE_DECIDED` (RESULT → KHSX người gửi: đã duyệt / từ chối + lý do). Badge Sếp `bossDeadlineChange` (số lô PENDING) cộng vào "Tổng
  hợp chờ duyệt".
- **Chỉ KHSX:** `@RequireRole(PRODUCTION_PLANNER, ADMIN)` cho 2 route sửa mốc + các route Excel + tạo / huỷ lô (đụng hành vi có sẵn: thủ kho
  đang có UPDATE - đã kiểm FE kho không gọi 2 route này). Duyệt / từ chối: `@RequireRole(BOSS)`.
- **Excel (BE, exceljs):** `GET /production-invoices/deadline-plan.xlsx` - mọi dòng SKU của PI chưa huỷ có lệnh chưa Kết thúc (kể cả chưa
  duyệt), 1 dòng / SKU, cột: Mã lệnh (LSX) · SKU · Tên · SL · Xưởng · Trạng thái ("Chưa duyệt" / "Đã duyệt – sửa cần Sếp duyệt lại" / "Đang chờ
  Sếp duyệt lại – không sửa được") · M1 Mua VT khung · Bắt đầu Phôi · Phôi · Hàn · Sơn · Khung · Nhập đan · Chuyền kiểm · M3 Mua VT còn lại ·
  Bắt đầu đóng gói · Đóng gói · Hạn giao (khoá) · cột ẩn: mã dòng + giá trị mốc lúc xuất. Chỉ ô ngày mở khoá, ngày dd/mm/yyyy.
  `POST .../deadline-plan/preview` (tải file lên) → so ô với **giá trị lúc xuất** (ô không sửa = không đổi; ô trống = giữ nguyên, không xoá
  mốc qua Excel) → trả từng dòng đổi: cũ → mới, sửa thẳng / chờ Sếp, lỗi (mã dòng lạ, ngày sai, lệnh Kết thúc, đang chờ duyệt, luật gộp, **mốc
  đã bị đổi sau lúc tải file** = hiện tại ≠ lúc xuất) và cảnh báo (thứ tự mốc ngược theo `MILESTONE_ORDER`). `POST .../deadline-plan/commit`
  (gửi lại đúng danh sách đổi đã xem, Idempotency-Key; BE kiểm lại hết) → ghi thẳng phần chưa duyệt + tạo 1 lô EXCEL cho phần đã duyệt. Có lỗi
  ở dòng nào thì dòng đó bị bỏ, các dòng khác vẫn xác nhận được (bảng ghi rõ).
- **Lịch sử:** `GET /production-invoices/items/:itemId/deadline-history` (KHSX, QLSX, Sếp) đọc audit + các lô của dòng: lúc nào, ai, mốc nào cũ →
  mới, sửa thẳng / Sếp duyệt / từ chối.
- **FE:** `LenhSXPage` thêm bộ lọc **"Đang chạy"** (PI có SKU đã duyệt chưa Kết thúc) để mở "Sửa thời hạn"; form: dòng đã duyệt có dải
  "Lệnh đã Sếp duyệt – lưu sẽ gửi Sếp duyệt lại", hạn giao chỉ xem, dòng đang chờ có nhãn "Chờ Sếp duyệt lại" + nút Huỷ yêu cầu, nút "Lịch sử
  đổi mốc"; nút **Tải Excel kế hoạch / Tải lên Excel** (KHSX) + hộp xem trước (bảng cũ → mới, lỗi đỏ, cảnh báo vàng, Xác nhận). Sếp: nút lọc
  "Đổi mốc lệnh SX" ở "Tổng hợp chờ duyệt" (màn mới `DuyetDoiMocPage`: mỗi lô = nguồn, người gửi, lúc gửi, bảng lệnh / SKU / mốc cũ → mới, Duyệt /
  Từ chối + lý do). Bảng mốc / Tổng hợp lệnh SX: nhãn "Đang chờ Sếp duyệt đổi mốc" trên dòng SKU.
- Chia thợ: BE (schema + migration + service lô + Excel + route + thông báo + badge + test) · FE (form + bộ lọc + Excel UI + màn Sếp + lịch sử +
  nhãn + test); Opus viết hợp đồng trước. Nhánh `dot-9-sua-ke-hoach` từ `main` `59f828c` / `demo` `136a1a3`; DB `dna_erp_dot9` (bản sao
  `dna_erp_dot4` + migration 5d) + dữ liệu thử `PA9-`.

**Tự đánh giá:**
- V9-1 (cao) File Excel cũ ghi đè mốc mới hơn → so với giá trị LÚC XUẤT (cột ẩn), ô KHSX không sửa không bao giờ ghi; ô sửa mà mốc hiện tại đã
  khác lúc xuất → lỗi dòng, bắt tải file mới.
- V9-2 (cao) Sếp duyệt muộn, mốc đã bị đổi bởi đường khác → kiểm `oldValues` = hiện tại lúc duyệt, lệch thì 409. Mỗi dòng ≤ 1 yêu cầu chờ + chỉ
  KHSX sửa → hiếm.
- V9-3 (vừa) Đổi quyền: thủ kho mất khả năng gọi 2 route sửa mốc (chưa có màn nào của kho gọi) → kiểm lại bằng grep FE + test quyền.
- V9-4 (vừa) Lệnh có dòng đã duyệt + dòng chưa duyệt trong 1 lần Lưu → tách: phần chưa duyệt ghi ngay, phần đã duyệt vào lô; báo rõ trên màn
  ("đã lưu 2 SKU, 1 SKU chờ Sếp duyệt lại").
- V9-5 (vừa) Luật gộp: lệnh gộp có 1 SKU chờ duyệt + 1 SKU sửa thẳng → kiểm luật trên giá trị "sau khi duyệt" lúc tạo, và kiểm lại lúc duyệt.
- V9-6 (thấp) `xlsx` FE có lỗi bảo mật khi đọc → không dùng ở FE cho tải lên; file lớn: giới hạn 2 MB / 2.000 dòng.
- V9-7 (thấp) Dời 1 mốc có tự dời mốc sau không, thứ tự ngược chặn hay cảnh báo → hỏi Sếp (Q9-1, Q9-2); mặc định chỉ đổi ô đã sửa + cảnh báo.
- **Sếp trả lời 06/11 (phần 2 - changelog Đợt 9 mục 9):** Q9-1 = B mốc sản xuất sau tự dời cùng số ngày (Mua VT, hạn giao không dời; Excel dùng
  công thức để KHSX thấy ngay và BE nhận ra ô gõ) · Q9-2 = B thứ tự ngược chặn lưu (cả dòng sửa thẳng) · Q9-3 = ý kiến khác: lệnh đã bắt đầu sản
  xuất (`floorStage` ≠ PENDING) KHÔNG sửa mốc ở mọi đường, Excel chỉ lệnh chưa cắt - thu hẹp v8 2.1 "mọi giai đoạn trước Kết thúc" · Q9-4 = B.

## 6. Đợt 8 – Sắt cắt bằng phần mềm (7.12, 7.14, 7.15, 7.17) · nhánh `dot-8-sat` (sau Đợt 2)

**v8:** 2 lần tính: MUA lưỡi 3 mm (Cấu hình) cho cả 2 máy, ngưỡng tề + cùi ≤ 1%; BẢNG CẮT lưỡi thật của máy (laser 1, tự động 2,5),
cùng ngưỡng; cây mua dư so với bảng cắt vào tồn chưa giữ · 7.14 chiều dài chuẩn theo quy cách × kho Phôi (= xưởng), KHSX đặt; bỏ chọn
chiều dài từng lệnh; tự dò chỉ còn để GỢI Ý; cây cũ dùng tới hết · 7.15 lệnh không đạt 1% xin đặc cách (cơ chế có sẵn); đếm theo quy
cách × kho từ lần đổi chiều dài gần nhất, từ 2 lệnh (Cấu hình) báo KHSX + Sếp, cờ đỏ · 7.17 nút "Gợi ý chiều dài"; đổi không cần duyệt,
ghi lịch sử, báo Mua hàng.

**Hiện trạng:** 1 lần giải HiGHS/lô, kết quả dùng cho cả mua (`approve()` lấy `totalBars`) lẫn bảng cắt; lưỡi/tề theo máy ở
`SystemConfig`; chiều dài do KHSX chọn theo lô (`solverStockLengthsByMaterial`), tự dò 5000–6000 khi không đạt; đặc cách =
`solverMaxWastePctOverride` (FE gửi 100) + lý do, chỉ lưu bằng chứng 1 vật tư; máy chọn cho cả lô.

**Thiết kế**
- `SystemConfig.solverPurchaseBladeWidthMm Decimal @default(3)`, `steelExceptionAlertCount Int @default(2)`.
- Lần tính mua chạy ngay sau lần tính bảng cắt trong `runSolverAndSave` (cùng hàng đợi), cùng máy/tề/chiều dài, lưỡi 3 mm; lưu
  `CuttingProposalLine.purchaseTotalBars`, `purchaseWastePct`, `purchaseFeasible`. Dòng chỉ coi là đạt khi **cả 2 lần** đạt ngưỡng
  (review mục 16 điểm 4). `approve()`: giữ chỗ theo `totalBars` (bảng cắt), số mua = `purchaseTotalBars − tồn khả dụng` (phần dư so với
  bảng cắt vào tồn chưa giữ). Đề xuất cũ (chưa có `purchaseTotalBars`) dùng `totalBars` như trước.
- Bảng `SteelStandardLength { materialId, workshopId, lengthMm, updatedAt, updatedById }` (unique vật tư × xưởng) + `SteelStandardLength
  Change` (cũ, mới, ai, lúc nào). Màn KHSX "Chiều dài chuẩn sắt" (vật tư sắt phần mềm × 2 xưởng; sửa; lịch sử; cờ đỏ + số lần đặc cách).
  Đổi → thông báo Mua hàng.
- Giải theo chiều dài chuẩn của xưởng; ô chọn chiều dài theo lô ở GomDotCatPage bỏ; tự dò (`auto_scan`) tắt trong lần tính thường.
- `SteelWasteException { materialId, workshopId, productionInvoiceId, cuttingProposalLineId, wastePct, approvedAt }` ghi lúc Sếp duyệt
  lệnh có đặc cách (mỗi vật tư vượt ngưỡng 1 dòng - sửa luôn chỗ bằng chứng chỉ lưu 1 vật tư); đếm từ `SteelStandardLength.updatedAt`;
  ≥ 2 → `STEEL_EXCEPTION_REPEATED` tới KHSX + Sếp.
- "Gợi ý chiều dài": chạy nền (hàng đợi solver) cho N lệnh gần nhất của xưởng có dùng quy cách đó, quét dải chiều dài (Cấu hình hiện có
  5000–6000, bước), đếm số lệnh đạt 1% ở cả 2 lần tính → đề xuất chiều dài đạt nhiều nhất (hoà thì gần chiều dài hiện tại); thông báo
  khi xong.
- **Vướng thứ tự (xem mục 12, vòng 2, điểm V2-3):** KHSX tính cắt TRƯỚC khi QLSX chọn xưởng → đề xuất: KHSX chọn "Xưởng dự kiến" khi
  tính (mặc định Phú An); QLSX chọn xưởng khác với xưởng đã tính → hệ thống chặn gửi Sếp và báo KHSX tính lại. **Cần người dùng chốt
  trước khi làm Đợt 8.**
- Test: 2 lần tính (đạt/không đạt từng lần), số mua dùng `purchaseTotalBars`, đề xuất cũ tương thích, chiều dài chuẩn + lịch sử +
  thông báo, đếm đặc cách, gợi ý (chạy với bộ dữ liệu `test/solver-real-data-new`).

**Cập nhật 07/11 (Bảo trả lời file "gửi Bảo Đợt 9 và Phần A còn lại", kèm câu anh Nhân chốt 07/11 - changelog 12-yeu-cau mục 31):**
- **Lưỡi máy TỰ ĐỘNG thật = 3 mm** (không phải 2,5 đang cài), laser 1 mm → bảng cắt Phôi máy tự động cũng 3 mm. Đổi ở Cấu hình (Admin) ô "Lưỡi
  cắt (mm)" của MC Tự động (`solverMctdBladeWidthMm`) - không cần code; mặc định schema 2,5 sửa thành 3 khi làm Đợt 8. Máy tự động: 2 lần tính
  (mua 3 mm / bảng cắt lưỡi thật) trùng nhau; chỉ laser khác.
- **Mua sắt luôn theo lưỡi 3 mm, không nhân 1%, mua đúng theo sơ đồ cắt**; sắt mua dư so với bảng cắt **vào tồn tự do**, lệnh khác dùng, lần
  tính sau tự trừ (anh Nhân 07/11 - khớp thiết kế).
- **Chỗ ghi số mua (Bảo đề xuất, chưa chốt với A):** B chỉ đọc `PurchaseProposalItem.buyQty` của dòng sắt (+ `stockLengthMm`), không đọc
  `CuttingProposalLine.buyBars`; nhận hàng giữ chỗ cho PI tới đúng `buyQty`. Đề xuất: `buyQty` = số cây bảng cắt cần, số mua theo 3 mm ghi
  vào `orderQty` (không đổi schema, phần dư tự vào tồn chưa giữ). **Vướng:** `orderQty` hiện là số người mua tự tăng, và việc sửa câu 3 (dưới)
  lại xoá `orderQty` khi tính lại → phải phân biệt số hệ thống ghi với số người mua tăng. Chốt trong buổi 30 phút với B (câu 4).
  Giữ 2 quy ước của B: mỗi vật tư + cỡ cây chỉ 1 dòng NEW; không sửa dòng đã chốt.
- **Đổi chiều dài chuẩn** (anh Nhân 07/11): đề xuất mua chưa có Giám đốc ký → tính lại theo chiều dài mới + báo người mua; phiếu đã ký giữ
  chiều dài cũ, hàng về dùng như cây cũ trong kho. (Thêm vào thiết kế "đổi → thông báo Mua hàng".)
- **Xưởng → kho Phôi (điểm ghép ③):** B làm xong **12/11/2026** (ngày chuyển 9 kho + kiểm kê, anh Nhân chốt; sớm hơn dự kiến ~06/01/2027):
  thêm cột "kho Phôi" vào bảng xưởng, tạo kho Phôi Phước An, 1 hàm "xưởng → kho Phôi" (B báo tên hàm). Phú An → kho Phôi Phú An (tách từ
  `phoi-son-han` thành Phôi / Hàn / Sơn); Phước An → kho Phôi Phước An (mới; tồn Phước An chưa có trong phần mềm, kiểm kê + nhập 12/11).
- **Không làm màn thêm xưởng** (anh Nhân 07/11: ít khi thêm, IT thêm tay; xưởng mới = 1 kho Phôi + 1 kho Hàn riêng, Sơn / phụ kiện / thành
  phẩm dùng kho chung ở Phú An).
- **Vẫn chờ:** câu 2.4 (xưởng dự kiến lúc tính cắt) của anh Nhân.

## 7. Đợt 10a – Booking / Lịch xuất hàng (YC5, phần Sales) · nhánh `dot-10a-booking` (sau Đợt 1, 2)

**v8:** 5.1 ô theo bảng booking anh Nhân gửi · 5.2 chọn hàng theo lệnh SX từng SKU, kèm mã PO khách · 5.3 xếp cả hàng chưa xong, tới
ngày lấy cont / CUT OFF chưa đủ thì cảnh báo · 5.4 thường 1 booking = 1 cont, có ô số cont · chặn vượt số còn lại · tổng m³ so cont ·
5.6 gom về 1 kho TP · 5.8 "chưa đủ hàng" = đã đóng gói − đã xuất. (5.5, 5.7 kho xác nhận xuất + bỏ nút cũ = 10b của người B.)

**Thiết kế**
- DB (điểm ghép ④ - làm trước 2 ngày đầu): `Booking { id, bookingNo, customerId, containerType @default("40HC"), containerQty
  @default(1), pod, cutSiAt?, pickupDate?, cutOffAt?, etd?, pickupPlace?, vesselVoyage?, warehouseCode? (kho TP gom hàng), note?,
  attachments Json, status (DRAFT|CONFIRMED|SHIPPED|CANCELLED), createdById, timestamps }`, `BookingLine { id, bookingId,
  productionInvoiceItemId, salesOrderItemId, qty, shippedQty @default(0) }` (`shippedQty` để 10b ghi).
- Còn được xếp của 1 dòng SKU = SL dòng − đã xuất (`SalesOrderItem.shippedQty`, sau 10b là Σ `BookingLine.shippedQty`) − đã xếp ở booking
  khác chưa huỷ; kiểm trong transaction có khoá dòng (`SELECT … FOR UPDATE`) để 2 Sales không xếp vượt.
- m³ = Σ qty × thể tích thùng × số thùng/bộ (Đợt 1); so `containerVolumeM3 × containerQty`; thiếu kích thước → "chưa tính được m³ của
  SKU …".
- Cảnh báo hằng ngày: tới ngày lấy cont / CUT OFF (≤ 1 ngày) mà đã đóng gói − đã xuất < số xếp → `BOOKING_SHORT` tới Sales + KHSX + kho TP.
- API `/bookings` CRUD (Sales: SALES_ORDER:CREATE/UPDATE; xem: VIEW), `GET /bookings/candidates?customerId` (dòng SKU còn hàng, kèm mã PO
  khách = `SalesOrder.orderCode`, mã lệnh, đã đóng gói, còn lại). File đính kèm dùng `POST /uploads/document` có sẵn.
- FE Sales: mục sidebar "Lịch xuất hàng" (**đụng sidebar dùng chung**): dạng lịch tháng (tự làm, `date-fns`) + dạng bảng; form booking
  theo đủ ô v8; bảng chọn hàng (nhập SL từng dòng, chặn vượt, tổng m³ / % cont), CUT OFF tô nổi.
- Test: còn lại (đã xếp booking khác, huỷ booking trả lại), chặn vượt đồng thời, m³, cảnh báo chưa đủ hàng.

---

## 8. Điểm ghép với người B

| Điểm | Khi | A đưa | B dùng |
|---|---|---|---|
| ① | Đợt 2 (ngày đầu) | `lenhDisplayCode` (BE + FE), `Workshop` + `ProductionInvoiceItem.workshopId` | in phiếu (5c), chia kho (7) |
| ② | Đợt 3–4 | `materialNeedDateOf(item, group)` | chia hàng theo SKU (5d) |
| ③ | Đợt 7 của B | (B đưa) xưởng → kho Phôi | Đợt 8 xuất sắt |
| ④ | Đợt 10a | `Booking`, `BookingLine` | 10b xác nhận xuất, trừ tồn |
| ⑤ (mới, review mục 16 điểm 8) | trước Đợt 5 của B | — | 3 luồng tính số mua + giữ chỗ nằm trong `production-invoices` (A); B sửa số mua/đơn gộp/giữ chỗ theo SKU → thống nhất: A không đổi chữ ký 3 hàm tính mua trong lúc B làm 5a–5d. **Cập nhật 04/11:** B đã làm 5a bằng cột riêng `PurchaseProposalItem.orderQty` (số mua = max(buyQty, orderQty)) nên lần tính lại không ghi đè số B tăng; còn hở: tính lại làm buyQty GIẢM thì mua dư tăng lặng lẽ → đề xuất lần tính lại xoá `orderQty` của dòng bị đổi + báo người mua (cần B đồng ý, code ở phía A). **07/11: B đồng ý (A sửa ở phần tính lại), anh Nhân chốt cho MỌI vật tư:** phiếu chưa có Giám đốc ký → bỏ số người mua đã tăng, quay về số mới, báo người mua; phiếu đã ký → gọi 1 hàm B viết sẵn (báo người mua + Giám đốc, người mua tự quyết phiếu thay thế / nhận đủ, dư vào tồn tự do). B đã kiểm lỗi có thật (orderQty 110 giữ nguyên khi buyQty tính lại còn 50). |

## 9. Thứ tự và ước lượng (phần A)

Đợt 1 (3) → Đợt 2 (5) → Đợt 3 (10) → Đợt 4 (5) → Đợt 9 (7) → Đợt 8 (9, cần chốt V2-3) → Đợt 10a (7). Tổng ≈ 46 ngày công như kế hoạch
kỹ thuật. Mỗi đợt xong: commit nhánh đợt, báo người dùng, hỏi gộp.

## 10. Câu hỏi cần người dùng / anh Nhân chốt

**Người dùng đã trả lời 04/11 (theo vòng 4):** Q1 mỗi dòng SKU 1 số LSX riêng, không trùng toàn hệ thống (unique index) · Q2 lúc KHSX
gửi QLSX, mốc còn trống thì **tự lưu ngày đề xuất** · Q3 "Đóng gói N+14" là **ngày bắt đầu** (M4); ngày xong = M4 + Xđg − 1; hạn VT
còn lại = M4 − 7 · Q4 lệnh đã gửi Sếp/đã duyệt trước khi có xưởng → migration **gán mặc định Xưởng Phú An**, QLSX đổi được khi chưa
xuất sắt. Câu 1 dưới đây coi như đã chốt theo Q1; câu 2 (Đợt 8) và 3–5 vẫn mở.

Danh sách câu hỏi ban đầu:

1. **Đợt 2 – LSX trùng cho 2 SKU?** Sổ xưởng có "I41+42 LSX 323" (1 số cho 2 SKU). Plan theo v8 "không trùng": mỗi dòng SKU 1 số riêng.
   Nếu xưởng vẫn đánh chung 1 số cho 2 SKU của cùng lệnh gộp thì nới: cho trùng trong cùng 1 PI.
   **06/11:** file kế hoạch KHSX dùng 1 số LSX cho nhiều mã là thường ngày (LSX324, LSX182, LSX317, 319, 320, 323…) → đã hỏi lại anh Nhân
   (changelog 12-yeu-cau mục 30), chờ trả lời.
2. **Đợt 8 – xưởng chưa biết lúc tính cắt** (V2-3 ở mục 12): chọn "xưởng dự kiến" khi tính + tính lại nếu QLSX đổi xưởng?
3. **Đợt 3 – khoảng ngày Nhập đan / Chuyền kiểm** khi chỉ có 1 ngày mốc: tính X ngày kết thúc ở ngày đó (plan) hay dồn cả lệnh vào 1 ngày?
4. **Đợt 3 – giờ chốt cuối ngày** 18:00; Phôi "làm được trong ngày" ước tính theo tỷ lệ đoạn cắt.
5. **Đợt 1 – 68 ÷ (thể tích × số thùng/bộ)** khác chữ v8 "68 ÷ thể tích thùng" (đã nêu ở review mục 16).

## 11. Rủi ro

- Đụng code với người B ở file dùng chung (`schema.prisma`, `notification-types.ts`, `work-queue.service.ts`, sidebar): giữ khối riêng,
  gộp sớm, báo trước.
- Nhánh chồng (đợt sau tách từ đợt trước chưa gộp) → gộp đúng thứ tự; đợt trước bị sửa sau review thì rebase đợt sau (chỉ trên nhánh
  đợt của A, chưa push).
- Đợt 3 đổi nghĩa form "Sửa thời hạn" (thêm ngày bắt đầu) - dữ liệu cũ giữ nghĩa "ngày xong", mốc bắt đầu cũ để trống ("Chưa đặt").
- Đợt 8 đổi số cây mua - so sánh trước/sau trên bộ dữ liệu thật trước khi gộp.
- Hiệu năng: capacity + daily output đọc nhiều bảng mỗi 10 phút → tính theo khoảng 30 ngày, chỉ lệnh đang chạy, đo trên `dna_erp_parta`.

## 12. Tự đánh giá plan (3 vòng)

**Vòng 1 – đối chiếu từng điều v8 và code thật**
- V1-1 (sửa): bản nháp đặt LSX ở cấp PI; code cho thấy PI sinh lúc gom và "lệnh gốc" = dòng SKU (gộp = 2 dòng) → chuyển LSX xuống
  `ProductionInvoiceItem`, PI hiển thị nối số các dòng. Khớp "lệnh gộp hiện đủ số 2 lệnh gốc".
- V1-2 (sửa): bản nháp đổi xưởng theo dòng SKU; xuất sắt + giữ chỗ theo PI → đổi xưởng cho cả PI, chặn khi PI có `SteelIssue`.
- V1-3 (sửa): bản nháp coi ngày Phôi/Đóng gói là ngày bắt đầu (đúng công thức mới) → sẽ đổi nghĩa dữ liệu cũ và làm Bảng mốc chấm sai;
  đổi sang giữ "ngày xong" + thêm 2 loại mốc bắt đầu.
- V1-4 (sửa): KHSX không có quyền SKU:UPDATE/PRODUCT:UPDATE → endpoint load cont dùng `@RequireRole` 3 vai trò + SKU:VIEW, không thêm quyền
  (khỏi seed production).
- V1-5 (giữ): dòng mua không gắn dòng SKU → màn "Vật tư cần về" theo dòng mua, hạn = SKU gấp nhất đang dùng vật tư; chia theo SKU là của B
  (5d) qua điểm ghép ②.
- V1-6 (sửa): `work-queue`, sidebar, `notification-types` là file chung → ghi rõ "chỉ thêm khối" và báo.
- V1-7 (thêm): route sửa hạn đang cho WAREHOUSE_STAFF gọi → Đợt 9 thêm chặn vai trò, ghi là đụng hành vi có sẵn.

**Vòng 2 – thử luồng đầu–cuối và chỗ hở**
- V2-1 (sửa): đăng ký module mới ở `app.module.ts` sẽ kéo theo dòng `PieceSyncBoardModule` chưa commit vào nhánh đợt → module mới import
  vào module nghiệp vụ; file có thay đổi dở dùng `git merge-file` để stage đúng phần của đợt.
- V2-2 (sửa): `materials-due` để trong `PurchaseProposalsModule` là đụng module của B → để ở `MilestoneBoardModule` (A).
- V2-3 (nêu câu hỏi): Đợt 8 cần xưởng lúc tính cắt nhưng QLSX chọn xưởng SAU khi KHSX tính → câu hỏi 2 (mục 10). Đợt 8 không bắt đầu khi
  chưa chốt.
- V2-4 (sửa): đếm đặc cách dựa `line.overThreshold` sẽ sai (tính theo ngưỡng 100) → lưu `SteelWasteException` lúc Sếp duyệt, so ngưỡng
  thường đang áp dụng lúc đó.
- V2-5 (sửa): Đóng gói "1 thùng = 1 bộ" trong code hiện tại mâu thuẫn số thùng/bộ của Đợt 1 → Đợt 3 đổi đóng gói ra bộ = thùng ÷ số
  thùng/bộ CHỈ trong phép tính năng lực, KHÔNG đổi nghĩa `PackagingRecord` (ghi rõ trong Hướng dẫn; nếu sai nghĩa thì hỏi).
- V2-6 (thêm): 2 Sales xếp cùng dòng vào 2 booking cùng lúc → khoá dòng trong transaction (10a).
- V2-7 (thêm): cảnh báo hằng ngày có thể bắn quá nhiều → gom 1 tin/người/ngày.

**Vòng 3 – tính khả thi, kiểm thử, triển khai**
- V3-1 (sửa): thêm giá trị enum Postgres trong cùng transaction với câu dùng nó sẽ lỗi → migration thêm enum riêng, migration dùng sau.
- V3-2 (sửa): thêm `workshopId` bắt buộc ở DTO gửi Sếp làm FE cũ vỡ nếu BE lên trước → ghi rõ FE + BE của Đợt 2 lên cùng lúc (gộp chung).
- V3-3 (giữ): mỗi đợt có kiểm thử thật trên DB dựng từ backup production; Đợt 8 có so sánh số cây trước/sau.
- V3-4 (thêm): đề xuất cũ của Đợt 8 không có `purchaseTotalBars` → dùng `totalBars` (tương thích).
- V3-5 (thêm): nhánh chồng cần thứ tự gộp; ghi vào mục 0 + mục 11.
- Kết luận vòng 3: đủ để bắt đầu Đợt 1 và Đợt 2; Đợt 8 chờ câu 2.

**Vòng 4 – phản biện độc lập (1 trợ lý chỉ đọc soi plan với v8 + code; Opus kiểm lại các điểm cao).** Các sửa dưới đây THẮNG nội dung
cũ ở mục 0–7 khi trái nhau.
- V4-1 (cao, đã kiểm `node`): `floor(68 ÷ (L·W·H/10⁶))` sai do số thực (85×80×100 → 99, đúng là 100) → tính bằng số nguyên: kích thước
  ×10 (mm), thể tích cont ×10⁹ (mm³), `floor(A ÷ B)` với A, B nguyên (sai số chỉ khi thương là số nguyên - an toàn vì B ≤ 1,6·10¹¹).
  Cùng hàm ở BE và FE, test có thùng 85×80×100 và 50×40×85.
- V4-2 (cao): mapper trả response chạy đồng bộ, ~15 chỗ gọi → **lưu sẵn** `MfgProduct.loadCont` (số hiệu lực) + `boxVolumeM3` lúc ghi
  kích thước; Admin đổi thể tích cont → tính lại mọi `MfgProduct` trong cùng transaction. Response chỉ đọc cột (thêm `@Expose()` + chọn
  cột ở mọi `include/select` liên quan; 1 test `instanceToPlain`).
- V4-3 (cao, đã kiểm `LenhSXPage.tsx:509-516`): ngày đề xuất không bao giờ được lưu → cảnh báo/năng lực/Vật tư cần về rỗng. Cần chốt (câu
  hỏi Q2 mới): tự lưu ngày đề xuất lúc KHSX gửi QLSX, hay bắt KHSX nhập đủ 4 mốc neo. Hàm ngày cần vật tư dùng dự phòng đúng: M1 =
  (PHOI_START ?? FRAME_PHOI) − 1; M3 = (PACKAGING_START ?? PACKAGING) − 7.
- V4-4 (cao): N mặc định "Khung − 2" chỉ đúng khi X = 1 → N = PHOI_START đã lưu ?? FRAME_PHOI đã lưu (dữ liệu cũ, = N) ?? Khung − (X + 1)
  ?? Hạn giao − (14 + Xđg − 1 + 3). Luôn lưu M2, M4 khi lưu form. Giữ test hồi quy: X = 1 ra đúng ngày PI-2026-035 cũ.
- V4-5 (cao): lúc KHSX đặt mốc chưa biết xưởng → đề xuất theo xưởng của dòng nếu có, chưa có thì "xưởng dự kiến" Phú An; QLSX chọn xưởng
  khác xưởng đã dùng để đề xuất → hộp QLSX cảnh báo + báo KHSX đặt lại mốc. Xưởng DAYS_PER_CONT dùng X tính lại (không dùng khoảng đã lưu).
- V4-6 (cao, đã kiểm `:583-598`): `mergeItems`/`claimSolo` xoá `warehouseCode` nhưng plan quên `workshopId` → **xưởng đi cùng vòng đời
  `warehouseCode`**: mọi chỗ đặt `warehouseCode: null` đặt luôn `workshopId: null`; thêm vào `snapshotItemApproval`; đọc lại dòng sau khi ghi.
- V4-7 (cao): LSX cho 2 SKU quyết định migration → hỏi trước Đợt 2 (Q1). Mặc định: mỗi dòng 1 số, unique index.
- V4-8 (vừa): "1 PI = 1 xưởng" áp cho MỌI PI (không chỉ PI gộp) lúc gửi Sếp - vì xuất sắt/giữ chỗ theo PI.
- V4-9 (vừa): dòng đang WAITING_BOSS/APPROVED lúc lên bản chính chưa có xưởng → mặc định gán Phú An trong migration (Q4), QLSX đổi được.
- V4-10 (vừa): người không phải Admin không đọc được `SystemConfig` → 1 route `GET /system-config/planning-params` (chỉ cần đăng nhập)
  trả thể tích cont, tiền tố LSX, số ngày được về sớm, năng lực.
- V4-11 (vừa, đã kiểm `:2403`): `boxesPacked` bị chặn ≤ số bộ của lệnh → đang là **bộ** → KHÔNG chia số thùng/bộ (thay V2-5).
- V4-12 (vừa): ngưỡng ngày = min(1 cont, phần còn lại của công đoạn đầu ngày); công đoạn xong rồi không báo; PI gộp cộng cont từng SKU.
- V4-13 (vừa): cảnh báo (a)(b) trùng tin sáng đang có → gộp vào `MORNING_MATERIALS_DIGEST` / `MORNING_PRODUCTION_DIGEST`; (b) đổi sang
  đọc M2 (PHOI_START); (c) chấm ngày D lúc 07:00 ngày D+1 (thay giờ chốt 18:00, khỏi lỡ báo muộn buổi tối); chỉ báo dòng đã có PHOI_START
  (tránh "bão" cảnh báo ngày đầu với lệnh cũ).
- V4-14 (vừa): M3 = ĐG − 7 của Sếp 27/10 tính từ ngày Đóng gói ĐÃ LƯU (hiện là ngày xong) vs v8 "Đóng gói N+14" → hỏi Q3.
- V4-15 (vừa): công thức đề xuất còn dùng ở danh sách/hộp duyệt (`proposeFor`) → giữ 1 bản hàm thuần ở FE + 1 ở BE, cùng bộ ví dụ test
  (thay cho API suggest).
- V4-16 (vừa): Phước An: Phôi [N, N+X−1], Hàn [N+1, N+X], Sơn ở Phú An [N+2, N+X+1] (X = ⌈4·cont⌉); Sơn Phú An cộng cont (theo 10.12,
  không theo "2 lệnh cùng ngày" của 10.13 - ghi rõ).
- V4-17 (vừa): "Vật tư cần về" theo YC11 11.1 phải hiện hạn THEO TỪNG SKU → mỗi dòng mua có dòng con từng SKU (hạn riêng); số cần theo
  SKU chờ phần chia của B (5d). Truy vấn "dòng mua còn thiếu" do A viết, B sửa khi đổi cấu trúc (điểm ghép ⑥).
- V4-18 (vừa): e2e `golden-path` (đã commit) phải điền LSX + xưởng ở Đợt 2.
- V4-19 (vừa): FE/BE không lên cùng lúc được tuyệt đối → BE trả 400 rõ "phiên bản cũ, tải lại trang" khi thiếu LSX/xưởng.
- V4-20 (thấp): thêm nhãn mới vào `auditAndNotifyDeadlineChange`, data-health `MILESTONE_ORDER`, màn Phôi; báo QLSX khi đổi mốc (v8 YC2);
  12.5 tính cả `MaterialYieldIssue`; chặn vai trò Sếp (Đợt 9), Sales (10a); tên migration theo giờ thật; Đợt 8 thêm "cây cũ dùng tới hết"
  + đo thời gian giải gấp đôi.
- Kết luận vòng 4: **Đợt 1 làm được ngay** (V4-1, V4-2 đã đưa vào thiết kế). Đợt 2 cần Q1, Q4; Đợt 3 cần Q2, Q3; Đợt 8 cần câu 2 ở mục 10.
