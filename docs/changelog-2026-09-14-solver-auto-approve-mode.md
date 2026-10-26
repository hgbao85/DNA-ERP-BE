# Changelog 2026-09-14 — Chọn mức tự duyệt cắt sắt

> **CẬP NHẬT cuối ngày 2026-09-14:** thiết kế `SolverAutoApproveMode` (enum 3 mức) mô tả ở mục 1-6
> **ĐÃ BỊ THAY THẾ** trong cùng ngày — xem **mục 7** ở cuối file. Enum không diễn đạt nổi ca nghiệp
> vụ thật ("mua cây chuẩn 6m NHƯNG chấp nhận vượt ngưỡng vì khách gấp"), nay thay bằng 2 thông số
> độc lập KHSX đề nghị / Sếp duyệt. Đọc mục 1-6 như lịch sử quyết định, không phải trạng thái hiện
> tại của code.

## 1. Bối cảnh

Trong lúc dò bug (`changelog-2026-09-14-e2e-test-bug-hunt.md`), người dùng hỏi hệ thống đang có mấy
trường hợp khi tính phương án cắt sắt (đạt ngay chiều dài chuẩn / phải mở rộng chiều dài / cắt
được nhưng vượt ngưỡng...). Sau khi liệt kê, người dùng yêu cầu: *"làm một nút setting để chọn cắt
theo kiểu nào được không (Đạt ngay ở chiều dài chuẩn, Phải mở rộng chiều dài mới đạt, Cắt được
nhưng vẫn vượt ngưỡng)"*.

Trước đây 3 hành vi này bị **cố định cứng trong code**: solver luôn được phép dò mở rộng
(`auto_scan=true`), và phương án vượt ngưỡng hao hụt luôn bị chặn không cho tự duyệt — không ai
chỉnh được mà không sửa code.

## 2. Chốt vị trí đặt setting (2 vòng thảo luận)

- **Vòng 1**: đặt ở Admin > "Cấu hình hệ thống" (cùng chỗ 8 tham số solver khác đã có sẵn -
  `solverStockLengths`, `solverMaxWastePercentage`...). Người dùng hỏi lại *"sao không làm ở chỗ
  tối ưu cắt sắt"*.
- Giải thích: setting này không điều khiển màn "Tối ưu cắt sắt" (màn đó chỉ xem trước/gộp SKU,
  không gọi solver thật) - nó điều khiển đúng lúc **Sếp bấm "Duyệt"** trên Lệnh sản xuất (khi đó
  `runSolverAndSave()` mới thật sự chạy). Người dùng chốt lại: *"để tối ưu cắt sắt lựa chọn để
  tiến hành gộp hay không và chọn hướng solve như nào luôn chứ vì đây là bên kế hoạch mà"* — tức
  bên **Kế hoạch sản xuất (KHSX)** phải là người quyết định, **theo TỪNG đợt** lúc gộp/cắt riêng,
  không phải 1 mức chung cố định do Admin đặt.

**Quyết định cuối**: giữ CẢ 2 tầng, đúng idiom `Material.maxCuttingWastePercentage` đã ghi đè
`SystemConfig.solverMaxWastePercentage` có sẵn trong hệ thống:
- `SystemConfig.solverAutoApproveMode` — mức **mặc định chung của công ty**, Admin chỉnh ở "Cấu
  hình hệ thống". Mặc định `ALLOW_EXPAND` (đúng hành vi hệ thống đã chạy từ trước, đổi default sẽ
  âm thầm đổi hành vi mọi lệnh sản xuất hiện có).
- `ProductionInvoice.solverAutoApproveMode` (nullable) — KHSX **tự chọn riêng cho ĐÚNG đợt đó**
  lúc "Xác nhận gộp"/"Tạo lệnh sản xuất riêng" ở "Tối ưu cắt sắt". `null` = không chọn gì → rơi về
  mặc định `SystemConfig`.

## 3. 3 mức (tăng dần độ dễ dãi, mỗi mức là tập cha của mức trước)

| Mức | `auto_scan` gửi solver | Vượt ngưỡng hao hụt có tự duyệt không |
|---|---|---|
| `FIXED_ONLY` | `false` — chỉ thử đúng các chiều dài chuẩn | Không (mặc nhiên, vì `auto_scan=false` nên không cắt được ở chiều dài chuẩn thì dừng) |
| `ALLOW_EXPAND` (mặc định) | `true` — dò mở rộng khi chiều dài chuẩn không đạt | **Không** — vẫn chặn, gợi ý gộp SKU khác |
| `ALLOW_OVER_THRESHOLD` | `true` | **Có** — tự duyệt với phương án tốt nhất tìm được, % hao hụt chỉ còn là cảnh báo |

Vô nghiệm thật (`!feasible`) hoặc hết giờ tính (`timedOut`) **luôn luôn chặn** ở cả 3 mức - không
mức nào cho tự duyệt 1 phương án chưa có kết luận hoặc thật sự không cắt được.

## 4. Đã làm

### BE
- **Schema**: `enum SolverAutoApproveMode { FIXED_ONLY ALLOW_EXPAND ALLOW_OVER_THRESHOLD }`;
  `SystemConfig.solverAutoApproveMode` (default `ALLOW_EXPAND`);
  `ProductionInvoice.solverAutoApproveMode` (nullable). 2 migration thuần cộng thêm (ADD COLUMN
  có default / ADD COLUMN nullable), không phá gì.
- `system-config` module: DTO response/update thêm field, validate bằng `@IsEnum`.
- `production-invoices` module:
  - `MergeProductionInvoiceDto` thêm `solverAutoApproveMode?` (optional).
  - `ClaimSoloDto` (file mới) - trước đây endpoint claim-solo không nhận body nào cả.
  - `mergeItems()`/`claimSolo()` lưu lựa chọn KHSX vào `ProductionInvoice` vừa tạo.
  - `ProductionInvoiceResponseDto` expose lại field (round-trip cho FE).
- `cutting-proposals` module (`CuttingProposalsService`):
  - `SolverJob` thêm field `solverAutoApproveMode: SolverAutoApproveMode | null`.
  - `buildOrderJob()` (1 SKU cắt riêng) đọc qua
    `productionOrder.productionInvoiceItem.productionInvoice.solverAutoApproveMode`.
  - `buildInvoiceJob()` (PI gộp) đọc thẳng `pi.solverAutoApproveMode` (mọi SKU trong 1 PI gộp
    dùng chung đúng 1 PI nên không có ca lệch nguồn).
  - `runSolverAndSave()`: `const autoApproveMode = job.solverAutoApproveMode ?? config.
    solverAutoApproveMode` - ưu tiên lựa chọn KHSX, rơi về SystemConfig khi KHSX không chọn gì.
    Dùng `autoApproveMode` (không phải `config.solverAutoApproveMode` trực tiếp) để tính
    `auto_scan` VÀ để gọi `autoApproveBlockReason()`.
  - `autoApproveBlockReason()` nhận thêm tham số `autoApproveMode` - nhánh chặn vượt ngưỡng (c)
    bọc trong `if (autoApproveMode !== ALLOW_OVER_THRESHOLD)`. **Lưu ý khi viết**: lần đầu viết
    nhầm bằng `if (mode === ALLOW_OVER_THRESHOLD) return null` (return SỚM cho cả hàm) - bug thật,
    bỏ qua luôn mọi chặn khác phía dưới (case "đã có phương án duyệt trước", xung đột chiều dài
    giữa các SKU cùng PI...). Tự bắt được bằng cách tạm bợ tái tạo bug rồi chạy lại test hồi quy -
    xác nhận FAIL đúng - trước khi sửa thành bọc `if (!== ALLOW_OVER_THRESHOLD)` quanh ĐÚNG đoạn
    kiểm tra vượt ngưỡng, giữ nguyên các chặn còn lại chạy bình thường.
  - Sửa luôn 2 chỗ comment/thông báo lỗi lỗi thời phát hiện được khi đọc lại vùng code này: (a)
    comment ở `runSolverAndSave` nói "2026-08-18 không còn auto_scan" trong khi auto_scan đã mở
    lại từ 2026-08-26 - sửa lại đúng thực tế mới; (b) thông báo lỗi nhánh vô nghiệm hardcode
    "...với cây 6000mm" dù thực ra đã dò hết cả dải mở rộng - sửa thành "...dù đã thử mọi chiều
    dài cho phép".

### FE
- `types/admin.ts`: thêm `SolverAutoApproveMode`, thêm field vào `SystemConfig`.
- `services/system-config-api.ts`: `updateSystemConfig()` gửi kèm field (trước đây chỉ gửi 6
  field công ty, các field solver khác dù DTO/response BE đã hỗ trợ từ trước vẫn CHƯA có form nào
  nhập - out of scope, chỉ thêm field mới của đợt này).
- `SystemConfigPage.tsx` (Admin): thêm khối "Đề xuất cắt sắt — mức tự động duyệt", radio 3 mức
  kèm mô tả viết cho Sếp đọc (không phải thuật ngữ dev), tách card riêng khỏi khối "Thông tin công
  ty" (subtitle cũ "chưa có nghiệp vụ nào tự động đọc" không còn đúng cho field mới).
- `services/cutting-batch-api.ts`: `mergeCuttingBatch()`/`claimSoloCuttingBatch()` nhận thêm
  tham số `solverAutoApproveMode?`.
- `GomDotCatPage.tsx` ("Tối ưu cắt sắt"): thêm `<select>` "Mức tự duyệt cắt sắt cho đợt này" (4
  lựa chọn: Mặc định hệ thống + 3 mức), đặt ở footer CẢ 2 khối xác nhận (gộp ≥2 SKU / cắt riêng 1
  SKU) - dùng chung 1 state.

## 5. Kiểm tra

- BE: `npx tsc --noEmit` sạch, `npx eslint --fix` sạch (0 lỗi). `npx jest cutting-proposals
  production-invoices system-config` → **237/237 pass**, gồm các test mới:
  - `cutting-proposals.service.spec.ts`: mode `FIXED_ONLY` gửi `auto_scan=false`; mode
    `ALLOW_OVER_THRESHOLD` tự duyệt khi vượt ngưỡng là chặn DUY NHẤT; mode
    `ALLOW_OVER_THRESHOLD` **KHÔNG** bỏ qua chặn "đã có phương án duyệt trước" (test hồi quy cho
    đúng bug tự mắc phải khi viết, đã xác nhận FAIL trên bản có bug trước khi sửa); PI gộp mang
    đúng `solverAutoApproveMode` qua `buildInvoiceJob()`; `buildOrderJob()` ưu tiên lựa chọn PI
    hơn mặc định SystemConfig dù 2 giá trị khác nhau.
  - `production-invoices.service.spec.ts`: `mergeItems()`/`claimSolo()` lưu đúng lựa chọn KHSX
    truyền vào, và lưu `null` khi không truyền gì.
  - `system-config.service.spec.ts`: field đi qua `findOne()`/`update()` nguyên vẹn.
- FE: `npx tsc --noEmit` sạch, `npx eslint` sạch (2 warning có sẵn từ trước, không liên quan).
- Live-test qua UI thật:
  - `admin`: "Cấu hình hệ thống" hiện đúng 3 lựa chọn kèm mô tả, chọn "Chỉ chiều dài chuẩn" → lưu
    → tải lại trang → vẫn đúng lựa chọn đã chọn (round-trip qua BE thật, không phải cache FE).
    Đổi lại về "Cho phép dò chiều dài khác" (mặc định) sau khi test xong.
  - `sales` tạo đơn mới `PO-E2E-SETTING-01`, xác nhận cọc.
  - `khsx` vào "Tối ưu cắt sắt", tick SKU, chọn "Chỉ chiều dài chuẩn" ở selector mới, bấm "Tạo
    lệnh sản xuất riêng cho SKU này" → tạo `PI-2026-003`.
  - Query thẳng DB xác nhận `ProductionInvoice` (code `PI-2026-003`) có đúng
    `solverAutoApproveMode: 'FIXED_ONLY'` - khớp lựa chọn đã chọn trên UI, không lẫn với mặc định
    `ALLOW_EXPAND` của SystemConfig.

## 6. Còn treo

- Chưa live-test đường "Xác nhận gộp" (≥2 SKU, `mergeItems()`) qua UI thật - mới test đường "Tạo
  lệnh sản xuất riêng" (`claimSolo()`, 1 SKU). Cả 2 dùng chung 1 code path lưu field
  (`solverAutoApproveMode ?? null`) và đã có test tự động riêng cho `mergeItems()`, rủi ro thấp
  nhưng chưa xác nhận bằng mắt qua UI thật.
- Chưa live-test toàn trình: tạo PI với mode khác mặc định → gửi QLSX → Sếp duyệt → xem solver
  thật có tôn trọng đúng mode đã chọn không (`runSolverAndSave()` chạy async, cần sản phẩm có
  BOM cắt sắt thật, xem `changelog-2026-09-14-e2e-test-bug-hunt.md` mục 4 - PI-2026-002 tạo lúc
  test bug hunt bị vướng lỗi dữ liệu BOM, không dùng lại được cho ca này).
- FE `updateSystemConfig()` giờ gửi field mới nhưng 8 tham số solver khác (`solverStockLengths`,
  `solverMaxWastePercentage`...) vẫn CHƯA có form nhập ở Admin dù BE đã hỗ trợ từ lâu - ngoài
  phạm vi yêu cầu lần này, không đụng tới.

---

## 7. THAY THẾ enum 3 mức bằng 2 thông số độc lập (cùng ngày 2026-09-14)

### 7.1 Vì sao bỏ thiết kế ở mục 1-6

Người dùng nêu một ca nghiệp vụ cụ thể: *"tối ưu cắt sắt thấy phần sắt đó hao hụt vượt quá 1% nhưng
tôi vẫn muốn solve để mua thanh sắt 6m dù vượt quá vì khách gấp"*.

Enum 3 mức **không diễn đạt được ca này**, vì nó là một thang leo tuyến tính trong khi thực tế có 2
trục độc lập — `auto_scan = mode !== FIXED_ONLY` khiến "chấp nhận vượt ngưỡng" luôn kéo theo "được
phép dò cây lạ":

| | Phải đạt ngưỡng | Chấp nhận vượt |
|---|---|---|
| **Chỉ cây chuẩn** | `FIXED_ONLY` | **(không có)** ← đúng ô cần dùng |
| **Cho đặt cây riêng** | `ALLOW_EXPAND` | `ALLOW_OVER_THRESHOLD` |

Cây đặt riêng phải chờ NCC cán, cây chuẩn mua được ngay — nên đơn gấp cần đúng tổ hợp còn thiếu.

### 7.2 Thiết kế mới

**Hai thông số độc lập trên `ProductionInvoice`**, KHSX đề nghị lúc gộp/cắt riêng ở "Tối ưu cắt
sắt", **Sếp chấp thuận bằng chính nút Duyệt lệnh sản xuất** (không thêm cổng duyệt mới — solver vốn
đã chỉ chạy sau khi Sếp duyệt):

- `solverMaxWastePctOverride` (Decimal?) — ngưỡng hao hụt đặc cách cho đợt này.
- `solverAllowCustomLength` (Boolean?) — có cho đặt cây ngoài chiều dài chuẩn không. null = theo
  mặc định công ty `SystemConfig.solverAllowCustomLength` (thay cho `SystemConfig.solverAutoApproveMode`).
- `solverOverrideReason` (String?) — lý do, **bắt buộc** khi có ngưỡng đặc cách.

**Dùng SỐ thay vì cờ bật/tắt** vì lúc Sếp duyệt mới chỉ có **cận dưới** của hao hụt (màn Tối ưu cắt
sắt luôn hiển thị kèm dấu ≥) — solver chạy xong có thể ra cao hơn. Cờ bật/tắt là ký séc khống; con số
là cái **trần**: vượt trần thì `autoApproveBlockReason()` vẫn chặn như thường.

Con số cũng tự giải quyết luôn trục chiều dài: ngưỡng 5% thì cây 6000mm ở 3.2% **đạt ngưỡng**, nên
theo đúng cơ chế sẵn có ("chiều dài chuẩn nào đạt là chốt luôn, chỉ khi không cây nào đạt mới vét
cạn") solver chốt cây chuẩn và không đi dò nữa.

**Ngưỡng đặc cách chỉ NÂNG, không hạ:** `max_waste_percentage = max(mặc định, đặc cách)` và
`max_waste_percentage_by_material[m] = max(ngưỡng riêng của m, đặc cách)`. Hạ được thì một đợt xin
5% sẽ vô tình siết loại sắt vốn đang được Sếp cho 8%.

**Cổng tự-duyệt đơn giản đi:** `autoApproveBlockReason()` bỏ hẳn tham số mode — vượt ngưỡng là
**luôn** chặn, vì ngưỡng đã bao gồm đặc cách từ trước khi giải.

**Sếp chỉ Duyệt hoặc Từ chối**, không sửa số ngay lúc duyệt (người dùng chốt) — nhờ vậy 2 endpoint
duyệt (`approve`, `approve-batch`, vốn không nhận body) không phải đụng tới.

### 7.3 Đã làm

**Schema** (`20260914043000_solver_waste_override_per_batch`): drop `enum SolverAutoApproveMode` +
2 cột thêm buổi sáng cùng ngày; thêm 3 cột trên `production_invoices` và
`system_config.solverAllowCustomLength BOOLEAN NOT NULL DEFAULT true` (default true = đúng hành vi
đã chạy từ 2026-08-26, không đổi ngầm hành vi đợt cắt hiện có). Đã đọc lại SQL sinh ra trước khi áp;
an toàn vì 2 cột bị drop mới tạo cùng ngày, chỉ có trên DB dev.

**BE** `cutting-proposals.service.ts`: `SolverJob` đổi sang `maxWastePctOverride` +
`allowCustomLength`; `buildOrderJob`/`buildInvoiceJob` đọc 3 cột mới (`.toNumber()` cho Decimal);
`runSolverAndSave` áp `Math.max()` cho cả scalar lẫn dict theo vật tư, `auto_scan: allowCustomLength`;
`autoApproveBlockReason()` bỏ tham số thứ 3.

**BE** `production-invoices`: `SolverOverrideDto` mới dùng chung cho cả `MergeProductionInvoiceDto`
và `ClaimSoloDto` (luật kiểm phải giống hệt nhau ở 2 đường, lệch là cùng một đề nghị lọt chỗ này
chặn chỗ kia); `@ValidateIf` bắt buộc lý do khi có ngưỡng; service lưu + `toResponseDto()` trả ra.

**FE**: `GomDotCatPage` thay `<select>` 3 mức bằng khối "đề nghị cắt đặc cách" (ô %, ô lý do, ô tick
"chỉ mua cây chuẩn") — **chỉ tự bung khi thật sự vướng** (đã gộp thì theo `preview.meetsThreshold`,
chưa gộp thì theo `overThreshold` của SKU), còn lại thu về một link nhỏ; nút bị khoá khi nhập thiếu
lý do hoặc % ngoài 0-100. `LenhSXPage` thêm callout "Kế hoạch SX xin cắt đặc cách" ở **cả** header
chi tiết PI **lẫn** modal xác nhận duyệt, chỉ hiện khi có đề nghị. `SystemConfigPage` (Admin) không
còn khối chọn mức (đã gỡ trước đó theo yêu cầu người dùng).

### 7.4 Kiểm tra

- BE: `npx tsc --noEmit` sạch, `npx eslint --fix` 0 lỗi, `npx jest` **238/238 pass**. Test mới:
  ngưỡng đặc cách nâng cả scalar lẫn dict và **không hạ** loại sắt đang có ngưỡng rộng hơn (0.3→5
  nhưng 8 giữ nguyên 8); `auto_scan` bám `allowCustomLength` **độc lập** với ngưỡng; vượt ngưỡng
  **vẫn** chặn tự duyệt dù đã có đặc cách; PI đè được mặc định SystemConfig; `buildInvoiceJob` quy
  Decimal về number (truyền thẳng Decimal vào `Math.max()` sẽ ra `NaN` mà không ai báo lỗi).
- FE: `npx tsc --noEmit` sạch, `npx eslint` 0 lỗi.
- Live-test qua UI thật (`sales` → `khsx` → `qlsx` → `boss`, tạo `PO-E2E-DACCACH-01`/`PI-2026-004`):
  khối đặc cách tự thu gọn khi SKU không vượt ngưỡng; mở ra nhập 5% → ô lý do tự hiện, nút tạo bị
  khoá cho tới khi điền lý do; tạo xong query DB thấy đúng `5.00 / false / "…giao gap…"`; Sếp mở
  lệnh sản xuất thấy callout ở cả header lẫn modal xác nhận; bấm Duyệt → solver được kích hoạt.

### 7.5 Còn treo

- **Chưa xác nhận được bằng mắt** rằng request gửi solver mang đúng `max_waste_percentage: 5` và
  `auto_scan: false`: lần chạy thật dừng sớm ở `buildBomRows` với lỗi *"BomRevision 2 không có dòng
  định mức mảnh nào"*. Đây là **dữ liệu định mức hỏng sẵn từ trước** (revision 2 đang ACTIVE có 3
  dòng `bom_piece` nhưng **0** dòng `piece_bom`, tức chưa mảnh nào được gán cỡ đoạn sắt) — đúng lỗi
  đã làm `PI-2026-002` fail ở đợt dò bug trước, không liên quan thay đổi này. Phần payload hiện
  đang được bảo vệ bằng 3 test tự động với assertion chính xác lên `max_waste_percentage`,
  `max_waste_percentage_by_material` và `auto_scan`.
