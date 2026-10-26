# Changelog 2026-09-30 — Review công thức quy ra số cây sắt Mua hàng cần mua

> Trạng thái: **CHỈ REVIEW, CHƯA SỬA CODE.** Các điểm cần xem ở mục 3 chờ người dùng quyết.

## 1. Yêu cầu

Người dùng: *"review là khi người mua hàng đi mua thì công thức tính sắt sẻ là như thế nào để quy ra
số cây cần mua"*.

## 2. Công thức hiện tại (đọc từ code)

1. **Bung định mức** (`CuttingProposalsService.buildBomRows/buildInvoiceJob`):
   `số đoạn = SL mảnh/bộ (BomPiece.qtyPerUnit) × SL đoạn/mảnh (PieceBom.qtyPerPiece) × số bộ`,
   gom theo (loại sắt, chiều dài đoạn); đợt gộp nhiều SKU thì cộng dồn rồi gửi `num_sets = 1`.
2. **Solver** (`DNA-DEXUAT cat_sat/de_xuat_logic.py::optimize_one_material/optimize_material`),
   riêng từng loại sắt: thử chiều dài chuẩn (`solverStockLengths`, mặc định 6000) trước; không đạt
   ngưỡng và được phép thì dò `min..max_length`. Ràng buộc: Σ(đoạn + lưỡi 1mm) ≤ L − tề đầu 10mm;
   hao hụt mỗi cây ≤ ngưỡng %; cắt ra ≥ nhu cầu và ≤ nhu cầu + `solverMaxSurplus` (10) đoạn/cỡ;
   ≤ 4 cỡ đoạn/cây. Mục tiêu: tối thiểu phế liệu, sau đó tối thiểu đoạn dư. Kết quả `totalBars`,
   `bestStockLengthMm`.
3. **Trừ tồn lúc duyệt** (`approve()`): `khả dụng` = tồn cùng vật tư + cùng kho + **cùng chiều dài
   cây** − giữ chỗ của phương án khác; `lấy từ kho = min(totalBars, khả dụng)` (giữ chỗ);
   `buyBars = totalBars − lấy từ kho`.
4. **Netting theo PI** (`computeNetRequirementByMaterial`): `Cần mua = max(0, Σ buyBars các phương án
   APPROVED của PI − đã chốt)`, đã chốt = `receivedQty` nếu PURCHASED, `buyQty` nếu QUOTING trở đi.
   Mua hàng thấy "Cần mua N cây" + chiều dài cây (`stockLengthMm`) ở `LenhMuaNCCPage.tsx`.

Ví dụ thật: Bàn J55 × 500 bộ, sắt hộp 25×50 = 2000 đoạn 200 + 1000×535 + 1000×680 + 1000×695 →
cần 2.315.000mm (kèm lưỡi) / 5990mm dùng được mỗi cây → cận dưới 387 cây; solver trả số ≥ 387.

## 3. Điểm cần xem (phát hiện khi review)

1. **Dư mua chỉ ghi log, Mua hàng không thấy**: khi nhu cầu tụt dưới phần đã chốt (`gross < firmed`,
   vd sửa giảm số lượng sau khi đã đặt), code chỉ `logger.warn(... Mua hàng cần xem lại)` — không có
   thông báo/cờ nào lên UI, nên thực tế không ai xem lại.
2. **Tồn khác chiều dài bị bỏ qua**: khả dụng lọc đúng `stockLengthMm` của phương án. Solver không
   biết tồn kho (không gửi tồn sang), nên nếu nó chọn cây dò 5900 trong khi kho còn cây 6000 cùng loại
   thì toàn bộ số cây được đề xuất mua mới, tồn 6000 nằm im.
3. **Cắt riêng từng SKU cộng dồn**: SKU duyệt riêng (`requestForOrder`) được tối ưu tách rời, rồi
   `Σ buyBars` — tổng ≥ số cây nếu tối ưu chung. Chỉ đợt gộp (`buildInvoiceJob`) mới tối ưu chung.
   Đúng thiết kế (lợi ích của "gộp"), ghi lại để người dùng biết.
4. **Không có dự phòng cho sắt**: mua đúng nhu cầu (+ tối đa 10 đoạn dư/cỡ do solver);
   `Material.purchaseWastePercentage` cố ý null với Sắt. Cắt hỏng/KCS không đạt đi luồng cấp bù.
   Câu hỏi nghiệp vụ, không phải bug.
5. **Quy đổi kg nếu NCC bán theo kg**: `khoUnitFactor` là hệ số cố định/vật tư, nhưng kg/cây phụ
   thuộc chiều dài cây (6000 vs cây dò) và độ dày — chưa xác minh sắt thật có dùng `purchaseUnit` hay
   không (seed dùng `unit = 'cây'`, không có đơn vị mua).
6. Liên quan: seed gộp sắt hộp 20×20 dày 0,8 và 0,6 thành 1 vật tư (xem
   `changelog-2026-09-30-danh-gia-ai-nhap-dinh-muc.md` mục 4) → Mua hàng sẽ mua chung 1 loại.

## 4. Chưa làm

- Chưa sửa gì. Chờ người dùng chọn điểm nào cần xử lý (ứng viên rõ nhất: mục 3.1 đưa cảnh báo dư mua
  lên UI Mua hàng; mục 3.2 ưu tiên dùng tồn khác chiều dài).
