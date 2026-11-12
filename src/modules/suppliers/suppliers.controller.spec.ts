import 'reflect-metadata';
import { ROLE_KEY } from '../../common/decorators/require-role.decorator';
import { DEFAULT_ROLES } from '../../common/constants/roles.constant';
import { SuppliersController } from './suppliers.controller';

// Đọc metadata trên function, không gọi như method - an toàn với unbound-method.
/* eslint-disable @typescript-eslint/unbound-method */
function rolesOf(method: keyof SuppliersController): unknown {
  return Reflect.getMetadata(ROLE_KEY, SuppliersController.prototype[method]);
}
/* eslint-enable @typescript-eslint/unbound-method */

describe('SuppliersController - quyền theo vai trò (12/11/2026, anh Nhân)', () => {
  it('xoá NCC chỉ Admin', () => {
    expect(rolesOf('remove')).toEqual([DEFAULT_ROLES.ADMIN]);
  });

  it.each(['create', 'update', 'findAll'] as const)(
    '%s không giới hạn vai trò (người mua tự thêm/sửa NCC)',
    (method) => {
      expect(rolesOf(method)).toBeUndefined();
    },
  );
});
