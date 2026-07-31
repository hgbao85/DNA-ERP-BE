# Quy ước code cho DNA-ERP-BE

Tài liệu này ghi lại các quy ước đã được kiểm chứng qua thực tế (Auth/Users/Roles - Phase 1)
để mọi module sau này (kể cả code do AI generate) đi theo cùng 1 chuẩn, không tự suy diễn lại
từ đầu mỗi lần dựa theo tài liệu thiết kế (vốn có thể đã lỗi thời so với code thật).

Dành cho cả BE và FE - đây không chỉ là quy ước code, mục 0 dưới đây còn giải thích **thứ tự
ưu tiên sửa gì trước** để cả 2 phía cùng hiểu tại sao 1 số việc được làm ngay còn 1 số việc
được chủ động để sau.

## 0. Ưu tiên: MVP trước, hoàn thiện dần

Dự án đang ở giai đoạn cho người dùng thử trước ("sân chơi" nội bộ) - ưu tiên là **main
feature chạy đúng** (BOM, sản xuất, kho...), không phải mọi API con đều hoàn hảo ngay từ đầu.
Không phải thiếu sót nào cũng cần sửa ngay, nhưng cần phân biệt rõ 2 loại:

**Loại 1 - Gap tính năng chưa hoàn thiện (an toàn để pending):**
Ví dụ: 1 model danh mục ít dùng chưa có soft-delete, 1 module phụ chưa có test. Nguyên tắc:
*"chỉ cái nào không sửa được bằng update thì mới cần xoá thật"* - với dữ liệu danh mục, sai
thì sửa lại (update), hiếm khi cần xoá vĩnh viễn. Việc hoàn thiện loại gap này nên chờ có
người dùng thật, phát hiện thật sự cần, rồi mới làm - không làm trước cho "đủ bộ".

**Loại 2 - Gap phá vỡ niềm tin vào hệ thống (sửa ngay, kể cả ở giai đoạn MVP):**
Là loại lỗi khiến hệ thống "nói dối" về việc nó vừa làm gì - vd xoá 1 role nhưng quyền vẫn
còn hiệu lực, xoá 1 bản ghi nhưng nó vẫn hiện trong danh sách. Loại này thường sửa rẻ (đăng
ký thêm 1 dòng vào `SOFT_DELETE_MODELS`/`AUDITED_MODELS`, xem mục 1-2), nhưng cái giá nếu để
lộ ra ngoài (mất niềm tin vào tool, khó debug về sau, dữ liệu sai lệch âm thầm) đắt hơn nhiều
chi phí sửa. Không đợi "có người dùng phàn nàn" mới sửa loại này.

**Cách phân loại nhanh:** hỏi *"nếu admin/user làm đúng thao tác, kết quả có đúng như họ nghĩ
không?"* - nếu không (vd họ tưởng đã xoá nhưng thực ra chưa), là loại 2, sửa ngay. Nếu chỉ là
"thiếu tính năng chưa ai cần tới", là loại 1, có thể để sau.

*Ví dụ thực tế đã áp dụng: bug "xoá Role nhưng quyền vẫn còn hiệu lực" (soft-delete quên áp
cho nested include khi load `User.roles.role`) là loại 2, đã sửa ngay. Còn việc thêm
soft-delete cho các model Phase 2 (Material/Supplier/WeavingPoint/Warehouse/ProductVariant/
Customer/DefectReason/MaterialGroup) là loại 1, đang pending - các model này vẫn dùng
`remove()` xoá thật (hard delete) đúng như bản gốc `init-phase2` đã build, cột `deletedAt`
đã có sẵn trong schema để đăng ký sau này chỉ cần sửa 1 dòng, không cần migration mới.*

## 1. Xoá mềm (soft-delete)

**Dùng `deletedAt DateTime?`, KHÔNG dùng 1 cột `isActive`/`isDeleted` tự quản lý tay.**

```prisma
model Xyz {
  id        BigInt    @id @default(autoincrement())
  deletedAt DateTime?
  // ...
}
```

Đăng ký model vào `src/prisma/soft-delete-models.constant.ts`:
```ts
export const SOFT_DELETE_MODELS = new Set(['User', 'Role', 'Xyz']);
```

Sau khi đăng ký, extension (`src/prisma/extensions/soft-delete.extension.ts`) tự động:
- Rewrite `prisma.xyz.delete(...)` thành `update({ data: { deletedAt: new Date() } })`.
- Tự thêm `where: { deletedAt: null }` vào **mọi** query đọc (`findMany`, `findFirst`,
  `findUnique`, `count`) - kể cả khi model được load qua `include` lồng từ model khác.

