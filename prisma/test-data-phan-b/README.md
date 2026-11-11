# Dữ liệu thử PB (phiên test kho 12/11/2026) - cách làm lại từ đầu

Thư mục này dựng bộ dữ liệu thử "PB" trên DB dev dùng chung bằng service thật. Dữ liệu nền (khách "PB Khách thử",
NCC "PB NCC Thép"/"PB NCC Sơn", điểm đan PB-Đ, sản phẩm PB-SP1/PB-SP2 + BOM) do `prisma/seed-test-phan-b.ts` tạo và
**không bị xoá** khi reset.

## Thứ tự chạy (đúng thứ tự này)

Chạy từ thư mục `D:\DNA-ERP-BE` (Git Bash). Nên dùng kết nối trực tiếp `DIRECT_DATABASE_URL` thay cho pooler: pooler
`pooled.db.prisma.io` đôi lúc trả về kết nối bị client khác đặt `search_path=''` và script dừng giữa chừng với lỗi
`relation "..." does not exist`.

```bash
cd /d/DNA-ERP-BE
export DATABASE_URL="$(grep '^DIRECT_DATABASE_URL=' .env | sed "s/^DIRECT_DATABASE_URL=//; s/^'//; s/'\s*$//")"
export NODE_PATH="D:/DNA-ERP-BE/node_modules"
TS="npx ts-node --transpile-only -P tsconfig.json"

# 1. Xoá sạch mọi thứ của PB (xem trước bằng --dry, đọc kỹ rồi mới chạy thật)
$TS prisma/test-data-phan-b/reset-pb.ts --dry
$TS prisma/test-data-phan-b/reset-pb.ts
$TS prisma/test-data-phan-b/reset-pb.ts --dry      # chạy lại: phải không còn bảng nào trong danh sách

# 2. Dựng PBA-1 + booking PB-BK (mất ~2 phút)
$TS prisma/test-data-phan-b/build-pb-a.ts

# 3. Dựng PBP-1, PBG-1 + PBG-2, PBD-1 (mất ~2 phút; cuối cùng tự in hiện trạng)
$TS prisma/test-data-phan-b/build-pb-pgd.ts

# 4. Tồn đầu kỳ (SAU khi dựng, để không ảnh hưởng giữ chỗ lúc Sếp duyệt)
$TS prisma/test-data-phan-b/opening-stock-pb.ts

# 5. Đặt lại "kho đang làm" của thủ kho
$TS prisma/seed-warehouse-keepers.ts --apply
```

Kiểm lại: `$TS prisma/test-data-phan-b/verify-pb-a.ts` (PBA-1) và `$TS prisma/test-data-phan-b/build-pb-pgd.ts --report`
(PBP/PBG/PBD).

## reset-pb.ts làm gì

- Neo: đơn hàng của khách PB, dòng đơn/PI item của PB-SP1/PB-SP2, PI chứa các dòng đó, NCC PB (đơn đặt hàng, phiếu nhận,
  bộ đếm số đơn), điểm đan PB-Đ, tồn đầu kỳ `PB-OPEN`. Từ đó lan theo khoá ngoại xuống mọi bảng con, cộng phiếu XK,
  phiếu chuyển kho, giữ chỗ, sổ kho, thông báo, audit log.
- Sổ kho được trừ ngược khỏi `stock_quant` trước khi xoá; dòng tồn về 0 mà chỉ PB tạo thì xoá.
- Bộ đếm số phiếu NK/XK theo ngày chỉ xoá khi mọi phiếu của ngày đó đều là của PB; bộ đếm số đơn của 2 NCC PB xoá hẳn
  (đơn đầu tiên sau reset là "Số 1/2026").
- **Dừng, không xoá gì** (in "DỪNG ...") nếu PI / phương án cắt / đơn đặt hàng / phiếu XK / phiếu chuyển kho / phiếu nhận /
  booking của PB có lẫn dòng không thuộc PB (vd tester gộp vật tư của lệnh khác vào cùng đơn NCC PB). Khi đó tự xử lý
  dòng lạ trước rồi chạy lại.
- Không đổi người dùng: `warehouseScope` của thủ kho do bước 5 đặt lại.

## Trạng thái sau khi dựng (bản 11/11)

| Lệnh | Xưởng | Trạng thái chính |
|---|---|---|
| PBA-1 (PB-SP1 ×20) | Phú An | Đã duyệt, Bắt đầu; HAN/SƠN PB-A 15 + PB-B 30; pat PB-C 16 vào kho TP; PB-B 20 vào kho TP; xuất đan PB-A 10 + nhận đan 10; chuyền kiểm A8/B16/C16; đóng gói 6 thùng; booking PB-BK DRAFT 8 |
| PBP-1 (PB-SP1 ×10) | Phước An | Đã duyệt, Bắt đầu; HAN PB-B 10 (Kho Hàn Phước An); mọi dòng mua NEW |
| PBG-1 + PBG-2 (PI gộp) | Phú An | Đã duyệt; sơn bột VTK-004 đặt NCC Sơn, **chỉ nhận 15/20,3** (Diễm, Kho Sơn PA) và giữ chỗ 15 cho PI - để test chặn ưu tiên SKU sớm (SKU 1 cần ~10,15, SKU 2 chỉ còn ~4,85) |
| PBD-1 (PB-SP2 ×10) | Phú An | Đã duyệt; SAT-001 5 cây 6000 mm + tán rút TR-001 81,2 đã nhận và giữ chỗ ở Kho Phôi PA; SAT-002 đã đặt (đơn duyệt) chưa nhận |

Tồn đầu kỳ (opening-stock-pb.ts): Kho Phụ kiện DAY-010 50, DINH-001 300, NN-001 300, CHAN-NHOM-01 100; Kho thành phẩm
VTK-352 40; Kho Phôi Phú An SAT-015 10, SAT-009 (bánh đá cắt) 30.
