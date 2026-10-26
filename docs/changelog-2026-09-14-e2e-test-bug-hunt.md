# Changelog 2026-09-14 — Test tay toàn trình (tạo đơn mới → cuối) + dò bug

## 1. Bối cảnh

Người dùng yêu cầu: *"hãy test trên FE xem thử có hiển thị đúng không bắt đầu từ tạo định mới tới
cuối luôn sẵn tiện dò bug"* — test tay toàn bộ luồng nghiệp vụ, bắt đầu từ Sales tạo đơn hàng mới,
đi hết qua KHSX/QLSX/Sếp duyệt, sản xuất (Phôi/Hàn/Sơn/KCS), chuyển kho nội bộ, tới khi thấy đúng
trên "Lịch sử kho" (màn vừa hoàn thiện ở `changelog-2026-09-12-lich-su-nhap-xuat-kho.md`) — đồng
thời chủ động tìm lỗi trong lúc test thay vì chỉ xác nhận tính năng chạy được.

Test bằng cách đăng nhập lần lượt các account demo thật (password chung `demo1234`, riêng `admin`
dùng `.env` local) và thao tác qua UI thật, không mock.

## 2. Luồng đã test qua (PO mới: `PO-E2E-BUGHUNT-01`, SKU `E2E-BAN-01`)

1. `sales` — tạo PO mới (SKU đã duyệt sẵn, KH Test E2E), xác nhận cọc.
2. `khsx` — vào "Tối ưu cắt sắt" (GomDotCatPage) để gom/tạo lệnh sản xuất riêng cho SKU này → **gặp
   Bug 1** (mục 3a).
3. `qlsx` — nhận PI, chọn kho thành phẩm, gửi Sếp duyệt.
4. `boss` — duyệt lệnh sản xuất (tạo ProductionOrder thật).
5. Quay sang PI có sẵn từ trước (`PO-1`/`PI-2026-001`, đã có tiến độ thật) để đi tiếp phần sản xuất
   floor vì SKU mới không có sẵn dữ liệu BOM đầy đủ cho Hàn/Sơn:
   - `kcs` — duyệt QC đợt Hàn (Chân bàn, 5 đạt).
   - `son` — báo sản lượng Sơn (Chân bàn, 20 cái).
   - `kcs` — duyệt QC đợt Sơn → **gặp Bug 2** (mục 3b) ngay tại đây (list hiện "20 lít" thay vì
     "20 cái").
   - `khopsh` (thủ kho Phôi Sơn Hàn) — xuất 2 dòng (CHAN-BAN ×20, PAT ×5) sang Kho Vật tư thành
     phẩm qua "Xuất kho" (tạo 2 phiếu chuyển kho `CK-2026-002`/`CK-2026-003`).
   - `khovttp` (thủ kho Vật tư TP) — xác nhận nhận đủ cả 2 phiếu ở "Nhập kho → Nhập nội bộ".
   - Kiểm tra lại "Lịch sử kho" ở CẢ 2 đầu (kho gửi `khopsh` + kho nhận `khovttp`) → **gặp Bug 3**
     (mục 3c), phát hiện ngay tại đây vì 2 phiếu chuyển kho vừa tạo hôm nay (`CK-2026-002`,
     `CK-2026-003`) vô tình trùng SỐ với `refId` của 2 dòng Xuất sắt/Tiêu hao đoạn sắt CŨ (11/09).

**Chưa test tiếp**: đóng gói, chuyển kho tiếp sang Kho Bao bì/Thành phẩm, xuất giao khách — hết thời
gian, để lại ở mục 4.

## 3. Bug tìm thấy — cả 3 đều đã sửa + có test hồi quy

### 3a. "Tối ưu cắt sắt" (GomDotCatPage) rỗng toàn bộ khi SKU đang chờ KHÔNG cần cắt sắt

**Hiện tượng**: PO mới tạo (`PO-E2E-BUGHUNT-01`) không hề xuất hiện trong danh sách "Tối ưu cắt
sắt" dù đã xác nhận cọc — trang hiện "Không có SKU nào đang chờ duyệt — không có gì để gộp", dù
DB có đúng 1 `ProductionInvoiceItem` đang chờ (`productionInvoiceId: null`, `prodApprovalStatus:
null`) khớp hệt điều kiện lọc.

