# K1 + K4 — danh sách lỗi còn tồn 16/11 (17/11/2026)

Nguồn: FE `docs/audit-2026-11-16-loi-con-ton-doc-code.html`, mục 3 (Kho / Mua hàng). Không có migration.

## K1. Xuất tiêu hao / đóng gói đọc tồn sai ô

`material-issues.service.ts` (`createInTx`) và `packaging-issues.service.ts` (`assertStockForSlip`, `createInTx`):

- **Trước:** câu đọc `stock_quant` chỉ lọc kho + vật tư rồi lấy 1 dòng bất kỳ. Từ khi tồn chia theo ô (độ dài cây, quy cách), vật tư có nhiều ô thì số tồn đọc ra là ngẫu nhiên, có thể cho xuất vượt tồn thật của ô bị trừ (âm kho).
- **Sau:** chỉ đọc ô `stockLengthMm = 0`, `spec = ''` — đúng ô mà sổ kho của 2 luồng này ghi vào (`postEntry` mặc định) và cũng là ô `getAvailableQty` tính giữ chỗ. Cùng cách phiếu "Dùng chung" đang làm.

## K4. Nhận hàng theo đơn đặt hàng đã "Thay phiếu"

`purchase-receipts.service.ts`:

- **Trước:** nhận hàng chỉ kiểm trạng thái dòng ("Đang mua"). Đơn "Thay phiếu" về nháp chờ Giám đốc ký lại nhưng dòng đã nhận dở vẫn "Đang mua", nên vẫn nhận tiếp được theo phiếu cũ.
- **Sau:** xem trước và nhận hàng chặn 409 khi đơn không ở trạng thái đã duyệt — "đang thay phiếu, chờ Giám đốc ký lại" hoặc "đã huỷ". Kiểm 2 lần: lúc đọc dòng, và trong transaction sau khoá đề xuất (khoá `FOR UPDATE` dòng đơn) — "Thay phiếu" cũng lấy cùng các khoá đề xuất nên không lọt xen giữa.
- **Không đổi:** "Từ chối nhận" vẫn làm được (hàng NCC giao tới vẫn phải trả lại được); dòng cũ không có đơn đặt hàng không kiểm.

## K4. Gỡ 2 dòng cuối cùng lúc để lại đơn nháp rỗng

`supplier-orders.service.ts` `removeItem`:

- **Trước:** "đơn rỗng" tính từ danh sách đọc trước transaction — 2 lần gỡ 2 dòng cuối chạy cùng lúc đều thấy còn 2 dòng nên không lần nào huỷ đơn.
- **Sau:** sau `lockDraft` (khoá đơn) mới gỡ (chỉ khi dòng còn trong đơn, không thì 409) rồi đếm số dòng còn lại; còn 0 thì huỷ đơn.

## Test

- Unit: thêm 8 test (5 nhận hàng, 3 gỡ dòng) + kiểm câu đọc tồn lọc đúng ô ở material/packaging issues. 248/248 nhóm liên quan; toàn bộ chỉ còn lỗi cũ của bộ giải tối ưu cắt.
- Integration 21/21.
- Thử sống trên bản sao DB dev (17/11):
  - Thay phiếu đơn 1/2026 (dòng 385 đã nhận 15/20,3): xem trước + nhận 409, không ghi phiếu; từ chối nhận được; "Sếp đã duyệt" lại thì nhận được.
  - Gỡ cùng lúc 2 dòng cuối, 3 lượt: cả 2 lệnh thành công, đơn tự huỷ.
  - Sơn bột ô 0 = 25 (15 giữ cho lệnh khác) + ô giả 6000 = 100: XK 20 bị chặn "khả dụng (10)"; XK 10 được, chỉ ô 0 giảm.
  - Đường đóng gói chưa thử sống (cần hàng qua Chuyền kiểm), chỉ có unit test.
