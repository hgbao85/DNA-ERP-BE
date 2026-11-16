# Tồn đoạn — sửa TĐ1–TĐ5 trước khi bật công tắc (rà soát 14/11, bước 6) — 16/11/2026

Lỗi gốc: FE `docs/audit-2026-11-14-ra-soat-mua-hang-kho.html`, mục 04. Công tắc `SEGMENT_STOCK_ENABLED` vẫn TẮT; các sửa dưới đây chỉ có tác dụng khi bật. Không có migration.

**Báo Sang:** TĐ1 và TĐ4 sửa trong phần Sang viết: `SegmentStockService.syncOrderProduction` (phía cộng) và `releaseOrderHoldings`. `ProductionOrdersService` nhận thêm `SegmentProductionService`.

## TĐ1 (Cao) — Phía cộng nhập đoạn "ảo" khi tổng của lệnh giảm

`segment-stock.service.ts` `syncOrderProduction`:

- **Lỗi:** khi tổng (giữ + dư) của lệnh giảm mà phần giữ tăng, chặn "dư dùng được không âm" (`x − a`) đẩy số ghi sổ `l` lên dương. Kết quả là ghi SEGMENT_PRODUCE nhập đoạn không có thật.
  - Ví dụ: dư 8 đã bị lệnh khác lấy hết, đích mới giữ 5 dư 0. Trước đây: nhập +5, giữ +5, dư vẫn 8.
- **Sửa:** tổng giảm thì `l ≤ 0`. Phần giữ không đủ dư để tăng thì kẹp theo `x ≤ l + a`, phần chưa ghi được trả về `unapplied`.
  - Cùng ví dụ, nay: không ghi sổ, giữ 0, dư 8; chưa ghi được: giữ +5, dư −8.

## TĐ2 — Phía trừ khoá ô theo thứ tự cố định

`production-batches.service.ts` `consumeSegmentsByCode`:

- Các mã đoạn được sắp theo `compareSegmentCodes` (cỡ đoạn rồi bộ công đoạn), cùng thứ tự với phía cộng.
- Trước đây thứ tự theo `pieceBom.findMany` không sắp xếp, nên 2 lượt trừ, hoặc trừ với cộng, có thể khoá chéo nhau.

## TĐ3 — Đếm "vượt lệnh" theo thứ tự gửi KCS

`consumeSegmentsByCode`:

- Cộng dồn mọi đợt đã rời trạng thái OPEN (bỏ điều kiện `id ≤ đợt này`), dưới khoá `production-batch-open:{lệnh SX}:{mảnh}:{công đoạn}`.
  - Đây là khoá mà "Gửi KCS" và "Lưu đợt" đang giữ. Gọi lại trong cùng transaction thì không phải chờ.
  - Đường "báo sản lượng" (`create`) trước đây không giữ khoá này.
  - Nhờ khoá chung, mọi đợt khác đã gửi lúc đọc đều là đợt gửi TRƯỚC đợt này.
- Ví dụ: kế hoạch 20; đợt id 900 gửi 12 trước, đợt id 700 gửi 20 sau.
  - Trước đây: đợt 700 chỉ thấy chính nó, không ghi vượt.
  - Nay: vượt 12.

## TĐ4 — Mở lại lệnh giữ lại phần đoạn đã nhả

- **`releaseOrderHoldings` (lệnh kết thúc):** ngoài nhả phần còn giữ về dư chung, `SegmentProduction` của lệnh chuyển đúng phần vừa nhả từ giữ sang dư.
  - Tổng không đổi, nên không ghi sổ.
  - Trước đây `SegmentProduction` vẫn ghi phần giữ cũ: tính lại thấy đích bằng số cũ nên không giữ lại được gì.
- **`ProductionOrdersService.startFloor`:** mở lại lệnh đã Kết thúc thì gọi `SegmentProductionService.recomputeAfterQc(…, 'PI_REOPENED')`.
  - Phía cộng lấy lại phần giữ từ dư, nếu lệnh khác chưa lấy.
  - Công tắc tắt thì không làm gì. Lỗi chỉ ghi log, không chặn mở lại lệnh.

## TĐ5 — Chuyển đổi dữ liệu cũ không chạy chen với phía trừ

- Khoá `SEGMENT_LEGACY_CONVERSION_LOCK` (`segment-stock.config.ts`):
  - chuyển đổi giữ khoá ĐỘC QUYỀN (như trước);
  - phía trừ (`consumeSegmentsByCode`) giữ khoá DÙNG CHUNG (`lockBusinessKeyShared`, mới trong `advisory-lock.util.ts`).
- Hàn / Sơn gửi KCS trong lúc chuyển đổi đang chạy sẽ chờ chuyển đổi xong, không làm lệch tồn ô.
- "Gửi KCS" lấy khoá chuyển đổi TRƯỚC khoá đợt `production-batch-open`. Thứ tự này khớp với lượt chuyển đổi (độc quyền → khoá đợt khi phát lại phía trừ), nên 2 bên không khoá chéo.
- **Cách bật công tắc (anh chọn 16/11):** giữ code, làm theo quy trình. Đã đính chính mục "Trước khi bật" trong `docs/changelog-2026-11-14-ton-doan-phia-tru.md`:
  1. Xem thử chuyển đổi.
  2. Lúc xưởng không báo / KCS: bật công tắc, chạy chuyển đổi thật ngay.
  3. Chạy song song với sổ thủ kho.

## Test

- **segment-stock:** TĐ1 (không nhập ảo khi tổng giảm), TĐ4 (giữ → dư khi nhả).
- **production-batches:** TĐ2 (thứ tự trừ theo mã đoạn), TĐ3 (đợt id lớn gửi trước vẫn được cộng, ghi vượt 12), TĐ5 (khoá chuyển đổi dùng chung đứng trước khoá đợt, ở cả báo sản lượng lẫn Gửi KCS).
- **production-orders:** mở lại lệnh đã Kết thúc thì tính lại phía cộng; lệnh chưa từng Kết thúc thì không.

## Thử sống trên bản sao DB dev, công tắc BẬT (16/11)

- **Chuyển đổi dữ liệu cũ (đúng quy trình mới):** xem thử rồi chạy thật. 6 ô về 0, 2 lệnh, 3 đợt Hàn / Sơn cũ trừ lại theo mã đoạn (thiếu 180 đoạn: dữ liệu thử chưa có đợt cắt qua KCS).
- **TĐ3:** lệnh PBA-1, mảnh 335 (kế hoạch 40, đã báo 30).
  - Đợt A "Lưu đợt" 5 (id 93, OPEN), đợt B báo thẳng 8 (id 94), rồi Gửi KCS A.
  - Sổ báo vượt đợt 93: `overPieces = 3`, OVER_REPORT. Code cũ cộng theo id: 0.
- **TĐ5:** phiên psql giữ khoá chuyển đổi độc quyền 8 giây. Hàn Gửi KCS đúng lúc đó chờ 7 giây rồi chạy xong bình thường.
- **TĐ4:** dữ liệu thử chưa có đoạn được giữ nên chỉ kiểm đường đi. Kết thúc lệnh PBP-1 thì PI sang DONE; mở lại thì PRODUCING, tính lại phía cộng chạy không lỗi. Phần chuyển giữ → dư và lấy lại kiểm bằng unit test.
- **TĐ1, TĐ2:** kiểm bằng unit test.
