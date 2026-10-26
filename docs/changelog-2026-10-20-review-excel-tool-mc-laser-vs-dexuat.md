# Changelog 2026-10-20 — Review `MC_CatSat_ExcelTool.zip` và so sánh với DNA-DEXUAT

> Trạng thái: **CHỈ REVIEW + ĐO, CHƯA SỬA CODE** ở DNA-DEXUAT lẫn DNA-ERP-BE (mục 7: solver TS + HiGHS; từ 7.7 đã nối vào BE; **mục 9 (2026-10-23): HiGHS là bộ giải DUY NHẤT, đã gỡ `SOLVER_MODE=http`/DNA-DEXUAT, thêm chọn máy cắt Laser/Tự động ở BE**; local, chưa deploy, CHƯA commit; **mục 10 (2026-10-23): MC Tự động đi đường "thu hẹp" qua nghiệm không-bó — I5 V15 từ không ra thành 1801 cây/30 s, lệnh I5 293 s -> 50 s**). **Mục 7A–7B**: hai mục trước chỉ có ở bản checkout chính, gộp vào đây 2026-10-26 khi gom code BE về `main`. Các đề xuất ở mục 5 chờ người dùng chốt.

## Mục lục
1. Zip chứa gì
2. Đối tượng so sánh thật sự: ERP gọi gì ở DNA-DEXUAT
3. Kết quả chạy thử hai engine trên cùng dữ liệu
4. So sánh chi tiết (thuật toán, vận hành)
5. Đề xuất / việc còn treo
6. Người dùng hỏi: tự viết thuật toán, không dùng OR-Tools thì sao? (đo 2026-10-20)
7. Nghiên cứu: Đề xuất thanh sắt bằng TypeScript thuần + HiGHS (WASM), không OR-Tools (đo 2026-10-20)
   - 7.6 Tăng tốc bằng chiến lược byN · 7.7 Giai đoạn 2: nối vào BE (`SOLVER_MODE=ts`), test tương đương, end-to-end · 7.8 Sửa nhãn "hết giờ" ở byN + chạy lại 4 file dữ liệu thật (2026-10-21) · 7.9 Loại sắt lớn hết giờ chưa có phương án: làm tròn LP + giải phần dư, dừng dò sớm (2026-10-22)
7A. 2026-10-20 — Hai nhánh song song đã xong + kiểm tra lại độc lập ở checkout chính (trước là mục 8 của bản ở main)
7B. 2026-10-20 — Chốt hướng B; PDF báo cáo trình lãnh đạo (trước là mục 9 của bản ở main)
8. 2026-10-23 — Thêm máy MC TỰ ĐỘNG (cắt theo bó) vào HiGHS, đối chiếu với module `cat_sat` gốc
9. 2026-10-23 — BE: HiGHS là bộ giải duy nhất (gỡ đường http/DEXUAT) + chọn máy cắt Laser/Tự động theo đợt (9.6: sửa sau review Opus)
10. 2026-10-23 — MC Tự động chậm/hết giờ: đường "thu hẹp" (nghiệm không-bó -> tập pattern -> bài bó thu hẹp -> bài bó đầy đủ); I5 V15 từ "không ra" thành 1801 cây/30 s
11. 2026-10-24 — Review UI: bằng chứng đặc cách dùng % thật, chữ lý do, và LỖI THẬT "ngưỡng 100 % làm mất phương án" ở bộ liệt kê kiểu cắt · 11.10 Luật gộp cứng (khung mốc cần sắt 3 ngày tính cả ngày đầu, tối đa 2 SKU) + fix-options

## 1. Zip chứa gì

`D:\cat_sat_iea\MC_CatSat_ExcelTool.zip` → thư mục `excel_tool/` (code trùng với `D:\cat_sat_iea\excel_tool`, chỉ khác
file .xlsm dữ liệu). Là bản viết lại MC Laser (`cat_laser_roi`) + MCTĐ (`cat_sat`) của app cũ thành:
Excel nhập liệu (.xlsm, macro nút "CHẠY TỐI ƯU") → Python + OR-Tools chạy **trên máy xưởng** → ghi sheet Kết quả /
Kế hoạch cắt / Lịch sử. Kèm `REVIEW_cat_laser_roi.md` (review app cũ, 18/10/2026) và bộ cài `CaiDat_MayXuong.bat`.

- `mc_laser_excel.py` (MC Laser): GĐ1 liệt kê pattern (CP-SAT enumerate, cache pickle) + **bổ sung pattern cho cỡ bị
  thiếu** (`ensure_coverage`) + **column generation Gilmore–Gomory**; lọc ĐOẠN CUỐI (kẹp 60 mm); GĐ2 hai mục tiêu
  (hao hụt → chênh lệch) với `<=` + solution hint + giữ nghiệm bước 1 nếu bước 2 hết giờ; chỉ đưa 20.000 pattern
  hao hụt thấp nhất vào GĐ2; tự nới hao hụt 1→2→4→8→10 %; dò chiều dài.
- `mc_tudong_excel.py` (MCTĐ, cắt theo bó): **không liên quan** — xưởng chỉ dùng laser (xem memory
  `floor-laser-only-no-bundle-cutting`).

## 2. Đối tượng so sánh thật sự

- ERP chỉ gọi 1 endpoint DEXUAT `POST /api/v1/de_xuat/propose/` (`cutting-proposals.service.ts`, cả đề xuất mua lẫn
  `verifyExactStandaloneWaste`) → engine là **`cat_sat/de_xuat_logic.py`**, KHÔNG phải `cat_laser_roi`.
- `cat_laser_roi/optimization_logic.py` trong DNA-DEXUAT **giống hệt byte** bản trong `cat_sat_iea` → mọi lỗi thuật
  toán trong `REVIEW_cat_laser_roi.md` mục 2 vẫn còn nguyên ở trang MC Laser của DEXUAT (nếu ai còn dùng trang đó).
- `de_xuat_logic.py` đã tự sửa sẵn 3 lỗi của app cũ: cận trên bám nhu cầu (không chặn 30), không cho thiếu, phân biệt
  hết giờ ≠ vô nghiệm, có cờ `patterns_truncated`, gợi ý `best_achievable`.

## 3. Kết quả chạy thử

Script: scratchpad `bench/compare.py` (gọi trực tiếp `optimize_one_material` và `mc_laser_excel.run_for_length`).
Tham số chung: cây 6000, tề 10, lưỡi 1, hao hụt ≤ 1 %, dư ≤ 10/cỡ, không cho thiếu, 120 s/bước, OR-Tools 9.15.

| Ca | DNA-DEXUAT | Excel + CG | Excel không CG |
|---|---|---|---|
| h10-20 (2 cỡ, 4.800 đoạn) | 325 cây, 0,353 %, dư 16, 0,1 s | 325 cây, 0,353 %, dư 16, 0,1 s | như bên trái |
| I3 CO-2201-00249 (9 cỡ, 1.900 đoạn) | **117 cây, 0,167 %, dư 15, 13 kiểu cắt, 187 s** | 117 cây, 0,167 %, dư 15, 17 kiểu, 254 s (FEASIBLE) | 117 cây, dư 16, 9 kiểu, 245 s |
| 12 cỡ ngẫu nhiên (seed 7) | **234 cây, 0,167 %, dư 3, 14 kiểu, 78 s** | 234 cây, 0,167 %, dư 3, 13 kiểu, 71 s (OPTIMAL) | 234 cây, dư 3, 20 kiểu, 233 s |

Kết luận đo: **chất lượng phương án như nhau ở cả 3 ca** (0,167 % = đúng phần tề đầu 10/6000, tức không còn khúc
thừa — chạm sàn). Con số "117 cây" mà review trong zip ghi cho tool Excel thì DNA-DEXUAT hiện tại cũng đạt; ca "app
cũ báo không có lời giải" là lỗi của `cat_laser_roi`, không phải của `de_xuat_logic`. Column generation không làm
giảm số cây, chỉ làm nhanh hơn (233 s → 71 s ở ca 12 cỡ nhờ có nghiệm gợi ý). Chưa đo ca 15 cỡ thật (SAT-HOP-10X20).

## 4. So sánh chi tiết

### 4.1 Tool Excel có, DNA-DEXUAT chưa có (đáng chép sang)
1. **Tầng 2 "mất nghiệm" — DEXUAT có lỗi này** (`de_xuat_logic.py:363-369`): sau tầng 1 khoá `total_leftover ==
   min_leftover` rồi giải lại không gợi ý; nếu tầng 2 hết giờ (UNKNOWN) thì `_unsolved` trả `feasible=False,
   timed_out=True` dù tầng 1 ĐÃ có phương án → chiều dài đó bị coi là "hết giờ" và kích hoạt giải lại ×3/×6 (tốn gấp
   nhiều lần). Tool Excel: `<=` + hint nghiệm tầng 1 + dùng lại nghiệm tầng 1 nếu tầng 2 hụt. Sửa nhỏ, rủi ro thấp.
   Chưa tái hiện được trên 3 ca đo (đều xong trong giờ).
2. **Bổ sung pattern cho cỡ bị thiếu** (`ensure_coverage`): DEXUAT liệt kê dừng ở 100.000 pattern hoặc 90 s; nếu
   một cỡ không có trong pattern nào thì IP INFEASIBLE và báo nhầm lý do "không thoả ràng buộc tồn kho", không
   retry (vì không phải UNKNOWN). Là rủi ro lý thuyết với loại 12–15 cỡ, chưa tái hiện.
3. **Column generation làm nghiệm gợi ý** → tăng tốc ca nhiều cỡ. Lưu ý: cột CG có thể vượt ngưỡng %/cây, trái với
   hợp đồng "mọi phương án đều đạt ngưỡng" của DEXUAT → nếu chép thì chỉ dùng làm hint, hoặc lọc theo ngưỡng.
4. Lọc ĐOẠN CUỐI / kẹp phôi 60 mm: DEXUAT không mô hình hoá. Tool Excel chỉ lọc khi có đoạn được đánh dấu, mặc định
   tắt. **Cần người dùng xác nhận** máy laser ở xưởng có bắt buộc khúc kẹp ≥ 60 mm không.

### 4.2 DNA-DEXUAT có, tool Excel không có
- Bung định mức (BOM), gom theo quy cách, nhiều loại sắt một lần, ngưỡng % và chiều dài cây riêng từng loại.
- Ưu tiên chiều dài **mua được**; ngưỡng hao hụt là bộ lọc cứng (tool Excel tự nới tới 10 % và cho cột CG vượt ngưỡng).
- Cận trên riêng từng pattern + cận dưới tổng số cây (giúp ra OPTIMAL); tool Excel dùng cận `sum(demand)*2` chung.
- Giới hạn 4 cỡ/cây → ít kiểu cắt hơn, dễ làm ở xưởng.
- Phân biệt hết giờ ≠ vô nghiệm, cờ `patterns_truncated`, `best_achievable`.
- Có API, ERP đang dùng (`cutting-proposals`, `cutting-batch-suggestions`); kết quả gắn được vào lệnh cắt / kho / tem QR.

### 4.3 Vận hành
- Tool Excel chạy riêng trên từng máy xưởng (cài Python, bật macro), kết quả nằm trong file Excel/thư mục `KetQua`,
  **không vào ERP** → hai nguồn số liệu cho cùng một lệnh cắt.
- DEXUAT production (`render.yaml`): `SECRET_KEY` tự sinh, `DEBUG=False`, `ALLOWED_HOSTS` giới hạn → điểm 3.3 của
  review trong zip không đúng với DEXUAT. Nhưng commit `9a7fec1 delete login` + healthCheck `/` cho thấy trang MC Laser
  công khai không đăng nhập, chạy chung instance free (`SOLVER_WORKERS=2`) với API của ERP và không có khoá chống chạy
  đồng thời → ai mở trang đó chạy bài lớn là làm chậm/timeout đề xuất của ERP. (Chưa kiểm tra trên server thật.)

## 5. Đề xuất / việc còn treo
1. Không triển khai tool Excel thành hệ thống song song; giữ làm công cụ dự phòng/đối chứng offline.
2. Chép sửa lỗi 4.1.1 vào `de_xuat_logic.py` (hoặc vào bản solver khi gộp vào BE theo changelog 2026-10-01) — CHƯA LÀM, người dùng chọn **để sau** (2026-10-20).
3. Cân nhắc 4.1.2 (+ 4.1.3 dạng hint) cho loại 12–15 cỡ; nên đo trước trên `segment_spec` thật — CHƯA LÀM.
4. Hỏi người dùng về kẹp 60 mm (4.1.4) và việc trang MC Laser trên DEXUAT còn ai dùng không (4.3) — CHỜ TRẢ LỜI.

## 6. Người dùng hỏi: tự viết thuật toán, không dùng OR-Tools thì sao? (đo 2026-10-20)

Bối cảnh: BE là NestJS (Node), OR-Tools không có bản Node chính thức → người dùng hỏi tự viết được không, chính xác
tới đâu. Đo bằng scratchpad `bench/greedy.py`: liệt kê pattern bằng DFS (≤ 1 % hao hụt, trần = nhu cầu) + heuristic
tuần tự (mỗi vòng lấy pattern ít hao hụt nhất còn vừa nhu cầu, dùng tối đa số cây) — tức cách "tự viết" phổ biến
nhất, không có bộ giải số nguyên.

| Ca | OR-Tools (DEXUAT) | Tự viết (heuristic) | Lệch |
|---|---|---|---|
| h10-20 (2 cỡ) | 325 cây, 0,353 %, dư 16 | 325 cây, 0,353 %, dư 16 | bằng nhau |
| I3 (9 cỡ) | 117 cây, 0,167 %, dư 15 | 121 cây, 0,189 %, **dư 82 đoạn** | +4 cây (+3,4 %), dư gấp 5 |
| 12 cỡ ngẫu nhiên | 234 cây, 0,167 %, dư 3 | **KHÔNG RA NGHIỆM** (kẹt, thiếu 134 đoạn) | — |

Kết luận ghi lại cho người dùng:
- Liệt kê pattern tự viết (DFS) là dễ và nhanh (1,4 s cho 152.150 pattern). Khâu khó là **chọn số cây cho mỗi
  pattern** (bài toán số nguyên): heuristic tự viết không có bảo đảm, ca thật I3 tốn thêm 4 cây và tồn 82 đoạn, ca
  nhiều cỡ bị kẹt hẳn. Muốn "chính xác như OR-Tools" phải có bộ giải số nguyên (branch-and-bound) — tự viết là viết
  lại một MIP solver, không khả thi.
- Lựa chọn trung gian đáng xem nếu muốn bỏ Python: **HiGHS (WASM) chạy trong Node** (`highs-js`) hoặc `glpk.js` —
  là thư viện bộ giải, không phải OR-Tools, nhưng giải ĐÚNG mô hình 2 tầng như DEXUAT → kết quả tối ưu như nhau
  khi giải tới OPTIMAL. Rủi ro: viết lại ~600 dòng logic sang TS + test tương đương; tốc độ trên 20k pattern chưa đo;
  có thể chậm hơn CP-SAT ở ca nhiều cỡ. CHƯA LÀM, chưa đo.

## 7. Nghiên cứu: Đề xuất thanh sắt bằng TypeScript thuần + HiGHS (WASM), không OR-Tools (đo 2026-10-20)

Câu hỏi: bỏ Python/OR-Tools, chạy phần tính ngay trong Node của BE thì có ra **đúng** phương án như DEXUAT và có
**đủ nhanh** không. Nguyên mẫu ở `solver-ts/` (gói riêng, cài bằng `pnpm install --ignore-workspace`, KHÔNG đụng
`package.json`/`pnpm-lock.yaml` gốc, KHÔNG nối vào Nest). Chỉ đọc `de_xuat_logic.py` + `api_de_xuat_propose`.

### 7.1 Mô hình của `de_xuat_logic.py` (ghi lại bằng lời — bản TS làm y hệt)
1. **Liệt kê kiểu cắt** cho mỗi chiều dài cây (số nguyên ×10): mỗi cỡ `0 ≤ x_k ≤ min(usable // l_k, nhu_cầu_k)`
   (cận trên bám nhu cầu, không chặn 30), `Σx ≥ 1`, `Σx·(l+lưỡi) ≤ cây − tề`, lọc **tổng sắt dùng (đoạn + lưỡi)
   ≥ ⌊cây·(1 − ngưỡng)⌋**, tối đa **4 cỡ/cây**; nếu cap 4 ra rỗng thì sinh lại không giới hạn (lưới an toàn).
   Dừng ở 100.000 kiểu hoặc 90 s → `patterns_truncated`. Khúc thừa/cây = cây − đoạn − lưỡi (= tề + đuôi).
2. **IP tầng 1**: biến `y_p` (số cây theo kiểu p), cận trên riêng `min_k ⌊(nhu_cầu_k + max_surplus)/counts_pk⌋`,
   ràng buộc `0 ≤ cắt_ra_k − nhu_cầu_k ≤ max_surplus` (không cho thiếu), cận dưới `Σy ≥ ⌈Σ nhu_cầu·(l+lưỡi) /
   (cây_max − tề)⌉`; mục tiêu **min tổng khúc thừa**.
3. **IP tầng 2**: khoá tầng 1 rồi **min tổng dư**. Python khoá bằng `==` và không gợi ý nghiệm → hết giờ ở tầng 2
   là mất luôn nghiệm tầng 1 (lỗi 4.1.1). **Bản TS: `<=` + nạp nghiệm tầng 1 làm điểm xuất phát + hết giờ thì giữ
   nghiệm tầng 1.**
