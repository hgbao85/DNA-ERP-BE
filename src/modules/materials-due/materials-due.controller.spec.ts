import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { MaterialsDueController } from './materials-due.controller';

describe('MaterialsDueController', () => {
  const user: AuthenticatedUser = {
    id: 'u1',
    username: 'u1',
    email: null,
    roles: ['PURCHASER'],
    permissions: [],
    mfgRole: null,
    warehouseScope: null,
  };

  it('chuyển query + người gọi sang service, trả nguyên kết quả', async () => {
    const response = { rows: [] };
    const service = { list: jest.fn().mockResolvedValue(response) };
    const controller = new MaterialsDueController(service as never);

    const query = { view: 'date' as const, date: '2026-11-10', scope: 'all' as const };
    await expect(controller.list(query, user)).resolves.toBe(response);
    expect(service.list).toHaveBeenCalledWith(user, query);
  });

  it('gắn quyền PURCHASE_PROPOSAL:VIEW', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- chỉ đọc metadata của handler, không gọi
    const handler = MaterialsDueController.prototype.list;
    const meta = Reflect.getMetadataKeys(handler)
      .map((k) => Reflect.getMetadata(k, handler) as unknown)
      .flat();
    expect(JSON.stringify(meta)).toContain(PERMISSION_MODULES.PURCHASE_PROPOSAL);
    expect(JSON.stringify(meta)).toContain('VIEW');
  });
});
