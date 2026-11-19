import { ForbiddenException } from '@nestjs/common';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../constants/roles.constant';

const SYSTEM_ROLE_NAMES = new Set<string>([
  ...Object.values(DEFAULT_ROLES),
  ...Object.values(BUSINESS_ROLES),
]);

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

/**
 * BM2 19/11: vai trò hệ thống (ADMIN + BUSINESS_ROLES) được nhận diện theo TÊN khắp code (@RequireRole(BOSS), "tổng kho"…) -
 * người không phải ADMIN đổi tên vai trò BOSS rồi đổi tên vai trò của mình thành BOSS là leo quyền. Cấm đổi tên vai trò
 * hệ thống và cấm đặt tên vai trò khác trùng tên hệ thống.
 */
export function assertNotRenamingSystemRole(
  actor: PrivilegeActor,
  currentName: string,
  newName: string | undefined,
): void {
  if (isAdminActor(actor) || newName === undefined || newName === currentName) return;
  if (SYSTEM_ROLE_NAMES.has(currentName)) {
    throw new ForbiddenException(
      `Chỉ quản trị viên (ADMIN) mới được đổi tên vai trò hệ thống ${currentName}`,
    );
  }
  if (SYSTEM_ROLE_NAMES.has(newName)) {
    throw new ForbiddenException(
      `Chỉ quản trị viên (ADMIN) mới được đặt tên vai trò là ${newName} (tên vai trò hệ thống)`,
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