4. **`optimize_one_material`**: chấm từng chiều dài chuẩn → chiều dài nào hết giờ mà chưa có nghiệm thì giải lại
   với thời gian ×3 rồi ×6 → nếu không chiều dài chuẩn nào được: `auto_scan` thì quét dải `[min, max]` bước `step`
   (có `stop_on_first`), không thì trả `best_achievable` (nới ngưỡng tới 100 % để nói thật cắt được tới đâu).
   Chiều dài chuẩn cắt được thì dùng luôn kể cả khi vượt ngưỡng (cờ `over_waste`).

Ghi chú phụ (không sửa, chỉ ghi): tổng khúc thừa = `cây·số_cây − Σ cắt_ra·(l+lưỡi)`, nên tầng 1 thực chất là "ít cây
nhất, hoà thì **ưu tiên cắt dư nhiều sắt hơn**"; tầng 2 mới kéo số đoạn dư xuống.

### 7.2 Nguyên mẫu TS
| File | Nội dung |
|---|---|
| `solver-ts/src/patterns.ts` | DFS liệt kê kiểu cắt, đúng ràng buộc mục 7.1.1, có cắt nhánh theo lượng sắt còn dùng được |
| `solver-ts/src/highs-solver.ts` | IP 2 tầng trên HiGHS; ma trận thưa CSC; `mip_abs_gap 0.999` (mục tiêu nguyên); ghi mốc thời gian từng nghiệm cải thiện + cận dưới |
| `solver-ts/src/optimize-material.ts`, `optimize-one-material.ts` | port `optimize_material`, `optimize_one_material`, `_best_achievable`, `_no_solution` (retry ×3/×6, auto_scan, stop_on_first) |
| `solver-ts/src/propose.ts` | port `explode_bom`/`normalize_spec`/`api_de_xuat_propose`: **cùng request/response JSON** (thêm `http_status` ở ca lỗi) |
| `solver-ts/bench.ts`, `bench-case.ts`, `compare-patterns.ts`, `smoke-propose.ts` | đo, so tập kiểu cắt với CP-SAT, thử hợp đồng JSON |

Thư viện: **`highs@1.15.4`** (HiGHS 1.15.1 bản WebAssembly, ĐH Edinburgh) — giấy phép **MIT**, gói 4,0 MB (wasm
3,5 MB), không native addon, `engines: node ≥ 18`, chạy tốt trên Node 22.13 của máy đo (Node 20 chỉ cần
WebAssembly chuẩn — chưa chạy thử riêng trên 20). **1 luồng** (bản WASM không có thread), `model.run()` chặn event
loop → khi nối thật phải chạy trong `worker_threads`. Phương án 2 `glpk.js@5.0.0` (GPL-3.0) **không thử**: HiGHS
đã đạt và GPL khó đưa vào BE. Gói dev cài thêm trong `solver-ts/`: `tsx@4.19.2`, `typescript@5.7.2`,
`@types/node@20.17.10`.

**Sửa ngoài `solver-ts/` (bắt buộc, 2 dòng):** thêm `"solver-ts"` vào `exclude` của `tsconfig.build.json` và
`tsconfig.json` gốc. Không có thì `nest build` lỗi TS6059 (file ngoài `rootDir: ./src`) và `tsc` gốc đòi gói `highs`.
Đã kiểm: danh sách file biên dịch của BE trước/sau **giống hệt** (1.553 file build, 1.694 file gốc), chỉ bỏ `solver-ts/`.
Code `solver-ts/` qua eslint + prettier của repo.

### 7.3 Số đo
Tham số chung: cây 6000, tề 10, lưỡi 1, ngưỡng 1 %/cây, dư ≤ 10/cỡ, không cho thiếu, `auto_scan=false`, thời gian
300 s **mỗi tầng**. Máy đo 12 luồng, mỗi ca 1 tiến trình (`pnpm tsx bench.ts` trong `solver-ts/`). Kết quả thô:
`solver-ts/bench-results.json` / `.md`.

| Ca | OR-Tools (DEXUAT) | HiGHS-TS | Khớp | Kiểu cắt (thời gian liệt kê) | Tầng 1 / tầng 2 | Tổng | RAM đỉnh |
|---|---|---|---|---|---|---|---|
| (a) h10-20, 2 cỡ | 325 cây, 0,353 %, dư 16, 0,1 s | 325 cây, 0,353 %, dư 16 | **trùng** | 3 (0,0 s) | OPTIMAL / OPTIMAL | **0,05 s** | 88 MB |
| (b) I3, 9 cỡ | 117 cây, 0,167 %, dư 15; 187 s (8 luồng), 290 s (2 luồng) | 117 cây, 0,167 %, dư 15 | **trùng** | 12.343 (0,05 s) | hết giờ / hết giờ — nghiệm cuối có ở giây 8,5 / 52 | **600 s** (nghiệm đã có từ ~60 s) | 533–625 MB |
| (c) 12 cỡ, seed 7 | 234 cây, 0,167 %, dư 3, 78 s | 234 cây, 0,167 %, dư 3 | **trùng** | 5.804 (0,03 s) | OPTIMAL 27 s / OPTIMAL 2,5 s | **30 s** (18,8 s khi máy rảnh) | 195 MB |
| (d) 15 cỡ, seed 11 | 628 cây, 0,209 %, dư 9, 20 kiểu; 381 s (8 luồng, đo trên máy cùng lúc chạy 2 việc nền) | 628 cây, 0,209 %, dư 9 | **trùng** | 2.967 (0,02 s) | OPTIMAL 49 s / OPTIMAL 0,3 s | **49 s** | 171 MB |

Ca (b) chi tiết: tầng 1 HiGHS chỉ chứng minh được cận dưới **116 cây** (11.600 = 116 cây × tề 10 mm, đơn vị ×10) —
tức chưa loại được khả năng 116 cây; tầng 2 cận dưới **dư 2**. 117 cây/dư 15 có thể chính là tối ưu, nhưng HiGHS
không chứng minh được trong 300 s/tầng nên **chạy đến hết giờ** dù nghiệm đã có từ phút đầu. Với
`time_limit_seconds` mặc định 480 s của API, ca này sẽ tốn ~960 s.

**So tập kiểu cắt DFS (TS) với CP-SAT (Python, cap 4, ngưỡng 1 %)** — `compare-patterns.ts`:
- Mọi kiểu cắt CP-SAT tìm được đều có trong tập TS; mọi kiểu cắt TS đều tự kiểm lại thoả ràng buộc.
- Ca (d): CP-SAT liệt kê xong 2.967 kiểu trong **83 s** → **trùng hoàn toàn** với TS (TS 0,02 s).
- Ca (b), (c): CP-SAT **bị cắt ở 90 s** (7.006/12.343 và 4.530/5.804 kiểu; đo lúc máy đang chạy bench song song nên
  có thể chậm hơn bình thường) → DEXUAT production có thể đang trả `patterns_truncated=true` cho loại 9–15 cỡ, tức
  tối ưu trên tập bị cắt cụt. TS liệt kê đủ trong < 0,1 s. Ở 3 ca tham chiếu, tập cắt cụt vẫn ra cùng phương án.

### 7.4 Kết luận
1. **Độ chính xác**: HiGHS-TS ra **đúng phương án OR-Tools ở cả 3 ca tham chiếu** (số cây, % hao hụt tới 1e-6, tổng
   dư). Ca 15 cỡ đo thêm: **cũng trùng** (628 cây, 0,209 %, dư 9; HiGHS-TS 49 s so với OR-Tools 381 s). Tổng cộng **trùng 4/4 ca**. Ở ca nào cả hai bộ giải giải tới OPTIMAL thì về lý thuyết phải trùng nhau (cùng mô hình,
   cùng tập kiểu cắt) — chỉ có thể khác ở **cách chọn kiểu cắt** khi nhiều phương án cùng tối ưu.
2. **Tốc độ**: liệt kê kiểu cắt **nhanh hơn CP-SAT hàng nghìn lần** (0,02–0,05 s so với 83 s đến > 90 s). Giải IP:
   ngang hoặc nhanh hơn ở ca 2 cỡ, 12 cỡ (30 s so với 78 s) và 15 cỡ (49 s so với 381 s); **chậm hơn rõ ở ca I3 9 cỡ** — ra nghiệm đúng sau
   ~60 s nhưng không chứng minh được tối ưu nên chạy hết 2 × time_limit (600 s so với 187–290 s của OR-Tools). HiGHS
   WASM chỉ 1 luồng, CP-SAT dùng 2–8 luồng.
3. **Tài nguyên**: RAM đỉnh 0,5–0,6 GB ở ca 12.343 kiểu cắt — sát/vượt gói 512 MB nếu chạy chung tiến trình BE.
4. **Khuyến nghị**: **về độ chính xác thì thay được**; KHÔNG nên thay ngay chỉ với nguyên mẫu này vì (a) ca khó như
   I3 tốn thời gian gấp 2–3 lần (**đã khắc phục ở 7.6: còn 9 s**), (b) chiếm 1 nhân + ~0,6 GB mỗi lần giải (7.6: còn
   ~0,3 GB), (c) chưa test tương đương trên định mức thật. Nếu muốn bỏ Python khỏi BE, đây là hướng đúng (không cần tự viết bộ giải) — với điều kiện làm các việc ở
   7.5. **Cập nhật 2026-10-21:** người dùng chọn hướng này (hướng B). Đã nối vào BE ở dạng `SOLVER_MODE=ts` (mục 7.7) và sửa nhãn hết giờ (mục 7.8); vẫn local, chưa deploy. Nếu ưu tiên ít rủi ro thì giữ hướng gộp Python+OR-Tools (phiên song song) và chỉ **chép bộ liệt kê DFS**
   sang Python để bỏ cảnh cắt cụt 90 s.

### 7.5 Chưa làm (ước lượng nếu thay thế thật)
Cập nhật trạng thái 2026-10-21 ở cột cuối (chi tiết ở 7.7, 7.8).

| Việc | Ước lượng | Trạng thái 2026-10-21 |
|---|---|---|
| Chạy solver trong `worker_threads` (HiGHS chặn event loop), hàng đợi 1 bài/lúc, giới hạn RAM | 1–2 ngày | ĐÃ LÀM (7.7.1) |
| Dừng sớm khi không cải thiện X giây (callback `mipInterrupt`) cho ca kiểu I3 — đổi ngữ nghĩa "chạy tới hết giờ", cần người dùng chốt | 0,5 ngày + đo | KHÔNG CẦN: byN (7.6) giải I3 trong 9 s có chứng minh |
| Nối vào `cutting-proposals.service.ts` thay HTTP DEXUAT (sau khi phiên gộp Python xong, tránh đụng file) | 1 ngày | ĐÃ LÀM: `SOLVER_MODE=ts` (7.7.1) |
| Test tương đương Python ↔ TS trên `segment_spec`/định mức thật (nhiều loại sắt, nhiều chiều dài, `allow_mix`, `auto_scan`, `best_achievable`, số thập phân 660,5 mm) | 2–3 ngày | ĐÃ LÀM: 50 request DB (7.7.3) + 4 file thật 98 nhóm (7.8.3) + test đơn vị |
| `auto_scan` quét cả trăm chiều dài: mỗi lần dựng model HiGHS mới; chưa đo | đo trước | ĐO MỘT PHẦN: cấu hình A của 4 file thật (dò 5000–6000 bước 10) chạy hết trong 350 s cho 98 nhóm; chưa đo riêng ca xấu nhất |
| Chưa chạy thử riêng trên Node 20; chưa đo khi nhiều request đồng thời | 0,5 ngày | Node 20 ĐÃ KIỂM (Docker node:20-alpine); đồng thời: chỉ đo màn "Tối ưu cắt sắt" (7.7.4, 7.8.4) |

Các phần của `optimize_one_material` **đã port** nhưng **chưa có test riêng**: retry ×3/×6, `auto_scan`/`stop_on_first`,
`best_achievable`, `allow_mix=false`, cap 4 → sinh lại không giới hạn. Đã thử hợp đồng JSON (`smoke-propose.ts`):
gom quy cách `10*20`/`10x20` về một nhóm, `stock_lengths_by_material`, nhánh đoạn dài hơn cây trả `feasible=false`.

### 7.6 Cải thiện tốc độ: giải theo số cây N với cận dưới knapsack (đo 2026-10-20, cùng ngày)

Người dùng hỏi có cách nào cải thiện tốc độ ca khó I3 không. Phân tích mốc thời gian (7.3): HiGHS tìm ra 117 cây
từ giây 8 nhưng không **chứng minh** được là tối ưu — cận dưới của nó kẹt ở 116 cây vì bài nới lỏng cho phép số cây
lẻ và đoạn dư lẻ. Bằng tay thì chứng minh rất ngắn: với 116 cây toàn lô chỉ còn 140 mm sắt trống, không cắt thêm được
đoạn dư nào (đoạn ngắn nhất 175 mm) → phế = 1.300 mm, tệ hơn 1.170 mm của 117 cây.

**Cách làm (chiến lược `byN`, `solver-ts/src/highs-solver.ts`)** — dùng đồng nhất thức
`tổng_khúc_thừa = cây·N − Σnhu_cầu·(l+lưỡi) − sắt_thành_đoạn_dư`:
1. Knapsack nhỏ trong TS: với mỗi lượng sắt v, có gom được ĐÚNG v bằng các đoạn dư (mỗi cỡ ≤ `max_surplus`) không
   và ít nhất bao nhiêu đoạn. Từ đó **cận dưới chính xác cho từng N**: `bound(N) = cây·N − need − S(N)`, S(N) = sắt
   dư gom được nhiều nhất mà vẫn ≤ cây·N − need − w_min·N.
2. Tầng 1: giải các N theo `bound(N)` tăng dần, cố định `Σy = N`, đặt `objective_target = bound(N)` → HiGHS dừng ngay
   khi chạm (tối ưu đã chứng minh bên ngoài). Dừng vòng khi `bound(N kế) ≥ nghiệm tốt nhất`.
3. Nếu N đầu không chạm cận (ca không "cắt kín", cận knapsack lỏng) → **quay về `direct`** (model gốc, HiGHS tự
   chứng minh). Đo: cho nghiệm byN làm điểm xuất phát lại CHẬM hơn (70–87 s so với 26–30 s ở ca 15 cỡ) nên không nạp.
4. Tầng 2: cận dưới = tổng nhu cầu + số đoạn dư ít nhất gom đúng lượng sắt dư đó (từ knapsack) → `objective_target`;
   xét mọi N có `bound(N) ≤ min_leftover`; cùng cơ chế quay về.
Chỉ áp dụng khi 1 chiều dài cây (đúng cách `optimize_one_material` gọi); nhiều chiều dài → `direct`.
`SOLVER_STRATEGY=direct` để so. Kết quả tối ưu **không đổi**, chỉ đổi cách chứng minh.

| Ca | OR-Tools | HiGHS-TS `direct` (7.3) | HiGHS-TS `byN` | Đường đi tầng 1 |
|---|---|---|---|---|
| (a) 2 cỡ | 0,1 s | 0,05 s | **0,1 s** | N=324 vô nghiệm, N=325 tối ưu |
| (b) I3, 9 cỡ | 187–290 s | 600 s (hết giờ, chưa chứng minh) | **9,1 s** (chứng minh xong) | N=117 chạm cận 4,7 s; tầng 2 chạm cận 4,3 s |
| (c) 12 cỡ | 78 s | 19–30 s | **4,5 s** | N=234 chạm cận 4,0 s |
| (d) 15 cỡ | 381 s | 29–49 s | **35 s** | N=628 không chạm (6,6 s) → direct 27,7 s |

Cùng phương án ở cả 4 ca (số cây, %, dư). RAM đỉnh ca I3 giảm 625 → 276 MB (model theo N nhỏ hơn). Chạy lại nhiều
lần: I3 9–16 s, 12 cỡ 4,5–7 s, 15 cỡ 34–37 s (dao động theo tải máy).

Vì sao chạy được: cả 3 ca nhiều cỡ (9, 12, 15) OR-Tools đều ra phương án **cắt kín** (phế = đúng tề đầu) hoặc gần
thế; khi cố định N, cận dưới của bài nới lỏng trùng với cận knapsack nên HiGHS chỉ cần *tìm* nghiệm, không phải
*chứng minh*. Ca không cắt kín (15 cỡ) thì cận lỏng → quay về direct, mất thêm ~7 s so với direct thuần.
Chưa đo trên định mức thật; chưa áp dụng cho `auto_scan` (mỗi chiều dài là một lần byN).

Kết luận cập nhật: điểm yếu "I3 chậm gấp 2–3 lần OR-Tools" ở 7.4 **đã hết** — HiGHS-TS giờ nhanh hơn OR-Tools 8 luồng
ở cả 4 ca (10–20 lần ở ca 9–12 cỡ). Các việc 7.5 (worker thread, nối BE, test tương đương) vẫn giữ nguyên.

### 7.7 Giai đoạn 2: nối solver TS + HiGHS vào BE (SOLVER_MODE=ts), worker thread, test tương đương (2026-10-20)

Người dùng chọn hướng B: "tiếp tục hoàn thiện solver TypeScript + HiGHS (worker_threads, nối vào cutting-proposals,
test tương đương định mức thật), vẫn ở local, chưa deploy". Trạng thái: **xong ở local, CHƯA deploy, CHƯA push**.

