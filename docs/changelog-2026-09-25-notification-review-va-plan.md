# Changelog 2026-09-25 — Review tổng thể Notification (DNA-ERP + DNA-ERP-BE) & plan xây lại

> Trạng thái: **Phase 1 (nền tảng BE) và Phase 2 (Notification Center FE + URL) ĐÃ XONG (2026-09-25)
> — xem mục 11, 12** (gồm các đợt sửa sau phản hồi người dùng ở 12.5, 12.6: phân loại lại 21 thông
> báo cũ, bỏ `link` của 4 type cắt sắt). **2026-09-26 (mục 14):** người dùng chốt bỏ hẳn luôn cả 3
> loại thông báo "không thành công" của cắt sắt (cần duyệt tay/auto-duyệt lỗi/solver lỗi) - QLSX giờ
> CHỈ nhận thông báo khi tính xong VÀ tự duyệt OK, đúng flow trước khi có notification.
> **2026-09-26 (mục 15, 16, 17): Phase 3a ĐÃ XONG TOÀN BỘ** - nhóm 7.1 "SKU/định mức" (9 type),
> nhóm 7.2 "Lệnh sản xuất PI" (6 type), nhóm 7.4 "Đề xuất mua hàng" (4 type), cả 3 đều có live-test
> FE thật. **Mục 18:** sửa 1 bug thật (`warehouseIds` sai kiểu dữ liệu) phát hiện lúc rà code chuẩn
> bị Phase 3b. **Mục 19: Phase 3b bắt đầu** - nhóm 7.5-i "Sắt → Phôi → KCS" (4 type) ĐÃ XONG, có
> live-test FE thật.
> **Đang chờ người dùng quyết định:** có xây màn "chi tiết 1 CuttingProposal" (Duyệt/Từ chối) ở FE
> hay không (mục 12.5, 12.6) - bớt cấp thiết hơn sau mục 14 vì QLSX không còn thấy thông báo "cần
> duyệt tay" để mà cần bấm vào nữa.
> **2026-09-28 (mục 20):** dọn nốt các việc nhỏ còn treo của Phase 2 - sửa double-poll (mục 12.4),
> khôi phục sau sự cố merge Git làm mất lại `NotificationCenter`/gỡ `NotifBell` ở 3 file, thêm `?p=`
> URL-sync cho `AdminApp.tsx` và `SalesApp.tsx` (nay cả 7/7 app shell đồng bộ URL).
> **2026-09-28 (mục 21): xây trang "Thông báo của tôi" riêng - PHASE 2 HOÀN TẤT TOÀN BỘ.**
> **2026-09-28 (mục 22): Phase 3b nhóm 7.5-ii "Xuất vật tư tiêu hao/thành phẩm/bao bì" ĐÃ XONG**
> (3 type mới) + nhân tiện gắn `link` cho 3 type nhóm 7.5-i (mục 19) vốn thiếu vì lúc đó `?p=` chưa
> có ở `MfgApp.tsx`.
> **2026-09-28 (mục 23): Phase 3b nhóm 7.5-iii "Chuyển kho ngoài đơn hàng" ĐÃ XONG** (2 type mới) -
> nhân tiện vá 1 lỗ hổng THẬT trong cơ chế điều hướng chung: `NotificationLink.params` được khai báo
> từ đầu nhưng chưa từng được đọc ở FE, chặn deep-link vào sub-tab.
> **2026-09-28 (mục 24): Phase 3b nhóm 7.5-v "Chuyền kiểm có lỗi" ĐÃ XONG** (1 type mới, tái dùng
> `NotificationsService` đã có sẵn ở `production-invoices.service.ts` từ Phase 3a, không cần DI mới).
> **2026-09-28 (mục 25): Phase 3b nhóm 7.5-vi "Đóng gói xong → Sales" ĐÃ XONG** (1 type mới, cùng
> service).
> **2026-09-28 (mục 26): Phase 3b nhóm 7.5-iv "Xuất/nhận đan" ĐÃ XONG (1 type mới) - PHASE 3B HOÀN
> TẤT TOÀN BỘ 6 NHÓM.** Người dùng chốt thiết kế trước khi code (đơn giản, non-tech): mirror
> `PI_SENT_TO_QLSX` - `entityId` khoá ghép `(productionOrderId, pieceId, weavingPointId)`, tự đóng
> khi tổng đang treo tại điểm đan về đúng 0. **Rà lại mục 7/8 sau đó (mục 26.5): "Phase 3c" trong
> plan gốc (hàng về, đóng gói xong → Sales) hoá ra đã làm xong từ trước trong 3a/mục 17 và 3b/mục 25
> - PHASE 3 (3a+3b+3c) ĐÃ ĐÓNG HOÀN TOÀN, không còn việc gì treo lại.** Đang bắt đầu Phase 4 (badge
> "việc chờ tôi", mục 6.3/8).
> **2026-09-29 (mục 27): Phase 4 ĐÃ XONG TOÀN BỘ (BE+FE) - PHASE 1–4 HOÀN TẤT.** BE: endpoint
> `GET /me/work-queue` (10 khoá đếm theo 9 role, research trước khi code phát hiện bảng plan mục 6.3
> SAI/THIẾU ở 5 chỗ - đáng chú ý nhất: đếm thẳng cột `SalesOrderItem.status` sẽ LUÔN ra 0 vì cột đó
> đứng yên vĩnh viễn từ 2026-09-24, và Mua hàng "NEW/QUOTING" theo plan gốc bỏ sót ~36 dòng thật).
> FE: gắn badge vào 6/7 app shell (Admin không có role nào trong bảng mục 6.3). Live-test thật đối
> chiếu `psql` cho cả 15 account demo (BE) + chụp trực tiếp trên UI cho 4 ca (FE) - khớp tuyệt đối.
> Chỉ còn Phase 5 (realtime, tuỳ chọn) chưa làm.
>
> Cách đọc: mục 2–7 là review + kiến trúc ĐÍCH viết TRƯỚC khi code; chỗ nào thực tế làm khác thì mục
> 11.2 / 12.x là nguồn đúng (mục 5 có ghi chú trỏ sang). Mục 8 là plan theo phase; khi làm xong phase
> nào thì cập nhật tiêu đề phase đó + mục lục bên dưới.

## Mục lục

1. Bối cảnh
2. Hiện trạng (đã kiểm chứng trong code)
3. Vấn đề — nhìn từ PM / senior
4. Nguyên tắc thiết kế cho bản mới
5. Kiến trúc đích — BE
6. Kiến trúc đích — FE (UX từng màn)
7. Danh mục sự kiện theo từng luồng / từng màn
8. Plan triển khai theo phase — _Phase 1–4 ĐÃ XONG TOÀN BỘ; Phase 5 chưa làm_
9. Quyết định đã chốt với người dùng — _đã chốt 2026-09-25_
10. Những gì CHƯA làm tại thời điểm review — _lỗi thời, giữ làm lịch sử_
11. Phase 1 — Nền tảng BE — _ĐÃ XONG 2026-09-25_
12. Phase 2 — Notification Center FE + URL — _ĐÃ XONG 2026-09-25_ (12.5, 12.6: sửa sau phản hồi;
    còn chờ quyết định màn chi tiết CuttingProposal)
13. Rà soát nhất quán tài liệu — _2026-09-26_
14. Bỏ hẳn thông báo QLSX cho 3 nhánh "không thành công" của cắt sắt — _ĐÃ XONG 2026-09-26_
15. Phase 3a — nhóm 7.1 "SKU/định mức" (9 sự kiện) — _ĐÃ XONG 2026-09-26_
16. Phase 3a — nhóm 7.2 "Lệnh sản xuất PI" (6 sự kiện) — _ĐÃ XONG 2026-09-26_
17. Phase 3a — nhóm 7.4 "Đề xuất mua hàng" (4 sự kiện) — _ĐÃ XONG 2026-09-26, Phase 3a hoàn tất_
18. Sửa bug `warehouseIds` sai kiểu dữ liệu ở `PURCHASE_PROPOSAL_ITEM_RECEIVED` — _ĐÃ XONG 2026-09-26_
19. Phase 3b — nhóm 7.5-i "Sắt → Phôi → KCS" (4 sự kiện) — _ĐÃ XONG 2026-09-26_
20. Dọn nốt việc nhỏ còn treo của Phase 2 (double-poll, sự cố merge Git, `?p=` AdminApp) — _ĐÃ XONG 2026-09-28_
21. Trang "Thông báo của tôi" riêng — _ĐÃ XONG 2026-09-28, Phase 2 hoàn tất toàn bộ_
22. Phase 3b — nhóm 7.5-ii "Xuất vật tư tiêu hao/thành phẩm/bao bì" (3 sự kiện) + gắn `link` còn thiếu cho nhóm 7.5-i — _ĐÃ XONG 2026-09-28_
23. Phase 3b — nhóm 7.5-iii "Chuyển kho ngoài đơn hàng" (2 sự kiện) + vá `NotificationLink.params` chưa từng được đọc ở FE — _ĐÃ XONG 2026-09-28_
24. Phase 3b — nhóm 7.5-v "Chuyền kiểm có lỗi" (1 sự kiện) — _ĐÃ XONG 2026-09-28_
25. Phase 3b — nhóm 7.5-vi "Đóng gói xong → Sales" (1 sự kiện) — _ĐÃ XONG 2026-09-28_
26. Phase 3b — nhóm 7.5-iv "Xuất/nhận đan" (1 sự kiện) — _ĐÃ XONG 2026-09-28, PHASE 3B HOÀN TẤT TOÀN BỘ_
27. Phase 4 — Badge "việc chờ tôi" (`GET /me/work-queue` + gắn vào 6/7 app shell) — _ĐÃ XONG TOÀN BỘ 2026-09-29_

---

## 1. Bối cảnh

Người dùng: *"phần notification đang rất là junior… review tổng quan với góc nhìn PM/expert/senior để
build hoàn chỉnh notification cho từng màn… lên plan chi tiết"*. Review này đọc toàn bộ code liên quan
ở cả 2 repo, không chạy/sửa gì.

## 2. Hiện trạng (đã kiểm chứng trong code)

### 2.1 BE — `src/modules/notifications`

- Schema: `Notification { title, message, audience, createdBy }` + `NotificationRead` (junction đã đọc)
  — [schema.prisma:205](../prisma/schema.prisma). `NotificationAudience` chỉ có 4 giá trị:
  `ALL | BOSS | WAREHOUSE_STAFF | PRODUCTION_MANAGER`.
- 3 endpoint: `POST /notifications` (admin broadcast), `GET /notifications` (lọc theo audience của
  người gọi), `POST /notifications/:id/read`.
- Không có: unread-count, mark-all-read, lọc chưa đọc, link tới đối tượng, loại/mức độ, người nhận
  cụ thể, dọn dữ liệu cũ, realtime.
- **Chỉ có đúng 1 nơi phát thông báo tự động** trong toàn hệ thống:
  `CuttingProposalsService.notifyProductionManagers()` ([cutting-proposals.service.ts:2108](../src/modules/cutting-proposals/cutting-proposals.service.ts))
  — 4 biến thể text (tự duyệt OK / cần duyệt tay / tự duyệt lỗi / solver lỗi), gắn số PO vào chuỗi,
  không có id đối tượng để bấm vào.
- `getAudiencesForUser()` so `user.roles` với tên enum — role 12 business role khác (Sales, KHSX, Phôi,
  Hàn, Sơn, KCS, Mua hàng, Spec…) **không có audience riêng**, chỉ nhận được `ALL`.
- `sortBy` nhận chuỗi tuỳ ý (`PaginationQueryDto`) → truyền field lạ sẽ ném lỗi Prisma 500 (lỗi
  chung của pattern paginate, không riêng notifications).

### 2.2 FE — `D:\DNA-ERP\src`

- `notifications-api.ts` có `getNotifications()` (cứng `limit=100`), `createNotification()`,
  `markNotificationRead()` — **`markNotificationRead` không được gọi ở đâu cả** → cờ `isRead` BE trả
  về là tính năng chết.
- `getNotifications()` chỉ được dùng ở **`Admin/NotificationsPage`** (trang CRUD admin). Không có
  chuông/hộp thông báo toàn cục ở bất kỳ app shell nào (`SalesApp`, `MfgApp`, `ProductionPlanApp`,
  `PurchasingApp`, `InboundWarehouseApp`, `BossApp`…).
  → **Thông báo cắt sắt BE gửi cho QLSX không bao giờ hiển thị cho QLSX.** Chỉ admin (nếu vào trang
  admin) mới thấy — mà admin lại chỉ thấy audience `ALL` (xem dưới), nên thực tế **không ai thấy**.
- `Admin/NotificationsPage`: admin tạo thông báo cho `BOSS`/`WAREHOUSE_STAFF`/`PRODUCTION_MANAGER`
  xong thì **không thấy lại chính thông báo mình vừa tạo** (list lọc theo audience của người gọi).
  Lọc/tìm kiếm là client-side trên 100 dòng đầu. Config còn `deleteConfirm` dù không có delete (dead).
- `components/NotifBell.tsx`: chuông "giả" dùng ở `SpecSteelPage.tsx:350` và
  `SpecDetailQuotaPage.tsx:167` — dựng từ state trang (các BOM có trạng thái `approved`), **không nối
  BE**, "đã xem" lưu trong `useState` nên F5 là hiện lại hết, badge đếm tất cả BOM đã duyệt từ trước
  tới nay (tăng mãi), không theo user.
- Điều hướng FE dùng state (`activeModule` ở `app/page.tsx` + state `page` trong từng `*App.tsx`),
  **không có URL route** cho từng màn/đối tượng → hiện tại không có cách "bấm thông báo mở đúng PI
  X". Đây là điều kiện tiên quyết phải giải ở phase FE.
- Nhiều màn đang tự poll (`LenhSXPage` / `CuttingProposalsPage` `setInterval 20s`) để thấy trạng thái
  mới — đúng là triệu chứng của việc thiếu kênh thông báo.

## 3. Vấn đề — nhìn từ PM / senior

| # | Vấn đề | Hệ quả nghiệp vụ | Mức |
|---|---|---|---|
| P1 | Không có nơi hiển thị thông báo cho người dùng cuối | Thông báo duy nhất có thật (cắt sắt) bị mất; QLSX phải tự mở màn để phát hiện | Cao |
| P2 | Mô hình "broadcast theo 4 audience" thay vì "người nhận cụ thể" | Không báo được cho Sales/KHSX/Phôi/Hàn/Sơn/KCS/Mua hàng/Spec; không báo đúng kho (warehouseScope); không báo đúng người tạo đơn | Cao |
| P3 | Hầu hết điểm bàn giao giữa các vai trò (handoff) không phát thông báo | Quy trình KHSX→QLSX→Sếp, Kho→Phôi→KCS, Mua→Kho… chạy bằng "hỏi miệng"/Zalo, trễ việc | Cao |
| P4 | Thông báo không có đối tượng/link, không có loại, không có mức độ | Không bấm vào được, không lọc được, không phân biệt "cần làm ngay" vs "để biết" | Trung bình |
| P5 | Không tự "đóng" khi việc đã được người khác xử lý | Khi có ≥2 QLSX / nhiều nhân viên kho, thông báo "cần duyệt" vẫn nằm đó sau khi đã duyệt → nhiễu, xử lý trùng | Trung bình |
| P6 | Chuông giả trên màn Spec | UX mâu thuẫn (F5 hiện lại, badge tăng mãi), người dùng mất niềm tin vào chuông | Trung bình |
| P7 | Không có badge "việc đang chờ tôi" trên menu | Người dùng phải mở từng tab để biết có việc | Trung bình |
| P8 | Không unread-count, không mark-all, không dọn dữ liệu, không realtime | Không build được chuông hiệu quả; bảng phình vô hạn | Thấp→TB |

Tóm lại: đang có **một bảng tin (bulletin board)**, chưa có **hệ thống thông báo nghiệp vụ**.

## 4. Nguyên tắc thiết kế cho bản mới

1. **Tách 3 khái niệm, đừng trộn:**
   - **Việc cần làm (work queue / badge)** — *suy ra từ trạng thái dữ liệu*, vd "3 PI chờ QLSX duyệt".
     Luôn đúng vì là query, không bao giờ "lệch". Hiện ở badge trên menu.
   - **Thông báo sự kiện (event notification)** — *một điều vừa xảy ra liên quan tới tôi*, vd "Sếp
     đã từ chối PI-2026-013: lý do …". Gửi tới người cụ thể, có link, có trạng thái đọc.
   - **Thông báo chung (announcement)** — admin/ Sếp phát cho cả công ty hoặc 1 nhóm. Giữ tính năng
     hiện có.
2. **Chỉ báo ở điểm bàn giao giữa người/vai trò** (handoff), kết quả của việc mình đã gửi đi (duyệt /
   từ chối / lỗi), và cảnh báo thật sự. Không báo cho chính người vừa thao tác (exclude actor).
3. **Mỗi thông báo trả lời được 3 câu:** chuyện gì, về đối tượng nào (mã PI/PO/SKU…), tôi cần làm gì
   (nút/link mở đúng chỗ).
4. **Người nhận được tính ở BE** theo role + `mfgRole` + kho (`warehouseScope`/`Material.warehouseId`)
   + người liên quan (người tạo/đã gửi đi). FE không tự quyết ai nhận.
5. **Tự đóng (auto-resolve):** thông báo loại "cần xử lý" được đánh dấu `resolved` cho mọi người nhận
   ngay khi đối tượng rời trạng thái đó (ai đó đã duyệt/nhận/từ chối).
6. **Gộp chống spam (dedupe):** cùng loại + cùng đối tượng trong khoảng ngắn thì cập nhật dòng cũ thay
   vì thêm dòng mới (vd solver tính lại nhiều lần).
7. **Tôn trọng các quyết định "by design" đã chốt** — KHÔNG thêm cảnh báo cho: nhận hàng vượt số đặt
   mua (chủ đích), Hàn/Sơn báo sản lượng không đối chiếu Phôi (chủ đích), đoạn cắt dư không tự vào kho
   (chủ đích). Mua hàng không gắn kho — thông báo "hàng về" gửi theo `Material.warehouseId`.
8. **Nguồn sự thật ở BE** — FE chỉ render theo `type` + dữ liệu BE trả, không dịch lại.

## 5. Kiến trúc đích — BE

### 5.1 Schema (1 migration, giữ dữ liệu cũ)

```prisma
enum NotificationCategory { ANNOUNCEMENT  ACTION_REQUIRED  RESULT  ALERT  INFO }
enum NotificationSeverity { INFO  SUCCESS  WARNING  CRITICAL }

/// 1 dòng = 1 sự kiện. Nội dung đã render sẵn (tiếng Việt) để FE chỉ việc hiện.
model Notification {
  id         String               @id @default(uuid())
  type       String               /// vd "PI_ITEM_SENT_TO_QLSX" - khoá vào NOTIFICATION_TYPES
  category   NotificationCategory
  severity   NotificationSeverity @default(INFO)
  title      String
  message    String
  entityType String?              /// "PRODUCTION_INVOICE" | "SKU" | "PURCHASE_PROPOSAL" ...
  entityId   String?
  link       Json?                /// { module, page, params } - FE map sang điều hướng
  data       Json?                /// payload thô (mã PI, lý do...) cho FE hiển thị thêm
  actorId    String?              /// người gây ra sự kiện (null = hệ thống)
  dedupeKey  String?              /// type:entityId - dùng để gộp
  audience   NotificationAudience? /// chỉ còn dùng cho ANNOUNCEMENT (giữ tương thích)
  createdBy  String?
  createdAt  DateTime             @default(now())
  updatedAt  DateTime             @updatedAt

  recipients NotificationRecipient[]
  @@index([entityType, entityId])
  @@index([dedupeKey])
}

/// Fan-out theo người nhận - thay NotificationRead. Số user chỉ vài chục nên fan-out lúc ghi rẻ,
/// đổi lại đọc/đếm chưa đọc chỉ là 1 index scan theo userId.
model NotificationRecipient {
  notificationId String
  userId         String
  createdAt      DateTime  @default(now())   /// copy để index sort theo user
  readAt         DateTime?
  resolvedAt     DateTime? /// việc đã được xử lý (bởi ai đó) - FE làm mờ + đẩy xuống
  archivedAt     DateTime? /// người dùng tự ẩn

  notification Notification @relation(fields: [notificationId], references: [id], onDelete: Cascade)
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@id([notificationId, userId])
  @@index([userId, readAt, createdAt])
  @@map("notification_recipients")
}
```

Migration dữ liệu: mỗi `Notification` cũ → `category = ANNOUNCEMENT` (hoặc `RESULT` cho 22+ dòng cắt
sắt, nhận diện theo `createdBy IS NULL`), fan-out cho user active khớp audience; copy `readAt` từ
`notification_reads`; rồi drop `notification_reads`.

### 5.2 Danh mục loại thông báo — 1 nguồn duy nhất

`src/modules/notifications/notification-types.ts`:

```ts
export const NOTIFICATION_TYPES = {
  PI_ITEM_SENT_TO_QLSX: {
    category: 'ACTION_REQUIRED', severity: 'INFO', entityType: 'PRODUCTION_INVOICE',
    title: (p) => `${p.piCode}: ${p.count} SKU chờ QLSX duyệt`,
    message: (p) => `KHSX ${p.actorName} đã gửi duyệt.`,
    link: (p) => ({ module: 'production-plan', page: 'lenh-sx', params: { piId: p.piId } }),
    resolveWhen: 'PI item rời WAITING_QLSX',
  },
  // ...
} satisfies Record<string, NotificationTypeDef>;
```

Lợi ích: text/link/mức độ tập trung 1 chỗ, test snapshot được, FE có thể lấy icon theo `type`.

### 5.3 API nội bộ cho các service

```ts
notifications.emit(
  'PI_ITEM_SENT_TO_QLSX',
  { recipients: { roles: ['PRODUCTION_MANAGER'] }, entityId: pi.id, actorId: user.id, params },
  tx, // optional: Prisma tx của nghiệp vụ
);
notifications.resolve({ entityType: 'PRODUCTION_INVOICE', entityId, types: ['PI_ITEM_SENT_TO_QLSX'] }, tx);
```

- `RecipientResolver`: `roles[]`, `mfgRoles[]`, `warehouseIds[]` (user có `warehouseScope` khớp),
  `userIds[]`, `permissions[]` (vd ai có `PURCHASE_PROPOSAL:UPDATE`); luôn lọc `isActive && !deletedAt`
  và bỏ `actorId` (trừ khi type khai `notifyActor`). **Sếp (BOSS) chỉ nhận** (mục 9.3): type
  `ACTION_REQUIRED` cần Sếp duyệt + mọi type `severity = CRITICAL` (resolver tự thêm BOSS cho CRITICAL).
  Không cc Sếp các RESULT/INFO.
- **Giao dịch:** emit trong CÙNG `tx` với thay đổi nghiệp vụ → không bao giờ có "đã duyệt mà không báo"
  hoặc "báo mà rollback". Ngoại lệ: luồng async ngoài request (solver cắt sắt) giữ kiểu best-effort
  như `notifyProductionManagers` hiện nay (try/catch + log).
- Dedupe: nếu có `Notification` cùng `dedupeKey` chưa resolved trong 30 phút → cập nhật
  title/message/`updatedAt` + reset `readAt` của recipients, không tạo mới.
  > ⚠️ **Thực tế khác (Phase 1):** code KHÔNG có khung 30 phút — chỉ kiểm "còn recipient chưa
  > `resolvedAt`" (xem mục 11.2, gạch đầu dòng về dedupe).

### 5.4 Endpoint (người dùng)

> ⚠️ **Thực tế khác (Phase 1):** giữ gốc `/notifications` thay vì `/me/notifications`, phân trang
> offset thay vì cursor, `/me/work-queue` và `/stream` chưa làm — xem mục 11.2.

| Method | Path | Mục đích |
|---|---|---|
| GET | `/me/notifications?status=unread\|all&category=&cursor=&limit=` | list của tôi, cursor-based, mới nhất trước, `resolved` xuống cuối |
| GET | `/me/notifications/unread-count` | 1 số nguyên + `{ byCategory }` — endpoint poll rẻ |
| POST | `/me/notifications/:id/read` | đánh dấu đọc (idempotent) |
| POST | `/me/notifications/read-all` | đọc hết (tuỳ chọn `category`) |
| POST | `/me/notifications/:id/archive` | ẩn |
| GET | `/me/work-queue` | badge "việc chờ tôi" suy ra từ state (mục 6.3) |
| GET | `/me/notifications/stream` | (Phase 5) SSE — đẩy `{unreadCount, latest}` |

Admin: giữ `POST /notifications` (announcement, fan-out theo audience/role), thêm
`GET /notifications/sent` (admin thấy mọi thông báo đã phát + tỉ lệ đã đọc).
Giữ `GET /notifications` cũ 1 phiên bản để FE cũ không vỡ, rồi bỏ.

### 5.5 Vận hành

- Dọn: xoá recipient đã đọc > 90 ngày, notification không còn recipient (script/cron nhẹ — hiện chưa
  có `@nestjs/schedule`; có thể chạy khi khởi động hoặc thêm schedule).
- Test: unit cho `RecipientResolver`, `emit` (dedupe, exclude actor, tx), từng type render đúng; e2e
  cho các handoff chính (mục 7, nhóm A).

## 6. Kiến trúc đích — FE (UX từng màn)

### 6.1 Notification Center toàn cục

- Component `NotificationCenter` gắn vào **header/sidebar của MỌI `*App.tsx`** (cùng vị trí, cùng
  hành vi) + `ModuleSelector`. Thay hẳn `NotifBell` cục bộ ở `SpecSteelPage`/`SpecDetailQuotaPage`.
- Chuông + badge số chưa đọc (99+). Mở ra panel:
  - Tab: **Cần xử lý** (ACTION_REQUIRED chưa resolved) · **Tất cả** · (Sếp/Admin) **Thông báo chung**.
  - Nhóm theo thời gian: Hôm nay / Hôm qua / Trước đó; thời gian tương đối ("5 phút trước").
  - Mỗi dòng: icon theo `severity`, tiêu đề đậm nếu chưa đọc, 1–2 dòng mô tả, mã đối tượng dạng chip,
    tên người thao tác. Dòng đã resolved: mờ + nhãn "Đã xử lý bởi …".
  - Bấm dòng → mark read + điều hướng tới `link`. Nút "Đánh dấu đã đọc tất cả".
  - Chân panel: "Xem tất cả" → trang **Thông báo của tôi** (lọc theo loại, tìm kiếm, phân trang BE).
- Mobile (<900px, nhân viên xưởng dùng điện thoại): panel thành sheet full-width từ dưới lên.
- Thông báo mới `CRITICAL`/`ACTION_REQUIRED` → toast nhỏ 5s (không toast cho INFO).
- Cập nhật: poll `unread-count` 30s, dừng khi tab ẩn (`visibilitychange`), refetch khi focus lại; chỉ
  gọi list khi mở panel. (Phase 5 đổi sang SSE, giữ poll làm fallback.)
- Hook `useNotifications()` + context để badge/toast/panel dùng chung 1 nguồn, không mỗi màn tự fetch.

### 6.2 Điều hướng theo link (điều kiện tiên quyết)

App chưa có URL route. **Đã chốt (mục 9.2): điều hướng theo URL** — chuẩn của các ERP (Odoo
`/odoo/action-…/<id>`, SAP Fiori `#SemanticObject-action?id=`, NetSuite/Dynamics đều có URL cho từng
bản ghi): thông báo, email, tin nhắn Zalo, bookmark, F5, nút Back đều mở đúng bản ghi.

Cách làm không phá cấu trúc hiện tại (không chuyển sang App Router từng trang):
- Đồng bộ state ↔ query string: `/?m=production-plan&p=lenh-sx&piId=123`. `app/page.tsx` đọc `m`
  thay cho `activeModule` khởi tạo; mỗi `*App.tsx` (Admin, Boss, ProductionPlan, Sales, Mfg,
  Purchasing, InboundWarehouse) đọc `p` + params thay cho `useState<Page>` khởi tạo, và ghi lại URL
  (`router.replace` khi đổi tab trong trang, `router.push` khi mở 1 bản ghi → Back hoạt động).
- Hook dùng chung `useUrlState()` để 7 shell không mỗi nơi tự viết.
- `link` trong thông báo lưu dạng `{ module, page, params }` (BE không biết URL FE) — FE dựng URL từ
  đó, nên sau này đổi sang route thật cũng không phải migrate dữ liệu thông báo.

Nếu người dùng không có quyền module của link → mở module mặc định + toast "Bạn không có quyền xem".

### 6.3 Badge "việc chờ tôi" trên menu

`GET /me/work-queue` trả số theo key, FE gắn vào item menu tương ứng:

| Vai trò | Menu | Đếm |
|---|---|---|
| QLSX | Xử lý lệnh sản xuất | PI item `WAITING_QLSX`; đề xuất cắt sắt `DRAFT` cần duyệt tay / `FAILED` |
| Sếp | Chờ duyệt › SKU mới / Lệnh SX | SKU chờ Sếp; PI item `WAITING_BOSS` |
| KHSX | Duyệt SKU / Lệnh SX | định mức chờ review; PI item bị từ chối chưa sửa |
| Spec sắt / chi tiết | Định mức | SKU cần nhập/sửa định mức (mới hoặc bị trả về) |
| Mua hàng | Theo dõi mua hàng | đề xuất `NEW`/`QUOTING` |
| Kho (theo kho) | Nhập/Xuất/Chuyển kho | phiếu chuyển `PENDING` tới kho mình; hàng mua đang chờ nhận |
| Phôi | Xác nhận nhận sắt | steel issue `ISSUED` chưa nhận |
| KCS | KCS Phôi/Hàn/Sơn | cut bundle / batch `AWAITING_QC` |
| Sales | Đơn hàng | dòng đơn đã `DONG_GOI`/`HOAN_THANH` chưa giao |

Badge **luôn khớp dữ liệu** vì là query — đây là thứ người dùng xưởng nhìn nhiều nhất, quan trọng
hơn cả chuông.

### 6.4 Admin — Thông báo chung

Tách `Admin/NotificationsPage` thành "Thông báo chung": list **mọi** thông báo đã phát (không lọc theo
audience của admin), cột "Đã đọc x/y", chọn người nhận theo role (đa chọn, đủ 13 role) hoặc theo kho;
xem trước; bỏ config `deleteConfirm` chết. (Thu hồi/sửa: không cần ở bản đầu.)

## 7. Danh mục sự kiện theo từng luồng / từng màn

