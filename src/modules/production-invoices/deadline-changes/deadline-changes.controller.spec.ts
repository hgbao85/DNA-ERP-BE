/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-floating-promises -- đọc metadata decorator từ prototype; service mock trả undefined */
import { Reflector } from '@nestjs/core';
import { PermissionAction } from '../../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../../common/constants/permission-modules.constant';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../../common/constants/roles.constant';
import { PERMISSIONS_KEY } from '../../../common/decorators/require-permissions.decorator';
import { ROLE_KEY } from '../../../common/decorators/require-role.decorator';
import { DeadlineChangesController } from './deadline-changes.controller';
import { DeadlineChangesService } from './deadline-changes.service';

describe('DeadlineChangesController (Phần A – Đợt 9)', () => {
  const reflector = new Reflector();
  const proto = DeadlineChangesController.prototype;
  const perm = (action: PermissionAction) => [
    { module: PERMISSION_MODULES.PRODUCTION_INVOICE, action },
  ];

  it('GET list / GET :id / history → PRODUCTION_INVOICE:VIEW, không giới hạn role', () => {
    for (const h of [proto.list, proto.get, proto.history]) {
      expect(reflector.get(PERMISSIONS_KEY, h)).toEqual(perm(PermissionAction.VIEW));
      expect(reflector.get(ROLE_KEY, h)).toBeUndefined();
    }
  });

  it('POST :id/decide → APPROVE + chỉ BOSS', () => {
    expect(reflector.get(PERMISSIONS_KEY, proto.decide)).toEqual(perm(PermissionAction.APPROVE));
    expect(reflector.get(ROLE_KEY, proto.decide)).toEqual([BUSINESS_ROLES.BOSS]);
  });

  it('POST requests/:requestId/cancel → UPDATE + KHSX hoặc ADMIN', () => {
    expect(reflector.get(PERMISSIONS_KEY, proto.cancel)).toEqual(perm(PermissionAction.UPDATE));
    expect(reflector.get(ROLE_KEY, proto.cancel)).toEqual([
      BUSINESS_ROLES.PRODUCTION_PLANNER,
      DEFAULT_ROLES.ADMIN,
    ]);
  });

  it('truyền actor + tham số xuống service', () => {
    const service = {
      listBatches: jest.fn(),
      decide: jest.fn(),
      cancelRequest: jest.fn(),
      historyOf: jest.fn(),
      getBatch: jest.fn(),
    };
    const controller = new DeadlineChangesController(service as unknown as DeadlineChangesService);
    const user = { id: 'u1', roles: ['BOSS'] } as never;
    controller.list({ status: 'ALL', mine: true }, user);
    expect(service.listBatches).toHaveBeenCalledWith(
      { id: 'u1', roles: ['BOSS'] },
      { status: 'ALL', mine: true },
    );
    controller.decide('5', { approveRequestIds: ['1'], rejectReason: 'x' }, user);
    expect(service.decide).toHaveBeenCalledWith({ id: 'u1', roles: ['BOSS'] }, '5', {
      approveRequestIds: ['1'],
      rejectReason: 'x',
    });
    controller.cancel('9', user);
    expect(service.cancelRequest).toHaveBeenCalledWith({ id: 'u1', roles: ['BOSS'] }, '9');
    controller.history('3');
    expect(service.historyOf).toHaveBeenCalledWith('3');
  });
});
