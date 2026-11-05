# Changelog – Phần A, Đợt 9 (phần 1): sửa kế hoạch ở mọi giai đoạn + Excel + Sếp duyệt lại (YC2) – 05/11/2026

Nhánh `dot-9-sua-ke-hoach` ở 2 worktree: BE `D:\DNA-ERP-BE-dot9` (cắt từ `origin/main` `59f828c` = đã có Đợt 4 + 5d), FE `D:\DNA-ERP-dot9`
(cắt từ `origin/demo` `136a1a3`). **Phần 1 (theo phương án IT đề xuất cho 4 câu chờ Sếp) commit trên nhánh + gộp `--no-ff` vào `main` / `demo`
05/11, sau Đợt 5d phần 2 của người B (chưa push).** Phần 2 = đổi theo câu trả lời của Sếp + file Excel mẫu (mục 3). Plan: `docs/ke-hoach-phan-a-12-yeu-cau-2026-11-04.md` mục 5, **5b**; bản yêu cầu v8 YC2
(2.1–2.4). 4 câu xin Sếp chốt: `docs/cau-hoi-sep-dot-9-sua-ke-hoach-2026-11-05.docx` - **chưa có câu trả lời**, code theo phương án IT đề xuất
(đổi nhanh được - mục 3).

## Mục lục
- 1. Đã làm (BE, FE)
- 2. Quyết định thiết kế / lệch plan có lý do
- 3. Phụ thuộc 4 câu đang chờ Sếp - chỗ đổi khi Sếp trả lời
- 4. Kiểm tra
- 5. Chưa làm / còn treo
- 6. Đụng phần có sẵn của file dùng chung
- 7. Danh sách file để commit
- 8. Môi trường thử

---

## 1. Đã làm

### 1.1 BE
- **DB** (migration chỉ-thêm `20261105130000_add_deadline_change_batches`): enum `DeadlineChangeSource` (MANUAL / EXCEL),
  `DeadlineChangeBatchStatus` (PENDING / DECIDED / CANCELLED), `DeadlineChangeRequestStatus` (PENDING / APPROVED / REJECTED / CANCELLED); bảng
  `deadline_change_batches` (người gửi, lúc gửi, người / lúc / ghi chú quyết, ghi chú lô, `idempotencyKey` unique) + `deadline_change_requests`
  (dòng SKU, trạng thái, `oldValues` / `newValues` JSON chỉ các mốc đổi). **Unique index một phần** "mỗi dòng SKU ≤ 1 yêu cầu PENDING"
  (`WHERE status = 'PENDING'`) - hàng rào cuối nếu 2 người lưu cùng lúc.
- **Luật ghi** (`DeadlineChangesService`, `deadline-changes/`): dòng SKU chưa duyệt → ghi thẳng như cũ; dòng Sếp đã duyệt → 1 lô chờ Sếp duyệt lại
  (mốc cũ vẫn chạy), bỏ hạn giao (2.4); lệnh Kết thúc / PI huỷ → lỗi; dòng đang chờ → lỗi "Huỷ yêu cầu cũ rồi mới sửa lại được"; luật gộp tính trên
  giá trị DỰ KIẾN của cả lệnh gộp (hiện tại + đổi lần này + yêu cầu chờ); cảnh báo thứ tự mốc (cùng thứ tự `MILESTONE_ORDER`,
  `src/common/utils/milestone-order.util.ts`). Ghi trong 1 giao dịch, khoá nghiệp vụ theo dòng + lệnh (thứ tự cố định), kiểm lại trong giao dịch.
- **Đường ghi mốc dùng chung** `item-deadline-writer.service.ts` (tách từ `ProductionInvoicesService`: ghi mốc, luật gộp + biến thể "dự kiến",
  audit + `PI_ITEM_DEADLINE_CHANGED` có ghi chú "Sếp đã duyệt") - hành vi cũ giữ nguyên.
- **Route cũ** `PATCH /production-invoices/:id/items-deadlines` và `PATCH :id/items/:itemId`: tách dòng chưa duyệt (ghi thẳng, kể cả hạn giao) / đã
  duyệt (vào lô, kiểm trước khi ghi gì); hạn PI chỉ ghi khi PI không có dòng đã duyệt; trả thêm `deadlineSave { applied, batch, skipped }` (dòng ghi
  thẳng cũng có cảnh báo thứ tự mốc - Opus thêm khi review). **Chỉ KHSX + Admin** (`@RequireRole`) - thủ kho có quyền UPDATE trước đây gọi được.
  Mỗi item trong response PI có `pendingDeadlineChange`.