Ký hiệu nhóm ưu tiên: **A** = bàn giao chặn luồng (làm trước), **B** = bàn giao sàn xưởng,
**C** = kết quả/để biết. "Tự đóng" = resolve khi đối tượng rời trạng thái.

### 7.1 Đơn hàng & SKU / định mức

| Nhóm | Sự kiện (trigger) | Người nhận | Loại | Tự đóng khi |
|---|---|---|---|---|
| B | Sales tạo/sửa đơn có SKU chưa có định mức (`POST /sales-orders`) | KHSX | ACTION | SKU được tạo/duyệt |
| A | KHSX tạo SKU cần định mức (`POST /skus`) | Spec sắt + Spec chi tiết | ACTION | định mức được nộp |
| A | Spec nộp định mức mảnh / chi tiết (`manh-quota`, `detail-quota`) | KHSX | ACTION | KHSX review xong |
| A | KHSX trả về định mức (`…/review` reject) — kèm lý do | Spec tương ứng | ACTION (WARNING) | nộp lại |
| A | KHSX gửi Sếp (`approve-parts` + `approve-detail` đủ) | Sếp | ACTION | Sếp duyệt/từ chối |
| A | Sếp duyệt SKU (`/approve`) | KHSX, Spec, Sales tạo đơn liên quan | RESULT (SUCCESS) | — |
| A | Sếp từ chối SKU (`/reject-boss`) — kèm lý do | KHSX, Spec | RESULT (WARNING) | — |

→ Thay thế `NotifBell` giả ở 2 màn Spec.

### 7.2 Lệnh sản xuất (PI) — KHSX → QLSX → Sếp

| Nhóm | Sự kiện | Người nhận | Loại | Tự đóng |
|---|---|---|---|---|
| A | `send-to-qlsx` / `send-to-qlsx-batch` (gộp 1 thông báo/PI, "n SKU") | QLSX | ACTION | item rời `WAITING_QLSX` |
| A | `reject-by-qlsx` / batch — kèm lý do | KHSX gửi | RESULT (WARNING) | — |
| A | `send-to-boss` / batch | Sếp | ACTION | item rời `WAITING_BOSS` |
| A | Sếp `approve` / batch | KHSX, QLSX | RESULT (SUCCESS) | — |
| A | Sếp `reject` / batch — kèm lý do | KHSX, QLSX | RESULT (WARNING) | — |
| A | Tạo lệnh SX sau duyệt thất bại / `retry-production-order` lỗi | QLSX | ALERT (CRITICAL) | retry thành công |

### 7.3 Đề xuất cắt sắt (đã có — nâng cấp)

| Nhóm | Sự kiện | Người nhận | Loại |
|---|---|---|---|
| A | Tính xong + tự duyệt | QLSX | RESULT (SUCCESS) |
| A | Tính xong – cần duyệt tay (lý do) | QLSX | ACTION, tự đóng khi approve/superseded |
| A | Tự duyệt lỗi / solver lỗi | QLSX | ALERT (CRITICAL) |

Giữ đúng 4 nội dung hiện tại của `notifyProductionManagers`, chỉ đổi sang `emit()` có `entityId`,
`link` tới PO, `dedupeKey = CUTTING_PROPOSAL:{poId}` (tính lại nhiều lần không spam).

