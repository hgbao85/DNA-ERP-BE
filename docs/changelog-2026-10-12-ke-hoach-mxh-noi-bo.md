# Changelog 2026-10-12 — Kế hoạch MXH nội bộ (bảng tin công ty) trong DNA-ERP

> Trạng thái: **MỚI LÀ PLAN, CHƯA CODE GÌ.** Đang chờ người dùng chốt 4 quyết định ở mục 6 trước khi
> bắt đầu Phase 1.

## Mục lục

1. Bối cảnh
2. Tự làm trong ERP hay dùng sản phẩm có sẵn
3. Cắt phạm vi từ mockup
4. Thiết kế BE
5. Thiết kế FE
6. Quyết định cần người dùng chốt — _chưa chốt_
7. Plan theo phase — _chưa bắt đầu_
8. Rủi ro
9. Chưa làm

---

## 1. Bối cảnh

Người dùng gửi ảnh mockup kiểu Facebook Workplace (bảng tin, nhóm theo phòng ban/dự án, bình luận,
cảm xúc, sự kiện sắp tới, nhóm gợi ý, thành viên đang hoạt động, icon chat) và hỏi: *"nếu làm MXH nội
bộ như thế này thì làm thế nào"*. Plan này dựa trên việc đọc code hiện có ở DNA-ERP-BE và stack FE
(`D:\DNA-ERP`: Next 16 + React 18 + socket.io-client), không sửa gì.

## 2. Tự làm trong ERP hay dùng sản phẩm có sẵn

ERP đã có sẵn phần lớn hạ tầng một MXH nội bộ cần (đã kiểm chứng trong code):

| Cần cho MXH | Đã có trong ERP |
|---|---|
| Đăng nhập, người dùng, phân quyền | `auth` (JWT), `User`, RBAC `Role`/`Permission` + `PermissionsGuard` |
| Đăng ảnh / file | `uploads` → Cloudinary (ảnh ≤ 5 MB, tài liệu ≤ 10 MB) |
| Realtime | `src/realtime` (socket.io + Redis adapter, hợp đồng "chỉ đẩy tín hiệu, FE refetch REST") |
| Thông báo (chuông, đã đọc, gộp trùng) | `NotificationsService.emit()` + `NotificationRecipient` + `dedupeKey` + `link` có `focus` |
| Nhật ký kiểm duyệt | `audit-log` |

Phần mới thực chất chỉ là **mô hình dữ liệu bài viết/nhóm + màn hình feed**. Lợi thế duy nhất so với
dùng Zalo/Lark là: 1 lần đăng nhập, dùng chung chuông thông báo, và **gắn được bài viết với đối tượng
ERP** (PI, đơn hàng, đề xuất mua…). Nếu không cần điểm cuối này thì nhóm Zalo đang dùng đã đủ và rẻ hơn.

Đề xuất: **làm MVP gọn trong ERP**, cắt bớt mockup (mục 3).

## 3. Cắt phạm vi từ mockup

| Thành phần trong mockup | Quyết định | Lý do |
|---|---|---|
| Đăng bài (chữ, ảnh, tài liệu) + feed | **MVP** | lõi |
| Nhóm: Toàn công ty, Phòng ban, Dự án | **MVP** | lõi; ERP chưa có model Phòng ban (xem 6b) |
| Bình luận (1 cấp trả lời), Thích/cảm xúc | **MVP** | lõi |
| @nhắc tên → thông báo | **MVP** | không có thì không ai biết để vào xem |
| Bài ghim / thông báo chính thức | **MVP** | thay luồng `ANNOUNCEMENT` admin broadcast hiện tại — tạo lý do để mọi người vào |
| Bài viết đã lưu | **MVP** | rẻ (1 bảng) |
| Tab "Tất cả / Nổi bật / Theo dõi / Gần đây" | **Gộp còn 2 tab**: "Tất cả" + "Đã ghim" | "Tất cả" và "Gần đây" trùng nhau khi feed đã sắp theo thời gian; "Nổi bật" cần thuật toán xếp hạng — không đáng với vài chục–trăm người |
| Sự kiện sắp tới (lịch + tham gia) | Phase 2 | |
| Khảo sát | Phase 2 | |
| Tài liệu | Phase 2 — gom từ file đính kèm của bài, không làm thư viện riêng | |
| Thành viên đang hoạt động (chấm xanh) | Phase 2 | cần presence qua socket; cân nhắc riêng tư |
| Hỏi đáp | Không làm module riêng — là 1 nhóm hoặc 1 loại bài `QUESTION` | |
| Khám phá / Nhóm gợi ý | Không làm | danh sách nhóm công khai là đủ ở quy mô này |
| Chat (icon tin nhắn) | **Không làm — dùng Zalo** | chat là cả một sản phẩm riêng (đã đọc, đang gõ, nhóm chat, file, đồng bộ đa thiết bị) |

## 4. Thiết kế BE

Module mới `src/modules/social`, permission module mới `SOCIAL` (VIEW / CREATE / MANAGE).

