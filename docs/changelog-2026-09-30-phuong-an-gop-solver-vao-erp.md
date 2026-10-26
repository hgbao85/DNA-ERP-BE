# Changelog 2026-09-30 — Phương án đưa Solver (DNA-DEXUAT) về chung với ERP

> Trạng thái: **CHỈ ĐỀ XUẤT KIẾN TRÚC, CHƯA LÀM.** Chờ người dùng trả lời 2 câu hỏi ở mục 4.

## 1. Yêu cầu

Người dùng: *"giờ kiểu phải xài liên phần mềm giữa ERP với Solve, liệu có thể đưa solve vào chung
luôn hay có giải pháp nào không"*.

## 2. Hiện trạng

- Người dùng cuối KHÔNG mở DNA-DEXUAT: ERP-BE gọi server-to-server `POST /api/v1/de_xuat/propose/`
  (Bearer `SOLVER_API_KEY` = `ERP_API_KEY`), chạy nền sau khi Sếp duyệt.
- Phần ERP thật sự dùng chỉ ~1.070 dòng Python: `cat_sat/de_xuat_logic.py` (605) + `api/views.py`
  (462). Phần còn lại của DEXUAT (Django templates, Channels + Redis cho màn MC Laser, module MCTĐ,
  `cat_laser` cũ) không dính tới ERP.
- Chi phí của việc tách 2 app: 2 repo/2 lần deploy, khoá bí mật phải khớp tay trên Render, service
  solver free ngủ sau 15 phút (cold start ~1 phút), HTTP giữ tới 1700s, và nhiều "mẹo" hợp đồng mà BE
  phải chiều theo (vd `stock_lengths` phải là chuỗi cách nhau bởi khoảng trắng; khoá theo vật tư
  không khớp thì solver bỏ qua lặng lẽ; `patterns_truncated` không được trả ra).
- `requirements.txt` của DEXUAT kéo cả `gurobipy`, `ipykernel`, `ipython`, `jupyter_*` vào image
  production — `gurobipy` chỉ được import ở module cắt laser/MCTĐ, không ở luồng ERP dùng.

## 3. Đánh giá phương án

- **Viết lại solver bằng TypeScript trong NestJS — không khuyến nghị.** OR-Tools không có bản chính
  thức cho Node; thay bằng MIP chạy WASM thì mất CP-SAT đa luồng, phải kiểm chứng lại toàn bộ kết quả
  (đã từng đối chiếu khớp với MC Laser), và bài toán nặng sẽ chặn event loop của BE.
- **Khuyến nghị: gộp CODE về repo ERP-BE, vẫn chạy 2 tiến trình.** Chỉ chép phần lõi
  (`de_xuat_logic.py` + API mỏng, không cần Django/Redis/templates) vào thư mục `solver/` của
  DNA-ERP-BE; chạy như service nội bộ trong cùng docker-compose, BE gọi qua mạng nội bộ. Lợi ích: 1
  repo, 1 lần deploy, sửa hợp đồng 2 phía trong cùng 1 commit + test hợp đồng chung, dọn được các mẹo ở
  mục 2, image solver nhỏ hơn nhiều.
- **Không gộp code nhưng giảm đau** (nếu chưa muốn động): giữ nguyên 2 app, chỉ nâng gói solver để
  hết ngủ + dọn requirements.

## 4. Chưa làm / cần người dùng trả lời

- Màn MCTĐ / MC Laser trên DEXUAT xưởng còn dùng trực tiếp không? (Còn dùng → giữ DEXUAT cho các
  màn đó, chỉ tách phần lõi đề xuất; không dùng → có thể ngừng DEXUAT sau khi chuyển.)
- Production chạy trên Render hay VPS? (Ảnh hưởng cách chạy service nội bộ; trên VPS docker-compose
  là đơn giản nhất.)
