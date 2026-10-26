# Changelog 2026-10-16 — Kế hoạch: AI đọc phiếu nhập kho → form nhận hàng → người dùng duyệt

> Trạng thái: **KẾ HOẠCH, CHƯA SỬA CODE.** Chờ người dùng trả lời 5 câu ở mục 6 và gửi thêm ảnh phiếu thật.

## 1. Yêu cầu

Người dùng: chụp phiếu nhập kho hoặc gửi file → AI đọc SKU, PI, vật tư, số lượng… trên phiếu → tạo sẵn form nhập kho → người dùng xem
lại, bấm Accept → lưu vào hệ thống, không nhập tay. Người dùng nghĩ "chắc không khó, chỉ việc tích hợp API AI". Gửi kèm 1 ảnh phiếu
hiện tại (viết tay) và cho biết về sau phiếu sẽ in máy để AI đọc dễ hơn.

## 2. Phiếu mẫu người dùng gửi (đọc từ ảnh)

Mẫu 01NK-DNA (theo Thông tư 133/2016), viết tay: ngày 14/10/2026, đơn vị IEA-KCN Phú An, người giao Huỳnh Thanh Phốc, "theo PXK
ngày 10/10/2026 của **Bảo Hân Plastic**" (nhà cung cấp), nhập tại kho Phú An. Một dòng: **"Bì zip 17×23 in dầu", ĐVT kg, theo chứng
từ 50, thực nhập 50**; cột Đơn giá bị dùng để ghi **"1 kg / 130 cái"**. Ký: người lập + thủ kho (Lê Thị Mỹ Quanh), QC (Trần Văn Nhơn),
người giao.

**Điều phiếu KHÔNG có:** mã PI, mã đề xuất mua, mã SKU, mã vật tư (cột "Mã số" để trống). Tức là AI đọc được CHỮ, nhưng phiếu
không nói hàng này thuộc dòng mua nào trong ERP — phần đó phải do hệ thống suy ra.

## 3. Nhận hàng trong ERP hiện nay (đã rà code)

- Nhập kho hàng mua = thủ kho xác nhận từng DÒNG của đề xuất mua đã được Sếp duyệt NCC (`PurchaseProposalItem` trạng thái
  `PURCHASING`): `POST /purchase-proposals/:id/items/:itemId/receive` với `receivedQty` (đơn vị tồn, vd cái) + tuỳ chọn
  `receivedQtyPurchaseUnit` (đơn vị mua, vd kg) và `Idempotency-Key` (`PurchaseProposalsService.receiveItem`). Kho nhận theo kho của
  dòng (`Material.warehouseId` / `receiveWarehouseCode`), không theo phạm vi kho người bấm (đúng thiết kế). Không chặn nhận vượt
  (bì zip đếm theo cân, đúng thiết kế).
- `Material.khoUnitFactor` = hệ số quy đổi cố định (vd 250 cái/kg); màn `NhapKhoPage.tsx` tự điền số cái từ số kg theo hệ số đó.
- NCC của dòng nằm ở `PurchaseProposalQuote` (`isChosen`, `supplierName`).
- Upload file đã có (`uploads` → Cloudinary, ảnh + tài liệu). Chưa có tích hợp AI nào trong BE.
- Nhập nội bộ (chuyển kho) là luồng khác (`NhapNoiBoSection`).

## 4. Đánh giá "chỉ việc tích hợp API AI"

**Đúng một nửa.** Gọi API để đọc ảnh ra JSON là phần DỄ (khoảng 1 ngày). Phần tốn công là ba chỗ còn lại:

1. **Ghép phiếu với dòng mua trong ERP.** Phiếu ghi "Bì zip 17×23 in dầu" + "Bảo Hân Plastic", không có PI. Hệ thống phải tìm trong
   các dòng mua đang chờ nhận: cùng NCC + tên vật tư gần giống. Nếu vật tư đó đang mua cho 2 PI cùng lúc thì một mình phiếu không đủ
   để biết chia cho PI nào → người dùng phải chọn. Đây là phần quyết định độ chính xác, không phải khâu đọc chữ.
