# Giữ chỗ đi theo kho — nhóm B rà soát Mua hàng + Kho 14/11 (16/11/2026)

Thiết kế: FE `docs/thiet-ke-2026-11-16-giu-cho-theo-kho.html`, đã cập nhật theo trả lời của anh Nhân và Sang ngày 16/11. Sửa các lỗi CK1–CK5, XK6 và "mảnh sang Sơn".

**Bất biến:** dòng `stock_reservations` ACTIVE nằm ở kho W thì phần còn giữ của nó là hàng đang có thật ở W. Dòng chỉ đổi kho khi hàng đổi kho, tức là lúc xác nhận phiếu chuyển.

## Migration (DB dev chung — báo Sang trước khi chạy)

`20261116120000_reservation_key_by_warehouse`:

- Nối thêm `:wh:{warehouseId}` vào `idempotencyKey` của 4 loại dòng: CONSUMABLE_MATERIAL_PURCHASE, PIECE_MATERIAL_YIELD_PURCHASE, MATERIAL_YIELD_RECIPE_PURCHASE, PRODUCTION_INVOICE.
- Chỉ nối cho dòng chưa có đuôi, nên chạy lại không đổi gì. Không đổi số lượng nào.
- Trên DB dev có 8 dòng như vậy (đo 16/11).

`prisma/split-warehouses.ts` (chia 9 kho) cũng đổi đuôi khoá khi chuyển giữ chỗ sang kho mới. Nhờ vậy, nếu production chạy chia kho sau migration này thì khoá vẫn khớp kho.

## B1 — Khoá giữ chỗ có kho

- `reservationKey(refType, refId, materialId, spec, warehouseId)`: 4 loại dòng ở trên thêm đuôi kho. Dòng CUTTING_PROPOSAL (sắt) giữ khoá cũ.
- `reservationKeyAtWarehouse(key, wh)` đổi đuôi kho của khoá.
- Khi nhận phiếu chuyển của lệnh, `WorkshopMoveService.moveReservationsInTx()` xử lý dòng có đuôi kho như sau:
  - Kho mới đã có dòng cùng nguồn (ví dụ hàng mua về kho mới trước): cộng vào dòng đó, co dòng ở kho cũ.
  - Chưa có: chuyển nguyên dòng (đổi cả kho lẫn khoá), hoặc tách phần nhận sang dòng mới mang khoá kho mới.
  - Lý do: nếu không đổi khoá, lần tính lại sau ở kho mới không thấy dòng cũ và giữ chỗ 2 lần.

## B2 (CK1) — Nhận hàng mua cộng vào đúng kho nhận

- `creditPool()` chỉ cộng vào dòng của lệnh ở đúng kho nhận.
- Chưa có dòng ở kho đó thì tạo dòng PRODUCTION_INVOICE ở kho đó, khoá có đuôi kho.
- Dòng cùng khoá đã nhả (lệnh xong rồi vẫn nhận tiếp) thì mở lại, không tạo trùng khoá.

## B3 (CK2) — Tính lại mua không kéo giữ chỗ đi nơi khác

`reserveOrAdjust()` bỏ nhánh "chuyển dòng sang kho mới". Dòng cùng khoá đã nhả mà cần giữ thêm thì mở lại.

`releaseOwnHoldsForRecompute()` xử lý từng dòng giữ chỗ của chính lệnh theo kho của dòng:

| Kho của dòng | Cách xử lý |
|---|---|
| Đúng kho đang tính | Co về phần đã tiêu, như trước. |
| Kho Phôi/Hàn cùng loại của xưởng khác | Để nguyên. Trả về `inTransitQty` ("đang chuyển tới"). |
| Kho khác còn lại (ví dụ đổi kho thành phẩm) | Dòng của nguồn co về phần đã tiêu như trước. Dòng "của cả lệnh" để nguyên. |

`sourceConsumedQty` giờ chỉ tính dòng nguồn ở kho đang tính.

3 nguồn mua (vật tư tiêu hao, pat, công thức) tính `inTransitQty` là "đã có":

- giữ thêm = min(nhu cầu − đã xuất − đang chuyển tới, khả dụng)
- mua = theo % hao hụt trên (khả dụng + đã xuất + đang chuyển tới)

## B4 (CK3, XK6) — Xuất chỉ rút giữ chỗ ở kho xuất