**Vì sao không tự set `isActive: false` trong service rồi tự lọc tay ở `findAll()`:**
cách đó bắt mỗi dev (hoặc AI) phải nhớ thêm điều kiện lọc ở **từng nơi** đọc dữ liệu, kể cả
những chỗ đọc gián tiếp qua relation (vd `User.roles.role`). Chỉ cần quên 1 chỗ là dữ liệu
"đã xoá" vẫn rò rỉ ra ngoài hoặc vẫn tiếp tục có hiệu lực nghiệp vụ - đây là lỗi thật đã xảy
ra với `Role` (soft-delete quên áp cho nested include) và lặp lại y hệt ở toàn bộ module
Phase 2 (`isActive` không được lọc ở bất kỳ `findAll()`/`findOne()` nào).

**`isActive` vẫn có chỗ dùng riêng - đừng nhầm với xoá:** nếu nghiệp vụ cần khái niệm
"tạm ngừng dùng nhưng vẫn muốn thấy trong danh sách để bật lại" (vd 1 NCC ngừng hợp tác tạm
thời, không phải xoá nhầm), giữ `isActive` như 1 field độc lập, KHÔNG gắn với việc ẩn khỏi
query. Ví dụ mẫu: `User.isActive` (khoá đăng nhập tạm) tách biệt hoàn toàn với `User.deletedAt`
(xoá tài khoản).

**Lưu ý hiện trạng (2026-07-31):** `Material/Supplier/WeavingPoint/Warehouse/ProductVariant`
đã có sẵn cột `deletedAt` trong schema nhưng **chưa** đăng ký vào `SOFT_DELETE_MODELS` -
`remove()` của các model này vẫn là hard delete thật (xem mục 0). Đừng tưởng nhầm là đã bật
soft-delete chỉ vì thấy cột tồn tại trong schema/migration.

## 2. Audit log

Đăng ký mọi model đại diện cho 1 entity nghiệp vụ độc lập (không phải junction/line-item con
của 1 revision) vào `src/prisma/extensions/audit-log.extension.ts`:
```ts
const AUDITED_MODELS = new Set(['User', 'Role', 'UserRole', 'RolePermission', 'Xyz']);
```
Mọi `create`/`update`/`delete` (kể cả bị soft-delete extension rewrite thành `update`) sẽ tự
ghi vào bảng `audit_logs` kèm `userId`/`ip`/`correlationId` của người thực hiện.

Field nhạy cảm (password, secret...) phải được thêm vào `REDACTED_FIELDS` trong cùng file
trước khi model đó được audit, để không lộ hash/secret vào snapshot.

**Không cần audit** các bảng junction/line-item con thay đổi liên tục theo vòng đời cha (vd
`BomPiece`/`PieceBom` con của `BomRevision` lúc còn DRAFT) - sẽ làm audit log quá ồn mà không
có giá trị tra soát.

## 3. RBAC

Mọi endpoint (trừ các route đánh dấu `@Public()`) phải có `@RequirePermissions({ module, action })`.
`module` lấy từ `PERMISSION_MODULES`, `action` là 1 trong `PermissionAction` (VIEW/CREATE/UPDATE/
DELETE/APPROVE). Không có route "quên" decorator.

## 4. Khoá chính (ID strategy)

- **Auth/Core** (User, Role, Permission...): `String @id @default(uuid())`.
- **Phase 2 trở đi** (Material, Warehouse, BomRevision...): `BigInt @id @default(autoincrement())`.

Đây là chủ đích, không phải thiếu nhất quán - giữ nguyên, không đổi ngược. Mọi controller nhận
`:id` dạng BigInt phải parse qua `parseBigIntId()` (`src/common/utils/parse-bigint-id.util.ts`),
không tự viết `BigInt(id)` trực tiếp (sẽ crash 500 thay vì trả 400 khi id sai định dạng).

Response DTO luôn convert `id.toString()` trước khi trả JSON - BigInt không tự serialize được.

## 5. Kiểm tra trùng lặp (uniqueness)

Khi entity có field unique mang tính nghiệp vụ (username, code, name...), thông báo lỗi phải
nêu rõ field nào trùng, dùng `ConflictException` (409), không để lộ lỗi DB thô (P2002) ra ngoài.

## 6. Test tối thiểu cho mỗi module mới

Theo đúng mức đã áp dụng cho Users/Auth trong Phase 1:
- Unit test (mock Prisma) cho service, bao phủ: happy path, boundary (rỗng/trùng/thiếu field),
  lỗi xác thực quyền, lỗi không tìm thấy record.
- Ít nhất 1 lượt test thật qua HTTP (không mock) xác nhận mã lỗi HTTP đúng (400/403/404/409),
  không lộ 500 cho lỗi có thể lường trước.

## 7. Trước khi chạy migration phá huỷ dữ liệu (DROP COLUMN/TABLE)

- Backup thủ công trước khi chạy (`pnpm db:backup`), không đợi lịch định kỳ.
- Ghi chú trong file migration đã kiểm tra dữ liệu hiện có trước khi xoá (xem ví dụ migration
  `20260727120000_remove_legacy_mfg_roles`).
- Không chạy migration DDL phá huỷ trực tiếp lên DB production từ máy cá nhân ngoài quy trình
  deploy - đã có bài học thật từ việc này trong dự án.