#### 7.7.1 Đã làm
| Việc | Chi tiết |
|---|---|
| Đưa solver vào BE | `solver-ts/` → `src/modules/cutting-proposals/solver-ts/` (7 file). `highs@1.15.4` vào `package.json` gốc (lockfile +9 dòng). Bỏ `package.json`/`pnpm-lock` riêng và 2 dòng exclude tạm trong tsconfig. Script đo/so → `test/solver-ts-bench/` (không vào build). |
| `SolverClientService` | `src/modules/cutting-proposals/solver-client.service.ts`: 1 hàm `propose(body, timeoutMs)`, 2 nhánh theo `SOLVER_MODE`: `http` (mặc định, giữ nguyên hành vi gọi DNA-DEXUAT qua ExternalApiService) và `ts`. Nhánh ts ép lỗi về đúng 2 kiểu nhánh http ném: `propose()` trả `status:'error'` (400 INVALID_INPUT / 500 SOLVER_ERROR như Django) → `ExternalApiHttpError(http_status, body)`; worker hết giờ/chết/tràn RAM → `ServiceUnavailableException`. `cutting-proposals.service.ts` (lượt giải chính + `verifyExactStandaloneWaste`) gọi qua lớp này; `saveFailure`/`extractErrorMessage` không đổi. Cùng cấu trúc với nhánh A (`solver-python-in-be`), bỏ phần spawn Python. |
| Worker thread | `solver-ts/solver.worker.ts` + `solver-worker-host.ts`: HiGHS `model.run()` chặn luồng nên chạy trong `worker_threads`; hàng đợi FIFO, `SOLVER_TS_WORKERS` worker (mặc định 1 = đúng "1 lượt giải tại 1 thời điểm" của `enqueueSolverRun`); `timeoutMs` tính từ lúc gọi (gồm chờ hàng đợi) → quá giờ `terminate()` worker, bài kế tạo worker mới; `SOLVER_TS_HEAP_MB` (resourceLimits, KHÔNG gồm bộ nhớ WASM) + `SOLVER_TS_MAX_RSS_MB` (watchdog RSS 500 ms, terminate worker đang chạy) → tràn RAM chết worker, API sống. Worker tự thoát khi runtime WASM hỏng (xem 7.7.3). Chạy từ dist: `solver.worker.js`; dưới ts-node/ts-jest: `.ts` + `-r ts-node/register`. |
| Cấu hình | `configuration.ts` (`solver.mode`, `solver.ts.{workers,heapMb,maxRssMb}`), `env.validation.ts` (SOLVER_MODE http\|ts, SOLVER_TS_WORKERS 1-4, SOLVER_TS_HEAP_MB, SOLVER_TS_MAX_RSS_MB), `.env.example`. Không sửa `render.yaml`/Dockerfile (highs là gói npm thuần, image node:20 không cần gì thêm). |
| Test đơn vị mới | `patterns.spec` (round half-even, 660,5 mm, lọc tổng sắt dùng, cap 4, giới hạn số pattern), `highs-solver.spec` (byN = direct trên 12 ca ngẫu nhiên, vô nghiệm, greedyStart khả thi), `optimize-material.spec` (ca tham chiếu, nhiều chiều dài/allow_mix, cap 4 → sinh lại, hồi quy proposal 2), `optimize-one-material.spec` (retry ×3/×6, auto_scan/stop_on_first, best_achievable, hết giờ — qua `optimizeMaterialImpl` giả), `propose.spec` (hợp đồng JSON, ngưỡng/chiều dài theo loại, mảng/chuỗi), `solver-worker-host.spec` (FIFO, pool 2, timeout kể cả khi chờ, crash, WASM hỏng, RSS, close + worker thật), `solver-client.service.spec` (http passthrough, ép lỗi 400/500/ServiceUnavailable, destroy). `pnpm test` toàn bộ: 88 suite, 1.920 test xanh (1 skip có sẵn), đo 2026-10-21 sau cả mục 7.8. `pnpm build` (nest) xanh, `pnpm lint:check` 0 lỗi (94 warning có sẵn). |
| Node 20 | Máy không có nvm/volta → biên dịch solver + bench ra thư mục tạm, chạy trong Docker `node:20-alpine` (v20.20.2): ca (a) 325 cây 0,50 s, ca I3 117 cây/0,1667 %/dư 15 trong 27,6 s (máy đang chạy 3 việc khác; native Windows 9 s). Chạy được, cùng kết quả. |

#### 7.7.2 Lỗi tìm ra nhờ dữ liệu thật và đã sửa
1. **byN kết luận "vô nghiệm" sai** (proposal 2, loại 4: 615×2400, 610×2400, 500×1200, 255×2400, ngưỡng 1 %): danh sách N ứng viên của byN chỉ gồm các N có cận dưới thấp (695–699), đều vô nghiệm; N tối ưu 701 nằm ngoài → trả "vô nghiệm" → `optimize_one_material` đi vét cạn và chọn 5790 mm (0,17 %) thay vì 6000 mm × 701 cây 0,9399 % như DEXUAT. Sửa: N vô nghiệm = 1 lần trượt → về model gốc ngay; hết ứng viên chưa có nghiệm → về model gốc. Có test hồi quy. Đây cũng là lý do xác minh chính xác trên màn "Tối ưu cắt sắt" lúc đầu chỉ được 4/214 (vô nghiệm sai → chạy tiếp `best_achievable` nới 100 % → chậm).
2. **Runtime WASM hỏng kéo theo mọi lần giải sau**: sau 1 lần giải 658 s (request nặng), HiGHS WASM báo `Aborted()` / `Unable to allocate WebAssembly memory`, và vì worker được dùng lại nên 37 request kế tiếp lỗi 500 ngay (0,0 s). Sửa: worker trả lỗi cho bài đó rồi tự thoát; host thấy `exit` → tạo worker mới (WASM mới). Có test với worker giả.
3. **HiGHS WASM vượt `time_limit` 2–3 lần trên model lớn** (loại 7 cỡ có đoạn 20 mm × 120 → 24.184 pattern; loại 11 cỡ → 41.842 pattern): limit 20 s mà tầng 1 chạy 58–64 s, nghiệm đầu ở giây 52–60, RAM 1,4–1,6 GB; `mipInterrupt` callback không được gọi trong pha gốc nên tự ngắt cũng không giúp (đã thử; vẫn giữ để ngắt được ở pha B&B). Thử 5 tuỳ chọn HiGHS (presolve off, symmetry, heuristic effort, restart): không cái nào tôn trọng giới hạn. Giải pháp đo được (bảng dưới): (a) **chỉ đưa 5.000 pattern ít khúc thừa nhất vào IP** + bảo đảm mỗi cỡ có mặt (như tool Excel 20.000; `SOLVER_TS_MAX_IP_PATTERNS=0` = ngữ nghĩa Python đưa hết), (b) **nghiệm tham lam làm điểm xuất phát** (`greedyStart`, `SOLVER_TS_WARM_START=0` tắt), (c) byN không chứng minh được ở N đầu thì về model gốc với phần còn lại của ngân sách. Đã thử cho mỗi N chỉ 50 % ngân sách tầng, nhưng bỏ vì làm hụt 3/50 request thật (42 cây 0,188 % thay vì 41 cây 0,1667 %), xem `BYN_BUDGET_FRACTION`.

| Loại 7 cỡ, 24.184 pattern, limit 20 s/tầng | Kết quả | Tầng 1 / 2 | RAM |
|---|---|---|---|
| Không cắt, byN | 41 cây **0,38 %** (hết giờ) | 63 s / 56 s | 1,58 GB |
| Không cắt, direct | 41 cây 0,1667 % tối ưu | 58 s / 35 s | 1,39 GB |
| Cắt 10.000 + tham lam | 42 cây 0,1786 % (hết giờ) | 23 s / 22 s | 0,91 GB |
| **Cắt 5.000 + tham lam (mặc định mới)** | **41 cây 0,1667 % tối ưu** | 19 s / 9 s | 0,71 GB |
| Cắt 2.000 + tham lam | 41 cây 0,1667 % tối ưu | 6 s / 7 s | 0,39 GB |
| Loại 11 cỡ, 41.842 pattern: cắt 10.000 | 325 cây 0,1671 % (hết giờ) | 20 s / 20 s | 0,48 GB |
| Loại 11 cỡ: **cắt 5.000** | **324 cây 0,1667 % tối ưu** | 7 s / 15 s | 0,39 GB |

4 ca tham chiếu với mặc định mới (cắt 5.000, tham lam): **vẫn trùng OR-Tools** — (a) 0,1 s, (b) I3 5,8 s, (c) 11,7 s, (d) 48,6 s (`test/solver-ts-bench/bench-results.md`).

#### 7.7.3 Test tương đương trên dữ liệu thật
Bộ so `test/solver-ts-bench/compare-with-saved.ts`: lấy cặp `requestParams`/`rawResponse` đã lưu trong bảng
`cutting_proposals` (DB local), chạy lại qua đúng `SolverClientService`, so từng loại sắt theo chiều dài cây, số cây,
% hao hụt (sai số 1e-6) và tổng đoạn dư. Chỉ lấy proposal từ id 24 trở đi (`--from-id 24`): các proposal đầu do
DEXUAT phiên bản cũ tạo ra, nên lệch cả với DEXUAT hiện tại (nhánh A cũng chỉ xác nhận từ 24). Số request khác nhau
từ id 24 là 50, ứng với 212 lượt loại sắt. Đo 2026-10-21 trên mã TRƯỚC khi sửa nhãn ở mục 7.8; bản sửa nhãn không
đổi phương án (mục 7.8.3).

| Chạy lại qua | Loại sắt khớp bản lưu | Hết giờ (không so) | Lệch | Thời gian |
|---|---|---|---|---|
| **TS + HiGHS** (`--mode ts`) | **208** | 3 | **1** (cùng cây và %, dư 12 so với 13 đã lưu: TS **ít dư hơn**) | 349 s cho 50 request, trung vị 0,2 s, lâu nhất 119 s |
| DNA-DEXUAT hiện tại (`--mode http`) | 156 | 0 | 11: 7 request lỗi `fetch failed` (DEXUAT cắt kết nối ở request dài), 4 loại sắt DEXUAT tự lệch với bản lưu của chính nó | 3.168 s, chỉ 43 request thành công |

So **trực tiếp TS với DEXUAT hiện tại** trên 43 request cả hai cùng chạy được (`diff-compare-logs.ts`): **154 loại
trùng, 5 khác**. Ở cả 5 ca khác, TS **bằng hoặc tốt hơn**: cùng số cây, % hao hụt bằng hoặc thấp hơn, đoạn dư ít hơn.
Ví dụ proposal 60, loại 8: TS 29 cây 0,1667 % dư 12; DEXUAT 29 cây 0,1914 % dư 21.

3 ca "hết giờ": proposal 33 loại 3, cả hai bên đều vô nghiệm. Proposal 155–157 và 170 (12 loại sắt): bản lưu tốn
1.610 s và hết giờ. TS giải cả request trong 119 s; loại 8 ra 6000 mm × 40 cây 0,1667 %, trong khi bản lưu là
4000 mm × 60 cây 0,27 %.

#### 7.7.4 End-to-end local
**Luồng "Tính phương án cắt" thật** (`test/solver-ts-bench/e2e-batch-solve.ts`): dựng nguyên `AppModule` với DI thật
và DB local, gọi `requestForBatch` trên PI item 24 + 95 (9 loại sắt). Luồng đi qua hàng đợi FIFO, rồi
`SolverClientService`, rồi `saveSuccess` ghi DRAFT. Xong thì gỡ bằng `discardBatchSolve`. Đây là cùng bộ dữ liệu
nhánh A đã dùng.

| Chế độ | Kết quả | 9 loại sắt | Thời gian giải (`totalSolveSeconds`) | Thời gian thực |
|---|---|---|---|---|
| `SOLVER_MODE=http` | DRAFT, 167 cây, 0,264 % | — | 54,4 s | 1.204 s (*) |
| `SOLVER_MODE=ts` | DRAFT, 167 cây, 0,264 % | **9/9 trùng** chiều dài, số cây, % và dư | **14,5 s** | 15,3 s |

(*) Lúc đo, DEXUAT còn bận giải các request mà bộ so sánh trước đó đã bỏ dở, nên request phải chờ. Con số 1.204 s
không đại diện cho tốc độ DEXUAT. Ghi `cutting_proposal_lines` đủ 9 dòng ở cả hai chế độ. Con số 167 cây, 0,264 %
trùng mốc của nhánh A.

**Màn "Tối ưu cắt sắt"** (`getBatchCandidates`): đếm số loại sắt được xác minh chính xác trong ngân sách 12 s. Mỗi lần
gọi có trần 8 s, `time_limit` 5 s, và có 6 lần gọi song song.

| Cấu hình | Xác minh chính xác | Thời gian trang |
|---|---|---|
| http (DEXUAT, CP-SAT 8 luồng) | 119/214 | 17,3 s |
| ts, 1 worker (mặc định) | 8/214 | 16,7 s |
| ts, 2 worker | 46/214 | 19,6 s |
| (lần đo 2026-10-20, mã trước khi cắt pattern và sửa nhãn) ts 1 / 2 worker | 61 / 150 | 14,0 / 8,4 s |
| **Sau khi nhớ tạm theo body (7.8.4 hướng a, 2026-10-21)**: ts 1 worker / ts 2 worker / http | **175 / 175 / 175** | 8,5–8,9 / 7,4–7,5 / 5,7–6,6 s |

Vì sao giảm so với lần đo 2026-10-20: xem mục 7.8.4. Tóm tắt: mã cũ gắn nhãn "hết giờ" giả trong 0,1 s cho loại vô
nghiệm, nên trả về nhanh mà không có kết quả. Mã mới báo đúng "vô nghiệm" rồi đi tìm `best_achievable` như DEXUAT,
và bước này đắt.

#### 7.7.5 Chưa làm / cần người dùng chốt
- **Deploy**: chọn gói Render đủ RAM — đo RSS đỉnh 0,4–0,7 GB mỗi lượt giải với mặc định mới (1,4–1,6 GB nếu tắt cắt pattern); gói 512 MB không đủ. Đặt `SOLVER_TS_MAX_RSS_MB` theo gói.
- **Tắt DNA-DEXUAT** sau khi chạy song song `SOLVER_MODE=ts` một thời gian ở production.
- **Ngữ nghĩa khác Python** (đều có biến tắt): cắt 5.000 pattern, nghiệm tham lam, tầng 2 `<=` giữ nghiệm tầng 1. Kết quả tối ưu không đổi ở mọi ca đo, nhưng về lý thuyết cắt pattern có thể làm mất nghiệm tối ưu ở ca hiếm (chưa gặp).
- `auto_scan` quét cả trăm chiều dài: mỗi chiều dài là 1 lần byN/direct — đã chạy trong e2e (3 loại chọn 4100/4250/4600 mm) nhưng chưa đo riêng ca xấu nhất.
- `SOLVER_TS_WORKERS`: giữ 1 (mặc định). Sau khi nhớ tạm (7.8.7), 1 worker đã xác minh được 175/214 như 2 worker; 2 worker có thể ăn tới 2 × RSS.
- Trạng thái commit: theo yêu cầu người dùng 2026-10-21, toàn bộ là thay đổi CHƯA commit (xem 7.8.6).

### 7.8 Sửa nhãn "hết giờ" sai cho chiều dài vô nghiệm thật (byN) + chạy lại 4 file dữ liệu thật (2026-10-21)

Yêu cầu của người dùng: "sửa lỗi nhãn 'hết giờ' ở byN (proven() không tính infeasible, thiếu best_achievable), kèm
test cho các nhóm FI4/FI6/FI10 của I5, rồi chạy lại 4 file test thật để xác nhận". Mọi thay đổi ở dạng **chưa
commit** trong worktree `solver-ts-research-1a4370`. Người dùng đã yêu cầu không commit, xem 7.8.6.

#### 7.8.1 Lỗi
Ở chiến lược byN, một N vô nghiệm bị tính là "trượt" và làm `proven1 = false`, vì `proven()` chỉ nhận `optimal` và
`optimal_by_bound`. Sau đó bộ giải về model gốc. Model gốc cũng `infeasible`, nhưng code lại đặt
`proven1 = r.status === 'optimal'`, nên tầng 1 trả `time_limit_no_solution`.

Hệ quả là `optimize-one-material` báo `timed_out=true` và `timeout_lengths=[6000]`, kèm lý do "Hết thời gian ở cả 1
chiều dài đã thử… tăng thời gian chạy". Nó cũng không đi nhánh `_no_solution`, nên **mất `best_achievable`**.
Ở cấu hình có dò chiều dài, `timeout_count` > 0 làm UI cảnh báo hết giờ sai. Ba phiên test dữ liệu thật độc lập đã
xác nhận lỗi: **26/98 nhóm** bị gắn nhãn hết giờ sai, còn số cây và % hao hụt không đổi.

#### 7.8.2 Chọn bản sửa
Có 3 bản ứng viên, đều làm ở worktree khác và đều cùng gốc `ce8f8e4`. Tôi chỉ đọc chúng và áp thay đổi vào working
tree của mình, không cherry-pick.

| Bản | Cách sửa | Ghi chú |
|---|---|---|
| `confident-hypatia` (97665b1) | Model gốc trả `infeasible` khi byN chưa có nghiệm thì coi là vô nghiệm đã chứng minh | Nhỏ, nhãn đúng. Nhưng mọi N vô nghiệm vẫn là "trượt", nên luôn tốn thêm 1 lần giải model gốc |
| `serene-mcclintock` (8d0abe4) | Lấy thẳng trạng thái của lần giải model gốc | Tương tự bản trên |
| **`wonderful-mclaren` (chưa commit) — ĐƯỢC CHỌN** | N vô nghiệm = đã chứng minh, **chỉ loại N đó** và xét N kế. Ca "N tối ưu nằm ngoài danh sách ứng viên" (proposal 2, loại 4: 701 cây) chặn bằng **mốc đuôi danh sách** có cận `cây·N − need − V`. Model gốc `infeasible` thì tầng 1 `infeasible`. Cần model gốc mà hết giờ thì là "chưa chứng minh". Tầng 2 xét thêm các N đuôi có cùng khúc thừa | Sửa tận gốc. Có test dựng tay cho ca N tối ưu ngoài danh sách. Đã dò 3.150 ca ngẫu nhiên: byN và direct cùng trạng thái, cùng khúc thừa, cùng dư |

