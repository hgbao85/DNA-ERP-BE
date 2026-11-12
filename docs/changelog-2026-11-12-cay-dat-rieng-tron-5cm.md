# Changelog 12/11/2026 - Cây sắt đặt riêng luôn tròn 5 cm

## Lý do
Màn Kế hoạch SX → Tối ưu cắt sắt → "Kết quả đã tính" ra cây đặt riêng lẻ như 5m36, 5m41. Máy dò chiều dài bắt đầu từ
(đoạn dài nhất + tề đầu) rồi tăng theo bước cấu hình 10 mm, nên điểm dò không thẳng hàng với bội 5 cm. Xưởng chỉ đặt cây tròn
5 cm (ghi ở changelog 2026-10-02: "5–6,5 m, tròn 0/5 cm"). Yêu cầu: chiều dài cây đặt riêng làm tròn LÊN bội 50 mm
(5m36 → 5m40, 5m41 → 5m45, 5m45 giữ), và số cây / hao hụt / cách cắt phải tính trên chính cây đã tròn.

## Quyết định (người dùng chốt)
- Máy chỉ THỬ các chiều dài bội 50 mm rồi chọn chiều dài đầu tiên đạt ngưỡng; KHÔNG lấy kết quả cũ rồi đổi nhãn (phần dài thêm
  sẽ thành sắt thừa, có thể vượt ngưỡng 1 %). Hệ quả: có ca ra 5m45 thay vì 5m40 nếu cây 5m40 hao quá ngưỡng.
- Bội 5 cm cố định trong code, không theo cấu hình. Bước dò ở cấu hình chỉ nhận bội 50 (50 = thử từng 5 cm, 100 = từng 10 cm).
- Chiều dài KHSX gõ cho từng loại sắt (ô "Chiều dài cây sắt", dùng khi NCC không có cây mình muốn) vẫn cho gõ, nhưng được làm tròn
  lên 5 cm khi tính và khi đặt mua (gõ 5830 → tính và mua 5850).
- Cây chuẩn công ty (đang 6 m) giữ nguyên.
- Phương án đã tính / đã duyệt / đã đặt mua trước khi sửa giữ nguyên; chỉ lần tính mới hoặc "Tính lại" mới ra bội 5 cm.
- Đơn mua sắt đặt riêng, giữ tồn khi duyệt, phiếu xuất sắt không sửa: các chỗ này lấy chiều dài trên dòng phương án nên tự theo.

## Sửa (BE)
- `solver-ts/stock-length-grid.ts` (mới): hằng số lưới 50 mm, hàm làm tròn lên / xuống, hàm chọn chiều dài cho 1 loại sắt
  (chiều dài riêng → làm tròn lên; không có → cây chuẩn giữ nguyên).
- `solver-ts/optimize-one-material.ts`: dò từ bội 50 đầu tiên ≥ max(min, đoạn dài nhất + tề), bước = bước cấu hình làm tròn lên
  bội 50 (tối thiểu 50), không vượt bội 50 lớn nhất ≤ max.
- `solver-ts/propose.ts`: chiều dài riêng từng loại sắt gửi vào bộ giải được làm tròn lên bội 50.
- `cutting-proposals.service.ts` (`resolveStockLengths`): ước tính nhanh / gợi ý cách sửa / xác minh cũng dùng chiều dài đã tròn.
- `system-config/dto/update-system-config.dto.ts`: `solverLengthStepMm` phải ≥ 50 và là bội 50, sai thì báo lỗi tiếng Việt.
- `prisma/schema.prisma` + migration `20261112020000_solver_length_step_50mm`: mặc định bước dò 10 → 50; dòng cấu hình đang lưu số
  không phải bội 50 được nâng lên bội 50 gần nhất phía trên (10 → 50). Đã chạy ở DB local; bản thật tự chạy khi deploy.
- `docs/business/cutting.md`: sửa 3 chỗ còn ghi "bước 10 mm".

## Sửa (FE)
- `CuttingSolvePanel.tsx`: bảng "Kết quả đã tính" hiện chiều dài cây theo mm ("5400 mm", "6000 mm") thay cho "5m40" / "6m"
  (người dùng yêu cầu 12/11), cùng đơn vị với cỡ đoạn cắt và số gõ ở ô chiều dài.
- `GomDotCatPage.tsx`: ô "Chiều dài cây sắt" vẫn cho gõ. Gõ số không tròn 5 cm thì ngay dưới ô báo "… 5830 mm sẽ tính và đặt mua là 5m85"; dòng tóm
  tắt hiện chiều dài đã tròn. Câu ghi chú / câu lỗi đưa ra ngoài lưới (trước đây câu lỗi dài làm cột tên sắt bị bóp xuống dòng).

## Còn lại
- Ô Admin "Bước dò chiều dài (mm)" (Cấu hình hệ thống → Máy cắt) đang cho nhập 1–1000: cần đổi thành 50–1000 bước 50 và thêm chữ
  hướng dẫn "chiều dài cây đặt riêng luôn tròn 5 cm", nếu không Admin lưu số không phải bội 50 sẽ bị BE báo lỗi.
- Bản thật: sau deploy, kiểm lại cấu hình bước dò đã thành 50.

## Kiểm tra
- Test khoá: làm tròn lên bội 50 (5360→5400, 5411→5450, 5460→5500, 5010→5050, 5960→6000, 5450 giữ), chiều dài riêng làm tròn,
  dò chỉ thử bội 50 (bước 10 → 5400, 5450…; bước 60 → 100; max 6020 → 6000; min 5010 → 5050), bộ giải nhận 5360 ra 5400,
  bước dò 10/25/60 bị từ chối, 50/100/1000 hợp lệ. Kỳ vọng cũ theo bước 10 mm đã chuyển sang bội 50.
- `jest src/modules/cutting-proposals/solver-ts src/modules/system-config cutting-proposals.service.spec.ts`: 307/307.
  `tsc` chỉ còn 2 lỗi cũ ở `prisma/seed-*.ts`; `nest build` sạch; eslint sạch các file đã sửa. FE: `tsc` sạch, eslint 0 lỗi.
- DB local: chạy lại đúng dữ liệu của một lượt cũ từng ra cây 5030 / 5020 → nay cả hai loại sắt ra 5050, hao hụt 0,78 % / 0,83 %
  (dưới ngưỡng 1 %). Lượt gộp 2 SKU thử trên màn ra cây chuẩn 6 m như trước. Gõ 5830 ở ô chiều dài → chip ước tính hiện "cây 5m85".
  "Kết quả đã tính" hiện "6000 mm" ở cột Chiều dài cây.
- Review (Loopwright, 2 lượt mỗi vòng): 3 vòng; vòng 1 thiếu sửa `docs/business/cutting.md`, vòng 2 tên test còn mã nội bộ
  (đã bỏ, khoá lại), vòng 3 đạt.
