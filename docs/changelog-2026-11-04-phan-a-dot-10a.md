# Changelog 2026-11-04 — Phần A, Đợt 10a: Booking / Lịch xuất hàng (YC5, phần Sales)

> Trạng thái (05/11): **ĐÃ CODE + kiểm tra + chạy thử thật; 05/11 đã commit `0e3b21b` + gộp vào `main` `4d95d04`, FE `67bfc8b` → `demo` `b7efc8c`, đã push 05/11 09:52 (BE) – 09:55 (FE)** (changelog phần A mục 10). Nhánh `dot-10a-booking`, worktree BE
> `D:\DNA-ERP-BE-dot10a` (cắt từ `main` `376534c` - đã có Đợt 1, 2, 5c), FE `D:\DNA-ERP-dot10a` (cắt từ `demo` `6774431`). DB dev riêng
> `dna_erp_dot10a`. Plan: `docs/ke-hoach-phan-a-12-yeu-cau-2026-11-04.md` mục 7, 8 (điểm ghép ④), 12 (V2-6, V4-20). Nghiệp vụ: v8 YC5
> 5.1–5.8 + ảnh "bảng thông tin booking" anh Nhân gửi.

## Mục lục
0. ~~Đang dở~~ → xong (05/11)
1. Đã làm - BE
2. Đã làm - FE
3. Vì sao / quyết định
4. Review của Opus (sửa gì sau thợ)
5. Kiểm tra + chạy thử thật
6. Chỗ đụng phần có sẵn của file dùng chung
7. Điểm ghép ④ cho người B (10b)
8. Chưa làm / còn treo
9. Danh sách file để commit
10. Trưởng nhóm kiểm lại trước khi gộp (05/11)

## 0. ~~Đang dở~~ → xong (05/11)

04/11 chiều người dùng tạm dừng khi 2 thợ `implementer-sonnet` (BE module `bookings`, FE màn "Lịch xuất hàng") đã viết gần đủ file nhưng
tiến trình bị dừng trước khi báo xong. 05/11 Opus làm tiếp: nhánh đã ở đúng bản mới nhất (`main` `376534c`, `demo` `6774431` - không phải
gộp thêm), `migrate deploy` + `prisma generate` lại, review diff thật, sửa (mục 4), chạy lại kiểm tra và chạy thử thật (mục 5).

Ghi chú môi trường: worktree BE dùng `node_modules` RIÊNG (`pnpm install --frozen-lockfile --ignore-scripts`, lấy từ kho pnpm chung) thay vì
nối junction về thư mục chính, vì `node_modules` của thư mục chính chưa có `exceljs` mà Đợt 5c (đã nằm trong `main`) cần - nối junction thì
`nest build`/jest của module mua hàng hỏng. Không đụng thư mục chính.

## 1. Đã làm - BE

- **DB** (migration `20261104190000_add_bookings`, chỉ THÊM): enum `BookingStatus` (DRAFT | CONFIRMED | SHIPPED | CANCELLED), bảng
  `bookings` (`bookingNo`, `customerId`, `containerType` mặc định 40HC, `containerQty` mặc định 1, `pod`, `cutSiAt`, `pickupDate` (DATE),
  `cutOffAt`, `etd` (DATE), `pickupPlace`, `vesselVoyage`, `warehouseCode` (kho TP gom hàng - 5.6), `note`, `attachments` JSON, `status`,
  người/lúc tạo-xác nhận-huỷ + lý do huỷ), bảng `booking_lines` (`bookingId`, `productionInvoiceItemId`, `salesOrderItemId`, `qty`,
  `shippedQty` mặc định 0 - để 10b ghi; unique (booking, dòng lệnh)).