### 4.1 Schema (Prisma, phác thảo)

```prisma
enum SocialGroupVisibility { PUBLIC PRIVATE }
enum SocialGroupRole       { ADMIN MEMBER }
enum PostType              { NORMAL ANNOUNCEMENT QUESTION }
enum ReactionType          { LIKE LOVE HAHA WOW SAD }

model SocialGroup {
  id            String  @id @default(uuid())
  name          String
  description   String?
  avatarUrl     String?
  visibility    SocialGroupVisibility @default(PUBLIC)
  isCompanyWide Boolean @default(false) // nhóm "Toàn công ty": mọi user tự là thành viên
  createdBy     String
  archivedAt    DateTime?
  createdAt     DateTime @default(now())
  members SocialGroupMember[]
  posts   Post[]
}

model SocialGroupMember {
  groupId  String
  userId   String
  role     SocialGroupRole @default(MEMBER)
  mutedAt  DateTime?       // tắt thông báo bài mới của nhóm
  joinedAt DateTime @default(now())
  @@id([groupId, userId])
  @@index([userId])
}

model Post {
  id            String   @id @default(uuid())
  groupId       String
  authorId      String
  type          PostType @default(NORMAL)
  content       String
  /// Gắn với đối tượng ERP - cùng quy ước entityType/entityId/link với Notification.
  entityType    String?
  entityId      String?
  pinnedAt      DateTime?
  editedAt      DateTime?
  deletedAt     DateTime?
  /// Đếm sẵn, cập nhật trong cùng transaction với insert/delete comment/reaction.
  commentCount  Int @default(0)
  reactionCount Int @default(0)
  createdAt     DateTime @default(now())
  @@index([groupId, createdAt(sort: Desc), id])
  @@index([authorId])
}

model PostAttachment  { id, postId, kind IMAGE|FILE, url, publicId, fileName, mimeType, size, width?, height?, sortOrder }
model PostComment     { id, postId, parentId? /* chỉ 1 cấp */, authorId, content, editedAt?, deletedAt?, reactionCount, createdAt }
model PostReaction    { postId, userId, type ReactionType, createdAt  @@id([postId, userId]) }
model CommentReaction { commentId, userId, type ReactionType, createdAt  @@id([commentId, userId]) }
model PostMention     { id, postId, commentId?, userId }
model SavedPost       { userId, postId, createdAt  @@id([userId, postId]) }
```

Tách `PostReaction`/`CommentReaction` thay vì 1 bảng polymorphic `targetType/targetId` để giữ được
khoá ngoại và `onDelete: Cascade`.

### 4.2 Feed

- **Fan-out lúc đọc** (không ghi sẵn timeline từng người): `WHERE groupId IN (nhóm của tôi + nhóm
  toàn công ty) AND deletedAt IS NULL ORDER BY createdAt DESC, id DESC`. Đủ nhanh tới vài nghìn
  người dùng với index ở 4.1.
- **Phân trang keyset** (`?cursor=<createdAt>_<id>`), KHÔNG dùng `PaginationQueryDto` offset +
  `sortBy` chuỗi tự do (đã ghi nhận lỗi 500 khi truyền field lạ ở changelog 2026-09-25 mục 2.1); feed
  dùng offset sẽ trùng/sót bài khi có bài mới chen vào.
- Mỗi bài trả kèm: 3 bình luận mới nhất, `myReaction`, `isSaved`, top 3 loại cảm xúc + tên 2 người
  đầu ("Bạn, Trần Thị Mai và 15 người khác").

### 4.3 Quyền

- Đọc bài = đọc được nhóm: nhóm PRIVATE chỉ thành viên. Kiểm tra ở REST — socket chỉ đẩy tín hiệu.
- Tác giả sửa/xoá bài của mình; admin nhóm xoá bài trong nhóm; quyền `SOCIAL:MANAGE` kiểm duyệt toàn
  hệ thống. Xoá = soft delete + ghi `audit-log` khi người xoá không phải tác giả.
- Chỉ `SOCIAL:MANAGE` được đăng `ANNOUNCEMENT` vào nhóm toàn công ty và ghim bài ở đó.

### 4.4 Upload

Tái dùng `uploads` (Cloudinary): FE upload trước → nhận `url/publicId` → gửi kèm khi tạo bài. Cần
thêm: giới hạn số file/bài (vd 10), kiểm tra `publicId` thuộc đúng người upload, và job dọn file mồ
côi (upload rồi không đăng bài).

### 4.5 Realtime

Thêm vào `realtime.contract.ts`:

- room `group:<id>` — server tự join theo membership lúc connect và khi tham gia/rời nhóm;
- event `social.post_created`, `social.post_changed` (chỉ `{ postId, groupId, action }`, đúng nguyên
  tắc hiện có).

FE nhận `post_created` → hiện thanh "Có N bài viết mới" ở đầu feed, KHÔNG chèn thẳng (tránh feed nhảy
khi đang đọc). `post_changed` → refetch đúng bài đó (số bình luận/cảm xúc).