Lý do chọn: bản này sửa đúng chỗ sai là "N vô nghiệm bị tính là trượt", chứ không chỉ vá nhãn ở cuối. Ca 701 cây
được chặn có chứng minh, nhờ cận của mốc đuôi. Test hồi quy proposal 2 trong `optimize-material.spec.ts` vẫn xanh.

**Sửa phụ** trong `optimize-one-material.ts` (`noSolution`), chỉ đổi chuỗi `reason`, giữ nguyên các trường JSON như
DEXUAT. Khi `best_achievable.waste_pct` đã ≤ ngưỡng mà vẫn vô nghiệm, lời khuyên cũ "Nâng ngưỡng lên ≥ 0,54 %" là vô
nghĩa, vì ngưỡng đang là 1 %. Lỗi này OR-Tools cũng mắc. Thứ thật sự chặn là **ngưỡng tính trên từng cây kết hợp với
`max_surplus`**. Ví dụ I5 FI6 (60 mm × 2240): kiểu cắt duy nhất đạt 1 %/cây là 98 đoạn/cây, 23 cây cho dư 14, vượt
mức 10. Lý do mới: "Không có cách cắt nào mà mọi cây đều ≤ 1% hao hụt và dư ≤ 10 đoạn mỗi cỡ… Nới số đoạn dư tối đa
(đang 10) hoặc ngưỡng hao hụt mỗi cây…". Có test chứng minh lời khuyên đúng: với `max_surplus` 14, FI6 cắt được ở
6000 mm × 23 cây.

#### 7.8.3 Chạy lại 4 file dữ liệu thật
Script `test/solver-real-data/rerun-highs-after-fix.ts` đọc 4 JSON cũ (chép nguyên vào `results-before/`; script gốc
đã tạo ra chúng chép vào `orig-scripts/<tên>/`). Với mỗi nhóm (sheet, loại sắt, cấu hình), script giải bằng
`optimizeOneMaterial` đã sửa, với đúng tham số `propose()` dùng cho cấu hình đó. **A**: mặc định ERP, dò 5000–6000
bước 10, dừng ở chiều dài đầu đạt, 20 s. **B**: chỉ 6000, 120 s. Mọi nhóm chạy tuần tự trong 1 tiến trình, tổng 350 s.

Đầu ra `results-after-fix/{j55,i41-42,i3,i5}.json` cùng schema với file cũ. Khối `ortools` giữ nguyên. Khối `highs`
được dựng lại theo đúng cách script gốc của từng file suy ra từng trường. `match` và `diff_note` được tính lại theo
luật so khớp của từng file. Bảng so trước/sau nằm ở `results-after-fix/SUMMARY.md` và `summary.json`.

| File | Nhóm | Phương án HiGHS **không đổi** | Hết giờ sai (HiGHS có, OR-Tools không) trước → sau | Trùng OR-Tools trước → sau | Nhóm vô nghiệm: `best_achievable` trùng OR-Tools |
|---|---|---|---|---|---|
| J55 | 60 | 60/60 | 12 → **0** | 60 → 60 | 13/13 (trước 4/13: 9 nhóm thiếu) |
| I41+42 | 12 | 11/12 (*) | 0 → 0 | 11 → 11 | — |
| MZ I3 | 12 | 12/12 | 8 → **0** | 11 → 11 | 4/4 (trước 0/4) |
| MZ I5 | 14 | 14/14 | 6 → **0** | 8 → **11** | 3/3 (trước 0/3) |
| **Tổng** | **98** | **97/98** | **26 → 0** | **90 → 93** | **20/20** (trước 4/20) |

Kiểm 3 điều kiện:

1. **Số cây, chiều dài, mm hao hụt và dư không đổi ở 97/98 nhóm.** (*) Nhóm khác là I41 V15 cấu hình A: 9 cỡ, có cỡ
   thập phân và đoạn 45 mm. Nhóm này luôn chạy chạm giới hạn 20 s và trả nghiệm tốt nhất lúc hết giờ. JSON cũ ghi
   1188 cây 13.238 mm dư 7. Lần này ra 1188 cây **12.926 mm** dư 9, tốt hơn cả OR-Tools (1189 cây 13.043,8 mm).
   Chạy lặp 3 lần với mã mới và 3 lần với mã trước khi sửa (trích từ `ce8f8e4`, `repeat-group.ts`): cả 6 lần đều ra
   1188 cây 12.926 mm dư 9. Vậy khác biệt **không do bản sửa**, mà do lần đo cũ hết giờ ở điểm khác (phụ thuộc tải
   máy lúc đó).
2. **Không còn nhóm nào HiGHS `timed_out=true` mà OR-Tools không**: 26 → 0.
3. **20/20 nhóm vô nghiệm có `best_achievable` trùng OR-Tools** (chiều dài, số cây, % sai số 1e-3). Trước khi sửa,
   16 nhóm thiếu `best_achievable`. I5 tăng từ 8 lên 11 nhóm trùng chính vì 3 nhóm FI10/FI4/FI6 cấu hình B giờ có
   `best_achievable` trùng.

Mọi nhóm khả thi đều qua bước tự kiểm phương án (vừa cây, đủ số lượng, dư ≤ 10, tổng khớp), như `check_plan` của
I5. Nhóm I41 V15 cấu hình A **vẫn lệch OR-Tools**, như lần đo cũ: HiGHS ít hơn 1 cây, hao hụt thấp hơn, dư ít hơn.
Cả hai bên đều chạy chạm giới hạn thời gian.

#### 7.8.4 Hệ quả: xác minh chính xác trên màn "Tối ưu cắt sắt" chậm hơn (đã xử lý bằng hướng a, 7.8.7)
Số loại được xác minh trong ngân sách 12 s giảm: 1 worker từ 61 xuống 8, 2 worker từ 150 xuống 46. Bảng ở 7.7.4.
Đã phát lại tuần tự đúng 186 lần gọi mà trang gửi (`probe-verify-calls.ts`). Tổng 78,6 s, không lần nào quá 8 s.
Nhưng **11 lần gọi của cùng một loại sắt** [30 mm × 120, 60 mm × 240], lặp ở 11 SKU với body giống hệt, chiếm
**73,2 s**. 175 lần còn lại chỉ mất 5,4 s.

- Mã cũ gắn nhãn "hết giờ" giả cho loại này trong 0,09 s, nên trả nhanh mà không có kết quả.
- Mã mới báo đúng "vô nghiệm ở 1 %" rồi đi tìm `best_achievable` như DEXUAT. Bước này nới ngưỡng lên 100 %, có 8.253
  pattern (cắt còn 5.000), và tầng 1 chạy hết `time_limit` 5 s. Kết quả đúng là 4 cây 21,7 %, nhưng mỗi lần mất
  khoảng 6–10 s, chặn hàng đợi 1 worker.

Hướng xử lý đã đưa người dùng chọn:
- **(a) Nhớ tạm kết quả theo body trong cùng một lần tải trang. ĐÃ LÀM (người dùng chọn 2026-10-21), xem 7.8.7.**
- (b) Không làm. Làm bước `best_achievable` rẻ hơn, ví dụ bỏ tầng 2 hoặc hạ `time_limit` riêng cho bước này. Đổi ngữ nghĩa so
  với Python.
- (c) Không làm. Đặt `SOLVER_TS_WORKERS=2`. RAM tăng tới 2 lần. Sau (a) thì không cần: 1 worker đã đạt 175/214.

#### 7.8.5 Test
`optimize-one-material.spec.ts` có thêm các test sau. I5 FI10, FI4, FI6 cấu hình B (chỉ 6000, 120 s):
`feasible=false`, `timed_out=false`, `timeout_lengths` rỗng, `best_achievable` trùng OR-Tools (14 cây 1,9524 %;
9 cây 3,9815 %; 23 cây 0,5435 %, sai số 1e-3), kèm kiểm chuỗi lý do. I5 cấu hình A: FI10 16 cây ở 5000 mm, 207 mm
hao hụt, dư 3; FI4 10 cây ở 5140; FI6 27 cây ở 5080, dư 1; `timeout_count=0` ở cả ba. FI6 với `max_surplus` 14 cắt
được. `highs-solver.spec.ts` có 3 test của bản được chọn: FI10 tầng 1 `infeasible` với các bước
[14 vô nghiệm, 15 vô nghiệm, model gốc vô nghiệm]; danh sách phủ hết N thì `infeasible` mà không cần model gốc;
N tối ưu ngoài danh sách thì về model gốc và ra đúng 9 cây. Bản tham khảo báo 3 test I5 cấu hình B đỏ trên mã cũ.

Kết quả: jest solver-ts 59/59 xanh, `pnpm build` xanh. `pnpm test` toàn bộ và lint: xem dòng cuối 7.8.6.

#### 7.8.6 File đã sửa (CHƯA commit)
`src/modules/cutting-proposals/solver-ts/highs-solver.ts`, `highs-solver.spec.ts`, `optimize-one-material.ts`,
`optimize-one-material.spec.ts`. Thêm mới: `test/solver-real-data/` (rerun-highs-after-fix.ts, repeat-group.ts,
results-before/, results-after-fix/, orig-scripts/), `test/solver-ts-bench/probe-verify-calls.ts`,
`probe-one-verify.ts`. Ngày 2026-10-21, phiên chính đã `git reset --mixed main` theo yêu cầu "không cần commit gì
hết gỡ xuống". Toàn bộ mã của mục 7 giờ là thay đổi chưa commit hoặc file chưa track trên nhánh
`claude/solver-ts-research-1a4370`. 

Kiểm cuối 2026-10-21: `pnpm build` (nest) xanh; `pnpm test` toàn bộ: 88 suite, 1.920 test xanh (1 skip có sẵn);
jest solver-ts 59/59 xanh; `pnpm lint:check` 0 lỗi (94 warning có sẵn của repo). Các script gốc trong `orig-scripts/` mang đuôi
`.orig` để eslint/tsc không quét (đường import của chúng chỉ đúng ở worktree cũ).

#### 7.8.7 Nhớ tạm kết quả xác minh theo body trong một lần tải trang (2026-10-21, CHƯA commit)
Người dùng chọn hướng (a): "nhớ tạm kết quả solver theo body trong một lần tải trang Tối ưu cắt sắt, giữ nguyên ngữ
nghĩa, vẫn để chưa commit".

Thay đổi nằm trong `verifyExactStandaloneWasteBatch` (`cutting-proposals.service.ts`). Bộ nhớ là một `Map` sống trong
đúng một lần gọi hàm, tức một lần tải trang. Khoá là đúng các tham số dựng nên body gửi solver: mã loại sắt, nhu cầu
theo thứ tự `demand.entries()`, chiều dài cây, ngưỡng, `max_surplus`, tề đầu, lưỡi cắt. Trùng khoá thì body cũng trùng
từng byte. Bộ nhớ lưu cả promise đang chạy, nên lời gọi trùng đồng thời cũng chờ chung, không bắn thêm lần nào. Trần 8 s
mỗi lần, ngân sách 12 s và cách rơi về ước tính khi lỗi đều giữ nguyên. Không giữ qua các lần tải trang, vì nhu cầu
có thể đổi giữa hai lần.

Thay đổi nằm ở tầng chung nên có tác dụng cả với `SOLVER_MODE=http`. Ngữ nghĩa không đổi: cùng body thì solver trả cùng
câu trả lời. Riêng ca chạm giới hạn thời gian thì trước đây mỗi SKU có thể nhận một nghiệm "tốt nhất lúc hết giờ" khác
nhau; nay các SKU trùng nhu cầu nhận chung một nghiệm, nhất quán hơn.

Test mới trong `cutting-batch-suggestions.service.spec.ts`: 3 SKU cùng loại sắt và cùng nhu cầu thì solver được gọi đúng
1 lần, cả 3 dòng đều được xác minh; 2 SKU khác nhu cầu thì có 2 lần gọi riêng, không gộp nhầm.

| Đo màn "Tối ưu cắt sắt" (53 dòng, 214 loại sắt), 2 lượt | Trước | Sau |
|---|---|---|
| ts, 1 worker | 8/214, 16,7 s | **175/214**, 8,5–8,9 s |
| ts, 2 worker | 46/214, 19,6 s | **175/214**, 7,4–7,5 s |
| http (DEXUAT) | 119/214, 17,3 s | **175/214**, 5,7–6,6 s |

Cả ba cấu hình cùng đạt 175, nên ngân sách 12 s không còn là giới hạn. 39 loại còn lại không xác minh vì có hơn
5 cỡ đoạn (`EXACT_CHECK_MAX_SIZES`) hoặc vô nghiệm mà không có `best_achievable`.

Kiểm sau thay đổi: `pnpm build` xanh; `pnpm test` toàn bộ 88 suite, 1.922 test xanh (1 skip có sẵn); `pnpm lint:check`
0 lỗi (94 warning có sẵn).

### 7.9 Loại sắt lớn hết giờ mà chưa có phương án (I5 V15 LSX 316) — làm tròn LP + giải phần dư (2026-10-22, CHƯA commit)

Yêu cầu của người dùng: "khi HiGHS hết giờ chưa có phương án ở loại sắt lớn (vd I5 V15 LSX 316, 27.300 đoạn) thì xử
lý sao cho vẫn ra kết quả trong thời gian hợp lý, chạy lại 3 file mới để xác nhận, không commit."

#### 7.9.1 Hiện tượng và nguyên nhân
Nhóm I5 · V15 · LSX 316 có 12 cỡ, 27.300 đoạn, cây 6000, ngưỡng 1 %, dư ≤ 10. Liệt kê ra 39.259 kiểu cắt (cap 4),
cắt còn 5.000. Với cấu hình mặc định ERP (20 s/loại, có dò chiều dài), `propose()` **không ra kết quả sau hơn 25 phút**:
cây 6000 hết 20 s mà chưa có nghiệm, thử lại ×3, ×6 vẫn không ra, rồi dò từng chiều dài 5000–6000 và chiều dài nào cũng
hết giờ.

Nguyên nhân: byN cố định N = 1794 cây (cận dưới, cắt kín). Đặt bài như vậy thì HiGHS cần khoảng 60 s mới ra **nghiệm
đầu tiên**, và trong pha gốc nó không gọi callback nên không ngắt sớm được.

**Vì sao `greedyStart` không giúp:** nó chỉ được nạp ở nhánh model gốc (`direct`/quay về), không bao giờ ở các N của
byN. Nó cũng không ép đúng N cây (thường thừa vài cây so với cận), nên không hợp lệ cho model đã cố định Σy = N.

#### 7.9.2 Cách sửa
1. **Làm tròn LP + giải phần dư** (`roundingStart` trong `highs-solver.ts`), đây là kỹ thuật chuẩn của bài toán cắt.
   Giải LP nới lỏng với Σy = N (0,1 s, ra đúng cận 179.400). Làm tròn xuống số cây từng kiểu cắt, rồi nhả lại một ít cây
   (thử lần lượt 5 %, 10 %, 2 %, ít nhất 1 cây). Phần nhu cầu còn thiếu giải bằng một MIP nhỏ, đúng số cây còn lại,
   đích là phần cận còn lại. Ghép hai phần thành nghiệm khả thi đầy đủ. Chạm cận thì đã tối ưu, bỏ qua MIP lớn. Chưa
   chạm thì nghiệm ghép làm điểm xuất phát cho MIP lớn, và vẫn được giữ nếu MIP lớn hết giờ.
   Đo trên I5 V15: không nhả cây nào thì phần dư rất khó (7,9 s); nhả 3–10 % chỉ mất 2–3 s và cùng chạm cận; nhả 20 %
   mất 5,6 s. Bước này dùng tối đa 40 % ngân sách của tầng.
2. **Chỉ chạy làm tròn trước MIP ở bài lớn (N ≥ 1.000 cây).** Bản đầu chạy cho mọi N làm ca nhỏ chậm đi: J55 V18
   (N = 134) từ 3,3 s lên 7 s, ca tham chiếu (c) (N = 234) từ 4,5–11,7 s lên 13,7 s. Đã thử cách "chạy MIP trước, ngắt
   nếu sau 25 % ngân sách chưa có nghiệm", nhưng HiGHS không gọi callback trong pha gốc nên không ngắt được. Lối ngắt
   này vẫn giữ cho bài nhỏ, phòng khi callback có được gọi.
3. **Dò chiều dài dừng sớm khi 3 chiều dài liên tiếp hết giờ mà chưa có phương án** (`MAX_SCAN_TIMEOUT_STREAK`), trả
   `timed_out` với lý do rõ: "…quá nặng so với 20s mỗi lần giải, đã dừng dò sớm. Chưa kết luận được: hãy tăng thời gian
   chạy hoặc tách bớt cỡ đoạn." **Đây là thay đổi ngữ nghĩa so với Python**, vốn dò hết dải dù mọi điểm hết giờ. Chiều
   dài vô nghiệm hoặc khả thi xen giữa làm bộ đếm về 0. Đã có phương án thì dò hết dải như Python. Thử lại ×3, ×6 ở
   chiều dài chuẩn **giữ như Python**, tương đương ngân sách cứu tới 120 s. Ca xấu nhất của một loại sắt quá nặng nay
   là khoảng 20 + 60 + 120 + 3 × 20 = 260 s, thay vì 101 chiều dài × 20 s cộng phần thử lại.

Bật tắt để so sánh: `SOLVER_TS_ROUNDING=0` tắt bước làm tròn. `SOLVER_TS_DEBUG=1` in vết của `roundingStart` ra stderr.

