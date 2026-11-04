/* eslint-disable @typescript-eslint/unbound-method --
   Đọc metadata (Reflect) gắn trên hàm xử lý route, không bao giờ gọi hàm - cùng cách `auth.controller.spec.ts`. */
import 'reflect-metadata';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { ROLE_KEY } from '../../common/decorators/require-role.decorator';
import { SkusController } from './skus.controller';

describe('SkusController - metadata PATCH :id/container-load (Phần A – Đợt 1, YC9)', () => {
  const handler = SkusController.prototype.updateContainerLoad;

  it('cho đúng 3 vai trò: Admin, KHSX, NV định mức chi tiết', () => {
    expect(Reflect.getMetadata(ROLE_KEY, handler)).toEqual([
      'ADMIN',
      'PRODUCTION_PLANNER',
      'SPEC_ACCESSORY_PACKAGING_STAFF',
    ]);
  });

  it('chỉ cần quyền SKU:VIEW (không thêm quyền mới)', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual([
      { module: PERMISSION_MODULES.SKU, action: PermissionAction.VIEW },
    ]);
  });

  it('class SkusController không đặt RequireRole cấp class (method không bị ghi đè ngược)', () => {
    expect(Reflect.getMetadata(ROLE_KEY, SkusController)).toBeUndefined();
  });
});
