# Phiếu đề xuất Excel (Mua hàng) — file trắng, bố cục theo mẫu, 3 cột số (23/11/2026)

Nút "In phiếu" ở Đơn đặt hàng / Lệnh mua vật tư (`GET /supplier-orders/:id/print`). **Có 1 migration** (`20261124120000_purchase_item_required_qty`), đã chạy trên DB dev chung 23/11. Không sửa FE.

## 1. Mở bằng Excel ra trắng

- **Nguyên nhân:** mẫu có cả `<outlinePr>` lẫn `<pageSetUpPr fitToPage>` trong `<sheetPr>`, và exceljs ghi 2 thẻ này sai thứ tự chuẩn OOXML (`pageSetUpPr` trước `outlinePr`). Excel coi file hỏng nên không mở / sửa thành trang trắng.
- **Vì sao test cũ không bắt được:** LibreOffice, openpyxl và chính exceljs vẫn đọc được file. Dữ liệu từ API tới trình duyệt vẫn đủ, trùng từng byte.
- **Sửa:** `renderPrintWorkbook` bỏ `outlineProperties` (mẫu chỉ có giá trị mặc định) trước khi ghi. Test mới soi XML thô của từng trang.

## 2. Bố cục theo ảnh mẫu phiếu thật

File mẫu `templates/phieu-de-xuat-mau.xlsx` dựng lại theo ảnh:

| Hàng | Nội dung |
|---|---|
| 1 | Tên công ty |
| 3 | PHIẾU ĐỀ XUẤT |
| 4 | Ngày dạng `dd/mm/yyyy` |
| 6 | "Kính gửi:" cùng hàng với "- Giám đốc Công ty …" |
| 8–9 | Nhãn ở cột A, giá trị ở cột C |
| 10 | Nội dung đề xuất |
| 12 | Tiêu đề bảng |
| 13–27 | 15 dòng vật tư |
| 29–36 | Ký tên |

- Độ rộng cột theo ảnh mẫu: cột "Số lệnh sản xuất" rộng 25.
- "(ký, ghi rõ họ tên)" không nghiêng.
- Bỏ dòng "- Bộ phận kế toán" (anh chốt).
- Ô tự xuống dòng (tên vật tư, số lệnh, ghi chú): hàng tự cao theo số dòng chữ (`wrappedLineCount`). Mẫu đặt chiều cao cố định 24pt nên Excel không tự giãn, trước đây chữ bị che.

## 3. Ba cột số + ghi chú (anh chốt 23/11)

| Cột | Trước | Sau |
|---|---|---|
| Số lượng còn tồn kho | Tồn lúc **in**: gồm cả hàng mua về cho chính dòng đó (đơn PB NCC Sơn 1/2026 in ra 15) | Tồn vật lý **lúc tính** dòng mua (`actualStock`) |
| Số lượng theo Định mức | Số cần mua (đã trừ tồn, đã cộng hao hụt) | Nhu cầu theo định mức thuần (`requiredQty` mới) |
| Số lượng đề xuất | Số cần mua; phần mua dư thành dòng riêng "Mua dư → nhập tồn" | Số thật sự đặt mua (gồm mua dư); bỏ dòng riêng |
| Ghi chú | Mã hàng | Chỉ "Hao hụt x%: +y"; không có hao hụt thì trống |

Cột "Số lệnh sản xuất" ghi số đề xuất của từng lệnh.

Quy tắc gộp nhiều dòng cùng vật tư:
- Định mức: cộng theo lệnh. Các dòng của cùng 1 lệnh (dòng đã ký + dòng phần thêm) lấy số lớn nhất, không cộng trùng.
- Tồn lúc tính: lấy số lớn nhất.

**`PurchaseProposalItem.requiredQty`** (Decimal(14,4), null được) được ghi lúc tính bởi:
- Vật tư tiêu hao: `required`.
- Vật tư thành phẩm theo công thức: `requiredInputQty`.
- Nguyên liệu mảnh: `bars`.
- Sắt: số cây chiều dài mua theo phương án cắt.
- Dòng mua lại phần thiếu: `requiredQty = reorderQty`, `appliedWastePct = 0`, để không cộng hao hụt lần 2.

**Dòng tạo trước cột này:** định mức suy ra = cần mua ÷ (1 + hao hụt). Cách suy đúng khi lúc tính không lấy hàng từ tồn. Hao hụt dùng `appliedWastePct`, chưa có thì lấy `% hao hụt khi mua` hiện tại của vật tư.

## Test

- Phiếu in: 11 test (file mở được bằng Excel, bố cục, chiều cao hàng, 3 cột số, ghi chú, dòng cũ, dòng cùng lệnh).
- 3 module nguồn mua hàng: 1188/1188, đã cập nhật số định mức ghi vào từng dòng.
- Unit toàn bộ: chỉ còn lỗi cũ của bộ giải tối ưu cắt; `solver-worker-host` chỉ hỏng khi máy chạy nặng, chạy riêng qua 13/13.
- Integration chưa chạy (Docker tắt).
- Thử sống: in đơn thật PB NCC Sơn 1/2026 qua BE dev, mở bằng Excel thật (COM) → tồn 0, định mức 20, đề xuất 20.3, ghi chú "Hao hụt 1.5%: +0.3".
- Chưa thử tính lại một lệnh thật để xem `requiredQty` được ghi (tránh ghi DB dev); có unit test.