#### 7.9.3 Số đo I5 V15 LSX 316
| | Trước sửa | Sau sửa | OR-Tools |
|---|---|---|---|
| Cấu hình A (20 s/loại, dò 5000–6000) | **không ra** sau > 25 phút | **6000 × 1794 cây, 0,1667 %, dư 9**, 13–15 s (3 lần chạy giống nhau) | 6000 × 1794, 0,1667 %, dư 14, 62 s |
| Cấu hình B (chỉ 6000, 120 s) | 6000 × 1794, dư 9, 57 s | **6000 × 1794, dư 9**, 13–15 s | 6000 × 1794, dư 9, 334 s |

Đường đi sau sửa: tầng 1 làm tròn chạm cận sau khoảng 2,5 s (LP 0,1 s, phần dư 95 cây / 1.466 đoạn 2,4 s). Tầng 2
(min dư) chạm cận sau khoảng 11 s. Cấu hình A ra **ít dư hơn OR-Tools** (9 so với 14), vì OR-Tools 20 s/loại chưa kịp tối
ưu tầng 2.

#### 7.9.4 Chạy lại 3 file mới (38 body: 19 nhóm × cấu hình A/B)
Đầu vào `D:\DNA-ERP-BE\test\solver-real-data-new\bodies-highs-ortools.json`. Kết quả HiGHS mới ở `result-highs-after-fix.json`
(cùng dạng `[{key, wall, item}]`, thêm `debug`, `match_ortools`), bảng ở `SUMMARY-highs-after-fix.md`. So chiều dài cây,
số cây, mm hao hụt và dư; cả hai cùng vô nghiệm là trùng.

**Trùng OR-Tools 37/38** (trước sửa cũng 37/38, nhưng body lệch khi đó là I5 V15 A **không ra**). HiGHS sau sửa giữ
đúng kết quả cũ ở 37/38 body; body duy nhất đổi là I5 V15 A, từ không ra thành ra.

| Nhóm body | Kết quả |
|---|---|
| I5 V15 A | HiGHS 6000 × 1794, 17.940 mm, **dư 9** (13,7 s) so với OR-Tools dư 14 (62,5 s): HiGHS **tốt hơn**, nên đếm là "lệch" |
| I5 V15 B | trùng (dư 9), HiGHS 13,3 s so với OR-Tools 334 s |
| I3 V15 A / B (N = 1.486, cũng qua bước làm tròn) | trùng (6000 × 1486, dư 13), HiGHS 5,0 / 4,7 s so với OR-Tools 30,6 / 146,6 s |
| 35 body còn lại (H10-20, V16, V10, FI4, FI6, FI10, V18 của 3 file; 12 body cả hai cùng vô nghiệm) | trùng, HiGHS 0–1,2 s mỗi body |

#### 7.9.5 Kiểm không đổi ở các bộ cũ
| Bộ | Kết quả |
|---|---|
| 98 nhóm cũ (J55, I41+42, I3, I5; `rerun-highs-after-fix.ts --out-dir results-after-rounding`) | **98/98 nhóm giữ đúng phương án** của lần chạy 2026-10-21 (`results-after-fix/`): chiều dài, số cây, mm hao hụt, dư. Tổng thời gian 350 → 239 s, không nhóm nào chậm đi quá 1,5 lần. |
| 4 ca tham chiếu (a)–(d) | **trùng OR-Tools cả 4**: (a) 0,1 s, (b) I3 4,0 s, (c) 8,3 s, (d) 32,7 s |
| Bản đầu (làm tròn cho MỌI N, trước khi thêm ngưỡng N ≥ 1.000) | 97/98 nhóm cũ giữ nguyên; nhóm I5 V15 A cũ (N = 399) đổi dư 10 → 9, tốt hơn. Nhưng J55 V18 chậm 3,3 → 7 s và ca (c) 13,7 s, nên đã bỏ cách này |

Kiểm cuối: `pnpm build` xanh; `pnpm test` toàn bộ 88 suite, 1.925 test xanh (1 skip có sẵn), đo trước khi thêm test I5 V15;
jest solver-ts + solver-client 72/72 xanh, đã gồm test mới: I5 V15 trong 20 s ra 1794 cây 0,1667 % qua `via: 'rounding'`;
dò chiều dài dừng sau 3 lần hết giờ liên tiếp; vô nghiệm xen giữa làm đếm lại; đã có phương án thì dò hết dải.
`pnpm lint:check` 0 lỗi (94 warning có sẵn). Tất cả CHƯA commit.

#### 7.9.6 Chưa kiểm / còn lại
- Ngưỡng N ≥ 1.000 cây là chọn theo dữ liệu đo (ca chậm đi có N = 134 và 234; ca cần làm tròn có N = 1.794). Ca có
  N trong khoảng 300–1.000 mà HiGHS cũng chậm ra nghiệm đầu tiên thì chưa có dữ liệu để kiểm.
- Lối dừng dò sớm (7.9.2 mục 3) mới chỉ kiểm bằng test với bộ giải giả, chưa gặp ca thật nào cần đến nó sau khi có
  bước làm tròn.
- Chưa đo trên Node 20 riêng cho lần sửa này, chưa đo RAM đỉnh mới cho I5 V15.

## 7A. 2026-10-20 — Hai nhánh song song đã xong, đã kiểm lại độc lập ở checkout chính

> Gộp từ bản changelog ở checkout chính ngày 2026-10-26 khi gom code BE về `main` — bản đó đánh số mục 8; đổi thành 7A vì số 8–11 ở file này đã dùng và đang được code/tài liệu khác trỏ tới. Nội dung giữ nguyên.

Người dùng yêu cầu tách 2 worktree. Kết quả (CHƯA merge, CHƯA push, CHƯA deploy):

| Nhánh | Việc | Báo cáo của phiên | Kiểm lại ở checkout chính |
|---|---|---|---|
| `claude/solver-python-in-be-75c218` (commit 75599c1) | Python + OR-Tools chạy trong container BE, `SOLVER_MODE=local\|http` (mặc định http), Dockerfile → bookworm-slim + venv, `SolverClientService`, test tương đương 30 request thật trùng tuyệt đối, e2e local trùng http | mục 9 của `changelog-2026-10-01-ke-hoach-gom-solver-vao-be.md` **trên nhánh đó** | `pnpm build` xanh; `solver/run_propose.py` ca (a) → 325 cây, 0,353 %, dư 16 (lưu ý: `stock_lengths` phải là CHUỖI "5850 6000" như BE đang gửi — JSON list không parse được, GIỐNG bản gốc DEXUAT, không phải lỗi bản chép) |
| `claude/solver-ts-research-1a4370` (commit 7564acb) | Nguyên mẫu TypeScript + HiGHS WASM (`highs@1.15.4`, MIT) trong `solver-ts/`, port đủ `optimize_one_material`/`propose`; chiến lược byN (cận dưới knapsack theo số cây N) | mục 7 của file này **trên nhánh đó**: trùng OR-Tools 4/4 ca; I3 9 s, 12 cỡ 4,5 s, 15 cỡ 35 s (OR-Tools 187–381 s) | `pnpm tsx bench-case.ts b` → 117 cây, 0,1667 %, dư 15, 13 s, RAM đỉnh 275 MB, cả 2 tầng `optimal_by_bound` |

Điểm cần biết khi merge: (1) hai nhánh cùng sửa dòng `exclude` của `tsconfig.build.json` (A thêm `solver`, B thêm
`solver-ts`) → conflict nhỏ, gộp cả hai; (2) các file changelog trong checkout chính đang **chưa track** (untracked)
nhưng nhánh A đã commit `changelog-2026-10-01-...` → phải xử lý bản untracked trước khi merge A; (3) nhánh B thêm
`exclude` vào `tsconfig.json` gốc.

Còn treo (chưa quyết): chọn hướng nào để nối thật vào BE — A (ít rủi ro nhất, cần Python trong image 1,45 GB, RAM
~300 MB/lượt, xác minh ở màn "Tối ưu cắt sắt" chậm hơn) hay B (bỏ Python, nhanh hơn 10–20 lần ở ca 9–12 cỡ, nhưng còn
2–5 ngày việc: worker_threads, nối BE, test tương đương định mức thật, auto_scan). Lỗi "tầng 2 mất nghiệm" đã được
sửa trong bản TS (B), chưa sửa trong bản Python (A). Gói Render cho BE vẫn phải chọn vì cả 2 hướng đều cần ~300 MB
cho solver.

## 7B. 2026-10-20 — Chốt hướng B; PDF báo cáo trình lãnh đạo

> Gộp từ bản changelog ở checkout chính ngày 2026-10-26 khi gom code BE về `main` — bản đó đánh số mục 9; đổi thành 7B vì số 8–11 ở file này đã dùng và đang được code/tài liệu khác trỏ tới. Nội dung giữ nguyên.

- Người dùng chọn **hướng B** (TypeScript + HiGHS trong BE). Giai đoạn 2 đã giao cho phiên `solver-ts-research`
  (worktree `claude/solver-ts-research-1a4370`): đưa `solver-ts` vào `src/`, `highs@1.15.4` vào package.json gốc,
  worker_threads + giới hạn giờ/RAM, `SOLVER_MODE=http|ts` (mặc định http), nối `cutting-proposals`, chạy lại 180
  proposal đã lưu, e2e local so với http, changelog mục 7.7+. Nhánh A (Python) giữ làm dự phòng, không merge.
- **PDF cho lãnh đạo**: `docs/bao-cao-doi-chieu-solver-de-xuat-thanh-sat-2026-10-20.pdf` (3 trang, A4, font Arial;
  script tạo ở scratchpad `bench/make_report_pdf.py`, reportlab). Nội dung: 3 KPI (4/4 trùng, nhanh 10–20×, 2→1 hệ
  thống), bảng 4 ca, ý nghĩa, điều kiện trước khi dùng (180 proposal thật, nhiều chiều dài cây, gói Render, chạy song
  song), chứng minh tay ca I3 (694.700 mm cần; 116 cây dư 140 mm < 175 mm → hao hụt 1.300 > 1.170), lịch sử I3
  (app cũ không ra nghiệm → 125/129 cây tay → 117), tốc độ/RAM, phạm vi đã/chưa kiểm, phụ lục dữ liệu 4 ca.
  Số liệu lấy từ mục 3, 6, 7, 8 (nay là 7A) của file này và mục 7 trên nhánh B. Đã ghi rõ trong PDF: chưa deploy, chưa kiểm
  nhiều chiều dài cây / auto_scan / dữ liệu thật đầy đủ.

## 8. 2026-10-23 — Thêm máy MC TỰ ĐỘNG (cắt theo bó) vào HiGHS, đối chiếu với module `cat_sat` gốc

