import { ForbiddenException } from '@nestjs/common';
import { DEFAULT_ROLES } from '../constants/roles.constant';

/**
 * B1 (danh sách lỗi 16/11) - chặn leo thang quyền qua quản lý tài khoản / vai trò. Trước đây ai có USER:UPDATE gán được mọi
 * vai trò kể cả ADMIN cho người khác (chỉ chặn tự sửa mình), ai có ROLE:UPDATE cấp được mọi quyền. Hiện chỉ ADMIN có 2 quyền
 * này, nhưng chỉ cần cấp USER:UPDATE cho 1 vai trò khác là lỗ mở ra - chặn ở BE thay vì trông vào cấu hình.
 *
 * Luật: người thao tác là ADMIN -> không hạn chế. Người khác:
 *  - không gán/bỏ vai trò ADMIN, không đụng tài khoản ADMIN (sửa, đặt lại mật khẩu, xoá), không sửa/xoá vai trò ADMIN;
 *  - chỉ cấp được quyền chính mình đang có (gán vai trò mới cho người khác / thêm quyền vào vai trò).
 */
export interface PrivilegeActor {
  id: string;
  roles: string[];
  permissions: string[];
}

export function isAdminActor(actor: PrivilegeActor): boolean {
  return actor.roles.includes(DEFAULT_ROLES.ADMIN);
}

/** `codes` dạng "MODULE:ACTION". */
export function assertCanGrantPermissions(
  actor: PrivilegeActor,
  codes: Iterable<string>,
  what: string,
): void {
  if (isAdminActor(actor)) return;
  const held = new Set(actor.permissions);
  const missing = [...new Set(codes)].filter((c) => !held.has(c)).sort();
  if (missing.length > 0) {
    throw new ForbiddenException(
      `Không thể ${what}: chỉ cấp được quyền chính bạn đang có - thiếu ${missing.join(', ')}`,
    );
  }
}

export function assertNotAdminRoleUnlessAdmin(
  actor: PrivilegeActor,
  roleNames: Iterable<string>,
  what: string,
): void {
  if (isAdminActor(actor)) return;
  for (const name of roleNames) {
    if (name === DEFAULT_ROLES.ADMIN) {
      throw new ForbiddenException(`Chỉ quản trị viên (ADMIN) mới được ${what}`);
    }
  }
}
