import { MaterialDetailKind, ProdItemStageType } from '../../generated/prisma/client';
import type { PrismaTx } from '../../prisma/prisma.service';
import {
  loadSkuPriorityHoldback,
  ranksBefore,
  SiblingOrder,
  skuHoldbackMessage,
} from './sku-priority.util';

const d = (s: string) => new Date(`${s}T00:00:00+07:00`);

function item(
  id: bigint,
  opts: { lsx?: string; material?: string; finished?: string; packaging?: string } = {},
) {
  return {
    id,
    lsxCode: opts.lsx ?? null,
    materialDeadline: opts.material ? d(opts.material) : null,
    finishedMaterialDeadline: opts.finished ? d(opts.finished) : null,
    stages: opts.packaging
      ? [{ stageType: ProdItemStageType.PACKAGING, deadline: d(opts.packaging) }]
      : [],
    productionInvoice: { deadline: null },
  };
}

function sibling(id: bigint, it: ReturnType<typeof item>) {
  return {
    id,
    poNumber: `PO-${id}`,
    bomRevisionId: 7n,
    quantity: 10,
    wireMaterialId: null,
    cushionMaterialId: null,
    productionInvoiceItem: it,
  };
}

function fakeTx(opts: {
  siblings: ReturnType<typeof sibling>[];
  own: ReturnType<typeof item>;
  detailKind?: MaterialDetailKind | null;
}) {
  return {
    productionOrder: { findMany: jest.fn().mockResolvedValue(opts.siblings) },
    productionInvoiceItem: { findUniqueOrThrow: jest.fn().mockResolvedValue(opts.own) },
    material: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ detailKind: opts.detailKind ?? null }),
    },
  };
}

const base = {
  orderId: 1n,
  productionInvoiceItemId: 11n,
  productionInvoiceId: 500n,
  materialId: 30n,
};

describe('ranksBefore', () => {
  it('hạn sớm hơn xếp trước, bằng hạn thì dòng vào trước, chưa có hạn xếp cuối', () => {
    expect(
      ranksBefore(
        { deadline: d('2026-11-10'), itemId: 9n },
        { deadline: d('2026-11-12'), itemId: 1n },
      ),
    ).toBe(true);
    expect(
      ranksBefore(
        { deadline: d('2026-11-12'), itemId: 1n },
        { deadline: d('2026-11-10'), itemId: 9n },
      ),
    ).toBe(false);
    expect(
      ranksBefore(
        { deadline: d('2026-11-10'), itemId: 1n },
        { deadline: d('2026-11-10'), itemId: 2n },
      ),
    ).toBe(true);
    expect(
      ranksBefore(
        { deadline: d('2026-11-10'), itemId: 2n },
        { deadline: d('2026-11-10'), itemId: 1n },
      ),
    ).toBe(false);
    expect(
      ranksBefore({ deadline: d('2026-12-31'), itemId: 9n }, { deadline: null, itemId: 1n }),
    ).toBe(true);
    expect(
      ranksBefore({ deadline: null, itemId: 1n }, { deadline: d('2026-12-31'), itemId: 9n }),
    ).toBe(false);
  });
});

