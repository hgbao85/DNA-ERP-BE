import { RecipientResolverService } from './recipient-resolver.service';

describe('RecipientResolverService - warehouseScopeRoles', () => {
  const makeService = (rows: Record<string, { id: string }[]>) => {
    const findMany = jest.fn((args: { where: Record<string, unknown> }) => {
      const key = 'warehouseScope' in args.where || 'OR' in args.where ? 'warehouse' : 'other';
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
    // Đợt 7: kho đang làm HOẶC nằm trong danh sách kho người đó giữ.
    expect(where).toMatchObject({
      OR: [{ warehouseScope: { in: ['VTTP'] } }, { warehouseScopes: { hasSome: ['VTTP'] } }],
    });
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
      OR: [{ warehouseScope: { in: ['VTTP'] } }, { warehouseScopes: { hasSome: ['VTTP'] } }],
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

// QLSX theo xưởng (2026-11-12): thông báo về lệnh Phước An không tới QLSX Phú An đã gắn xưởng.
describe('RecipientResolverService - dropQlsxOfOtherWorkshops', () => {
  const PHU_AN = 1n;
  const PHUOC_AN = 2n;
  const ALL = ['qlsx-phu', 'qlsx-pa', 'qlsx-chua-gan', 'thu-kho'];

  const makeService = (opts: {
    scoped?: { id: string; workshopId: bigint }[];
    itemWorkshops?: (bigint | null)[];
    piByCode?: { id: bigint } | null;
    proposal?: { productionOrderId: bigint | null; productionInvoiceId: bigint | null } | null;
  }) => {
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue(
          opts.scoped ?? [
            { id: 'qlsx-phu', workshopId: PHU_AN },
            { id: 'qlsx-pa', workshopId: PHUOC_AN },
          ],
        ),
      },
      productionInvoice: { findUnique: jest.fn().mockResolvedValue(opts.piByCode ?? null) },
      productionOrder: { findUnique: jest.fn().mockResolvedValue(null) },
      cuttingProposal: { findUnique: jest.fn().mockResolvedValue(opts.proposal ?? null) },
      productionInvoiceItem: {
        findMany: jest
          .fn()
          .mockResolvedValue((opts.itemWorkshops ?? []).map((workshopId) => ({ workshopId }))),
      },
    };
    return { service: new RecipientResolverService(prisma as never), prisma };
  };

  it('thông báo về lệnh Phước An (theo mã PI): bỏ QLSX Phú An đã gắn xưởng, giữ QLSX Phước An + QLSX chưa gắn + vai khác', async () => {
    const { service, prisma } = makeService({ piByCode: { id: 7n }, itemWorkshops: [PHUOC_AN] });

    const ids = await service.dropQlsxOfOtherWorkshops(ALL, {
      entityType: 'PURCHASE_PROPOSAL',
      entityId: '99',
      params: { piCode: 'PI-2026-007' },
    });

    expect(ids).toEqual(['qlsx-pa', 'qlsx-chua-gan', 'thu-kho']);
    // Chỉ xét user ĐÃ gắn xưởng và là QLSX (role hoặc mfgRole).
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ALL },
        workshopId: { not: null },
        OR: [
          { roles: { some: { role: { name: 'PRODUCTION_MANAGER' } } } },
          { mfgRole: 'PRODUCTION_MANAGER' },
        ],
      },
      select: { id: true, workshopId: true },
    });
  });

  it('QLSX Phú An (xưởng sơn nhờ) cũng không nhận thông báo lệnh Phước An', async () => {
    const { service } = makeService({ piByCode: { id: 7n }, itemWorkshops: [PHUOC_AN] });

    const ids = await service.dropQlsxOfOtherWorkshops(['qlsx-phu'], {
      params: { piCode: 'PI-2026-007' },
    });

    expect(ids).toEqual([]);
  });

  it('theo entityType PRODUCTION_INVOICE / PRODUCTION_INVOICE_ITEM / PRODUCTION_ORDER (không có piCode)', async () => {
    for (const entityType of [
      'PRODUCTION_INVOICE',
      'PRODUCTION_INVOICE_ITEM',
      'PRODUCTION_ORDER',
    ]) {
      const { service } = makeService({ itemWorkshops: [PHU_AN] });

      const ids = await service.dropQlsxOfOtherWorkshops(ALL, { entityType, entityId: '5' });

      expect(ids).toEqual(['qlsx-phu', 'qlsx-chua-gan', 'thu-kho']);
    }
  });

  it('đề xuất cắt sắt: tra xưởng qua lệnh sản xuất của đề xuất', async () => {
    const { service, prisma } = makeService({
      proposal: { productionOrderId: 9n, productionInvoiceId: null },
      itemWorkshops: [PHUOC_AN],
    });

    const ids = await service.dropQlsxOfOtherWorkshops(ALL, {
      entityType: 'CUTTING_PROPOSAL',
      entityId: '3',
    });

    expect(ids).toEqual(['qlsx-pa', 'qlsx-chua-gan', 'thu-kho']);
    expect(prisma.productionInvoiceItem.findMany).toHaveBeenCalledWith({
      where: { productionOrder: { is: { id: 9n } } },
      select: { workshopId: true },
    });
  });

  it('không gắn được với lệnh nào (vd bản tin buổi sáng): giữ nguyên mọi người nhận', async () => {
    const { service } = makeService({});

    const ids = await service.dropQlsxOfOtherWorkshops(ALL, {
      entityType: 'MORNING_DIGEST',
      entityId: '2026-11-12',
      params: { late: 1 },
    });

    expect(ids).toEqual(ALL);
  });

  it('lệnh chưa có xưởng (SKU cũ, workshopId null): giữ nguyên mọi người nhận', async () => {
    const { service } = makeService({ itemWorkshops: [null] });

    const ids = await service.dropQlsxOfOtherWorkshops(ALL, {
      entityType: 'PRODUCTION_INVOICE_ITEM',
      entityId: '5',
    });

    expect(ids).toEqual(ALL);
  });

  it('không có QLSX nào đã gắn xưởng trong người nhận: không tra lệnh, giữ nguyên', async () => {
    const { service, prisma } = makeService({ scoped: [] });

    const ids = await service.dropQlsxOfOtherWorkshops(ALL, {
      entityType: 'PRODUCTION_INVOICE',
      entityId: '5',
    });

    expect(ids).toEqual(ALL);
    expect(prisma.productionInvoiceItem.findMany).not.toHaveBeenCalled();
  });
});
