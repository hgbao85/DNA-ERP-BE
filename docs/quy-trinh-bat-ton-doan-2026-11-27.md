# Quy trình bật tồn đoạn (`SEGMENT_STOCK_ENABLED`) — 27/11/2026, sửa 28/11

Gom từ quản lý chốt câu 10 (26/11, trả lời thêm 27/11) và quy trình bật đã chốt 16/11 (`docs/changelog-2026-11-14-ton-doan-phia-tru.md`,
mục "Trước khi bật").

**Quản lý trả lời 27/11:**
- Ngày nghỉ để kiểm kê: chốt sau khi chạy thử trên bản thử ổn.
- Kho Hàn cũng đếm số thanh phôi. Sơn chỉ đếm số mảnh, không đếm thanh phôi.

**Đã chọn (28/11): bật cùng giao nhận giữa tổ (`STAGE_HANDOVER_ENABLED`).** Đoạn Phôi giao cho Hàn đi phiếu giao đoạn, nằm ở kho
Hàn; thủ kho Hàn kiểm kê kho mình. Vì vậy **tồn đoạn bật cùng ngày với giao nhận giữa tổ, sau khi IT làm xong đợt 2 của 5 tính
năng xưởng / kho**. Code kiểm kê kho Hàn đã có (28/11, xem cuối file).

**Thứ tự bắt buộc:**
- Chuyển đổi dữ liệu cũ chạy thật **chỉ được khi công tắc tồn đoạn đã bật**.
- Chuyển đổi chỉ chạy được **một lần, khi chưa có dữ liệu tồn đoạn theo lệnh**. Nếu đã bật mà có người báo Hàn / Sơn gửi KCS
  hoặc KCS chấm trước khi chuyển đổi chạy, chuyển đổi sẽ bị từ chối.
- Chuyển đổi đưa mọi ô tồn đoạn cũ về 0, nên **giao đoạn sang Hàn và kiểm kê phải làm SAU chuyển đổi**.
- Lúc bật, thanh phôi đang nằm ở tổ Hàn vẫn tính trong kho Phôi (trước đó chưa có giao nhận). Phải chuyển sang kho Hàn bằng
  **phiếu giao đoạn**, không dùng kiểm kê: phiếu chuyển cả phần giữ của lệnh. Kiểm kê chỉ sửa cột Dư, không đụng phần giữ của lệnh;
  dùng kiểm kê để "chuyển" thì kho Phôi còn giữ ảo cho lệnh, kho Hàn có dư không gắn lệnh.

## A. Trước ngày bật

| # | Việc | Ai | Ghi chú |
|---|---|---|---|
| A1 | Làm xong đợt 2 của 5 tính năng xưởng / kho (giao nhận giữa tổ) | IT | Điều kiện để bật giao nhận cùng ngày. Lượt 1 (đầu kỳ + 2 lỗi câu 1) xong 28/11 |
| A2 | Chạy thử trên bản thử (bản sao DB): bật cả 2 công tắc, chạy chuyển đổi, lập phiếu giao đoạn Phôi → Hàn, cho Phôi / Hàn / Sơn / KCS báo như thật, kiểm kê thử cả kho Phôi lẫn kho Hàn | IT | Quản lý chốt: thử ổn mới chốt ngày nghỉ |
| A3 | Hỏi quản lý ngày xưởng nghỉ để kiểm kê | IT | Sau A2 |
| A4 | Trên production (công tắc còn tắt): chạy chuyển đổi **xem thử** `POST /api/v1/segment-stock/legacy-conversion` `{ "dryRun": true }` bằng tài khoản Admin. Đối chiếu báo cáo với sổ thủ kho Phôi | IT + thủ kho Phôi | Xem thử chạy rồi rollback, không ghi gì |
| A5 | Báo trước cho QLSX, tổ trưởng Phôi / Hàn / Sơn, KCS: ngày nghỉ đó không báo sản lượng, không gửi KCS, không chấm KCS | Quản lý / QLSX | Hệ thống chưa có khoá, chỉ dựa vào dặn |
| A6 | Không đổi xưởng lệnh đã có đoạn cắt dư từ giờ tới lúc sửa | KHSX | Hạn chế đã biết TĐ7 (16/11): phần dư bị ghi sang kho mới |
| A7 | Có tài khoản thủ kho Hàn từng xưởng (gán đúng kho Hàn, quyền STOCK xem / sửa) | Admin | Thủ kho Hàn kiểm kê kho mình |
| A8 | Chuẩn bị người có quyền sửa biến môi trường BE trên Render | IT | |

## B. Ngày xưởng nghỉ