describe('loadSkuPriorityHoldback', () => {
  it('PI 1 SKU (không có SKU khác) - không chừa gì, không đọc thêm', async () => {
    const tx = fakeTx({ siblings: [], own: item(11n) });
    const remainingOf = jest.fn();
    const res = await loadSkuPriorityHoldback(tx as unknown as PrismaTx, { ...base, remainingOf });
    expect(res).toEqual({ qty: 0, holders: [] });
    expect(remainingOf).not.toHaveBeenCalled();
    expect(tx.productionInvoiceItem.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('chỉ tìm SKU khác CÙNG PI, chưa Kết thúc', async () => {
    const tx = fakeTx({ siblings: [], own: item(11n) });
    await loadSkuPriorityHoldback(tx as unknown as PrismaTx, { ...base, remainingOf: jest.fn() });
    expect(tx.productionOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { not: 1n },
          floorStage: { not: 'FINISHED' },
          productionInvoiceItem: { productionInvoiceId: 500n },
        },
      }),
    );
  });

  it('ví dụ v8 PI-045: X cần 10/11, Y cần 12/11 - xuất cho Y phải chừa phần X còn cần', async () => {
    const x = sibling(2n, item(12n, { lsx: 'MY-313', material: '2026-11-10' }));
    const tx = fakeTx({ siblings: [x], own: item(11n, { lsx: 'MY-314', material: '2026-11-12' }) });
    const remainingOf = jest.fn((s: SiblingOrder) => Promise.resolve(s.id === 2n ? 8 : 0));
    const res = await loadSkuPriorityHoldback(tx as unknown as PrismaTx, { ...base, remainingOf });
    expect(res.qty).toBe(8);
    expect(res.holders).toEqual([
      { productionOrderId: '2', lenhCode: 'MY-313', deadline: d('2026-11-10'), qty: 8 },
    ]);
    expect(remainingOf).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2n, bomRevisionId: 7n, quantity: 10 }),
    );
  });

  it('xuất cho X (SKU sớm hơn) thì không chừa cho Y', async () => {
    const y = sibling(3n, item(13n, { material: '2026-11-12' }));
    const tx = fakeTx({ siblings: [y], own: item(11n, { material: '2026-11-10' }) });
    const remainingOf = jest.fn().mockResolvedValue(8);
    const res = await loadSkuPriorityHoldback(tx as unknown as PrismaTx, { ...base, remainingOf });
    expect(res.qty).toBe(0);
    expect(remainingOf).not.toHaveBeenCalled();
  });

  it('SKU sớm hơn đã xuất đủ (còn cần ≤ 0) - không chừa', async () => {
    const x = sibling(2n, item(12n, { material: '2026-11-10' }));
    const tx = fakeTx({ siblings: [x], own: item(11n, { material: '2026-11-12' }) });
    const res = await loadSkuPriorityHoldback(tx as unknown as PrismaTx, {
      ...base,
      remainingOf: jest.fn().mockResolvedValue(-2),
    });
    expect(res).toEqual({ qty: 0, holders: [] });
  });

  it('vật tư đóng gói xếp theo hạn VT còn lại (Đóng gói), không theo hạn khung', async () => {
    // X: khung sớm hơn nhưng đóng gói MUỘN hơn Y -> với thùng carton, Y (lệnh đang xuất) được trước, không chừa cho X.
    const x = sibling(2n, item(12n, { material: '2026-11-05', packaging: '2026-11-25' }));
    const own = item(11n, { material: '2026-11-07', packaging: '2026-11-20' });
    const pack = fakeTx({ siblings: [x], own, detailKind: MaterialDetailKind.PACKAGING });
    const remainingOf = jest.fn().mockResolvedValue(5);
    expect(
      (await loadSkuPriorityHoldback(pack as unknown as PrismaTx, { ...base, remainingOf })).qty,
    ).toBe(0);
    // Cùng 2 SKU, vật tư khung (sơn) -> X sớm hơn, phải chừa.
    const frame = fakeTx({ siblings: [x], own, detailKind: null });
    expect(
      (await loadSkuPriorityHoldback(frame as unknown as PrismaTx, { ...base, remainingOf })).qty,
    ).toBe(5);
  });

  it('bằng hạn thì dòng vào lệnh trước được ưu tiên; chưa có số LSX thì hiện số PO', async () => {
    const earlier = sibling(2n, item(10n, { material: '2026-11-10' }));
    const later = sibling(3n, item(12n, { material: '2026-11-10' }));
    const tx = fakeTx({ siblings: [earlier, later], own: item(11n, { material: '2026-11-10' }) });
    const res = await loadSkuPriorityHoldback(tx as unknown as PrismaTx, {
      ...base,
      remainingOf: jest.fn().mockResolvedValue(4),
    });
    expect(res.holders.map((h) => h.lenhCode)).toEqual(['PO-2']);
    expect(res.qty).toBe(4);
  });
});

describe('skuHoldbackMessage', () => {
  it('nêu số chừa, lệnh, ngày cần và phần còn xuất được', () => {
    const msg = skuHoldbackMessage(
      {
        qty: 8,
        holders: [
          { productionOrderId: '2', lenhCode: 'MY-313', deadline: d('2026-11-10'), qty: 8 },
        ],
      },
      10,
      5,
      'SON-01',
    );
    expect(msg).toContain('Tồn kho khả dụng 10 vật tư SON-01');
    expect(msg).toContain('đang chừa 8 cho lệnh MY-313 (cần 10/11)');
    expect(msg).toContain('chỉ còn xuất được 2, không đủ 5');
  });

  it('chừa nhiều hơn tồn thì còn xuất được 0, không âm', () => {
    const msg = skuHoldbackMessage(
      {
        qty: 30,
        holders: [{ productionOrderId: '2', lenhCode: 'MY-313', deadline: null, qty: 30 }],
      },
      10,
      1,
      'X',
    );
    expect(msg).toContain('cho lệnh MY-313 (chưa có hạn)');
    expect(msg).toContain('chỉ còn xuất được 0');
  });
});
