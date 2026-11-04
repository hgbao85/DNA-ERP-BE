# Changelog 2026-11-04 — Phần A, Đợt 2: số LSX + chọn xưởng cơ khí (V3-1, YC12 phần chọn)

> Trạng thái: **ĐÃ CODE + kiểm tra + chạy thử thật, ĐÃ GHÉP ĐỢT 1, CHƯA commit** (người dùng tự commit). Nhánh `dot-2-lsx-xuong` ở
> worktree BE `D:\DNA-ERP-BE-dot2` và FE `D:\DNA-ERP-dot2`; HEAD đã fast-forward lên `main` 4b7f899 / `demo` 032ec7b ("Gộp Đợt 1 – Load
> cont SKU", có cả Đợt 5a + 5b của người B), thay đổi Đợt 2 nằm trên đó chưa commit - xem mục 8. Plan:
> `docs/ke-hoach-phan-a-12-yeu-cau-2026-11-04.md` mục 2 + mục 12 (V4-6..V4-10, V4-18, V4-19). Changelog phần A chung:
> `docs/changelog-2026-11-04-phan-a-12-yeu-cau.md` (của Đợt 1, file riêng để 2 nhánh không đụng nhau).

## Mục lục
1. Đã làm - BE
2. Đã làm - FE
3. Quyết định trong lúc làm (khác/không có trong plan)
4. Kiểm tra
5. Đụng phần có sẵn của file dùng chung
6. Chưa làm / còn treo
7. Danh sách file của Đợt 2 (để commit)
8. Ghép Đợt 1 (+ Đợt 5b của B) vào nhánh Đợt 2

## 1. Đã làm - BE

**Vì sao:** v8 V3-1 - mã lệnh chính là số LSX nhà máy (MY-313, GP-176), KHSX gõ khi lập kế hoạch, bắt buộc trước khi gửi duyệt, không
trùng, tiền tố Admin cấu hình, lệnh gộp hiện đủ số 2 lệnh gốc, lệnh cũ giữ PI-2026-xxx và tìm theo cả hai. YC12 - QLSX chọn xưởng cơ khí
(Phú An, Phước An) cùng kho thành phẩm, bắt buộc mới gửi Sếp; lệnh gộp cùng 1 xưởng; đổi xưởng sau duyệt chỉ khi chưa xuất sắt, báo Sếp.

- **DB** - migration `20261104170000_add_lsx_and_workshop` (chỉ thêm):
  - bảng `workshops` + enum `WorkshopCapacityMode` (CONT_PER_DAY | DAYS_PER_CONT); chèn sẵn `PHU_AN` "Xưởng Phú An" và `PHUOC_AN` "Xưởng
    Phước An" (sơn ở Phú An - `paintWorkshopId`) → production có ngay sau `migrate deploy`, không cần seed;
  - `production_invoice_items.lsxCode` (unique toàn hệ thống - người dùng chốt Q1) + `workshopId` (FK, index);
  - **gán Xưởng Phú An cho mọi dòng đang WAITING_BOSS/APPROVED** (người dùng chốt Q4);
  - `system_config.lsxPrefixes TEXT[]` mặc định rỗng (= mọi tiền tố đúng dạng).
- **Điểm ghép ① cho người B** - `src/common/utils/lenh-code.util.ts`: `normalizeLsxCode` ("my 313" → "MY-313"), `isValidLsxCode`
  (`^[A-Z]{1,6}-\d{1,6}$`), `lsxPrefixOf`, `normalizeLsxPrefixes`, `lenhLsxCodes`, `lenhDisplayCode` (LSX các dòng nối " + ", chưa có thì
  mã PI), `loadLenhDisplayCodes(prisma, piIds)` (2 truy vấn cho nhiều PI - dùng khi in phiếu/chia kho).
- **Lệnh SX** (`production-invoices`):
  - `PATCH /production-invoices/:id/items/:itemId/lsx` `{lsxCode|null}` - KHSX/Admin. Dòng chưa duyệt sửa/xoá tự do; dòng đã duyệt chỉ
    ĐIỀN khi đang trống, đổi/xoá → 403 "nhờ Admin" (Admin làm được). Sai dạng / tiền tố ngoài cấu hình → 400; trùng → 409 nêu mã lệnh +
    SKU đang giữ số (bắt cả lỗi unique khi 2 người nhập cùng lúc). Ghi audit.
  - Bắt buộc LSX: `send-to-qlsx` và `send-to-qlsx-batch` thiếu số → 400 liệt kê mọi SKU thiếu (không gửi gì). Bước sau (gửi Sếp, duyệt)
    không chặn - lệnh cũ đang chờ không bị kẹt.
  - Gửi Sếp (`send-to-boss`, `send-to-boss-batch`) thêm `workshopId` bắt buộc: thiếu → 400 "phiên bản cũ, tải lại trang (F5)" (V4-19);
    xưởng không có/ngừng dùng → 400; **1 PI = 1 xưởng cho mọi PI** (V4-8): SKU khác của lệnh đã gửi ở xưởng khác → 409. Ghi `workshopId`
    cùng lệnh với kho thành phẩm; route lẻ trả dòng ĐỌC LẠI từ DB (V4-6).
  - `PATCH /production-invoices/:id/workshop` `{workshopId, reason}` - QLSX: đổi cho MỌI dòng của lệnh khi mọi dòng đã gửi Sếp/đã duyệt và
    lệnh chưa có `SteelIssue` lẫn `MaterialYieldIssue` (kiểm trước + trong transaction) → 409 "đã xuất sắt/vật tư". Audit từng dòng kèm lý
    do; thông báo mới `PI_WORKSHOP_CHANGED` tới Sếp + KHSX (người đổi không tự nhận).
  - `workshopId` đi cùng vòng đời `warehouseCode` (V4-6): `mergeItems`/`claimSolo` xoá cả 2; nhánh từ chối giữ nguyên như kho; thêm vào
    `snapshotItemApproval` (lịch sử duyệt). `lsxCode` đi theo dòng SKU (gộp/cắt riêng lại vẫn giữ).
  - Response: lệnh thêm `displayCode`, `lsxCodes`, `hasMaterialIssue` (chỉ danh sách/chi tiết, đếm bằng `_count` cùng truy vấn); dòng thêm
    `lsxCode`, `workshop {id, code, name}`. Tìm kiếm `?search=` khớp mã PI HOẶC số LSX của dòng.
- **Xưởng** - module mới `workshops`: `GET /workshops` (PRODUCTION_INVOICE:VIEW), import vào `ProductionInvoicesModule` (không đụng
  `app.module.ts`).
- **Cấu hình** - `lsxPrefixes` trong response/`PUT /system-config` (Admin; mỗi tiền tố 1–6 chữ cái, chuẩn hoá in hoa, bỏ trùng).
- **Bảng mốc** - mỗi dòng thêm `lsxCode` (của chính dòng SKU) và `displayCode` (của lệnh, 1 lần đọc cho cả bảng; lỗi thì rơi về mã PI).

## 2. Đã làm - FE

- Hợp đồng (Opus viết): `src/utils/lenhCode.ts` (cùng luật BE + `lsxCodeError`, `lineCode`, `matchesLenhSearch`, `parseLsxPrefixes`),
  `types/workshop.ts`, `services/workshops-api.ts`, `production-invoices-api.ts` (field mới; `sendPiToBoss`/`sendItemToBoss` thêm
  `workshopId`; `updateItemLsx`, `changePiWorkshop`), `hooks/useLsxPrefixes.ts`, component `LsxCodeInput` (ô "Số LSX": tiền tố + số, dán
  được cả "MY-313"), `ChangeWorkshopDialog` (chọn xưởng mới + lý do bắt buộc), `LenhCodeText` (không bẻ dòng giữa số LSX).
- **Lệnh sản xuất mới / Xử lý / Duyệt** (`LenhSXPage`):
  - Mã lệnh = số LSX (đậm) + mã PI nhạt; ô tìm "Tìm mã PI hoặc số LSX...".
  - KHSX: ô Số LSX từng dòng SKU ở chi tiết lệnh và ngay trong hộp "Gửi QLSX"; thiếu số → cảnh báo đỏ + khoá nút; danh sách có nhãn
    "Thiếu số LSX (n SKU)".
  - QLSX: nút "Chọn kho & xưởng", hộp "Chọn kho thành phẩm & xưởng cơ khí" có MỘT ô "Xưởng cơ khí (cả lệnh)" + kho từng SKU, đủ cả hai mới
    gửi; khối mới "Đã gửi Sếp — chờ duyệt" với nút "Đổi xưởng".
  - Sếp: đầu trang chi tiết hiện "Xưởng: …", hộp duyệt hiện LSX + xưởng từng SKU.
- **Tổng hợp lệnh SX** (`ThongKePagePlan`): mã lệnh theo LSX, dòng SKU hiện LSX của dòng; "Xưởng: …" ở chi tiết lệnh; QLSX "Đổi xưởng"
  (đã xuất sắt thì hiện "Đã xuất sắt — không đổi xưởng được"); KHSX bổ sung LSX cho dòng đã duyệt còn trống, Admin sửa được; tìm theo LSX.
- **Bảng mốc**: cột "Mã lệnh · SKU" hiện LSX của dòng (mã PI nhạt dưới), tìm theo LSX.
- **Cấu hình hệ thống**: nhóm "Lệnh sản xuất" - ô "Tiền tố số LSX" (vd `MY, GP`, sai thì báo đỏ và chặn Lưu).
- **Hướng dẫn**: bài mới "Số LSX và xưởng cơ khí" (`pp-so-lsx-xuong`); sửa bài KHSX lập lệnh (bước nhập LSX), bài QLSX (đổi tên "Chọn kho
  thành phẩm, xưởng & gửi duyệt", bước chọn xưởng), câu "Chọn kho sản xuất" cũ ở bài Sản lượng xưởng.
- **e2e `golden-path`** (V4-18): KHSX điền LSX (tiền tố EE / mục đầu danh sách, số theo thời gian) trước "Gửi QLSX"; QLSX chọn
  "Xưởng Phú An"; ô tìm mới.

## 3. Quyết định trong lúc làm

- **Một ô xưởng cho cả lệnh** (thay vì mỗi SKU 1 ô như chữ v8): mọi lệnh phải cùng 1 xưởng (V4-8), chọn từng dòng chỉ thêm cách chọn lệch.
  Mỗi thẻ SKU vẫn hiện chip xưởng đã chọn cạnh ô kho. BE vẫn kiểm 1 PI = 1 xưởng.
- **Màn theo lệnh** hiện mã lệnh gộp ("MY-313 + MY-314"); **màn theo dòng SKU** (Bảng mốc, dòng SKU trong lệnh) hiện LSX của chính dòng.
  Mã PI luôn hiện nhạt bên cạnh để đối chiếu và để e2e/thông báo cũ (theo mã PI) vẫn tìm được.
- Dòng đã ở WAITING_BOSS/APPROVED mà `workshopId` null (không có trên dữ liệu thật vì migration gán Phú An) không bị coi là "khác xưởng".
- `PUT /system-config` từ chối tiền tố có khoảng trắng (FE luôn gửi đã bỏ trắng) - không tự cắt ở BE.
- **GomDotCatPage không đổi**: plan nhắc "danh sách lệnh vừa tạo" nhưng màn hiện không có danh sách đó (tạo xong chuyển sang "Lệnh sản xuất
  mới", đã hiện LSX). Dòng chờ gom ở đó vẫn hiện mã đơn/mã PI.
- Không khoá dòng PI khi đổi xưởng (`SELECT … FOR UPDATE`): kiểm xuất sắt 2 lần (trước + trong transaction) thu hẹp cửa sổ đua, chưa chặn
  tuyệt đối - cùng mức các route xuất sắt hiện có.

## 4. Kiểm tra

- BE: `jest` toàn bộ - 2261 qua, 2 lỗi ở `cutting-proposals/solver-ts/optimize-material.spec.ts` (test bộ giải giới hạn 20 giây, máy bận
  thì trượt; chạy riêng còn 1 lỗi; log jest toàn bộ của Đợt 1 cũng hỏng đúng file này - **có sẵn, không liên quan Đợt 2**). Module liên quan:
  production-invoices 276 test (≈55 mới), workshops, system-config, milestone-board, lenh-code util - xanh. `tsc --noEmit` chỉ còn 2 lỗi
  seed cũ; `nest build` OK; eslint các file đổi 0 lỗi (cảnh báo `any` có sẵn). `prisma migrate diff` DB sau migration ↔ schema: rỗng.
- FE: `tsc --noEmit` sạch; `vitest` 29 file / 287 test qua (25 test mới cho `lenhCode`); eslint 0 lỗi. e2e chưa chạy (cần cả bộ BE/FE
  3001/3000 + solver giả).
- **Chạy thử thật** BE 3033 + FE 3133 trên DB riêng `dna_erp_dot2` (backup production 26/10 + `migrate deploy` + `seed-demo` + dữ liệu thử
  `PA2-PI-A..G`, `PA2B-PI-A..G` đủ trạng thái: chưa gửi, chờ QLSX, chờ Sếp, đã duyệt chưa/đã xuất sắt):
  - API 50 trường hợp qua (2 kịch bản): migration gán Phú An đúng 4 dòng; tiền tố; chuẩn hoá; sai dạng; trùng 409 nêu lệnh; KHSX 403 khi đổi
    dòng đã duyệt, Admin đổi được; gửi QLSX thiếu LSX 400 liệt kê; thiếu xưởng 400 "tải lại trang"; lệnh gộp 2 xưởng 409; đổi xưởng lệnh chờ
    Sếp / đã duyệt OK, đã xuất sắt 409, đang chờ QLSX 409; Sếp + KHSX nhận `PI_WORKSHOP_CHANGED`, QLSX không; Bảng mốc có LSX; audit có lý do.
  - Trình duyệt (khsx, qlsx, boss; khổ 800px và điện thoại 375px): danh sách/chi tiết hiện LSX, nhãn thiếu LSX, hộp Gửi QLSX khoá + báo trùng
    rõ, hộp chọn kho & xưởng, khối "Đã gửi Sếp" + Đổi xưởng, Tổng hợp lệnh SX (bổ sung LSX, "Đã xuất sắt — không đổi xưởng được"), Sếp thấy
    xưởng. Sửa sau khi thử: mã gộp bị bẻ giữa số ("GP-" / "201") → `LenhCodeText`; mã PI nhạt bị bẻ trên điện thoại; bỏ chip xưởng lặp ở
    từng dòng màn duyệt (đầu trang đã có "Xưởng: …"); câu "cả 1 SKU" trong hộp đổi xưởng.

## 5. Đụng phần có sẵn của file dùng chung

Chỉ THÊM khối có chú thích "Phần A – Đợt 2", trừ các chỗ ghi "sửa":
- `prisma/schema.prisma`: `SystemConfig.lsxPrefixes`, `ProductionInvoiceItem.lsxCode/workshopId/workshop` + index, model `Workshop` + enum.
- `src/modules/notifications/notification-types.ts`: `PI_WORKSHOP_CHANGED` + params.
- `system-config` (DTO response/update, service `update`): `lsxPrefixes`.
- `production-invoices.module.ts`: import `WorkshopsModule`.
- **Sửa hành vi có sẵn**: gửi QLSX giờ bắt buộc có LSX; gửi Sếp bắt buộc `workshopId` (FE + BE phải lên CÙNG LÚC - BE thiếu field trả 400 rõ
  ràng); chữ ký `sendItemToBoss`/`sendBatchToBoss` (service) và `sendPiToBoss`/`sendItemToBoss` (FE api) thêm tham số xưởng.
- `daily-jobs.service.spec.ts`: dòng mẫu `MilestoneRow` thêm 2 field mới (chỉ test).
- FE: `types/admin.ts`, `services/system-config-api.ts` (`lsxPrefixes`), `production-invoices-api.ts`; Hướng dẫn `productionPlan.ts` (bài
  mới + sửa 2 bài QLSX/KHSX), `manufacturing.ts` (1 câu "Chọn kho sản xuất" → "Chọn kho & xưởng"); e2e `golden-path.spec.ts`.
- Đổi chữ trên giao diện: "Chọn kho sản xuất" → "Chọn kho & xưởng"; tiêu đề hộp "Chọn kho thành phẩm" → "Chọn kho thành phẩm & xưởng cơ
  khí"; ô tìm "Tìm mã PI..." → "Tìm mã PI hoặc số LSX..."; nhãn "Mã PI" → "Mã lệnh" ở hộp QLSX/duyệt, cột Tổng hợp lệnh SX và Bảng mốc.

## 6. Chưa làm / còn treo

- ~~Chưa ghép Đợt 1~~ → **đã ghép** (mục 8), `lsxPrefixes` đã vào `planning-params`.
- **FE + BE Đợt 2 phải lên CÙNG LÚC** (gửi Sếp bắt buộc `workshopId`; FE cũ gọi BE mới bị 400 "tải lại trang").
- Các màn khác (xưởng, kho, thông báo cũ, in phiếu, GomDotCat…) vẫn hiện mã PI - người B dùng `lenhDisplayCode`/`loadLenhDisplayCodes` khi
  in phiếu (5c), chia kho (7).
- Ảnh chụp Hướng dẫn `pp-lenh-sx-qlsx.png` còn là bản cũ (nút "Chọn kho sản xuất").
- e2e `golden-path` đã sửa nhưng chưa chạy.
- Chưa có màn quản lý danh mục xưởng (thêm/sửa xưởng) - chỉ 2 xưởng chèn sẵn.

## 7. Danh sách file của Đợt 2 (để commit)

BE (`D:\DNA-ERP-BE-dot2`): `prisma/schema.prisma`, `prisma/migrations/20261104170000_add_lsx_and_workshop/migration.sql`,
`src/common/utils/lenh-code.util.ts`, `src/common/utils/lenh-code.util.spec.ts`, `src/modules/workshops/**` (6 file),
`src/modules/production-invoices/{production-invoices.service.ts, production-invoices.service.spec.ts, production-invoices.controller.ts,
production-invoices.controller.spec.ts, production-invoices.module.ts}`, `src/modules/production-invoices/dto/{send-to-boss.dto.ts,
production-invoice-response.dto.ts, production-invoice-item-response.dto.ts, update-item-lsx.dto.ts, change-workshop.dto.ts}`,
`src/modules/system-config/{dto/system-config-response.dto.ts, dto/update-system-config.dto.ts, system-config.service.ts,
system-config.service.spec.ts}`, `src/modules/milestone-board/{milestone-board.service.ts, milestone-board.service.spec.ts}`,
`src/modules/notifications/notification-types.ts`, `src/modules/daily-jobs/daily-jobs.service.spec.ts`,
`docs/changelog-2026-11-04-phan-a-dot-2.md`.

FE (`D:\DNA-ERP-dot2`): `src/utils/lenhCode.ts`, `src/utils/lenhCode.test.ts`, `src/types/workshop.ts`, `src/services/workshops-api.ts`,
`src/hooks/useLsxPrefixes.ts`, `src/components/{LsxCodeInput.tsx, ChangeWorkshopDialog.tsx, LenhCodeText.tsx}`,
`src/services/{production-invoices-api.ts, system-config-api.ts, milestone-board-api.ts}`, `src/types/admin.ts`,
`src/modules/pages/ProductionPlan/LenhSXPage.tsx`, `src/modules/pages/Manufacturing/{ThongKePagePlan.tsx, MilestoneBoardView.tsx}`,
`src/modules/pages/Admin/SystemConfigPage.tsx`, `src/modules/pages/Guide/content/{productionPlan.ts, manufacturing.ts}`,
`e2e/golden-path.spec.ts`.

Sau khi ghép Đợt 1 có thêm (file của Đợt 1, chỉ thêm 1 field): BE `src/modules/system-config/dto/planning-params.dto.ts`; FE
`src/types/containerLoad.ts`.

KHÔNG đưa vào commit: `next-env.d.ts` (do `next dev` tự đổi đường dẫn), `tsconfig.tsbuildinfo` (bộ đệm `tsc`).

## 8. Ghép Đợt 1 (+ Đợt 5b của B) vào nhánh Đợt 2

**Vì sao:** phiên gốc báo Đợt 1 đã commit và gộp vào `main` 4b7f899 / `demo` 032ec7b ở máy (có cả Đợt 5b của B); Đợt 2 cần route
`planning-params` của Đợt 1 và phải nằm trên đúng nền đó trước khi người dùng commit.

**Cách làm (không tạo commit, không stash):** lưu `git diff` + bản chép đầy đủ mọi file Đợt 2 ra thư mục tạm → trả các file đang sửa về
HEAD → `git merge --ff-only main` / `demo` (fast-forward, không commit) → trộn 3 chiều từng file bằng `git merge-file` (gốc faf75fe / 13b75bb,
bản nhánh chính, bản Đợt 2); file nhánh chính không đổi thì chép lại bản Đợt 2. File mới (chưa theo dõi) không bị đụng.
- BE: 5 file trộn sạch (`production-invoices.service.ts`, 4 file system-config), 2 xung đột tự gỡ: `schema.prisma` (Đợt 1 căn lại cột khối
  `ProductionInvoiceItem` - giữ căn cột mới + thêm `lsxCode/workshopId/workshop`), `production-invoice-item-response.dto.ts` (giữ import
  `ContainerLoadDto`).
- FE: 5 file trộn sạch, `LenhSXPage.tsx` 3 xung đột cùng kiểu "hai bên chèn cùng chỗ" (import + 2 vị trí `ContainerLoadHint` của Đợt 1 cạnh
  chip LSX/ô LSX của Đợt 2) - giữ cả hai.
- Thêm `lsxPrefixes` vào `GET /system-config/planning-params` (`PlanningParamsDto` + service + test) và kiểu FE `PlanningParams`;
  `useLsxPrefixes` đọc qua `getPlanningParams()` của Đợt 1.
- DB `dna_erp_dot2`: `migrate deploy` thêm `20261104110000_add_supplier_orders` (B) + `20261104150000_add_mfg_product_container_load`
  (Đợt 1) - áp sau migration Đợt 2 vẫn được; `prisma migrate diff` DB ↔ schema rỗng; `prisma generate`.

**Kiểm tra lại:** BE `tsc` chỉ 2 lỗi seed cũ, `nest build` OK, eslint 0 lỗi, `jest` toàn bộ 2302 qua - 3 lỗi chỉ ở file test bộ giải
`optimize-material.spec.ts` (giới hạn 20 giây, máy đang bận - có sẵn, như mục 4). FE `tsc` sạch, `vitest` 30 file / 300 test (có test của
Đợt 1), eslint 0 lỗi. Diff Đợt 2 giữ đúng kích thước như trước khi ghép (không đổi cả file vì kết thúc dòng). Chạy thử thật BE 3033 + FE
3133: KHSX đọc `planning-params` có `containerVolumeM3` 68 + `lsxPrefixes` ["MY","GP"]; dòng lệnh có cả `containerLoad` (Đợt 1) và
`lsxCode`/`workshop`; thiếu xưởng vẫn 400; tiền tố ngoài cấu hình 400; trên trình duyệt ô tiền tố đã thành danh sách MY/GP, đứng cùng dòng
"Chưa có load cont" của Đợt 1.