**Nguyên nhân**: `CuttingProposalsService.loadBatchContext()` (`src/modules/cutting-proposals/
cutting-proposals.service.ts`) có `if (byMaterial.size === 0) return null` — early-return này vốn
định để "khỏi bắn tiếp 4 truy vấn vô ích" khi KHÔNG có gì cần cắt sắt, nhưng `byMaterial` được tính
GỘP TRÊN TOÀN BỘ danh sách item đang chờ (không tách riêng theo từng item) — hễ MỌI item đang chờ
(kể cả chỉ có đúng 1 item, case rất phổ biến khi có 1 đơn hàng mới) đều không cần cắt sắt (BOM chỉ
có `PieceMaterialYield`/phụ kiện, không có dòng `pieceBom` nào) thì `byMaterial` rỗng toàn cục, cả
hàm trả `null`, kéo theo `getBatchCandidates()` trả `items: []` — SKU biến mất khỏi bảng dù đang
chờ thật.

Hậu quả nghiêm trọng hơn cả hiển thị: `getBatchCandidates()` là **đường DUY NHẤT** FE dùng để hiện
checkbox cho KHSX bấm "Tạo lệnh sản xuất riêng" (`claimSolo`, ở `ProductionInvoicesService`) hay
"Xác nhận gộp" — bản thân `claimSolo()` KHÔNG hề phụ thuộc `byMaterial`/cắt sắt gì cả, nhưng vì FE
không có gì để bấm nên **SKU bị kẹt vĩnh viễn** ở bước "Sales vừa tạo", không ai gộp/tạo lệnh sản
xuất riêng được — dù BE có API xử lý được. Bug này ảnh hưởng TOÀN BỘ sản phẩm không cần cắt sắt
(hàng chỉ lắp phụ kiện/vật tư cắt sẵn), không phải ca hiếm.

**Đã sửa**: bỏ hẳn early-return `byMaterial.size === 0 → null`; giữ nguyên early-return khi
`items.length === 0` (đúng, không có gì để hiện). `materials` findMany với danh sách rỗng vẫn trả
`[]` an toàn, không lỗi gì; `getBatchSuggestions()`/`previewBatch()` (2 caller còn lại của
`loadBatchContext()`) đã tự nhiên suy ra `[]` khi `materials`/`byMaterial` rỗng, không cần sửa gì
thêm ở đó.

- File: `src/modules/cutting-proposals/cutting-proposals.service.ts`.
- Test hồi quy mới: `src/modules/cutting-proposals/cutting-batch-suggestions.service.spec.ts` — ca
  "1 SKU đang chờ, KHÔNG cần cắt sắt (0 dòng pieceBom) - vẫn phải hiện ra, không được rỗng cả
  bảng". Đã xác nhận test FAIL đúng trên code cũ (stash lại bản sửa rồi chạy) trước khi khôi phục.
- Kiểm tra: `npx tsc --noEmit` sạch, `npx eslint --fix` sạch, `npx jest cutting-proposals` 107/107
  pass. Live-test: sau khi sửa + hot-reload, `PO-E2E-BUGHUNT-01` hiện đúng trong bảng, bấm "Tạo lệnh
  sản xuất riêng cho SKU này" tạo thành công `PI-2026-002`, đi tiếp hết luồng QLSX → Sếp duyệt bình
  thường (ra `ProductionOrder` thật, `floorStage: PENDING`).

### 3b. Cột "Tổng SL chờ kiểm" ở màn KCS — Công đoạn Sơn hiện sai đơn vị "lít" thay vì "cái"

**Hiện tượng**: KCS duyệt lô Sơn 20 mảnh "Chân bàn" nhưng danh sách chờ kiểm hiện **"20 lít"** —
đọc như đang duyệt 20 lít sơn lỏng, trong khi thực tế đang duyệt 20 CÁI chân bàn đã sơn xong.