- **Route mới** `/deadline-changes`: `GET /` (`status`, `mine`), `GET /:id` (xem), `POST /:id/decide` (Sếp: `approveRequestIds` + `rejectReason` -
  yêu cầu không chọn bị từ chối, cần lý do ≥ 3 ký tự; kiểm mốc hiện tại = lúc gửi, lệch → 409; lệnh huỷ / Kết thúc lúc duyệt → 409), `POST
  /requests/:requestId/cancel` (người gửi / Admin), `GET /items/:itemId/history` (lịch sử: sửa thẳng từ audit + gửi / duyệt / từ chối / huỷ).
- **Excel** (`deadline-plan-excel.service.ts`, `deadline-plan.controller.ts`, exceljs): `GET /deadline-plan/export?scope=all|approved` (KHSX,
  Admin, Sếp) → file `ke-hoach-san-xuat-YYYYMMDD-HHmm.xlsx`: sheet "Kế hoạch" (Mã lệnh · SKU · Tên · SL · Xưởng · Trạng thái · 11 mốc · Hạn giao chỉ
  xem · 2 cột ẨN mã dòng + giá trị lúc xuất), sheet ẩn `_dna` đánh dấu file, sheet khoá (chỉ ô mốc của dòng sửa được mở, tô vàng nhạt), ngày Excel =
  nửa đêm UTC của ngày VN. `POST /deadline-plan/preview` (file ≤ 2 MB, ≤ 2.000 dòng, chỉ file của hệ thống) → so ô với giá trị LÚC XUẤT (ô trống =
  giữ nguyên), đọc ngày nhiều kiểu + số serial, lỗi từng dòng. `POST /deadline-plan/commit` (bắt buộc `Idempotency-Key`; gửi lại không tạo lô thứ 2).
- **Thông báo**: `DEADLINE_CHANGE_PENDING` (Sếp, ACTION_REQUIRED, link "Tổng hợp chờ duyệt › Đổi mốc lệnh SX", tự đóng khi quyết / huỷ),
  `DEADLINE_CHANGE_DECIDED` (KHSX người gửi: duyệt X/Y, từ chối + lý do). Sau khi Sếp duyệt: `PI_ITEM_DEADLINE_CHANGED` tới Mua hàng / QLSX / Kho / tổ như
  sửa thẳng. **Badge** Sếp `bossDeadlineChange` (số lô chờ). **Bảng mốc** `MilestoneRow.pendingDeadlineChange`.

### 1.2 FE
- `LenhSXPage` (KHSX): tab **"Đang lập (n) / Đang chạy (n)"** (Đang chạy = PI có SKU đã duyệt chưa Kết thúc); nhãn "N SKU chờ Sếp duyệt lại" trên dòng;
  nút **Tải Excel kế hoạch / Tải lên Excel**; form "Sửa thời hạn": dòng đã duyệt có dải xanh "lưu sẽ gửi Sếp duyệt lại, mốc cũ vẫn chạy", hạn giao chỉ
  xem; dòng đang chờ có khung vàng (giờ gửi, mốc cũ → mới, nút **Huỷ yêu cầu**), ô khoá; dòng Kết thúc khoá; nút **Lịch sử đổi mốc**; sau Lưu báo "Đã lưu
  N SKU. M SKU đã gửi Sếp duyệt lại" + cảnh báo vàng. Dòng đã duyệt chỉ gửi ô KHSX thật sự sửa (ô "đề xuất" không tự sinh yêu cầu).
- `DeadlinePlanImportModal` (xem trước Excel: 4 số đếm, bảng dòng / lệnh / SKU / loại / mốc cũ → mới / lỗi đỏ / cảnh báo vàng, Xác nhận → kết quả),
  `DeadlineHistoryModal`.
- Sếp: `BossApp` "Tổng hợp chờ duyệt" thêm nút lọc **"Đổi mốc lệnh SX"** (badge, đọc `filter=doi-moc` trên URL); màn mới `DuyetDoiMocPage`: mỗi lô (Sửa tay /
  Excel + ghi chú, người gửi, lúc gửi) bảng lệnh / SKU / SL / mốc cũ → mới / cảnh báo, ô chọn từng yêu cầu (bỏ chọn = từ chối, bắt buộc lý do), Duyệt (N) /
  Từ chối…, tab "Đã quyết"; màn hẹp thành thẻ. `MilestoneBoardView` nhãn "Chờ Sếp duyệt đổi mốc".
- `useWorkQueue` trả thêm `refresh` - màn Sếp duyệt xong tải lại số nhắc việc ngay (Opus thêm khi review: trước đó số chỉ đổi sau lượt poll 30–120 s).
- Hướng dẫn trong app: bài "Sửa kế hoạch lệnh đang chạy và Excel" (KHSX), "Duyệt đổi mốc lệnh SX" (Sếp).

