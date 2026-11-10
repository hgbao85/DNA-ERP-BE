# Changelog – Phần A, Đợt 3: Mốc, năng lực 1,3 cont/ngày, cảnh báo (YC10) – 04–05/11/2026

Nhánh `dot-3-moc-nang-luc` (**05/11 đã commit `a4331d8` + gộp vào `main` `f3c3d50`, FE `798a82f` → `demo` `c9d6588`, đã push 05/11 09:52 (BE) – 09:55 (FE)** - changelog phần A mục 10) ở 2 worktree: BE `D:\DNA-ERP-BE-dot3` (cắt từ `origin/main` `376534c` - đã có Đợt 1, 2, 5a, 5b, 5c), FE
`D:\DNA-ERP-dot3` (cắt từ `origin/demo` `6774431`). 05/11 đã fetch lại: `main`/`demo` không có commit mới hơn nên không phải gộp.
Upstream của nhánh đã gỡ (không vô tình push lên main/demo). **Chưa commit** (người dùng tự commit / nhờ phiên gốc gộp).
Plan: `docs/ke-hoach-phan-a-12-yeu-cau-2026-11-04.md` mục 3 + vòng 4 (V4-3..V4-5, V4-11..V4-16, V4-20 thắng nội dung cũ); bản yêu cầu v8
YC10 mục 10.1–10.16.

## Mục lục
- 1. Đã làm
- 2. Quyết định thiết kế / lệch plan có lý do
- 3. Kiểm tra
- 4. Chưa làm / còn treo
- 5. Đụng phần có sẵn của file dùng chung
- 6. Danh sách file để commit
- 7. Môi trường thử

---

## 1. Đã làm

### 1.1 Ý nghĩa ngày + 2 mốc bắt đầu (DB)
- Các mốc công đoạn đang có giữ nghĩa **ngày phải XONG** (Bảng mốc chấm theo nghĩa này). Thêm 2 giá trị enum `ProdItemStageType`:
  `PHOI_START` (M2 – Bắt đầu Phôi = N), `PACKAGING_START` (M4 – Bắt đầu đóng gói) bằng **migration riêng**
  `20261104180000_add_stage_start_types` (Postgres không cho dùng giá trị enum mới trong cùng transaction).
- `SystemConfig.capacityContPerDay` (Decimal 4,2, mặc định 1,3) và `daysPerContPhuocAn` (Int, mặc định 4) - migration
  `20261104180100_add_capacity_config`. Admin sửa ở Cấu hình hệ thống; trả ở `GET /system-config/planning-params` (mọi người đăng nhập).

### 1.2 Công thức đề xuất mốc (1 hàm thuần BE + 1 FE, cùng bộ ví dụ test)
- BE `src/common/utils/timeline-suggest.util.ts`, FE `src/utils/phuAnTimeline.ts`. X (Phôi = Hàn = Sơn mỗi công đoạn) = Phú An
  ⌈cont ÷ 1,3⌉, Phước An ⌈4 × cont⌉; Xđg = ⌈cont ÷ 1,3⌉; tính bằng SỐ NGUYÊN (208 bộ load 80 = 2,6 cont ÷ 1,3 số thực ra 3 ngày, đúng
  là 2). N = N gõ ?? PHOI_START ?? Phôi xong − (X−1) ?? Khung − (X+1) ?? hạn giao − (Xđg+16). M1 = N−1; Phôi xong N+X−1; Hàn N+X;
  Sơn = Khung N+X+1; Nhập đan N+12; Chuyền kiểm N+13; M4 = N+14 (hoặc đã lưu); Đóng gói xong M4+Xđg−1; M3 = M4−7.
- Cảnh báo thứ tự (v8 10.14, chỉ báo không chặn): Nhập đan sớm hơn Sơn xong, Chuyền kiểm sớm hơn Nhập đan, Bắt đầu đóng gói sớm hơn
  Chuyền kiểm, ngày xong sớm hơn ngày bắt đầu, Đóng gói xong sau hạn giao.
