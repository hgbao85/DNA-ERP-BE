# Changelog 2026-09-11 — Khung cơ khí (Phôi/Hàn/Sơn): bỏ mốc bắt đầu, chỉ còn 1 mốc kết thúc

## 1. Bối cảnh

Từ một phiên làm việc trước (2026-09-09), `ProductionInvoiceItemStage` có thêm `stageType` mới
`FRAME_PHOI`/`FRAME_HAN`/`FRAME_SON` (mốc con trong công đoạn Khung cơ khí) kèm cột `startDate`
(nullable) — cho phép mỗi mốc con là 1 *khoảng* [startDate, deadline], với ràng buộc BE
`assertFrameSubStagesWithinRange()`: khoảng của Phôi/Hàn/Sơn phải nằm trong khoảng của FRAME (Phôi/
Hàn/Sơn được phép chồng lấn lẫn nhau, chỉ không được vượt ra ngoài FRAME).

Người dùng hỏi lại: công đoạn Khung cơ khí và 3 mốc con có thật sự cần "thời gian bắt đầu" không, hay
nên giống các công đoạn khác (Đan/Chuyền kiểm/Đóng gói) — chỉ cần 1 mốc kết thúc (deadline)?

## 2. Kiểm tra tác động trước khi đổi

Trước khi sửa, xác minh qua **DB thật** (gọi trực tiếp `GET /api/v1/production-invoices?limit=100`
từ browser đã đăng nhập, xem toàn bộ `stages[]` thật) — kết quả: **0 dòng dữ liệu nào** từng dùng
`startDate` hoặc các `stageType` FRAME/FRAME_PHOI/FRAME_HAN/FRAME_SON có giá trị `startDate` khác
null. `frameDeadlineOf()` (dùng cho mua hàng/đề xuất cắt/giữ kho) chỉ đọc `frame.deadline`, không bao
giờ đọc `startDate` → không bị ảnh hưởng bởi thay đổi này.

Kết luận: bỏ `startDate` là an toàn 100%, không mất dữ liệu nghiệp vụ nào.

## 3. Quyết định (người dùng chọn)

**Vẫn tách riêng Phôi/Hàn/Sơn thành 3 mốc theo dõi độc lập** (không gộp lại thành 1 mốc FRAME duy
nhất) — chỉ bỏ khái niệm "khoảng thời gian"/`startDate`, mỗi mốc con giờ chỉ còn 1 `deadline`, giống
hệt cách WEAVING/TRANSFER_CHECK/PACKAGING đã làm từ đầu. Bỏ luôn ràng buộc "phải nằm trong khung cha".

## 4. Đã làm

**BE (`D:\DNA-ERP-BE`)**
- `prisma/schema.prisma`: xóa cột `startDate DateTime?` khỏi `ProductionInvoiceItemStage`. Viết lại
  doc comment enum `ProdItemStageType` ghi rõ lịch sử "thêm 2026-09-09, bỏ lại 2026-09-11 lần 2".
- Migration `20260911083642_remove_start_date_from_prod_item_stage` (`ALTER TABLE ... DROP COLUMN
  "startDate"`) — đã áp dụng vào DB dev local.
- `production-invoices.service.ts`: xóa hẳn `assertFrameSubStagesWithinRange()` (~65 dòng), đơn giản
  hoá vòng lặp `upsert` stage trong `updateItem()` (không còn build/truyền `startDate`), xóa
  `startDate` khỏi `toItemResponseDto()`.
- `dto/update-production-invoice-item.dto.ts`, `dto/production-invoice-item-response.dto.ts`: xóa
  field `startDate` khỏi `ProdItemStageInputDto`/`ItemStageDto`.
- `production-invoices.service.spec.ts`: xóa bộ 7 test cho
  `assertFrameSubStagesWithinRange`, thay bằng test xác nhận Phôi/Hàn/Sơn lưu được dù **chồng lấn
  nhau** và **không cần Khung cơ khí đặt trước**, mỗi mốc chỉ còn `deadline`.

