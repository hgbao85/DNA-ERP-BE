# C5 — danh sách lỗi còn tồn 16/11 (17/11/2026)

Nguồn: FE `docs/audit-2026-11-16-loi-con-ton-doc-code.html`, mục C5 (phương án cắt sắt, mục nhỏ). **Có 1 migration** (`20261117180000_widen_cutting_waste_mm`), chưa chạy trên DB dev chung. Không sửa FE.

## 1. Idempotency kiểu đọc-rồi-tạo

`requestForOrder` / `requestForInvoice`:
- **Trước:** hàm kiểm "đã có phương án với Idempotency-Key này chưa" rồi mới tạo. Hai lời gọi cùng khoá chạy đồng thời đều qua được bước kiểm, lời gọi sau vấp UNIQUE (P2002) thành lỗi 500.
- **Sau:** `createProposalIdempotent()` bắt đúng P2002 trên `idempotencyKey`, đọc lại phương án của lời gọi thắng và trả về như gọi lại, không chạy solver lần 2. P2002 vì trường khác vẫn ném lỗi như cũ.

## 2. `totalWasteMm` có thể tràn

`CuttingProposal.totalWasteMm` `Decimal(8,1)` và `CuttingProposalLine.totalWasteMm` `Decimal(7,1)` (trần 999.999,9 mm một dòng) nay nới cùng lên `Decimal(12,1)`.
- Trên DB dev, giá trị lớn nhất hiện là 14.797,5 mm một dòng (421 cây) và 27.462,5 mm một phương án.
- Lệnh rất lớn chạy chế độ gấp (hao hụt cao) có thể vượt trần → lỗi lúc lưu kết quả solver.
- Postgres tăng độ chính xác `numeric` không ghi lại bảng.

## 3. N+1

- **`getBatchSolves`:** dòng lệnh + định mức ACTIVE của mọi phương án DRAFT (tối đa 30) đọc 1 lần qua `loadReadinessContext()`. Trước đây mỗi phương án 2 câu. `invoiceReadinessReason()` nhận thêm dữ liệu tải sẵn (tuỳ chọn); các chỗ gọi khác không đổi.
- **`aggregateDemand`** (dựng bài toán cho PI gộp / lượt tính trước PI): định mức mọi SKU đọc trong 2 câu qua `buildBomRowsMany()`. Trước đây mỗi SKU 2 câu. Một bản định mức thì vẫn đúng câu truy vấn cũ.

## 4. `countNeedsAction` không giới hạn

Số đỏ "Lệnh sản xuất" của QLSX:
- **Trước:** tải mọi phương án CALCULATING/DRAFT/FAILED (tăng dần theo thời gian) rồi lọc trong JS.
- **Sau:** đếm thẳng bằng `COUNT` với điều kiện tương đương `computeDisplayStatus()` = NEEDS_ACTION:
  - FAILED;
  - CALCULATING quá hạn gọi solver + 60 s;
  - DRAFT vô nghiệm / vượt ngưỡng / chưa có `completedAt` / xong quá cửa sổ tự-duyệt 60 s.
- Đổi nhánh nào ở `computeDisplayStatus()` thì phải đổi theo ở đây.

## Test

- Unit: toàn bộ chỉ còn 2 lỗi cũ của bộ giải tối ưu cắt (3833 qua). Integration 35/35.
- Test mới:
  - P2002 do khoá → trả phương án cũ, không chạy solver; P2002 trường khác → ném lỗi.
  - `getBatchSolves` 3 phương án → mỗi bảng đọc 1 lần.
  - `buildInvoiceJob` 2 SKU → định mức đọc 1 lần.
  - Điều kiện COUNT của `countNeedsAction`.
- Thử sống bản sao DB dev (đã chạy migration):
  - Chèn tạm 9 phương án đủ các trạng thái → số đỏ QLSX 0 → 6, đúng bằng số dòng API danh sách trả `NEEDS_ACTION`; đã xoá dữ liệu thử.
  - 2 lần POST đồng thời cùng Idempotency-Key cho PO 68 → cả hai 201 cùng 1 phương án, DB chỉ có 1 dòng (đã xoá sau).
  - `GET /cutting-batch-solves` → 200, nhưng bản sao không có lượt tính trước nào nên N+1 ở đây chỉ kiểm bằng unit test.

## Cần làm khi gộp

Chạy migration `20261117180000_widen_cutting_waste_mm` trên DB dev chung và báo Sang.
