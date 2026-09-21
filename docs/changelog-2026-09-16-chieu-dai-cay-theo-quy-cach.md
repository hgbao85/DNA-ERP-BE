# Changelog 2026-09-16 — Chiều dài cây sắt theo TỪNG QUY CÁCH (nghiên cứu)

> Trạng thái: **ĐÃ XONG CẢ 3 TẦNG** - solver + BE (mục 7) + FE (mục 8), đã live-test đầu-cuối. Câu hỏi thiết kế ở
> mục 4 đã được người dùng chốt: phương án **(b)** - KHSX chọn theo TỪNG ĐỢT.

## 1. Yêu cầu

Người dùng (xem màn "Tối ưu cắt sắt", tài khoản `khsx`, có ghi chú tay trên ảnh): *"cần có ô để
chọn chiều dài mặc định cho từng quy cách, không để cứng 6m nữa mà có thể linh hoạt (default cây
chuẩn vẫn là 6m)"*. Ghi chú tay đặt các ô `6m` / `5m85` cạnh từng mã sắt trong bảng.

Con số `5m85` không phải tuỳ tiện: tài liệu `PHAN_TICH_HE_THONG_CatSat.md` chạy chuẩn vàng với
`{5850, 6000}`, còn `SystemConfig` hiện tại chỉ `{6000}` (bỏ 5850 từ 2026-08-12 vì "hỏi lại NCC,
hiện chỉ cung cấp 6000mm" — xem doc comment `SystemConfig.solverStockLengths`). Tức nhu cầu này là
**mở lại khả năng đó nhưng theo từng quy cách**, không phải một danh sách chung cho mọi loại sắt.

## 2. Hiện trạng — chiều dài cây đang là MỘT danh sách CHUNG

`SystemConfig.solverStockLengths` (`Json`, mặc định `[6000]`) là nguồn duy nhất, dùng ở **4 chỗ**:

| Chỗ | Hàm | Dùng làm gì |
|---|---|---|
| `cutting-proposals.service.ts:426` | `getBatchSuggestions()` | dòng "Hệ thống đề xuất gộp N SKU" |
| `:518` | `getBatchCandidates()` | bảng "LOẠI SẮT · HAO HỤT KHI CẮT RIÊNG" (các chip `≥x%`) |
| `:624` | `previewBatch()` | khối "Nếu gộp N SKU đã chọn" (cột Cắt riêng/Cắt chung/Bớt) |
| `:1314` | `runSolverAndSave()` | request thật: `stock_lengths: [...].join(' ')` |

3 chỗ đầu là **đúng màn hình người dùng đang nói tới** — mọi con số `≥x%` trên đó tính qua
`bestWasteAcrossStockLengths(sizes, stockLengthsMm, ...)` (`best-fill.util.ts:101`). Hàm này **đã
nhận danh sách chiều dài theo từng lần gọi**, nên chỉ cần truyền danh sách của đúng loại sắt đó —
không phải sửa thuật toán.

## 3. Solver có đỡ được không — CÓ, và rẻ hơn dự kiến

Đọc `D:\DNA-DEXUAT\api\views.py` + `cat_sat/de_xuat_logic.py`:

- Request hiện chỉ có `stock_lengths` **CHUNG** (parse ở `views.py:183-187`), **không** có
  `stock_lengths_by_material`.
- NHƯNG solver **đã vòng lặp theo từng loại sắt** (`views.py:228-249`:
  `for group in material_groups: ... optimize_one_material(stock_lengths=stock_lengths, ...)`) và
  hàm lõi `optimize_one_material(sizes, demands, stock_lengths, ...)` nhận chiều dài **theo từng
  lời gọi**, bên trong còn `for L in sorted(set(stock_lengths))`.

→ Thêm chiều dài theo quy cách **không phải sửa thuật toán**, chỉ là nối dây ở `views.py`: thêm
`_parse_stock_lengths_by_material()` (sao y `_parse_max_waste_pct_by_material`, `views.py:58-80`),
resolve trong vòng lặp group, và echo `resolved_stock_lengths_by_group` vào `input_echo`.

**Tiền lệ có sẵn cả 2 đầu** — `max_waste_percentage_by_material` (solver) ghi đè
`max_waste_percentage`, phía BE là `Material.maxCuttingWastePercentage` ghi đè
`SystemConfig.solverMaxWastePercentage`. Tính năng này lặp lại ĐÚNG khuôn đó, gồm cả 2 bài học đã
ghi trong solver: **không fuzzy-match khoá** (khớp nhầm lặng lẽ tệ hơn bỏ qua) và **phải echo giá
trị THỰC SỰ áp** để caller không phải đoán qua request đã gửi.

## 4. CÂU HỎI THIẾT KẾ CÒN MỞ — đặt ở tầng nào?

Câu chữ yêu cầu có 2 nghĩa khác nhau về schema:

- **(a) Master data theo vật tư**: `Material.defaultStockLengthMm` (hoặc `stockLengthsMm Json?`),
  `null` = rơi về `SystemConfig.solverStockLengths`. Admin đặt 1 lần ở "Vật tư", đúng chỗ đã có
  `maxCuttingWastePercentage`. Khớp chữ "mặc định cho từng quy cách".
- **(b) KHSX chọn theo TỪNG ĐỢT** ngay trên màn "Tối ưu cắt sắt" — khớp chữ "cần có ô để chọn" và
  khớp vị trí ghi chú tay (cạnh từng mã sắt TRONG bảng đợt cắt).

> **NGƯỜI DÙNG CHỐT (2026-09-16): phương án (b)** - chỉ tầng đợt, KHÔNG thêm field ở `Material`.
> Đề xuất 2 tầng bên dưới KHÔNG được chọn, giữ lại để hiểu vì sao cân nhắc.

~~**Đề xuất: làm CẢ 2 TẦNG**~~, đúng idiom đã chốt ở `changelog-2026-09-14-solver-auto-approve-mode.md`
mục 2 cho `solverAutoApproveMode` (SystemConfig = mặc định công ty, ProductionInvoice = KHSX chọn
riêng cho đợt đó). Cụ thể: `Material.defaultStockLengthMm` làm mặc định của quy cách, ô trên màn
"Tối ưu cắt sắt" điền sẵn giá trị đó và KHSX sửa được cho riêng đợt đang gộp.

## 5. Kế hoạch (chưa làm)

1. **Solver** (`D:\DNA-DEXUAT`): `stock_lengths_by_material` + echo `resolved_stock_lengths_by_group`
   + test sao y `api/tests.py` (đã có sẵn 6 test cho `max_waste_percentage_by_material` làm khuôn).
2. **BE**: migration thêm field (tầng vật tư, + tầng PI nếu chốt 2 tầng); resolve chiều dài theo
   từng loại sắt ở **cả 4 chỗ** ở mục 2 — riêng 3 chỗ preview phải sửa cùng lúc, nếu không con số
   `≥x%` trên màn sẽ tính theo 6m trong khi solver thật cắt 5m85, lệch nhau ngay trên cùng một màn.
3. **FE**: ô chọn chiều dài cạnh từng chip loại sắt ở `GomDotCatPage.tsx`; mặc định hiện `6m`.
4. **Không đụng** `solverMinLengthMm`/`MaxLengthMm`/`LengthStepMm` (dải vét cạn `auto_scan`) — khác
   khái niệm với chiều dài cây chuẩn, xem mục 10 của changelog 09-14.

## 6. Còn treo

- ~~Chưa chốt (a)/(b)/cả-hai ở mục 4~~ — **đã chốt (b), đã làm xong BE + solver, xem mục 7**.
- ~~2 SKU gộp chung 1 loại sắt mà chọn 2 chiều dài khác nhau thì xử lý sao~~ — **câu hỏi tự biến
  mất với phương án (b)**: ô chọn theo QUY CÁCH trong ĐỢT (không theo SKU) nên mỗi loại sắt chỉ
  có đúng 1 giá trị, không thể mâu thuẫn.
- ~~FE chưa làm~~ - **đã xong 2026-09-16, xem mục 8.**
- ~~2 endpoint GET vẫn tính theo cây chuẩn~~ — **quyết định này SAI, đã sửa ở mục 7.6**: người
  dùng yêu cầu đổi chiều dài thì chip "hao hụt khi cắt riêng" phải tự tính lại.

---

## 7. ĐÃ LÀM (2026-09-16) — BE + solver

### 7.1 Solver (`D:\DNA-DEXUAT`, `api/views.py`)

Thêm `stock_lengths_by_material`, sao y khuôn `max_waste_percentage_by_material` - 6 chỗ sửa:
`_parse_stock_lengths_by_material()` (nhận số đơn / list / chuỗi, loại giá trị <= 0 và entry rác),
docstring endpoint, khối parse, khai báo `resolved_stock_lengths_by_group`, resolve trong vòng lặp
theo từng loại sắt, và 2 khoá mới trong `input_echo`.

**KHÔNG đụng `de_xuat_logic.py`** - đúng như mục 3 dự đoán: `optimize_one_material()` vốn đã nhận
`stock_lengths` theo từng lời gọi.

Test: thêm class `DeXuatProposeStockLengthsByMaterialTests` (6 test) - backward-compat khi không
gửi dict, khớp 1 loại, khoá không khớp, cả 3 dạng giá trị, giá trị rác/<=0, và không phải dict.
Chạy trong container: `docker exec catsat_web python manage.py test api` → **13/13 pass**.

### 7.2 BE - lưu ở tầng đợt

- Migration `20260916020703_pi_solver_stock_lengths_by_material`: thêm
  `ProductionInvoice.solverStockLengthsByMaterial Json?` (`{ "<materialId>": <mm> }`).
- `SolverOverrideDto` (dùng chung mergeItems + claimSolo) và `PreviewCuttingBatchDto` cùng nhận
  field này → KHSX xem thử rồi bấm xác nhận là gửi lại y nguyên thứ vừa xem, FE không phải map lại.
- Validator dùng chung mới: `src/common/validators/stock-lengths-by-material.validator.ts`.

**Vì sao phải kiểm ở BE dù solver đã sanitize**: solver CỐ Ý bỏ qua lặng lẽ entry sai rồi rơi về
chiều dài chung ("khớp nhầm lặng lẽ tệ hơn bỏ qua" - đúng cho solver). Nhưng với người dùng thì
sai: KHSX chọn 5m85, hệ thống âm thầm cắt 6m, không ai biết. Nên BE bật lỗi ngay lúc gửi.

**CỐ Ý KHÔNG chặn theo `SystemConfig.solverStockLengths`**: danh sách đó hiện chỉ có `[6000]`,
chặn theo nó thì tính năng vô dụng. Đổi lại phải chấp nhận rủi ro đã ghi ở doc comment schema:
chọn cỡ NCC không bán được thì không ai phát hiện (Mua hàng vẫn mua cây chuẩn). Chỉ chặn sai đơn
vị (ngoài khoảng 500-20.000mm, bắt ca gõ 6 hoặc 600 thay vì 6000).

### 7.3 BE - đường chảy tới solver

`SolverJob.stockLengthsByMaterial` + 2 chỗ dựng job (1 lệnh SX / cả PI gộp) + gửi
`stock_lengths_by_material` trong request. Khoá = `Material.id` dạng chuỗi, **cùng cách đánh khoá**
với `maxWastePctByMaterial` đã có, nên khớp đúng field `material` trong `bom[]`.

### 7.4 BE - preview trên màn KHSX

`previewBatch()` resolve chiều dài theo TỪNG quy cách (helper mới `resolveStockLengths()`), và
`CuttingBatchPreviewLineDto` thêm `stockLengthMm` để FE hiện con số này đang nói về cây nào.

> **Đoạn dưới đây là quyết định SAI, đã đảo lại ở mục 7.6** (giữ để hiểu vì sao từng nghĩ vậy):
>
> *2 endpoint GET vẫn tính theo cây chuẩn — cố ý: `getBatchSuggestions()`/`getBatchCandidates()`
> là danh sách ứng viên dựng TRƯỚC khi KHSX chọn gì, không có ngữ cảnh đợt để mà áp. Đúng tiền lệ
> `solverMaxWastePctOverride`: chip ngưỡng trên bảng cũng hiện ngưỡng thường, đặc cách chỉ ảnh
> hưởng đợt.*

### 7.5 Kiểm tra

- `tsc --noEmit` sạch; `eslint` 0 lỗi (có 2 lỗi prettier trong spec, đã `--fix`).
- **Toàn bộ BE: 48 suite / 1054 test pass**, không hồi quy.
- Test mới: 7 test DTO (`solver-override.dto.spec.ts`), 2 test request gửi solver
  (`cutting-proposals.service.spec.ts`: gửi đúng dict / KHÔNG gửi key khi không chọn), 2 test
  preview (`cutting-batch-suggestions.service.spec.ts`: đổi cây thì đổi số; khoá lạ không kéo theo).
- **Live-test thật với container solver** (`localhost:18080`, cùng bộ nhu cầu, 2 loại sắt):

| Request | Loại 200 | Loại 300 |
| --- | --- | --- |
| `stock_lengths_by_material: {"200": 5850}` | **cây 5850**, 67 cây, 13,541% | cây 6000, 23 cây, 0,8203% |
| không gửi (`{}`) | cây 6000, 58 cây, 1,8537% | cây 6000, 23 cây, 0,8203% |

`resolved_stock_lengths_by_group` trả đúng `{"200":[5850],"300":[5850,6000]}`. Loại 300 KHÔNG đổi
gì giữa 2 lần - chứng minh lựa chọn chỉ tác động đúng một quy cách.

Ghi chú đọc bảng: ép 5m85 cho loại 200 làm hao hụt **tệ hơn hẳn** (13,5% so với 1,85%) vì đoạn
840mm không lấp gọn cây 5850. Đó là hành vi ĐÚNG, và cũng là lời nhắc: ô chọn này cho KHSX quyền
làm xấu phương án, nên FE nên hiện ngay hậu quả (khối "Nếu gộp" đã có sẵn số để làm việc đó).

### 7.6 SỬA LẠI: 2 bảng danh sách CŨNG phải tính lại theo cây đã chọn (cùng ngày)

Người dùng phản hồi kèm ảnh chụp cột "LOẠI SẮT · HAO HỤT KHI CẮT RIÊNG": *"ban đầu là 6m thì ra
kết quả như hình, khi sửa lại 5890 thì tự tính lại"*.

**Quyết định ở mục 7.4 sai.** Lập luận "danh sách dựng trước khi chọn nên không có ngữ cảnh" chỉ
đúng nếu ô chọn nằm ngoài màn này - nhưng ô chọn nằm NGAY TRÊN cùng màn, nên để chip đứng yên là
tạo ra đúng cái lỗi đã tự cảnh báo ở mục 5: chip nói cây 6m trong khi đợt sẽ cắt cây 5m85, lệch
nhau trên cùng một màn hình.

Tiền lệ `solverMaxWastePctOverride` cũng viện dẫn sai: ngưỡng đặc cách là thứ Sếp duyệt SAU, còn
chiều dài cây là thứ KHSX đang chỉnh ngay trước mắt để xem hệ quả.

**Đã làm**:

- `getBatchSuggestions(chosen?)` và `getBatchCandidates(chosen?)` nhận chiều dài đã chọn, resolve
  theo TỪNG quy cách ngay trong vòng lặp có sẵn (cả 2 hàm vốn đã dùng `stockLengths` bên trong
  vòng lặp theo loại sắt nên không phải đổi cấu trúc).
- `getBatchCandidates()` **truyền tiếp** lựa chọn xuống `getBatchSuggestions()` - nếu không, hệ
  thống tick sẵn một tổ hợp tính trên cây 6m trong khi bảng đang hiện số của cây 5m85.
- `CandidateMaterialDto` thêm `stockLengthMm` (giống dòng preview) để chip nói rõ đang tính trên
  cây nào.
- DTO query mới `BatchStockLengthsQueryDto` + controller nhận `@Query()`.

**Chỗ dễ vỡ nhất là query string, không phải tính toán.** Giá trị qua query luôn là **chuỗi** nên
phải ép kiểu trước khi validate - thêm `coerceStockLengthsFromQuery()` (chỉ dùng cho `@Query`,
KHÔNG dùng cho `@Body` vì body là JSON đã có số thật). Giá trị không ép được giữ NGUYÊN VĂN để
validator bật lỗi, không âm thầm bỏ qua. Nhưng bẫy thật sự thì chỉ live-test mới lộ, xem mục 7.7.

Test gọi thẳng service không bao giờ chạm chuyện đổi kiểu này, nên có file spec riêng cho lớp đó
(`cutting-batch-candidate.dto.spec.ts`, 6 test) - không có nó thì lỗi "chọn 5850 mà BE trả 400"
chỉ lộ ra lúc bấm thật trên FE.

**Kiểm tra**: thêm 2 test hành vi (đổi cây thì chip tính lại + đổi luôn tổ hợp tick sẵn) và 6 test
query DTO. Toàn bộ BE **49 suite / 1062 test pass**, tsc + eslint sạch.

Số đo khoá trong test: 840mm trên cây 5850 → tề đầu 10 còn 5840, cắt 6 đoạn hết 6×(840+1)=5046,
dôi 794 → hao hụt (10+794)/5850 = **13,744%** (vượt ngưỡng), so với 1,88% trên cây 6000. Lưu ý
công thức tính hao hụt trên CẢ CÂY và **tính cả phần tề đầu** - tính tay bỏ sót 10mm này sẽ ra
13,61% và tưởng code sai.

### 7.7 Live-test (2026-09-16) — bắt được bẫy query string mà unit test không thấy

Người dùng yêu cầu live-test. Dựng: `preview_start` server dev (port 3001), 2 đơn tạm `LIVE-01`
(BAN-J55 ×100) / `LIVE-02` (GHE-J55 ×60) dùng chung 3 loại sắt fixture, đăng nhập thật bằng tài
khoản `khsx`.

**Lần gọi đầu đã 400.** Unit test xanh hết, nhưng gọi thật `?stockLengthsByMaterial[7]=5850` thì
BE từ chối. Truy ra chuỗi nhân quả 2 tầng:

1. `qs` (bộ parse query của Express) thấy khoá thuần số `7` và `<= arrayLimit` (mặc định **20**)
   nên hiểu là **chỉ số mảng**, dựng ra mảng thưa `[ <7 chỗ trống>, "5850" ]` thay vì object.
2. `class-transformer` **NÉN mảng thưa** trước khi gọi `@Transform`, nên thứ tới tay code chỉ còn
   `[5850]` - **materialId đã bị xoá sạch**.

Đo thật để chắc: id **7** → khoá thành `"0"` (sai) và trả 400; id **25** → chạy bình thường. Tức
tính năng sống chết theo **id vật tư to hay nhỏ** - loại bug gần như không thể suy ra từ đọc code,
và unit test gọi thẳng service/DTO thì không bao giờ chạm tới.

**Đã xử lý**: hợp đồng query là **chuỗi gọn** `?stockLengthsByMaterial=7:5850,6:6000` (chạy đúng
với mọi id). Dạng object `[<id>]` vẫn nhận vì là dữ liệu hợp lệ nhưng KHÔNG phải hợp đồng (chỉ
đúng khi id > 20). **Mảng bị từ chối thẳng** kèm thông báo chỉ rõ cách sửa - cố "khôi phục" id từ
chỉ số là đoán bừa, mà đoán sai ở đây nghĩa là áp chiều dài cây cho NHẦM loại sắt rồi cắt thật.
Khoá lại bằng test riêng để sau này không ai "sửa" bằng cách map chỉ số.

**Kết quả live sau khi sửa** (`GET /api/v1/cutting-batch-candidates`, tài khoản `khsx`):

| Chip | Không chọn | Chọn `7:5850` | |
| --- | --- | --- | --- |
| BAN-J55 / SAT-VUONG-20X20 | 6000mm → 1,88% | 5850mm → **13,74%** | ĐÃ TÍNH LẠI |
| GHE-J55 / SAT-VUONG-20X20 | 6000mm → 0,27% | 5850mm → **0,29%** | ĐÃ TÍNH LẠI |
| BAN-J55 / SAT-VUONG-50X50 | 6000mm → 0,85% | 6000mm → 0,85% | giữ nguyên |
| BAN-J55 / SAT-HOP-25X50 | 6000mm → 0,17% | 6000mm → 0,17% | giữ nguyên |
| GHE-J55 / SAT-VUONG-50X50 | 6000mm → 6,62% | 6000mm → 6,62% | giữ nguyên |
| GHE-J55 / SAT-HOP-25X50 | 6000mm → 0,27% | 6000mm → 0,27% | giữ nguyên |

Đúng như thiết kế: chỉ loại sắt được chọn tính lại (ở CẢ 2 SKU dùng nó), 4 chip còn lại không
nhúc nhích. Con số 13,74% khớp chính xác unit test.

Sau đợt này: **49 suite / 1064 test pass**, tsc + eslint sạch.

### 7.8 Còn treo sau live-test

- **Dữ liệu tạm còn trên DB dev**: 2 đơn `LIVE-01`/`LIVE-02` + 2 dòng SKU chưa gom, tạo bằng
  `prisma/tmp-livetest-seed.ts`. Cố ý GIỮ LẠI để còn ứng viên mà dựng FE; xoá bằng
  `npx ts-node -r tsconfig-paths/register prisma/tmp-livetest-seed.ts --clean`.
- Chưa live-test đường POST (`previewBatch`, `mergeItems`/`claimSolo` có kèm chiều dài) - mới live
  đúng 2 endpoint GET dựng bảng. 2 đường POST nhận JSON body nên KHÔNG dính bẫy qs ở trên, và đã
  có test tự động; rủi ro thấp nhưng chưa xác nhận bằng mắt.
- ~~FE vẫn chưa làm~~ - **đã xong, xem mục 8.**

---

## 8. FE (`D:\DNA-ERP`, nhánh `demo`) — 2026-09-16

Chi tiết đầy đủ ở changelog repo FE: `docs/changelog-2026-09-16-chieu-dai-cay-theo-quy-cach.html`
(repo đó dùng changelog HTML, không phải Markdown). Tóm tắt phần ảnh hưởng tới BE:

- **Hợp đồng query đã được FE tuân thủ đúng**: `toStockLengthsQuery()` dựng chuỗi gọn
  `7:5850,6:6000`, KHÔNG dùng cú pháp ngoặc. Kiểm bằng network log khi live-test:
  `GET /cutting-batch-candidates?stockLengthsByMaterial=7%3A5850`.
- **Ô chọn theo QUY CÁCH, không theo SKU** - một loại sắt đúng một ô, gom thành thanh riêng trên
  bảng. Nhờ vậy khẳng định ở mục 4 (2 SKU gộp chung 1 loại sắt không thể chọn lệch nhau) là đúng
  trong thực tế FE chứ không chỉ trên lý thuyết.
- **FE hiện `stockLengthMm` do BE trả về**, không tự suy từ ô nhập - ô nhập là ý muốn, số BE trả
  mới là cây thật sự dùng để tính. Đây là lý do 2 field `stockLengthMm` thêm ở mục 7.4 là cần
  thiết chứ không thừa.
- **Debounce 400ms** trước khi gọi lại: không có thì gõ "5850" bắn 4 request và request của "5"
  (số vô lý) có thể về sau cùng rồi ghi đè kết quả đúng.

**Live-test đầu-cuối qua trình duyệt** (tài khoản `khsx`, FE :3000 ⇄ BE :3001): nhập 5850 cho
`SAT-VUONG-20X20` → chip của ĐÚNG loại đó đổi `≥1.88% → ≥13.74%` (BAN-J55) và `≥0.27% → ≥0.29%`
(GHE-J55), 4 chip loại khác đứng yên; khối "Nếu gộp" đổi `Bớt 4 cây` → `Bớt 5 cây`; 0 lỗi console;
lựa chọn tick 2 SKU giữ nguyên. Số khớp chính xác live-test BE ở mục 7.7.

**Còn treo**: chưa bấm thật nút "Xác nhận gộp"/"Tạo lệnh sản xuất riêng" để xem chiều dài có xuống
tới PI không (bấm sẽ tạo PI và làm rỗng bảng ứng viên). Hai đường dùng chung `solverOverride()`,
đã kiểm kiểu + có test tự động ở BE.

---

## 9. Vá 2 chỗ nói sai khi KHSX đã chọn chiều dài riêng (2026-09-16, cùng ngày)

Người dùng hỏi thử ca cụ thể: chọn 20x20=6000, 25x50=6000, 30x50=5800 rồi mới bấm mode "Chấp nhận
hao hụt cao hơn" — có tính đúng theo từng cỡ đã chọn không. Trả lời: **có**, nhưng khi trace ra
phát hiện **2 chỗ đã bị bỏ sót** ở đợt làm mục 7-8, cả hai đều là nói sai chuyện với Sếp trên màn
duyệt.

### 9.1 Bug — bằng chứng đặc cách vẫn tính trên cây chuẩn

`ProductionInvoicesService.buildOverrideEvidence()` gọi `previewBatch()` **không kèm**
`stockLengthsByMaterial` KHSX vừa chọn. Hệ quả: KHSX nhìn số ≥13,74% trên màn (đã tính đúng theo
cây 5800 nhờ mục 7-8) rồi xin đặc cách theo số đó, nhưng bằng chứng lưu vào PI lại tính lại trên
cây chuẩn 6000 (≥1,88%) — con số Sếp đọc được KHÔNG khớp con số KHSX nhìn thấy lúc xin.

Nặng hơn: ngưỡng đặc cách được solver áp lên **cây đang cắt**, không phải cây chuẩn (lọc cứng ngay
khâu sinh kiểu cắt - `de_xuat_logic.py::optimize_one_material`). Nên nếu Sếp duyệt đúng số bằng
chứng ghi (theo cây chuẩn) mà thực tế đang cắt cây 5800, số duyệt gần như chắc chắn KHÔNG đủ →
phương án FAILED sau khi đã ký, đúng vòng lặp vô ích từng cảnh báo ở changelog 09-14 mục 8.5.

**Đã vá**: `buildOverrideEvidence()` gọi `previewBatch()` kèm `solver?.solverStockLengthsByMaterial`.
`solverOverrideEvidence` thêm field `stockLengthMm` (cây mà `estimatedWastePct` được tính trên đó),
`undefined`/thiếu = bản ghi cũ trước ngày này, khi đó "cây chuẩn" vẫn đúng.

**Test khoá lại** (`production-invoices.service.spec.ts`): ca `{20x20:6000, 25x50:6000, 30x50:5800}`
— xác nhận `previewBatch` được gọi kèm đúng map, và bằng chứng lưu đúng vật tư/số/cây của quy cách
vượt ngưỡng nhất. BE **49 suite / 1065 test pass**.

### 9.2 FE — câu chữ ở màn Sếp duyệt (`LenhSXPage.tsx`) nói sai khi có cây riêng

Callout "Kế hoạch SX xin cắt đặc cách" có 2 câu ghi CỨNG theo giả định cũ (mọi thứ luôn là cây
chuẩn), nay sai khi KHSX chọn cây riêng:

1. Dòng `onlyStandard`: *"Chỉ mua **cây chuẩn**..."* — sai khi cỡ đã chọn là 5800, không phải
   chuẩn. Bản chất cờ này (`solverAllowCustomLength=false`) không đổi: solver không được tự dò cây
   khác. Chỉ câu chữ sai. **Người dùng chốt: chỉ hiển thị cây hiện tại, không thêm số cây chuẩn để
   so sánh.** Sửa thành: *"Giữ **đúng chiều dài đã định**, không cho hệ thống tự dò cây khác"* —
   đúng cho cả 2 ca (không chọn gì = cây chuẩn; có chọn = cây đó).
2. Dòng bằng chứng: *"...ở **cây chuẩn** ước tính hao ≥X%"* — ghi cứng "cây chuẩn". Sửa đọc
   `ev.stockLengthMm`: có giá trị thì nêu đúng cây đó (`ở cây 5800mm ước tính hao ≥13.74%`), thiếu
   (bản ghi cũ) thì giữ nguyên "cây chuẩn".

FE `tsc` sạch, `eslint` 0 lỗi (cảnh báo còn lại có sẵn từ trước), **38/38 test**.

### 9.3 Kiểm tra

- Đơn vị: BE 1065/1065, FE 38/38, đều pass.
- **Đã live-test qua trình duyệt (2026-09-16, lần 2)** - vai `boss`. Lần đầu BE dev server bị
  dừng giữa chừng (không do lỗi code - `preview_logs` xác nhận "stopped by the app") và Browser
  pane không mở được để bấm chuột; khởi động lại BE + pane hiển thị lại thì làm được.

  `PI-2026-001` không dùng được để test (status `PRODUCING`, không rơi vào danh sách "chờ Sếp
  duyệt" mà callout chỉ render ở đó) - dựng 1 PI TẠM `PI-VIEWTMP-001` đúng trạng thái
  (`status: PLANNING`, item `prodApprovalStatus: WAITING_BOSS`) kèm bằng chứng
  `{ materialCode: "SAT-HOP-30X50", estimatedWastePct: 13.74, stockLengthMm: 5800 }`.

  Kết quả đúng cả 2 chỗ vá: **"Giữ đúng chiều dài đã định, không cho hệ thống tự dò cây khác"** và
  **"SAT-HOP-30X50 ở cây 5800mm ước tính hao ≥13.74%"** - không còn chữ "cây chuẩn" ghi cứng. 0 lỗi
  console phát sinh từ trang này (lỗi console còn lại đều thuộc phiên đăng nhập lần đầu, trước khi
  BE khởi động lại). Đã xoá `PI-VIEWTMP-001` và dọn sạch `PI-2026-001` về đúng trạng thái ban đầu
  ngay sau khi xem (dùng `Prisma.DbNull` - lần dọn đầu lỡ dùng `undefined` nên Prisma hiểu là
  "giữ nguyên field" chứ không xoá, phải dọn lại lần 2 mới sạch).

## Còn treo (cập nhật)

- Live-test đường POST (`mergeItems`/`claimSolo` mang chiều dài xuống PI) — vẫn treo từ mục 7.8.
- ~~live-test câu chữ callout duyệt ở mục 9.2~~ — **đã xong, xem mục 9.3.**

---

## 10. Sửa nốt ô tick gốc ở màn KHSX (`GomDotCatPage.tsx`) — cùng ngày

Sau khi live-test qua Duyệt thật (mục 11), phát hiện mục 9.2 mới sửa câu chữ ở màn SẾP ĐỌC
(`LenhSXPage.tsx`), quên sửa ô tick GỐC mà KHSX thực sự bấm (`GomDotCatPage.tsx:504`) — vẫn ghi
"Chỉ mua cây chuẩn (khỏi chờ nhà cung cấp cán cây riêng)", sai nghĩa khi KHSX đã chọn cây riêng
rồi mới tick (đúng ca vừa live-test: chọn 5850 cho SAT-VUONG-50X50, tick ô này để giữ nguyên).

**Đã sửa**: đổi thành **"Giữ đúng chiều dài đã định, không cho hệ thống tự dò cây khác"** — khớp
NGUYÊN VĂN với câu đã sửa ở `LenhSXPage.tsx` mục 9.2, để Sếp đọc đúng y chang thứ KHSX vừa tick,
không phải một cách diễn đạt khác đi.

Live-test qua trình duyệt (vai `khsx`, tick "Chấp nhận hao hụt cao hơn"): nhãn hiện đúng, 0 lỗi
console phát sinh từ trang. FE `tsc` sạch, eslint 0 lỗi mới, 38/38 test.

## 11. Live-test đầu-cuối qua nút Duyệt thật — solver chạy thật, đúng thiết kế

Người dùng yêu cầu live-test qua đúng nút "Duyệt" để xem solver có chạy hay không, không dừng ở
việc xem câu chữ. Đi trọn luồng thật với dữ liệu `LIVE-01`/`LIVE-02`:

**KHSX** (`GomDotCatPage.tsx`): mở "Tối ưu cắt sắt", chọn `5850` cho `SAT-VUONG-50X50`, tick 2 SKU,
bấm "Xác nhận gộp" → tạo `PI-2026-002`. Xác nhận thẳng qua DB: `solverStockLengthsByMaterial: {"5":
5850}`, và **quan trọng nhất** - `solverOverrideEvidence.estimatedWastePct: 0.291` khớp CHÍNH XÁC
con số hiển thị trên màn ("Nếu gộp" → ≥0.29%) - bằng chứng sống rằng bản vá mục 9.1 (bằng chứng
tính theo đúng chiều dài đã chọn) hoạt động thật, không chỉ đúng trên test giả lập.

**KHSX** → "Gửi QLSX" → **QLSX** (`qlsx`/demo1234): "Chọn kho sản xuất" → callout hiện đúng
*"SAT-VUONG-50X50 ở cây 5850mm ước tính hao ≥0.29%"* → "Gửi sếp duyệt". **Sếp** (`boss`/demo1234):
callout giống hệt, bấm "Duyệt cả đợt (2 SKU)" → dialog xác nhận (không thể hoàn tác) → "Xác nhận
duyệt".

**Kết quả thật từ CuttingProposal (không phải mock)**:

| Loại sắt (id) | `bestStockLengthMm` | `lengthSource` | Hao hụt thực |
| --- | --- | --- | --- |
| **5 = SAT-VUONG-50X50** (KHSX ép 5850) | **5850** | `fixed` | 1.75% |
| 6 = SAT-HOP-25X50 | 6000 | `fixed` | 0.17% |
| 7 = SAT-VUONG-20X20 | 6000 | `fixed` | 0.50% |

`lengthSource: "fixed"` xác nhận solver dùng ĐÚNG cây bị ép, không tự dò sang cây khác - đúng hành
vi `solverAllowCustomLength=false` phải đảm bảo. `CuttingProposal.status = APPROVED`,
`PI.status = PRODUCING`. Cả 4 vai (KHSX/QLSX/Sếp/solver) đều chạy thật, không giả lập bước nào.

**Đã dọn sạch sau khi xem**: xoá `PI-2026-002` + mọi bản ghi phụ thuộc (cutting_proposals,
production_orders, purchase_proposals, stock_ledger, stock_reservations...) + `LIVE-01`/`LIVE-02`,
dựng lại `stock_quant` từ ledger còn lại (14 dòng, khớp `PO-1`). DB dev trở về đúng nền tảng
(1 đơn hàng / 1 PI / 1 lệnh SX / 2 phương án cắt của `PO-1`).

## Còn treo (cập nhật)

- ~~Live-test đường POST (mergeItems mang chiều dài xuống PI)~~ — **đã xong, xem mục 11.**
- ~~Ô tick "Chỉ mua cây chuẩn" ở màn KHSX nói sai~~ — **đã xong, xem mục 10.**
- Chưa live-test đường `claimSolo` (cắt riêng 1 SKU, không gộp) - chỉ mới test đường `mergeItems`.
  Dùng chung `SolverOverrideDto` + đã có test tự động, rủi ro thấp.

---

## 12. Live-test kỹ hơn — claimSolo + ca biên trên UI (cùng ngày)

Người dùng yêu cầu live-test kỹ hơn. Mở rộng ra đúng những chỗ còn treo: đường `claimSolo`, và các
ca biên trên UI chưa test trước đó (giá trị ngoài khoảng, nút "Về cây chuẩn").

### 12.1 Ca biên trên ô nhập chiều dài (`GomDotCatPage.tsx`)

- **Nhập `300` (dưới 500mm)**: viền đỏ + thông báo *"Chiều dài phải từ 500 đến 20000mm..."* hiện
  NGAY khi gõ, không cần đợi submit. Kiểm bằng `performance.getEntriesByType('resource')`: request
  gửi đi sau debounce **KHÔNG mang query string nào** - giá trị không hợp lệ bị `stockLengths`
  (useMemo) tự loại trước khi gọi API, đúng thiết kế "ô đang gõ dở/sai khoảng không được gửi đi".
- **Nút "Về cây chuẩn"**: xoá sạch `stockLenInput`, mọi ô về placeholder 6000, và chính nút này tự
  ẩn đi (đúng điều kiện `Object.keys(stockLengths).length > 0`) - không còn gì để "về" thì không
  hiện nút hoàn tác nữa.
- **Giá trị hợp lệ biên dưới (5000mm)**: chấp nhận, ô hiện đậm + viền cam như thiết kế.

### 12.2 Đường `claimSolo` (cắt riêng 1 SKU, không gộp) — chưa từng live-test trước đợt này

Dựng `LIVE-SOLO` (BAN-TRA-J55 ×30, dùng chung 3 loại sắt với BAN-J55/GHE-J55 nhưng test ĐỘC LẬP,
không gộp). Cả 3 loại đều vượt ngưỡng khi ở cây chuẩn (`≥13.90%`, `≥2.25%`... cận dưới, tính riêng
1 SKU thì càng cao hơn: 20x20 tới 20%+). Chọn `5850` cho cả 3, tick "Chấp nhận hao hụt cao hơn",
xin 12%, bấm **"Tạo lệnh sản xuất riêng cho SKU này"** (nút `claimSolo`, khác nút `mergeItems` đã
test ở mục 11).

Xác nhận qua DB: `isMerged: false` (đúng là `claimSolo`, không phải `mergeItems`),
`solverStockLengthsByMaterial: {"5":5850,"6":5850,"7":5850}`, bằng chứng ghi loại vướng nhất
(`SAT-VUONG-20X20`, `11.692%`) - khớp callout Sếp đọc được ở cả 2 màn QLSX và Sếp duyệt.

Đẩy trọn luồng **KHSX → QLSX → Sếp → Duyệt** như mục 11, solver chạy thật:

| Loại sắt (id) | `bestStockLengthMm` | `lengthSource` | Hao hụt thực |
| --- | --- | --- | --- |
| 5 = SAT-VUONG-50X50 | 5850 | `fixed` | 5.73% |
| 6 = SAT-HOP-25X50 | 5850 | `fixed` | 3.67% |
| 7 = SAT-VUONG-20X20 | 5850 | `fixed` | 11.69% |

Cả 3 dưới ngưỡng 12% đã xin. `CuttingProposal.status = APPROVED`, `PI.status = PRODUCING`.
**Đường `claimSolo` hoạt động đúng y hệt `mergeItems`** - đúng như kỳ vọng vì cả 2 dùng chung
`SolverOverrideDto` và cùng gọi `buildOverrideEvidence()`.

### 12.3 Dọn dẹp + kiểm tra cuối

Xoá `PI-2026-002` (lần 2, ca solo) + `LIVE-SOLO` + mọi bản ghi phụ thuộc, dựng lại `stock_quant` từ
ledger còn lại. DB dev trở về đúng nền tảng (1 đơn hàng / 1 PI / 1 lệnh SX / 2 phương án cắt của
`PO-1`, `stock_quant` 14 dòng). Chạy lại toàn bộ: BE **49 suite / 1065 test**, FE **5 file / 38
test** - đều pass, không hồi quy sau 2 vòng live-test liên tiếp.

## Còn treo (cập nhật)

- ~~Chưa live-test đường claimSolo~~ — **đã xong, xem mục 12.2.**
- Chưa test: 2 SKU merge mà MỘT SKU dùng loại sắt ngoài phạm vi chọn (loại đó phải tự rơi về cây
  chuẩn) - đã có unit test (`test_key_khong_khop_loai_nao_thi_tat_ca_dung_chung`) nhưng chưa xác
  nhận qua UI thật.
- Chưa test responsive (khung hẹp) và dark mode cho thanh chọn chiều dài mới thêm - ngoài phạm vi
  yêu cầu lần này (chỉ xoay quanh hành vi solver), ghi lại để không quên.

---

## 13. Xác nhận nốt "loại sắt ngoài phạm vi chọn" — dữ liệu trả về thật, không qua mock

Việc còn treo duy nhất có ý nghĩa nghiệp vụ (mục "Còn treo" ở mục 12): gán chiều dài cho một loại
sắt KHÔNG thuộc phạm vi đợt gộp - xác nhận nó không gây ảnh hưởng gì tới các loại sắt thật sự được
cắt.

**Dựng ca**: `LIVE-01`(BAN-J55)/`LIVE-02`(GHE-J55) dùng chung 3 loại sắt (`SAT-VUONG-20X20`,
`SAT-HOP-25X50`, `SAT-VUONG-50X50`); `E2E-BAN-01` dùng `E2E-SAT-25` - HOÀN TOÀN khác, không SKU nào
khác dùng chung. Gán `6500mm` cho `E2E-SAT-25`, rồi CHỈ tick BAN-J55 + GHE-J55 để gộp (không đụng
E2E-BAN-01).

**Bắt được lỗi thao tác, không phải lỗi code**: `form_input` (đặt `checked` qua DOM property) trên
checkbox React controlled **không kích hoạt `onChange`** - React state `selected` không đổi dù
checkbox hiện `checked` trên màn. Đổi sang `computer left_click` (sự kiện chuột thật) thì đúng ngay.
Ghi lại vì đây là bẫy chung của mọi checkbox React trong repo, không riêng gì trang này.

**Xác nhận qua dữ liệu trả về thật (không phải giả lập)**:

1. Network request GET candidates: `?stockLengthsByMaterial=1%3A6500` - CHỈ đúng 1 khoá
   (`E2E-SAT-25`), 3 chip của BAN-J55/GHE-J55 đứng nguyên `≥1.88%/≥0.85%/≥0.17%` như cây chuẩn.
2. Sau "Xác nhận gộp": `ProductionInvoice.solverStockLengthsByMaterial = {"1":6500}` - field vô hại
   được LƯU nguyên (echo), dù không SKU nào trong PI dùng vật tư đó.
3. **Bằng chứng mạnh nhất - sau khi Duyệt, solver chạy thật**: `CuttingProposal` chỉ có ĐÚNG 3
   dòng, không dòng nào cho `materialId=1`. Tức lựa chọn ngoài phạm vi không tạo ra bất kỳ ảnh
   hưởng nào lên kết quả cắt thật - không phải "bị bỏ qua nhưng vẫn làm gì đó ngầm", mà THỰC SỰ
   không chạm tới đường tính toán của 3 loại sắt kia.

Kết quả solver ca này còn cho thấy hành vi đúng khác (ngoài phạm vi yêu cầu, ghi nhận thêm): 2/3
loại sắt tự CHUYỂN SANG `lengthSource=scan` với chiều dài lạ (5270mm/5900mm) dù KHÔNG xin đặc cách
gì - vì nhu cầu GỘP THẬT (khác số preview ước tính riêng lẻ) không đạt ngưỡng 1% ở cây 6000, và
`solverAllowCustomLength` mặc định công ty đang `true` nên tự dò. Đúng thiết kế đã ghi ở changelog
09-16 mục "review DNA-DEXUAT" - không phải bug.

**Đã dọn sạch** dữ liệu test, DB dev về đúng nền tảng (`sales_orders=1, production_invoices=1,
production_orders=1, cutting_proposals=2, stock_quant=14` - của `PO-1`).

## Còn treo (cập nhật)

- ~~Loại sắt ngoài phạm vi chọn~~ — **đã xác nhận qua dữ liệu thật, xem mục 13.**
- Responsive/dark mode: người dùng xác nhận KHÔNG cần test - chỉ quan tâm dữ liệu trả về, không
  phải trình bày giao diện. Bỏ khỏi danh sách còn treo.

**Tất cả trường hợp có ý nghĩa nghiệp vụ (dữ liệu solver trả về) đã được xác nhận qua UI thật, dữ
liệu thật, không qua mock**: mergeItems (mục 11), claimSolo (mục 12), loại sắt ngoài phạm vi
(mục 13). Không còn việc nào treo cho tính năng này.

---

## 14. Live-test lại đầu-cuối sau sự cố commit — phát hiện bẫy dev-tooling + xác nhận Case 2 bằng dữ liệu thật

Người dùng gặp lỗi `pre-commit` (husky/lint-staged) chặn commit vì `prisma/tmp-livetest-seed.ts` có
lỗi ESLint (`no-unsafe-member-access` ở `e.message` trong catch). Người dùng tự xoá file đó. Sau
đó yêu cầu live-test lại từ đầu.

### 14.1 Bẫy dev-tooling: viết file mới trong `prisma/` có thể GIẾT server đang chạy

Khi tạo file kiểm tra kết quả (`prisma/e2e-check.ts`) NGAY SAU lúc bấm Duyệt (solver đang chạy nền,
fire-and-forget), BE server tự khởi động lại — `CuttingProposal` bị kẹt vĩnh viễn ở `CALCULATING`,
không có cách nào tiếp tục (job đã bị giết giữa chừng).

Truy nguyên nhân: `nest-cli.json` có `"assets": [{ "include": "../prisma/**/*", "watchAssets": true }]`
— Nest theo dõi TOÀN BỘ thư mục `prisma/`, không chỉ `src/`. Thử lại cẩn thận hơn thì bắt được lỗi
nặng hơn: `AssetsManager` của `@nestjs/cli` không bắt được exception khi copy asset gặp file `.tmp`
tạm thời (do cơ chế ghi nguyên tử của công cụ Write - ghi ra `.tmp.<pid>.<hash>` rồi rename) đã bị
rename xong trước khi watcher kịp copy → `ENOENT` không được catch → **crash toàn bộ tiến trình
Node**, không chỉ riêng watcher.

**Bài học cho các lần live-test sau**: viết BẤT KỲ file nào vào `prisma/` trong lúc BE dev server
đang chạy (đặc biệt khi có job fire-and-forget đang xử lý, như `runSolverAndSave()`) là rủi ro thật,
không phải giả thuyết. Cách né: gộp mọi thao tác seed/check/clean vào **một file duy nhất tạo TRƯỚC
khi bắt đầu luồng**, chỉ RUN (không WRITE) file đó trong lúc chờ kết quả, và chỉ xoá file sau khi đã
lấy xong toàn bộ dữ liệu cần kiểm.

### 14.2 Làm lại toàn bộ - lần này không xin đặc cách, chỉ chọn chiều dài + mode Bình thường

Khác các lần trước (luôn kèm "Chấp nhận hao hụt cao hơn"), lần này CHỈ chọn `5850mm` cho
`SAT-VUONG-20X20` rồi xác nhận gộp ở mode **Bình thường (mặc định)** - chưa từng test tổ hợp này.
Xác nhận không hiện callout đặc cách ở cả màn QLSX lẫn Sếp duyệt (đúng - không có gì để hiện).

### 14.3 Phát hiện quan trọng - xác nhận bằng dữ liệu thật đúng Case 2 đã cảnh báo từ đầu

Kết quả `CuttingProposal` sau Duyệt:

| Loại sắt | KHSX chọn | `bestStockLengthMm` thật | `lengthSource` |
| --- | --- | --- | --- |
| SAT-VUONG-20X20 (id 7) | **5850** | **5900** | **`scan`** |
| SAT-VUONG-50X50 (id 5) | không chọn | 5270 | `scan` |
| SAT-HOP-25X50 (id 6) | không chọn | 6000 | `fixed` |

**Cây KHSX chọn (5850) KHÔNG được dùng** - solver cắt 5900! Đây đúng "Case 2" đã cảnh báo lúc mới
review `DNA-DEXUAT` (trước khi viết code): chiều dài chọn chỉ ràng buộc bước "fixed" của
`optimize_one_material()`; nhánh `auto_scan` (kích hoạt khi `solverAllowCustomLength` mặc định công
ty đang `true` và KHSX không tick "Giữ đúng chiều dài đã định") quét ĐỘC LẬP trong dải
`[solverMinLengthMm, solverMaxLengthMm]`, KHÔNG bị giới hạn bởi lựa chọn của KHSX. Nhu cầu GỘP THẬT
ở 5850mm không đạt ngưỡng 1% nên solver tự tìm cây khác - đúng thiết kế, không phải bug, nhưng là
điều KHSX cần biết: **chọn cây riêng mà không tick "Giữ đúng chiều dài đã định" thì lựa chọn đó chỉ
là ưu tiên, không phải cam kết.**

Đối chiếu với live-test mục 11 (CÓ tick "Giữ đúng chiều dài đã định"): cả 3 loại đều `lengthSource:
fixed`, đúng cây đã chọn tuyệt đối. Hai lần live-test này bổ sung nhau, xác nhận đầy đủ cả 2 nhánh
hành vi bằng dữ liệu thật.

`CuttingProposal.status = APPROVED`, PI chuyển `PRODUCING`, tổng `wastePct = 0.222%`.

### 14.4 Dọn dẹp + kiểm tra cuối

Dùng đúng 1 file (`prisma/e2e-run.ts`, gộp seed/check/clean) tạo 1 lần duy nhất trước khi bắt đầu,
không viết thêm file nào vào `prisma/` cho tới khi xoá sạch ở bước cuối. Xoá PI kẹt từ lần thử đầu
(mục 14.1) + dữ liệu PI-2026-002 lần 2 + toàn bộ file tạm. DB dev về đúng nền tảng
(`sales_orders=1, production_invoices=1, production_orders=1, cutting_proposals=2, stock_quant=14`).
Chạy lại toàn bộ: BE **49 suite / 1065 test pass**.

## Còn treo (cập nhật)

Không còn việc nào treo cho tính năng. Ghi nhận rủi ro vận hành dev-tooling ở mục 14.1 để tránh lặp
lại ở các phiên live-test sau (không phải việc của tính năng này, nhưng ảnh hưởng trực tiếp cách
live-test được thực hiện).

---

## 15. Xác nhận đến tận Mua hàng - toàn chuỗi KHSX → Sếp duyệt → solver → Mua hàng (2026-09-17)

Người dùng hỏi: UI/UX từ KHSX tới Sếp duyệt qua solve rồi về Mua hàng đã ổn thoả hết chưa. Trước
đó chưa soát khâu Mua hàng trong toàn bộ đợt làm tính năng này.

### 15.1 Phát hiện: đường ống đã có sẵn từ trước (2026-08-26), không phải phần vừa làm

`PurchaseProposalItem.stockLengthMm` đã tồn tại sẵn, copy thẳng từ
`CuttingProposalLine.bestStockLengthMm` lúc `approve()` (comment trong code: *"PurchaseProposalItem
.stockLengthMm giờ copy thẳng từ bestStockLengthMm lúc approve()"*) - xây cho tính năng auto_scan
mở lại ngày 2026-08-26, KHÔNG phải phần chọn-chiều-dài-theo-quy-cách vừa làm. FE
`Purchasing/LenhMuaNCCPage.tsx` cũng đã có sẵn `ItemName()` hiện `· cây Xmm` cho MỌI chiều dài khác
6000, với đúng lý do đã ghi trong code: *"buyQty vô nghĩa nếu Purchasing không biết đặt cây dài bao
nhiêu, nhất là từ khi solver có thể đề xuất cây KHÁC 6000mm mặc định"*.

Vì tính năng mới chỉ đổi GIÁ TRỊ mà `bestStockLengthMm` nhận (do KHSX chọn thay vì auto_scan tự
tìm), không đổi CÁCH field đó chảy xuống hạ nguồn, nên toàn bộ đường ống cũ tự động đúng mà không
cần sửa gì thêm - đã xác nhận bằng cách đọc code, và LIVE-TEST lại để chắc chắn không có gì khác đi.

### 15.2 Live-test: đi trọn KHSX → QLSX → Sếp duyệt → solver → Mua hàng

Chọn `5850mm` cho `SAT-VUONG-20X20`, tick "Giữ đúng chiều dài đã định" (để chắc chắn không rơi vào
Case 2 đã ghi ở mục 14.3), xin đặc cách 15%, đi hết luồng.

**Kết quả solver** (khớp lựa chọn tuyệt đối nhờ có tick giữ nguyên):

| Loại sắt | KHSX chọn | `bestStockLengthMm` | `lengthSource` |
| --- | --- | --- | --- |
| SAT-VUONG-20X20 | 5850 | **5850** | `fixed` |
| SAT-VUONG-50X50 | không chọn | 6000 | `fixed` |
| SAT-HOP-25X50 | không chọn | 6000 | `fixed` |

**`PurchaseProposal` tự sinh sau khi duyệt** (không cần thao tác gì thêm):

| Vật tư | `stockLengthMm` | `buyQty` |
| --- | --- | --- |
| SAT-VUONG-50X50 | 6000 | 63 |
| SAT-HOP-25X50 | 6000 | 111 |
| SAT-VUONG-20X20 | **5850** | 34 |

**Đăng nhập thật tài khoản `muapsh`** (Mua hàng - kho Phôi Sơn Hàn, đúng kho đề xuất thuộc về) →
`LenhMuaNCCPage.tsx` hiện đúng:

> Sắt vuông 50×50 · cây 6000mm — Cần mua 63
> Sắt hộp 25×50 · cây 6000mm — Cần mua 111
> **Sắt vuông 20×20 · cây 5850mm — Cần mua 34**

Đúng chiều dài KHSX chọn hiện NGUYÊN VẸN trên màn Mua hàng thật, không lệch không thiếu. 6 lỗi
console 403 xuất hiện khi mở trang - kiểm tra là ĐÚNG THIẾT KẾ (chặn xem "Lịch sử hoạt động" cho
tài khoản không phải Admin/Giám đốc), trang tự bắt và hiện thông báo thân thiện, không phải lỗi
thật.

### 15.3 Sự cố môi trường gặp phải (không liên quan tính năng)

Máy đã khởi động lại từ phiên trước - Docker Desktop (chứa solver + Postgres) và cả BE/FE dev
server đều tắt. Phải khởi động lại Docker Desktop qua PowerShell, đợi container lên, rồi mới
seed/test được. Ghi lại vì đây là bước cần làm mỗi khi bắt đầu phiên live-test mới sau khi máy
khởi động lại, không phải lỗi của tính năng.

### 15.4 Kết luận cho câu hỏi UI/UX

**Đã ổn thoả từ KHSX tới Mua hàng.** Không phát hiện chỗ nào lệch, thiếu, hay hiện sai. Chuỗi hoạt
động đúng nhờ tái dùng hạ tầng có sẵn (`bestStockLengthMm` → `PurchaseProposalItem.stockLengthMm`
→ hiển thị FE) từ tính năng auto_scan cũ, mà tính năng chọn-theo-quy-cách mới chỉ là MỘT NGUỒN
KHÁC ghi vào đúng field đó.

## Còn treo (cập nhật)

Không còn việc nào treo. Tính năng đã được xác nhận đầu-cuối qua UI thật, dữ liệu thật, từ lúc KHSX
chọn chiều dài tới lúc Mua hàng nhìn thấy đúng cây cần đặt.

---

## 16. Live-test riêng cho UI/UX (2026-09-17)

Người dùng yêu cầu live-test tập trung vào chất lượng trải nghiệm (rõ ràng, phản hồi, luồng thao
tác), khác các đợt trước chỉ soát đúng dữ liệu. Dựng ca **3 SKU** (UX-01/02/03, dùng
BAN-J55/GHE-J55/GHE-TY-J55) - phép gộp 3 chiều chưa từng test trước đó (mọi lần trước chỉ 2 SKU).

### 16.1 Sự cố công cụ: đặt kích thước tuỳ chỉnh làm click theo `ref` trật hướng

Khi gọi `resize_window` với `width/height` tuỳ chỉnh (1280×900) rồi tiếp tục click theo `ref`, các
click KHÔNG trúng đúng phần tử (gõ "5850" vào ô chiều dài lại đổi trạng thái tick của một SKU khác).
Nguyên nhân: ảnh chụp bị co lại theo tỷ lệ (1280×900 → ảnh trả về chỉ 800×562) nhưng toạ độ click
theo `ref` dường như tính theo khung logic đầy đủ, lệch khung so với khung ảnh đã co. Khắc phục:
trả kích thước về mặc định của pane (`resize_window` preset `desktop`, không đặt số tuỳ chỉnh) rồi
mới thao tác - lúc đó `ref` trỏ đúng, xác nhận bằng `document.activeElement` sau mỗi click quan
trọng thay vì tin ảnh chụp.

**Ghi lại cho các phiên live-test sau**: tránh đặt `width/height` tuỳ chỉnh cho `resize_window` khi
cần độ chính xác cao lúc click bằng `ref`; nếu bắt buộc phải đổi kích thước (test responsive), nên
dùng `find`/`read_page` lấy `ref` MỚI ngay sau khi resize thay vì tái dùng toạ độ từ ảnh chụp cũ, và
xác nhận bằng `document.activeElement` sau click quan trọng.

### 16.2 Kiểm tra ca 3 SKU (chưa test trước đây) — không phát hiện lỗi

- Lưới chọn chiều dài với 4 loại sắt: không tràn ngang ở 1280px (`document.body.scrollWidth ===
  document.documentElement.clientWidth`), không lỗi bố cục.
- Đổi 1 ô: đúng nhãn đậm + viền cam + giá trị đậm, 3 ô còn lại giữ nguyên xám nhạt - tín hiệu thị
  giác rõ ràng, không mơ hồ ô nào vừa đổi.
- Gộp 3 SKU: `SAT-VUONG-20X20` (chọn 5850mm) từ hao hụt riêng lẻ 13.74%/0.29%/0.77% xuống còn
  **0.17%** khi cắt chung cả 3 - đúng logic, dòng "SKU cùng dùng" liệt kê đủ
  `BAN-J55 + GHE-J55 + GHE-TY-J55` không bị cắt bớt.
- 3 lựa chọn tick giữ nguyên qua các lần tải lại do đổi chiều dài (đúng thiết kế mục 3 changelog
  09-16 gốc).
- Modal "Chọn kho thành phẩm" mở rộng đúng cho 3 SKU (3 khối input riêng biệt, không cách nhau chật
  chội); nút "Gửi sếp duyệt (3 SKU)" tự vô hiệu tới khi đủ kho - affordance rõ ràng; "Áp dụng nhanh
  cho tất cả" áp đúng cho cả 3 cùng lúc.
- Trang chi tiết PI xếp 3 thẻ SKU dọc, không tràn, không chật.
- Callout đặc cách ĐÚNG THEO Ý: không mở "Chấp nhận hao hụt cao hơn" ở lượt này -> không hiện
  callout ở cả màn KHSX lẫn QLSX/Sếp, nhất quán với hành vi đã xác nhận ở mục 11.

### 16.3 Kiểm tra hành vi kỹ thuật (không phải nhìn bằng mắt)

- **Bàn phím**: `Tab` từ ô SAT-VUONG-20X20 chuyển đúng sang SAT-VUONG-50X50 (thứ tự DOM theo đúng
  thứ tự hiển thị, không có "bẫy" tab lạc hướng); input KHÔNG nằm trong `<form>` nên `Enter` không
  vô tình kích hoạt submit nào.
- **Debounce/loading**: đặt `MutationObserver` theo dõi dòng "Đang tải…" trong lúc gõ và đợi
  debounce chạy - KHÔNG bắt được lần nào dòng này xuất hiện trong điều kiện mạng cục bộ (phản hồi
  quá nhanh). Tức trên mạng thật CÓ THỂ có, nhưng chưa quan sát được trực tiếp; ghi lại như một khả
  năng chưa xác nhận, không phải lỗi đã xác nhận.
- Console không phát sinh lỗi mới trong toàn bộ phiên (ngoài các lỗi cũ đã biết từ trước, không
  liên quan).

## Còn treo (cập nhật)

- **Mới, chưa xác nhận**: dòng "Đang tải…" có gây giật layout trên mạng chậm hơn mạng cục bộ hay
  không - chưa tái hiện được để xác nhận chắc chắn, cần thử với mạng thật hoặc giả lập độ trễ mạng
  nếu muốn kết luận dứt điểm.
- Không phát hiện lỗi UI/UX nào khác qua đợt live-test này (bố cục, tương tác, bàn phím, phản hồi
  trạng thái, wording đều nhất quán và rõ ràng ở ca 3 SKU).

---

## 17. Đo hiệu năng thật - chưa từng test trước đợt này (2026-09-17)

Người dùng hỏi đã test performance chưa. Câu trả lời trung thực: **chưa** - mọi đợt trước chỉ soát
đúng dữ liệu và UI/UX, chưa đo thời gian phản hồi. Đây đúng là khoảng trống, đặc biệt vì đã có cảnh
báo LÝ THUYẾT từ lúc mới review `DNA-DEXUAT` (rủi ro nhánh `auto_scan` có thể tốn tới ~33 phút nếu
mọi lần quét đều chạm trần 20s) nhưng chưa bao giờ ĐO THẬT để biết rủi ro đó lớn tới đâu trong thực
tế.

### 17.1 Cấu hình solver hiện tại (nguồn của phép tính lý thuyết)

`solverMinLengthMm=5000, solverMaxLengthMm=6000, solverLengthStepMm=10, solverTimeLimitSeconds=20`
→ dải quét `auto_scan` = 101 lần gọi CP-SAT, mỗi lần trần 20s → lý thuyết tối đa **~33,7 phút** cho
MỘT loại sắt nếu mọi lần quét đều chạm trần.

### 17.2 Đo thật - gọi thẳng solver, KHÔNG qua BE, đo bằng `time` của shell

Cố tình đặt ngưỡng hao hụt gần bất khả thi (0.001%-0.05%) để BUỘC toàn bộ 101 lần quét đều phải
chạy hết (không dừng sớm vì đạt ngưỡng), đo tổng thời gian thực (wall-clock):

| Số cỡ đoạn khác nhau | Tổng nhu cầu | Thời gian thật (101 lần quét) | Trung bình/lần |
| --- | --- | --- | --- |
| 1 | 50 | **0.22s** | ~2ms |
| 4 | 400 | **0.28s** | ~2.8ms |
| 8 | 680 | **6.7s** | ~66ms |
| 12 | 915 | **58.9s** | ~583ms |

`timed_out: false` ở MỌI ca - không lần quét đơn lẻ nào chạm trần 20s, kể cả ca 12 cỡ chậm nhất.
Tức tổng thời gian dài là do CỘNG DỒN 101 lần quét chậm dần, không phải do một lần bị treo.

**Cô lập biến số**: chạy lại đúng ca 12 cỡ với `max_surplus` nới từ 10 lên 50 (x5) - thời gian GẦN
NHƯ KHÔNG ĐỔI (59.4s so với 58.9s). Kết luận: **thủ phạm là SỐ CỠ ĐOẠN KHÁC NHAU trên cùng một loại
sắt, không phải trần cắt dư** - khác với nghi vấn ban đầu khi đọc code.

Đối chiếu code: `de_xuat_logic.py` có sẵn `MAX_SIZES_PER_BAR = 4` - giới hạn mỗi cây chỉ thử tối đa
4 cỡ đoạn/lượt sinh kiểu cắt ĐẦU TIÊN, chỉ rơi về không giới hạn nếu lượt giới hạn đó không sinh
được kiểu cắt nào. Ca 12 cỡ (vượt trần 4) nhiều khả năng đã rơi vào nhánh không giới hạn này -
đúng chỗ combinatorics bùng nổ.

### 17.3 Đánh giá rủi ro thực tế cho catalog hiện tại

Dữ liệu BOM thật hiện có (4 SKU: BAN-J55, GHE-J55, GHE-TY-J55, BAN-TRA-J55) khi gộp chung 1 loại
sắt chỉ tạo ra **2-4 cỡ đoạn khác nhau** (nhiều SKU dùng trùng cỡ, vd GHE-J55 và GHE-TY-J55 cùng
450mm) - nằm gọn trong vùng AN TOÀN (dưới 0.3s). **Rủi ro chưa xảy ra hôm nay**, nhưng là điều cần
theo dõi khi catalog sản phẩm lớn lên - mỗi loại sắt dùng chung bởi càng nhiều SKU có cỡ đoạn càng
đa dạng thì càng tiến gần vùng chậm.

**Quan trọng**: `runSolverAndSave()` xử lý TUẦN TỰ từng loại sắt (vòng `for` qua `material_groups`,
không song song) - nếu MỘT PI gộp nhiều loại sắt mà NHIỀU loại cùng cần quét (không đạt ngưỡng ở
cây chuẩn), thời gian CỘNG DỒN qua từng loại, không phải chỉ tính loại chậm nhất.

### 17.4 Liên hệ với tính năng chọn-chiều-dài-theo-quy-cách

Rủi ro hiệu năng này CÓ SẴN TỪ TRƯỚC (thuộc cơ chế `auto_scan`, 2026-08-26), không phải do tính
năng mới tạo ra. Nhưng tính năng mới làm rủi ro DỄ XẢY RA HƠN theo 2 hướng đã xác nhận ở mục 14:

- Loại sắt KHSX KHÔNG chọn chiều dài riêng vẫn dùng mặc định công ty
  (`solverAllowCustomLength=true`) → vẫn có thể rơi vào auto_scan như trước, không đổi gì.
- Loại sắt KHSX CÓ chọn nhưng KHÔNG tick "Giữ đúng chiều dài đã định" → nếu chiều dài chọn không
  đạt ngưỡng, auto_scan vẫn chạy (đã xác nhận thật ở mục 14.3) - tức KHSX có thể vô tình TỰ KÍCH
  HOẠT nhánh chậm này cho một loại sắt mà trước đây (chỉ có cây chuẩn) ít khi cần quét.

### 17.5 Còn treo (ĐÃ ĐO XONG - xem 17.6)

- ~~Chưa đo hiệu năng tầng FE/BE (`getBatchCandidates`/`previewBatch`) với catalog LỚN (10+ SKU ứng
  viên cùng lúc)~~ → đã đo, xem 17.6.
- ~~Chưa đo thời gian `runSolverAndSave()` đầu-cuối thật (qua BE, nhiều loại sắt cộng dồn)~~ → đã đo
  thật qua toàn bộ pipeline (merge → QLSX → Sếp duyệt → solver → CuttingProposal), xem 17.6.
- ~~Chưa xác định NGƯỠNG chính xác~~ → thêm 2 điểm đo (10, 14 cỡ), xem 17.6. Vẫn CHƯA phải đường
  cong chính xác tuyệt đối (chỉ 6 điểm rời rạc), nhưng đủ để thấy xu hướng plateau thay vì bùng nổ
  vô hạn - xem nhận định ở 17.6.

### 17.6 Đo tiếp theo yêu cầu "đo cho tôi" (2026-09-17, cùng ngày)

**A. Thêm điểm đo cho đường cong (gọi thẳng solver, cùng phương pháp mục 17.2)**

| Số cỡ đoạn khác nhau | Thời gian thật (101 lần quét) |
| --- | --- |
| 1 | 0.22s |
| 4 | 0.28s |
| 8 | 6.7s |
| 10 | **30.565s** (mới) |
| 12 | 58.9s |
| 14 | **62.337s** (mới, `best_achievable: null`) |

Nhận định: từ 12 cỡ lên 14 cỡ thời gian gần như KHÔNG đổi (58.9s → 62.3s), trong khi từ 8 lên 10 cỡ
tăng gần 5 lần (6.7s → 30.6s). Đường cong có vẻ **plateau quanh mốc ~60s** thay vì tiếp tục tăng
theo cấp số nhân vô hạn - có thể vì CP-SAT bắt đầu chạm trần 20s/lần quét ở nhiều điểm trong dải
101 lần hơn (tiệm cận trần lý thuyết 101×20s=33,7 phút chỉ khi MỌI lần quét đều timeout, chưa xảy ra
ở 14 cỡ). Đây là tin tốt hơn dự đoán ban đầu, nhưng KHÔNG loại trừ khả năng catalog lớn hơn (20+
cỡ) mới thực sự chạm vùng timeout-hàng-loạt - chỉ có 6 điểm đo, không phải đường cong đầy đủ.

**B. Đo tầng BE với dữ liệu ứng viên lớn (12 SKU thật, qua HTTP thật, có auth)**

Seed 12 `SalesOrder`/`ProductionInvoiceItem` thật (`PERF-01`..`PERF-12`, script tạm
`prisma/perf-run.ts`, đã xoá sau khi đo xong) xoay vòng 4 SKU thật hiện có trong catalog demo, tạo
ra 3 loại sắt dùng chung (3, 5, 9 cỡ đoạn khác nhau/loại - xem bảng dưới).

| Endpoint | Thời gian (HTTP thật, có auth) |
| --- | --- |
| `GET /cutting-batch-candidates` (12 ứng viên) | **219ms** |
| `GET /cutting-batch-suggestions` | **102ms** |
| `POST /cutting-batch-preview` (gộp cả 12) | **213ms** |

Tầng BE (candidates/suggestions/preview - những gì màn "Tối ưu cắt sắt" gọi MỖI LẦN KHSX gõ số/tick
chọn) nhanh, không phải nguồn rủi ro - khớp với suy luận ban đầu vì tầng này KHÔNG gọi solver CP-SAT
thật, chỉ ước tính cục bộ (xem `previewBatch`/`getBatchCandidates` trong
`cutting-proposals.service.ts`). Rủi ro hiệu năng chỉ nằm ở `runSolverAndSave()` (mục C).

**C. Đo `runSolverAndSave()` đầu-cuối THẬT qua toàn bộ pipeline BE**

Chạy đúng luồng nghiệp vụ thật với 12 SKU trên: KHSX gộp (`POST /production-invoices/merge`) → gửi
QLSX (`send-to-qlsx-batch`) → QLSX gửi Sếp (`send-to-boss-batch`) → Sếp duyệt
(`POST /production-invoices/:id/approve-batch`, kích hoạt `runSolverAndSave()` chạy nền). Đo bằng
timestamp thật của chính `CuttingProposal` (`requestedAt` → `completedAt`), không phải đồng hồ bên
ngoài:

- `requestedAt`: `2026-09-17T02:26:45.250Z`
- `completedAt`: `2026-09-17T02:26:54.569Z`
- **Thời gian đầu-cuối thật: 9.319s** cho 3 loại sắt (5, 3, 9 cỡ đoạn/loại) cộng dồn tuần tự, kết
  quả 625 cây, hao hụt tổng 0.268% (dưới ngưỡng nên tự APPROVED, Sếp không cần chấp nhận hao hụt
  cao hơn).
- Khớp hợp lý với đường cong ở mục A: loại sắt nặng nhất (9 cỡ, gần mức 8 cỡ→6.7s) chiếm phần lớn
  9.3s, hai loại còn lại (3 và 5 cỡ) chỉ cộng thêm vài trăm ms đến ~2s. Xác nhận: đo trực tiếp
  solver (mục 17.2/A) dự đoán ĐÚNG được thời gian thật qua toàn bộ pipeline BE, không có tầng
  overhead nào (DB write, network nội bộ tới `catsat_web`...) đủ lớn để làm sai lệch đáng kể.

**Dữ liệu test đã xoá sạch** sau khi đo (12 `SalesOrder`, `ProductionInvoiceItem`, `ProductionOrder`,
`CuttingProposal`+pattern/segment, `PurchaseProposal` tự sinh, và `ProductionInvoice` gộp) - dùng
đúng `prisma/perf-run.ts clean` rồi xoá file, không để lại dữ liệu rác trong DB dev.

**Sự cố tooling gặp lại lúc đo (giống hệt mục 14.1)**: viết `prisma/perf-run.ts` lần đầu trong lúc
BE dev server đang chạy làm server CRASH (`ENOENT copyfile ...perf-run.ts.tmp...` trong
`AssetsManager.actionOnFile` của `@nestjs/cli`) - phải `preview_start` lại. Rút thêm một quy tắc:
khi cần SỬA file trong `prisma/` (không chỉ tạo mới) mà server đang chạy, an toàn nhất là DỪNG
server trước (`preview_stop`) rồi mới sửa, thay vì chỉ tránh sửa ngay sau lúc gọi solver - áp dụng
khi viết lại `clean()` để xử lý chuỗi FK (`production_orders` → `cutting_proposal_pattern_segments`
→ `cutting_proposal_patterns` → `cutting_proposal_lines` → `cutting_proposals` →
`purchase_proposal_items`/`purchase_proposals`) mà lần seed ban đầu không lường tới vì lúc đó PI
test chưa từng được duyệt thật.

### 17.7 Còn treo (sau 17.6)

- Đường cong vẫn chỉ có 6 điểm rời rạc (1/4/8/10/12/14 cỡ) - chưa đo mốc 16-20+ cỡ để xác nhận
  plateau có giữ hay lại tăng tiếp (dữ liệu giả lập, không tốn thời gian dựng nếu cần đo tiếp).
  Chưa cấp bách vì catalog thật hiện tại (17.3) chỉ tạo 2-9 cỡ/loại, còn cách xa vùng này.
  - Cây riêng thực tế cần thời gian solver tương ứng với số cỡ đoạn, đã xác nhận thời gian thật
    qua HTTP khớp với đo trực tiếp solver (17.6.C) - không cần đo lại kiểu này trừ khi catalog sản
    phẩm thay đổi lớn.

---

## 18. Đưa lại cột số cây vào bảng "Nếu gộp N SKU đã chọn" (2026-09-21)

### 18.1 Yêu cầu

Người dùng (ảnh chụp màn "Tối ưu cắt sắt" đang chọn 2 SKU `GHE-J55-GOPLUS`): *"chỗ này nên đưa
thêm cột SL cho nếu gộp 2 SKU không, để cho người ta biết mỗi loại sắt cần mua bao nhiêu cây"*.

### 18.2 Bối cảnh — cột này từng có và đã bị bỏ

Bảng chi tiết theo từng loại sắt trước đây có 6 cột: `Loại sắt | SKU dùng | Cắt riêng | Cắt chung |
Bớt | Hao hụt`. Ngày 19/09, sau 2 vòng góp ý, người dùng yêu cầu bỏ `Cắt riêng`/`Cắt chung` rồi bỏ
nốt `Bớt` ("chỉ quan tâm hao hụt thôi") — xác nhận sau khi đã được cảnh báo về nguyên tắc #1 ở đầu
`GomDotCatPage.tsx` (ca sắt 50x50 giảm % rất đẹp mà bớt ĐÚNG 0 cây). Việc bỏ chỉ áp dụng cho bảng
chi tiết; số `Bớt` tổng vẫn còn ở banner "Nếu gộp N SKU" (`preview.totalBarsSaved`).

Lần này **mục đích khác hẳn** nên đưa lại là hợp lý: 19/09 bỏ đi vì nó phục vụ việc *so sánh*
gộp/không gộp (đúng là gây hiểu nhầm); 21/09 thêm lại để trả lời *"loại sắt này phải mua bao nhiêu
cây"* — một câu hỏi mua hàng, không phải câu hỏi so sánh. Vì vậy chỉ đưa lại **một** cột
(`minBars` = số cây khi cắt chung), không đưa lại `Cắt riêng`/`Bớt`.

### 18.3 Đã làm

`D:\DNA-ERP\src\modules\pages\ProductionPlan\GomDotCatPage.tsx`:

- Thêm cột **`Số cây cần`** (căn phải, `NUM`) giữa `SKU dùng` và `Hao hụt`, hiển thị
  `≥ {l.minBars}`. Áp cho **mọi dòng**, kể cả dòng solo (loại sắt chỉ 1 SKU trong nhóm dùng) — đây
  chính là các loại mà mua hàng vẫn phải đặt dù gộp không tác động gì.
- `title` từng ô: *"Cắt khéo nhất cũng cần N cây <mã sắt> - phương án cắt thật (chạy sau khi Sếp
  duyệt) có thể cần nhiều hơn."*
- `minWidth` bảng 640 → 720 cho vừa cột mới.
- Sửa banner xanh đầu trang: *"Các con số hao hụt **và số cây** là mức tốt nhất có thể (nên luôn có
  dấu ≥)"* — trước chỉ nói về hao hụt, giờ dấu `≥` xuất hiện ở cả số cây nên phải nói cả hai, tránh
  hai chỗ trong cùng một màn nói hai điều khác nhau.

### 18.4 Vì sao giữ dấu `≥`, không để trần "SL"

`minBarsFor()` (`cutting-proposals.service.ts:2083`) tính
`ceil(tổng mm cần / bestUsedMm của cây khéo nhất)` với `bestUsedMm` lấy từ
`bestWasteAcrossStockLengths()` — tức **cận dưới**, giả định nguồn đoạn vô hạn, không tôn trọng số
lượng chính xác của từng cỡ đoạn. Phương án cắt thật (CP-SAT, chạy sau khi Sếp duyệt) phải tôn
trọng đúng số lượng nên **có thể cần nhiều cây hơn**. Để tiêu đề trần là `SL` và số trần là `52` sẽ
bị đọc thành đơn đặt hàng; `≥ 52` giữ đúng tính chất tham khảo, cùng quy ước với cột `Hao hụt` ngay
bên cạnh.

### 18.5 Kiểm tra

- `npx tsc --noEmit` (FE): sạch (chỉ còn lỗi có sẵn `.next/types/validator.ts` do artifact build cũ
  của trang `phantich` đã xoá — không liên quan).
- **Live-test trên FE thật** (`khsx` / localhost:3000, BE localhost:3001): chọn 2 SKU
  `GHE-J55-GOPLUS` (300 + 10 cái). Bảng ra đúng 4 cột:

  | Loại sắt | SKU dùng | Số cây cần | Hao hụt |
  |---|---|---|---|
  | SAT-TRON-FI4 | GHE-J55-GOPLUS + GHE-J55-GOPLUS | ≥ 7 | ≥ 0.37% ✓ |
  | SAT-VUONG-18X18 | GHE-J55-GOPLUS + GHE-J55-GOPLUS | ≥ 174 | ≥ 0.17% ✓ |
  | SAT-VUONG-10X10 | GHE-J55-GOPLUS + GHE-J55-GOPLUS | ≥ 52 | ≥ 7.60% vượt ngưỡng 1% |
  | SAT-HOP-10X20 | GHE-J55-GOPLUS + GHE-J55-GOPLUS | ≥ 52 | ≥ 0.40% ✓ |

  Banner đầu trang hiện đúng câu mới ("hao hụt và số cây"). Tổng 285 cây khớp với banner
  "Bớt 1 cây sắt" (cắt riêng 286).

### 18.6 Sự cố môi trường (không liên quan tính năng)

Docker Desktop chưa chạy → BE trả `Database error` ở màn đăng nhập. Khởi động Docker Desktop, đợi
`dna-erp-be-postgres-1` lên rồi đăng nhập lại là xong.

### 18.7 Soi kỹ dòng `SAT-TRON-FI4` bất thường (2026-09-21)

Người dùng hỏi *"sao không để ≈ hoặc ± nó hợp lý hơn chứ?"* cho cột `Số cây cần` → đối chiếu ước
tính với số solver giải thật, phát sinh 2 kết luận.

**A. Giữ `≥`, không dùng `≈`/`±`.** `bestUsedMm` là số mm lớn nhất MỘT cây có thể chở
([best-fill.util.ts:42](src/modules/cutting-proposals/best-fill.util.ts:42)); tổng mm phải cắt là cố
định → không thể cần ít cây hơn `ceil(tổng/bestUsedMm)`. Sai số **một chiều**, nên `≈`/`±` (ngụ ý
có thể thấp hơn) là sai. Đối chiếu proposal #2 (PO-GOPLUS-E2E-01, 300 ghế, cùng `bomRevisionId=1`):

| Loại sắt | Công thức | Solver thật | |
|---|---|---|---|
| SAT-HOP-10X20 | 50 | **50** @6000 | trùng khít |
| SAT-VUONG-18X18 | 168 | **168** @6000 | trùng khít |
| SAT-VUONG-10X10 | 50 @6000 | 50 @**5560** (`lengthSource='scan'`) | khác cây, không so được |

Chưa làm: cận TRÊN (xếp FFD tôn trọng đúng số lượng) để hiện thành khoảng `52 – 54 cây` — đã đề
xuất, chờ người dùng quyết.

**B. Dòng `SAT-TRON-FI4` 1 cây/30% KHÔNG phải lỗi tính toán** mà là định mức đã bị sửa tại chỗ
(6.0mm → 60.0mm) trên một BomRevision đang ACTIVE đã có proposal duyệt treo lên. Điều tra đầy đủ +
3 lỗ hổng phát hiện được ghi ở `changelog-2026-09-11-bom-revision-ghim-cu-canh-bao.md` **mục 8**.
