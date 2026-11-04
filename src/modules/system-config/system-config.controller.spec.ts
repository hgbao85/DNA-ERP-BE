/* eslint-disable @typescript-eslint/unbound-method --
   Đọc metadata (Reflect) gắn trên hàm xử lý route, không bao giờ gọi hàm - cùng cách `auth.controller.spec.ts`. */
import 'reflect-metadata';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { ROLE_KEY } from '../../common/decorators/require-role.decorator';
import { SystemConfigController } from './system-config.controller';

describe('SystemConfigController - GET planning-params (Phần A – Đợt 1, YC9)', () => {
  it('mọi người đã đăng nhập đọc được: không khai quyền / vai trò riêng (PermissionsGuard cho qua)', () => {
    const handler = SystemConfigController.prototype.getPlanningParams;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSIONS_KEY, SystemConfigController)).toBeUndefined();
    expect(Reflect.getMetadata(ROLE_KEY, handler)).toBeUndefined();
  });
});