- **Module `src/modules/bookings`** (đăng ký qua `SalesOrdersModule` + `DailyJobsModule`, không sửa `app.module.ts`):
  - `GET /bookings` (lọc `from/to` theo ngày VN - lấy booking có ít nhất 1 trong 4 ngày rơi vào khoảng, `status`, `customerId`, `search`
    theo số booking / POD / tàu / khách / mã PO / số LSX / mã PI; mặc định bỏ booking đã huỷ), `GET /bookings/meta` (kho thành phẩm đang
    dùng + thể tích cont - Sales không có quyền WAREHOUSE/SYSTEM_CONFIG), `GET /bookings/candidates?customerId&bookingId` (dòng lệnh SX còn
    hàng của khách), `GET /bookings/:id`, `POST /bookings`, `PATCH /bookings/:id` (`lines` có mặt = thay toàn bộ hàng),
    `POST /bookings/:id/confirm`, `POST /bookings/:id/cancel`.
  - Quyền: xem `SALES_ORDER:VIEW`; ghi `SALES_ORDER:CREATE/UPDATE` **+ `@RequireRole(SALES_STAFF, ADMIN)`** (V4-20 - WAREHOUSE_STAFF cũng có
    SALES_ORDER:UPDATE). Không thêm quyền mới → không phải seed production.
  - "Còn được xếp" của 1 dòng đơn = SL dòng − đã xuất − phần chưa xuất đã xếp ở booking KHÁC đang DRAFT/CONFIRMED. Kiểm trong transaction,
    **khoá dòng đơn `SELECT … FROM sales_order_items … ORDER BY id FOR UPDATE` TRƯỚC khi đọc số** (V2-6) → 2 Sales xếp cùng dòng cùng lúc
    không vượt. Cho xếp cả hàng chưa làm xong (5.3). Vượt → 400 nêu SKU / PO / lệnh / số còn lại.
  - Số booking không trùng giữa booking CHƯA HUỶ (không phân biệt hoa/thường, khoá advisory theo số) → 409; booking đã huỷ thì tạo lại số
    đó được. Sửa chỉ khi DRAFT/CONFIRMED (SHIPPED/CANCELLED → 409). Đổi khách khi đã có hàng mà không gửi hàng mới → 400. Xác nhận cần ≥ 1
    dòng + kho gom (5.6). Huỷ cần lý do, chặn nếu có dòng đã xuất (10b), đóng luôn cảnh báo BOOKING_SHORT. Audit sau commit cho tạo / sửa /
    xác nhận / huỷ.
  - Response làm giàu theo lô (không N+1): mã PO khách (`SalesOrder.orderCode`), mã lệnh của dòng (số LSX ?? mã PI ?? "chưa lên lệnh"),
    kho đóng gói của dòng, SL đơn / đã xuất / xếp booking khác / còn được xếp / đã đóng gói / sẵn hàng (= đã đóng gói − đã xuất, 5.8),
    thể tích bộ, m³ dòng, số thiếu; tổng: bộ, m³ / sức chứa (68 × số cont), %, SKU chưa có kích thước thùng, tổng thiếu.
  - `booking-calc.util.ts` (hàm thuần): ngày hạn = ngày SỚM HƠN giữa ngày lấy cont và ngày (giờ VN) của CUT OFF; chia hàng sẵn cho các
    booking cùng dòng đơn theo ngày hạn (không ngày xếp cuối, cùng ngày id nhỏ trước) → số thiếu từng booking; m³ tính bằng SỐ NGUYÊN
    (đơn vị 1e-4 m³) như load cont của Đợt 1.
  - Cảnh báo hằng ngày `BookingAlertsService.syncShortAlerts` (gọi từ `daily-jobs`, mỗi 10 phút): booking DRAFT/CONFIRMED có ngày hạn ≤ ngày
    mai (kể cả đã quá) mà còn thiếu → thông báo mới `BOOKING_SHORT` (ALERT/WARNING) tới Sales + KHSX + thủ kho TP của kho gom (loại Mua
    hàng); 1 thông báo/booking, chỉ gửi lại khi sang ngày mới; tự đóng khi đủ hàng / ra khỏi cửa sổ / huỷ / đã xuất.
- `SalesOrdersService.remove()`: đơn có hàng trong booking chưa huỷ → 409 "gỡ hàng khỏi booking (hoặc huỷ booking) trước khi xoá đơn"; còn
  lại chỉ là dòng của booking đã huỷ → xoá trước để FK không chặn.