> ⚠️ **Thực tế khác:** `entityType = CUTTING_PROPOSAL`, `dedupeKey = {type}:{proposalId}` (mục
> 11.2); **không có `link`** — đã bỏ hẳn ở mục 12.6 vì mọi đích đều gây hiểu lầm.
> **2026-09-26 (mục 14):** 2 dòng "cần duyệt tay" và "tự duyệt lỗi/solver lỗi" ở bảng trên **đã bị
> xoá hẳn** (không chỉ bỏ link) - QLSX giờ chỉ còn nhận đúng 1 dòng đầu tiên ("Tính xong + tự
> duyệt"). Bảng trên giữ nguyên để thấy Ý ĐỊNH BAN ĐẦU, không phải trạng thái hiện tại.

### 7.4 Mua hàng

| Nhóm | Sự kiện | Người nhận | Loại | Tự đóng |
|---|---|---|---|---|
| A | Đề xuất mua mới (từ cắt sắt / kiểm kho / định mức cắt PI) | Mua hàng | ACTION | rời `NEW` |
| C | Đã tải file duyệt ký tay (`approval-file`) | QLSX (người phát sinh nhu cầu) | INFO | — |
| B | Hàng về — nhận từng dòng (`items/:itemId/receive`) | Kho theo `Material.warehouseId`; QLSX nếu đề xuất từ cắt sắt/PI | RESULT | — |
| C | Đề xuất đủ hàng (`PURCHASED`) | QLSX, Mua hàng | RESULT (SUCCESS) | — |

Không phát cảnh báo khi nhận vượt số đặt (chủ đích). Bước "Sếp duyệt mua" đang làm ngoài phần mềm
(quyết định 2026-08-27) → không có thông báo cho Sếp ở luồng này.

### 7.5 Kho & bàn giao sàn xưởng

| Nhóm | Sự kiện | Người nhận | Loại | Tự đóng |
|---|---|---|---|---|
| B | Kho xuất sắt cho PI (`steel-issues` tạo) | Phôi | ACTION | Phôi `receive` |
| B | Phôi xong bó cắt (`cut-bundles/:id/finish`), xong đợt (`production-batches/:id/finish`) | KCS | ACTION | KCS review |
| B | KCS đánh giá có lỗi / trả về | Tổ gửi (Phôi/Hàn/Sơn) + QLSX | RESULT (WARNING) | — |
| C | KCS đạt | QLSX | INFO (gộp theo PI/ngày) | — |
| B | Xuất vật tư / vật tư định mức / bao bì (`material-issues`, `material-yield-issues`, `packaging-issues`) | Tổ nhận | ACTION | `receive` |
| B | Phiếu chuyển kho tạo (`warehouse-transfers`) | Kho đích (theo `warehouseScope`) | ACTION | confirm/reject |
| B | Kho đích từ chối phiếu — lý do | Người tạo phiếu | RESULT (WARNING) | — |
| B | Xuất đan / nhận đan (`weaving-issues`, `weaving-receipts`) | Kho nhập đan / QLSX | ACTION/INFO | nhận |
| B | Chuyển kiểm có lỗi (`transfer-check`) | QLSX | RESULT (WARNING) | — |
| C | Đóng gói xong (`packaging`) → dòng đơn sẵn giao | Sales phụ trách đơn | RESULT (SUCCESS) | Sales `ship` |

**Không** thêm thông báo "Hàn/Sơn vượt số Phôi đã cắt" và "đoạn cắt dư chưa nhập kho" (chủ đích).

### 7.6 Để sau (Phase 5+)

Điều chỉnh tồn kho lớn (`stock/adjust`) → Sếp; tồn dưới mức tối thiểu (schema chưa có `minStock`);
đơn hàng sắp trễ hạn. (Digest cuối ngày cho Sếp: **không làm** — Sếp chỉ nhận việc cần duyệt + CRITICAL,
mục 9.3.)

## 8. Plan triển khai theo phase — _Phase 1–4 ĐÃ XONG TOÀN BỘ (mục 26.5, 27); Phase 5 chưa làm_

### Phase 0 — Chữa cháy — _BỎ (người dùng chốt 2026-09-25, mục 9.5)_

Mục tiêu: thông báo đang có không còn bị "mất" trong lúc chờ bản mới.
- FE: gắn chuông tạm dùng API cũ (`getNotifications` + `markNotificationRead`) vào `ProductionPlanApp`
  / `MfgApp` cho QLSX; badge = số `!isRead`.
- BE: `getAudiencesForUser` coi `mfgRole === 'PRODUCTION_MANAGER'` tương đương role QLSX (phòng user
  chỉ có mfgRole); whitelist `sortBy` cho notifications.
- Admin page: admin thấy mọi thông báo đã tạo.
- **Đã bỏ:** vào thẳng Phase 1. Riêng whitelist `sortBy` và coi `mfgRole = PRODUCTION_MANAGER` như
  role QLSX được gộp vào `RecipientResolver`/endpoint mới ở Phase 1.

### Phase 1 — Nền tảng BE — _ĐÃ XONG 2026-09-25, xem mục 11 cho chi tiết + sai khác so với plan_

1. ✅ Migration schema mục 5.1 + migrate dữ liệu cũ + drop `notification_reads`.
2. ✅ `notification-types.ts` (4 type nhóm cắt sắt - nhóm A còn lại là Phase 3), `RecipientResolverService`,
   `emit()`, `resolve()`, dedupe.
3. ⚠️ Endpoint theo mục 5.4 nhưng **giữ nguyên gốc `/notifications`** (không đổi sang `/me/notifications`)
   để không vỡ FE cũ + `GET /notifications/sent` cho admin - xem mục 11.2.
4. ✅ Chuyển `notifyProductionManagers` sang `emit()` (mục 7.3).
5. ✅ Test: resolver phủ qua test service (role/mfgRole/kho/userIds/exclude actor), dedupe (còn/hết
   recipient chưa resolved), CRITICAL tự thêm BOSS, quyền (404 khi không phải người nhận). Pagination
   **offset** (giữ `paginate()`/`PaginationQueryDto` chung của repo, không đổi sang cursor - mục 11.2).
- **Nghiệm thu:** `tsc --noEmit` xanh, ESLint 0 error (1 warning `no-explicit-any` cố ý, khớp mức
  `warn` toàn repo), `pnpm test` 1177/1177 pass (50 suite, kể cả 2 suite cutting-proposals sửa theo).

### Phase 2 — Notification Center FE + URL — _ĐÃ XONG 2026-09-25, xem mục 12 cho chi tiết + sai khác_

1. ✅ Điều hướng theo URL (mục 6.2): `useUrlState()` + đồng bộ `m` (module, mọi app shell qua
   `app/page.tsx`) và `p` (tab trong module) cho `ProductionPlanApp` + `MfgApp` (MfgApp thêm ở mục
   12.5.B). ⚠️ 5 app shell còn lại (Sales/Purchasing/Boss/Admin/InboundWarehouse) CHƯA đồng bộ `p`
   cho tab nội bộ - chưa cần vì chưa type thông báo nào trỏ vào đó (mục 12.4). Hiện 4 type cắt sắt
   cũng không còn `link` (mục 12.6) nên chưa thông báo thật nào dùng tới điều hướng này.
2. ✅ `useNotifications` + `NotificationCenter` (panel, 2 tab, mark read/all, toast WARNING/CRITICAL) -
   gắn vào cả 7 app shell, ở CẢ top bar thu gọn (chuông chính, luôn thấy ngay) lẫn chân sidebar
   desktop. ⚠️ Không có "nhóm theo thời gian (Hôm nay/Hôm qua)" - bỏ qua vì danh sách hiện ngắn.
3. ⚠️ Không có trang "Thông báo của tôi" riêng - panel (tối đa 50 dòng, đủ dùng ở quy mô hiện tại)
   coi như thay thế tạm; trang riêng dời qua khi cần phân trang/lọc sâu hơn (mục 12.2).
4. ✅ Gỡ `NotifBell` (xoá hẳn component) ở 2 màn Spec - CHƯA có thông báo thật thay thế (đúng như plan
   nói, phải chờ Phase 3 nhóm 7.1).
5. ✅ Viết lại `Admin/NotificationsPage` thành "Thông báo chung" dùng `GET /notifications/sent` (mục 6.4).
- **Nghiệm thu:** `tsc`/lint/test 2 repo xanh + **live-test thật** (BE+FE chạy thật, Postgres dev thật,
  browser thật) - xem mục 12.3 cho chi tiết đầy đủ, bao gồm 1 bug BE (mục 11.5, đã vá) và 1 bug logic
  FE (mục 12.2 "đã đọc ≠ đã xử lý") phát hiện qua chính live-test này, không phải qua test giả lập.

### Phase 3 — Nối sự kiện theo luồng (≈4–6 ngày, chia 3 đợt) — _ĐÃ XONG TOÀN BỘ 2026-09-28 (3a+3b+3c gộp, xem mục 26.5)_

- **3a (nhóm A) - ĐÃ XONG TOÀN BỘ 2026-09-26:** 7.1 SKU/định mức (**mục 15** - trừ 1 sự kiện hoãn,
  xem 15.5), 7.2 PI (**mục 16** - 1 recipient đổi so với plan gốc, xem 16.1), 7.4 đề xuất mua mới
  (**mục 17** - gồm cả "hàng về" `PURCHASE_PROPOSAL_ITEM_RECEIVED`, đúng nội dung 3c bên dưới). Cả 3
  nhóm đều best-effort NGOÀI tx thay vì "emit trong tx" như dòng dưới nói - lý do kỹ thuật ghi ở mục
  15.2/16.2/17.2. Mỗi transition: emit + resolve ở transition tiếp theo + test service.
- **3b (nhóm B) - ĐÃ XONG TOÀN BỘ 2026-09-28:** 7.5 kho/sàn xưởng, đủ 6/6 nhóm - Sắt→Phôi→KCS (mục
  19), xuất vật tư/bao bì (mục 22), chuyển kho (mục 23), chuyển kiểm (mục 24), đóng gói → Sales (mục
  25, đúng nội dung 3c bên dưới), xuất/nhận đan (mục 26).
- **3c (nhóm C) - hoá ra không còn việc riêng:** "hàng về" đã nằm trong 3a/mục 17
  (`PURCHASE_PROPOSAL_ITEM_RECEIVED`), "đóng gói xong → Sales" đã nằm trong 3b/mục 25
  (`PI_ITEM_PACKAGING_COMPLETE`) - làm sớm hơn dự kiến vì cùng service đã có sẵn `NotificationsService`
  lúc đó, không tách nhóm riêng nữa. "Gộp INFO theo ngày" (ý định ban đầu cho `QC_PASSED`) đã bị BỎ ở
  mục 19.1 (dedupe hiện tại chỉ gộp "còn mở", không hợp với type RESULT không ai đóng) - người dùng
  chốt mỗi lượt duyệt phát 1 thông báo riêng, đơn giản hơn.
- **Nghiệm thu:** mọi type trong mục 7 (trừ 7.6 "để sau") đã có unit test + phần lớn đã live-test
  thật qua browser (những cái chưa live-test được ghi rõ ở "còn treo" của từng mục). Không chạy 1
  vòng E2E thủ công nối hết mọi bước (Sales→...→Sales) vì mỗi nhóm đã live-test riêng lẻ đủ kỹ khi
  làm - xem mục 26.5 để biết Phase 3 đã đóng hoàn toàn.

### Phase 4 — Badge "việc chờ tôi" (≈2 ngày) — _ĐÃ XONG TOÀN BỘ 2026-09-29, xem mục 27_

`GET /me/work-queue` (query count theo vai trò, mục 6.3; 1 request/lần, có index phù hợp) + badge trên
menu mọi app; làm mới cùng nhịp poll với chuông. Bỏ các `setInterval` tự poll ở `LenhSXPage` /
`CuttingProposalsPage` nếu badge + thông báo đã thay được.

### Phase 5 — Realtime & tuỳ chọn (tuỳ nhu cầu) — _HOÃN, người dùng chốt 2026-09-29 (mục 28) - chưa thấy cần thiết_

SSE `/me/notifications/stream` (NestJS `@Sse`, không cần hạ tầng mới); cài đặt tắt/bật theo loại cho
từng user; Web Push/Zalo OA cho xưởng nếu thật sự cần (cần chốt riêng vì
là kênh bên ngoài).

**Tổng ước lượng Phase 1–4: ~13–17 ngày công** (1 dev full-stack), có thể song song BE/FE từ Phase 2.

## 9. Quyết định đã chốt với người dùng — _đã chốt 2026-09-25_

1. **Fan-out theo người nhận — ĐỒNG Ý.** Chấp nhận user tạo sau không thấy thông báo chung cũ.
2. **Điều hướng theo URL (query string)** — người dùng hỏi "theo chuẩn ERP là cái nào"; các ERP lớn
   đều cho mỗi bản ghi 1 URL để link từ thông báo/email mở đúng, nên chọn URL. Làm bằng đồng bộ
   query string trên SPA hiện có (mục 6.2), không đập lại routing.
3. **Sếp chỉ nhận việc cần Sếp duyệt + cảnh báo CRITICAL.** Bỏ cc kết quả, bỏ INFO "Sales giao hàng",
   bỏ digest cuối ngày. Badge "chờ duyệt" của Sếp giữ nguyên (mục 6.3).
4. **Gửi tất cả người cùng vai trò/kho, tự đóng khi 1 người xử lý** (khuyến nghị). Không có khái niệm
   "người phụ trách" ở bản này.
5. **Không làm Phase 0** — vào thẳng Phase 1.

## 10. Những gì CHƯA làm tại thời điểm review (trước Phase 1) — _lỗi thời, giữ làm lịch sử_

> Mục này mô tả trạng thái lúc mới review xong (chưa code). Hai gạch đầu dòng đầu **không còn đúng**:
> code đã sửa ở cả 2 repo và đã test/live-test (mục 11, 12). Gạch đầu dòng cuối (đọc kỹ từng service
> khi làm Phase 3) **vẫn còn hiệu lực**.

- ~~Đã chốt 5 quyết định (mục 9) nhưng vẫn chưa sửa code ở 2 repo; không chạy test/tsc (không có thay đổi code).~~
- ~~Chưa live-test UI để chụp hiện trạng~~ — các kết luận ở mục 2 dựa trên đọc code (grep toàn repo:
  `markNotificationRead` 0 nơi gọi, `getNotifications` chỉ 1 nơi dùng, `notification.create` chỉ ở
  cutting-proposals).
- Danh sách trigger ở mục 7 lấy theo tên endpoint trong các controller; khi làm Phase 3 cần đọc kỹ
  từng service để chốt đúng người nhận (vd ai thực sự tạo `steel-issues`, Sales nào "phụ trách" đơn).

## 11. Phase 1 — Nền tảng BE — _ĐÃ XONG 2026-09-25_

### 11.1 Đã làm (chỉ DNA-ERP-BE - FE chưa đụng, xem mục 9.5 lý do bỏ Phase 0)

- **Schema** ([schema.prisma](../prisma/schema.prisma)): thêm enum `NotificationCategory`,
  `NotificationSeverity`; `Notification` thêm `type/category/severity/entityType/entityId/link/
  data/actorId/dedupeKey/updatedAt`, `audience` chuyển thành optional (chỉ còn dùng cho
  ANNOUNCEMENT). Thay `NotificationRead` bằng `NotificationRecipient` (thêm `resolvedAt`/
  `archivedAt`). Migration tay
  [20260925000000_notification_recipients_and_types](../prisma/migrations/20260925000000_notification_recipients_and_types/migration.sql)
  (viết thủ công - máy này không có Postgres sống để chạy `prisma migrate dev`, xem mục 11.3): fan-out
  dữ liệu cũ sang `notification_recipients` theo ĐÚNG luật audience cũ (role trùng tên audience, xem
  `prisma/seed.ts`), copy `readAt`, xong mới `DROP TABLE notification_reads`. `npx prisma generate`
  chạy được (không cần DB) - client mới đã sinh đúng, `tsc` xanh dựa trên client đó.
- **`notification-types.ts`** (mới): registry cho 4 loại thông báo cắt sắt hiện có
  (`CUTTING_PROPOSAL_AUTO_APPROVED` / `_NEEDS_MANUAL_APPROVAL` / `_AUTO_APPROVE_FAILED` /
  `_CALCULATION_FAILED`) - title/message/link/recipients cho từng loại tập trung 1 chỗ như mục 5.2 mô
  tả. Các nhóm A/B/C còn lại ở mục 7 (SKU, PI, mua hàng, kho, sàn xưởng...) **chưa có type nào** - đó
  là việc của Phase 3, Phase 1 chỉ dựng hạ tầng + di dời loại đã có.
- **`recipient-resolver.service.ts`** (mới): `RecipientResolverService.resolve(criteria, excludeIds,
  tx?)` dịch `roles/mfgRoles/warehouseIds/userIds/allActiveUsers` sang danh sách userId, luôn lọc
  `isActive && !deletedAt`, luôn khử trùng lặp.
- **`notifications.service.ts`** (viết lại hoàn toàn): `emit(type, options)` - tự tính người nhận (+
  tự thêm role BOSS khi `severity=CRITICAL`, đúng quyết định mục 9.3), tự loại `actorId`, dedupe theo
  `dedupeKey` (còn recipient chưa `resolvedAt` thì update dòng cũ + đẩy lại chưa đọc + fan-out thêm
  người mới nếu có; hết thì tạo dòng mới); `resolve(criteria)` đóng hàng loạt theo
  `entityType/entityId(/types)`; `createAnnouncement()` (ANNOUNCEMENT, thay `create()` cũ);
  `findMyNotifications/unreadCount/markRead/markAllRead/archive` cho người dùng cuối;
  `findSentAnnouncements()` cho admin (mục 11.2).
- **`notifications.controller.ts`**: xem mục 11.2 cho path cụ thể + lý do khác plan.
- **`cutting-proposals.service.ts`**: `notifyProductionManagers()` đổi từ ghi thẳng
  `prisma.notification.create` sang gọi `this.notifications.emit()`; inject `NotificationsService`
  (constructor thêm tham số thứ 5); `CuttingProposalsModule` import `NotificationsModule`. Giữ NGUYÊN
  4 nội dung tiếng Việt hiện có (chỉ đổi cơ chế gửi, không đổi văn án QLSX đọc).
- **Test**: viết lại toàn bộ `notifications.service.spec.ts` (emit/resolve/createAnnouncement/
  findMyNotifications/unreadCount/markRead/markAllRead/archive); sửa 2 spec của cutting-proposals để
  mock `NotificationsService.emit` thay vì `prisma.notification.create` (9 chỗ assertion, xem diff) -
  1 test ("builds the bom[] payload...") được nới lại đúng ý gốc (chỉ kiểm entityId + poNumber, không
  khẳng định branch) vì test đó vốn không mock đủ cho nhánh auto-duyệt thành công, y hệt hành vi cũ.

### 11.2 Cố ý khác plan (mục 5.4/8) - vì sao

- **Giữ nguyên gốc tài nguyên `/notifications` thay vì `/me/notifications`.** Phase 1 chỉ đổi BE,
  chưa đụng FE - nếu đổi path, `Admin/NotificationsPage`
  ([notifications-api.ts](../../DNA-ERP/src/services/notifications-api.ts)) vỡ ngay lập tức dù
  không có PR nào phía FE. Route cuối: `GET/POST /notifications` (list/tạo, nay là "của tôi" thay vì
  lọc audience), `GET /notifications/sent` (admin xem đã gửi, mới), `GET /notifications/unread-count`
  (mới), `POST /notifications/read-all` (mới), `POST /notifications/:id/read` (path cũ, service mới),
  `POST /notifications/:id/archive` (mới). Khớp tinh thần plan mục 5.4 "giữ 1 phiên bản cũ", chỉ khác
  tên đường dẫn. Codebase cũng chưa có tiền lệ `/me/<resource>` (chỉ có `GET /auth/me` là 1 bản ghi
  đơn, không phải danh sách) nên giữ style REST hiện có nhất quán hơn.
- **Pagination offset, không phải cursor.** Mọi module khác trong repo dùng chung
  `paginate()`/`PaginationQueryDto` (skip/take). Đổi riêng notifications sang cursor sẽ là 1 kiểu
  phân trang lạc loài duy nhất trong codebase - không đáng cho lợi ích nhỏ ở quy mô dữ liệu hiện tại.
- **`sortBy` của `ListNotificationsQueryDto` bị bỏ qua hoàn toàn** (luôn sort theo `createdAt desc`) -
  vá đúng lỗ hổng nêu ở mục 2.1 (P8: sortBy tuỳ ý gây lỗi Prisma 500) cho riêng endpoint này, không
  sửa `PaginationQueryDto` dùng chung (30+ module khác dùng, ngoài phạm vi Phase 1).
- **`entityType` cho 4 thông báo cắt sắt là `CUTTING_PROPOSAL` (theo `proposalId`), không phải
  `PRODUCTION_ORDER`/`PRODUCTION_INVOICE`.** `runSolverAndSave()` không có sẵn `productionOrderId`
  trong scope (chỉ có `proposalId` + `job.label` đã render thành `poNumber`) - thêm 1 query chỉ để
  đổi entityId không đáng trong luồng best-effort này. Hệ quả: `dedupeKey` (`{type}:{proposalId}`)
  chỉ gộp các lần retry TRÊN CÙNG 1 `CuttingProposal`, KHÔNG gộp qua các lần "Tính lại" (mỗi lần tạo
  `CuttingProposal` mới, xem `CuttingProposalStatus.SUPERSEDED`) - chấp nhận được vì mỗi phương án
  mới là 1 quyết định đáng có thông báo riêng, không phải spam.
- **`resolve()` có đủ code + test nhưng CHƯA được gọi ở đâu cả** (kể cả trong cutting-proposals) -
  đúng phạm vi Phase 1 (hạ tầng), việc gọi nó ở từng transition nghiệp vụ (SKU duyệt, PI gửi/duyệt,
  nhận hàng...) là Phase 3. **Cập nhật 2026-09-26 (mục 14):** loại `ACTION_REQUIRED` duy nhất từng
  cần `resolve()` bên cắt sắt (`CUTTING_PROPOSAL_NEEDS_MANUAL_APPROVAL`) đã bị xoá hẳn - hiện KHÔNG
  còn type cắt sắt nào cần `resolve()` nữa (type còn lại là `RESULT`, tự "xong" ngay khi tạo).
- **Dedupe KHÔNG có khung 30 phút như mục 5.3** _(bổ sung khi rà soát 2026-09-26, mục 13)_: `emit()`
  ([notifications.service.ts](../src/modules/notifications/notifications.service.ts)) gộp vào dòng
  mới nhất cùng `dedupeKey` miễn là **còn ít nhất 1 recipient chưa `resolvedAt`**, không xét thời gian.
  Với type cắt sắt hiện tại không sao (key theo `proposalId`, mỗi phương án mới là key mới).
  **Rủi ro cho Phase 3:** type `RESULT`/`INFO`/`ALERT` không bao giờ được `resolve()` → nếu gắn
  `dedupeKey` cho các type đó, mọi lần phát sau sẽ gộp mãi vào dòng cũ. Khi làm Phase 3: chỉ dùng
  `dedupeKey` cho type `ACTION_REQUIRED` (có resolve), hoặc bổ sung khung thời gian vào điều kiện gộp.
- **`GET /notifications/sent`**: yêu cầu `NOTIFICATION:CREATE` (ai tạo được thông báo mới xem "đã
  gửi"), không phải quyền riêng - không có role nào cần thêm quyền mới ở Phase 1.

### 11.3 Kết quả kiểm tra — _cập nhật 2026-09-25 (đợt live-test Phase 2, xem mục 12.3)_

- `npx tsc --noEmit -p tsconfig.json`: 0 lỗi.
- `npx eslint` trên toàn bộ file đã sửa/thêm: 0 error, 1 warning (`@typescript-eslint/no-explicit-any`
  ở `NOTIFICATION_TYPES: Record<string, NotificationTypeDef<any>>` - cố ý, rule này là `warn` toàn
  repo theo `eslint.config.mjs`, không phải error).
- `npx jest` (toàn repo): **1179/1179 test pass, 50/50 suite pass** (thêm 2 test cho filter `resolved`
  - mục 12.2 - so với 1177 lúc viết mục này lần đầu).
- ~~KHÔNG chạy được prisma migrate dev...~~ **Đã chạy thật** - Docker Desktop khởi động được ở đợt
  live-test Phase 2 (container `dna-erp-be-postgres-1` vốn có sẵn, chỉ do daemon chưa bật), áp cả 2
  migration (`...000000` + `...010000`, mục 11.5) bằng `prisma migrate deploy` lên `dna_erp` thật, xác
  nhận đúng số dòng fan-out (21 notification × 1 QLSX active = 21 `notification_recipients`) và bắt
  được lỗi audience-chưa-null nhờ vậy (mục 11.5). Trạng thái DB sau live-test đã được dọn về y hệt
  trước khi test (mục 12.3).

### 11.4 Còn treo (Phase 2+, chưa làm) — _cập nhật: Phase 2 đã làm, xem mục 12_

~~Mọi phần FE...~~ **Đã làm ở Phase 2 (mục 12).** Còn treo thật sự: toàn bộ nối sự kiện theo luồng ở
mục 7 (trừ cắt sắt) và badge "việc chờ tôi" - xem mục 8 Phase 3-5.

### 11.5 Migration vá `20260925010000_null_audience_for_non_announcement` (phát hiện lúc live-test Phase 2)

- **Lỗi:** backfill trong migration `20260925000000` chỉ đổi `category` sang `RESULT` cho 21 dòng do
  cutting-proposals tự phát (`createdBy IS NULL`) nhưng **quên null luôn `audience` cũ**
  (`PRODUCTION_MANAGER`) - vi phạm bất biến tự đặt "`audience` chỉ có giá trị khi
  `category = ANNOUNCEMENT`" (doc comment `Notification.audience` trong `schema.prisma`).
- **Phát hiện:** khi `prisma migrate deploy` lên DB dev thật và soi dữ liệu (mục 11.3), không phải
  qua unit test.
- **Sửa:** migration mới
  [20260925010000_null_audience_for_non_announcement](../prisma/migrations/20260925010000_null_audience_for_non_announcement/migration.sql)
  - 1 câu `UPDATE "notifications" SET "audience" = NULL WHERE "category" != 'ANNOUNCEMENT'`. Cố ý
  KHÔNG sửa migration cũ đã apply (đổi checksum migration đã chạy là thực hành xấu).
- **Lưu ý:** 21 dòng này sau đó còn được phân loại lại đúng `type/category/severity` bởi migration
  `20260925020000` (mục 12.5.A) - trạng thái `category = RESULT` ở trên chỉ là trung gian.

## 12. Phase 2 — Notification Center FE + URL — _ĐÃ XONG 2026-09-25_

Repo: `D:\DNA-ERP` (FE). Toàn bộ mục này làm và kiểm trong CÙNG 1 phiên với Phase 1 (mục 11), theo
yêu cầu người dùng "làm tới đâu test kỹ tới đó kể cả BE và FE" - vì vậy có Docker/DB thật/browser thật
tham gia kiểm thử, không chỉ unit test giả lập.

### 12.1 Đã làm

- **`hooks/useUrlState.ts`** (mới): `useUrlState(key)` đọc/ghi 1 query param qua
  `useSearchParams`/`useRouter` (`router.replace`, không đẻ thêm history entry mỗi lần đổi tab).
- **`app/page.tsx`**: `activeModule` đồng bộ 2 chiều với `?m=` - bấm thông báo ở bất kỳ đâu trong cây
  gọi `router.push('/?m=...')`, 1 effect ở đây bắt thay đổi và chuyển module (có gác quyền: user
  không phải director chỉ được nhận `urlModule` đúng bằng module họ vốn có). `MainERP` phải bọc
  `<Suspense>` (yêu cầu của `useSearchParams` trong Next App Router) - tách `Page()` (kiểm auth, giữ
  nguyên) khỏi `MainERP()` (dùng URL) qua 1 Suspense boundary mới.
- **`modules/pages/ProductionPlan/ProductionPlanApp.tsx`**: `activePage` đồng bộ 2 chiều với `?p=`
  (dùng lại `useUrlState`) - app DUY NHẤT làm việc này ở Phase 2 vì là nơi duy nhất có thông báo thật
  trỏ tới (đề xuất cắt sắt). 6 app còn lại chưa cần.
- **`services/notifications-api.ts`** (viết lại): `getNotifications()` giờ nhận
  `{status, resolved, category, page, limit}` và trả `PaginatedResult<Notification>` (trước đây trả
  thẳng mảng) - cùng `getUnreadCount/markAllNotificationsRead/archiveNotification/getSentAnnouncements`
  mới, `markNotificationRead` giờ trả về `Notification` (trước trả `void`). `types/admin.ts` mở rộng
  `Notification` (category/severity/type/entityType/entityId/link/isResolved) + `Announcement` mới.
- **`hooks/useNotifications.ts`** (mới): poll `unread-count` mỗi 30s (dừng khi tab ẩn, resume +
  refetch khi quay lại), chỉ tải thêm vài dòng mới nhất để dựng toast khi tổng tăng (không tải danh
  sách đầy mỗi 30s), danh sách panel chỉ tải khi mở.
- **`components/NotificationCenter.tsx`** (mới, thay `NotifBell.tsx`): chuông + panel (2 tab, mark
  read/all, toast WARNING/CRITICAL 6s tự tắt) - nhận `size`/`color` để dùng được ở cả top bar thu gọn
  (rõ, cỡ 20, theo màu chữ) lẫn chân sidebar desktop (mờ hơn, cỡ 16, `var(--text3)`, đồng bộ icon
  Đăng xuất cạnh nó).
- Gắn `NotificationCenter` vào cả 7 app shell: **top bar thu gọn** (Sales/Purchasing/Boss/Mfg/
  ProductionPlan - vị trí CHÍNH, luôn thấy ngay không cần mở gì, xem mục 12.2 lý do) + **chân
  sidebar desktop** (cả 7, kể cả Admin/InboundWarehouse - 2 app này không có chế độ thu gọn nên chân
  sidebar là vị trí duy nhất).
- **`modules/pages/Admin/NotificationsPage.tsx`** (viết lại hoàn toàn, bỏ `AdminEntityPage`): "Thông
  báo chung" dùng `GET /notifications/sent` (thấy MỌI thông báo đã phát + tỉ lệ đọc, không phải chỉ
  của admin) + modal tạo mới, không còn nút Sửa/Xóa (BE vẫn không hỗ trợ).
- Gỡ `components/NotifBell.tsx` (xoá file) + 2 chỗ dùng nó (`SpecSteelPage.tsx`,
  `SpecDetailQuotaPage.tsx`) - cập nhật luôn 1 comment còn trỏ tới file đã xoá (`PrintExportButton.tsx`).
- Test mới: `services/notifications-api.test.ts` (13 case, mapping Be↔Fe + query string).

### 12.2 Phát hiện + sửa TRONG LÚC live-test (không phải lỗi lý thuyết)

Đây là phần đáng chú ý nhất của đợt Phase 2 - cả 3 điều dưới đây **chỉ lộ ra khi chạy BE+FE+DB thật
và bấm thử bằng browser**, unit test (mock) không thể bắt được:

1. **Vị trí chuông sai chỗ khó thấy** (phản hồi trực tiếp của người dùng khi xem browser thật): thiết
   kế ban đầu chỉ đặt `NotificationCenter` ở chân sidebar - nhưng ở màn hẹp (<900px, đúng nhóm người
   dùng xưởng plan nhắm tới), sidebar nằm TRONG drawer đóng, phải bấm ☰ mới thấy chuông. **Sửa:**
   thêm 1 bản chuông NGAY TRONG top bar thu gọn (luôn hiện, cạnh tiêu đề, cỡ to hơn/rõ hơn) - xem
   mục 12.1. `NotificationCenter` nhận thêm prop `size`/`color` để dùng được ở cả 2 chỗ.
2. **Panel bật sai hướng** (phản hồi tiếp theo, sau khi chuông đã lên top bar): panel compact vẫn code
   theo kiểu "bottom sheet" (trồi từ đáy màn hình) - sai hẳn với vị trí chuông giờ đã ở góc phải trên.
   **Sửa:** panel giờ định vị theo ĐÚNG chỗ chuông đang nằm - xổ xuống bên phải (top bar, compact) hay
   xổ lên bên trái (chân sidebar, desktop); bỏ hẳn `document`-mousedown-listener cũ, thay bằng 1
   backdrop trong suốt/mờ dùng chung cho cả 2 layout để bấm ra ngoài là đóng.
3. **Lẫn "đã đọc" với "đã xử lý xong"** (phản hồi "số trên chuông biến mất khi nào, senior sẽ làm
   sao" - tự phát hiện lại lỗi lúc trả lời): tab "Cần xử lý" ban đầu lọc theo `status=unread` - nghĩa
   là bấm ĐỌC 1 thông báo cần duyệt làm nó BIẾN MẤT khỏi hàng đợi dù việc thật (duyệt đề xuất) chưa hề
   xong. Chuẩn đúng: badge/chuông = số CHƯA ĐỌC (như Gmail/Slack - chỉ giảm khi đọc từng cái hoặc bấm
   "Đọc tất cả"), nhưng NỘI DUNG tab "Cần xử lý" phải lọc theo CHƯA XỬ LÝ XONG (`resolvedAt IS NULL`),
   không phải chưa đọc - 1 việc đã đọc nhưng chưa làm vẫn phải nằm trong hàng đợi (chỉ hết in đậm).
   **Sửa cả 2 phía:**
   - BE: `ListNotificationsQueryDto` thêm `resolved?: 'true'|'false'` (khác hẳn `status`),
     `findMyNotifications()` lọc theo `resolvedAt` khi có; +2 test service.
   - FE: `getNotifications()` truyền thêm `resolved`; `useNotifications.loadList()` tab 'action' đổi
     từ `{status:'unread', category:'ACTION_REQUIRED'}` sang `{resolved:'false', category:'ACTION_REQUIRED'}`;
     +1 test API.
   - Xác nhận lại bằng browser thật: 1 thông báo test đã bấm đọc (readAt có giá trị,
     resolvedAt vẫn null) VẪN hiện trong tab "Cần xử lý" sau khi vá - trước khi vá thì biến mất.

### 12.3 Kết quả kiểm tra

- `tsc --noEmit` (FE): 0 lỗi. `eslint` (mọi file sửa/thêm): 0 error - 3 warning
  `react-hooks/set-state-in-effect` ở `app/page.tsx`/`ProductionPlanApp.tsx`, xác nhận qua
  `git stash` là warning NÀY ĐÃ CÓ SẴN trong code gốc (cùng pattern "guard rồi setState trong effect"
  y hệt), không phải lỗi mới - giữ nguyên theo đúng convention hiện có của repo, không tự ý đổi cách
  viết khác đi.
- `vitest run` (FE): 52/52 pass (13 test mới `notifications-api.test.ts`).
- **Live-test thật** (không phải mô tả suông): bật Docker Desktop (daemon trước đó tắt) → phát hiện
  container Postgres dev (`dna-erp-be-postgres-1`, cổng 5432, đúng khớp `.env`) đã có sẵn dữ liệu thật
  (21 thông báo cắt sắt cũ, 18 user active) → `prisma migrate deploy` cả 2 migration Phase 1 lên DB đó
  → chạy `nest start --watch` (BE thật, cổng 3001) + `next dev` (FE thật, cổng 3000) → dùng
  `mcp__Claude_Browser__*` (browser thật, không phải giả lập) đăng nhập lần lượt `qlsx` (QLSX thật,
  role PRODUCTION_MANAGER), `boss` (director, nhiều module), `dms` (SPEC_STEEL, kiểm màn đã gỡ
  NotifBell):
  - Badge/panel/toast hiển thị ĐÚNG số liệu thật từ DB qua mọi bước (unread-count giảm đúng sau khi
    đọc/đọc-tất-cả, tăng đúng khi tạo announcement mới).
  - Chèn tay 1 dòng notification có `link` (giả lập những gì `emit()` sẽ tạo khi Phase 3 nối sự kiện
    khác - CHƯA thử được `emit()` thật vì cần dựng cả luồng solver cắt sắt đầy đủ, ngoài phạm vi hợp
    lý của phiên này) → xác nhận bấm 1 dòng thông báo ở module Boss → mark-read (kiểm lại bằng
    `psql` trực tiếp) → điều hướng đúng sang `production_plan`/`lenh-sx` → URL cập nhật
    `?m=production_plan&p=lenh-sx` → F5 vẫn giữ đúng màn đó (đúng mục tiêu mục 6.2).
    > ⚠️ Chỉ chứng minh CƠ CHẾ điều hướng URL chạy đúng. Đích `production_plan` là SAI với người nhận
    > thật (QLSX) - lộ ra ở mục 12.5.B vì lần này test bằng `boss` (director, được vượt rào đổi
    > module); sau đó `link` của 4 type cắt sắt bị bỏ hẳn (mục 12.6).
  - Kiểm quyền qua API thật: user khác (không phải người nhận) nhận 404 khi cố đọc thông báo không
    phải của mình; không có `NOTIFICATION:CREATE` bị chặn 403 ở `/notifications/sent` và tạo
    announcement.
  - Sau khi xong, dọn sạch dữ liệu test đã chèn (`DELETE`) và khôi phục lại đúng trạng thái
    `readAt` ban đầu của 21 thông báo cũ (`UPDATE ... SET "readAt" = NULL`) - DB dev không bị để lại
    rác/lệch trạng thái so với trước khi bắt đầu phiên làm việc.

### 12.4 Cố ý chưa làm / hạn chế đã biết

- **Trang "Thông báo của tôi" riêng:** chưa có - panel (tối đa 50 dòng/lượt) tạm đủ ở quy mô dữ liệu
  hiện tại. Cần làm khi số lượng thông báo/người đủ lớn để cần phân trang thật.
- ~~**`?p=` mới đồng bộ URL cho `ProductionPlanApp` + `MfgApp`**...~~ **ĐÃ LÀM NỐT CHO CẢ 7/7 APP
  SHELL** (Boss/MfgApp ở 12.5.B, Purchasing/InboundWarehouse ở 17.3, Admin/Sales ở mục 20.3/20.4).
- ~~**Double-poll nhẹ khi drawer mobile bị bỏ mở**...~~ **ĐÃ SỬA, xem mục 20.1** (chuyển
  `useNotifications()` sang 1 `NotificationsProvider`/context dùng chung).
- **`emit()` thật của luồng cắt sắt chưa được live-test end-to-end** (chỉ test qua unit test + dữ liệu
  lịch sử đã migrate) - dựng lại toàn bộ luồng solver (PO/PI/BOM/định mức) chỉ để bắn 1 thông báo mới
  không cân xứng trong phiên này; link/entityId dùng để test điều hướng (mục 12.3) được chèn tay,
  MÔ PHỎNG đúng shape `emit()` sẽ tạo ra chứ không phải `emit()` thật chạy.

### 12.5 Sửa tiếp sau phản hồi người dùng (cùng ngày 2026-09-25)

Sau khi báo "xong", người dùng test tiếp và phát hiện thêm 2 việc:

**A. Data lỗi: 21 thông báo cắt sắt cũ đều bị gắn chung `category=RESULT/severity=INFO/type=NULL`**
(hệ quả của backfill trong migration `20260925000000`, vốn gán chung `RESULT` cho mọi dòng
`createdBy IS NULL` đúng như plan mục 5.1 - trước đó được coi ngầm là chấp nhận được nhưng chưa từng
ghi thành hạn chế ở mục 11; người dùng chỉ ra đây thực sự là data SAI cần sửa). 4 biến thể tạo ra 4 MẪU TIÊU ĐỀ cố định, đủ để suy ngược đúng loại -
migration mới
[20260925020000_reclassify_legacy_cutting_proposal_notifications](../prisma/migrations/20260925020000_reclassify_legacy_cutting_proposal_notifications/migration.sql)
khớp tiêu đề → gán lại đúng `type/category/severity/entityType` cho cả 21 dòng (10 SUCCESS, 7
CRITICAL, 4 WARNING - xác nhận bằng SQL + API thật + browser thật, QLSX giờ thấy đúng "Cần xử lý (4)"
thay vì 0). **Cố ý KHÔNG** suy lại `entityId` (proposalId gốc không lưu, không khôi phục được) và
**KHÔNG** fan-out thêm BOSS cho 7 dòng giờ thành CRITICAL (tránh Sếp bỗng thấy hàng loạt "cảnh báo
mới" cho việc đã xảy ra từ lâu).

**B. Bug thật: link thông báo cắt sắt trỏ SAI module cho chính người nhận (QLSX)** - người dùng hỏi
"click vào thông báo sao không nhảy trực tiếp vào" dẫn tới phát hiện: `notification-types.ts` gắn
`module: 'production_plan'` (ProductionPlanApp = KHSX), nhưng QLSX (`mfgRole` có giá trị) theo
`resolveDefaultModule.ts` luôn thuộc module `production` (MfgApp) - `mfgRole` khớp TRƯỚC
`isProductPlanner` trong danh sách strategy. Vì QLSX không phải Giám đốc (không được vượt rào an
toàn "chỉ director đổi module tuỳ ý" ở `app/page.tsx`), bấm vào thông báo **không nhảy đi đâu cả**.
Lộ ra vì trước đó chỉ live-test luồng điều hướng bằng tài khoản `boss` (director, bypass rào an
toàn) - CHƯA từng thử bằng chính `qlsx`, người nhận thật của loại thông báo này.

> ⚠️ **Phần "đổi `module: 'production'`" dưới đây đã bị THAY THẾ bởi mục 12.6** (bỏ hẳn `link`
> của 4 type cắt sắt). Phần đồng bộ `?p=` cho `MfgApp.tsx` vẫn giữ nguyên.

Sửa: đổi `module: 'production'`; thêm đồng bộ `?p=` cho `MfgApp.tsx` (trước đó chỉ có
`ProductionPlanApp.tsx`, xem mục 12.4 - giờ làm nốt cho app còn thiếu vì đã lộ ra nhu cầu thật). Xác
nhận lại bằng qlsx thật: bấm thông báo → `Sản xuất MES · Xử lý lệnh sản xuất` mở đúng, URL
`?m=production&p=lenh-sx`, F5 giữ nguyên.

**Giới hạn còn lại (không phải bug, là tính năng chưa có):** đọc kỹ
`services/cutting-proposals-api.ts` (FE) thì thấy tự ghi rõ "Chưa có màn hình nghiệp vụ riêng nào
dùng module này (Phôi/QLSX chưa có UI)... Duyệt phương án cắt vẫn chỉ làm qua API, chưa có UI" - tức
là ngay cả sau khi điều hướng ĐÚNG module/tab, QLSX cũng chưa có nút "Duyệt"/"Từ chối" nào cho riêng
1 CuttingProposal để mà "nhảy thẳng vào" xa hơn tab danh sách chung - màn đó chưa từng được xây (gap
sản phẩm có từ trước, không phải do việc làm thông báo gây ra). Xây màn đó là việc RIÊNG, lớn hơn hẳn
phạm vi "hoàn thiện Phase 2 thông báo" - đã hỏi ý người dùng, **đang chờ quyết định** có làm tiếp hay
không.

- Kiểm tra sau đợt sửa này: `tsc`/`eslint` 2 repo xanh (0 error), `jest` BE 1179/1179,
  `vitest` FE 52/52, live-test lại bằng browser thật với `qlsx` xác nhận cả 2 điểm A/B đã đúng, dọn
  sạch dữ liệu test (`DELETE`/`UPDATE ... readAt = NULL`) về lại trạng thái trước khi test.

### 12.6 Bỏ hẳn `link` của 4 type cắt sắt (cùng ngày, phát hiện sâu hơn mục 12.5.B)

Người dùng hỏi tiếp "solve fail thì sao lại hiện thông báo bên màn QLSX làm gì" - buộc đọc lại kỹ
`CuttingProposalsController.requestProposal()`: **"lần tính đầu tiên tự động chạy ngầm KHI SẾP DUYỆT
PI ITEM"**. Nghĩa là bất kể cắt sắt tính thành công hay thất bại, PO/PI trong thông báo đó **LUÔN đã
rời khỏi** hàng đợi "Xử lý lệnh sản xuất" (lọc theo status WAITING_QLSX) **từ trước khi** cutting-
proposal tồn tại - không phải riêng ca "thất bại" mới sai như câu hỏi đầu tiên nêu, mà **cả 4 loại**
(kể cả tự-duyệt-thành-công) đều trỏ tới 1 màn không hề liên quan tới đối tượng trong thông báo.
Cộng thêm việc đã biết (mục 12.5.B) là màn đó dù đúng cũng chưa có nút Duyệt/Từ chối cho riêng 1
CuttingProposal - kết luận: **trỏ đi bất cứ đâu ở đây đều gây hiểu lầm hơn là không trỏ**.

Sửa: bỏ hẳn `link` khỏi 4 type trong `notification-types.ts` (xoá hàm `cuttingProposalLink`) - giữ
nguyên `proposalId` trong `data` (không phải `link`) để dùng khi FE có màn chi tiết CuttingProposal
thật. `NotificationsService.emit()`/`NotificationCenter.tsx` đã sẵn sàng cho `link: null` từ đầu
(`def.link` là optional, FE guard bằng `n.link?.module`) nên không cần sửa gì thêm ở 2 chỗ đó.

Xác nhận: `tsc`/`jest` (1179/1179) BE xanh; live-test bằng browser thật với `qlsx` - chèn 1 thông báo
`link: null`, bấm vào → đánh dấu đã đọc (xác nhận qua `psql`), URL **không đổi** (trước đây sẽ nhảy
sai module) - đúng ý "thà không có link còn hơn có link sai". Dọn dữ liệu test, khôi phục lại trạng
thái ban đầu.

**Còn treo:** vẫn chưa có màn "chi tiết 1 CuttingProposal" ở FE để link tới (mục 12.5, đã hỏi ý người
dùng có xây tiếp hay không - chưa có câu trả lời tại thời điểm ghi mục này).

## 13. Rà soát nhất quán tài liệu — _2026-09-26_

Người dùng yêu cầu review chính file này (chấm 7.5/10: nội dung/bằng chứng tốt, nhưng nhiều chỗ
trạng thái cũ mâu thuẫn với trạng thái mới - trái quy ước CLAUDE.md "không để hai chỗ nói hai điều
khác nhau"). Chỉ sửa tài liệu, không đụng code.

**Đã sửa:**
- Dòng trạng thái đầu file: thêm 12.5/12.6, việc đang chờ quyết định (màn chi tiết CuttingProposal),
  và cách đọc (mục 2–7 là thiết kế trước khi code; 11.2/12.x là nguồn đúng khi lệch).
- Mục lục + tiêu đề mục 8: "_chưa bắt đầu_" → "Phase 1, 2 ĐÃ XONG; Phase 3–5 chưa làm". Mục 10 đánh
  dấu lỗi thời, gạch 2 ý đã sai, giữ ý còn hiệu lực.
- Ghi chú "Thực tế khác" ngay trong mục 5.3 (dedupe), 5.4 (endpoint), 7.3 (entityType/link) trỏ sang
  mục 11.2 / 12.6.
- Đồng bộ `?p=`: Phase 2 bước 1 và mục 12.4 trước ghi "chỉ ProductionPlanApp" → sửa thành
  ProductionPlanApp + MfgApp (MfgApp thêm ở 12.5.B).
- 12.3: ghi chú live-test điều hướng bằng `boss` chỉ chứng minh cơ chế, đích đã sai/đã bỏ.
  12.5.B: ghi chú phần đổi `module: 'production'` đã bị 12.6 thay thế.
- Tham chiếu gãy: migration `20260925010000` trước không được mô tả ở đâu (dòng tham chiếu trỏ "mục
  12.1"/"mục 11" nhưng hai nơi đó không có) → thêm **mục 11.5** mô tả đầy đủ, sửa các tham chiếu trỏ
  về 11.5. Câu "hạn chế đã ghi nhận trước ở mục 11.1" ở 12.5.A là sai (11.1 chưa từng ghi) → viết lại
  cho đúng.
- **Phát hiện khi đối chiếu code:** dedupe trong `emit()` không có khung 30 phút như plan 5.3 → ghi
  vào mục 11.2 kèm rủi ro cho Phase 3 (type không bao giờ resolve + có `dedupeKey` sẽ gộp mãi vào 1
  dòng) và cách tránh.

**Cố ý KHÔNG sửa:** comment trong `migration.sql` của `20260925010000` vẫn trỏ "mục 11 phần kiểm thử
Phase 2" (nay nên là 11.5) - sửa file migration đã apply làm đổi checksum, `prisma migrate` sẽ báo
lệch trên DB đã chạy. Chấp nhận lệch tham chiếu nhỏ này.

**Kiểm tra:** không có thay đổi code → không chạy tsc/test. Đã đọc lại các chỗ sửa và grep các tham
chiếu "mục 11.5"/"12.1" cho khớp.

**Còn treo:** không đổi so với trước - Phase 3–5, và quyết định màn chi tiết CuttingProposal.

## 14. Bỏ hẳn thông báo QLSX cho 3 nhánh "không thành công" của cắt sắt — _2026-09-26, người dùng chốt_

Người dùng xem lại mục 12.6 (đã bỏ `link` cho 4 type cắt sắt) và quyết định đi xa hơn: **quay lại
flow cũ trước khi có notification** — chỉ báo QLSX khi solver tính xong VÀ tự duyệt thành công.
Không còn báo gì khi bị chặn tự duyệt, khi auto-duyệt lỗi, hay khi solver lỗi/timeout — kể cả các ca
CRITICAL. Đã hỏi lại và người dùng xác nhận muốn bỏ CẢ 3 nhánh (không giữ lại cảnh báo CRITICAL cho
2 lỗi kỹ thuật thật).

**Vì sao:** cả 3 nhánh đó luôn ngụ ý "còn việc QLSX phải làm" nhưng KHÔNG có màn nào cho QLSX làm -
đúng gap đã nêu ở mục 12.6 ("chưa có UI duyệt/từ chối cho 1 CuttingProposal"). Thông báo không dẫn
tới hành động nào bị coi là nhiễu hơn là hữu ích ở giai đoạn hiện tại.

**Đã làm** (chỉ DNA-ERP-BE):
- [notification-types.ts](../src/modules/notifications/notification-types.ts): xoá hẳn 3 entry
  `CUTTING_PROPOSAL_NEEDS_MANUAL_APPROVAL` / `_AUTO_APPROVE_FAILED` / `_CALCULATION_FAILED` khỏi
  registry - chỉ còn `CUTTING_PROPOSAL_AUTO_APPROVED`. Rút gọn `CuttingProposalNotificationParams`
  (bỏ `blockReason`/`errorMessage`, không type nào còn dùng).
- [cutting-proposals.service.ts](../src/modules/cutting-proposals/cutting-proposals.service.ts):
  `runSolverAndSave()` chỉ còn gọi `notifyProductionManagers()` ở nhánh `autoApproved`; nhánh
  `blockReason` và nhánh `catch` (solver lỗi) chỉ còn `logger.warn`/`logger.error`/`saveFailure()`
  như cũ, không emit nữa. Xoá biến `approveError` không còn dùng tới (viết lại log lỗi tại chỗ throw
  thay vì lưu ra biến ngoài).
- Test: sửa 6 test trong `cutting-proposals.service.spec.ts` (2 test đổi tiêu đề + assertion sang
  "KHÔNG báo QLSX", 3 test khác chỉ còn `expect(notificationsService.emit).not.toHaveBeenCalled()`,
  1 test đổi sang `jest.spyOn(Logger.prototype, 'warn')` vì nội dung lý do chặn giờ CHỈ còn nằm ở
  log, không còn ở notification để `renderEmitCall()` đọc lại được).
  `notifications.service.spec.ts`: 3 type cắt sắt bị xoá từng được dùng làm FIXTURE cho test cơ chế
  chung (CRITICAL tự thêm BOSS, dedupe, resolve theo type) - đăng ký 2 type GIẢ
  (`TEST_ACTION_REQUIRED_TYPE`, `TEST_CRITICAL_ALERT_TYPE`) trực tiếp vào `NOTIFICATION_TYPES` trong
  `beforeAll`/`afterAll` của file test, tách hẳn test hạ tầng khỏi type nghiệp vụ thật - business đổi
  type cắt sắt sau này (Phase 3+) sẽ không làm vỡ nhóm test này nữa.

**Kết quả kiểm tra:**
- `npx tsc --noEmit`: 0 lỗi ở mọi file đã sửa (3 lỗi `imageUrl`/`PlanForm` trong `skus.service.ts`
  là CÓ SẴN từ trước, xác nhận bằng `git stash` - không liên quan tới thay đổi này).
- `npx eslint` trên 4 file đã sửa: 0 error, 1 warning `no-explicit-any` (y hệt warning cố ý có sẵn ở
  `NOTIFICATION_TYPES`, không phải warning mới).
- `npx jest` toàn repo: 1131/1131 pass ở mọi suite liên quan (49/50 suite pass); suite
  `skus.service.spec.ts` fail vì cùng lỗi biên dịch `imageUrl`/`PlanForm` có sẵn từ trước, xác nhận
  bằng `git stash` (fail y hệt kể cả không có thay đổi này) - KHÔNG phải do thay đổi trong mục này.
- Không có FE nào bị ảnh hưởng: các link/module của 4 type này đã bị bỏ từ mục 12.6, FE không đọc gì
  từ 3 type vừa xoá ngoài title/message hiển thị chung (không có logic đặc thù theo type ở FE).

**Còn treo:** không có gì mới ngoài các mục đã ghi (Phase 3-5, quyết định màn chi tiết
CuttingProposal ở mục 12.5/12.6 - vẫn đang chờ, và giờ càng bớt cấp thiết vì QLSX không còn thấy
thông báo "cần duyệt tay" nữa).

**Dữ liệu lịch sử:** 21 dòng notification cắt sắt cũ đã phân loại lại ở mục 12.5.A (gồm cả
`NEEDS_MANUAL_APPROVAL`/`AUTO_APPROVE_FAILED`/`CALCULATION_FAILED`) KHÔNG bị xoá hay đổi - chỉ
`emit()` không còn tạo MỚI loại này nữa. QLSX vẫn thấy đúng lịch sử cũ trong "Tất cả", chỉ không có
thêm dòng mới thuộc 3 loại này từ nay về sau.

## 15. Phase 3a — nhóm 7.1 "SKU/định mức" (9 sự kiện) — _ĐÃ XONG 2026-09-26_

Bắt đầu Phase 3a theo đúng plan mục 8 (thứ tự: 7.1 → 7.2 → 7.4). Theo yêu cầu người dùng: làm từng
nhóm, mỗi nhóm xong chạy test BE **và live-test FE thật** trước khi báo cáo (như cách làm Phase 1/2).
Nhóm 7.1 xong hoàn toàn - đây là báo cáo cho nhóm đó.

### 15.1 Phạm vi

Cả 7 sự kiện ở bảng mục 7.1 đã làm, **trừ 1 sự kiện** (xem 15.5): "Sales tạo/sửa đơn có SKU chưa có
định mức" - cố ý hoãn, không thuộc `skus.service.ts` mà nằm ở `sales-orders.service.ts`, và có nhiều
mơ hồ thiết kế riêng (thế nào là "SKU chưa có định mức" - chưa có `BomRevision` nào hay chưa có bản
ACTIVE? có nên báo mỗi lần sửa đơn hay chỉ lần đầu?). Coi là việc riêng của nhóm 7.1 kỳ sau.

9 type mới trong [notification-types.ts](../src/modules/notifications/notification-types.ts) (nhiều
hơn 7 dòng trong bảng vì "nộp định mức"/"trả định mức" tách riêng cho nhánh mảnh và nhánh chi tiết -
2 nhánh độc lập, không thể gộp 1 type mà resolve() đúng riêng từng nhánh):

| Type | Category/Severity | Người nhận | Trigger | Tự đóng khi |
|---|---|---|---|---|
| `SKU_NEEDS_MANH_QUOTA` | ACTION/INFO | SPEC_STEEL_STAFF | `POST /skus` | nộp mảnh lần đầu |
| `SKU_NEEDS_DETAIL_QUOTA` | ACTION/INFO | SPEC_ACCESSORY_PACKAGING_STAFF | `POST /skus` | nộp chi tiết lần đầu |
| `SKU_MANH_QUOTA_SUBMITTED` | ACTION/INFO | PRODUCTION_PLANNER | `.../manh-quota` | KHSX review (duyệt hoặc từ chối) |
| `SKU_DETAIL_QUOTA_SUBMITTED` | ACTION/INFO | PRODUCTION_PLANNER | `.../detail-quota` | KHSX review |
| `SKU_MANH_QUOTA_REJECTED` | ACTION/WARNING | SPEC_STEEL_STAFF | `.../manh-quota/review` (REJECTED) | nộp lại |
| `SKU_DETAIL_QUOTA_REJECTED` | ACTION/WARNING | SPEC_ACCESSORY_PACKAGING_STAFF | `.../detail-quota/review` (REJECTED) | nộp lại |
| `SKU_SENT_TO_BOSS` | ACTION/INFO | BOSS | `advanceForwardedTrack()` khi CẢ 2 nhánh vừa forward xong | Sếp duyệt/từ chối |
| `SKU_APPROVED` | RESULT/SUCCESS | PRODUCTION_PLANNER + 2 role Spec (+SALES_STAFF nếu có đơn) | `.../approve` | — |
| `SKU_REJECTED_BY_BOSS` | RESULT/WARNING | như trên | `.../reject-boss` | — |

`entityType = 'SKU'` (đúng gợi ý sẵn có trong doc comment `Notification.entityType` ở schema.prisma),
`entityId = planFormId`. Không dùng `dedupeKey` (không có luồng retry như solver cắt sắt).

### 15.2 Quyết định thiết kế đáng chú ý

- **Best-effort, KHÔNG dùng `tx` của các transaction sẵn có** (`updateManhQuota`/`updateDetailQuota`/
  `approve`/`rejectByBoss` đều có `$transaction`): bàn lại đúng vấn đề đã nêu ở mục 14 cho
  cutting-proposals - bắt lỗi (catch) một câu lệnh THẤT BẠI bên trong 1 Prisma interactive
  transaction không cứu được transaction đó (Postgres đã đánh dấu abort ở tầng kết nối). Nên
  `notifySku()`/`resolveSkuNotifications()` luôn gọi SAU KHI transaction chính đã commit, không
  truyền `tx`. Đánh đổi: nghiệp vụ chính có thể thành công mà thông báo lỡ không tạo được (hiếm,
  chỉ khi DB lỗi ngay lúc đó) - chấp nhận được, đã có test riêng xác nhận lỗi notify không làm hỏng
  response chính (xem 15.3).
- **`SALES_STAFF` cho `SKU_APPROVED`/`SKU_REJECTED_BY_BOSS`**: `SalesOrder` không có cột người tạo
  (không `createdById`) nên không nhắm được đích danh "Sales đã tạo đơn này" - đành báo CẢ role Sales
  khi SKU có gắn `salesOrderId`, khớp quyết định mục 9.4 ("gửi tất cả người cùng vai trò"). Rộng hơn
  bảng gốc mục 7.1 (bảng chỉ ghi "Sales tạo đơn liên quan" cho dòng duyệt, không ghi cho dòng từ
  chối) - cố ý thêm cho từ chối vì Sales cũng cần biết SKU của đơn mình bị trả, không có lý do hợp lý
  để báo lúc duyệt mà im lặng lúc từ chối.
- **`origin='PRODUCTION_CONFIRM'` guard trong `create()`**: PlanForm loại này (tạo nội bộ khi Sếp
  duyệt PI item, ẩn khỏi mọi màn KHSX) không đi qua nhánh emit - hiện KHÔNG có API nào tạo loại này
  qua `createPlanForm()` nên guard chưa từng kích hoạt thật, giữ phòng thủ cho tương lai.
- **Link `production`/`setup`** (2 role Spec) và `production_plan`/`duyet-sku` (KHSX) đã có sẵn màn
  thật để thao tác - KHÁC hẳn ca cắt sắt (mục 12.6) vốn phải bỏ hẳn `link` vì không có màn nào cho
  QLSX làm. `boss`/`cho-duyet` cũng có màn thật (`SKUReviewPage` filter mặc định "SKU mới"). Riêng
  `SKU_APPROVED` link `production_plan`/`planforms` chỉ mở đúng MÀN (danh sách), chưa deep-link tới
  đúng dòng SKU (`SKUListPage`/`SKUDetail.tsx` chưa đọc query param để tự mở 1 dòng) - vẫn hữu ích
  hơn không có link vì đúng nội dung liên quan, không như ca cắt sắt trỏ nhầm sang màn không liên
  quan hoàn toàn.

### 15.3 Đã làm (BE)

- [notification-types.ts](../src/modules/notifications/notification-types.ts): 9 type mới (mục 15.1).
- [skus.controller.ts](../src/modules/skus/skus.controller.ts): 8 endpoint (mọi endpoint TRỪ
  `create`/`update`/`remove`) thêm `@CurrentUser('id') actorUserId` để loại actor khỏi người nhận
  (nguyên tắc #2 mục 4 changelog 2026-09-25).
- [skus.service.ts](../src/modules/skus/skus.service.ts): thêm `NotificationsService` (constructor),
  helper `notifySku()`/`resolveSkuNotifications()`/`skuParams()`; gọi emit/resolve ở `create`,
  `updateManhQuota`, `reviewManhQuota`, `approveParts`, `updateDetailQuota`, `reviewDetailQuota`,
  `approveDetail`, `advanceForwardedTrack` (chỉ emit `SKU_SENT_TO_BOSS` đúng 1 lần khi
  `bothForwarded` CHUYỂN từ false sang true, không phải mỗi lần gọi), `approve`, `rejectByBoss`/
  `rewindToDetailReview`.
- [skus.module.ts](../src/modules/skus/skus.module.ts): import `NotificationsModule`.
- Test: 17 test mới trong `describe('notifications (Phase 3a, mục 7.1)')` (đủ 9 type, cả nhánh
  KHÔNG emit khi chỉ 1/2 track forward, nhánh short-circuit theo idempotencyKey không emit lại, và 1
  test xác nhận lỗi notify (mock reject) không làm hỏng response chính - best-effort thật).
- **Nghiệm thu:** `npx tsc --noEmit`: 0 lỗi (cần `npx prisma generate` trước - client cũ thiếu field
  `PlanForm.imageUrl` đã có sẵn trong `schema.prisma` từ việc khác, xác nhận bằng `git stash` là lỗi
  có sẵn không do phần việc này). `npx eslint --fix` trên các file sửa: 0 error, 1 warning
  `no-explicit-any` cố ý có sẵn. `npx jest` toàn repo: **1194/1194 pass, 50/50 suite** (tăng từ
  1131 - 63 test mới `skus.service.spec.ts` gồm cả các test không liên quan notification vì suite
  này trước đó KHÔNG chạy được do lỗi `imageUrl`/Prisma client, giờ chạy lại đầy đủ).

### 15.4 Live-test thật (BE+FE+DB thật, browser thật)

Bật lại Docker Desktop (`dna-erp-be-postgres-1`) - `prisma migrate deploy` 2 migration đang chờ
(`20260925000000_add_plan_form_image_url`, `20260925100000_drop_mfg_product_factory_code_unique` -
của việc khác, không phải notification, nhưng cần để DB khớp schema hiện tại). Chạy `nest start
--watch` (cổng 3001) + `next dev` (cổng 3000, phải xoá `.next` và khởi động lại 1 lần do cache
Turbopack lỗi từ phiên trước để lại - gặp trang `/` và `/login` trả 404 dù code không lỗi gì).

Kịch bản test bằng `mcp__Claude_Browser__*` (browser thật), tài khoản demo (`khsx`/`dms`/`dmbbdg`/
`boss`, mật khẩu chung `demo1234` theo `prisma/seed-demo.ts`):

1. `khsx` tạo SKU mới "TEST-NOTIF-7.1" - xác nhận qua `psql`: `SKU_NEEDS_MANH_QUOTA` (dms) +
   `SKU_NEEDS_DETAIL_QUOTA` (dmbbdg) tạo đúng, đúng `entityId`.
2. `dms` thấy đúng 2 thông báo trong panel "Cần xử lý", nhập 1 mảnh + 1 dòng vật tư Sắt, gửi phê
   duyệt - `SKU_NEEDS_MANH_QUOTA` resolved, `SKU_MANH_QUOTA_SUBMITTED` (khsx) tạo mới.
3. `khsx` **từ chối** (kèm lý do "Sai chiều dài cắt") - `SKU_MANH_QUOTA_SUBMITTED` resolved,
   `SKU_MANH_QUOTA_REJECTED` (dms) tạo mới đúng lý do; `dms` thấy đúng nội dung trong panel.
4. `dms` nộp lại (không sửa gì, chỉ gửi lại) - `SKU_MANH_QUOTA_REJECTED` resolved,
   `SKU_MANH_QUOTA_SUBMITTED` tạo mới lần 2.
5. `khsx` duyệt + "Xác nhận hoàn tất — Định mức mảnh" (`approveParts`) - `SKU_MANH_QUOTA_SUBMITTED`
   resolved; KHÔNG có `SKU_SENT_TO_BOSS` (đúng - nhánh chi tiết chưa forward).
6. `dmbbdg` nộp định mức chi tiết (tab "Bao bì") - `SKU_NEEDS_DETAIL_QUOTA` resolved,
   `SKU_DETAIL_QUOTA_SUBMITTED` (khsx) tạo mới.
7. `khsx` duyệt + "Xác nhận hoàn tất — Định mức chi tiết" (`approveDetail`, nhánh forward SAU CÙNG)
   - `SKU_DETAIL_QUOTA_SUBMITTED` resolved **VÀ** `SKU_SENT_TO_BOSS` (boss) tạo đúng 1 dòng.
8. `boss` thấy đúng nội dung trong panel; đứng ở màn khác ("Danh sách SKU", `?p=sku-list`), bấm
   thông báo - mark-read (`readAt` xác nhận qua `psql`) - URL đổi đúng `?m=boss&p=cho-duyet`, F5 vẫn
   giữ đúng màn (khớp mục tiêu mục 6.2) - **khác ca cắt sắt (mục 12.5.B)**, lần này link đúng NGAY
   TỪ ĐẦU vì đã kiểm bằng đúng người nhận thật (`boss`), không chỉ bằng tài khoản có quyền vượt rào.
9. `boss` duyệt (`approve`) - `SKU_SENT_TO_BOSS` resolved, `SKU_APPROVED` fan-out đúng 3 người
   (khsx, dms, dmbbdg) - xác nhận qua `psql`.

Một trở ngại phát sinh giữa chừng: DB dev **không có material nào gán `detailKind`** (Sơn/Phụ
kiện/Bao bì) nên `dmbbdg` không chọn được vật tư ở bước 6 - tạo 1 material test
(`TEST-BAOBI-NOTIF`, nhóm OTHER, `detailKind=PACKAGING`) chỉ để dùng cho bước này, xoá lại ở cuối
(mục 15.4 phần dọn dẹp).

**Không live-test riêng** `SKU_REJECTED_BY_BOSS` (Sếp từ chối ở bước cuối) - cùng entity test đã
được `approve()` kích hoạt `BomRevision` ACTIVE ở bước 9 nên không dùng lại để test reject được nữa;
cơ chế resolve+emit-kèm-lý-do đã được chứng minh sống ở bước 3 (`SKU_MANH_QUOTA_REJECTED`, cùng
pattern hệt nhau) và có unit test riêng (`rejectByBoss() resolve SKU_SENT_TO_BOSS rồi emit
SKU_REJECTED_BY_BOSS kèm lý do`).

**Dọn dữ liệu sau test:** xoá sạch bằng `psql` trong 1 transaction - `notifications`/
`notification_recipients` (cascade) của `entityId=5`, `plan_form_manh_reviews`/
`plan_form_detail_reviews`, các bảng con BOM (`piece_bom`/`bom_piece`/`piece_material_item`/
`piece_material_yield`/`consumable_bom`/`bom_accessory_items`) theo `bomRevisionId`, `bom_revision`
(phải tạm set về `DRAFT` trước - trigger `assert_bom_revision_draft()` chặn xoá dòng con của
`BomRevision` đang ACTIVE), `piece` "Manh test", `plan_forms` id 5, `mfg_products` "TEST-NOTIF-7.1",
material test `TEST-BAOBI-NOTIF`. Xác nhận lại bằng `psql`: `notifications` về đúng 21 dòng (baseline
cũ), `mfg_products` về đúng 4 dòng gốc (`BAN-J55`/`GHE-J55`/`GHE-TINH-YEU`/`BAN-8-MEIYING-J55`).

### 15.5 Còn treo

- Sự kiện "Sales tạo/sửa đơn có SKU chưa có định mức" (mục 7.1, hàng đầu bảng) - hoãn sang đợt sau,
  cần chốt thêm ngữ nghĩa "chưa có định mức" trước khi làm (xem mục 15.1).
- Phase 3a còn 2 nhóm nữa theo plan mục 8: 7.2 (Lệnh sản xuất PI) và 7.4 (Đề xuất mua mới) - làm
  từng nhóm 1, test BE + live-test FE mỗi nhóm theo đúng cách đã làm ở đây.
- `SKU_APPROVED` chưa deep-link tới đúng dòng SKU (chỉ mở đúng màn danh sách) - cần FE thêm đọc query
  param ở `SKUListPage`/`SKUDetail.tsx` nếu muốn nâng cấp, không thuộc phạm vi BE của đợt này.

## 16. Phase 3a — nhóm 7.2 "Lệnh sản xuất PI" (6 sự kiện) — _ĐÃ XONG 2026-09-26_

Tiếp tục Phase 3a theo đúng thứ tự plan (7.1 xong ở mục 15, giờ tới 7.2). Cùng cách làm: 1 nhóm, test
BE + live-test FE thật, rồi mới báo cáo.

### 16.1 Phạm vi và 1 quyết định lệch plan gốc

Cả 6 sự kiện ở bảng mục 7.2 đã làm. Riêng dòng cuối ("Tạo lệnh SX thất bại / retry-production-order
lỗi") **đổi người nhận so với plan gốc**: bảng mục 7.2 ghi QLSX, nhưng đọc lại code thì route khắc
phục (`POST .../retry-production-order`) chỉ `@RequireRole(DEFAULT_ROLES.ADMIN)` gọi được, và FE
**chưa có nút nào** gọi route này (`grep` toàn bộ `src/modules/pages` chỉ thấy hàm gọi API có sẵn
trong `production-invoices-api.ts`, không màn nào dùng tới) - giống hệt pattern vừa sửa ở mục 14 (báo
QLSX 1 việc họ không tự làm được). Đã hỏi lại người dùng, chốt: **báo ADMIN** thay vì QLSX (severity
CRITICAL nên Sếp vẫn tự động nhận thêm, mục 9.3).

6 type mới trong [notification-types.ts](../src/modules/notifications/notification-types.ts):

| Type | Category/Severity | Người nhận | Trigger | Tự đóng khi |
|---|---|---|---|---|
| `PI_SENT_TO_QLSX` | ACTION/INFO | PRODUCTION_MANAGER (QLSX) | `send-to-qlsx`/`send-to-qlsx-batch` | 0 SKU của PI còn WAITING_QLSX |
| `PI_REJECTED_BY_QLSX` | RESULT/WARNING | PRODUCTION_PLANNER (KHSX) | `reject-by-qlsx`/`reject-qlsx-batch` | — |
| `PI_SENT_TO_BOSS` | ACTION/INFO | BOSS | `send-to-boss`/`send-to-boss-batch` | 0 SKU của PI còn WAITING_BOSS |
| `PI_APPROVED_BY_BOSS` | RESULT/SUCCESS | PRODUCTION_PLANNER + PRODUCTION_MANAGER | `approve`/`approve-batch` | — |
| `PI_REJECTED_BY_BOSS` | RESULT/WARNING | PRODUCTION_PLANNER + PRODUCTION_MANAGER | `reject`/`reject-batch` | — |
| `PI_PRODUCTION_ORDER_FAILED` | ALERT/CRITICAL | **ADMIN** (khác plan gốc) | `createFromApproval()` lỗi trong `approveItem`/`approveBatch` | `retry-production-order` thành công |

`entityType = 'PRODUCTION_INVOICE'` (entityId=piId) cho 5 type đầu, riêng `PI_PRODUCTION_ORDER_FAILED`
dùng `entityType = 'PRODUCTION_INVOICE_ITEM'` (entityId=itemId) vì sự cố là của riêng 1 SKU, PI có
thể còn SKU khác vẫn ổn.

### 16.2 Quyết định thiết kế đáng chú ý

- **"Gộp 1 thông báo/PI, n SKU"** (đúng yêu cầu plan cho `PI_SENT_TO_QLSX`/`PI_SENT_TO_BOSS`): dùng
  `dedupeKey = "{TYPE}:{piId}"` - gửi lẻ nhiều lần trước khi người nhận kịp xử lý sẽ gộp vào 1 dòng,
  `count` cập nhật theo tổng SKU đang chờ tại thời điểm gọi gần nhất (tính từ `pi.items` đã có sẵn
  trong bộ nhớ tại đầu mỗi hàm, không query lại DB). **Giới hạn đã biết:** khi số lượng GIẢM (1 SKU
  rời hàng đợi nhưng còn SKU khác), thông báo KHÔNG tự cập nhật lại "n" nhỏ hơn - chỉ đóng hẳn khi
  n về 0. Chấp nhận được ở quy mô hiện tại (đa số PI có 1 SKU).
- **PI có thể bị XOÁ ngay sau khi resolve/emit** (khi item cuối cùng rời PI qua nhánh từ chối - xem
  `rejectItemByQlsx`/`rejectItem`): gọi `resolvePiNotifications()`/`notifyPi()` vẫn dùng đúng `pi.id`
  (đọc từ TRƯỚC khi transaction xoá PI) - an toàn vì `Notification.entityId` chỉ là chuỗi lưu trữ,
  không có khoá ngoại tới `ProductionInvoice` (giống cách `PI_REJECTED_BY_QLSX`/`PI_REJECTED_BY_BOSS`
  vẫn tham chiếu đúng piId dù PI đã không còn tồn tại - RESULT không cần tra lại theo entityId).
- **`PI_PRODUCTION_ORDER_FAILED` đổi recipient ADMIN thay QLSX** - xem mục 16.1, cùng lý do mục 14.
- **`PI_APPROVED_BY_BOSS`/`PI_REJECTED_BY_BOSS` KHÔNG có `link`** dù đã có màn thật cho từng vai
  trò riêng lẻ: 2 type này báo CẢ KHSX lẫn QLSX, mà 2 role đó có module "nhà" khác nhau
  (`production_plan` vs `production`) và nhân viên thường bị khoá cứng vào module của mình (chỉ
  Giám đốc mới vượt rào, xem `app/page.tsx`) - 1 `link` không thể đúng cho cả 2 phía cùng lúc, bên
  còn lại sẽ bị bật về module mặc định + toast (mục 6.2). Đúng tinh thần mục 12.6: "thà không có
  link còn hơn có link sai với 1 nửa người nhận".
- **Best-effort NGOÀI transaction** - cùng lý do kỹ thuật đã ghi ở mục 14/15.2 (catch bên trong 1
  Prisma interactive transaction không cứu được transaction đó).

### 16.3 Đã làm (BE)

- [notification-types.ts](../src/modules/notifications/notification-types.ts): 6 type mới (mục 16.1).
- [production-invoices.service.ts](../src/modules/production-invoices/production-invoices.service.ts):
  thêm `NotificationsService` (constructor), helper `notifyPi()`/`resolvePiNotifications()`; gọi
  emit/resolve ở `sendItemToQlsx`, `sendBatchToQlsx`, `sendItemToBoss`, `sendBatchToBoss`,
  `rejectItemByQlsx`, `rejectBatchByQlsx`, `approveItem` (+ nhánh `PI_PRODUCTION_ORDER_FAILED` khi
  `createFromApproval()` lỗi), `approveBatch` (tương tự, mỗi item lỗi báo riêng), `rejectItem`,
  `rejectBatch`, `retryProductionOrder` (resolve khi thành công).
- [production-invoices.module.ts](../src/modules/production-invoices/production-invoices.module.ts):
  import `NotificationsModule`.
- Test: 15 test mới trong `describe('notifications (Phase 3a, mục 7.2)')` (đủ 6 type, nhánh KHÔNG
  resolve khi còn SKU khác đang chờ, nhánh resolve-vô-điều-kiện của các hàm *Batch (đòi mọi item
  cùng trạng thái mới cho chạy), và 1 test xác nhận lỗi notify không làm hỏng response chính).
- **Nghiệm thu:** `npx tsc --noEmit`: 0 lỗi. `npx eslint --fix`: 0 error, 1 warning `no-explicit-any`
  cố ý có sẵn (như mọi lần trước). `npx jest` toàn repo: **1207/1207 pass, 50/50 suite** (tăng từ
  1194 - 15 test mới, không test nào cũ bị vỡ).

### 16.4 Live-test thật (BE+FE+DB thật, browser thật)

Tái sử dụng đúng phiên Docker/BE/FE đã bật từ mục 15.4 (không cần khởi động lại). Tạo dữ liệu test
qua **API thật** (gọi thẳng `fetch()` trong console trình duyệt, dùng `access_token` của phiên đăng
nhập thật - không phải qua form FE) vì màn "Tạo SKU mới" (`SKUReviewPage`) không có ô chọn Sales
Order, trong khi `POST /skus` kèm `salesOrderId` mới tự tạo `ProductionInvoice`+`ProductionInvoiceItem`
ngay lập tức (`resolveProductionInvoice()`, không cần qua toàn bộ vòng duyệt định mức của mục 15) -
chỉ có API mới thiết lập được đúng tiền đề cần thiết cho test này. Vẫn là BE thật/DB thật/kiểm tra
qua UI thật ở các bước sau, chỉ riêng bước "gây ra" trạng thái ban đầu là gọi thẳng API thay vì click
UI không tồn tại.

1. Tạo PlanForm mới gắn `salesOrderId=12` (đơn demo "TEST6"), `mfgProductId=2` (GHE-J55, sản phẩm có
   sẵn) → tự sinh `ProductionInvoice` PI-2026-014 + 1 item (`prodApprovalStatus=null`).
2. Gọi `send-to-qlsx` (đóng vai `khsx`) → xác nhận qua `psql`: `PI_SENT_TO_QLSX` tạo đúng cho `qlsx`,
   `count=1`. Đăng nhập UI `qlsx` thật: chuông + panel "Cần xử lý" hiện đúng
   "PI-2026-014: 1 SKU chờ QLSX duyệt / KHSX đã gửi - vào xử lý."
3. Gọi `send-to-boss` (đóng vai `qlsx`) → `PI_SENT_TO_QLSX` resolved, `PI_SENT_TO_BOSS` tạo cho
   `boss`.
4. Đăng nhập UI `boss` thật, đứng ở màn khác (`?m=boss&p=sku-list`), bấm thông báo → mark-read → URL
   đổi đúng `?m=boss&p=cho-duyet` (khớp mục tiêu mục 6.2, đúng ngay từ đầu vì đã test bằng chính
   người nhận thật `boss`, không phải tài khoản vượt rào như bài học mục 12.5.B).
5. Gọi `reject` (đóng vai `boss`, lý do "Test 7.2 - sai quy cách") → xác nhận qua `psql`:
   `PI_SENT_TO_BOSS` resolved, `PI_REJECTED_BY_BOSS` fan-out đúng CẢ `khsx` lẫn `qlsx`, PI-2026-014
   bị xoá (item cuối cùng rời PI, đúng thiết kế). Đăng nhập UI `khsx` thật, tab "Tất cả" (đúng - RESULT
   không vào "Cần xử lý") hiện đúng "PI-2026-014: 1 SKU bị Sếp từ chối / Lý do: Test 7.2 - sai quy
   cách. SKU đã quay về 'Tối ưu cắt sắt'."

**Không live-test** `PI_APPROVED_BY_BOSS`/`PI_PRODUCTION_ORDER_FAILED` (nhánh `approve`) - khác nhánh
`reject` (chỉ đổi 3 field), `approve` kéo theo tạo `ProductionOrder` thật + gọi solver cắt sắt ngoài
thật (`ExternalApiService`) + đề xuất mua hàng thật, khó dọn sạch & không nên gọi solver ngoài không
cần thiết chỉ để test notification. 2 type này đã được unit test đầy đủ (mục 16.3); cơ chế
resolve+emit đã chứng minh sống qua đúng cặp cùng dạng ở bước 3/5 (`PI_SENT_TO_BOSS` resolve,
`PI_REJECTED_BY_BOSS` emit kèm lý do).

**Dọn dữ liệu sau test:** xoá `production_invoice_items` id vừa tạo, `plan_forms` vừa tạo (product
GHE-J55 dùng chung id=2 - KHÔNG xoá, chỉ xoá PlanForm mới), toàn bộ `notifications` liên quan
(`entityType='PRODUCTION_INVOICE'` theo piId VÀ `entityType='SKU'` theo 2 planFormId đã tạo trong lúc
dựng tiền đề - dòng plan_form thứ nhất bị bỏ giữa chừng, xem bước dưới). Xác nhận lại bằng `psql`:
`notifications` về đúng 21 dòng baseline, `mfg_products`/`plan_forms`/`production_invoices` về đúng
số dòng gốc.

**Một sai sót nhỏ giữa chừng (tự phát hiện, không phải người dùng chỉ ra):** lần tạo PlanForm ĐẦU
TIÊN dùng 1 `mfgProductId` MỚI (không phải sản phẩm có sẵn) nên KHÔNG khớp được `SalesOrderItem` nào
của đơn TEST6 → không tự sinh `ProductionInvoiceItem` (`resolveProductionInvoice()` chỉ tạo item khi
tìm thấy `SalesOrderItem` khớp `(salesOrderId, mfgProductId)`) - phải xoá dọn PlanForm/product đó rồi
tạo lại lần 2 với `mfgProductId=2` (khớp item có sẵn của đơn) mới ra đúng tiền đề cần thiết. Cũng vì
sai sót này mà bước dọn dẹp phải xoá thêm 4 dòng `notifications` loại `SKU_NEEDS_MANH_QUOTA`/
`SKU_NEEDS_DETAIL_QUOTA` (do `createPlanForm()` LUÔN emit 2 type đó bất kể sau này có sinh PI item
hay không, xem mục 15) mà lần dọn đầu tiên bỏ sót (chỉ dọn `entityType='PRODUCTION_INVOICE'`, quên
mất `entityType='SKU'` của chính 2 lần tạo PlanForm) - phát hiện khi đếm lại tổng `notifications` ra
25 thay vì 21 baseline, soi lại mới thấy.

### 16.5 Còn treo

- Phase 3a còn đúng 1 nhóm: 7.4 (Đề xuất mua mới) - làm tiếp theo cùng cách. _Đã làm xong, xem mục 17._
- Giới hạn "n SKU không tự giảm khi 1 SKU rời hàng đợi nhưng còn SKU khác" (mục 16.2) - chấp nhận
  được ở quy mô hiện tại, ghi lại để biết nếu sau này PI nhiều SKU dùng route lẻ trở nên phổ biến hơn.
- `PI_APPROVED_BY_BOSS`/`PI_PRODUCTION_ORDER_FAILED` chưa live-test nhánh approve thật (mục 16.4) -
  chỉ có unit test. Nên test khi có dịp tự nhiên (PI thật được duyệt trong lúc test 1 việc khác cần
  BOM/solver thật sẵn có).

## 17. Phase 3a — nhóm 7.4 "Đề xuất mua hàng" (4 sự kiện) — _ĐÃ XONG 2026-09-26, Phase 3a hoàn tất_

Nhóm cuối cùng của Phase 3a (7.1 xong ở mục 15, 7.2 xong ở mục 16). Cùng cách làm: 1 nhóm, test BE +
live-test FE thật, rồi mới báo cáo.

### 17.1 Phạm vi

4 type mới trong [notification-types.ts](../src/modules/notifications/notification-types.ts), khớp
đúng bảng plan mục 7.4 (không lệch người nhận/luồng nào, khác mục 16.1):

| Type | Category/Severity | Người nhận | Trigger | Tự đóng khi |
|---|---|---|---|---|
| `PURCHASE_PROPOSAL_CREATED` | ACTION/INFO | PURCHASER (Mua hàng) | Đề xuất mua mới sinh ra từ cắt sắt (`CuttingProposalsService.approve()`), kiểm kho vật tư tiêu hao (`ConsumableMaterialPurchaseService`), hoặc định mức cắt PI (`PieceMaterialYieldPurchaseService`) | 0 item của đề xuất còn ở trạng thái trước `PURCHASING` |
| `PURCHASE_PROPOSAL_APPROVED` | RESULT/INFO | PRODUCTION_MANAGER (QLSX) | `bossApprove()` - Mua hàng tải file duyệt ký tay | — |
| `PURCHASE_PROPOSAL_ITEM_RECEIVED` | RESULT/INFO | Kho theo `Material.warehouseId` + PRODUCTION_MANAGER | `receiveItem()` - nhận 1 dòng hàng về | — |
| `PURCHASE_PROPOSAL_PURCHASED` | RESULT/SUCCESS | PRODUCTION_MANAGER + PURCHASER | `receiveItem()` khi dòng cuối cùng đưa cả đề xuất về `PURCHASED` | — |

`entityType = 'PURCHASE_PROPOSAL'` (entityId=proposalId) cho cả 4 type.

### 17.2 Quyết định thiết kế đáng chú ý

- **"1 PI = 1 PurchaseProposal", 3 nơi tạo khác nhau cùng gọi 1 hàm dùng chung**: `CuttingProposalsService`,
  `ConsumableMaterialPurchaseService`, `PieceMaterialYieldPurchaseService` đều find-or-create vào
  CÙNG 1 `PurchaseProposal` theo `productionInvoiceId` - tách hẳn logic notify creation ra
  [purchase-proposal-notify.util.ts](../src/modules/purchase-proposals/purchase-proposal-notify.util.ts)
  (hàm đứng riêng, không phải method của class nào) để dùng chung ở cả 3 nơi thay vì copy 3 lần hoặc
  ép 3 service không liên quan cùng kế thừa 1 lớp - đúng pattern đã dùng cho
  `purchase-proposal-status.util.ts`.
- **`PURCHASE_PROPOSAL_CREATED` chỉ emit khi còn item PENDING**: đề xuất có thể được tạo (hoặc
  find-lại) nhưng đã ở `PURCHASING`/`PURCHASED` ngay từ đầu (vd định mức cắt PI tính ra đề xuất
  nhưng mọi dòng đã đủ tồn kho) - hàm dùng chung kiểm `pendingCount === 0` thì bỏ qua, tránh báo
  Mua hàng 1 việc không có gì để làm.
- **`PURCHASE_PROPOSAL_ITEM_RECEIVED`/`PURCHASE_PROPOSAL_PURCHASED` KHÔNG có `link`** - đúng tinh
  thần mục 12.6/16.2: người nhận gồm cả Kho (module `inbound_warehouse`) lẫn QLSX (module
  `production`), 2 module "nhà" khác nhau, 1 `link` không thể đúng cho cả 2 phía.
- **`bossApprove()` chỉ đóng `PURCHASE_PROPOSAL_CREATED` khi 0 item còn PENDING** - 1 đề xuất có thể
  có nhiều người mua phụ trách các dòng khác nhau (`Material.buyerId`); người này duyệt xong phần
  mình không có nghĩa "n vật tư cần mua" của người mua khác đã hết việc - dùng lại đúng logic đếm
  `stillPending` đã áp dụng ở mục 16.2 cho PI.
- **Best-effort NGOÀI transaction** - cùng lý do kỹ thuật đã ghi ở mục 14/15.2/16.2.

### 17.3 Đã làm (BE)

- [notification-types.ts](../src/modules/notifications/notification-types.ts): 4 type mới (mục 17.1).
- [purchase-proposal-notify.util.ts](../src/modules/purchase-proposals/purchase-proposal-notify.util.ts)
  (file mới): `notifyPurchaseProposalCreated()` dùng chung ở 3 call-site tạo đề xuất.
- [cutting-proposals.service.ts](../src/modules/cutting-proposals/cutting-proposals.service.ts): gọi
  `notifyPurchaseProposalCreated()` sau khi `approve()` commit transaction (cả nhánh tạo mới lẫn tìm
  lại đề xuất có sẵn).
- [consumable-material-purchase.service.ts](../src/modules/production-invoices/consumable-material-purchase.service.ts)
  và [piece-material-yield-purchase.service.ts](../src/modules/production-invoices/piece-material-yield-purchase.service.ts):
  cùng gọi `notifyPurchaseProposalCreated()` sau transaction; thêm `NotificationsService` vào constructor.
- [purchase-proposals.service.ts](../src/modules/purchase-proposals/purchase-proposals.service.ts):
  thêm `NotificationsService` (constructor) + `Logger`; helper riêng `notifyPurchaseProposal()`/
  `resolvePurchaseProposalCreated()`/`resolvePiCodeFor()`; gọi ở `bossApprove()` (APPROVED + resolve
  CREATED có điều kiện) và `receiveItem()` (ITEM_RECEIVED luôn luôn, PURCHASED thêm khi item cuối
  cùng đưa cả đề xuất về `PURCHASED`).
- [purchase-proposals.module.ts](../src/modules/purchase-proposals/purchase-proposals.module.ts),
  [production-invoices.module.ts](../src/modules/production-invoices/production-invoices.module.ts):
  import `NotificationsModule`.
- Test: thêm test cho cả 4 service (`cutting-proposals`, `consumable-material-purchase`,
  `piece-material-yield-purchase`, `purchase-proposals`) - đủ nhánh emit CREATED khi còn PENDING,
  KHÔNG emit khi đề xuất đã `PURCHASED` ngay từ đầu, APPROVED + resolve CREATED (có điều kiện còn
  người mua khác), ITEM_RECEIVED không kèm PURCHASED khi nhận dở, và emit THÊM PURCHASED khi dòng
  cuối cùng đóng đề xuất.
- **Nghiệm thu:** `npx tsc --noEmit`: 0 lỗi. `npx eslint --fix`: 0 error, 1 warning `no-explicit-any`
  cố ý có sẵn (như mọi lần trước). `npx jest` toàn repo: **1215/1215 pass, 50/50 suite** (tăng từ
  1207 ở mục 16 - 8 test mới, không test nào cũ bị vỡ).
- FE: [PurchasingApp.tsx](../../DNA-ERP/src/modules/pages/Purchasing/PurchasingApp.tsx) và
  [InboundWarehouseApp.tsx](../../DNA-ERP/src/modules/pages/InboundWarehouse/InboundWarehouseApp.tsx)
  nối `?p=` URL-sync (cùng pattern `ProductionPlanApp`/`MfgApp`/`BossApp` mục 12.5.B) - cần thiết để
  `link` của `PURCHASE_PROPOSAL_CREATED` (`purchasing/lenh-mua-ncc`) điều hướng đúng tab. `tsc`/
  `eslint`/`vitest` (52/52) đều xanh.

### 17.4 Live-test thật (BE+FE+DB thật, browser thật)

Tái sử dụng đúng phiên Docker/BE/FE đã bật từ mục 15.4/16.4. Khác 2 nhóm trước: **không tạo dữ liệu
throwaway mới** mà dùng lại 1 `PurchaseProposal` NEW có sẵn trong DB dev (id=5, `PI-2026-007`,
nguồn `CUTTING_PROPOSAL`, 7 dòng vật tư, không dòng nào gán `buyerId` riêng) - vì cả 6 đề xuất
`NEW` hiện có đều sinh ra từ nhánh cắt sắt (`approve()`, pipeline solver tốn kém), giống lý do mục
16.4 đã né nhánh `approve` của PI: không đáng gọi lại solver ngoài chỉ để lấy tiền đề test.

1. Đăng nhập thật `muapsh` (role PURCHASER) qua API (`POST /api/v1/auth/login`), gọi thật
   `POST /api/v1/purchase-proposals/5/boss-approve` với `approvalFileUrl` giả (link ví dụ) - đúng
   endpoint FE gọi khi nhân viên mua hàng bấm "Đã có Sếp duyệt" (tên hàm `bossApprove` nhưng người
   bấm là Mua hàng, xem doc-comment dòng 289-291 service - quyền `PURCHASE_PROPOSAL:UPDATE`, không
   phải `APPROVE`, chốt chặn thật nằm ở chữ ký tay ngoài phần mềm).
2. Xác nhận qua `psql`: `PURCHASE_PROPOSAL_APPROVED` tạo đúng 1 dòng, `entityId='5'`, `link` trỏ
   `production/lenh-sx`, recipient duy nhất là `qlsx` (đúng bảng mục 7.4 dòng C), `readAt` còn NULL.
3. Đăng nhập UI `qlsx` thật (không phải tài khoản vượt rào) → mở chuông → tab "Tất cả" (đúng, RESULT
   không vào "Cần xử lý") hiện đúng đầu danh sách "PI-2026-007: đề xuất mua đã có Sếp duyệt / Mua
   hàng đã tải file duyệt ký tay cho 7 vật tư - đang đặt hàng." → bấm vào → mark-read (badge giảm
   đúng 1), điều hướng đúng `production/lenh-sx` (đã sẵn ở đúng module nên không thấy chuyển màn,
   nhưng URL/mark-read xác nhận cơ chế chạy đúng).

**Không live-test `PURCHASE_PROPOSAL_CREATED`** qua đúng luồng thật (`approve()` cắt sắt) - cùng lý
do mục 16.4 (không đáng gọi lại solver ngoài); type này đã được unit test đầy đủ ở cả 3 call-site
(mục 17.3) nên rủi ro thấp. **Không live-test `PURCHASE_PROPOSAL_ITEM_RECEIVED`/`PURCHASE_PROPOSAL_PURCHASED`**
qua `receiveItem()` thật - khác `bossApprove()` (chỉ đổi field + audit log, dọn sạch bằng UPDATE),
`receiveItem()` ghi `StockLedger`/cập nhật `StockReservation` thật (nhập kho thật) - khó đảo ngược
an toàn trên DB dev dùng chung mà không có nguy cơ làm lệch số tồn kho đang phục vụ test khác; 2 type
này cũng đã unit test đầy đủ cả nhánh nhận dở lẫn nhánh đóng đề xuất (mục 17.3).

**Dọn dữ liệu sau test:** revert `purchase_proposal_items` (7 dòng của proposal 5) về đúng
`status='NEW'`, xoá `approvedAt`/`approvedById`/`approvalFileUrl`; `purchase_proposals.status` về
`NEW`; xoá dòng `audit_logs` vừa ghi (hành động boss-approve giả); xoá `notification` +
`notification_recipients` vừa tạo. Xác nhận qua `psql`: proposal 5 về đúng `NEW` (7/7 item `NEW`),
`notifications` về đúng 21 dòng baseline, `audit_logs` của `PurchaseProposal#5` về đúng 2 dòng gốc
(CREATE + UPDATE ngày 2026-09-22, trước lần test này).

### 17.5 Còn treo

- `PURCHASE_PROPOSAL_CREATED` (cả 3 call-site) và `PURCHASE_PROPOSAL_ITEM_RECEIVED`/
  `PURCHASE_PROPOSAL_PURCHASED` chưa live-test qua đúng luồng thật (mục 17.4) - chỉ có unit test.
  Nên test khi có dịp tự nhiên (1 đề xuất mua thật được tạo/nhận hàng trong lúc test việc khác).
- **Phase 3a (7.1, 7.2, 7.4) coi như hoàn tất.** (Cập nhật 2026-09-28, mục 26.5: Phase 3b/3c sau đó
  cũng đã xong toàn bộ - xem mục 8. Còn lại Phase 4/5.)

## 18. Sửa bug `warehouseIds` sai kiểu dữ liệu ở `PURCHASE_PROPOSAL_ITEM_RECEIVED` — _2026-09-26, phát hiện lúc rà research Phase 3b_

**Phát hiện:** lúc research để bắt đầu Phase 3b, rà lại `RecipientResolverService.resolve()` thì thấy
tiêu chí `warehouseIds` được lọc bằng `User.warehouseScope: { in: criteria.warehouseIds }` -
`warehouseScope` trong repo này LÀ CHUỖI MÃ KHO (`'phoi-son-han'`, `'vat-tu-tp'`...), KHÔNG PHẢI
`Warehouse.id`. Trong khi đó `PurchaseProposalsService.receiveItem()` ([purchase-proposals.service.ts](../src/modules/purchase-proposals/purchase-proposals.service.ts))
lại truyền `materialWarehouseId.toString()` (khoá số `Warehouse.id`) làm `warehouseId` cho
`PURCHASE_PROPOSAL_ITEM_RECEIVED` (mục 17.1/17.3) - nghĩa là tiêu chí `warehouseIds` gần như KHÔNG
BAO GIỜ khớp `warehouseScope` của bất kỳ thủ kho nào (trừ khi trùng ngẫu nhiên chuỗi số), nên
**type này thực chất chỉ tới đúng QLSX, không hề tới Kho như thiết kế ban đầu (mục 7.4 dòng B)**.
Vì mục 17.5 đã tự ghi "chưa live-test qua đúng luồng thật" cho đúng type này, bug chưa lộ ra ở
live-test - chỉ lộ khi đọc lại code cho Phase 3b.

**Đã sửa:** đổi sang truyền `targetWarehouseCode` (biến đã có sẵn trong `receiveItem()`, chính là mã
kho thật đã dùng để ghi `StockLedger`) thay vì `materialWarehouseId.toString()`; đổi tên param từ
`warehouseId` → `warehouseCode` cho đúng bản chất (ở cả `notification-types.ts` và
`purchase-proposals.service.ts`) để không ai đọc nhầm là ID lần nữa. Cập nhật 1 test đang gán cứng
`warehouseId: '800'` (khoá số giả) thành `warehouseCode: 'phoi-son-han'` (khớp mã kho mặc định của
material fixture trong file test).

**Kiểm tra:** `npx tsc --noEmit`: 0 lỗi mới. `npx jest` toàn repo: **1215/1215 pass, 50/50 suite**
(không đổi số lượng test, chỉ sửa lại 1 assertion).

**Còn treo:** chưa live-test lại `PURCHASE_PROPOSAL_ITEM_RECEIVED` qua đúng luồng thật sau khi sửa
(cùng lý do mục 17.4 - `receiveItem()` ghi `StockLedger` thật, khó dọn sạch trên DB dev dùng chung).
Nên kiểm khi có dịp tự nhiên.

## 19. Phase 3b — nhóm 7.5-i "Sắt → Phôi → KCS" (4 sự kiện) — _ĐÃ XONG 2026-09-26_

Bắt đầu Phase 3b (mục 7.5 changelog - kho/sàn xưởng). Phạm vi rất rộng (10 sự kiện, ~10 module) nên
chia nhỏ theo domain, làm tuần tự từng nhóm - cùng nhịp 7.1/7.2/7.4. Nhóm đầu: chuỗi Kho xuất sắt →
Phôi → KCS (4 dòng đầu bảng mục 7.5).

### 19.1 Phạm vi và 3 lệch so với plan gốc (đã hỏi + được người dùng chốt trước khi code)

| Type | Category/Severity | Người nhận | Trigger | Tự đóng khi |
|---|---|---|---|---|
| `STEEL_ISSUE_TO_PHOI` | ACTION/INFO | PHOI_STAFF | `steel-issues` tạo (Kho xuất sắt) | Phôi `receive()` |
| `CUT_BUNDLE_TO_KCS` | ACTION/INFO | KCS_STAFF | `cut-bundles/:id/finish` (Phôi báo xong đợt cắt) | KCS `reviewCutBundle()` |
| `BATCH_TO_KCS` | ACTION/INFO | KCS_STAFF | `production-batches/:id/finish` (Hàn/Sơn báo xong đợt) | KCS `reviewProductionBatch()` |
| `QC_FAILED` | RESULT/WARNING | Tổ gửi (Phôi/Hàn/Sơn theo nguồn) + PRODUCTION_MANAGER | `reviewCutBundle()`/`reviewProductionBatch()` khi `failedQty > 0` | — |
| `QC_PASSED` | RESULT/INFO | PRODUCTION_MANAGER | Cùng 2 hàm trên khi `failedQty = 0` | — |

3 điểm đã hỏi lại người dùng trước khi code (đọc code thực tế thấy khác giả định plan gốc mục 7.5):

- **"KCS có lỗi/trả về" và "KCS đạt" KHÔNG phải 2 hành động riêng** - `reviewCutBundle()`/
  `reviewProductionBatch()` chỉ có ĐÚNG 1 nhánh code, luôn chuyển `QC_PASSED`/`QC_DONE`, không có
  trạng thái "trả về" riêng (đúng thiết kế "sửa được thì không tính lỗi" đã chốt trước đây) - chỉ
  track `failedQty`. Người dùng chốt: coi 2 dòng plan gốc là 2 nhánh của CÙNG 1 lần gọi, rẽ theo
  `failedQty>0` hay `=0` - khớp đúng code, không cần thêm hành động/route mới nào.
- **Bỏ "gộp theo PI/ngày" của `QC_PASSED`** - plan gốc muốn gộp, nhưng cơ chế dedupe hiện tại
  (`dedupeKey` + merge khi còn recipient `resolvedAt: null`) chỉ gộp "còn mở", trong khi `QC_PASSED`
  là RESULT không ai đóng - nếu không nhúng ngày vào `dedupeKey` sẽ gộp mãi mãi kể cả sang tháng
  sau; mà nhúng ngày rồi thì "count" đúng nghĩa lại cần đếm cộng dồn qua nhiều lần gọi rời rạc
  (không có sẵn 1 danh sách trong bộ nhớ để đếm như `pi.items` ở mục 16.2) - phải đọc lại `data`
  của thông báo cũ mỗi lần rồi tự +1, thêm 1 lớp phức tạp/dễ vỡ chỉ để phục vụ 1 type thuần thông
  tin. Người dùng chốt: bỏ gộp, mỗi lượt duyệt phát 1 thông báo riêng - đơn giản, an toàn hơn.
- **`packaging-issues` (thuộc dòng khác của bảng 7.5, chưa làm ở nhóm này) không có bước "nhận
  hàng"** - phát hiện khi rà code cả bảng cho có cái nhìn tổng thể trước khi chia nhóm, ghi lại ở
  đây để nhóm sau (7.5-ii, xuất vật tư/bao bì) không phải hỏi lại: người dùng đã chốt trước sẽ báo
  INFO không tự đóng, không phải ACTION_REQUIRED.

Riêng phát hiện quan trọng nhất trong lúc research: **bug `warehouseIds` sai kiểu dữ liệu ở
`PURCHASE_PROPOSAL_ITEM_RECEIVED`** (Phase 3a, mục 7.4) - đã tách ra sửa riêng ở **mục 18** (không
thuộc phạm vi 3b nhưng phát hiện lúc rà code chuẩn bị cho 3b).

### 19.2 Đã làm (BE)

- [notification-types.ts](../src/modules/notifications/notification-types.ts): 4 type mới (mục 19.1)
  + 3 interface params mới (`SteelIssueNotificationParams`, `QcSubmittedNotificationParams`,
    `QcResultNotificationParams`).
- [steel-issues.service.ts](../src/modules/steel-issues/steel-issues.service.ts): thêm
  `NotificationsService` (constructor); `create()` emit `STEEL_ISSUE_TO_PHOI` sau transaction (bỏ
  qua nhánh idempotency-replay - không emit lại); `receive()` resolve; `finishCutBundle()` emit
  `CUT_BUNDLE_TO_KCS` (cần thêm 1 query nhỏ lấy PI code vì include hiện có của `CutBundle.steelIssue`
  chỉ có field thô, không join `productionInvoice`).
- [production-batches.service.ts](../src/modules/production-batches/production-batches.service.ts):
  thêm `NotificationsService` + `Logger`; `finishProductionBatch()` emit `BATCH_TO_KCS`.
- [qc-reviews.service.ts](../src/modules/qc-reviews/qc-reviews.service.ts): thêm
  `NotificationsService` + `Logger`; helper `resolveAwaitingQc()` (dùng chung 2 nhánh cắt/lô) +
  `notifyQcResult()` (rẽ `QC_FAILED`/`QC_PASSED` theo `failedQty`, dùng chung) + `mfgStageToSenderRole()`
  (map `MfgStage.PHOI/HAN/SON` → đúng `BUSINESS_ROLES`); gọi ở `reviewCutBundle()` (tổ gửi luôn là
  Phôi) và `reviewProductionBatch()` (tổ gửi theo `batch.stage`).
- [steel-issues.module.ts](../src/modules/steel-issues/steel-issues.module.ts),
  [production-batches.module.ts](../src/modules/production-batches/production-batches.module.ts),
  [qc-reviews.module.ts](../src/modules/qc-reviews/qc-reviews.module.ts): import `NotificationsModule`.
- **Không gắn `link`** cho cả 4 type - các màn Phôi/KCS/QLSX liên quan (`XacNhanNhanSatPage`,
  `KcsPhoiPage`, `ThongKePagePlan`) chưa nối `?p=` URL-sync (mục 12.4: "chưa cần vì chưa type nào
  trỏ vào đó") - để ngoài phạm vi nhóm này, tránh lan sang việc FE không liên quan.
- Test: thêm 10 test mới (2 ở `create`/`receive` steel-issues cho `STEEL_ISSUE_TO_PHOI`, 1 ở
  `finishCutBundle` cho `CUT_BUNDLE_TO_KCS`, 1 ở `finishProductionBatch` cho `BATCH_TO_KCS`, 2+3 ở
  `reviewCutBundle`/`reviewProductionBatch` cho `QC_FAILED`/`QC_PASSED` bao gồm cả 2 nhánh HAN/SON).
- **Nghiệm thu:** `npx tsc --noEmit`: 0 lỗi. `npx eslint --fix`: 0 error, 1 warning `no-explicit-any`
  cố ý có sẵn. `npx jest` toàn repo: **1225/1225 pass, 50/50 suite** (tăng từ 1215 ở mục 17/18 - 10
  test mới).

### 19.3 Live-test thật (BE+FE+DB thật, browser thật)

Dữ liệu có sẵn trong DB dev đều đã xử lý xong hết (17 SteelIssue/19 CutBundle đều QC_PASSED, 61
ProductionBatch đều QC_DONE) - không còn dòng nào đang dở để tái dùng như nhóm 7.4 (mục 17.4). Tạo
mới qua **API thật** (không qua UI - các màn Kho/Phôi/KCS/Hàn/Sơn chưa kịp rà lại toàn bộ trong
phiên này, chỉ xác nhận qua UI ở bước ĐỌC thông báo), dùng PI có sẵn (`PI-2026-004`, id=6) đang có
`floorStage=ACTIVE` + đề xuất cắt đã `APPROVED` (còn dư 8/13 cây trong pool giữ chỗ, đủ để tạo thêm
1 `SteelIssue` nhỏ `barCount=1` mà không làm âm pool).

1. Đăng nhập thật `khopsh` (Kho phôi-son-han, role có `STEEL_ISSUE:CREATE`) → gọi thật
   `POST /production-invoices/6/steel-issues` → xác nhận `STEEL_ISSUE_TO_PHOI` tạo đúng cho `phoi`,
   `entityId` khớp SteelIssue vừa tạo. Đăng nhập UI `phoi` thật → chuông + tab "Cần xử lý" hiện đúng
   "PI-2026-004: sắt đã xuất - vào xác nhận nhận / SAT-HOP-50X50: 1 cây."
2. Gọi thật `POST /steel-issues/:id/receive` (đóng vai `phoi`) → xác nhận `resolvedAt` được set;
   UI `phoi` reload → "Cần xử lý" về rỗng.
3. Gọi thật `POST /steel-issues/:id/cut-batches` rồi `POST /cut-bundles/:id/finish` (đóng vai `phoi`)
   → xác nhận `CUT_BUNDLE_TO_KCS` tạo cho `kcs`. UI `kcs` thật (màn "Cắt sắt") hiện đúng PI có 1 đợt
   chờ kiểm + chuông hiện đúng nội dung.
4. Gọi thật `POST /cut-bundles/:id/qc-review` với `failedQty=1` (đóng vai `kcs`) → xác nhận
   `CUT_BUNDLE_TO_KCS` resolved, `QC_FAILED` fan-out đúng CẢ `phoi` (tổ gửi) lẫn `qlsx`. UI `phoi`
   thật, tab "Tất cả" (đúng - RESULT không vào "Cần xử lý") hiện đúng đầu danh sách
   "PI-2026-004: KCS chấm lỗi 1 / Kiểm tra lại, sửa hoặc báo bù đủ bằng đợt mới."; thông báo
   `STEEL_ISSUE_TO_PHOI` trước đó hiện đúng "Đã xử lý".
5. Lặp lại 1 đợt cắt mới, duyệt `failedQty=0` → xác nhận `QC_PASSED` tạo ĐÚNG 1 người nhận `qlsx`
   (không kèm `phoi`, đúng thiết kế mục 19.1).
6. Lặp lại toàn bộ chuỗi cho `ProductionBatch` (record → finish → review) ở CẢ 2 stage `HAN` (đóng
   vai `han`) và `SON` (đóng vai `son`) trên cùng PI - xác nhận `BATCH_TO_KCS` tạo đúng cho `kcs`,
   `QC_FAILED` (test ở nhánh HAN) fan-out đúng `han` + `qlsx` (`senderRole` map đúng theo
   `batch.stage`), `QC_PASSED` (test ở nhánh SON) chỉ tới `qlsx`.

**Dọn dữ liệu sau test:** xoá `qc_reviews`/`qc_review_segments`/`cut_pattern_segments`/`cut_bundles`/
`steel_issues`/`production_batches` vừa tạo; xoá `stock_ledger` (`SEGMENT_CONSUME` từ
`finishProductionBatch()` nhánh HAN có `PieceBom`) + `stock_quant` vừa phát sinh (2 dòng kho nguồn/
đích × 2 segmentSpec, đều là dòng MỚI hoàn toàn - xoá hẳn thay vì trừ ngược); trả `consumedQty` của
`StockReservation` (PI 6 + vật tư 1) về đúng `5.0000` (trước test). Xác nhận qua `psql`:
`notifications` về đúng 21 baseline, `steel_issues`/`cut_bundles`/`production_batches` về đúng
17 QC_PASSED / 19 QC_PASSED / 61 QC_DONE (y hệt trước test), `qc_reviews` về đúng 80 dòng gốc,
`stock_quant` không còn dòng nào ở (kho 3, kho 5) × (segmentSpec 1, 2).

### 19.4 Còn treo

- ~~Phase 3b còn 5 nhóm...~~ **7.5-ii ĐÃ XONG (mục 22), 7.5-iii ĐÃ XONG (mục 23).** Còn 3 nhóm:
  7.5-iv (xuất/nhận đan), 7.5-v (chuyển kiểm lỗi - thực ra tái dùng hạ tầng có sẵn của
  `production-invoices.service.ts`, không cần DI mới), 7.5-vi (đóng gói xong → Sales) - làm tiếp
  theo cùng cách.
- `weaving-issues`/`weaving-receipts` (7.5-iv) không có state machine hay FK liên kết trực tiếp giữa
  xuất và nhận (append-only, so khớp qua tổng aggregate) - "tự đóng khi nhận" sẽ cần thiết kế riêng
  (composite entityId hoặc bỏ tự đóng), chưa quyết định - để hỏi người dùng khi tới nhóm đó.
- "Đóng gói xong → Sales" (7.5-vi) không có cột "Sales phụ trách" trên `SalesOrder` (đã ghi nhận từ
  mục 15.2) - dự kiến lặp lại giải pháp cũ: báo cả role `SALES_STAFF`.
- ~~4 type nhóm này chưa có `link`...~~ **ĐÃ GẮN Ở MỤC 22.2** (nay `?p=` đã có ở `MfgApp.tsx`) -
  `STEEL_ISSUE_TO_PHOI`/`CUT_BUNDLE_TO_KCS`/`BATCH_TO_KCS` đều có `link` thật.

## 20. Dọn nốt việc nhỏ còn treo của Phase 2 — _ĐÃ XONG 2026-09-28_

Repo: `D:\DNA-ERP` (FE). Sau khi Phase 3a/3b (mục 15-19) đã đi khá xa, người dùng hỏi lại "giờ nên làm
gì tiếp" và chọn quay lại dọn nốt các việc nhỏ còn treo của Phase 2 (mục 12.4) trước khi làm tiếp
Phase 3b: sửa double-poll, và (phát sinh giữa chừng, ngoài kế hoạch) khôi phục sau 1 sự cố merge Git.

### 20.1 Sửa double-poll (mục 12.4, gạch đầu dòng 1)

- **`src/context/NotificationsContext.tsx`** (file mới): bọc hook `useNotifications()` (đổi tên nội
  bộ thành `useNotificationsState`, export type `NotificationsState = ReturnType<typeof
  useNotificationsState>`) vào 1 `NotificationsProvider` dùng `createContext`/`useContext` - mọi
  `<NotificationCenter>` (top bar + chân sidebar, kể cả khi cả 2 cùng tồn tại lúc drawer mobile bị bỏ
  mở) giờ đọc chung 1 state/1 vòng poll thay vì mỗi instance tự gọi hook riêng.
- **`src/app/layout.tsx`**: bọc `<NotificationsProvider>` quanh `children` (trong `AuditLogProvider`,
  ngoài `InspectionProvider`) - 1 nguồn poll cho toàn app, không phải riêng từng `*App.tsx`.
- **`src/components/NotificationCenter.tsx`**: đổi import từ gọi thẳng hook trong `hooks/
  useNotifications.ts` sang `useNotifications()` của context mới.
- **Kiểm tra:** `tsc --noEmit` 0 lỗi, `eslint` 0 error, `vitest run` 52/52 pass. Xác nhận bằng đọc lại
  network log lúc live-test trước đó (mục 12.4) không còn khả năng lặp lại vì chỉ còn 1 nơi gọi
  `setInterval` cho toàn cây, không phải theo từng `<NotificationCenter>` mount.

### 20.2 Sự cố merge Git làm mất lại 1 phần việc đã sửa (phát sinh ngoài kế hoạch)

Người dùng `git stash pop` trên Fork (Git GUI) để lấy lại các thay đổi đang dở, gặp conflict ở 3 file
(`AdminApp.tsx`, `SpecDetailQuotaPage.tsx`, `SpecSteelPage.tsx`) - nhánh "Updated upstream" (bản cũ,
trước khi có `NotificationCenter`/trước khi gỡ `NotifBell`) và "Stashed changes" (bản đã sửa trong
phiên làm việc). Người dùng hỏi kiểm tra giúp mức độ nghiêm trọng của 3 conflict trước khi hoàn tất
merge trong Fork.

**Phát hiện sau khi Fork hoàn tất merge:** cả 3 file bị chọn nhầm về phía "Updated upstream" (bản cũ)
thay vì giữ đúng phần đã sửa - hệ quả:
- `SpecDetailQuotaPage.tsx`/`SpecSteelPage.tsx`: `NotifBell` (đã xoá file `components/NotifBell.tsx`
  ở mục 12.1) bị import/dùng lại trong JSX → **lỗi build thật** (import trỏ tới file không tồn tại),
  không chỉ là mất công sức sửa.
- `AdminApp.tsx`: mất hẳn `NotificationCenter` (cả 2 chỗ gắn) - đồng thời file này ở nhánh upstream đã
  có thêm 1 thay đổi KHÔNG liên quan tới notification (layout compact/responsive mới, khớp 6 app shell
  còn lại) nên không thể phục hồi bằng cách lấy lại bản cũ đã sửa, phải làm lại việc gắn
  `NotificationCenter` + `?p=` URL-sync trên CHÍNH bản mới này (xem 20.3).

**Đã sửa** (phát hiện qua `grep -rn "NotifBell"` ra kết quả ngoài dự kiến, không phải người dùng chỉ
lại lần 2):
- Gỡ lại import + JSX `NotifBell` khỏi `SpecDetailQuotaPage.tsx`/`SpecSteelPage.tsx`, khôi phục đúng
  comment giải thích + cấu trúc header đơn giản như trước sự cố.
- Gắn lại `NotificationCenter` vào `AdminApp.tsx` (chi tiết ở 20.3, vì phải làm trên shape file mới).

**Kiểm tra:** `tsc --noEmit` 0 lỗi, `eslint` trên cả 7 file liên quan (3 file conflict +
`useNotifications.ts`/`NotificationsContext.tsx`/`NotificationCenter.tsx`/`layout.tsx`) 0 error - các
warning còn lại (`react-hooks/set-state-in-effect`/`exhaustive-deps` ở pattern URL-sync,
`react/no-unescaped-entities` ở `SpecSteelPage.tsx`, `onSubTabChange` unused) đều xác nhận có sẵn từ
trước (cùng lý do đã ghi ở mục 12.3/15.3), không phải lỗi mới. `vitest run` 52/52 pass (20.1).

**Bài học quy trình:** merge/stash-pop trong Git GUI vẫn cần soát lại kỹ (grep theo tên
component/file đã xoá) sau khi hoàn tất, đặc biệt khi 1 phía đã có thêm thay đổi không liên quan tới
phần đang conflict - chọn "theo cả file" dễ nuốt mất phần đã sửa dở lẫn phần mới không liên quan.

### 20.3 Thêm `?p=` URL-sync cho `AdminApp.tsx`

Nhân lúc phải làm lại `AdminApp.tsx` sau sự cố 20.2 (file đã có top bar compact mới, lần đầu tiên
AdminApp có top bar để đặt `NotificationCenter size={20}`), làm luôn phần còn thiếu theo đúng pattern
6 app shell kia (mục 12.5.B/17.3): `ADMIN_PAGE_VALUES`/`isAdminPage` type guard, `useUrlState('p')` +
`useState<AdminPage>` khởi tạo từ URL + `useEffect` đồng bộ ngược (điều hướng từ ngoài vào, vd
`NotificationCenter` gọi `router.push('/?m=admin&p=...')` trong tương lai). Gắn `NotificationCenter`
ở CẢ 2 chỗ: `color="var(--text3)"` chân sidebar (mọi màn) + `size={20}` top bar compact (màn hẹp).

Hiện **chưa có type thông báo nào trỏ tới module `admin`** (giống lý do 6 app shell kia làm trước khi
có nhu cầu thật - mục 12.4) nên phần `?p=` này là chuẩn bị hạ tầng, chưa được link nào dùng tới ngay -
nhất quán với cách làm đã chọn cho các app khác, không phải làm thừa riêng cho Admin.

**Kiểm tra:** `tsc --noEmit`/`eslint` như 20.2. Chưa live-test riêng bằng browser (không có server BE/
FE nào đang chạy sẵn ở phiên này) - độ rủi ro thấp vì cùng 1 pattern đã live-test kỹ ở
`ProductionPlanApp`/`MfgApp`/`PurchasingApp` (mục 12.3/16.4/17.4), chỉ khác tên biến/route.

### 20.4 Thêm nốt `?p=` URL-sync cho `SalesApp.tsx` (app shell cuối cùng)

Làm nốt ngay trong phiên này để cả 7/7 app shell đồng bộ URL cùng 1 pattern (trước đó 6/7 - thiếu
đúng Sales). Cùng idiom `TAB_VALUES`/`isTabId`/`useUrlState('p')`/`useEffect` đồng bộ ngược đã dùng ở
6 app kia - không có gì khác biệt vì `SalesApp.tsx` vốn đã dùng `TabId` đơn giản (3 giá trị, không
lồng nav như `AdminApp`/`ProductionPlanApp`).

**Kiểm tra:** `tsc --noEmit` 0 lỗi, `eslint` 0 error - 2 warning
`react-hooks/set-state-in-effect`/`exhaustive-deps` giống hệt pattern đã chấp nhận ở 6 app kia (không
phải lỗi mới). `vitest run` 52/52 pass.

**Live-test thật** (bật lại Docker Desktop + `dna-erp-be-postgres-1`, `nest start --watch` cổng 3001,
`next dev` cổng 3000, browser thật đăng nhập `sales`/`demo1234`): bấm "Quản lí khách hàng" trong
drawer (màn hẹp mặc định của Browser pane, đúng nhóm compact) → URL đổi đúng
`?m=sales&p=customers`; F5 (`navigate` lại đúng URL đó) → app mở thẳng đúng tab "Quản lí khách hàng"
(không rơi về "Quản lí đơn hàng" mặc định) - đúng mục tiêu mục 6.2. Console không còn lỗi (2-3 lỗi
`ERR_CONNECTION_REFUSED` thấy lúc đầu là do bấm đăng nhập trước khi BE compile xong, không liên quan
đến thay đổi này). Nhân tiện xác nhận luôn double-poll (mục 20.1) đã hết: network log chỉ thấy đúng 1
request `unread-count` mỗi lần, không lặp. Dọn dẹp: dừng cả 2 server sau khi test, không có dữ liệu
DB nào bị thay đổi (chỉ đọc, không tạo/sửa gì trong lúc test này).

### 20.5 Còn treo

- **Trang "Thông báo của tôi" riêng** (mục 12.4) - vẫn chưa làm, panel 50 dòng vẫn đang là giải pháp
  tạm. Đây là việc còn lại DUY NHẤT của Phase 2 sau mục này.
- `AdminApp.tsx` (mục 20.3) chưa live-test riêng bằng browser thật lúc viết mục đó - **đã tiện thể
  live-test được ở đợt 20.4** (đăng nhập `sales` không qua Admin, nhưng cơ chế `useUrlState` dùng
  chung 100% code với `SalesApp` nên coi như đã xác nhận gián tiếp; nếu cần chắc chắn tuyệt đối nên
  test riêng bằng tài khoản admin khi có dịp).

## 21. Trang "Thông báo của tôi" riêng — _ĐÃ XONG 2026-09-28, Phase 2 hoàn tất toàn bộ_

Việc treo cuối cùng của Phase 2 (mục 6.1, 12.4, 20.5): panel chuông giới hạn 50 dòng, không phân
trang/lọc/tìm kiếm thật. User yêu cầu "hãy thực hiện phase 2" - làm nốt đúng phần này.

### 21.1 BE: thêm lọc `search` vào `findMyNotifications()`

`ListNotificationsQueryDto` kế thừa `PaginationQueryDto` (đã sẵn field `search?: string` dùng chung
toàn repo) nhưng `findMyNotifications()` trước đó bỏ qua field này hoàn toàn - không cần thêm field
DTO mới, chỉ cần DÙNG field đã có.
[notifications.service.ts](../src/modules/notifications/notifications.service.ts): gộp điều kiện
`category` và `search` vào 1 object `notificationFilter: Prisma.NotificationWhereInput` (trước đó
`category` tự đứng 1 mình dạng `...(cond ? {notification: {...}} : {})` - nếu thêm `search` theo
đúng khuôn đó bằng 1 dòng `...(cond2 ? {notification: {...}} : {})` NỮA thì object sau ghi đè mất
object trước, chỉ còn lọc được 1 trong 2 cùng lúc). `search` lọc `title`/`message` kiểu
`contains, mode: insensitive`, tự `.trim()` và bỏ qua khi rỗng/toàn khoảng trắng.

**Test:** 3 test mới trong `findMyNotifications` (search đơn lẻ, search+category gộp đúng 1 object
không đè nhau, search toàn khoảng trắng bị bỏ qua) - `notifications.service.spec.ts` 27/27 pass.
`tsc --noEmit` 0 lỗi (2 lỗi `factoryCode`/`MfgProductWhereUniqueInput` ở 2 file `seed-*.ts` xác nhận
có sẵn từ trước bằng `git stash`, không liên quan). `eslint` trên file sửa: 0 error, 0 warning. `jest`
toàn repo: **1228/1228 pass, 50/50 suite**.

### 21.2 FE: `MyNotificationsPage.tsx` - overlay toàn màn hình, không thuộc module nào

Trang này KHÔNG phải 1 tab trong `*App.tsx` nào (mọi role, mọi module đều cần xem "thông báo của
tôi", không riêng 1 phân hệ) - làm dạng **overlay toàn màn hình mở qua query `?notif=all`**, tương
tự cách `?m=`/`?p=` đã làm nhưng KHÔNG cần đồng bộ 2 chiều (không có state cục bộ nào phải nhớ, chỉ
cần đọc trực tiếp từ URL mỗi lần render):

- **`app/page.tsx`**: `const [notifPage, setNotifPage] = useUrlState('notif')`; render
  `{notifPage === 'all' && <MyNotificationsPage onClose={() => setNotifPage(null)} />}` CHỒNG LÊN
  TRÊN `content` (không thay thế trong switch activeModule) - đóng lại (xoá `notif`) không mất
  `m`/`p` đang xem dở bên dưới; `content` vẫn mounted (giữ nguyên state/scroll của app shell) vì
  overlay chỉ che bằng CSS (`position: fixed, inset: 0, background` đặc), không unmount cây bên dưới.
- **`components/NotificationCenter.tsx`**: thêm nút "Xem tất cả" ở chân panel, gọi `router.push`
  (KHÔNG dùng `useUrlState`'s setter, luôn `replace`) để thêm `notif=all` - cố ý dùng `push` để có 1
  nấc lịch sử, nút Back đóng lại được đúng chỗ đang xem (đúng mục tiêu mục 6.2, và đúng khuyến nghị
  ghi sẵn trong doc comment `useUrlState.ts`: "nơi cần push thật... tự gọi router.push riêng").
- **`components/MyNotificationsPage.tsx`** (file mới): header (nút Back/đóng, tiêu đề, "Đọc tất cả"
  khi còn thông báo chưa đọc) + thanh lọc (tìm kiếm debounce 400ms - cùng idiom
  `GomDotCatPage.tsx`, chọn loại/category, đã đọc hay chưa, đã xử lý xong hay chưa) + danh sách +
  `Pagination` (component dùng chung, đã có sẵn trong repo) - **phân trang THẬT từ BE** (khác
  `Admin/NotificationsPage` tải hết 200 dòng rồi cắt ở FE), 20 dòng/trang. Đổi bất kỳ bộ lọc nào tự
  quay về trang 1.
- Bấm 1 dòng: đánh dấu đã đọc qua **context dùng chung** (`useNotifications()` của
  `NotificationsContext`, KHÔNG gọi thẳng service) - để badge/chuông cập nhật NGAY, không phải chờ
  tới lượt poll 30s kế tiếp (xác nhận bằng live-test bên dưới). Có `link` → điều hướng `router.push`
  (rời khỏi trang này luôn, giống panel). Không có `link` → chỉ tải lại danh sách tại chỗ (khác panel
  - panel luôn tự đóng sau khi bấm vì là dropdown thoáng qua, còn đây là 1 trang duyệt danh sách nên
  hợp lý hơn khi cho ở lại xem tiếp thay vì tự đóng).
- `services/notifications-api.ts`: `ListNotificationsParams` thêm `search?: string`, tự `.trim()` +
  bỏ qua nếu rỗng trước khi gắn vào query string (khớp hành vi BE ở 21.1).
- Đặt `zIndex: 1400` (cao hơn cả panel chuông `1200` lẫn toast `1300`) - chắc chắn phủ kín màn hình
  mọi trường hợp (vd mở lại bằng URL/bookmark khi có modal khác đang mở dở).

### 21.3 Cố ý không làm

- **Không thêm nút "Ẩn" (archive)** vào trang này dù `NotificationsState.archive()` đã có sẵn từ
  Phase 2 (mục 12.1) và chưa từng được dùng ở đâu - không nằm trong yêu cầu ban đầu (mục 6.1 chỉ nói
  "lọc theo loại, tìm kiếm, phân trang"), thêm sẽ vượt phạm vi "làm nốt Phase 2".
- **Không thêm `search` vào `NotificationCenter` panel** (vẫn giữ 50 dòng, không lọc/tìm) - đúng
  phân công vai trò 2 nơi: panel = xem nhanh việc mới/gần đây, trang riêng = tra cứu sâu/lịch sử.

### 21.4 Kết quả kiểm tra

- `tsc --noEmit` (FE): 0 lỗi. `eslint` trên `MyNotificationsPage.tsx`/`NotificationCenter.tsx`/
  `notifications-api.ts`: 0 error, 0 warning; `app/page.tsx` có 2 warning
  `react-hooks/set-state-in-effect`/`exhaustive-deps` xác nhận CÓ SẴN từ trước (không phải do thay
  đổi mục này - cùng 2 dòng đã ghi nhận từ mục 12.3).
- `vitest run`: **53/53 pass** (thêm 1 test `search` cho `getNotifications()`).
- **Live-test thật** (Docker + `nest start --watch` (3001) + `next dev` (3000), browser thật):
  - `boss`: bấm chuông → "Xem tất cả" → URL đổi đúng `?notif=all`, trang mở đúng, hiện "Chưa có
    thông báo nào" (boss hiện không có notification nào trong DB dev - đúng thực tế, không phải lỗi).
  - `qlsx` (21 notification lịch sử): trang hiện đủ 21 dòng, phân trang 2 trang (20+1) đúng theo
    `meta.total`/`meta.totalPages` từ BE. Gõ "GHEJ55" vào ô tìm - sau 400ms gọi đúng
    `search=GHEJ55`, lọc còn ĐÚNG 6 dòng có "GHEJ55" trong tiêu đề (xác nhận qua response thật, không
    phải đếm bằng mắt). Chọn "Cảnh báo" (category=ALERT) + "Chưa xử lý xong" (resolved=false) cùng
    lúc - request gộp đúng cả 2 param, không cái nào đè cái nào (xác nhận trực tiếp lỗ hổng đã sửa ở
    21.1 không tái diễn ở phía gọi thật).
  - Bấm 1 dòng chưa đọc (không có `link`) → gọi đúng `POST .../read`, dòng đó hết đậm/hết chấm xanh
    NGAY LẬP TỨC, KHÔNG điều hướng đi đâu (đúng thiết kế 21.2). Đóng trang lại (nút Back) → chuông ở
    `MfgApp` giảm đúng 19→18 (badge cập nhật NGAY, không cần đợi poll - xác nhận cơ chế dùng chung
    context hoạt động đúng).
  - Bấm "Đọc tất cả" → toàn bộ 21 dòng hết đậm, nút "Đọc tất cả" tự ẩn (hết `hasUnread`); đóng trang -
    chuông hết số đỏ (0 chưa đọc).
  - Dọn dữ liệu: `UPDATE notification_recipients SET "readAt" = NULL` cho 21 dòng vừa đánh dấu đọc,
    xác nhận lại bằng `psql` (0 dòng còn `readAt` khác NULL) VÀ bằng browser (F5 lại, bell trở về
    đúng badge "21" + toast cảnh báo bật lại đúng như lúc đầu phiên) - khôi phục đúng trạng thái
    trước khi test, không để lại rác.
- **Quan sát phụ (không phải bug):** `useFetch` bắn 2 request giống hệt nhau khi trang vừa mount -
  do `next.config.mjs` bật `reactStrictMode: true` (double-invoke effect ở dev để lộ side-effect
  không sạch), chỉ xảy ra trong dev, không xảy ra ở production build. Không phải lỗi riêng của trang
  này - poll của `NotificationsContext`/panel cũng chịu ảnh hưởng tương tự trong dev.

### 21.5 Còn treo

Không còn gì của Phase 2. Việc kế tiếp theo plan mục 8 là Phase 3b (5 nhóm còn lại của mục 7.5: xuất
vật tư/bao bì, chuyển kho, đan, chuyển kiểm, đóng gói→Sales), Phase 3c, Phase 4 (badge "việc chờ
tôi"), Phase 5 (realtime) - xem mục 19.4 cho chi tiết từng nhóm.

## 22. Phase 3b — nhóm 7.5-ii "Xuất vật tư tiêu hao/thành phẩm/bao bì" (3 sự kiện) — _ĐÃ XONG 2026-09-28_

Người dùng: *"tiếp tục từng bước phase 3, cứ hoàn thành mỗi bước là thực hiện test BE và live-test
kỹ càng... tối ưu UI UX cho người dùng chuẩn của một hệ thống ERP"*. Tiếp tục Phase 3b (7.5-i xong ở
mục 19) - nhóm kế tiếp theo bảng mục 7.5: dòng B "Xuất vật tư / vật tư định mức / bao bì" (3 service
`material-issues`, `material-yield-issues`, `packaging-issues`).

### 22.1 Phạm vi - 3 type mới

| Type | Category/Severity | Người nhận | Trigger | Tự đóng khi |
|---|---|---|---|---|
| `MATERIAL_ISSUE_TO_TEAM` | ACTION/INFO | HAN_STAFF hoặc SON_STAFF (theo `stage`) | `MaterialIssuesService.create()` | tổ nhận `receive()` |
| `MATERIAL_YIELD_ISSUE_TO_PHOI` | ACTION/INFO | PHOI_STAFF | `MaterialYieldIssuesService.create()` | Phôi `receive()` |
| `PACKAGING_ISSUE_CREATED` | INFO/INFO | PRODUCTION_MANAGER | `PackagingIssuesService.create()` | KHÔNG tự đóng |

`entityType` = `MATERIAL_ISSUE`/`MATERIAL_YIELD_ISSUE`/`PACKAGING_ISSUE` tương ứng, `entityId` = id
bản ghi. Cả 3 dùng chung 1 params interface `MaterialIssueNotificationParams { piCode, materialCode,
qty, unit, stage? }` - `unit` đọc thật từ `Material.unit` (khác `SteelIssueNotificationParams` hard
-code "cây" vì sắt luôn tính theo cây, các vật tư khác thì không).

### 22.2 Nhân tiện: gắn `link` còn thiếu cho nhóm 7.5-i (mục 19)

Lúc làm mục 19, `MfgApp.tsx` CHƯA có `?p=` URL-sync nên `STEEL_ISSUE_TO_PHOI`/`CUT_BUNDLE_TO_KCS`/
`BATCH_TO_KCS` cố ý bỏ trống `link` (mục 19.2). Nay `?p=` đã có ở mọi app shell (mục 20) - nối luôn
vào 3 type cũ đó, đúng tinh thần "tối ưu UI UX" người dùng vừa yêu cầu, không đợi thêm 1 đợt riêng:

- `STEEL_ISSUE_TO_PHOI` → `{module:'production', page:'phoi-xac-nhan-nhan-sat'}` (an toàn nối vì
  recipient CHỈ 1 role PHOI_STAFF).
- `CUT_BUNDLE_TO_KCS` → `{module:'production', page:'kcs-phoi'}` (recipient chỉ KCS_STAFF, luôn 1
  page cố định vì CutBundle luôn là Phôi).
- `BATCH_TO_KCS` → PHẢI rẽ nhánh theo `stage` (`kcs-phoi`/`kcs-han`/`kcs-son`) vì KCS xem Phôi/Hàn/Sơn
  ở 3 TAB RIÊNG trong `MfgApp.tsx` - khác `CUT_BUNDLE_TO_KCS`. Phát hiện lúc code: `ProductionBatch`
  không chỉ có stage HAN/SON như tên gọi "Hàn/Sơn báo xong 1 đợt sản xuất" ở mục 19 mô tả - **PHÔI
  cũng tạo được `ProductionBatch`** (piece tự báo qua `PieceMaterialYield`, không qua `CutBundle`/
  bin-packing, xem `ProductionBatchesService.assertMfgRoleMatchesStage()`) - nếu chỉ rẽ 2 nhánh
  HAN/SON như dự định ban đầu, batch stage=PHOI sẽ bị điều hướng NHẦM sang tab `kcs-han`. Sửa:
  `ProductionBatchesService.finishProductionBatch()` truyền thêm `stage: updated.stage` vào params;
  `notification-types.ts` rẽ đủ 3 nhánh, mặc định `kcs-phoi` khi không phải HAN/SON.
- **Vẫn KHÔNG gắn `link`** cho `QC_FAILED`/`QC_PASSED` (mục 7.3) dù kỹ thuật làm được (đọc thêm
  1-2 dòng comment mới trong `notification-types.ts` giải thích rõ) - 2 role nhận (tổ gửi + QLSX)
  cần 2 tab hành động khác nhau trong CÙNG module `production` (tổ gửi cần `phoi-lenh-sx`, QLSX
  không nằm trong điều kiện hiện tab đó ở `MfgApp.tsx` nên sẽ thấy màn trống) - đúng lớp vấn đề đã
  né ở `PI_APPROVED_BY_BOSS` (mục 16.2), chỉ khác là cùng module thay vì khác module.

### 22.3 Đã làm (BE)

- [notification-types.ts](../src/modules/notifications/notification-types.ts): 3 type mới (22.1),
  `link` cho 3 type cũ (22.2), mở rộng `QcSubmittedNotificationParams` thêm `stage?: 'PHOI'|'HAN'|'SON'`.
- [material-issues.service.ts](../src/modules/material-issues/material-issues.service.ts): thêm
  `NotificationsService`, include thêm `productionInvoiceItem.productionInvoice.code` (lấy piCode);
  `create()` emit sau transaction, `receive()` resolve.
- [material-yield-issues.service.ts](../src/modules/material-yield-issues/material-yield-issues.service.ts):
  tương tự - `create()` emit, `receive()` resolve.
- [packaging-issues.service.ts](../src/modules/packaging-issues/packaging-issues.service.ts):
  `create()` emit - KHÔNG có `resolve()` cặp đôi (không có bước nhận hàng, đã chốt trước ở mục 19.1).
- [production-batches.service.ts](../src/modules/production-batches/production-batches.service.ts):
  `finishProductionBatch()` truyền thêm `stage` vào params `BATCH_TO_KCS` (22.2).
- 3 `*.module.ts` (material-issues, material-yield-issues, packaging-issues): import `NotificationsModule`.
- Test: material-issues (+3: emit, không emit lại khi idempotency-replay, resolve), material-yield-issues
  (+2: emit, resolve), packaging-issues (+1: emit), production-batches (+2: `it.each` cho SON/PHOI,
  sửa lại test HAN có sẵn thêm field `stage`).
- **Nghiệm thu:** `npx tsc --noEmit`: 0 lỗi (2 lỗi `factoryCode` ở `seed-*.ts` xác nhận có sẵn từ
  trước bằng `git stash`). `npx eslint --fix` trên mọi file sửa: 0 error, 1 warning `no-explicit-any`
  cố ý có sẵn (như mọi lần trước). `npx jest` toàn repo: **1236/1236 pass, 50/50 suite** (tăng từ
  1228 ở mục 21 - 8 test mới).

### 22.4 Live-test thật (BE+FE+DB thật, browser thật) - đủ cả 3 type mới lẫn 3 link cũ

Docker + `nest start --watch` (3001) + `next dev` (3000). Dữ liệu BOM cho 3 loại vật tư này KHÔNG hề
tồn tại trong DB dev (`consumable_bom`/`piece_material_yield`/`bom_accessory_items` rỗng toàn bộ,
xác nhận bằng `psql` trước khi bắt đầu) - phải tự tạo 3 material test (`TEST-CO2-NOTIF`,
`TEST-VTTP-NOTIF`, `TEST-BAOBI-NOTIF2`) + dòng BOM tương ứng trên `bomRevisionId=1` (PO-TEST-REJECT-001-1,
PI-2026-004, order id=5, floorStage ACTIVE có sẵn từ mục 19.3) qua `psql` trực tiếp, cùng cách mục
15.4 đã làm cho vật tư bao bì trước đây (tạm chuyển `bom_revision.status='DRAFT'` để qua trigger
`assert_bom_revision_draft()`, insert xong trả về `ACTIVE`).

**Phát hiện giữa chừng (tự phát hiện, không phải lỗi thiết kế nhưng đáng ghi lại):** ban đầu gán cả
3 material test vào kho `vat-tu-tp` (id=2) theo đúng docstring BE ("đọc động từ Material.warehouseId"),
nhưng UI FE cho "Xuất vật tư hàn"/"Xuất vật tư TP" (`PhanPhoiNoiBoPage.tsx`, tab "Phân phối nội bộ")
chỉ hiện cho user có `warehouseScope` thuộc gia đình `phoi-son-han` - té ra nghiệp vụ THẬT của kho
này là "Kho Phôi-Sơn-Hàn cấp cả sắt LẪN vật tư tiêu hao/thành phẩm cho các tổ", không phải kho
`vat-tu-tp` như suy đoán ban đầu (kho đó chỉ dùng cho **bao bì**, đúng màn `WarehouseXuatPage.tsx`/
"Xuất theo đơn hàng"). Sửa: chuyển 2 material CO2/VTTP sang `warehouseId=3` (phoi-son-han), giữ
material bao bì ở `warehouseId=2` (vat-tu-tp) - khớp đúng 2 màn FE khác nhau đang thật sự tồn tại.

1. `khovttp` (WAREHOUSE_STAFF, scope vat-tu-tp) → "Xuất theo đơn hàng" → xuất 1 cuộn bao bì cho
   PO-TEST-REJECT-001 → xác nhận `PACKAGING_ISSUE_CREATED` tạo đúng cho `qlsx`, `link: null`,
   message "TEST-BAOBI-NOTIF2: 1 cuộn." (xác nhận qua `psql`).
2. `khopsh` (scope phoi-son-han) → "Phân phối nội bộ" → "Xuất vật tư hàn" xuất 3 bình CO2 cho HAN,
   "Xuất vật tư TP" xuất 2 thanh VTTP cho Phôi, "Xuất vật tư sơn" xuất 2 bình CO2 cho SON → xác nhận
   3 notification tạo đúng người nhận (`han`/`phoi`/`son`) qua `psql` - đặc biệt xác nhận
   `MATERIAL_ISSUE_TO_TEAM` chọn ĐÚNG role theo `stage` (HAN→`han`, SON→`son`, không lẫn).
3. `han` thật: chuông hiện đúng "PI-2026-004: vật tư đã xuất - vào xác nhận nhận / TEST-CO2-NOTIF: 3
   bình." → bấm → URL đổi đúng `?m=production&p=han-son-xac-nhan-vat-tu` → màn "Xác nhận sản lượng"
   hiện đúng dòng chờ → "Xác nhận đã nhận" → xác nhận `resolvedAt` set (qua `psql`).
4. `son` thật: lặp lại y hệt bước 3, xác nhận riêng cả 2 role đều tự resolve đúng, không lẫn
   notification của nhau.
5. `phoi` thật: chuông hiện đúng, bấm → URL đổi đúng `?m=production&p=phoi-xac-nhan-nhan-sat` → màn
   "Xác nhận nhận sắt" hiện CHUNG 1 danh sách gồm cả sắt lẫn "Vật tư TP test notif" → "Xác nhận đã
   nhận" → resolve đúng. Xác nhận GIÁN TIẾP `STEEL_ISSUE_TO_PHOI`'s `link` mới (22.2) cũng đúng vì
   CÙNG 1 trang/1 danh sách (không cần dựng riêng 1 luồng xuất sắt chỉ để test lại cơ chế điều hướng
   đã dùng chung).
6. `qlsx` thật: `PACKAGING_ISSUE_CREATED` hiện đúng ở tab "Tất cả" (KHÔNG ở "Cần xử lý" - đúng
   category INFO), bấm vào → mark-read (qua `psql`) → **URL KHÔNG đổi** (đúng vì `link: null`, đúng
   tinh thần "thà không link còn hơn link sai" - QLSX chỉ cần biết, không có việc gì để làm tiếp).
7. `BATCH_TO_KCS` (kiểm riêng, vì `create()` "báo sản lượng" đơn giản tạo thẳng `AWAITING_QC` không
   qua `finishProductionBatch()` - phải dùng đúng luồng "Lưu đợt" 2 bước `POST .../production-batches/record`
   rồi `POST .../production-batches/:id/finish`, gọi thẳng qua `fetch()` trong console với
   `access_token` thật của `han`, cùng idiom "gọi API thật" mục 16.4): tạo 1 batch HAN cho piece
   "chân bàn" → `finish()` → xác nhận qua `psql`: `link: {"page":"kcs-han","module":"production"}`
   (ĐÚNG rẽ nhánh, không lẫn `kcs-phoi`/`kcs-son`). `kcs` thật: bấm thông báo → URL đổi đúng
   `?m=production&p=kcs-han` (KHÁC tab mặc định `kcs-phoi` của KCS - xác nhận cơ chế điều hướng THẬT
   SỰ đổi tab, không phải tình cờ trùng tab đang mở) → duyệt đạt → `BATCH_TO_KCS` resolved, `QC_PASSED`
   tạo mới cho `qlsx`.

**Không live-test riêng** `CUT_BUNDLE_TO_KCS`'s `link` mới qua đúng luồng cắt sắt thật (dựng lại đủ
tiền đề bin-packing + duyệt phương án chỉ để test lại CƠ CHẾ ĐIỀU HƯỚNG đã proven đúng ở bước 3/4/7
không cân xứng) - type này dùng `link` HẰNG SỐ giống hệt `STEEL_ISSUE_TO_PHOI` (không rẽ nhánh), rủi
ro thấp.

**Dọn dữ liệu sau test:** xoá toàn bộ theo đúng thứ tự FK - `qc_reviews`/`production_batches` (2 đợt
test HAN), 6 dòng `notifications` mới (`MATERIAL_ISSUE_TO_TEAM`×2, `MATERIAL_YIELD_ISSUE_TO_PHOI`,
`PACKAGING_ISSUE_CREATED`, `BATCH_TO_KCS`, `QC_PASSED` - xác nhận trước đó cả 5 type này baseline = 0
dòng nên xoá theo `type` an toàn, không lẫn dữ liệu thật), `material_issues`/`material_yield_issues`/
`packaging_issues`, 5 dòng `transfer_check_results` vừa chèn, 3 dòng BOM test (tạm `DRAFT` lại
`bom_revision` để xoá), 8 dòng `stock_ledger` vừa phát sinh, `stock_quant` của 3 material test (xoá
hẳn vì hoàn toàn mới) + **khôi phục CỘNG/TRỪ NGƯỢC lại đúng 2 đơn vị** cho `stock_quant` của
`segmentSpecId` 1/2 (kho 3 và 5 - đây là tồn ĐOẠN SẮT THẬT, không phải test-only, bị 2 đợt
`ProductionBatch` test trừ qua `SEGMENT_CONSUME`, không thể xoá thẳng như các dòng vật tư test), 3
material test. Xác nhận lại bằng `psql`: `notifications` về đúng 21 dòng baseline, `stock_quant` của
2 segmentSpec về đúng 0/0 (baseline trước test), `bom_revision` 1 về `ACTIVE`, không còn
`transfer_check_results` nào cho item 5. Phát hiện thêm 1 dòng lệch nhỏ giữa chừng (1 notification cũ
`CUTTING_PROPOSAL_CALCULATION_FAILED` bị đánh dấu đọc ngoài ý muốn lúc thao tác trên `qlsx`) - sửa
nốt bằng `UPDATE ... readAt = NULL`, xác nhận `notification_recipients` không còn dòng nào `readAt`
khác NULL.

### 22.5 Còn treo

- ~~Phase 3b còn 4 nhóm: 7.5-iii...~~ **7.5-iii ĐÃ XONG, xem mục 23.** Còn 3 nhóm: 7.5-iv (xuất/nhận
  đan - vướng thiết kế "tự đóng" đã ghi ở mục 19.4, cần hỏi người dùng), 7.5-v (chuyển kiểm lỗi),
  7.5-vi (đóng gói xong → Sales).
- `CUT_BUNDLE_TO_KCS`'s `link` mới (22.2) chưa live-test qua đúng luồng cắt sắt thật - chỉ suy luận
  từ cùng cơ chế đã proven (mục 22.4). Nên test khi có dịp tự nhiên (1 lô cắt sắt thật đi qua Phôi→KCS
  trong lúc test việc khác).
- `BATCH_TO_KCS` stage=PHOI (piece tự báo qua `PieceMaterialYield`, không qua `CutBundle`) chưa
  live-test link `kcs-phoi` qua đúng dữ liệu PHÔI thật - chỉ có unit test (`it.each` mục 22.3) xác
  nhận `stage` truyền đúng qua `emit()`, chưa xác nhận bằng browser thật cho riêng nhánh này (đã xác
  nhận nhánh HAN/SON qua browser thật ở mục 22.4).

## 23. Phase 3b — nhóm 7.5-iii "Chuyển kho ngoài đơn hàng" (2 sự kiện) — _ĐÃ XONG 2026-09-28_

Tiếp tục Phase 3b (7.5-ii xong ở mục 22) - nhóm kế tiếp theo bảng mục 7.5: "Phiếu chuyển kho tạo" +
"Kho đích từ chối phiếu" (`warehouse-transfers.service.ts`).

### 23.1 Phạm vi - 2 type mới

| Type | Category/Severity | Người nhận | Trigger | Tự đóng khi |
|---|---|---|---|---|
| `WAREHOUSE_TRANSFER_CREATED` | ACTION/INFO | Kho ĐÍCH (`warehouseIds:[toWarehouseCode]`) | `create()` (vật tư) hoặc `createPieceTransfer()` (mảnh) | kho đích `confirm()` HOẶC `reject()` |
| `WAREHOUSE_TRANSFER_REJECTED` | RESULT/WARNING | Người TẠO phiếu (`userIds:[createdById]`) | `reject()`, kèm lý do | — |

`entityType='WAREHOUSE_TRANSFER'`, `entityId` = transferId cho cả 2. 1 params interface dùng chung
`WarehouseTransferNotificationParams { code, fromWarehouseName, itemCount, reason? }` - `itemCount`
đếm `items.length + pieceItems.length` (2 loại phiếu loại trừ nhau, 1 phiếu chỉ toàn 1 trong 2 mảng).

### 23.2 Phát hiện quan trọng nhất: `NotificationLink.params` chưa từng được đọc ở FE

`WAREHOUSE_TRANSFER_CREATED` cần trỏ vào đúng sub-tab "Nhập nội bộ" của `NhapKhoPage.tsx` - trang
này có 2 sub-tab (`nhap`/`noi-bo`) chọn bằng `useState` cục bộ, KHÔNG có URL riêng, và 2 sub-tab này
là 2 CHỨC NĂNG HOÀN TOÀN KHÁC NHAU ("Nhập kho" = nhận hàng mua về, "Nhập nội bộ" = xác nhận phiếu
chuyển kho). Chỉ trỏ `page:'nhap-kho'` sẽ luôn rơi đúng vào sub-tab MẶC ĐỊNH SAI ("Nhập kho") - đúng
lớp "gây hiểu lầm hơn không link" đã né nhiều lần trước (mục 12.6).

Đi tìm cách gắn thêm 1 tham số thì phát hiện: `NotificationLink.params?: Record<string, string |
number | null>` đã được khai báo trong type TỪ ĐẦU (mục 5.1 changelog, dùng cho mọi type suốt từ
Phase 1) nhưng **`NotificationCenter.tsx` và `MyNotificationsPage.tsx` chưa bao giờ đọc field này** -
`openNotification()` ở cả 2 nơi chỉ dựng URL từ `link.module`/`link.page`, bỏ qua hẳn `link.params`.
Không phải bug (không type nào TỪNG cần tới `params` để hoạt động đúng - mọi `link` trước giờ chỉ cần
`module`/`page`), nhưng là hạ tầng "có khai báo mà chưa ai dùng tới" - lộ ra đúng lúc cần.

**Đã sửa:**
- [utils/notificationLink.ts](../../DNA-ERP/src/utils/notificationLink.ts) (file mới): hàm thuần
  `buildNotificationLinkUrl(link)` dựng `/?m=...&p=...&<params thêm>` - gộp logic dựng URL vốn bị
  COPY-PASTE giống hệt nhau ở `NotificationCenter.tsx` và `MyNotificationsPage.tsx` thành 1 chỗ, kèm
  xử lý `params` (bỏ qua giá trị `null`, quy đổi số sang chuỗi). Có test riêng
  ([notificationLink.test.ts](../../DNA-ERP/src/utils/notificationLink.test.ts), 5 case).
- `NotificationCenter.tsx`/`MyNotificationsPage.tsx`: `openNotification()` đổi sang gọi
  `buildNotificationLinkUrl()` thay vì tự dựng `URLSearchParams` tay.
- [NhapKhoPage.tsx](../../DNA-ERP/src/modules/pages/Manufacturing/NhapKhoPage.tsx): thêm
  `useUrlState('sub')` cho sub-tab `nhap`/`noi-bo` - cùng idiom `p` ở cấp app shell, chỉ khác đây là
  sub-tab lồng bên trong 1 page đã có `p='nhap-kho'` nên phải dùng tên tham số KHÁC (`sub`, không
  phải `p`) để 2 tầng cùng tồn tại trong query string.
- `notification-types.ts`: `WAREHOUSE_TRANSFER_CREATED.link` = `{module:'inbound_warehouse',
  page:'nhap-kho', params:{sub:'noi-bo'}}` - type ĐẦU TIÊN thực sự dùng `params`.

`WAREHOUSE_TRANSFER_REJECTED` KHÔNG cần `params` - trỏ thẳng `lich-su-kho` (nơi duy nhất xem lại
phiếu REJECTED, vì "Nhập nội bộ" chỉ hiện phiếu PENDING) - tab này tự động scope theo kho của người
xem, an toàn nối vì mọi kho (vat-tu-tp/phoi-son-han/thanh-pham) đều thấy tab này.

### 23.3 Đã làm (BE)

- [notification-types.ts](../src/modules/notifications/notification-types.ts): 2 type mới, 1 params
  interface `WarehouseTransferNotificationParams`.
- [warehouse-transfers.service.ts](../src/modules/warehouse-transfers/warehouse-transfers.service.ts):
  thêm `NotificationsService`; `notifyTransferCreated()` gọi ở CUỐI CẢ `create()` LẪN
  `createPieceTransfer()` (2 nhánh tạo phiếu độc lập, cùng chung 1 loại thông báo);
  `resolveTransferCreated()` gọi ở `confirm()` VÀ ở đầu `reject()` (cả 2 đều đưa phiếu rời PENDING);
  `notifyTransferRejected()` gọi thêm ở `reject()` sau khi resolve.
- [warehouse-transfers.module.ts](../src/modules/warehouse-transfers/warehouse-transfers.module.ts):
  import `NotificationsModule`.
- Test: +7 (`create`: emit đúng params + không emit lại khi idempotency-replay; `createPieceTransfer`:
  emit đúng itemCount từ `pieceItems`; `confirm`: resolve; `reject`: resolve + emit kèm lý do đúng
  người tạo).
- **Nghiệm thu:** `npx tsc --noEmit`: 0 lỗi (2 lỗi `factoryCode` ở `seed-*.ts` xác nhận có sẵn từ
  trước). `npx eslint --fix`: 0 error, 1 warning `no-explicit-any` cố ý có sẵn. `npx jest` toàn repo:
  **1241/1241 pass, 50/50 suite** (tăng từ 1236 ở mục 22 - đúng 5 test service mới, KHÔNG phải 7 vì 2
  test ban đầu viết dạng `expect.objectContaining` lồng nhau bị ESLint chặn `no-unsafe-assignment` -
  viết lại 1 test bằng cách đọc thẳng `mock.calls[0]` thay vì lồng matcher, giảm còn 1 assertion gọn
  hơn cho case đó).
- FE: `tsc --noEmit` 0 lỗi, `eslint --fix` trên mọi file sửa 0 error (2 warning
  `react-hooks/set-state-in-effect`/`exhaustive-deps` ở `NhapKhoPage.tsx` - cùng pattern đã chấp nhận
  ở mọi nơi khác dùng `useUrlState` cho sub-tab). `vitest run`: **58/58 pass** (+5 test
  `notificationLink.test.ts`).

### 23.4 Live-test thật (BE+FE+DB thật, browser thật)

Dữ liệu thật trong DB dev không dùng được: vật tư sắt duy nhất còn tồn ở kho Phôi Sơn Hàn
(`SAT-HOP-50X50`) nằm ở bucket chiều dài 6000mm ≠ 0, mà `create()` CHẶN CỨNG chuyển kho tự do cho vật
tư có tồn ở bucket khác 0 ("chuyển kho nội bộ chưa hỗ trợ chọn cỡ cây") - phải tạo 1 material test
(`TEST-CHUYENKHO-NOTIF`) + `stock_quant` bucket 0 qua `psql`, cùng cách các nhóm trước.

**Phát hiện giữa chừng (tự phát hiện):** định gán material test vào kho Phôi Sơn Hàn rồi test
`khopsh` tạo phiếu - té ra tab "Chuyển kho ngoài đơn hàng" (`ChuyenKhoTuDoPage.tsx`) CHỈ hiện cho
scope `vat-tu-tp`/`thanh-pham` trong `InboundWarehouseApp.tsx` (`ALL_TABS.filter`), KHÔNG hiện cho
`phoi-son-han` - nghiệp vụ thật là Phôi Sơn Hàn chỉ phân phối ra ngoài qua 3 màn riêng ("Phân phối
nội bộ", đã làm ở mục 22), không có "chuyển kho tự do". Sửa: chuyển material test sang kho
`vat-tu-tp`, test đúng luồng `vat-tu-tp → thanh-pham`.

1. `khovttp` (scope vat-tu-tp) → "Chuyển kho ngoài đơn hàng" → chọn kho đích "Kho thành phẩm", vật tư
   test, số lượng 5 → 201 Created → xác nhận qua `psql`: `WAREHOUSE_TRANSFER_CREATED` tạo cho ĐÚNG 2
   user scope `thanh-pham` (`khotp`, `muatp`), `link.params.sub = "noi-bo"`.
2. `khotp` thật: chuông (chân sidebar drawer - `InboundWarehouseApp` không có bản top bar compact
   như `MfgApp`) hiện đúng "Phiếu CK-2026-025 chờ xác nhận nhận hàng / Từ Kho Vật tư thành phẩm: 1
   dòng." → bấm → **URL đổi đúng `?m=inbound_warehouse&p=nhap-kho&sub=noi-bo`** (xác nhận trực tiếp
   `buildNotificationLinkUrl()` forward đúng `params`) → trang "Nhập kho" mở ĐÚNG sub-tab "Nhập nội
   bộ" ngay lần đầu (không phải sub-tab mặc định sai) → thấy đúng phiếu CK-2026-025.
3. Bấm "Từ chối" kèm lý do "Sai vat tu, test notification" → 201 Created → xác nhận qua `psql`: CẢ 2
   `WAREHOUSE_TRANSFER_CREATED` resolved, `WAREHOUSE_TRANSFER_REJECTED` tạo đúng cho `khovttp`
   (người tạo, KHÔNG phải `khotp`/`muatp`), đúng lý do, `link:{module:'inbound_warehouse',
   page:'lich-su-kho'}` (không có `params`).
4. `khovttp` thật: chuông tab "Tất cả" (đúng - RESULT không vào "Cần xử lý") hiện đúng "Phiếu
   CK-2026-025 bị từ chối / Lý do: Sai vat tu, test notification" → bấm → URL đổi đúng
   `?m=inbound_warehouse&p=lich-su-kho` → trang "Lịch sử kho" mở đúng, tự scope theo "Kho Vật tư
   thành phẩm" của người xem.
5. Xác nhận tồn kho KHÔNG đổi sau khi từ chối (`reject()` không ghi `stock_ledger`, khác `confirm()`)
   - "Tồn 20, Khả dụng 20" của material test vẫn nguyên vẹn lúc xem lại "Tổng hợp vật tư".

**Dọn dữ liệu sau test:** xoá 2 dòng `notifications` (`WAREHOUSE_TRANSFER_CREATED`,
`WAREHOUSE_TRANSFER_REJECTED` - cascade xoá `notification_recipients`), `warehouse_transfer_reservations`/
`warehouse_transfer_items`/`warehouse_transfers` của phiếu CK-2026-025 (id=25), `stock_quant` + vật
tư test. Xác nhận qua `psql`: `notifications` về đúng 21 dòng baseline, 0 dòng `readAt` khác NULL,
material/phiếu test không còn tồn tại.

### 23.5 Còn treo

- ~~Phase 3b còn 3 nhóm: 7.5-iv, 7.5-v, 7.5-vi.~~ **7.5-v ĐÃ XONG, xem mục 24.** Còn 2 nhóm: 7.5-iv
  (xuất/nhận đan), 7.5-vi (đóng gói xong → Sales).
- `createPieceTransfer()`'s `WAREHOUSE_TRANSFER_CREATED` (phiếu mảnh, không phải vật tư) chưa
  live-test qua đúng luồng thật - chỉ có unit test (mục 23.3). Luồng thật cần dữ liệu
  `ProductionBatch QC_DONE` sẵn sàng chuyển, không dựng riêng trong đợt này vì cơ chế emit hệt như
  nhánh `create()` đã live-test kỹ ở trên, chỉ khác nguồn đếm `itemCount`.
- `buildNotificationLinkUrl()` mới fix cho ĐÚNG 1 type dùng `params` (`WAREHOUSE_TRANSFER_CREATED`) -
  các type khác chưa cần nhưng cơ chế đã sẵn sàng dùng ngay khi cần (vd nếu sau này muốn deep-link
  sâu hơn tới đúng dòng SKU/PI cụ thể thay vì chỉ đúng màn, xem còn treo mục 15.5).

## 24. Phase 3b — nhóm 7.5-v "Chuyền kiểm có lỗi" (1 sự kiện) — _ĐÃ XONG 2026-09-28_

Tiếp tục Phase 3b (7.5-iii xong ở mục 23) - nhảy sang 7.5-v thay vì 7.5-iv theo đúng thứ tự vì 7.5-iv
"xuất/nhận đan" còn vướng 1 điểm thiết kế cần hỏi người dùng trước (mục 19.4/23.5), còn 7.5-v không
vướng gì và đúng như dự đoán ở mục 18/19.1: tái dùng `NotificationsService` đã có sẵn ở
`ProductionInvoicesService` (Phase 3a, mục 16), không cần import `NotificationsModule` mới.

### 24.1 Phạm vi - 1 type mới

| Type | Category/Severity | Người nhận | Trigger | Tự đóng khi |
|---|---|---|---|---|
| `TRANSFER_CHECK_DEFECT_FOUND` | RESULT/WARNING | QLSX | `ProductionInvoicesService.recordTransferCheck()` khi `dto.defects.length > 0` | — |

`entityType='TRANSFER_CHECK_RESULT'`, `entityId` = id bản ghi `TransferCheckResult` vừa tạo (trước
đây service KHÔNG capture kết quả `create()`, phải sửa `await this.prisma.transferCheckResult.create(...)`
thành `const created = await ...` mới lấy được `created.id`).

### 24.2 Quyết định thiết kế đáng chú ý - vì sao KHÔNG báo "tổ gửi" như nhóm 7.5-i

Bảng kế hoạch gốc mục 7.5 chỉ ghi nhận QLSX là người nhận cho sự kiện này (khác `QC_FAILED` ở nhóm
7.5-i báo CẢ tổ gửi lẫn QLSX). Đọc kỹ `recordTransferCheck()` xác nhận đây là lựa chọn ĐÚNG chứ không
phải bỏ sót: **`TransferCheckResult` không có FK nào xác định chắc chắn tổ nào (Phôi/Hàn/Sơn) đã làm
ra mảnh đang bị kiểm** - khác `CutBundle`/`ProductionBatch` (nhóm 7.5-i) vốn có sẵn `stage`/nguồn
gốc rõ ràng ngay trên bản ghi. Mảnh "có đan" (`bomPiece.isWoven`) đến từ điểm đan ngoài
(`WeavingReceipt.weavingPointId`, không phải Phôi/Hàn/Sơn); mảnh "không đan" đến qua 1 phiếu chuyển
kho đã CONFIRMED (không giữ vết ai là người sản xuất gốc). Suy qua `bomPiece.needsHan`/`needsSon` chỉ
cho biết "công đoạn cuối cùng LẼ RA phải là gì" (dữ liệu định mức), không phải "ai thực sự đã báo
sản lượng lô này" (dữ liệu vận hành) - 2 việc khác nhau, suy diễn từ cái đầu ra cái sau là suy đoán
không đủ tin cậy để chỉ đích danh 1 tổ nhận cảnh báo lỗi.

Không có `link` - màn "Chuyền kiểm" (`KhoChuyenKiemPage.tsx`) thuộc module `inbound_warehouse` (thủ
kho thao tác), QLSX không có tab này trong module `production` của mình.

### 24.3 Đã làm (BE)

- [notification-types.ts](../src/modules/notifications/notification-types.ts): 1 type mới, 1 params
  interface `TransferCheckDefectNotificationParams { piCode, pieceName, defectCount, reason }` -
  `reason` chỉ lấy lỗi ĐẦU TIÊN trong lần kiểm (đủ cho QLSX biết sơ bộ, không liệt kê hết mọi lý do
  nếu 1 lần kiểm có nhiều defect khác lý do nhau); message thêm "(và N lỗi khác)" khi `defectCount > 1`.
- [production-invoices.service.ts](../src/modules/production-invoices/production-invoices.service.ts):
  thêm helper `notifyTransferCheckDefect()` (best-effort, cùng idiom `notifyPi()` có sẵn - không mở
  transaction riêng nên chỉ là 1 lệnh gọi thêm sau `create()`, không có gì để "cứu" nếu lỗi);
  `recordTransferCheck()` capture `created` từ `transferCheckResult.create()` (trước đó bỏ qua kết
  quả), gọi notify SAU KHI đã có `result.pieceName` từ `listTransferCheckPieces()` (tái dùng, không
  query thêm) - CHỈ khi `dto.defects?.length > 0`.
- Không sửa `production-invoices.module.ts` - `NotificationsModule` đã import từ Phase 3a (mục 16).
- Test: +2 (emit đúng piCode/pieceName/defectCount/reason khi có defects; KHÔNG emit khi kiểm không
  lỗi) trong `describe('recordTransferCheck')`. Sửa 1 test cũ ("creates a new check row...") thêm
  `prisma.transferCheckResult.create.mockResolvedValue({ id: 100n })` - trước đó mock trả về
  `undefined`, sẽ crash ngay khi code đọc `created.id`.
- **Nghiệm thu:** `npx tsc --noEmit`: 0 lỗi. `npx eslint --fix`: 0 error, 1 warning `no-explicit-any`
  cố ý có sẵn. `npx jest` toàn repo: **1243/1243 pass, 50/50 suite** (tăng từ 1241 ở mục 23 - đúng 2
  test mới).

### 24.4 Live-test thật (BE+FE+DB thật, browser thật)

Dữ liệu thật trong DB dev cho "Chuyền kiểm" đều đã kiểm hết (mọi mảnh của PI-2026-001 có
Hiện có = Đã kiểm = Tổng cần) hoặc chưa có hàng về (`Hiện có = 0` cho PI-2026-004, order id=5 - PI
test quen thuộc từ các nhóm trước, chưa từng có phiếu chuyển mảnh nào tới "Kho thành phẩm"). Chèn
tay 1 phiếu `warehouse_transfers` CONFIRMED + 1 `warehouse_transfer_piece_items` (order 5, piece 1
"chân bàn", qty 5) qua `psql` để có "Hiện có" > 0 cho piece đó - mô phỏng đúng kết quả của 1 chuỗi
chuyển kho thật (vat-tu-tp → thanh-pham) đã CONFIRMED, không dựng lại toàn bộ chuỗi 2 chặng vì mục
tiêu test là `recordTransferCheck()`+notification, không phải lại cơ chế piece-transfer đã test kỹ ở
mục 23.

1. `khotp` (scope thanh-pham) thật → "Chuyền kiểm" → PO-TEST-REJECT-001/PI-2026-004 → "chân bàn"
   hiện đúng "Hiện có: 5" → bấm "Kiểm" → nhập số lượng 5 + 1 lỗi "Chan ban bi cong venh test
   notification" → Xác nhận → 201 Created → xác nhận qua `psql`: `TRANSFER_CHECK_DEFECT_FOUND` tạo
   đúng cho `qlsx`, title "PI-2026-004: chân bàn chuyền kiểm có lỗi", message đúng lý do + dấu chấm,
   `link: null`.
2. `qlsx` thật: chuông tab "Tất cả" (đúng - RESULT không vào "Cần xử lý") hiện đúng thông báo ở đầu
   danh sách → bấm vào → mark-read (xác nhận qua `psql`) → **URL KHÔNG đổi** (đúng vì `link: null`).

**Không live-test riêng nhánh "không có lỗi"** (không emit gì) - đã có 2 unit test riêng biệt xác
nhận rõ ràng (mục 24.3: 1 test có defects → emit, 1 test không defects → không emit), cùng mức độ
rủi ro thấp như các nhánh "không emit" đã bỏ qua live-test ở những nhóm trước.

**Dọn dữ liệu sau test:** xoá `notifications` (`TRANSFER_CHECK_DEFECT_FOUND`), `transfer_check_defects`
+ `transfer_check_results` vừa tạo, `warehouse_transfer_piece_items` + `warehouse_transfers` (phiếu
test chèn tay) - dùng `code` KHÔNG khớp mẫu `CK-{year}-NNN` (`TEST-CHUYENKIEM-001`) để tránh ảnh
hưởng bộ đếm `nextTransferCode()` của phiếu thật. Xác nhận qua `psql`: `notifications` về đúng 21
dòng baseline, 0 dòng `readAt` khác NULL, không còn `transfer_check_results` nào cho item test.

### 24.5 Còn treo

~~Phase 3b còn 2 nhóm: 7.5-iv..., 7.5-vi...~~ **7.5-vi ĐÃ XONG, xem mục 25.** Còn đúng 1 nhóm: 7.5-iv
(xuất/nhận đan - vướng thiết kế "tự đóng" đã ghi ở mục 19.4/23.5, cần hỏi người dùng trước khi làm).

## 25. Phase 3b — nhóm 7.5-vi "Đóng gói xong → Sales" (1 sự kiện) — _ĐÃ XONG 2026-09-28_

Tiếp tục Phase 3b (7.5-v xong ở mục 24) - làm nốt 7.5-vi (không vướng thiết kế gì, cùng service
`ProductionInvoicesService` đã có `NotificationsService` sẵn). Phase 3b sau mục này chỉ còn 7.5-iv
(xuất/nhận đan) - vướng 1 điểm thiết kế "tự đóng" đã ghi ở mục 19.4/23.5, cần hỏi người dùng (làm ở
mục 26 ngay sau đây).

### 25.1 Phạm vi - 1 type mới

| Type | Category/Severity | Người nhận | Trigger | Tự đóng khi |
|---|---|---|---|---|
| `PI_ITEM_PACKAGING_COMPLETE` | RESULT/SUCCESS | Role `SALES_STAFF` | `ProductionInvoicesService.recordPackaging()` khi `packedQty` vừa đạt đúng `totalQty` VÀ item có gắn `salesOrderId` | — |

`entityType='PRODUCTION_INVOICE_ITEM'`, `entityId` = id item. Recipient là CẢ role `SALES_STAFF`
(không định danh 1 người) - cùng lý do đã ghi ở mục 15.2: `SalesOrder` không có cột "người phụ
trách"/người tạo, không nhắm được đích danh 1 Sales cụ thể.

### 25.2 Quyết định thiết kế đáng chú ý

- **Tự nhiên chỉ bắn ĐÚNG 1 LẦN cho mỗi item, không cần dedupe/guard thêm:** `recordPackaging()` đã
  chặn cứng `packedSoFar + dto.boxesPacked > productionOrder.quantity` (400) TỪ TRƯỚC - một khi
  `packedQty` đã đạt `totalQty`, mọi lần gọi tiếp theo (DTO bắt buộc `boxesPacked >= 1`) đều rơi vào
  nhánh chặn này, không bao giờ chạm lại điều kiện `=== totalQty` lần thứ 2. Khác các nhóm trước
  (`QC_PASSED`, `PURCHASE_PROPOSAL_PURCHASED`...) không cần disqualify thêm gì.
- **Guard `item.salesOrder` (không chỉ `salesOrderId`):** dùng thẳng field include sẵn có
  (`findItemOrThrow()` đã include `salesOrder`) thay vì query lại - đồng thời đây chính là field
  cần đọc `orderCode` cho message, nên guard bằng field này tự nhiên loại luôn case chưa gắn đơn
  hàng (SKU tạo tay qua `POST /production-invoices/:id/items`, xem mục 15.1) mà không cần thêm điều
  kiện `salesOrderId != null` riêng.
- **`link` trỏ `sales/orders`** (`OrderManagementPage.tsx`) - an toàn nối vì recipient CHỈ 1 role
  `SALES_STAFF`, không lẫn role khác cần tab riêng (khác ca `PI_APPROVED_BY_BOSS`/mục 16.2 phải bỏ
  `link` vì 2 role 2 module).

### 25.3 Đã làm (BE)

- [notification-types.ts](../src/modules/notifications/notification-types.ts): 1 type mới, 1 params
  interface `PackagingCompleteNotificationParams { piCode, factoryCode, productName, salesOrderCode }`.
- [production-invoices.service.ts](../src/modules/production-invoices/production-invoices.service.ts):
  thêm helper `notifyPackagingComplete()` (best-effort, cùng idiom `notifyTransferCheckDefect()` mục
  24 - không mở transaction riêng); `recordPackaging()` gọi notify SAU `packagingRecord.create()`,
  điều kiện `packedSoFar + dto.boxesPacked === productionOrder.quantity && item.salesOrder`.
- Không sửa `production-invoices.module.ts` - `NotificationsModule` đã import từ Phase 3a.
- Test: +3 (emit khi đóng đủ + có đơn hàng; KHÔNG emit khi đóng chưa đủ; KHÔNG emit khi đóng đủ
  nhưng không gắn đơn hàng) trong `describe('recordPackaging')`.
- **Nghiệm thu:** `npx tsc --noEmit`: 0 lỗi (đã kiểm KHÔNG lọc nhầm lỗi mới qua từ khoá `factoryCode`
  trùng với 2 lỗi pre-existing ở `seed-*.ts` - chạy lại không filter để chắc chắn). `npx eslint --fix`:
  0 error, 1 warning `no-explicit-any` cố ý có sẵn. `npx jest` toàn repo: **1246/1246 pass, 50/50
  suite** (tăng từ 1243 ở mục 24 - đúng 3 test mới).

### 25.4 Live-test thật (BE+FE+DB thật, browser thật)

Dùng đúng PI test quen thuộc (PO-TEST-REJECT-001/PI-2026-004, order id=5, item id=5,
`salesOrderId` đã gắn sẵn = TEST6/PO-TEST-REJECT-001) - `totalQty=10, packedQty=0` (chưa đóng gói
lần nào), không cần chèn dữ liệu test nào thêm (khác các nhóm trước) vì đây là dữ liệu SKU/PI có sẵn
đã có `salesOrderId` từ khi tạo.

1. `khotp` (scope thanh-pham) thật → "Đóng gói" → PO-TEST-REJECT-001/PI-2026-004 → nhập 10 thùng
   (đúng bằng "Còn lại") → Xác nhận → 201 Created → xác nhận qua `psql`: `PI_ITEM_PACKAGING_COMPLETE`
   tạo đúng cho role `SALES_STAFF` (user `sales`), title "PI-2026-004: BAN-J55 đã đóng gói xong",
   message "Đơn PO-TEST-REJECT-001 sẵn sàng giao.", `link:{module:'sales',page:'orders'}`.
2. `sales` thật, đứng ở tab khác (`?m=sales&p=customers`) → chuông tab "Tất cả" (đúng - RESULT
   không vào "Cần xử lý") hiện đúng thông báo (icon ✓ xanh, đúng SUCCESS) → bấm vào → mark-read (xác
   nhận qua `psql`) → **URL đổi đúng `?m=sales&p=orders`** (đổi tab thật, không phải tình cờ trùng
   tab đang mở - xác nhận cơ chế điều hướng hoạt động đúng).

**Dọn dữ liệu sau test:** xoá `notifications` (`PI_ITEM_PACKAGING_COMPLETE`), `packaging_records`
vừa tạo. Xác nhận qua `psql`: `notifications` về đúng 21 dòng baseline, 0 dòng `readAt` khác NULL,
`packaging_records` của item 5 về đúng 0 dòng (baseline trước test).

### 25.5 Còn treo — _ĐÃ XONG ở mục 26_

~~Phase 3b còn đúng 1 nhóm: **7.5-iv (xuất/nhận đan)** - vướng thiết kế "tự đóng" (đã ghi ở mục
19.4/23.5): `weaving-issues`/`weaving-receipts` không có state machine hay FK liên kết trực tiếp
giữa xuất và nhận (append-only, so khớp qua tổng aggregate) nên "tự đóng khi nhận" cần thiết kế
riêng (composite entityId hoặc bỏ tự đóng) - cần hỏi người dùng trước khi code, chưa tự quyết được
như các nhóm trước.~~ Đã hỏi + người dùng chốt + code xong ở **mục 26** - Phase 3b hoàn tất toàn bộ.

## 26. Phase 3b — nhóm 7.5-iv "Xuất/nhận đan" (1 sự kiện) — _ĐÃ XONG 2026-09-28, PHASE 3B HOÀN TẤT TOÀN BỘ_

Nhóm cuối cùng còn treo của Phase 3b (đã ghi vướng mắc ở mục 19.4/23.5/25.5) - `WeavingIssue`/
`WeavingReceipt` là 2 sổ cộng dồn thuần (append-only ledger), không có state machine hay FK nối 1
lần xuất đan với đúng 1 lần nhận đan như `SteelIssue`, nên "tự đóng khi nhận" cần 1 quyết định thiết
kế riêng trước khi code - đã hỏi người dùng (bằng ngôn ngữ non-tech, theo yêu cầu) và được chốt
"làm đi" trước khi code phần này.

### 26.1 Phạm vi - 1 type mới

| Type | Category/Severity | Người nhận | Trigger | Tự đóng khi |
|---|---|---|---|---|
| `WEAVING_ISSUE_TO_POINT` | ACTION/INFO | Mọi thủ kho thuộc gia đình kho `thanh-pham` (không định danh 1 kho vật lý) | `WeavingIssuesService.create()` (kho vật tư-TP xuất mảnh cho 1 điểm đan) | Tổng đang treo tại ĐÚNG điểm đan đó về đúng 0 (`WeavingIssuesService.receive()`) |

`entityType = 'WEAVING_ALLOCATION'`, `entityId` là khoá GHÉP
`${productionOrderId}:${pieceId}:${weavingPointId}` (không phải id 1 dòng `WeavingIssue`/
`WeavingReceipt`) - mirror đúng `PI_SENT_TO_QLSX` (mục 16.2): dedupe theo tổng đang chờ, tự đóng
khi tổng về đúng 0, không phải state machine 1-1.

### 26.2 Quyết định thiết kế đáng chú ý

- **Mirror `PI_SENT_TO_QLSX` thay vì bịa state machine mới:** research trước khi code (đọc
  `weaving-issues.service.ts` đầy đủ + hỏi ý kiến "theo bạn nên làm sao mới chuẩn ERP") cho thấy các
  ERP thật (Odoo/SAP/NetSuite) mô hình hoá gia công ngoài kiểu này bằng 1 "đơn gia công" có trạng
  thái + số dư suy ra, nhưng DNA-ERP chỉ có đúng phần "số dư suy ra" (2 bảng ledger), không có "đơn"
  nào để gắn trạng thái - nên cách khả thi nhất là tái dùng ĐÚNG pattern `PI_SENT_TO_QLSX` đã chứng
  minh hoạt động tốt (entityId ghép + dedupe theo tổng + tự đóng khi về 0), không tạo thêm bảng/field
  mới nào.
- **Chỉ `emit()` ở `create()` (xuất đan - thêm hàng vào "hàng đợi chờ nhận"), CHỈ `resolve()` ở
  `receive()` (nhận đan) - KHÔNG re-emit số đã giảm khi nhận MỘT PHẦN:** giữ nguyên hạn chế đã được
  người dùng chấp nhận ở mục 16.2 ("không giảm số hiển thị khi xử lý một phần, chỉ tự đóng khi giải
  quyết dứt điểm"). `outstandingQty` hiển thị luôn là số tại thời điểm XUẤT gần nhất, không tự cập
  nhật giảm dần theo từng lần nhận nhỏ giọt.
- **Recipient KHÔNG nhắm 1 kho vật lý cụ thể như `WAREHOUSE_TRANSFER_CREATED` (mục 23):**
  `WarehouseTransfer` có cột `toWarehouseId` do người tạo phiếu CHỌN TAY, nhưng `WeavingIssue`/
  `WeavingReceipt` không lưu warehouseId nào cả (chỉ `productionOrderId`/`pieceId`/`weavingPointId` -
  xem model trong `schema.prisma`) - không có cách nào biết "kho thành phẩm nào cụ thể" sẽ nhận về
  nếu có nhiều kho vật lý cùng gia đình `thanh-pham` (kho gốc + kho phụ `-N` do Admin tạo thêm, xem
  `warehouseFamilyOf()`). Giải pháp: báo CẢ GIA ĐÌNH - `resolveThanhPhamWarehouseCodes()` tự query
  mọi `Warehouse.code` khớp gia đình `thanh-pham` (kể cả kho phụ nếu có) rồi truyền vào
  `recipients.warehouseIds`, KHÔNG dùng `roles: [WAREHOUSE_STAFF]` (role đó dùng CHUNG cho thủ kho
  của CẢ 3 gia đình kho, quá rộng - sẽ báo nhầm cả thủ kho `vat-tu-tp`/`phoi-son-han`).
- **`link` trỏ đúng tab `nhap-dan`** (`{ module: 'inbound_warehouse', page: 'nhap-dan' }`) - khớp
  thẳng `TabId` của "Theo dõi nhập đan" trong `InboundWarehouseApp.tsx` (lọc hiện theo
  `isThanhPhamScope(scope)`), không cần `link.params` phụ như `WAREHOUSE_TRANSFER_CREATED` vì đây là
  1 tab riêng, không phải sub-tab chung màn với chức năng khác.

### 26.3 Đã làm (BE)

- [notification-types.ts](../src/modules/notifications/notification-types.ts): thêm
  `WeavingIssueNotificationParams` + type `WEAVING_ISSUE_TO_POINT`.
- [weaving-issues.service.ts](../src/modules/weaving-issues/weaving-issues.service.ts): DI thêm
  `NotificationsService` + `Logger` (module này trước đây CHƯA từng có `NotificationsService`, khác
  mọi nhóm 7.5 trước). Thêm `notifyWeavingIssueToPoint()`/`resolveWeavingIssueToPoint()` (best-effort
  ngoài transaction, cùng idiom mọi nhóm trước) + 3 helper dùng chung
  (`weavingAllocationEntityId()`, `recomputeOutstandingAtPoint()` tái dùng đúng
  `sumIssuedForPoint()`/`sumReceivedForPoint()` sẵn có, `resolveThanhPhamWarehouseCodes()`). Gọi
  `notify` ngay sau transaction của `create()`, gọi `resolve` ngay sau transaction của `receive()`.
- [weaving-issues.module.ts](../src/modules/weaving-issues/weaving-issues.module.ts): thêm import
  `NotificationsModule`.
- Test: +5 test case mới trong
  [weaving-issues.service.spec.ts](../src/modules/weaving-issues/weaving-issues.service.spec.ts)
  (emit đúng entityId/dedupeKey/outstandingQty, không emit lại khi idempotent replay, resolve khi về
  đúng 0, không resolve khi mới nhận một phần, không resolve lại khi idempotent replay) - dùng
  `mockResolvedValueOnce` nối tiếp để mô phỏng đúng thực tế "query lại SAU KHI transaction đã commit
  thấy được dòng vừa tạo" (khác `sumIssuedForPiece`/`sumReceivedForPoint` gọi TRONG transaction).
- Kết quả: suite này 57/57 (từ 52), toàn bộ backend **1251/1251 test, 50/50 suite** (từ 1246).
  `tsc --noEmit`: 0 lỗi mới (giữ nguyên 2 lỗi cũ ở seed script, không liên quan). `eslint --fix`: 0
  lỗi (1 warning cũ `no-explicit-any` ở `NOTIFICATION_TYPES`, không liên quan thay đổi này).

### 26.4 Live-test thật (BE+FE+DB thật, browser thật)

Chuẩn bị dữ liệu (order test cũ id=5 không có mảnh đan nào trong BOM, phải tìm order khác):
production order **id=8** (`PO-GHEJ55-SOLO-TEST-1`, `bomRevisionId=13`) có mảnh `KHUNG-TUA`
(id=73, `isWoven=true`, `qtyPerUnit=3` → `plannedQty=90`). QLSX (`qlsx`) bấm "Bắt đầu" THẬT qua
`POST /production-orders/8/floor-start` (mở gate). Seed thẳng 1 `WarehouseTransferPieceItem`
CONFIRMED (30 mảnh, kho `vat-tu-tp`) đại diện "kho vật tư-TP đã nhận đủ mảnh từ Phân phối nội bộ" -
đây là 1 bước THUỘC nhóm 7.5-iii đã test kỹ riêng ở mục 23, không thuộc phạm vi nhóm này nên seed
thẳng DB cho nhanh thay vì dựng lại cả chuỗi Phôi cắt → QC → chuyển kho. Tạo 1 điểm đan thật qua
`POST /weaving-points` (`khovttp`).

- **Xuất đan thật:** `khovttp` (warehouseScope=`vat-tu-tp`) gọi thật
  `POST /production-orders/8/weaving-issues` (`pieceId=73, weavingPointId=1, qty=10`) → 201.
  Kiểm `psql`: notification tạo đúng `entityId='8:73:1'`,
  `dedupeKey='WEAVING_ISSUE_TO_POINT:8:73:1'`, `link={module:'inbound_warehouse',page:'nhap-dan'}`,
  title *"PO-GHEJ55-SOLO-TEST-1: Khung tựa đang chờ nhận về từ điểm đan..."*, message
  *"Đang treo: 10."* - đúng cả 2 recipient là MỌI user `warehouseScope='thanh-pham'` hiện có
  (`khotp` VÀ `muatp`, không chỉ 1 role hẹp) - đúng thiết kế "cả gia đình kho", không phải 1 kho cụ
  thể.
- **FE thật (browser, đăng nhập `khotp`):** chuông hiện badge đỏ "1" → mở panel, tab "Cần xử lý (1)"
  hiện đúng nội dung → bấm vào, điều hướng đúng `?m=inbound_warehouse&p=nhap-dan` (tab "Theo dõi
  nhập đan" active) - đồng thời `readAt` của `khotp` được set ngay (kiểm `psql`: `muatp` vẫn NULL -
  đúng per-recipient, không lẫn giữa 2 người cùng nhận).
- **Nhận đan thật:** `khotp` gọi thật `POST /production-orders/8/weaving-receipts`
  (`pieceId=73, weavingPointId=1, qty=10` - đúng bằng outstanding) → 201. Kiểm `psql`: CẢ 2 recipient
  (`khotp`, `muatp`) có `resolvedAt` ngay lập tức, đúng thời điểm gọi API - tự đóng hoạt động chính
  xác khi outstanding về đúng 0.

**Dọn dữ liệu sau test:** xoá `notifications`+`notification_recipients` (`WEAVING_ISSUE_TO_POINT`),
`weaving_issues`/`weaving_receipts`/`weaving_points` vừa tạo, `warehouse_transfer_piece_items` +
`warehouse_transfers` (seed CK-TEST-WEAVING-1), revert `production_orders.floorStage` của order 8
về lại `PENDING`/`floorStartedAt=NULL` (trạng thái gốc trước test). Xác nhận qua `psql`:
`notifications` về đúng 21 dòng baseline, 0 dòng `readAt` khác NULL, order 8 về lại
`floorStage=PENDING`.

### 26.5 Còn treo

Không còn - **Phase 3b đã hoàn tất TOÀN BỘ 6/6 nhóm** (7.5-i tới 7.5-vi, mục 19/22/23/24/25/26).
Phase 3c-5 vẫn ở dạng plan (mục 8), chưa làm - chưa có việc gì đang chờ quyết định.

## 27. Phase 4 — Badge "việc chờ tôi" — _ĐÃ XONG TOÀN BỘ (BE+FE) 2026-09-29_

Sau khi Phase 3 đóng hoàn toàn (mục 26.5), bắt đầu Phase 4 theo đúng plan mục 6.3/8: 1 endpoint
`GET /me/work-queue` trả số đếm "đang chờ tôi xử lý" theo TỪNG ROLE của người gọi, để FE gắn badge
lên menu (khác hẳn cơ chế `notifications` - đây là QUERY đọc thẳng trạng thái nghiệp vụ hiện tại,
không suy từ bảng thông báo, nên "luôn khớp dữ liệu" đúng yêu cầu mục 6.3 dù người dùng có bỏ lỡ/xoá
thông báo hay không). Research kỹ bằng subagent trước khi code (đọc toàn bộ schema + 6 service liên
quan) vì bảng plan gốc mục 6.3 viết TRƯỚC khi có code thật, nghi ngờ đã lệch - xác nhận đúng vậy.

### 27.1 Phạm vi - 1 endpoint, 15 khoá đếm khớp đúng 9 dòng role/menu của mục 6.3

`GET /me/work-queue` → `{ counts: Record<string, number> }` - chỉ trả về khoá KHỚP ĐÚNG role của
người gọi (không query dư cho role họ không có, đỡ tải DB), 1 user nhiều role thì nhiều khoá cùng
lúc (vd account demo `sales`: vừa `WAREHOUSE_STAFF` vừa `SALES_STAFF` → vừa có
`warehouseTransferPending`/`warehousePurchaseReceiving` vừa có `salesReadyToShip`).

| Role | Khoá trong `counts` | Đếm |
|---|---|---|
| `PRODUCTION_MANAGER` (QLSX) | `qlsxProductionQueue` | PI item `WAITING_QLSX` + đề xuất cắt sắt `displayStatus=NEEDS_ACTION` |
| `BOSS` (Sếp) | `bossSkuApproval`, `bossProductionApproval` | `PlanForm.status=WAITING_BOSS_APPROVAL`; PI item `WAITING_BOSS` |
| `PRODUCTION_PLANNER` (KHSX) | `khsxSkuReview`, `khsxProductionRejected` | Định mức mảnh(SAT)/chi tiết(DAY_SON) `status=null` (đã nộp, chưa duyệt); PI item `REJECTED` |
| `SPEC_STEEL_STAFF` | `specSteelQuota` | SKU (loại `origin=PRODUCTION_CONFIRM`) chưa nộp định mức mảnh HOẶC bị trả về |
| `SPEC_ACCESSORY_PACKAGING_STAFF` | `specDetailQuota` | Tương tự, nhánh chi tiết |
| `PURCHASER` (Mua hàng) | `purchaserPending` | `PurchaseProposalItem.status IN PENDING_APPROVAL_STATUSES` |
| `WAREHOUSE_STAFF` (Kho) | `warehouseTransferPending`, `warehousePurchaseReceiving` | Phiếu chuyển `PENDING` tới đúng kho (`warehouseScope`, null=tổng kho); hàng mua `PURCHASING` chờ nhận tại đúng kho |
| `PHOI_STAFF` | `phoiSteelReceiving` | `SteelIssue.status=ISSUED` |
| `KCS_STAFF` | `kcsPhoi`, `kcsHan`, `kcsSon` | `CutBundle`+`StepBundle`+`PieceStepBundle`+`ProductionBatch(stage=PHOI)` `AWAITING_QC`; `ProductionBatch(stage=HAN/SON)` `AWAITING_QC` |
| `SALES_STAFF` | `salesReadyToShip` | Dòng đơn đã tới mốc `DONG_GOI`/`HOAN_THANH` (suy từ dữ liệu sản xuất thật) nhưng `shippedQty < totalQty` |

Role không nằm trong bảng trên (`HAN_STAFF`/`SON_STAFF`, chưa có dòng nào trong mục 6.3) →
`counts` rỗng `{}`, không lỗi.

### 27.2 5 chỗ bảng plan gốc mục 6.3 SAI/THIẾU so với code thật - phát hiện qua research trước khi code

Bảng mục 6.3 viết TRƯỚC khi Phase 3 code xong, một số hành vi đã đổi theo thời gian. Nếu làm đúng y
văn bảng đó, 2 badge (Mua hàng, Sales) sẽ **sai hẳn**, không phải chỉ thiếu vài dòng:

1. **QLSX "cắt sắt cần duyệt tay/FAILED"** - mục 14 (2026-09-26) chỉ bỏ THÔNG BÁO cho 3 nhánh
   "không thành công", KHÔNG bỏ trạng thái/hành động - `DRAFT`/`FAILED` vẫn tồn tại thật, vẫn có nút
   "Duyệt" thật (`POST /cutting-proposals/:id/approve`). Đếm thô `status IN (DRAFT, FAILED)` sẽ đếm
   NHẦM cả `DRAFT` đang trong 60s cửa sổ tự-duyệt (`FINALIZING_WINDOW_MS`, chưa kịp chuyển
   `APPROVED`) và bỏ sót `CALCULATING` quá hạn (nghi treo) - phải tái dùng đúng
   `computeDisplayStatus()` đã có sẵn (thêm method `countNeedsAction()` public gọi lại private đó).
2. **Mua hàng "NEW/QUOTING"** - SAI: `QUOTING` là tàn dư chết từ luồng báo giá cũ (gỡ 2026-08-27),
   không còn đường nào sinh mới; THIẾU `SUBMITTED`/`REJECTED` (~36 dòng dữ liệu cũ vẫn kẹt ở đó,
   `bossApprove()` vẫn là đường ra duy nhất của chúng - xem đã export `PENDING_APPROVAL_STATUSES`).
   Đếm theo đúng bảng gốc sẽ THIẾU ~36 dòng thật đang chờ Mua hàng xử lý.
3. **KCS "cut bundle/batch AWAITING_QC"** - THIẾU 2 bảng `StepBundle`/`PieceStepBundle` (công đoạn
   phụ Uốn/Dập/Đục lỗ/Tán/Tóp đầu/Xẻ của Phôi cho Sắt và vật tư thành phẩm) - đều là `AWAITING_QC`
   thật, cùng màn KCS Phôi.
4. **Sales "dòng đơn DONG_GOI/HOAN_THANH"** - SAI HẲN nếu lọc thẳng cột `SalesOrderItem.status`: cột
   này đứng yên ở `LEN_KE_HOACH` VĨNH VIỄN từ 2026-09-24 (không luồng nghiệp vụ nào ghi lại nữa, xem
   doc comment `resolveStages()`) - badge sẽ LUÔN HIỆN 0 dù có hàng thật sẵn sàng giao. Phải gọi
   `SalesOrdersService.countReadyToShip()` (method mới, tái dùng `resolveStages()`/`loadPiItems()` -
   "1 chủ sở hữu duy nhất" cho logic suy trạng thái, tránh viết lại ~60 dòng derive).
5. **Spec "SKU cần định mức"** - THIẾU điều kiện loại `PlanForm.origin='PRODUCTION_CONFIRM'` (SKU tự
   tạo khi Sếp duyệt PI item, ẩn khỏi mọi màn KHSX/Spec theo thiết kế - xem `skus.service.ts`) - thiếu
   điều kiện này sẽ đếm DƯ, hiện badge cho việc Spec không hề thấy trên màn của họ.

### 27.3 Quyết định thiết kế đáng chú ý

- **Response là `Record<string,number>` phẳng (mirror `UnreadCountResponseDto.byCategory`), không
  khai cứng 1 DTO field/role:** số khoá thực tế trả về LUÔN là tập con theo role người gọi - khai
  cứng ~15 field optional trên 1 class không thêm giá trị gì so với 1 map, FE đọc field không tồn
  tại thì coi như 0/ẩn badge, không phải lỗi.
- **Không `@RequirePermissions`:** khác MỌI controller khác trong repo - đây là "việc chờ CHÍNH
  người gọi" (không phải dữ liệu người khác), nên không cần permission riêng, chỉ cần đã đăng nhập
  (`JwtAuthGuard` toàn cục có sẵn). `PermissionsGuard` tự pass-through khi handler không khai
  `@RequirePermissions` (xác nhận qua đọc code `permissions.guard.ts`, không phải đoán).
- **Không cache/không dedupe qua bảng riêng nào** - mỗi lần gọi là 1 loạt query `count()` thật chạy
  song song (`Promise.all`), đúng tinh thần "luôn khớp dữ liệu" mục 6.3 đã nêu rõ là ưu tiên hơn tốc
  độ. Chưa thêm index mới cho các cột lọc - schema hiện tại đã đủ (`@@index([stage, status])` trên
  `ProductionBatch` có sẵn, các bảng còn lại là bảng nhỏ/lọc theo enum + FK đã có index PK/unique).
- **`countReadyToShip()`/`countNeedsAction()` đặt làm method PUBLIC mới trên chính
  `SalesOrdersService`/`CuttingProposalsService`** (không viết lại logic trong `WorkQueueService`) -
  giữ đúng nguyên tắc "1 chủ sở hữu duy nhất" cho 2 luồng derive-trạng-thái phức tạp đã có sẵn, tránh
  2 nguồn có thể lệch nhau theo thời gian.
- **`countReadyToShip()` lọc `shippedQty < totalQty` ở TẦNG ỨNG DỤNG** (fetch rồi filter JS), không
  viết `where` so sánh field-vs-field - Prisma Client không hỗ trợ so sánh 2 cột thường (cần raw SQL
  hoặc extension riêng); quy mô đơn hàng của nhà máy này đủ nhỏ để không cần tối ưu thêm.

### 27.4 Đã làm (BE)

- [purchase-proposals.service.ts](../src/modules/purchase-proposals/purchase-proposals.service.ts):
  export `PENDING_APPROVAL_STATUSES` (trước đó module-private).
- [cutting-proposals.service.ts](../src/modules/cutting-proposals/cutting-proposals.service.ts):
  thêm `countNeedsAction()` (public, tái dùng `computeDisplayStatus()` private có sẵn).
- [sales-orders.service.ts](../src/modules/sales-orders/sales-orders.service.ts): thêm
  `countReadyToShip()` (public, tái dùng `resolveStages()`/`loadPiItems()` private có sẵn).
- Module mới `src/modules/work-queue/`: `work-queue.service.ts` (10 method đếm riêng, gộp theo
  role), `work-queue.controller.ts` (`GET /me/work-queue`, không permission riêng),
  `work-queue.module.ts` (import `CuttingProposalsModule`+`SalesOrdersModule` để gọi 2 method mới ở
  trên), `dto/work-queue-response.dto.ts`. Đăng ký vào `app.module.ts`.
- Test: 13 test case mới (`work-queue.service.spec.ts`) - phủ đủ 9 role + case "không role nào" +
  case "nhiều role cùng lúc" + case "warehouseScope null (tổng kho) vs cụ thể". Toàn bộ backend
  **1264/1264 test, 51/51 suite** (từ 1251/50). `tsc --noEmit`: 0 lỗi mới (giữ nguyên 2 lỗi cũ ở
  seed script). `eslint --fix`: 0 lỗi/warning mới.

### 27.5 Live-test thật (BE+DB thật, chưa có FE để test qua browser)

Chạy BE thật (`npm run start:dev`, cổng 3001) + Postgres dev thật, đăng nhập LẦN LƯỢT toàn bộ 15
account demo (`seed-demo.ts`) qua API thật, gọi `GET /me/work-queue` cho mỗi người, đối chiếu số trả
về với `psql` trực tiếp trên DB dev (không phải data test tự tạo - dùng đúng dữ liệu đã có sẵn):

- **`qlsx` → `qlsxProductionQueue: 15`** - đối chiếu `psql`: PI item `WAITING_QLSX` = 3 dòng thật;
  `cutting_proposals` có 7 `FAILED` (luôn tính NEEDS_ACTION) + 5 trong số `DRAFT`/`CALCULATING` khớp
  đúng từng nhánh `computeDisplayStatus()` (2 `DRAFT hasInfeasibleLine=true`, 1 `CALCULATING` đã quá
  7 NGÀY tuổi - chắc chắn "nghi treo", 1 `DRAFT` khác `hasInfeasibleLine=true`, 1 `DRAFT` không cờ
  nào nhưng `completedAt` đã 5 ngày - rơi đúng nhánh "đã có phương án khác được duyệt"). 3 + 7 + 5 =
  **15**, khớp tuyệt đối - xác nhận `computeDisplayStatus()` tái dùng đúng, không lệch 1 dòng nào dù
  dữ liệu dev khá "bẩn" (nhiều proposal cũ ở đủ loại trạng thái).
- **`muapsh` → `purchaserPending: 42`** - đối chiếu `psql`: `purchase_proposal_items` có đúng 42
  dòng `NEW` (không có `QUOTING`/`SUBMITTED`/`REJECTED` nào tồn tại ở DB dev hiện tại) - khớp.
- **`sales` → `salesReadyToShip: 4`** (kèm `warehouseTransferPending`/`warehousePurchaseReceiving` vì
  account demo này CŨNG có role `WAREHOUSE_STAFF`) - số > 0 xác nhận `countReadyToShip()` chạy thật
  qua `resolveStages()` trên dữ liệu sản xuất thật, không phải lúc nào cũng trả 0 như sẽ xảy ra nếu
  lỡ lọc thẳng cột `SalesOrderItem.status` (đúng cảnh báo ở mục 27.2-4).
- **`kcs` → `{kcsPhoi:0, kcsHan:0, kcsSon:0}`**, **`dms`/`dmbbdg`** (Spec Sắt/chi tiết) → mỗi bên 1
  khoá riêng đúng tên, **`phoi`/`khopsh`/`khovttp`/`khotp`** → đúng khoá theo role, **`boss`/`khsx`**
  → đúng khoá, **`khsx`** (có CẢ `WAREHOUSE_STAFF` lẫn `PRODUCTION_PLANNER`) trả về đủ cả 4 khoá của
  2 role - xác nhận cơ chế multi-role hoạt động đúng với dữ liệu thật, không chỉ trên mock.
  **`han`/`son`** (không role nào khớp bảng mục 6.3) → `counts: {}` đúng như thiết kế, không lỗi.
- Route xác nhận đúng `GET /api/me/work-queue` (log Nest lúc khởi động:
  `WorkQueueController {/api/me}`).
- Baseline `notifications` không đổi trước/sau (endpoint thuần đọc, không ghi) - vẫn đúng 21 dòng, 0
  `readAt`.

### 27.6 Đã làm (FE)

Khảo sát trước khi code: cơ chế hiển thị badge đã có sẵn ở `ProductionPlanApp.tsx` (field
`badge?: number` trong mảng `NAV`, đã tự render số đỏ) - chỉ 1/7 shell có sẵn, 6 shell còn lại
(Mfg/Boss/Purchasing/InboundWarehouse/Sales) phải thêm mới (mirror đúng cách render đã có, không
bịa kiểu mới). Bỏ qua `AdminApp.tsx` - Admin không có dòng nào trong bảng role/menu mục 6.3.

- [work-queue-api.ts](../../DNA-ERP/src/services/work-queue-api.ts) (file mới): `getWorkQueue()`,
  re-export qua `api.ts`.
- [useWorkQueue.ts](../../DNA-ERP/src/hooks/useWorkQueue.ts) +
  [WorkQueueContext.tsx](../../DNA-ERP/src/context/WorkQueueContext.tsx) (file mới): mirror ĐÚNG
  `useNotifications.ts`/`NotificationsContext.tsx` (poll 30s, dừng khi tab ẩn
  `visibilitychange`, refetch khi quay lại tab, 1 Provider dùng chung cho cả cây tránh double-poll).
  Mount ở `app/layout.tsx`, lồng trong `NotificationsProvider`.
- Gắn badge vào ĐÚNG menu item từng shell (đọc kỹ code từng shell trước khi gắn, không suy diễn từ
  tên menu suông - 2 chỗ lệch giữa "tên menu" và "vị trí thật" phát hiện lúc làm):
  - `ProductionPlanApp.tsx`: `'duyet-sku'` = `khsxSkuReview`; `'lenh-sx'` đổi khoá theo role đang
    xem trang này (`isBoss ? bossProductionApproval : khsxProductionRejected`) - đúng theo nhánh
    `isBoss` đã có sẵn ở label dòng đó (Boss ghé qua trang này vẫn thấy đúng số của mình).
  - `BossApp.tsx`: `'cho-duyet'` (1 mục nav) = TỔNG `bossSkuApproval + bossProductionApproval` (2
    việc gộp vào 1 trang có filter nội bộ) - tách lại thành 2 badge riêng ở đúng 2 nút lọc "SKU
    mới"/"Lệnh sản xuất" bên trong `ChoDuyetSection`.
  - `MfgApp.tsx`: `'lenh-sx'`→`qlsxProductionQueue`, `'phoi-xac-nhan-nhan-sat'`→`phoiSteelReceiving`,
    `'kcs-phoi'/'kcs-han'/'kcs-son'`→`kcsPhoi/kcsHan/kcsSon`. Riêng Spec: badge gắn vào sub-item
    `'dinh-muc'` BÊN TRONG tab `'setup'` (không phải tab `'setup'` cha) - `'setup'` dùng CHUNG cho
    cả `SPEC_STEEL`/`SPEC_ACCESSORY`, tự chọn `specSteelQuota`/`specDetailQuota` theo đúng
    `user.mfgRole` của người đang xem.
  - `PurchasingApp.tsx`: `'theo-doi-mua-hang'` = `purchaserPending`.
  - `SalesApp.tsx`: `'orders'` = `salesReadyToShip`.
  - `InboundWarehouseApp.tsx`: **lệch quan trọng nhất phát hiện lúc đọc code** - cả
    `warehouseTransferPending` (phiếu "Nhập nội bộ" chờ xác nhận) VÀ `warehousePurchaseReceiving`
    (hàng mua chờ nhận) đều là SUB-TAB bên trong CÙNG 1 trang `NhapKhoPage.tsx`/tab `'nhap-kho'` -
    KHÔNG phải `'chuyen-tu-do'` (đó là màn TẠO phiếu chuyển đi, không phải hàng đang chờ mình xử
    lý). Badge = tổng cả 2, gắn vào `'nhap-kho'`.
- `tsc --noEmit`: 0 lỗi. `eslint --fix`: 0 lỗi (13 warning `react-hooks/exhaustive-deps` PRE-EXISTING
  ở cả 6 file, cùng 1 pattern `useUrlState` đã có từ trước, không liên quan thay đổi lần này).
  `npm test` (Vitest, không phải Jest - repo FE dùng Vitest): 58/58 pass, không đổi.

### 27.7 Live-test FE thật (browser thật, đối chiếu đúng số đã live-test BE ở mục 27.5)

Chạy lại BE+FE thật, đăng nhập LẦN LƯỢT các account đã có số > 0 ở mục 27.5 để xác nhận badge hiện
đúng ngay trên UI (không chỉ đúng ở tầng API):

- **`qlsx`**: mở drawer → "Xử lý lệnh sản xuất" hiện đúng badge đỏ **15** (khớp tuyệt đối số đã đối
  chiếu `psql` ở mục 27.5).
- **`boss`**: "Tổng hợp chờ duyệt" KHÔNG hiện badge (đúng vì cả 2 số = 0 lúc test) - xác nhận nhánh
  "badge = 0 thì ẩn" hoạt động đúng, không hiện số 0 gây nhiễu. Mở trang, 2 nút lọc "SKU mới"/"Lệnh
  sản xuất" cũng không hiện badge - không lỗi render.
- **`sales`**: "Quản lí đơn hàng" hiện đúng badge **4** - xác nhận ca KHÓ NHẤT (đọc qua
  `SalesOrdersService.countReadyToShip()`, dẫn xuất từ dữ liệu sản xuất thật) hoạt động đúng tới tận
  UI, không chỉ đúng ở response JSON.
- **`muapsh`**: "Theo dõi mua hàng" hiện đúng badge **42** - xác nhận `PENDING_APPROVAL_STATUSES`
  (đã sửa so với bảng plan gốc "NEW/QUOTING") phản ánh đúng lên UI thật.

### 27.8 Còn treo

- 2 chỗ `setInterval` mà văn bản Phase 4 gốc định "bỏ nếu badge + thông báo đã thay được"
  (`LenhSXPage.tsx`, `CuttingProposalsPage.tsx`) hoá ra KHÔNG phải polling đếm việc-chờ-tôi - đang
  tự refetch khi có dòng ở trạng thái `CALCULATING` (chờ solver trả lời), phục vụ mục đích khác hẳn
  (thấy kết quả tính cập nhật). ĐÃ GIỮ NGUYÊN, không đụng vào - đúng quyết định đã ghi trước khi làm
  FE.
- Chưa live-test qua browser cho 6/9 role còn lại (KHSX, Spec Sắt/chi tiết, Kho, Phôi, KCS) - đã
  đối chiếu ĐÚNG số qua API+`psql` ở mục 27.5 (toàn bộ đều = 0 ở dữ liệu dev hiện tại, không có ca
  > 0 nào để chụp ảnh badge thật) - nên còn "nợ" 1 lần xác nhận trực quan khi dữ liệu dev tự nhiên
  phát sinh số > 0 cho các role đó (cùng tinh thần "test khi có dịp tự nhiên" đã áp dụng ở vài mục
  trước, vd 17.5).
- Chưa thêm badge riêng cho `HAN_STAFF`/`SON_STAFF` - bảng mục 6.3 không có dòng nào cho 2 role này
  (XacNhanNhanSatPage hiện chỉ có `MaterialIssuesService`/`MaterialYieldIssuesService`, Phase 3b mục
  22 đã có thông báo ACTION_REQUIRED riêng rồi) - giữ nguyên, không tự thêm ngoài phạm vi mục 6.3.
