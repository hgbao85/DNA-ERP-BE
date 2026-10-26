# Changelog 2026-10-01 — Live-test đầu-cuối: từ tạo vật tư/định mức tới giao hàng (UI thật, từng vai trò)

> Trạng thái: **ĐÃ LIVE-TEST XONG toàn chuỗi trên local (2 sản phẩm: LIVE-01 tuỳ biến và Ghế J55 định mức thật, mục 6),
> không lỗi 5xx ở BE.** Bài e2e tự động (Playwright) mới viết tới hết chặng Sếp duyệt lệnh sản xuất (xem mục 4) - các
> chặng mua hàng → giao hàng CHƯA tự động hoá. Mục 6 (Ghế J55) và 7 (đo thời gian solver) bổ sung sau.

## 1. Cách làm

Yêu cầu: "test E2E từ đầu tới cuối từ tạo định mức" → ban đầu viết kịch bản Playwright chạy ẩn; người dùng hỏi "sao
không live test" → chuyển sang lái trình duyệt thật trong app, từng vai trò đăng nhập riêng (token nạp vào localStorage
để khỏi dính giới hạn `/auth/login` 8 lần/phút), kiểm tra lời gọi API và log BE sau mỗi chặng.

Dữ liệu: vật tư mới `SAT-009` (Sắt LIVE 01) + `VTK-009` (Sơn LIVE 01), SKU `LIVE-01`, đơn `LIVE-PO-01` (50 bộ),
lệnh sản xuất `PI-2026-022`, đề xuất mua #17, lệnh xưởng (production order) #24.

## 2. Chuỗi đã chạy (UI, trừ ghi chú) và kết quả

| # | Vai trò | Việc | Kết quả |
|---|---|---|---|
| 1 | admin | Danh mục hệ thống > Vật tư: tạo Sắt (kho PSH, NV mua hàng kho PSH) + Sơn (Vật tư khác, phân loại Sơn) | `POST /materials` 201 ×2 |
| 2 | khsx | Duyệt SKU > Tạo SKU mới `LIVE-01` (khách Meiying) | "Đang làm định mức" |
| 3 | dms | Định mức mảnh: mảnh "Mảnh LIVE A", 2 dòng sắt SAT-009 (700×4, 520×6), Gửi phê duyệt | `manh-quota` 201 |
| 4 | khsx | Duyệt định mức mảnh (Duyệt → Xác nhận duyệt → Xác nhận hoàn tất) | OK |
| 5 | dmbbdg | Định mức chi tiết: sơn VTK-009, 2 kg/bộ, Gửi phê duyệt | `detail-quota` 201 |
| 6 | khsx | Duyệt định mức chi tiết → Xác nhận gửi Sếp | `detail-quota/review` + `approve-detail` 201 |
| 7 | boss | SKU mới > Duyệt (hộp xác nhận cũng có nút tên "Duyệt") | `POST /skus/16/approve` 201 |
| 8 | sales | Tạo PO `LIVE-PO-01`: SKU LIVE-01 ×50, hạn giao 16/10 (form có thêm ô bắt buộc "Mã đơn hàng", hạn giao là lịch tự vẽ) | `POST /sales-orders` 201 |
| 9 | khsx | Tối ưu cắt sắt: chọn 1 SKU → Tính → **75 cây dài 4m04 (đặt riêng), hao hụt 0,70%, Đạt** (5 s) → Tạo lệnh sản xuất | `claim-solo` 201 → PI-2026-022 |
| 10 | khsx | Gửi QLSX (với PI 1 SKU nút trong hộp tên "Gửi QLSX", không có "(1 SKU)") | `send-to-qlsx-batch` 201 |
| 11 | qlsx | Thấy "Phương án cắt đã tính 75 cây · 0,70%", chọn kho thành phẩm, gửi Sếp | `send-to-boss-batch` 201 |
| 12 | boss | Hộp duyệt hiện đúng "Phương án cắt đã tính 75 cây · 0,70%" → Xác nhận duyệt | `items/36/approve` 201 |
| 13 | (API đọc) | Đề xuất mua #17 tự sinh: **SAT-009 mua 75 cây dài 4040mm (khớp phương án), VTK-009 mua 100 kg (= 2 kg × 50)** | đúng |
| 14 | muapsh | Lệnh mua vật tư: "Sếp đã duyệt" + đính file phiếu ký (tạo `File` bằng JS trong trang) → Xác nhận | `boss-approve` 201, đề xuất → PURCHASING |
| 15 | khopsh | Nhập kho: nhận 75 cây + 100 kg | `receive` 201 ×2, "Đã mua" |
| 16 | qlsx | Tổng hợp lệnh SX: Bắt đầu (override `window.confirm`) | `floor-start` 201 |
| 17 | khopsh | Phân phối nội bộ > Xuất sắt trong phôi: 75 cây × 4040 | "Chờ Phôi nhận" |
| 18 | phoi | Xác nhận nhận sắt; Lệnh sản xuất: cắt 200×700 + 300×520 (đúng nhu cầu từ định mức), Lưu đợt cắt, Gửi KCS | "chờ KCS" |
| 19 | kcs | Phôi: Tiến hành duyệt 500 đạt / 0 lỗi | "đạt" |
| 20 | han | Báo 50 mảnh, Lưu đợt, Gửi KCS; kcs duyệt Hàn 50 đạt | OK |
| 21 | son | Báo 50 mảnh, Lưu đợt, Gửi KCS; kcs duyệt Sơn 50 đạt | "Mảnh chờ đan" LIVE-01 = 50 |
| 22 | khopsh → khovttp | Xuất theo đơn hàng: chuyển 50 mảnh sang Kho Vật tư TP (CK-2026-025); khovttp Nhập nội bộ > Xác nhận nhận hàng | "Hiện có" ở Chuyền kiểm = 50 |
| 23 | khotp | Chuyền kiểm: kiểm 50, lỗi 0; Đóng gói: 50 thùng | còn lại 0, mục đơn = DONG_GOI |
| 24 | sales | Chi tiết xuất hàng chỉ hiển thị (**không có nút giao** - ship gọi API `POST /sales-orders/23/items/35/ship {qty:50}`) | 201, đã xuất 50, còn 0 |
| 25 | qlsx | Bấm "Kết thúc" lệnh xưởng | mục đơn **HOAN_THANH** |