- Test hồi quy: X = 1 ra đúng ngày PI-2026-035 cũ; ví dụ v8 (160/240/400 bộ → 2/3/4 ngày; Phước An 1,5 cont → 6 ngày; PI-040 M2 09/11 →
  Phôi xong 11/11). FE dùng cho form "Sửa thời hạn", thẻ SKU, hộp duyệt (`proposeFor`), hộp QLSX.

### 1.3 Lệnh SX (BE `production-invoices`)
- **Tự lưu ngày đề xuất khi KHSX gửi QLSX** (quyết định Q2): `sendItemToQlsx` / `sendBatchToQlsx` ghi MỌI mốc còn trống (M1, M3, 9 stage)
  theo công thức, xưởng của dòng (chưa có thì Phú An dự kiến). Không ghi đè mốc đã có (upsert `update: {}`), không đụng hạn giao.
  Lệnh gộp kiểm lại luật gộp sau khi ghi (vi phạm → 400 + gợi ý mở Sửa thời hạn, không đổi trạng thái). Audit
  `source: AUTO_FILL_ON_SEND_QLSX`, không gửi thông báo.
- **Báo KHSX đặt lại mốc** (V4-5): QLSX gửi Sếp / đổi xưởng mà X của xưởng mới ≠ X của xưởng đã dùng để đề xuất → thông báo mới
  `PI_TIMELINE_NEEDS_REPLAN` (1 tin/lệnh, chỉ báo, không chặn).
- Đổi mốc (`auditAndNotifyDeadlineChange`): nhãn "Nhập đan", "Chuyền kiểm", "Bắt đầu Phôi", "Bắt đầu đóng gói"; mọi lần đổi báo thêm
  QLSX (V4-20).
- Màn Lệnh SX Phôi: `order-summary` trả thêm `phoiStart`; FE hiện "Bắt đầu dd/MM · Xong dd/MM".
- Kiểm tra dữ liệu `MILESTONE_ORDER`: thêm Bắt đầu Phôi / Bắt đầu đóng gói vào thứ tự, đổi chữ "Đan" → "Nhập đan".

### 1.4 Năng lực - chỉ cảnh báo (module mới `src/modules/production-capacity/`)
- `production-capacity.ranges.ts`: khoảng ngày từng công đoạn từ mốc ĐÃ LƯU - Phôi [PHOI_START, Phôi xong], Hàn [N+1, Hàn xong], Sơn
  [N+2, Sơn xong] (nhóm theo xưởng; Sơn theo xưởng sơn: Phước An → Phú An, cộng cont); Nhập đan / Chuyền kiểm trải Xđg ngày kết thúc ở
  ngày mốc, Đóng gói [M4, Đóng gói xong] (nhóm theo kho đóng gói); Phước An Phôi/Hàn dùng X tính lại theo xưởng.
- `production-capacity.rules.ts`: cộng cont theo ngày; Phú An / kho > 1,3 → vượt; Phước An: từ 2 LỆNH SX (đếm theo PI - lệnh gộp 2 SKU
  cắt chung là 1 lệnh) cùng chiếm 1 ngày → vượt. Gộp ô vượt liên tiếp cùng tập lệnh thành 1 cảnh báo.
- `GET /production-capacity?from&to` (mặc định hôm nay + 13 ngày, tối đa 62) và `POST /production-capacity/check` (thử mốc / xưởng / kho
  chưa lưu, chỉ trả cảnh báo dính dòng thử). Quyền `PRODUCTION_INVOICE:VIEW` có sẵn (không phải seed quyền).
- FE: tab **"Năng lực"** trong "Tổng hợp lệnh SX" (`?view=nang-luc`): bảng 14 ngày × (xưởng/kho × công đoạn), ô đỏ khi vượt, bấm ô xem
  lệnh, khối cảnh báo, dòng vàng "SKU chưa có load cont"; điện thoại cuộn ngang trong bảng, cột đầu dính, thu hẹp còn 104 px.

### 1.5 Cảnh báo hằng ngày (gộp vào tin sáng có sẵn, không thêm loại tin)
- `MORNING_PRODUCTION_DIGEST`: "chưa bấm Bắt đầu" so theo M2 (lệnh cũ chưa có M2 thì như cũ); thêm "chưa bắt đầu Đóng gói" (tới M4 chưa
  đóng thùng nào, `packagingNotStarted`); thêm câu sản lượng hôm qua (`lowOutput`).