## 2. Quyết định thiết kế / lệch plan có lý do
- Xuất / đọc Excel ở BE bằng `exceljs`, KHÔNG đọc ở FE: `xlsx` 0.18.5 của FE có lỗi bảo mật khi đọc file lạ (CVE-2023-30533, CVE-2024-22363).
- So ô Excel với giá trị LÚC XUẤT (cột ẩn) chứ không với DB: ô không sửa không bao giờ ghi; ô sửa mà DB đã đổi sau lúc tải file → lỗi dòng (V9-1).
- Trạng thái theo TỪNG yêu cầu (lô = PENDING / DECIDED / CANCELLED) để cùng 1 BE chạy được cả 2 cách duyệt của câu 4.
- Ô trống trong Excel = giữ nguyên (không xoá mốc qua Excel / form).
- Cảnh báo thứ tự mốc gộp: nhiều mốc sau cùng sớm hơn 1 mốc → 1 câu "Hàn (07/12) muộn hơn các mốc sau nó: Sơn (09/11), Khung (09/11), …" (Opus đổi khi
  xem thử: trước 1 lần dời ra 7 câu).
- Lưu hỗn hợp (dòng chưa duyệt + dòng đã duyệt trong 1 lần): dòng đã duyệt được kiểm TRƯỚC khi ghi gì; nếu lỗi ở bước tạo lô sau cùng (2 người đua nhau
  đúng lúc) thì phần chưa duyệt đã ghi - hiếm, chấp nhận.
- File xuất trả bằng `@Res()` (không qua interceptor bọc JSON) + `Access-Control-Expose-Headers: Content-Disposition`.

## 3. Phụ thuộc 4 câu đang chờ Sếp - chỗ đổi khi Sếp trả lời
| Câu | Đang làm (IT đề xuất) | Đổi nếu Sếp chọn khác |
|---|---|---|
| Q9-1 dời 1 mốc có tự dời mốc sau | A - chỉ ô đã sửa + cảnh báo | B: thêm bước tự dời mốc sau cùng số ngày ở `DeadlineChangesService` (form + Excel) |
| Q9-2 thứ tự ngược | A - cảnh báo, vẫn lưu | B: `ORDER_VIOLATION_BLOCKS = true` (`deadline-changes.types.ts`) |
| Q9-3 Excel gồm | A - mọi lệnh chưa Kết thúc (`scope=all`) | B: FE gọi `downloadDeadlinePlan('approved')` |
| Q9-4 lô có lệnh không đồng ý | B - Sếp bỏ chọn từng yêu cầu | A: `DEADLINE_PARTIAL_APPROVAL = false` (`deadline-changes-api.ts`) |

## 4. Kiểm tra
- **BE** (worktree, sau khi Opus nối Excel vào module): `nest build` OK; `tsc` chỉ 2 lỗi seed cũ; `jest --runInBand` toàn bộ **132 suite / 2672 test
  xanh** (1 skip có sẵn); eslint file đổi 0 lỗi.
- **FE**: `tsc` sạch; `vitest` **36 file / 365 test xanh**; eslint file đổi 0 lỗi (cảnh báo có sẵn).
- **API thật** (BE 3038, `dna_erp_dot9`, tài khoản demo): thợ lõi - `khsx` sửa lệnh chưa duyệt ghi thẳng, lệnh đã duyệt ra lô (DB chưa đổi), sửa lại dòng
  đang chờ 400, `khotp` 403, `boss` duyệt 1 + từ chối 1 có lý do (thiếu lý do 400) → mốc đổi đúng dòng duyệt, badge về 0, KHSX nhận "Sếp đã duyệt đổi mốc
  1/2 SKU", lịch sử 3 mục, huỷ yêu cầu → lô CANCELLED. Opus - **Excel đầu-cuối**: xuất 22 dòng (lệnh Kết thúc MY-9405 không có), cột ẩn + sheet khoá; sửa
  file → xem trước: MY-9311 (chưa duyệt) ghi thẳng, MY-9303 (đã duyệt) chờ Sếp, ô "31/13/2026" lỗi ngày, MY-9404 dời mốc vật tư khung ra 20/11 → lỗi luật gộp
  (2 SKU cách 13 ngày); Xác nhận 2 lần cùng khoá → 1 lô; thiếu khoá → 400; tải lại file cũ → dòng đang chờ báo lỗi.
- **Trình duyệt** (FE 3138): `khsx` tab Đang chạy 12 lệnh, MY-9303 "1 SKU chờ Sếp duyệt lại"; MY-9402 sửa "Bắt đầu Phôi" → "1 SKU đã gửi Sếp duyệt lại", nhãn
  trên dòng, mốc chưa đổi; mở lại form: khung vàng + Huỷ yêu cầu, ô khoá; Lịch sử đổi mốc 1 mục. `boss` "Tổng hợp chờ duyệt" 3 (1 lệnh + 2 đổi mốc), 2 lô (Excel,
  Sửa tay); Duyệt lô sửa tay → MY-9402 Bắt đầu Phôi = 08/11 trong DB; Từ chối lô Excel có lý do; tab Đã quyết đúng; Bảng mốc nhãn "Chờ Sếp duyệt đổi mốc"
  trên MY-9401; duyệt xong số nhắc việc giảm ngay (sau khi thêm `refresh`).

