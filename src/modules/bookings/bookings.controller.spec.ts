/* eslint-disable @typescript-eslint/unbound-method -- đọc metadata decorator từ prototype */
import { Reflector } from '@nestjs/core';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { ROLE_KEY } from '../../common/decorators/require-role.decorator';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../common/constants/roles.constant';
import { BookingsController } from './bookings.controller';

/** Phần A – Đợt 10a: ghi booking chỉ Sales + Admin (WAREHOUSE_STAFF cũng có SALES_ORDER:UPDATE nên phải chặn theo vai trò). */
describe('BookingsController (Phần A – Đợt 10a)', () => {
  const reflector = new Reflector();
  const proto = BookingsController.prototype;
  const meta = <T>(key: string, handler: (...args: never[]) => unknown): T | undefined =>
    reflector.get<T>(key, handler);

  it.each([
    ['create', proto.create, PermissionAction.CREATE],
    ['update', proto.update, PermissionAction.UPDATE],
    ['confirm', proto.confirm, PermissionAction.UPDATE],
    ['cancel', proto.cancel, PermissionAction.UPDATE],
  ])('%s: quyền SALES_ORDER + vai trò [SALES_STAFF, ADMIN]', (_name, handler, action) => {
    expect(meta(PERMISSIONS_KEY, handler)).toEqual([
      { module: PERMISSION_MODULES.SALES_ORDER, action },
    ]);
    expect(meta(ROLE_KEY, handler)).toEqual([BUSINESS_ROLES.SALES_STAFF, DEFAULT_ROLES.ADMIN]);
  });

  it.each([
    ['findAll', proto.findAll],
    ['getMeta', proto.getMeta],
    ['getCandidates', proto.getCandidates],
    ['findOne', proto.findOne],
  ])('%s: chỉ cần SALES_ORDER:VIEW, không chặn vai trò', (_name, handler) => {
    expect(meta(PERMISSIONS_KEY, handler)).toEqual([
      { module: PERMISSION_MODULES.SALES_ORDER, action: PermissionAction.VIEW },
    ]);
    expect(meta(ROLE_KEY, handler)).toBeUndefined();
  });

  it('route tĩnh (meta, candidates) khai trước :id', () => {
    const names = Object.getOwnPropertyNames(proto);
    expect(names.indexOf('getMeta')).toBeLessThan(names.indexOf('findOne'));
    expect(names.indexOf('getCandidates')).toBeLessThan(names.indexOf('findOne'));
  });
});
