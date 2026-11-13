# 13/11/2026 - Tồn đoạn kho Phôi theo mã đoạn, giữ đoạn theo lệnh (khung + phía cộng)

Sếp chốt 11 câu tồn đoạn (13/11):
- quản đoạn theo TỪNG LỆNH, theo kho Phôi của TỪNG XƯỞNG, tách theo MÃ ĐOẠN;
- đoạn đủ công đoạn + KCS đạt của lệnh nào giữ cho lệnh đó;
- phần cắt dư vào cột "dư" chung của xưởng, chia cho lệnh sau;
- tồn không âm; Hàn / Sơn báo vượt không chặn mà ghi sổ báo vượt.

Bản này làm phần nền: chiều mã đoạn trong tồn, bảng giữ đoạn theo lệnh, cột dư, chia dư, nhả khi lệnh kết thúc, và PHÍA CỘNG (sau
KCS tự vào tồn). Phía trừ (Hàn / Sơn trừ phần giữ của lệnh, sổ báo vượt, số lấy thêm, đổi xưởng chuyển đoạn, màn Kho phôi, chuyển đổi
dữ liệu cũ) làm sau trên khung này.

**Mặc định TẮT** (`SEGMENT_STOCK_ENABLED=false`): deploy bản này không đổi số tồn nào. KCS vẫn chạy y như cũ.

## Thay đổi

1. **Migration `20261113180000_segment_stock_by_order`** (chỉ mở rộng, không xoá dữ liệu):
   - Cột `segmentSteps` trên `stock_ledger` và `stock_quant`: bộ công đoạn phụ của đoạn, `''` = trơn. Mọi dòng cũ nhận `''` nên số cũ không đổi.
   - CHECK `*_segment_steps_chk`:
     - chỉ khác `''` khi là dòng đoạn;
     - chỉ nhận công đoạn trong `PROCESS_STEPS` (trừ Cắt), nối bằng dấu phẩy.
   - Unique `stock_quant_wh_seg_steps_key` (kho, cỡ đoạn, bộ công đoạn) thay `stock_quant_warehouseId_segmentSpecId_key`.
     - Hàm trigger `fn_sync_stock_quant` đổi CÙNG migration (bài học 42P10 ngày 04/09); 3 nhánh còn lại giữ nguyên.
   - Bảng `segment_reservations`: giữ đoạn theo (kho, lệnh, mã đoạn), cột `reservedQty` / `consumedQty`.
     - CHECK 0 ≤ đã dùng ≤ đã giữ.
   - Bảng `segment_productions`: phía cộng đã ghi gì cho lệnh (`heldQty` giữ cho lệnh, `surplusQty` vào dư).
     - Tính lại chỉ ghi phần chênh.
   - Bảng `segment_reservation_logs`: nhật ký, chỉ thêm. Loại PRODUCE / SURPLUS_IN / CONSUME / RELEASE / TRANSFER / ADJUST.
   - Loại bút toán `SEGMENT_PRODUCE`: kho ảo PRODUCTION → kho Phôi; tính lại giảm thì ghi chiều ngược lại.
2. **Mã đoạn** `src/common/utils/segment-code.util.ts`:
   - Mã đoạn = (cỡ đoạn, bộ công đoạn).
   - `normalizeSegmentSteps` bỏ Cắt, bỏ trùng, sắp theo thứ tự nghiệp vụ. Định mức lưu "CAT,TAN,NHAN" hay "CAT,NHAN,TAN" đều ra cùng `TAN,NHAN`.
   - Có thêm nhãn tiếng Việt, khoá advisory theo ô / theo lệnh, thứ tự khoá.
   - Test đối chiếu danh sách công đoạn với các CHECK của migration.
3. **Sổ kho:**
   - `postEntry` nhận `segmentSteps`, kiểm đúng dạng.
   - `/stock-ledger` và `/stock-quant` trả thêm `segmentSteps`. Nhãn `segmentSpecLabel` giữ khuôn cũ cho màn Kho phôi đang đọc.
   - Lịch sử kho trả mã lệnh (`piCode`) cho bút toán `SEGMENT_PRODUCE`.
4. **Module `segment-stock`:**
   - `SegmentStockService`. Mô hình 1 ô (kho, mã đoạn): tồn = `stock_quant`; còn giữ = Σ(giữ − dùng) mọi lệnh; dư = tồn − còn giữ.
     - `syncOrderProduction`: ghi phần chênh của phía cộng. Giảm bị chặn để không làm tồn âm và không nhả quá phần lệnh còn giữ. Phần không ghi được trả ở `unapplied*`.
     - `consumeForOrder` (cho phía trừ): lấy phần giữ của lệnh trước, thiếu thì lấy từ dư (chia dư lúc dùng, ghi SURPLUS_IN), còn thiếu thì trả `shortageQty`, không ghi sổ phần thiếu.
     - `allocateSurplusToOrder`: chia dư chủ động.
     - `releaseOrderHoldings`: nhả phần còn giữ về dư; gọi lại không làm gì.
     - Mọi hàm ghi khoá advisory từng ô theo thứ tự cố định.
   - `SegmentProductionService` (phía cộng):
     - Đọc số đạt KCS của CẢ lệnh, cùng công thức bảng tiến độ Phôi / piece-sync: đạt = đã báo − lỗi − chưa gửi − chờ KCS.
     - Số cần theo (cỡ đoạn, bộ công đoạn) từ định mức × số lượng.
     - Tính đích bằng `computeSegmentTargets` (mục 5).
     - Ghi thật trong transaction, khoá lệnh TRƯỚC rồi mới đọc số.
   - API:
     - `GET /segment-stock/balances?warehouseId=&materialId=&segmentSpecId=`: tồn / còn giữ / dư từng ô. Dư không kẹp về 0 để dữ liệu cũ âm lộ ra.
     - `GET /segment-stock/orders/:productionInvoiceId`: phần giữ của lệnh + 100 dòng nhật ký.
     - `POST /segment-stock/recompute {productionInvoiceId, dryRun}` (quyền STOCK UPDATE):
       - `dryRun` chạy được cả khi tắt công tắc;
       - ghi thật cần bật công tắc và lệnh chưa kết thúc.
