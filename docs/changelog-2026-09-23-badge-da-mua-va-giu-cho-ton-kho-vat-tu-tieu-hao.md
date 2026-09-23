# 2026-09-23 — Badge "Đã mua" sai nghĩa + giữ chỗ tồn kho cho vật tư tiêu hao/"vật tư thành phẩm"

## Lý do

User báo: trang "Lệnh mua vật tư" hiện badge **"Đã mua"** cho vài vật tư (Sơn bột, Bì zipper, Tán
rút, HDLR J55 ghế...) dù PI còn "Chờ Sếp duyệt" và chưa hề có giao dịch mua/nhận hàng nào.

Điều tra ra root cause: `PurchaseProposalItem.status=PURCHASED` được BE dùng chung cho 2 nghĩa khác
hẳn nhau:
1. Đã thực sự mua + Kho đã nhận hàng (`receiveItem()`).
2. `buyQty` tính ra = 0 lúc tạo đề xuất (tồn kho đã đủ, không cần mua) — 3 service tạo đề xuất
   (`CuttingProposalsService.approve()`, `ConsumableMaterialPurchaseService`,
   `PieceMaterialYieldPurchaseService`) đều đặt thẳng `PURCHASED` ngay lúc tạo cho case này, để
   dòng buyQty=0 không kẹt vĩnh viễn ở NEW chờ báo giá vô ích (D.p7-zero-buyqty-stuck).

Đào sâu thêm 2 câu hỏi tiếp theo (user hỏi): "khi nào trừ tồn thật" và "sao biết đúng dòng này" —
phát hiện `ConsumableMaterialPurchaseService`/`PieceMaterialYieldPurchaseService` đọc thẳng tồn vật
lý thô (`stock_quant`) để quyết định buyQty=0, **không** qua cơ chế giữ chỗ (`StockReservation`)
như nhánh sắt đã có từ B4 Đợt 2 (2026-08-15) — 2 PI khác nhau cùng cần 1 vật tư, tính đề xuất gần
nhau, có thể cùng đọc thấy "tồn đủ" dù tồn thật chỉ đủ cho 1 PI (race condition thật, không phải
hiếm — mọi PI dùng chung 1 loại Sơn/phụ kiện/Dây-Đinh đều có thể dính).

## Thay đổi

**FE** (chỉ đổi cách HIỂN THỊ, không đổi BE lúc này):
- `InspectionContext.tsx`: thêm `wasActuallyPurchased(item)` (status=purchased VÀ buyQty>0) và
  `itemStatusLabel(item)` — item buyQty=0 hiện badge riêng **"Đủ tồn kho (X đơn vị)"** (xám, khác
  hẳn "Đã mua" xanh lá), kèm số lượng thực tế đã dùng từ tồn kho (`actualStock`).
- `LenhMuaNCCPage.tsx`: 2 chỗ hiện badge item (pill "N vật tư khác" + danh sách "Đã duyệt mua") dùng
  `itemStatusLabel()` thay vì tra thẳng `PROPOSAL_STATUS_LABELS[status]`.
- `LichSuMuaHangPage.tsx` ("Lịch sử đã mua"): lọc theo `wasActuallyPurchased()` thay vì
  `status==='purchased'` — không còn liệt kê các dòng buyQty=0 (chưa từng mua thật) vào lịch sử mua.

**BE** — đóng race condition ở tầng tính đề xuất mua (mirror thiết kế B4 Đợt 2 của nhánh sắt):
- `prisma/schema.prisma`: thêm 2 giá trị enum `StockReservationRefType`:
  `CONSUMABLE_MATERIAL_PURCHASE`, `PIECE_MATERIAL_YIELD_PURCHASE`. Migration
  `20260923064322_add_consumable_piece_yield_reservation_reftypes` (additive-only, đã áp dụng DB dev).
