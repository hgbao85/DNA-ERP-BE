# Changelog 2026-10-01 — Kế hoạch gom solver (DNA-DEXUAT) vào repo DNA-ERP-BE

> Trạng thái: **CHỈ LÀ KẾ HOẠCH, CHƯA CODE.** Chờ người dùng chốt 3 câu hỏi ở mục 6.
> **Cập nhật 2026-10-20 (mục 8):** người dùng muốn BỎ HẲN DNA-DEXUAT để bớt 1 hệ thống → đề xuất đổi bước 6 từ
> "service Render thứ 2" sang "chạy chung container BE"; có số đo RAM. Vẫn chưa code, chờ chốt.

## 1. Hiện trạng (đọc từ code, 2026-10-01)

- BE chỉ dùng **1 endpoint** của DNA-DEXUAT: `POST /api/v1/de_xuat/propose/` (Bearer `ERP_API_KEY`), cấu hình qua
  `SOLVER_BASE_URL` / `SOLVER_API_KEY` / `SOLVER_TIMEOUT_SECONDS` (`src/config/configuration.ts`).
- Phần lõi thật sự chạy cho BE ≈ 950 dòng Python:
  - `cat_sat/de_xuat_logic.py` (605 dòng) — thuật toán, chỉ cần `ortools` + thư viện chuẩn.
  - hàm `api_de_xuat_propose` + các hàm parse trong `api/views.py` (~350 dòng) — kiểm key, đọc request, gọi
    `list_material_groups` / `optimize_one_material` cho từng loại sắt, dựng response.
- Phần còn lại của DEXUAT (157 file: Django, Channels/Redis, daphne, MC Laser, `cat_laser_roi`, accounts, templates,
  gurobipy, pandas, jupyter…) BE KHÔNG dùng.
- Triển khai: DEXUAT là web service Render gói free riêng (512MB, CPU chia sẻ, ngủ sau 15 phút) + 1 Redis free.

## 2. Mục tiêu

Solver nằm chung repo BE (cùng phiên bản, sửa thuật toán và BE trong cùng commit), **API giữ y hệt** để code
TypeScript của BE không đổi (chỉ đổi biến môi trường). DNA-DEXUAT vẫn chạy song song cho tới khi chắc chắn.

## 3. Cấu trúc dự kiến

```
DNA-ERP-BE/solver/
  app.py            # lớp HTTP mỏng: POST /api/v1/de_xuat/propose/ + GET /health, kiểm Bearer key (fail-closed)
  propose.py        # thân api_de_xuat_propose tách khỏi Django: propose(body) -> (http_status, dict)
  de_xuat_logic.py  # chép NGUYÊN từ DEXUAT commit 56aa61d, không sửa thuật toán
  requirements.txt  # ortools==9.15.6755 (khoá đúng bản đang chạy) + fastapi + uvicorn
  Dockerfile        # python slim
  tests/            # test tương đương với DEXUAT
```

## 4. Các bước

1. Chép nguyên `de_xuat_logic.py`, ghi rõ nguồn (repo + commit).
2. Tách `api_de_xuat_propose` thành hàm thuần; thay `JsonResponse`/`settings.ERP_API_KEY`/`settings.DEBUG` bằng
   tham số + biến môi trường. Giữ nguyên tên mọi trường request/response.
3. Lớp HTTP (FastAPI + uvicorn), so key bằng `hmac.compare_digest` như cũ, thêm `/health`.
4. **Test tương đương** (bước quan trọng nhất): lấy các cặp `requestParams` / `rawResponse` thật đã lưu trong
   `cutting_proposals`, chạy lại qua solver mới, so số cây / chiều dài cây / % hao hụt / khả thi từng loại sắt.
   CP-SAT có thể ra cách cắt khác nhưng cùng giá trị tối ưu → so theo chỉ số, không so từng pattern.
5. Local: thêm service `solver` vào `docker-compose.yml`, BE trỏ `SOLVER_BASE_URL=http://solver:8000`.
6. Production: thêm service Render thứ 2 build từ thư mục `solver/` của CÙNG repo (không gộp chung container với
   Node: solver ăn CPU làm API BE chậm, 512MB dễ tràn RAM).
7. Chuyển đổi: deploy solver mới chạy song song DEXUAT → đổi `SOLVER_BASE_URL` của BE → theo dõi vài ngày.
   Rollback = đổi lại biến môi trường. Từ đó thuật toán chỉ sửa trong `solver/`; bản ở DEXUAT đóng băng.

## 5. Được gì / không được gì

