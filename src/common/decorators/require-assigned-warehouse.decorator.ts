import { SetMetadata } from '@nestjs/common';

export const REQUIRE_ASSIGNED_WAREHOUSE_KEY = 'requireAssignedWarehouse';

/**
 * Rà soát 14/11 XK1 (16/11/2026): route GHI của kho (xuất, chuyển, nhận, sửa tồn, kiểm kê...) - "Nhân viên"
 * (`WAREHOUSE_STAFF`) phải đang phụ trách 1 kho (`warehouseScope` khác rỗng) mới gọi được.
 *
 * `WAREHOUSE_STAFF` là vai trò gốc "Nhân viên" của MỌI nhân viên văn phòng / kho (người mua, KHSX, Sales, Quản lý vật tư
 * cũng mang vai trò này kèm cờ isPurchaser/isProductPlanner/...), nên quyền RBAC ghi kho đi theo cả họ. Trước đây phạm
 * vi trống = tổng kho ở mọi service, nên các tài khoản văn phòng (và thủ kho mới tạo chưa gán kho) xuất / chuyển / sửa
 * tồn được ở cả 9 kho. Nay phạm vi trống chỉ còn là tổng kho với Admin / Giám đốc; các màn hình XEM không đổi.
 * Kiểm ở WarehouseScopeGuard (APP_GUARD).
 */
export const RequireAssignedWarehouse = () => SetMetadata(REQUIRE_ASSIGNED_WAREHOUSE_KEY, true);