- Chưa live-test đường "Xác nhận gộp" (≥2 SKU) với khối mới — mới test đường "cắt riêng 1 SKU". Hai
  đường dùng chung `SolverOverrideDto` và chung khối JSX, đã có test tự động cho `mergeItems()`.
- ~~Dữ liệu test để lại trên DB dev: `PO-E2E-DACCACH-01` / `PI-2026-004`~~ — **đã dọn 2026-09-16, xem mục 14**.

---

## 8. Dò bug bằng dữ liệu thật — định mức demo + 7 ca thử (2026-09-14, cuối ngày)

### 8.1 Vì sao phải dựng định mức trước

Không ca nào thử được: DB demo chỉ có `E2E-BAN-01`, revision ACTIVE khai 3 mảnh nhưng **0 dòng
`PieceBom`** (chưa mảnh nào gắn cỡ đoạn) → solver luôn chết ở `buildBomRows`. Toàn bộ luồng
cắt/gộp/ngưỡng chưa từng chạy được bằng dữ liệu thật.

`prisma/seed-cutting-fixture.ts` (mới) dựng bộ bàn ghế sắt ngoài trời dùng chung 3 loại sắt
(`SAT-VUONG-50X50`, `SAT-HOP-25X50`, `SAT-VUONG-20X20`):

- **`BAN-J55`** chép NGUYÊN VĂN định mức Bàn J55 ở `docs/PHAN_TICH_HE_THONG_CatSat.md` mục II.3.1
  (bên FE) — bảng định mức thật kèm kết quả solver đã kiểm chứng tay trong cùng tài liệu.
- 3 SKU cùng họ (`GHE-J55`, `GHE-TY-J55`, `BAN-TRA-J55`) đặt theo kích thước nội thất thông dụng
  (ghế cao 450-480mm, sâu ngồi 400-450mm, bàn ăn 700-800mm) để gộp có ý nghĩa.
- Kèm `PlanForm` APPROVED mỗi SKU — thiếu cái này Sales KHÔNG chọn được SKU khi tạo PO
  (`OrderManagementPage` đọc PlanForm, không đọc `mfg_products`).

Kiểm chứng bung định mức: nhu cầu 500 bộ ra **đúng** bảng II.3.2 (930/765/695 → 1000 mỗi cỡ,
200 → 2000, 660 → 2000, 840 → 500).

### 8.2 Solver deploy đã chết — chuyển về container local

`https://dna-dexuat.onrender.com` trả **404 ở MỌI đường dẫn** (kể cả `/`). Container local
`catsat_web` (docker, cổng 18080) còn sống. Đã đổi `.env`: `SOLVER_BASE_URL=http://localhost:18080`,
`SOLVER_API_KEY=dev-local-solver-key` (lấy từ `ERP_API_KEY` của chính container). Đổi lại khi
instance Render sống lại.

### 8.3 Chuẩn vàng — số solver khớp tài liệu

Bàn J55 × 500, cấu hình hiện hành:

| Loại sắt | Tài liệu | Chạy thật | |
|---|---|---|---|
| sắt hộp 25×50 | 6000mm · 467 cây · 0.18% | 6000mm · **467 cây** · 0.178% | ✔ khớp |
| sắt vuông 50×50 | 6000mm · 223 cây · 0.85% | 6000mm · **223 cây** · 0.847% | ✔ khớp |
| sắt vuông 20×20 | vét cạn 6740mm · 63 cây · 0.18% | vét cạn **5900mm** · 72 cây · 0.220% | ✔ đúng cấu hình |

Lệch ở 20×20 là do cấu hình chứ không phải sai: tài liệu dò dải 5000→**7000** nên ra 6740mm, còn
`SystemConfig.solverMaxLengthMm` của hệ thống chặn **6000** nên tốt nhất trong dải là 5900mm.

### 8.4 Ma trận ca thử (chạy thật qua API, đúng endpoint FE gọi)

| # | Ca | Thông số | Kết quả | Đạt |
|---|---|---|---|---|
| 1 | J55×500 cắt riêng | mặc định | 3 loại đạt, 20×20 `scan` 5900mm → **tự duyệt** | ✔ |
| 2 | J55×500 cắt riêng | cấm cây lạ | 20×20 **vô nghiệm** ở 6000 → **chặn** (DRAFT) | ✔ |
| 3 | J55×500 cắt riêng | cấm cây lạ + đặc cách 2% | cả 3 loại ở **6000 fixed**, 20×20 1.86% ≤ 2% → **tự duyệt** | ✔ |
| 4 | Gộp **4 SKU** | mặc định | 3 loại ở 6000 fixed, 0.167/0.409/0.364% → **tự duyệt** | ✔ |
| 5 | Validate DTO | các biến thể sai | chặn 400 đúng, **trừ 1 ca lọt** (xem 8.5) | ⚠ |
| 6 | J55×500 | đặc cách 2%, 1 loại đã có ngưỡng riêng 5% | payload `max_waste=2`, `by_material={"5":5}` → **chỉ nâng, không hạ** | ✔ |
| 7 | Gộp **2 SKU** | cấm cây lạ + đặc cách 1.5% | 2/3 loại vẫn vô nghiệm → **vẫn chặn** | ✔ |

Ca 3 là ca nghiệp vụ gốc ("khách gấp, mua cây 6m dù vượt ngưỡng") — tổ hợp mà enum 3 mức cũ không
diễn đạt nổi, nay chạy đúng. Ca 7 chứng minh đặc cách là **trần** chứ không phải giấy phép: xin
1.5% mà thực tế cần 2.07% thì hệ thống vẫn chặn.

Nhu cầu khi gộp 4 SKU cộng đúng từng cỡ đoạn qua các SKU (vd 25×50 @450 = 800 của GHE-J55 + 400
của GHE-TY-J55 = 1200). Trên FE, gộp 3 SKU bớt **20 cây**, gộp 4 SKU bớt **30 cây**.

### 8.5 Bug tìm được

**(a) ĐÃ VÁ — lý do đặc cách chỉ gồm khoảng trắng vẫn lọt.** `@MinLength(1)` đếm `"   "` là 3 ký
tự nên POST thẳng API tạo được lệnh sản xuất với lý do rỗng trơn, Sếp duyệt một đề nghị nới ngưỡng
không có căn cứ nào. FE có `.trim()` nhưng luật phải nằm ở BE. Vá bằng `@Transform` trim trước khi
validate (`solver-override.dto.ts`), kèm `solver-override.dto.spec.ts` (6 test) khoá lại.

**(b) CHỐT KHÔNG XỬ LÝ (2026-09-16) — thông báo vô nghiệm đổ lỗi sai chỗ.**
Khi bế tắc do trần `max_surplus` (cho dư tối đa 10 đoạn **mỗi cỡ** - xem
`changelog-2026-08-15...` mục 15.2; "đoạn dư" là đoạn ĐÃ cắt đúng cỡ trong đơn, KHÁC hẳn **mẩu
nguyên** `mauNguyenMm` là phần cây cắt dở còn nguyên nhập lại kho) chứ không phải ngưỡng hao hụt, solver vẫn
trả: *"Không có cách cắt nào đạt ngưỡng 1.5%. Tốt nhất có thể: **0.79%**. Nâng ngưỡng lên ≥ 0.79%"*
— tự mâu thuẫn (0.79% vốn đã dưới 1.5%) và khuyên sai hướng. Đo tách bạch trên cùng bộ nhu cầu:

| `max_surplus` | kết quả |
|---|---|
| 10 | vô nghiệm, "tốt nhất 0.79%" |
| 100 | vô nghiệm, "tốt nhất 0.60%" |
| 500 | **khả thi** — 160 cây, 0.31% |

Hệ quả với tính năng này: KHSX đọc thông báo sẽ đi xin ngưỡng đặc cách, Sếp duyệt, mà **vẫn không
chạy được** — vòng lặp vô ích. Hai hướng xử lý: sửa thông báo ở `cat_sat_iea`, hoặc DNA-ERP-BE tự
phát hiện mâu thuẫn (`bestAchievable.waste_pct <= ngưỡng đã áp`) và viết lại lý do cho đúng.

**Truy thêm 2026-09-16** (trả lời câu hỏi "nên xử lý thế nào"): `max_surplus` **KHÔNG** phải tham số
solver tự đặt như dòng trên từng ghi — nó là **`SystemConfig.solverMaxSurplus` của chính repo này**,
mặc định **10** (`schema.prisma:260`), gửi sang solver ở `cutting-proposals.service.ts:1324`. Kèm
theo: field này **chưa có form nhập ở Admin** (BE đã hỗ trợ sẵn tại `update-system-config.dto.ts:86`,
chỉ thiếu FE) → dù biết đúng nguyên nhân, hiện KHÔNG ai sửa được mà không vào thẳng DB.

**Quyết định (người dùng chốt 2026-09-16): KHÔNG xử lý, giữ nguyên hành vi hiện tại.** Đã trình bày
rủi ro nghiệp vụ (KHSX đọc thông báo sai → xin đặc cách nới ngưỡng → Sếp duyệt dựa trên con số vô
nghĩa → vẫn bế tắc, lặp vô ích, làm rỗng chính tính năng "xin - duyệt có bằng chứng" ở mục 7-12) và
3 bước vá đã đề xuất; người dùng đánh giá chưa cần thiết. Ghi lại để không ai tưởng việc này bị bỏ
quên. Nếu về sau gặp thật trên môi trường chạy, phương án rẻ nhất vẫn là bước 1: chặn ở
`lineDisplayReason()` (`cutting-proposals.service.ts:2458`) - so `bestAchievable.waste_pct` với
ngưỡng đang áp, nếu đã thấp hơn thì nói rõ "không phải do ngưỡng hao hụt, xin đặc cách sẽ không giải
quyết được gì" (phần này là số học, chắc chắn đúng, không phải suy đoán).

**Chưa kiểm chứng, cần làm trước nếu sau này quyết nâng `solverMaxSurplus`**: nâng trần cho dư KHÔNG
miễn phí - đoạn dư được solver tính là *dùng được* chứ không phải *vụn bỏ*, nên % hao hụt đẹp hơn
(0.31% ở `max_surplus=500`) có thể đi kèm MUA NHIỀU SẮT HƠN. Chưa so được số cây vì 2 ca
`max_surplus` 10/100 đều bế tắc, không có phương án để đối chiếu. Phải đối chiếu tài liệu solver
(mục 8.3) trước khi đổi mặc định, và đây là quyết định nghiệp vụ của Sếp/KHSX (dư ít → hay bế tắc;
dư nhiều → tồn kho phình), không phải lựa chọn kỹ thuật.

**Chốt nghiệp vụ 2026-09-16 (người dùng):** đoạn dư **để dưới xưởng, KHÔNG tự đưa vào tồn kho**; nếu
có tồn thì **thủ kho tự xử và tự nhập vào**. Đã đối chiếu code - hệ thống hiện tại **đã đúng** ý
này, KHÔNG phải sửa gì:

- `recordCutBatch()` (Phôi báo cắt, `steel-issues.service.ts`) chỉ ghi `CutBundle` +
  `cutPatternSegment` (số đoạn theo từng cỡ) — **không** gọi `postEntry()`. Đoạn cắt ra, kể cả đoạn
  dư, nằm nguyên ở tầng sản xuất.
- Đường DUY NHẤT post stock trong module này là lúc kho **giao sắt cây** cho sản xuất
  (`refType: STEEL_ISSUE`, kho → Kho sản xuất, `steel-issues.service.ts:278`). Không có đường nào
  tự nhập đoạn cắt vào kho.
- Khi thủ kho muốn nhập tay: `StockLedgerService.adjust()` đã nhận sẵn `segmentSpecId` (cỡ đoạn),
  `pieceId` (mảnh), `stockLengthMm` và `note`, ghi `refType: ADJUST` — đúng cơ chế "thủ kho tự xử".

→ Hệ quả: lo ngại "nâng trần cho dư → tồn kho phình" ở đoạn trên KHÔNG phải rủi ro hệ thống (không
có gì tự phình vào sổ kho), mà là việc quản lý vật lý dưới xưởng.

**Doc lệch, chưa sửa**: doc comment `CutBundle.mauNguyenMm` (`schema.prisma:2339`) và
`CuttingProposalLine.mauNguyenMm` (`:1559`) vẫn ghi mẩu nguyên là "TÀI SẢN **nhập lại kho**" - nhưng
từ 2026-09-05 ô nhập "mẩu nguyên" đã bị bỏ, dòng mới ghi 0, và không có đường nào post nó vào kho.
Theo đúng chốt trên thì hành vi hiện tại KHÔNG sai (thủ kho tự nhập nếu cần), chỉ có câu comment
đang tả một ý định không còn đường đi. Chưa sửa vì `schema.prisma` đang nằm trong phần sửa dở chưa
commit - đợi người dùng đồng ý.

### 8.6 Còn treo

- Bug (b) ở trên: **chốt KHÔNG xử lý** (2026-09-16, xem phần cuối mục 8.5) - giữ nguyên hành vi hiện tại.
- Chưa thử gộp 3 SKU (đã thử 1, 2, 4 — cùng một code path `mergeItems`).
- `.env` đang trỏ solver local; phải đổi lại khi deploy.
- ~~Dữ liệu thử để lại trên DB dev: `PO-J55-A..F`, `PO-TRA-A..C`, `PO-GOP-*`, `PO-DEMO-*`, PI-2026-011/012~~ — **đã dọn 2026-09-16, xem mục 14**.

---

## 9. Đổi UI sang "bánh răng + 3 tình huống", điền sẵn số và phơi hậu quả (2026-09-14)

### 9.1 Vì sao đổi lại UI

Người dùng nhìn màn hình và hỏi lại: *"tôi nhớ kêu bạn làm một ô bánh răng setting để chọn 1 trong
3 trường hợp mà?"* — đúng, đó là yêu cầu gốc; bản trước là 2 ô nhập rời (số % + ô tick) nên đọc như
tham số kỹ thuật chứ không như tình huống nghiệp vụ.

Không quay lại enum 3 mức cũ (đã hỏng vì lý do ở mục 7.1), mà giữ nguyên 2 thông số độc lập bên
dưới và **đặt tên 3 tình huống ở lớp trên**:

| Chọn trên UI | Gửi BE |
|---|---|
| Bình thường — cho đặt cây riêng nếu cần (mặc định) | không gửi gì |
| Chỉ mua cây chuẩn, phải đạt ngưỡng | `solverAllowCustomLength: false` |
| Chấp nhận hao hụt cao hơn (đơn gấp) | `solverMaxWastePctOverride` + lý do, kèm `solverAllowCustomLength: false` nếu tick |

Tổ hợp thứ 4 ("cho đặt cây riêng + chấp nhận vượt") không thành dòng thứ 4 mà là tình huống 3 khi
BỎ tick "chỉ mua cây chuẩn" — danh sách vẫn gọn đúng 3 dòng mà không mất ca nào.

Nút radio ghim cứng `width/height: 15` — bản trước ở Admin để trình duyệt tự co giãn nên nút phình
to bằng cả dòng ở khung hẹp, chính là lý do người dùng bắt gỡ khối đó đi.

### 9.2 Ca "nhập 10% khi màn báo ≥13.90%" — đo thật, ra 2 kết quả trái ngược

Người dùng hỏi thẳng ca này. Chạy cả hai biến thể trên Bàn trà J55 ×180-200:

| Biến thể | Kết quả |
|---|---|
| 10%, KHÔNG tick "chỉ cây chuẩn" | **tự duyệt** — 20×20 ra cây **5180mm**, hao 0.268% |
| 10%, CÓ tick "chỉ cây chuẩn" | **bị chặn** — 20×20 vô nghiệm, báo "tốt nhất 13.90%, nâng ngưỡng lên ≥13.90%" |

Bài học: số `≥13.90%` trên màn là hao hụt **ở cây chuẩn 6000mm**. Còn được đặt cây riêng thì solver
tìm ra cây 5180mm nên 13.90% không bao giờ xảy ra.

**Phát hiện quan trọng hơn:** ở CẢ HAI lần, xin 10% để cứu 20×20 đã âm thầm duyệt luôn
`SAT-HOP-25X50` (~1.51%) và `SAT-VUONG-50X50` (~2.21%) — hai loại mà người xin không hề nghĩ tới,
trong khi ngưỡng thường là 1%. Con số đặc cách là **trần cho cả đợt**, nên xin thừa là chi thêm
tiền sắt ngoài ý định.

### 9.3 Hai việc làm để bịt chỗ đó

**(1) Điền sẵn mức tối thiểu cần xin** (`GomDotCatPage`): chọn tình huống 3 là ô % tự điền con số
suy từ chính số đang hiện trên màn (loại sắt vướng nhất trong tổ hợp đang chọn, làm tròn lên 0.1%),
kèm chú thích *"(ước tính cần ≥13.9% — do SAT-VUONG-20X20)"*. Gõ thấp hơn thì cảnh báo *"Thấp hơn
mức ước tính — nhiều khả năng vẫn bị chặn nếu không cho đặt cây riêng"* (cảnh báo, KHÔNG cấm: như
9.2 cho thấy, còn tuỳ có cho dò cây riêng hay không). Ô "chỉ mua cây chuẩn" tick sẵn vì đơn gấp gần
như luôn cần. Luồng thường ngày giờ không phải gõ số nào.

**(2) Chỉ đích danh dòng đã tiêu tới đặc cách** (BE + màn "Cắt sắt" của Admin):
`CuttingProposalLineResponseDto` thêm `normalWastePctThreshold` (ngưỡng thường của loại sắt đó) và
`usedWasteOverride` (hao thật > ngưỡng thường). Lưu ý bắt buộc: `maxWastePctThreshold` có sẵn trên
dòng là ngưỡng **ĐÃ NÂNG** solver nhận, không dùng để so được — nên `findOne()` đọc thêm
`SystemConfig.solverMaxWastePercentage` rồi truyền vào `toDetailResponseDto()`, còn ngưỡng riêng
từng vật tư lấy từ `line.material` vốn đã có trong `DETAIL_INCLUDE` (không thêm truy vấn nào).

Màn chi tiết giờ hiện, ngay dưới cột Hao hụt %: `⚠ dùng đặc cách (thường ≤1%)` — đúng 2 dòng nói
trên, còn 20×20 (lý do xin ban đầu) KHÔNG có nhãn vì thực tế không dùng tới.

### 9.4 Kiểm tra

- BE `npx jest`: **1043/1043 pass**; `tsc`/`eslint` sạch.
- FE `tsc` sạch, `vitest cuttingGuide` 8/8 pass (fixture bổ sung 2 field mới).
- Live trên FE: nút `Chế độ cắt: Bình thường` → mở ra đúng 3 tình huống (radio 15×15px, không
  phình); chọn tình huống 3 → ô % tự điền `13.9`, chú thích đúng loại sắt, ô "chỉ cây chuẩn" tick
  sẵn; gõ `10` → hiện cảnh báo thấp hơn ước tính; gộp 3 SKU với 2.5% + "chỉ cây chuẩn" → PI lưu
  đúng `2.50 / false / lý do`, Sếp duyệt → solver chạy `max_waste=2.5 auto_scan=false`, 50×50 ra
  2.266% và **tự duyệt**; màn Admin > Cắt sắt hiện đúng nhãn `⚠ dùng đặc cách`.

---

## 10. Bỏ chế độ "Chỉ mua cây chuẩn", còn 2 lựa chọn (2026-09-15)