- `drainPool()` / `drainPoolBestEffort()` nhận thêm `warehouseId` (bắt buộc) và chỉ rút dòng ở kho đó. Áp cho các luồng: sắt (kho Phôi của xưởng làm lệnh), tiêu hao, vật tư TP, đóng gói, vật tư kèm đan.
- Xuất sắt bỏ chỗ so kho của dòng đầu. Kho Phôi của xưởng không đủ giữ chỗ mà lệnh còn giữ ở kho khác thì báo: "Lệnh còn giữ X ở kho Y - cần phiếu chuyển hàng của lệnh sang kho này trước khi xuất".

## B5 (CK4) — Phiếu chuyển kiểm tồn kho gửi (anh Nhân 16/11 câu 2)

- **Lập phiếu chuyển hàng của lệnh:** khoá `stock_quant` kho gửi. Tồn thật trừ mọi phiếu chuyển chờ nhận khác phải đủ từng dòng; thiếu thì 409.
- **Xác nhận mọi phiếu chuyển (vật tư lẫn mảnh):** khoá `stock_quant` kho gửi theo thứ tự cố định trước khi ghi sổ. Tồn thật nhỏ hơn số thực nhận thì 409 "kiểm tra lại tồn kho gửi, không nhận thiếu được".
- Nhận theo số thực nhận (hàng hư dọc đường) vẫn giữ: chỉ cần kho gửi đủ số thực nhận.

## B6 (CK5) — Phiếu chuyển của lệnh chưa nhận khi lệnh đổi xưởng tiếp (anh Nhân 16/11 câu 1)

Thủ kho kho gửi chọn theo thực tế hàng:

- **(a) Hàng chưa rời kho / xe quay về:** `POST /warehouse-transfers/:id/cancel {reason}`, chỉ kho gửi.
  - Ghi như từ chối (REJECTED, lý do "Kho gửi huỷ phiếu: …"), không ghi sổ.
  - Lệnh đã sang xưởng khác thì nhắc lập lại (WORKSHOP_MOVE_NEEDED).
  - Chỉ áp cho phiếu chuyển hàng của lệnh đang chờ nhận.
- **(b) Hàng đang trên đường tới xưởng mới:** `POST /warehouse-transfers/:id/change-destination`, chỉ kho gửi.
  - Khoá dòng lệnh (chung với đổi xưởng), đổi nơi nhận sang kho cùng loại của xưởng hiện tại.
  - Nơi nhận vẫn đúng xưởng thì 400. Lệnh về lại xưởng của kho gửi thì 400 (phải huỷ).
  - Phiếu có sắt mà KHSX chưa "Đã kiểm" phương án cắt thì 409.
  - Thông báo chuyển từ kho đích cũ sang kho đích mới.
- **(c) Hàng đã nhập kho đích:** kho đích nhận như thường. Sau khi nhận, `WorkshopMoveService.notifyMovesNeeded()` nhắc thủ kho kho đó lập phiếu chuyển tiếp, nếu kho đó không còn thuộc xưởng của lệnh.
- **Đánh dấu phiếu sai đích:** response phiếu chuyển có `destinationOutdated`, nghĩa là phiếu chờ nhận mà kho đích không còn thuộc xưởng của lệnh.
- **Cảnh báo lúc đổi xưởng:** `GET /warehouse-transfers/workshop-moves/pending?productionInvoiceId=`, quyền PRODUCTION_INVOICE:VIEW, trả về các phiếu chuyển hàng của lệnh còn chờ nhận.
  - **Việc của Sang:** hiện cảnh báo trong `ChangeWorkshopDialog`.
  - **Việc của Sang:** anh Nhân chốt người đổi xưởng là KHSX. Route `PATCH /production-invoices/:id/workshop` hiện chỉ cho `MfgRole.PRODUCTION_MANAGER`.

FE (`InternalTransferSections.tsx`):

- **"Phiếu đã gửi"** có nút "Huỷ phiếu" cho phiếu chuyển hàng của lệnh. Phiếu sai đích có thêm cảnh báo và nút "Đổi nơi nhận".
- **Hộp nhận phiếu** của kho đích ghi chú khi phiếu đi sai đích.

## B7 — Phiếu chuyển mảnh không vượt tồn mảnh ở kho gửi