**Nguyên nhân**: `SON_CFG` (constant dùng chung, `src/components/sanxuat/core.tsx`) khai
`unit: 'lít', itemLabel: 'Loại sơn'` — sai từ đầu, vì `ProductionBatch.reportedQty` (nguồn dữ liệu
duy nhất cho mọi màn Sơn) LUÔN đếm theo MẢNH giống hệt Hàn (`HAN_CFG: unit: 'cái'`), không có luồng
nào theo dõi lít sơn tiêu thụ qua bảng này. Ai đó ĐÃ từng phát hiện đúng vấn đề này cho MỘT màn
(`LenhSanXuatSon.tsx`, màn Tổ Sơn tự báo sản lượng) và tự override cục bộ
`{ ...SON_CFG, itemLabel: 'Mảnh', unit: 'cái' }` kèm comment giải thích rõ — nhưng không sửa gốc
`SON_CFG`, nên 2 nơi khác vẫn dùng thẳng bản gốc sai: `KcsSonPage.tsx` (màn KCS duyệt Sơn — chính
màn bị phát hiện lần này) và `ThongKePagePlan.tsx` (bảng thống kê cho KHSX/Sếp, dùng `SON_CFG` trực
tiếp, khả năng cũng hiện sai — chưa live-test riêng màn này).

**Đã sửa**: sửa GỐC `SON_CFG` thành `unit: 'cái', itemLabel: 'Mảnh'` (khớp `HAN_CFG`), sửa luôn
`KcsSonPage.tsx` dùng cùng giá trị đúng, và bỏ override thừa ở `LenhSanXuatSon.tsx` (giờ trùng với
`SON_CFG` gốc nên dùng thẳng).

- File: `D:\DNA-ERP\src\components\sanxuat\core.tsx`,
  `D:\DNA-ERP\src\modules\pages\Kcs\KcsSonPage.tsx`,
  `D:\DNA-ERP\src\modules\pages\Son\LenhSanXuatSon.tsx` (repo FE, khác repo với BE).
- Kiểm tra: `npx tsc --noEmit` sạch, `npx eslint` sạch (0 lỗi, 2 warning có sẵn từ trước ở chỗ
  khác trong `core.tsx`, không liên quan). Live-test: reload màn KCS — Công đoạn Sơn, cột "Tổng SL
  chờ kiểm" hiện đúng "20 cái".
- **Còn treo**: chưa live-test riêng `ThongKePagePlan.tsx` (bảng "Khung cơ khí" cho KHSX/Sếp) xem
  trước đây có hiện sai "lít" ở đó không — code đã sửa gốc `SON_CFG` nên về lý thuyết đã tự khớp,
  nhưng chưa xác nhận bằng mắt.

### 3c. "Lịch sử kho" gán NHẦM mã phiếu chuyển kho cho bút toán không liên quan (do id trùng số khác bảng)

**Mức độ**: cao nhất trong 3 bug — sai dữ liệu hiển thị trực tiếp trên chính màn "Lịch sử kho" vừa
xây ở đợt trước, có thể khiến thủ kho tin nhầm 1 bút toán xuất sắt/tiêu hao đoạn sắt là thuộc về
1 phiếu chuyển kho hoàn toàn không liên quan.

**Hiện tượng phát hiện được**: sau khi tạo 2 phiếu chuyển kho MỚI hôm nay (`CK-2026-002`,
`CK-2026-003`, id thật trong DB là `2` và `3`), cột "Lệnh sản xuất" ở Lịch sử kho của Kho Phôi Sơn
Hàn lập tức hiện SAI cho 3 dòng CŨ (ngày 11/09, không liên quan gì tới 2 phiếu chuyển kho vừa tạo):

| Dòng cũ (refType thật) | refId | Hiện sai thành |
|---|---|---|
| STEEL_ISSUE (xuất sắt) | `2` | `CK-2026-002` |
| SEGMENT_CONSUME (tiêu hao đoạn sắt) | `2` | `CK-2026-002` |
| SEGMENT_CONSUME (tiêu hao đoạn sắt) | `3` | `CK-2026-003` |