Người dùng nhìn lại 3 lựa chọn và thấy cái ở giữa thừa. Đúng: `FIXED_STRICT` chỉ khác `AUTO`
**đúng một ca** — khi không chiều dài chuẩn nào đạt ngưỡng (vì cơ chế vốn là "cây chuẩn nào đạt thì
chốt luôn, không đạt mới vét cạn") — và trong ca đó nó chỉ làm mỗi việc là dừng lại.

Có nêu số đo phản biện trước khi bỏ: trong các lần chạy thật, `AUTO` đặt cây riêng khá thường xuyên
(Bàn J55 ×500 → 5900mm; Bàn trà ×200 → 5180mm; chỉ đợt gộp 4 SKU mới ở cây chuẩn 6000), tức 2/3
lần hệ thống tự chốt cây phải cán riêng rồi tự đẩy sang Mua hàng. `FIXED_STRICT` sinh ra để chặn
đúng chuyện đó. Người dùng vẫn chốt bỏ — hàm ý đặt cây riêng ở xưởng không phải vấn đề về thời gian.

**Ràng buộc "chỉ cây chuẩn" KHÔNG mất**: nó vẫn là ô tick bên trong `ACCEPT_OVER`, đúng chỗ thật sự
cần (đơn gấp). Tổ hợp duy nhất không còn chọn được từ UI là "chỉ cây chuẩn + giữ ngưỡng thường" —
nếu sau này cần cho toàn hệ thống thì đặt `SystemConfig.solverAllowCustomLength = false`.

**Đã sửa** (`GomDotCatPage.tsx`): `CutMode` còn `'AUTO' | 'ACCEPT_OVER'`, bỏ entry giữa khỏi
`CUT_MODES` và nhánh `FIXED_STRICT` trong `solverOverride()`; nhãn nút không còn cắt chuỗi theo
`' — '` mà map thẳng; câu cảnh báo trong panel đổi "chọn tình huống thứ 3" → gọi thẳng tên
"Chấp nhận hao hụt cao hơn". **Không đụng BE** — `solverAllowCustomLength` vẫn được gửi từ ô tick.

Trang giải thích cho Sếp cập nhật theo: đổi tên thành "Duyệt cắt sắt" (khỏi vỡ nếu số chế độ đổi
lần nữa), còn 2 thẻ chế độ, và ví dụ gộp 4 đơn (bớt 30 cây) tách ra thành mục riêng
**"Cách rẻ nhất — gộp đơn, trước khi xin gì cả"** vì gộp là đòn bẩy không tốn tiền, không phải một
chế độ.

Kiểm tra: FE `tsc` sạch, `eslint` 0 lỗi; live trên FE thấy đúng 2 radio, ô "chỉ mua cây chuẩn" vẫn
tick sẵn trong chế độ đơn gấp.

---

## 11. Bằng chứng đặc cách trong CHÍNH callout duyệt, và soát lại UI/UX (2026-09-15)

### 11.1 Yêu cầu

Người dùng hỏi: *"duyệt cắt sắt để làm gì, sao không thể hiện trong PI lúc đưa qua sếp duyệt luôn?"*
rồi chốt: *"tất cả hiển thị hết trong 1 màn mà đúng không chứ không tạo ra màn mới"*. Trang giải
thích 2 chế độ (mục 9-10) chỉ để đọc một lần cho hiểu khái niệm - chỗ quyết định thật phải nằm
ngay trong callout Sếp đang đọc lúc duyệt, không thêm màn nào.

### 11.2 Bằng chứng BE tự tính, không tin số FE

`ProductionInvoice.solverOverrideEvidence` (Json, nullable, migration
`20260915033000_pi_solver_override_evidence` - thuần cộng cột). `buildOverrideEvidence()`
(`production-invoices.service.ts`) gọi lại `CuttingProposalsService.previewBatch()` - đúng phép
tính KHSX đã nhìn thấy lúc gộp - ngay tại thời điểm bấm gộp/cắt riêng, chọn loại sắt vướng nhất
trong tổ hợp, lưu `{ materialCode, estimatedWastePct, normalThresholdPct }`.

Vì sao BE tự tính thay vì nhận field FE gửi: đây là căn cứ Sếp dùng để duyệt chi thêm tiền, không
được để client khai. Vì sao CHỤP LẠI thay vì tính lúc hiển thị: solver chỉ chạy SAU khi Sếp duyệt
nên lúc duyệt chưa có số thật, và tính lại về sau có thể ra số khác nếu định mức đã đổi - đây là
vết duyệt, không phải số liệu sống. Chỉ tính khi có `solverMaxWastePctOverride` (khỏi tốn 1 lượt
tính cho đường thường); lỗi khi tính (vd định mức hỏng) chỉ log cảnh báo, KHÔNG chặn thao tác gộp -
thiếu một dòng hiển thị không đáng chặn cả nghiệp vụ.

Test thật qua API: `claim-solo` với `solverMaxWastePctOverride: 10` trên `BAN-TRA-J55` (đúng SKU đã
đo hôm 09-14) → BE tự ra đúng `{"materialCode":"SAT-VUONG-20X20","estimatedWastePct":13.9,
"normalThresholdPct":1}` không cần FE gửi gì.

### 11.3 Bắt được lỗi khi tự soát với vai Sếp — con số tự mâu thuẫn

Đọc lại chính callout vừa dựng: *"Chấp nhận hao hụt tới 10%"* đứng cạnh *"Vì SAT-VUONG-20X20 ước
tính hao hụt ≥13.90%"* - đọc lên như KHSX tính sai hoặc giấu gì, vì 10% < 13.9%. Không sai: con số
≥13.9% là ước tính KHI CHỈ CẮT CÂY CHUẨN (`previewBatch` không dò cây riêng), còn đợt này không tick
"chỉ mua cây chuẩn" nên hệ thống vẫn được dò - đúng loại sắt đó, đo hôm 09-14, dò ra cây 5180mm chỉ
hao 0.27%. Câu chữ thiếu mất vế "khi chỉ cắt cây chuẩn", nên đọc vào thấy vênh dù không sai.

Sửa: câu luôn nêu rõ *"cắt **cây chuẩn** ước tính hao hụt ≥X%"*, và khi KHÔNG tick "chỉ mua cây
chuẩn" thì nối thêm *"— đợt này còn được thử đặt cây riêng nên thực tế có thể thấp hơn nhiều"*.

Nhân tiện phát hiện dữ liệu test của chính phiên này bị lỗi encode (`Kho th�nh ph?m` thay vì
"Kho thành phẩm") - do tiếng Việt bị nát khi gửi qua `curl` trong Bash trên Windows lúc dựng dữ
liệu thử, KHÔNG phải bug ứng dụng (đối chiếu với bản ghi tạo qua đúng UI thì encode đúng). Đã sửa
lại đúng dòng dữ liệu test đó bằng UPDATE trực tiếp.

### 11.4 Soát UI/UX với vai Sếp — viết lại `solverOverrideNote()`

Bản đầu nhồi 3 loại thông tin khác hẳn nhau (con số xin duyệt - sự thật; lý giải kỹ thuật - bằng
chứng hệ thống; lý do KHSX - lời người) vào CÙNG một cỡ chữ/màu, chỉ khác bullet với không-bullet.
3 vấn đề cụ thể: (a) con số `10%` - thứ Sếp cần thấy đầu tiên - chìm giữa câu văn, không có gì kéo
mắt; (b) không so được ngay `10%` với ngưỡng thường `1%` - phải tự đọc, tự nhớ, tự so; (c) 3 loại
thông tin lẫn vào nhau, khó phân biệt đâu là số liệu đáng tin, đâu là lời giải trình của người.

Viết lại theo đúng thứ tự Sếp cần đọc: **thẻ số lớn** "Xin duyệt tới 10%" đặt cạnh "Ngưỡng thường
1%" (so trực tiếp, không cần tính nhẩm) → dòng lý giải kỹ thuật chữ nhỏ hơn, mờ hơn (`opacity`/màu
nhạt) → lý do KHSX tách hẳn bằng đường kẻ `border-top`, đặt trong ngoặc kép như một lời trích dẫn.

Kiểm tra: FE `tsc` sạch, `eslint` 0 lỗi (89 warning `any` có sẵn từ trước). Live trên FE (cả header
chi tiết PI lẫn modal xác nhận duyệt, `compact=true`) đúng bố cục, không vỡ layout ở khung hẹp.

### 11.5 Chỉnh nhanh theo phản hồi ngay sau khi xem live (2026-09-15)

- "Xin duyệt tới" → **"Xin hao hụt tới"** (đúng bản chất con số hơn - không phải "duyệt tới đâu"
  mà là "chấp nhận hao hụt tới đâu").
- Bỏ hẳn khối thống kê "Ngưỡng thường" cạnh số chính - người dùng thấy thừa. `ev.normalThresholdPct`
  vẫn được BE tính và lưu trong `solverOverrideEvidence`, chỉ không còn đọc ở UI này.
- Thêm lại nhãn **"Lý do:"** trước phần trích dẫn (bị rớt lúc đổi sang định dạng ngoặc kép) - giờ
  là `Lý do: "…"`.

Xác nhận lại trên FE (header PI): số lớn `10%`, dòng lý giải kỹ thuật, dòng `Lý do: "…"` sau đường
kẻ - đúng bố cục, không còn khối ngưỡng thường.

---

## 12. Chip loại sắt: 3 màu → 2 màu (2026-09-15)

Người dùng thấy 3 màu (xám/vàng/đỏ) ở bảng "Loại sắt · hao hụt khi cắt riêng" là thừa, đề xuất
2 màu xanh/đỏ theo mốc cố định `< 1%` / `≥ 1%`.

Đồng ý đổi 2 màu nhưng chỉnh 2 điểm trước khi làm:

1. **Không hard-code mốc 1%.** Cờ `over` (BE tính sẵn) đã đúng theo NGƯỠNG CỦA CHÍNH LOẠI SẮT ĐÓ
   (`Material.maxCuttingWastePercentage ?? SystemConfig` mặc định) - hard-code 1% ở FE sẽ báo đỏ
   sai ngay khi ai đó đặt ngưỡng riêng khác 1% cho một loại sắt (tính năng đã có sẵn ở Admin).
2. **Cảnh báo "mẫu quá nhỏ" (`isLowConfidence`, dấu `?`) không nên bỏ hẳn** - nó cảnh báo cận dưới %
   không đáng tin khi SKU cần dưới 3 cây (cây cuối gần như quyết định hết cả %). Bỏ hẳn thì một
   chip XANH "≥0.3%" tính trên 2 cây có thể khiến người xem yên tâm nhầm trong khi thực tế cắt ra
   có thể 5-8%. Hỏi lại người dùng qua AskUserQuestion, chọn giữ dấu `?` nhưng gộp vào đúng 2 màu
   thay vì tách màu vàng riêng.

**Đã sửa** `MaterialChip()` (`GomDotCatPage.tsx`): bỏ nhánh màu vàng
(`lowConfidence ? '#fef9c3' : ...`), còn đúng 2 màu theo `over` - đỏ `#fee2e2`/`#b91c1c` (vượt
ngưỡng), xanh `#e8f5e9`/`#166534` (đạt ngưỡng, dùng lại đúng tông xanh đã có sẵn trong file này cho
"đạt ngưỡng"/"bớt được cây"). Dấu `?` + tooltip mẫu nhỏ giữ nguyên, chỉ đổi nền.

Kiểm tra: FE `tsc` sạch, `eslint` 0 lỗi. Live trên FE: `SAT-VUONG-50X50 ≥6.62%` và
`SAT-VUONG-20X20 ≥1.88%` lên đỏ, `SAT-HOP-25X50 ≥0.27%`/`≥0.17%`, `SAT-VUONG-50X50 ≥0.85%` lên
xanh - đúng theo `over`, không còn màu vàng.

---

## 13. Đồng bộ commit mới của partner (`e4a118b`) vào cây làm việc đang dở (2026-09-16)

`main` local đứng ở `1ad053b` (DEC39), behind 1 so với `origin/main` = `e4a118b` ("48-52-54" của
partner). Checkout thẳng bị git từ chối vì working tree đang có 17 file sửa dở + 15 file mới chưa
commit (toàn bộ công việc mục 7-12 ở trên chưa commit).

**Vì sao không commit trước rồi mới pull**: công việc đang dở nửa vời (mục 7.5/8.6 còn treo), commit
vào lúc này sẽ tạo commit không chạy được. Cũng không tạo branch mới theo yêu cầu người dùng — chỉ
cần đứng ở commit mới.

**Đối chiếu trước khi làm** — `e4a118b` sửa 7 file, chỉ 2 file trùng với file đang sửa dở, và các
vùng dòng KHÔNG đè nhau:

| File | Local sửa (dòng) | `e4a118b` sửa (dòng) | Đụng |
| --- | --- | --- | --- |
| `stock/stock-ledger.service.ts` | 649 | 183, 215-240 | không |
| `cutting-proposals/cutting-proposals.service.ts` | ...2079, 2435-2508 | 2183-2258 | không |

→ git tự merge được, không phải chọn bỏ code bên nào.

**Đã làm**:

1. Backup 2 lớp trước khi động vào: `git diff HEAD` ra patch + `tar` toàn bộ file untracked (theo
   `git ls-files --others --exclude-standard`) vào scratchpad — patch không chứa file mới nên thiếu
   tar là mất hẳn `solver-override.dto.ts`, 4 migration, 5 changelog...
2. `git stash push -u -m "pre-ff-e4a118b"` → `git merge --ff-only origin/main` (fast-forward, không
   tạo merge commit, không đổi lịch sử của partner) → `git stash apply` (dùng `apply` chứ không
   `pop` để stash còn lại làm lớp an toàn thứ 3).
3. Auto-merge sạch cả 2 file, 0 conflict marker.

**Kết quả kiểm tra**:

- `git status` sau khi apply: đúng 17 file `M` + 15 file untracked như trước, `git diff --stat` khớp
  y nguyên (1135 insertions, 83 deletions).
- Code của partner còn nguyên trong cây: `stockLengthMm: dto.stockLengthMm` (dòng 185),
  `locked.reduce(...)` (dòng 240) — bản sửa cộng dồn nhiều bucket `stockLengthMm` khi
  `dto.stockLengthMm` bỏ trống; và `{ timeout: 30_000 }` (dòng 2339) — bọc lại
  `$transaction` trong `runSolverAndSave()`. `git diff` hiện tại không xoá dòng nào của partner.
- `tsc --noEmit`: sạch (exit 0).
- `jest` 2 spec của đúng 2 module từng đụng: 109/109 pass.

**Còn treo**: `stash@{0}` (`pre-ff-e4a118b`) vẫn giữ làm lớp an toàn — khi nào yên tâm thì
`git stash drop stash@{0}`. Phần công việc mục 7-12 vẫn chưa commit, vẫn nằm dạng dirty như trước.

---

## 14. Dọn sạch dữ liệu test trên DB dev + tạo lại BOM hỏng (2026-09-16)

Người dùng yêu cầu dọn rác test (mục 8.6/7.5) và "xoá BOM tạo lại" (chặn đường ở mục 8.1/7.5).

### 14.1 Phát hiện trước khi xoá: ảnh người dùng gửi KHÔNG phải DB local

Người dùng gửi ảnh màn "Tối ưu cắt sắt" (tài khoản `khsx`) có `PO-6472813`/`dinh muc 09/2026`,
`PO-48`/`Ghế J57`, `máhgd`/`nhan` (SL 1342). **DB local `localhost:5432/dna_erp` không có bản ghi
nào trong số đó** — PI đang `PLANNING` ở local là `E2E-BAN-01` và `BAN-TRA-J55`. Vậy ảnh là môi
trường khác (deploy/staging). Đã hỏi lại và người dùng chốt: **chỉ dọn DB local**.

Đồng thời phạm vi rác lớn hơn danh sách đã ghi: local có 36 đơn hàng / 25 PI / **30 lệnh SX, trong
đó 29 là test** (thêm `PO-GOP2-*`, `PO-UI-*`, `PO-M1..M6`, `PO-FE-CHECK`, `PO-CHIP-CHECK` chưa từng
ghi ở mục 8.6). Người dùng chốt phạm vi: **xoá toàn bộ dữ liệu test, giữ `PO-1`/`PI-2026-001` và 4
SKU định mức fixture**.

### 14.2 Cách làm — 3 lớp an toàn thay vì xoá tay

1. **Backup**: không có `pg_dump` trên máy (và `scripts/backup-db.sh` mà `package.json` gọi
   **không tồn tại** — script hỏng, xem mục 14.5). Thay bằng JSON dump TOÀN BỘ DB qua
   `information_schema` → 81 bảng / 2.587 dòng, mỗi bảng 1 file.
2. **Bản đồ khoá ngoại tự truy từ DB** (`information_schema.referential_constraints`) chứ không
   đoán từ schema — ra đúng thứ tự xoá và biết chỗ nào `RESTRICT`/`CASCADE`/`SET NULL`. Nhờ đó phát
   hiện `plan_form_manh_reviews`/`plan_form_detail_reviews` chặn `plan_forms` (lần chạy đầu fail,
   transaction rollback nguyên vẹn, không mất gì).
3. **Kiểm chứng tồn kho TRƯỚC khi xoá**: so `stock_quant` với tổng hợp từ `stock_ledger`
   (`to` cộng, `from` trừ, nhóm theo warehouse+material/segment/piece+stockLengthMm) → **khớp
   100%**. Nhờ đó chọn cách "xoá xong dựng lại `stock_quant` từ ledger còn lại" thay vì bù trừ tay
   từng dòng. Nếu lệch thì script tự dừng, không dựng lại.

Toàn bộ xoá chạy trong **1 transaction**.

### 14.3 Đối chiếu quyền sở hữu từng bản ghi phụ thuộc (để không xoá lây `PO-1`)

Truy từng bảng thay vì xoá theo tên: cả 4 `production_batches`, `material_yield_issues`,
`purchase_proposals` 1-3, `stock_reservations`, và bút toán kho **1-9** đều thuộc `PO-1` → giữ. Chỉ
2 bút toán `WAREHOUSE_TRANSFER` (của `CK-2026-002/003`) là test → xoá. `steel_issues` chỉ có 1 dòng
và thuộc `PI-2026-001` → giữ cùng 3 `cut_bundles`.

**Kết quả (909 dòng bị xoá)**: coverage 21, pattern_segments 547, patterns 150, lines 48,
purchase_proposal_items 43, purchase_proposals 15, cutting_proposals 20, stock_ledger 2,
warehouse_transfer* 4+3, production_orders 29, production_invoice_items 35, production_invoices 24,
plan_form reviews 2, plan_forms 5, sales_order_items 35, sales_orders 35.

| | Trước | Sau |
|---|---|---|
| Đơn hàng / PI / Lệnh SX | 36 / 25 / 30 | 1 / 1 / 1 |
| Phương án cắt / Đề xuất mua | 22 / 18 | 2 / 3 (đều của `PO-1`) |
| Phiếu chuyển kho | 3 | 0 |
| Bút toán kho / stock_quant | 11 / 18 | 9 / 14 |
| `piece_bom` (định mức fixture) | 21 | 21 — nguyên vẹn |

`stock_quant` dựng lại: 14 dòng, **lệch 0** so với ledger.

### 14.4 Việc A — nguyên nhân BOM hỏng KHÔNG phải "thiếu dữ liệu ngẫu nhiên"

Truy `piece_material_yield` mới thấy đúng bản chất: trong `rev2` của `E2E-BAN-01`, mảnh **`PAT`**
lấy từ vật tư TẤM (`E2E-SAT-LA`, 10 mảnh/cây) và **`CHAN-NHOM`** cũng từ material yield
(`E2E-SAT-25`, 5 mảnh/cây) → **đúng là không được có `piece_bom`**. Mảnh duy nhất phải cắt theo cỡ
đoạn là **`CHAN-BAN`** — `rev1` có dòng đó (700mm `E2E-SAT-25`, `{CAT}`), **`rev2` mất đúng nó** nên
tổng `piece_bom` = 0 và `buildBomRows` chết.

Nên "tạo lại" KHÔNG cần bịa số: `rev3` = bản sao `rev2` + dòng `piece_bom` copy từ `rev1`.

- Xác minh `rev2` không bị lệnh SX nào ghim (`bomRevisionId`) trước khi xoá — `rev1` thì **có**
  (`PO-1-1` ghim), nên giữ nguyên `rev1` `RETIRED`.
- Gặp index `bom_revision_one_active_per_product` (partial unique, chỉ 1 `ACTIVE`/SKU) → phải xoá
  `rev2` TRƯỚC rồi mới tạo `rev3` `ACTIVE`, không tạo song song được.
- Kết quả: `rev3` (id=16) `ACTIVE` — 3 mảnh, **1 `piece_bom`** (CHAN-BAN 700mm), 2 dòng yield.

### 14.5 Còn treo

- `package.json` có `db:backup`/`db:restore` trỏ `bash scripts/backup-db.sh`/`restore-db.sh` nhưng
  **thư mục `scripts/` không có 2 file đó** — chạy là fail. Chưa sửa (ngoài phạm vi yêu cầu).
- 22 dòng `notifications` chưa dọn: không có FK nên không bị chặn, nhưng có thể trỏ tới PI/PO vừa
  xoá. Chưa kiểm tra xem FE có vỡ khi mở thông báo chết hay không.
- Môi trường trong ảnh (deploy/staging) **chưa dọn** — người dùng chốt chỉ làm local đợt này.
- Backup JSON nằm ở scratchpad `db-backup-20260916-084341` (81 bảng). Phiên sau sẽ mất theo
  scratchpad — nếu cần giữ lâu thì copy ra chỗ khác.

## 15. Thêm trục thứ 3 độc lập — "Thời gian chạy tối đa" (2026-09-22), và vá lỗi timeout thật trên production

### 15.1 Tính năng mới — `solverTimeLimitSecondsOverride`

