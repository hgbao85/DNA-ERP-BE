import {
  loadSegmentProcessInfo,
  resolveProposalBomEntries,
  segmentStepKey,
  type ProposalBomSource,
} from './proposal-segment-info.util';

type Prisma = Parameters<typeof resolveProposalBomEntries>[0] &
  Parameters<typeof loadSegmentProcessInfo>[0];

describe('proposal-segment-info.util', () => {
  const src = (over: Partial<ProposalBomSource> & { id: bigint }): ProposalBomSource => ({
    productionInvoiceId: null,
    productionOrder: null,
    items: [],
    ...over,
  });

  describe('resolveProposalBomEntries', () => {
    it('items trước, rồi lệnh SX, rồi lệnh SX nạp sẵn của PI; không truy vấn thêm', async () => {
      const findMany = jest.fn();
      const prisma = { productionOrder: { findMany } } as unknown as Prisma;
      const map = await resolveProposalBomEntries(prisma, [
        src({ id: 1n, items: [{ bomRevisionId: 5n, quantity: 2 }] }),
        src({ id: 2n, productionOrder: { bomRevisionId: 6n, quantity: 3 } }),
        src({
          id: 3n,
          productionInvoiceId: 100n,
          invoiceOrders: [{ bomRevisionId: 7n, quantity: 4 }],
        }),
        src({ id: 4n }),
      ]);
      expect(map.get('1')).toEqual([{ bomRevisionId: 5n, quantity: 2 }]);
      expect(map.get('2')).toEqual([{ bomRevisionId: 6n, quantity: 3 }]);
      expect(map.get('3')).toEqual([{ bomRevisionId: 7n, quantity: 4 }]);
      expect(map.get('4')).toEqual([]);
      expect(findMany).not.toHaveBeenCalled();
    });

    it('phương án neo PI: 1 truy vấn gộp cho mọi PI', async () => {
      const findMany = jest.fn().mockResolvedValue([
        { bomRevisionId: 5n, quantity: 2, productionInvoiceItem: { productionInvoiceId: 100n } },
        { bomRevisionId: 6n, quantity: 1, productionInvoiceItem: { productionInvoiceId: 100n } },
        { bomRevisionId: 8n, quantity: 9, productionInvoiceItem: { productionInvoiceId: 200n } },
      ]);
      const prisma = { productionOrder: { findMany } } as unknown as Prisma;
      const map = await resolveProposalBomEntries(prisma, [
        src({ id: 1n, productionInvoiceId: 100n }),
        src({ id: 2n, productionInvoiceId: 200n }),
        src({ id: 3n, productionInvoiceId: 300n }),
      ]);
      expect(findMany).toHaveBeenCalledTimes(1);
      expect(map.get('1')).toEqual([
        { bomRevisionId: 5n, quantity: 2 },
        { bomRevisionId: 6n, quantity: 1 },
      ]);
      expect(map.get('2')).toEqual([{ bomRevisionId: 8n, quantity: 9 }]);
      expect(map.get('3')).toEqual([]);
    });
  });

  describe('loadSegmentProcessInfo', () => {
    const dec = (n: number) => ({ toNumber: () => n });
    const pieceBom = (
      rev: bigint,
      piece: bigint,
      qty: number,
      steps: string[],
      cut: number,
      material = 7n,
    ) => ({
      bomRevisionId: rev,
      pieceId: piece,
      qtyPerPiece: qty,
      processSteps: steps,
      segmentSpec: { materialId: material, cutLengthMm: dec(cut) },
    });

    const make = (rows: unknown[]) => {
      const pieceBomFind = jest.fn().mockResolvedValue(rows);
      const bomPieceFind = jest.fn().mockResolvedValue([
        { bomRevisionId: 5n, pieceId: 1n, qtyPerUnit: 3 },
        { bomRevisionId: 5n, pieceId: 2n, qtyPerUnit: 1 },
        { bomRevisionId: 6n, pieceId: 1n, qtyPerUnit: 2 },
      ]);
      return {
        prisma: {
          pieceBom: { findMany: pieceBomFind },
          bomPiece: { findMany: bomPieceFind },
        } as unknown as Prisma,
        pieceBomFind,
        bomPieceFind,
      };
    };

    it('nhu cầu dập = mảnh/bộ × đoạn/mảnh × số bộ, chỉ từ dòng có DAP; cộng gộp cùng chiều dài', async () => {
      const { prisma } = make([
        pieceBom(5n, 1n, 2, ['DAP'], 425), // 3 × 2 × 4 bộ = 24
        pieceBom(5n, 2n, 1, ['DAP', 'UON'], 425), // 1 × 1 × 4 = 4
        pieceBom(5n, 2n, 5, ['UON'], 300), // không dập
      ]);
      const info = await loadSegmentProcessInfo(
        prisma,
        new Map([['p1', [{ bomRevisionId: 5n, quantity: 4 }]]]),
      );
      const punched = info.get('p1')!.punchedByMaterial.get('7')!;
      expect([...punched.values()]).toEqual([{ cutLengthMm: 425, count: 28 }]);
    });

    it('các bước công đoạn hợp theo (loại sắt, chiều dài)', async () => {
      const { prisma } = make([
        pieceBom(5n, 1n, 2, ['DAP'], 425),
        pieceBom(5n, 2n, 1, ['UON', 'TAN'], 425),
        pieceBom(5n, 2n, 5, ['DUC_LO'], 300),
      ]);
      const info = await loadSegmentProcessInfo(
        prisma,
        new Map([['p1', [{ bomRevisionId: 5n, quantity: 1 }]]]),
      );
      const steps = info.get('p1')!.stepsByMaterialLength;
      expect([...steps.get(segmentStepKey(7n, 425))!].sort()).toEqual(['DAP', 'TAN', 'UON']);
      expect([...steps.get(segmentStepKey(7n, 300))!]).toEqual(['DUC_LO']);
    });

    it('gộp nhiều phương án trong 2 truy vấn, mỗi phương án theo định mức riêng', async () => {
      const { prisma, pieceBomFind, bomPieceFind } = make([
        pieceBom(5n, 1n, 1, ['DAP'], 425),
        pieceBom(6n, 1n, 1, ['DAP'], 425),
      ]);
      const info = await loadSegmentProcessInfo(
        prisma,
        new Map([
          ['a', [{ bomRevisionId: 5n, quantity: 1 }]],
          ['b', [{ bomRevisionId: 6n, quantity: 5 }]],
        ]),
      );
      expect(pieceBomFind).toHaveBeenCalledTimes(1);
      expect(bomPieceFind).toHaveBeenCalledTimes(1);
      expect(info.get('a')!.punchedByMaterial.get('7')!.get('425')!.count).toBe(3);
      expect(info.get('b')!.punchedByMaterial.get('7')!.get('425')!.count).toBe(10);
    });

    it('withPunchDemand = false: bỏ truy vấn số mảnh/bộ, chỉ lấy bước', async () => {
      const { prisma, bomPieceFind } = make([pieceBom(5n, 1n, 1, ['DAP', 'UON'], 425)]);
      const info = await loadSegmentProcessInfo(
        prisma,
        new Map([['a', [{ bomRevisionId: 5n, quantity: 1 }]]]),
        { withPunchDemand: false },
      );
      expect(bomPieceFind).not.toHaveBeenCalled();
      expect(info.get('a')!.punchedByMaterial.size).toBe(0);
      expect(info.get('a')!.stepsByMaterialLength.size).toBe(1);
    });

    it('không có định mức: không truy vấn gì', async () => {
      const { prisma, pieceBomFind } = make([]);
      const info = await loadSegmentProcessInfo(prisma, new Map([['a', []]]));
      expect(pieceBomFind).not.toHaveBeenCalled();
      expect(info.get('a')!.punchedByMaterial.size).toBe(0);
    });
  });
});