**Nguyên nhân**: `StockLedgerService.toResponseDto()` (`src/modules/stock/stock-ledger.service.ts`)
tra `refCode` bằng `transferCodeById?.get(row.refId)` — map này CHỈ chứa `WarehouseTransfer.id →
code` (đúng, xem `fetchTransferCodes()`), nhưng lookup ở đây **KHÔNG kiểm tra `row.refType ===
WAREHOUSE_TRANSFER` trước khi tra** — bất kỳ dòng nào có `refId` (xuất sắt, tiêu hao đoạn sắt, xuất
vật tư...) đều bị đem tra vào map đó. `refId` các bảng khác nhau (`steel_issues.id`,
`stock_ledger`'s `warehouse_transfers.id`...) đều tự `autoincrement()` RIÊNG, nên chỉ cần trùng số
NGẪU NHIÊN (ở đây: `SteelIssue.id=2` trùng `WarehouseTransfer.id=2`) là hiện sai ngay — không phải
lỗi hiếm, càng nhiều dữ liệu càng dễ trùng.

Có 1 test trước đó (`tra mã phiếu ("CK-2026-010")...`) TƯỞNG đã che ca này (dòng comment ghi "KHÔNG
bị tra nhầm sang bảng chuyển kho") nhưng dữ liệu test dùng `refId` KHÁC nhau giữa 2 loại (`77` vs
`5`) nên chưa từng thật sự tạo ra tình huống trùng số — test không hề chạm bug, dù comment nói có.

**Đã sửa**: thêm điều kiện `row.refType === StockLedgerRefType.WAREHOUSE_TRANSFER` trước khi tra
map, đúng cách `refStage`/`poCode`/`piCode` đã làm ĐÚNG ngay từ đầu (key ghép `${refType}:${refId}`
thay vì `refId` trần).

- File: `src/modules/stock/stock-ledger.service.ts`.
- Test hồi quy mới (thay cho test cũ không thật sự che được ca này):
  `src/modules/stock/stock-ledger.service.spec.ts` — ca "KHÔNG gán nhầm mã phiếu chuyển kho khi
  refId của STEEL_ISSUE trùng SỐ với id 1 WarehouseTransfer (khác bảng)". Đã xác nhận test FAIL
  đúng trên code cũ trước khi khôi phục bản sửa.
- Kiểm tra: `npx tsc --noEmit` sạch, `npx eslint --fix` sạch, `npx jest stock-ledger.service.spec`
  28/28 pass. Live-test: reload "Lịch sử kho" (cả 2 đầu kho gửi/nhận) — 3 dòng cũ giờ hiện đúng
  `PI-2026-001` (mã Lệnh sản xuất thật của chúng), không còn dính `CK-2026-002`/`003` nữa; 2 dòng
  chuyển kho MỚI hôm nay vẫn hiện đúng mã phiếu của chính nó.

## 4. Còn treo

- Test E2E mới dừng ở bước "chuyển kho nội bộ Kho Phôi Sơn Hàn → Kho Vật tư thành phẩm" — CHƯA test
  tiếp: đóng gói (Đóng gói), chuyển tiếp sang Kho Bao bì/Thành phẩm, xuất giao khách hàng
  (`SalesOrder.shippedQty`, vốn đã ghi nhận ở `changelog-2026-09-12...` mục 9 là KHÔNG ghi
  `stock_ledger`).
- `ThongKePagePlan.tsx` (mục 3b) chưa live-test riêng sau khi sửa `SON_CFG`.
- `PI-2026-002` (PO mới tạo hôm nay) đã có `ProductionOrder` (`floorStage: PENDING`) nhưng CHƯA có
  ai báo cắt/Hàn/Sơn cho nó (BOM revision 2 của SKU `E2E-BAN-01` — bản ACTIVE hiện tại — có piece
  `CHAN-NHOM` gắn cờ `needsHan`/`needsSon` nhưng KHÔNG có dòng `pieceBom` tương ứng; xem
  `CuttingProposal` tự động sinh ra cho PO này có status `FAILED`) — nghi là dữ liệu BOM test dựng
  tay từ trước bị thiếu, KHÔNG chắc là bug code, chưa điều tra sâu vì ưu tiên thấp (dữ liệu test,
  không phải luồng thật của người dùng cuối).
- Dọn dữ liệu test: `PO-E2E-BUGHUNT-01`/`PI-2026-002` và 2 phiếu chuyển kho `CK-2026-002`/
  `CK-2026-003` đều là dữ liệu test tự tạo trong phiên này, không phải nghiệp vụ thật — để lại trên
  DB dev, chưa dọn (cùng tình trạng với `CK-2026-001` đã ghi ở changelog trước).
