# Changelog 2026-09-25 — Review tổng thể Notification (DNA-ERP + DNA-ERP-BE) & plan xây lại

> Trạng thái: **Phase 1 (nền tảng BE) và Phase 2 (Notification Center FE + URL) ĐÃ XONG (2026-09-25)
> — xem mục 11, 12** (gồm các đợt sửa sau phản hồi người dùng ở 12.5, 12.6: phân loại lại 21 thông
> báo cũ, bỏ `link` của 4 type cắt sắt). **2026-09-26 (mục 14):** người dùng chốt bỏ hẳn luôn cả 3
> loại thông báo "không thành công" của cắt sắt (cần duyệt tay/auto-duyệt lỗi/solver lỗi) - QLSX giờ
> CHỈ nhận thông báo khi tính xong VÀ tự duyệt OK, đúng flow trước khi có notification.
> **2026-09-26 (mục 15, 16, 17): Phase 3a ĐÃ XONG TOÀN BỘ** - nhóm 7.1 "SKU/định mức" (9 type),
> nhóm 7.2 "Lệnh sản xuất PI" (6 type), nhóm 7.4 "Đề xuất mua hàng" (4 type), cả 3 đều có live-test
> FE thật. Phase 3b-5 vẫn ở dạng plan, chưa làm.
> **Đang chờ người dùng quyết định:** có xây màn "chi tiết 1 CuttingProposal" (Duyệt/Từ chối) ở FE
> hay không (mục 12.5, 12.6) - bớt cấp thiết hơn sau mục 14 vì QLSX không còn thấy thông báo "cần
> duyệt tay" để mà cần bấm vào nữa.
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
8. Plan triển khai theo phase — _Phase 1, 2, 3a ĐÃ XONG; Phase 3b–5 chưa làm_
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

## 8. Plan triển khai theo phase — _Phase 1, 2, 3a ĐÃ XONG; Phase 3b–5 chưa làm_

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

### Phase 3 — Nối sự kiện theo luồng (≈4–6 ngày, chia 3 đợt) — _3a ĐÃ XONG (mục 15, 16, 17); 3b, 3c chưa làm_

- **3a (nhóm A):** 7.1 SKU/định mức (**✅ ĐÃ XONG 2026-09-26, mục 15** - trừ 1 sự kiện hoãn, xem
  15.5), 7.2 PI (**✅ ĐÃ XONG 2026-09-26, mục 16** - 1 recipient đổi so với plan gốc, xem 16.1),
  7.4 đề xuất mua mới (chưa làm). Cả 2 nhóm đã xong đều best-effort NGOÀI tx thay vì "emit trong tx"
  như dòng dưới nói - lý do kỹ thuật ghi ở mục 15.2/16.2. Mỗi transition: emit + resolve ở
  transition tiếp theo + test service.
- **3b (nhóm B):** 7.5 kho/sàn xưởng (steel issue, KCS, material issues, chuyển kho, đan, chuyển kiểm).
- **3c (nhóm C):** hàng về, đóng gói xong → Sales, gộp INFO theo ngày.
- **Nghiệm thu:** chạy E2E 1 vòng đầy đủ Sales → KHSX → Spec → Sếp → QLSX → Kho → Phôi → KCS → Đóng
  gói → Sales, mỗi bước người nhận đúng thấy đúng 1 thông báo, bấm mở đúng màn; thông báo "cần xử lý"
  tự chuyển "Đã xử lý" khi người khác làm xong.

### Phase 4 — Badge "việc chờ tôi" (≈2 ngày) — _chưa làm_

`GET /me/work-queue` (query count theo vai trò, mục 6.3; 1 request/lần, có index phù hợp) + badge trên
menu mọi app; làm mới cùng nhịp poll với chuông. Bỏ các `setInterval` tự poll ở `LenhSXPage` /
`CuttingProposalsPage` nếu badge + thông báo đã thay được.

### Phase 5 — Realtime & tuỳ chọn (tuỳ nhu cầu) — _chưa làm_

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
- **`?p=` mới đồng bộ URL cho `ProductionPlanApp` + `MfgApp`** (MfgApp thêm ở mục 12.5.B), 5 app còn
  lại (Sales/Purchasing/Boss/Admin/InboundWarehouse) vẫn dùng `useState` nội bộ cho tab - sẽ làm nốt
  cho app nào khi Phase 3 gắn sự kiện thật trỏ vào 1 tab cụ thể của app đó (làm tất cả ngay bây giờ là
  suy đoán trước nhu cầu thật).
- **Double-poll nhẹ khi drawer mobile bị bỏ mở:** nếu người dùng mở drawer (☰) rồi điều hướng đi nơi
  khác mà không đóng lại, cả 2 bản `NotificationCenter` (top bar + chân sidebar trong drawer) cùng tồn
  tại trong cây một lúc, mỗi bản tự poll riêng - dữ liệu vẫn đúng (không sai), chỉ tốn gọi API dư. Phát
  hiện qua log BE lúc live-test (nhiều request `unread-count` trùng giờ giống hệt). Không sửa trong
  phiên này vì cần nâng cấp lên 1 context/provider dùng chung - không cân xứng với mức độ ảnh hưởng
  (hiếm gặp, không gây sai dữ liệu).
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
- **Phase 3a (7.1, 7.2, 7.4) coi như hoàn tất.** Còn lại theo plan mục 8: Phase 3b (kho/sàn xưởng -
  mục 7.5), Phase 3c (kết quả cuối luồng), Phase 4 (badge "việc chờ tôi"), Phase 5 (realtime) - vẫn
  ở dạng plan, chưa làm, chưa có yêu cầu triển khai tiếp trong phiên này.