Từ cảnh báo live-test thật ("Đợt tính có 7 loại sắt × time_limit 60s/loại = tối đa 420s, vượt
timeout HTTP client hiện tại 300s"), người dùng hỏi thẳng: *"vậy tại màn tối ưu cắt sắt làm thêm
một ô để nhập thời gian như thế này thì sao"* (kèm ảnh mockup ô "Thời gian chạy tối đa (3x phút)"),
rồi chốt *"hãy implement luôn không cần plan"*.

Thêm trục thứ 3 **độc lập** với 2 trục hao hụt/chiều dài đã có ở mục 4 (`solverMaxWastePctOverride`,
`solverAllowCustomLength`) — khác biệt cố ý: **KHÔNG cần Sếp duyệt**, vì đây thuần là ngân sách
*thời gian tính toán*, không đổi kết quả cắt hay chi phí sắt (khác 2 trục kia, đổi thẳng phương án
cắt nên bắt buộc Sếp thấy trước khi duyệt).

- **BE**: `ProductionInvoice.solverTimeLimitSecondsOverride Int?` (migration
  `20260922041632_add_solver_time_limit_override`, thuần ADD COLUMN nullable). Thêm vào
  `SolverOverrideDto` (dùng chung cho `mergeItems`/`claimSolo`), `ProductionInvoiceResponseDto` (chỉ
  để đọc lại/debug — không hiện ở màn Sếp duyệt vì không phải quyết định nghiệp vụ).
  `CuttingProposalsService.runSolverAndSave()`: `timeLimitSeconds = job.timeLimitSecondsOverride ??
  config.solverTimeLimitSeconds`, dùng số này cho cả `time_limit_seconds` gửi solver lẫn phép kiểm
  `distinctMaterialIds.length × timeLimitSeconds > timeoutSeconds` (không áp trần/`max()` như 2 trục
  kia — KHSX tự chịu trách nhiệm con số mình nhập). Câu lỗi khi vượt ngưỡng nêu đúng nguồn để sửa
  (ô "Thời gian chạy tối đa" nếu KHSX đã set, hoặc `SystemConfig.solverTimeLimitSeconds` nếu chưa).
- **FE** (`GomDotCatPage.tsx`): ô nhập **đơn vị phút** (mặc định công ty hiện tính bằng giây, gõ giây
  cho số phút thật cần thì dài dòng) đặt ngoài khối "Chế độ cắt" collapsible (luôn hiện, không cần
  Sếp duyệt nên không cần ẩn đi như 2 trục kia); hiện gợi ý mặc định công ty (đọc
  `SystemConfig.solverTimeLimitSeconds` qua `getSystemConfig()`, lỗi 403 do KHSX không có quyền
  `SYSTEM_CONFIG:VIEW` thì bỏ qua lặng lẽ — chỉ là gợi ý, không phải điều kiện bắt buộc) và ước tính
  trực tiếp `(Nx phút ≈ Y phút tổng)` theo đúng số loại sắt của tổ hợp đang tick.
- **Kiểm tra**: `tsc --noEmit` + `eslint` sạch cả 2 repo; `jest` (BE, 3 suite liên quan) 270 test
  qua hết, không sửa gì; live-test tạo PO mới (2 SKU, 6 loại sắt), gõ "2" phút → hiện đúng
  "(6x phút ≈ 12 phút tổng)".

### 15.2 Phát hiện production đang fail hàng loạt vì đúng cơ chế này

Ngay sau khi tính năng trên xong, người dùng báo: production test thật, "42/57 Cần xử lý", cùng
1 câu lỗi timeout y hệt loại ở 15.1, và hỏi *"sao bên production tôi test khi boss duyệt xong qua
solve lại faile ?"*, sau đó *"nếu đang solve sao ko vào admin kiểm tra"* / *"nếu bỏ giới hạn thời
gian solve thì sao"*.

**Root cause xác nhận qua đọc code + `render.yaml`** (không phải bug do tính năng 15.1 — guard này
đã có từ 18/08, xem comment `cutting-proposals.service.ts:1399` tự dự báo đúng ca này: *"mặc định
code (SOLVER_TIMEOUT_SECONDS=300)... không đủ cho phiếu gộp nhiều loại sắt nếu ai đó quên set env
production"*):

- `render.yaml` **chưa từng khai** `SOLVER_TIMEOUT_SECONDS` → production rơi về mặc định code
  **300s** (local `.env` đang để 1700s nên không ai thấy ca này khi dev).
- DB production có `SystemConfig.solverTimeLimitSeconds = 180` (giây/loại sắt) — cao hơn nhiều
  mặc định thiết kế (schema default 20s).
- Guard `distinctMaterialIds.length × timeLimitSeconds > timeoutSeconds` (đã có sẵn, không phải mới)
  → chỉ cần **2 loại sắt** đã đủ 360s > 300s để bị chặn. Vì hầu hết lệnh SX gộp ≥2 loại sắt/SKU nên
  gần như mọi lô rơi vào "Cần xử lý" — khớp đúng 42/57.
- Đã giải thích rõ với người dùng: gọi solver này chạy NỀN (`void runSolverAndSave(...)`, fire-and-
  forget ngay sau khi PI được duyệt — xem comment dòng 187-192), nên `SOLVER_TIMEOUT_SECONDS` không
  hề liên quan gì tới timeout Render/FE — nó là timeout của chính BE (đóng vai HTTP client) khi gọi
  SANG solver. Vì vậy **tăng** giá trị này lên rất cao là an toàn; nhưng **bỏ hẳn giới hạn thì
  không nên** — ca hiếm CP-SAT bế tắc ở MỌI chiều dài thử (thường do đặt sai ngưỡng %) sẽ treo
  request vĩnh viễn thay vì có đáy chặn.

### 15.3 Tái hiện bug + verify fix — live-test local (không chạy test BE, theo đúng yêu cầu)

- Tìm tổ hợp 2 SKU có sẵn trong dữ liệu thật (`prisma/real-data/dinh-muc-j55-gtu.json`) cho đúng
  **7 loại sắt** như ca production: `GHE-J55` (4 loại) + `GHE-TINH-YEU` (5 loại, giao 2) = 7 loại
  không trùng — khớp chính xác con số trong lỗi thật.
- Tạo `PO-GHE-MERGE-TEST` (2 SKU), gộp ở "Tối ưu cắt sắt" với "Thời gian chạy tối đa" = 3 phút
  (180s, đúng số người dùng đã thử trên production) → `PI-2026-006`.
- Hạ tạm `.env` local `SOLVER_TIMEOUT_SECONDS` 1700 → **300** (khớp mặc định production đang chạy),
  restart BE cho nhận `.env` mới.
- Chạy đủ chuỗi duyệt thật: `khsx` "Gửi QLSX" → `qlsx` "Chọn kho + Gửi sếp duyệt" → `boss` "Duyệt cả
  đợt" → **tái hiện ĐÚNG lỗi**: `cutting_proposals.status='FAILED'`, `errorMessage` khớp nguyên văn
  ca production ("7 loại sắt × time_limit 180s/loại = tối đa 1260s, vượt timeout HTTP client hiện
  tại (300s)...").
- Áp fix: trả `.env` về **1700**, restart BE, bấm "Tính lại" (Admin > Module nghiệp vụ > Cắt sắt —
  màn tạm thời theo đúng ghi chú mục mã nguồn, chưa có màn nghiệp vụ riêng cho Phase 7) → guard qua
  ngay (không còn fail tức thì), solver THẬT chạy tuần tự 7 loại sắt (~5 phút), kết quả:
  `status='DRAFT'`, `wastePercentage=18.6%`, `totalBarsAll=35`, `hasOverThreshold=false` — không lỗi,
  không bị ngắt giữa chừng.
- **Đã sửa `render.yaml`**: thêm `SOLVER_TIMEOUT_SECONDS: '1700'` (khớp giá trị local đã kiểm chứng
  chạy ổn) — **CHƯA deploy**, cần người dùng tự commit/deploy theo đúng quy ước phiên làm việc.

### 15.4 Ca "Không khả thi" tưởng thiếu tính năng nhưng thực ra là thiếu nhu cầu (2026-09-22)

Soát lại đúng kết quả `PI-2026-006` vừa tái hiện ở trên, người dùng thấy dòng `SAT-HOP-20X20` báo
"Không khả thi" (64.50% hao hụt, 6000mm × 1 cây) và hỏi *"sao cây này không đặt riêng như SAT vuông
15x15 ??"*.

Kiểm định mức trực tiếp: `SAT-HOP-20X20` chỉ được dùng bởi đúng 1 SKU (`GHE-J55`), đúng 1 mảnh "B"
dài 425mm × SL 5 = tổng nhu cầu chỉ **2125mm**. Trong khi `SAT-VUONG-15X15` được CẢ 2 SKU dùng chung
nên nhu cầu dồn đủ lớn để lấp đầy cây (solver còn tính thêm được `optimal_custom_length: 5640`).

Cả 2 loại sắt dùng CHUNG 1 bộ tham số (`stock_lengths="6000"`, `auto_scan=true`,
`min_length=5000/max_length=6000`, kiểm trực tiếp qua `requestParams` của proposal) — không có gì
khác nhau về cấu hình "đặt riêng" giữa 2 loại. Vấn đề thuần là **thiếu nhu cầu**: với tổng nhu cầu
chỉ 2125mm, dù chọn chiều dài nào trong khoảng cho phép (≥5000mm theo `SystemConfig.
solverMinLengthMm`) thì cũng luôn phải mua nguyên 1 cây mà chỉ dùng hết ~35%, hao hụt luôn ~60-65%
bất kể "đặt riêng" bao nhiêu mm — đúng như gợi ý chính solver đã nêu ("thử gộp đợt cắt với SKU khác
dùng chung loại sắt này"). Kết luận: không phải thiếu tính năng, cách sửa đúng là gộp thêm SKU khác
cũng dùng `SAT-HOP-20X20`.

### 15.5 Còn treo

- `SystemConfig.solverTimeLimitSeconds = 180` trên DB production **chưa đụng tới** (không có kết
  nối trực tiếp tới DB production từ phiên này) — vẫn cao hơn mặc định thiết kế (20s); nên cân nhắc
  hạ lại, hoặc chấp nhận giữ 180s vì 1700s mới đã đủ dư cho tới ~9 loại sắt (9×180=1620<1700) — quá
  số đó vẫn cần KHSX tự đặt "Thời gian chạy tối đa" thấp hơn cho riêng đợt đó.
  Chưa xác nhận Render (nơi build/host BE) có tự áp thêm 1 tầng giới hạn thời gian request nào khác
  ở tầng platform hay không - phiên này chỉ verify được đúng tầng axios client timeout (BE→solver)
  vì gọi này chạy nền, không phụ thuộc request FE→BE; rủi ro còn lại nếu SOLVER_BASE_URL production
  cũng trỏ tới 1 dịch vụ có giới hạn request riêng (vd Render free-tier) thì cần kiểm chứng thêm khi
  deploy thật.
- Phát hiện phụ trong lúc live-test: 1 tiến trình nền sót lại từ đầu phiên làm việc (dò BE sống lại
  sau lúc restart Docker) gọi lặp `/auth/login` mỗi 2 giây **không dừng** suốt nhiều giờ, tự nó đã đủ
  chiếm hết quota throttle (8 req/60s, `auth.controller.ts:24`) khiến MỌI lần đăng nhập từ máy này
  luôn dính `429` - không liên quan gì tính năng đang làm, chỉ là tiến trình quên tắt. Bài học: luôn
  dừng hẳn các vòng lặp polling nền ngay sau khi mục đích ban đầu (chờ server sống lại) đã xong.

## 16. Xử lý timeout thật ở tầng solver (`SOLVER_WORKERS`), hiển thị thời gian giải, và chặn ô nhập "Thời gian chạy tối đa" tại nguồn (2026-09-22 → 2026-09-23)

### 16.1 Bug hiển thị "0 mảnh" ở Danh sách SKU — lệch quyền sở hữu PlanForm/BomRevision

Sau khi seed thêm dữ liệu thật cho `GHE-J55` (script `prisma/seed-ghe-j55-full-bom.ts`, 5 mảnh, 33
dòng định mức, 7 loại sắt), người dùng báo màn "Danh sách SKU → Định mức mảnh" vẫn hiện "0 mảnh · 0
dòng vật tư" dù dữ liệu đã có trong DB — trong khi màn "Tối ưu cắt sắt" đọc đúng.

Root cause: `SkusService.reconstructQuotaBatch()` (màn Danh sách SKU) dựng bảng theo
`BomRevision.sourcePlanFormId` (bản ghi BomRevision mà MỘT PlanForm cụ thể "sở hữu" để sửa), không
phải theo "revision ACTIVE hiện tại của sản phẩm" như các màn khác. Script seed tạo BomRevision mới
nhưng không set `sourcePlanFormId` nên revision đó vô hình với đúng màn này. Sửa bằng SQL trực tiếp,
gán lại quyền sở hữu đúng revision mới nhất cho `PlanForm` tương ứng — live-verify qua UI thật
(`khsx` → Danh sách SKU → Ghế J55 → Định mức mảnh hiện đúng "5 mảnh · 33 dòng vật tư"`).

### 16.2 Nguyên nhân THẬT của timeout lặp lại trên máy dev — tranh chấp CPU, không phải bài toán khó

Test lại chính ca 7 loại sắt ở mục 15.3 nhiều lần vẫn timeout dù `SOLVER_TIMEOUT_SECONDS=1700` đã đủ
dư. Ban đầu nghi `SAT-HOP-10X20` (7 cỡ đoạn, có đoạn 20mm) "khó giải" — **giả thuyết này đã bị người
dùng bắt lỗi và tự rút lại** sau khi đọc kỹ raw JSON solver trả về: field `timeout_count`/
`timeout_lengths` cho thấy solver **hết giờ giữa chừng ở chính 6000mm** dù CPU container lúc đó lên
tới 800%+ — tức không phải bài toán bất khả thi, mà nhiều luồng CP-SAT (`SOLVER_WORKERS` mặc định 8,
`de_xuat_logic.py`) tranh CPU thật với các container Docker khác (postgres×3, redis, pgadmin) + BE/FE
dev server đang chạy cùng máy — đúng như comment sẵn có trong code đã cảnh báo nhưng chưa ai áp dụng
("trên máy chủ CPU dùng chung... đặt SOLVER_WORKERS=2").

Fix: thêm `SOLVER_WORKERS=4` vào `docker-compose.yml` (`D:\DNA-DEXUAT`) của service `web`, không hạ
hẳn 2 vì máy dev có 12 core thật (khác PaaS free-tier 1-2 vCPU). Verify bằng cách chạy lại ĐÚNG batch
7 loại sắt cũ: `total_solve_seconds` giảm từ **410.15s → 114.77s** (3.6 lần) — không sửa gì khác,
cùng dữ liệu, cùng tham số.

Cũng đổi `stop_on_first` (mặc định `false` → `true`) trong `baseRequestBody`
(`cutting-proposals.service.ts`) — trong `optimize_one_material()`, khi phải `auto_scan` (không cỡ
tiêu chuẩn nào thoả ngưỡng), nhận chiều dài ĐẦU TIÊN đạt thay vì quét hết để tìm chiều dài tốt nhất.
Góp phần vào tổng thời gian giảm ở trên, đổi lại có thể không còn là phương án tối ưu tuyệt đối (chấp
nhận được — vẫn thoả ngưỡng hao hụt).

### 16.3 Hiện thời gian giải + danh sách "đang tính" khi phiếu còn `CALCULATING`

Thêm `totalSolveSeconds` (CuttingProposal) và `solveSeconds` (CuttingProposalLine) — BE ghi lại từ
field `solve_seconds`/`total_solve_seconds` mới thêm ở `D:\DNA-DEXUAT\api\views.py` (đo bằng
`time.perf_counter()` quanh từng lần gọi `optimize_one_material()`). Migration
`20260922081046_add_solve_seconds_timing`, thuần ADD COLUMN nullable. FE (`CuttingProposalsPage.tsx`)
hiện tổng thời gian giải ở header modal chi tiết + cột "Thời gian" theo từng loại sắt; khi phiếu đang
`CALCULATING`, hiện thêm bảng "loại sắt còn đang tính" (`pendingMaterials`, BE dựng từ
`requestParams.bom` đã lưu SỚM — ngay trước khi gọi solver, không đợi solver trả lời — để có dữ liệu
hiện ngay cả khi đang chờ).

**Lưu ý sửa test**: thêm bước lưu `requestParams` sớm này đẩy `prisma.cuttingProposalLine.update`
lên thành lệnh update THỨ 2 (không còn là thứ 1) trong các test case solver trả về thành công — sửa
5 assertion `mock.calls[0]` → `mock.calls[1]` ở `cutting-proposals.service.spec.ts` (case chặn ở
guard vẫn đúng ở `[0]` vì throw trước khi lưu sớm chạy tới). 127/127 test BE qua.

### 16.4 Chặn tại Ô NHẬP "Thời gian chạy tối đa" thay vì để công nhân đọc lỗi kỹ thuật

Người dùng chỉ ra: câu lỗi guard ("vượt timeout HTTP client...") là lỗi kỹ thuật tiếng Anh lẫn số
liệu, công nhân/KHSX thực tế không tự hiểu để biết phải sửa gì — *"đưa ra dùng thật thì công nhân
sao họ biết để mà nhập?"*.

- **BE**: `CuttingBatchCandidateListDto` thêm `solverTimeoutSeconds` (=
  `SOLVER_TIMEOUT_SECONDS`) và `defaultTimeLimitSeconds` (= `SystemConfig.solverTimeLimitSeconds`),
  trả kèm trong `getBatchCandidates()` — để FE tự tính "tối đa bao nhiêu phút/loại" và chặn ngay tại
  ô nhập, không cần gọi `GET /system-config` (KHSX không có quyền `SYSTEM_CONFIG:VIEW`, endpoint đó
  luôn 403 âm thầm — đây là cách FE trước đó lấy gợi ý mặc định, đã bỏ).
- **FE** (`GomDotCatPage.tsx`): tính `maxTimeLimitMinutes = floor(solverTimeoutSeconds /
  selectedMaterialCount / 60 * 10) / 10`; nếu KHSX gõ số phút vượt trần này thì disable nút
  "Chốt nhóm"/"Xem trước" kèm câu tiếng Việt nêu đúng số loại sắt + trần thật.

### 16.5 Bug sót lại: để Ô TRỐNG (dùng mặc định) vẫn fail y hệt — đã sửa (2026-09-23)

Live-test sau khi làm xong 16.4 vẫn thấy các PI `NEEDS_ACTION` với đúng lỗi cũ dù KHSX để ô "Thời
gian chạy tối đa" **trống** (không gõ gì) — người dùng hỏi thẳng *"sao khi ô nhập thời gian bên KHSX
tôi để mặc định ... vẫn fail??"* kèm dữ liệu thật cho thấy nhiều PI fail với thông báo "7 loại sắt ×
time_limit 60s/loại = tối đa 420s, vượt timeout HTTP client (300s)" dù không ai gõ override.

Nguyên nhân: `timeLimitOverMax` ở 16.4 chỉ so sánh số KHSX **đã gõ** với trần — bỏ sót đúng trường
hợp để trống. Khi để trống, BE dùng `SystemConfig.solverTimeLimitSeconds` (mặc định công ty, lúc đó
= 60s/loại trên máy dev) làm `time_limit` thật; nếu chính con số mặc định này nhân với số loại sắt
đang chọn đã vượt `SOLVER_TIMEOUT_SECONDS` cục bộ (300s, `.env` dev chưa nâng lên 1700 như mục 15.3
đã áp cho lần test khác), guard vẫn chặn y hệt — nhưng FE coi "để trống" là an toàn nên không cảnh
báo, khiến KHSX bấm "Chốt nhóm" xong mới biết fail ở bước Sếp duyệt.

Sửa `GomDotCatPage.tsx`: tính `effectiveTimeLimitSeconds` = số KHSX đã gõ (nếu hợp lệ) **hoặc**
`defaultTimeLimitSeconds` khi để trống — rồi so `effectiveTimeLimitSeconds × selectedMaterialCount`
với `solverTimeoutSeconds` trong MỌI trường hợp, không chỉ khi có gõ. Thông báo lỗi tách 2 nhánh: gõ
quá tay → giữ nguyên câu cũ; để trống nhưng mặc định công ty đã vượt trần → câu mới nêu rõ
"Mặc định công ty (X phút/loại) × N loại sắt đang chọn đã vượt giới hạn - phải tự nhập tối đa Y
phút/loại" để KHSX biết chính xác phải làm gì tiếp theo.

### 16.6 Người dùng hỏi tiếp: hệ thống có tự đề xuất số được không, công nhân sao tự biết mà gõ?

Ngay sau 16.5, người dùng hỏi đúng câu hỏi còn lại: *"hệ thống(BE) có tự đề xuất thời gian được
không chứ công nhân sao biết giới hạn hay thời gian bao nhiêu mà nhập??"*. Đúng — BE đã trả sẵn cả 2
con số cần (`solverTimeoutSeconds`, `defaultTimeLimitSeconds`, xem 16.4), FE chỉ việc tự tính rồi
điền sẵn, không cần bắt KHSX tự nhẩm.

Thêm auto-suggest vào `GomDotCatPage.tsx`: state `timeLimitTouched` (mặc định `false`) theo dõi
KHSX đã tự gõ tay chưa. 1 effect điền sẵn `min(mặc định công ty, trần thật của tổ hợp đang chọn)`
mỗi khi đổi tổ hợp SKU (đổi `selectedMaterialCount` đổi luôn trần) — CHỈ khi `!timeLimitTouched`,
để không ghi đè số KHSX đã tự gõ. Gõ tay vào ô → `timeLimitTouched=true`, dừng tự điền từ đó. Bỏ
chọn hết SKU (đổi tổ hợp mới) → reset `timeLimitTouched=false` để lần đề xuất sau tính lại từ đầu.

### 16.7 Live-test qua UI thật — xác nhận cả auto-suggest lẫn nhánh chặn khi để trống (2026-09-23)

- Đăng nhập `khsx`, vào "Tối ưu cắt sắt", tick `GHE-J55` (đúng 7 loại sắt như ca lỗi gốc). Với
  `.env` local đang chạy đúng giá trị đã vá ở 15.3 (`SOLVER_TIMEOUT_SECONDS=1700`,
  `SystemConfig.solverTimeLimitSeconds=20` mặc định schema) — ô "Thời gian chạy tối đa" **tự điền
  sẵn "0.2" phút** (không còn để trống), hiện "(7x phút ≈ 1.4 phút tổng)", không cảnh báo gì — đúng
  vì 7×20s=140s còn xa mới chạm trần 1700s.
- Tái hiện ĐÚNG ca lỗi gốc: hạ tạm `.env` `SOLVER_TIMEOUT_SECONDS` 1700 → **100** (để 7×20s=140s >
  100s, buộc phải chạm trần), restart BE, tải lại trang, tick lại `GHE-J55` → ô tự điền **"0.2"**
  (đã tự hạ xuống dưới trần thật `floor(100/7/60*10)/10=0.2`, KHÔNG còn là mặc định 20s/loại nữa) —
  auto-suggest tự tránh luôn ca lỗi, không cần KHSX làm gì.
- Xoá tay ô về trống (mô phỏng đúng ca người dùng báo: `timeLimitTouched=true` sau khi gõ) → hiện
  ĐÚNG câu cảnh báo mới: *"Mặc định công ty (0.3 phút/loại) × 7 loại sắt đang chọn đã vượt giới hạn
  — phải tự nhập tối đa 0.2 phút/loại."*, viền ô đỏ, nút "Tạo lệnh sản xuất riêng cho SKU này"
  `disabled=true` (xác nhận qua DOM, không chỉ nhìn giao diện) — không còn cách nào bấm ra PI
  `FAILED`/`NEEDS_ACTION` từ đúng lỗi ban đầu người dùng báo.
- Trả `.env` về **1700** như cũ, restart lại BE — môi trường dev về đúng trạng thái trước khi test.

**Kiểm tra**: `npx tsc --noEmit` sạch cả 2 lần sửa (16.5 + 16.6). Live-test qua UI thật xác nhận đủ
3 nhánh: auto-suggest an toàn (ca thường), auto-suggest tự tránh trần (ca sát trần), và chặn đúng
khi KHSX xoá tay về trống mà mặc định đã vượt trần (ca người dùng báo lỗi).

### 16.8 Đảo ngược quyết định 16.6/16.7 — BỎ HẲN ô nhập, không phải giấu vào "nâng cao" (2026-09-23)

Ngay sau 16.7, khi đang chuyển ô "Thời gian chạy tối đa" vào khối "Cài đặt nâng cao" theo lựa chọn
đầu tiên của người dùng (qua `AskUserQuestion`), người dùng gửi thêm 1 câu chốt lại hướng đi:
*"bên KHSX không cần biết là tốn bao lâu thời gian, miễn là cho tôi kết quả tốt nhất"*. Đây là
thông tin mới quan trọng: KHSX không chỉ "không rành để tự tính" (đã xử lý ở 16.6) mà **hoàn toàn
không quan tâm** tới khái niệm thời gian giải — họ chỉ muốn kết quả tốt nhất, không cần biết trả
giá gì. Giấu ô vào "nâng cao" (16.7) vẫn còn 1 escape hatch cho người rành kỹ thuật chỉnh tay; theo
đúng ý người dùng, escape hatch đó cũng không cần thiết — bỏ hẳn.

**Nhận ra hướng đi đúng hơn hẳn**: 2 lần sửa trước (16.5, 16.6/16.7) đều lấy "mặc định công ty
(`SystemConfig.solverTimeLimitSeconds`, vài chục giây) làm ĐIỂM XUẤT PHÁT rồi validate/giấu nó đi.
Nhưng mặc định công ty đó vốn được thiết kế CHO TRƯỜNG HỢP CHẠY NHANH, không phải "ngân sách tốt
nhất có thể" — dùng nó làm baseline là bỏ phí phần lớn ngân sách thời gian mà `SOLVER_TIMEOUT_
SECONDS` (trần HTTP client, hiện 1700s) thật ra CÒN DƯ rất nhiều. Vì lệnh gọi solver chạy NỀN
(fire-and-forget ngay sau khi Sếp duyệt, xem `runSolverAndSave`) nên "tốn thêm thời gian giải"
KHÔNG làm KHSX phải chờ gì — chỉ ảnh hưởng lúc Sếp mở lại xem kết quả sau. Tức "cho CP-SAT thêm
thời gian dò" gần như MIỄN PHÍ theo đúng nghĩa người dùng quan tâm (trải nghiệm KHSX), không có lý
do gì để giữ ở mức mặc định thấp.

**Sửa `GomDotCatPage.tsx`** — bỏ HẲN, không còn field/state/UI nào cho khái niệm này:
- Xoá state `timeLimitMinutes`, `timeLimitTouched`, cả 2 `useEffect` auto-suggest/reset, toàn bộ
  block JSX (label + input + cảnh báo) vừa chuyển vào khối "nâng cao" ở 16.7.
- Trả nút "nâng cao" về đúng tên/nội dung gốc trước khi có tính năng này ("Chế độ cắt: ...") —
  khối đó giờ CHỈ còn nói về hao hụt/chiều dài, không dính gì thời gian nữa.
- Thay bằng 1 hằng số tính SẴN, LUÔN gửi kèm mọi lần gộp/cắt riêng, không đọc từ bất kỳ input nào:
  ```ts
  const autoTimeLimitSeconds =
    data && selectedMaterialCount > 0
      ? Math.max(1, Math.floor(data.solverTimeoutSeconds / selectedMaterialCount))
      : null
  ```
  Dùng **hết** phần ngân sách an toàn tối đa (không phải mặc định tối thiểu). An toàn tuyệt đối
  bằng toán học của phép chia nguyên: với `N = selectedMaterialCount`, `T = solverTimeoutSeconds`,
  `N × floor(T/N) ≤ T` LUÔN đúng với mọi N — không cần validate, không cần cảnh báo, không có
  trạng thái nào để hiển thị lỗi, vì về mặt toán học không thể vượt trần.

  > **⚠ ĐÍNH CHÍNH (2026-09-23, xem mục 17.4):** câu "an toàn tuyệt đối" ở trên **SAI**. Nó chỉ
  > đúng với phép kiểm của guard BE (guard giả định mỗi loại sắt tốn đúng 1×`time_limit`), KHÔNG
  > đúng với thời gian chạy thật: mỗi lần chấm 1 chiều dài, solver tốn tới `2×min(TL,30s)` liệt kê
  > pattern + 2 lần giải CP-SAT mỗi lần ≤ TL, tức ~4×TL, chưa kể vét cạn. Với TL=242s × 7 loại, ca
  > xấu nhất vượt xa 1700s → request bị HTTP client ngắt giữa chừng. Trước đây TL mặc định 20s nên
  > còn dư nhiều, ca này không lộ ra. **Chưa sửa** — xem đề xuất ở 17.4.
- `solverOverride()` giờ LUÔN gửi `solverTimeLimitSecondsOverride: autoTimeLimitSeconds` (khi có
  dữ liệu), không còn nhánh "undefined nếu chưa gõ" như trước — BE không bao giờ phải rơi về
  `SystemConfig.solverTimeLimitSeconds` (mặc định thấp) cho luồng gộp/cắt riêng qua màn này nữa.

**Live-test qua UI thật xác nhận**: đăng nhập `khsx`, tick `GHE-J55` (7 loại sắt), không thấy ô
thời gian nào ở bất cứ đâu (kể cả trong khối "Chế độ cắt" mở ra — `document.body.innerText.includes
('Thời gian chạy tối đa')` → `false`). Bấm "Tạo lệnh sản xuất riêng cho SKU này" → `201 Created`,
tạo `PI-2026-011` thật — đọc response xác nhận
**`solverTimeLimitSecondsOverride: 242`** (khớp đúng `floor(1700/7)=242`, tự động 100%, không ai
gõ gì). `npx tsc --noEmit` + `eslint` sạch (chỉ còn 1 warning `set-state-in-effect` đã có TỪ TRƯỚC
phiên này, không phải do thay đổi hôm nay).

### 16.9 Còn treo

- Câu hỏi người dùng đặt ra về việc gộp `SOLVER_TIMEOUT_SECONDS` (env, tầng HTTP client) với
  `SystemConfig.solverTimeLimitSeconds` (DB, ngân sách/loại sắt) thành 1 giá trị duy nhất — đã giải
  thích: không nên gộp vì khác đơn vị đo (1 cái là trần CỐ ĐỊNH cho cả request, 1 cái là ngân sách
  NHÂN THEO số loại sắt biến thiên từng đợt) và khác tần suất đổi (env cần redeploy, SystemConfig
  KHSX tự chỉnh). Sau 16.8, câu hỏi này phần lớn đã hết ý nghĩa cho luồng "Tối ưu cắt sắt": FE
  không còn đọc/gửi dựa trên `SystemConfig.solverTimeLimitSeconds` nữa (luôn tự tính
  `autoTimeLimitSeconds` từ `solverTimeoutSeconds` + số loại sắt đang chọn) — 2 con số env/DB vẫn
  tồn tại độc lập ở BE nhưng KHSX không còn chạm tới cái nào qua UI này nữa.
- `SystemConfig.solverTimeLimitSeconds` giờ chỉ còn là **giá trị dự phòng** khi có nơi khác gọi
  BE mà KHÔNG gửi `solverTimeLimitSecondsOverride` (vd gọi thẳng API, không qua màn "Tối ưu cắt
  sắt") — chưa rà xem còn luồng nào khác trong hệ thống phụ thuộc vào giá trị này hay không, ngoài
  phạm vi phiên này. Production đang ở 180s (xem mục 15.5), local dev ở mặc định schema 20s.

## 17. Nghiên cứu: "Tối ưu cắt sắt" báo 6000mm đạt, solve thật lại dò cây riêng (2026-09-23) — CHƯA SỬA CODE

### 17.1 Hiện tượng

TEST3/TEST5 (`GHE-J55`, 30 bộ, 7 loại sắt): màn "Tối ưu cắt sắt" hiện cả 7 chip xanh ở cây 6m
("Không SKU nào vượt ngưỡng"), nhưng solve thật ra 3 loại **đặt riêng**: SAT-VUONG-20X20 → 5000mm,
SAT-VUONG-12X12 → 5100mm, SAT-PHI-6 → 5520mm. Người dùng yêu cầu: 6000mm đạt thì phải cắt 6000mm,
chỉ dò cây riêng khi 6000mm thật sự vượt 1%.

Đã loại trừ: KHÔNG phải do cấu hình (`requestParams` thật của TEST3: `stock_lengths="6000"`,
`max_waste_percentage=1`, `auto_scan=true` chỉ là cờ CHO PHÉP dò — solver luôn chấm 6000mm trước).
Đã thử và BỎ hướng "sửa công thức ước tính ở BE" (`best-fill.util.ts`): công thức
`minBars×cây − tổng cần` bị chính SAT-PHI-4 phản bác (tính ra ≥1,8% nhưng solver thật 0,22%) vì
không tính phần "mẫu nguyên" (`_giu_lai_mau_nguyen`).

### 17.2 Nguyên nhân gốc — ngưỡng % bị áp cho TỪNG CÂY, không phải cho CẢ ĐỢT

`generate_patterns()` (`de_xuat_logic.py:247`) chỉ sinh kiểu cắt có hao hụt **từng cây** ≤ ngưỡng
(`total_used >= stock×(1−ratio)`), rồi `optimize_material()` phải phủ ĐÚNG nhu cầu (dư ≤
`max_surplus`=10 đoạn/cỡ) chỉ bằng các kiểu đó. Trong khi mọi chỗ khác của hệ thống hiểu ngưỡng
là **cả đợt**: cột "Hao hụt %" hiển thị, cờ `over_waste` của chính solver (`:650`,
`waste_pct > threshold`), `_best_achievable()` — và cách người dùng nói ("6000mm cho ra hao hụt
lớn hơn 1%"). Bộ lọc từng-cây gây "không khả thi giả" theo 2 cơ chế, kiểm bằng tay trên BOM thật:

- **Lệch tỷ lệ kiểu cắt** (SAT-VUONG-20X20: 90×405 + 90×460): ở 1%/cây chỉ đúng **1** kiểu cắt tồn
  tại (9×405 + 5×460, thừa 0,68% — chính là con số chip xanh). Tỷ lệ 9:5 không khớp nhu cầu 1:1 →
  cắt đủ 460 thì dư 72 đoạn 405 > 10 → vô nghiệm. Kiểu (1×405 + 12×460) thừa **1,03%** bị loại chỉ
  vì hơn ngưỡng 0,03%. SAT-VUONG-12X12 y hệt (chỉ còn kiểu 6×405 + 8×441).
- **Cây cuối bắt buộc cắt dở** (SAT-PHI-6: 180×30 + 360×60 = 27.540mm = 4,6 cây): bộ lọc bắt MỌI
  cây phải đầy ≥99% nên 5 cây phải ăn ≥29.700mm, dư tối đa chỉ 920mm → vô nghiệm. Thực tế cây thứ 5
  cắt dở, phần còn lại là mẫu nguyên nhập kho — đúng thứ `_giu_lai_mau_nguyen` sinh ra để xử lý,
  nhưng bước đó chỉ chạy SAU khi đã có nghiệm nên không cứu được. Ở 5520mm, 5 cây vừa khít ≥99% nên
  vét cạn tìm ra.

### 17.3 Thực nghiệm trong container `catsat_web` (BOM thật TEST3, không sửa repo)

Script nháp ở scratchpad (`exp_6000.py`, `exp_stage2.py`), chạy trực tiếp các hàm của
`D:\DNA-DEXUAT\cat_sat\de_xuat_logic.py`. Tất cả ở **6000mm**:

| Loại sắt | Hiện tại (lọc 1%/cây) | Đề xuất "tầng 2" | Kết quả vét cạn thật (TEST3) |
|---|---|---|---|
| SAT-VUONG-20X20 | không khả thi | **14 cây, 0,721%** | 5000mm × 17 cây, 0,57% |
| SAT-VUONG-12X12 | không khả thi | **13 cây, 0,628%** | 5100mm × 15 cây, 0,23% |
| SAT-PHI-6 | không khả thi | **5 cây, 0,167%**, mẫu nguyên 1490mm | 5520mm × 5 cây, 0,22% |
| SAT-PHI-4 / TRON-FI21 / VUONG-10X10 | đạt ngay | (không chạy tầng 2) | 6000mm |

"Tầng 2" (prototype): chỉ chạy khi tầng 1 VÔ NGHIỆM THẬT (không phải hết giờ), vẫn ở đúng chiều dài
đó: (a) nới bộ lọc từng cây lên 2%, (b) cho phép **đúng 1 cây cắt dở** (phần còn lại = mẫu nguyên,
chỉ tính tề đầu vào phế — đúng quy ước của `_giu_lai_mau_nguyen`), (c) áp ngưỡng 1% cho **TỔNG phế
của cả đợt**. Cả 3 loại đạt ≤1% ở 6000mm → không cần đặt cây riêng nữa. Thời gian: 0,02s / 0,02s /
6,7s (nhanh hơn vét cạn 101 chiều dài đang chạy). Lưu ý ca nặng: SAT-HOP-10X20 (7 cỡ) tầng 2 mất
~40s với 5.125 kiểu cắt — nhưng loại này bình thường đạt ngay ở tầng 1 (trong lần chạy thử nó ra
"không đạt" ở tầng 1 do HẾT GIỜ, không phải vô nghiệm — bản thật phải phân biệt 2 ca này).

Hệ quả phụ tốt: sau khi solver đổi sang ngưỡng theo đợt, chip xanh ở BE (cận dưới hao hụt từng
cây tốt nhất) trở thành chỉ báo KHỚP HƯỚNG với solver — không cần sửa `best-fill.util.ts`.

### 17.4 Phát hiện kèm: ngân sách thời gian tự động ở 16.8 có thể làm vỡ request

Guard BE tính mỗi loại sắt tốn 1×`time_limit`, nhưng mỗi lần chấm 1 chiều dài solver tốn tới
`2×min(TL, ENUM_TIME_LIMIT=30s)` + 2 lần giải ≤ TL. 16.8 gửi TL = floor(1700/N) (7 loại → 242s)
nên ca xấu nhất ~7×(60+484)s ≫ 1700s. Hướng sửa đúng gốc: BE gửi 1 **hạn chót cho cả request**,
solver trong vòng lặp `views.py` tự chia thời gian còn lại cho số loại sắt còn lại (và tầng 2/vét
cạn cũng dừng theo hạn chót đó) — thay vì FE/BE đoán hệ số nhân từ bên ngoài.

### 17.5 Còn treo — cần người dùng quyết

- Đổi nghĩa ngưỡng hao hụt từ "từng cây" sang "cả đợt" là quyết định nghiệp vụ (bộ lọc từng cây
  được chép từ MC Laser một cách có chủ đích — comment `de_xuat_logic.py:567`). Chưa sửa code.
  Sau mục 18 (bỏ mẫu nguyên), phần "cho phép 1 cây cắt dở" của tầng 2 ở 17.3 KHÔNG còn áp dụng —
  đề xuất còn lại chỉ là ngưỡng theo cả đợt, cứu được SAT-VUONG-20X20/12X12 nhưng KHÔNG cứu được
  SAT-PHI-6 (không có cây cắt dở thì ở 6000mm hao hụt cả đợt khoảng 5%).
- Sửa ngân sách thời gian (17.4). Chưa sửa code. Bằng chứng thêm từ live-test mục 18:
  SAT-HOP-10X20 chạy **301,8s** trong khi TL gửi đi là 242s (vượt 25% chỉ riêng 1 loại).

## 18. Bỏ cơ chế "mẫu nguyên" khỏi solver (2026-09-23)

### 18.1 Yêu cầu và quyết định

Người dùng: *"vì bây giờ đã có mode chấp nhận hao hụt cao hơn rồi thì tôi nghĩ mẫu nguyên đó không
còn cần"*. Tôi đã nêu hệ quả trước khi làm (loại sắt ít đoạn như phi 6 sẽ hay báo vượt ngưỡng; chế
độ đặc cách nới ngưỡng cho CẢ đợt chứ không riêng 1 loại; mẫu nguyên thật ra là sắt dùng lại được) —
người dùng chốt *"hãy bỏ mẫu nguyên đi"*.

Lưu ý phân biệt: đây là mẫu nguyên **của solver** (lúc tính phương án). "Mẩu nguyên" ở báo cáo đợt
cắt của Phôi (`cut_bundles.mauNguyenMm`, bỏ ô nhập từ 2026-09-05) là chuyện khác, KHÔNG đụng.

### 18.2 Đã sửa

- **Solver `D:\DNA-DEXUAT`** (cây source thật container `catsat_web` mount):
  - `cat_sat/de_xuat_logic.py`: xoá hẳn `_giu_lai_mau_nguyen()`, bỏ lời gọi trong
    `optimize_material()` (cùng dòng trừ `bu_tru_s` khỏi phế), bỏ field `mau_nguyen_mm` ở kết quả
    `optimize_material()` và `optimize_one_material()`. Cây cuối giờ cắt nốt như mọi cây, phần đoạn
    dư (≤ `max_surplus`) giữ nguyên là đoạn dư đã cắt.
  - `api/views.py`: bỏ `mau_nguyen_mm` ở `purchase_plan[]` và `cutting_patterns[]`.
  - `cat_sat/templates/cat_sat/de_xuat_index.html` (giao diện riêng của solver): bỏ tổng "Mẩu nguyên
    nhập kho", bỏ ô "Mẩu nguyên chưa cắt" và hàng tô xanh "cây này cắt dở".
  - `api/tests.py` bỏ field trong fixture; `README.md` bỏ mục mô tả cơ chế.
- **BE**: `cutting-proposals.service.ts` bỏ `mau_nguyen_mm` khỏi kiểu `SolverProposeResponse` và
  không ghi `mauNguyenMm` khi lưu dòng/pattern nữa (cột DB để mặc định 0). Spec đổi từ "ghi 1351"
  sang "không có key `mauNguyenMm`". Sửa doc comment `best-fill.util.ts`, `schema.prisma` (chỉ
  comment, không cần migration).
- **FE**: `CuttingProposalsPage.tsx` và `utils/cuttingGuide.ts` (bản in/Excel) trước đây LUÔN in
  "Mẫu nguyên chưa cắt: 0mm" — giờ chỉ in khi > 0.

**CẬP NHẬT NGAY SAU ĐÓ**: người dùng thấy vẫn còn hàng "cắt dở" ở TEST3 (chụp màn hình), hỏi thẳng
*"mẫu nguyên thấy bạn còn để đây mà xóa đâu?"* — đúng, phần trên chỉ mới chặn solver SINH mẫu nguyên
MỚI, còn cố ý giữ hiển thị cho 7 phương án CŨ đã có mẫu nguyên (lý do: sợ hướng dẫn cắt cho Phôi mất
giải thích). Người dùng không đồng ý giữ nửa vời — gỡ luôn phần hiển thị, kể cả với dữ liệu cũ:
- `CuttingProposalsPage.tsx`: bỏ dòng "Mẫu nguyên chưa cắt", bỏ tô vàng + ghi chú "cây này cắt dở"
  trong khối xem chi tiết (không đọc `mauNguyenMm` nữa).
- `HuongDanCatPage.tsx` (màn Phôi xem/in hướng dẫn cắt): bỏ y hệt, bỏ luôn cột "Ghi chú" (chỉ tồn
  tại để chứa ghi chú cắt dở, bỏ nội dung thì cột trống vô nghĩa).
- `utils/cuttingGuide.ts` (Excel + bản in HTML dùng chung 2 nơi trên): bỏ cột "Ghi chú"/tô màu ở cả
  2 hàm dựng bảng, bỏ dòng "Mẫu nguyên chưa cắt" ở phần tóm tắt đầu trang.
- `services/cutting-proposals-api.ts`, `cuttingGuide.test.ts`: bỏ field `mauNguyenMm` khỏi kiểu
  `CuttingProposalLine`/`CuttingProposalPattern` và fixture test.
- BE (`cutting-proposal-response.dto.ts`, `cutting-proposals.service.ts`): bỏ nốt `mauNguyenMm`
  khỏi response DTO (trước đó vẫn trả ra dù solver không còn gửi nữa).

Cột DB (`cutting_proposal_lines.mauNguyenMm`, `cutting_proposal_patterns.mauNguyenMm`) **vẫn giữ
nguyên** — không migration nào chạy, dữ liệu 7 phương án cũ vẫn còn trong DB, chỉ là không nơi nào
đọc/hiển thị nữa. Đây là lựa chọn tối thiểu-rủi-ro (schema change + migration cho một việc thuần
hiển thị là quá tay); xoá cột hẳn có thể làm sau, riêng, nếu cần.

### 18.3 Kiểm tra

- Solver: `python manage.py test api cat_sat` 13/13 qua; log container xác nhận StatReloader đã nạp
  lại `views.py` + `de_xuat_logic.py`.
- BE: `tsc --noEmit` sạch, `jest src/modules/cutting-proposals` 127/127 qua. FE: `tsc` sạch,
  `cuttingGuide.test.ts` 8/8, eslint không lỗi mới.
- **Live-test luồng thật** (`PI-2026-011`, TEST4, GHE-J55 × 30 — cùng SKU, cùng số lượng TEST3):
  `khsx` Gửi QLSX → `qlsx` chọn "Kho thành phẩm (demo)" + Gửi sếp duyệt → `boss` Duyệt → solver chạy
  nền, phương án **#17 tự duyệt** sau ~255s. Đối chiếu với TEST3 (#16, code cũ):

  | Loại sắt | #16 cũ: cây, %, mẫu nguyên | #17 mới: cây, %, mẫu nguyên |
  |---|---|---|
  | SAT-HOP-10X20 | 61, 0,167%, 3330mm | 61, 0,167%, **0** |
  | SAT-PHI-4 | 15, 0,217%, 1425mm | 15, 0,218%, **0** |
  | SAT-TRON-FI21 | 52, 0,214%, 1103mm | 52, 0,214%, **0** |
  | SAT-VUONG-10X10 | 44, 0,281%, 1539mm | 44, 0,283%, **0** |
  | SAT-VUONG-20X20 | 5000mm, 17, 0,573%, 4178mm | 5000mm, 17, 0,582%, **0** |
  | SAT-VUONG-12X12 | 5100mm, 15, 0,235%, 0 | 5100mm, 15, 0,235%, 0 |
  | SAT-PHI-6 | 5520mm, 5, 0,217%, 0 | 5520mm, 5, 0,217%, 0 |

  `rawResponse` của #17 không còn chuỗi `mau_nguyen` (#16 còn). UI admin "Chi tiết đề xuất cắt
  sắt": #17 chỉ còn "Tổng khúc thừa (phế liệu): 495mm", không có dòng mẫu nguyên / hàng "cắt dở";
  #16 lúc đó (TRƯỚC bản sửa 18.4 dưới đây) vẫn hiện "Mẫu nguyên chưa cắt: 4178mm" + hàng vàng.
- Đúng như đã báo trước khi làm: **bỏ mẫu nguyên KHÔNG đưa 3 loại đặt riêng về 6000mm** (vẫn
  5000/5100/5520) — nguyên nhân chính là ngưỡng theo từng cây (mục 17.2), vẫn chờ quyết định.

### 18.4 Gỡ nốt phần hiển thị cho dữ liệu CŨ (2026-09-24)

Xem "CẬP NHẬT NGAY SAU ĐÓ" ở mục 18.2 — người dùng chỉ ra 18.2/18.3 mới chặn solver SINH mẫu nguyên
mới, còn 7 phương án CŨ (như #16/TEST3) vẫn hiện nguyên nếu chưa sửa FE/BE đọc field đó. Đã gỡ toàn
bộ nơi đọc/hiển thị `mauNguyenMm` (chi tiết đổi ở mục 18.2 bản cập nhật) — cột DB vẫn giữ, chỉ ngừng
đọc.

**Kiểm tra**: `tsc --noEmit` sạch cả 2 repo (BE + FE), `jest src/modules/cutting-proposals` 127/127,
`vitest cuttingGuide.test.ts` 8/8, eslint không phát sinh lỗi mới. Docker/Postgres/dev server đã tắt
qua đêm — khởi động lại toàn bộ (Docker Desktop, BE, FE) trước khi test.

**Live-test qua UI thật, đúng dòng #16/TEST3 (dữ liệu CŨ, tính từ TRƯỚC khi có bản sửa này)**: đăng
nhập `admin` → Module nghiệp vụ → Cắt sắt → mở chi tiết TEST3 → mở dòng SAT-VUONG-20X20 (dòng trước
đó chụp màn hình cho thấy còn "Mẫu nguyên chưa cắt: 4178mm" + hàng vàng "cây này cắt dở — còn
4178mm để nguyên"). Sau khi sửa: dòng này giờ chỉ còn **"Tổng khúc thừa (phế liệu): 487mm"**, 3
hàng "Thanh 5000mm × 9/7/1 cây" không còn tô vàng, không còn ghi chú cắt dở nào — xác nhận dữ liệu
CŨ trong DB vẫn còn `mauNguyenMm > 0` nhưng UI đã ngừng đọc/hiện hoàn toàn, đúng yêu cầu.

## 19. Gọi THẲNG solver để xác minh "hao hụt khi cắt riêng" trên Tối ưu cắt sắt (2026-09-24)

### 19.1 Yêu cầu

Người dùng quay lại đúng gốc vấn đề (mục 17, chưa sửa lúc đó): *"chỗ Loại sắt · hao hụt khi cắt
riêng này phải theo loại cắt chuẩn nếu báo xanh hết thì làm thế nào để nó buộc phải tính theo
6000mm chứ không tự auto-scan, hãy cùng tìm cách giải quyết kỹ càng để không xảy ra vấn đề về sau,
hãy review 3 source FE, BE, Solver để tìm cách"*, kèm *"đồng thời live-test để đối chiếu với data
debug luôn"*.

Trước đó (đầu mục 17) người dùng đã bác đề xuất "nới ngưỡng từng cây" (*"mỗi loại sắt chỉ được cho
tối đa bé hơn 1% hao hụt thôi nên việc bạn kêu nới ra là không khả thi"*) và không trả lời câu hỏi
"tắt hẳn auto_scan" (`AskUserQuestion` bị dismiss) — nên hướng "ép cứng" (đổi ngưỡng, hoặc tắt
auto_scan) đều không dùng được. Cần một cách khác không đụng tới 2 trục đó.

### 19.2 Kiểm chứng lại 1 giả thuyết TRƯỚC khi code (đúng tinh thần đã lặp lại nhiều lần trong phiên)

Trước khi bắt tay sửa, tự hỏi: liệu SAT-VUONG-20X20 (90×405 + 90×460) có BỎ SÓT 1 kiểu cắt ≤1%/cây
nào không (nếu có thì "vô nghiệm" ở mục 17 là solver chưa tìm hết, không phải thật sự bất khả thi)?
Tính tay ra kiểu (1×405 + 12×460) tưởng đạt 0,867% - **kiểm lại bằng `_scale()` thật trong container
mới phát hiện tính tay sai, số đúng là 1,033%** (vượt 1% đúng 0,033%). Chạy `generate_patterns()`
thật xác nhận đúng CHỈ 1 kiểu cắt ≤1%/cây tồn tại cho cặp cỡ này - kết luận mục 17 (vô nghiệm thật
ở 6000mm/1%-mỗi-cây) đứng vững, không phải solver bỏ sót.

### 19.3 Hướng đi: gọi solver THẬT thay vì sửa công thức ước tính

`best-fill.util.ts` (chip "hao hụt khi cắt riêng") là cận dưới LÝ TƯỞNG - giả định nguồn đoạn vô
hạn, bỏ qua số lượng chính xác (đã kết luận ở mục 17, và trước đó đã thử "sửa công thức" ở phiên
17/18 và thất bại vì không mô phỏng được cơ chế mẫu nguyên/pattern thật của solver). Không có công
thức rút gọn nào vừa nhanh vừa đúng - hướng ĐÚNG là gọi CHÍNH solver, nhưng chỉ khi rẻ:

- Endpoint `/de_xuat/propose/` đã nhận `bom` là mảng bất kỳ (không bắt buộc đủ mọi loại sắt) và
  `auto_scan` điều khiển được (`false` = chỉ chấm đúng chiều dài gửi lên, không tự dò) - **không
  cần thêm route mới bên solver**, gọi lại chính endpoint đó với 1 bom TỐI GIẢN chỉ đúng 1 loại sắt
  của 1 SKU (mỗi cỡ đoạn 1 dòng, `qty_per_part` = đúng số lượng cần, `qty_per_set=1, num_sets=1`).
- Khi `auto_scan=false` và cây chuẩn không đạt ngưỡng, solver tự rơi vào `_no_solution()` →
  `_best_achievable()` (nới lỏng HẲN bộ lọc, ratio=1.0) để trả `best_achievable: {length, waste_pct,
  bars}` - CHÍNH XÁC con số cần: "tốt nhất có thể ở cây chuẩn", dù đạt hay không đạt ngưỡng.
- Chi phí: số cỡ đoạn KHÁC NHAU ít (2-4, đa số vật tư thật) thì rẻ (đo thật <0,1s/lần ở mục 17.3).
  Nhiều cỡ (SAT-HOP-10X20, 7 cỡ) thì đắt (tới 300s, mục 18.3) - **bỏ qua có chủ đích** các loại này
  (rơi về ước tính cũ), không cố xác minh bằng mọi giá.

### 19.4 Đã sửa

- **BE** (`cutting-proposals.service.ts`): thêm `verifyExactStandaloneWasteBatch()` +
  `verifyExactStandaloneWaste()`. Trong `getBatchCandidates()`, sau khi dựng xong ước tính cũ như
  trước, chạy thêm 1 lượt xác minh cho các dòng đủ điều kiện (≤5 cỡ đoạn khác nhau -
  `EXACT_CHECK_MAX_SIZES`), GHI ĐÈ trực tiếp lên object `CandidateMaterialDto` đã dựng rồi sort lại
  (standaloneWastePct có thể đổi thứ tự). 3 lưới an toàn ĐỘC LẬP với nhau (không cái nào phụ thuộc
  cái kia, phòng cả demand lớn dù ít cỡ vẫn chậm bất ngờ - xem 19.5 ca SAT-PHI-6):
  - `EXACT_CHECK_TIMEOUT_MS=8000` - timeout HTTP MỖI lần gọi, lỗi/timeout → `null` → giữ ước tính cũ.
  - `EXACT_CHECK_CONCURRENCY=6` - tối đa 6 lần gọi song song, tránh dội hàng chục request vào solver
    khi bảng nhiều SKU.
  - `EXACT_CHECK_BATCH_BUDGET_MS=12000` - ngân sách CHUNG cho cả lượt xác minh; hết giờ thì các dòng
    CHƯA kịp gọi bị bỏ qua (không huỷ dòng đang chạy dở) - trang không bao giờ treo dù dữ liệu tăng
    đột biến.
  - `feasible=true` KHÔNG tự suy ra đạt ngưỡng - đọc đúng field `over_threshold` riêng (pattern
    generation chỉ lọc hao hụt TỪNG CÂY, tổng cả loại vẫn có thể vượt - xem doc comment
    `SolverProposeResponse`, bug suýt mắc phải lúc viết).
  - Sửa 1 lỗi thật bắt được qua test: `res.purchase_plan` thiếu optional-chaining trên `res` (chỉ
    có trên `.purchase_plan`) - request lỗi/mock trả `undefined` làm cả hàm throw thay vì rơi về
    `null` như thiết kế.
- **DTO** (`cutting-batch-candidate.dto.ts`, `services/cutting-batch-api.ts` bên FE): thêm field
  `verified: boolean` vào `CandidateMaterialDto`/`CandidateMaterial`. Cập nhật doc comment
  `standaloneWastePct`/`standaloneMinBars`/`stockLengthMm` giải thích ý nghĩa đổi khi verified=true.
- **FE** (`GomDotCatPage.tsx::MaterialChip`): `verified=true` → bỏ dấu "≥" (không còn là ước tính),
  thêm icon `Check`, tooltip đổi thành "số THẬT vừa xác minh với solver". Dấu "?" (mẫu quá nhỏ,
  cận dưới không đáng tin) chỉ còn ý nghĩa khi `verified=false` - số thật thì đáng tin bất kể số cây
  nhiều hay ít.
- **Phạm vi CỐ Ý giới hạn**: chỉ áp cho "hao hụt khi cắt riêng" (1 SKU × 1 loại sắt). Chip "nếu gộp
  N SKU" (`getBatchSuggestions`/`buildBatchLevel`) VẪN dùng ước tính cũ - cùng vấn đề, nhưng để
  riêng cho lần sau (mở rộng theo đúng pattern này khi cần), tránh làm 1 lần sửa quá lớn khó review.

### 19.5 Kiểm tra

- `tsc --noEmit` sạch cả 2 repo. `jest src/modules/cutting-proposals` **131/131** qua (127 cũ +
  4 test mới: feasible=true dùng số thật + gọi đúng endpoint/tham số, feasible=false có
  best_achievable vẫn là số thật, >5 cỡ đoạn KHÔNG gọi solver, lỗi/timeout rơi về ước tính cũ
  không throw). eslint không phát sinh lỗi mới.
- **Live-test qua UI thật, đối chiếu với debug (mục 17.3) và dữ liệu thật (TEST3, mục 18.3)** -
  đăng nhập `khsx`, "Tối ưu cắt sắt", đọc thẳng response `/cutting-batch-candidates` cho TEST5/TEST6
  (GHE-J55 × 30, ĐÚNG demand như TEST3):

  | Loại sắt | Ước tính cũ | Xác minh mới (verified) | Khớp debug 17.3 (ratio=1.0)? | Kết quả thật TEST3 |
  |---|---|---|---|---|
  | SAT-VUONG-12X12 | ≥0,47% xanh | **1,021% ĐỎ** verified=true | ✓ khớp 0,997% | auto-scan 5100mm |
  | SAT-VUONG-20X20 | ≥0,68% xanh | **0,783% ĐỎ** verified=true | ✓ khớp 0,721% | auto-scan 5000mm |
  | SAT-VUONG-10X10 | ≥0,27% xanh | 0,283% xanh verified=true | - | 6000mm (đúng) |
  | SAT-PHI-4 | ≥0,17% xanh | 0,218% xanh verified=true | - | 6000mm (đúng) |
  | SAT-TRON-FI21 | ≥0,18% xanh | 0,214% xanh verified=true | - | 6000mm (đúng) |
  | SAT-HOP-10X20 | ≥0,17% xanh | KHÔNG xác minh (7 cỡ, bỏ qua có chủ đích) | - | 6000mm (đúng) |
  | SAT-PHI-6 | ≥0,17% xanh | **KHÔNG xác minh (timeout 8s)** | - | auto-scan 5520mm |

  2/3 loại từng "xanh giả" (12X12, 20X20) giờ đúng ngay tại bảng chọn, trước khi KHSX kịp gộp -
  không còn bất ngờ ở bước Sếp duyệt cho 2 loại này. Số verified khớp rất sát bản debug thủ công ở
  mục 17.3 (lệch <0,05 điểm %, hợp lý vì cách tính `_best_achievable` không hoàn toàn giống cách
  chạy thử tay).

### 19.6 Còn treo - giới hạn THẬT của cách làm này, phải nói rõ không giấu

- **SAT-PHI-6 KHÔNG được cứu** - đây là phát hiện QUAN TRỌNG lúc live-test, không phải giả thuyết:
  request thật timeout đúng 8s cho loại này (`verified=false`, vẫn hiện ước tính cũ ≥0,17% xanh),
  dù chỉ có 2 cỡ đoạn (dưới ngưỡng `EXACT_CHECK_MAX_SIZES=5`). Nguyên nhân: khi cây chuẩn vô nghiệm,
  `_best_achievable()` nới lỏng ratio=1.0 khiến pattern nổ tổ hợp bất kể ÍT cỡ đoạn - đúng lý do
  `EXACT_CHECK_TIMEOUT_MS` phải là lưới an toàn ĐỘC LẬP với số cỡ đoạn (đã ghi ở 19.4), và đúng lý
  do đã đo ở container: ratio=1.0 cho ca này mất tới 41,36s (mục 17.3's `exp_6000.py`). Tức
  **KHÔNG có cách xác minh nào vừa nhanh vừa đúng cho MỌI trường hợp** - kể cả ý tưởng "gọi solver
  thật" ở mục này cũng có ca lọt lưới, chỉ là ít hơn hẳn cách cũ (ước tính sai cả 3 loại → giờ chỉ
  còn 1 loại không xác minh được, và ít nhất KHÔNG hiện số sai - chỉ hiện số CŨ kèm verified=false).
- Trang "Tối ưu cắt sắt" giờ tải **~8-10 giây** khi có nhiều dòng cần xác minh (đo thật lúc live-test
  ở trên, 2 SKU × 6 loại sắt/SKU = 12 lượt gọi, concurrency=6) - chấp nhận được cho 1 trang xem
  trước không phải thao tác lặp lại liên tục, nhưng CHƯA thử với bảng nhiều SKU hơn (vd 10-20 SKU
  đang chờ cùng lúc) - `EXACT_CHECK_BATCH_BUDGET_MS=12000` sẽ chặn không cho vượt quá ~12s+1 lượt
  đang chạy dở, nhưng chưa live-test đúng kịch bản đó.
- FE chưa hiện gì đặc biệt cho dòng "không xác minh được vì timeout" (SAT-PHI-6) khác với dòng
  "không xác minh vì quá nhiều cỡ đoạn" (SAT-HOP-10X20) - cả 2 đều verified=false, hiện y hệt ước
  tính cũ. Có thể cân nhắc thêm sau nếu KHSX vẫn bị bất ngờ vì loại như SAT-PHI-6.
- Phạm vi 19.4 đã nêu: "nếu gộp N SKU" (getBatchSuggestions/buildBatchLevel) chưa được xác minh
  theo cách này, vẫn dùng ước tính cũ y hệt trước.

### 19.7 Bug thật bắt được qua live-test — `overThreshold` tự mâu thuẫn với số hiển thị (2026-09-24)

Sau khi báo hoàn tất 19.1-19.6, người dùng live-test và hỏi thẳng: *"kết quả 1,02% và 0,78% là
sao"*, rồi *"hao hụt 0,78% <1% mà?"* — đúng chỗ sai: nhánh `best_achievable` ở 19.4 **hardcode
`overThreshold: true`** bất kể con số thật, với lý do "đạt/không đạt ngưỡng đây không suy được từ
% mà từ việc có cắt được với luật mỗi-cây hay không". Lý do đúng, nhưng hệ quả sai: SAT-VUONG-20X20
ra 0,78% (< ngưỡng 1%) mà chip vẫn tô đỏ — tự mâu thuẫn ngay trên màn hình, đúng loại lỗi cả phiên
này đang cố dẹp (số liệu và màu sắc nói hai điều khác nhau).

Sửa: `overThreshold` giờ LUÔN so thẳng `wastePct > thresholdPct` (đúng nghĩa mặt chữ, không còn
hardcode), ở CẢ 2 nhánh `fixed`/`scan`. Field `verifiedLengthSource: 'fixed'|'scan'|null` (đã thêm
sẵn ở 19.4 đúng lúc cần) giữ lại làm GHI CHÚ ĐỘC LẬP, không quyết định màu nữa: `'scan'` nghĩa là
"hệ thống hiện tại (đang áp luật mỗi cây ≤ ngưỡng khi solve thật) sẽ KHÔNG tự chọn cây chuẩn theo
đúng mức hao hụt này, dù số có đạt ngưỡng" - kể cả khi màu xanh.

Test cũ `cutting-batch-suggestions.service.spec.ts` (khoá `overThreshold=true` bất kể %) đã SỬA
LẠI thành khoá đúng hành vi mới (`overThreshold=false` khi 0,78<1, `verifiedLengthSource='scan'`
vẫn giữ) - nếu không sửa, test sẽ ôm luôn lỗi cũ và không cảnh báo được lần sau.

### 19.8 Người dùng chốt hướng hiển thị cuối: hiện số thật, không giấu, để tự quyết định

Ngay sau khi hiểu rõ 19.7, người dùng chốt: *"tôi muốn nó hiển thị là nếu cắt với cây 6m thì hao
hụt nó lớn hơn 1% với các điều kiện của 1 cây đã được áp để người dùng có thể xem và đưa ra quyết
định"* — tức: đừng giấu con số hay tự quyết thay (bản 19.6 đã thử giấu % sau chữ "cần đặt riêng" -
đây LÀ hướng SAI, ngược đúng yêu cầu này), mà đưa con số THẬT ra để KHSX tự cân nhắc.

**Đã sửa FE** (`GomDotCatPage.tsx::MaterialChip`): bỏ hẳn nhánh "cần đặt riêng, không hiện %" ở
19.6 - giờ LUÔN hiện % thật (kèm dấu ✓ khi verified), màu đỏ/xanh đi theo ĐÚNG so sánh
`overThreshold` (đã sửa ở 19.7). Khi `verifiedLengthSource==='scan'`, thêm 1 icon `RefreshCw` nhỏ
cạnh % (không đổi màu, không đổi chữ) + tooltip riêng giải thích: *"số THẬT nếu chấp nhận vài cây
lẻ tự vượt ngưỡng riêng... hệ thống hiện tại vẫn sẽ TỰ đặt cây riêng khi duyệt, trừ khi bạn chọn
'chỉ cây chuẩn' + chấp nhận hao hụt cao hơn để ép đúng mức này"* - đúng tinh thần "xem và tự quyết
định", không còn số nào bị giấu.

**Kiểm tra**: `tsc --noEmit` sạch, `jest` 132/132 (2 test cũ sửa lại đúng hành vi mới, không thêm
test mới vì logic chỉ đổi Ở NGAY công thức so sánh, các ca khác không đổi). Live-test qua UI thật
xác nhận: SAT-VUONG-20X20 giờ hiện **xanh "0,78% ✓ 🔄"** (đúng vì 0,78<1), SAT-VUONG-12X12 vẫn
**đỏ "1,02% ✓ 🔄"** (đúng vì 1,02>1) - cả 2 đều có icon 🔄 báo "vẫn sẽ auto-scan khi duyệt thật".
Banner tổng "2 SKU có loại sắt vượt ngưỡng" ở đầu trang KHÔNG đổi (vẫn đúng - SAT-VUONG-12X12 thật
sự vượt ngưỡng nên cả 2 dòng SKU vẫn có ít nhất 1 loại vượt).

### 19.9 Người dùng bác bản 19.8: "bịp bợm" - phải hiện đúng sự thật đã chứng minh, không phải số đẹp

Ngay khi thấy SAT-VUONG-20X20 hiện **xanh "0,78%"** (kết quả 19.8), người dùng phản ứng gay gắt:
*"con số như vậy khác gì bịp bợm đâu, nếu bạn nói nếu cắt cây 20x20 với rule áp cho loại sắt thì
hao hụt sẻ lớn hơn 1% => đây là cái tôi cần bạn hiển thị ra"*.

**Đúng, và đây là lỗi thật của 19.7/19.8, không phải người dùng khó tính**: 0,78% CÓ THẬT (1 phương
án cắt hợp lệ, executable), nhưng chỉ đạt được bằng cách **PHÁ chính luật "mỗi cây ≤ ngưỡng"** mà
hệ thống đang áp cho loại sắt đó (xem 19.4: `_best_achievable()` chạy với ratio=1.0, tức bỏ hẳn bộ
lọc mỗi-cây). Trưng nó ra như "hao hụt sẽ đạt được" là sai bản chất kép:
1. Solver THẬT (auto_scan, khi Sếp duyệt) sẽ KHÔNG BAO GIỜ chọn phương án 0,78% này - pattern
   generation loại nó ngay từ khâu sinh kiểu cắt, trước cả khi tới bước chọn phương án.
2. Tô XANH một con số < ngưỡng cho 1 ca vốn dĩ KHÔNG đạt ngưỡng là nói ngược hẳn sự thật.

**Suy luận chặt (không phải phỏng đoán) để biết CHẮC CHẮN hao hụt thật > ngưỡng**: `generate_
patterns()` đã liệt kê HẾT các kiểu cắt ≤ ngưỡng/cây rồi thử phủ đúng nhu cầu CHỈ bằng các kiểu đó
- và THẤT BẠI (đó chính là lý do rơi vào nhánh `best_achievable`). Vậy MỌI phương án cắt hợp lệ
khác (phủ đúng nhu cầu, dù bằng kiểu cắt nào) BẮT BUỘC phải dùng ít nhất 1 kiểu KHÔNG ≤ ngưỡng -
tức chắc chắn có sẵn ít nhất 1 cây tự nó vượt ngưỡng. Đây là toán học, không phải ước tính.

**Đã sửa BE** (`cutting-proposals.service.ts::verifyExactStandaloneWaste`): nhánh `best_achievable`
đổi `overThreshold` từ so sánh trực tiếp (19.7) sang **LUÔN `true`** - nhưng lần này có LÝ DO CHỨNG
MINH CHẶT ghi rõ trong code (khác hẳn bản hardcode mù ở 19.4 ban đầu). `standaloneWastePct` vẫn trả
`best_achievable.waste_pct` (0,78%) làm DỮ LIỆU PHỤ, không phải "hao hụt sẽ đạt" - doc comment DTO
viết rõ ý này để không ai lặp lại đúng lỗi 19.8 lần nữa.

**Đã sửa FE** (`MaterialChip`): khi `verifiedLengthSource==='scan'`, KHÔNG hiện % (`best_achievable`)
làm số chính nữa - hiện **`> {thresholdPct}%`** (dùng đúng ngưỡng riêng của chính loại sắt đó, không
hard-code 1%). Số % thật (0,78%) chuyển vào tooltip, gắn rõ ràng "KHÔNG phải phương án hệ thống tự
chọn khi duyệt". Bỏ icon `RefreshCw` (không cần nữa - chữ ">ngưỡng%" đã tự nói rõ, không cần thêm
icon phụ).

**Kiểm tra**: `tsc --noEmit` sạch cả 2 repo, `jest` 132/132 (sửa lại đúng 1 test đang khoá hành vi
19.7 thành khoá hành vi mới, có giải thích rõ 3 lần sửa trong 1 ngày ngay trong comment test để
người đọc sau không tưởng nhầm đây là lần đầu). Live-test qua UI thật: SAT-VUONG-12X12 VÀ
SAT-VUONG-20X20 giờ ĐỀU hiện đỏ **"> 1%"** — không còn con số cụ thể nào gây hiểu lầm về việc "đạt
được ở cây chuẩn". Các loại thật sự đạt ngưỡng (SAT-VUONG-10X10 0,28%, SAT-PHI-4 0,22%, SAT-TRON-
FI21 0,21%) không đổi, vẫn hiện số verified bình thường.

**Bài học rút ra** (đáng ghi lại vì lặp 3 lần trong 1 ngày trên CÙNG 1 field): "hiện số thật để
người dùng tự quyết định" KHÔNG có nghĩa là hiện MỌI con số solver trả về - một con số chỉ "thật"
theo nghĩa hữu ích khi nó phản ánh đúng NHỮNG GÌ SẼ XẢY RA trong hệ thống thật. Con số đúng về mặt
tính toán (0,78% là kết quả có thật của 1 lần gọi solver) nhưng SAI về mặt NGỮ CẢNH (phương án đó
hệ thống không bao giờ tự chọn) vẫn là lừa dối người đọc, dù không có ý đó.

### 19.10 Chữ "cây cuối đợt" trong banner gây liên tưởng nhầm sang mẫu nguyên (2026-09-24)

Người dùng đọc banner đầu trang "Tối ưu cắt sắt" (`Các con số hao hụt... vì còn phụ thuộc số lượng
và cây cuối đợt không cắt đầy`), hỏi: *"cây cuối đợt => mẫu nguyên đã bỏ rồi mà"*.

**Không phải lỗi nội dung, mà là 2 khái niệm khác nhau trùng chữ "cây cuối"**:
- **Mẫu nguyên** (đã bỏ ở mục 18): solver CHỦ ĐỘNG cắt ít lại ở cây cuối, giữ nguyên phần dư để
  nhập kho dùng cho đợt sau - một hành vi XỬ LÝ KẾT QUẢ của solver, đã xoá hoàn toàn.
- **"Cây cuối không cắt đầy" ở banner**: nói về ĐỘ LỆCH CỐ HỮU của `best-fill.util.ts` (ước tính
  nhanh, KHÔNG gọi solver) - công thức giả định có đủ số lượng để lặp lại đúng kiểu cắt tối ưu ở
  MỌI cây; số lượng thật ít thì cây cuối không đủ đoạn để lặp kiểu đó, hao hụt thật cao hơn ước
  tính. Khái niệm này VẪN ĐÚNG, không liên quan gì tới việc để dư 1 khúc sắt nguyên.

Dù đúng về nội dung, chữ "cây cuối" ngay sau cả một phiên vừa dọn mẫu nguyên là lựa chọn từ ngữ tệ -
dễ gây hiểu lầm y hệt những gì vừa xảy ra. Ngoài ra phát hiện thêm 1 lỗi thật khác trong lúc soát
lại: banner khẳng định "luôn có dấu ≥" - câu này đã SAI kể từ khi có `verified` (mục 19): dòng đã
xác minh (dấu ✓) không còn dấu ≥ nữa.

**Đã sửa** (`GomDotCatPage.tsx`, banner đầu trang): viết lại, bỏ hẳn chữ "cây cuối đợt", tách rõ 2
trường hợp "chưa có dấu ✓" (ước tính, kèm ≥, giải thích đúng lý do lệch - giả định đủ số lượng để
lặp kiểu cắt tối ưu ở mọi cây) và "đã có dấu ✓" (số thật, không còn giả định này) - sửa luôn câu
"luôn có dấu ≥" đã sai.

**Kiểm tra**: `tsc --noEmit` sạch, không cần sửa test (thuần đổi text hiển thị, không đổi logic/dữ
liệu). Live-test qua UI thật xác nhận banner mới không còn nhắc "cây cuối", phân biệt đúng ✓/≥.

### 19.11 Bỏ hẳn dấu ✓ (2026-09-24)

Người dùng: *"tôi nghĩ bỏ dấu tick luôn"*. Bỏ icon `Check` khỏi `MaterialChip` - dòng đã xác minh
giờ chỉ phân biệt với dòng ước tính bằng việc CÓ/KHÔNG có dấu "≥" (banner ở 19.10 đã giải thích rõ
quy ước này), không cần thêm icon. Sửa lại đúng banner (vừa viết ở 19.10, còn nhắc "dấu ✓") cho
khớp: "Loại sắt kèm dấu ≥ là ước tính... Loại KHÔNG kèm dấu ≥ là số thật đã xác minh...". Icon
`Check` vẫn giữ import (còn dùng ở chỗ khác trong cùng file, không phải `MaterialChip`).

**Kiểm tra**: `tsc --noEmit` sạch, `jest` 132/132 (không đổi logic, chỉ bỏ 1 icon + sửa text).
Live-test: chip không còn ✓ ở bất kỳ dòng nào, banner khớp đúng quy ước ≥/không-≥.

## 20. Rủi ro "liệt kê pattern chưa xong" (`patterns_truncated`) bị đánh rơi trước khi tới BE/FE — đã nâng giới hạn 30s→90s, dấu cảnh báo QUYẾT ĐỊNH KHÔNG LÀM (2026-09-24)

### 20.1 Phát hiện qua hỏi đáp, không phải qua live-test

Người dùng hỏi lại nền tảng của tính năng xác minh solver ở mục 19: *"sao chỉ 1 lần giải, 1 lần giải
liệu có chính xác"*. Trả lời cho thấy CP-SAT tự nó KHÔNG phải nguồn rủi ro (là solver chính xác -
`OPTIMAL`/`FEASIBLE`/`INFEASIBLE` đều là kết luận chứng minh được, không phải may rủi của 1 lần thử)
- nhưng lần theo tới `generate_patterns()` (bước liệt kê MỌI kiểu cắt hợp lệ, chạy TRƯỚC khi đưa vào
CP-SAT chọn phương án) thì phát hiện 1 gap thật:

- `generate_patterns()` có ngân sách thời gian RIÊNG (`enum_budget`, cũ = `min(time_limit_sec, 30)`)
  tách khỏi thời gian giải IP. Nếu liệt kê CHƯA XONG mà hết giờ nhưng đã kịp tìm được vài pattern,
  code vẫn cho giải tiếp trên tập BỊ CẮT CỤT đó và trả `feasible: True` kèm cờ nội bộ
  `patterns_truncated: True` (`de_xuat_logic.py` dòng 405) - nghĩa là phương án trả về vẫn HỢP LỆ
  (đạt đúng ngưỡng %/cây) nhưng có thể CHƯA PHẢI phương án ít hao hụt nhất, vì 1 số kiểu cắt tốt hơn
  chưa kịp được xét.
- Grep `api/views.py` xác nhận cờ `patterns_truncated` **không hề được đưa vào** object trả ra ngoài
  (`purchase_plan[]` chỉ có `best_stock_length`, `length_source`, `waste_percentage`,
  `max_waste_pct_threshold`...) - bị **đánh rơi ngay ở tầng đóng gói response**, chưa từng tới được
  BE (`CuttingProposalsService`) hay FE (`MaterialChip`). Người dùng đang xem % mà không có cách nào
  biết con số đó có kèm cảnh báo "chưa chắc chắn tuyệt đối" hay không.
- Xác nhận thêm: gap này **áp dụng cho CẢ luồng đề xuất cắt sắt THẬT** (KHSX gộp đợt → Sếp duyệt →
  `runSolverAndSave` → `/de_xuat/propose/`), không chỉ riêng tính năng xác minh ở mục 19 - cả 2 đường
  gọi cùng đi qua đúng 1 hàm lõi `optimize_one_material()` → `generate_patterns()`
  (`api/views.py` dòng 253+283 gọi thẳng, không có nhánh riêng nào khác).

### 20.2 Đo thật bằng dữ liệu DB, không đoán chừng, trước khi quyết định nâng bao nhiêu

Comment gốc trong `generate_patterns()` (dòng 156-160) đã có số liệu đo thật: mỗi cỡ đoạn thêm vào 1
loại sắt làm số kiểu cắt khả dĩ nhân lên **~5 lần** (4 cỡ→60 cách, 5 cỡ→423, 6 cỡ→2.239); "9-10 cỡ
thì liệt kê hết mất hàng giờ". Để biết 30s (hay con số nâng lên) có thực sự đủ dùng không, query trực
tiếp DB dev (`docker exec dna-erp-be-postgres-1 psql`, bảng `segment_spec` join `materials`) đếm số
cỡ đoạn khác nhau mỗi loại sắt THẬT từng cần cắt:

| Loại sắt | Số cỡ đoạn khác nhau |
|---|---|
| SAT-HOP-10X20 | **15** |
| SAT-VUONG-20X20 | **12** |
| SAT-TRON-FI21 | 8 |
| SAT-HOP-25X50 | 6 |
| SAT-VUONG-12X12 | 5 |
| SAT-HOP-10X10 | 4 |
| còn lại | ≤3 |

**Kết luận từ số liệu thật**: 2 loại sắt thật đang có trong hệ thống (15 và 12 cỡ đoạn) đã VƯỢT mốc
"9-10 cỡ = hàng giờ" nêu trong code - không phải giả định lý thuyết, là rủi ro có thật với dữ liệu
đang dùng. Đồng thời kết luận: **không có con số giới hạn "hợp lý" nào giải quyết trọn vẹn mọi
trường hợp**, vì bài toán tăng theo cấp số nhân, không tăng đều - nâng cao cỡ nào thì 2 loại "khủng"
này vẫn có thể vượt.

### 20.3 Quyết định: nâng giới hạn (đã làm) — dấu cảnh báo QUYẾT ĐỊNH KHÔNG LÀM

Theo đúng chuẩn ERP (được hỏi thẳng, trả lời 2-3 câu theo quy ước câu hỏi mở): chuẩn production-grade
không nằm ở việc "nâng đủ cao thì hết rủi ro" (không đạt được cho lớp bài toán tổ hợp này - phần mềm
chuyên dụng như MC Laser mà code đang so sánh cũng chấp nhận giới hạn tương tự, không cố giải hết mọi
ca), mà nằm ở **minh bạch dữ liệu**: gắn cờ rõ ràng "best effort, chưa chứng minh tối ưu" thay vì hệ
thống tự quyết là "đủ tin" rồi im lặng - tôi đề xuất làm cả 2 việc (nâng giới hạn + cờ cảnh báo).

1. **Đã làm (2026-09-24)**: nâng `ENUM_TIME_LIMIT` từ `30.0` → `90.0` giây
   (`D:\DNA-DEXUAT\cat_sat\de_xuat_logic.py` dòng 59, kèm comment giải thích số liệu + lý do không
   nâng cao hơn/bỏ hẳn). Đủ cho đa số loại sắt thật (≤8 cỡ đoạn, dưới mốc "hàng giờ"). Rẻ, an toàn:
   solver chạy NỀN sau khi Sếp duyệt (đã chốt ở mục 15-16 "KHSX không cần biết tốn bao lâu"), tốn
   thêm tối đa 1 phút không ai phải chờ. Container `catsat_web` mount source qua volume (dev mode) -
   Django `StatReloader` tự nạp lại ngay, xác nhận qua log container
   (`/app/cat_sat/de_xuat_logic.py changed, reloading.`), không cần restart thủ công.
2. **Người dùng CHỐT KHÔNG LÀM** (phản hồi thẳng: *"chắc không cần dấu ? đâu"*, sau khi đã nghe rõ
   đánh đổi ở mục 20.2-20.3): đẩy `patterns_truncated` xuyên suốt `views.py` → BE DTO → FE
   `MaterialChip` (dấu cảnh báo kiểu `lowConfidence` đã có). Lý do chấp nhận được: nâng giới hạn ở
   mục (1) đã giảm đáng kể tần suất gặp phải, chỉ còn đúng 2 loại sắt thật (15, 12 cỡ đoạn) còn khả
   năng dính - rủi ro còn lại được đánh giá là chấp nhận được, không cần thêm UI cảnh báo cho ca
   hiếm này. **Không xoá đoạn phân tích ở 20.1-20.2** - giữ lại làm tài liệu tham khảo nếu sau này
   muốn làm lại (vd nếu 1 trong 2 loại sắt "khủng" đó thực sự gây sai lệch được phát hiện qua thực
   tế sản xuất).

### 20.4 Kiểm tra

Đã xác nhận: container solver reload thành công (log), không có file nào khác tham chiếu
`ENUM_TIME_LIMIT` cần sửa theo (`grep` `api/tests.py` + toàn bộ `cat_sat/*.py`, không match). CHƯA
live-test lại 2 loại sắt "khủng" (SAT-HOP-10X20, SAT-VUONG-20X20) trên UI thật với giới hạn mới -
90s vẫn có thể chưa đủ cho chúng (đúng như đã dự đoán ở 20.2), việc đó không phải mục tiêu của thay
đổi này. `tsc`/`jest` không áp dụng (thay đổi thuần Python, không đụng BE/FE).

### 20.5 Bug thật bắt được ngay sau đó qua live-test: sync git đầu phiên làm "mất" cả tính năng verify (2026-09-24)

Ngay sau khi làm xong mục 20.1-20.4, người dùng gửi ảnh chụp màn "Tối ưu cắt sắt": *"khi nãy 2 loại
sắt màu đỏ giờ sao thành màu xanh rồi?"* - đúng 2 loại `SAT-VUONG-20X20`/`SAT-VUONG-12X12` vừa xác
nhận đỏ (mục 19.9) nay lại hiện xanh kèm dấu `≥` (ước tính, CHƯA xác minh) thay vì `>1%` (đã xác
minh, chắc chắn vượt).

**Không phải lỗi logic hiển thị** (nghi ngờ ban đầu) - kiểm tra network response thật của
`/cutting-batch-candidates` thấy field `verified`/`verifiedLengthSource` **biến mất hoàn toàn** khỏi
JSON (không phải `false`, mà KHÔNG CÓ key đó) - dấu hiệu server đang chạy code CŨ, từ TRƯỚC khi có
tính năng xác minh (mục 19) được thêm vào DTO.

**Gốc rễ thật**: đầu phiên này, theo đúng yêu cầu *"tôi track vô nhánh mới nhất thì bị conflict [...]
không tự tiện merge"*, đã `git stash` → `git merge --ff-only origin/main` (kéo về commit `c13b7b5`,
mang theo migration `20260923064322_add_consumable_piece_yield_reservation_reftypes` - thêm 2 giá trị
enum `StockReservationRefType`: `CONSUMABLE_MATERIAL_PURCHASE`, `PIECE_MATERIAL_YIELD_PURCHASE`) →
`git stash pop` (áp lại code phiên này, tự merge sạch `prisma/schema.prisma`, không conflict). Nhưng
2 bước BẮT BUỘC sau khi đổi schema **không tự động chạy theo git**:
1. `npx prisma generate` - Prisma Client (`src/generated/prisma`, **gitignored**, dòng 31 `.gitignore`)
   vẫn là bản CŨ, thiếu 2 giá trị enum mới.
2. `npx prisma migrate deploy` - DB dev local CHƯA có 2 giá trị enum đó (`prisma migrate status` xác
   nhận: *"Following migration have not yet been applied: ..."*).

Hệ quả: `nest start --watch` (webpack watch mode) phát hiện **12 lỗi TypeScript thật**
(`material-issues.service.ts`, `material-yield-issues.service.ts`, `packaging-issues.service.ts`,
`consumable-material-purchase.service.ts`, `piece-material-yield-purchase.service.ts`,
`weaving-issues.service.ts` - toàn bộ chỗ dùng 2 giá trị enum mới) khi cố build lại theo các thay đổi
của session này (mục 15-20) - nhưng KHÔNG crash, mà **âm thầm giữ bản build thành công GẦN NHẤT
TRƯỚC ĐÓ chạy tiếp** (trước khi tính năng verify mục 19 tồn tại) - không có log lỗi nào lộ ra ngoài
theo cách dễ thấy (`preview_logs level:error` báo "No server errors found" vì lỗi nằm ở STDOUT của
lần compile TRƯỚC, đã bị các lần compile lỗi sau đè log). Route/controller/DTO/service code trên đĩa
đều ĐÚNG - chỉ có tiến trình Node đang chạy là SAI (stale).

**Đã sửa**: `npx prisma generate` (Client mới) → `npx prisma migrate deploy` (áp migration còn thiếu
vào DB dev - migration chỉ `ALTER TYPE ... ADD VALUE`, thuần cộng thêm, không đụng dữ liệu, an toàn
tuyệt đối) → restart hẳn `dev` server (`preview_stop` + `preview_start`, không chỉ chờ hot-reload) →
build lại "Found 0 errors".

**Live-test lại qua UI thật xác nhận đã khớp đúng dữ liệu** (network response mới):
`SAT-VUONG-12X12`: `standaloneWastePct: 1.0205%, verified: true, verifiedLengthSource: "scan",
overThreshold: true`; `SAT-VUONG-20X20`: `0.7833%, verified: true, "scan", true` - cả 2 đúng lại màu
đỏ `>1%` trên UI, banner "2 SKU có loại sắt vượt ngưỡng hao hụt" hiện đúng trở lại.

**Bài học quy trình** (đáng nhớ cho lần sync git kế tiếp có đổi `schema.prisma`): `git merge`/
`git stash pop` chỉ đồng bộ được FILE - Prisma Client (build artifact, gitignored) và DB thật (state
ngoài git) đều phải tự tay đồng bộ theo SAU MỖI LẦN `schema.prisma` đổi qua sync, không chỉ lần đầu
setup dự án. `nest start --watch` KHÔNG BÁO LỖI RÕ RÀNG khi rơi vào ca này (giữ bản cũ chạy tiếp âm
thầm) - dấu hiệu đáng ngờ nhất là **field bị thiếu hẳn trong response** (không phải giá trị sai),
nên bất cứ khi nào 1 tính năng "vừa làm xong" đột nhiên biến mất sau 1 lần sync git, nên nghi ngay
build/Prisma-client/migration lệch nhau trước khi nghi logic.

## 21. Test thật trên production lộ ra gap còn sót của mục 19: "xanh" ở Tối ưu cắt sắt vẫn có thể phải "đặt riêng" khi solve thật — thêm trạng thái "chưa xác minh" (2026-09-24)

### 21.1 Phát hiện qua test thật trên production

Người dùng gửi ảnh "Chi tiết đề xuất cắt sắt" (kết quả solve THẬT của 1 PI production, `Ghế J55 (3
ghế)`): 3 loại sắt (SAT-003, SAT-005, SAT-006) đều "Khả thi", hao hụt thấp (0.58%/0.23%/0.22%, đều
dưới ngưỡng) nhưng cột chiều dài ghi **"⚠ đặt riêng"** (không phải 6000mm). Trong khi đó màn "Tối ưu
cắt sắt" (preview TRƯỚC khi solve) chỉ báo đỏ 2 loại (`overThreshold`), không cảnh báo gì về 3 loại
này - hỏi: *"sau khi tôi test trên production cũng data ghế J55 chỉ có 2 loại nó báo đỏ ở Tối ưu cắt
sắt nhưng sau khi solve ra lại tới 3 loại đặt riêng?"*

**Không phải bug mới - là gap ĐÃ BIẾT từ mục 17, giờ mới thấy hậu quả cụ thể bằng dữ liệu thật**: chip
đỏ/xanh ở "Tối ưu cắt sắt" và cờ "đặt riêng" ở kết quả solve thật đang trả lời **2 câu hỏi khác
nhau**:
- Đỏ/xanh (mục 19, `verifyExactStandaloneWaste`) = "cây chuẩn (6000mm) có đạt ngưỡng hao hụt hay
  không" - CHỈ vậy.
- "Đặt riêng" (kết quả solve thật, `optimize_one_material()` bước 1 ở mục trước) = "solver có CHỌN
  6000mm hay 1 chiều dài KHÁC" - đạt ngưỡng KHÔNG có nghĩa là đạt NGAY ở 6000mm; có thể đạt ở 1
  chiều dài khác mà solver tự tìm tốt hơn.

1 loại sắt hoàn toàn có thể "xanh" (đạt ngưỡng) mà vẫn "đặt riêng" - 2 khái niệm không loại trừ nhau.
Với vật tư như SAT-003/005/006 (nhiều khả năng bị chặn xác minh do quá nhiều cỡ đoạn, xem mục 19's
`EXACT_CHECK_MAX_SIZES`), "Tối ưu cắt sắt" chỉ có ước tính nhanh (`best-fill.util.ts`, cận dưới LÝ
TƯỞNG giả định lặp lại đúng kiểu cắt tối ưu ở MỌI cây) - ước tính này LẠC QUAN hơn thực tế, nhất là
với số lượng nhỏ (`Ghế J55 (3 ghế)` - đúng ca lệch nặng nhất theo doc comment field này).

### 21.2 Không thể mở rộng xác minh cho MỌI loại sắt - đo thật xác nhận rủi ro có thật (không phải 300s như comment cũ, nhưng vẫn đủ nguy hiểm)

Hướng đầu tiên định làm: bỏ hẳn `EXACT_CHECK_MAX_SIZES` (giới hạn 5 cỡ đoạn), gọi xác minh cho MỌI
loại sắt - dựa vào `EXACT_CHECK_BATCH_BUDGET_MS`/`EXACT_CHECK_CONCURRENCY` sẵn có để chặn tổng thời
gian trang tải. Trước khi làm, đo thật bằng cách gọi TRỰC TIẾP solver local với đúng 15 cỡ đoạn thật
của `SAT-HOP-10X20` (loại nhiều cỡ nhất trong DB dev) qua `curl`, `time_limit_seconds=5` (đúng giá trị
`EXACT_CHECK_SOLVER_TIME_LIMIT_SEC`):

```
real 15.191s | response: {"feasible": false, "timed_out": true, "best_achievable": null,
"solve_seconds": 15.07}
```

**Kết quả đo thật**: 15.07s - THẤP hơn nhiều "~300s" ghi trong comment cũ của `EXACT_CHECK_MAX_SIZES`
(có thể do các lần tối ưu solver ở phiên trước - `stop_on_first`, lọc ngưỡng chặt hơn khi sinh
pattern...) nhưng **vẫn vượt `EXACT_CHECK_TIMEOUT_MS=8000`** (8s) - nghĩa là dù gọi, BE cũng bỏ cuộc
ở giây 8 (rơi về ước tính cũ, kết quả cuối không đổi) trong khi **solver vẫn âm thầm tính tiếp ~7s
nữa phía sau** (HTTP timeout ở client không hủy được tiến trình đang chạy trong container). Với
`EXACT_CHECK_CONCURRENCY=6` gọi song song, nhiều loại "nặng" cùng lúc vẫn có thể chiếm CPU container
solver dùng chung, ảnh hưởng các đợt giải THẬT khác đang chạy đồng thời - rủi ro hạ tầng có thật,
đo được, không phải suy diễn. **Quyết định: KHÔNG bỏ giới hạn** - hỏi lại người dùng qua
`AskUserQuestion`, chọn phương án "Cảnh báo rõ, không hiện số".

### 21.3 Đã sửa - thêm trạng thái thứ 3 "chưa xác minh" cho `MaterialChip` (thuần FE, không đổi BE)

Nhận ra dữ liệu cần đã có sẵn ở BE, không cần thêm field mới: `overThreshold` (tính từ cận dưới ước
tính) đã ĐÚNG theo 1 CHIỀU DUY NHẤT - nếu cận dưới lý tưởng ĐÃ vượt ngưỡng thì thực tế CHẮC CHẮN vượt
(cận dưới không bao giờ cao hơn thực tế) - chiều này vẫn đáng tin dù `verified=false`. Chiều ngược
lại (`overThreshold=false` khi chưa verify) mới là chiều KHÔNG đáng tin - thực tế có thể cao hơn tới
mức vượt ngưỡng, đúng ca SAT-003/005/006. Vậy chỉ cần 1 điều kiện suy ra hoàn toàn từ field có sẵn:

```ts
const unreliableEstimate = !verified && !over
```

`D:\DNA-ERP\src\modules\pages\ProductionPlan\GomDotCatPage.tsx::MaterialChip` - khi
`unreliableEstimate`, đổi màu chip sang vàng cam (`#fef3c7`/`#92400e`, khác cả đỏ vượt ngưỡng và xanh
đạt ngưỡng), **ẨN số %** (dễ đọc nhầm "đã ổn"), hiện thẳng **"{code} chưa xác minh"** kèm icon cảnh
báo, tooltip giải thích lý do (quá nhiều cỡ đoạn, tránh treo solver dùng chung) + khuyên chờ Sếp
duyệt để biết kết quả thật. Cập nhật banner đầu trang thêm đúng câu giải thích trạng thái thứ 3 này
(tránh lặp lỗi mục 19.10 - banner nói khác chip).

**Kiểm tra**: Live-test qua UI thật (đăng nhập `khsx`/`demo1234`, "Tối ưu cắt sắt", GHE-J55 SL 30) -
xác nhận đúng 3 trạng thái cùng hiện diện trên 1 dòng: `SAT-VUONG-12X12`/`SAT-VUONG-20X20` đỏ `>1%`
(đã xác minh, vượt); `SAT-VUONG-10X10 0.28%`/`SAT-PHI-4 0.22%`/`SAT-TRON-FI21 0.21%` xanh (đã xác
minh, đạt); `SAT-HOP-10X20`/`SAT-PHI-6` vàng cam **"chưa xác minh"** (không còn hiện `≥0.17%` gây
hiểu lầm như trước). Banner mới hiện đủ giải thích cả 3 màu.

### 21.4 Còn treo

Đây chỉ đóng gap ở PHÍA HIỂN THỊ (không còn hiện số sai gây hiểu lầm) - KHÔNG làm màn "Tối ưu cắt
sắt" biết chắc 100% "sẽ đạt hay đặt riêng" cho những loại nhiều cỡ đoạn, vì bản chất không có cách an
toàn nào xác minh nhanh được trong lúc tải trang (mục 21.2). Muốn biết chắc 100% vẫn phải chờ solve
thật (chạy nền khi Sếp duyệt) - đây là giới hạn cố hữu của 1 màn xem trước, không phải thiếu sót có
thể vá thêm.

### 21.5 Người dùng chốt: bỏ trạng thái "chưa xác minh", quay lại đúng 2 màu xanh/đỏ như trước 21.3 (2026-09-24)

Sau khi bàn xong rủi ro 2 PI duyệt gần nhau (mục 22 dưới), người dùng yêu cầu **backout** phần UI mục
21.3 vừa làm - `MaterialChip` trở lại ĐÚNG như trước (chỉ 2 màu xanh/đỏ, dấu `≥` cho ước tính chưa xác
minh, không còn màu vàng cam "chưa xác minh" ẩn số %).

**Đã sửa** (`GomDotCatPage.tsx::MaterialChip`): bỏ biến `unreliableEstimate` và toàn bộ nhánh hiển thị
của nó (màu vàng cam, chữ "chưa xác minh" thay số %, icon cảnh báo riêng) - trở lại hiện `≥{pct}%` màu
xanh bình thường cho MỌI dòng `verified=false` bất kể `over` là gì, đúng y hệt hành vi trước mục 21.3.
Bỏ luôn câu giải thích trạng thái thứ 3 ở banner đầu trang (mục 21.3 đã thêm). Phần BE (mục 19-20,
`verified`/`verifiedLengthSource`, `ENUM_TIME_LIMIT=90`) và phần hàng đợi FIFO (mục 22) GIỮ NGUYÊN -
chỉ backout riêng lớp hiển thị "chưa xác minh" ở FE.

**Kiểm tra**: `tsc --noEmit` sạch (2 lần, ngay sau khi bỏ biến và sau khi bỏ banner).

## 22. Hàng đợi FIFO cho mọi lượt gọi solver thật - PI duyệt sau phải chờ PI duyệt trước xong (2026-09-24)

### 22.1 Câu hỏi dẫn tới thay đổi

Sau khi đo thật thấy 2 lượt giải chạy song song có thể tranh CPU container solver (mục 21, phần
"SAT-HOP-10X20 mất 372s"), người dùng hỏi tiếp: *"nếu mỗi PI qua solve theo từng phiên thì sao, phiên
này xong thì mới tiến hành solve phiên tiếp theo"* rồi chốt rõ: *"vẫn phải xếp hàng theo lượt gửi khi
boss duyệt, ví dụ có 3 PI là 1 2 3 cần boss duyệt... PI 2 sẽ vô hàng chờ solve PI 1 xong"*.

### 22.2 Đã làm

`CuttingProposalsService` (`cutting-proposals.service.ts`):
- Thêm field `solveQueueTail: Promise<void>` (dòng ~230) - đuôi hàng đợi FIFO trong tiến trình.
  KHÔNG dùng Redis/BullMQ - đã kiểm `render.yaml`: BE chạy đúng 1 instance (`plan: free`, không scale
  ngang), promise-chain thuần trong process là đủ, không cần thêm hạ tầng.
- Thêm method `enqueueSolverRun()` (dòng ~260) - nối lượt gọi mới vào ĐUÔI hàng đợi, lượt hiện tại chỉ
  chạy SAU KHI lượt trước đó xong (thành công hoặc lỗi đều tính "xong"). Lỗi của 1 lượt bị NUỐT RIÊNG ở
  chỗ nối đuôi (không phải ở promise trả về caller) để không làm vỡ chuỗi - lượt kế tiếp vẫn được xếp
  hàng và chạy dù lượt trước lỗi.
- Đổi 2 nơi gọi (`requestForOrder`, `requestForInvoice`) từ `void this.runSolverAndSave(...)` sang
  `void this.enqueueSolverRun(...)` - giữ nguyên mọi tham số + `.catch()` log lỗi riêng của từng nơi
  gọi (không đổi thông báo lỗi hiện có).
- KHÔNG đổi tính ĐÚNG của dữ liệu - `approve()` đã tự khoá `stock_quant` bằng `FOR UPDATE` từ trước
  (xem dòng ~1125, comment ghi rõ "chặn 2 phương án cắt cùng vật tư được duyệt gần như đồng thời cùng
  đọc thấy 1 số dư" + khoá theo thứ tự `materialId` tăng dần để tránh deadlock) - hàng đợi này CHỈ đổi
  tốc độ/thứ tự hoàn thành, không phải lưới an toàn dữ liệu thứ 2.

### 22.3 Kiểm tra

`tsc --noEmit` sạch, `jest src/modules/cutting-proposals` 132/132 pass (không test nào bị ảnh hưởng -
mỗi test trước giờ chỉ chạy 1 lượt, hàng đợi rỗng chạy y hệt gọi trực tiếp).

**Live-test thật với 3 PI** (gọi trực tiếp 2 route "Tính lại": `POST production-invoices/8/cutting-
proposals` = PI-A đợt gộp 2 SKU, `POST production-orders/8/cutting-proposals` = PI-B GHE-J55 đơn,
`POST production-orders/9/cutting-proposals` = PI-C TEST1 - bắn B,C cách A đúng ~10s, trong lúc A còn
đang giải):

| PI | Bắt đầu giải thật | Thời gian giải | Kết quả |
|---|---|---|---|
| A | ngay (07:51:58) | 848.08s | `DRAFT` (1 dòng infeasible) |
| B | chờ tới khi A xong (08:06:06) | 53.30s | `DRAFT` (đạt ngưỡng, 0.25%, 217 cây) |
| C | chờ tới khi B xong (08:07:00) | ~0.5s | `FAILED` (chặn bởi guard timeout có từ trước: 7 loại × 300s > 1700s - không liên quan hàng đợi) |

Xác minh qua 2 cách độc lập: (1) `netstat` kiểm tra kết nối TCP thật tới container solver ngay sau khi
bắn cả 3 - chỉ thấy ĐÚNG 1 kết nối đang mở (không phải 3), xác nhận B/C chưa hề gửi request; (2)
`docker logs catsat_web --timestamps` suốt 14 phút A đang giải (07:52:08 → 08:06:06) không ghi nhận
BẤT KỲ request nào khác hoàn tất - nếu B chạy song song (vốn từng đo ~372-450s ở mục 21) nó đã phải
xong từ lâu trước khi A xong; B chỉ thực sự bắt đầu VÀ hoàn tất (53s) ngay sau khi A kết thúc, C tương
tự ngay sau B - khớp khít, không chạy chồng.

### 22.4 Còn treo

Chưa test ca "1 lượt lỗi giữa hàng đợi có làm kẹt lượt sau không" bằng dữ liệu thật (PI-C ở trên fail
nhưng đã CHỨNG MINH được lượt sau nó - không có, C là lượt cuối - nên chưa có ca thật "lỗi rồi vẫn xếp
hàng tiếp"). Về lý thuyết đã đúng qua code review (lỗi nuốt riêng ở chỗ nối đuôi), nhưng chưa có bằng
chứng sống cho đúng tình huống đó.

## 23. Guard timeout chặn OAN "Tính lại" vì override lưu trên PI đã lỗi thời - đổi từ throw sang tự co ngân sách (2026-09-24)

### 23.1 Phát hiện qua chính live-test mục 22

PI-C ở live-test 3 PI (mục 22.3, `production-orders/9/cutting-proposals` = TEST1) bị `FAILED` gần như
lập tức: *"Đợt tính có 7 loại sắt × time_limit 300s/loại = tối đa 2100s, vượt timeout HTTP client hiện
tại (1700s)"*. Người dùng hỏi: *"tại sao vẫn còn chặn guard này... cách để giải quyết triệt để"*.

**Gốc rễ**: `solverTimeLimitSecondsOverride=300` đang lưu CỐ ĐỊNH trên PI-2026-008 từ lúc PI này được
tạo (mục 15-16: FE tự tính `floor(T/N)` rồi LƯU LẠI trên PI lúc gộp/cắt riêng, không phải nhập tay).
Nút "Tính lại" thật (`retryCuttingProposal`/`retryCuttingProposalForInvoice`,
`cutting-proposals-api.ts`) gửi **body rỗng** - không gửi lại override mới - nên luôn TÁI DÙNG đúng số
`300` đã lưu, tính theo N loại sắt LÚC ĐÓ. Nếu sau này BOM đổi (thêm loại sắt, N tăng lên 7), guard cũ
so `7 × 300 = 2100s > 1700s` rồi throw - chặn OAN, vì con số 300 đã lỗi thời, không phản ánh N thật của
lượt tính NÀY. Đây không phải lỗi riêng của live-test - **nút "Tính lại" thật trên UI cũng dính đúng
lỗi này** vì cùng gửi body rỗng.

Guard cũ còn 1 lý do không còn đúng nữa: comment gốc ghi *"KHSX tự chịu trách nhiệm với con số mình
nhập"* - đúng khi còn ô nhập tay, nhưng từ 2026-09-23 (mục 16) override đã LUÔN do FE tự tính, không
còn ai "tự nhập" nữa - lý do chặn cứng để "KHSX tự sửa" không còn hợp lý (chưa kể: không có ô nào cho
KHSX sửa số này sau khi đã lưu).

### 23.2 Đã sửa - tự CO time_limit về mức an toàn thay vì throw

`cutting-proposals.service.ts` (~dòng 1492-1520): thay khối `if (worstCaseSeconds > timeoutSeconds)
throw Error(...)` bằng:

```ts
const timeLimitSeconds = Math.min(
  requestedTimeLimitSeconds,
  Math.max(1, Math.floor(timeoutSeconds / distinctMaterialCount)),
);
```

Đúng công thức toán học FE đã dùng để tự tính ô ngân sách (`autoTimeLimitSeconds`,
`GomDotCatPage.tsx`): `N × floor(T/N) ≤ T` LUÔN đúng, nên KHÔNG còn cách nào vượt `timeoutSeconds` nữa
- bỏ hẳn nhánh throw, không cần "chặn trước" vì đã tự sửa an toàn ngay tại nguồn. Giữ lại 1 dòng
`logger.warn()` khi co thật (số gửi < số yêu cầu) để có dấu vết audit khi cần soi - không im lặng đổi
số mà không ai biết.

### 23.3 Kiểm tra

- Sửa lại test cũ (`cutting-proposals.service.spec.ts`, test *"chặn TRƯỚC khi gọi solver..."* →
  *"co time_limit_seconds về mức AN TOÀN..."*) - khoá đúng hành vi MỚI: `externalApiService.post` VẪN
  được gọi (đúng 1 lần) với `time_limit_seconds` đã co (`floor(300/2)=150`), KHÔNG còn có dòng
  `FAILED` nào trong `cuttingProposal.update`. `tsc --noEmit` sạch, `jest` 132/132 pass.
- **Live-test thật**: gọi lại đúng `production-orders/9/cutting-proposals` (TEST1) vừa fail ở mục 22 -
  log xác nhận đúng dòng cảnh báo mới: *"co ngân sách time_limit từ 300s xuống 242s/loại (7 loại sắt ×
  timeoutSeconds 1700s)"* - request KHÔNG còn bị chặn, đã thực sự đi tới solver (status
  `CALCULATING`, không `FAILED` ngay như trước).