## 2. Đã làm - FE

- Mục sidebar **"Lịch xuất hàng"** trong Bán hàng (`SalesApp.tsx`, giữa "Quản lí đơn hàng" và "Quản lí khách hàng").
- `BookingSchedulePage.tsx` (+ `booking/`): chuyển **Lịch tháng** (tự dựng bằng `date-fns`, không thêm thư viện; chip Lấy cont / **CUT OFF
  nền vàng như Excel** / ETD / Cắt SI, viền đỏ khi thiếu hàng, "+n mốc khác"; điện thoại → danh sách theo ngày) và **Bảng** (đúng cột bảng
  booking anh Nhân: STT, Khách, Tên PI, SKU, Số lượng, Số booking, POD, Cắt SI, Ngày lấy cont, CUT OFF, ETD, Nơi lấy cont, Tên tàu, Ghi
  chú + Kho gom, Khối, Hàng, Trạng thái; điện thoại → thẻ). Lọc khách / trạng thái / "hiện booking đã huỷ" / tìm. Prop `readOnly` để sau
  này KHSX / Sếp dùng lại.
- Form booking đủ ô v8 (giờ VN cho Cắt SI / CUT OFF), kho gom tự gợi ý khi mọi dòng cùng 1 kho đóng gói, file / ảnh booking chỉ tải lên khi
  bấm Lưu (`POST /uploads/document` có sẵn), Lưu / Lưu & xác nhận / Huỷ booking (lý do bắt buộc), đổi khách khi có hàng → hỏi rồi xoá hàng.
- Bảng chọn hàng nhóm theo mã PO khách: lệnh SX, SKU, hạn giao, SL đơn, đã xuất, xếp booking khác, đã đóng gói, còn được xếp, ô nhập SL +
  "Lấy hết" (vượt → viền đỏ + không cho lưu), m³/bộ, kho đóng gói; chân bảng: tổng bộ, tổng m³ / sức chứa + % + thanh (đỏ khi vượt), "chưa
  tính được m³ của SKU …", "SKU … đang ở kho A, khác kho gom B". Sau lưu: "thiếu N bộ" theo dòng.
- Hàm `utils/bookingVolume.ts` (cùng luật BE), `utils/bookingDates.ts` (giờ VN cố định), có test. Bài Hướng dẫn "Lịch xuất hàng (Booking)".

## 3. Vì sao / quyết định

- 1 booking gom hàng của NHIỀU đơn cùng 1 khách (v8: "30% đơn A + 30% đơn B") → không lưu mã PO riêng, suy từ các dòng (cột "Tên PI").
- Chọn hàng theo **dòng lệnh SX** (`ProductionInvoiceItem`, 1-1 với dòng đơn, SL đã ghim) nhưng số "đã xuất / còn lại" tính theo dòng đơn
  (`SalesOrderItem`) vì "đã xuất" nằm ở đó. Dòng chưa gom lệnh vẫn chọn được (5.3), hiện "Chưa lên lệnh"; lệnh huỷ không hiện.
- "Chưa đủ hàng" chia hàng sẵn theo ngày hạn để 2 booking cùng 1 dòng đơn không cùng "đếm" 1 lô hàng; chỉ 1 booking thì đúng bằng công
  thức v8 5.8.
- Vượt sức chứa cont chỉ CẢNH BÁO (v8: "hiện tổng m³ so với sức chứa"), không chặn - Sales có thể còn đang sắp xếp.
- Không phát realtime (khỏi đụng `realtime.contract` dùng chung) - người khác thấy thay đổi khi tải lại.

## 4. Review của Opus (sửa gì sau thợ)

Đọc diff thật cả 2 phía; thiết kế bám hợp đồng. Sửa:
- BE: `ACTIVE_STATUSES` thiếu kiểu → tsc lỗi; mock `bookingLine` trong `sales-orders.service.spec.ts` chưa khai kiểu → tsc lỗi; 1 test kỳ vọng
  sai nghĩa `availableQty` (theo hợp đồng = số tối đa CHÍNH booking đó được giữ) → sửa test; `let prisma: any` trong 2 spec làm eslint
  `no-unsafe-call` báo ~40 lỗi → đặt kiểu cho mock; 2 lỗi `no-base-to-string`.
