# Changelog 2026-09-17 — Reset DB local, tài khoản demo, vật tư/định mức thật, E2E

> Trạng thái: **ĐANG TIẾP TỤC live test các case còn treo** (mục 15-17), **đã sửa xong 2/3 bug thật
> phát hiện được và đã DÒ LẠI TOÀN DIỆN xác nhận ổn định** (mục 18-19) — sau khi ĐÃ XONG happy-path
> đầy đủ
> đợt 2026-09-21 (mục 11-13) - đợt 2026-09-17 (mục 1-10) đã xong 1 SKU (GHE-J55-GOPLUS, PI-2026-003).
> Đợt 2026-09-21 reset lại DB lần nữa (trừ account), seed 4 sản phẩm thật mới từ 1 file Excel khác
> ("định mức mảnh bàn ghế J55, ghế tình yêu.xlsx", 10 vật tư sắt), và live-test lại TOÀN BỘ chuỗi cho
> cả 4 SKU / 3 PI (không chỉ 1 SKU đơn giản như đợt trước): Sales → KHSX → QLSX → Sếp → solver → Mua
> hàng → Nhập kho → Xuất sắt Phôi → Phôi cắt → KCS duyệt cắt → Hàn → KCS duyệt Hàn → Sơn → KCS duyệt
> Sơn → chuyển kho nội bộ (khopsh xuất → khovttp nhận) → Chuyền kiểm (khotp) → Đóng gói (khotp) —
> **chạy hết đến điểm dừng cuối cùng hệ thống hiện theo dõi được**, phát hiện thêm 1 bug thao tác tự
> gây (mục 11.4) + xác nhận lại ranh giới tính năng M2 (mục 8.4 đợt trước) đúng cho cả trường hợp
> nhiều SKU/PI phức tạp hơn. Sau đó tiếp tục test các nhánh Từ chối/Sửa thời hạn/chế độ hao hụt đặc
> cách (mục 15), rồi partial receipt/validation vượt số/KCS "Không đạt"/Cấp bù/badge "N Issue(s)"
> (mục 16), rồi KCS "Không đạt" ở Hàn/Sơn (mục 17) trên dữ liệu test riêng — ban đầu tưởng phát hiện 3
> bug thật (over-receipt không bị chặn khi nhận hàng mua; endpoint `/replenish-requests` không tồn tại
> ở BE dù FE gọi; **nghiêm trọng nhất** - màn Hàn/Sơn tự báo sản lượng không hiện lại được đợt vừa lưu,
> không bấm "Gửi KCS" được qua UI) — **over-receipt sau đó được người dùng đính chính là thiết kế có
> chủ đích, không phải bug** (vật tư bao bì/bì zip không đếm chính xác được, xem mục 16.1). Theo yêu
> cầu người dùng, đã điều tra root cause 2 bug thật còn lại + lên plan qua
> `EnterPlanMode` rồi **sửa xong 2 bug** (Hàn/Sơn "Gửi KCS" + dead code `/replenish-requests`, xem mục
> 18), live-test lại qua UI thật xác nhận cả 2 hết lỗi. Người dùng yêu cầu dò lại lần nữa cho chắc
> (mục 19) — phát hiện thêm 1 commit khác của đồng nghiệp đè lên sau đó (không xung đột), và môi
> trường dev cục bộ thiếu 2 migration Prisma (không liên quan, đã xử lý xong); dò lại toàn diện qua
> UI thật (kể cả ca va chạm 3 lệnh cùng lúc, rộng hơn giả thiết ban đầu) xác nhận cả 2 bug vẫn sửa
> đúng và ổn định. Xem mục 14 để biết case nào còn treo.

## 1. Yêu cầu

Người dùng: *"clean toàn bộ data của local, xong bắt đầu tạo lại account, account pass đều là
demo1234 kể cả admin, và đặt tên dễ nhớ như Kế Hoạch sản xuất thì là KHSX..."*, sau đó tiếp: *"sau
khi clean và tạo lại account xong bắt đầu tiến hành thêm vật tư vào kho... dựa vào các file excel
này, thêm vật tư vào kho, bắt đầu lên định mức và thực hiện flow test từ đầu tới cuối"*, kèm 5 file
Excel thật từ máy người dùng.

## 2. Reset DB local

- `npx prisma migrate reset --force` — Prisma tự chặn vì phát hiện được gọi bởi AI agent, yêu cầu
  hỏi lại xác nhận rõ ràng (không được suy ra từ chat trước đó). Đã hỏi qua `AskUserQuestion`, người
  dùng xác nhận "Đồng ý, xoá sạch và tạo lại" → chạy với
  `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` = đúng câu xác nhận đó. `DATABASE_URL` xác nhận
  local (`localhost:5432/dna_erp`).
- `npm run seed` (roles/permissions/warehouses/material-groups + 1 admin bootstrap theo
  `SEED_ADMIN_*` trong `.env`).
- `npm run seed:demo` — **va chạm username `admin`**: bootstrap-admin (`admin@dna-erp.local`, từ
  `seed.ts`) và demo-admin (`admin@demo.com`, từ `seed-demo.ts`) đều dùng username `admin`, upsert
  theo `email` nên tạo bản ghi MỚI thay vì cập nhật → vi phạm unique `username`, cả script dừng
  giữa chừng (chỉ tạo được 0/18 tài khoản demo). Vì `SEED_ADMIN_PASSWORD` trong `.env` VỐN ĐÃ LÀ
  `demo1234` (trùng ý định người dùng), xoá thẳng bản ghi bootstrap-admin (`email=admin@dna-erp.local`)
  rồi seed lại — 18/18 tài khoản demo tạo thành công.

### 18 tài khoản demo (mật khẩu `demo1234` cho MỌI tài khoản, kể cả admin)

| Username | Vai trò |
|---|---|
| `admin`, `admin2` | Quản trị viên |
| `boss` | Giám đốc (duyệt) |
| `sales` | Sales |
| `khsx` | Kế hoạch sản xuất (KHSX) |
| `qlsx` | Quản lý sản xuất (QLSX) |
| `khopsh`, `khovttp`, `khotp` | Kho (Phôi Sơn Hàn / Vật tư TP / Thành phẩm) |
| `muapsh`, `muavttp`, `muatp` | Mua hàng (theo từng kho) |
| `phoi`, `han`, `son`, `kcs` | Các chuyền SX |
| `dms` | Định mức sắt |
| `dmbbdg` | Định mức chi tiết (Sơn/Phụ kiện/Bao bì) |

Danh sách đầy đủ + role/mfgRole/warehouseScope xem `prisma/seed-demo.ts`.

## 3. Vật tư sắt thật từ Excel

Người dùng gửi 5 file Excel thật. Sau khi đọc (qua `xlsx` package của repo FE, vì Read tool không
đọc được binary .xlsx), phân loại:

- `VẬT TƯ THÀNH PHẨM.xlsx` — vật tư ĐÓNG GÓI (carton, xốp...) theo LSX, không phải sắt.
- `vật tư kho nghiaxx.xlsx` — thiết bị/CCDC (quạt, bóng đèn...), không phải vật tư SX.
- `kho thành phẩm T5 26.xlsx` — sổ kho THÀNH PHẨM (tồn/nhập/xuất theo mã SP), không phải vật tư sắt.
- `J55 GHẾ GOPLUS MỚI.xlsx` + `36. GHẾ J55 GOPLUS MỚI.xlsx` — bảng theo dõi ĐỊNH MỨC SẮT thật cho
  sản phẩm "Ghế J55 mới Goplus" (LSX125/132/133/134): từng mảnh (Tay phải/Tay trái) → loại sắt (mã
  tắt V18/V10/FI4/h10-20) → kích thước mm → số đoạn cần cắt.

Người dùng xác nhận phạm vi: **chỉ seed vật tư sắt** (bỏ qua đóng gói/thiết bị/tồn kho TP lần này),
và xác nhận cách giải mã mã tắt: V18=Vuông 18×18, V10=Vuông 10×10, FI4=Phi 4 (tròn), h10-20=Hộp
10×20mm.

### 4 vật tư tạo qua API (`POST /materials`, nhóm Sắt, kho Phôi Sơn Hàn, tồn đầu kỳ 30 cây/loại)

| Code | Tên | 
|---|---|
| `SAT-VUONG-18X18` | Sắt vuông 18×18 |
| `SAT-VUONG-10X10` | Sắt vuông 10×10 |
| `SAT-TRON-FI4` | Sắt tròn Ø4 |
| `SAT-HOP-10X20` | Sắt hộp 10×20 |

**Sự cố encoding**: gửi tiếng Việt qua `curl -d "..."` trong Git Bash bị mangle (`"Sắt vuông"` →
`"S?t vu�ng"`) - PATCH lại bằng file JSON UTF-8 (Write tool) thay vì chuỗi inline. `unit="cây"` cũng
bị mangle tương tự lúc tạo, sửa cùng cách.

## 4. Định mức thật - "Ghế J55 mới Goplus"

Đọc từ sheet `LSX132 SL 1048` (mới nhất trong file `J55 GHẾ GOPLUS MỚI.xlsx`, khớp chéo với
LSX133/134 cùng file và LSX125 ở file kia): 2 mảnh đối xứng gương "Tay phải"/"Tay trái", mỗi mảnh
7 dòng cắt giống hệt nhau:

| Vật tư | Chiều dài (mm) |
|---|---|
| SAT-VUONG-18X18 | 605, 601, 422, 40 |
| SAT-VUONG-10X10 | 461 |
| SAT-TRON-FI4 | 6 |
| SAT-HOP-10X20 | 497 |

Tạo qua script Prisma một lần (`prisma/tmp-seed-ghe-j55-goplus.ts`, xoá ngay sau khi chạy - theo
đúng quy tắc tránh crash `nest-cli` asset-watcher đã ghi ở changelog 2026-09-16 mục 14.1): dừng
server BE trước khi ghi file vào `prisma/`, chạy xong xoá file rồi mới bật lại server.
`mfgProduct.factoryCode = GHE-J55-GOPLUS`, `BomRevision` ACTIVE, `PlanForm` APPROVED (bắt buộc để
Sales chọn được SKU) - đứng tên `khsx`.

## 5. Live-test đầu-cuối

Luồng thật, không tắt qua bất kỳ bước nào:

1. **Sales** tạo `Customer` + `SalesOrder` (PO-GOPLUS-E2E-01, 300 bộ Ghế J55 Goplus) →
   `SalesOrder` tự sinh 1 `ProductionInvoiceItem` "chưa gom" (candidate).
2. **KHSX** `claim-solo` (1 SKU, không cần gộp) → tạo PI riêng.
   - *Sự cố tự gây*: lúc đầu tạo nhầm PI + item thủ công qua `POST /production-invoices` +
     `POST /items` (bỏ qua candidate thật do SalesOrder sinh ra) → tạo dư 1 nhu cầu 300 bộ. Phát
     hiện qua `cutting-batch-candidates` (chỉ thấy item gốc, không thấy item tạo tay) và
     `production-invoices` list (item tạo tay `salesOrderId=null`). Sửa: Sếp `reject` item tạo tay,
     dùng đúng item gốc qua `claim-solo`.