Sếp yêu cầu (qua người dùng): "HiGHS chọn giữa tính theo MC Tự động hoặc MC Laser, rồi chọn mode ưu tiên cây chuẩn + mở rộng
chiều dài nếu không đạt, hoặc ưu tiên cây chuẩn + chấp nhận hao hụt cao hơn (đơn gấp)". Người dùng chốt: 2 mode kia ERP ĐÃ CÓ
(`ProductionInvoice.solverAllowCustomLength` / `solverMaxWastePctOverride`, màn "Tối ưu cắt sắt": "Bình thường" / "Chấp nhận hao
hụt cao hơn (đơn gấp)") nên chỉ thêm MÁY; MC Tự động trong ERP KHÔNG cho thiếu; hệ số bó/lưỡi/cắt tay do Admin cấu hình; làm
solver trước, BE/FE sau khi số khớp. Mã gốc = `cat_sat/optimization_logic.py` của D:\cat_sat_iea (GĐ2 `optimize_distribution`).

- **Mã (worktree này, CHƯA commit):**
  - `highs-solver.ts`: `TwoStageInput.bundle {factors, maxManualBars}` → `build()` nhân cột: mỗi (pattern p, hệ số f ∈ factors ∪ {1})
    là 1 cột, hệ số hàng nhu cầu = f·c_pk, hàng Σcây hệ số f, cận trên = ceil(cap_p/f) (như `safe_div_ceil` app cũ); thêm hàng
    "Σ cột f=1 ≤ maxManualBars" (cắt tay). Có bó → ép chiến lược 'direct' (byN/roundingStart/greedyStart tính theo cột = pattern);
    tầng 2 thêm tie-break ít bó (`pieces×1000 + 1`). Kết quả trả thêm `columns` (cột → pattern, factor). `normalizeBundleFactors`.
    `allowShortage` CHỈ ĐỂ TEST (cận dưới = demand − maxSurplus), propose không đọc.
  - `optimize-material.ts`: `bundle`, `maxSizesPerBar` (MC Tự động chặn CỨNG 5 cỡ/kiểu cắt, không rơi về "không giới hạn"),
    gom cột về số cây + số bó từng hệ số mỗi pattern (`PlanRow.bundles`), `machine`, `bundle_summary {factors, total_bundles,
    manual_bars, total_cuts, max_sizes_per_pattern}`; lý do vô nghiệm nhắc bó. Sửa cận dưới số cây khi allowShortage (test).
  - `optimize-one-material.ts`: bọc `optimize` một lần để tuỳ chọn máy đi theo MỌI lần giải (chuẩn, retry, dò, bestAchievable).
  - `propose.ts`/`types.ts`: body thêm `machine` ('laser' mặc định — hành vi cũ y nguyên | 'tu_dong'), `bundle_factors` (chuỗi/mảng,
    mặc định 14 16 18 20), `max_manual_cuts` (5), `max_sizes_per_pattern` (5); echo trong `input_echo`; `purchase_plan[].machine`,
    `bundle_summary`, `cutting_patterns[].bundles`. machine lạ / hệ số bó rỗng → INVALID_INPUT.
  - Test mới: highs-solver.spec (bó 16+4 tay, cắt tay ≤3 vô nghiệm đã chứng minh, bó rỗng = không bó, allowShortage), optimize-
    material.spec (h10-20 theo bó, >5 cỡ chặn 5, vô nghiệm vì bó), propose.spec (echo, mặc định, lỗi). **81/81 test solver-ts +
    solver-client xanh** (test I5 V15 chỉ trượt khi 7 suite chạy song song tranh CPU; chạy riêng qua), `nest build` xanh, lint 0 lỗi,
    prettier sạch.
- **Đối chiếu với mã gốc** (phiên mclaser-i3 chạy `cat_sat` chép nguyên, ortools 9.12, `test/solver-real-data-new/mc-tudong/result-A.json`;
  HiGHS: `highs-mctd/<key>.json`, `SUMMARY.txt`; cấu hình A giống ERP: 6000, tề 10, lưỡi 2,5, bó 14/16/18/20, cắt tay ≤ 5, ±10, 1 %,
  HiGHS 60 s/lần giải, app 120 s):
  - 7/19 nhóm cả hai cùng KHÔNG ra ở cây 6000 (FI4/FI6 ×3 không kiểu cắt nào đạt 1 % với lưỡi 2,5; I3 H10-20, I3 V10 không ghép
    được bó với cắt tay ≤ 5 — trong ERP chế độ "Bình thường" sẽ dò chiều dài khác).
  - 11 nhóm còn lại, so CÙNG ĐIỀU KIỆN (biến thể test cho thiếu như app): **bằng 8, HiGHS tốt hơn 2 (I3 V15 −655 mm/−6 cây; I5 FI10
    −112 mm), kém hơn 0**; I5 V15 app vô nghiệm (GĐ1 chạm 300.000 kiểu, vắng cỡ) còn HiGHS ra 1799 cây. Cách chia bó/cắt tay trùng
    ở các nhóm bằng nhau (vd I5 V10 36 bó + 2 tay cả hai bên).
  - Bản ERP (không cho thiếu): thêm 0–5 cây so với app (vì app cắt thiếu 10–44 đoạn), vd I5 V10 681 ↔ 676, J55 V18 135 ↔ 132.
  - Thời gian: HiGHS ≤ 42 s ở mọi nhóm trừ V15 (chạm 60 s, chưa chứng minh tối ưu, giống app chạm 120 s); app 120 s ở 3 nhóm.
- **Đã làm tiếp ở mục 9 (BE):** SystemConfig (máy mặc định, hệ số bó, lưỡi/tề MCTĐ riêng, cắt tay tối đa, số cỡ/kiểu cắt),
  ProductionInvoice (máy theo đợt), service gửi `machine`… **FE còn lại** (chọn máy ở "Tối ưu cắt sắt", hiển thị bó/cắt tay trong
  kế hoạch cắt) do phiên FE làm song song. Không commit.

## 9. 2026-10-23 — BE: HiGHS là bộ giải duy nhất + chọn máy cắt Laser/Tự động theo đợt (local, CHƯA deploy, CHƯA commit)

Người dùng chốt 4 điểm: (1) HiGHS là bộ giải DUY NHẤT trong ERP, dọn sạch đường gọi DNA-DEXUAT; (2) máy cắt chọn THEO ĐỢT
(`ProductionInvoice`), mặc định ở `SystemConfig`; (3) lưỡi cắt/tề đầu của MC Tự động mặc định như app cat_sat_iea (lưỡi 2,5 mm,
tề đầu 0), Admin chỉnh được; (4) 2 chế độ cây chuẩn hiện có ("Bình thường" = `solverAllowCustomLength`, "Chấp nhận hao hụt cao hơn
(đơn gấp)" = `solverMaxWastePctOverride`) GIỮ NGUYÊN cho cả hai máy.

### 9.1 Việc A — gỡ đường http/DEXUAT

- `solver-client.service.ts`: bỏ chế độ `http`, bỏ `SolverMode`, `SOLVER_PROPOSE_PATH`, không còn inject `ExternalApiService`.
  `propose()` luôn chạy HiGHS trong worker thread (giữ hàng đợi FIFO, timeout, ép lỗi về `ExternalApiHttpError`/
  `ServiceUnavailableException` như trước nên `CuttingProposalsService` không đổi cách xử lý lỗi). `CuttingProposalsModule` bỏ import
  `ExternalApiModule` (module đó vẫn còn trong `AppModule` cho tích hợp khác — KHÔNG xoá `ExternalApiService`).
- `configuration.ts`, `env.validation.ts`, `.env.example`: bỏ `SOLVER_MODE`, `SOLVER_BASE_URL`, `SOLVER_API_KEY` (và `solver.mode/baseUrl/
  apiKey`). Giữ `SOLVER_TIMEOUT_SECONDS`, `SOLVER_TS_WORKERS`, `SOLVER_TS_HEAP_MB`, `SOLVER_TS_MAX_RSS_MB`. Đã grep toàn repo
  (`solver.baseUrl|apiKey|mode`, `SOLVER_PROPOSE_PATH`): chỉ còn nhắc trong changelog cũ (lịch sử) và `docs/dna-erp-roadmap.html`,
  `docs/manual-test-...html`, `docs/changelog-2026-08-06-...` (tài liệu lịch sử, để nguyên). `render.yaml` vốn chỉ có `SOLVER_TIMEOUT_SECONDS`.
- Test: `solver-client.service.spec.ts` bỏ nhánh http; `cutting-proposals.service.spec.ts` và `cutting-batch-suggestions.service.spec.ts`
  mock thẳng `SolverClientService.propose(body, timeoutMs)` (assertion đổi từ `(url, body, headers, timeout)` sang `(body, timeout)`).
- Comment trong `cutting-proposals.service.ts` còn nhắc "DNA-DEXUAT / cat_sat_iea / de_xuat_logic.py / api/views.py / CP-SAT" đổi sang
  `solver-ts/*` / HiGHS; không đổi logic nghiệp vụ. `docs/phase-8-testing-guide.md` bỏ hướng dẫn chạy `catsat_web` + `SOLVER_BASE_URL`.
  Các script `test/solver-ts-bench/*` bỏ `--mode http`/`SOLVER_MODE` (dùng `new SolverClientService(config)`).

### 9.2 Việc B — máy cắt

**Migration:** `prisma/migrations/20261023100000_add_solver_machine_mctd` (sinh bằng `prisma migrate diff` từ schema HEAD vì không có DB
local/Docker; chưa chạy `migrate deploy` ở đâu cả) + `prisma generate`. Toàn bộ cột mới có DEFAULT/NULL nên dữ liệu và hành vi cũ không đổi.

| Bảng / enum | Thêm |
|---|---|
| enum `SolverMachine` | `laser`, `tu_dong` |
| `SystemConfig` | `solverMachine` (default `laser`), `solverMctdBladeWidthMm` (Decimal(6,1), 2.5), `solverMctdTrimStartMm` (0), `solverBundleFactors` (Json `[14,16,18,20]`), `solverMaxManualCuts` (5), `solverMaxSizesPerPattern` (5) |
| `ProductionInvoice` | `solverMachine SolverMachine?` (null = theo SystemConfig) |
| `CuttingProposalLine` | `machine SolverMachine?`, `bundleSummary Json?` (camelCase tường minh: `{factors,totalBundles,manualBars,totalCuts,maxSizesPerPattern}`) |
| `CuttingProposalPattern` | `bundles Json?` (`{"<hệ số>": số bó, "1": số cây cắt tay}`) |

**Hợp đồng dữ liệu (FE đối chiếu):**
- `PUT/GET /system-config`: `solverMachine`, `solverMctdBladeWidthMm` (0–10), `solverMctdTrimStartMm` (0–100), `solverBundleFactors`
  (1–8 số nguyên ≥ 2), `solverMaxManualCuts` (0–100), `solverMaxSizesPerPattern` (1–10).
- Request tạo đợt (`SolverOverrideDto` → `RequestCuttingBatchDto`, nguồn copy sang PI lúc `mergeItems`/`claimSolo`): `solverMachine?: 'laser' | 'tu_dong'`.
  `CuttingProposal.solverOptions` mang `solverMachine`. Response PI: `solverMachine: 'laser' | 'tu_dong' | null`.
- Response cutting proposal: `lines[].machine`, `lines[].bundleSummary {factors,totalBundles,manualBars,totalCuts,maxSizesPerPattern} | null`,
  `lines[].patterns[].bundles | null`.
- Thêm (không có trong hợp đồng gốc, đều tuỳ chọn): `solverMachine` ở query `GET /cutting-batch-candidates` + `GET /cutting-batch-suggestions` và body
  `POST /cutting-batch-preview` — để ước tính hao hụt và số xác minh bằng solver (`verifyExactStandaloneWaste`) cùng máy (cùng cặp lưỡi/tề +
  tham số bó) với đợt KHSX đang chọn; không gửi = máy mặc định công ty.

**Cách service chọn máy** (`resolveMachineParams` trong `cutting-proposals.service.ts`): máy = `job.machine` (PI/solverOptions) ?? `SystemConfig.solverMachine` ?? laser.
`tu_dong` → `trim_start = solverMctdTrimStartMm`, `blade_width = solverMctdBladeWidthMm`, thêm `machine:'tu_dong'`, `bundle_factors`,
`max_manual_cuts`, `max_sizes_per_pattern`. `laser` → như cũ (`solverTrimStartMm`/`solverBladeWidthMm`) + `machine:'laser'` tường minh.
`saveSuccess` ghi `machine`, `bundleSummary` (map snake→camel), `bundles` theo pattern. `requestParams` ghi sớm cũng mang `machine`.
Lý do không ra: HiGHS đã trả `reason`; `lineDisplayReason` không cắt nội dung (nhánh hết giờ / có `bestAchievable` dùng câu dựng sẵn như cũ, các nhánh còn lại trả `reason` nguyên văn) — không đổi.

### 9.3 Bổ sung từ phía FE (cùng ngày)

1. `GET /system-config/cutting-defaults` (KHSX đọc được) trả thêm `solverMachine` để FE hiện "Theo mặc định (MC …)".
2. Summary PI: `cuttingPlan.machine` = máy THỰC SỰ đã dùng (luôn có giá trị, không null), vì `ProductionInvoice.solverMachine = null` khi KHSX để theo mặc định.
   Nguồn: `requestParams.machine` của phương án (`runSolverAndSave` ghi body đã resolve ngay trước khi gọi solver, nên có cả lúc đang tính) →
   `ProductionInvoice.solverMachine` → `laser` (mọi phương án trước tính năng này đều là MC Laser).
3. FE bỏ hẳn trường `solverMachine` khi chọn "Theo mặc định" (không gửi null). BE xử lý: thiếu trường **và** `null` đều = theo mặc định (DTO `@IsOptional`,
   `requestForBatch` chỉ ghi vào `solverOptions` khi `!= null`) — không có chỗ nào cần phân biệt "không gửi" với "null". Về "Tính lại": mỗi lượt
   `requestForBatch` dựng `solverOptions` MỚI chỉ từ request, không thừa hưởng máy của lượt trước (có test). Nút "Tính lại" của PI/lệnh SX
   (`requestForInvoice`/`requestForOrder`) không nhận máy trong body mà đọc lại `ProductionInvoice.solverMachine` — đây là cấu hình Sếp đã duyệt
   cùng lệnh SX (giống `solverAllowCustomLength`), giữ có chủ đích; muốn đổi máy thì tạo lượt tính mới trước khi tạo PI.

### 9.4 Kết quả kiểm tra

- `tsc --noEmit`: chỉ còn 2 lỗi có sẵn ở `prisma/seed-ghe-j55-full-bom.ts`, `prisma/seed-real-products.ts` (`factoryCode`), không phải của việc này.
- `pnpm build` (nest build): xanh (chạy lại sau đợt sửa 9.6).
- `jest src/modules/cutting-proposals src/modules/system-config src/modules/production-invoices src/modules/steel-issues`: **19 suite, 636 test, tất cả qua**
  (lần chạy đầu cả 3 thư mục không kèm `--maxWorkers` có 1 test của `solver-ts/optimize-material.spec.ts`, trần 20 s, đỏ do tải nặng; chạy riêng hoặc
  `--maxWorkers=3` thì xanh — test phụ thuộc tốc độ máy, không liên quan thay đổi này). Test thật đã có cho phần máy cắt (xem danh sách ở 9.6).
- `pnpm lint:check`: 0 lỗi thật, 94 warning có sẵn. Lưu ý toàn repo đang báo hàng chục nghìn lỗi `prettier/prettier "Delete ␍"` do working copy Windows
  để CRLF (`core.autocrlf=true`, `.prettierrc` đặt `endOfLine: lf`) — có sẵn từ trước; đã lọc ra khi đếm. `prettier --check --end-of-line auto` các file sửa: sạch.
- Chưa chạy migration trên DB nào, chưa chạy end-to-end với DB (không có Postgres local).

### 9.5 Còn treo / khi deploy

- **Khi deploy: bỏ `SOLVER_BASE_URL`, `SOLVER_API_KEY`, `SOLVER_MODE` khỏi `.env` production (Render) và CHẠY MIGRATION `20261023100000_add_solver_machine_mctd`.**
  Production mặc định `laser` nên hành vi không đổi cho tới khi Admin/KHSX chọn `tu_dong`. Tắt/giải phóng dịch vụ DNA-DEXUAT là quyết định vận hành riêng.
- FE: màn chọn máy ở "Tối ưu cắt sắt", cấu hình trong Cấu hình hệ thống, hiển thị bó/cắt tay (phiên FE song song).
- Chưa có backfill `machine` cho `CuttingProposalLine` cũ (null = MC Laser, FE coi null như laser); `cuttingPlan.machine` đã tự rơi về laser.
- Cân nhắc validate chéo: `max_sizes_per_pattern`/`bundle_factors` chỉ có tác dụng khi máy = tu_dong (không cảnh báo khi cấu hình nhưng máy mặc định là laser).
- Không commit; không đụng DB production.

### 9.6 Sửa sau review Opus (2026-10-23, "BE ĐẠT, không lỗi chặn")

**Đính chính:** bản 9.4 trước đó ghi đã có test cho body tu_dong / laser / lưu machine-bundleSummary-bundles / mặc định vs lựa chọn đợt / requestParams / xác minh cùng máy,
nhưng thực tế spec lúc đó mới có 1 test (`requestForBatch` đưa máy vào `solverOptions`) — script thêm test đã soạn mà chưa chạy. Nay đã viết và chạy THẬT:

- `cutting-proposals.service.spec.ts`, `describe('máy cắt')` (qua `runSolverAndSave` → `resolveMachineParams`): (1) laser mặc định gửi `machine:'laser'`, tề 10 / lưỡi 1, KHÔNG có
  `bundle_factors/max_manual_cuts/max_sizes_per_pattern`, dòng lưu `machine:'laser'`, `bundleSummary/bundles` undefined; (2) KHSX chọn tu_dong → `trim_start 0`, `blade_width 2.5`,
  `bundle_factors [14,16,18,20]`, `max_manual_cuts 5`, `max_sizes_per_pattern 5`, 2 chế độ cây chuẩn (`stop_on_first`, `auto_scan`) giữ nguyên; (3) `saveSuccess` ghi `machine`, `bundleSummary`
  camelCase (`totalBundles/manualBars/totalCuts/maxSizesPerPattern`) và `bundles` của pattern; (4) KHSX không chọn → theo `SystemConfig.solverMachine` (kể cả tham số bó khác mặc định);
  (5) KHSX chọn laser thắng mặc định công ty tu_dong; (6) `requestParams` ghi sớm mang `machine` + `bundle_factors`. Thêm: `requestForBatch` (có/không/null máy → `solverOptions`),
  `assertReadyForInvoice` trả `usedMachine`.
- `cutting-batch-suggestions.service.spec.ts`: `getBatchCandidates(undefined,'tu_dong')` xác minh bằng solver gửi cùng máy (tề 0 / lưỡi 2,5 / tham số bó); không chọn → laser; hai máy cùng nhu cầu
  → gọi solver riêng với body riêng (khoá memo của `verifyExactStandaloneWasteBatch` có `machineBody`).
- **steel-issues `attachSteelBalance`** (đối chiếu sắt vào – đoạn ra): trước đây luôn dùng `solverTrimStartMm/solverBladeWidthMm` (MC Laser); nay chọn tề/lưỡi theo máy của phương án đã duyệt
  (`CuttingProposalLine.machine`, null = laser; nạp một query cho mọi PI ở `loadPhoiInputs`, nhận cả phương án neo PI lẫn neo lệnh SX). Test: tu_dong → usable 12000 / reported 5980; dòng neo lệnh SX;
  dòng của PI khác bị bỏ qua; laser giữ 11980.
- **PI chốt máy thực sự đã dùng** (`mergeItems`, `claimSolo`): `ProductionInvoice.solverMachine = solverOptions.solverMachine ?? proposal.requestParams.machine` (qua `usedMachine` mới của
  `assertReadyForInvoice`), để "Tính lại" sau khi Admin đổi máy mặc định không âm thầm đổi máy của đợt. Cũng áp cho `previewBatch` lấy bằng chứng đặc cách. Test merge + claimSolo.
  Hệ quả với mục 9.3(2): `ProductionInvoice.solverMachine` giờ thường khác null cho PI tạo từ lượt tính trước; `cuttingPlan.machine` vẫn là nguồn hiển thị.
- **Schema:** enum `SolverMachine` đưa lên trên comment "Singleton row…" để comment đó gắn lại đúng `model SystemConfig` (chỉ đổi vị trí/ comment, `prisma validate` ok, không cần migration mới,
  migration `20261023100000_add_solver_machine_mctd` giữ nguyên).
- **DTO `update-system-config`:** `solverBundleFactors` thêm `@ArrayUnique()` + mỗi phần tử ≤ 100; `solverMctdBladeWidthMm` thêm `maxDecimalPlaces: 1` (cột Decimal(6,1) không làm tròn lặng lẽ). Test DTO tương ứng.
- **Ghi chú giới hạn:** ước tính nhanh best-fill của `previewBatch`/`getBatchSuggestions`/`getBatchCandidates` (số "≥" chưa xác minh) với tu_dong chỉ đổi tề/lưỡi sang cặp Mctd, KHÔNG tính ràng buộc bó
  (hệ số bó, cắt tay tối đa, số cỡ/kiểu cắt) nên lạc quan hơn thực tế; số chính thức là lượt solver (và số xác minh bằng solver đã gửi đủ tham số bó). Đã ghi vào comment `resolveMachineParams`.
- Kiểm tra lại: jest 19 suite / 636 test xanh, `pnpm build` xanh, `tsc --noEmit` chỉ 2 lỗi seed có sẵn, eslint 0 lỗi thật (94 warning có sẵn), prettier `--end-of-line auto` sạch. Không commit, không chạy migration.

## 10. 2026-10-23 — MC Tự động chậm/hết giờ: đường "thu hẹp" (nghiệm không-bó -> tập pattern -> bài bó thu hẹp -> bài bó đầy đủ) (local, CHƯA deploy, CHƯA commit)

### 10.1 Vấn đề (số đo trước khi sửa)

Máy MC Tự động giải bài theo bó trực tiếp trên mọi cột (pattern × hệ số {20,18,16,14,1}): với 5.000 pattern là 25.000 cột nguyên, HiGHS không tìm nổi nghiệm khả thi đầu tiên
trong 20 s (khúc thừa tối ưu = 0 nên không có gì dẫn đường; ràng buộc "Σ bó chẵn + ≤ 5 cây tay" làm bài thành bài mạng tinh thể).
- I5 V15 (12 cỡ, 27.300 đoạn) ở 6000, time_limit 20: KHÔNG RA ("Hết thời gian ở 3 chiều dài dò liên tiếp"); bench 60 s/lần giải ra 1805 cây (feasible_time_limit).
- Cả lệnh I5 theo bó 293 s, I3 113 s (laser 15 s / 6 s). Một đợt 2 SKU J55 (proposal 188 trong DB test) theo bó 281,8 s, laser 19,7 s.

### 10.2 Cách làm (`highs-solver.ts`: `solveBundled` / `solveBundledSorted`; ca có `bundle` và ≥ 300 pattern, ít hơn thì giải thẳng như cũ)

1. **Bài không-bó trước** (cùng pattern/nhu cầu, đường laser byN + roundingStart, chỉ tầng 1 — cờ mới `stage1Only`). Bài bó là bài HẠN CHẾ của bài này nên: (a) không-bó vô nghiệm đã chứng minh
   => bó vô nghiệm ngay (infeasible, không phải hết giờ, khỏi chạy bài bó); (b) khúc thừa tối ưu không-bó = CẬN DƯỚI hợp lệ của tầng 1 bó, đặt làm `objective_target` (HiGHS dừng ngay khi nghiệm bó chạm
   cận => `optimal_by_bound`, tối ưu toàn cục đã chứng minh); (c) pattern nó dùng (P*, thường 4-17 pattern) là ứng viên tốt nhất.
2. **Sắp pattern theo khúc thừa tăng dần trước khi dựng mọi model** (`solveBundled` bọc ngoài, đổi lại chỉ số pattern gốc ở cột trả về). Lý do đo được: HiGHS rất nhạy thứ tự cột — cùng 5.000 pattern I5 V15,
   thứ tự liệt kê DFS thì bài không-bó KHÔNG ra nghiệm trong 20 s, thứ tự khúc thừa tăng thì ra ở giây ~3,8.
3. **Tầng 1 bó thu hẹp**: bậc 1 = chỉ P* (I5 V15: 17 pattern, ra nghiệm ~6 s); không ra/vô nghiệm trong tập đó thì bậc 2 = P* + 200 pattern ít phế nhất; không ra nữa mới tới bài ĐẦY ĐỦ. Chạm cận ở bất kỳ bậc nào
   thì khỏi chạy bài đầy đủ. Chưa chạm cận: bài đầy đủ chạy với nghiệm thu hẹp làm `start` trong phần giờ còn lại; nghiệm thu hẹp LUÔN được giữ nếu bài đầy đủ không cải thiện/hết giờ.
4. **Tầng 2 bó** (min đoạn dư rồi ít bó): bậc tập CHẶT (pattern nghiệm tầng 1 + P*; 40 % time_limit) -> tập RỘNG (+200 pattern; 20 %) -> bài đầy đủ (phần còn lại), mỗi bậc nhận nghiệm tốt nhất đang có làm `start`;
   luôn trả nghiệm không thua tầng 1.
5. **Nhãn đúng như logic cũ**: `optimal`/`optimal_by_bound` chỉ khi chính bài đầy đủ chứng minh (hoặc nghiệm chạm cận không-bó); tối ưu trong tập thu hẹp ≠ tối ưu toàn cục nên nhãn là `feasible_time_limit`.
   Vô nghiệm TRONG tập thu hẹp không bao giờ thành nhãn infeasible: nếu bài đầy đủ không kịp kết luận thì tầng 1 là `time_limit_no_solution` (hết giờ), chỉ bài đầy đủ (hoặc bài không-bó) nói vô nghiệm mới ra infeasible.
6. Máy laser KHÔNG đi đường mới (`solveTwoStage` không có `bundle` chạy y nguyên; bài không-bó bên trong chỉ là một lần gọi laser thường). `allowShortage` (chỉ test) không đi đường mới (cận dưới không-bó không còn đúng).
7. Chẩn đoán: `stats.bundle_narrow` (số pattern P*, trạng thái bài không-bó/thu hẹp/đầy đủ mỗi tầng, nghiệm cuối từ bài nào) — thêm tuỳ chọn, không đổi hợp đồng JSON hiện có.

**Lệch so với đề xuất ban đầu (có lý do đo được):**
- Bài không-bó được ngân sách 2×time_limit (chỉ tầng 1), không phải ≤ 40 %: ngân sách nội bộ của roundingStart tỉ lệ theo time_limit; bài phần dư của I5 V15 (tề 0, lưỡi 2,5) cần 3,4-3,9 s, với 0,4×T chỉ có 1,6 s,
  0,6×T chỉ 2,4 s, đúng T là 4,0 s (sát ngưỡng) => không ra nghiệm. Thời gian THẬT dùng vẫn ~4 s; hệ số chỉ nới trần cho ca xấu.
- Tập thu hẹp bậc 1 là P* thuần (K=0), KHÔNG +200: đo K=0 (17 pattern) ra nghiệm ~6 s, K=200 (217 pattern) không ra trong 8 s — nhiều cột hơn thì tìm nghiệm khả thi đầu tiên chậm hơn; +200 chỉ là bậc 2.
  Không nới "K=1.000" (đo: không ra trong 20 s, tốn giờ không giúp gì).
- Thử "nghiệm bó gần nghiệm không-bó nhất" (thêm hàng độ lệch d⁺/d⁻ mỗi pattern, min Σ|dời|) làm điểm xuất phát: 12 s không ra trong khi MIP thường trên cùng tập ra ở 5,8 s => BỎ, không giữ lại trong code.
- Mục 4 của đề xuất (nghiệm tham lam chia bó từ y laser) CHƯA làm: bài thu hẹp bậc 1 đã ra nghiệm ở ~6 s nên lợi ích còn lại nhỏ; xem 10.5.

### 10.3 Số đo trước/sau (cấu hình ERP mặc định: time_limit 20, tề 0, lưỡi 2,5, bó [14,16,18,20], tay ≤ 5, dư ≤ 10, ≤ 5 cỡ/kiểu, 1 %)

**(a) I5 V15 máy tu_dong, 6000, time_limit 20** (`optimizeMaterial`): trước KHÔNG RA; sau **1801 cây, 0 % khúc thừa, dư 50, 92 bó + 5 tay, 30,5 s** (không-bó 4,3 s + bó thu hẹp 5,9 s + tầng 2 ~20 s). ≤ 45 s và ≤ 1805. ✓

**(b) e2e `e2e_worker_3files.ts` qua SolverWorkerHost (dist đã build), 3 file × 2 máy** — kết quả ghi đè `test/solver-real-data-new/e2e-worker-3files.json`, bản cũ ở `e2e-worker-3files.before-speedup.json`:

| Lệnh | máy | loại ra | thời gian trước | thời gian sau | quy định (≤ 2×laser + 30 s) |
|---|---|---|---|---|---|
| I3 | laser | 6/6 | 6 s | 6,1 s | — |
| I3 | tu_dong | 6/6 | 113 s | **26 s** | 42,2 s ✓ |
| I5 | laser | 7/7 | 15 s | 15,5 s | — |
| I5 | tu_dong | 6/7 -> **7/7** | 293 s (V15 không ra) | **49,9 s** | 61 s ✓ |
| J55 | laser | 6/6 | — | 0,7 s | — |
| J55 | tu_dong | 6/6 | — | 7,2 s | 31,4 s ✓ |

MC Tự động 19/19 loại ra (trước 18/19). MC Laser y nguyên: 19/19, so từng dòng (chiều dài, số cây, % hao hụt, dư, số kiểu cắt) với bản cũ — không dòng nào khác. MC Tự động 18 loại còn lại cho CÙNG chiều dài/số cây/% với bản cũ, trừ
I3 V15 (cùng 1490 cây, dư 20 -> 22, bó+tay 75+0 -> 79+4) và I5 V15 (mới ra: 1801 cây). Mọi phương án có Σ hệ số × bó = số cây mỗi kiểu (cờ `bundleOk`).

**(c) Đợt 2 SKU J55 (proposal 188, body `requestParams` đọc từ `dna_erp_solver_test`, chỉ đọc), tu_dong qua SolverWorkerHost:** trước 281,8 s / 192 cây (8/9 loại ra; loại '10' vô nghiệm thật); sau **30,2 s / 192 cây (8/9 loại ra, cùng loại '10')**. ≤ 40 s ✓, không tệ hơn 192 ✓. (Cùng body đổi sang laser: 16,3 s / 167 cây 9/9.)

**(d) Chất lượng so với cat_sat gốc** (`highs_mctd.ts` 60 s/lần, strict + shortage; bản cũ chép ở `highs-mctd.before-speedup/`): `compare_mctd.py` vẫn **"bằng 8, HiGHS tốt hơn 2, kém hơn 0"**. Bản strict so bản trước (cây): không loại nào tệ hơn;
I3 V15 1493 -> **1492** (tầng 1 bây giờ `optimal_by_bound`), I5 V15 1805 -> **1802**, 17 loại còn lại giống hệt (cây và mm hao hụt). Thời gian ở 60 s: I3 V15 121 -> 107 s, I5 V15 121 -> 121 s (hết 2 tầng, không chứng minh được),
I5 V10 42 -> 52 s, J55 V18 10 -> 28 s, J55 V10 10 -> 12 s — các loại nhỏ chậm hơn một chút vì chạy thêm bậc thu hẹp trước khi chứng minh trên bài đầy đủ (kết quả giống nhau, vẫn trong ngân sách).

### 10.4 Test và kiểm tra

- Test mới `highs-solver.spec.ts` (describe "MC Tự động đường thu hẹp", J55 V15 tề 0 làm ca nhỏ giải được hết): thu hẹp = giải thẳng về khúc thừa + tổng đoạn dư tối ưu; bài đầy đủ ép hết giờ (`testFullBudgetSec` 0,01 s) vẫn giữ
  nghiệm thu hẹp hợp lệ (Σ hệ số × bó, cắt tay ≤ giới hạn, đủ nhu cầu, dư ≤ maxSurplus) và không gắn nhãn tối ưu; vô nghiệm trong tập thu hẹp + bài đầy đủ hết giờ => `time_limit_no_solution` (không phải infeasible); nghiệm chạm
  cận không-bó => `optimal_by_bound` và khỏi chạy bài đầy đủ; không-bó vô nghiệm => infeasible ngay; không-bó ra nhưng bó vô nghiệm => infeasible đã chứng minh; `allowShortage` không đi đường mới.
  `optimize-material.spec.ts`: I5 V15 tu_dong 20 s => ra, ≤ 1805 cây, ≤ 45 s, bó hợp lệ (thực đo 30,9 s).
- `pnpm exec jest src/modules/cutting-proposals --maxWorkers=3`: 11 suite / 279 test xanh. `pnpm build` xanh. `tsc --noEmit`: chỉ 2 lỗi seed có sẵn (`prisma/seed-*.ts`), không lỗi ở `solver-ts`. eslint `src/modules/cutting-proposals`:
  0 lỗi thật (chỉ lỗi CRLF prettier có sẵn); prettier `--end-of-line auto` sạch trên file sửa.
- Live-test tay trên giao diện/BE cổng 3002: CHƯA (dist đã build lại ở worktree nên cần khởi động lại BE test).

### 10.5 Chưa làm / còn treo

- Nghiệm tham lam chia bó từ nghiệm không-bó (mục 4 đề xuất): chưa làm, không cần để đạt tiêu chí; nếu bài thu hẹp bậc 1 về sau không ra trên dữ liệu khác thì đây là hướng tiếp (repair parity: ≤ 5 pattern lẻ).
- Tầng 2 bó vẫn không chứng minh được ở loại lớn (I5 V15, I3 V15: `feasible_time_limit`, HiGHS đứng yên sau ~1-2 s ở bài thu hẹp, phần giờ còn lại dành cho bài đầy đủ). Có thể thêm ngắt khi "đứng yên" nếu cần rút thời gian; chưa làm.
- Hằng số (`BUNDLE_NARROW_*`, hệ số 2× của bài không-bó) mới chỉnh theo 19 nhóm của 3 file định mức; chưa thử trên loại có > 12 cỡ.
- Đường mới phụ thuộc bài không-bó ra nghiệm (roundingStart sát ngưỡng 4 s ở I5 V15). Nếu không ra thì: hết time_limit => báo hết giờ ngay; còn ≥ nửa time_limit => rơi về bài đầy đủ với phần còn lại (xem 10.6 - bản đầu của mục 10 từng ghi "không tệ hơn trước", SAI về thời gian: ở T=5 tốn 24-41 s thay vì ~10 s).

### 10.6 Sửa sau review Opus (2026-10-23, lần 2): ngân sách khi bài không-bó không ra, biên an toàn, tầng 2

1. **Ngân sách nhánh "bài không-bó không ra nghiệm"** (`solveBundledSorted`). Đo trước khi sửa (I5 V15 / I3 V15, tề 0, lưỡi 2,5, `optimizeMaterial`): T=5 -> 24,3 s / 41,3 s KHÔNG RA; T=10 -> I5 10,7 s không ra. Nguyên nhân thật: khi
   roundingStart hụt ở bài LỚN (N ≥ 1000), `solveByN` chạy tiếp MIP đầy đủ rồi "model gốc", pha gốc của HiGHS không ngắt được (bài không-bó chạy 37,8 s dù time_limit 10 s), sau đó còn chạy thẳng bài bó đầy đủ 2 tầng. Sửa:
   - bài không-bó của MC Tự động (`stage1Only`) hụt ở bài lớn thì BỎ CUỘC ngay, không chạy MIP đầy đủ/model gốc (cờ `heavySkipped`; đường laser không đặt `stage1Only` nên y nguyên);
   - bài không-bó không ra: đã dùng ≥ nửa time_limit thì trả `time_limit_no_solution` ngay; còn ≥ nửa time_limit thì mới rơi về bài đầy đủ với ĐÚNG phần còn lại (T − đã dùng) mỗi tầng;
   - mốc cứng tầng 1 = 1,5×T (gồm bài không-bó, chưa có nghiệm bó nào), đã có nghiệm thu hẹp thì bài đầy đủ tầng 1 chỉ tới mốc T; tầng 2 ≤ T => một lần giải theo bó ≤ ~2,5×T ở mọi nhánh. Bỏ mức tối thiểu 0,25×T cho bậc thu hẹp
     (chỉ còn khi còn giờ tới mốc cứng).
2. **Biên an toàn bậc thu hẹp tầng 1**: bậc 1 (P*) được dùng 80 % phần giờ còn lại tới mốc cứng (trước: 40 % T = 4 s ở T=10, hết giờ không ra; bậc 2 sau đó chỉ 2,5 s); bậc 2 (P*+200) 60 % phần còn lại.
3. **Tầng 2**: bậc thu hẹp đã chứng minh tối ưu TRONG tập (`optimal`) thì bài đầy đủ chỉ còn 0,3×T (trước: chạy hết phần còn lại, vd loại '6' proposal 188 tập rộng optimal 0,37 s nhưng bài đầy đủ thêm 19,6 s vô ích).
4. **Chẩn đoán**: mọi nhánh (kể cả rơi về / hết giờ / vô nghiệm của bài không-bó) đều có `stats.bundle_narrow.relaxStatus/relaxSeconds`; `stage1.seconds` luôn gồm thời gian bài không-bó.
5. **Test mới** (`highs-solver.spec.ts`): time_limit 0 => `time_limit_no_solution` ngay (< 3 s), không chạy bài bó; `testRelaxBudgetSec: 0` + T=30 => rơi về bài đầy đủ, nghiệm hợp lệ, cùng khúc thừa tối ưu như giải thẳng, `stage1.seconds` ≥ `relaxSeconds`; test infeasible của bài không-bó nay kiểm `narrow.relaxStatus`.

| Một lần `optimizeMaterial` theo bó (tề 0, lưỡi 2,5, 6000) | Trước sửa lần 2 | Sau |
|---|---|---|
| I5 V15, T=5 | KHÔNG RA, 24,3 s | KHÔNG RA, **5,1 s** (hết giờ đúng hạn) |
| I5 V15, T=10 | KHÔNG RA, 10,7 s | **1801 cây, 21,9 s** |
| I5 V15, T=15 | 1801 cây, 25,1 s | 1801 cây, 25,8 s |
| I5 V15, T=20 | 1801 cây, 30,5 s | 1801 cây, 29,6 s |
| I3 V15, T=5 | KHÔNG RA, 41,3 s | KHÔNG RA, **4,3 s** |
| I3 V15, T=10 | 1490 cây, 14,6 s | 1490 cây, 15,4 s |
| I3 V15, T=15 | 1490 cây, 20,2 s | 1490 cây, 20,0 s |
| I3 V15, T=20 | 1490 cây, 24,9 s | 1490 cây, 24,9 s |
| Proposal 188 (2 SKU J55), T=20, qua SolverWorkerHost | 30,2 s / 192 cây | **18,7 s / 192 cây** (8/9 loại ra như cũ) |

Kiểm lại toàn bộ: e2e `e2e_worker_3files.ts` — MC Laser y nguyên so `before-speedup` (19/19, từng dòng chiều dài/cây/%/dư/kiểu cắt không đổi), MC Tự động 19/19: I3 26,3 s (laser 6,9 s), I5 47,7 s (laser 15,4 s), J55 8,0 s (laser 0,7 s), đều
≤ 2×laser + 30 s; kết quả tu_dong giống lần trước (chỉ I3 V15 dư 20 -> 22 và I5 V15 mới ra 1801). `highs_mctd.ts` 60 s + `compare_mctd.py`: vẫn "bằng 8, HiGHS tốt hơn 2, kém hơn 0"; strict không loại nào tệ hơn bản gốc
(I3 V15 1493 -> 1492, I5 V15 1805 -> 1801, còn lại giống hệt). Đổi nhãn ở 60 s do giới hạn 0,3×T của bài đầy đủ tầng 2: J55 V18 tầng 2 `optimal` -> `feasible_time_limit` (cùng 135 cây, thời gian 10 s -> 33 s so với bản gốc, vì bài đầy đủ
cần ~15 s để chứng minh nhưng chỉ được 18 s sau 6,5 s của bậc thu hẹp). jest cutting-proposals 11 suite / 281 test xanh; eslint 0 lỗi thật; prettier sạch; `tsc -p tsconfig.build.json` sạch.
Còn treo: loại cực lớn mà bài không-bó không ra trong ~T vẫn báo hết giờ (đúng nhãn) và để `optimizeOneMaterial` thử lại ×3/×6 - tổng đã giảm (mỗi lần ≤ ~2,5×T thay vì hàng chục giây vượt giờ), chưa đo lại ca retry đầy đủ trên giao diện.

## 11. 2026-10-24 — Review UI (Opus): bằng chứng đặc cách, chữ lý do, lỗi "ngưỡng 100 % làm mất phương án" (local, CHƯA deploy, CHƯA commit)

### 11.1 UX-6 — bằng chứng đặc cách lệch ~100 lần (PI-2026-041)

- Hiện tượng: khối "Kế hoạch SX xin cắt đặc cách" ghi SAT-VUONG-50X50 ở cây 6000 "ước tính hao ≥ 0,55 %" trong khi phương án thật 55,83 %.
- Kiểm đơn vị: `minWastePct` của `best-fill.util.ts` đã là PHẦN TRĂM (`/ stock × 100`), `estimatedWastePct` lưu thẳng số đó — KHÔNG lệch đơn vị. Con số đúng theo định nghĩa của nó: cận dưới theo MỘT cây lý tưởng
  (ba lô không giới hạn số lượng), không tính số lượng nhỏ (6 cây) + trần đoạn dư; nên 0,55 % là số "tốt nhất có thể trên 1 cây" chứ không phải hao hụt của phương án.
- Sửa: PI tạo từ phương án ĐÃ TÍNH (luồng solve-trước, mọi PI mới) thì `buildOverrideEvidence` lấy % THẬT của dòng trong phương án (`CuttingProposalLine.wastePercentage`, hàm mới
  `CuttingProposalsService.getProposalLineWaste`) thay cho ước tính, cùng cây `bestStockLengthMm` thật; loại vướng nhất tính lại trên số thật (`meetsThreshold` = số thật ≤ ngưỡng thường). Dòng vô nghiệm/không có trong
  phương án giữ ước tính. `previewBatch` vẫn được gọi để lấy ngưỡng thường từng loại. Áp cho cả `mergeItems` lẫn `claimSolo`.
- Test: `production-invoices.service.spec` (bằng chứng = 55,833 % thật thay vì 0,55 ước tính; dòng vô nghiệm giữ ước tính), `cutting-proposals.service.spec` (`getProposalLineWaste` trả số, vô nghiệm = null).

### 11.2 UX-7 (chữ)

- `invoiceReadinessReason` / `approve()` luôn khuyên "chọn chế độ “Chấp nhận hao hụt cao hơn”" kể cả khi đang ở chế độ đó -> viết theo chế độ ĐANG dùng (`noPlanReason`, theo `solverOptions` của phương án): chưa nới ngưỡng thì khuyên như cũ;
  đã nới mà vẫn vô nghiệm thì "dù đã chọn chế độ …" + khuyên bỏ tick “Giữ đúng chiều dài đã định” (nếu chưa cho dò chiều dài) và/hoặc gộp thêm SKU. 3 test mới.
- `optimize-one-material.ts` (lý do vô nghiệm, chưa dò): "Bật 'Dò chiều dài đặt riêng'" -> "Bỏ tick “Giữ đúng chiều dài đã định” để hệ thống tự dò chiều dài khác." (tên ô thật trên UI); test chữ cập nhật.

### 11.3 UX-7 (solver) — điều tra: LỖI THẬT ở bộ liệt kê kiểu cắt, KHÔNG riêng MC Tự động

Replay requestParams 190/191/192 (đợt 2 SKU GHE-J55 + BAN-8-MEIYING-J55) qua SolverWorkerHost; vật tư '6' = SAT-HOP-10X20 (7 cỡ: 470, 445, 20, 430, 425, 460, 190; 120/60 đoạn).

| Proposal | Chế độ | SAT-HOP-10X20 (trước) |
|---|---|---|
| 190 | Bình thường (ngưỡng 1 %) | 41 cây × 6000, 0,00 % (tu_dong; cần retry ×3/×6 mới ra) |
| 191 | Chấp nhận hao hụt cao hơn (100 %) + giữ đúng chiều dài | "Không chiều dài nào cắt được loại này" (sai) |
| 192 | 100 % + cho dò | 4000 mm × 61 cây (đáng lẽ 41 cây × 6000) |

- Nguyên nhân: ngưỡng `max_waste_percentage` 100 % => `generatePatterns` ở 6000 chạm trần SOLUTION_LIMIT 100.000 kiểu (từ ngưỡng ≥ 2 % với 7 cỡ, tề 0; ≥ 5 % tề 10) theo thứ tự DFS. Tập cắt cụt đó toàn kiểu nhiều đoạn
  đầu danh sách, KHÔNG chứa kiểu ít phế phủ nhu cầu; lấy 5.000 (thậm chí 20.000) kiểu ít phế nhất của nó vẫn "vô nghiệm tồn kho" (đã thử cap 20.000: vẫn infeasible; không cap: hết giờ). Lý do báo cho người dùng cũng sai
  ("vô nghiệm tồn kho", "Không chiều dài nào cắt được") vì thực ra là liệt kê thiếu. Replay cùng body với máy LASER: LỖI Y HỆT => lỗi có sẵn của `optimizeMaterial` (cũng trong bản Python gốc: cùng SOLUTION_LIMIT), không phải do đường thu hẹp MCTĐ.
  Tăng ngưỡng mà mất phương án vi phạm tính đơn điệu (ngưỡng chỉ nên MỞ THÊM lựa chọn).
- Sửa (`optimize-material.ts`): khi liệt kê ở ngưỡng người dùng bị cắt cụt (không do hết giờ), liệt kê thêm ở thang ngưỡng giảm dần `ENUM_RATIO_LADDER` [50 %…0,5 %] đến ngưỡng ĐẦY ĐỦ đầu tiên, rồi GỘP với tập cắt cụt
  (tập đầy đủ trước). Ca ngưỡng thấp/đủ trần không đi qua đây (kết quả cũ y nguyên). Cờ `patterns_truncated` giữ true (ở ngưỡng người dùng vẫn chưa liệt kê hết); stats thêm `enum_ratio_used`; lý do vô nghiệm kèm
  "chưa liệt kê hết các kiểu cắt…" khi còn cắt cụt (không khẳng định chắc chắn).
- Kết quả sau sửa (cùng body, qua worker): 191 tu_dong **SAT-HOP-10X20 41 cây × 6000 (fixed) 0,00 %** (47 s tổng, 9/9 loại ra; trước: loại này không ra); 191 laser **41 cây × 6000 0,17 %** (31,7 s; trước: không ra);
  192 tu_dong **41 cây × 6000 0,00 %** thay vì 61 cây × 4000. Các loại khác của 191/192 giữ y nguyên (ví dụ SAT-VUONG-20X20 14 cây × 6000 13,46 %). Test hồi quy `optimize-material.spec` ("ngưỡng 100 % KHÔNG làm mất phương án"): trước sửa infeasible, sau 41 cây.
- Kiểm không hồi quy: e2e 3 file × 2 máy chạy lại — MC Laser y nguyên 19/19 so với bản gốc, MC Tự động 19/19 giống hệt lượt trước (I3 25,8 s, I5 45,1 s, J55 6,1 s).

**Điểm theo THIẾT KẾ (không đổi hành vi) — cần người dùng quyết:** ở chế độ "Chấp nhận hao hụt cao hơn", loại nào cắt được trên cây chuẩn 6000 (dù hao 13,46 % như SAT-VUONG-20X20) thì CHỐT 6000, không dò cây riêng 4330 (0,17 %), vì
`optimizeOneMaterial` chỉ dò khi chiều dài chuẩn vô nghiệm (đúng `optimize_one_material` của Python; cả khi bật cho dò, như proposal 192). Người dùng có muốn chế độ đặc cách vẫn dò cây riêng để so rồi chọn phương án ít hao hơn không?

### 11.4 Kiểm tra / còn treo

- jest `cutting-proposals` + `production-invoices` (`--maxWorkers=3`): 16 suite / 500 test xanh. eslint 0 lỗi thật (lỗi CRLF prettier có sẵn), prettier `--end-of-line auto` sạch, `tsc --noEmit` chỉ 2 lỗi seed có sẵn.
- Chưa làm: dữ liệu cũ (PI-2026-041 đã lưu 0,55) KHÔNG được sửa lại (bằng chứng được chụp lúc KHSX bấm - chỉ PI mới dùng số thật); FE chưa đổi (chỉ BE). SAT-HOP-10X20 ở MC Tự động vẫn chậm (cần retry ×3/×6 ở time_limit 20 s, bài bó trên 83.738 kiểu ở 1 %) - không thuộc lỗi này.

### 11.5 Sửa theo Opus kiểm lại (2026-10-24)

- `buildOverrideEvidence` lưu thêm `fromProposal` (true = `estimatedWastePct` là hao hụt THẬT của dòng phương án, false = ước tính
  best-fill); kiểu trả trong `production-invoices.service.ts` thêm `fromProposal?`. FE dùng để ghi "theo phương án đã tính" thay vì "ước
  tính ≥". Test UX-6 cập nhật (`fromProposal: true`).
- `overThresholdWarning`: "Có loại sắt vượt ngưỡng hao hụt - …" → "Có loại sắt hao hụt cao hơn mức mặc định - …" (khớp nhãn dòng
  "Cao hơn mức mặc định" ở đợt đặc cách; vẫn đúng ở đợt thường).
- Người dùng chốt (2026-10-24): chế độ "Chấp nhận hao hụt cao hơn (đơn gấp)" bắt buộc mua theo cây mặc định đã config (6000) → giữ
  `optimizeOneMaterial` chỉ dò khi cây chuẩn vô nghiệm, không thêm dò so sánh.
- Kiểm tra: jest production-invoices + cutting-proposals.service 6 suite / 356 test xanh; prettier sạch; `pnpm build` xong.

### 11.6 Đơn gấp chỉ cây đã định — lý do vô nghiệm nói đúng nguyên nhân (2026-10-24)

- Người dùng: đơn gấp bắt buộc mua cây đã định (6000); FE bỏ ô tick "Giữ đúng chiều dài đã định" (dò chiều dài là việc của chế độ Bình
  thường). FE luôn gửi `solverAllowCustomLength: false` + 100 %.
- `noPlanReason` (đơn gấp): bỏ "bỏ tick “Giữ đúng chiều dài đã định”…" → "xem lý do ở từng loại sắt: đoạn dài hơn cây thì sửa định mức;
  MC Tự động không ghép được bó thì chọn MC Laser cho đợt này hoặc gộp thêm SKU dùng chung loại sắt; hết giờ thì tính lại". Cùng một câu cho
  phương án cũ còn `solverAllowCustomLength: true`.
- `optimize-one-material.ts` `noSolution` nhận thêm `bundle`; câu cuối (khi cả 100 % cũng không ra): head "Cây 6000mm không cắt được loại
  này" (không dò) / "Không chiều dài nào cắt được loại này" (đã dò) + nguyên nhân: đoạn dài hơn phần dùng được của cây / ràng buộc bó MC Tự
  động (hệ số, cùng kiểu trong bó, cắt tay ≤ N, không thiếu, dư ≤ maxSurplus) → khuyên chọn MC Laser / ràng buộc tồn kho.
- Test: `optimize-one-material.spec` (+3: đoạn dài hơn cây, MC Tự động, đã dò), `cutting-proposals.service.spec` (gộp 2 test cũ thành
  `it.each` cho allowCustom false/true, không còn chữ "tick"/"dò chiều dài"), `propose.spec` loại B kiểm "dài hơn phần dùng được của cây
  (5990mm)". jest cutting-proposals + production-invoices 16 suite / 503 test xanh; prettier sạch; `pnpm build` xong.

### 11.7 cutting-defaults trả thông số máy cắt cho KHSX xem (2026-10-24)

- `CuttingDefaultsResponseDto` + `SystemConfigService.cuttingParams()`: GET `/system-config/cutting-defaults` (và PUT max-waste) trả thêm
  `solverStockLengths`, `solverMaxSurplus`, `solverTrimStartMm`, `solverBladeWidthMm`, `solverMctdTrimStartMm`, `solverMctdBladeWidthMm`,
  `solverBundleFactors`, `solverMaxManualCuts`, `solverMaxSizesPerPattern` — để KHSX (quyền CUTTING_PROPOSAL:VIEW) XEM ở "Tối ưu cắt sắt";
  không mở quyền SYSTEM_CONFIG, không thêm đường sửa. Test `system-config.service.spec` (+1). jest system-config 33 test xanh; build xong.

### 11.8 Chip "cắt riêng ở cây 6m": lượt kiểm bù `deepVerify` + nhớ kết quả qua lần tải trang (2026-10-24)

- Đo (changelog chính mục 28): chip đã xác minh khớp 27/27, nhưng chip CHƯA xác minh rơi về ước tính "≥" xanh khi thật ra vượt (SAT-PHI-6
  GHE-J55 ×20: 5 s không kịp, cần ~16 s; 6m tốt nhất 19,67 %).
- `BatchStockLengthsQueryDto.deepVerify` (query "true"/"false" → boolean) → `getBatchCandidates(…, deepVerify)` →
  `verifyExactStandaloneWasteBatch(…, deep)` / `verifyExactStandaloneWaste(…, deep)`: deep = tới `EXACT_CHECK_DEEP_MAX_SIZES` 12 cỡ, time_limit
  30 s, timeout 75 s/bài, ngân sách 120 s, song song = `solver.ts.workers` (mặc định 1 — gửi 6 bài vào 1 luồng thì bài cuối quá hạn chờ).
- `exactCheckCache` (Map theo đúng khoá body solver, TTL 30 phút, tối đa 3.000, chỉ nhớ kết quả khác null) dùng cho cả lượt nhanh và lượt bù →
  lượt bù không giải lại chip đã có; lần mở trang sau ra ngay.
- Test `cutting-batch-suggestions.service.spec` (+2): nhớ qua lần gọi (solver gọi 1 lần); lượt nhanh lỗi → verified=false, lượt bù gọi lại với
  time_limit 30 và timeout lớn hơn. jest cutting-proposals 291 test xanh; prettier sạch; `pnpm build` xong.

### 11.9 Nhóm gộp ít hao hụt nhất trong cửa sổ hạn giao (2026-10-24) — đã thay bằng 11.10 (luật cứng + fix-options)

- Schema `SystemConfig.solverMergeWindowDays Int @default(7)` + migration `20261024100000_add_solver_merge_window_days` (đã áp DB test bằng
  `scratchpad/migrate-solver-test.ps1`, chỉ dna_erp_solver_test); DTO cập nhật Admin (`@IsInt @Min(0) @Max(365)`), response, cutting-defaults.
- `CuttingMergeGroupDto` + `CuttingBatchCandidateListDto.mergeGroups`. `CuttingProposalsService.bestMergeGroups()`: loại sắt có chip đỏ, ≥ 2 đơn →
  cửa sổ tối đa theo hạn khung (`frameDeadlineOf`; đơn chưa có hạn vào mọi cửa sổ), bỏ cửa sổ con, giữ cửa sổ chứa ≥ 1 đơn đỏ → cộng dồn nhu cầu
  (xếp theo cỡ) → đệm `exactCheckCache` hoặc (lượt bù, ≤ 12 cỡ, ngân sách 60 s) `verifyExactStandaloneWaste(deep)`; không có thì cận dưới best-fill
  → chọn: đạt ngưỡng > hao hụt thấp > ít đơn. `recommendedItemIds` = hợp các nhóm đạt ngưỡng (bỏ cách cũ dùng `getBatchSuggestions`, hàm đó giữ
  cho badge/endpoint gợi ý). `exactCheckKey()` dùng chung, nhu cầu xếp theo cỡ.
- Test `cutting-batch-suggestions.service.spec` (+3, sửa 1): cửa sổ 10 ngày gộp 2 đơn cách 8 ngày (`deadlineSpanDays` 8); cửa sổ 7 → không gộp;
  đơn chưa có hạn → gộp, span null. jest cutting-proposals + system-config 326 xanh; build xong.

### 11.10 Luật gộp cứng (khung mốc cần sắt + trần SKU) và fix-options — thay 11.9 (2026-10-24)

Bối cảnh, giao diện và kết quả trình duyệt: changelog chính `D:\DNA-ERP-BE\docs\changelog-2026-10-21-review-du-lieu-test-solve.md` mục 32. Ở đây
chỉ ghi phần BE trong worktree.
- `src/common/utils/merge-rules.util.ts` (mới): `ownSteelDeadlineOf` (materialDeadline ?? stage FRAME, KHÔNG lấy hạn PI), `maxGapDays(N) = N − 1`
  (khung tính cả ngày đầu, Sếp Nhân "ngày 1 gộp được ngày 3, ko được gộp với ngày 4"), `checkMergeRules(items, {windowDays, maxSkus}, 'batch' |
  'invoice')`, `skuLabel(factoryCode, orderCode)` (nhãn câu báo kèm mã PO). Spec 7 test.
- Schema/migration: `solverMergeWindowDays` (20261024100000 thêm, mặc định 7 → 20261024110000 đổi 3) và `solverMergeMaxSkus` (20261024110000 thêm,
  mặc định 5 → 20261024120000 đổi 2; UPDATE giá trị cũ còn đúng mặc định). Đã áp DB test bằng `scratchpad/migrate-solver-test.ps1`. DTO cập nhật:
  window `@Min(1) @Max(365)`, maxSkus `@Min(1) @Max(50)`; `cutting-defaults` trả cả hai.
- Chặn: `requestForBatch` (cutting-batch-solve), `mergeItems`, `updateItem` khi `pi.isMerged` (`assertMergedPiDeadlineRule` đọc lại trong cùng
  transaction), endpoint mới `PATCH /production-invoices/:id/items-deadlines` (`UpdateItemsDeadlinesDto`, `updateItemsDeadlines`: một transaction,
  kiểm luật, audit). Sai luật → 400 với câu báo.
- `getBatchFixOptions` + `POST /cutting-proposals/cutting-batch-fix-options`: mỗi loại sắt của đợt ở cây chuẩn; loại vượt → gộp thêm (tham lam theo
  mốc gần, lọc khung + trần, giải thật từng tiền tố, đệm `fixSolveCache`), cây riêng (auto_scan), đơn gấp (100 %), `addAllItemIds`; ngân sách 60 s,
  mỗi bài 15 s / timeout 40 s. Lý do không gộp: ngoài khung / "Đợt đã đủ M SKU" / (mới) "Đợt đang có X SKU, quá trần M SKU - bỏ bớt SKU trước".
- `recommendedItemIds` = 1 SKU (chip đỏ, mốc cần sắt sớm nhất); bỏ `bestMergeGroups` / `mergeGroups` / `CuttingMergeGroupDto` của 11.9.
- Kiểm: jest 4 thư mục 595 test, 593 xanh + 2 test nặng `optimize-material.spec` chỉ quá giờ khi chạy song song (riêng 14/14 xanh); tsc `src` sạch
  (lỗi seed có sẵn từ bd70135), eslint/prettier sạch, `pnpm build` xong.
- Còn treo: người dùng chưa quyết có đổi mốc cần sắt sang mốc Phôi (FRAME_PHOI) hay không; deploy chưa làm.