## 5. Chưa làm / còn treo
- 4 câu Sếp (mục 3) - có câu trả lời thì đổi + chạy lại test.
- File Excel kế hoạch mẫu của KHSX (nếu Sếp gửi) → đổi tên / thứ tự cột của file xuất.
- Tab "Đang chạy" tính từ danh sách PI FE đang tải (`limit=100` có sẵn) - lệnh cũ ngoài 100 lệnh mới nhất không hiện (chưa gặp ở dữ liệu thật).
- Chưa mở file Excel bằng Microsoft Excel thật (khoá ô / ẩn cột mới kiểm bằng đọc lại qua exceljs).
- `MilestoneRow.pendingDeadlineChange` để tuỳ chọn vì spec daily-jobs dựng tay `MilestoneRow`.
- Báo người B khi gộp: route sửa mốc chỉ còn KHSX / Admin (thủ kho mất quyền gọi - không màn kho nào gọi); `useWorkQueue` thêm `refresh`.

## 6. Đụng phần có sẵn của file dùng chung
- `schema.prisma` (3 enum, 2 model, 3 quan hệ ngược ở `User` / `ProductionInvoiceItem`), `notification-types.ts` (2 loại mới + `note?` của
  `PI_ITEM_DEADLINE_CHANGED`), `work-queue.service.ts` (khoá `bossDeadlineChange`), `milestone-board.service.ts` (cờ chờ duyệt).
- `production-invoices.service.ts` (tách 3 hàm ra writer, constructor thêm 2 tham số, 2 hàm sửa mốc nhận actor + tách dòng, include yêu cầu chờ),
  `.controller.ts` (`@RequireRole` + `@CurrentUser`), `.module.ts` (đăng ký 2 controller + 3 provider mới), 2 DTO response.
- FE: `LenhSXPage.tsx` (dùng chung với Sếp - chỉ phần KHSX), `production-invoices-api.ts` (`updateProductionInvoiceItemsDeadlines` trả `{ pi, deadlineSave }`),
  `BossApp.tsx`, `MilestoneBoardView.tsx`, `milestone-board-api.ts`, `useWorkQueue.ts` (`refresh`), Guide `productionPlan.ts`, `boss.ts`.

## 7. Danh sách file để commit
**BE**: `prisma/schema.prisma`, `prisma/migrations/20261105130000_add_deadline_change_batches/migration.sql`, `src/common/utils/milestone-order.util.ts` + spec,
`src/modules/production-invoices/item-deadline-writer.service.ts` + spec, `src/modules/production-invoices/deadline-changes/**` (types, port, values util,
service + spec, controller + spec, dto, Excel service + spec, Excel controller + spec), `production-invoices.{service,controller,module}.ts` + 2 spec,
`dto/production-invoice-{item-,}response.dto.ts`, `src/modules/notifications/notification-types.ts`, `src/modules/work-queue/work-queue.service.ts` + spec,
`src/modules/milestone-board/milestone-board.service.ts` + spec, `docs/changelog-2026-11-05-phan-a-dot-9.md`.
**FE**: `src/services/deadline-changes-api.ts`, `src/services/production-invoices-api.ts`, `src/services/milestone-board-api.ts`, `src/hooks/useWorkQueue.ts`,
`src/modules/pages/ProductionPlan/{LenhSXPage.tsx,DeadlinePlanImportModal.tsx,DeadlineHistoryModal.tsx,deadlineChange.ts,deadlineChange.test.ts}`,
`src/modules/pages/Boss/{BossApp.tsx,DuyetDoiMocPage.tsx,duyetDoiMoc.ts,duyetDoiMoc.test.ts}`, `src/modules/pages/Manufacturing/MilestoneBoardView.tsx`,
`src/modules/pages/Guide/content/{productionPlan,boss}.ts`. **Không commit:** `next-env.d.ts`, `tsconfig.tsbuildinfo`.

## 8. Môi trường thử
- DB `dna_erp_dot9` = bản sao `dna_erp_dot4` + migration 5d + Đợt 9; dữ liệu: `.claude/tools/huong-dan-test-phan-a/pa4-seed.sql` rồi `pa9-seed.sql` (lệnh gộp
  đã duyệt PA4-PI-C = MY-9403 + MY-9404, xoá lô đổi mốc cũ). Không commit 2 script (repo public).
- `.claude/launch.json`: `be-3038-dot9`, `fe-3138-dot9`.
