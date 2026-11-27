# Lỗi mức thấp — rà soát Mua hàng + Kho 14/11 (16/11/2026)

Bản rà soát (FE `docs/audit-2026-11-14-ra-soat-mua-hang-kho.html`, mục 05) chỉ mô tả được 3 trong khoảng 12 lỗi thấp, và IT đã review cả 3. Các mã còn lại (MH4–MH7, XK5, XK7, XK8, CK7–CK9, TĐ6) chưa từng có mô tả, kể cả trong bản gốc, nên chưa sửa được.

Không có migration.

## 1. Xoá NCC đang có đơn

`suppliers.service.ts` `remove`:

- **Trước:** xoá thẳng. Khoá ngoại chặn lại, và người dùng chỉ thấy câu chung "bản ghi đang được dùng ở chỗ khác" (lỗi 400).
- **Sau:** đếm trước đơn đặt hàng, báo giá và vật tư đang gắn NCC. Có thì báo 409, ví dụ: "Nhà cung cấp "X" đang có 2 đơn đặt hàng, 3 vật tư đang gắn NCC này - không xoá được. Tắt "Đang dùng" để ngừng chọn NCC này."

## 2. Số phiếu NK in trước chỉ người in dùng được

`purchase-receipts.service.ts` `receive`:

- **Trước:** ai cũng xác nhận nhập được bằng số NK người khác đã giữ lúc in, nên lệch dấu vết ai in, ai nhận.
- **Sau:** số NK phải là số do chính người xác nhận giữ (`createdById`). Số của người khác thì báo 400 "do người khác in - bấm "In phiếu nhập" để lấy số của mình".
- **Thay đổi hành vi:** thủ kho A in phiếu, thủ kho B bấm xác nhận nay bị chặn; B phải in số của mình.

## 3. Transaction phiếu chuyển kho 20 giây

`warehouse-transfers.service.ts`: tạo phiếu, chuyển mảnh, xác nhận, từ chối, kho gửi huỷ, đổi nơi nhận trước đây dùng thời gian chờ mặc định 5 giây. Nay dùng 20 giây (`TRANSFER_TX_OPTIONS`), cùng mức `createWorkshopMove`. Phiếu nhiều dòng phải khoá, kiểm tồn và ghi sổ từng dòng nên có thể hết 5 giây. Hết giờ thì rollback sạch như trước.

## Test

- **suppliers:** NCC có đơn / vật tư gắn kèm → 409 nói rõ, không xoá.
- **purchase-receipts:** đánh dấu dùng số NK kèm người giữ; số của người khác → 400.
- **warehouse-transfers:** 91 test qua.

## Rà lại 16/11 + sửa 5 lỗi Trung bình (17/11)

Rà lại 4 khu vực (Mua hàng, Kho xuất, Chuyển kho, Tồn đoạn) ra 21 lỗi - mô tả ở FE `docs/audit-2026-11-14-ra-soat-mua-hang-kho.html`
mục 05. Đã sửa các lỗi Trung bình:

- **CK7** `stock-ledger.service.ts` `assertAdjustLegs`: "Sửa nhanh tồn kho" phải đúng 1 chân kho thật + 1 chân kho ảo (Cân đối tồn kho);
  thủ kho chỉ sửa được kho thật của mình. Trước đây chỉ cần 1 chân thuộc phạm vi - chuyển được hàng từ kho thật khác về kho mình qua
  API, bỏ qua phiếu chuyển. FE "Tổng hợp kho" vốn luôn đối ứng OPENING_BALANCE nên không đổi.
- **XK5** `material-issues.service.ts`, `packaging-issues.service.ts`, `StockReservationsService.getAvailableQty`: làm tròn 4 số lẻ định
  mức × số lượng, đã xuất, còn lại, tồn khả dụng. Trước đây 0,57 × 100 = 56,99999999999999 chặn xuất đủ 57.
- **MH4** `PurchaseProposalsService.resolveReceiptRejected`: "Kho từ chối nhận" đóng khi lần giao sau của đề xuất được nhận
  (`PurchaseReceiptsService.receive`) hoặc đề xuất đủ hàng / đóng phần thiếu (`notifyIfFullyPurchased`). Trước đây không bao giờ đóng.
- **TĐ6** `SegmentStockService.releaseOrderHoldings` / `transferOrderHoldings`: khoá lệnh (`segmentProductionLockKey`, cùng khoá "tính
  lại") trước mọi khoá ô - không còn bị lượt tính lại sau KCS ghi đè.
- **TĐ8** `SegmentProductionService.recomputeInTx`, `SegmentStocktakeService`: giữ khoá chuyển đổi dữ liệu cũ (dùng chung) trước khoá
  lệnh / ô - không chạy chen lượt chuyển đổi.
- **TĐ7** (đổi xưởng chuyển cả phần dư sang kho mới): anh chọn tạm chấp nhận, ghi hạn chế vào quy trình bật công tắc
  (`docs/changelog-2026-11-14-ton-doan-phia-tru.md`). Sửa đúng cần tách `SegmentProduction` theo kho (migration, bảng của IT).

Test: stock-ledger (2 chân thật -> 400), material-issues (0,57 × 10 xuất 5,7 được), purchase-receipts + purchase-proposals (đóng "Kho từ
chối nhận"), segment-stock / transfer (khoá lệnh trước), segment-production + stocktake (khoá chuyển đổi trước).

