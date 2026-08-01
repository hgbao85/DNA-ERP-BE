import { SetMetadata } from '@nestjs/common';
import { BusinessRole } from '../constants/roles.constant';

export const ROLE_KEY = 'requiredBusinessRoles';

/**
 * Requires the caller to hold one of the given business Roles (by name, e.g. 'BOSS').
 * Layered on top of (not instead of) `@RequirePermissions` - use when a module+action
 * permission is legitimately shared by several roles (e.g. PLAN_FORM:APPROVE is granted
 * to both PRODUCTION_MANAGER for its own forwarding step and to BOSS for the final
 * sign-off) but one specific endpoint must be reachable by only one of them. Mirrors
 * `@RequireMfgRole`, which gates on the business-attribute `mfgRole` column instead of
 * on assigned Role name - BOSS has no mfgRole, so that decorator can't express "BOSS only".
 */
export const RequireRole = (...roles: BusinessRole[]) => SetMetadata(ROLE_KEY, roles);
