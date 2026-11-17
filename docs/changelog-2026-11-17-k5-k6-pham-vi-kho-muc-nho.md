# K5 + K6 — danh sách lỗi còn tồn 16/11 (17/11/2026)

Nguồn: FE `docs/audit-2026-11-16-loi-con-ton-doc-code.html`, mục 3. Không có migration. FE có sửa (nhánh demo).

## K5. Đọc tồn / sổ kho / phiếu XK không lọc theo kho được giao

- `GET /stock-quant`, `GET /stock-ledger`: thủ kho chỉ đọc **cả họ kho** của mình. Ba họ: Phôi-Sơn-Hàn, Vật tư TP, Thành phẩm. Họ = kho gốc + kho phụ `{họ}-...`, theo `warehouseWhereForScope()` trong `warehouse-family.util.ts`.
  - Sổ kho lấy bút toán có ít nhất 1 chân thuộc họ.
  - Không lọc đúng từng mã kho. Lý do: nhiều tài khoản tổ Hàn/Sơn/KCS mang scope `phoi-son-han`, mà tồn thật nằm ở các kho chia Đợt 7. Lọc theo họ cũng khớp cách màn "Tổng hợp kho" vẫn lọc theo groupKey.
  - Tổng kho, Giám đốc, Admin (scope null) không bị lọc.
- `GET /issue-slips`: lọc đúng kho ngay trong câu truy vấn, cùng luật `inScope()`. Trước đây lấy 200 phiếu mới nhất của mọi kho rồi mới lọc, nên kho ít phiếu bị phiếu kho khác đẩy ra ngoài.
- `GET /issue-slips/:id`: phiếu kho khác → 403.
- `GET /stock-quant` không còn N+1: phần đang giữ lấy 1 lần cho mọi dòng qua `StockReservationsService.getReservedQtyMap()`, cùng điều kiện với `getReservedQty()`. Vẫn chưa phân trang; muốn phân trang phải đổi 5 màn FE đang gọi.
- **Không làm** `GET /material-issues`: người đọc là tổ Hàn/Sơn (nhận hàng), và đợt xuất không có cột kho. Lọc theo kho của vật tư sẽ làm tổ mất đợt của mình.

## K6. Các mục nhỏ

- **Số phiếu CK** (`nextTransferCode`): lấy số lớn nhất của đúng dạng `<prefix><chữ số>` rồi +1. Trước đây đếm mọi mã `startsWith(prefix)`: kho có mã ngắn là tiền tố của kho khác (vd `CK-ABC-` / `CK-ABC-X-`) bị đếm lẫn, ra số nhảy hoặc trùng (code @unique → lỗi tạo phiếu).
- **Xuất đóng gói — kho nguồn**:
  - Vật tư khai ở họ kho thành phẩm nay xuất từ **kho thành phẩm QLSX chọn cho lệnh**, xem `packagingSourceWarehouseCode()`. Đây cũng là nơi hàng mua về được nhập (`receiveWarehouseCode`) và giữ chỗ.
  - Áp dụng thống nhất cho kiểm tồn, khoá, ghi sổ, nhả giữ chỗ, kế hoạch (`materialWarehouseCode`, FE lọc thủ kho theo mã này) và phiếu XK.
  - Kho nguồn trùng kho đích (lệnh ở kho TP gốc) → ghi sang kho ảo `PRODUCTION`, tức là đã dùng. Trước đây báo lỗi "from == to" (07-08/10); lệnh ở kho TP phụ thì đọc tồn sai kho và thủ kho kho phụ bị chặn.
  - Vật tư khai ở kho khác: giữ nguyên như cũ.
- **Sửa đơn bán**: `PATCH /sales-orders/:id` nhận thêm `items[]` (id + các trường của `PATCH :id/items/:itemId`). Đơn và mọi dòng ghi trong **1 transaction**: 1 dòng lỗi (vd đổi số lượng đã ghim lệnh) thì không lưu gì. `PATCH :id/items/:itemId` vẫn còn, nay cũng chạy trong transaction.

**FE (nhánh demo):**

- `sales-orders-api.ts`: `updateSalesOrder` gửi 1 request có `items`, bỏ vòng patch từng dòng. Hiện chỉ màn Đơn hàng bán gọi, để bật/tắt cọc.
- `PhieuXuatPage.tsx`: thêm khoá `useRef` chống bấm "Tạo phiếu" 2 lần. BE tạo phiếu chưa có Idempotency-Key; muốn có phải thêm cột, tức là cần migration.
- Mua hàng:
  - Theo dõi / Lịch sử chỉ giữ dòng của chính người mua.
  - Đơn đặt hàng chỉ hiện đơn có dòng vật tư mình phụ trách. Đơn rỗng chỉ người lập và Giám đốc thấy.

## Test

- Unit: toàn bộ chỉ còn 2 lỗi cũ của bộ giải tối ưu cắt (3746 qua). Mới thêm:
  - K5: lọc stock-quant / stock-ledger / issue-slips, xem phiếu kho khác, batch giữ chỗ.
  - K6: số CK lấy max, đóng gói kho TP2 / nguồn = đích → PRODUCTION / kế hoạch, sửa đơn nhiều dòng (ghi đủ / 1 dòng lỗi không ghi gì).
- Integration 33/33.
- Thử sống bản sao DB dev (cổng 3011):
  - K5: `diem` (Sơn PA) chỉ thấy tồn 5 kho họ Phôi-Sơn-Hàn; `khotp2` thấy họ Thành phẩm; `quanh` thấy `vat-tu-tp`. Phiếu XK lọc đúng kho; xem phiếu kho khác 403, Admin xem được.
  - `availableQty` khớp SQL 39/39 dòng (17 dòng có giữ chỗ).
  - Đóng gói PO 63 (kho TP gốc): phiếu XK lập + xác nhận được, sổ ghi `thanh-pham → PRODUCTION` 2, tồn 40 → 38. Thủ kho TP2 lập cho lệnh này → 403. Kế hoạch PO 68 (lệnh ở TP2) trả mã kho TP2.
  - Sửa đơn 68 kèm 2 dòng, dòng 2 đổi số đã ghim → 409, đơn và dòng 1 không đổi; 2 dòng hợp lệ → lưu cả 3; đã trả lại như cũ.
  - Giao diện Mua hàng: `nhan` không còn thấy đề xuất PB-DH-G ở Theo dõi (chỉ `nghi` có dòng đang mua); `nghi` chỉ thấy đơn Sơn của mình, không thấy 3 đơn Thép của `nhan`.
- Chưa thử sống: số CK (chỉ unit test), khoá bấm 2 lần ở Phiếu xuất.