3. **KHSX** gửi QLSX (`send-to-qlsx`) → **QLSX** gửi Sếp (`send-to-boss`).
4. **Sếp** duyệt (`approve`) → kích hoạt `runSolverAndSave()` tự động.
5. **Kết quả lần 1 (NGƯỠNG MẶC ĐỊNH 1%)**: `NEEDS_ACTION` — 3/4 vật tư cắt tốt
   (SAT-VUONG-18X18 0.195%, SAT-VUONG-10X10 0.288%, SAT-HOP-10X20 0.4%), riêng **SAT-TRON-FI4
   (đoạn 6mm) KHÔNG đạt ngưỡng** — tốt nhất chỉ 30% hao hụt (1 cây 6000mm cắt được rất ít đoạn
   6mm hữu ích so với phần dư). Hợp lý về bản chất: đoạn 6mm quá ngắn so với cây 6m chuẩn, đặc thù
   của vật tư này chứ không phải lỗi 1 lô hàng cụ thể.
6. **Xử lý ca NEEDS_ACTION**: đặt `maxCuttingWastePercentage=35` ở CẤP VẬT TƯ (`PATCH /materials/3`)
   thay vì override per-batch (hợp lý hơn vì đây là đặc tính cố hữu của SAT-TRON-FI4, không phải
   quyết định riêng của lô này) → bấm "Tính lại"
   (`POST /production-orders/:id/cutting-proposals`, role QLSX) → **APPROVED** ngay, 269 cây tổng,
   0.362% hao hụt tổng, tự động duyệt (dưới ngưỡng).
7. **Mua hàng**: `PurchaseProposal` tự sinh đúng 1-1 với `CuttingProposal` đã duyệt, 4 dòng vật tư,
   `buyQty` khớp `totalBars` của solver (168/50/1/50), `stockLengthMm` khớp đúng nguồn (168 cây
   6000mm cố định, 50 cây 5560mm từ `auto_scan`...). `actualStock=0` cho MỌI dòng dù đã có tồn đầu
   kỳ 30 cây/vật tư — **không phải bug**: tồn đầu kỳ tạo lúc `POST /materials` không gắn
   `stockLengthMm` cụ thể (bucket `stockLengthMm=0`, xác nhận qua `GET /stock-quant`), trong khi
   `actualStock` của `PurchaseProposalItem` tính theo ĐÚNG bucket chiều dài solver đề xuất mua
   (6000mm/5560mm) - đúng thiết kế "stock theo chiều dài cụ thể" (xem migration
   `stock_length_bucket`, 2026-08-29).

## 6. Kết luận

- Toàn bộ chuỗi Sales → KHSX → QLSX → Sếp → solver → Mua hàng chạy đúng với dữ liệu THẬT (không
  phải fixture giả lập), bao gồm cả nhánh xử lý vật tư vượt ngưỡng hao hụt (ca thực tế đầu tiên gặp
  phải kể từ khi tính năng ngưỡng hao hụt theo vật tư tồn tại).
- Dữ liệu địn mức "Ghế J55 mới Goplus" hiện có trong DB local là dữ liệu THẬT trích từ Excel, có thể
  dùng tiếp cho các đợt test sau (không phải dọn như các file test tạm khác).
- Xác nhận lại: viết/sửa file trong `prisma/` PHẢI dừng server BE trước — áp dụng chắc chắn cho cả
  script một-lần lẫn seed thông thường, không chỉ lúc đang có solver job chạy nền (khác điều kiện
  hẹp hơn đã ghi ở changelog 2026-09-16 mục 14.1).

## 7. Còn treo

- Chưa seed vật tư ĐÓNG GÓI (`VẬT TƯ THÀNH PHẨM.xlsx`), THIẾT BỊ (`vật tư kho nghiaxx.xlsx`), hay
  đồng bộ TỒN KHO THÀNH PHẨM thật (`kho thành phẩm T5 26.xlsx`) - người dùng xác nhận bỏ qua lần
  này, chỉ tập trung vật tư sắt.
- Định mức "Ghế J55 mới Goplus" mới chỉ có phần KHUNG SẮT (2 mảnh, 7 loại cắt) - chưa có phụ kiện/
  bao bì/sơn/dây... (không có trong 2 file định mức sắt, và nằm ngoài phạm vi lần seed này).
- `SAT-TRON-FI4` đoạn 6mm: cách hiểu "KÍCH THƯỚC=6mm" từ Excel CÓ THỂ không phải chiều dài cắt thật
  (dây phi 4 thường không cắt theo đoạn 6mm) - đã hỏi người dùng, người dùng nói "tiếp tục" nên giữ
  nguyên số liệu gốc và xử lý bằng ngưỡng hao hụt riêng thay vì đoán lại số liệu. Nếu sau này xác
  nhận số liệu gốc sai, cần sửa lại `SegmentSpec` tương ứng.

## 8. Live-test đầu-cuối (tiếp) — nhập kho → xưởng sản xuất → đóng gói

