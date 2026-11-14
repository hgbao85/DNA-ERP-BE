import { ConflictException } from '@nestjs/common';
import { StockLedgerRefType } from '../../generated/prisma/client';
import { SegmentLegacyConversionService } from './segment-legacy-conversion.service';

describe('SegmentLegacyConversionService', () => {
  const env = process.env.SEGMENT_STOCK_ENABLED;
  afterEach(() => {
    if (env === undefined) delete process.env.SEGMENT_STOCK_ENABLED;
    else process.env.SEGMENT_STOCK_ENABLED = env;
  });

  function make(opts: { reservations?: number } = {}) {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      segmentReservation: { count: jest.fn().mockResolvedValue(opts.reservations ?? 0) },
      segmentProduction: { count: jest.fn().mockResolvedValue(0) },
      warehouse: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 99n }) },
      stockQuant: {
        findMany: jest.fn().mockResolvedValue([
          {
            warehouseId: 1n,
            segmentSpecId: 5n,
            segmentSteps: '',
            qty: -30,
            warehouse: { name: 'Kho Phôi Phú An' },
            segmentSpec: { cutLengthMm: 600, material: { code: 'SAT-001' } },
          },
          {
            warehouseId: 1n,
            segmentSpecId: 6n,
            segmentSteps: 'DAP',
            qty: 4,
            warehouse: { name: 'Kho Phôi Phú An' },
            segmentSpec: { cutLengthMm: 460, material: { code: 'SAT-002' } },
          },
        ]),
      },
      productionOrder: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { productionInvoiceItem: { productionInvoiceId: 75n } },
            { productionInvoiceItem: { productionInvoiceId: 75n } },
            { productionInvoiceItem: { productionInvoiceId: 70n } },
          ]),
      },
      productionInvoice: {
        findMany: jest.fn().mockResolvedValue([
          { id: 75n, code: 'PI-75' },
          { id: 70n, code: 'PI-70' },
        ]),
      },
      productionInvoiceItem: { findMany: jest.fn().mockResolvedValue([]) },
      stockLedger: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ refId: '301' }, { refId: '300' }, { refId: '400' }]),
      },
      productionBatch: {
        findUnique: jest.fn(({ where }: { where: { id: bigint } }) =>
          Promise.resolve({
            productionOrder: {
              productionInvoiceItem: { productionInvoiceId: where.id === 400n ? 70n : 75n },
            },
          }),
        ),
      },
    };
    const prisma = {
      $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const ledger = { postEntry: jest.fn().mockResolvedValue({}) };
    const segmentProduction = {
      // Lệnh 70 đã kết thúc.
      recomputeInTx: jest.fn((_t: unknown, pi: bigint) =>
        Promise.resolve(pi === 70n ? null : { changes: [{ ledgerQty: 40 }, { ledgerQty: 5 }] }),
      ),
    };
    const batches = {
      replayLegacySegmentConsume: jest.fn().mockResolvedValue({
        productionInvoiceId: 75n,
        neededQty: 20,
        takenQty: 15,
        shortageQty: 5,
      }),
    };
    const service = new SegmentLegacyConversionService(
      prisma as never,
      ledger as never,
      segmentProduction as never,
      batches as never,
    );
    return { service, tx, prisma, ledger, segmentProduction, batches };
  }

  it('xem thử: ô cũ về 0 (âm cộng vào, dương trừ ra), tính phía cộng lệnh chưa kết thúc, trừ lại đợt cũ theo thứ tự; rollback', async () => {
    const { service, ledger, segmentProduction, batches, prisma } = make();
    const r = await service.run({ dryRun: true, actorId: 'admin' });
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(ledger.postEntry).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        fromWarehouseId: 99n,
        toWarehouseId: 1n,
        qty: 30,
        refType: StockLedgerRefType.ADJUST,
      }),
      expect.anything(),
    );
    expect(ledger.postEntry).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        fromWarehouseId: 1n,
        toWarehouseId: 99n,
        qty: 4,
        segmentSteps: 'DAP',
      }),
      expect.anything(),
    );
    expect(segmentProduction.recomputeInTx.mock.calls.map((c) => c[1])).toEqual([70n, 75n]);
    // Đợt 400 thuộc lệnh 70 đã kết thúc: bỏ qua. 300 trước 301.
    expect(
      (batches.replayLegacySegmentConsume.mock.calls as [unknown, bigint][]).map((c) => c[1]),
    ).toEqual([300n, 301n]);
    expect(r.dryRun).toBe(true);
    expect(r.zeroedCells.map((c) => c.segmentLabel)).toEqual([
      'SAT-001 @ 600mm · Trơn',
      'SAT-002 @ 460mm · Dập',
    ]);
    expect(r.replayedBatches).toBe(2);
    expect(r.totals).toEqual({ producedQty: 45, neededQty: 40, takenQty: 30, shortageQty: 10 });
    expect(r.orders.find((o) => o.productionInvoiceId === '70')?.closed).toBe(true);
  });

  it('chạy thật cần bật công tắc', async () => {
    process.env.SEGMENT_STOCK_ENABLED = 'false';
    const { service, prisma } = make();
    await expect(service.run({ dryRun: false, actorId: 'admin' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('đã có dữ liệu tồn đoạn theo lệnh -> từ chối (chỉ chạy 1 lần)', async () => {
    process.env.SEGMENT_STOCK_ENABLED = 'true';
    const { service, ledger } = make({ reservations: 3 });
    await expect(service.run({ dryRun: false, actorId: 'admin' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(ledger.postEntry).not.toHaveBeenCalled();
  });

  it('chạy thật trả báo cáo, không rollback', async () => {
    process.env.SEGMENT_STOCK_ENABLED = 'true';
    const { service } = make();
    const r = await service.run({ dryRun: false, actorId: 'admin' });
    expect(r.dryRun).toBe(false);
    expect(r.zeroedCells).toHaveLength(2);
  });
});