- `StockReservationsService`: thêm 3 hàm mới —
  - `reserveOrAdjust()`: tạo MỚI hoặc cập nhật quantity của 1 dòng giữ chỗ ỔN ĐỊNH (refId không đổi
    qua nhiều lần gọi lại — khác `reserve()` idempotent-nhưng-không-cập-nhật của nhánh sắt, vì nhánh
    sắt mỗi lần "Tính lại" sinh `cuttingProposalId` MỚI còn 2 nguồn này tính lại trên CÙNG 1 refId).
    Không bao giờ đặt quantity thấp hơn `consumedQty` đã tiêu thật.
  - `shrinkToFloor()`: co giữ chỗ của CHÍNH lượt tính TRƯỚC ĐÓ về đúng phần đã tiêu, chạy TRƯỚC khi
    tính available của lượt hiện tại — nếu không, phần chưa tiêu của chính nó bị `getAvailableQty()`
    trừ NHẦM vào chính nó (tự xung đột qua các lần tính lại, refId ổn định không tự release như
    CuttingProposal).
  - `drainPoolBestEffort()`: bản KHÔNG throw của `drainPool()` — dùng ở bước xuất vật tư thật (xem
    dưới), không chặn cứng vì nguồn tạo giữ chỗ (2 service dưới) chạy best-effort (bọc try/catch,
    chỉ log lỗi ở `ProductionInvoicesService.triggerPostApprovalProposals()`), PI hoàn toàn có thể
    chưa từng có gì để rút.
- `ConsumableMaterialPurchaseService`, `PieceMaterialYieldPurchaseService`
  (`computeAndUpsertProposals()`): buyQty/consumeQty giờ tính theo tồn KHẢ DỤNG
  (`getAvailableQty()` — trừ giữ chỗ của PI/luồng khác), không đọc thẳng tồn vật lý thô. Phần tồn
  dùng để che phủ demand (`consumeQty`) được giữ chỗ thật qua `reserveOrAdjust()`. `actualStock` giữ
  nguyên ý nghĩa "tồn vật lý thật" để hiển thị/audit, không đổi.
- `MaterialIssuesService`, `MaterialYieldIssuesService` (`create()`): sau khi ghi `StockLedger`
  thật, gọi `drainPoolBestEffort()` để "trả nợ" giữ chỗ tương ứng — nếu không, phần giữ chỗ chưa
  tiêu sẽ bị coi là "đang giữ" mãi mãi dù vật lý đã rời kho, khoá ảo tồn kho cho các lần tính đề
  xuất sau.
- `production-invoices.module.ts`: import `StockModule` (cung cấp `StockReservationsService`).

### Đính chính SAU live-test (cùng ngày) — bug thật, không phải giả thuyết

Phần 2 live-test (xem "Xác minh") phát hiện: `MaterialIssuesService`/`MaterialYieldIssuesService.
create()` VẪN gọi `getAvailableQty()` như cũ để tránh giành tồn với `WarehouseTransferReservation`
(chuyển kho nội bộ) — nhưng hàm đó trừ TẤT CẢ `StockReservation` ACTIVE của vật tư, KHÔNG phân biệt
nguồn. Từ khi `ConsumableMaterialPurchaseService`/`PieceMaterialYieldPurchaseService` bắt đầu ghi
`StockReservation` cho ĐÚNG những vật tư 2 service issue này xử lý, giữ chỗ CỦA CHÍNH PI đang xuất
cũng bị trừ vào `available` — tái hiện thật: 2 PI cùng giữ chỗ cộng đúng bằng tồn vật lý (PI1=50 +
PI2=50 = onHand=100) → `available=0` → xuất bị chặn 409 dù tồn vật lý còn nguyên 100. Trước
2026-09-23 việc này chưa từng xảy ra vì `StockReservation` duy nhất tồn tại (`CUTTING_PROPOSAL`)
chỉ áp dụng cho vật tư sắt, không đụng tới vật tư 2 service này xử lý.

Sửa: `StockReservationsService.getAvailableQty()` thêm tham số `excludeRefTypes?` (6 tham số, sau
`stockLengthMm`) — lọc `refType: { notIn: excludeRefTypes }` khi tính `reservedFromStock`.
`MaterialIssuesService`/`MaterialYieldIssuesService.create()` truyền
`[CONSUMABLE_MATERIAL_PURCHASE, PIECE_MATERIAL_YIELD_PURCHASE]` — 2 refType này chỉ nên chặn tính
đề xuất mua của PI KHÁC (đúng mục đích ban đầu), không được chặn ngược chính việc xuất vật lý của
vật tư nó đang giữ chỗ. Các caller khác (`CuttingProposalsService.approve()`) KHÔNG đổi, vẫn không
truyền `excludeRefTypes` (giữ nguyên hành vi trừ mọi refType như trước).

