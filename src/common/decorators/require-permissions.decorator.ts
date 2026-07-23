import { SetMetadata } from '@nestjs/common';
import { PermissionAction } from '@prisma/client';
import { PermissionModule } from '../constants/permission-modules.constant';

export const PERMISSIONS_KEY = 'requiredPermissions';

export interface RequiredPermission {
  module: PermissionModule;
  action: PermissionAction;
}

/** Requires the caller's JWT to carry ALL of the given module+action permissions. */
export const RequirePermissions = (...permissions: RequiredPermission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