Log BE: không có dòng lỗi, không 5xx. Chỉ có 401 rải rác từ một tab trình duyệt cũ không còn token (nhiễu, không phải lỗi luồng).

## 3. Quan sát / việc cần quyết (chưa sửa)

1. **Ship không có UI** (đã biết từ golden-path 2026-08): Sales không có nút "Xuất hàng" - chặng cuối phải gọi API.
2. **HOAN_THANH cần cả đóng gói đủ VÀ QLSX bấm "Kết thúc"** (quyết định 2026-09-24, `resolveStages`): giao đủ + đóng gói đủ mà
   chưa Kết thúc thì danh sách đơn vẫn ghi "0 xong · 1 chưa xong". Đúng thiết kế nhưng dễ gây hiểu nhầm cho Sales.
3. **KHSX không thấy "Phương án cắt đã tính" trên màn "Lệnh sản xuất mới"** (QLSX và Sếp thấy). KHSX phải quay lại tab
   "Kết quả đã tính" mới xem lại số - nên cân nhắc hiển thị cùng khối cho KHSX.
4. **Chuyền kiểm cần "nhập nội bộ" mảnh về kho TP trước** ("Hiện có" lấy từ phiếu chuyển/nhập đan, không lấy thẳng từ KCS Sơn):
   khopsh xuất + khovttp xác nhận mới kiểm được. Đúng thiết kế nhưng không có gợi ý nào trên màn Chuyền kiểm ("Hiện có 0" và
   nút Kiểm mờ, không nói cần làm gì tiếp).
5. **Dữ liệu rác trong DB local do các lần chạy tự động**: SKU `E2E-EXPLORE-1`, `E2E-FULL-*` (một số đang "Chờ sếp duyệt"), vật
   tư "Sắt E2E …"/"Sơn E2E …", đơn `E2E-DOTHAM-1`, `E2E-ST-*`, PI-2026-018..021 (đang chờ Sếp). Chưa dọn.

## 4. Bài e2e Playwright (tự động)