- BE (tìm ra khi chạy thử): máy chậm → `P2028 Unable to start a transaction in the given time` (Prisma chờ mở transaction mặc định 2 s) → 4
  transaction của booking dùng `{ maxWait: 10 s, timeout: 30 s }` như `daily-jobs`.
- FE: 2 ô lọc giãn hết chiều ngang (CSS chung `select { width: 100% }`) + chữ "Hiện booking đã huỷ" gãy 3 dòng; icon mũi tên tháng co còn
  6 px (padding mặc định của nút); 1 dòng hàng hiện 2 lần ý "chưa đủ hàng" + "thiếu N bộ" → gộp 1 dòng; thẻ điện thoại ghép tên tàu vào
  dòng "ETD" → tách dòng "Tàu".
- Repo BE public: số booking thật lấy từ bảng của anh Nhân lọt vào spec + chú thích schema, tên tàu thật ở chú thích / placeholder → thay
  bằng giá trị giả (`BK0000123`, "TÊN TÀU 0123-045N").

## 5. Kiểm tra + chạy thử thật

- BE: jest module liên quan (bookings, daily-jobs, sales-orders, notifications) **9 suite / 184 test xanh**; jest toàn bộ **2375 / 2380
  xanh** (1 skip) - 4 lỗi đều do máy đang rất chậm sau khởi động: 3 test thời gian của `optimize-material.spec.ts` (giải ≤ 20 s; chạy lại
  riêng còn 1 lỗi MC Tự động - loại đã biết chập chờn khi máy bận, không đụng solver) và 1 test `supplier-order-print.spec.ts` của Đợt 5c
  (chạy riêng 4/4 xanh); `tsc --noEmit` chỉ còn 2 lỗi seed cũ; `nest build` OK; eslint file đổi 0 lỗi (1 cảnh báo `any` có sẵn ở
  `notification-types.ts`).
- FE: `tsc --noEmit` sạch; eslint file đổi 0 lỗi (2 cảnh báo ở dòng có sẵn của `SalesApp.tsx`); `vitest run` **32 file / 310 test xanh**.
- Chạy thật BE 3035 + FE 3135 trên `dna_erp_dot10a` (dữ liệu `PA10-`: 2 khách, 3 đơn, 5 lệnh trong đó 1 lệnh huỷ, 1 dòng chưa gom lệnh, SKU
  có / thiếu kích thước thùng, đã đóng gói một phần):
  - Ứng viên đúng (lệnh huỷ không hiện, dòng chưa gom hiện không mã lệnh, sẵn hàng = đã đóng gói − đã xuất). Thủ kho TP tạo booking → 403.
  - **Xếp đồng thời**: 2 PATCH cùng lúc 60 + 60 khi còn 100 → 1 được, 1 bị 400 "chỉ còn 40 bộ"; **5 PATCH cùng lúc 20 bộ khi còn 40 → đúng 2
    được**, tổng giữ đúng 200 = SL dòng.
  - Trùng số booking (khác hoa/thường, thừa khoảng trắng) → 409; huỷ booking → số được trả lại; sửa booking đã huỷ → 409; xác nhận chưa có kho
    → 400, có kho → CONFIRMED; m³: 0,68 × 100 = 68 (100 %), 0,844 × 173 = 146,012 (214,7 %, cảnh báo vượt); SKU thiếu kích thước được báo.
  - Thiếu hàng chia theo ngày: booking A (lấy cont mai) lấy trước 100/120 bộ sẵn → booking B (không ngày) thiếu 40.
  - Cảnh báo `BOOKING_SHORT` (gọi thẳng `syncShortAlerts` vì server thử để `DAILY_JOBS=off`): A thiếu 30 bộ J55 → 1 thông báo tới `sales`,
    `khsx`, `khotp` (thủ kho của kho gom), không tới Mua hàng; chạy lại cùng ngày không gửi trùng; gỡ dòng thiếu → cả 3 người được đóng.
  - Xoá đơn đang có hàng trong booking → 409; huỷ booking rồi xoá → 204, dòng của booking đã huỷ được dọn.
  - Trình duyệt: lịch tháng, bảng, form sửa / tạo (gõ vượt → viền đỏ + nút Lưu tắt; hàng ở Kho TP 2 khác kho gom → nhắc chuyển; kho gom tự
    điền; Lưu & xác nhận); màn 375 px: lịch thành danh sách theo ngày, bảng thành thẻ, form không tràn ngang, ô nhập SL cao 45 px.

