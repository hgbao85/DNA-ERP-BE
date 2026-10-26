# Changelog 2026-09-19 — Bỏ chặn cứng "nhận vượt số đặt mua", chuyển cảnh báo sang popup xác nhận ở FE

> Trạng thái: **ĐÃ XONG**.

## 1. Yêu cầu

Người dùng test trên bản deploy thật (erpdna.vercel.app) gặp lỗi khi nhập kho PO-41/PI-2026-010:
vật tư SAT-003 đặt 21, thủ kho nhập 27 (giao dư so với đặt mua) bị chặn cứng: *"Xác nhận nhận hàng
thất bại: Vật tư SAT-003: nhận vượt số đặt mua... vượt mức cho phép 21 (dung sai 0%)"*. Người dùng
yêu cầu: *"bỏ hẳn check, nhưng khi nhấn xác nhận hãy hiển thị popup để xác nhận"*.

## 2. Hiện trạng trước khi sửa

`PurchaseProposalsService.receiveItem()` chặn cứng (`BadRequestException`) khi tổng nhận vượt
`buyQty * (1 + dung_sai% / 100)`, với dung sai % đọc từ `SystemConfig.purchaseOverReceiptTolerancePercent`
(mặc định 0% nếu chưa cấu hình → không cho nhận thừa 1 đơn vị nào). Tính năng này từng được thêm để
sửa 1 bug thật (`D.b3-silent-over-receipt`, trước 2026-08-15): hệ thống cũ tự động `Math.min(buyQty, ...)`
cắt âm thầm số nhận về đúng số đặt mua, khiến hàng thực tế nằm trong kho mà sổ sách ghi thiếu, không
cảnh báo, sai lệch chỉ lộ ra lúc kiểm kê cuối kỳ.

## 3. Thay đổi

**BE** (`src/modules/purchase-proposals/purchase-proposals.service.ts`):
- Bỏ hẳn việc đọc `tolerancePercent`/tính `maxAllowedQty` và nhánh `throw BadRequestException` khi
  vượt ngưỡng. `receiveItem()` giờ LUÔN ghi đúng số thực nhận (`nextReceivedQty`), kể cả khi vượt
  `buyQty` - không còn tái kiểm gì ở BE, không còn cắt âm thầm (giữ nguyên phần sửa
  `D.b3-silent-over-receipt`, chỉ bỏ phần "chặn cứng", KHÔNG quay lại `Math.min` cũ).
- Xoá method `getOverReceiptTolerancePercent()` (không còn nơi gọi). **Cố ý giữ lại** field
  `SystemConfig.purchaseOverReceiptTolerancePercent` (schema, DTO, trang Admin cấu hình hệ thống) -
  không dọn trong đợt này vì xoá field DB cần migration, ngoài phạm vi yêu cầu ("chỗ này" = luồng
  nhận hàng, không phải "xoá field cấu hình"); field này tạm thời không còn tác dụng, có thể dọn ở
  đợt sau nếu xác nhận không dùng lại.
- Cập nhật `purchase-proposals.service.spec.ts`: 2 test cũ khẳng định "CHẶN khi vượt buyQty"/"CHẶN
  khi đã nhận đủ mà nhập thêm" đổi thành "CHO PHÉP", verify `receivedQty` ghi đúng số thật (không
  cắt). Test "CHO nhận thừa trong dung sai" (dùng mock `systemConfig.findUnique` giả lập dung sai
  25%) bị gộp vào 2 test trên vì cơ chế dung sai không còn tồn tại.

**FE** (`src/modules/pages/Manufacturing/NhapKhoPage.tsx`):
- Thêm `useConfirm()` (hook + `ConfirmModal` dùng chung toàn app, KHÔNG dùng `window.confirm()` native
  - đồng bộ pattern đã dùng ở `KhoNhapDanPage.tsx`).
