# Changelog – Phần A, Đợt 9: sửa kế hoạch + Excel + Sếp duyệt lại (YC2) – phần 1 05/11, phần 2 06/11/2026

Nhánh `dot-9-sua-ke-hoach` ở 2 worktree: BE `D:\DNA-ERP-BE-dot9` (cắt từ `origin/main` `59f828c` = đã có Đợt 4 + 5d), FE `D:\DNA-ERP-dot9`
(cắt từ `origin/demo` `136a1a3`). **Phần 1 (theo phương án IT đề xuất cho 4 câu chờ Sếp) commit trên nhánh + gộp `--no-ff` vào `main` / `demo`
05/11, sau Đợt 5d phần 2 của người B (chưa push).** Phần 2 = đổi theo câu trả lời của Sếp + file Excel mẫu (mục 3). Plan: `docs/ke-hoach-phan-a-12-yeu-cau-2026-11-04.md` mục 5, **5b**; bản yêu cầu v8 YC2
(2.1–2.4). 4 câu xin Sếp chốt: `docs/cau-hoi-sep-dot-9-sua-ke-hoach-2026-11-05.docx` - phần 1 code theo phương án IT đề xuất (mục 3).
**Sếp trả lời 06/11 → phần 2 (mục 9): code xong ở nhánh, CHƯA commit.** Phần 1 đã push 05/11 (Render 17:01, Vercel kiểm 06/11).

## Mục lục
- 1. Đã làm (BE, FE)
- 2. Quyết định thiết kế / lệch plan có lý do
- 3. Phụ thuộc 4 câu đang chờ Sếp - chỗ đổi khi Sếp trả lời
- 4. Kiểm tra
- 5. Chưa làm / còn treo
- 6. Đụng phần có sẵn của file dùng chung
- 7. Danh sách file để commit
- 8. Môi trường thử
- 9. Phần 2 (06/11): đổi theo câu trả lời của Sếp

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

## 3. Phụ thuộc 4 câu chờ Sếp - ~~chỗ đổi khi Sếp trả lời~~ → Sếp đã trả lời 06/11, đã đổi (mục 9)
| Câu | Phần 1 (IT đề xuất) | Sếp trả lời 06/11 → phần 2 |
|---|---|---|
| Q9-1 dời 1 mốc có tự dời mốc sau | A - chỉ ô đã sửa + cảnh báo | **B** - mốc sản xuất sau tự dời cùng số ngày (form + Excel), KHSX sửa tay lại được - mục 9.1 |
| Q9-2 thứ tự ngược | A - cảnh báo, vẫn lưu | **B** - không cho lưu dòng đó (`ORDER_VIOLATION_BLOCKS = true`, cả dòng sửa thẳng) - mục 9.2 |
| Q9-3 Excel gồm | A - mọi lệnh chưa Kết thúc | **Ý kiến khác** - chỉ lệnh CHƯA bắt đầu sản xuất (chưa cắt phôi); lệnh đã bắt đầu không sửa mốc ở mọi đường - mục 9.3 |
| Q9-4 lô có lệnh không đồng ý | B - Sếp bỏ chọn từng yêu cầu | **B** - giữ nguyên |

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
- ~~4 câu Sếp (mục 3) - có câu trả lời thì đổi + chạy lại test.~~ → đã đổi ở phần 2 (mục 9).
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

## 9. Phần 2 (06/11): đổi theo câu trả lời của Sếp

