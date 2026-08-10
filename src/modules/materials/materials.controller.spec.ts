import 'reflect-metadata';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import {
  PERMISSIONS_KEY,
  RequiredPermission,
} from '../../common/decorators/require-permissions.decorator';
import { MaterialsController } from './materials.controller';

// Reading metadata off the function object below, never calling it as a method, so `this`
// binding does not matter - safe to ignore unbound-method here.
/* eslint-disable @typescript-eslint/unbound-method */
function permissionsOf(method: keyof MaterialsController): RequiredPermission[] {
  const handler = MaterialsController.prototype[method];
  return Reflect.getMetadata(PERMISSIONS_KEY, handler) as RequiredPermission[];
}
/* eslint-enable @typescript-eslint/unbound-method */

describe('MaterialsController permissions', () => {
  it('gates plain material edit by MATERIAL:UPDATE', () => {
    expect(permissionsOf('update')).toEqual([
      { module: PERMISSION_MODULES.MATERIAL, action: PermissionAction.UPDATE },
    ]);
  });

  // Rủi ro #2: các route lồng .../materials/:id/suppliers quản lý bảng nối MaterialSupplier,
  // không phải entity Material - phải gắn permission module SUPPLIER (không phải MATERIAL),
  // nếu không PURCHASER (chỉ cần quyền quản lý NCC) sẽ vô tình có luôn quyền sửa vật tư gốc.
  it.each([
    ['addSupplier', PermissionAction.CREATE],
    ['listSuppliers', PermissionAction.VIEW],
    ['updateSupplier', PermissionAction.UPDATE],
    ['removeSupplier', PermissionAction.DELETE],
  ] as const)('gates %s by SUPPLIER:%s (not MATERIAL)', (method, action) => {
    expect(permissionsOf(method)).toEqual([{ module: PERMISSION_MODULES.SUPPLIER, action }]);
  });
});
