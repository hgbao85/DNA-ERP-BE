# Changelog 2026-10-21 — Review thư mục "Data test solve" (bảng theo dõi sắt thành phẩm)

> **2026-10-26: ĐÃ COMMIT + PUSH + LÊN PRODUCTION** (BE `4cf4078` trên `main`, FE `d70be5e` trên `demo`; CI xanh, Render và Vercel đã chạy bản mới — changelog-2026-10-06 mục 5.8). Các chữ "CHƯA commit/CHƯA deploy" bên dưới là trạng thái lúc viết từng mục.
>
> Trạng thái: mục 1–16 CHỈ REVIEW DỮ LIỆU / báo cáo (không sửa code); từ mục 17 có sửa code solver + BE/FE (máy cắt MC Tự động, local, CHƯA commit, CHƯA deploy). Các điểm "cần xác nhận" chờ người dùng.

## 1. Nội dung thư mục

`C:\Users\ROG ZEPHYRUS\Downloads\Data test solve\` — 4 file "BẢNG THEO DÕI SẮT THÀNH PHẨM" của xưởng Tây Sơn, mỗi
sheet = 1 lệnh sản xuất (LSX): cột A mã chi tiết, B tên sắt (+ ghi chú gia công), D kích thước (mm), E số đoạn, F số
ghế, G SL cần cắt (công thức), H… SL đã cắt theo ngày/ca.

| File | Sheet → LSX / SỐ LƯỢNG |
|---|---|
| `8. J55 GHẾ GOPLUS MỚI.xlsx` | `LSX 137-145` → 137/956 · `J55 LSX 138` → 138/1038 · `LSX133 SL 1048` → 133/1048 · `J55 LSX 140` → **138/1038** · `GHẾ J55 GOPLUS` → 163/956 |
| `I41+42 MZ (10-2026).xlsx` | `41` → 323/450 · `42` → 323/450 |
| `MZ I3 MỚI.xlsx` | `I3 MEYING` → 311/1000 (ô D7 ghi thêm "300 b") |
| `MZ I5 MỚI.xlsx` | `I5 MEYING` → 310/140 |

Script trích + kiểm: scratchpad `bench/parse_bom.py` (openpyxl, đọc cả giá trị lẫn công thức cột G), kết quả thô
`bench/parse_bom.out`, `bench/bom_rows.json`.

## 2. Phát hiện

### 2.1 Nghi sai số liệu (ảnh hưởng trực tiếp số sắt cần cắt/mua)
1. **`LSX133 SL 1048`: FI 4 = 6 mm (r20, r28) và Fi 6 = 12 mm (r36)**; mọi sheet J55 khác ghi 60 mm và 150 mm. Nghi gõ
   thiếu số 0 / sai.
2. **I41 (cả sheet) và I42 khối Mê ngồi: SL cần = Số đoạn × SỐ LƯỢNG, bỏ qua cột Số ghế** (F = 2 hoặc 4), trong khi I42
   khối Tựa lưng và mọi file khác dùng E × F × SỐ LƯỢNG. Nếu F là số chi tiết/bộ thật thì 33 dòng đang **thiếu 1/2 đến
   3/4 số lượng** (vd 42.I.2.1 hông ghế ghép 1490,8 mm: 900 so với 3.600). Cần xác nhận ý nghĩa cột F ở 2 sheet này.
3. **I3: ô D7 "300 b"** bên cạnh SỐ LƯỢNG 1000 bộ — các chi tiết bàn (I3.2.x, F=1) đang tính theo 1000. Nếu chỉ làm
   300 bàn thì bàn đang dư 700 bộ sắt. Cần xác nhận.
4. **I3 r46 `I3.2.2.2 V15 TRƠN` 395 mm × 2: ô SL cần trống** (không có công thức) → dòng này sẽ bị bỏ khi tính.
5. **Sheet `J55 LSX 140` có tiêu đề LSX 138 / SL 1038** (sao chép từ sheet 138, chưa sửa số LSX).

### 2.2 Lỗi mã / nhãn (không đổi số lượng nhưng dễ nhầm khi nhập ERP)
- Trùng mã: `JSE 55.1.4.3` (sheet 138, 140: 460 mm và 230 mm), `I41 II.2.4` (r29, r30), I3 khối Kỷ dùng lại mã
  `I3.2.2.1–3` của khối Mặt bàn (nên là I3.2.3.x), I5 r62 `I5.1.3 .7` nằm trong khối I5.2.3 (nên là I5.2.3.7).
- I3 nhóm "**I1.1.2** - Tay trái" (nên là I3.1.2). Mã có khoảng trắng thừa: `I3.1.2 .1`, `I5.2.2 .3`…
- Sheet `LSX 137-145` / `LSX133` đánh mã 1–7 lặp lại mỗi khối thay vì mã chi tiết.

### 2.3 Dòng không phải đoạn sắt cây (phải loại khỏi bài toán cắt)
PAT / pát / LA BẠ "50*14" (bản mã, ô D là chữ hoặc trống), PAT KÍNH, chân sofa (D trống), các dòng "% HOÀN THÀNH" nằm
trong vùng bảng.

### 2.4 Tên sắt không chuẩn → không gom nhóm tự động được
Cùng một loại sắt viết nhiều kiểu: `V15` / `V 15` / `V15 GẤP` / `V15 HÔNG BÀN (2T)` / `V15 GHẾ GÓC (2D)`…; `FI 10` /
`fi 10` / `fi10`; `Fi 6` / `FI 6`; `H10-20` / `h10-20`. Cột B trộn **loại sắt + ghi chú gia công (tán, dập, uốn,
nhấn) + tên chi tiết**. Ghép tự động theo chữ sẽ tách nhầm 1 loại thành nhiều nhóm (solver tính riêng từng nhóm →
hao hụt tăng). Cần cột mã vật tư riêng (đúng như ERP đang làm qua Material).

**Người dùng xác nhận (2026-10-21):** "GẤP" chỉ là ký hiệu công đoạn cho công nhân, không phải loại sắt — `V15 GẤP` là
V15. Áp chung quy tắc: **loại sắt = phần đầu tên** (`V15`, `V 15`, `H10-20`, `FI 10`, `fi10`…), mọi chữ phía sau
(trong/ngoài ngoặc: tán, dập, uốn, nhấn, GẤP, CHỐT, TRƠN, BÀN, GHẾ GÓC, HÔNG…, bạ H, có móc) là ghi chú, bỏ qua khi gom.
Script `bench/group_steel.py`: 61 cách viết → **8 loại sắt**: V15 (36 cách viết), V10 (4), V16 (4), V18 (4),
H10-20 (7), FI10 (3), FI6 (2), FI4 (1). 16 dòng bị loại khỏi bài toán cắt (PAT/pát/LA BẠ 50*14, PAT KÍNH, chân
sofa, dòng % hoàn thành). Riêng "GHẾ GÓC/BÀN/HÔNG…" là tên chi tiết, cũng coi là ghi chú — chưa hỏi lại người dùng
từng chữ, nếu có chữ nào thực ra là loại sắt khác (vd V15 dày khác) thì quy tắc này gom nhầm.

### 2.5 Điểm tốt cho việc test solver
- Có kích thước thập phân thật: 1052,2 / 1317,2 / 1490,8 / 1774,4 / 2625,2 mm — đúng phần bản HiGHS-TS **chưa kiểm**
  (changelog 2026-10-20 review excel, mục 6–7).
- Có loại sắt nhiều cỡ (V15 của I3, I5, I41) và đoạn rất ngắn (40, 45, 55, 60 mm).

## 3. Chưa làm
- ~~Chưa chạy solver trên dữ liệu này~~ → **ĐÃ CHẠY, xem mục 4** (dùng dữ liệu nguyên trạng theo yêu cầu người dùng,
  các điểm 2.1 vẫn chưa được xác nhận — chỉ gắn cờ).
- Chưa đối chiếu với định mức đang lưu trong ERP (bảng định mức sản phẩm I3/I5/J55/I41/I42 trong DB local).

## 4. 2026-10-21 — Test HiGHS-TS vs OR-Tools trên 4 file này + PDF trình lãnh đạo

Người dùng yêu cầu chia nhiều worktree để test bộ giải mới (HiGHS-TS) trên dữ liệu này rồi gom PDF đối chiếu với bộ giải
cũ. 4 phiên song song, mỗi phiên 1 file, worktree cắt từ `claude/solver-ts-research-1a4370` (commit ce8f8e4):

| Phiên / nhánh | Commit | Kết quả phiên báo |
|---|---|---|
| `claude/test-real-j55-bb0b28` | 305fe97 | 60/60 trùng (5 sheet × 6 loại × 2 cấu hình) |
| `claude/test-real-i41-42-1cccb5` | 527ab47 | 11/12 trùng |
| `claude/test-real-i3-9ea3f4` | 158876b | 11/12 trùng (lệch: V15 cấu hình A, HiGHS tốt hơn) |
| `claude/test-real-i5-a5d5bd` | 37f27e9 | 8/14 theo tiêu chí của phiên (xem dưới) |

Mỗi (sheet × loại sắt) chạy 2 cấu hình qua cả 2 bộ giải, cùng request: **A** = đúng SystemConfig mặc định (cây 6000,
tề 10, lưỡi 1, ≤1 %, dư ≤10, 20 s/loại, auto_scan + stop_on_first, dải 5000–6000 bước 10); **B** = như A nhưng
auto_scan false, 120 s. OR-Tools qua `solver/run_propose.py` nhánh A (SOLVER_WORKERS=2), tuần tự.

**Kiểm lại độc lập ở checkout chính** (scratchpad `bench/aggregate.py`, đọc 4 file JSON từ các worktree, tính lại
match theo chiều dài cây + số cây + mm hao hụt + số dư; cả hai cùng không đạt ngưỡng = như nhau): **98 nhóm, 94 như
nhau, 3 HiGHS tốt hơn, 1 khác.** Lệch với đánh giá của phiên I5 ở 4 nhóm: FI10·A chỉ khác làm tròn hiển thị %
(cùng 207 mm, Python `round` vs TS `Math.round`); FI4/FI6/FI10·B cả hai cùng không đạt, phiên I5 tính "lệch" vì HiGHS
thiếu `best_achievable` và báo sai "hết giờ" — mình tính là như nhau về kết quả, ghi riêng phần lỗi nhãn.
- HiGHS tốt hơn: I3·V15·A (2194 cây, 0,1682 % so với 0,1754 %; OR-Tools bị cắt cụt liệt kê trong 20 s, ở B ra bằng
  HiGHS), I5·V15·A và I5·V15·B (399 cây, 0,1696 % so với 0,1745/0,1741 %; 13 cỡ, OR-Tools cắt cụt cả ở 120 s).
- Khác: I41·V15·A — cả hai chạm 20 s; OR-Tools 1189 cây/13.043,8 mm hao hụt, HiGHS 1188 cây/13.238 mm (ít hơn 1 cây
  nhưng nhiều mm hơn theo mục tiêu tầng 1). Ở B cả hai 1188 cây/0,1813 %/dư 9 (tốt hơn cả hai bản 20 s).
- **Không nhóm nào HiGHS mua nhiều cây hơn OR-Tools.** Thời gian giải tổng: OR-Tools 1.130 s, HiGHS 549 s (I3·V15
  HiGHS chậm hơn: 145 s so với 60 s, nhưng ra tối ưu). Đo trên máy dev có việc nền khác → chỉ so bậc độ lớn.
- **Lỗi HiGHS-TS phát hiện (CHƯA SỬA):** byN trong `highs-solver.ts` — `proven()` không tính trạng thái infeasible
  nên chiều dài đã chứng minh vô nghiệm bị trả `time_limit_no_solution` → `timed_out=true`, lý do "hết thời gian, hãy
  tăng thời gian chạy", thiếu `best_achievable`. 26 nhóm bị gắn nhãn sai; số cây/hao hụt không đổi. Phải sửa trước
  khi dùng. Phụ: OR-Tools khuyên "nâng ngưỡng" ở I5·FI6·B dù tốt nhất 0,54 % < 1 % (thứ chặn là max_surplus).
- Ảnh hưởng dữ liệu nghi sai thấy rõ: LSX133 FI6 = 12 mm → chỉ 11 cây (sheet khác 116–126 cây).

**PDF:** `docs/bao-cao-test-solver-dinh-muc-that-2026-10-21.pdf` (5 trang A4; script scratchpad
`bench/make_realdata_pdf.py`): trang 1 KPI (98 / 94 / 3 / 1) + bảng theo file + kết luận + việc phải làm; trang 2
các nhóm khác nhau + vì sao + lỗi phát hiện + cách đo; trang 3 dữ liệu cần xác nhận; trang 3–5 phụ lục 98 nhóm.

Chưa làm: sửa lỗi nhãn byN; xác nhận các điểm 2.1 rồi chạy lại với dữ liệu đã sửa; đối chiếu với định mức trong ERP.
Không merge 4 nhánh test (chỉ chứa script + JSON kết quả).

## 5. 2026-10-21 — Gỡ toàn bộ commit `claude/*`, giữ file chưa commit

Người dùng thấy trong Fork hàng loạt commit `claude/*` và hỏi vì sao commit: "chỉ giữ im trong máy tôi thôi không
commit", rồi "không cần commit gì hết gỡ xuống trong fork cho tôi". Nguyên nhân: brief giao cho các phiên song song (do
phiên điều phối này viết) ghi "Commit trên nhánh worktree, không push"; các phiên con còn tự mở thêm 3 phiên sửa cùng
lỗi nhãn "hết giờ". Không có gì bị push (mọi nhánh `upstream=none`), `main` 4a967f5 không bị đụng, 2 dòng
`stash@{0..1} WIP on claude/…` trong ảnh Fork là bản sao lưu tạm của lint-staged, đã tự xoá.

Đã làm (script scratchpad `uncommit_worktrees.py`, chạy thử `--dry-run` trước): trong mỗi worktree
`git reset --mixed main` → commit biến mất khỏi Fork, file giữ nguyên dạng chưa commit/chưa track. Kiểm bằng băm từng file
của commit cũ trên đĩa trước/sau reset: **0 file thay đổi** ở cả 9 worktree. `claude/wonderful-mclaren-6bdc6e` (không
mở ở worktree nào, chỉ chứa ce8f8e4 — nội dung có trên đĩa ở `solver-ts-research`) chuyển con trỏ về main.
`claude/distracted-mahavira-8d50b1` không có commit ngoài main → không đụng.

SHA cũ (lấy lại được qua reflog / `git branch -f <nhánh> <sha>`): confident-hypatia 97665b1 · fix-highs-byn-infeasible-label
ce8f8e4 · serene-mcclintock 8d0abe4 · solver-python-in-be 75599c1 · solver-ts-research ce8f8e4 · test-real-i3 158876b ·
test-real-i41-42 527ab47 · test-real-i5 37f27e9 · test-real-j55 305fe97 · wonderful-mclaren ce8f8e4. Danh sách đầy đủ:
scratchpad `claude-branches-before-reset.txt`.

Đã lưu memory `khong-commit-giu-thay-doi-local`; đã nhắn các phiên còn chạy dừng commit/stash. Việc còn treo: 3 phiên
sửa lỗi nhãn trùng nhau (người dùng chưa chọn dừng phiên nào); phiên HiGHS đang sửa lỗi nhãn + chạy lại 4 file, chưa
commit.

## 6. 2026-10-21 — Chạy lại OR-Tools lần 2 + bảng so sánh tổng (OR-Tools 2 lần ↔ HiGHS đã sửa nhãn)

Người dùng: "trong lúc đợi highs thì bắt đầu tiến hành test bằng OR tool với 4 file excel tôi gửi bạn, rồi làm bảng so
sánh tổng". OR-Tools đã chạy 1 lần trong 4 phiên test (mục 4), nên đây là **lần 2**: chạy ngay trong phiên điều phối,
tuần tự, 1 request / (sheet × loại sắt × cấu hình) qua `solver/run_propose.py` (worktree solver-python-in-be, logic trùng
byte DEXUAT f80e005), `SOLVER_WORKERS=2`, cùng tham số cấu hình A/B như mục 4. Script scratchpad
`bench/run_ortools_all.py` → `ortools_run2.json`. Không mở phiên mới, không commit.

HiGHS dùng kết quả **sau khi sửa nhãn "hết giờ"** do phiên `solver-ts-research` chạy lại
(`.claude/worktrees/solver-ts-research-1a4370/test/solver-real-data/results-after-fix/`, chưa commit): nhãn sai 26 → 0,
`best_achievable` trùng OR-Tools 20/20, 97/98 phương án không đổi so với trước khi sửa (nhóm đổi: I41·V15·A, dao động do
chạm 20 s — phiên đó chạy lặp 6 lần cả mã cũ lẫn mới đều ra 1188 cây/12.926 mm/dư 9).

**Kết quả** (`bench/make_total_pdf.py`, so theo thứ tự mục tiêu solver: ít cây → ít mm hao hụt → ít dư):

| | Số nhóm |
|---|---|
| HiGHS (đã sửa) so với OR-Tools lần 2: như nhau | **96/98** |
| HiGHS tốt hơn | **2** — I5·V15·A (399 cây, 4.060 so với 4.177 mm), I5·V15·B (399 cây, cùng 4.060 mm, dư 9 so với 12) |
| OR-Tools tốt hơn | **0** |
| OR-Tools lần 1 = lần 2 | 94/98 (4 nhóm V15 nhiều cỡ khác; lần 2 máy rảnh hơn nên tốt hơn ở I41·A, I3·A, I5·B) |
| HiGHS trước sửa = sau sửa | 97/98 |
| Thời gian tổng | OR-Tools 1.130 s (lần 1, máy bận) / 875 s (lần 2) — HiGHS 350 s |

So với OR-Tools lần 1 thì HiGHS 94 như nhau + 4 tốt hơn. Kết luận không đổi so với PDF trước: **không nhóm nào bộ giải
mới kém hơn**; chênh lệch chỉ ở V15 9–13 cỡ, nơi OR-Tools liệt kê kiểu cắt bị cắt cụt theo giờ nên kết quả dao động.

**PDF:** `docs/bang-so-sanh-tong-ortools-highs-2026-10-21.pdf` (4 trang): trang 1 KPI (98 / 96 / 2 / 0) + bảng theo file
+ các nhóm khác/dao động + kết luận; trang 2 việc cần chốt + dữ liệu cần xác nhận + cách đo; trang 2–4 phụ lục 98 nhóm
(OR-Tools lần 1, lần 2, HiGHS đã sửa). Dữ liệu gộp: scratchpad `bench/total_merged.json`.

**~~Còn chờ người dùng chốt~~ → ĐÃ LÀM hướng (a)** (xem dưới) (từ phiên solver-ts-research, changelog 2026-10-20 mục 7.8.4): màn "Tối ưu cắt sắt" xác minh
chính xác chậm hơn — HiGHS 1 worker 8/214 loại so với DEXUAT 119/214 trong 12 s; 11 lần gọi giống hệt của một loại sắt
[30 mm × 120, 60 mm × 240] chiếm 73 s/78,6 s. Hướng: (a) nhớ kết quả theo body trong cùng lần tải trang (đề xuất), (b) làm
bước `best_achievable` rẻ hơn (đổi ngữ nghĩa so với Python), (c) `SOLVER_TS_WORKERS=2` (RAM ×2). Chưa làm.

**Cập nhật 2026-10-21 — đã làm hướng (a)** (người dùng chọn; phiên solver-ts-research làm, CHƯA commit, changelog
2026-10-20 mục 7.8.7): nhớ tạm kết quả xác minh theo body trong một lần gọi `verifyExactStandaloneWasteBatch` (một lần
tải trang), lưu cả promise đang chạy. Đo màn "Tối ưu cắt sắt" (53 dòng, 214 loại): ts 1 worker 8 → **175/214** (8,5–8,9 s),
ts 2 worker 46 → 175 (7,4 s), http/DEXUAT 119 → 175 (5,7–6,6 s). 39 loại còn lại không xác minh vì > 5 cỡ đoạn hoặc vô
nghiệm không có best_achievable — như nhau ở cả 3 chế độ. Đã kiểm ở checkout chính: HEAD worktree vẫn 4a967f5 (không
commit), mục 7.8.7 có trong changelog của worktree. Phiên báo build, 1.922 test, lint xanh (chưa chạy lại độc lập).

## 7. 2026-10-21 — PDF quyết định "Nên chọn bộ giải nào" (gộp mọi lần test)

Người dùng: "làm file PDF so sánh … ghi rõ là test với data nào ra kết quả gì rồi so sánh giữa cả 2 xem nên chọn cái nào,
ghi dễ hiểu". File: `docs/bao-cao-chon-bo-giai-de-xuat-thanh-sat-2026-10-21.pdf` (4 trang, script scratchpad
`bench/make_decision_pdf.py`). Gộp 5 bộ test, số lấy từ các mục trước (không chạy lại gì mới):

| Bộ | Nguồn số liệu | Kết quả cũ ↔ mới |
|---|---|---|
| 1. 4 ca chuẩn | changelog 2026-10-20 review excel mục 3, 7.3, 7.6, 7.7.2 | 4/4 giống hệt |
| 2. 4 file định mức | mục 6 file này (OR-Tools lần 2 ↔ HiGHS đã sửa) | 96 giống, 2 mới tốt hơn, 0 kém |
| 3. Đề xuất đã lưu (từ #24) | changelog 2026-10-20 mục 7.7.3 (so trực tiếp 43 đơn) | 154 giống, 5 mới tốt hơn, 0 kém |
| 4. "Tính phương án cắt" e2e | mục 7.7.4 (PI item 24 + 95) | 9/9 giống, 54 s → 15 s |
| 5. Màn "Tối ưu cắt sắt" | mục 7.7.4 + 7.8.7 | cả hai 175/214 (cũ ~6 s, mới ~9 s) |

Tổng 4 + 98 + 159 + 9 = 270 lần so, 0 lần bộ giải mới kém hơn. Nội dung: câu trả lời ngắn + KPI; bảng dữ liệu test;
so theo tiêu chí (ghi cả 3 điểm cũ hơn: màn Tối ưu nhanh hơn chút, RAM ít hơn, đã chạy thật lâu); các chỗ khác nhau; lỗi
đã tìm/sửa ở cả hai bên; 3 lựa chọn (giữ nguyên / Python trong ERP / HiGHS trong ERP) + khuyến nghị C với 4 bước (gói
≥ 1 GB RAM → triển khai để công tắc ở bộ cũ → chạy song song 1–2 tuần → tắt DEXUAT); giới hạn test; dữ liệu định mức
cần xác nhận; phụ lục số chi tiết.

Lưu ý: thời gian bộ 3 của DEXUAT (3.168 s) có 7 đơn lỗi kết nối và chạy Docker local — PDF ghi rõ. RAM HiGHS
0,4–0,7 GB/lượt lấy từ đo của phiên solver-ts-research (7.7.5), chưa đo độc lập trong phiên này.

## 8. 2026-10-21 — Báo cáo KẾT QUẢ TÍNH từng file (để sếp đối chiếu với số liệu cũ) + file Excel

Người dùng: "trong pdf bạn đưa chưa có kết quả tính để tôi đưa sếp đối chiếu với kết quả cũ của 4 bộ excel". Đã kiểm 4
file Excel (mọi cột): **không có số cây / kết quả cắt cũ** — chỉ có SL cần, SL đã cắt/dập/tán/uốn/hàn theo ngày, cột
"Thanh sắt" (LS/TĐ). Nên báo cáo trình kết quả tính đầy đủ và chừa cột trống "Số liệu cũ (điền tay)" để sếp tự đối chiếu
với số cây thực tế đã mua/xuất kho hoặc kết quả cách tính cũ.

Chạy lại **cấu hình A (mặc định ERP)** cho 49 nhóm (sheet × loại sắt) trên cả hai bộ giải để lấy đủ kiểu cắt (các JSON
trước chỉ lưu số tổng): OR-Tools qua `run_propose.py` (SOLVER_WORKERS=2), HiGHS qua `propose()` của worktree
solver-ts-research (bản đã sửa, chạy bằng `pnpm --dir <wt> exec ts-node --transpile-only`, không sửa file worktree).
Script scratchpad `bench/patterns_or.py`, `patterns_highs.ts`, `make_results_report.py`; dữ liệu `bodies_A.json`,
`patterns_or.json`, `patterns_highs.json`.

Kết quả: **48/49 giống hệt**; khác duy nhất I5 · V15 (399 cây cả hai, HiGHS 4.060 mm so với OR-Tools 4.177 mm). 3 nhóm
không đạt ngưỡng ở cả hai (FI4 của LSX 138, 140, 133), `best_achievable` trùng nhau.

File:
- `docs/ket-qua-tinh-de-xuat-thanh-sat-4-file-dinh-muc-2026-10-21.pdf` (13 trang): cách đọc + tham số; bảng tổng số cây
  phải mua theo LSX × loại sắt (đánh dấu * khác bộ giải cũ, (!) dữ liệu nghi sai); mỗi LSX: từng loại sắt (đoạn cần cắt,
  kết quả mới, bộ giải cũ, cột trống điền số liệu cũ) + bảng kiểu cắt (cây dài, số cây, một cây cắt ra gì, thừa mm/cây) +
  đoạn dư; trang cuối lưu ý dữ liệu.
- `docs/ket-qua-tinh-de-xuat-thanh-sat-4-file-dinh-muc-2026-10-21.xlsx`: sheet "Tổng hợp" (49 dòng, cột MỚI/CŨ + 2 cột
  vàng điền số liệu cũ, có lọc), "Kiểu cắt (mới)" 267 dòng, "Kiểu cắt (cũ)" 211 dòng, "Đầu vào" 156 dòng.

Quan sát (chưa xử lý, ghi để nhớ): bộ giải tối ưu tầng 2 (ít dư) sinh nhiều kiểu cắt chỉ 1–2 cây (vd J55 LSX 138 · V15:
27 kiểu, I5 · V15: 25 kiểu) — xưởng có thể thấy khó thực hiện; cả hai bộ giải đều vậy (OR-Tools ít kiểu hơn chút). Nếu cần
gọn thì phải thêm ràng buộc/ưu tiên ít kiểu cắt — chưa bàn với người dùng.

## 9. 2026-10-21 — Review 3 file định mức MỚI (`Data test solve\data test new\`)

Người dùng gửi 3 file đã rà soát lại: `I3 MEYING MỚI LSX 315.xlsx` (700 bộ), `I5 MEYING MỚI LSX 316.xlsx` (650 bộ),
`LSX 180 GHẾ J55 GOPLUS.xlsx` (239 bộ). Chạy lại `bench/parse_bom.py` → `parse_bom_new.out`, `bom_rows_new.json`.

**Đã sửa so với bản cũ:** I3 ô G trống của V15 TRƠN 395 → có công thức; "300 b" → chỉ "700 bộ"; mã Kỷ I3.2.3.x, nhãn
I3.1.2; I5 mã dòng 62 → I5.2.3.7; J55 hết trùng JSE 55.1.4.3; 100 % dòng dùng E×F×SỐ LƯỢNG (không còn kiểu I41/I42 bỏ
cột Số ghế); không còn kích thước thập phân. Bộ kiểm không báo lỗi số liệu; chỉ loại pát/la bạ/dòng %.

**Còn phải sửa:** (1) I5: ô B4 số LSX trống (tên file ghi 316). (2) J55: tên file "LSX 180" nhưng sheet + ô B8 = 316,
trùng LSX với I5 → phải chốt 180 hay 316.

**Thay đổi định mức (nên xác nhận chủ ý):** mê ngồi I3/I5 bỏ V15 GẤP 1.774,4 / 2.625,2 mm, thay bằng V15 445×2 + 415×2
(I5.2.4: 445×2 + 840×2); chốt V15 40 mm ở tay E 2 → 1 (I3, I5); I3 tay V10 (U) 440 → 437; I5 hông bàn V10 110 → 120.

Chưa chạy solver trên 3 file này (chờ người dùng chốt 2 điểm LSX ở trên).

**Bổ sung 2026-10-21 (người dùng):** "không cần quan tâm đến chốt và PAT" → quy tắc trích: bỏ dòng CHỐT (`V15 (CHỐT)`
40 mm) và PAT/la bạ. Hệ quả: các báo cáo mục 4–8 đã tính chốt vào V15 của I3 LSX 311 (8.000/36.000 đoạn) và I5 LSX 310
(1.680/6.160 đoạn) → số cây V15 hai LSX đó hơi cao so với quy tắc mới; J55, I41/42 không ảnh hưởng. ~~Chưa xác nhận V18 40 mm của J55~~ → **sếp xác nhận 2026-10-21: KHÔNG phải chốt**, là chi tiết
thật dài 4 cm ở tay phải/tay trái (JSE 55.1.2.4/55.1.3.4) — GIỮ trong bài toán cắt. Chỉ bỏ dòng có chữ CHỐT trong tên. Đã lưu memory `chot-va-pat-khong-dua-vao-bai-toan-cat`.

## 10. 2026-10-22 — Đối chiếu 3 công cụ trên 3 file mới: MC Laser (cat_sat_iea, xưởng dùng thật) · ERP OR-Tools · ERP HiGHS

Người dùng: "chia ra nhiều phiên để test cho nhanh … đồng thời chạy src cat_sat_iea để thực hiện test đối chiếu với MC laser
(src cat_sat_iea mới là src gốc thực sự xưởng đang dùng)". Đã lưu memory `mc-laser-xuong-dung-la-cat-sat-iea`.

**Cách làm (không commit, không sửa D:\cat_sat_iea):**
- Đầu vào chung `test/solver-real-data-new/input-groups.json` (script scratchpad `bench/build_new_groups.py`): 19 nhóm
  (I3 LSX 315 × 6, I5 LSX 316 × 7, J55 LSX 180 × 6), bỏ 13 dòng (6 CHỐT, PAT/la bạ, dòng %), giữ V18 40 mm.
- MC Laser: 3 phiên song song (mclaser-i3/i5/j55), mỗi phiên chép nguyên `optimization_logic.py` + `utils/cache_utils.py`
  của D:\cat_sat_iea @ `10836a6` vào `test/solver-real-data-new/mc-laser-<f>/app-copy/`, gọi như `views.run_optimization`
  với mặc định form (6000, tề 10, lưỡi 1 cố định, ≤1 %, ±10, 100.000 kiểu, 30 đoạn/cỡ/cây, 120 s mỗi bước GĐ2). Phải cài
  pandas 2.2.3 riêng (pandas 3 bỏ `Styler.applymap` làm app chết sau khi giải). Kết quả `mc-laser-<f>/result.json|md`.
- ERP: phiên điều phối chạy OR-Tools (`run_propose.py`, SOLVER_WORKERS=2) và HiGHS (`propose()` worktree solver-ts-research,
  bản đã sửa nhãn) song song, 2 cấu hình: A mặc định ERP (20 s, dò 5000–6000), B chỉ 6000 / 120 s. Kết quả
  `result-ortools.json`, `result-highs*.json`; gộp `merged-3tools.json` (script `bench/merge_3tools.py`).

**Kết quả:**
- **MC Laser chỉ ra kết quả 10/19 loại sắt.** Không tìm thấy lời giải: FI4, FI6 ở cả 3 file (chặn 30 đoạn/cỡ/cây — đoạn 60 mm
  cần ≥ 98/cây; 150 mm không có số đoạn lọt ngưỡng), I3 H10-20 và V10 (mọi kiểu đạt 1 % có số đoạn/cây cố định, không phối
  đủ trong ±10 — ERP chỉ-6000 cũng không đạt), I5 V15 (trần 100.000 kiểu cắt không chứa cỡ 445 và 405 mm, trong 1,28 triệu
  kiểu hợp lệ). I3 V15 chạm 120 s, bấm lại ra thiếu 75 thay vì 77.
- **Ở 10 loại có kết quả MC Laser luôn cắt THIẾU** (tổng 277 đoạn, tới −10/cỡ) vì mục tiêu 1 là min mm hao hụt và cho
  phép −10. Cộng số cây bù thiếu (Σ(đoạn+1)×thiếu / 5990, làm tròn lên) thì **bằng ERP 9/10**; I5 FI10 ERP ít hơn 1 cây.
- **ERP ra kết quả 19/19** (OR-Tools, mặc định A; loại không đạt ở cây 6000 thì dò cây đặt riêng, vd I3 H10-20 637 × 5.080).
- **HiGHS = OR-Tools 37/38 lần tính.** Lệch duy nhất **I5 V15 cấu hình A**: HiGHS liệt kê đủ 39.259 kiểu (0,1 s) nhưng
  tầng 1 byN (N=1794) cần ~62 s mới có nghiệm → với 20 s: hết giờ → retry ×3/×6 → auto_scan từng chiều dài → dừng tay sau
  ~25 phút (`result-highs-i5v15-A.json` ghi tay). OR-Tools giải trong 62 s. Thử nghiệm (`bench/highs_debug_i5v15.ts`):
  120 s byN → 1794 cây/0,1667 %/dư 9 trong 78 s (= OR-Tools B); bỏ cap 5.000 (39.259 kiểu) → 162 s không nghiệm, 578 MB;
  direct 120 s → 1794 cây dư 12, 246 s. → **Phải sửa trước khi dùng HiGHS**: nâng time limit cho loại nhiều cỡ/số lượng
  lớn, hoặc HiGHS hết giờ chưa có nghiệm thì chuyển OR-Tools cho riêng loại đó. CHƯA LÀM.

**File:** `docs/doi-chieu-mc-laser-voi-erp-3-file-moi-2026-10-22.pdf` (5 trang: KPI 10/19 · 19/19 · 277 · 37/38, kết luận,
bảng 19 loại sắt 3 cột MC Laser / ERP chỉ-6000 / ERP mặc định; vì sao MC Laser khác; vì sao HiGHS không kịp + việc phải sửa;
chi tiết cắt vs cần; cách đo + dữ liệu cần chỉnh + dòng đã bỏ) và `.xlsx` (Tổng hợp 19 dòng, MC Laser cắt vs cần, kiểu
cắt MC Laser / ERP 6000 HiGHS / ERP 6000 OR / ERP mặc định OR, Đầu vào, Dòng đã bỏ). Script `bench/make_3tools_report.py`.

Lưu ý: kết quả này làm khuyến nghị "chọn HiGHS" (mục 7) có thêm điều kiện — HiGHS chưa đủ tin cậy với giới hạn 20 s ở loại
sắt rất lớn (I5 V15 27.300 đoạn); cần sửa như trên rồi chạy lại.

**Cập nhật 2026-10-22 — đã sửa HiGHS "loại sắt lớn hết giờ"** (phiên solver-ts-research, CHƯA commit, worktree HEAD vẫn 4a967f5):
- Cách sửa (highs-solver.ts, optimize-one-material.ts): (1) `roundingStart` — điểm xuất phát tầng 1 cho byN bằng "giải LP nới
  lỏng với Σy = N → làm tròn xuống → giải MIP nhỏ cho phần dư (nhả 5 %/10 %/2 % cây để có chỗ xoay)", dùng 40 % ngân sách mỗi N;
  chạm cận thì xong luôn. Lý do greedyStart không giúp: chỉ dùng ở nhánh model gốc và không ép đúng N cây. Tắt bằng
  `SOLVER_TS_ROUNDING=0`. (2) `MAX_SCAN_TIMEOUT_STREAK = 3`: auto_scan dừng sớm khi 3 chiều dài liên tiếp hết giờ mà chưa
  chiều dài nào ra phương án, báo rõ "hãy tăng thời gian / tách cỡ" — KHÁC Python (dò hết dải).
- Kết quả 38 body 3 file mới (`test/solver-real-data-new/result-highs-after-fix.json`, `SUMMARY-highs-after-fix.md`, mình
  kiểm lại độc lập): **I5 V15 A: không ra (>25 phút) → 1794 cây / 0,1667 % / dư 9 trong 14,2 s** (OR-Tools A: dư 14, 62,5 s);
  I5 V15 B 57 s → 12,8 s; I3 V15 A/B 88 s → 5,7 s. **37/38 body không đổi phương án**; so OR-Tools: 37 trùng + 1 HiGHS tốt hơn,
  0 kém hơn. Tổng thời gian 38 body: HiGHS 42 s, OR-Tools 798 s.
- Báo cáo `docs/doi-chieu-mc-laser-voi-erp-3-file-moi-2026-10-22.pdf/.xlsx` đã dựng lại với số sau sửa (merge_3tools.py
  ưu tiên `result-highs-after-fix.json`).
- ~~CHƯA có lúc ghi: 98 nhóm cũ + 4 ca tham chiếu + build/test/lint~~ → **ĐÃ KIỂM, xem đoạn dưới.**

**Kiểm lại độc lập ở phiên điều phối (2026-10-22), bằng code HIỆN TẠI của worktree solver-ts-research** — vì
`highs-solver.ts` sửa lần cuối 08:37:06 mà lần chạy 98 nhóm của phiên đó bắt đầu ~08:32 và file 38 body ghi xong 08:38,
nên có thể chưa dùng bản cuối:
- 38 body 3 file mới chạy lại (`test/solver-real-data-new/result-highs-verify.json`): **38/38 khớp** kết quả phiên báo;
  so OR-Tools 37/38 (lệch duy nhất I5|V15|A: HiGHS dư 9 tốt hơn OR-Tools dư 14). Tổng 63 s (máy đang chạy song song việc khác).
- 98 nhóm cũ chạy lại (`rerun-highs-after-fix.ts --out-dir results-verify-final`, trong worktree): **98/98 giữ đúng phương
  án** của 21/10 (`results-after-fix/`). Tổng 350 → 267 s. 3 nhóm có vẻ chậm khi máy bận (J55 LSX 137 V18 A/B 3,4 → 7,7 s;
  LSX133 FI4 A 1,1 → 2,7 s) — đo riêng lúc máy rảnh (`bench/time_group.ts`, 3 lần mỗi nhóm): V18 3,3–3,8 s, FI4 1,2–1,6 s
  → không chậm đi thật.
- `pnpm jest` solver-ts + solver-client: **72/72 xanh**; `pnpm build` (nest) xanh; `pnpm lint:check` 0 lỗi (94 warning có sẵn).
- Không kiểm lại: `pnpm test` toàn bộ (phiên báo 1.925 test xanh), 4 ca tham chiếu (phiên báo trùng cả 4), Node 20, RAM đỉnh I5 V15.
- Tất cả vẫn CHƯA commit (worktree HEAD 4a967f5).

## 11. 2026-10-22 — Báo cáo kết quả tính chi tiết: MC Laser (cat_sat_iea) và HiGHS (ERP), bỏ OR-Tools của DEXUAT

Người dùng: "làm file so sánh như hôm qua, không cần OR tool của DEXUAT chỉ cần OR tools của catsat-iea là được". Định dạng
như báo cáo kết quả tính hôm qua (mục 8): tổng hợp + từng lệnh SX × loại sắt có kết quả, cắt vs cần, kiểu cắt của cả hai bên,
cột vàng điền số liệu cũ. "OR-Tools của catsat-iea" = MC Laser (CP-SAT trong `cat_laser_roi/optimization_logic.py`).

- Nguồn: MC Laser `test/solver-real-data-new/mc-laser-{i3,i5,j55}/result.json` (mục 10); HiGHS `result-highs-verify.json`
  (code hiện tại sau sửa 22/10, cấu hình A mặc định ERP; mình đã kiểm 38/38 khớp báo cáo phiên). Không dùng OR-Tools DEXUAT.
- File: `docs/ket-qua-tinh-mc-laser-va-highs-3-file-moi-2026-10-22.pdf` (11 trang: KPI 10/19 · 19/19 · 277 · 9/10, cách đọc,
  bảng tổng 19 loại sắt, kết luận; mỗi LSX: từng loại sắt kết quả 2 bên + cột điền tay, cắt vs cần từng cỡ, kiểu cắt MC Laser
  và HiGHS xếp theo số cây; lý do MC Laser không ra; trang cuối cách tính + dòng bỏ) và `.xlsx` (Tổng hợp có 2 cột vàng, Cắt vs
  cần, Kiểu cắt MC Laser, Kiểu cắt HiGHS, Đầu vào, Dòng đã bỏ). Script scratchpad `bench/make_mc_vs_highs.py`.
- Số: MC Laser ra 10/19, HiGHS 19/19; MC Laser thiếu tổng 277 đoạn; sau bù thiếu số cây bằng HiGHS 9/10, I5 FI10 HiGHS ít hơn
  1 cây; không loại nào MC Laser ít cây hơn sau bù.

## 12. 2026-10-22 — MC Laser (cat_sat_iea) BẬT dò chiều dài cây 5000–6000, so với HiGHS (ERP)

Người dùng: "giờ hãy thực hiện test với bật auto-scan", sau đó đồng ý chạy thêm lượt "Dò hết" cho mọi loại, rồi "làm file
tổng hợp cho tôi". Mục 11 chỉ có MC Laser với cây 6.000 cố định (form mặc định không bật dò).

- **Cách chạy** (3 phiên mclaser-i3/i5/j55, mỗi phiên chỉ ghi trong `test/solver-real-data-new/mc-laser-{i3,i5,j55}/`, mã
  `D:\cat_sat_iea` không sửa, ortools 9.12.4544 + pandas 2.2.3): gọi `find_optimal_stock_length` như màn MC Laser khi bật ô
  "Tự động tìm chiều dài cây sắt tối ưu (5000–6000mm)", bước 10 (101 chiều dài), các ô khác mặc định. Lượt 1 "Dừng sớm" = tick
  "Dừng ngay khi tìm thấy nghiệm khả thi đầu tiên"; lượt 2 "Dò hết" = không tick (mặc định form; chọn % hao hụt nhỏ nhất,
  lệch < 0,01 điểm coi như bằng → tổng |chênh| nhỏ nhất → ít cây). Trần 45 phút tường mỗi loại.
  Kết quả: `result-scan-first.json`, `result-scan-full.json`, `result-scan.md` trong từng thư mục.
- **Quyết định trong lúc chạy:** (a) I5 V15/FI4/FI6: FI4/FI6 lượt 1 đã dò đủ 101 chiều dài, không có kiểu cắt → lượt 2 chép
  lượt 1, không chạy lại. (b) V15 lớn (mỗi chiều dài 4–6 phút): lượt 2 dùng lại các chiều dài lượt 1 đã chạy (I3: 5000;
  I5: 5000–5070) rồi chạy tiếp, chọn theo đúng luật của app trên cả tập. (c) Lượt 2 của 3 phiên chạy CÙNG LÚC trên máy
  12 luồng (khoảng 4 tiến trình CP-SAT) → các bước 120 s hết giờ nhiều hơn lượt 1, thời gian bị nhiễu; đã ghi trong md.
- **Số chính** (19 loại; HiGHS = `result-highs-verify.json` cấu hình A như mục 11):
  - MC Laser ra 13/19 (cây 6.000 cố định: 10/19); thêm I3 H10-20, I3 V10, I5 V15. FI4/FI6 cả 3 file vẫn không ra (giới hạn
    30 đoạn mỗi cỡ trên 1 cây, đổi chiều dài không gỡ được). HiGHS 19/19.
  - "Dò hết", 13 loại cả hai cùng ra, mét sắt = cây × chiều dài, MC Laser cộng bù thiếu (ceil(Σ(đoạn+1)×thiếu / (L−10)) cây
    cùng chiều dài): **MC Laser 44.450,5 m · HiGHS 44.538,5 m → MC Laser ít hơn 88,0 m (0,20 %)**; MC ít hơn ở 10 loại, bằng 2,
    HiGHS ít hơn 1 (I5 V10 +2,4 m). "Dừng sớm": MC 44.543,6 m · HiGHS 44.538,5 m → gần như bằng nhau.
  - Phần ít hơn chủ yếu do **chiều dài cây**: MC "Dò hết" chọn cây đặt riêng ở 12/13 loại (5.060–5.970 mm), HiGHS (giống DEXUAT)
    dùng cây 6.000 ở 11/13 loại vì 6.000 đã đạt 1 %. Ở 2 loại cùng chiều dài (I3 V10 5.190, J55 V15 6.000) mét sắt bằng nhau.
  - Đổi lại MC Laser: thiếu tổng 381 đoạn phải cắt bù; 3 loại chạm trần 45 phút chỉ dò được một phần (I3 V15 tới 5.070, I5 V15
    tới 5.120, I5 V10 tới 5.320); nhiều chiều dài bị app coi "không có nghiệm" chỉ vì bước 2 hết 120 s (I5 V15: 5000–5020, 5040,
    5050, 5080–5110) → kết quả phụ thuộc máy bận/rảnh. Tổng thời gian "Dò hết" ~231 phút; HiGHS 31 s cho 19 loại.
- **File:** `docs/ket-qua-tinh-mc-laser-do-chieu-dai-va-highs-3-file-moi-2026-10-22.pdf` (15 trang: KPI + kết luận + đã test gì,
  bảng tổng 19 loại (cây 6.000 · dừng sớm · dò hết · HiGHS · so mét sắt), mỗi LSX từng loại: kết quả + cột vàng điền tay, ghi chú
  dò, cắt vs cần, kiểu cắt MC Laser (dò hết) và HiGHS; trang cuối cách tính + dòng bỏ) và `.xlsx` (Tổng hợp, Chiều dài đã dò —
  mọi chiều dài có nghiệm của cả 2 lượt, Cắt vs cần, Kiểu cắt MC Laser (dò), Kiểu cắt HiGHS, Đầu vào, Dòng đã bỏ). Script
  scratchpad `bench/make_mc_scan_vs_highs.py`. Đã render từng trang kiểm bố cục; mở lại xlsx bằng openpyxl được.
- **Kiểm:** mình đọc lại 6 file kết quả của 3 phiên; số trong báo cáo lấy thẳng từ đó (không chép tay). Không kiểm lại bằng
  cách tự chạy MC Laser.
- ~~CHƯA làm: test HiGHS dò cả dải 5.000–6.000 khi cây 6.000 đã đạt~~ → **ĐÃ LÀM, xem mục 13.** Giá/khả năng mua cây
  không chuẩn vẫn chưa xét. Không commit.

## 13. 2026-10-22 — HiGHS dò cả dải 5.000–6.000 kể cả khi cây 6.000 đã đạt, gộp vào báo cáo mục 12

Người dùng: "test thêm HiGHS dò cả dải 5.000–6.000 kể cả khi cây 6.000 đã đạt, so mét sắt với MC Laser Dò hết rồi bổ sung vào
báo cáo". Lý do: ở mục 12 MC Laser "Dò hết" ít hơn HiGHS mặc định 88 m nhưng là nhờ chọn cây đặt riêng, còn HiGHS mặc định
(giống DEXUAT) dùng 6.000 khi 6.000 đạt — cần so cùng điều kiện.

- **Cách chạy:** script scratchpad `bench/highs_fullscan.ts` (KHÔNG sửa mã ERP): gọi `optimizeOneMaterial` của worktree
  solver-ts-research với `stockLengths = []` + `autoScan`, `stopOnFirst=false`, 5000–6000 bước 10, 20 s/lần giải, dư ≤ 10, ngưỡng
  1 % → thử cả 101 chiều dài (gồm 6.000), chọn theo luật dò sẵn có của ERP (% hao hụt nhỏ nhất, bằng thì ít cây). Bọc
  `optimizeMaterial` để ghi kết quả TỪNG chiều dài. 5 tiến trình node song song, 13:14 → 13:58. Kết quả
  `test/solver-real-data-new/highs-fullscan/<key>.json` + `log-1..5.txt`.
- **Số** (19/19 ra):
  - 13 loại MC Laser cũng ra: MC Laser "Dò hết" 44.450,5 m (đã cộng bù thiếu) · HiGHS mặc định 44.538,5 m · **HiGHS dò cả dải
    44.452,9 m → gần như bằng MC Laser (chênh 2,4 m, 0,005 %) mà không thiếu đoạn nào.** Ở V16 (I3, I5), I5 FI10, I3 V10 HiGHS chọn
    đúng cùng chiều dài và cùng số mét với MC Laser. → phần MC Laser ít hơn HiGHS mặc định là nhờ chiều dài cây.
  - 19 loại: HiGHS mặc định 46.102,8 m → dò cả dải 46.018,1 m (bớt 84,7 m, 0,18 %); nếu chọn "ít mét sắt nhất" (tính lại từ kết quả
    từng chiều dài đã ghi, không chạy lại) thì 45.993,9 m (bớt 109,0 m). Luật "% hao hụt nhỏ nhất" không tính đoạn dư nên vài loại
    dò cả dải tốn hơn 6.000 một chút (J55 V10 481,1 vs 480,0 m; J55 V18 805,1 vs 804,0; FI vài chục cm).
  - Giá phải trả: cây không chuẩn ở 16/19 loại; chậm ở loại lớn: I5 V15 44,5 phút (17/101 chiều dài hết 20 s), I3 V15 16,3 phút
    (8 hết giờ), I5 V10 8,6 phút; còn lại < 1 phút. Mặc định cả 19 loại 31 s. Các chiều dài hết giờ có thể còn tốt hơn.
- **Báo cáo:** cập nhật `docs/ket-qua-tinh-mc-laser-do-chieu-dai-va-highs-3-file-moi-2026-10-22.pdf` (17 trang: thêm KPI "2,4 m" và
  "85 m", kết luận viết lại, cột HiGHS có 2 dòng mặc định/dò cả dải, cột so sánh 2 dòng; trang chi tiết thêm cột cắt/dư và kiểu cắt
  HiGHS dò cả dải khi khác mặc định; trang cuối thêm cách tính) và `.xlsx` (Tổng hợp thêm 5 cột HiGHS dò cả dải; "Chiều dài đã dò"
  thêm mọi chiều dài HiGHS đạt; sheet mới "Kiểu cắt HiGHS dò cả dải"). Đã render từng trang kiểm bố cục; mở lại xlsx bằng openpyxl.
- **Kiểm:** chạy thử 2 nhóm trước (J55 V15 → 6.000, I3 V10 → 5.190 khớp mặc định); số trong báo cáo lấy thẳng từ JSON.
- **CHƯA làm / gợi ý:** nếu muốn ERP tiết kiệm phần này cần (1) tuỳ chọn "dò cả dải kể cả khi 6.000 đạt", (2) cân nhắc chọn theo
  ít mét sắt thay vì % hao hụt, (3) chạy nền vì loại lớn mất hàng chục phút; giá và khả năng mua cây không chuẩn chưa xét. Chưa sửa
  mã ERP. Không commit.

## 14. 2026-10-22 — Kiểm case test MC Laser (cat_sat_iea) ↔ HiGHS khớp nhau + tổng thời gian

Người dùng hỏi "tổng thời gian, đã khớp với data test của catsat-iea chưa, khớp ở đây là về case test". Script scratchpad
`bench/verify_cases.py` so mọi nguồn với `test/solver-real-data-new/input-groups.json` (19 nhóm, 61 dòng cỡ, 127.259 đoạn).

- **Case test: KHỚP 100 %.** Cả 6 nguồn — MC Laser cây 6000 / dừng sớm / dò hết (`mc-laser-*/result*.json`: cả `sizes` lẫn số
  "cần" trong `produced`), body gửi HiGHS mặc định (`bodies-highs-ortools.json`, cấu hình A), số "demand" HiGHS mặc định trả về
  (`result-highs-verify.json`) và HiGHS dò cả dải (`highs-fullscan/`) — đủ 19 nhóm, không thiếu/thừa nhóm, không lệch cỡ hay số
  lượng nào. `D:\cat_sat_iea` không có bộ test riêng (thư mục `data/` chỉ có db, log, cache) nên case test chính là 3 file Excel.
- **Tham số:** 3 phiên MC Laser ghi params mỗi phiên một kiểu nhưng cùng giá trị: cây 6000 / dò 5000–6000 bước 10, tề 10, lưỡi 1,
  hao hụt 0,01, ±10, tổng tồn 1000, 100.000 kiểu, 30 đoạn/cỡ/cây, 120 s mỗi bước, commit 10836a6. HiGHS mặc định 1 bộ duy nhất
  (6000, tề 10, lưỡi 1, 1 %, dư 10, 5000–6000 bước 10, 20 s, auto_scan, stop_on_first).
- **LỆCH phát hiện: phiên bản ortools.** `D:\cat_sat_iea\requirements.txt` để `ortools` không ghim nhưng ghim `protobuf==5.29.3`,
  nên bản cài như xưởng ra ortools 9.12.4544 (phiên I5 đã cài thử). I3: cả 3 lượt 9.12 ✓; I5: cây 6000 chạy 9.15.6755, 2 lượt dò 9.12;
  **J55: cả 3 lượt 9.15.6755.** Ảnh hưởng: chỉ khi GĐ1 chạm trần 100.000 kiểu (I5 V15) hoặc GĐ2 chưa tối ưu thì kết quả có thể khác
  theo phiên bản; J55 GĐ1 liệt kê đủ (14–188 kiểu, không cắt cụt), GĐ2 tối ưu ở V15/H10-20/V18, riêng J55 V10 lượt dò hết có chiều dài
  chưa tối ưu. ~~Chưa chạy lại J55 bằng 9.12.~~ → **ĐÃ chạy lại (cả I5 cây 6000), kết quả không đổi — xem mục 15.**
- **Tổng thời gian** (cộng thời gian ghi trong file của 19 nhóm): MC Laser cây 6000 9,9 phút · dừng sớm 44,0 phút · dò hết 231,0 phút
  (3 loại chạm trần 45 phút nên chưa dò hết dải; lượt này 3 phiên chạy cùng lúc) · HiGHS mặc định 31 giây · HiGHS dò cả dải 71,0 phút
  cộng dồn (5 tiến trình song song: 13:14 → 13:58 = 44,5 phút đồng hồ; I5 V15 riêng 44,5 phút).
- Theo người dùng ("không quan tâm OR tools của DEXUAT nữa, chỉ so HiGHS với OR tools của catsat-iea"): bỏ câu "(giống DEXUAT)" — chỗ
  nhắc DEXUAT duy nhất còn lại trong báo cáo — rồi xuất lại PDF/XLSX (PDF không còn chữ DEXUAT). "ortools 9.12/9.15" ở trên là phiên
  bản thư viện OR-Tools mà MÃ cat_sat_iea dùng khi chạy, không liên quan DEXUAT.

## 15. 2026-10-22 — Chạy lại MC Laser bằng ortools 9.12.4544 (bản xưởng) cho J55 (3 lượt) + I5 (cây 6000); báo cáo bản cuối

Người dùng: "chạy lại MC Laser J55 (cây 6000, dừng sớm, dò hết) bằng ortools 9.12.4544 rồi cập nhật báo cáo nếu số thay đổi".
Mình thêm I5 lượt cây 6000 (cũng đã chạy 9.15) để cả 3 file × 3 lượt cùng một phiên bản.

- **Cách chạy:** phiên mclaser-j55 và mclaser-i5 dùng `pydeps912` (ortools 9.12.4544 + protobuf 5.29.3, cài --target) đặt đầu
  sys.path; bản 9.15 giữ lại `result-915.json`, `result-scan-first-915.json`, `result-scan-full-915.json` (J55), `result-915.*` (I5).
  J55 "Dò hết": V10 một tiến trình, các loại khác tiến trình thứ hai; V15 chạm trần 45 phút ở 5910 (tranh CPU với V10) → mình giao
  chạy tiếp 5910–6000 một mình rồi ghép, chọn theo đúng luật app; kế hoạch cắt lấy từ GĐ2 ở 6000 trong lần chạy tiếp.
- **Kết quả: KHÔNG ĐỔI.** J55 18/18 ô (6 loại × 3 lượt) và I5 cây 6000 7/7 loại: cùng trạng thái, chiều dài chọn, số cây, % hao hụt,
  thiếu/dư với bản 9.15 (kiểu cắt có thể khác nhưng tổng giống). I5 V15 cây 6000 vô nghiệm ở cả hai bản nhưng vắng cỡ khác nhau do GĐ1
  cắt cụt 100.000 kiểu. → Báo cáo không đổi số liệu nào; giờ toàn bộ MC Laser chạy bằng 9.12.4544.
- **Thời gian khác nhiều:** 9.12 chậm hơn ở J55 V15 (lượt dừng sớm ở 5000: 126,6 s so với 7,8 s — GĐ2 hết 120 s; "Dò hết" 53,4 phút
  so với 4,5 phút); J55 V10 dò hết 41,7 so với 24,6 phút (có tranh CPU); H10-20/V18 lại nhanh hơn (lần 9.15 chạy cùng 3 phiên).
  Tổng "Dò hết" MC Laser 19 loại nay 291,4 phút (trước 231).
- **Báo cáo** `docs/ket-qua-tinh-mc-laser-do-chieu-dai-va-highs-3-file-moi-2026-10-22.pdf` (18 trang) + `.xlsx`: thêm trang "Thời gian chạy
  và kiểm đầu vào" (bảng thời gian 19 loại × 5 cách chạy, số chiều dài đã thử, chạm trần; ô kiểm case test tính tự động trong script:
  19/19 khớp; phiên bản OR-Tools đọc từ file kết quả: 9.12.4544 cho cả 3 file × 3 lượt). Kiểm: render từng trang, mở lại xlsx.
- Không commit.

## 16. 2026-10-22 — Thêm trang "Ưu – nhược điểm và đề xuất" vào báo cáo MC Laser ↔ HiGHS

Người dùng: "đã làm thành file đối chiếu kết quả chưa, ưu nhược,...". Báo cáo mục 12–15 có số đối chiếu nhưng chưa có phần ưu/nhược riêng.
- Thêm trang 2 của `docs/ket-qua-tinh-mc-laser-do-chieu-dai-va-highs-3-file-moi-2026-10-22.pdf` (nay 20 trang): bảng 10 tiêu chí MC Laser
  (cat_sat_iea) ↔ HiGHS (ERP), ô nền xanh = bên tốt hơn — ra kết quả 13/19 ↔ 19/19; cắt đủ (thiếu 381 đoạn ↔ đủ); mét sắt 13 loại
  (44.450,5 ↔ mặc định 44.538,5 / dò cả dải 44.452,9, ngang); số cây 8.219 (gồm bù) ↔ 7.568 / 7.522; chiều dài cây; tốc độ (dò hết 291 phút,
  3 loại chưa xong ↔ mặc định 31 giây); ổn định (120 s/bước, phụ thuộc phiên bản OR-Tools ↔ chạy lại 38/38 + 98/98 khớp); giới hạn kỹ thuật;
  vận hành; điểm mạnh riêng. Kèm ô "Đề xuất": dùng HiGHS cấu hình mặc định; tuỳ chọn dò cả dải chạy nền + chọn ít mét nhất chỉ khi mua được
  cây không chuẩn giá tương đương; HiGHS còn là bản thử, cần đưa vào ERP và chạy thử lệnh thật. Excel thêm sheet "Ưu nhược" (thứ 2).
- Mọi số trong bảng tính từ cùng dữ liệu trong script `bench/make_mc_scan_vs_highs.py` (không gõ tay), trừ 38/38 + 98/98 lấy từ mục 10.
  Kiểm: render trang, mở lại xlsx. Không commit.

## 17. 2026-10-22 — Tài liệu riêng giải thích logic các bộ giải (đọc từ code thật)

Người dùng hỏi các báo cáo đã mô tả logic HiGHS và OR-Tools chưa → **chưa** (chỉ có kết quả + vài ghi chú rời rạc) → yêu cầu làm
tài liệu riêng, đọc code thật. Chỉ đọc code, không chạy bộ giải, không sửa code nào.

- **Code đã đọc** (3 agent đọc song song, mình tự đối chiếu lại các dòng then chốt):
  - MC Laser: `D:\cat_sat_iea\cat_laser_roi\optimization_logic.py` + views/forms/index.html, commit 10836a6 (file logic giống hệt bản
    trong `D:\DNA-DEXUAT`).
  - DNA-DEXUAT (ERP đang gọi): `D:\DNA-DEXUAT\cat_sat\de_xuat_logic.py` + `api\views.py`, commit f80e005, ortools 9.15.6755.
  - HiGHS: worktree `solver-ts-research-1a4370` (bản 22/10, chưa commit) `src/modules/cutting-proposals/solver-ts/`.
- **Phát hiện chính, ghi trong tài liệu:**
  - Có 3 bộ giải, hai bộ OR-Tools là hai code khác nhau. HiGHS là bản viết lại của DNA-DEXUAT (cùng bài toán: cắt đủ, dư ≤ 10/cỡ,
    ≤ 4 cỡ/cây, lọc 1 % từng cây); MC Laser là bài toán khác (cho thiếu ±10, ≤ 30 đoạn/cỡ/cây, 100.000 kiểu *tìm thấy đầu tiên*,
    không giới hạn giờ liệt kê, có cache pickle).
  - **Không bộ nào có tầng "ít cây nhất"**: tầng 1 của cả ba là min mm sắt bỏ đi (tề đầu + đầu mẩu, không tính lưỡi, đoạn dư không
    tính là bỏ đi); tầng 2 = MC Laser min Σ|lệch|, DEXUAT/HiGHS min đoạn dư. Câu "thứ tự mục tiêu: ít cây → ít hao hụt → ít dư" trong
    `bang-so-sanh-tong-ortools-highs-2026-10-21.pdf` là thứ tự để *so kết quả*, không phải mục tiêu trong code — tài liệu mới ghi rõ.
  - MC Laser cắt thiếu vì tầng 1 min sắt bỏ đi + cho thiếu → bớt cây. MC Laser và DEXUAT khoá tầng 1 bằng `==` và không đưa nghiệm
    sang tầng 2 → có thể mất nghiệm khi hết giờ; HiGHS khoá bằng `≤` + nghiệm tầng 1 làm điểm xuất phát → giữ được.
  - ERP gửi `stop_on_first: true` → cây đặt riêng là chiều dài **ngắn nhất** đạt 1 %, không phải ít hao hụt nhất; dò chỉ chạy khi
    6.000 không có phương án (kể cả sau lần chạy lại ×3/×6).
  - Phụ: cache MC Laser trả rỗng khi file cache lỗi/khác phiên bản (in "tạo lại" nhưng không tạo); DEXUAT không gửi
    `patterns_truncated` về ERP; gợi ý "nâng ngưỡng ≥ x %" lấy % trung bình nên nâng đúng x % chưa chắc ra nghiệm; `SOLVER_MODE`
    mặc định vẫn `http` (DEXUAT).
- **File:** `docs/logic-bo-giai-cat-sat-highs-va-ortools-2026-10-22.pdf` (5 trang A4, script scratchpad `make_logic_pdf.py`, ReportLab
  cùng khung các báo cáo 21/10): tóm tắt; bài toán chung + sơ đồ 1 cây + bảng từ ngữ; bước 1 liệt kê kiểu cắt (bảng 3 cột); bước 2 mô
  hình (bảng 3 cột) + vì sao MC Laser cắt thiếu; các kỹ thuật riêng của HiGHS (byN, tham lam, nới lỏng–làm tròn, giữ nghiệm, chạy lại,
  worker) + dò chiều dài; khi không có phương án; điểm cần biết; danh sách code đã đọc.
- **Kiểm:** PDF đúng 5 trang (không tràn), mở xem trong trình duyệt từng trang; quét toàn bộ ký tự với 3 font Arial — không thiếu glyph
  (đã thay ký hiệu ⌈ ⌉ hiện thành ô vuông). Sửa 1 ví dụ sai: cỡ vắng 445/405 mm là **I5** V15, không phải I3.
- **Chưa làm / treo:** chưa thêm tầng "ít cây nhất" vào bộ giải nào (chỉ ghi nhận); các lỗi phụ nêu trên chỉ ghi nhận, chưa sửa.
  Không commit.

## 17. 2026-10-23 — Sếp yêu cầu thêm MC Tự động vào HiGHS: solver đã xong, đối chiếu khớp mã gốc

Chi tiết ở changelog của worktree solver-ts-research (`docs/changelog-2026-10-20-review-excel-tool-mc-laser-vs-dexuat.md` mục 8 TRONG
worktree `.claude/worktrees/solver-ts-research-1a4370`, chưa commit). Tóm tắt: HiGHS nhận `machine` 'laser'|'tu_dong' + `bundle_factors`
(14 16 18 20) + `max_manual_cuts` (5) + `max_sizes_per_pattern` (5); 'tu_dong' giải theo bó, không cho thiếu. Người dùng chốt: 2 mode
cây chuẩn dùng lại cái ERP có; tham số bó Admin cấu hình; BE/FE làm sau. Đối chiếu 19 nhóm với module `cat_sat` gốc
(`test/solver-real-data-new/mc-tudong/`, `highs-mctd/SUMMARY.txt`): cùng điều kiện bằng 8, HiGHS tốt hơn 2, kém 0, 7 cả hai không ra ở
cây 6000, 1 chỉ HiGHS ra. 81/81 test xanh, build/lint sạch. Memory mới `mc-tu-dong-vao-highs-2026-10-23`.

## 18. 2026-10-23 — Báo cáo tổng hợp đối chiếu OR-Tools (cat_sat_iea) ↔ HiGHS cho CẢ HAI máy MC Laser + MC Tự động

Người dùng: "trước khi làm (BE/FE) hãy làm file tổng hợp đối chiếu kết quả solve giữa OR-tool của catsat-iea với Highs về MC tự động và MC laser".
- File: `docs/doi-chieu-or-tools-cat-sat-iea-va-highs-mc-laser-mc-tu-dong-2026-10-23.pdf` (12 trang: trang 1 KPI + kết luận + đã test gì; bảng 1
  MC Laser 19 loại (OR cây 6000 / OR dò hết / HiGHS mặc định / HiGHS dò cả dải / so mét sắt); bảng 2 MC Tự động 19 loại (OR cho thiếu / HiGHS cùng
  điều kiện / HiGHS ERP không thiếu / so); chi tiết MC Tự động từng LSX: cắt vs cần + kiểu cắt có cột bó/tay cả hai bên + cột vàng điền số cũ;
  trang cuối cách tính, tham số, thời gian) và `.xlsx` (MC Laser, MC Tự động, MCTĐ cắt vs cần, 3 sheet kiểu cắt, Đầu vào). Script scratchpad
  `bench/make_or_vs_highs_2may.py`; chi tiết MC Laser từng cỡ vẫn ở báo cáo 22/10.
- Số chính: MC Laser OR 13/19 ↔ HiGHS 19/19; 13 loại: OR dò hết 44.450,5 m (sau bù) · HiGHS mặc định 44.538,5 · dò cả dải 44.452,9. MC Tự động
  (cây 6000, lưỡi 2,5): OR 10/19 ↔ HiGHS 11/19, 8 cả hai không ra, I5 V15 chỉ HiGHS; cùng điều kiện 10 loại: bằng 8, HiGHS tốt hơn 2, kém 0;
  bản ERP không thiếu +0..5 cây so OR (OR thiếu 197 đoạn). Thời gian MCTĐ 19 loại: OR 7,9 phút, HiGHS 5,2 phút.
- Kiểm: render từng trang; mở lại xlsx. Không commit.
- Sửa theo góp ý người dùng (tiêu đề cũ dễ hiểu nhầm là so MC Laser với MC Tự động): đổi tiêu đề thành "Đối chiếu hai bộ giải trên cùng một
  máy", thêm câu nêu rõ 2 cặp so riêng (OR-Tools Laser ↔ HiGHS Laser; OR-Tools Tự động ↔ HiGHS Tự động), ghi "Cặp …" ở KPI, kết luận, tiêu đề
  bảng/cột, tên sheet Excel, chân trang; thêm câu kết luận "KHÔNG so hai máy với nhau" và lý do (khác lưỡi 1/2,5 mm, khác ràng buộc bó).

## 19. 2026-10-23 — Dọn test/solver-real-data-new (3.047 → 176 file thay đổi)

Người dùng thấy 3.047 local changes, yêu cầu dọn phần không liên quan. Đã xoá (có xác nhận) 2.871 file ~265 MB trong
`test/solver-real-data-new/`: các bản chép mã cat_sat_iea + ortools 9.12 cài riêng (`mc-laser-*/app-copy*`, `mc-tudong/app-copy`), log thô
và raw từng chiều dài (`raw*`, `logs*`), `__pycache__`, `*.progress.json`. GIỮ: `input-groups.json`, `bodies-highs-ortools.json`, mọi
`result*.json/md` (kể cả bản -915), script chạy, `highs-fullscan/`, `highs-mctd/`, báo cáo docs/ và changelog. Hai script báo cáo
(mục 16, 18) dựng lại từ phần giữ vẫn ra đủ PDF/XLSX. Thư mục còn 3,9 MB. Không commit.

## 20. 2026-10-23 — MC Tự động: cây nào khả thi? HiGHS dò cả dải 5.000–6.000 cho 8 loại không ra ở cây 6.000

Người dùng hỏi "MC Tự động có tối ưu chiều dài không" và "làm sao biết cây nào khả thi". Mã gốc `cat_sat`: ô chiều dài là NumberInput
nhập tự do (views đọc `int(data['length'])`, không `is_valid`), KHÔNG có dò tự động như màn MC Laser — người dùng tự đổi cây và tính lại.
HiGHS MC Tự động đi qua `optimizeOneMaterial` nên dò được như MC Laser.
- Script scratchpad `bench/highs_mctd_scan.ts` (không ưu tiên 6.000, dò hết 101 chiều dài, 20 s/chiều dài, tề 10, lưỡi 2,5, bó 14/16/18/20,
  tay ≤ 5, dư ≤ 10, không thiếu) → `test/solver-real-data-new/highs-mctd-scan/`. 8 loại chạy 23 s tổng.
- Kết quả: 7/8 loại có chiều dài cắt được theo bó — I3 FI4 9 chiều dài (chọn 5.010 × 35 cây), I3 FI6 18 (5.010 × 70), I5 FI4 13 (5.200 × 47),
  I5 FI6 9 (5.010 × 130), J55 FI6 4 (5.050 × 29), I3 H10-20 35 (5.840 × 555; ít sắt nhất 5.890 × 550), I3 V10 7 (5.210 × 350).
  **J55 FI4 (60 mm × 478) không chiều dài nào**: cần 5–6 cây mà bó nhỏ nhất 14 cây (dư quá 10) và cắt tay ≤ 5 → đơn quá nhỏ để cắt bó;
  phải cắt tay (nới cắt tay ≥ 6) hoặc cắt bằng MC Laser.
- Đề xuất cho ERP: MC Tự động dùng cùng chế độ "Bình thường" (6.000 trước, không đạt thì dò) + trả về danh sách chiều dài khả thi (cây, hao hụt,
  bó/tay) để KHSX chọn cây mua được; cảnh báo riêng ca "đơn quá nhỏ cho bó" gợi ý nới cắt tay hoặc chuyển MC Laser. Không commit.
- **Đính chính lý do (sau khi kiểm bằng `bench/why_6000.ts`):** I3 H10-20, I3 V10, J55 FI6 không ra ở cây 6.000 KHÔNG phải vì bó — cắt từng
  cây (không bó, lưỡi 2,5) cũng không ra: có kiểu cắt đạt 1 % (11 / 2 / 1 kiểu) nhưng không phối đủ các cỡ trong chênh lệch ≤ 10 đoạn
  (J55 FI6: chỉ kiểu 39 đoạn/cây → 24 cây thiếu 20, 25 cây dư 19). Đã sửa câu lý do ở bảng 2 của báo cáo 2 máy và xuất lại PDF/XLSX.
  Riêng J55 FI4 (60 mm × 478): 27 chiều dài không có kiểu cắt, 74 chiều dài có kiểu cắt nhưng cần ~6 cây — không gom được bó ≥ 14 (dư quá)
  và cắt tay chỉ ≤ 5 → đúng là "đơn quá nhỏ để cắt bó".

## 21. 2026-10-23 — Implement HiGHS + máy cắt vào ERP (BE + FE) bằng đội agent, đã review 2 vòng

Người dùng yêu cầu chia việc cho đội agent: Sonnet làm BE, Sonnet làm FE, Opus review/kiểm. Không commit, chưa chạy migration lên DB nào.
- **BE** (worktree `.claude/worktrees/solver-ts-research-1a4370`, chi tiết changelog trong worktree `docs/changelog-2026-10-20-review-excel-tool-mc-laser-vs-dexuat.md` mục 9):
  HiGHS là bộ giải duy nhất (bỏ SOLVER_MODE/SOLVER_BASE_URL/SOLVER_API_KEY, gỡ đường gọi DNA-DEXUAT); enum `SolverMachine`, SystemConfig 6 cột máy/MCTĐ
  (lưỡi 2,5, tề 0, bó [14,16,18,20], cắt tay 5, 5 cỡ), ProductionInvoice.solverMachine, CuttingProposalLine.machine/bundleSummary,
  CuttingProposalPattern.bundles; migration `20261023100000_add_solver_machine_mctd`; máy áp ở mọi đường tính (runSolverAndSave, candidates,
  suggestions, preview, verify); `cutting-defaults.solverMachine`, `cuttingPlan.machine`; PI ghi máy đã dùng; đối chiếu sắt Phôi theo máy.
  636/636 test (4 module), nest build, prisma validate, lint 0 lỗi thật.
- **FE** (`D:\DNA-ERP`, changelog `docs/changelog-2026-10-23-chon-may-cat-mc-tu-dong.md`): Admin nhóm "Máy cắt"; "Tối ưu cắt sắt" chọn máy theo đợt,
  ước tính/xem trước theo máy, ghi chú số ước tính MCTĐ chưa tính bó; kết quả/Hướng dẫn cắt (bản in, Excel)/Admin Cắt sắt/Lệnh SX hiện bó + cắt tay
  ("bó cây" ở Phôi); hướng dẫn sử dụng. tsc sạch, 209/209 vitest.
- **Review Opus:** vòng 1 FE ĐẠT + 10 điểm nên sửa; vòng 1 BE ĐẠT + 6 điểm, phát hiện 1 lỗi FE (ước tính chưa gửi máy) và changelog BE ghi test chưa có;
  tất cả đã sửa; kiểm lần cuối ĐẠT, không lỗi mới.
- **CHƯA làm:** test đầu cuối với DB (máy chưa có Postgres local); deploy (khi người dùng nói): chạy migration, bỏ 3 biến SOLVER_* khỏi .env Render.

## 22. 2026-10-23 — Test đầu cuối local: BE worktree (HiGHS) + FE + Postgres, cả hai máy

- **Môi trường (không đụng DB dev/production):** bật Docker Desktop; clone DB dev `dna_erp` sang DB mới `dna_erp_solver_test` (pg_dump | pg_restore
  trong container `dna-erp-be-postgres-1`), `prisma migrate deploy` CHỈ trên DB test (thêm `20261023100000_add_solver_machine_mctd`). BE worktree
  build rồi chạy cổng 3002 qua launch config mới `be-3002-solver-test` (`.claude/launch.json`, script scratchpad `run-be-solver-test.ps1` đổi tên DB từ
  `.env` worktree, FLOOR_ALERTS off); FE `fe-3100-qlsx` (API 3002). Log BE: "Solver HiGHS WASM trong worker thread".
- **API:** `GET /system-config/cutting-defaults` (khsx) trả `solverMachine`; `GET /system-config` (admin) có đủ 6 tham số máy (mặc định laser,
  2,5 / 0 / [14,16,18,20] / 5 / 5).
- **Giao diện "Tối ưu cắt sắt" (khsx, 2 SKU hệ thống đề xuất gộp: GHE-J55 + BAN-8-MEIYING-J55):** ô Máy cắt hiện "Theo mặc định (MC Laser)";
  chọn MC Tự động → FE gọi `cutting-batch-candidates?solverMachine=tu_dong`. Bấm Tính:
  - MC Tự động: proposal 188, `requestParams` machine=tu_dong, tề 0, lưỡi 2,5, bó [14,16,18,20], cắt tay 5; 192 cây, 0,08 %, **giải 281,8 s**;
    8/9 loại ra (SAT-VUONG-50X50 không ra); lưu `machine`, `bundleSummary` camelCase, `bundles` từng kiểu cắt (Σ hệ số × bó = số cây). Màn kết quả hiện
    "2 bó + 3 cây cắt tay = 5 lần cắt", cột "Cách cắt theo bó" ("14 cây × 2 bó", "14 cây × 1 bó + 1 cây", "2 cây cắt tay").
  - MC Laser (cùng 2 SKU, Tính lại): proposal 189, machine=laser, tề 10, lưỡi 1, không bó; **167 cây, 0,264 %, 19,7 s — trùng proposal 187 ngày 21/10**
    (đường cũ không đổi). 9/9 loại ra.
- **3 file định mức qua đường worker thật** (`SolverWorkerHost` + `dist/.../solver.worker.js`, body như service gửi với cấu hình mặc định, chế độ Bình
  thường, script scratchpad `bench/e2e_worker_3files.ts`, kết quả `test/solver-real-data-new/e2e-worker-3files.json`): MC Laser 19/19 ra, số trùng
  `result-highs-verify.json`; MC Tự động 18/19 ra (8 loại không đạt ở 6000 nay tự dò được: vd I3 FI4 35 × 5000, J55 FI4 5 × 6000 cắt tay 5).
- **VẤN ĐỀ PHÁT HIỆN (chưa sửa):**
  1. ~~**MC Tự động chậm và hết giờ ở loại lớn với time limit mặc định 20 s:**~~ → **ĐÃ SỬA, xem mục 23.** I5 V15 (27.300 đoạn) "Hết thời gian ở 3 chiều dài dò liên tiếp" (bench 60 s
     thì ra 1805 cây); I5 tu_dong cả lệnh 293 s, I3 113 s; 2 SKU J55 281,8 s (laser 19,7 s). Nguyên nhân: bài theo bó chạy 'direct' (không có byN /
     làm tròn LP / nghiệm tham lam như laser) và mỗi chiều dài dò đều giải bài bó. Hướng sửa đề xuất: lấy nghiệm laser (byN, nhanh) làm điểm xuất phát
     rồi chia bó, hoặc dựng nghiệm tham lam theo bó; nâng time limit riêng cho MCTĐ.
  2. UI nhỏ: dòng "0 bó + 5 cây cắt tay = 5 lần cắt" nên bỏ "0 bó +"; cột "Cách cắt theo bó" bị cắt mép phải ở màn 1440 px.
- Chưa test: màn Phôi "Hướng dẫn cắt"/bản in/Excel và màn duyệt của Sếp với dữ liệu thật (cần duyệt phương án + tạo lệnh SX); đã có unit test FE.
- Môi trường để lại: DB `dna_erp_solver_test`, BE 3002 + FE 3100 đang chạy, Docker đang bật. Không commit.

## 23. 2026-10-23 — Tăng tốc MC Tự động + 2 lỗi UI nhỏ (đội agent, Opus review 2 vòng)

Người dùng: "Sửa tốc độ MC Tự động: lấy nghiệm MC Laser (byN) làm điểm xuất phát rồi chia bó…; sửa luôn 2 lỗi UI nhỏ; giao đội agent làm + Opus review, không commit".
- **BE solver** (worktree, chi tiết changelog worktree mục 10, 10.6): `highs-solver.ts` `solveBundled` — với ≥ 300 pattern: giải bài KHÔNG bó trước bằng
  đường laser (byN + roundingStart, cờ `stage1Only`), dùng khúc thừa tối ưu làm cận dưới, tập P* = pattern nghiệm dùng (4–17); sắp pattern theo khúc thừa
  (HiGHS nhạy thứ tự cột); tầng 1 bó P* → P*+200 → đầy đủ (start = nghiệm thu hẹp, luôn giữ); tầng 2 chặt → rộng → đầy đủ (0,3T nếu thu hẹp đã tối ưu).
  Ngân sách sửa theo review: mọi nhánh ≤ ~2,5T; ca không ra dừng ~T.
- **Số đo** (T=20, cấu hình mặc định): I5 V15 không ra → 1801 cây ~30 s (T=10 cũng ra, 22 s); I5 cả lệnh 293 → 48 s, I3 113 → 26 s; đợt 2 SKU J55
  281,8 → 18,7 s (worker) / **16,5 s trên giao diện thật** (proposal 190, 192 cây, Σ bó hợp lệ 22/22 kiểu); ca không ra I5/I3 V15 T=5: 24–41 → 4–5 s.
  MC Laser y nguyên 19/19 dòng; MC Tự động 19/19 (trước 18/19); so cat_sat gốc vẫn bằng 8 / tốt hơn 2 / kém 0; strict không loại nào tệ hơn (I3 V15 1493→1492,
  I5 V15 1805→1801). 281 test cutting-proposals xanh, build, lint, prettier sạch. Opus tự đo lại khớp.
- **FE** (`D:\DNA-ERP`, changelog FE mục 2d): bỏ "0 bó +" ("5 cây cắt tay = 5 lần cắt"); cột "Cách cắt theo bó" xuống dòng — kiểm bằng mắt trên giao diện: không
  còn bị cắt (đo DOM: ô không tràn). 209 vitest xanh.
- **Gợi ý còn treo (không chặn):** roundingStart trả null cả khi LP với Σy=N vô nghiệm → bài không-bó bỏ cuộc thay vì xét N kế (mất lợi thu hẹp, nhãn vẫn đúng);
  bài không-bó nhỏ (N<1000) còn trần 2T. Chưa test retry ×3/×6 đầy đủ qua giao diện. Không commit.


## 24. 2026-10-24 — Kiểm UI/UX các màn máy cắt (Opus senior FE) → Sonnet sửa → Opus kiểm lại (local, CHƯA commit)

Người dùng: "Lập đội kiểm UI/UX: Opus senior FE kiểm bằng trình duyệt mọi màn liên quan máy cắt ở desktop/tablet/mobile/chế độ tối trên môi
trường test (tạo lệnh SX đã duyệt trong DB test nếu cần), Sonnet sửa, Opus kiểm lại; không commit."

- **Vòng 1 (Opus, trình duyệt, FE 3100 + BE 3002 + DB `dna_erp_solver_test`):** 18 lỗi UX-1…UX-18, UX-1 chặn trên mobile (dòng "Cài đặt
  đã dùng" bị ép 19 px). Dữ liệu test tạo thêm: phương án 191, 192 (APPROVED), PI-2026-041 (id 46).
- **Sonnet FE** sửa UX-1…5, 8…18 — chi tiết changelog FE `D:\DNA-ERP\docs\changelog-2026-10-23-chon-may-cat-mc-tu-dong.md` mục 2e.
- **Sonnet BE** sửa UX-6, UX-7 — chi tiết changelog worktree `docs/changelog-2026-10-20-review-excel-tool-mc-laser-vs-dexuat.md` mục 11:
  - UX-6: bằng chứng đặc cách "≥0,55 %" là cận dưới theo 1 cây lý tưởng (không sai đơn vị); PI tạo từ phương án đã tính nay lấy % THẬT của
    dòng phương án (`getProposalLineWaste`).
  - UX-7 chữ: lý do chặn khi vô nghiệm viết theo chế độ; thay "Bật 'Dò chiều dài đặt riêng'" bằng "Bỏ tick “Giữ đúng chiều dài đã định”".
  - UX-7 solver — **lỗi thật, có từ bản gốc, cả hai máy**: ngưỡng hao hụt cao (≥ 2 % khi tề 0) làm bộ liệt kê kiểu cắt chạm trần 100.000
    theo thứ tự DFS → tập kiểu thiếu, báo "Không chiều dài nào cắt được". Sửa: khi bị cắt cụt thì liệt kê thêm ở thang ngưỡng giảm dần
    (`ENUM_RATIO_LADDER`) rồi gộp. SAT-HOP-10X20 (phương án 191): không ra → 41 cây × 6000, 0,00 % (MC Tự động) / 0,17 % (laser).
    e2e 3 file × 2 máy chạy lại: 19/19 cả hai máy, số y nguyên.
- **Vòng 2 (Opus kiểm lại):** 13 đạt; đạt một phần UX-6 (câu "ước tính hao ≥33.75%" dù đã là số thật), UX-9 (nút cam tương phản 3,79:1 < 4,5),
  UX-10 (bảng mobile vẫn cuộn ngang — chấp nhận); chỉ kiểm qua code UX-7 chữ (không có dòng vô nghiệm để hiện), UX-16 (Phôi bị chặn IP, chưa
  có PI MC Tự động đã xuất sắt). Dữ liệu test thêm: phương án 193, PI-2026-042 (id 47, chờ Sếp duyệt).
- **Tôi sửa nốt 4 chỗ sót Opus báo:**
  1. Mã sắt trên nút mở chi tiết bị căn giữa khi xuống dòng ở mobile → `textAlign: 'left'` (`CuttingSolvePanel.tsx`).
  2. Cảnh báo BE "Có loại sắt vượt ngưỡng hao hụt - vẫn tạo được lệnh…" → "Có loại sắt hao hụt cao hơn mức mặc định - …" (khớp nhãn dòng).
  3. Bằng chứng đặc cách: BE lưu thêm `fromProposal` (true = số thật của phương án); FE `LenhSXPage` ghi "hao hụt 33,75% theo phương án đã
     tính" thay vì "ước tính hao ≥33.75%"; bản ghi cũ (thiếu trường) giữ câu ước tính; số dùng dấu phẩy. PI-2026-042 trong DB TEST được bổ
     sung `fromProposal: true` (đúng như code mới sẽ lưu) để kiểm; API trả đúng trường.
  4. Admin "⚠ Cao hơn mức mặc định (≤1%)" → "(mặc định ≤1%)" để khỏi đọc nhầm là dòng này ≤1 %.
- **Kiểm tra:** BE jest production-invoices + cutting-proposals.service 6 suite / 356 test xanh, prettier sạch, `pnpm build` (nest build)
  xong, BE 3002 đã khởi động lại. FE `tsc --noEmit` sạch, eslint file sửa 0 lỗi. Câu mới trên màn Sếp sau đó Opus đã thấy tận mắt ở tablet (mục 25.3).
- **Quyết định người dùng (2026-10-24):** chế độ "Chấp nhận hao hụt cao hơn (đơn gấp)" **bắt buộc mua theo cây mặc định đã config (6000)**
  và chấp nhận hao hụt cao hơn — giữ hành vi hiện tại (SAT-VUONG-20X20 chốt 6000 13,46 % dù 4330 chỉ 0,17 %), không thêm dò so sánh.
- **Còn treo:** ~~UX-9~~ đã sửa sau theo người dùng — chỉ nút "In (… vật tư)" dùng nền cam đậm `--bg-bf360c` (5,6:1), màu cam chung toàn app giữ nguyên (changelog FE mục 2f); ~~Phôi
  "Hướng dẫn cắt" MC Tự động + tải Excel + tablet Sếp/Phôi/Admin chưa kiểm trực quan~~ đã kiểm ở mục 25.3; PI-2026-041 cũ vẫn giữ bằng chứng 0,55. Không commit.

## 25. 2026-10-24 — Đơn gấp: chỉ cây đã định (bỏ ô tick chiều dài) + vì sao vẫn có thể vô nghiệm + Opus kiểm Phôi MC Tự động/Excel/tablet (local, CHƯA commit)

### 25.1 Vì sao "Chấp nhận hao hụt cao hơn" vẫn có thể không cắt được ở cây 6m

Người dùng hỏi: "tại sao đơn gấp vẫn không cắt được với cây 6m trong khi đã chấp nhận hao hụt vượt ngưỡng".
- **Đính chính:** FE đã KHÔNG còn ô nhập % từ 2026-09-30 — đơn gấp luôn gửi `solverMaxWastePctOverride = 100`
  (`NO_CEILING_PCT`, không trần). Trong chat tôi đã nói nhầm "KHSX nhập 15 %"; bảng thử nhiều mức dưới đây chỉ là chạy bộ giải bên
  ngoài để minh hoạ, không phải cách ERP chạy. Ngưỡng solver là **% mỗi cây** (mọi cây ≤ X %), không phải trung bình đợt; nới ngưỡng
  không bao giờ làm kết quả tệ hơn, nên chạy 100 % = phương án tổng hao hụt nhỏ nhất trên cây đó (đúng ý "dò rồi lấy cái bé nhất").
- **Đo thật** (`scratchpad/bench/why_urgent_fail.ts`, cây 6000, dư ≤ 10, Laser tề 10/lưỡi 1, Tự động tề 0/lưỡi 2,5 bó 14/16/18/20 tay ≤ 5):

  | Loại | MC Laser | MC Tự động |
  |---|---|---|
  | SAT-VUONG-50X50 660×48 (PI-2026-041) | 6 cây 0,85 % ở mọi mức | không ra 1–50 %; 60 %/100 %: 14 cây 55,83 % (1 bó) |
  | SAT-VUONG-50X50 660×80 (PI-2026-042) | 9 cây 0,85 % | không ra ≤ 30 %; 40 %+: 14 cây 33,75 % |
  | SAT-VUONG-20X20 840/460/405 × 12/60/60 | 11 cây 0,31 % (từ 5 %) | không ra ≤ 10 %; 15 %+: 14 cây 13,46 % |

  Đã ra thì mọi mức cho CÙNG một số. Nguyên nhân hao cao/không ra ở MC Tự động: bó ≥ 14 cây, **mọi cây trong bó cùng một kiểu**, cắt tay
  ≤ 5 cây, không thiếu, dư ≤ 10 — 48 đoạn cần 6 cây, 5 cây tay chỉ ra 45 nên buộc 1 bó 14 cây × 4 đoạn (56, dư 8) = 55,83 %/cây.
- **Ở 100 % chỉ còn vô nghiệm khi:** đoạn dài hơn cây − tề; MC Tự động không ghép được bó (vd 8 đoạn 3500 mm: 5 cây tay thiếu, 1 bó 14 cây
  ra ≥ 14 > 8 + 10); hết giờ giải. (Lỗi liệt kê thiếu kiểu cắt ở ngưỡng cao đã sửa ở mục 24.)
- **Lưu ý cho người dùng (chưa làm):** số lượng nhỏ trên MC Tự động ở đơn gấp mua 14 cây thay vì 6 (dư 8 cây); nếu Admin cho cắt tay tối
  đa 6 cây thì loại đó chỉ cần 6 cây 0,85 %. Người dùng (2026-10-24): **để sau, giữ cắt tay tối đa 5 cây như hiện tại**. Câu so với MC Laser / mức trần cảnh báo: chưa làm.

### 25.2 Người dùng chốt: đơn gấp chỉ cắt trên cây đã định, bỏ ô tick

"mode đó là bắt buộc phải mua theo cây mặc định được config là 6000m cho đơn gấp và chấp nhận hao hụt cao hơn" + "FE xóa luôn ô tick
của đơn gấp là mở rộng chiều dài vì trùng chức năng với mode thứ 1".
- **FE** (`GomDotCatPage.tsx`): bỏ ô tick "Giữ đúng chiều dài đã định…" và state `onlyStandardLength`; đơn gấp LUÔN gửi
  `solverAllowCustomLength: false` (+ 100 % như cũ). Mô tả chế độ + dòng trong khối đơn gấp: "Chỉ cắt trên đúng chiều dài cây đã định
  (không dò cây khác), không đặt trần hao hụt — hệ thống tự tìm phương án hao hụt nhỏ nhất trên cây đó". "Đã định" = cây chuẩn hoặc
  chiều dài KHSX đặt ở ô "Chiều dài cây sắt". Guide `productionPlan.ts` cập nhật.
- **BE** (worktree): `noPlanReason` ở đơn gấp không còn khuyên "bỏ tick … dò chiều dài" — thay bằng "xem lý do ở từng loại sắt: đoạn dài hơn
  cây thì sửa định mức; MC Tự động không ghép được bó thì chọn MC Laser cho đợt này hoặc gộp thêm SKU; hết giờ thì tính lại".
  `optimize-one-material.ts` `noSolution`: nêu đúng nguyên nhân — "Cây 6000mm không cắt được loại này — có đoạn …mm dài hơn phần dùng được
  của cây (…mm)" / "— MC Tự động phải cắt theo bó (14/16/18/20 cây/bó, mọi cây trong bó cùng một kiểu cắt; cắt tay ≤ 5 cây)… Chọn MC
  Laser cho đợt này…" / "— ràng buộc tồn kho quá chặt…". BE vẫn nhận `solverAllowCustomLength: true` từ client cũ (không ép ở BE).
- **Kiểm tra:** jest cutting-proposals + production-invoices 16 suite / 503 test xanh (thêm test: đoạn dài hơn cây, MC Tự động, đã dò;
  sửa test propose loại B), prettier sạch, `pnpm build` xong, BE 3002 đã chạy lại. FE tsc sạch, eslint 0 lỗi, vitest 212 qua.
  Trình duyệt (KHSX): khối đơn gấp không còn checkbox; bấm Tính 2 SKU J55 → **phương án 194** lưu `solverAllowCustomLength: false`,
  `solverMaxWastePctOverride: 100`; 9/9 loại `fixed` 6000 (laser), SAT-PHI-6 20,05 %, còn lại ≤ 0,87 %.

### 25.3 Opus kiểm Phôi "Hướng dẫn cắt" MC Tự động, Excel, tablet — và sửa

- **Đạt:** PI-2026-042 (MC Tự động) hiện ở Hướng dẫn cắt (cần ≥ 1 phiếu xuất sắt); dòng "Máy cắt: MC Tự động · x bó cây + y cây cắt tay =
  z lần cắt"; cột bó khớp `rawResponse` phương án 193 cả 9 loại; mobile cột bó sau STT; bản in 9 mục. Excel
  `Huong-dan-cat-PI-2026-042.xlsx` (9 sheet) và `…-SAT-TRON-FI21.xlsx`: dòng máy cắt ô A3, cột "Cách cắt theo bó cây", số là số thật, 0 ô lỗi.
  Tablet: Sếp/Admin/Cấu hình "Máy cắt" không tràn. Tài khoản `phoi` bị chặn IP (đúng thiết kế) → kiểm bằng vai boss (cùng component).
- **Lỗi Opus báo, đã sửa (FE):**
  1. Cột "Cách cắt theo bó cây" khuất ở tablet và cả desktop với loại nhiều cỡ (SAT-HOP-10X20 bảng 1331 px / khung 1167) →
     `HuongDanCatPage` luôn đặt cột bó sau STT trên màn hình (bản in/Excel vẫn để cuối), tiêu đề cỡ đoạn xuống dòng (`minWidth 72`).
     Đo lại tablet 768: 9/9 bảng cột bó trong khung; SAT-HOP-10X20 864/713 (trước 1331), các loại khác vừa khung.
  2. Nút viền "In" từng vật tư 3,79:1 → `--fg-c2410c` (đo 5,18:1; chế độ tối token tự sáng).
  3. Số thập phân trên màn: HH/cây Phôi và "phần thừa …mm/cây" Admin dùng `vi-VN` ("7,5"); Excel giữ số thật.
  4. Nhãn Admin "(mặc định ≤1%)" lặp chữ → "⚠ Cao hơn mức mặc định 1%".
- **Chưa làm (gợi ý của Opus):** vùng chạm 40 px mới áp < 768 px — trên tablet "Ẩn chi tiết" 24 px, nút "In" 28–30 px, "Đóng" Admin 26 px
  (nên dùng `(pointer: coarse)`, đổi kiểu chung nên chưa làm); chế độ tối "— duyệt lệnh này…" 3,44:1; `--text3` 2,83:1 là vấn đề chung app.
- **Dữ liệu test (DB `dna_erp_solver_test`, qua giao diện):** PI-2026-042 boss đã duyệt; GHE-J55 của PI đó đã "Bắt đầu"; khopsh xuất 1 cây
  SAT-HOP-10X20 6000 (tồn/giữ chỗ −1); phương án 194 (đơn gấp, DRAFT). Không đụng DB `dna_erp`. Không commit.

## 26. 2026-10-24 — KHSX xem thông số máy cắt (chỉ xem, đóng sẵn) ở "Tối ưu cắt sắt" (local, CHƯA commit)

Người dùng: "để sau, giữ cắt tay tối đa 5 cây như hiện tại" rồi "có thể để KHSX xem thông số hiện tại không, mà làm ẩn ở đâu đó cho UI khỏi bị
tràn, KHSX cần xem thông số thì mới hiển thị ra, nếu cần config lại thì liên hệ admin".
- **BE** (worktree): `GET /system-config/cutting-defaults` (quyền CUTTING_PROPOSAL:VIEW — KHSX có sẵn; KHÔNG mở GET /system-config)
  trả thêm `solverStockLengths`, `solverMaxSurplus`, `solverTrimStartMm`, `solverBladeWidthMm`, `solverMctdTrimStartMm`,
  `solverMctdBladeWidthMm`, `solverBundleFactors`, `solverMaxManualCuts`, `solverMaxSizesPerPattern` (cùng tên cột SystemConfig, Decimal →
  number) — helper `cuttingParams()` dùng chung cho GET và PUT max-waste. Không thêm đường sửa nào. Test mới ở `system-config.service.spec`.
- **FE** (`GomDotCatPage`, khối "Máy cắt"): nút "Xem thông số máy cắt" (đóng sẵn, `aria-expanded`, cao 40 px trên mobile) → bảng thông số của
  ĐÚNG máy sẽ dùng cho đợt (máy chọn riêng, không thì máy mặc định — tiêu đề ghi "(máy mặc định)"), đổi máy thì bảng đổi theo:
  - MC Laser: lưỡi cắt, tề đầu; MC Tự động: lưỡi cắt, tề đầu, số cây mỗi bó, cắt tay tối đa, số cỡ đoạn tối đa mỗi kiểu cắt;
  - chung: cây chuẩn, dư tối đa mỗi cỡ đoạn; cuối khối: "Chỉ xem. Cần đổi thông số thì liên hệ Admin (Cấu hình hệ thống)."
  BE cũ chưa trả trường thì không hiện nút. Guide `productionPlan.ts` thêm 1 câu.
- **Kiểm tra:** BE jest system-config 2 suite / 33 test xanh, tsc sạch, prettier sạch, `pnpm build` xong, BE 3002 đã chạy lại. FE tsc sạch,
  eslint 0 lỗi, vitest 212 qua. Trình duyệt (KHSX): mặc định → "Thông số MC Laser (máy mặc định)…: Lưỡi cắt 1 mm · Tề đầu 10 mm · Cây chuẩn
  6.000 mm · Dư tối đa 10 đoạn"; chọn MC Tự động → "Lưỡi cắt 2,5 mm · Tề đầu 0 mm · Số cây mỗi bó 14 / 16 / 18 / 20 cây · Cắt tay tối đa 5 cây
  mỗi loại sắt · Số cỡ đoạn tối đa 5 · …". Mobile 375 + chế độ tối: không tràn (trang 375 px), lưới 2 cột, nút 40 px, tương phản nhãn 7,2:1 /
  số 12,7:1.
- Chưa làm: không có. Cắt tay tối đa giữ 5 (quyết định người dùng).

## 27. 2026-10-24 — Gợi ý "gộp với đơn nào" ở Tối ưu cắt sắt gọn lại (chỉ FE, local, CHƯA commit) — đã thay bằng mục 29

Người dùng chỉ ảnh cột "Loại sắt · hao hụt khi cắt riêng" (danh sách "gộp được với: GHE-J55, GHE-J55, …" lặp tên, dài ~15 dòng/SKU, không
bấm được) rồi duyệt: "gom một dòng gọn mỗi SKU, đếm đơn trùng tên, nút chọn đơn gần hạn nhất, danh sách đơn đóng sẵn có mã PO và hạn giao, chip
dùng dấu phẩy. Kiểm trên trình duyệt."
- Đã làm ở FE (`D:\DNA-ERP`): util mới `src/utils/mergeHints.ts` + test; `GomDotCatPage` dòng gọn "↳ SAT-… gộp được với N đơn khác: GHE-J55 ×9 ·
  …", nút "Chọn đơn gần hạn nhất" (đơn có hạn giao gần với đơn này nhất, bấm lại thêm đơn kế), "Xem N đơn" (đóng sẵn, có mã PO + hạn, tick từng
  đơn); chip % dấu phẩy. Không đổi BE. Chi tiết: changelog FE mục 2i.
- Kiểm tra: FE tsc sạch, eslint 0 lỗi, vitest 217 test (+5). Trình duyệt desktop + mobile 375: số đơn khớp BE (20/17), nút chọn/tick chạy đúng,
  không tick nhầm dòng, nút 40 px trên mobile.
- Hạn chế: DB test không có đơn ứng viên nào có hạn giao → thứ tự "gần hạn nhất" mới kiểm bằng unit test, chưa thấy trên dữ liệu thật.

## 28. 2026-10-24 — Kiểm độ chính xác chip "hao hụt khi cắt riêng" (Tối ưu cắt sắt) — đề xuất đã chỉnh và ĐÃ LÀM ở mục 29

Người dùng (ảnh bảng): "thấy vẫn khó chịu, có cách nào tối ưu nhất có thể, rồi nghiên cứu xem con số thể hiện hao hụt khi cắt đó có chuẩn không".
- **Cách chip đang tính** (`getBatchCandidates` + `verifyExactStandaloneWaste`): mỗi (đơn, loại sắt) ≤ 5 cỡ đoạn thì gọi bộ giải ngưỡng
  1 %/cây, CHỈ cây 6000 (`auto_scan=false`), 5 s, ngân sách cả trang 12 s. Ra phương án → chip xanh số thật; vô nghiệm có `best_achievable`
  → chip đỏ ">1%"; còn lại (> 5 cỡ, hết giờ, hết ngân sách, vô nghiệm không có best) → ước tính best-fill "≥x%" (cận dưới 1 cây lý tưởng).
- **Đo thật** (`scratchpad/bench/chip_check.ts`, `chip_compare.py`; nhu cầu lấy từ DB test bằng `chip_demand.sql`; chip từ API cả 2 máy):
  388 chip / 78 bài giải riêng; mỗi bài giải 4 kiểu: như BE (5 s), như BE 30 s, lượt tính thật chế độ Bình thường (dò 5000–6000), cây 6000 không trần.
  | Loại chip | MC Laser | MC Tự động | Đánh giá |
  |---|---|---|---|
  | Xanh, không "≥" (đã xác minh) | 18 bài: = lượt tính thật 18/18 | 9 bài: = 9/9 | **Chuẩn** |
  | Đỏ ">1%" | 16 bài | 13 bài | Nghĩa là "ở cây 6000 không có cách cắt mà MỌI cây ≤ 1 %", KHÔNG phải hao hụt > 1 % |
  | "≥x%" ước tính | 5 bài | 17 bài | Là cận dưới (0 lần vượt số thật) nhưng lệch xa: Laser lệch TB 3,98 điểm % (max 19,9), Tự động TB 26,3 (max 85,6) |
- **Sai lệch đáng kể:**
  1. Ảnh của người dùng: GHE-J55 ×20 — SAT-VUONG-20X20 và SAT-VUONG-12X12 đỏ ">1%" nhưng ở cây 6000 tổng hao hụt chỉ 0,88 % / 0,87 %, và lượt
     tính thật (Bình thường) sẽ đặt cây 5000 (0,59 %) / 5100 (0,24 %) — tức KHÔNG phải vấn đề, chip đỏ làm KHSX tưởng phải gộp.
  2. SAT-PHI-6 (30 mm ×120 + 60 mm ×240) GHE-J55 ×20 hiện XANH "≥0,17%" (chỉ là tề đầu 10/6000) vì xác minh 5 s không kịp (7,7 s) → rơi về ước
     tính; thật ra không cắt được ở ngưỡng 1 % ở mọi chiều dài 5000–6000 (tốt nhất 19,67 % ở 6000) → đợt sẽ "Cần xử lý".
  3. MC Tự động: ước tính bỏ qua bó → "≥0%" xanh trong khi thật 57 % (GHE-J55 ×1 SAT-VUONG-12X12), 61 % (BAN-J55 ×7 SAT-HOP-25X50).
- **Thời gian** (39 bài/máy): kiểu như BE tổng 46 s (Laser) / 94 s (Tự động); kiểu lượt tính thật 38 s / 99 s; đa số < 1 s, chỉ 2–5 bài > 5 s.
- **Đề xuất (chờ người dùng duyệt):** chip theo đúng lượt tính thật (Bình thường: cây chuẩn trước, không đạt thì dò) — "6m 0,28%" / "cây 5m10
  0,24%" / "không cắt được, tốt nhất 19,67% ở 6m"; xác minh không kịp → xám "chưa kiểm" (không xanh); MC Tự động chưa xác minh → xám; bảng chỉ hiện
  chip có vấn đề, loại đạt gom "n loại đạt"; gợi ý gộp chuyển lên 1 khối trên bảng (mỗi loại sắt 1 dòng) thay vì lặp ở từng dòng.
- **Người dùng làm rõ (2026-10-24):** "con số đó là đối với cây chuẩn 6m để cảnh báo" → RÚT đề xuất "chip theo lượt tính thật (có dò chiều dài)".
  Xét lại theo đúng ý cảnh báo ở cây 6m: chip xanh đã xác minh ĐÚNG; đỏ ">1%" ĐÚNG theo thiết kế (6m không cắt được mà mọi cây ≤ 1 %);
  lỗi thật = chip CHƯA xác minh vẫn hiện XANH (SAT-PHI-6 GHE-J55 ×20 "≥0,17%" trong khi 6m tốt nhất 19,67 %; MC Tự động "≥0%" trong khi 6m 57–61 %)
  → bỏ sót cảnh báo. Đề xuất mới: chip chưa xác minh hiện xám "chưa kiểm", nới thời gian xác minh cho ca chậm (kiểm bù không chặn trang),
  tiêu đề cột ghi "ở cây 6m"; bố cục như trên. → Người dùng duyệt, đã làm ở mục 29.

## 29. 2026-10-24 — Chip cây 6m: chưa kiểm = xám + kiểm bù nền; bảng chỉ hiện cảnh báo; khối gợi ý gộp; "Chọn lại đề xuất" (local, CHƯA commit) — nút "Chọn đơn gần hạn nhất" đã thay bằng "Chọn nhóm này" ở mục 30

Người dùng duyệt (sau mục 28): "giữ chip ở cây 6m, chip chưa kiểm hiện xám "chưa kiểm", kiểm bù ca chậm không chặn trang, tiêu đề cột ghi
"ở cây 6m", mỗi dòng SKU chỉ hiện loại có cảnh báo, gợi ý gộp lên khối trên bảng. Kiểm trên trình duyệt." + giữa chừng: "có cách nào mà click
1 cái xong tự fill các SKU được hệ thống đề xuất lại không" (kèm ảnh nhãn "ĐỀ XUẤT" gãy 2 dòng).
- **BE** (worktree, chi tiết changelog worktree 11.8): `GET /cutting-batch-candidates?deepVerify=true` = lượt KIỂM BÙ (tới 12 cỡ đoạn, 30 s/bài,
  ngân sách 120 s, song song đúng bằng số luồng bộ giải `SOLVER_TS_WORKERS`); bộ nhớ đệm kết quả xác minh qua các lần tải trang (30 phút,
  ≤ 3.000 khoá, chỉ nhớ kết quả thành công). Lượt nhanh giữ nguyên (≤ 5 cỡ, 5 s, 12 s).
- **FE** (chi tiết changelog FE 2j): chip 3 trạng thái (xanh đã kiểm đạt / đỏ vượt / xám "chưa kiểm" – "đang kiểm" khi lượt bù chạy); lượt bù
  chạy nền sau khi bảng hiện, ghép kết quả không đổi thứ tự dòng/lựa chọn; ô loại sắt chỉ hiện cảnh báo + "✓ n loại đạt" (mở được); khối
  "Loại sắt có cảnh báo khi cắt riêng ở cây 6m" (mỗi loại 1 dòng, 3 loại đầu + "Xem thêm", nút "Chọn đơn gần hạn nhất", danh sách đơn); tiêu đề
  cột "… ở cây 6m"; nút "Chọn lại đề xuất"; nhãn "ĐỀ XUẤT" không gãy dòng.
- **Kiểm tra:** BE jest cutting-proposals 11 suite / 291 test (+2), prettier sạch, `pnpm build` xong, BE 3002 chạy lại. FE tsc sạch, eslint 0 lỗi,
  vitest 23 file / 220 test (`mergeHints.test.ts` 8). Trình duyệt (KHSX, DB test, laser):
  - BE khởi động lại (đệm trống): bảng hiện sau ~9 s với 35 chip "đang kiểm"; lượt bù xong trong khoảng 45–85 s → **0 chip chưa kiểm**; dòng
    GHE-J55 ×20 …633975 = "SAT-PHI-6 >1% · SAT-VUONG-20X20 >1% · SAT-VUONG-12X12 >1% · ✓ 4 loại đạt" (SAT-PHI-6 trước hiện xanh "≥0,17%").
    Đệm đã có: bảng 2,8 s, mọi chip xác minh ngay.
  - Dòng SKU 83 px (trước 258 px); khối cảnh báo 236 px (bản đầu 9 loại × 2 dòng = 655 px → thu 1 dòng/loại + 3 loại đầu).
  - "Chọn đơn gần hạn nhất" (SAT-HOP-20X20, chưa tick đơn nào) tick 2 đơn BAN-J55; "Chọn lại đề xuất" hiện khi lựa chọn khác đề xuất, bấm →
    về đúng 2 SKU, dòng tóm tắt "đang chọn đúng đề xuất". Mobile 375: thẻ 151 px, nút 40 px, không cuộn ngang; "4 loại đạt" mở đủ chip, không tick
    nhầm thẻ.
- **Lỗi gặp khi kiểm:** lần 1 còn 4 bài "chưa kiểm" (xếp hàng 6 bài vào 1 luồng, bài cuối quá 45 s; SAT-PHI-6 cần ~16 s > 15 s) → song song theo
  số luồng + 30 s/bài; lần 2 lượt bù bị axios huỷ ở 20 s (`REQUEST_TIMEOUT_MS`) → riêng lời gọi bù 150 s.
- **Hạn chế / chưa làm:** lần mở trang đầu sau khi BE khởi động lại phải chờ ~1 phút mới hết chip xám (1 luồng bộ giải); lượt bù chiếm luồng bộ
  giải nên nếu KHSX bấm "Tính" ngay lúc đó thì lượt tính phải chờ. MC Tự động chưa đo lại thời gian lượt bù. DB test không có đơn nào có hạn giao
  → thứ tự "gần hạn" chỉ kiểm bằng unit test.

## 30. 2026-10-24 — Gợi ý gộp = nhóm ÍT HAO HỤT NHẤT trong cửa sổ hạn giao (BE + FE, migration mới, local, CHƯA commit) — nhóm tick sẵn + `mergeGroups` đã thay bằng 1 SKU + fix-options ở mục 32

Người dùng (ảnh khối "Loại sắt có cảnh báo"): "cái này theo chuẩn ERP sản xuất thì phải là chọn gộp SKU để cho ra ít hao hụt nhất chứ". Hỏi lại,
người dùng chọn: **"Ít hao hụt nhất trong cửa sổ hạn giao"** (Admin cấu hình số ngày) và **nhóm tick sẵn đổi theo cùng tiêu chí**.
- **Trước:** `getBatchSuggestions` xếp đơn theo hạn gần, gộp dần tới khi ĐẠT 1 % thì dừng (best-fill ước tính); nút ở khối cảnh báo "Chọn đơn gần
  hạn nhất" (mục 29) cũng theo hạn giao.
- **Cấu hình mới** `SystemConfig.solverMergeWindowDays` (mặc định 7, 0–365) — migration `20261024100000_add_solver_merge_window_days`, ĐÃ áp
  DB test `dna_erp_solver_test` (chưa áp DB dev/production). Admin sửa ở Cấu hình hệ thống → nhóm "Máy cắt" → "Gợi ý gộp đơn (cả hai máy)";
  KHSX thấy ở "Xem thông số máy cắt".
- **BE** `bestMergeGroups` (chi tiết changelog worktree 11.9): mỗi loại sắt có chip đỏ → các cửa sổ hạn giao tối đa (mỗi đơn có hạn làm mốc:
  đơn có hạn trong [mốc, mốc + N ngày] + đơn chưa có hạn) → chọn nhóm: đạt ngưỡng trước, hao hụt thấp, ít đơn. Lượt nhanh dùng ước tính/đệm;
  lượt kiểm bù chạy bộ giải thật cho từng nhóm ở cây chuẩn. `recommendedItemIds` = hợp các nhóm đạt ngưỡng; trả kèm `mergeGroups`.
- **FE** (changelog FE 2k): mỗi loại trong khối cảnh báo ghi "gộp n đơn (GHE-J55 ×10…, hạn cách nhau d ngày) → x%" (xanh = đạt, đỏ "vẫn >1%",
  "≥x% (ước tính)" khi chưa kiểm) + nút **"Chọn nhóm này (n đơn)"** (thay cho "Chọn đơn gần hạn nhất"); lượt kiểm bù đổi luôn nhóm tick sẵn nếu
  KHSX chưa sửa lựa chọn.
- **Kiểm tra:** BE jest cutting-proposals + system-config 326 test (+3: trong cửa sổ thì gộp, hạn cách 8 ngày với cửa sổ 7 thì không, đơn chưa có
  hạn không bị chặn), tsc/eslint/prettier sạch, `pnpm build`, BE 3002 chạy lại. FE tsc sạch, eslint 0 lỗi, vitest 217. Trình duyệt (DB test,
  laser, đệm trống): lượt nhanh hiện ước tính, lượt bù ra số thật —
  SAT-VUONG-20X20 gộp 21 đơn → 0,17 %; SAT-PHI-6 gộp 10 đơn → 0,55 % (từng đơn đều >1 %); SAT-VUONG-12X12 18 đơn → 0,17 %; SAT-HOP-25X50 27 đơn
  → 0,21 %; SAT-HOP-50X50 24 đơn → 0,85 %; SAT-PHI-4 10 đơn → 0,80 %; SAT-HOP-20X20 24 đơn → vẫn >1 %; SAT-009 2 đơn → vẫn >1 %; SAT-018 chỉ
  1 đơn. "Chọn nhóm này" của SAT-PHI-6 tick đúng 10 đơn GHE-J55, nút thành "Đang chọn nhóm này", hiện "Chọn lại đề xuất". Admin: ô "Gộp đơn có
  hạn giao cách nhau tối đa (ngày)" = 7; nhập 400 → "Phải là số nguyên từ 0 đến 365", không lưu (DB vẫn 7).
- **Lưu ý / còn treo:**
  - DB test KHÔNG có đơn nào có hạn giao → cửa sổ không chặn gì → nhóm tick sẵn = **45 SKU** (gần cả bảng). Dữ liệu thật có hạn giao thì cửa sổ
    7 ngày giới hạn lại; nếu vẫn quá lớn cần thêm trần số đơn/đợt — chưa làm, chờ người dùng.
  - Khi deploy: chạy thêm migration `20261024100000_add_solver_merge_window_days`.

## 31. 2026-10-24 — Review tin nhắn Sếp Nhân về gộp SKU + chốt luật gộp — ĐÃ LÀM ở mục 32 (trần mặc định đổi 5 → 2, khung tính cả ngày đầu)

Người dùng hỏi trong nhóm: "chỗ gộp SKU có nên giới hạn số SKU gộp không, ví dụ chỉ được gộp tối đa 5 hoặc 10 sku" và "gộp SKU xong thì sẽ
hiển thị deadline theo cái gần nhất hay trễ nhất". Sếp Nhân trả lời: "gộp xong vẫn phải tách riêng thời gian ra", "chắc chắn chỉ được gom các lệnh
cách nhau khoảng 3 ngày đổ lại", "không được gộp 2 lệnh cách nhau quá xa", "sẽ kiểm soát lúc lên kế hoạch". Người dùng chốt tiêu chí gợi ý: "ít hao
hụt nhất, nhưng giới hạn chỉ được gộp tối đa bao nhiêu đó SKU". Trước đó người dùng cũng làm rõ mục đích gộp: chỉ gộp khi đơn cắt riêng ở cây 6m
vượt 1 % mà không muốn dùng chế độ đơn gấp (muốn vẫn mua 6m, hao hụt ≤ 1 %).

- **Đối chiếu code:** `mergeItems` giữ nguyên hạn/công đoạn RIÊNG của từng SKU (ProductionInvoiceItem + stages); chỉ `ProductionInvoice.deadline`
  của lệnh gộp = hạn GẦN NHẤT ("cắt theo SKU gấp nhất") và "Tổng hợp lệnh SX" chỉ hiện một ngày đó. Cửa sổ gộp `solverMergeWindowDays` = 7 ngày,
  chỉ dùng cho GỢI Ý (mục 30) — KHSX tick tay đơn cách nhau bao xa vẫn tính/tạo lệnh được (preview chỉ ghi "cắt sớm N ngày"). Chưa có trần số SKU.
- **Đề xuất (chờ duyệt):**
  1. Cửa sổ mặc định 3 ngày và thành LUẬT CỨNG ở bước lên kế hoạch (FE chặn nút Tính/Tạo lệnh + BE chặn ở solve/merge): hạn giao trong đợt cách
     nhau > N ngày thì không cho, báo "Hạn giao trong đợt cách nhau X ngày, tối đa cho phép N ngày". Đơn chưa có hạn: không chặn, ghi chú.
  2. Cấu hình mới "Số SKU gộp tối đa" (đề xuất mặc định 5, Admin sửa) — cũng là luật cứng; gợi ý gộp = nhóm ÍT HAO HỤT NHẤT trong ≤ N ngày và ≤ M SKU.
  3. Lệnh gộp hiện KHOẢNG hạn ("12/11 → 14/11 (2 SKU)") thay vì một ngày; hạn từng SKU giữ nguyên.
  4. Giao diện theo mockup "Đợt đang chọn" (mỗi loại sắt vượt 1 % ở 6m: gộp thêm đơn [nên làm] / để hệ thống đặt cây riêng / đơn gấp), tick sẵn = đơn
     gấp nhất + nhóm gộp tốt nhất của nó; khối cảnh báo toàn bảng thay bằng khối này.
- **Chốt thêm (2026-10-24):**
  - Đối chiếu code: gộp SKU → 1 PI thì phương án cắt (`CuttingProposal.productionInvoiceId`), đề xuất mua (`PurchaseProposal.productionInvoiceId`) và xuất sắt (`SteelIssue.productionInvoiceId`) đi theo PI; lệnh sản xuất (`ProductionOrder.productionInvoiceItemId` unique) và timeline đi theo từng SKU. KHSX đã sửa được timeline từng SKU trong PI gộp ("Sửa thời hạn", `updateItem`). Hai lỗ hổng: `ProductionInvoice.deadline` của lệnh gộp chốt lúc gộp, không cập nhật khi sửa hạn SKU; sửa hạn sau khi gộp không kiểm luật 3 ngày.
  - Người dùng chốt: luật "cách nhau ≤ 3 ngày" tính theo **mốc cần sắt** (hạn mua hàng, không có thì hạn khung - `frameDeadlineOf`), như hệ thống đang dùng. Trần số SKU mặc định: chờ người dùng (đề xuất 5).

## 32. 2026-10-24 — Luật gộp cứng: mốc cần sắt trong khung 3 ngày + tối đa 2 SKU; khung "Đợt đang chọn"; lệnh gộp hiện khoảng hạn (BE + FE, 3 migration, local, CHƯA commit, CHƯA deploy)

Người dùng duyệt (nguyên văn): "Làm theo luật đã chốt (3 ngày theo mốc cần sắt là luật cứng, ít hao hụt nhất trong giới hạn, trần mặc định 5 SKU
Admin sửa, lệnh gộp hiện khoảng hạn, sửa hạn sau gộp cũng kiểm 3 ngày, giao diện theo mockup Đợt đang chọn). Kiểm trên trình duyệt." Giữa chừng
Sếp Nhân chỉnh: "bắt buộc chỉ được gộp tối đa 2 lệnh có ngày cắt sắt cách nhau ko quá 3 ngày (ví dụ: ngày 1 gộp được ngày 3, ngày 1 ko được gộp
với ngày 4)" → **khung tính cả ngày đầu** (3 = chênh tối đa 2 ngày) và **trần mặc định 2 SKU** (thay 5).

### 32.1 Luật (BE là nơi chặn thật, FE chặn sớm cho dễ thấy)
- **Mốc cần sắt** của 1 SKU = hạn Mua hàng (`materialDeadline`), không có thì hạn Khung cơ khí (stage FRAME) — `merge-rules.util.ts`
  `ownSteelDeadlineOf`. Không lấy hạn của PI (lệnh gộp có hạn chung = hạn sớm nhất, lấy vào thì SKU nào cũng như đang ở mốc sớm nhất). SKU chưa
  có mốc riêng: bỏ qua, không chặn.
- **Khung N ngày tính cả ngày đầu**: mốc sớm nhất và muộn nhất chênh ≤ N − 1 ngày (`maxGapDays`). **≤ M SKU** mỗi đợt tính / lệnh gộp.
- Cấu hình Admin: `SystemConfig.solverMergeWindowDays` (mặc định 3, 1–365) và `solverMergeMaxSkus` (mặc định 2, 1–50) — Cấu hình hệ thống →
  "Gợi ý gộp đơn (cả hai máy)". KHSX xem ở "Xem thông số máy cắt": "Luật gộp (mốc cần sắt): khung 3 ngày, tối đa 2 SKU".
- Chặn ở 4 chỗ: bấm **Tính phương án** (`cutting-batch-solve`), **gộp lệnh** (`mergeItems`), **sửa hạn 1 SKU** của lệnh gộp (`updateItem`) và
  endpoint mới **sửa hạn cả lệnh một lượt** `PATCH /production-invoices/:id/items-deadlines` (một transaction, kiểm luật trên giá trị vừa ghi,
  sai thì rollback). Câu báo nêu số ngày, mốc sớm nhất/muộn nhất kèm **mã SKU + mã PO** (nhiều đơn cùng SKU vẫn phân biệt được), vd "Mốc cần sắt
  của các SKU trong đợt cách nhau 3 ngày (sớm nhất 01/11 – GHE-J55 (RP-…633975), muộn nhất 04/11 – GHE-J55 (RP-…320871)) - chỉ được gộp trong
  khung 3 ngày (chênh tối đa 2 ngày)".

### 32.2 Gợi ý xử lý — thay cách "nhóm gộp tick sẵn" của mục 30
- **Tick sẵn đúng 1 SKU**: đơn có chip đỏ với mốc cần sắt sớm nhất (mục 30 tick sẵn hợp các nhóm → DB test ra 45 SKU). Bỏ `bestMergeGroups` /
  `mergeGroups`.
- Endpoint mới `POST /cutting-proposals/cutting-batch-fix-options` (quyền xem): với đợt đang chọn, mỗi loại sắt ở cây chuẩn → (1) **gộp thêm đơn**:
  tham lam theo mốc gần nhất, chỉ đơn còn trong khung + còn chỗ trong trần SKU, giải thật từng tiền tố, chọn tiền tố đạt ngưỡng với hao hụt thấp
  nhất; (2) **cây riêng** (chế độ Bình thường tự dò chiều dài); (3) **đơn gấp** (cây chuẩn, 100 %); kèm `addAllItemIds`. Ngân sách 60 s.
- Trần SKU: đợt đã đủ M SKU → "Đợt đã đủ 2 SKU… không gộp thêm được"; đợt đang quá trần → "Đợt đang có 3 SKU, quá trần 2 SKU - bỏ bớt SKU trước".

### 32.3 Giao diện (chi tiết changelog FE 2l, 2l-b, 2m)
- "Tối ưu cắt sắt": khung **"Đợt đang chọn"** trên bảng (số SKU, khoảng mốc cần sắt, luật; cảnh báo đỏ khi vi phạm; mỗi loại sắt vượt 1 % ở 6m:
  gộp thêm [Nên làm] / cây riêng / đơn gấp; ô "Bỏ khỏi đợt" cho SKU không dùng chung sắt; "Thêm tất cả đơn gợi ý"). Vi phạm luật thì nút Tính
  khoá (tooltip ghi lý do), thanh dưới ghi "vượt luật gộp · Xem cách xử lý".
- "Lệnh sản xuất": lệnh gộp hiện **khoảng hạn** "05/12/2026 → 10/12/2026 (2 SKU)"; "Sửa thời hạn" kiểm luật ngay khi gõ (khoá Lưu, báo lỗi tại
  chỗ) và lưu cả lệnh một lượt qua endpoint mới.
- **Lỗi tìm thấy khi kiểm và đã sửa:** mốc "ước tính" của SKU trong lệnh gộp lùi từ hạn SỚM NHẤT của lệnh, không phải hạn giao của chính SKU
  (PI-2026-016: SKU giao 10/12 hiện "Mua hàng 14/11" = lùi từ 05/12). Nay lùi từ hạn giao từng SKU, ở cả 4 chỗ (bảng chi tiết KHSX, chi tiết
  Boss/QLSX, modal Sửa thời hạn, modal gửi QLSX) — GHE-TINH-YEU giờ 19/11 · 26/11 · 02/12 · 07/12.
- "Bỏ khỏi đợt" chuyển lên ngay dưới cảnh báo luật: trước nằm sau danh sách loại sắt, gợi ý tải xong đẩy ô xuống làm bấm trượt.

### 32.4 Kiểm tra
- BE: jest `common/utils` + `production-invoices` + `cutting-proposals` + `system-config` 595 test — 593 xanh; 2 test bộ giải nặng có giới hạn 20 s
  (`optimize-material.spec`) quá giờ khi chạy song song 25 bộ, chạy riêng 14/14 xanh. Test mới: luật khung tính cả ngày đầu (ngày 1 + ngày 3 đạt,
  ngày 1 + ngày 4 chặn), trần SKU, câu báo kèm mã PO, tick sẵn 1 SKU, fix-options (gộp trong khung / ngoài khung / đã đủ trần / quá trần / vi phạm),
  `updateItemsDeadlines`. tsc phần `src` sạch (lỗi tsc ở `prisma/seed-real-products.ts`, `seed-ghe-j55-full-bom.ts` có từ commit bd70135 — factoryCode
  hết unique, không thuộc việc này), eslint + prettier sạch, `pnpm build` (nest build) xong, BE 3002 chạy lại.
- FE: tsc sạch, eslint 0 lỗi (cảnh báo cũ giữ nguyên), vitest 24 file / 227 test.
- Trình duyệt (DB test `dna_erp_solver_test`, KHSX demo, MC Laser, khung bề ngang hẹp): tick sẵn 1 SKU (mốc 01/11); thêm đơn mốc 04/11 → báo đỏ
  "cách nhau 3 ngày… chênh tối đa 2 ngày", nút Tính khoá; 3 SKU trong khung → "Đợt gồm 3 SKU, tối đa 2 SKU…", nút khoá có tooltip; "Xem cách
  xử lý" cuộn tới khung; "Bỏ khỏi đợt" BAN-J55 → còn 2 SKU, hết cảnh báo, nút mở. Lệnh gộp PI-2026-016: khoảng hạn đúng; sửa Mua hàng 13/11 và
  18/11 → báo lỗi + khoá Lưu; sửa về 15/11 → Lưu, `PATCH …/21/items-deadlines` 200, hai mốc in đậm (lưu thật), mốc khác vẫn "ước tính". Admin demo:
  hai ô = 3 và 2 kèm giải thích.
- **Dữ liệu DB test đã đổi:** item 99/101/103 `materialDeadline` = 01/11, 03/11, 04/11 (để thử khung); PI-2026-016 (id 21) hai SKU `materialDeadline`
  = 13/11, 15/11 (lưu qua giao diện). Không đụng DB dev `dna_erp`, không đụng production.

### 32.5 Sự cố trong lúc làm (đã khắc phục)
Lỡ chạy `prettier --write` lên `D:\DNA-ERP\src\modules\pages\ProductionPlan\GomDotCatPage.tsx` — FE không có cấu hình prettier, cả file bị định
dạng lại (diff ~2.900 dòng). Đã dựng lại bản gốc từ cache Turbopack của dev server (`.next-e2e/dev/cache/turbopack/*.sst`, giải nén LZ4 bản lúc
14:45) + áp lại 3 lần sửa sau đó; bản dựng lại khi chạy prettier ra **đúng từng byte** với bản đang có → logic không đổi, chỉ trả lại cách viết gốc
(diff thật so với HEAD +517/−253). Đã ghi nhớ: không chạy prettier ở FE.

### 32.6 Còn treo
- **Chờ người dùng quyết:** "ngày cắt sắt" của Sếp nên tính theo mốc **Phôi** (FRAME_PHOI, mặc định −25 ngày) → Khung → Mua hàng? Mặc định hiện tại
  lệch: Mua hàng −21 nhưng Phôi −25 (vd PI-2026-035: Phôi 17/09, Khung 26/09, Mua hàng 02/10 — hạn mua sắt muộn hơn ngày phải cắt). Đang tính theo
  Mua hàng → Khung như người dùng chốt ở mục 31.
  **Cập nhật 2026-10-24:** người dùng sẽ xin Sếp họp 1 ngày để chốt **business rule thời hạn** (thứ tự + số ngày lùi các mốc, mốc nào là
  "ngày cắt sắt", ràng buộc giữa các mốc) — làm nền cho thông báo trễ deadline gửi Sếp sau này. Tới lúc đó GIỮ NGUYÊN Mua hàng → Khung, chưa sửa code.
- Khi deploy (chỉ khi người dùng nói "deploy"): chạy migration `20261024100000_add_solver_merge_window_days`, `20261024110000_merge_rules_window_3_max_skus`,
  `20261024120000_merge_max_skus_default_2` (cùng migration MCTĐ `20261023100000_add_solver_machine_mctd`); đã áp DB test, chưa áp DB dev/production.
