/* eslint-disable @typescript-eslint/no-unsafe-assignment -- expect.objectContaining() trả any */
import { SegmentReservationLogKind, StockLedgerRefType } from '../../generated/prisma/client';
import { PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { SegmentStockService } from './segment-stock.service';

const dec = (n: number) => ({ toNumber: () => n });
const OLD = 10n;
const NEW = 20n;
const SPEC = 5n;
const PI = 100n;

/** Đổi xưởng: chuyển phần đoạn lệnh còn giữ ở kho Phôi cũ sang kho Phôi xưởng mới (anh Nhân 13/11 câu 8). */
function makeEnv(opts: {
  reserved: number;
  consumed: number;
  oldQty: number | null;
  destRow?: boolean;
}) {
  const res = {
    id: 1n,
    warehouseId: OLD,
    segmentSpecId: SPEC,
    segmentSteps: 'DAP',
    productionInvoiceId: PI,
  };
  const locks: string[] = [];
  const tx = {
    $executeRaw: jest.fn((_s: TemplateStringsArray, key: string) => {
      locks.push(key);
      return Promise.resolve(1);
    }),
    segmentProduction: { updateMany: jest.fn(() => Promise.resolve({ count: 1 })) },
    segmentReservation: {
      findMany: jest.fn(() =>
        Promise.resolve([
          { ...res, reservedQty: dec(opts.reserved), consumedQty: dec(opts.consumed) },
        ]),
      ),
      findUnique: jest.fn((args: { where: { id?: bigint } }) =>
        Promise.resolve(
          args.where.id === 1n
            ? { reservedQty: dec(opts.reserved), consumedQty: dec(opts.consumed) }
            : opts.destRow
              ? { id: 2n }
              : null,
        ),
      ),
      update: jest.fn(() => Promise.resolve({ id: 2n })),
      create: jest.fn(() => Promise.resolve({ id: 2n })),
    },
    segmentReservationLog: { create: jest.fn(() => Promise.resolve({})) },
    stockQuant: {
      findFirst: jest.fn(() =>
        Promise.resolve(opts.oldQty === null ? null : { qty: dec(opts.oldQty) }),
      ),
    },
  };
  const ledger = { postEntry: jest.fn(() => Promise.resolve({})) };
  const service = new SegmentStockService(
    {} as unknown as PrismaServiceType,
    ledger as unknown as StockLedgerService,
  );
  const run = () =>
    service.transferOrderHoldings(tx as unknown as PrismaTx, {
      productionInvoiceId: PI,
      toWarehouseId: NEW,
      refId: PI.toString(),
      actorId: 'qlsx',
    });
  return { tx, ledger, run, locks };
}

describe('SegmentStockService.transferOrderHoldings', () => {
  it('chuyển phần còn giữ (giữ 30, đã dùng 12 → 18) sang kho mới: sổ kho + giữ ở kho mới + nhật ký 2 chiều', async () => {
    const { tx, ledger, run, locks } = makeEnv({ reserved: 30, consumed: 12, oldQty: 25 });
    const out = await run();
    expect(out).toEqual({ movedQty: 18, droppedQty: 0, reservationCount: 1 });
    expect(tx.segmentProduction.updateMany).toHaveBeenCalledWith({
      where: { productionInvoiceId: PI, warehouseId: { not: NEW } },
      data: { warehouseId: NEW },
    });
    expect(locks).toHaveLength(2);
    expect(tx.segmentReservation.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: { reservedQty: 12 },
    });
    expect(ledger.postEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        fromWarehouseId: OLD,
        toWarehouseId: NEW,
        segmentSpecId: SPEC,
        segmentSteps: 'DAP',
        qty: 18,
        refType: StockLedgerRefType.WAREHOUSE_TRANSFER,
      }),
      tx,
    );
    expect(tx.segmentReservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          warehouseId: NEW,
          productionInvoiceId: PI,
          reservedQty: 18,
        }),
      }),
    );
    const kinds = tx.segmentReservationLog.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { data: { kind: string; qty: number } }).data,
    );
    expect(kinds).toEqual([
      expect.objectContaining({ kind: SegmentReservationLogKind.TRANSFER, qty: -18 }),
      expect.objectContaining({ kind: SegmentReservationLogKind.TRANSFER, qty: 18 }),
    ]);
  });

  it('kho cũ thiếu tồn thật (dữ liệu cũ): chỉ chuyển phần có, phần còn lại nhả', async () => {
    const { ledger, run, tx } = makeEnv({ reserved: 20, consumed: 0, oldQty: 5 });
    const out = await run();
    expect(out).toEqual({ movedQty: 5, droppedQty: 15, reservationCount: 1 });
    expect(ledger.postEntry).toHaveBeenCalledWith(expect.objectContaining({ qty: 5 }), tx);
    expect(tx.segmentReservationLog.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ kind: SegmentReservationLogKind.RELEASE, qty: 15 }),
    });
  });

  it('kho cũ tồn ≤ 0: không ghi sổ, nhả hết phần giữ', async () => {
    const { ledger, run, tx } = makeEnv({ reserved: 8, consumed: 2, oldQty: -4 });
    const out = await run();
    expect(out).toEqual({ movedQty: 0, droppedQty: 6, reservationCount: 1 });
    expect(ledger.postEntry).not.toHaveBeenCalled();
    expect(tx.segmentReservation.create).not.toHaveBeenCalled();
  });

  it('đã dùng hết phần giữ: không làm gì', async () => {
    const { ledger, run } = makeEnv({ reserved: 10, consumed: 10, oldQty: 30 });
    expect(await run()).toEqual({ movedQty: 0, droppedQty: 0, reservationCount: 0 });
    expect(ledger.postEntry).not.toHaveBeenCalled();
  });
});
