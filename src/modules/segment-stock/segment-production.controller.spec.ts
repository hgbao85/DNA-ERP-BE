/* eslint-disable @typescript-eslint/unbound-method -- đọc metadata decorator từ prototype */
import { Reflector } from '@nestjs/core';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { ROLE_KEY } from '../../common/decorators/require-role.decorator';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { DEFAULT_ROLES } from '../../common/constants/roles.constant';
import { SegmentProductionController } from './segment-production.controller';

/** 20/11/2026 (T3-5): tính lại tồn đoạn là công cụ sửa lệch / backfill, chỉ Admin (cả xem thử). */
describe('SegmentProductionController', () => {
  const reflector = new Reflector();

  it('recompute: quyền STOCK:UPDATE và vai trò chỉ ADMIN', () => {
    const handler = SegmentProductionController.prototype.recompute;
    expect(reflector.get(PERMISSIONS_KEY, handler)).toEqual([
      { module: PERMISSION_MODULES.STOCK, action: PermissionAction.UPDATE },
    ]);
    expect(reflector.get(ROLE_KEY, handler)).toEqual([DEFAULT_ROLES.ADMIN]);
  });
});
