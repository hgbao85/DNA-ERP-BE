# Changelog 2026-09-12 — Lịch sử nhập xuất kho cho 3 kho vật lý

## 1. Bối cảnh

Người dùng phát hiện màn "Xuất kho" (`WarehouseXuatPage.tsx`) thiếu lịch sử xuất nhập thật. Soi ra:
tab "Lịch sử" ở đó chỉ giữ `txns` trong `useState` cục bộ, đẩy thêm mỗi lần bấm "Xác nhận" thành
công — chính code cũng tự ghi *"Chưa có giao dịch nào **trong phiên này**"*. Tải lại trang / đổi máy
/ người khác đăng nhập là mất sạch.

Rà tiếp thì vấn đề lớn hơn: **3 thủ kho không có đường nào xem được sổ kho thật của kho mình.** Màn
"Tổng hợp kho" (`MfgWarehousesPage.tsx`) có tab Lịch sử đọc `stock_ledger` thật, nhưng tab đó KHÔNG
nằm trong bộ tab của 3 scope kho (chỉ KHSX/Sếp/tổng kho mở được), và bảng ở đó cũng chỉ còn 5 cột rút
gọn.

## 2. Chốt phạm vi với người dùng

Hỏi "lịch sử nên thể hiện gì cho chuẩn ERP" → người dùng chốt gọn: **chỉ là log nhập/xuất**, không
giá vốn/định giá (tôi có nhắc tới giá vốn ở bản đề xuất đầu — bị gạt đúng, đã bỏ). Cũng chốt: **làm
cho 3 kho vật lý** `phoi-son-han`, `vat-tu-tp`, `thanh-pham`, list theo vật tư của chính kho đó.

Kiểm tra hệ thống đang có **7 kho**: 3 vật lý ở trên + 4 kho **ảo** (`SUPPLIER`, `PRODUCTION`,
`SCRAP`, `OPENING_BALANCE`) vốn là điểm đối ứng bút toán, không có tồn vật lý.

## 3. Quyết định thiết kế

**Đọc thẳng `stock_ledger`** — sổ cái bút toán kép duy nhất, mọi luồng đều ghi vào đó qua
`StockLedgerService.postEntry()` (13 `refType`: mua hàng, xuất sắt, xuất vật tư hàn/sơn, tiêu hao
vật tư thành phẩm, chuyển kho, KCS phế, điều chỉnh...). **Rút lại đề xuất trước đó** là gom lịch sử
từ `warehouse-transfers` — làm vậy vừa sót luồng vừa lệch số.

**Bỏ cột "loại chứng từ" riêng**: 4 kho ảo đã tự nói lên nghiệp vụ, chỉ cần hiện **kho đối ứng** —
`SUPPLIER`→kho = mua về, kho→`PRODUCTION` = xuất cho sản xuất, kho→`SCRAP` = phế liệu,
`OPENING_BALANCE`↔kho = tồn đầu kỳ/sửa tay, kho↔kho vật lý = chuyển kho nội bộ.

**7 cột chốt**: Thời gian · Mặt hàng (mã + tên) · Nhập/Xuất · Số lượng + ĐVT · Đối ứng · Người thực
hiện · Ghi chú.

## 4. Đã làm

**BE** (`stock-ledger`) — dữ liệu vốn đã load sẵn trong `LEDGER_INCLUDE`, chỉ là DTO không trả ra:
- `StockLedgerResponseDto` thêm: `materialName`, `materialUnit` (không có ĐVT thì "18" vô nghĩa —
  18 cây hay 18 kg?), `fromWarehouseName`/`toWarehouseName` (đọc "Nhà cung cấp" dễ hơn "SUPPLIER"),
  `stockLengthMm` (cùng mã sắt khác chiều dài là 2 lô tồn RIÊNG), `createdByName`.
- `createdByName` lấy thẳng từ relation `createdBy` (thêm vào `LEDGER_INCLUDE`) **thay vì để FE
  resolve qua `GET /users`** như các màn Admin: `WAREHOUSE_STAFF` không có quyền `USER:VIEW` nên gọi
  `/users` sẽ 403 — đây là điểm dễ vấp nếu làm theo idiom cũ.
- Test: mock row bổ sung `name`/`unit`/`stockLengthMm` + 1 case mới xác nhận DTO trả đủ các field.