- `DailyOutputService.alertsForDay(hôm qua)`: chỉ dòng đã có PHOI_START; ngưỡng = min(1 cont, phần còn lại đầu ngày); xong rồi không báo;
  Phước An kiểm cuối mỗi khối 4 ngày. Nguồn: Hàn/Sơn báo mảnh (bỏ lần huỷ), Nhập đan nhận đan, Chuyền kiểm lần kiểm, Đóng gói bộ
  (không chia thùng/bộ - V4-11), Phôi ước tính theo tỷ lệ đoạn cắt (ghi "ước tính theo đoạn cắt").
- M1/M3 vật tư chưa đủ: tin `MORNING_MATERIALS_DIGEST` + cột Mua VT ở tin tiến độ đã báo sẵn - Đợt 3 chỉ cần M1/M3 được LƯU (nhờ 1.3).

### 1.6 Bảng mốc + FE khác
- Bảng mốc: thêm cột **Chuyền kiểm** (nguồn tiến độ chuyền kiểm theo mảnh), nhãn "Nhập đan", dòng "Bắt đầu dd/MM" dưới Phôi và Đóng gói.
- Form **"Sửa thời hạn"** (LenhSXPage): ô Bắt đầu Phôi, Chuyền kiểm, Bắt đầu đóng gói, "Phôi/Hàn/Sơn xong", "Đóng gói xong"; dòng
  "240 bộ · load cont 80 = 3 cont → … 3 ngày (Xưởng Phú An (dự kiến), 1,3 cont/ngày) · Đóng gói 3 ngày" (chưa có load cont → nền vàng
  "tạm tính 1"); đổi ô chốt thì ô đề xuất tính lại; **M2, M4 luôn được lưu khi bấm Lưu** (V4-4); khối cảnh báo thứ tự + năng lực
  (chỉ báo). Nhãn phụ ghi N+k / M4+k / M4−7 (không dùng "ĐG" để khỏi nhầm "Đóng gói xong").
- Hộp QLSX chọn kho & xưởng: cảnh báo "ở Xưởng Phước An Phôi/Hàn/Sơn cần 8 ngày mỗi công đoạn, mốc đang đặt theo Xưởng Phú An 2 ngày - gửi
  Sếp thì KHSX được báo để đặt lại mốc" + cảnh báo năng lực theo xưởng/kho đang chọn. Không chặn gửi.
- Cấu hình hệ thống: mục "Năng lực sản xuất (chỉ cảnh báo)" 2 ô. Hướng dẫn KHSX: bài mới "Mốc thời gian và năng lực 1,3 cont/ngày"; bài
  Bảng mốc sửa 9 → 10 mốc.

