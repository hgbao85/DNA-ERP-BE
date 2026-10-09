import { RecipientResolverService } from './recipient-resolver.service';

describe('RecipientResolverService - warehouseScopeRoles', () => {
  const makeService = (rows: Record<string, { id: string }[]>) => {
    const findMany = jest.fn((args: { where: Record<string, unknown> }) => {
      const key = 'warehouseScope' in args.where ? 'warehouse' : 'other';
      return Promise.resolve(rows[key] ?? []);
    });
    const service = new RecipientResolverService({ user: { findMany } } as never);
    return { service, findMany };
  };

  it('không có warehouseScopeRoles: lọc theo kho như cũ (không ràng buộc role)', async () => {
    const { service, findMany } = makeService({ warehouse: [{ id: 'u1' }] });
    const ids = await service.resolve({ warehouseIds: ['VTTP'] });
    expect(ids).toEqual(['u1']);
    const where = findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ warehouseScope: { in: ['VTTP'] } });
    expect(where).not.toHaveProperty('roles');
  });

  it('có warehouseScopeRoles: nhóm kho CHỈ gồm user có role đó (không báo cho Mua hàng cùng kho)', async () => {
    const { service, findMany } = makeService({ warehouse: [{ id: 'thu-kho' }] });
    const ids = await service.resolve({
      warehouseIds: ['VTTP'],
      warehouseScopeRoles: ['WAREHOUSE_STAFF'],
    });
    expect(ids).toEqual(['thu-kho']);
    expect(findMany.mock.calls[0][0].where).toMatchObject({
      warehouseScope: { in: ['VTTP'] },
      roles: { some: { role: { name: { in: ['WAREHOUSE_STAFF'] } } } },
    });
  });

  it('có warehouseScopeExcludeRoles: loại Mua hàng (dù cũng giữ role thủ kho) khỏi nhóm kho', async () => {
    const { service, findMany } = makeService({ warehouse: [{ id: 'thu-kho-thuan' }] });
    await service.resolve({
      warehouseIds: ['VTTP'],
      warehouseScopeRoles: ['WAREHOUSE_STAFF'],
      warehouseScopeExcludeRoles: ['PURCHASER'],
    });
    expect(findMany.mock.calls[0][0].where).toMatchObject({
      NOT: { roles: { some: { role: { name: { in: ['PURCHASER'] } } } } },
    });
  });

  it('warehouseScopeRoles không ảnh hưởng nhóm roles riêng (OR giữa các nhóm)', async () => {
    const { service } = makeService({ warehouse: [{ id: 'a' }], other: [{ id: 'b' }] });
    const ids = await service.resolve({
      roles: ['PRODUCTION_MANAGER'],
      warehouseIds: ['VTTP'],
      warehouseScopeRoles: ['WAREHOUSE_STAFF'],
    });
    expect(ids.sort()).toEqual(['a', 'b']);
  });
});

describe('RecipientResolverService - excludeRoles', () => {
  it('loại khỏi KẾT QUẢ CUỐI user có role bị loại (vd Mua hàng giữ chung role thủ kho)', async () => {
    const findMany = jest.fn((args: { where: Record<string, unknown> }) => {
      const where = args.where;
      if ('id' in where) return Promise.resolve([{ id: 'mua-hang' }]); // truy vấn tìm người bị loại
      return Promise.resolve([{ id: 'thu-kho' }, { id: 'mua-hang' }]);
    });
    const service = new RecipientResolverService({ user: { findMany } } as never);

    const ids = await service.resolve({
      roles: ['WAREHOUSE_STAFF'],
      excludeRoles: ['PURCHASER'],
    });

    expect(ids).toEqual(['thu-kho']);
    expect(findMany.mock.calls[1][0].where).toMatchObject({
      roles: { some: { role: { name: { in: ['PURCHASER'] } } } },
    });
  });

  it('không có excludeRoles -> không truy vấn thêm', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'a' }]);
    const service = new RecipientResolverService({ user: { findMany } } as never);

    await service.resolve({ roles: ['KCS_STAFF'] });

    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