### Đính chính LẦN 2 (cùng ngày, user hỏi "còn rủi ro/lỗ hổng nào không") — 2 chỗ NỮA dính đúng bug

Rà lại TOÀN BỘ caller của `getAvailableQty()` trong repo (không chỉ 2 chỗ vừa live-test) - phát
hiện thêm đúng bug y hệt ở 2 nơi CHƯA VÁ:
- `PackagingIssuesService.create()` (xuất Bao bì/Phụ kiện đóng gói) - đúng nhóm vật tư
  `ConsumableMaterialPurchaseService` giữ chỗ qua nhánh `BomAccessoryItem`.
- `WeavingIssuesService.issueMaterialsForWeaving()` (xuất Dây/Đinh/Nút nhựa kèm mảnh lúc đan) - đúng
  nhóm vật tư giữ chỗ qua nhánh `PieceMaterialItem`.

Vá y hệt pattern đã dùng cho `MaterialIssuesService`/`MaterialYieldIssuesService` (truyền
`excludeRefTypes` như nhau).

### Đính chính LẦN 3 (cùng ngày, user bảo "làm cái 2 đi" - live-test 2 chỗ vừa vá LẦN 2) — thiếu sót thứ 3

Lúc chuẩn bị fixture live-test, phát hiện tiếp: `PackagingIssuesService.create()` và
`WeavingIssuesService.issueMaterialsForWeaving()` chỉ được vá phần GATE (`excludeRefTypes`) ở đính
chính LẦN 2, **quên gọi `drainPoolBestEffort()`** để "trả nợ" giữ chỗ sau khi ghi ledger - đúng lỗ
hổng "khoá ảo vĩnh viễn" mà `drainPoolBestEffort()` sinh ra để giải quyết cho
`MaterialIssuesService`/`MaterialYieldIssuesService`, nhưng bị bỏ sót khi áp dụng sang 2 service
này. Đã bổ sung: `PackagingIssuesService.create()` gọi `drainPoolBestEffort()` ngay sau
`postLedgerEntry()`; `WeavingIssuesService.issueMaterialsForWeaving()` nhận thêm tham số
`productionInvoiceId` (truyền từ `create()`, tra qua `productionInvoiceItem.findUniqueOrThrow()`
cùng idiom `assertItemPiHasActiveFloor`) và gọi `drainPoolBestEffort()` cho từng dòng vật tư mang
kèm.

**Live-test đầy đủ cho cả 2 service (xem "Xác minh") - 10/10 PASS**, dựng fixture đủ cả 2 gate phụ
(Chuyền kiểm cho Đóng gói qua `TransferCheckResult`; "đã nhận thật từ Phân phối nội bộ" cho Đan qua
`WarehouseTransferPieceItem` CONFIRMED) - xác nhận cả race condition (buyQty đúng) LẪN trả nợ giữ
chỗ (`consumedQty` tăng đúng, `stock_quant` giảm đúng) hoạt động thật trên DB dev.

### Đính chính LẦN 4 (cùng ngày, user hỏi "đã ổn hết chưa") — lỗ hổng thứ 5, hướng NHẬN hàng thay vì XUẤT

Rà lần cuối phát hiện: `PurchaseProposalsService.receiveItem()` (Kho xác nhận nhận hàng mua) chỉ
cộng hàng vừa về vào giữ chỗ (`creditPool()`) khi **đúng vật tư SẮT** (kiểm bằng
`CuttingProposalLine.findFirst`) - comment cũ giải thích "nhánh khác (VTTP/tiêu hao) không có pool
nào để cộng vào", đúng ở thời điểm viết (trước hôm nay) nhưng SAI từ khi
`ConsumableMaterialPurchaseService`/`PieceMaterialYieldPurchaseService` đã có pool thật.

