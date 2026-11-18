import type { AuthUserProfile } from '../users/users.service';

/** Quyền "MODULE:ACTION" của tài khoản (gộp từ mọi vai trò) - dùng khi cấp token và khi đối chiếu lại DB (LiveAuthService). */
export function derivePermissions(user: AuthUserProfile): string[] {
  const permissions = new Set<string>();
  for (const userRole of user.roles) {
    for (const rolePermission of userRole.role.permissions) {
      permissions.add(`${rolePermission.permission.module}:${rolePermission.permission.action}`);
    }
  }
  return [...permissions];
}

export function deriveRoleNames(user: AuthUserProfile): string[] {
  return user.roles.map((userRole) => userRole.role.name);
}