**FE (`D:\DNA-ERP\src`)**
- `modules/pages/ProductionPlan/LenhSXPage.tsx`: xóa `computeSubRange()`, gộp state
  `FRAME_START/PHOI_START/PHOI_END/...` thành 3 field đơn `PHOI/HAN/SON`; xóa vòng lặp validate
  "phải trong khung cơ khí" ở `handleSavePI()`; xóa khối JSX lồng nhau (Khung cơ khí dạng khoảng +
  border-left cho 3 mốc con), thay bằng 1 hàng `dateInput` đơn cho Phôi/Hàn/Sơn (giống Đan/Đóng gói).
  Fallback ngày mặc định cho 3 mốc con dùng offset đơn giản trước `computedDeadline`
  (Phôi -25, Hàn -20, Sơn -16 ngày, đứng trước offset -14 có sẵn của Khung cơ khí — đúng thứ tự quy
  trình Phôi→Hàn→Sơn→Khung cơ khí hoàn tất→Đan→Đóng gói).
- `services/production-invoices-api.ts`: xóa `startDate` khỏi type `BeProductionInvoiceItem.stages`,
  `toItem()`, và tham số của `updateProductionInvoiceItem()`.

## 5. Kiểm tra đã làm

- BE: `npx tsc --noEmit` sạch, `npx jest` — **47 test suites / 999 test đều pass** (không có test nào
  vỡ do thay đổi này).
- FE: `npx tsc --noEmit` sạch.
- Live-test: gọi thẳng `PATCH /production-invoices/1/items/1` (PI-2026-001, item thật trên DB dev) với
  payload `stages` mới (chỉ `stageType` + `deadline`, không `startDate`) cho cả 6 loại
  (`FRAME_PHOI/FRAME_HAN/FRAME_SON/FRAME/WEAVING/PACKAGING`) — trả về 200, response đúng schema mới
  (không còn field `startDate`). Tải lại trang "Bảng thống kê" trên FE thật — hiển thị đúng % từng
  công đoạn (Khung cơ khí 67%, Phôi 100%, Hàn 100%, Sơn 0%), không lỗi console, không crash do field
  `startDate` bị thiếu.

## 6. Chỉnh lại vị trí hiển thị + thêm nút bật/tắt Phôi/Hàn/Sơn (2026-09-12)

Sau khi bỏ `startDate`, bản đầu tiên gộp cả Phôi/Hàn/Sơn + Khung cơ khí thành 2 hàng phẳng ngang
hàng với Mua hàng/Đan/Đóng gói — mất luôn phần phân cấp trực quan "Phôi/Hàn/Sơn là mốc con của Khung
cơ khí" mà bản gốc (2026-09-09) có (dù bản gốc thể hiện bằng cặp Bắt đầu/Kết thúc). Người dùng yêu
cầu trả lại đúng VỊ TRÍ như trước (Khung cơ khí đứng riêng, không lẫn vào hàng Mua hàng/Đan/Đóng
gói), đồng thời thêm 1 nút bật/tắt cạnh Khung cơ khí để mở ra sửa Phôi/Hàn/Sơn — thay vì luôn hiện
sẵn 3 ô như trước.

**Đã làm** (`LenhSXPage.tsx`):
- Trả `Mua hàng/Đan/Đóng gói` về đúng 1 hàng riêng (bỏ Khung cơ khí ra khỏi hàng này).
- `Khung cơ khí` quay lại thành 1 khối riêng, kèm nút **"Phôi/Hàn/Sơn"** (icon chevron) ngay cạnh ô
  ngày — bấm để bật/tắt khối Phôi/Hàn/Sơn thu gọn bên dưới (indent + viền trái, giữ đúng phong cách
  lồng nhau của bản gốc, chỉ khác là mỗi mốc giờ 1 ô ngày thay vì cặp Bắt đầu/Kết thúc).
- Thêm state `expandedFrame` (theo từng SKU/idx trong PI) — **tự động mở sẵn nếu SKU đã có ít nhất 1
  mốc Phôi/Hàn/Sơn lưu THẬT** (không phải ước tính), để không giấu mất dữ liệu đã có; mặc định đóng
  nếu SKU chưa từng nhập gì (đỡ rối màn khi chưa cần).

