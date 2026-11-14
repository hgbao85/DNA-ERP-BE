# 14/11/2026 - Tồn đoạn theo lệnh: phía trừ, sổ báo vượt, đổi xưởng, kiểm kê đoạn, chuyển đổi dữ liệu cũ (Bảo)

Nối tiếp `changelog-2026-11-13-ton-doan-theo-lenh.md` (khung + phía cộng của Sang). Vẫn **mặc định TẮT** (`SEGMENT_STOCK_ENABLED`):
công tắc tắt thì Hàn / Sơn trừ đoạn y như cũ, đổi xưởng không đụng tồn đoạn. Riêng kiểm kê đoạn và sổ báo vượt chạy cả khi tắt
(sổ trống vì chưa có gì ghi vào).

## Thay đổi

1. **Migration `20261113200000_segment_overages`** (chỉ thêm, ĐÃ chạy trên DB dev chung): bảng `segment_overages` + enum
   `SegmentOverageKind` (OVER_REPORT / REWORK). Unique (đợt báo, mã đoạn).
2. **Phía trừ** (`ProductionBatchesService.consumeSegmentsByCode`, chỉ khi bật công tắc):
   - gộp định mức mảnh theo MÃ ĐOẠN (cỡ + `normalizeSegmentSteps`), gọi `SegmentStockService.consumeForOrder` (giữ của lệnh → dư → thiếu);
   - khoá chống trùng `production-batch-segment-consume:{đợt}:{cỡ}:{bộ công đoạn}` (khác khoá cũ `...:{đợt}:{cỡ}`);
   - KHÔNG chặn Hàn / Sơn (câu 2, 7). Ghi 1 dòng sổ báo vượt khi thiếu đoạn và / hoặc đợt làm số mảnh vượt số lượng lệnh
     (`overPieces`, `extraQty` = số lấy thêm). Trước đó KCS đã chấm lỗi mảnh / công đoạn này hoặc đợt là làm lại → REWORK (câu 6), không thì OVER_REPORT;
   - đợt đã có dòng sổ cho mã đoạn thì gọi lại bỏ qua (lần đầu không trừ được gì thì không có bút toán để nhận ra trùng).
3. **Sổ báo vượt** - module mới `segment-overages`:
   - `GET /segment-overages?status=open|resolved|all&productionInvoiceId=` (PRODUCTION_BATCH VIEW). QLSX gắn xưởng chỉ thấy lệnh xưởng mình.
   - `POST /segment-overages/:id/resolve {reason}` (QLSX / Admin, lý do ≥ 3 ký tự): đóng có điều kiện `resolvedAt IS NULL` (2 người bấm cùng lúc → 409), ghi audit log, chặn QLSX xưởng khác.
   - Chưa có thông báo cho QLSX khi phát sinh dòng mới - chờ anh Nhân trả lời ý 2.
4. **Đổi xưởng** (câu 8): `SegmentStockService.transferOrderHoldings` (hàm mới trong file của Sang), gọi trong transaction đổi xưởng
   (`WorkshopMoveService.afterWorkshopChanged`) khi bật công tắc:
   - phần lệnh CÒN GIỮ ở kho Phôi khác → bút toán WAREHOUSE_TRANSFER sang kho Phôi xưởng mới + giữ cho lệnh ở kho mới; nhật ký TRANSFER 2 chiều;
   - kho cũ không đủ tồn thật (dữ liệu cũ) → chỉ chuyển phần có, phần còn lại nhả (RELEASE);
   - `segment_productions.warehouseId` của lệnh đổi sang kho mới (phía cộng lần sau ghi vào kho mới). Cột dư không chuyển (của chung xưởng cũ).
5. **Kiểm kê đoạn**: `POST /segment-stock/stocktake` (STOCK UPDATE, thủ kho chỉ kho mình, chỉ kho loại PHOI): nhập số đếm 1 mã đoạn,
   so `expectedCurrentQty` (lệch → 409), ghi phần chênh ADJUST đối ứng "Cân đối tồn kho" (OPENING_BALANCE). Khoá cùng khoá ô với
   phía cộng / phía trừ. Không đụng phần giữ của lệnh - chênh vào / ra cột Dư.