- Được: 1 repo 1 phiên bản, test chung; bỏ Django/Redis/~140 file không dùng; image nhẹ, khởi động nhanh hơn.
- **Không** tự làm tính nhanh hơn: tốc độ phụ thuộc CPU của gói Render. Gói free vẫn chậm + ngủ 15 phút — muốn KHSX
  chờ ít thì phải nâng gói cho solver; việc này ảnh hưởng thời gian chờ nhiều hơn việc gom repo.
- Hàng đợi solver trong BE (1 lượt/lần, nằm trong bộ nhớ) giữ nguyên, không thuộc phạm vi việc này.

### 5b. Đánh giá lại khi người dùng hỏi "không nhanh hơn thì có tác dụng gì" (2026-10-01)

Lợi ích chỉ nằm ở **bảo trì cho người phát triển**, người dùng cuối không thấy khác. Bằng chứng việc phải sửa đồng
thời 2 repo đã xảy ra nhiều lần: `max_waste_percentage_by_material`, `stock_lengths_by_material` (2026-09-16),
`solve_seconds` (2026-09-22) - mỗi lần sửa DEXUAT trước, deploy, rồi mới sửa BE. Kết luận: **không ưu tiên lúc này**;
nên làm khi sắp sửa thuật toán lần nữa. Việc ưu tiên hơn: chạy seed, chạy thử đợt thật đo thời gian chờ solver; nếu
chờ lâu thì nâng CPU cho solver (không cần code).

## 6. Chờ người dùng chốt

1. ~~Màn MC Laser / màn demo trên DEXUAT còn ai dùng không?~~ **ĐÃ TRẢ LỜI (2026-10-01): không ai dùng ngoài
   người dùng (chủ dự án).** → DEXUAT chỉ cần chạy song song trong giai đoạn chuyển đổi + kiểm tra; sau đó có thể
   tắt cả web service lẫn Redis của nó (trừ khi chính người dùng còn muốn giữ màn MC Laser/demo cho riêng mình).
2. Gói Render cho solver mới: free (public + API key như hiện nay) hay trả phí (private service, CPU mạnh hơn)?
3. Đồng ý dùng FastAPI cho lớp HTTP (thay Django)?

## 7. Rủi ro

- Lệch kết quả nếu lệch phiên bản OR-Tools → khoá đúng `9.15.6755`.
- Ai đó sửa thuật toán ở DEXUAT sau khi chuyển → hai bản lệch nhau; cần thống nhất "chỉ sửa ở `solver/`".
- 2 service Render free cùng ngủ → lượt tính đầu sau khi ngủ chậm thêm ~1 phút (như hiện nay).

## 8. Cập nhật 2026-10-20 — mục tiêu mới: bỏ hẳn DNA-DEXUAT (CHƯA CODE, chờ chốt)

Bối cảnh: Render free ngủ sau 15 phút gây bất tiện; người dùng muốn bỏ DEXUAT để giảm gánh nặng vận hành. Bước 6
cũ (service Render thứ 2 từ thư mục `solver/`) vẫn là 2 service, vẫn ngủ → không đạt mục tiêu.

**Đo RAM/thời gian** `optimize_one_material` (`SOLVER_WORKERS=2` như Render, máy dev Windows, OR-Tools 9.15):

| Ca | Kết quả | Thời gian | RAM sau import | RAM đỉnh |
|---|---|---|---|---|
| 12 cỡ ngẫu nhiên | 234 cây, 0,167 % | 141 s | 75 MB | 175 MB |
| I3 CO-2201-00249 (9 cỡ) | 117 cây, 0,167 % | 290 s (8 luồng: 187 s) | 75 MB | **290 MB** |

Hướng đề xuất: solver chạy **trong cùng container BE** dưới dạng tiến trình con Python (mỗi lượt 1 tiến trình,
JSON vào stdin / ra stdout, chạy xong thoát để trả RAM); hàng đợi FIFO 1 lượt sẵn có của BE giữ nguyên; công tắc
`SOLVER_MODE=local|http` để rollback về DEXUAT bằng biến môi trường; runtime đổi từ `node:20-alpine` sang Debian
slim (wheel OR-Tools cho musl chưa kiểm chứng); `nice` + `oom_score_adj` cho tiến trình con để nếu tràn RAM thì
chết solver chứ không chết API.

Điều kiện: **không chạy được ổn trên gói free** — 512 MB phải chứa Node + 290 MB solver (loại 12–15 cỡ còn nặng
hơn), và CPU gói free rất thấp nên API BE sẽ ì trong lúc giải. Cần gói trả phí cho service BE (1 service thay vì 2).
Chưa đo ca 15 cỡ thật (SAT-HOP-10X20) — phải đo trước khi chọn gói. Màn MC Laser trên DEXUAT (chỉ người dùng dùng,
mục 6.1) thay bằng tool Excel offline `MC_CatSat_ExcelTool` (xem changelog 2026-10-20 review excel tool).