**Kiểm tra**: `npx tsc --noEmit` sạch, `npx eslint` 0 lỗi (chỉ còn warning `any`/`Date.now` có sẵn từ
trước, không liên quan). Live-test tài khoản `khsx`, PI-2026-001 (tạm chuyển status `PLANNING` để mở
được modal, đổi lại `PRODUCING` ngay sau khi xem xong): mở modal tự động hiện sẵn Phôi/Hàn/Sơn (vì
PI này đã có data thật từ lần test trước) đúng vị trí lồng dưới Khung cơ khí; bấm nút toggle thu gọn
lại đúng, không mất giá trị đã nhập.

## 7. Nối "Deadline" thật ở màn Hàn/Sơn (2026-09-12)

Người dùng hỏi: mốc Phôi/Hàn/Sơn KHSX đặt ở "Sửa thời hạn" có hiển thị ra màn Hàn thật không? Kiểm
tra thấy: **KHÔNG** — mốc này (FRAME_PHOI/FRAME_HAN/FRAME_SON) trước giờ chỉ được ghi/đọc lại đúng
trong chính modal đó (`LenhSXPage.tsx`), không chảy tới bất kỳ màn nào khác. Màn Phôi thật
(`LenhSanXuatPhoi.tsx`) không có khái niệm deadline nào cả (không có quyền `SKU:VIEW`/
`PRODUCTION_ORDER:VIEW` để đọc). Màn Hàn/Sơn thật (`core.tsx` `TwoTierScreen`/`fetchHanSonRows()`)
**đã CÓ SẴN cột/dòng "Deadline"** trong UI (`ProcRow.deadline`) nhưng bị hard-code `'—'` từ đợt nối
BE thật trước đó, vì `ProductionOrder` (nguồn dữ liệu Hàn/Sơn) tự nó không có cột deadline — chưa ai
nối nó với `ProductionInvoiceItem.stages` (nơi deadline thật nằm).

**Đã làm** (chỉ nối dữ liệu, không đổi UI/UX):
- **BE** (`production-orders.service.ts`/`production-order-response.dto.ts`): thêm
  `stages: {stageType, deadline}[]` vào `ProductionOrderResponseDto` — lấy kèm luôn trong include có
  sẵn của `GET /production-orders` (thêm `stages: {select: {stageType, deadline}}` vào
  `productionInvoiceItem.select`), **không tốn round-trip riêng**. Test: thêm case xác nhận
  `stages` map đúng qua `toResponseDto()`.
- **FE** (`production-batches-api.ts`, `components/sanxuat/core.tsx`): `BeProductionOrderSummary`
  thêm field `stages`; `fetchHanSonRows(stage)` tra đúng `FRAME_HAN` (khi `stage==='HAN'`) hoặc
  `FRAME_SON` (khi `stage==='SON'`) từ `o.stages`, gán vào `ProcRow.deadline` thay vì hard-code
  `'—'`. Chưa có mốc nào (KHSX chưa đặt) → `dateVN('')` tự trả `'—'` như cũ, không hiện "Invalid
  Date".

**Kiểm tra**: BE 47 suites/1003 test pass, `tsc`/`eslint` sạch cả 2 bên. Live-test PI-2026-001 (đã có
`FRAME_HAN=25/6/2026`, `FRAME_SON=28/6/2026` từ lần test trước):
- Tài khoản `han`: mở SKU "Bàn thử E2E" trong PI → subtitle hiện đúng **"PO-1 · Bàn thử E2E · SL 5 ·
  hạn 25/6/2026"**.
- Tài khoản `son`: danh sách SKU trong PI → cột **"Deadline"** hiện đúng **"28/6/2026"** (trước đây
  luôn là `—`).

**Còn treo riêng mục này**: màn Phôi thật (`LenhSanXuatPhoi.tsx`) vẫn CHƯA hiện `FRAME_PHOI` (khác
cấu trúc `TwoTierScreen`, PHOI_STAFF cũng chưa có quyền đọc `PRODUCTION_ORDER`/`SKU` để tự resolve -
cần bàn thêm nếu muốn làm, phạm vi khác với việc chỉ "nối dữ liệu vào cột có sẵn" như Hàn/Sơn).

