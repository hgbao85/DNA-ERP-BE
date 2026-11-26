import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ROLE_KEY } from '../../common/decorators/require-role.decorator';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
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

  // 26/11/2026: danh mục xưởng là dữ liệu tham chiếu - mọi người dùng đã đăng nhập đọc được (JwtAuthGuard toàn cục vẫn bắt
  // đăng nhập). Không gác theo module / vai nào, để tổ trưởng Hàn / Sơn không còn bị 403.
  it('KHÔNG đòi quyền module hay vai nào (chỉ cần đăng nhập)', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.findAll as object)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSIONS_KEY, WorkshopsController)).toBeUndefined();
    expect(Reflect.getMetadata(ROLE_KEY, proto.findAll as object)).toBeUndefined();
    expect(Reflect.getMetadata(ROLE_KEY, WorkshopsController)).toBeUndefined();
  });

  it('findAll trả kết quả của service.findActive', async () => {
    const list = [{ id: '1' }];
    const ctrl = new WorkshopsController({
      findActive: jest.fn().mockResolvedValue(list),
    } as never);
    await expect(ctrl.findAll()).resolves.toBe(list);
  });
});
