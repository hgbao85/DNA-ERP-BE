# K2 + K3 — danh sách lỗi còn tồn 16/11 (17/11/2026)

Nguồn: FE `docs/audit-2026-11-16-loi-con-ton-doc-code.html`, mục 3. Không có migration. FE có sửa nhỏ (nhánh demo).

## K2. `reserve()` trả dòng giữ chỗ đã nhả như đang giữ

`stock-reservations.service.ts` `reserve`:

- **Trước:** dòng cùng khoá đã RELEASED (phương án bị thay / lệnh xong rồi duyệt lại) được trả về nguyên trạng. Caller tưởng đã giữ chỗ, nhưng `getAvailableQty()` không trừ dòng RELEASED, nên lệnh khác lấy mất hàng.
- **Sau:** mở lại thành ACTIVE với số mới, không thấp hơn phần đã tiêu — cùng cách `reserveOrAdjust` / `creditPool`.
- Phần còn lại của K2 (P2002 khi nhận trễ, giữ chỗ không theo kho) đã sửa ở nhóm B 16/11. Giữ chỗ không theo chiều dài là chủ ý (xem comment `loadPool`).

## K3. "Sửa nhanh tồn kho" không khoá, không chặn âm, không xét giữ chỗ

`stock-ledger.service.ts` `adjust` + `postAdjustLockedInTx`:

- **Trước:** không gửi `expectedCurrentQty` thì ghi thẳng: không khoá, không chặn âm. Cả 2 nhánh đều không xét giữ chỗ.
- **Sau:**
  - Mọi lần sửa đều trong transaction, khoá `FOR UPDATE` đúng ô tồn sẽ ghi ở kho thật (vật tư: chiều dài + quy cách; mảnh; thành phẩm; đoạn: bộ công đoạn).
  - Giảm làm tồn âm → 400 "Tồn hiện có X - không giảm Y được (tồn sẽ âm)".
  - Tồn mới thấp hơn phần đang giữ cho lệnh / phiếu chuyển → **vẫn ghi** (số đếm thực tế là đúng — anh chốt 17/11), trả thêm `reservationWarning` nói rõ thiếu bao nhiêu.
  - Gọi lại cùng Idempotency-Key trả bút toán cũ TRƯỚC khi kiểm (tránh báo âm oan vì tồn đã trừ theo chính bút toán đó).
  - `expectedCurrentQty` vẫn so như cũ.
- `StockReservationsService.getReservedQty()` tách ra từ `getAvailableQty()` để biết phần đang giữ (getAvailableQty kẹp về 0). Vẫn đúng 1 chỗ cộng 2 bảng giữ chỗ.
- `StockLedgerService` nay inject `StockReservationsService` (cùng StockModule; test module nào tự dựng StockLedgerService phải provide thêm).
- Phần "xác nhận phiếu chuyển không kiểm lại tồn nguồn" đã sửa ở nhóm B (`assertSourceStockInTx`); chuyển giữa 2 kho thật đã chặn ở CK7.

**FE** (`MfgWarehousesPage.tsx`, `stock-api.ts`): có `reservationWarning` thì hiện hộp "Đã sửa tồn - thiếu hàng cho lệnh".

## Test

- Unit: +7 (K2 mở lại dòng nhả; K3 khoá ô, chặn âm, cảnh báo giữ chỗ, tăng không cảnh báo, gọi lại cùng key, chân mảnh). Toàn bộ chỉ còn lỗi cũ của bộ giải tối ưu cắt. Integration 21/21.
- Thử sống bản sao DB dev (Sơn bột, kho Sơn PA, giữ 15 cho PI 77):
  - Giảm 20 khi ô có 15, không gửi expectedCurrentQty → 400.
  - Ô 25, đếm còn 5 → ghi được + "thiếu 10"; gửi lại cùng key → bút toán cũ, không trừ lần 2.
  - Tăng tồn → không cảnh báo.
  - Giao diện "Quản lý kho" sửa 5 → 3 → hộp cảnh báo "thiếu 12", tồn cập nhật 3.
- K2 chưa thử sống (khó dựng phương án cắt duyệt lại trên dữ liệu thật), chỉ unit test.