## 6. Chỗ đụng phần có sẵn của file dùng chung

- `prisma/schema.prisma`: 4 dòng quan hệ ngược (User, Customer, SalesOrderItem, ProductionInvoiceItem) + khối model mới đặt ngay sau
  `SalesOrderItem` (tránh cuối file - phiên Đợt 3 hay thêm ở đó). Tất cả có chú thích "Phần A – Đợt 10a".
- `src/modules/notifications/notification-types.ts`: thêm interface params + type `BOOKING_SHORT` ở cuối object (Đợt 3 cũng có thể thêm ở
  cuối → gộp dễ xung đột vị trí, giữ cả hai).
- `src/modules/daily-jobs/daily-jobs.service.ts`: 1 import, 1 tham số constructor CUỐI, **1 dòng bước** `cảnh báo booking`; module import
  `BookingsModule`; spec thêm tham số mock thứ 5 + 1 test. (Phiên Đợt 3 sửa nhiều file này ở nhánh khác.)
- `src/modules/sales-orders/sales-orders.module.ts`: import `BookingsModule`.
- `src/modules/sales-orders/sales-orders.service.ts` `remove()`: **đổi hành vi có sẵn** - chặn xoá đơn có hàng trong booking chưa huỷ, dọn
  dòng của booking đã huỷ trước khi xoá. Spec: thêm mock + 2 test.
- FE `SalesApp.tsx` (thêm 1 mục sidebar), `Guide/content/sales.ts` (thêm 1 bài cuối mảng).
- Ngoài repo: `D:\DNA-ERP-BE\.claude\launch.json` thêm `be-3035-dot10a`, `fe-3135-dot10a` (file local, không commit).

## 7. Điểm ghép ④ cho người B (10b)

- Bảng `Booking`, `BookingLine` (`shippedQty` để kho TP ghi số thực xuất; trạng thái `SHIPPED` do 10b đặt).
- "Đã xuất" của dòng đơn đọc ở ĐÚNG 1 hàm `orderShippedQtyOf()` (`src/modules/bookings/bookings.service.ts`) - hiện = `SalesOrderItem.
  shippedQty` (nút "Xuất giao" cũ). 10b đổi nguồn ở đó (hoặc vẫn cộng vào `SalesOrderItem.shippedQty` khi xác nhận).
- Phần "đang giữ" của 1 dòng booking = `qty − shippedQty` khi booking DRAFT/CONFIRMED; SHIPPED / CANCELLED không giữ. Huỷ bị chặn khi có
  dòng `shippedQty > 0`; sửa không được giảm dưới / gỡ dòng đã xuất.
- Danh sách cho kho TP: `GET /bookings?status=CONFIRMED` (+ `warehouseCode` của booking = kho gom). Kho TP hiện chỉ xem được (quyền
  SALES_ORDER:VIEW), ghi bị chặn vai trò - route xác nhận xuất của 10b cần vai trò WAREHOUSE_STAFF riêng.

## 8. Chưa làm / còn treo

- 10b (người B): kho TP xác nhận số thực xuất, trừ tồn, bỏ nút "Xuất giao" cũ, chứng từ xuất hàng. **Trong lúc nút cũ còn**, "Xuất giao"
  cộng `shippedQty` không xét booking → số đã xếp có thể vượt "còn lại" (BE kẹp về 0, không âm).