Người dùng gửi file trả lời của Sếp (`TRA_LOI_DOT_9_SUA_KE_HOACH_IT_05-11-2026.docx`): Q1 **B** ("Mốc sau tự dời theo; KHSX vẫn sửa tay lại được
từng mốc nếu cần"), Q2 **B** ("Không cho lưu dòng đó tới khi sửa đúng thứ tự"), Q3 **ý kiến khác** ("Chỉ tải các lệnh CHƯA BẮT ĐẦU SẢN XUẤT (chưa
bắt đầu cắt phôi) – gồm cả lệnh chưa duyệt và lệnh Sếp đã duyệt nhưng chưa cắt. Lệnh đã bắt đầu cắt sắt KHÔNG được sửa mốc nên không đưa vào file."),
Q4 **B**. Không kèm file Excel mẫu → giữ thứ tự cột như màn "Sửa thời hạn". Nhánh `dot-9-sua-ke-hoach` fast-forward lên `main` `9615554` / `demo`
`e1cae72` trước khi làm. Opus viết hợp đồng (types + hàm thuần BE, bản chép FE + test) → 4 thợ song song (BE lõi, BE Excel, FE KHSX, FE Sếp), không
chung file → Opus đọc diff, sửa nhỏ, chạy lại hết.

### 9.1 Q9-1 = B: tự dời mốc sau
- **Luật (hàm thuần `resolveAutoShift(old, explicit)`** ở `deadline-values.util.ts`, FE chép y hệt `ProductionPlan/deadlineRules.ts`): mốc SẢN XUẤT
  (`stage.*`: Bắt đầu Phôi → Đóng gói) KHSX không gõ mà đã có ngày → dời cùng số ngày với mốc sản xuất gõ GẦN NHẤT phía trước. Gõ lại đúng ngày cũ
  = dời 0 → mốc sau đứng yên (cách nén lịch: dời Phôi mà giữ Đóng gói). Mốc chưa có ngày không tự sinh; gõ mốc chưa có ngày không dời mốc sau. **2 mốc
  Mua VT không tự dời** (danh sách Sếp chọn chỉ có mốc sản xuất; Mua VT là hạn của Mua hàng - dời theo sẽ đổi hạn mua mà không ai sửa) - nếu dời sớm
  làm Mua VT còn lại muộn hơn Bắt đầu đóng gói thì luật thứ tự (9.2) chặn để KHSX sửa tay. Hạn giao không dời (v8 2.4).
- **Form** (`LenhSXPage`): `applyFormAutoShift` (`deadlineChange.ts`) - `saved` = mốc đã lưu (ô đề xuất không bao giờ tự dời), `explicit` = ô đã chạm
  (chạm mà để trống = ngày đã lưu); ô tự dời ghi "(tự dời +2)" ở tên ô, state `editAuto`; tự dời chạy trước rồi mới tính lại ô đề xuất. Dòng đã duyệt
  gửi cả ô tự dời (khác ngày đã lưu). Câu nhắc trong khung thông tin dòng.
- **Excel** (`deadline-plan-excel.service.ts`): mốc sản xuất của dòng sửa được xuất dạng **công thức** `<ô mốc sản xuất trước gần nhất có ngày>±<số
  ngày lúc xuất>` (vd `=H14+1`) → KHSX sửa 1 ô thì Excel đổi các ô sau ngay. Đọc lại: ô có công thức KHỚP công thức kỳ vọng của đúng dòng đó (bỏ `=`,
  `$`, khoảng trắng; `cell.formula` của exceljs đã dịch shared formula theo ô) = mốc tự dời - BE **tự tính lại**, không tin kết quả Excel lưu; ô giá trị /
  công thức lạ (lấy kết quả đã lưu) / ô trống (= gõ lại ngày cũ) = ô gõ → `resolveAutoShift`. Bản xem trước gắn `auto: true` (FE ghi "(tự dời)" + chú
  thích). Dấu file v2 (đọc nhận v1 - file cũ không công thức thì không tự dời). Thêm trang **"Hướng dẫn"** (8 dòng chữ thường) trong file.
- Thiết kế công thức thay vì "ô không đổi = dời theo" vì cách sau không cho KHSX giữ 1 mốc sau ở ngày cũ trong Excel (ô gõ lại ngày cũ trông như
  không đổi) - đúng ca hay gặp nhất (dời Phôi, giữ Đóng gói theo hạn giao).

### 9.2 Q9-2 = B: thứ tự ngược chặn lưu
- `ORDER_VIOLATION_BLOCKS = true` (BE types + FE). Dòng đã duyệt: `evaluate()` đã có → lỗi dòng (form 400; Excel dòng Lỗi, bị bỏ).
- **Dòng sửa thẳng** (`updateItemsDeadlines`, `updateItem`): `assertMilestoneOrderAfterWrite` đọc lại dòng trong giao dịch sau khi ghi; dòng CÓ ĐỔI (mốc
  hoặc hạn giao) mà ngược thứ tự → 400 `<LSX> · <SKU>: <câu>` (nhiều dòng), rollback cả lần kể cả hạn PI. Dòng không đổi thì không kiểm (dữ liệu cũ sai
  thứ tự không chặn dòng khác).
- Opus: hạn giao để so = hạn riêng của dòng, chưa có thì **hạn của lệnh** (form đang hiện như vậy; Excel cũng xuất như vậy) - sửa ở `evaluate`,
  `toBatchDtos` (`deliveryDayOf`) và dòng sửa thẳng, để BE và FE chặn cùng một chỗ.
- **Form**: `projectedOrderErrors` trên đúng giá trị sẽ gửi (tách `buildItemsOut()` dùng chung cho Lưu + kiểm) → khung đỏ dưới SKU "Thứ tự mốc ngược –
  sửa lại mới lưu được:" + câu; nút Lưu khoá (title). Bỏ khung vàng `timelineWarnings` cũ trong hộp (trùng ý). Câu lỗi 400 nhiều dòng hiện xuống dòng.

### 9.3 Q9-3: lệnh đã bắt đầu sản xuất không sửa mốc
- Định nghĩa: lệnh SX `floorStage` ≠ PENDING (`isFloorStarted`) - QLSX đã bấm "Bắt đầu" (Phôi chỉ báo cắt được khi lệnh ACTIVE; PAUSED / FINISHED
  cũng là đã bắt đầu). Thu hẹp v8 2.1 "mọi giai đoạn trước Kết thúc" theo ý Sếp.
- BE: `evaluate()` lỗi `FLOOR_STARTED_ERROR` (trước kiểm "đang chờ"); dòng sửa thẳng phòng xa 400 (`assertFloorNotStarted`); `decide()` 409 nếu duyệt yêu
  cầu của lệnh đã bắt đầu; `DeadlineChangeRequestDto.blockedReason` (huỷ / Kết thúc / đã bắt đầu) cho yêu cầu PENDING. Excel chỉ xuất dòng chưa có lệnh
  SX hoặc `floorStage = PENDING`; chữ Trạng thái "Đã duyệt, chưa cắt – sửa cần Sếp duyệt lại".
- FE KHSX: `itemDeadlineState` thêm `STARTED` (khoá như Kết thúc, khung xám `FLOOR_STARTED_TEXT`, nhãn "Đã bắt đầu SX" ở danh sách, vẫn nằm tab Đang
  chạy); dòng đang chờ mà lệnh đã cắt → câu "Sếp không duyệt được nữa, nên Huỷ yêu cầu". Câu "Sửa ô nào thì lưu ô đó; Bắt đầu Phôi và Bắt đầu đóng gói
  luôn được lưu" chỉ hiện ở dòng chưa duyệt (Opus - trước hiện cả dòng khoá / dòng đã duyệt, sai với dòng đã duyệt).
- FE Sếp: yêu cầu bị chặn → ô chọn khoá + bỏ chọn, chữ đỏ `blockedReason`, "Chọn hết" bỏ qua, nút Duyệt khoá khi không còn gì duyệt được, lý do từ chối
  điền sẵn "Lệnh đã bắt đầu sản xuất (cắt phôi)" khi chỉ còn yêu cầu bị chặn (không ghi đè chữ Sếp gõ); câu xác nhận / kết quả nhắc số yêu cầu bị chặn
  (Opus rút gọn câu). Danh sách mốc dài xuống dòng trên điện thoại.
- Hướng dẫn: `productionPlan.ts` (điều kiện chưa cắt phôi, tự dời, khung đỏ, nhãn Đã bắt đầu SX, Excel chỉ lệnh chưa cắt + ô tự đổi trong file), `boss.ts`.

### 9.4 Kiểm tra
- **BE** (worktree): `nest build` OK; `tsc` chỉ 2 lỗi seed cũ; `jest --runInBand` toàn bộ **134 suite / 2722 test xanh** (1 skip có sẵn) - mới: util tự
  dời 10 ca, Excel 13 ca (công thức đúng chữ, vòng tròn xuất → sửa → đọc, gõ lại ngày cũ, xoá trống ô công thức, công thức lạ, shared formula, file v1),
  lõi (chặn đã bắt đầu, thứ tự ngược strict / không strict, decide 409, `blockedReason`), dòng sửa thẳng (ngược → 400, đúng → lưu, không đổi không
  kiểm, lệnh SX đã bắt đầu → 400); eslint file đổi 0 lỗi.
- **FE**: `tsc` sạch; `vitest` **37 file / 392 test xanh** (mới: `deadlineRules` 10 ca cùng ca với BE, trạng thái STARTED, `applyFormAutoShift`,
  `projectedOrderErrors`, màn Sếp 5 ca); eslint 0 lỗi (cảnh báo có sẵn).
- **API thật** (BE 3038, `dna_erp_dot9`, tài khoản demo): xuất 20 dòng - không có MY-9308 / 9309 (ACTIVE), MY-9405 (Kết thúc); công thức vd MY-9311
  `=H14+1 | =I14+1 | … | =P14+1`, sheet Kế hoạch / Hướng dẫn / `_dna` ẩn. Sửa file rồi xem trước: MY-9311 Bắt đầu Phôi +3 → APPLY, 8 mốc sau "(tự dời)"
  +3; MY-9310 +2 → NEEDS_APPROVAL, 8 mốc tự dời; MY-9304 +3 và gõ lại ngày cũ Đóng gói → ERROR "Đóng gói (21/11) sớm hơn Bắt đầu đóng gói (24/11)";
  MY-9303 (Hàn đang ngược sẵn) sửa Nhập đan → ERROR. Sửa thẳng MY-9311 Hàn ra sau Sơn → 400; đúng thứ tự → 200. Sửa MY-9308 → 400 "đã bắt đầu sản
  xuất". MY-9401 gửi Sếp rồi đặt ACTIVE → `blockedReason` đúng; Sếp duyệt → 409; từ chối → DECIDED.
- **Trình duyệt** (FE 3138): `khsx` MY-9308 nhãn "Đã bắt đầu SX", form khung xám + ô khoá; MY-9310 dời Bắt đầu Phôi 04/11 → 06/11 → 8 ô "(tự dời +2)",
  Mua VT + hạn giao giữ; gõ lại Đóng gói 18/11 → khung đỏ, Lưu khoá (title đúng); Đóng gói 21/11 → Lưu → "1 SKU đã gửi Sếp duyệt lại", yêu cầu lưu 9
  mốc. Đặt MY-9310 ACTIVE → `boss` Đổi mốc lệnh SX: chữ đỏ, ô chọn khoá, "Duyệt (0)" khoá, Từ chối… lý do điền sẵn → "Đã từ chối 1 yêu cầu (1 yêu cầu
  của lệnh đã bắt đầu sản xuất, không duyệt được)", số nhắc việc hết. Console không lỗi. Dữ liệu thử dựng lại sau khi thử.
