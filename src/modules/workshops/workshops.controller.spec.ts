import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import {
  PERMISSIONS_KEY,
  RequiredPermission,
} from '../../common/decorators/require-permissions.decorator';
import { WorkshopsController } from './workshops.controller';

describe('WorkshopsController - quyền', () => {
  const proto = WorkshopsController.prototype as unknown as Record<string, unknown>;
  const routes = Object.getOwnPropertyNames(WorkshopsController.prototype).filter(
    (n) => n !== 'constructor',
  );

  it('chỉ có đúng 1 route GET /workshops', () => {
    expect(routes).toEqual(['findAll']);
    const handler = proto.findAll as object;
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('/');
    expect(Reflect.getMetadata(PATH_METADATA, WorkshopsController)).toBe('workshops');
  });

  it('cần quyền xem Lệnh sản xuất (PRODUCTION_INVOICE.VIEW)', () => {
    const perms = Reflect.getMetadata(PERMISSIONS_KEY, proto.findAll as object) as
      RequiredPermission[] | undefined;
    expect(perms).toEqual([
      { module: PERMISSION_MODULES.PRODUCTION_INVOICE, action: PermissionAction.VIEW },
    ]);
  });

  it('findAll trả kết quả của service.findActive', async () => {
    const list = [{ id: '1' }];
    const ctrl = new WorkshopsController({
      findActive: jest.fn().mockResolvedValue(list),
    } as never);
    await expect(ctrl.findAll()).resolves.toBe(list);
  });
});