- Màn xem cho KHSX / Sếp (v8 "KHSX, Sếp xem lịch"): component đã có `readOnly` nhưng chưa gắn vào phân hệ KHSX / Sếp (đụng thêm 2 sidebar
  dùng chung - để quyết sau). Link thông báo BOOKING_SHORT của KHSX tạm trỏ "Tổng hợp lệnh SX".
- Danh sách đơn hàng chưa báo trước "không xoá được vì đang trong booking" (`deleteBlockedReason`) - chỉ báo khi bấm Xoá.
- Chưa thử tải file booking thật (tránh đẩy file thử lên Cloudinary thật) - API nhận url đã thử.
- Cảnh báo hằng ngày thử bằng cách gọi thẳng service (server thử tắt DAILY_JOBS); bước trong `daily-jobs` có unit test.

## 9. Danh sách file để commit

BE (`D:\DNA-ERP-BE-dot10a`):
- `prisma/schema.prisma`, `prisma/migrations/20261104190000_add_bookings/migration.sql`
- `src/modules/bookings/` (`bookings.module.ts`, `bookings.controller.ts`, `bookings.service.ts`, `booking-alerts.service.ts`,
  `booking-calc.util.ts`, `dto/create-booking.dto.ts`, `dto/update-booking.dto.ts`, `dto/cancel-booking.dto.ts`, `dto/booking-query.dto.ts`,
  `dto/booking-response.dto.ts`, 4 spec)
- `src/modules/daily-jobs/daily-jobs.module.ts`, `daily-jobs.service.ts`, `daily-jobs.service.spec.ts`
- `src/modules/notifications/notification-types.ts`
- `src/modules/sales-orders/sales-orders.module.ts`, `sales-orders.service.ts`, `sales-orders.service.spec.ts`
- `docs/changelog-2026-11-04-phan-a-dot-10a.md`

FE (`D:\DNA-ERP-dot10a`) - trừ `next-env.d.ts`, `tsconfig.tsbuildinfo`:
- `src/types/booking.ts`, `src/services/bookings-api.ts`
- `src/utils/bookingVolume.ts`, `src/utils/bookingVolume.test.ts`, `src/utils/bookingDates.ts`, `src/utils/bookingDates.test.ts`
- `src/modules/pages/Sales/BookingSchedulePage.tsx`, `src/modules/pages/Sales/booking/` (`BookingCalendar.tsx`, `BookingTable.tsx`,
  `BookingFormModal.tsx`, `BookingLinePicker.tsx`, `CancelBookingDialog.tsx`, `bookingShared.tsx`)
- `src/modules/pages/Sales/SalesApp.tsx`, `src/modules/pages/Guide/content/sales.ts`

## 10. Trưởng nhóm kiểm lại trước khi gộp (05/11)

- Đọc lại diff thật: migration chỉ THÊM 2 bảng + 1 enum; FK `booking_lines` → `production_invoice_items` / `sales_order_items` là
  Restrict - đã rà các chỗ xoá có sẵn: QLSX/Sếp từ chối chỉ đổi trạng thái dòng (xoá PI khi PI hết dòng), xoá đơn đã dọn dòng booking
  huỷ trước → không có đường nào vướng FK. `Notification.entityType` là chuỗi, 'BOOKING' không cần migration.
- Chạy lại: BE tsc chỉ 2 lỗi seed có từ trước, `nest build` exit 0, jest toàn bộ 112/113 bộ (2378 qua, 1 bỏ qua; 1 lỗi
  `optimize-material.spec.ts` do máy tải nặng - chạy riêng 14/14); FE tsc 0, vitest 32 file 310/310; eslint chỉ cảnh báo có sẵn
  ở `SalesApp.tsx` dòng 29–30.
- Gộp với Đợt 3: 5 file BE cùng sửa (`schema.prisma`, `daily-jobs.module.ts`, `daily-jobs.service.ts`, `daily-jobs.service.spec.ts`,
  `notification-types.ts`). Thử gộp 3 chiều ở thư mục nháp: schema tự gộp; 4 file kia chỉ xung đột kiểu "cả 2 cùng thêm dòng ở 1 chỗ"
  → giữ cả hai. FE không chung file. Thứ tự gộp: Đợt 3 trước, 10a sau.