**FE**:
- Component dùng chung mới `components/WarehouseLedgerHistory.tsx` — nhận `warehouseId` +
  `warehouseCode`, tự fetch `GET /stock-ledger?warehouseId=...` (BE đã lọc sẵn "mọi bút toán chạm
  tới kho này", cả 2 chân from/to), bộ lọc Tất cả/Nhập/Xuất + khoảng ngày. Nhận diện mặt hàng theo
  đúng XOR 4 chân hàng của sổ (vật tư / đoạn sắt / mảnh / thành phẩm) thay vì chỉ mã vật tư.
- `InboundWarehouseApp.tsx`: thêm tab **"Lịch sử kho"** cho cả 3 scope kho, tự khoá vào đúng kho của
  người đăng nhập (resolve `warehouseScope` code → warehouse id qua `getWarehouses()`).
- `MfgWarehousesPage.tsx`: thay bảng lịch sử cũ bằng chính component trên (dùng chung), **xoá code
  chết**: `interface Txn`, `interface LedgerRow`, `function WarehouseHistory` (~100 dòng), mapping
  `txns`, import `getStockLedger` không còn dùng.

## 5. Kiểm tra

- BE: `npx tsc --noEmit` sạch, `npx jest` — **47 suites / 1004 test pass**. (Lần chạy đầu 1 suite
  `audit-log` fail do worker jest thoát lỗi, chạy lại `-w 2` pass hết — flaky môi trường, không phải
  regression.)
- FE: `npx tsc --noEmit` sạch, `npx eslint` 0 lỗi (chỉ còn warning `react-hooks/purity` có sẵn từ
  trước ở `MfgWarehousesPage`, không liên quan).
- Live-test tài khoản `khopsh` (Kho Phôi Sơn Hàn) — sổ hiện đủ 9 bút toán thật, đọc được ngay:

  | Thời gian | Mặt hàng | Nhập/Xuất | SL | Đối ứng | Người |
  |---|---|---|---|---|---|
  | 14:18 11/09 | E2E-SAT-25 @ 700mm (đoạn sắt đã cắt) | Xuất | −5 đoạn | Chuyển đến Đang sản xuất (ảo) | Hàn (demo) |
  | 08:32 11/09 | E2E-SAT-25 · cây 5.620mm | Nhập | +3 cây | Nhận từ Nhà cung cấp (ảo) | Kho phôi sơn hàn |
  | 11:25 10/09 | E2E-SAT-25 | Nhập | +200 cây | Nhận từ Đối ứng tồn kho ban đầu (ảo) | Quản trị viên 2 |

- Live-test `khotp` (Kho Bao bì/Thành phẩm): tab lên đúng, hiện empty state "Kho này chưa có giao
  dịch nhập xuất nào" (data demo chưa phát sinh bút toán cho kho này).

## 6. Vòng 2 (cùng ngày) — bỏ tab trùng + bám bộ cột người dùng đã quen

**a. Bỏ tab "Lịch sử" chết trong màn Xuất kho.** Người dùng nhắc chung: *"lúc nào nhớ để ý UI UX
luôn"* — 2 tab cùng tên "Lịch sử" nằm cạnh nhau trong cùng phân hệ, một cái LUÔN trống, là lỗi UX rõ
ràng. Đã xoá hẳn tab + `interface Txn` + state `txns` + 3 khối `setTxns` optimistic + khối render +
import thừa (`Clock`, `tabBtn`) khỏi `WarehouseXuatPage.tsx`. Giờ chỉ còn 1 nguồn lịch sử duy nhất là
tab "Lịch sử kho".

**b. Đổi bộ cột theo mẫu màn "Lịch sử nhập nội bộ"** (`InternalTransferSections.tsx`) mà người dùng
đã quen — họ gửi ảnh và yêu cầu "show các trường giống như này":

| Trước | Sau |
|---|---|
| Thời gian · Mặt hàng · Nhập/Xuất · SL · Đối ứng · Người · Ghi chú | Thời gian · **Chứng từ** · **Từ kho** · **Đến kho** · Mặt hàng · SL · Người · Ghi chú |

- Bỏ cột "Nhập/Xuất" riêng (hướng đã thể hiện qua dấu ±, màu, và cặp Từ/Đến kho) — tránh phình cột.
- Tách "Đối ứng" thành **Từ kho / Đến kho** đúng như màn mẫu.

**c. Cột "Chứng từ" + ràng buộc dữ liệu thật.** Kiểm tra toàn bộ bảng nguồn: **CHỈ
`WarehouseTransfer` có cột `code`** đọc được (`CK-2026-010`); `SteelIssue`/`MaterialIssue`/
`PackagingIssue`/`PurchaseProposal`/`MaterialYieldIssue`/`WeavingIssue`/`ProductionBatch` đều **không
có mã** - `refId` chỉ là id số. Nên:
- BE: thêm `refCode` vào `StockLedgerResponseDto`, `findAll()` batch-tra `warehouse_transfers` cho
  riêng refType=WAREHOUSE_TRANSFER (1 query/trang, bỏ qua nếu trang không có dòng nào loại này).
- FE: ô "Chứng từ" hiện mã thật khi có (kèm dòng phụ "Chuyển kho"), còn lại hiện **nhãn loại bút
  toán** tiếng Việt (Mua hàng / Xuất sắt / Tiêu hao đoạn sắt / Điều chỉnh / Xuất bao bì...) thay vì
  để cột trống — không bịa mã phiếu giả.

**d. KHÔNG thêm cột "Trạng thái"** dù màn mẫu có: mỗi dòng sổ kho là bút toán **đã ghi** (sự việc đã
rồi), không có trạng thái chờ/từ chối — phiếu bị từ chối thì không bao giờ sinh bút toán. Thêm vào
sẽ là cột hằng số vô nghĩa.

**Kiểm tra**: BE `tsc` sạch, `npx jest stock-ledger` — **24 test pass** (thêm 2 case: tra đúng mã
phiếu cho bút toán chuyển kho + không query bảng chuyển kho khi trang không có dòng nào). FE `tsc`/
`eslint` sạch. Live-test `khopsh` — sổ hiện đúng: *"Tiêu hao đoạn sắt · Kho Phôi Sơn Hàn → Đang sản
xuất (ảo) · E2E-SAT-25 @ 700mm · −5 đoạn · Hàn (demo)"*, *"Mua hàng · Nhà cung cấp (ảo) → Kho Phôi
Sơn Hàn · +3 cây"*.

**e. Đổi tên hiển thị 4 kho ảo.** Người dùng hỏi lại "đang hiển thị các kho ảo à?" — đúng là chưa
ổn: tên thật trong DB mang cách gọi kỹ thuật + chữ "(ảo)" (`Đối ứng tồn kho ban đầu/điều chỉnh (ảo)`,
`Đang sản xuất (ảo)`), hợp với Admin nhưng vô nghĩa với thủ kho đang đọc sổ. **Không ẩn** 4 kho này
(kho đối ứng chính là phần "vì việc gì" — ẩn đi thì cột Từ/Đến kho trống trơn), chỉ đổi nhãn hiển thị
ở FE theo cách gọi nghiệp vụ:

| Kho ảo (tên DB) | Hiện trên sổ |
|---|---|
| Nhà cung cấp (ảo) | Nhà cung cấp |
| Đang sản xuất (ảo) | Xưởng sản xuất |
| Phế liệu (ảo) | Phế liệu |
| Đối ứng tồn kho ban đầu/điều chỉnh (ảo) | Cân đối tồn kho |

Chỉ là lớp hiển thị (`VIRTUAL_WAREHOUSE_LABEL` trong `WarehouseLedgerHistory.tsx`) — không đổi tên
kho trong DB, Admin vẫn thấy tên gốc ở màn quản lý kho.

**f. "Từ / Đến" + chỉ đúng TỔ tiêu thụ.** Người dùng chốt tiếp: đổi tiêu đề `Từ kho`/`Đến kho` →
**`Từ`/`Đến`**, và ví dụ họ đưa là *"Đến: Tổ Phôi"* — tức phải chỉ đúng tổ chứ không phải gom hết về
"Xưởng sản xuất" (kho ảo `PRODUCTION` là điểm đến chung của MỌI luồng vào xưởng nên đọc không ra
nghĩa).

- BE: thêm `refStage` vào `StockLedgerResponseDto`; `findAll()` batch-tra công đoạn từ bản ghi nguồn
  cho 2 refType có cột `stage` thật — `SEGMENT_CONSUME` → `ProductionBatch.stage`, `MATERIAL_ISSUE`
  → `MaterialIssue.stage` (mỗi bảng 1 query/trang, bỏ qua nếu trang không có dòng nào loại đó).
- FE: khi kho đối ứng là `PRODUCTION` thì hiện tổ — ưu tiên `refStage` (PHOI/HAN/SON/DAN → Tổ Phôi/
  Tổ Hàn/Tổ Sơn/Điểm đan), refType không có stage thì suy tổ cố định theo nghiệp vụ
  (`STEEL_ISSUE`/`MATERIAL_YIELD_CONSUME`/`FRAME_OUTPUT` → Tổ Phôi, `WEAVING_ISSUE_MATERIAL` → Điểm
  đan, `PACKAGING_ISSUE` → Tổ đóng gói).

Kết quả đọc trên sổ: *"Tiêu hao đoạn sắt · Kho Phôi Sơn Hàn → **Tổ Hàn** · −5 đoạn"*, *"Xuất sắt ·
Kho Phôi Sơn Hàn → **Tổ Phôi** · −3 cây"*, *"Mua hàng · **Nhà cung cấp** → Kho Phôi Sơn Hàn · +3
cây"*. BE 25 test pass (thêm case tra đúng stage), tsc/eslint 2 bên sạch, đã live-test `khopsh`.

**g. Gộp phiếu bị từ chối vào sổ + tách lại cột "Trạng thái".** Người dùng hỏi: "chuyển qua Lịch sử
kho có thể xem được lịch sử đã xác nhận với từ chối luôn có sao đâu?" — đúng, không có gì cản. Phiếu
CONFIRMED đã có sẵn trong sổ cái (qua `refCode`), chỉ thiếu REJECTED (không sinh bút toán, đúng vì
hàng không di chuyển). Đã gộp thêm:

- BE (`warehouse-transfers.service.ts`, `warehouse-transfer-response.dto.ts`): thêm
  `createdByName`/`confirmedByName`/`rejectedByName` — resolve tên qua relation
  `createdBy`/`confirmedBy`/`rejectedBy` (cùng vấn đề đã vá ở `stock-ledger`: thủ kho không có
  `USER:VIEW` nên không tự gọi `/users` được). Test: thêm case xác nhận tên trả đúng khi relation có
  dữ liệu. 35 test pass (thêm 1).
- FE (`WarehouseLedgerHistory.tsx`): gọi thêm `getWarehouseTransfers('REJECTED')`, lọc đúng phiếu
  chạm tới kho đang xem (`fromWarehouseId`/`toWarehouseId`), ghép chung 1 danh sách với sổ cái, sort
  lại theo thời gian. Đánh dấu RÕ RÀNG dòng này khác dòng sổ cái thật (nền xám nhạt, "Số lượng" =
  "—" vì không có gì di chuyển).
- Sau đó người dùng yêu cầu thêm: **tách riêng cột "Trạng thái"** (thay vì nhét badge vào ô "Số
  lượng") với đúng 2 giá trị **"Đã xác nhận"/"Đã từ chối"**, dùng lại đúng 2 màu của
  `TRANSFER_STATUS_MAP` cũ (`#e8f5e9`/`#2e7d32` xanh, `#fce4ec`/`#c62828` đỏ) - dòng sổ cái nào cũng
  là "Đã xác nhận" (bút toán chỉ tồn tại vì đã thật sự xảy ra).
- **Xóa hẳn bảng "Lịch sử nhập nội bộ"** khỏi `InternalTransferSections.tsx` (giữ nguyên khối "đang
  chờ nhận" - phần duy nhất Lịch sử kho không thay thế được, vì sổ cái không có khái niệm "đang
  chờ"). Xóa luôn `TransferHistoryTable` (~50 dòng) + import thừa (`TRANSFER_STATUS_MAP`,
  `tableWrap`, `tbl`, `row`, `badge`).

**h. Đổi tên cột "Chứng từ" → "Mã phiếu"** — người dùng chỉ ra ảnh gốc ("Lịch sử nhập nội bộ") ghi
"Mã phiếu", không có chữ "Chứng từ" nào; đó là tôi tự đặt. Đồng thời sửa lại ô này cho ĐÚNG NGHĨA của
tên cột: trước đây khi không có mã thật, ô chính hiện tên loại bút toán ("Mua hàng", "Xuất sắt"...)
IN ĐẬM giống hệt kiểu 1 mã phiếu thật — dễ hiểu lầm đó là mã. Giờ ô chính LUÔN là mã thật hoặc dấu
"—" xám nếu không có; tên loại bút toán chuyển hẳn xuống dòng phụ nhỏ, mọi dòng đều có (không chỉ
khi có mã).

**i. Bỏ hẳn cột "Người thực hiện".** Người dùng thấy thừa: phần lớn chỉ lặp lại tên chính kho đang
xem (thủ kho tự xuất/nhập cho kho mình) — không thêm gì so với cột Từ/Đến đã có. Xóa khỏi header +
cả 2 nhánh render (ledger/rejected); `createdByName`/`rejectedByName` vẫn giữ trong type/DTO (không
hại gì khi không dùng, tái sử dụng được sau).

**Kiểm tra vòng 2**: BE `tsc` sạch, `npx jest warehouse-transfers` (35 pass) + `stock-ledger` (25
pass, không đổi). FE `tsc`/`eslint` sạch. Live-test bằng cách tạo thật 1 phiếu chuyển kho (API) rồi
từ chối nó (`khovttp` từ chối phiếu `khopsh` gửi) — "Lịch sử kho" của `khopsh` hiện đúng dòng nền
xám, badge đỏ "Đã từ chối", lý do "Sai số lượng, không đúng vật tư", Số lượng = "—".

**Lưu ý phát sinh khi live-test**: phiếu test tôi tạo (`CK-2026-001`) dùng **vật tư nguyên (sắt
cây)** thay vì mảnh đã cắt — người dùng chỉ ra đây không đúng nghiệp vụ thật (sắt cây không đi
chuyển kho, chỉ mảnh/vật tư thành phẩm mới đi theo chuỗi phôi-son-han→vat-tu-tp). Hệ thống (BE)
không chặn vì `isValidTransferRoute()` chỉ kiểm tra "gia đình kho" hợp lệ, không kiểm tra loại hàng
có phù hợp với chặng đó không - **không phải bug cần sửa trong đợt này**, chỉ là dữ liệu test tôi
chọn sai ví dụ. Đã cố xóa dòng test này khỏi DB dev nhưng bị chặn bởi permission classifier (thao
tác xóa nhiều bảng liên quan FK) - còn treo, xem mục dưới.

**Ngoài lề (không liên quan thay đổi này)**: lúc live-test mọi API trả 500 "Database error" — do 2
migration mới trong code vừa commit (`piece_material_item_include_in_weaving`,
`weaving_issue_material`) **chưa được áp vào DB dev local**, và Prisma Client cũng chưa generate lại.
Đã chạy `npx prisma generate` + `npx prisma migrate deploy` (cả 2 migration đều thuần cộng thêm: ADD
COLUMN có default, ADD enum value, CREATE TABLE mới - không có lệnh phá huỷ nào). Máy khác pull code
này về cũng sẽ cần làm 2 bước đó.

## 7. Vòng 3 (cùng ngày) — Sếp duyệt qua Trương Văn Nhân: bỏ Trạng thái + gộp từ chối, thêm Lệnh sản xuất/PO

Người dùng gửi lại nguyên văn phản hồi của Sếp (qua tin nhắn với Trương Văn Nhân, kèm 1 ảnh màn hình
khác không phải màn này) và yêu cầu áp dụng cho "Lịch sử kho":

- Trương Văn Nhân: *"chỗ mã phiếu nên sửa thành lệnh sản xuất á anh"*, *"với thêm cái mã đơn hàng
  (po) nữa"*.
- Người dùng tự hỏi lại: *"bị nhiều quá không"*, *"có cần xóa bớt trường nào không"*.
- Trương Văn Nhân trả lời: *"bỏ cột trạng thái"*, *"lịch sử chỉ ghi lại những lần xuất, nhập được
  chấp nhận"*, *"nếu từ chối thì ko cần thêm vào lịch sử"*.

**Quyết định** (không hỏi lại người dùng — áp dụng theo đúng nghĩa đen của phản hồi, phù hợp nguyên
tắc sổ CÁI chỉ ghi việc đã thật sự xảy ra mà chính component này đã ghi ở đầu file):

a. **Bỏ hẳn phần gộp phiếu chuyển kho bị TỪ CHỐI** vào Lịch sử kho (`getWarehouseTransfers
   ('REJECTED')` + biến `Row` dạng union `kind: 'ledger' | 'rejected'`) — tính năng này mới thêm ở
   mục 6g theo yêu cầu người dùng lúc đó, nay Sếp duyệt lại và chốt bỏ. Quay lại đọc thẳng 1 nguồn
   `stock_ledger`, đúng tinh thần "sổ cái là nguồn duy nhất đúng" đã ghi ở đầu file.
b. **Bỏ hẳn cột "Trạng thái"** — hệ quả trực tiếp của (a): khi chỉ còn dòng sổ cái (luôn "Đã xác
   nhận") thì cột này không còn giá trị thông tin.
c. **Đổi tên cột "Mã phiếu" → "Lệnh sản xuất"** — GIỮ NGUYÊN logic nội dung ô (mã phiếu chuyển kho
   thật khi có, còn lại là nhãn loại nghiệp vụ) — không đổi thành hiện `ProductionOrder.poNumber`
   vì quy ước toàn hệ thống là mã này CHỈ dùng nội bộ tra cứu, KHÔNG hiển thị cho người dùng (xem
   `InspectionContext.tsx` dòng ~76, `BePieceTransferPlanItem.poNumber` ở FE) — hiển thị đúng sẽ là
   `SalesOrder.orderCode`, tách riêng ở cột (d).
d. **Thêm cột mới "Mã đơn hàng (PO)"** — BE: `StockLedgerResponseDto.poCode`, tra qua
   `StockLedgerService.fetchPoCodes()` (mới, cùng pattern batch-resolve với `fetchRefStages`/
   `fetchTransferCodes`, 1 query/loại refType cho cả trang). Chuỗi quan hệ dùng lại đúng idiom đã có
   sẵn ở `MaterialIssuesService`/`PackagingIssuesService`/`ProductionBatchesService`/
   `WeavingIssuesService`/`MaterialYieldIssuesService`:
   `productionOrder.productionInvoiceItem.salesOrder.orderCode` (cho MATERIAL_ISSUE,
   SEGMENT_CONSUME, PACKAGING_ISSUE, MATERIAL_YIELD_CONSUME, WEAVING_ISSUE_MATERIAL); riêng
   STEEL_ISSUE đi thẳng `productionInvoice.salesOrder.orderCode` (không qua ProductionOrder, theo
   idiom `SteelIssuesService`). Null cho refType không gắn Lệnh sản xuất nào (mua hàng, chuyển kho,
   KCS phế, điều chỉnh tay) hoặc khi PI nguồn là PI gộp nhiều đơn (`ProductionInvoice.salesOrderId
   = null`).

Bộ cột cuối cùng: **Thời gian · Lệnh sản xuất · Mã đơn hàng (PO) · Từ · Đến · Mặt hàng · Số lượng ·
Ghi chú** (vẫn 8 cột như trước vòng này - bỏ 1 cột Trạng thái, thêm 1 cột Mã đơn hàng (PO) bù lại).

**Đã làm**:
- BE: `stock-ledger-response.dto.ts` thêm `poCode`; `stock-ledger.service.ts` thêm
  `fetchPoCodes()` + gọi trong `findAll()` + tham số mới ở `toResponseDto()`.
- BE test: `stock-ledger.service.spec.ts` — thêm mock `packagingIssue`/`materialYieldIssue`/
  `weavingIssueMaterial`/`steelIssue`, thêm test case tra `poCode` (gắn Lệnh sản xuất → có mã; PI
  gộp không tra được → null; refType không gắn đơn hàng → null, không query gì thêm).
- FE: `stock-api.ts` thêm `poCode` vào `BeStockLedgerEntry`; `WarehouseLedgerHistory.tsx` bỏ hẳn
  `getWarehouseTransfers`/kiểu `Row` union/`rejectedItemSummary()`/badge Trạng thái, đổi header
  "Mã phiếu" → "Lệnh sản xuất", thêm cột "Mã đơn hàng (PO)", cập nhật lại toàn bộ doc comment đầu
  file cho khớp thiết kế mới, `colSpan` giữ nguyên `8`.

**Kiểm tra (lần 1, chỉ đổi tên nhãn cột (c), chưa sửa nội dung)**: BE `npx tsc --noEmit` sạch,
`npx eslint --fix` sạch (0 lỗi), `npx jest stock-ledger.service.spec.ts` 26/26 pass (25 cũ + 1 mới
cho `poCode`). FE `npx tsc --noEmit` sạch, `npx eslint` sạch. Live-test qua UI thật (Super Admin →
Quản trị hệ thống → Quản lý kho → Kho Phôi Sơn Hàn → Lịch sử Nhập/Xuất): xác nhận đúng 8 cột như
trên, không còn cột Trạng thái, phiếu `CK-2026-001` (REJECTED, dữ liệu test — xem mục 9) không còn
xuất hiện trong danh sách; cột "Mã đơn hàng (PO)" hiện đúng "PO-1" cho các dòng Xuất sắt/Tiêu hao
đoạn sắt/Tiêu hao vật tư TP, hiện "—" cho Mua hàng/Điều chỉnh (đúng - 2 loại này không gắn Lệnh sản
xuất nào).

e. **Sửa tiếp (người dùng phát hiện ngay sau khi xem live)**: người dùng hỏi lại *"sao lệnh sản xuất
   lại hiển thị Tiêu hao đoạn sắt, Xuất sắt, Mua hàng, Tiêu hao vật tư TP, Điều chỉnh"* — đúng, vì
   (c) ở trên CHỈ đổi nhãn cột mà giữ nguyên nội dung cũ (nhãn loại nghiệp vụ, không phải mã Lệnh
   sản xuất thật) nên cột đọc như dữ liệu rác, kể cả với dòng Mua hàng/Điều chỉnh vốn không hề gắn
   Lệnh sản xuất nào. Sửa lại: dòng chính của cột giờ hiện `piCode` thật
   (`ProductionInvoice.code`, vd "PI-2026-001") khi bút toán gắn 1 PI cụ thể, hoặc `refCode` (mã
   phiếu chuyển kho) cho WAREHOUSE_TRANSFER, "—" khi không có gì để tra (mua hàng, điều chỉnh tay,
   KCS phế...); nhãn loại nghiệp vụ ("Tiêu hao đoạn sắt", "Mua hàng"...) lùi xuống làm dòng phụ nhỏ
   bên dưới, đúng vai trò ban đầu của nó. Thêm BE: `StockLedgerService.fetchPiCodes()` (cùng pattern
   `fetchPoCodes()` nhưng đi tới `productionInvoice.code` thay vì `salesOrder.orderCode` — KHÔNG có
   ca null vì PI gộp, vì `ProductionInvoice.code` luôn có bất kể `isMerged`, chỉ `salesOrderId` mới
   null khi gộp) + `StockLedgerResponseDto.poCode` → thêm `piCode`. FE: `stock-api.ts` thêm
   `piCode`, `WarehouseLedgerHistory.tsx` đổi dòng chính của ô "Lệnh sản xuất" thành
   `e.refCode ?? e.piCode ?? '—'`.

**Kiểm tra (lần 2, sau khi sửa (e))**: BE `npx tsc --noEmit` sạch, `npx eslint --fix` sạch (0 lỗi),
`npx jest stock-ledger.service.spec.ts` 27/27 pass (thêm 1 test cho `piCode`: gắn PI → có mã; STEEL_
ISSUE gắn PI → có mã; refType không gắn Lệnh sản xuất nào → null). FE `npx tsc --noEmit`/`eslint`
sạch. Live-test lại (cùng tài khoản/màn ở trên, sau khi hot-reload): cột "Lệnh sản xuất" hiện đúng
**PI-2026-001** (in đậm, monospace) cho các dòng Tiêu hao đoạn sắt/Xuất sắt/Tiêu hao vật tư TP, hiện
"—" cho Mua hàng/Điều chỉnh; nhãn loại nghiệp vụ vẫn còn nhưng nay là dòng phụ nhỏ màu xám bên dưới,
không còn bị hiểu nhầm là nội dung chính của cột.

f. **Bỏ hẳn dòng phụ (nhãn loại nghiệp vụ)** — người dùng hỏi ý nghĩa dòng chữ nhỏ dưới mã ("Tiêu
   hao đoạn sắt", "Mua hàng"...), sau khi tôi giải thích đây là `REF_TYPE_LABEL` do tôi tự đặt ra
   lúc viết component (không phải yêu cầu cụ thể nào từ người dùng/Sếp), người dùng trả lời thẳng
   *"vậy xóa cho tôi, tôi thấy không cần thiết"*. Xóa hẳn constant `REF_TYPE_LABEL` (không còn nơi
   nào dùng) và dòng `<div>` phụ trong ô "Lệnh sản xuất" - ô này giờ CHỈ còn đúng 1 dòng:
   `e.refCode ?? e.piCode ?? '—'`.

**Kiểm tra (lần 3, sau khi bỏ (f))**: FE `npx tsc --noEmit` sạch, `npx eslint` sạch. Live-test lại
(cùng màn ở trên): cột "Lệnh sản xuất" chỉ còn 1 dòng mã, không còn dòng chữ loại nghiệp vụ bên
dưới.

## 8. Ẩn kho ẢO khỏi "Tổng hợp kho" với Boss/QLSX/KHSX (cùng ngày)

Người dùng hỏi list các màn đã có "Lịch sử xuất nhập kho" kèm account để tự kiểm tra. Trả lời xong,
người dùng nhận ra ở "Tổng hợp kho" (`MfgWarehousesPage.tsx`, xem lại từ trước - KHÔNG phải phần vừa
sửa hôm nay) có hiện luôn 4 kho ẢO (Đối ứng tồn kho ban đầu/điều chỉnh, Phế liệu, Đang sản xuất, Nhà
cung cấp - không có tồn vật lý, chỉ là điểm đối ứng bút toán kỹ thuật) và yêu cầu: *"màn Boss, QLSX
và khsx tôi nghĩ nên ẩn kho ảo đi, chỉ để mỗi admin hiển thị thôi"*.

**Nguyên nhân hiện ra**: `MfgWarehousesPage` dùng CHUNG bởi nhiều module (`BossApp`, `MfgApp` role
QLSX, `ProductionPlanApp` role KHSX, `AdminApp`, và cả `InboundWarehouseApp` cho 3 thủ kho) qua cùng
1 danh sách `visibleWhs`. 3 module Boss/QLSX/KHSX gọi `<MfgWarehousesPage />` KHÔNG truyền `groupKey`
("Tất cả kho") nên thấy đủ cả 7 kho kể cả 4 kho ảo; Admin cũng gọi y hệt. Riêng 3 thủ kho
(`InboundWarehouseApp`) truyền `groupKey={scope}` (vd `'phoi-son-han'`) nên vốn ĐÃ không thấy kho ảo
từ trước (code kho ảo như `SUPPLIER`/`PRODUCTION` không khớp bất kỳ family nào) - không cần đổi gì
cho nhóm này.

**Đã làm**: `WhRow` (view-model cục bộ của trang) thêm field `isVirtual: boolean` (BE
`GET /warehouses` đã trả sẵn field này qua `warehouses-api.ts`, chỉ chưa khai báo ở đây). Thêm 1 bước
lọc vào `visibleWhs`: `.filter(w => isAdmin || !w.isVirtual)` - `isAdmin` đã có sẵn biến cục bộ
(`user?.role === 'ADMIN'`) dùng cho nút "Tạo kho mới"/xóa kho, tái dùng luôn thay vì thêm biến mới.

**Kiểm tra**: FE `npx tsc --noEmit` sạch, `npx eslint` sạch (0 lỗi, chỉ 1 warning React purity có sẵn
từ trước ở dòng khác, không liên quan). Live-test qua UI thật:
- `admin` (Super Admin): "Tổng hợp kho" vẫn hiện đủ 7 kho (4 ảo + 3 thật) - không đổi hành vi.
- `boss` (demo1234): "Tổng hợp kho" chỉ còn 3 kho thật (Kho Phôi Sơn Hàn / Kho Vật tư thành phẩm /
  Kho Bao bì/Thành phẩm), không còn 4 kho ảo.

Chưa live-test riêng `qlsx`/`khsx` (cùng code path `visibleWhs`/`isAdmin` với `boss`, không có logic
rẽ nhánh nào khác theo role ngoài `isAdmin` nên tin tưởng hành vi giống nhau), có thể test thêm nếu
cần.

## 9. Còn treo

- ~~Tab "Lịch sử" cũ trong màn Xuất kho vẫn là bản session-only~~ — **đã xoá hẳn ở mục 6a**.
- ~~Lịch sử nhập nội bộ tách riêng khỏi Lịch sử kho, không thấy phiếu bị từ chối~~ — đã gộp ở mục 6g,
  rồi **Sếp duyệt lại và chốt BỎ gộp** ở mục 7a (chỉ ghi lại xuất/nhập đã được chấp nhận, đúng nghĩa
  sổ cái). Phiếu bị từ chối xem lại ở "Nhập nội bộ" (hộp thư PENDING), không có màn lịch sử riêng.
- Chưa có **tồn lũy kế sau mỗi dòng** (running balance) và chưa **link `refId` ra chứng từ gốc** —
  2 thứ này có trong danh sách "chuẩn ERP" đã bàn nhưng xếp làm sau.
- Phiếu chuyển kho nội bộ đang `PENDING` (chưa ai xác nhận/từ chối) KHÔNG xuất hiện ở sổ - đúng ý
  Sếp (mục 7): sổ chỉ ghi việc đã CHẤP NHẬN. Xem "đang chờ" ở tab "Nhập nội bộ" (hộp thư PENDING).
- Xuất cho khách (`SalesOrder.shippedQty`) **không ghi `stock_ledger`** nên không xuất hiện ở sổ kho
  thành phẩm — cần quyết định có đưa vào sổ không (đây là thay đổi nghiệp vụ, không chỉ hiển thị).
- **Dữ liệu test còn sót trên DB dev**: phiếu `CK-2026-001` (Kho Phôi Sơn Hàn → Kho Vật tư thành
  phẩm, vật tư "Sắt hộp 25x50", đã REJECTED) là tôi tự tạo qua API để test tính năng gộp phiếu bị từ
  chối - **không phải nghiệp vụ thật** (sắt cây nguyên không đi chuyển kho theo chuỗi này, chỉ mảnh/
  vật tư thành phẩm mới đi - người dùng đã chỉ ra). Từ mục 7a, phiếu này KHÔNG còn hiển thị ở Lịch
  sử kho nữa (hết ảnh hưởng hiển thị) nhưng vẫn còn tồn tại trên DB - thử xóa (`DELETE` 3 bảng liên
  quan FK: `warehouse_transfer_reservations` → `warehouse_transfer_items` → `warehouse_transfers`)
  nhưng bị Claude Code auto-mode chặn (thao tác xóa nhiều bảng). Cần người dùng tự xóa hoặc cho phép
  lại nếu muốn dọn sạch DB dev.