- `createPieceTransfer()`: ngoài số đã qua KCS, số chuyển bị kẹp thêm theo tồn mảnh ở kho gửi (khoá `stock_quant` theo mảnh), trừ phiếu chuyển mảnh chờ nhận khác.
- Xác nhận kiểm tồn mảnh như B5.
- Tồn mảnh chỉ ghi từ 09/11 (`8289a61`). Trên DB dev cả 6 lô QC_DONE đều từ 09/11 trở đi. Mảnh làm xong trước mốc đó không có tồn sẽ bị chặn chuyển.

## Kiểm dữ liệu trước khi gộp (DB dev, chỉ đọc, 16/11)

- Không ô (kho, vật tư, dài, quy cách) nào có giữ chỗ còn lại lớn hơn tồn thật, tức chưa có dấu vết CK1/CK2.
- Không có phiếu chuyển vật tư / mảnh nào đang chờ nhận.
- Production: chạy lại cùng các câu kiểm trước khi deploy.

## Test

- Unit: stock-reservations (50), workshop-move (13), warehouse-transfers (88), 3 nguồn mua (96), các luồng xuất (296).
- Integration `test/integration/giu-cho-theo-kho.integration.spec.ts` (Postgres thật) đi hết chuỗi đổi xưởng: giữ 50 ở A → tính lại ở B (50 đang chuyển tới) → 30 về B → nhận phiếu 48/50 (khoá đổi đuôi) → tính lại không giữ 2 lần → xuất 20 ở B chỉ rút ở B → rút cứng vượt báo còn giữ ở A.

## Thử sống trên bản sao DB dev (16/11)

Sao DB dev về Postgres local, chạy migration (8 khoá đổi đuôi), chạy bản build ở cổng 3011 với `DAILY_JOBS=off FLOOR_ALERTS=off CUT_AUTO_PULL=off`. Thêm 1 xưởng thử X có kho Phôi vào bản sao để thử được (b). Lệnh thử: PI-2026-004 (PBD-1), giữ 81,2 Tán rút + 5 cây sắt ở kho Phôi Phú An.

| Bước | Kết quả |
|---|---|
| Đổi sang Phước An | Giữ chỗ vẫn ở kho Phôi Phú An; kế hoạch chuyển có phần sắt (chờ "Đã kiểm") + vật tư khác |
| "Tạo lại" ở xưởng mới | TR-001 không sinh dòng mua mới (81,2 đang chuyển tới). Dòng giữ chỗ mới đều có đuôi kho |
| Lập phiếu → API cảnh báo | `workshop-moves/pending` trả đúng phiếu |
| Đổi về lại Phú An | Phiếu `destinationOutdated=true`; đổi nơi nhận → 400 "về lại xưởng của kho gửi - huỷ phiếu" |
| (a) Huỷ | Thủ kho kho nhận → 403; kho gửi huỷ được, tồn + giữ chỗ không đổi |
| (b) Đổi nơi nhận | Phú An → Phước An (lập phiếu) → xưởng X; đổi nơi nhận sang Kho Phôi xưởng X, ghi chú phiếu, thông báo kho đích cũ tắt |
| B5 | Hạ tồn kho gửi còn 50 < 81,2 → xác nhận 409, phiếu vẫn chờ |
| (c) Nhận rồi nhắc | Kho X nhận đủ: dòng giữ chỗ sang kho X, khoá `:wh:296`; kế hoạch của kho X có dòng chuyển tiếp |
| FE | Thủ kho Phước An thấy cảnh báo + nút "Đổi nơi nhận" / "Huỷ phiếu"; cả 2 nút chạy đúng, lý do có dấu lưu đúng, không lỗi console |

**Lỗi tìm ra khi thử sống, đã sửa:** lời nhắc (c) và (a) gửi kèm người thao tác, mà hệ thống thông báo bỏ người thao tác khỏi danh sách nhận. Người vừa bấm nhận / huỷ chính là thủ kho cần được nhắc, nên không ai nhận được. Nay `notifyMovesNeeded()` gửi không kèm người thao tác. Thử lại: thủ kho Phước An nhận được nhắc chuyển tiếp.

FE: nút xác nhận trong hộp huỷ phiếu đổi chữ từ "Xác nhận từ chối" (mặc định của ReasonModal) sang "Huỷ phiếu".