2. **Đơn vị và hệ số quy đổi.** Phiếu ghi kg, tồn kho tính cái, và hệ số trên phiếu (130 cái/kg) có thể khác hệ số trong danh mục
   vật tư. Ghi sai hệ số = sai tồn kho hàng nghìn cái. Màn duyệt phải hiện rõ cả hai và hỏi dùng số nào.
3. **An toàn số liệu.** Nhập kho đi thẳng vào sổ tồn. AI đọc nhầm chữ viết tay (130 ↔ 150, 50 ↔ 30) là chuyện sẽ xảy ra. Vì vậy:
   AI không bao giờ tự lưu; luôn có bước người duyệt với ảnh phiếu đặt ngay cạnh; vẫn phải SỬA được trong bước duyệt (chọn lại dòng
   mua từ danh sách, sửa số); giữ nguyên cách nhập tay cũ làm dự phòng khi AI lỗi/mất mạng.

**Nguyên tắc chống bịa:** gửi cho AI ảnh phiếu + danh sách dòng mua ĐANG CHỜ NHẬN (mã, tên vật tư, đơn vị, hệ số, NCC, PI, số còn
thiếu); AI chỉ được chọn `itemId` trong danh sách đó hoặc trả "không khớp", không được tự tạo vật tư/PI. BE kiểm lại mọi thứ AI trả về
bằng code tất định trước khi hiện lên màn duyệt.

## 5. Kế hoạch triển khai

### GĐ0 — Thu mẫu và đo độ chính xác (1–2 ngày, cần người dùng gửi ảnh)
- Thu 20–30 phiếu thật (cả viết tay hiện tại lẫn mẫu in máy sắp dùng), kèm đáp án đúng (dòng mua nào, bao nhiêu).
- Script chạy thử model đọc ảnh, đo theo từng trường: NCC, tên hàng, ĐVT, theo chứng từ, thực nhập, hệ số, ngày.
- Chốt: model (mặc định `claude-sonnet-5-5`; thử `claude-haiku-5-5` nếu đủ chính xác để rẻ hơn), chi phí thật mỗi phiếu, tỷ lệ phải
  sửa tay. Nếu chữ viết tay dưới ngưỡng chấp nhận thì đợi mẫu in máy rồi mới làm GĐ1.

### GĐ1 — BE (4–5 ngày)
- Module mới `receipt-scans`, bảng `receipt_scans` (+ dòng): file (Cloudinary), người quét, model, token/chi phí, JSON gốc AI trả, trạng
  thái `DRAFT → ACCEPTED / REJECTED`, mỗi dòng: chữ đọc được trên phiếu, `itemId` đề xuất, độ tin cậy, số theo chứng từ / thực nhập,
  đơn vị, hệ số đọc được, cảnh báo.
- `POST /receipt-scans` (ảnh/PDF ≤ 10MB, ≤ 3 trang) → lưu file → dựng danh sách dòng mua đang chờ nhận mà người này được nhận (cùng bộ
  lọc với màn Nhập kho) → gọi Anthropic Messages API (ảnh + danh sách, trả JSON theo schema bằng tool use) → **bộ ghép tất định**:
  `itemId` phải có trong danh sách, số > 0, quy đổi kg → cái, so hệ số phiếu với `khoUnitFactor`, phát hiện nhận vượt / trùng phiếu
  đã quét / nhiều PI cùng vật tư → lưu nháp.
- `PATCH /receipt-scans/:id/lines/:n` (người duyệt chọn lại dòng mua, sửa số, bỏ dòng), `POST /receipt-scans/:id/accept`: gọi đúng
  `receiveItem()` hiện có cho từng dòng với `Idempotency-Key = scan:<id>:line:<n>` (bấm lại không cộng 2 lần), ghi kết quả từng dòng;
  lỗi một dòng không làm mất các dòng đã nhận. Ảnh phiếu gắn vào lần nhận để tra ở Lịch sử nhập xuất kho.
