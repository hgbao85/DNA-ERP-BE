/* eslint-disable @typescript-eslint/no-unsafe-assignment -- expect.objectContaining() lồng nhau trả any */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SegmentReservationLogKind, StockLedgerRefType } from '../../generated/prisma/client';
import { PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { SegmentStockService } from './segment-stock.service';

const dec = (n: number) => ({ toNumber: () => n });

const PRODUCTION_WH = 99n;
const WH = 10n;
const SPEC = 5n;
const PI = 100n;

interface ResRow {
  productionInvoiceId: bigint;
  reserved: number;
  consumed: number;
}

/** Giả lập 1 ô (kho, mã đoạn): tồn q, các dòng giữ của mọi lệnh, các dòng SegmentProduction của lệnh đang tính. */
function makeEnv() {
  const calls: string[] = [];
  const state = {
    q: null as number | null,
    reservations: [] as ResRow[],
    productions: [] as {
      segmentSpecId: bigint;
      segmentSteps: string;
      warehouseId: bigint;
      heldQty: number;
      surplusQty: number;
    }[],
    ledgerDup: false,
  };
  const tx = {
    $executeRaw: jest.fn((_s: TemplateStringsArray, key: string) => {
      calls.push(`lock:${key}`);
      return Promise.resolve(1);
    }),
    stockQuant: {
      findFirst: jest.fn(() => {
        calls.push('read');
        return Promise.resolve(state.q === null ? null : { qty: dec(state.q) });
      }),
    },
    segmentReservation: {
      findMany: jest.fn(() =>
        Promise.resolve(
          state.reservations.map((r) => ({
            id: 1n,
            warehouseId: WH,
            segmentSpecId: SPEC,
            segmentSteps: '',
            productionInvoiceId: r.productionInvoiceId,
            reservedQty: dec(r.reserved),
            consumedQty: dec(r.consumed),
          })),
        ),
      ),
      // Tra theo khoá (kho, lệnh, mã đoạn): có dòng giữ của lệnh trong state thì trả id, không thì null (bumpReservation tạo mới).
      findUnique: jest.fn(
        (args?: {
          where?: {
            warehouseId_productionInvoiceId_segmentSpecId_segmentSteps?: {
              productionInvoiceId: bigint;
            };
          };
        }) => {
          const k = args?.where?.warehouseId_productionInvoiceId_segmentSpecId_segmentSteps;
          const found =
            k && state.reservations.some((r) => r.productionInvoiceId === k.productionInvoiceId);
          return Promise.resolve(found ? { id: 1n } : null);
        },
      ),
      create: jest.fn(() => Promise.resolve({ id: 1n })),
      update: jest.fn(() => Promise.resolve({ id: 1n })),
    },
    segmentReservationLog: { create: jest.fn(() => Promise.resolve({})) },
    segmentProduction: {
      findMany: jest.fn(() =>
        Promise.resolve(
          state.productions.map((p) => ({
            ...p,
            productionInvoiceId: PI,
            heldQty: dec(p.heldQty),
            surplusQty: dec(p.surplusQty),
          })),
        ),
      ),
      upsert: jest.fn(() => Promise.resolve({})),
    },
    warehouse: { findUniqueOrThrow: jest.fn(() => Promise.resolve({ id: PRODUCTION_WH })) },
    stockLedger: {
      findUnique: jest.fn(() => Promise.resolve(state.ledgerDup ? { id: 1n } : null)),
    },
  };
  const ledger = { postEntry: jest.fn(() => Promise.resolve({})) };
  const prisma = {
    stockQuant: { findMany: jest.fn() },
    // fields: tham chiếu cột cho getBalances (reservedQty > consumedQty lọc trong DB).
    segmentReservation: { findMany: jest.fn(), fields: { consumedQty: 'consumedQty' } },
    warehouse: { findMany: jest.fn() },
    segmentSpec: { findMany: jest.fn() },
    productionInvoice: { findUnique: jest.fn() },
    segmentProduction: { findMany: jest.fn() },
    segmentReservationLog: { findMany: jest.fn() },
  };
  const service = new SegmentStockService(
    prisma as unknown as PrismaServiceType,
    ledger as unknown as StockLedgerService,
  );
  return { service, tx: tx as unknown as PrismaTx, txMock: tx, ledger, prisma, state, calls };
}

describe('SegmentStockService', () => {
  describe('syncOrderProduction', () => {
    const target = (heldQty: number, surplusQty: number, segmentSteps = '', spec = SPEC) => ({
      segmentSpecId: spec,
      segmentSteps,
      heldQty,
      surplusQty,
    });
    const run = (env: ReturnType<typeof makeEnv>, targets: ReturnType<typeof target>[]) =>
      env.service.syncOrderProduction(env.tx, {
        productionInvoiceId: PI,
        warehouseId: WH,
        targets,
        actorId: 'u1',
        reason: 'QC_CUT_BUNDLE:12',
      });

    it('(a) mới: giữ 20 + dư 5, tồn trống -> ghi sổ 25, giữ +20, after (20, 5)', async () => {
      const env = makeEnv();
      env.state.q = 0;
      const result = await run(env, [target(20, 5)]);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]).toMatchObject({
        warehouseId: WH,
        before: { heldQty: 0, surplusQty: 0 },
        target: { heldQty: 20, surplusQty: 5 },
        after: { heldQty: 20, surplusQty: 5 },
        ledgerQty: 25,
        unappliedHeldQty: 0,
        unappliedSurplusQty: 0,
      });
      expect(env.ledger.postEntry).toHaveBeenCalledTimes(1);
      const [entry, txArg] = env.ledger.postEntry.mock.calls[0] as unknown as [
        Record<string, unknown>,
        unknown,
      ];
      expect(entry).toMatchObject({
        fromWarehouseId: PRODUCTION_WH,
        toWarehouseId: WH,
        segmentSpecId: SPEC,
        segmentSteps: '',
        qty: 25,
        refType: StockLedgerRefType.SEGMENT_PRODUCE,
        refId: '100',
        createdById: 'u1',
      });
      expect(entry).not.toHaveProperty('idempotencyKey');
      expect(entry.note).toContain('QC_CUT_BUNDLE:12');
      expect(txArg).toBe(env.tx);
      expect(env.txMock.segmentReservation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reservedQty: 20,
            consumedQty: 0,
            productionInvoiceId: PI,
          }),
        }),
      );
      expect(env.txMock.segmentReservation.update).not.toHaveBeenCalled();
      expect(env.txMock.segmentReservationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          kind: SegmentReservationLogKind.PRODUCE,
          qty: 20,
          refType: 'SEGMENT_PRODUCTION',
          refId: '100',
          note: 'QC_CUT_BUNDLE:12',
          createdById: 'u1',
        }),
      });
      expect(env.txMock.segmentProduction.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ warehouseId: WH, heldQty: 20, surplusQty: 5 }),
          update: { warehouseId: WH, heldQty: 20, surplusQty: 5 },
        }),
      );
    });

    it('(b) lệnh đã dùng 8/10, đích giữ giảm 10 -> 5: chỉ nhả 2, unappliedHeld = -3', async () => {
      const env = makeEnv();
      env.state.q = 2;
      env.state.reservations = [{ productionInvoiceId: PI, reserved: 10, consumed: 8 }];
      env.state.productions = [
        { segmentSpecId: SPEC, segmentSteps: '', warehouseId: WH, heldQty: 10, surplusQty: 0 },
      ];
      const result = await run(env, [target(5, 0)]);

      expect(result.changes[0]).toMatchObject({
        after: { heldQty: 8, surplusQty: 0 },
        ledgerQty: -2,
        unappliedHeldQty: -3,
        unappliedSurplusQty: 0,
      });
      expect(env.ledger.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({ fromWarehouseId: WH, toWarehouseId: PRODUCTION_WH, qty: 2 }),
        env.tx,
      );
      expect(env.txMock.segmentReservationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ kind: SegmentReservationLogKind.PRODUCE, qty: -2 }),
      });
    });

    it('(c) đổi giữ -> dư khi lệnh đã dùng 6: giữ giảm 4, không ghi sổ, after (6, 4)', async () => {
      const env = makeEnv();
      env.state.q = 4;
      env.state.reservations = [{ productionInvoiceId: PI, reserved: 10, consumed: 6 }];
      env.state.productions = [
        { segmentSpecId: SPEC, segmentSteps: '', warehouseId: WH, heldQty: 10, surplusQty: 0 },
      ];
      const result = await run(env, [target(0, 10)]);

      expect(result.changes[0]).toMatchObject({
        after: { heldQty: 6, surplusQty: 4 },
        ledgerQty: 0,
        unappliedHeldQty: -6,
        unappliedSurplusQty: 6,
      });
      expect(env.ledger.postEntry).not.toHaveBeenCalled();
      expect(env.txMock.segmentReservationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ qty: -4 }),
      });
    });

    it('(d) đổi dư -> giữ khi lệnh khác đã lấy 7 dư: chỉ chuyển 3, after (3, 7)', async () => {
      const env = makeEnv();
      env.state.q = 10;
      env.state.reservations = [{ productionInvoiceId: 200n, reserved: 7, consumed: 0 }];
      env.state.productions = [
        { segmentSpecId: SPEC, segmentSteps: '', warehouseId: WH, heldQty: 0, surplusQty: 10 },
      ];
      const result = await run(env, [target(10, 0)]);

      expect(result.changes[0]).toMatchObject({
        after: { heldQty: 3, surplusQty: 7 },
        ledgerQty: 0,
        unappliedHeldQty: 7,
        unappliedSurplusQty: -7,
      });
      expect(env.ledger.postEntry).not.toHaveBeenCalled();
    });

    it('(e) tồn cũ âm: tăng thì vẫn ghi đủ; giảm thì không ghi sổ (L = 0)', async () => {
      const up = makeEnv();
      up.state.q = -6;
      const inc = await run(up, [target(10, 2)]);
      expect(inc.changes[0]).toMatchObject({
        ledgerQty: 12,
        after: { heldQty: 10, surplusQty: 2 },
      });
      expect(up.ledger.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({ qty: 12, fromWarehouseId: PRODUCTION_WH }),
        up.tx,
      );

      const down = makeEnv();
      down.state.q = -6;
      down.state.reservations = [{ productionInvoiceId: PI, reserved: 10, consumed: 0 }];
      down.state.productions = [
        { segmentSpecId: SPEC, segmentSteps: '', warehouseId: WH, heldQty: 10, surplusQty: 2 },
      ];
      const dec2 = await run(down, [target(0, 0)]);
      expect(dec2.changes[0].ledgerQty).toBe(0);
      expect(down.ledger.postEntry).not.toHaveBeenCalled();
    });

    it('mã đã ghi mà bị bỏ khỏi targets -> đích 0/0, dùng kho của dòng cũ', async () => {
      const env = makeEnv();
      env.state.q = 15;
      env.state.reservations = [{ productionInvoiceId: PI, reserved: 12, consumed: 0 }];
      env.state.productions = [
        { segmentSpecId: SPEC, segmentSteps: 'DAP', warehouseId: 77n, heldQty: 12, surplusQty: 3 },
      ];
      const result = await run(env, []);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]).toMatchObject({
        warehouseId: 77n,
        segmentSteps: 'DAP',
        target: { heldQty: 0, surplusQty: 0 },
        after: { heldQty: 0, surplusQty: 0 },
        ledgerQty: -15,
      });
      expect(env.ledger.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({ fromWarehouseId: 77n, toWarehouseId: PRODUCTION_WH, qty: 15 }),
        env.tx,
      );
    });

    it('mã không đổi (before = target) -> không khoá, không ghi, không có trong changes', async () => {
      const env = makeEnv();
      env.state.productions = [
        { segmentSpecId: SPEC, segmentSteps: '', warehouseId: WH, heldQty: 4, surplusQty: 1 },
      ];
      const result = await run(env, [target(4, 1)]);

      expect(result.changes).toEqual([]);
      expect(env.txMock.$executeRaw).not.toHaveBeenCalled();
      expect(env.txMock.segmentProduction.upsert).not.toHaveBeenCalled();
    });

    it('targets trùng mã -> BadRequest; bộ công đoạn sai dạng -> BadRequest; số âm -> BadRequest', async () => {
      const env = makeEnv();
      await expect(run(env, [target(1, 0), target(2, 0)])).rejects.toThrow(BadRequestException);
      await expect(run(env, [target(1, 0, 'DAP,UON')])).rejects.toThrow(BadRequestException);
      await expect(run(env, [target(-1, 0)])).rejects.toThrow(BadRequestException);
      await expect(run(env, [target(Number.NaN, 0)])).rejects.toThrow(BadRequestException);
    });

    it('khoá ô trước khi đọc, nhiều ô khoá theo kho tăng dần rồi mã đoạn dù targets đưa vào ngược', async () => {
      const env = makeEnv();
      env.state.q = 0;
      env.state.productions = [
        { segmentSpecId: 3n, segmentSteps: '', warehouseId: 20n, heldQty: 1, surplusQty: 0 },
      ];
      // Mã (spec 9, kho 10) + (spec 2 'UON', kho 10) mới; mã (spec 3, kho 20) đã có dòng và bị bỏ.
      await run(env, [target(1, 0, '', 9n), target(1, 0, 'UON', 2n)]);

      const locks = env.calls.filter((c) => c.startsWith('lock:'));
      expect(locks).toEqual([
        'lock:segment-stock:10:2:UON',
        'lock:segment-stock:10:9:',
        'lock:segment-stock:20:3:',
      ]);
      // Mỗi lần đọc tồn đứng ngay sau khoá của chính nó.
      expect(env.calls.slice(0, 2)).toEqual(['lock:segment-stock:10:2:UON', 'read']);
    });
  });

  describe('consumeForOrder', () => {
    const input = (qty: number, extra: Record<string, unknown> = {}) => ({
      warehouseId: WH,
      productionInvoiceId: PI,
      segmentSpecId: SPEC,
      segmentSteps: 'DAP',
      qty,
      refId: '55',
      actorId: 'u1',
      ...extra,
    });

    it('đủ phần giữ của lệnh: lấy hết từ giữ, ghi CONSUME + bút toán kho -> PRODUCTION', async () => {
      const env = makeEnv();
      env.state.q = 10;
      env.state.reservations = [{ productionInvoiceId: PI, reserved: 10, consumed: 0 }];
      const result = await env.service.consumeForOrder(env.tx, input(4, { idempotencyKey: 'k1' }));

      expect(result).toEqual({
        takenQty: 4,
        fromHeldQty: 4,
        fromSurplusQty: 0,
        shortageQty: 0,
        duplicate: false,
      });
      // Dòng giữ đã có: CẬP NHẬT (không upsert - CHECK của Postgres chặn bộ "tạo mới" giữ 0 / dùng 4).
      expect(env.txMock.segmentReservation.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1n }, data: { consumedQty: { increment: 4 } } }),
      );
      expect(env.txMock.segmentReservation.create).not.toHaveBeenCalled();
      expect(env.txMock.segmentReservationLog.create).toHaveBeenCalledTimes(1);
      expect(env.txMock.segmentReservationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          kind: SegmentReservationLogKind.CONSUME,
          qty: 4,
          refType: 'SEGMENT_CONSUME',
          refId: '55',
        }),
      });
      expect(env.ledger.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          fromWarehouseId: WH,
          toWarehouseId: PRODUCTION_WH,
          segmentSteps: 'DAP',
          qty: 4,
          refType: StockLedgerRefType.SEGMENT_CONSUME,
          refId: '55',
          idempotencyKey: 'k1',
        }),
        env.tx,
      );
    });

    it('thiếu phần giữ thì lấy thêm từ dư: ghi SURPLUS_IN rồi CONSUME', async () => {
      const env = makeEnv();
      env.state.q = 10;
      // Lệnh còn giữ 3, lệnh khác giữ 2 -> H = 5, dư = 5.
      env.state.reservations = [
        { productionInvoiceId: PI, reserved: 3, consumed: 0 },
        { productionInvoiceId: 200n, reserved: 2, consumed: 0 },
      ];
      const result = await env.service.consumeForOrder(env.tx, input(6));

      expect(result).toMatchObject({
        takenQty: 6,
        fromHeldQty: 3,
        fromSurplusQty: 3,
        shortageQty: 0,
      });
      expect(env.txMock.segmentReservation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { reservedQty: { increment: 3 }, consumedQty: { increment: 6 } },
        }),
      );
      const kinds = (
        env.txMock.segmentReservationLog.create.mock.calls as unknown as [
          { data: { kind: string; qty: number } },
        ][]
      ).map(([c]) => [c.data.kind, c.data.qty]);
      expect(kinds).toEqual([
        [SegmentReservationLogKind.SURPLUS_IN, 3],
        [SegmentReservationLogKind.CONSUME, 6],
      ]);
    });

    it('thiếu hẳn: chỉ trừ phần có, shortage = phần còn lại (không ghi sổ phần thiếu)', async () => {
      const env = makeEnv();
      env.state.q = 2;
      env.state.reservations = [{ productionInvoiceId: PI, reserved: 5, consumed: 0 }];
      const result = await env.service.consumeForOrder(env.tx, input(4));

      expect(result).toMatchObject({
        takenQty: 2,
        fromHeldQty: 2,
        fromSurplusQty: 0,
        shortageQty: 2,
      });
      expect(env.ledger.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({ qty: 2 }),
        env.tx,
      );
    });

    it('tồn âm (dữ liệu cũ): không trừ gì, không ghi sổ, shortage = qty', async () => {
      const env = makeEnv();
      env.state.q = -3;
      const result = await env.service.consumeForOrder(env.tx, input(4));

      expect(result).toEqual({
        takenQty: 0,
        fromHeldQty: 0,
        fromSurplusQty: 0,
        shortageQty: 4,
        duplicate: false,
      });
      expect(env.ledger.postEntry).not.toHaveBeenCalled();
      expect(env.txMock.segmentReservation.create).not.toHaveBeenCalled();
      expect(env.txMock.segmentReservation.update).not.toHaveBeenCalled();
    });

    it('idempotencyKey đã có bút toán -> duplicate, không khoá, không làm gì', async () => {
      const env = makeEnv();
      env.state.ledgerDup = true;
      const result = await env.service.consumeForOrder(env.tx, input(4, { idempotencyKey: 'k1' }));

      expect(result).toEqual({
        takenQty: 0,
        fromHeldQty: 0,
        fromSurplusQty: 0,
        shortageQty: 0,
        duplicate: true,
      });
      expect(env.txMock.$executeRaw).not.toHaveBeenCalled();
      expect(env.ledger.postEntry).not.toHaveBeenCalled();
    });

    it('ledgerRefType truyền vào được dùng cho cả bút toán lẫn nhật ký; qty <= 0 hoặc mã sai dạng -> BadRequest', async () => {
      const env = makeEnv();
      env.state.q = 5;
      env.state.reservations = [{ productionInvoiceId: PI, reserved: 5, consumed: 0 }];
      await env.service.consumeForOrder(
        env.tx,
        input(1, { ledgerRefType: StockLedgerRefType.SEGMENT_PRODUCE }),
      );
      expect(env.ledger.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({ refType: StockLedgerRefType.SEGMENT_PRODUCE }),
        env.tx,
      );
      await expect(env.service.consumeForOrder(env.tx, input(0))).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        env.service.consumeForOrder(env.tx, input(1, { segmentSteps: 'DAP,UON' })),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('allocateSurplusToOrder', () => {
    const input = (qty: number) => ({
      warehouseId: WH,
      productionInvoiceId: PI,
      segmentSpecId: SPEC,
      segmentSteps: '',
      qty,
      actorId: 'u1',
      refType: 'MANUAL',
      refId: '7',
      note: 'chia dư',
    });

    it('chia tối đa bằng dư hiện có, trả phần dư còn lại', async () => {
      const env = makeEnv();
      env.state.q = 10;
      env.state.reservations = [{ productionInvoiceId: 200n, reserved: 7, consumed: 0 }];
      const r1 = await env.service.allocateSurplusToOrder(env.tx, input(5));

      expect(r1).toEqual({ allocatedQty: 3, remainingSurplusQty: 0 });
      expect(env.txMock.segmentReservationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          kind: SegmentReservationLogKind.SURPLUS_IN,
          qty: 3,
          refType: 'MANUAL',
          refId: '7',
          note: 'chia dư',
        }),
      });
      expect(env.ledger.postEntry).not.toHaveBeenCalled();

      const r2 = await env.service.allocateSurplusToOrder(env.tx, input(2));
      expect(r2).toEqual({ allocatedQty: 2, remainingSurplusQty: 1 });
    });

    it('không có dư -> không ghi gì', async () => {
      const env = makeEnv();
      env.state.q = 5;
      env.state.reservations = [{ productionInvoiceId: 200n, reserved: 5, consumed: 0 }];
      const result = await env.service.allocateSurplusToOrder(env.tx, input(2));

      expect(result).toEqual({ allocatedQty: 0, remainingSurplusQty: 0 });
      expect(env.txMock.segmentReservation.create).not.toHaveBeenCalled();
      expect(env.txMock.segmentReservation.update).not.toHaveBeenCalled();
    });
  });

  describe('releaseOrderHoldings', () => {
    it('nhả mọi phần còn giữ về dư: reservedQty = consumedQty, log RELEASE, không ghi sổ kho', async () => {
      const env = makeEnv();
      const base = { warehouseId: WH, segmentSpecId: SPEC, segmentSteps: '' };
      env.txMock.segmentReservation.findMany.mockResolvedValue([
        { id: 2n, ...base, segmentSpecId: 9n, reservedQty: dec(10), consumedQty: dec(4) },
        { id: 1n, ...base, reservedQty: dec(5), consumedQty: dec(5) },
        { id: 3n, ...base, reservedQty: dec(3), consumedQty: dec(0) },
      ] as never);
      env.txMock.segmentReservation.findUnique
        .mockResolvedValueOnce({ reservedQty: dec(3), consumedQty: dec(0) } as never)
        .mockResolvedValueOnce({ reservedQty: dec(10), consumedQty: dec(4) } as never);

      const result = await env.service.releaseOrderHoldings(env.tx, {
        productionInvoiceId: PI,
        actorId: 'u1',
        reason: 'PI_FINISHED',
      });

      expect(result).toEqual({ releasedQty: 9, reservationCount: 2 });
      // Khoá theo thứ tự mã đoạn (spec 5 trước spec 9).
      expect(env.calls.filter((c) => c.startsWith('lock:'))).toEqual([
        'lock:segment-stock:10:5:',
        'lock:segment-stock:10:9:',
      ]);
      expect(env.txMock.segmentReservation.update).toHaveBeenCalledWith({
        where: { id: 3n },
        data: { reservedQty: 0 },
      });
      expect(env.txMock.segmentReservation.update).toHaveBeenCalledWith({
        where: { id: 2n },
        data: { reservedQty: 4 },
      });
      expect(env.txMock.segmentReservationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          reservationId: 2n,
          kind: SegmentReservationLogKind.RELEASE,
          qty: 6,
          refType: 'PI_FINISHED',
          createdById: 'u1',
        }),
      });
      expect(env.ledger.postEntry).not.toHaveBeenCalled();
      expect(env.txMock.segmentProduction.upsert).not.toHaveBeenCalled();
    });

    it('idempotent: gọi lại khi mọi dòng đã nhả -> không làm gì', async () => {
      const env = makeEnv();
      env.txMock.segmentReservation.findMany.mockResolvedValue([
        {
          id: 1n,
          warehouseId: WH,
          segmentSpecId: SPEC,
          segmentSteps: '',
          reservedQty: dec(4),
          consumedQty: dec(4),
        },
      ] as never);

      const result = await env.service.releaseOrderHoldings(env.tx, {
        productionInvoiceId: PI,
        reason: 'PI_FINISHED',
      });

      expect(result).toEqual({ releasedQty: 0, reservationCount: 0 });
      expect(env.txMock.$executeRaw).not.toHaveBeenCalled();
      expect(env.txMock.segmentReservation.update).not.toHaveBeenCalled();
      expect(env.txMock.segmentReservationLog.create).not.toHaveBeenCalled();
    });
  });

  describe('getBalances', () => {
    it('gộp tồn + giữ theo ô; dư = tồn - giữ KHÔNG kẹp (âm vẫn âm); ô chỉ có giữ vẫn hiện; sắp theo kho, sắt, dài giảm dần', async () => {
      const env = makeEnv();
      env.prisma.stockQuant.findMany.mockResolvedValue([
        { warehouseId: 1n, segmentSpecId: 11n, segmentSteps: '', qty: dec(-6) },
        { warehouseId: 1n, segmentSpecId: 12n, segmentSteps: 'DAP', qty: dec(20) },
        { warehouseId: 1n, segmentSpecId: 12n, segmentSteps: '', qty: dec(8) },
      ]);
      env.prisma.segmentReservation.findMany.mockResolvedValue([
        {
          warehouseId: 1n,
          segmentSpecId: 12n,
          segmentSteps: 'DAP',
          reservedQty: dec(10),
          consumedQty: dec(4),
        },
        {
          warehouseId: 1n,
          segmentSpecId: 12n,
          segmentSteps: 'DAP',
          reservedQty: dec(5),
          consumedQty: dec(0),
        },
        {
          warehouseId: 1n,
          segmentSpecId: 11n,
          segmentSteps: '',
          reservedQty: dec(2),
          consumedQty: dec(0),
        },
        // Đã dùng hết -> không tính là lệnh đang giữ.
        {
          warehouseId: 1n,
          segmentSpecId: 12n,
          segmentSteps: '',
          reservedQty: dec(3),
          consumedQty: dec(3),
        },
        // Ô không có stock_quant nhưng có lệnh còn giữ.
        {
          warehouseId: 2n,
          segmentSpecId: 11n,
          segmentSteps: 'UON',
          reservedQty: dec(1),
          consumedQty: dec(0),
        },
      ]);
      env.prisma.warehouse.findMany.mockResolvedValue([
        { id: 1n, code: 'PHOI-A', name: 'Phôi A' },
        { id: 2n, code: 'PHOI-B', name: 'Phôi B' },
      ]);
      env.prisma.segmentSpec.findMany.mockResolvedValue([
        { id: 11n, cutLengthMm: dec(300), material: { id: 7n, code: 'SAT-005', name: 'Sắt 5' } },
        { id: 12n, cutLengthMm: dec(460), material: { id: 7n, code: 'SAT-005', name: 'Sắt 5' } },
      ]);

      const rows = await env.service.getBalances({ warehouseId: undefined });

      expect(
        rows.map((r) => [
          r.warehouseCode,
          r.cutLengthMm,
          r.segmentSteps,
          r.onHandQty,
          r.heldQty,
          r.surplusQty,
          r.holdingOrderCount,
        ]),
      ).toEqual([
        ['PHOI-A', 460, '', 8, 0, 8, 0],
        ['PHOI-A', 460, 'DAP', 20, 11, 9, 2],
        ['PHOI-A', 300, '', -6, 2, -8, 1],
        ['PHOI-B', 300, 'UON', 0, 1, -1, 1],
      ]);
      expect(rows[1]).toMatchObject({
        warehouseId: '1',
        segmentSpecId: '12',
        materialId: '7',
        materialCode: 'SAT-005',
        segmentStepsLabel: 'Dập',
        label: 'SAT-005 @ 460mm · Dập',
      });
      // Truy vấn gộp: 1 lần mỗi bảng, không N+1.
      expect(env.prisma.warehouse.findMany).toHaveBeenCalledTimes(1);
      expect(env.prisma.segmentSpec.findMany).toHaveBeenCalledTimes(1);
    });

    it('lọc materialId đẩy xuống cả 2 truy vấn', async () => {
      const env = makeEnv();
      env.prisma.stockQuant.findMany.mockResolvedValue([]);
      env.prisma.segmentReservation.findMany.mockResolvedValue([]);

      const rows = await env.service.getBalances({ materialId: 7n, warehouseId: 1n });

      expect(rows).toEqual([]);
      expect(env.prisma.stockQuant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            warehouseId: 1n,
            segmentSpec: { materialId: 7n },
            segmentSpecId: { not: null },
          }),
        }),
      );
      expect(env.prisma.segmentReservation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ warehouseId: 1n, segmentSpec: { materialId: 7n } }),
        }),
      );
    });
  });

  describe('getOrderHoldings', () => {
    it('lệnh không tồn tại -> NotFound', async () => {
      const env = makeEnv();
      env.prisma.productionInvoice.findUnique.mockResolvedValue(null);
      await expect(env.service.getOrderHoldings(1n)).rejects.toThrow(NotFoundException);
    });

    it('gộp reservation + SegmentProduction (mã chỉ có SegmentProduction vẫn hiện) + nhật ký, id trả chuỗi', async () => {
      const env = makeEnv();
      env.prisma.productionInvoice.findUnique.mockResolvedValue({ id: PI, code: 'LSX-1' });
      env.prisma.segmentReservation.findMany.mockResolvedValue([
        {
          warehouseId: 1n,
          segmentSpecId: 12n,
          segmentSteps: 'DAP',
          reservedQty: dec(10),
          consumedQty: dec(4),
        },
      ]);
      env.prisma.segmentProduction.findMany.mockResolvedValue([
        {
          warehouseId: 1n,
          segmentSpecId: 12n,
          segmentSteps: 'DAP',
          heldQty: dec(10),
          surplusQty: dec(2),
        },
        {
          warehouseId: 1n,
          segmentSpecId: 11n,
          segmentSteps: '',
          heldQty: dec(0),
          surplusQty: dec(3),
        },
      ]);
      env.prisma.segmentReservationLog.findMany.mockResolvedValue([
        {
          id: 9n,
          kind: 'CONSUME',
          qty: dec(4),
          refType: 'SEGMENT_CONSUME',
          refId: '55',
          note: null,
          createdAt: new Date('2026-11-13T00:00:00Z'),
          createdById: 'u1',
          reservation: { warehouseId: 1n, segmentSpecId: 12n, segmentSteps: 'DAP' },
        },
      ]);
      env.prisma.warehouse.findMany.mockResolvedValue([{ id: 1n, code: 'PHOI-A', name: 'Phôi A' }]);
      env.prisma.segmentSpec.findMany.mockResolvedValue([
        { id: 11n, cutLengthMm: dec(300), material: { id: 7n, code: 'SAT-005', name: 'Sắt 5' } },
        { id: 12n, cutLengthMm: dec(460), material: { id: 7n, code: 'SAT-005', name: 'Sắt 5' } },
      ]);

      const result = await env.service.getOrderHoldings(PI);

      expect(result.productionInvoiceId).toBe('100');
      expect(result.productionInvoiceCode).toBe('LSX-1');
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toMatchObject({
        warehouse: { id: '1', code: 'PHOI-A', name: 'Phôi A' },
        segmentSpecId: '12',
        label: 'SAT-005 @ 460mm · Dập',
        reservedQty: 10,
        consumedQty: 4,
        remainingQty: 6,
        producedHeldQty: 10,
        producedSurplusQty: 2,
      });
      expect(result.rows[1]).toMatchObject({
        segmentSpecId: '11',
        reservedQty: 0,
        remainingQty: 0,
        producedSurplusQty: 3,
      });
      expect(result.logs[0]).toMatchObject({
        id: '9',
        kind: 'CONSUME',
        qty: 4,
        warehouseId: '1',
        segmentSpecId: '12',
        label: 'SAT-005 @ 460mm · Dập',
        refId: '55',
      });
      expect(env.prisma.segmentReservationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });
  });
});