Hậu quả: PI2 mua thêm 10kg Sơn, Kho xác nhận nhận hàng → tồn vật lý +10kg (đúng) nhưng giữ chỗ của
PI2 KHÔNG tăng theo → PI3 tính đề xuất ngay sau đó thấy "tồn dư" đúng 10kg đó (thực ra đã thuộc về
PI2) → đọc trùng, tái hiện lại race condition gốc nhưng qua đường NHẬN hàng thay vì đường TÍNH đề
xuất.

Sửa: bỏ điều kiện `isSteelLineOfThisPI` (và xoá luôn query `cuttingProposalLine.findFirst` không
còn cần) - gọi `creditPool()` VÔ ĐIỀU KIỆN cho mọi `targetProductionInvoiceId != null`. An toàn vì
MỌI `PurchaseProposalItem` đều do 1 trong 3 service tự động tạo (không có đường tạo tay - xem
`project_purchase_proposal_sources` trong memory), nên luôn có pool hợp lệ để cộng vào hoặc
`creditPool()` tự tạo dòng `PRODUCTION_INVOICE` mới đúng nghĩa (ca buyQty=100% nhu cầu, chưa từng
giữ chỗ gì - cùng idiom nhánh sắt).

**Live-test riêng cho fix này** (kịch bản 3 PI): PI1 vét sạch 50kg tồn (buyQty=0, giữ 50kg). PI2
cần 60kg, tồn đã hết → buyQty=60 (mua toàn bộ), CHƯA có giữ chỗ nào (consumeQty=0 lúc tính). Kho
xác nhận nhận đủ 60kg cho PI2 → tồn vật lý 50→110kg, VÀ giữ chỗ PI2 được tạo mới đúng 60kg
(refType `PRODUCTION_INVOICE`, trước khi sửa dòng này sẽ KHÔNG tồn tại). PI3 cần 40kg tính NGAY SAU
→ `buyQty=40` (available=110−50(PI1)−60(PI2)=0) - **PI3 KHÔNG "ăn ké" được phần PI2 vừa mua về**
dù tồn vật lý nhìn có vẻ dư dả 110kg. **6/6 kiểm tra PASS**, dọn sạch sau test.

**CỐ Ý KHÔNG sửa** `WarehouseTransfersService` (chuyển kho nội bộ) dù nó cũng gọi
`getAvailableQty()` cho vật tư có thể trùng - bản chất nghiệp vụ khác hẳn: 3 service xuất ở trên
"xuất = hoàn thành đúng lời hứa" (loại trừ giữ chỗ là đúng), còn chuyển kho là RÚT vật tư ra khỏi
nơi đang hứa cho 1 PI để dùng việc khác.