- Quyền = quyền nhận hàng hiện có (`PURCHASE_RECEIPT:UPDATE`, như route receive), cùng phạm vi kho. Giới hạn tần suất riêng, trần chi phí/tháng, cờ bật
  tắt `RECEIPT_AI_ENABLED`, khoá `ANTHROPIC_API_KEY` trên Render. Hết hạn mức / API lỗi → trả lỗi rõ, màn vẫn cho nhập tay như cũ.
- Test: đơn vị (bộ ghép, quy đổi, idempotency) + ma trận quyền như `floor.controller.spec.ts`; AI giả lập (không gọi API thật trong CI).

### GĐ2 — FE (3–4 ngày)
- Nút "Quét phiếu" ở màn Nhập kho: chụp bằng camera điện thoại (`accept="image/*" capture`) hoặc chọn file/PDF; nén ảnh trước khi gửi.
- Màn duyệt: ảnh phiếu bên trái (phóng to được), các dòng bên phải. Mỗi dòng: chữ AI đọc → dòng mua đã ghép (đổi được bằng danh sách
  thả xuống, không gõ), số thực nhập, kg ↔ cái với hệ số (đánh dấu khi khác danh mục), độ tin cậy, cảnh báo. Nút Accept khoá cho tới
  khi mọi dòng đã ghép hoặc đã bỏ; bấm Accept hiện bảng xác nhận tổng hợp (như màn công nhân).
- Playwright: luồng quét → duyệt → accept với AI giả lập; trường hợp nhiều PI, hệ số lệch, mất mạng lúc accept.

### GĐ3 — Thử thật (1–2 tuần, song song)
- Một thủ kho dùng thật với phiếu thật; đo: tỷ lệ phiếu không phải sửa gì, số lần sửa mỗi phiếu, thời gian so với nhập tay, chi phí.

### Hướng tốt hơn khi chuyển sang phiếu in máy (đề xuất)
Thay vì in phiếu trống rồi để AI đoán nó thuộc PI nào: **ERP in sẵn phiếu nhập** từ các dòng đang chờ nhận (đã có mã đề xuất, PI, mã
vật tư, NCC, hệ số) kèm **mã QR** ở góc; thủ kho chỉ viết số thực nhập. Khi quét: QR cho biết chắc chắn phiếu thuộc dòng nào → AI chỉ
còn đọc vài ô số → sai ít hơn hẳn, phần ghép mục 4.1 gần như biến mất. Đáng làm trước hoặc cùng GĐ1.

## 6. Cần người dùng quyết

1. Phiếu do ai lập: thủ kho công ty tự viết (như ảnh) hay có cả phiếu giao hàng của NCC? Khi in máy, có đồng ý cho ERP in sẵn phiếu
   kèm mã QR (mục 5, hướng tốt hơn) không?
2. Phạm vi đợt đầu: chỉ nhận hàng MUA, hay cả nhập nội bộ / chuyển kho?
3. "Không nhập tay": ở bước duyệt có cho sửa số và chọn lại dòng mua từ danh sách không (đề xuất: có, chỉ chọn/sửa, không gõ từ đầu)?
4. Sếp có đồng ý gửi ảnh chứng từ lên dịch vụ AI bên ngoài (Anthropic) không; ai đứng tên tài khoản và trả phí API?
5. Hệ số trên phiếu (vd 130 cái/kg) khác danh mục vật tư thì lấy số nào làm chuẩn — số trên phiếu của từng lần giao, hay số danh mục?

## 7. Chưa làm

Chưa sửa code, chưa gọi thử API AI nào, chưa có mẫu phiếu ngoài 1 ảnh. Ước lượng ngày công ở mục 5 là sơ bộ, chốt lại sau GĐ0.
