import { loadPlanSurplus } from './plan-surplus.util';

/** Câu 12b / 14a (anh Nhân 24/11/2026): đoạn dư theo phương án + đoạn dư lấy từ kho, gán cho SKU. */
describe('loadPlanSurplus', () => {
  const order = (id: bigint, status = 'RELEASED', quantity = 2) => ({
    id,
    bomRevisionId: 5n,
    quantity,
    status,
  });
  function db(opts: {
    coverage: ReturnType<typeof order>[];
    segments: { spec: bigint; countPerBar: number; barCount: number }[];
    stockLogs?: { kind: string; qty: number; spec: bigint; steps: string }[];
  }) {
    return {
      cuttingPlanCoverage: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ cuttingProposalId: 110n }])
          .mockResolvedValueOnce(
            opts.coverage.map((o) => ({ cuttingProposalId: 110n, productionOrder: o })),
          ),
      },
      cuttingProposalPatternSegment: {
        findMany: jest.fn().mockResolvedValue(
          opts.segments.map((s) => ({
            segmentSpecId: s.spec,
            countPerBar: s.countPerBar,
            pattern: { barCount: s.barCount, line: { cuttingProposalId: 110n } },
          })),
        ),
      },
      segmentReservationLog: {
        findMany: jest.fn().mockResolvedValue(
          (opts.stockLogs ?? []).map((l) => ({
            refId: '110',
            kind: l.kind,
            qty: { toNumber: () => l.qty },
            reservation: { segmentSpecId: l.spec, segmentSteps: l.steps },
          })),
        ),
      },
      bomPiece: {
        findMany: jest.fn().mockResolvedValue([{ bomRevisionId: 5n, pieceId: 20n, qtyPerUnit: 1 }]),
      },
      // 2 đoạn 650 (Uốn) + 4 đoạn 420 (trơn) mỗi bộ
      pieceBom: {
        findMany: jest.fn().mockResolvedValue([
          {
            bomRevisionId: 5n,
            pieceId: 20n,
            segmentSpecId: 535n,
            qtyPerPiece: 2,
            processSteps: ['CAT', 'UON'],
          },
          {
            bomRevisionId: 5n,
            pieceId: 20n,
            segmentSpecId: 538n,
            qtyPerPiece: 4,
            processSteps: ['CAT'],
          },
        ]),
      },
    };
  }

  it('dư = Σ kiểu cắt − số cần của mọi SKU phương án phủ, gán hết cho SKU còn chạy id nhỏ nhất', async () => {
    // 2 SKU x 2 bộ -> cần 650: 8; cắt 10 -> dư 2
    const d = db({
      coverage: [order(78n), order(77n)],
      segments: [{ spec: 535n, countPerBar: 5, barCount: 2 }],
    });
    expect(await loadPlanSurplus(d as never, [77n, 78n])).toEqual([
      { productionOrderId: 77n, segmentSpecId: 535n, qty: 2 },
    ]);
  });

  it('SKU đã huỷ vẫn tính vào số cần (không cộng phần của nó sang SKU khác) nhưng không nhận dư', async () => {
    const d = db({
      coverage: [order(77n, 'CANCELLED'), order(78n)],
      segments: [{ spec: 535n, countPerBar: 5, barCount: 2 }],
    });
    expect(await loadPlanSurplus(d as never, [77n, 78n])).toEqual([
      { productionOrderId: 78n, segmentSpecId: 535n, qty: 2 },
    ]);
  });

  it('câu 14a: cỡ được đoạn dư trong kho phủ HẾT (không còn trong kiểu cắt) vẫn ra dòng lấy từ kho', async () => {
    const d = db({
      coverage: [order(76n)],
      segments: [{ spec: 535n, countPerBar: 4, barCount: 1 }],
      stockLogs: [
        { kind: 'SURPLUS_IN', qty: 8, spec: 538n, steps: '' },
        { kind: 'SURPLUS_IN', qty: 1, spec: 535n, steps: 'UON' },
      ],
    });
    const rows = await loadPlanSurplus(d as never, [76n]);
    expect(rows).toEqual(
      expect.arrayContaining([
        { productionOrderId: 76n, segmentSpecId: 538n, qty: 8, fromStockSteps: '' },
        { productionOrderId: 76n, segmentSpecId: 535n, qty: 1, fromStockSteps: 'UON' },
        // cần 4 − 1 lấy từ kho = 3, cắt 4 -> dư 1
        { productionOrderId: 76n, segmentSpecId: 535n, qty: 1 },
      ]),
    );
    expect(rows).toHaveLength(3);
  });

  it('phần đã nhả (phương án bị thay) không còn tính là lấy từ kho', async () => {
    const d = db({
      coverage: [order(76n)],
      segments: [{ spec: 535n, countPerBar: 4, barCount: 1 }],
      stockLogs: [
        { kind: 'SURPLUS_IN', qty: 8, spec: 538n, steps: '' },
        { kind: 'RELEASE', qty: 8, spec: 538n, steps: '' },
      ],
    });
    expect(await loadPlanSurplus(d as never, [76n])).toEqual([]);
  });
});
