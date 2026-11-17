# B1 + B2 — danh sách lỗi còn tồn 16/11 (17/11/2026)

Nguồn: FE `docs/audit-2026-11-16-loi-con-ton-doc-code.html`, mục 4. Không có migration, không sửa FE.

## B1. Quyền sửa user / vai trò leo thang được lên ADMIN

Trước đây:
- ai có USER:UPDATE gán được mọi `roleIds`, kể cả ADMIN, cho người khác (chỉ chặn tự sửa mình);
- ai có ROLE:UPDATE cấp được mọi quyền.

Trên DB dev hiện chỉ vai trò ADMIN có 2 quyền này, nên lỗ chưa mở. Nhưng chỉ cần cấp USER:UPDATE cho một vai trò khác là mở ra. Nay chặn ở BE bằng `common/utils/privilege-guard.util.ts`.

Người thao tác là **ADMIN** thì không bị hạn chế gì. Người thao tác khác:

- **Tài khoản ADMIN:** không sửa, không sửa thuộc tính sản xuất, không đặt lại mật khẩu, không xoá. Đặt lại mật khẩu ADMIN tương đương chiếm tài khoản ADMIN.
- **Gán vai trò** (tạo / sửa tài khoản): không gán được ADMIN. Vai trò **thêm mới** phải chỉ gồm những quyền chính mình đang có. Vai trò người đó đã có thì giữ nguyên được, vì FE luôn gửi cả danh sách.
- **Vai trò:** không tạo / sửa / xoá vai trò ADMIN, không đổi tên vai trò khác thành ADMIN. Quyền **thêm mới** vào vai trò phải là quyền mình có; quyền vai trò đã có thì giữ nguyên được.

Quyền của người thao tác đọc từ access token, nên vai trò vừa bị gỡ quyền vẫn còn hiệu lực tới khi token hết hạn. Cách này giống mọi kiểm quyền khác trong hệ thống.

Chữ ký service đổi: `UsersService.create / update / updateMfgAttributes / resetPassword / remove` và `RolesService.create / update / remove` nhận thêm người thao tác (`AuthenticatedUser` từ `@CurrentUser()`).

## B2. `sortBy` không kiểm

Trước đây chuỗi `?sortBy=` tuỳ ý đi thẳng vào Prisma `orderBy` ở 20 service:
- trường lạ → 500;
- `/users?sortBy=password` sắp xếp được theo hash mật khẩu.

Nay mọi chỗ đi qua `common/utils/sort-order-by.util.ts` `sortOrderBy(query, danh sách cho phép, mặc định)`:
- trường ngoài danh sách → 400;
- không gửi `sortBy` → giữ thứ tự cũ.

Danh sách cho phép chỉ gồm trường đơn giản đã kiểm có trong model (id / mã / tên / ngày tạo-sửa…), không có trường nhạy cảm. FE hiện không gửi `sortBy` ở đâu, nên không ảnh hưởng màn nào.

## Test

- Unit: toàn bộ chỉ còn 2 lỗi cũ của bộ giải tối ưu cắt (3794 qua). Integration 33/33.
- Test mới:
  - B1 users: không đụng tài khoản ADMIN; không gán ADMIN; không gán vai trò có quyền mình thiếu; chỉ xét vai trò thêm mới; giữ nguyên vai trò cũ vẫn lưu được.
  - B1 roles: không tạo / sửa / xoá / đổi tên thành ADMIN; chỉ thêm quyền mình có; tạo vai trò với quyền thiếu bị chặn.
  - B2: `sortOrderBy` (mặc định / hợp lệ / `password`, trường lạ, `__proto__` → 400).
- Thử sống bản sao DB dev, cấp tạm cho BOSS USER:VIEW/CREATE/UPDATE + ROLE:VIEW/UPDATE (đã gỡ lại sau):
  - Bị chặn 403: boss đặt lại mật khẩu admin; boss sửa admin; boss gán ADMIN cho `quanh`; boss sửa vai trò ADMIN; boss thêm STOCK:DELETE vào WAREHOUSE_STAFF.
  - Vẫn được 200: boss lưu lại WAREHOUSE_STAFF giữ nguyên quyền cũ; boss lưu `quanh` giữ nguyên vai trò; admin sửa vai trò ADMIN.
  - `/users?sortBy=password` → 400; `sortBy=khongCo` → 400 (trước đây 500); `sortBy=username` → 200 đúng thứ tự; `/materials?sortBy=code` → 200.