6. **Chuyển đổi dữ liệu cũ** (câu 10): `POST /segment-stock/legacy-conversion {dryRun}` (chỉ Admin, mặc định xem thử):
   - 1 transaction: ô đoạn cũ (trừ PRODUCTION / OPENING_BALANCE) về 0 bằng ADJUST → phía cộng mọi lệnh chưa kết thúc
     (`SegmentProductionService.recomputeInTx`, tách từ `recomputeForPi` - file của Sang) → phát lại phía trừ theo mã đoạn cho đợt
     Hàn / Sơn cũ có bút toán SEGMENT_CONSUME khoá cũ, của lệnh chưa kết thúc (không ghi sổ báo vượt, thiếu trả trong báo cáo);
   - xem thử chạy y hệt rồi rollback; chạy thật cần bật công tắc và bảng giữ đoạn / phía cộng còn trống (chạy đúng 1 lần).
   - Xem thử trên DB dev 14/11: 6 ô âm về 0 (−30, −30, −30, −60, −10, −20), 2 lệnh PB đang chạy, 3 đợt Hàn trừ lại, thiếu 180 (dữ liệu thử chưa có KCS Phôi). Chạy lại ra đúng số cũ → rollback đúng.
7. **FE** (nhánh `ton-doan-phia-tru` của FE):
   - Kho phôi (tổ Phôi) đọc `/segment-stock/balances`: tách theo mã đoạn, cột Tồn / Giữ cho lệnh / Dư, chọn kho xưởng, hiện số âm (có cảnh báo), cỡ số lẻ không còn bị bỏ;
   - thủ kho kho Phôi: tab mới "Tồn đoạn" (cùng màn, khoá đúng kho mình) + nút Kiểm kê từng mã đoạn;
   - QLSX: tab "Sổ báo vượt đoạn" (đóng dòng có lý do); Giám đốc chỉ xem;
   - Lịch sử kho: SEGMENT_PRODUCE hiện "Tổ Phôi"; dòng đoạn có công đoạn hiện thêm "· Dập".

## Kiểm tra

- Jest: production-batches, segment-stock (kể cả spec mới chuyển đoạn / kiểm kê), segment-overages, warehouse-transfers, production-invoices đều đạt; tsc + eslint sạch.
- Trên server dev thật (công tắc tắt): API sổ báo vượt 200 / 400 / 404; kiểm kê 409 / 403 / 400 không ghi gì; xem thử chuyển đổi như mục 6.
- Trình duyệt: thủ kho Phôi Phước An thấy tab Tồn đoạn (−20, −10 + cảnh báo), hộp kiểm kê tính đúng chênh (đã Hủy, không ghi); QLSX thấy Sổ báo vượt đoạn.
- CHƯA thử khi bật công tắc trên DB thật (trừ theo mã đoạn, ghi sổ, đổi xưởng chuyển đoạn) - cần bản sao DB local.

## Trước khi bật `SEGMENT_STOCK_ENABLED`

1. Chạy `legacy-conversion` xem thử trên production, đối chiếu sổ thủ kho Phôi, rồi bật công tắc và chạy thật.
2. Chạy song song 3–5 ngày với sổ thủ kho Phôi.

## Bổ sung 14/11 chiều - anh Nhân trả lời ý 2 (sổ báo vượt)

- Thông báo mới `SEGMENT_OVERAGE_REPORTED` (ACTION_REQUIRED, WARNING) cho QLSX khi đợt Hàn / Sơn ghi sổ báo vượt: gửi SAU khi
  transaction trừ đoạn commit, 1 thông báo / đợt (dedupeKey theo đợt), QLSX xưởng khác tự bị bỏ (piCode), tiêu đề hiện số LSX.
  Bấm vào mở tab "Sổ báo vượt đoạn". Tự đóng khi QLSX đóng hết dòng của đợt.
- KHSX: tab "Sổ báo vượt đoạn" chỉ xem (Giám đốc đã có ở MfgApp).
- Ý 3 (cộng dần sau mỗi lần KCS đạt) khớp code đã có. Ý 1 (mã đoạn) Sang đang đề xuất lại với anh Nhân.
