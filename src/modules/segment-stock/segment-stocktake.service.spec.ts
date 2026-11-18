import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { StockLedgerRefType } from '../../generated/prisma/client';
import {
  SEGMENT_STOCKTAKE_NOT_CONVERTED_MESSAGE,
  SegmentStocktakeService,
} from './segment-stocktake.service';

describe('SegmentStocktakeService', () => {
  function make(
    opts: {
      qty?: number | null;
      kind?: string;
      code?: string;
      reservations?: number;
      productions?: number;
    } = {},
  ) {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      stockQuant: {
        findFirst: jest.fn().mockResolvedValue(opts.qty === null ? null : { qty: opts.qty ?? 12 }),
      },
      segmentProduction: { count: jest.fn().mockResolvedValue(opts.productions ?? 0) },
      segmentReservation: {
        count: jest.fn().mockResolvedValue(opts.reservations ?? 1),
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
    const realtime = { publishEntityChanged: jest.fn() };
    const service = new SegmentStocktakeService(
      prisma as never,
      ledger as never,
      realtime as never,
    );
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
    return { run, ledger, tx, realtime };
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

  it('rà soát 14/11 TĐ8: giữ khoá chuyển đổi dữ liệu cũ (dùng chung) trước khoá ô', async () => {
    const { run, tx } = make();
    await run();
    const calls = tx.$executeRaw.mock.calls as [TemplateStringsArray, string][];
    expect(calls[0][0].join('?')).toContain('pg_advisory_xact_lock_shared');
    expect(calls[0][1]).toBe('segment-legacy-conversion');
    expect(calls[1][1]).toMatch(/^segment-stock:/);
  });

  it('P3: 2 bảng đoạn theo lệnh cùng trống (chưa chuyển đổi) thì 409, không ghi sổ, không phát realtime', async () => {
    const { run, ledger, realtime } = make({ reservations: 0, productions: 0 });
    const err = await run().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toBe(SEGMENT_STOCKTAKE_NOT_CONVERTED_MESSAGE);
    expect(ledger.postEntry).not.toHaveBeenCalled();
    expect(realtime.publishEntityChanged).not.toHaveBeenCalled();
  });

  it('P3: chỉ cần 1 trong 2 bảng có dòng là ghi bình thường', async () => {
    for (const o of [
      { reservations: 1, productions: 0 },
      { reservations: 0, productions: 1 },
    ]) {
      const { run, ledger } = make(o);
      await run();
      expect(ledger.postEntry).toHaveBeenCalledTimes(1);
    }
  });

  it('P3: phát realtime STOCK ADJUSTED đúng 1 lần khi có chênh, sau khi transaction trả về', async () => {
    const { run, realtime, tx } = make();
    const order: string[] = [];
    realtime.publishEntityChanged.mockImplementation(() => order.push('publish'));
    tx.segmentReservation.findMany.mockImplementation(() => {
      order.push('tx');
      return Promise.resolve([]);
    });
    await run();
    expect(realtime.publishEntityChanged).toHaveBeenCalledTimes(1);
    expect(realtime.publishEntityChanged).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'STOCK', action: 'ADJUSTED', actorId: 'tk' }),
    );
    expect(order).toEqual(['tx', 'publish']);
  });

  it('P3: đếm khớp tồn (chênh 0) thì không phát realtime', async () => {
    const { run, realtime } = make();
    await run({ countedQty: 12 });
    expect(realtime.publishEntityChanged).not.toHaveBeenCalled();
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