- `e2e/solve-truoc-tao-lenh.spec.ts` (luồng "Solve trước", xem changelog-2026-09-30-solve-truoc-tao-pi.md mục 4i) - đã qua.
- `e2e/full-flow.spec.ts` (mới): đã viết tới hết chặng Sếp duyệt SKU + Sales tạo đơn → cắt sắt → QLSX → Sếp duyệt lệnh. Chạy riêng
  từng chặng đã qua đến "Sếp duyệt SKU" (A0–A6, ~12 s); các chặng B (đơn hàng trở đi) **cần sửa theo live-test** (ô "Mã đơn
  hàng", lịch chọn hạn giao, nút "Gửi QLSX" của PI 1 SKU) và chưa chạy lại; chặng mua hàng → giao hàng chưa viết.
- `e2e/helpers.ts`: đăng nhập bằng API 1 lần/tài khoản + nạp token (BE giới hạn `/auth/login` 8 lần/phút).
- Phát hiện kỹ thuật: Playwright mặc định KHÔNG giới hạn thời gian từng thao tác - bài dài phải đặt `actionTimeout`.
- `golden-path.spec.ts` vẫn hỏng từ trước (khách "MEIJING"/SKU "test" không còn và form PO có thêm ô "Mã đơn hàng").

## 5. Lỗi tìm thêm sau live-test (người dùng gửi ảnh PI-2026-021) — ĐÃ SỬA

- **Triệu chứng**: màn QLSX "Tổng hợp lệnh SX > Chi tiết PI" hiện "Mua hàng ✓" và "Đan ✓" trong khi "Khung cơ khí" 0%, "Chưa bắt đầu";
  cùng PI đó, KHSX thấy "Mua hàng" đang chạy 0% (đúng). Thực tế đề xuất mua #16 còn `NEW`, đã nhận 0.
- **Nguyên nhân**: `InspectionContext` bỏ qua việc nạp đề xuất mua với MỌI tài khoản có `mfgRole` (lý do cũ 2026-08-13: các vai xưởng
  không có `PURCHASE_PROPOSAL:VIEW`). QLSX (PRODUCTION_MANAGER) hiện ĐÃ có quyền này nhưng vẫn bị bỏ qua → danh sách rỗng →
  `getPurchasingPercent([])` = 100 ("không có gì cần mua") → bước Mua hàng luôn "xong" ở màn QLSX, kéo theo nhãn "công đoạn hiện tại" sai.
- **Sửa** (FE `src/context/InspectionContext.tsx`): chỉ bỏ qua khi `mfgRole` khác PRODUCTION_MANAGER. Live-test lại: QLSX thấy "Mua hàng 0%"
  như KHSX. tsc sạch, vitest 61/61.
- **Còn lại (chưa sửa)**: công đoạn "không áp dụng" (vd Đan khi không có mảnh cần đan) vẫn hiện dấu ✓ xanh như đã xong (code coi 'na' = 100%);
  khi Mua hàng xong và Khung cơ khí đang chạy thì Đan ✓ nằm trước Khung cơ khí ○ trông như làm sai thứ tự. Nên hiển thị riêng "không áp dụng".
- **Bài học**: danh sách rỗng bị coi là "xong" ở nhiều chỗ (`length === 0 → 100`) - nguồn dữ liệu không tải được sẽ biến thành "đã xong" thay vì "chưa biết".

## 6. Live-test lần 2: Ghế J55 (định mức thật, 20 bộ) — XONG, HOAN_THANH

Dữ liệu: đơn `LIVE-GHE-01` (id 25), SKU Ghế J55 (BOM revision 13: 5 mảnh × 3/bộ, 8 loại sắt hộp/tròn/vuông/phi), PI-2026-024,
lệnh xưởng #27, đề xuất mua #19. Chạy từng vai trò trên UI thật (token nạp bằng API), kiểm API/log sau mỗi chặng.

Chuỗi: khsx Tính (solver local) → tạo lệnh → QLSX → Sếp duyệt → mua/nhận kho → QLSX Bắt đầu → xuất sắt → Phôi cắt → KCS → Hàn → KCS → Sơn
(5 mảnh × 60, Lưu đợt + Gửi KCS) → KCS Sơn duyệt 5/5 → khopsh "Xuất theo đơn hàng" 5 mảnh sang Kho VTTP → khovttp Nhập nội bộ 5/5 →
**Xuất đan 5 mảnh (60) cho điểm đan** → khotp **Nhận hàng đan** 5/5 → Chuyền kiểm 5×60 → Đóng gói **20 thùng** → Sales giao 20 (API) → QLSX Kết thúc.
Kết quả: mục đơn `HOAN_THANH`, đã giao 20/20; log BE không lỗi (`preview_logs level=error` rỗng).

Khác với LIVE-01: cả 5 mảnh Ghế J55 là mảnh **đan** (`BomPiece.isWoven=true`), nên "Hiện có" ở Chuyền kiểm tính từ `WeavingReceipt`
(Xuất đan → Nhận hàng đan), KHÔNG phải từ phiếu chuyển kho nội bộ (listTransferCheckPieces, nhánh `bp.isWoven`). Nhánh này lần đầu được chạy thật.

### Quan sát / việc cần quyết (chưa sửa)
1. **Xuất theo đơn hàng vẫn mời chuyển mảnh ĐAN sang kho TP ("Có thể chuyển 60")** — và phiếu chuyển vẫn xác nhận được, nhưng số này không làm
   "Hiện có" ở Chuyền kiểm tăng (mảnh đan chỉ đếm theo nhận hàng đan). Thủ kho làm đúng "theo hướng dẫn màn" vẫn kẹt ở Chuyền kiểm (Hiện có 0).
   Xuất đan lại LẤY số "đã nhận" của phiếu chuyển làm hạn mức (`sumReceivedForPiece`) nên bước chuyển kho vẫn cần — chỉ là không có gợi ý mảnh nào đi đường nào.
2. **Điểm đan phải tạo trước, màn Xuất đan không báo gì khi chưa có điểm đan** (ô chọn chỉ có "Chọn điểm đan…"). DB local chưa có điểm đan nào;
   production cần thủ kho tạo điểm đan thật (Quản lý điểm đan) trước khi chạy đơn có mảnh đan.
3. **Phôi chỉ tính 58% dù QLSX Kết thúc → PI hiện "Hoàn thành 100%"**: Phôi gồm Cắt + công đoạn phụ (Uốn/Dập/Tán/Tóp đầu/Xẻ); live-test mới báo Cắt
   (Hàn/Sơn không kiểm tồn phôi - đúng thiết kế). "Kết thúc" không chặn khi công đoạn phụ chưa làm; sau đó màn QLSX ghi 100%. Đúng quyết định
   2026-09-24 nhưng nên cho QLSX thấy cảnh báo "Phôi còn 42% chưa báo" trước khi Kết thúc. Chưa live-test các công đoạn phụ + KCS của chúng.
4. **Màn trống khi vừa đổi tài khoản/tải trang** ("Không có lệnh xuất nào đang chờ xử lý", "SKU chưa được Sếp duyệt…", "Không có phiếu chuyển kho…")
   trong vài giây đầu, tự hết khi dữ liệu về. Hiển thị trạng thái rỗng thay cho "đang tải" dễ làm người dùng tưởng mất dữ liệu — nên có skeleton/"Đang tải…".
5. **Hạn giao lệch giữa các màn**: Chuyền kiểm/Đóng gói ghi 25/10/2026, QLSX/lệnh xưởng ghi 16/10/2026 cho cùng đơn (chưa tra nguồn từng màn).
6. Đã nêu ở mục 5 trước: mục Xuất sắt vẫn cho bấm "Xuất" ở dòng đã xuất đủ (báo "Nhập chiều dài cây hợp lệ" gây khó hiểu — nên khoá dòng đã xuất đủ);
   form Sales PO tự thêm các dòng SKU khác khi chọn khách; gợi ý "gộp được với" liệt kê trùng tên SKU; dấu ✓ cho công đoạn "không áp dụng".

Mẹo kỹ thuật cho bài e2e sau: modal xác nhận của app là DOM tự dựng (không phải `window.confirm`) — cần bấm nút "Xác nhận" trong modal; đổi tài khoản
bằng cách đăng nhập API rồi ghi `accessToken/refreshToken` (nằm trong `data` của phản hồi `/auth/login`) vào localStorage và tải lại trang.

## 7. Đo thời gian solver: phụ thuộc SỐ CỠ ĐOẠN khác nhau, không phụ thuộc số bộ

Solver local (docker `catsat_web`, 8 worker) gọi trực tiếp trên loại sắt chậm nhất của Ghế J55 (SAT-HOP-10X20, 7 cỡ đoạn), `time_limit_seconds=60`,
`auto_scan` bật (script `scale_test.js` trong scratchpad, không ghi vào DB nào):

| Kịch bản | Thời gian | Ghi chú |
|---|---|---|
| 7 cỡ × 5 bộ | 135,8 s | 11 cây, hao hụt 0,17% |
| 7 cỡ × 20 bộ | 151,6 s | 41 cây |
| 7 cỡ × 100 bộ | 130,2 s | 201 cây |
| 7 cỡ × 500 bộ | 127,2 s | 1004 cây |
| 4 cỡ × 20 bộ | 14,6 s | hao hụt 0,97% (cây 6000) |
| 4 cỡ × 100 bộ | 0,5 s | tìm được cây 4000 qua scan |
| 4 cỡ × 500 bộ | 0,4 s | |
| **10 cỡ × 20 bộ** | **> 306 s, client bỏ (không có kết quả)** | thêm 3 cỡ giả lập |

Kết luận: số bộ (5 → 500) gần như không đổi thời gian; **mỗi cỡ đoạn khác nhau thêm trong cùng 1 loại sắt làm thời gian tăng rất nhanh** (4 cỡ < 15 s,
7 cỡ ≈ 130–150 s, 10 cỡ > 300 s ở limit 60 s). BE thực tế đặt `time_limit` ≈ 242 s/loại sắt (cộng thời gian liệt kê pattern và 2 lần CP-SAT) nên
7 cỡ có thể ra 360 s cho 1 loại sắt (đã gặp: Ghế J55 1 SKU/20 bộ = 362,8 s, 1 loại sắt chiếm 361,5 s); hàng đợi solver là FIFO 1 lượt toàn hệ thống.
Biện pháp đề xuất (CHƯA làm, chờ quyết): giới hạn/cảnh báo số cỡ đoạn mỗi loại sắt, hạ time_limit cho loại sắt nhiều cỡ, bỏ `auto_scan`/cây riêng khi
quá số cỡ, hiện vị trí hàng đợi cho KHSX, và gói Render đủ mạnh (solver free plan chậm hơn nhiều).

### 7b. Live-test tốc độ solver TỪNG SKU, qua BE thật (tuần tự, 20 bộ/SKU) — ĐÃ CHẠY

Cách chạy: mỗi SKU 1 đơn Sales mới (20 bộ) → `POST /cutting-batch-solve` đúng 1 SKU → đợi xong; không chạy song song. Chạy 2 lượt: (A) mặc định
BE (`time_limit` 20 s/loại sắt) và (B) đúng như màn KHSX gửi (`time_limit = floor(1700 / số loại sắt)` — xem `autoTimeLimitSeconds` ở GomDotCatPage.tsx).
Số liệu lấy từ `cutting_proposals.totalSolveSeconds` + `requestParams.time_limit_seconds` (#43–#54, local, solver docker 8 worker).

| SKU | Số loại sắt | A: 20 s/loại | B: như màn KHSX | Kết quả (cây / hao hụt) A vs B |
|---|---|---|---|---|
| Ghế J55 | 7 | **51,4 s** | **358,8 s** (limit 242) | 146 cây / 0,244% — **y hệt** |
| Ghế tình yêu | 5 | **66,7 s** | **515,5 s** (limit 340) | 91 cây / 0,237% — **y hệt** |
| Bàn J55 | 3 | 0,07 s | 0,08 s (limit 566) | 29 cây / 0,436% |
| Bàn 8 Meiying | 3 | 0,07 s | 0,06 s | 32 cây / 0,392% |
| LIVE-01 (custom) | 1 | 0,01 s | 0,02 s (limit 1700) | 30 cây / 0,707% |

Kết luận:
1. SKU nhỏ (1–3 loại sắt, ít cỡ đoạn): dưới 1 giây dù cấu hình nào.
2. SKU nặng (Ghế J55, Ghế tình yêu): thời gian bị **time_limit quyết định**, không phải độ khó — nâng limit từ 20 s lên 242/340 s làm thời gian
   tăng 7–8 lần (51→359 s, 67→516 s) mà **kết quả không cải thiện** (cùng số cây, cùng % hao hụt, cùng nguồn chiều dài cây) ở cả 2 SKU thật.
   → Chính sách "dùng hết ngân sách an toàn" (quyết định 2026-09-23, KHSX không cần biết thời gian) đang tốn 6–9 phút/SKU để cho ra đúng kết quả
   mà 1 phút đã có. Với hàng đợi FIFO 1 lượt toàn hệ thống, 2 SKU nặng tính liên tiếp = ~15 phút chờ.
3. Cẩn trọng khi kết luận: mới 2 SKU nặng, 1 cỡ 20 bộ, máy local 8 worker; chưa có ca nào time_limit cao mới cho kết quả TỐT HƠN nên chưa chứng minh
   được rằng không bao giờ có. Trước khi đổi chính sách nên chạy thêm các SKU nặng khác/đơn gộp nhiều SKU.
4. Lỗi vụn của script đo (không phải của hệ thống): access token hết hạn sau ~15 phút khi poll lâu → 401; BE `nest --watch` restart giữa lần đo đầu làm mất 1 lượt
   (đã chạy lại).

CHƯA làm (chờ quyết định): đổi `autoTimeLimitSeconds` (vd trần 30–60 s/loại), đo đơn gộp nhiều SKU, đo trên Render.

### 7c. Thử trần 60 s/loại sắt ở màn KHSX — ĐÃ ĐỔI (thử nghiệm), live-test qua UI

- Đổi FE `GomDotCatPage.tsx`: `autoTimeLimitSeconds = min(SOLVER_MAX_SECONDS_PER_MATERIAL = 60, floor(solverTimeoutSeconds / N))` (trước đây chỉ floor(T/N) = 242 s cho
  Ghế J55). Vẫn là chặn trên nên N × giới hạn ≤ T. BE không đổi (`min(requested, floor(T/N))` đã có).
- Live-test UI (khsx chọn 1 SKU Ghế J55 → Tính): request gửi `time_limit_seconds = 60` (kiểm trong `requestParams` của đợt #55), **không có lỗi time_limit**
  (không bị co ngân sách, không timeout, không 4xx/5xx; tsc sạch, vitest 61/61). Kết quả **146 cây / 0,244% — y hệt** các lần 20 s và 242 s.
- Thời gian thực: **147 s** (so với 51 s ở limit 20 và 359 s ở limit 242). Thời gian ≈ 2,5 × limit cho loại sắt nặng nhất (liệt kê pattern + 2 lần CP-SAT,
  mỗi lần ăn đủ limit) → trần 30 s cho khoảng ~75 s, 20 s cho ~50 s. Với 2 SKU nặng đã thử, limit 20 s đã cho đúng phương án; **chưa chọn giữa 20/30/60**.
- Chưa làm: hạ trần xuống 30 (đợi quyết định); các PI cũ đã lưu override 242/340 trong DB khi bấm "Tính lại" vẫn dùng số cũ (BE chỉ kẹp theo N).

## 8. Xoá đợt solve khỏi "Kết quả đã tính" — XONG

Lý do: thử nhiều lần thì danh sách đợt tính tràn lan, không có chỗ dọn (người dùng hỏi sau khi thấy 16 thẻ).
- BE `DELETE /cutting-batch-solves/:id` (`CuttingProposalsService.discardBatchSolve`, quyền `CUTTING_PROPOSAL:CREATE` + role KHSX, trả 204). Chỉ xoá đợt chưa dùng
  (DRAFT/FAILED, chưa gắn PI/PO). Chặn 409: đang tính (CALCULATING), đã gắn lệnh sản xuất/PO, đã duyệt/đã bị thay thế. "Xoá" = gỡ dòng ghim
  `CuttingProposalItem` + đánh `SUPERSEDED` — giữ bản ghi làm lịch sử vì bảng dòng cắt con không cascade; biến khỏi mọi danh sách, SKU được thả để tính lại.
- FE: nút "Xóa lượt tính này" (đỏ) trong phần mở rộng của thẻ, hộp xác nhận (lỗi BE hiện ngay trong hộp), thẻ biến mất sau khi xoá; `discardCuttingBatchSolve` ở cutting-batch-api.ts.
- Kiểm tra: jest cutting-proposals 178/178 (+8 test mới: xoá DRAFT/FAILED, 404, 5 ca chặn); FE tsc + vitest sạch; live UI: xoá #55 → 204, danh sách 15 → 14;
  gọi DELETE #42 (đợt của PI-2026-024) → 409 "đã được dùng cho một lệnh sản xuất".
- Phát hiện kèm (CHƯA sửa, đã hoàn nguyên bản sửa nhầm): xoá ĐƠN SALES khi đơn còn đợt solve trước-PI báo lỗi mơ hồ 400 "Invalid reference to a related record" (FK Restrict từ
  `CuttingProposalItem`). Tôi từng hiểu nhầm yêu cầu "xoá" là xoá đơn và sửa `sales-orders.service.ts` - đã `git checkout` bỏ. Cách tránh hiện nay: xoá đợt solve trước (gỡ ghim) rồi mới xoá đơn;
  nếu muốn thông báo lỗi rõ hơn thì làm riêng.
- Chưa làm: xoá hàng loạt ("xoá tất cả đợt chưa dùng") nếu muốn dọn nhanh.

### 7d. So sánh các mức trần time_limit (10 / 20 / 30 / 60 / 242–340 s) — hiện FE đang đặt TRẦN = 30 s

FE `SOLVER_MAX_SECONDS_PER_MATERIAL` hạ 60 → **30**. Live-test qua UI (Ghế J55, Ghế tình yêu ở 30 s) + script gọi BE thật (các mức còn lại), tuần tự, 20 bộ, máy local 8 worker.
Mọi mức cho ra **đúng cùng phương án từng loại sắt** (so từng cặp: loại sắt, số cây, chiều dài cây, % hao hụt từ `rawResponse.purchase_plan`).

| time_limit/loại | Ghế J55 (7 loại sắt) | Ghế tình yêu (5 loại sắt) | Phương án |
|---|---|---|---|
| 10 s | **25,7 s** | **29,5 s** | 146 cây 0,244% / 91 cây 0,237% — giống hệt |
| 20 s | 51,4 s | 66,7 s | giống hệt |
| 30 s (đang đặt) | 84,5 s | 110,6 s | giống hệt |
| 60 s | 147,3 s | 194,7 s | giống hệt |
| 242 / 340 s (trước đây) | 358,8 s | 515,5 s | giống hệt |

Ca khó nhất đã gặp (1 loại sắt SAT-HOP-10X20 thêm 3 cỡ giả = 10 cỡ đoạn, gọi thẳng solver): limit 10 → 60 s, 66 cây hao hụt 0,2545% · limit 30 → 158 s, 66 cây hao hụt 0,25% ·
limit 60 (lần đo trước) → quá 300 s chưa ra kết quả. Tăng limit 10 → 30 chỉ cải thiện 0,0045 điểm % hao hụt, cùng số cây.

Kết luận / khuyến nghị: thời gian ≈ 2,5 × limit cho loại sắt nặng nhất (cộng dồn các loại nặng) và phương án KHÔNG đổi từ 10 s trở lên ở cả 3 ca → trần cao chỉ tốn thời gian. Đề xuất **20 s**
(heavy SKU ~50–70 s, gấp đôi mức 10 s đã chứng minh đủ); 30 s vẫn ổn nhưng chậm hơn ~1,6 lần mà không thêm lợi. Giới hạn của kết luận: 3 ca, cỡ 20 bộ, một máy; chưa thử đơn gộp nhiều SKU nặng, chưa thử limit < 10 s,
chưa đo trên Render. Chưa đổi sang 20 — chờ người dùng chốt.

### 7e. ĐÍNH CHÍNH 7d: chạy lặp cho thấy trần thấp (20–30 s) KHÔNG ổn định — kết luận "20 s đủ" ở 7d chưa đủ cơ sở

Chạy lặp Ghế J55 (cùng đầu vào, tuần tự, qua BE thật). Phương án "tốt" = 146 cây / 0,244%, SAT-HOP-10X20 41 cây 6 m, ~2,5 × limit giây.
Phương án "xấu" = 164–168 cây / 0,27–0,33%, SAT-HOP-10X20 60–63 cây **đặt riêng** ~4m01–4m05, và chậm gấp 3–15 lần.

| limit | lượt tốt / tổng | thời gian lượt tốt | thời gian lượt xấu |
|---|---|---|---|
| 10 s | 2 / 2 | 24–26 s | — |
| 20 s | 3 / 8 | 51–59 s | 166, 322, 348, 379, **790 s** |
| 30 s | 2 / 4 | 81–84 s | 137, 142 s |
| 60 s | 1 / 1 | 147 s | — |
| 242 s | 1 / 1 | 359 s | — |

Cơ chế (đọc `de_xuat_logic.py::optimize_one_material`): trước hết giải chiều dài cây chuẩn 6 m với ngưỡng hao hụt; nếu CP-SAT KHÔNG tìm được nghiệm đạt ngưỡng trong `time_limit` thì coi là hết giờ
→ chuyển sang quét các chiều dài cây riêng (mỗi chiều dài lại ăn tới `time_limit`, dừng ở chiều dài đầu tiên đạt ngưỡng) → ra cây đặt riêng, nhiều cây hơn và lâu hơn nhiều.
Việc 6 m có tìm được kịp hay không là NGẪU NHIÊN (nhiều worker CP-SAT) và nhạy với tải CPU: 5/5 lượt xấu đầu tiên rơi đúng lúc tôi chạy tsc/vitest/jest song song, nhưng
lượt 790 s xảy ra khi máy rảnh → không thể đổ hết cho tải. Control (limit 10 s, máy rảnh) vẫn ra 146 cây/24 s → solver không hỏng.

Hệ quả: (1) kết luận ở 7b/7d "mọi mức cho cùng phương án" chỉ đúng với các lượt may mắn đầu tiên, KHÔNG phải với mọi lượt; (2) trần càng thấp thì ca xấu càng rẻ về mỗi lượt nhưng xác suất xấu có vẻ không giảm
rõ khi tăng limit trong dải 10–30 s (mẫu quá nhỏ để kết luận); (3) môi trường thật (Render free, CPU yếu hơn nhiều) khả năng cao rơi vào nhánh xấu thường xuyên hơn.
Trần 20 s hiện đang đặt ở FE (`SOLVER_MAX_SECONDS_PER_MATERIAL = 20`) — CẦN QUYẾT lại; chưa đổi.
Hướng sửa gốc (chưa làm, ở solver DNA-DEXUAT): thử lại chiều dài cây chuẩn với limit dài hơn trước khi chuyển sang quét; giới hạn số chiều dài quét; hoặc cho CP-SAT hint/seed cố định để kết quả lặp lại được.

Làm thêm trong lượt này: màn "Kết quả đã tính" — bấm vào dòng loại sắt (vd SAT-TRON-FI21) bung 2 bảng "Các đoạn cần cắt" (cỡ đoạn/mảnh/cần/cắt ra) và "Cách cắt từng cây" (kiểu cắt × số cây × phần thừa).
Chỉ sửa FE (`CuttingSolvePanel.tsx`, `cutting-batch-api.ts`), dùng sẵn dữ liệu `pieceSummary`/`patterns` BE đã trả; tsc + vitest 61/61; live UI đúng (4 kiểu cắt cộng đúng 35 cây).

## 9. Solver: giải lại chiều dài chuẩn 6000 trước khi quét chiều dài riêng — XONG (đã merge vào `main` của DNA-DEXUAT, CHƯA push)

**Vấn đề (từ 7e):** ở trần 20 s, loại sắt nặng (Ghế J55 – HOP10X20) hay hết giờ ở 6000 mm → solver nhảy sang quét chiều dài riêng 4000–6000 → ra phương án 164–168 cây, chậm 166–790 s; chỉ 3/8 lượt ra phương án tốt (146 cây).

**Đã làm** ([cat_sat/de_xuat_logic.py](D:/DNA-DEXUAT/cat_sat/de_xuat_logic.py)): trong `optimize_one_material`, nếu 6000 mm chỉ *hết giờ* (không phải vô nghiệm) thì giải lại 6000 với `time_limit × 3`, rồi `× 6` (hằng `FIXED_RETRY_FACTORS = (3, 6)`) trước khi mới quét chiều dài riêng. Chỉ quét khi 6000 thật sự vô nghiệm/vẫn hết giờ sau các lần thử.

**Kiểm tra (live qua BE, Ghế J55 × 20 bộ, trần 20 s, 8 lượt tuần tự):** 8/8 ra 146 cây, cây 6000 mm, hao 24,4 % (trước: 3/8). Thời gian: 7 lượt 53–58 s, 1 lượt 450 s (lần giải lại leo thang). Đuôi chậm còn nhưng tốt hơn trước (166–790 s kèm phương án xấu).

**Còn treo:** solver phải **deploy lại trên Render** (chỉ người dùng push); chưa test ca ACCEPT_OVER/vô nghiệm thật sau patch — logic vô nghiệm không đổi nhưng nên test lại sau deploy; nếu 450 s gây phiền có thể hạ hệ số xuống (2, 4).

### 9b. Test lại sau patch solver (theo yêu cầu: "thời gian lâu không quan trọng miễn không fail")

- **Ghế tình yêu** (20 bộ, trần 20 s × 3 lượt): 3/3 DRAFT, 91 cây, hao 23,7 %, HOP10X20 = 33 cây @6000/fixed; 54–78 s. Không lượt nào fail.
- **Bàn J55** (20 bộ × 3 lượt): lượt 1–2 DRAFT, 29 cây, hao 43,6 %, ~1 s (không có HOP10X20 nên cột đó rỗng). Lượt 3 lỗi script (login bị throttle 8/phút) — không phải lỗi solver.
- **Bộ test solve đầy đủ:** 76/77 PASS (`scratchpad/solve_suite3.log`). ACCEPT_OVER (D6–D10) PASS. **I9–I13 từ FAIL thành PASS:** nguyên nhân cũ là kịch bản test gửi thiếu `warehouseName` ở bước QLSX→Sếp (BE trả 400, item kẹt WAITING_QLSX) — lỗi script, không phải lỗi hệ thống; đã sửa script.
- **Còn FAIL: D5** — chọn riêng 5850 cho SAT-HOP-20X20 nhưng kết quả ra 4340 mm. Có từ trước patch, CHƯA điều tra (nghi: quét chiều dài riêng vẫn chạy bên cạnh chiều dài do KHSX chọn, hoặc khoá không khớp nên solver bỏ qua lặng lẽ). Chưa sửa.
- **B16** (cờ boolean sai kiểu vẫn 201): giải thích — `enableImplicitConversion` ép chuỗi thành boolean; mức thấp, chưa sửa.

### 9c. Điều tra D5 — KHÔNG phải lỗi, test kỳ vọng sai

Chạy lại BAN-J55 ba cấu hình (script `scratchpad/d5.js`):
1. Chọn 5850 cho SAT-HOP-20X20, cho phép cây riêng → ra **4340 (scan)**, hao 0,392.
2. Cùng chọn nhưng **cấm cây riêng** → SAT-HOP-20X20 **vô nghiệm** (không có cách cắt 5850 đạt ngưỡng).
3. Chọn 5850 cho SAT-HOP-25X50 (cấm cây riêng) → ra **5850 (fixed)**, hao 0,192 — đúng như chọn.

Kết luận: ghi đè chiều dài theo quy cách hoạt động đúng. Với SAT-HOP-20X20, cây 5850 không cắt được đạt ngưỡng hao hụt nên solver tự quét cây riêng (4340) — hành vi đúng khi cho phép cây riêng. Test D5 chọn nhầm loại sắt đầu tiên (đúng loại không hợp 5850). Cần sửa kịch bản test (chọn loại sắt mà 5850 khả thi, hoặc kiểm "5850 hoặc quét") — chưa sửa script. Không có thay đổi code.

### 9d. Đo 4 SKU gộp (12 loại sắt) sau patch + kiểm tra timeout Render

- **Timeout:** solver chạy `daphne --application-close-timeout 300` (không phải giới hạn thời gian tính); `render.yaml` không đặt giới hạn request; giới hạn proxy Render CHƯA xác minh. BE: `SOLVER_TIMEOUT_SECONDS=1700` ở `.env` local (mặc định ở `.env.example` là 300 — giá trị môi trường thật CHƯA biết); trần client `POST_BREAKER_TIMEOUT_MS` 30 phút.
- **Đo:** Ghế J55 + Ghế tình yêu + Bàn 8 Meiying J55 + Bàn J55, mỗi SKU 20 bộ, trần 20 s/loại → phương án #155 **DRAFT, 340 cây, 12/12 loại khả thi, tổng 1527 s** (sát giới hạn 1700 s). Hai loại nặng tốn gần hết thời gian: SAT-HOP-10X20 932 s (quét ra 4050 mm), SAT-VUONG-20X20 566 s (quét ra 4000 mm); loại còn lại < 30 s.
- **Nhận xét:** ở ca gộp nhiều loại nặng, 6000 mm vẫn hết giờ kể cả sau giải lại ×3/×6 nên vẫn rơi vào quét chiều dài riêng — patch không giúp ca này, chỉ cộng thêm tối đa ~(3+6)×trần giây mỗi loại trước khi quét. Chưa đo bản cũ trên cùng bộ nên chưa biết patch làm chậm thêm bao nhiêu. Nếu SOLVER_TIMEOUT_SECONDS thật = 300 thì ca này chắc chắn FAILED.
- Lượt #156 là bản chạy trùng do lỡ chạy 2 lần (còn CALCULATING lúc ghi) — dữ liệu test local.

### 9e. So sánh bản cũ vs bản patch trên bộ 4 SKU gộp (12 loại sắt, trần 20 s) — patch CHẬM GẤP ~3 ở ca này

| | Bản cũ | Bản patch |
|---|---|---|
| Kết quả | 340 cây, 12/12 khả thi | 340 cây, 12/12 khả thi (y hệt, từng loại trùng) |
| Tổng thời gian | **533 s** | **1527 s** (#155), **1610 s** (#156) |
| SAT-HOP-10X20 | 394 s | 932 s |
| SAT-VUONG-20X20 | 113 s | 566 s |

Kết luận: ở ca nhiều loại nặng 6000 mm vẫn hết giờ → vẫn quét; patch không đổi kết quả nhưng cộng thời gian giải lại ×3/×6 vô ích, đẩy tổng sát trần 1700 s (rủi ro FAILED). Ngược lại patch giúp ca Ghế J55 đơn (8/8 ra 146 cây thay vì 3/8). Đề xuất: bỏ bậc ×6 (chỉ ×3) hoặc đặt trần tổng thời gian giải lại — CHỜ người dùng quyết. Code solver (`main` DNA-ERP/DEXUAT local) hiện vẫn là bản patch (×3, ×6), đã khôi phục sau khi đo bản cũ.

### 9f. Thử bỏ bậc ×6 (chỉ giải lại ×3) — KHÔNG chọn, giữ `FIXED_RETRY_FACTORS = (3, 6)`

| | Bản cũ | ×3 và ×6 | Chỉ ×3 |
|---|---|---|---|
| Ghế J55 × 8 lượt (146 cây) | 3/8 | 8/8 | 7/8 (lượt 8: 165 cây, cây 4080 quét riêng, 705 s) |
| 4 SKU gộp (12 loại sắt) | 533 s, 340 cây | 1527–1610 s, 340 cây | 736 s, 341 cây |

"Lượt xấu" = 6000 mm hết giờ → solver quét cây riêng → mua nhiều hơn ~19 cây (13%) và phải đặt cây cắt riêng. Quyết định (người dùng): ca gộp 4 SKU chỉ là bài thử tải, thực tế dùng 1–2 SKU/lượt nên ưu tiên độ ổn định ca đơn → giữ (3, 6). Rủi ro còn lại: gộp nhiều SKU nặng cùng lúc có thể chạm trần SOLVER_TIMEOUT_SECONDS (đã đặt 1700 trên môi trường thật theo báo cáo của người dùng). Working tree DNA-DEXUAT đã khôi phục về commit (3, 6); không có thay đổi mới cần commit ở DNA-DEXUAT (patch đã commit/merge từ mục 9). Vẫn CHƯA push/deploy solver.