- **Microsoft Excel 16 thật** (Opus, qua Excel COM): mở file xuất - sheet khoá, `_dna` ẩn; ô Mã lệnh không sửa được; MY-9311 sửa Bắt đầu Phôi +3 → Excel tự
  tính các ô Phôi … Đóng gói +3 ngay, Mua VT giữ; MY-9305 Bắt đầu Phôi +2 + gõ lại ngày cũ vào Bắt đầu đóng gói / Đóng gói; lưu bằng Excel → tải lên:
  MY-9311 APPLY 8 mốc "(tự dời)", MY-9305 ERROR "Chuyền kiểm (23/11) muộn hơn các mốc sau nó: Bắt đầu đóng gói (22/11), Đóng gói (22/11)" - công thức Excel
  lưu lại vẫn được nhận là ô tự dời.

### 9.5 Chưa làm / còn treo
- Chưa thử WPS / Google Sheets (đã thử Microsoft Excel 16 - mục 9.4).
- Màn xem trước Excel (`DeadlinePlanImportModal`) chưa thử bấm trên trình duyệt (dữ liệu `auto` đã kiểm qua API; thay đổi màn chỉ thêm chữ "(tự dời)").
- File Excel mẫu của KHSX (nếu Sếp gửi) → đổi tên / thứ tự cột.
- Chưa commit / gộp / push (chờ người dùng). Báo người B (3 điểm ở mục 5) + `production-invoices.service.ts` thêm 2 hàm kiểm cho dòng sửa thẳng.

### 9.6 File phần 2
**BE**: `deadline-changes/{deadline-changes.types.ts, deadline-values.util.ts, deadline-values.util.spec.ts (mới), deadline-changes.service.ts + spec,
deadline-plan-excel.service.ts + spec}`, `production-invoices.service.ts` + spec, `docs/changelog-2026-11-05-phan-a-dot-9.md`.
**FE**: `src/services/deadline-changes-api.ts`, `src/modules/pages/ProductionPlan/{deadlineRules.ts (mới), deadlineRules.test.ts (mới), deadlineChange.ts,
deadlineChange.test.ts, LenhSXPage.tsx, DeadlinePlanImportModal.tsx}`, `src/modules/pages/Boss/{DuyetDoiMocPage.tsx, duyetDoiMoc.ts, duyetDoiMoc.test.ts}`,
`src/modules/pages/Guide/content/{productionPlan,boss}.ts`. **Không commit:** `next-env.d.ts`, `tsconfig.tsbuildinfo`.
