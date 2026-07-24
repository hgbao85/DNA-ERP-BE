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
 */
export const RequireWarehouseScope = (paramName = 'warehouseCode') =>
  SetMetadata(WAREHOUSE_SCOPE_KEY, paramName);
