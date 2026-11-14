import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { StockLedgerRefType } from '../../generated/prisma/client';
import { SegmentStocktakeService } from './segment-stocktake.service';

describe('SegmentStocktakeService', () => {
  function make(opts: { qty?: number | null; kind?: string; code?: string } = {}) {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      stockQuant: {
        findFirst: jest.fn().mockResolvedValue(opts.qty === null ? null : { qty: opts.qty ?? 12 }),
      },
      segmentReservation: {
        findMany: jest.fn().mockResolvedValue([{ reservedQty: 10, consumedQty: 4 }]),
      },
    };
    const prisma = {
      warehouse: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 1n, code: opts.code ?? 'phoi-pa', kind: opts.kind ?? 'PHOI' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 98n }),
      },
      segmentSpec: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ cutLengthMm: 460, material: { code: 'SAT-005' } }),
      },
      $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const ledger = { postEntry: jest.fn().mockResolvedValue({}) };
    const service = new SegmentStocktakeService(prisma as never, ledger as never);
    const run = (over: Record<string, unknown> = {}) =>
      service.stocktake({
        warehouseId: 1n,
        segmentSpecId: 5n,
        segmentSteps: 'DAP',
        countedQty: 9,
        expectedCurrentQty: 12,
        note: 'Kiểm kê cuối tuần',
        actorId: 'tk',
        warehouseScope: 'phoi-pa',
        ...over,
      });
    return { run, ledger, tx };
  }

  it('đếm ít hơn: ghi phần chênh ra "Cân đối tồn kho", khoá đúng ô, trả số còn giữ', async () => {
    const { run, ledger, tx } = make();
    const r = await run();
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(ledger.postEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        fromWarehouseId: 1n,
        toWarehouseId: 98n,
        segmentSpecId: 5n,
        segmentSteps: 'DAP',
        qty: 3,
        refType: StockLedgerRefType.ADJUST,
      }),
      tx,
    );
    expect(r).toEqual({
      label: 'SAT-005 @ 460mm · Dập',
      beforeQty: 12,
      countedQty: 9,
      deltaQty: -3,
      heldQty: 6,
    });
  });

  it('đếm nhiều hơn ô chưa có tồn: cộng vào kho Phôi', async () => {
    const { run, ledger } = make({ qty: null });
    await run({ countedQty: 5, expectedCurrentQty: 0 });
    expect(ledger.postEntry).toHaveBeenCalledWith(
      expect.objectContaining({ fromWarehouseId: 98n, toWarehouseId: 1n, qty: 5 }),
      expect.anything(),
    );
  });

  it('đếm đúng bằng tồn: không ghi gì', async () => {
    const { run, ledger } = make();
    const r = await run({ countedQty: 12 });
    expect(r.deltaQty).toBe(0);
    expect(ledger.postEntry).not.toHaveBeenCalled();
  });

  it('tồn vừa đổi so với lúc mở form -> 409', async () => {
    const { run, ledger } = make({ qty: 10 });
    await expect(run()).rejects.toBeInstanceOf(ConflictException);
    expect(ledger.postEntry).not.toHaveBeenCalled();
  });

  it('kho khác phạm vi -> 403; kho không phải Phôi -> 400', async () => {
    await expect(make({ code: 'phoi-pha' }).run()).rejects.toBeInstanceOf(ForbiddenException);
    await expect(make({ kind: 'SON' }).run()).rejects.toBeInstanceOf(BadRequestException);
  });
});
