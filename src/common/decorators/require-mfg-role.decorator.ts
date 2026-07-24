import { SetMetadata } from '@nestjs/common';
import { MfgRole } from '../../generated/prisma/client';

export const MFG_ROLE_KEY = 'requiredMfgRoles';

/**
 * Requires the caller's `User.mfgRole` to be one of the given roles. Layered on top
 * of (not instead of) `@RequirePermissions` - use for MES actions that only one
 * production role may perform (e.g. only mfgRole=PHOI may confirm a steel issue).
 */
export const RequireMfgRole = (...roles: MfgRole[]) => SetMetadata(MFG_ROLE_KEY, roles);