### 4.6 Thông báo

Tái dùng `NotificationsService.emit()`, thêm **category riêng `SOCIAL`** để FE tách khỏi thông báo
nghiệp vụ — không để "A đã thích bài của bạn" đẩy trôi "PI cần duyệt". Type mới:

| Type | Người nhận | Gộp (`dedupeKey`) |
|---|---|---|
| `SOCIAL_MENTIONED` | người bị @ | không |
| `SOCIAL_POST_COMMENTED` | tác giả bài + người đã bình luận trước | theo bài |
| `SOCIAL_COMMENT_REPLIED` | tác giả bình luận gốc | theo bình luận |
| `SOCIAL_POST_REACTED` | tác giả bài | theo bài → "A và 15 người khác" |
| `SOCIAL_ANNOUNCEMENT` | toàn công ty | không — thay luồng `ANNOUNCEMENT` cũ |

Bài thường trong nhóm KHÔNG bắn thông báo cho cả nhóm (chỉ realtime "bài mới"), tránh spam.

### 4.7 Tìm kiếm

Postgres `unaccent` + `pg_trgm`, index GIN trên `content` — tìm tiếng Việt không dấu được ("ao hoa"
ra "ảo hoá"). Không cần Elasticsearch ở quy mô này.

### 4.8 Endpoint (MVP)

```
GET    /social/feed?cursor=&groupId=&pinned=
POST   /social/posts                      PATCH/DELETE /social/posts/:id
POST   /social/posts/:id/pin              DELETE /social/posts/:id/pin
PUT    /social/posts/:id/reaction         DELETE /social/posts/:id/reaction
GET    /social/posts/:id/comments?cursor= POST /social/posts/:id/comments
PATCH/DELETE /social/comments/:id         PUT/DELETE /social/comments/:id/reaction
POST/DELETE  /social/posts/:id/save       GET /social/saved
GET    /social/groups                     POST /social/groups   PATCH /social/groups/:id
POST   /social/groups/:id/join            DELETE /social/groups/:id/members/:userId
GET    /social/mention-suggest?q=
```

## 5. Thiết kế FE (`D:\DNA-ERP`)

- Bố cục 3 cột như mockup trên desktop; **mobile là bắt buộc** nếu công nhân xưởng dùng (6a): 1 cột,
  sidebar thành drawer, cột phải ẩn.
- Component: `Composer`, `PostCard`, `ImageGrid` (1/2/3/4+ ảnh), `CommentThread`, `ReactionBar`,
  `MentionInput`, `GroupSidebar`, `NewPostsBanner`.
- Lazy-load ảnh, dùng transform Cloudinary để lấy thumbnail thay vì ảnh gốc.

## 6. Quyết định cần người dùng chốt — _chưa chốt_

a. **Ai dùng?** Chỉ khối văn phòng, hay cả công nhân Phôi/Hàn/Sơn (đã có tài khoản ERP chưa)? Quyết
   định độ ưu tiên mobile và mức kiểm duyệt.
b. **Phòng ban:** ERP chưa có model Phòng ban (chỉ có `mfgRole`, `warehouseScope`, các cờ `is*`). Dùng
   Nhóm thay Phòng ban (đề xuất), hay cần model `Department` thật cho HR sau này?
c. **Chat:** dùng Zalo (đề xuất) hay tự làm?
d. **Gắn bài với đối tượng ERP** (chia sẻ PI/đơn hàng vào nhóm, thảo luận dưới đối tượng đó) — có
   cần không? Đây là lý do chính để tự làm thay vì dùng Zalo.

## 7. Plan theo phase — _chưa bắt đầu_

| Phase | Nội dung | Ước lượng (1 dev fullstack) |
|---|---|---|
| 1 — MVP | Schema + migration, nhóm, bài (chữ/ảnh/file), bình luận, cảm xúc, @nhắc, ghim, lưu, feed keyset, realtime "bài mới", 5 type thông báo, màn feed + nhóm (responsive) | ~2–3 tuần |
| 2 | Sự kiện (lịch, tham gia), khảo sát, tab tài liệu, tìm kiếm không dấu, đang hoạt động | ~1–2 tuần |
| 3 | Gắn bài với đối tượng ERP, báo cáo vi phạm, thống kê tương tác | tuỳ 6d |

## 8. Rủi ro

- **Không ai đăng** — MXH nội bộ thường chết vì thiếu lý do để vào. Giảm bằng cách: thông báo chính
  thức chỉ đăng ở đây, sự kiện công ty ở đây.
- Dung lượng Cloudinary (gói miễn phí có hạn) khi ảnh nhiều — cần nén/giới hạn kích thước phía FE.
- Nội dung không phù hợp — cần quyền kiểm duyệt + audit-log từ Phase 1.

## 9. Chưa làm

Toàn bộ — đây mới là plan, chưa sửa schema/code ở BE hay FE.
