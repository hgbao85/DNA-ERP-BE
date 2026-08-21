import { SetMetadata } from '@nestjs/common';

export const WAREHOUSE_SCOPE_KEY = 'requireWarehouseScopeParam';

/**
 * Marks a route as warehouse-scoped: the caller's `User.warehouseScope` (from
 * `@CurrentUser()`) is compared against the resource identifier named by `paramName`
 * (checked in order: route param, query param, body field). A `null` warehouseScope
 * means "tổng kho" - sees everything, so the check is skipped.
 *
 * Only enforces the match; it does not filter query results. Row-level scoping
 * (e.g. listing only the caller's warehouse) is still the service's job.
 *
 * KHÔNG có controller nào đang gắn decorator này (audit 2026-08-20) - WarehouseScopeGuard
 * (registered as APP_GUARD) chạy trên mọi request nhưng luôn no-op vì metadata không tồn
 * tại ở đâu cả. Warehouse scope hiện được kiểm tra thủ công đúng cách trong service layer.
 * Trước khi thêm decorator này vào 1 route, xác nhận service đó KHÔNG còn tự kiểm tra scope
 * thủ công nữa (tránh trùng logic) - đây là cơ chế dự phòng chưa dùng, không phải dead code.
 */
export const RequireWarehouseScope = (paramName = 'warehouseCode') =>
  SetMetadata(WAREHOUSE_SCOPE_KEY, paramName);