- Nút "Xác nhận" giờ gọi `handleConfirmClick()`: nếu `đã nhận + nhập thêm > SL cần mua` → mở popup
  hỏi lại trước khi thực sự gọi API; không vượt thì xác nhận thẳng như cũ, không làm phiền người
  dùng ở trường hợp bình thường.
- **Sửa lại 19/09 lần 2** (góp ý người dùng sau khi xem UI thật): popup lúc đầu giải thích dài
  ("đặt mua X, đã nhận Y, vượt Z...") + `danger: true` (icon/nút đỏ) - người dùng phản hồi nhìn quá
  "báo lỗi nghiêm trọng" cho 1 việc chỉ là hỏi lại số liệu. Rút gọn còn đúng 1 câu hỏi thẳng số cuối
  cùng ("Xác nhận đã nhận {tổng} {đvt} "{tên vật tư}"?"), bỏ `danger` (đổi về icon/nút tím mặc định
  của `ConfirmModal`, không sửa `ConfirmModal.tsx` dùng chung vì chỉ cần đổi cách gọi ở đây).

## 4. Kết quả kiểm tra

- **Unit test BE**: `npx jest purchase-proposals.service.spec.ts` → **50/50 pass**.
- **Biên dịch**: `nest start --watch` sau `prisma generate` → 0 lỗi TypeScript.
- **Kiểm tra state-machine khác không bị ảnh hưởng**: gọi thẳng API `POST /purchase-proposals/3/items/11/receive`
  cho 1 item đã `PURCHASED` (đã nhận đủ) → vẫn bị chặn đúng bởi guard KHÁC ("chỉ PURCHASING mới nhận
  hàng được", `409 ConflictException`) - xác nhận việc bỏ chặn dung sai KHÔNG đụng tới các guard
  state-machine khác đang bảo vệ luồng nhận hàng.
- **Live-test qua UI thật (bổ sung 19/09 sau khi có DB local đầy đủ)**: môi trường local trước đó
  thiếu 2 migration `add_office_supplies`/`office_supplies_per_warehouse` (đã tồn tại sẵn trong
  `prisma/migrations`, chỉ chưa áp dụng vào DB local vì Docker Desktop/Postgres bị tắt) - khởi động
  lại Docker, `npx prisma migrate deploy` áp dụng đủ 114/114 migration, BE hết lỗi "Database error".
  Dựng lại 1 purchase-proposal PURCHASING còn thiếu hàng bằng đúng nghiệp vụ thật (không tạo giả
  qua DB): boss-approve proposal PI-2026-002 qua tài khoản `muapsh` (đúng vai trò được cấp
  `PURCHASE_PROPOSAL:UPDATE` - xem comment D.c4-warehouse-can-quote, KHÔNG phải tài khoản `boss`)
  kèm file phê duyệt upload thật qua Cloudinary. Đăng nhập `khopsh`, vào Nhập kho → PI-2026-002 →
  vật tư "Sắt tròn Ø4" (đặt mua 1, đã nhận 0) → nhập 5 → bấm Xác nhận:
  - **Popup hiện đúng**: "Nhận vượt số đặt mua" - "Vật tư 'Sắt tròn Ø4': đặt mua 1 cây, đã nhận 0,
    lần này nhập 5 -> tổng 5 VƯỢT số đặt mua...".
  - Bấm "Đúng, ghi nhận" → ghi thành công, gọi lại API xác nhận `receivedQty=5` (ĐÚNG số thật, không
    bị cắt về 1), `status=PURCHASED`.
  - Test thêm trường hợp bình thường (không vượt): nhập đúng 84/84 cho "Sắt vuông 18×18" → xác nhận
    thẳng, KHÔNG hiện popup, đúng như thiết kế (chỉ làm phiền khi thật sự vượt).

## 5. Còn treo

- Field cấu hình `purchaseOverReceiptTolerancePercent` (schema + trang Admin) hiện không còn tác
  dụng - để nguyên theo quyết định ở mục 3, cân nhắc dọn hẳn (kèm migration) ở đợt sau nếu xác nhận
  không cần dùng lại.