## 2. Quyết định thiết kế / lệch plan có lý do
- Bỏ API `POST /production-invoices/:id/timeline-suggest` (V4-15 thắng): 1 hàm thuần BE + 1 FE, cùng ví dụ test.
- N dự phòng từ Phôi xong đã lưu = `FRAME_PHOI − (X − 1)` (plan ghi "= N", đúng khi X = 1 như dữ liệu cũ; với X > 1 giữ nghĩa "Phôi phải
  xong ngày này"). M4 dự phòng = Đóng gói đã lưu − (Xđg − 1).
- Module `production-capacity` được import ở `DailyJobsModule` (không ở `ProductionInvoicesModule` như plan): module năng lực cần
  `ProductionInvoicesService` → import ngược thành vòng. Không sửa `app.module.ts`.
- Phước An "2 lệnh chồng ngày" đếm theo lệnh SX (PI), không theo dòng SKU - lệnh gộp 2 SKU cắt chung không tự báo chồng (Opus sửa khi
  review, có test).
- "Xưởng dùng để đề xuất" = xưởng đang lưu của dòng, chưa có thì Phú An; cảnh báo/thông báo đặt lại mốc chỉ khi số ngày X thật sự khác
  (vd 0,2 cont: Phú An 1 ngày = Phước An 1 ngày → không báo).
- Dự phòng M1 = (PHOI_START ?? FRAME_PHOI) − 1, M3 = M4 − 7 trong hàm ngày cần vật tư (V4-3 câu cuối) **để Đợt 4** (điểm ghép ②
  `materialNeedDateOf`): đổi `purchaseDeadlineOf` sẽ đổi "Theo dõi mua hàng" của người B. Lệnh mới đã có M1/M3 lưu sẵn nhờ tự lưu khi
  gửi QLSX.
- Luật gộp lệnh vẫn đọc `materialDeadline ?? FRAME` như cũ (không đổi sang Phôi).

## 3. Kiểm tra
- BE `npx jest` toàn bộ: 114/116 bộ xanh, 2417 test qua; chỉ `optimize-material.spec.ts` hỏng 4 test thời gian khi máy bận - chạy riêng
  **14/14 xanh**. Các module Đợt 3: production-capacity 58/58, production-invoices + system-config + data-health + steel-issues 494,
  milestone-board + daily-jobs + daily-output 81, timeline-suggest 17.
- BE `npx tsc --noEmit -p tsconfig.json`: chỉ 2 lỗi seed cũ (`prisma/seed-ghe-j55-full-bom.ts`, `prisma/seed-real-products.ts`).
  `npx nest build` qua. `eslint --fix` + `eslint` file đổi: 0 lỗi (13 cảnh báo `any` sẵn kiểu cũ trong spec).
- FE `npx tsc --noEmit` sạch; `npx vitest run` 31 file / 316 test xanh; eslint file đổi 0 lỗi (113 cảnh báo, phần lớn có sẵn).
- `prisma migrate diff` DB ↔ schema rỗng.
- **Chạy thử thật** BE 3034 + FE 3134 trên `dna_erp_dot3` (backup production 26/10 + migrate + seed-demo + dữ liệu `PA3-PI-A..K`):
  - API 34 trường hợp qua (`dot3-api-check.mjs`): planning-params; bảng năng lực ra đúng 8 cảnh báo (Phôi/Hàn/Sơn Phú An 2 cont > 1,3;
    Phước An 2 lệnh chồng ngày; Nhập đan / Chuyền kiểm / Đóng gói Kho thành phẩm vượt); Sơn Phước An nằm ở Sơn Phú An; SKU chưa có load
    cont; 400 khi ngày sai / quá 62 ngày; `check` B sang Phước An ra chồng lệnh, A chưa có xưởng không xét; KHSX gửi QLSX A → tự lưu đúng
    9 mốc + M1 15/11, M3 23/11, hạn giao giữ nguyên, có audit; QLSX gửi Sếp B ở Phước An → `PI_TIMELINE_NEEDS_REPLAN` "cần 6 ngày … đang đặt
    theo Phú An 2 ngày", KHSX nhận; KHSX sửa M2 + Chuyền kiểm → QLSX nhận tin đổi mốc; Bảng mốc 10 mốc + phoiStart/packagingStart + ô
    Chuyền kiểm; màn Phôi phoiStart; Admin đổi 1,5 / 5 → planning-params đổi, 0,05 và 2,5 → 400, KHSX → 403.
  - Tin sáng thật (BE bật việc hằng ngày): "1 lệnh chưa bắt đầu" (tới M2 04/11 còn PENDING), "1 lệnh chưa bắt đầu đóng gói" (tới M4
    03/11 chưa đóng thùng), "Đóng gói · Kho thành phẩm 04/11: làm 0,38/1 cont - MY-9308" (30 bộ / load 80).
  - Trình duyệt (khsx, qlsx, admin; 1024 px và điện thoại 375 px): tab Năng lực (ô đỏ, bấm ô xem lệnh, trang không tràn ngang); form Sửa
    thời hạn (đổi Khung 01/12 → các ô đề xuất tính lại; Lưu chỉ ghi Khung + M2 + M4; Gửi QLSX tự lưu đúng các ngày form đã hiện); hộp QLSX
    cảnh báo Phước An 8 ngày; Bảng mốc cột Chuyền kiểm + "Bắt đầu dd/MM"; Cấu hình mục năng lực. Console không lỗi.
  - Sửa sau khi thử: cột đầu bảng năng lực trên điện thoại thu còn 104 px (trước chỉ thấy 3 ngày); chữ "ô vượt" → "cảnh báo vượt năng
    lực"; nhãn ĐG → M4; xoá cảnh báo năng lực cũ khi mở form lệnh khác.

## 4. Chưa làm / còn treo
- 2 mặc định chờ anh Nhân (`docs/cau-hoi-xac-nhan-anh-nhan-2026-11-04.docx` câu 2.2–2.3): Nhập đan / Chuyền kiểm trải X ngày kết thúc ở
  ngày mốc (`SINGLE_DATE_STAGE_SPREAD_X_DAYS`), chấm "chưa đủ 1 cont" ngày D lúc 7h ngày D+1 (`DIGEST_HOUR_VN`) - đổi bằng hằng số ở
  `production-capacity.types.ts` / `daily-jobs.service.ts`.
- Phôi "làm được trong ngày" đang ƯỚC TÍNH theo tỷ lệ đoạn cắt; đồng bộ theo mảnh (mức 2, anh Nhân chốt 04/11) làm sau.
- Dự phòng M1/M3 trong hàm ngày cần vật tư → Đợt 4 (mục 2).
- Tin sáng vẫn ghi mã PI (`PA3-PI-I`) thay vì số LSX (hành vi có sẵn từ trước Đợt 2) - không đổi ở đợt này.
- Còn file rỗng `D:\jest-pc.log` do 1 thợ tạo nhầm ngoài repo (lệnh xoá của thợ bị chặn) - người dùng xoá tay nếu muốn.

## 5. Đụng phần có sẵn của file dùng chung
Chỉ THÊM khối chú thích "Phần A – Đợt 3", trừ các chỗ ghi **sửa**:
- `prisma/schema.prisma`: 2 giá trị enum `ProdItemStageType`, 2 cột `SystemConfig`.
- `src/modules/notifications/notification-types.ts`: `PI_TIMELINE_NEEDS_REPLAN` + params; `ProductionDigestNotificationParams` thêm
  `packagingNotStarted?`, `lowOutput?`; **sửa** tiêu đề tin sáng tiến độ (thêm 2 vế khi có số).
- `src/modules/daily-jobs/daily-jobs.module.ts`: import `ProductionCapacityModule`. `daily-jobs.service.ts`: **sửa** điều kiện "chưa bấm
  Bắt đầu" (theo M2), constructor thêm `DailyOutputService` (phiên Đợt 10a cũng sửa file này - khi gộp để ý).
- `production-invoices.service.ts`: **sửa** nhãn WEAVING/TRANSFER_CHECK, thêm QLSX vào người nhận đổi mốc, kiểu trả của
  `resolveWorkshopForSend`; thêm tự lưu khi gửi QLSX + báo đặt lại mốc.
- `milestone-board.rules.ts/.service.ts`: **sửa** nhãn "Đan" → "Nhập đan", thêm mốc CHUYEN_KIEM (10 mốc), 2 field dòng.
- `data-health.checks.ts`: **sửa** luật `MILESTONE_ORDER` (Mua VT khung so với Bắt đầu Phôi, Mua VT còn lại so với Bắt đầu đóng gói, chữ
  Nhập đan).
- `steel-issues.service.ts` (người B có thể đụng): chỉ chỗ dựng `order-summary` lấy thêm `PHOI_START`.
- `system-config` (DTO/service/planning-params): 2 trường.
- FE: `types/admin.ts`, `system-config-api.ts`, `types/containerLoad.ts`, `steel-issues-api.ts`, `milestone-board-api.ts`; **sửa**
  `phuAnTimeline.ts` (thay công thức cũ Khung−2 / hạn giao−17 bằng công thức theo X; X = 1 ra y hệt cũ), `LenhSXPage.tsx` (form, thẻ,
  hộp QLSX; danh sách xưởng nay tải cho cả KHSX), Hướng dẫn `productionPlan.ts` (bài Bảng mốc 9 → 10 mốc), `ThongKePagePlan.tsx` (chỉ
  thêm tab).
- Ngoài repo: `D:\DNA-ERP-BE\.claude\launch.json` thêm `be-3034-dot3`, `be-3034-dot3-daily`, `fe-3134-dot3` (thư mục `.claude/` không
  commit).

## 6. Danh sách file để commit
**BE** (`D:\DNA-ERP-BE-dot3`):
```
docs/changelog-2026-11-04-phan-a-dot-3.md
prisma/schema.prisma
prisma/migrations/20261104180000_add_stage_start_types/migration.sql
prisma/migrations/20261104180100_add_capacity_config/migration.sql
src/common/utils/timeline-suggest.util.ts
src/common/utils/timeline-suggest.util.spec.ts
src/modules/production-capacity/   (15 file: types, ranges, rules, service, controller, module, daily-output.*, dto/*, *.spec.ts)
src/modules/daily-jobs/daily-jobs.module.ts
src/modules/daily-jobs/daily-jobs.service.ts
src/modules/daily-jobs/daily-jobs.service.spec.ts
src/modules/data-health/data-health.checks.ts
src/modules/milestone-board/milestone-board.rules.ts
src/modules/milestone-board/milestone-board.service.ts
src/modules/milestone-board/milestone-board.service.spec.ts
src/modules/notifications/notification-types.ts
src/modules/production-invoices/production-invoices.service.ts
src/modules/production-invoices/production-invoices.service.spec.ts
src/modules/steel-issues/dto/pi-order-summary-response.dto.ts
src/modules/steel-issues/steel-issues.service.ts
src/modules/steel-issues/steel-issues.service.spec.ts
src/modules/system-config/dto/planning-params.dto.ts
src/modules/system-config/dto/system-config-response.dto.ts
src/modules/system-config/dto/update-system-config.dto.ts
src/modules/system-config/dto/update-system-config.dto.spec.ts
src/modules/system-config/system-config.service.ts
src/modules/system-config/system-config.service.spec.ts
```
**FE** (`D:\DNA-ERP-dot3`) - KHÔNG commit `next-env.d.ts`, `tsconfig.tsbuildinfo`:
```
src/hooks/usePlanningParams.ts
src/services/production-capacity-api.ts
src/services/milestone-board-api.ts
src/services/production-invoices-api.ts
src/services/steel-issues-api.ts
src/services/system-config-api.ts
src/types/admin.ts
src/types/containerLoad.ts
src/utils/phuAnTimeline.ts
src/utils/phuAnTimeline.test.ts
src/modules/pages/Admin/SystemConfigPage.tsx
src/modules/pages/Guide/content/productionPlan.ts
src/modules/pages/Manufacturing/CapacityView.tsx
src/modules/pages/Manufacturing/capacityView.utils.ts
src/modules/pages/Manufacturing/capacityView.utils.test.ts
src/modules/pages/Manufacturing/MilestoneBoardView.tsx
src/modules/pages/Manufacturing/ThongKePagePlan.tsx
src/modules/pages/Phoi/LenhSanXuatPhoi.tsx
src/modules/pages/ProductionPlan/LenhSXPage.tsx
```
Lưu ý khi deploy: 2 migration phải chạy trước khi BE mới lên; FE + BE nên lên cùng lúc (FE gửi stage mới `PHOI_START`/`PACKAGING_START`/
`TRANSFER_CHECK` - BE cũ đã nhận `TRANSFER_CHECK` nhưng chưa có 2 giá trị kia).

## 7. Môi trường thử
- DB `dna_erp_dot3` (container `dna-erp-be-postgres-1`): backup production 26/10 + `migrate deploy` + `seed-demo` + dữ liệu thử `PA3-`
  (script `pa3-seed.sql` ở scratchpad phiên; SKU `PA3-J55` load 80, `PA3-I3` load 100, `PA3-NOLC` chưa load cont; lệnh `PA3-PI-A..K`).
- BE worktree có `node_modules` RIÊNG (`pnpm install --frozen-lockfile`) vì `main` mới cần `exceljs` mà `node_modules` thư mục chính
  chưa có; thư mục chính không bị đụng.
- Chạy thử: `be-3034-dot3` (tắt việc hằng ngày), `be-3034-dot3-daily` (bật - để thử tin sáng), `fe-3134-dot3`.