**Quyết định nghiệp vụ (user xác nhận 2026-09-23, sau khi xem kịch bản cụ thể "PI1 giữ 50kg/100kg
tồn, Tổng kho muốn chuyển 80kg sang kho khác")**: GIỮ NGUYÊN hành vi hiện tại - chuyển kho VẪN bị
giới hạn bởi giữ chỗ (chỉ chuyển được phần chưa hứa cho PI nào, ở ví dụ trên là tối đa 50kg, không
phải 80kg) - ưu tiên an toàn sản xuất (tránh chuyển mất vật tư xưởng đang trông chờ) hơn tiện lợi
vận hành kho. KHÔNG thêm `excludeRefTypes` ở đây - việc này là CHỦ ĐÍCH, không phải bỏ sót.

**Rủi ro nhỏ còn lại, chưa sửa (không phải bug chặn cứng)**: màn "Tồn kho"
(`StockQuantResponseDto.toResponseDto()`, hiển thị cột "khả dụng") cũng gọi `getAvailableQty()`
không loại trừ gì - sẽ hiện số thấp hơn tồn thực tế cho vật tư có giữ chỗ, có thể gây thắc mắc cho
thủ kho ("kệ còn 100 sao hệ thống ghi khả dụng 50") dù về logic là đúng (số đó phản ánh đúng phần đã
cam kết cho sản xuất). Thuần hiển thị, không chặn thao tác nào.

## Xác minh

- BE: `npx tsc --noEmit` sạch, `npx eslint` sạch (0 lỗi/warning ở mọi file đổi), `npx jest` — **50
  test suite / 1147 test xanh** (thêm ~23 test mới: race condition, `reserveOrAdjust`/
  `shrinkToFloor`/`drainPoolBestEffort`, "trả nợ" giữ chỗ ở 4 service xuất vật tư,
  `excludeRefTypes` của `getAvailableQty()`).
- FE: `npx tsc --noEmit` sạch, `npx vitest run` — 38/38 test xanh.
- **Live-test trên DB dev thật, 3 đợt (2026-09-23, sau khi user hỏi "có rủi ro gì không" rồi "còn
  rủi ro/lỗ hổng nào không")** — script
  Node độc lập chạy thẳng từ `dist/` đã build (không chạm cây `src/`/`prisma/` đang bị `nest --watch`
  theo dõi, tránh trigger restart giữa chừng), fixture cô lập tag `TEST-*`, dọn sạch 100% sau mỗi đợt
  (xác nhận lại bằng query riêng: 0 record/0 reservation còn sót):

  **Đợt 1 — `ConsumableMaterialPurchaseService` race condition:** gọi
  `computeAndUpsertProposals()` 2 lần cho 2 PI khác nhau, cùng cần 1 vật tư, tồn vật lý 100kg (nhập
  thật qua `StockLedgerService.postEntry()` từ kho ảo SUPPLIER). PI1 (required=50kg): `buyQty=0`
  (đúng). PI2 tính NGAY SAU ĐÓ (required=60kg), **tồn vật lý vẫn nguyên 100kg**: `buyQty=10` (ĐÚNG -
  trước bản vá sẽ ra `buyQty=0` SAI). Đúng 2 dòng `StockReservation`, PI1 giữ 50kg + PI2 giữ 50kg =
  khớp chính xác 100kg tồn thật.

  **Đợt 2 — `PieceMaterialYieldPurchaseService` (song sinh) + "trả nợ" giữ chỗ ở 2 service xuất vật
  tư thật:** lặp lại đúng kịch bản race condition cho `PieceMaterialYieldPurchaseService` (kết quả
  giống hệt đợt 1: PI2 `buyQty=10` đúng, không phải 0 sai) — VÀ gọi thật
  `MaterialIssuesService.create()`/`MaterialYieldIssuesService.create()` để xuất vật tư cho PI1.
  **Lần chạy đầu tiên của đợt 2 FAIL** - lộ ra bug thật (xem "Đính chính SAU live-test" ở trên):
  `MaterialIssuesService.create()` bị chính giữ chỗ của PI2 (materialId trùng) chặn ngược, trả 409
  dù tồn vật lý còn nguyên. Sửa xong (`excludeRefTypes`), chạy lại: **10/10 kiểm tra PASS** - xuất
  20kg/15 cây thành công, `stock_quant` giảm đúng (100→80, 100→85), giữ chỗ PI1 "trả nợ" đúng
  (`consumedQty` 0→20/0→15, `quantity` giữ nguyên 50 - không đổi ý nghĩa "đã hứa bao nhiêu").

  **Đợt 3 — `PackagingIssuesService`/`WeavingIssuesService` (2 chỗ vá ở "Đính chính LẦN 2/3"):**
  dựng fixture đủ 2 gate phụ đặc thù mỗi service - Chuyền kiểm (`TransferCheckResult`, đủ cho cả
  `order.quantity` sản phẩm) cho Đóng gói; "đã nhận thật từ Phân phối nội bộ"
  (`WarehouseTransferPieceItem` status CONFIRMED) cho Đan. Lặp lại đúng kịch bản race condition (2
  PI cùng vật tư) RỒI gọi thật `PackagingIssuesService.create()`/
  `WeavingIssuesService.create()` để xuất. **10/10 kiểm tra PASS** ngay từ lần chạy đầu (sau khi đã
  vá cả gate LẪN drain trước khi test, không phải test-rồi-mới-lộ-bug như đợt 2) - `stock_quant`
  giảm đúng (100→80 cả 2 ca), giữ chỗ "trả nợ" đúng (`consumedQty` 0→20, `quantity` giữ nguyên 50).
- Chưa test qua UI/browser thật (thay đổi BE thuần, không có UI mới ngoài phần badge đã live-test ở
  mã nguồn) — theo dõi log lỗi vài ngày đầu vì đây là logic tồn kho nhạy cảm.

## Việc cần biết

- Giữ chỗ (`StockReservation`) tạo ở bước tính đề xuất **không tự giải phóng** nếu SKU/PI bị huỷ
  giữa chừng trước khi xưởng thực xuất vật tư (khác nhánh sắt có `releaseByRef()` khi supersede/huỷ
  phương án cắt) — hệ thống hiện KHÔNG có cơ chế huỷ ProductionOrder sau khi đã duyệt (xem
  `project_no_cancel_mechanism_production_order` trong memory), nên tình huống này chưa có đường
  xảy ra thật. Nếu sau này có nút huỷ, cần bổ sung bước release tương ứng ở đây.
- 2 service tạo đề xuất chạy **best-effort** (lỗi chỉ log, không chặn duyệt SKU) — 1 PI có thể
  không có giữ chỗ nào nếu bước tính lỗi/mất mạng đúng lúc đó; `drainPoolBestEffort()` cố ý không
  throw để không khoá xưởng vĩnh viễn cho ca hiếm này (đánh đổi: giữ chỗ có thể không khớp tuyệt đối
  100% mọi lúc, nhưng KHÔNG BAO GIỜ chặn nhầm việc xuất vật tư thật).

## Mức độ tin cậy thật (user hỏi "chắc chắn hết lỗ hổng chưa", 2026-09-23)

**KHÔNG dám khẳng định tuyệt đối hết lỗ hổng.** Trong đúng 1 buổi làm việc này, mỗi lần báo "xong"
lại lộ thêm 1 bug thật khi rà sâu hơn (tổng 5 lần: race condition gốc → tự chặn ngược lúc xuất
(Hàn/Sơn) → thiếu trả nợ giữ chỗ (Hàn/Sơn) → tự chặn ngược + thiếu trả nợ (Đóng gói/Đan) → thiếu
credit lúc nhận hàng mua về) - không có gì đảm bảo đây là lần cuối.

Đã làm để tối đa hoá độ tin cậy:
- Rà **toàn bộ** caller của `getAvailableQty()`/`creditPool()`/`drainPool` trong repo (grep toàn bộ,
  không dừng ở chỗ đã nghi ngờ/đã test).
- Live-test qua DB thật (không chỉ unit test mock) cho mọi luồng: tính đề xuất, xuất cả 4 loại vật
  tư (Hàn/Sơn, Chân nhôm/Pat, Đóng gói, Đan), nhận hàng mua về, race giữa nhiều PI - tổng 4 đợt live
  qua DB dev.

Giới hạn thật của mức độ verify này:
- Test **tuần tự** (PI1 rồi PI2 nối tiếp), KHÔNG test 2 request chạm cùng vật tư **đồng thời thật**
  - tin vào cơ chế khoá `FOR UPDATE` trên `stock_quant` (đã chứng minh đúng cho nhánh sắt từ trước,
    dùng lại y hệt pattern cho các service mới) chứ chưa tự tay tái hiện race timing thật.
  - Hệ thống mới tinh chỉnh trong 1 buổi, chưa "sống" qua dữ liệu/tải thật của người dùng thật.
  - Không loại trừ được kiểu lỗi "chưa nghĩ tới" (unknown-unknown) - độ phức tạp tương tác giữa các
    module đủ lớn (ít nhất 9 nơi đọc `getAvailableQty`, nhiều nơi ghi/rút `StockReservation`) để việc
    rà bằng mắt + suy luận không thể loại trừ tuyệt đối 1 góc khuất nào đó.

**Khuyến nghị**: coi đã sẵn sàng để lên, nhưng theo dõi log lỗi chủ động vài ngày đầu (đặc biệt
`ConflictException`/`BadRequestException` ở 4 service xuất vật tư và `receiveItem()`) thay vì tin là
tuyệt đối không còn gì - đó là cách trung thực nhất để đóng khoảng cách giữa "đã kiểm tra hết mức
hợp lý" và "chắc chắn".
