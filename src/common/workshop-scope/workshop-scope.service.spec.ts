import { ForbiddenException } from '@nestjs/common';
import { WorkshopScopeService } from './workshop-scope.service';

const make = (user: unknown) =>
  new WorkshopScopeService({ user: { findUnique: jest.fn().mockResolvedValue(user) } } as never);

describe('WorkshopScopeService', () => {
  it('không đăng nhập / chưa gắn xưởng -> không giới hạn', async () => {
    const svc = make({ workshopId: null, workshop: null });
    const scope = await svc.getScope('u1');
    expect(scope.workshopId).toBeNull();
    expect(svc.itemWhere(scope)).toBeUndefined();
    expect(svc.canManage(scope, 2n)).toBe(true);
    expect((await svc.getScope(null)).visibleWorkshopIds).toBeNull();
  });

  it('QLSX Phú An (sơn nhờ cho Phước An) xem được 2 xưởng nhưng chỉ thao tác Phú An', async () => {
    const svc = make({
      workshopId: 1n,
      workshop: { name: 'Xưởng Phú An', paintsFor: [{ id: 2n }] },
    });
    const scope = await svc.getScope('u1');
    expect(scope.visibleWorkshopIds).toEqual([1n, 2n]);
    expect(svc.itemWhere(scope)).toEqual({
      OR: [{ workshopId: null }, { workshopId: { in: [1n, 2n] } }],
    });
    expect(svc.canView(scope, 2n)).toBe(true);
    expect(svc.canManage(scope, 2n)).toBe(false);
    expect(svc.canManage(scope, null)).toBe(true);
    expect(() => svc.assertCanManage(scope, [1n, null])).not.toThrow();
    expect(() => svc.assertCanManage(scope, [1n, 2n])).toThrow(ForbiddenException);
  });

  it('QLSX Phước An chỉ xem Phước An', async () => {
    const svc = make({ workshopId: 2n, workshop: { name: 'Xưởng Phước An', paintsFor: [] } });
    const scope = await svc.getScope('u2');
    expect(scope.visibleWorkshopIds).toEqual([2n]);
    expect(svc.canView(scope, 1n)).toBe(false);
  });
});