## 8. Còn treo

- ~~Chưa live-test trực tiếp modal "Sửa thời hạn" qua thao tác chuột thật~~ — **đã xong ở mục 6**
  (2026-09-12): trang "Tạo lệnh sản xuất" chỉ hiện PI đang `PLANNING`, nên phải tạm chuyển status
  PI-2026-001 sang `PLANNING` (đổi lại `PRODUCING` ngay sau khi xem) để mở được modal qua UI thật —
  không có PI demo nào khác đang ở `PLANNING` sẵn. Nếu cần test lại tự nhiên (không cần chuyển
  status tay), phải tạo thêm 1 PI demo mới ở đúng trạng thái đó.
- ~~Chưa nối `FRAME_PHOI` cho màn Phôi thật~~ — **đã xong, xem mục 9**.

## 9. Nối "Deadline" thật ở màn Phôi (2026-09-12, cùng ngày)

Người dùng báo (kèm ảnh chụp) "màn Phôi tôi lỡ tay xóa mất cột deadline" ở đúng card "PO/SKU trong PI
này" (`LenhSanXuatPhoi.tsx`) — yêu cầu thêm lại. Khác Hàn/Sơn (đã có sẵn cột "Deadline" chỉ cần nối
dữ liệu, xem mục 7): Phôi CHƯA từng có field này trong UI, và quan trọng hơn - **PHOI_STAFF không có
quyền `PRODUCTION_INVOICE:VIEW`/`SKU:VIEW`** nên không tự đọc `ProductionInvoiceItem.stages` qua các
endpoint thông thường được.

**Giải pháp**: màn Phôi vốn đã có sẵn 1 endpoint riêng đi vòng đúng vấn đề permission này —
`GET /production-invoices/:id/order-summary` (định nghĩa ở `SteelIssuesController`, dùng
`STEEL_ISSUE:VIEW` thay vì `PRODUCTION_INVOICE:VIEW` - doc comment ở đó ghi rõ lý do đặt sai chỗ
này: "PHOI_STAFF không có PRODUCTION_INVOICE:VIEW"). Chỉ cần lấy kèm `stages` (lọc `FRAME_PHOI`)
trong query đã có sẵn của endpoint này - không cần đổi permission, không cần endpoint mới.

**Đã làm**:
- **BE** (`steel-issues.service.ts`, `pi-order-summary-response.dto.ts`): `getOrderSummary()` lấy
  kèm `productionInvoiceItem.stages` (where `stageType: 'FRAME_PHOI'`), thêm field `phoiDeadline:
  Date | null` vào `PiOrderSummaryResponseDto`. Test: cập nhật case cũ + field `phoiDeadline` cho cả
  2 nhánh (có mốc / null).
- **FE** (`steel-issues-api.ts`, `LenhSanXuatPhoi.tsx`): `BePiOrderSummary` thêm `phoiDeadline`; card
  "PO/SKU trong PI này" hiện thêm `Deadline {dateVN(o.phoiDeadline)}` cạnh SL — thêm 1 helper
  `dateVN()` nội bộ file này (không import chéo từ `core.tsx`, giữ đúng nguyên tắc file Phôi độc lập
  đã ghi trong doc comment đầu file).

**Kiểm tra**: BE 47 suites/1003 test pass (tăng do case mới), `tsc`/`eslint` cả 2 bên sạch. Live-test
tài khoản `phoi`, PI-2026-001 (đã có `FRAME_PHOI=22/6/2026` từ lần test trước ở mục 2/7): card "PO/SKU
trong PI này" hiện đúng **"PO-1-1 · Bàn thử E2E · Deadline 22/6/2026 · SL 5"**.

Vậy tới đây **Phôi/Hàn/Sơn đều đã hiện đúng deadline thật** — không còn khoảng trống nào giữa 3 công
đoạn về mặt hiển thị này nữa.