5. **Cách tính đoạn đủ công đoạn** (`segment-targets.util.ts`), cho mỗi cỡ đoạn của lệnh:
   - mã nhiều công đoạn trước: số đủ = min(còn cắt đạt, số đạt của từng công đoạn trong bộ), lượt 1 tới trần số cần (giữ cho lệnh), lượt 2 phần vượt (dư);
   - đoạn trơn chỉ tính phần cắt ra không còn phải chờ công đoạn nào của lệnh. Cắt 120 cỡ 460 mm, mới Dập 20 / cần 50 thì 30 đoạn chưa Dập được để dành, không tính là trơn;
   - cộng dần sau mỗi lần KCS (chưa đợi đủ cả lệnh - câu hỏi lại số 1 vẫn chờ Sếp, đổi ở đúng hàm này).
6. **Móc nối:**
   - sau khi KCS commit ở `review()`, `reviewCutBundle()`, `reviewStepBundle()`: tính lại cho lệnh. Công tắc tắt thì không truy vấn gì; mọi lỗi chỉ log, KCS không bị hỏng;
   - QLSX Kết thúc SKU cuối cùng của lệnh: nhả giữ đoạn về dư (cạnh chỗ nhả giữ chỗ vật tư, try/catch riêng).
7. **Không móc "Sửa SKU đợt":** tồn tính theo cả lệnh, SKU mới luôn thuộc cùng lệnh (`assignCutBundleOrder` / `assignStepBundleOrder` đã kiểm) nên số không đổi.
   - Sửa định mức / số lượng lệnh chưa tự tính lại: lần KCS sau hoặc `POST /segment-stock/recompute` tính lại.

## Lỗi bắt khi review (đã sửa)

- **Hàn dùng đoạn bị CHECK chặn oan** (chỉ lộ khi thử trên Postgres thật, test mock không thấy).
  - `upsert` của Prisma thành `INSERT ... ON CONFLICT`, và Postgres kiểm CHECK trên bộ giá trị "tạo mới" kể cả khi rơi vào nhánh cập nhật.
  - Ví dụ: dòng đã giữ 10, dùng 8 → bộ tạo mới (giữ 0, dùng 8) vi phạm.
  - Đổi sang đọc dòng rồi cập nhật / tạo, an toàn vì đã giữ khoá ô.
- Số dư theo ô: lọc dòng còn giữ (giữ > dùng) ngay trong DB bằng tham chiếu cột, không tải dòng của lệnh đã dùng hết.

## Kiểm tra

- Jest 8 bộ (mã đoạn, giữ đoạn, phía cộng, hàm tính đích có 11 ví dụ + 200 bộ số ngẫu nhiên, KCS, lệnh sản xuất, sổ kho, tồn): 208 test đạt.
- tsc sạch (ngoài 2 lỗi cũ ở `prisma/seed-*`), eslint sạch.
- Thử trên Postgres thật, trong 1 transaction rồi rollback: 9 bước đều đúng. Gồm: ghi phía cộng, gọi lại không ghi đôi, dùng từ phần giữ, lấy dư, thiếu không ghi sổ, tính lại giảm bị chặn đúng, bỏ mã về 0, chia dư, nhả, nhả lại.
- Thử luồng thật qua API trên BẢN SAO DB local (đã xoá sau khi thử):
  - Xem thử / ghi 2 lệnh: số khớp định mức.
  - Gọi lại không ghi thêm.
  - Lệnh xưởng Phước An vào kho Phôi Phước An.
  - Phôi nhập đợt cắt 15 đoạn (lệnh cần 40, đã có 30) → báo xong (chưa vào tồn) → KCS đạt → tự ghi: giữ +10, dư +5.
  - Lịch sử kho hiện mã lệnh.
  - QLSX Kết thúc lệnh → phần giữ nhả về dư.
  - Tính lại lệnh đã kết thúc → 409.

## Trước khi bật `SEGMENT_STOCK_ENABLED`

1. Phía trừ phải đổi sang `consumeForOrder` (trừ đúng mã đoạn của lệnh). Phía trừ cũ trừ mọi đoạn vào dòng TRƠN, kể cả đoạn có Dập / Uốn.
2. Chuyển đổi dữ liệu cũ (câu 10: tồn không âm, số âm cũ tính lại).
   - Trên DB local, mỗi dòng trơn âm đúng bằng phần Hàn đã trừ theo cách cũ, gồm cả đoạn "800 mm Dập" bị trừ vào "800 mm trơn".
   - Lúc đó phần giữ của lệnh bị số âm cũ "ăn" mất, nên Hàn sẽ bị báo thiếu oan.
   - Cần đối chiếu số trên production trước khi chuyển.
3. Màn Kho phôi đang tách dòng theo nhãn "{mã} @ {n}mm". Khi có dòng có công đoạn thì cùng nhãn ra 2 dòng → chuyển màn sang `GET /segment-stock/balances` (có cột dư).