Người dùng yêu cầu tiếp tục test hết chuỗi, không dừng ở Mua hàng: *"test tới cuối cùng nhập kho
thành phẩm luôn, kể cả sản xuất, xuất đan,..."*, sau đó xác nhận tiếp *"chắc chắn, tôi đã kêu test
toàn bộ luồng của hệ thống rồi"* khi được hỏi có nên tiếp tục đào sâu không. Test bằng UI thật (đăng
nhập lần lượt các tài khoản demo đúng vai trò), 2 chỗ phải bridge qua API thẳng (có báo rõ lúc làm):
`window.confirm()` gọi bởi nút "Bắt đầu"/"Kết thúc" floor-stage (ThongKePagePlan.tsx) bị
Claude_Browser tool tự động dismiss nên không bấm được qua UI, và input `type="file"` (modal "Sếp đã
duyệt") không set được qua `form_input`.

### 8.1. Chuỗi đã test qua UI thật cho PI-2026-003 (150 cái GHE-J55-GOPLUS)

Nhập kho sắt (Sếp duyệt mua kèm ảnh phiếu ký - upload thật qua `POST /uploads/document` rồi
`boss-approve` với `approvalFileUrl` thật) → `floor-start` PO (bridge API, xem trên) → Xuất sắt cho
Phôi → Phôi cắt 4 vật tư → KCS duyệt cắt (4/4 đạt) → Hàn 2 mảnh (Tay phải/Tay trái, 150/150, "Lưu
đợt" + "Gửi KCS") → KCS duyệt Hàn (2/2 đạt) → Sơn 2 mảnh (150/150) → KCS duyệt Sơn (2/2 đạt) →
Chuyền kiểm (kho thành phẩm, 150/150 mỗi mảnh, 0 lỗi) → Đóng gói (150/150 thùng, "Còn lại: 0").
"Đan" xác nhận KHÔNG áp dụng cho SKU này (BOM khung sắt hiện tại không có Dây/Đinh/Nút nhựa - đúng
mục 7 "còn treo" là định mức mới chỉ có KHUNG SẮT).

### 8.2. Bug thật tìm được + đã sửa: `batchesByLine`/`awaitingByLine` đè nhau giữa các PO chung mfgProduct

**Triệu chứng**: sau khi Hàn "Lưu đợt" 150 cho mảnh "Tay phải" (PI-2026-003), màn hình Hàn vẫn hiện
"Đã báo: 0", không có nút "Gửi KCS", dù `GET /production-orders/3/production-batches` xác nhận DB
đúng (`reportedQty:150, status:"OPEN"`) và network response trên browser cũng trả đúng dữ liệu đó.

**Nguyên nhân** (`D:\DNA-ERP\src\components\sanxuat\core.tsx`, hàm `fetchHanSonRows()`): PI-2026-001/
002/003 cùng dùng 1 `mfgProduct`/`BomRevision` nên CÙNG `pieceId` (Tay phải=1, Tay trái=2).
`awaitingByLine`/`batchesByLine` trước đây là 2 `Map` GỘP TOÀN CỤC keyed chỉ theo `pieceId`, xây bằng
cách lặp qua TẤT CẢ ProductionOrder rồi `.set(pieceId, ...)` - PO xử lý SAU trong mảng `orders` (BE
trả mới nhất trước: PI-003 → PI-002 → PI-001) ghi đè PO xử lý trước cùng `pieceId`. Kết quả: PO
cuối cùng trong vòng lặp (PI-2026-001, chưa có đợt nào) đè mất dữ liệu batch thật của PI-2026-003,
khiến "Đã báo"/"Gửi KCS" sai cho MỌI PO trừ PO cuối - lỗi này xảy ra bất cứ khi nào 1 sản phẩm được
đặt sản xuất từ 2 PI trở lên (tình huống rất phổ biến), không riêng gì lần test này.

**Sửa**: chuyển `awaitingByLine`/`batchesByLine` từ 2 map gộp toàn cục sang khai RIÊNG cho từng
order ngay trong vòng lặp của `fetchHanSonRows()`, gắn vào từng `ProcRow` (`awaitingByLine`/
`batchesByLine` mới thêm vào interface `ProcRow`) thay vì trả phẳng ở `HanSonFetch`. `TwoTierScreen`
đọc 2 map này từ `selPo` (PO đang chọn) thay vì từ `fetched` toàn cục. Đã verify lại qua UI thật
(reload trang, đăng nhập lại `han`, đi lại đúng đường dẫn PI-2026-003 → SKU → Tay phải): "Chưa gửi
KCS" hiện đúng 150, nút "Gửi KCS" xuất hiện, bấm xong chuyển đúng sang "Chờ KCS duyệt: 150".

### 8.3. Sự cố tự gây trong lúc test: Hàn "Tay phải" bị cộng dồn 450 thay vì 150

Do hiểu lầm UI reset input về "0" sau khi bấm "Lưu đợt" là lưu THẤT BẠI (thật ra là lưu thành công,
input tự clear) nên bấm lại 3 lần → `ProductionBatch.reportedQty` cộng dồn thành 450 (`RecordProductionBatchDto.qty`
chỉ nhận số dương, "Lưu đợt" LUÔN cộng dồn vào batch đang `OPEN`, không có cách sửa/trừ qua API).
Sửa bằng script Prisma một-lần (dừng BE → `prisma/tmp-fix-han-qty.ts` set thẳng `reportedQty=150` cho
`ProductionBatch.id=1` → xoá script → khởi động lại BE), đúng quy trình đã thống nhất cho sửa
`prisma/`. Verify lại qua `GET production-batches` xác nhận `reportedQty:150` trước khi tiếp tục.

### 8.4. Xác nhận: "Nhập kho thành phẩm" (tồn kho có số lượng) CHƯA phải tính năng đã xây — không phải bug

Đọc kỹ code xác nhận: `ProductionInvoicesService.recordPackaging()` (Đóng gói) chỉ tạo
`PackagingRecord`, KHÔNG ghi `StockLedger`/`StockQuant` nào. Comment "Phase 9b" đầu `schema.prisma`
(dòng ~2580) xác nhận đây là CHỦ Ý: domain "Sản lượng theo công đoạn Phôi/Hàn/Sơn" (nguồn tồn khung
thật) "chưa được xây (M2 riêng)" - `WeavingIssue`/`WeavingReceipt` (nhập/xuất đan) và
`PackagingRecord` hiện chỉ là lớp theo dõi THỰC THI (progress tracking), không có state machine,
không đụng tồn kho thật. Vì vậy **"Đóng gói" (150/150, còn lại 0) là điểm dừng cuối cùng mà hệ thống
hiện tại theo dõi được cho PI-2026-003** - không có màn "Nhập kho thành phẩm" riêng để test thêm vì
tính năng đó nằm ngoài phạm vi M2 hiện tại (roadmap `docs/dna-erp-roadmap.html` mục 08), không phải
lỗi bỏ sót của lần test này.

## 9. Kết luận (tiếp mục 6)

- Toàn bộ chuỗi sản xuất thật (Phôi → KCS → Hàn → KCS → Sơn → KCS → Chuyền kiểm → Đóng gói) chạy
  đúng cho PI-2026-003 sau khi sửa bug 8.2 - trước khi sửa, Hàn/Sơn cho sản phẩm "đặt hàng lần 2 trở
  lên" (chung mfgProduct với PO khác) sẽ bị chặn hoàn toàn ở bước "Gửi KCS" (nút không hiện ra).
- Test đến đúng ranh giới tính năng đã xây (Đóng gói) - "Nhập kho thành phẩm" với số lượng tồn thật
  là hạng mục M2 CHƯA triển khai, xem mục 8.4.

## 10. Còn treo (tiếp mục 7)

- PI-2026-001 (300 cái, cùng SKU) mới `floor-start`, CHƯA chạy qua Hàn/Sơn/Đóng gói - không nằm
  trong phạm vi lần test này (chỉ PI-2026-003 được yêu cầu test đến cuối).
- Domain tồn kho thành phẩm thật (StockLedger cho SKU sản xuất xong) chưa được xây - xem mục 8.4,
  không phải việc của thay đổi lần này.

## 11. Đợt test thứ 2 (2026-09-21) — reset lại DB, định mức thật khác, test lại từ đầu

Yêu cầu mới của người dùng: *"clean toàn bộ data của dblocal trừ account, sau đó test toàn bộ
workflow mà hệ thống có thể dùng, tất cả các field và button của hệ thống, live-test với dữ liệu
thật"*, dữ liệu tham khảo trong `C:\Users\ROG ZEPHYRUS\OneDrive\Tài liệu\Đông Nam Á\Mã nhà máy`. Khác
đợt 09-17: **giữ nguyên account** (không seed lại từ đầu), chỉ xoá dữ liệu nghiệp vụ qua
`prisma migrate reset --force` + `npm run seed` + `npm run seed:demo` (18 tài khoản demo, mật khẩu
`demo1234`, xác nhận qua `AskUserQuestion` đúng quy trình an toàn Prisma AI-agent như đợt trước).

### 11.1. Định mức thật mới — 4 sản phẩm, 10 vật tư sắt

Nguồn: `định mức mảnh bàn ghế J55, ghế tình yêu.xlsx` (khác file "Ghế J55 mới Goplus" của đợt
09-17) — 1 sheet, 88 dòng, 4 sản phẩm: **BAN-J55** (Bàn J55 900×735×1420, 5 mảnh), **GHE-J55** (Ghế
J55 500×875×445, 4 mảnh), **GHE-TINH-YEU** (860×510×1225, 10 mảnh), **BAN-8-MEIYING-J55** (5 mảnh).
Parse bằng script Python (`openpyxl`, xem `scratchpad/parse_dinhmuc.py` phiên này) thay vì Prisma
script trực tiếp trên `prisma/real-data/dinh-muc-j55-gtu.json`, seed qua `prisma/seed-real-products.ts`
(giữ lại trong repo, chạy lại vô hại — khác quy tắc "xoá script tạm ngay" của đợt 09-17 vì đây là
seed CHÍNH THỨC dùng lại được, không phải patch một lần).

**2 lỗi phân loại vật tư tự phát hiện và sửa khi viết script parse** (không phải bug ứng dụng, lỗi ở
logic parse của phiên làm việc này):
- 4 dòng ở mảnh "Ghế J55" (A/B) ghi TÊN "sắt hộp" nhưng quy cách lại "Ø21..." (ký hiệu đường kính) —
  tin theo SỐ (Ø=tròn) thay vì TÊN khi phân loại, vì đây rõ ràng là lỗi gõ ở file gốc.
- Áp dụng máy móc "ưu tiên Ø" ban đầu suýt phân loại nhầm "chốt Ø6×60×0.6" và "ô tròn lỗ dù
  55×0.2" (phụ kiện rời, không phải cây sắt cắt theo chiều dài) thành cây TRÒN — sửa bằng cách bắt
  buộc tên phải chứa "sắt" mới được xét VUONG/HOP/TRON, còn lại luôn là OTHER (phụ kiện, chưa seed
  đợt này — nằm ngoài phạm vi `PieceBom`/`SegmentSpec` hiện tại).

**Phát hiện thật (không phải bug, ghi nhận để cân nhắc sau)**: "dằng bàn" của BAN-J55 dùng vật tư
ghi tên "sắt hộp" cho tiết diện 20×20, trong khi BAN-8-MEIYING-J55/GHE-TINH-YEU dùng "sắt vuông" cho
CÙNG tiết diện 20×20 — gần như chắc chắn cùng 1 loại sắt vật lý, nhưng do nhãn "hộp"/"vuông" không
nhất quán ở file Excel gốc nên hệ thống tạo ra 2 `Material` khác nhau (SAT-HOP-20X20 vs
SAT-VUONG-20X20), khiến engine gợi ý gộp SKU không bao giờ đề xuất gộp BAN-J55 với 2 sản phẩm kia
trên vật tư này. Không sửa nhãn nguồn (không chắc quy ước xưởng dùng thế nào), chỉ ghi nhận.

### 11.2. Luồng đã test qua UI thật (Sales → Sếp duyệt → Mua hàng → Nhập kho)

Tạo 2 khách hàng/PO khác nhau (PO-GOPLUS-001: BAN-J55 SL150; PO-MEIYING-001: GHE-J55 SL1200 +
BAN-8-MEIYING-J55 SL300 + GHE-TINH-YEU SL200) → KHSX gộp 2 SKU (BAN-8-MEIYING-J55 + GHE-TINH-YEU)
thành PI-2026-001 (gộp nhiều đơn), claim-solo riêng GHE-J55 → PI-2026-003, riêng BAN-J55 →
PI-2026-002 → gửi QLSX → gửi Sếp → Sếp duyệt (kích hoạt solver) → Mua hàng duyệt kèm ảnh phiếu ký
(upload thật qua `POST /uploads/document`) → Kho nhận hàng (`Nhập kho`, xác nhận từng dòng) →
QLSX `floor-start` từng PO.

**Phát hiện thật #1 — lịch trình ước tính lùi về quá khứ khi gộp SKU có hạn giao khác xa nhau**:
PI-2026-001 gộp 1 SKU hạn 25/10/2026 với 1 SKU hạn 18/10/2026 → các mốc "ước tính" cấp PI (Mua
hàng/Khung CK/Đan/Đóng gói) đều tính lùi từ hạn SỚM NHẤT (18/10), ra "Mua hàng ước tính 31/08/2026"
— đã ở QUÁ KHỨ so với "hôm nay" (21/09/2026) ngay lúc PI vừa được tạo. Chưa sửa, chỉ ghi nhận hành
vi quan sát được (nằm ngoài yêu cầu lần này).

**Phát hiện thật #2 — thời gian solver ở quy mô gộp lớn**: batch gộp 2 SKU × 10 vật tư (PI-2026-001)
mất **~72 giây** để giải (`docker logs catsat_web`: `HTTP POST /api/v1/de_xuat/propose/ 200 [72.15,
...]`), so với <2 giây cho batch đơn giản 1 SKU/3-4 vật tư — số liệu hiệu năng thật, khớp với lo
ngại đã ghi trước đây về khả năng mở rộng của solver, không phải treo/lỗi.

### 11.3. 2 giới hạn công cụ browser test đã xác nhận lại (giống đợt 09-17, không phải bug ứng dụng)

- `input type="file"` (modal "Sếp đã duyệt" mua hàng): không set được qua Claude_Browser →
  workaround `curl -F "file=@..."` tới đúng endpoint `POST /uploads/document` rồi gọi
  `POST /purchase-proposals/:id/boss-approve` với `approvalFileUrl` trả về — đúng DTO/luồng FE
  dùng, không phải tắt qua bước khác.
- `window.confirm()` (nút "Bắt đầu" floor-start): bị Claude_Browser tự động dismiss (trả `false`) —
  xác nhận qua `read_console_messages` (`Page dialog suppressed`), workaround gọi thẳng
  `POST /production-orders/:id/floor-start` bằng token role `qlsx`.

### 11.4. Xuất sắt Phôi (14 đợt, cả 3 PI) — 1 lỗi thao tác TỰ GÂY (không phải bug ứng dụng), đã xác minh nguyên nhân

Trang "Xuất sắt trong phôi" (`XuatSatPage.tsx`): ô "Dài cây (mm)" là input CÓ GIÁ TRỊ THẬT
(`value={barLen[key] ?? String(suggested)}`, mặc định = `bestStockLengthMm` từ phương án cắt đã
duyệt, thường 6000), không phải placeholder — nếu chỉ `click` rồi gõ thêm mà KHÔNG chọn hết nội
dung cũ trước, con trỏ chèn giữa chuỗi số cũ, tạo ra số vô nghĩa (vd gõ "6000" vào giữa "60|00" có
sẵn ra "60600000"), khiến API từ chối đúng ("Tồn kho vật lý cây dài 60600000mm (0 cây) không đủ
xuất..."). Xác nhận đây là lỗi thao tác của phiên test này (không phải bug BE/FE) bằng cách tính
tay: chèn "6000" vào vị trí giữa "6000" gốc cho ra đúng "60600000". Sửa bằng cách luôn
`triple_click` (chọn hết) trước khi gõ đè vào ô này. **Bài học cho các phiên sau**: KHÔNG gõ vào ô
số đã có giá trị mặc định mà không chọn hết trước (dùng `triple_click`, không phải `left_click` rồi
gõ).

Sau khi sửa: cả 14 đợt xuất sắt (PI-2026-002: 3 vật tư, PI-2026-003: 4 vật tư, PI-2026-001: 7 vật
tư) xuất đúng số cây/chiều dài đã duyệt, `Đã xuất` khớp `Cần` từng dòng.

### 11.5. Phôi nhận + báo cắt + KCS duyệt cắt — xong 100% (14/14 đợt)

`phoi` xác nhận nhận đủ 14 đợt kho vừa xuất (nút "Xác nhận đã nhận" từng dòng, `Xác nhận nhận sắt`)
→ báo cắt đủ số đoạn theo từng cỡ (trang "Lệnh sản xuất" công đoạn Phôi, nhập "Nhập đợt này" khớp
đúng "Cần" cho MỌI cỡ đoạn của MỌI vật tư — PI-2026-001/`Sắt vuông 20×20` phức tạp nhất, 11 cỡ đoạn
khác nhau trong 1 lần "Lưu đợt") → "Gửi KCS" từng vật tư → `kcs` duyệt "Tiến hành duyệt" → "Xác nhận
duyệt" (mặc định 0 lỗi, đủ số lượng) cho cả 14/14 đợt — tất cả chuyển "đạt", không có ca lỗi/không
đạt nào cần test nhánh "Không đạt" (còn treo, xem mục 11.7).

### 11.6. Hàn (báo sản lượng theo mảnh) — xong 100% (24/24 mảnh, cả 3 PI)

Xác nhận lại đường vào đúng: "Xác nhận sản lượng" (nav Hàn) chỉ dùng để nhận VẬT TƯ HÀN từ kho
(chưa test vì chưa `Xuất vật tư hàn`), "Khung hàn" chỉ là kho xem khung đã KCS duyệt chờ Sơn (đọc);
màn BÁO SẢN LƯỢNG thật nằm ở "Lệnh sản xuất" → chọn PI → chọn SKU → bấm vào TỪNG MẢNH (`>` chevron)
để mở form nhập — giống hệt cấu trúc UI của Phôi. Báo đủ số lượng theo `Cần` cho:
- PI-2026-002 (Bàn J55, 5 mảnh: chân bàn/đoạn dài/đoạn ngắn/dằng bàn/viền bàn)
- PI-2026-003 (Ghế J55, 4 mảnh: A/B/C/D)
- PI-2026-001 (2 SKU merge — Ghế tình yêu 10 mảnh + Bàn 8 Meiying J55 5 mảnh)

Xác nhận **cổng "Làm tuần tự"** (SKU sau trong PI gộp chỉ mở khi SKU trước đủ 100%) hoạt động đúng
theo SỐ LƯỢNG ĐÃ BÁO (không cần KCS duyệt trước) — Bàn 8 Meiying J55 mở ra ngay sau khi Ghế tình yêu
báo đủ 10/10 mảnh, dù chưa có mảnh nào được KCS duyệt.

### 11.7. Gián đoạn dev server giữa phiên (hết hạn mức, khởi động lại) — sự cố môi trường, không phải bug ứng dụng

Phiên bị ngắt giữa chừng do hết hạn mức sử dụng; lúc tiếp tục, cả 2 dev server (BE port 3001, FE
port 3000) đã tắt (Docker containers Postgres/solver vẫn chạy, không mất dữ liệu). Khởi động lại
qua `preview_start` gặp 1 sự cố: FE (Next.js Turbopack dev) kẹt ở vòng lặp redirect chết
`GET /login → 404` (dù `src/app/login/page.tsx` tồn tại) ngay cả ở tab trắng hoàn toàn mới — do
cache `.next` cũ từ lần chạy trước đó trong phiên (trước khi bị ngắt) không khớp với route thật.
Sửa bằng `rm -rf .next` rồi khởi động lại `next dev` — vào lại bình thường. **Ghi nhận cho các phiên
sau**: nếu FE dev server bị kẹt 404 ở `/login` (hoặc route bất kỳ thật sự tồn tại trong `src/app/`)
ngay sau khi khởi động lại, thử xoá `.next` trước khi nghi ngờ code.

## 12. KCS duyệt Hàn (24/24), Sơn (24/24 báo + 24/24 duyệt) — xong 100%

Lặp lại đúng quy trình mục 11.5 (KCS duyệt theo từng lô/vật liệu, mặc định 0 lỗi) cho công đoạn
**Hàn**: 24/24 mảnh (PI-2026-002: 5, PI-2026-003: 4, PI-2026-001: 7+5+... — thực ra PI-2026-001 gộp
2 SKU nên KCS Hàn hiện thành 2 dòng riêng trong danh sách "Số lô chờ kiểm" dù cùng 1 mã PI, tổng
5+10=15 mảnh) — tất cả "đạt", không có ca lỗi nào.

Sau đó lặp lại **toàn bộ chu trình Sơn** giống hệt Hàn (Sơn báo sản lượng theo mảnh ở "Lệnh sản
xuất" → "Gửi KCS" → KCS duyệt): 24/24 mảnh báo đủ số lượng, 24/24 được KCS duyệt "đạt".

## 13. Chuyển kho nội bộ + Chuyền kiểm + Đóng gói — hoàn tất TOÀN BỘ chuỗi cho cả 4 SKU/3 PI

### 13.1. Phát hiện: `khotp` không thấy "Hiện có" ở Chuyền kiểm dù Sơn đã KCS duyệt hết — không phải bug, thiếu 1 bước trung gian

Sau khi Sơn được KCS duyệt 100%, đăng nhập `khotp` (Kho thành phẩm) vào "Chuyền kiểm" thì mọi mảnh
đều hiện "Hiện có: 0" và nút "Kiểm" báo "Chưa có hàng về để kiểm". Dùng Explore agent lần theo code
(`KhoChuyenKiemPage.tsx` → comment "đã nhập đan/nhập nội bộ về" → `WarehouseTransfersService`) xác
định đây là **2 bước chuyển kho nội bộ bắt buộc, chưa làm**, không phải bug:

1. **`khopsh`** (Kho Phôi Sơn Hàn) → "Xuất theo đơn hàng" → xác nhận số lượng từng mảnh đã qua KCS
   → tạo `WarehouseTransfer` (phiếu "CK-2026-xxx") trạng thái PENDING, đích đến kho Vật tư thành
   phẩm.
2. **`khovttp`** (Kho VTTP) → "Nhập kho" → "Nhập nội bộ" → "Xác nhận nhận hàng" cho từng phiếu →
   chuyển trạng thái CONFIRMED.

Chỉ cần xác nhận xong bước 2 (dù hàng thực tế còn ở kho trung gian `vat-tu-tp`, CHƯA thật sự chuyển
tiếp sang kho `thanh-pham`) là `ProductionInvoicesService.listTransferCheckPieces()` đã tính đủ
"Hiện có" cho Chuyền kiểm — do câu query chỉ lọc theo `productionOrderId + pieceId`, không lọc
`toWarehouseId`. Ghi nhận đúng như code hiện có (không sửa, không phải phạm vi đợt test này), chỉ
lưu ý cho phiên sau: **thứ tự đúng là `khopsh` xuất → `khovttp` nhận, KHÔNG PHẢI `khopsh` → `khotp`
trực tiếp**, dù `khotp` mới là nơi cuối cùng thao tác Chuyền kiểm/Đóng gói.

Thực hiện: `khopsh` xác nhận xuất đủ số lượng cho cả 24 mảnh (4 SKU × 5/4/5/10 mảnh) → 24 phiếu
CK-2026-001..024 → `khovttp` xác nhận nhận đủ cả 24 phiếu.

### 13.2. Chuyền kiểm (khotp) — 24/24 mảnh, 0 lỗi

Cho cả 4 SKU (BAN-J55/PI-2026-002, GHE-J55/PI-2026-003, BAN-8-MEIYING-J55 & GHE-TINH-YEU cùng
PI-2026-001): bấm "Kiểm" từng mảnh, nhập đúng số lượng "Còn lại" vào "Số lượng đã kiểm", không thêm
lỗi nào → "Đã kiểm" khớp "Hiện có" cho toàn bộ 24/24 mảnh.

### 13.3. Đóng gói (khotp) — 4/4 SKU, đủ số thùng

Mỗi SKU chỉ có 1 dòng "Thùng thành phẩm" (không tách theo mảnh) — nhập đúng số lượng = SL đơn hàng
(BAN-J55: 150, GHE-J55: 1.200, BAN-8-MEIYING-J55: 300, GHE-TINH-YEU: 200) → cả 4/4 SKU "Đã đóng gói"
khớp "Tổng thùng", "Còn lại" = 0.

**Đây là điểm dừng cuối cùng hệ thống hiện theo dõi được** — xác nhận lại đúng ranh giới đã ghi ở
mục 8.4 đợt 09-17 (domain tồn kho thành phẩm thật/StockLedger cho SKU sản xuất xong chưa được xây,
M2 riêng), lần này với bộ dữ liệu phức tạp hơn nhiều (4 SKU, 3 PI, 1 PI gộp 2 SKU) chứ không chỉ 1
SKU đơn giản như đợt trước — củng cố thêm rằng ranh giới này là chủ ý thiết kế, không phải giới hạn
riêng của 1 kịch bản test đơn giản.

## 14. Còn treo (tính đến hết đợt 2026-09-21, cập nhật sau mục 18)

- ~~Chưa test nhánh Từ chối ở QLSX/Sếp~~ → **đã test, xem mục 15.1** (KCS "Không đạt" → xem mục 16.2
  và 17.2).
- ~~Chưa test "Sửa thời hạn"~~ → **đã test, xem mục 15.2**.
- ~~Chưa test chế độ "Chấp nhận hao hụt cao hơn (đơn gấp)"~~ → **đã test đầu-cuối, xem mục 15.3** —
  xác nhận tính năng trong `wise-gathering-lake.md` đã triển khai đúng thiết kế.
- ~~Chưa test KCS "Không đạt" ở Phôi cắt + flow "Cấp bù"~~ → **đã test, xem mục 16.2**.
- ~~Chưa test KCS "Không đạt" ở Hàn~~ → **đã test, xem mục 17.2** — hoạt động đúng. Bug THẬT NGHIÊM
  TRỌNG phát hiện cùng lúc (mục 17.1: "Lưu đợt" lưu đúng xuống BE nhưng UI không hiện lại được, không
  bấm "Gửi KCS" được qua UI) → **ĐÃ SỬA, xem mục 18.1-18.2 + 18.4** (root cause: `batchesByLine`/
  `awaitingByLine` khoá theo `pieceId` trần, bị lệch khi 2 lệnh sản xuất dùng chung BOM revision).
- ~~Chưa test KCS "Không đạt" ở Sơn~~ → **đã test, xem mục 17.3** — hoạt động đúng; bug 17.1 CŨNG xảy
  ra ở Sơn (dùng chung `core.tsx` với Hàn) → cùng 1 lượt sửa ở mục 18 đã fix cho cả 2. Chuyền kiểm
  "Không đạt" vẫn CHƯA test.
- ~~Chưa test validation nhập số vượt "Còn lại"~~ → **đã test, xem mục 16.1 và 16.3** — 1 chỗ CÓ chặn
  đúng (xuất sắt cho Phôi, phải khớp phương án cắt) và 1 chỗ KHÔNG chặn (nhận hàng mua vào kho, xem
  16.1) — **đính chính 2026-09-22: KHÔNG chặn là chủ đích** (vật tư bao bì/bì zip không đếm chính xác
  được), không phải bug, không cần sửa.
- ~~Chưa test partial receipt~~ → **đã test, xem mục 16.1** — hoạt động đúng.
- ~~Chưa xác định ý nghĩa badge đỏ "N Issue(s)"~~ → **đã xác nhận + ĐÃ SỬA, xem mục 16.5 + 18.3-18.4**
  — là Next.js dev overlay, trúng đúng 1 lỗi 404 thật (`GET /replenish-requests`) do dead code sót lại
  từ đợt dọn tính năng `ReplenishRequest` ngày 2026-09-08 (BE đã xoá hẳn, FE cleanup lúc đó bỏ sót
  `steel-issues-api.ts` + `XuatSatPage.tsx`) — đã xoá dead code, live-test xác nhận hết badge + hết 404.
- Vẫn chưa test: KCS "Không đạt" ở Chuyền kiểm, Admin screens, "Danh sách SKU"/"Duyệt SKU" edit paths,
  "Văn phòng phẩm", "Lịch sử kho"/"Lịch sử đã mua"/"Theo dõi mua hàng" (read-only history views),
  quote/so sánh NCC ở Mua hàng, "Theo dõi nhập đan"/"Quản lý điểm đan" (không áp dụng cho bộ dữ liệu
  này vì BOM hiện tại chỉ có khung sắt, không có mảnh cần đan).
- File token tạm `.muapsh_token`/`.qlsx_token` ở `D:\DNA-ERP-BE\` root đã dọn (xem mục 11.7 — không
  còn liên quan sau khi hoàn tất đợt test này).
- 3 phát hiện thật đã ghi ở mục 11.1/11.2 (nhãn vật tư "hộp"/"vuông" không nhất quán, lịch trình ước
  tính lùi về quá khứ khi gộp SKU hạn khác xa nhau, thời gian solver ~72s ở quy mô gộp lớn) — chưa
  sửa, chỉ ghi nhận quan sát được, ngoài phạm vi yêu cầu "test toàn bộ workflow" lần này.
- ~~Còn 1 phát hiện thật CHƯA sửa (mục 16.1): over-receipt...~~ → **đính chính 2026-09-22: KHÔNG PHẢI
  bug** (vật tư bao bì/bì zip không đếm chính xác được — thiết kế có chủ đích, xem mục 16.1). 2 bug
  thật còn lại (mục 17.1 Hàn/Sơn "Gửi KCS" và mục 16.5 badge "N Issue(s)") đã sửa xong, xem mục 18.
  → **Không còn bug thật nào tồn đọng từ các đợt live-test đến nay.**

## 15. Đợt test thứ 3 (2026-09-21, tiếp) — nhánh Từ chối, Sửa thời hạn, chế độ hao hụt đặc cách

Dữ liệu test riêng, KHÔNG đụng tới 3 PI đã hoàn tất ở mục 11-13: tạo mới `PO-TEST-REJECT-001` /
`BAN-J55` ×10 → claim-solo 3 lần trên cùng SKU này để lần lượt tạo `PI-2026-002`/`003`/`004` cho từng
kịch bản dưới đây.

### 15.1. Từ chối ở QLSX và ở Sếp — cùng 1 hành vi, đã xác nhận đúng cả 2 nơi

- **QLSX** ("Xử lý lệnh sản xuất" → nút "Từ chối" trên PI): modal yêu cầu lý do bắt buộc
  (`textbox "Nhập lý do từ chối..."`), text cảnh báo *"Từ chối sẽ xoá lệnh sản xuất PI-XXXX và trả 1
  SKU về đơn hàng gốc kèm lý do. KHSX sẽ thấy nó lại ở màn 'Tối ưu cắt sắt' để gộp/cắt lại từ đầu."*
  Xác nhận → `ProductionInvoice` bị xoá hẳn, SKU quay lại "Tối ưu cắt sắt" bên KHSX với badge đỏ
  "REJECTED" + dòng "Bị từ chối: {lý do}".
- **Sếp** ("Lệnh sản xuất" → nút "Từ chối" trên PI): modal, text cảnh báo, và kết quả round-trip về
  KHSX **giống hệt** nhánh QLSX ở trên — cùng 1 cơ chế xoá PI + trả SKU, chỉ khác role gọi.
- Kết luận: nhánh Từ chối hoạt động đúng như mô tả UI ở cả 2 cổng duyệt, không phát hiện lỗi.

### 15.2. "Sửa thời hạn"

Test trên SKU claim-solo bình thường (trước khi thử chế độ đặc cách): sửa 1 mốc đang ở trạng thái
"ước tính" thành ngày cố định — lưu đúng, hiển thị lại đúng ngày vừa chọn, không còn nhãn "ước tính"
cho mốc đó nữa. Không phát hiện lỗi.

### 15.3. Chế độ "Chấp nhận hao hụt cao hơn (đơn gấp)" — xác nhận đầu-cuối đúng thiết kế `wise-gathering-lake.md`

Đây là tính năng cho phép KHSX đề nghị nâng ngưỡng hao hụt + ép cây chuẩn cho từng đợt cắt (thay vì
solver tự quyết như trước), Sếp thấy rõ đề nghị trước khi duyệt. Đã test đầu-cuối qua UI thật +
kiểm tra trực tiếp trong DB:

1. **KHSX** — màn "Tối ưu cắt sắt", claim-solo SKU `BAN-J55`, chọn chế độ "Chấp nhận hao hụt cao hơn
   (đơn gấp)" → hiện đúng như thiết kế: ô "Chấp nhận hao hụt tới %" (prefill "1.8" - ước tính cần
   ≥1.8% do `SAT-HOP-20X20`), checkbox "Giữ đúng chiều dài đã định, không cho hệ thống tự dò cây
   khác" (tự tick sẵn), ô "Lý do để Sếp duyệt". Sửa % thành "5", ghi lý do, tạo `PI-2026-004`, gửi
   QLSX.
   - Gặp lại đúng bug nhập liệu đã ghi ở mục 11.4 (input có giá trị mặc định thật, không phải
     placeholder) — click thường rồi gõ "5" vào ô đang có sẵn "1.8" ra "51.8". Sửa bằng
     `triple_click` chọn hết trước khi gõ — xác nhận lại quy tắc: **luôn `triple_click` trước khi gõ
     vào input có giá trị mặc định thật trong FE này**.
2. **QLSX** — mở PI-2026-004, chọn "Kho thành phẩm (demo)", "Gửi sếp duyệt".
3. **Sếp** — mở PI-2026-004: callout amber *"Kế hoạch SX xin cắt đặc cách — XIN HAO HỤT TỚI 5% — Giữ
   đúng chiều dài đã định... — Lý do: ..."* hiện đúng ở cả header chi tiết PI lẫn modal xác nhận
   duyệt (đúng thiết kế mục 5 của plan — Sếp thấy đề nghị 2 lần trước khi bấm nút cuối). Bấm "Duyệt".
4. **Kiểm DB** (`docker exec dna-erp-be-postgres-1 psql -U erp_user -d dna_erp`):
   - `production_invoices` id=6: `solverMaxWastePctOverride=5.00`, `solverAllowCustomLength=false`,
     `solverOverrideReason` lưu đúng lý do đã nhập, `status=PRODUCING`.
   - `cutting_proposals` id=4 (qua `production_orders.productionOrderId=5`): `status=APPROVED`,
     `hasOverThreshold=false` — solver tự chạy và tự duyệt luôn vì hao hụt thực tế nằm trong ngưỡng
     đã nới (không cần quay lại xin thêm).
   - `cutting_proposal_lines` cả 3 loại sắt (`SAT-HOP-50X50`, `SAT-HOP-25X50`, `SAT-HOP-20X20`):
     `bestStockLengthMm=6000`, `lengthSource='fixed'` cho cả 3 — đúng thiết kế "ép cây chuẩn, không
     cho dò cây lạ". `maxWastePctThreshold=5.000` (đúng bằng override, không phải ngưỡng gốc của
     material) cho cả 3, kể cả 2 loại vốn không phải loại đang vượt ngưỡng — đúng cơ chế "nới chung
     cả đợt" ở mục 2 của plan. Hao hụt thực tế ra (0.713%/0.213%/0.958%) đều thấp hơn cả ước tính ban
     đầu (≥1.75%) lẫn ngưỡng gốc thường dùng — tức trường hợp test này solver vẫn chọn được cây 6000mm
     tối ưu, nhưng cơ chế ép `lengthSource='fixed'` + nới ngưỡng theo override vẫn chạy đúng luồng
     thiết kế, không phụ thuộc kết quả cuối có thực sự cần đặc cách hay không.
5. **Kết luận**: tính năng "Chấp nhận hao hụt cao hơn (đơn gấp)" trong `wise-gathering-lake.md` đã
   được triển khai đầy đủ và hoạt động đúng thiết kế ở cả 3 lớp (KHSX nhập → Sếp thấy + duyệt →
   solver áp override đúng). Không phát hiện lỗi.

## 16. Đợt test thứ 4 (2026-09-21, tiếp) — chạy PI-2026-004 tới xưởng để test partial receipt,
    validation vượt số, KCS "Không đạt" + Cấp bù, và giải mã badge "N Issue(s)"

Tiếp tục dùng PI-2026-004 (SKU test riêng, không đụng 3 PI thật đã xong ở mục 11-13): mua hàng → nhận
kho → bắt đầu xưởng → xuất sắt → Phôi cắt → KCS. Mục tiêu là dữ liệu thật đủ để test các case còn treo
ở mục 14, không phải test lại solver/duyệt (đã xong ở mục 15.3).

### 16.1. Mua hàng: file Sếp duyệt (bridge upload), partial receipt, và over-receipt (KHÔNG PHẢI BUG — xem đính chính 2026-09-22 cuối mục)

- Bridge "Sếp đã duyệt" kèm file: dùng lại quy trình đã thiết lập trước đây (`curl -F` multipart tới
  `POST /uploads/document`, lấy `fileUrl` trả về, rồi `POST /purchase-proposals/:id/boss-approve` với
  `{approvalFileUrl}`) do Claude_Browser không lái được `<input type="file">`. FE sau đó hiển thị đúng
  link "Xem file Sếp duyệt" trỏ về file vừa upload — xác nhận bridge hoạt động đúng, không chỉ ở tầng
  API mà cả UI đọc lại đúng.
- **Partial receipt** (`khopsh` → Nhập kho → PO-TEST-REJECT-001): nhận 3/5 cây `SAT-HOP-50X50` trước
  → "Đã nhận" hiện đúng 3/5, dòng vẫn mở (chưa "Đã nhận đủ"), trạng thái phiếu vẫn "Đang mua hàng".
  Nhận tiếp phần còn lại ở dòng khác (đúng số) → "Đã nhận đủ" đúng. Không phát hiện lỗi ở partial
  receipt.
- **Over-receipt không bị chặn** (ban đầu ghi nhận nhầm là bug, xem đính chính bên dưới): nhập "10" cây
  (khi chỉ còn cần 2/5, tức tổng sẽ là 13/5) cho `SAT-HOP-50X50` → hệ thống chỉ hỏi xác nhận *"Xác nhận
  đã nhận 13 cây 'Sắt hộp 50×50'?"* rồi CHO PHÉP xác nhận bình thường, ghi nhận `receivedQty=13` dù
  `buyQty=5`, đánh dấu "✓ Đã nhận đủ". Số dư thừa (8 cây) sau đó thật sự có mặt trong tồn kho ("Còn
  được xuất" ở màn Xuất sắt lên đúng 13) — tức không phải chỉ hiển thị sai, mà đi vào `stock_quant`
  thật. So sánh với mục dưới (16.3): màn Xuất sắt cho Phôi CÓ chặn vượt số đã giữ chỗ, nhưng màn Nhận
  hàng mua vào kho thì KHÔNG.
  - **Đính chính 2026-09-22**: người dùng giải thích đây là **thiết kế có chủ đích, KHÔNG PHẢI bug**.
    Vật tư dạng bao bì (bao bì, bì zip các kiểu...) không thể nào nhập được số lượng chính xác khớp
    kế hoạch đã mua — thực tế nhận hàng luôn lệch (đếm ước lượng theo cân/kiện, NCC giao dư/thiếu so
    với đơn). Chặn cứng theo `buyQty` sẽ khiến thủ kho không nhận được hàng thật đã về kho. Vậy nên
    "thiếu nhất quán" giữa 2 nơi (16.1 không chặn, 16.3 xuất sắt cho Phôi CÓ chặn) là ĐÚNG Ý, không
    phải lỗi: xuất sắt cho Phôi cần khớp đúng phương án cắt đã duyệt (không co giãn được), còn nhận
    hàng mua thì phải co giãn theo thực tế vật lý giao nhận. Đã lưu vào memory
    (`over-receipt-no-cap-by-design.md`) để không lặp lại nhầm lẫn này. **Không cần sửa gì.**

### 16.2. Xưởng Phôi: floor-start, xuất sắt, và bug nhập liệu tái diễn (lần thứ 3)

- `window.confirm()` chặn nút "Bắt đầu" ở QLSX → Tổng hợp lệnh SX (mẫu hình tương tự các nút
  Kết thúc/Tạm dừng): bridge bằng `POST /production-orders/:id/floor-start` trực tiếp với token qlsx.
- **Bug nhập liệu tái diễn (lần 3 trong toàn bộ đợt test, cùng gốc với mục 11.4 và 15.3.1)**: ở màn
  "Xuất sắt trong phôi" (`XuatSatPage.tsx`), sau khi nhập 3 giá trị (5/8/2) rồi bấm "Xuất" cho dòng
  đầu, 2 dòng sau vẫn giữ nguyên state cũ trong ô "SL cây" dù hiển thị placeholder trống — gõ thêm số
  mới bị NỐI vào giá trị cũ ẩn, ra "88" và "22" thay vì "8"/"2". Khác 2 lần trước (input có default
  value nhìn thấy được): lần này ô trông TRỐNG (placeholder) nhưng vẫn giữ state — tức không chỉ
  input có default value thật mới bị, input rỗng-về-mặt-hiển-thị cũng có thể bị nếu component không
  reset đúng. May mắn là **validate BE đã chặn đúng** (xem 16.3), không có dữ liệu sai lọt qua — nhưng
  củng cố thêm quy tắc thao tác: **luôn `triple_click` trước khi gõ vào MỌI ô số trong FE này, kể cả
  khi ô trông có vẻ trống**, không riêng ô có default value nhìn thấy được.
- Sau khi sửa lại bằng `triple_click`, xuất đúng 5/8/2 cây cho 3 loại sắt — Phôi xác nhận nhận đủ.

### 16.3. Validation vượt "Còn lại" ở Xuất sắt cho Phôi — CÓ chặn đúng

Thử xuất "88" cây `SAT-HOP-25X50` (khi "Còn được xuất" chỉ 8) và "22" cây `SAT-HOP-20X20` (còn 2) —
hệ thống từ chối rõ ràng ngay trên UI: *"Xuất 88 cây vượt quá phần đã giữ chỗ còn lại (8 cây) cho vật
tư 2 của PI 6 - không đủ hứa"* (tương tự cho dòng kia) — không tạo `SteelIssue` nào, không trừ kho.
Đối lập với 16.1 (nhận hàng mua không chặn) — xem ghi nhận nhất quán ở đó.

### 16.4. KCS "Không đạt" ở Phôi cắt + flow "Cấp bù" — hoạt động đúng đầu-cuối

Test trên `SAT-HOP-20X20` (2 cây, cần cắt 20 đoạn 392mm cho cả PI):
1. Phôi báo cắt xong 20/20, gửi KCS.
2. KCS "Tiến hành duyệt" → nhập "5" vào ô "Không đạt" → UI tính lại ngay "Đạt: 15 · Không đạt: 5",
   bắt buộc chọn "Nguyên nhân không đạt" (dropdown rỗng ban đầu — không có danh mục lỗi có sẵn, phải
   tự thêm mới qua ô "+ Thêm loại lỗi mới…", đã thêm "Cắt lệch kích thước" và dùng luôn), có thêm
   "Ghi chú" (đã điền) và "Hình ảnh" (bỏ qua, không bắt buộc) → "Xác nhận duyệt". Kết quả: đợt hiện
   "đạt (lỗi 5 đoạn)" — tức đợt vẫn coi là đã xử lý xong (không phải trạng thái "chờ" mãi), nhưng lưu
   rõ số lỗi + lý do.
3. Quay lại màn cắt của Phôi: dòng vật tư hiện "còn thiếu 5 đoạn", nút **"Bù đủ"** xuất hiện cạnh số
   lỗi (5) — bấm vào tự điền "5" vào ô "Nhập đợt này" (không tự gửi, Phôi vẫn phải bấm "Lưu đợt cắt"
   như bình thường). Lưu → tạo "Đợt 2" (5 đoạn) → "Gửi KCS".
4. KCS duyệt Đợt 2 với "Không đạt" = 0 → "đạt" bình thường. Cả 2 đợt giờ đều "đạt" — vật tư
   `SAT-HOP-20X20` coi như hoàn tất cắt (25 đoạn làm ra / 20 cần, 5 dư từ đợt bù trừ đúng 5 lỗi ban đầu).
5. **Kết luận**: toàn bộ chuỗi KCS "Không đạt" → "Bù đủ" (self-service, Phôi tự cắt bù ngay, KHÔNG qua
   `BeReplenishRequest`/API `/replenish-requests`) → KCS duyệt lại hoạt động đúng, không phát hiện lỗi
   nghiệp vụ. Chỉ mới test ở công đoạn Phôi cắt; chưa test Hàn/Sơn/Chuyền kiểm "Không đạt" (nghi ngờ
   cơ chế tương tự nhưng chưa xác nhận trực tiếp).

### 16.5. Giải mã badge đỏ "N Issue(s)" góc dưới trái FE — Next.js dev overlay, trúng 1 lỗi 404 thật

Bấm vào badge → mở overlay Next.js dev ("Console ApiError"), nội dung: *"Cannot GET
/api/v1/replenish-requests?status=OPEN&limit=100"* (404), stack trỏ về `src/services/core/http.ts:73`
`toApiError()`. Xác nhận:
- `D:\DNA-ERP\src\services\steel-issues-api.ts:499` (list) và `:507`/`:511` (fulfill/reject) gọi
  `/replenish-requests...` — FE có nguyên một client API cho "yêu cầu cấp bù" dạng phiếu riêng
  (`BeReplenishRequest`), được `XuatSatPage.tsx` gọi khi tải trang.
- Grep toàn bộ `D:\DNA-ERP-BE\src` — **không có route/controller `replenish-requests` nào cả** (chỉ có
  chuỗi "ReplenishRequest" xuất hiện trong 1 hằng số quyền + 1 comment không liên quan). Route này
  chưa từng được implement ở BE.
- **Phát hiện thật**: đây là code chết/dở dang ở FE — một thiết kế "yêu cầu cấp bù" dạng phiếu (khác
  với "Bù đủ" tự cắt-ngay đã test ở 16.4, vốn hoạt động tốt và không cần API này) gọi vào một endpoint
  chưa từng tồn tại, gây lỗi 404 mỗi lần vào trang xuất sắt — đây chính là nguồn gốc badge "1 Issue"
  từng thấy lặp lại suốt nhiều đợt test trước mà chưa xác định được. Không ảnh hưởng chức năng chính
  (Cấp bù qua "Bù đủ" vẫn chạy tốt, đây là 1 nhánh khác song song, có vẻ chưa hoàn thiện/chưa gỡ bỏ) —
  chưa sửa, ghi nhận là phát hiện thật ngoài phạm vi yêu cầu lần này.

## 17. Đợt test thứ 5 (2026-09-21, tiếp) — KCS "Không đạt" ở Hàn, và 1 bug FE THẬT NGHIÊM TRỌNG:
    màn báo sản lượng Hàn/Sơn không hiện được đợt vừa "Lưu đợt", không có cách nào bấm "Gửi KCS"
    (**ĐÃ SỬA — xem mục 18**)

### 17.1. Bug thật — `LineDetailCard` (Hàn/Sơn) không hiện đợt OPEN vừa lưu, khoá luôn đường "Gửi KCS"
    (**ĐÃ SỬA, xem mục 18.1** — nguyên nhân: `batchesByLine`/`awaitingByLine` trong `fetchHanSonRows()`
    khoá theo `pieceId` trần, bị 2 lệnh sản xuất dùng chung BOM revision đè lên nhau)

Test qua UI thật (role `han`), vào PI-2026-004 → SKU → mảnh "chân bàn" (P1, cần 40 cái) → nhập "40"
vào "Nhập đợt này" → "Lưu đợt". Kết quả UI: **"Đã báo" vẫn hiện 0, không có nút "Gửi KCS" xuất hiện,
"Chưa gửi KCS" vẫn hiện 0** — y như chưa từng bấm gì.

- Ban đầu tưởng do bug nhập liệu quen thuộc (mục 11.4/15.3.1/16.2) nên thử lại 2 lần nữa bằng
  `triple_click` trước khi gõ — vẫn y hệt kết quả.
- Kiểm tra Network: **`POST /production-orders/5/production-batches/record` trả về `201 Created`
  đàng hoàng** mỗi lần bấm "Lưu đợt" — tức BE nhận và lưu đúng, không phải lỗi request.
- Kiểm thẳng DB (`docker exec dna-erp-be-postgres-1 psql`) xác nhận có 1 dòng
  `production_batches` (`stage=HAN, pieceId=1, status=OPEN`) — nhưng vì "Lưu đợt" CỘNG DỒN vào batch
  OPEN thay vì thay thế (đúng thiết kế, xem comment `production-batches.service.ts:204`), cả 3 lần bấm
  thử đều cộng dồn thành `reportedQty=120` (= 40×3) dù cần chỉ 40 — tự gây ra dữ liệu lệch bởi chính
  việc thử lại nhiều lần, không phải bug riêng.
- **Xác nhận bug thật bằng cách gọi thẳng đúng 2 API mà trang này gọi** (`GET
  .../production-batch-plan?stage=HAN` và `GET .../production-batches?limit=100`) qua
  `javascript_tool` ngay trong tab đang mở, dùng đúng access token của session — cả 2 endpoint trả về
  đúng, `pieceId` khớp kiểu (đều là chuỗi `"1"`), đủ dữ liệu để `batchesByLine.get(1)` tìm ra được
  batch OPEN. Tức **tầng dữ liệu hoàn toàn đúng, lỗi nằm ở tầng render/state của `LineDetailCard`**
  (`D:\DNA-ERP\src\components\sanxuat\core.tsx:717-834`, cùng file dùng chung cho cả Hàn và Sơn).
- **Test lại trên 1 mảnh HOÀN TOÀN SẠCH** (`đoạn dài`, P2, chưa từng có lịch sử) để loại trừ khả năng
  do "Đợt 1: 600 cái" lịch sử của mảnh "chân bàn" (thấy từ trước, không liên quan PI này) gây nhiễu —
  **tái hiện y hệt**: `POST .../record` trả 201, DB có batch OPEN mới (`pieceId=2, qty=20`), nhưng UI
  vẫn "Chưa gửi KCS: 0", không nút "Gửi KCS".
- **Test lại sau khi `location.reload()` (F5 cứng, không phải chuyển trang SPA)** — vẫn y hệt, loại
  trừ luôn khả năng do cache/state cũ của SPA chưa refetch.
- **Không root-cause được chính xác dòng code gây lỗi** trong giới hạn phiên làm việc này (logic
  `batchesByLine`/`openBatch` trong `core.tsx` đọc qua thì đúng cả về kiểu dữ liệu lẫn luồng gọi
  `refetch()` sau khi lưu — cần một dev đọc kỹ hơn / thêm log để tìm chỗ lệch thực sự, có thể do biến
  `line`/`selPo` bị giữ tham chiếu cũ ở tầng nào đó chưa lần ra).
- **Tác động**: đây là bug chặn đường - Hàn/Sơn báo sản lượng xong **không có cách nào qua UI để gửi
  KCS duyệt** (không giống Phôi, nơi "Gửi KCS" hiện đúng ngay sau "Lưu đợt cắt" - xem mục 16.4). Muốn
  tiếp tục test phải bridge thẳng qua API (`POST /production-batches/:id/finish`, dùng token `han`) -
  đã làm vậy để mở khoá test KCS "Không đạt" ở mục 17.2 bên dưới. **Đây là phát hiện quan trọng nhất
  của đợt test này, cần ưu tiên sửa trước khi Hàn/Sơn dùng thật** (hiện tại chắc chắn KHÔNG dùng được
  ở môi trường thật, vì không role nào tự "Gửi KCS" được qua UI).

### 17.2. KCS "Không đạt" ở Hàn — hoạt động đúng (sau khi bridge qua khỏi bug 17.1)

Sau khi bridge cả 5 mảnh của PI-2026-004 sang `AWAITING_QC`, vào màn KCS — Hàn (`KcsStagePage.tsx`):
màn này đọc đúng dữ liệu (hiện đủ "5 lô chờ kiểm, 190 cái" ngay từ đầu) — **xác nhận bug 17.1 CHỈ nằm
ở trang Hàn/Sơn tự báo sản lượng, không lan sang trang KCS duyệt**. Test "Không đạt" trên mảnh
"viền bàn" (20 cái): nhập "6" vào "Số lượng chưa đạt" → tính đúng "Đạt: 14 · Không đạt: 6" → thêm mới
nguyên nhân "Mối hàn không chắc" (dropdown lỗi cũng rỗng ban đầu, giống bên Phôi - danh mục lỗi có vẻ
tách riêng theo từng {PI, mảnh}, không dùng chung 1 danh mục toàn hệ thống) → "Xác nhận duyệt" → kết
quả đúng "14 đạt · 6 không đạt", `SL` tổng PI giảm đúng từ 190 xuống còn 170 (trừ 20 đã xử lý, cộng lại
0 vì không có "Bù đủ" test ở đây). 4 mảnh còn lại duyệt "Đạt" toàn bộ (kể cả mảnh "chân bàn" 120 cái dư
do bug 17.1 - vẫn duyệt được bình thường, không bị BE chặn dù vượt xa "Cần" 40, đúng ý thiết kế "không
clamp Còn lại" ghi trong comment `core.tsx:738-741`). Không phát hiện lỗi nghiệp vụ nào khác ở KCS.

### 17.3. Xác nhận bug 17.1 CŨNG xảy ra ở Sơn (dùng chung `core.tsx`) + KCS "Không đạt" ở Sơn — đúng

Test lại y hệt quy trình 17.1 nhưng ở role `son`: vào PI-2026-004 → mảnh "chân bàn" → nhập "40" →
"Lưu đợt" — **tái hiện y hệt bug 17.1** (Đã báo vẫn 0, không nút "Gửi KCS"). Xác nhận qua DB: batch
`id=54, stage=SON, pieceId=1, reportedQty=40, status=OPEN` được tạo đúng (lần này không bị cộng dồn
sai vì chỉ bấm 1 lần, rút kinh nghiệm từ 17.1) — củng cố thêm: bug nằm ở component dùng chung
`LineDetailCard`/`TwoTierScreen` cho cả 2 công đoạn, không phải lỗi riêng của luồng Hàn.

Bridge nốt 4 mảnh còn lại (`POST .../production-batches/record` cho pieceId 2/3/4/5) rồi `finish` cả
5 batch qua API (token `son`). Vào KCS — Sơn (`KcsStagePage.tsx`, cùng file dùng chung với Hàn): hiện
đúng "5 lô chờ kiểm, 110 cái" ngay từ đầu — **không dính bug 17.1** (giống Hàn, bug chỉ ở trang tự báo
sản lượng). Test "Không đạt" trên mảnh "dằng bàn" (10 cái): nhập "2" → "Đạt: 8 · Không đạt: 2" → thêm
nguyên nhân mới "Sơn loang màu" → "Xác nhận duyệt" → kết quả đúng "8 đạt · 2 không đạt". 4 mảnh còn
lại duyệt "Đạt" toàn bộ. PI-2026-004 giờ đã hoàn tất Hàn + Sơn (đều đã qua KCS, có 2 chỗ ghi nhận lỗi
thật: 5/20 ở Hàn "viền bàn", 2/10 ở Sơn "dằng bàn" — không "Bù đủ" cho các lỗi Hàn/Sơn này vì mục tiêu
chỉ là xác nhận luồng "Không đạt" hoạt động đúng, không phải hoàn thiện dữ liệu PI test). Không phát
hiện lỗi nghiệp vụ nào khác.

## 18. Sửa bug 17.1 (Hàn/Sơn "Gửi KCS" biến mất) + dọn dead code bug 16.4/16.5 (`/replenish-requests`)

Người dùng yêu cầu: điều tra kỹ nguyên nhân bug badge "N Issue(s)" (`/replenish-requests` 404) và lên
plan sửa bug 17.1 — đã điều tra + lên plan qua `EnterPlanMode`, người dùng duyệt gộp sửa cả 2 bug cùng
lượt (xem plan đã duyệt, lưu tại `wise-gathering-lake.md` phiên làm việc này — không phải plan cùng
tên đợt cắt sắt đặc cách trước đó, file đã bị ghi đè hoàn toàn sang chủ đề mới).

### 18.1. Root cause chính xác của bug 17.1 — đã tìm ra (không còn "chưa root-cause" như mục 17.1 ghi)

`D:\DNA-ERP\src\components\sanxuat\core.tsx`, hàm `fetchHanSonRows()` gom dữ liệu Hàn/Sơn của TẤT CẢ
lệnh sản xuất đang chạy vào 2 map DÙNG CHUNG, khoá theo `pieceId` TRẦN (không kèm order id):

```ts
const lineId = Number(item.pieceId)
awaitingByLine.set(lineId, item.awaitingQcQty)          // ← ghi đè nếu 2 lệnh cùng pieceId
batchesByLine.set(lineId, batches.filter(...))            // ← ghi đè nếu 2 lệnh cùng pieceId
```

`pieceId` KHÔNG unique giữa các lệnh sản xuất khác nhau: 2 production order dùng chung 1 BOM revision
(tức cùng sản xuất 1 sản phẩm — ca rất bình thường khi khách đặt lại hàng cũ) có piece TRÙNG y hệt
`pieceId`. Xác nhận trực tiếp qua DB: `PO-GOPLUS-001-1` (order 1, PI-2026-002) và `PO-TEST-REJECT-001-1`
(order 5, PI-2026-004) đều `bomRevisionId=1` (cùng BAN-J55). Vòng lặp xử lý các lệnh theo thứ tự trả về
từ `listProductionOrdersForStage()`, `Map.set()` của lệnh xử lý SAU ghi đè mất dữ liệu (kể cả batch
`OPEN` đang chờ gửi KCS) của lệnh xử lý TRƯỚC nếu cùng `pieceId` — đây chính là lý do "Lưu đợt" lưu
đúng xuống DB nhưng UI không bao giờ thấy được, và cũng giải thích luôn hiện tượng phụ đã thấy ở mục
17.1 (mảnh "chân bàn" hiện nhầm lịch sử "Đợt 1: 600 cái" của PI-2026-002, không phải của chính
PI-2026-004 đang xem).

`KcsStagePage.tsx` (màn KCS duyệt) không dính bug vì không gộp nhiều lệnh vào 1 map khoá `pieceId`
theo cùng cách này.

### 18.2. Cách sửa — chỉ 1 file, không đụng BE

`fetchHanSonRows()`: đổi khoá `awaitingByLine`/`batchesByLine` từ `Map<number, ...>` (khoá = pieceId)
sang `Map<string, ...>` (khoá = `` `${orderId}:${pieceId}` ``). `TwoTierScreen`: giữ nguyên contract
của `VatTuDetailBoard`/`LineDetailCard`/`LineListBoard` (vẫn nhận `Map<number, ...>` như cũ, KHÔNG đổi
3 component này) — thay vào đó dựng thêm `scopedBatchesByLine` (qua `useMemo`, lọc lại đúng theo
`selPo.realOrderId` đang chọn, khoá lại về `line.id` như cũ) và `scopedChoKcsFor` (cùng cơ chế cho
`awaitingByLine`), truyền 2 cái này xuống `VatTuDetailBoard` thay vì map thô. Đã xác nhận
`VatTuDetailBoard` dùng ở `ThongKePagePlan.tsx` (chế độ readOnly cho KHSX xem) không truyền
`batchesByLine`/`choKcsFor` nên không bị ảnh hưởng.

### 18.3. Dọn dead code gây bug badge "N Issue(s)" (`/replenish-requests` 404, mục 16.4/16.5)

Điều tra sâu hơn xác nhận đây KHÔNG phải bug thiếu sót ngẫu nhiên mà là **dead code sót lại có chủ
đích từ 1 đợt refactor trước** — đọc `docs/changelog-2026-09-06-cut-bundle-lifecycle-tach-doi-cat-khoi-dot-nhan.md`
mục 21: ngày 2026-09-08, tính năng `ReplenishRequest` ("cấp bù khi phế", dạng phiếu riêng cho KCS đề
xuất cấp bù) đã bị **xoá hẳn ở BE** (DROP TABLE `replenish_requests`, xoá 3 route
`GET/POST replenish-requests*`, xoá mọi service method liên quan) vì đã hỏng sẵn từ trước (fulfill chỉ
support nhánh Phôi, nhánh Hàn/Sơn/VTTP tạo ra request không bao giờ fulfill được) và được thay bằng
"Bù đủ" (tự cắt/báo bù ngay, không qua API riêng — đã test kỹ ở mục 16.4/17.2-17.3, hoạt động tốt). FE
cleanup lúc đó (mục 21.3 cùng file) chỉ bỏ field `scrapQty` ở `steel-issues-api.ts` — **bỏ sót** 3 hàm
`getReplenishRequests`/`fulfillReplenishRequest`/`rejectReplenishRequest` + type liên quan, và bỏ sót
luôn khối UI "Cần cấp lại — KCS chấm phế" ở `XuatSatPage.tsx` (trang "Xuất sắt trong phôi") vẫn gọi
`api.getReplenishRequests('OPEN')` không điều kiện mỗi lần tải trang → 404 lặp lại vô hạn, chính là
nguồn gốc badge đỏ "N Issue(s)" thấy suốt nhiều đợt test.

Đã xoá: `steel-issues-api.ts` (type `ReplenishRequestStatus`, interface `BeReplenishRequest`, 3 hàm
kể trên), re-export tương ứng ở `api.ts`, và ở `XuatSatPage.tsx`: import, `useFetch(getReplenishRequests)`,
hàm `doCapLai`/`doFulfill`, khối UI "Cần cấp lại", component `ReplenishRow`, cùng icon `PackagePlus`
không còn dùng.

### 18.4. Kiểm tra

- **`npx tsc --noEmit`** (`D:\DNA-ERP`): sạch, không lỗi.
- **`npx eslint`** trên cả 4 file đã sửa (`core.tsx`, `steel-issues-api.ts`, `api.ts`,
  `XuatSatPage.tsx`): 0 lỗi, chỉ còn đúng 2 warning CÓ TỪ TRƯỚC trong `core.tsx` (không liên quan thay
  đổi lần này — `lineStats` unused + 1 warning `react-hooks/set-state-in-effect` cũ).
- **Live-test qua UI thật xác nhận bug 17.1 đã hết** (role `han`, PI-2026-004, mảnh "chân bàn" - đúng
  mảnh từng lỗi, đúng lệnh từng bị PI-2026-002 đè lên): mở lại thấy lịch sử đúng "Đợt 1: 120 cái · đã
  duyệt" (số của CHÍNH PI-2026-004, không còn lẫn "600 cái" của PI-2026-002 như mục 17.1 ghi) — xác
  nhận luôn hết cả hiện tượng phụ. Nhập "5", "Lưu đợt" → **"Chưa gửi KCS" hiện đúng "5", nút "Gửi KCS"
  xuất hiện** → bấm gửi → "Chờ KCS duyệt: 5" đúng — vòng lặp Lưu đợt → Gửi KCS hoạt động đầy đủ lần đầu
  tiên trong toàn bộ đợt test.
- **Live-test bug 18.3**: đăng nhập `khopsh`, vào "Phân phối nội bộ" → "Xuất sắt trong phôi" (đúng
  trang từng gây lỗi) — không còn badge đỏ "N Issue(s)" góc dưới trái, `read_network_requests` lọc
  `replenish` trả về 0 request (trước đó luôn có ít nhất 1 request 404 mỗi lần vào trang này).
- Chưa chạy lại `npx jest` phía BE lúc đó (không đụng BE lần sửa này nên không cần) và chưa test
  regression trên 1 lệnh KHÔNG share BOM revision với lệnh nào khác — **đã bù lại đầy đủ ở mục 19**.

### 18.5. Kết luận

2 bug thật ở mục 16.5/17.1 đã sửa xong: 17.1 (Hàn/Sơn Gửi KCS), 16.5 (badge N Issue(s)/dead code).
Phát hiện thứ 3 (over-receipt không chặn khi nhận hàng mua vào kho, mục 16.1) — **đính chính
2026-09-22: không phải bug**, là thiết kế có chủ đích vì vật tư bao bì/bì zip không đếm chính xác
được, không cần sửa (xem mục 16.1 để biết chi tiết đính chính).

## 19. Dò lại toàn bộ từ đầu tới cuối (2026-09-22) — theo yêu cầu người dùng "dò thêm 1 lần cho chắc"

Người dùng đã tự commit fix ở mục 18 (`178b95e Fix bug FE Han Son gui KCS da luu data nhung FE khong
hien thi`) rồi yêu cầu dò lại kỹ. Việc này rơi đúng lúc có 1 commit MỚI của người khác
(`654981d`/`d62dece` "DEC-53-v2", tác giả `ohey`) đã đè lên SAU commit sửa bug — cùng đụng
`steel-issues-api.ts`/`api.ts` (thêm tính năng gán SKU cho đợt cắt/công đoạn phụ cũ, không liên quan
2 bug đã sửa) — nên việc dò lại lần này còn có ý nghĩa xác nhận fix KHÔNG bị commit sau đè mất.

### 19.1. Xác nhận qua git — không xung đột, không đè mất fix

- `git log --oneline -3 -- src/components/sanxuat/core.tsx` → commit gần nhất vẫn là `178b95e` (fix
  của tôi) - **không ai đụng lại `core.tsx` sau đó**.
- `git show 654981d -- src/services/steel-issues-api.ts src/services/api.ts` → cả 2 diff đều THUẦN
  CỘNG THÊM (thêm field/hàm mới cho tính năng khác), không revert/xoá phần dead-code tôi đã xoá ở mục
  18.3, không tạo xung đột.

### 19.2. Static check lại toàn bộ project (không chỉ file đã sửa)

- `npx tsc --noEmit` toàn bộ `D:\DNA-ERP` sau khi merge cả 2 commit → **sạch, 0 lỗi**.
- `npx eslint src/` toàn bộ project → 135 vấn đề (133 warning + **2 error**) — kiểm tra kỹ: cả 2 error
  (`react/no-unescaped-entities`, dấu `"` chưa escape trong JSX) nằm ở `SpecSteelPage.tsx:763`, file
  **không hề đụng tới** bởi tôi hay bởi commit DEC-53-v2 (lần sửa cuối của file này là commit cũ
  `b4e6db6 DEC41-42-43-49-51`, có từ trước) — xác nhận đây là lỗi CÓ SẴN TỪ TRƯỚC, không phải do lần
  sửa này gây ra.

### 19.3. Phát hiện phụ: môi trường dev BỊ HỎNG do 2 migration Prisma chưa apply (không liên quan 2 bug đã sửa, nhưng chặn hết mọi live-test)

Khởi động lại BE để live-test lại (máy đã qua ngày mới, Docker/BE/FE đều tắt) → **BE lỗi biên dịch 41
lỗi TypeScript**, toàn bộ ở `steel-issues.service.ts`, do code đã tham chiếu cột `productionOrderId`
trên `CutBundle`/`StepBundle`/`StepBatch` (phần BE của tính năng DEC-53-v2, commit BE `d62dece` cùng
tác giả) nhưng **2 migration Prisma đi kèm chưa được apply vào DB dev cục bộ**
(`20260921030000_cut_bundle_production_order`, `20260921060000_step_batch_bundle_production_order`)
→ generated Prisma Client cũ không có field đó. Xác nhận qua `npx prisma migrate status`. Đọc kỹ 2 file
`migration.sql` trước khi chạy — cả 2 đều THUẦN CỘNG THÊM (ADD COLUMN nullable + CREATE INDEX + ADD
FOREIGN KEY `ON DELETE SET NULL`, không DROP/không mất dữ liệu) → chạy `npx prisma migrate deploy` rồi
`npx prisma generate` → BE biên dịch sạch ("Found 0 errors"), khởi động và lắng nghe port 3001 bình
thường. **Đây không phải lỗi do 2 bug tôi sửa gây ra** — là do máy/DB cục bộ chưa đồng bộ với 1 commit
khác của người khác đã push trước đó; sửa 1 lần bằng cách apply migration là xong, không cần lặp lại
trừ khi migration mới lại xuất hiện.

### 19.4. Live-test lại đầy đủ qua UI thật (BE/FE mới khởi động lại, dữ liệu DB giữ nguyên từ trước)

- **Hàn, PI-2026-004, mảnh "chân bàn"** (đúng ca từng lỗi ở mục 17.1): lịch sử đúng "Đợt 1: 120 cái ·
  đã duyệt" (KHÔNG còn lẫn "600 cái" của PI-2026-002). Nhập "5" → "Lưu đợt" → "Chưa gửi KCS: 5" + nút
  "Gửi KCS" hiện đúng → gửi → KCS duyệt "5 đạt".
- **Sơn, PI-2026-004, mảnh "dằng bàn"** (mảnh còn treo 2 cái từ lần test KCS "Không đạt" ở mục 17.3,
  CHƯA re-test sau fix ở lần trước) — bấm "Bù đủ" tự điền "2" → "Lưu đợt" → "Chưa gửi KCS: 2" + nút
  "Gửi KCS" hiện đúng → gửi → KCS duyệt "2 đạt". PI-2026-004 giờ Hàn+Sơn đều 100% xong.
- **Regression trên lệnh KHÔNG share BOM revision** (PI-2026-003, GHE-J55, `bomRevisionId=2` — DUY
  NHẤT lệnh này dùng revision đó): vào Hàn, mảnh "A" — phát hiện thú vị: mảnh "A" của GHE-J55 CŨNG có
  `pieceId=1`, TRÙNG với "chân bàn" của CẢ PI-2026-002 lẫn PI-2026-004 (tức đụng 3 lệnh cùng lúc, không
  phải chỉ 2 như giả thiết ban đầu trong root-cause ở mục 18.1 — piece id có vẻ bị trùng bất cứ khi nào
  nhiều lệnh cùng có mặt trong danh sách "đang chạy" của Hàn/Sơn, không riêng gì cùng BOM revision).
  Lịch sử hiện đúng "Đợt 1: 2.400 cái · đã duyệt" (số của chính PI-2026-003, không lẫn PI khác) — xác
  nhận fix đọc đúng dù va chạm 3 lệnh. Nhập thêm "3" → "Lưu đợt" → "Chưa gửi KCS: 3" + "Gửi KCS" hiện
  đúng → gửi → KCS duyệt "3 đạt". **Kết luận: fix xử lý đúng cả trường hợp va chạm rộng hơn dự kiến ban
  đầu, không chỉ giới hạn ở "2 lệnh cùng BOM revision".**
- **Badge "N Issue(s)"**: xuất hiện lại 1 lần trong lúc dò (2 Issues) — kiểm tra kỹ nội dung qua overlay
  Next.js: cả 2 đều là `ThrottlerException: Too Many Requests`/`Invalid credentials` **tự gây ra** bởi
  chính tôi đăng nhập lại nhiều lần liên tiếp trong lúc test (rate-limit đăng nhập 8 req/60s) — KHÔNG
  phải `/replenish-requests` quay lại. Đóng overlay, tải lại trang → badge biến mất hẳn, xác nhận bug
  16.5 vẫn ở trạng thái đã sửa.
- Dọn dữ liệu test: duyệt hết 3 lô KCS phát sinh trong lúc dò (Hàn "chân bàn" 5 cái, Sơn "dằng bàn" 2
  cái, Hàn "A"/PI-2026-003 3 cái) — không để lại lô nào "chờ KCS" treo lại sau khi dò xong.

### 19.5. Kết luận cuối cùng

Cả 2 bug (17.1 Hàn/Sơn "Gửi KCS", 16.5 badge/dead-code) **được xác nhận sửa đúng và ổn định** qua dò
lại toàn diện: không bị commit khác đè mất, không có regression ở ca đơn-lệnh lẫn ca va-chạm-3-lệnh,
`tsc`/`eslint` sạch trên toàn project (2 lỗi lint còn lại là có sẵn từ trước, không liên quan). Phát
hiện thêm 1 vấn đề môi trường (2 migration Prisma chưa apply, không liên quan 2 bug đã sửa) và đã xử
lý xong trong lúc dò. Phát hiện thứ 3 trước đây (over-receipt không chặn khi nhận hàng mua vào kho,
mục 16.1) đã được người dùng đính chính 2026-09-22: **không phải bug**, là thiết kế có chủ đích (vật
tư bao bì/bì zip không đếm chính xác được) — **không còn bug thật nào tồn đọng** từ toàn bộ các đợt
live-test tính đến nay.
