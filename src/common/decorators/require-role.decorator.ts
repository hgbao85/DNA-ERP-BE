import { SetMetadata } from '@nestjs/common';
import { BusinessRole, DefaultRole } from '../constants/roles.constant';

export const ROLE_KEY = 'requiredBusinessRoles';

/**
 * Requires the caller to hold one of the given Roles (by name, e.g. 'BOSS' or 'ADMIN').
 * Layered on top of (not instead of) `@RequirePermissions` - use when a module+action
 * permission is legitimately shared by several roles (e.g. SKU:APPROVE is granted
 * to both PRODUCTION_MANAGER for its own forwarding step and to BOSS for the final
 * sign-off) but one specific endpoint must be reachable by only one of them. Mirrors
 * `@RequireMfgRole`, which gates on the business-attribute `mfgRole` column instead of
 * on assigned Role name - BOSS has no mfgRole, so that decorator can't express "BOSS only".
 *
 * Accepts `DefaultRole` (ADMIN) too, không chỉ `BusinessRole` - đính chính 2026-08-29
 * (retryProductionOrder(): sự cố kỹ thuật cần ADMIN xử lý, không phải quyết định nghiệp vụ của
 * BOSS). `AuthenticatedUser.roles` là `string[]` thô ở runtime nên so khớp đúng bất kể type gốc.
 */
export const RequireRole = (...roles: (BusinessRole | DefaultRole)[]) =>
  SetMetadata(ROLE_KEY, roles);