| # | Việc | Ai | Ghi chú |
|---|---|---|---|
| B1 | Xác nhận không còn ai báo sản lượng / gửi KCS / chấm KCS. Hàn bấm Gửi KCS hết các mảnh đã hàn xong | QLSX / tổ Hàn | Thanh phôi đã hàn vào mảnh thì không đếm được nữa |
| B2 | Render: đặt `SEGMENT_STOCK_ENABLED=true` và `STAGE_HANDOVER_ENABLED=true` cho BE, chờ server khởi động lại xong | IT | Giao nhận cần tồn đoạn bật mới có tác dụng |
| B3 | **Ngay sau khi server lên:** chạy chuyển đổi **thật** `{ "dryRun": false }`. Lưu báo cáo trả về | IT | Báo "Đã có dữ liệu tồn đoạn theo lệnh" = có người báo chen vào: tắt công tắc, dọn dữ liệu vừa sinh rồi làm lại B2–B3 |
| B3b | QLSX mở "Sản lượng xưởng" > tab "Giao nhận giữa tổ", bấm **Ghi đầu kỳ** (1 lần, ngay sau B3): số đã báo Hàn / Sơn trước ngày bật thành "đã nhận" | QLSX | Câu 2 chốt 28/11 (cách 1). Ghi muộn sẽ tính cả phần báo sau ngày bật |
| B3c | Thủ kho Hàn Phú An đếm khung đã Hàn đạt đang chờ ở tổ Sơn, nhập ở "Phân phối nội bộ" > "Giao khung cho Sơn" > khối **Đầu kỳ** (mỗi SKU, mảnh 1 lần) | Thủ kho Hàn Phú An | Sơn coi như đã nhận, khung vào tồn kho Sơn |
| B4 | Tổ Hàn đếm thanh phôi còn ở tổ, **theo lệnh và mã đoạn** | Tổ trưởng Hàn | Để lập phiếu giao đoạn đúng lệnh |
| B5 | Thủ kho Phôi lập **phiếu giao đoạn** cho Hàn đúng số B4, thủ kho Hàn xác nhận phiếu | Thủ kho Phôi + thủ kho Hàn | Chuyển cả phần giữ của lệnh sang kho Hàn |
| B6 | Thủ kho Phôi đếm đoạn còn ở kho Phôi, nhập tại tab **Tồn đoạn**, nút **Kiểm kê** từng mã | Thủ kho Phôi | Nhập SỐ ĐẾM, không phải số chênh; hệ thống tự ghi phần chênh |
| B7 | Thủ kho Hàn mở tab **Tồn đoạn** (tiêu đề "Thanh phôi tại kho Hàn"), kiểm kê nếu còn lệch sau B5 | Thủ kho Hàn | Chỉ hiện khi bật giao nhận giữa tổ |
| B8 | Kế toán hoặc KCS kiểm lại số đếm | Kế toán / KCS | Quản lý chốt 26/11 |
| B9 | Thủ kho Sơn đếm số mảnh, nhập tại tab **Tồn mảnh**, nút **Kiểm kê** từng mảnh | Thủ kho Sơn | Có từ 28/11. Chỉ hiện mảnh đã có dòng tồn ở kho Sơn |
| B10 | Báo các tổ báo sản lượng lại bình thường | QLSX | |

## C. Sau khi bật

| # | Việc | Ai | Ghi chú |
|---|---|---|---|
| C1 | Chạy song song 3–5 ngày: so tồn đoạn trên hệ thống với sổ thủ kho Phôi và kho Hàn mỗi ngày | Thủ kho + IT | Quy trình 16/11 |
| C2 | Theo dõi tab "Sổ báo vượt đoạn" và thông báo báo vượt của QLSX | QLSX | |
| C3 | Lệch nhiều, không giải thích được: báo IT xem trước, đừng tắt công tắc ngay | IT | Tắt lại sau khi đã chạy thì Hàn / Sơn quay về trừ kiểu cũ vào dòng trơn, tồn đoạn theo lệnh đã ghi đứng yên - bật lại sẽ lệch |

## Chỗ hở

1. **Không có khoá báo sản lượng lúc kiểm kê.** B1 chỉ dựa vào dặn miệng (28/11: tạm không làm - hệ thống đã tự chặn chuyển đổi
   khi có người báo chen, và kiểm kê báo lệch khi tồn vừa đổi).
2. **Kiểm kê mảnh ở kho Sơn: đã có (28/11).** Tab "Tồn mảnh" của thủ kho Sơn (`KiemKeManhPage`); BE `POST /stock-ledger/adjust`
   nay so tồn lúc mở (`expectedCurrentQty`) cả với `pieceId`. Mảnh chưa từng có dòng tồn ở kho Sơn thì chưa nhập được.
3. **Đoạn Phôi giao thẳng Sơn** (mảnh không hàn): khi bật giao nhận, đoạn nằm ở kho Sơn. Quản lý nói Sơn không đếm thanh phôi -
   cần chốt với IT đoạn ở kho Sơn có cần kiểm kê không (hiện code chỉ cho kho Phôi và kho Hàn).

## Code kiểm kê kho Hàn (28/11)

- BE `segment-stocktake.service.ts`: `segmentStocktakeKinds()` = `[PHOI]`, thêm `HAN` khi `isStageHandoverEnabled()` (cần cả 2
  công tắc). Kiểm kê kho Hàn khi tắt → 400 nêu lý do. `GET /segment-stock/stocktake-config` trả `{ kinds }`.
- FE: hook `useSegmentStocktakeKinds`; `InboundWarehouseApp` hiện tab "Tồn đoạn" cho thủ kho Hàn khi có `HAN`; `KhoPhoiPage` đổi
  tiêu đề "Thanh phôi tại kho Hàn". Link `?p=ton-doan` vào đúng tab sau khi hỏi BE xong.
- Thử sống bản sao 28/11: bật → thủ kho Hàn kiểm kê 0 → 5 (API) và 5 → 3 (giao diện), kiểm kê kho Phôi bị 403; tắt → config chỉ
  `PHOI`, kiểm kê kho Hàn 400, tab ẩn; thủ kho Phôi không đổi.
