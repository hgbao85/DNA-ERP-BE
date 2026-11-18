import { groupStaleByQueueWorkshop, staleBucketKey } from './floor-stale.util';

describe('floor-stale.util', () => {
  // Xưởng 1 (An) nhờ xưởng 2 (Bình) sơn; xưởng 2 tự sơn.
  const makeDb = (opts?: {
    items?: Array<{ pi: bigint; ws: bigint }>;
    defaultWs?: bigint | null;
  }) => {
    const items = opts?.items ?? [
      { pi: 10n, ws: 1n },
      { pi: 20n, ws: 2n },
    ];
    const defaultWs = opts?.defaultWs === undefined ? 2n : opts.defaultWs;
    return {
      productionInvoiceItem: {
        findMany: jest
          .fn()
          .mockImplementation(({ where }: { where: { productionInvoiceId: { in: bigint[] } } }) => {
            const ids = where.productionInvoiceId.in;
            return Promise.resolve(
              items
                .filter((i) => ids.includes(i.pi))
                .map((i) => ({ productionInvoiceId: i.pi, workshopId: i.ws })),
            );
          }),
      },
      warehouse: {
        findUnique: jest
          .fn()
          .mockResolvedValue(defaultWs == null ? null : { workshopId: defaultWs }),
      },
      workshop: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { id: { in: bigint[] } } }) => {
          const ids = where.id.in;
          return Promise.resolve(ids.map((id) => ({ id, paintWorkshopId: id === 1n ? 2n : null })));
        }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
  };

  const key = (s: 'PHOI' | 'HAN' | 'SON', w: bigint | null) => staleBucketKey(s, w);

  it('staleBucketKey: <tổ>:<id xưởng | none>', () => {
    expect(staleBucketKey('SON', 2n)).toBe('SON:2');
    expect(staleBucketKey('PHOI', null)).toBe('PHOI:none');
  });

  it('AC6: lô Sơn lệnh xưởng An -> xưởng nơi sơn (Bình); Hàn lấy xưởng lệnh; Phôi lệnh Bình; dòng không lệnh -> null', async () => {
    const db = makeDb();
    const out = await groupStaleByQueueWorkshop(db as never, [
      { stage: 'SON', productionInvoiceId: 10n },
      { stage: 'HAN', productionInvoiceId: 10n },
      { stage: 'PHOI', productionInvoiceId: 20n },
      { stage: 'PHOI', productionInvoiceId: null },
    ]);
    const m = new Map(out.map((b) => [key(b.stage, b.workshopId), b.count]));
    expect(out).toHaveLength(4);
    expect(m.get('SON:2')).toBe(1);
    expect(m.get('HAN:1')).toBe(1);
    expect(m.get('PHOI:2')).toBe(1);
    expect(m.get('PHOI:none')).toBe(1);
  });

  it('nhiều dòng cùng lệnh cùng tổ cộng dồn', async () => {
    const out = await groupStaleByQueueWorkshop(makeDb() as never, [
      { stage: 'PHOI', productionInvoiceId: 10n },
      { stage: 'PHOI', productionInvoiceId: 10n },
      { stage: 'PHOI', productionInvoiceId: 10n },
    ]);
    expect(out).toEqual([{ stage: 'PHOI', workshopId: 1n, count: 3 }]);
  });

  it('danh sách rỗng -> []', async () => {
    expect(await groupStaleByQueueWorkshop(makeDb() as never, [])).toEqual([]);
  });

  it('lệnh không có xưởng -> xưởng mặc định; không có xưởng nào -> nhóm null', async () => {
    const noOwn = makeDb({ items: [], defaultWs: 2n });
    const a = await groupStaleByQueueWorkshop(noOwn as never, [
      { stage: 'HAN', productionInvoiceId: 99n },
    ]);
    expect(a).toEqual([{ stage: 'HAN', workshopId: 2n, count: 1 }]);

    const none = makeDb({ items: [], defaultWs: null });
    const b = await groupStaleByQueueWorkshop(none as never, [
      { stage: 'HAN', productionInvoiceId: 99n },
    ]);
    expect(b).toEqual([{ stage: 'HAN', workshopId: null, count: 1 }]);
  });
});
