import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { FloorReportKind } from '../../generated/prisma/client';
import { FLOOR_REPORT_REVERSED_REPLAY_MESSAGE } from '../../common/utils/floor-report.util';
import { IdempotencyKeyReusedException } from '../../common/utils/idempotency.util';
import { MfgStage, ProcessStep, StockLedgerRefType } from '../../generated/prisma/client';
import { PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { MaterialYieldIssuesService } from '../material-yield-issues/material-yield-issues.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProductionBatchesService } from './production-batches.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { SegmentStockService } from '../segment-stock/segment-stock.service';

/**
 * UB5 (QA, P1-T3-U1) - chặn báo vượt mảnh / pat, trừ đoạn lúc KCS chấm, gửi lại sau hủy, chốt.
 * AC22, AC23 (pat; viết lại theo Câu 6 ngày 19/11: pat được báo vượt, chỉ ghi log) + CĐ-4, AC24, AC35 (kế hoạch mảnh), AC37 (BE-3), AC53 (mảnh), MF3 (khoá), MF10 (2 lô 60).
 * Sổ dữ liệu (lô, sổ kho, Sổ báo vượt) là bộ nhớ có trạng thái: lần ghi trước hiện ra ở lần đọc sau.
 */

interface BatchState {
  id: bigint;
  status: 'OPEN' | 'AWAITING_QC' | 'QC_DONE';
  reportedQty: number;
  reportedById: string;
  stage: MfgStage;
  pieceId: bigint;
  reworkOfId: bigint | null;
}

const ORDER_ID = 1n;
const PIECE = { id: 40n, code: 'MANH-TUA', name: 'Mảnh tựa' };
const order = {
  id: ORDER_ID,
  poNumber: 'PO-31-1',
  bomRevisionId: 5n,
  quantity: 10,
  productionInvoiceItemId: 20n,
  mfgProduct: { name: 'SP-1', factoryCode: 'SKU-1' },
  productionInvoiceItem: { productionInvoiceId: 500n, salesOrder: { orderCode: 'PO-31' } },
};
type MockGroup = Record<string, jest.Mock>;

function build(opts: { qtyPerUnit?: number; bomPiece?: boolean } = {}) {
  const state = {
    batches: [] as BatchState[],
    ledger: [] as { refType: string; refId: string }[],
    overages: [] as Record<string, unknown>[],
    reviewFailed: 0,
  };
  let seq = 700n;
  const qtyPerUnit = opts.qtyPerUnit ?? 24; // cần 24 x 10 = 240
  const bomPieceRow =
    opts.bomPiece === false
      ? null
      : { id: 1n, bomRevisionId: 5n, pieceId: 40n, qtyPerUnit, needsHan: true, needsSon: true };
  const rowOf = (b: BatchState) => ({
    ...b,
    idempotencyKey: null,
    reportedAt: new Date(),
    productionOrderId: ORDER_ID,
    productionOrder: order,
    piece: PIECE,
  });
  const prisma = {} as Record<string, MockGroup | jest.Mock>;
  prisma.productionBatch = {
    findUnique: jest.fn().mockImplementation((a: { where: { id?: bigint } }) => {
      const b = state.batches.find((x) => x.id === a.where.id);
      return Promise.resolve(b ? rowOf(b) : null);
    }),
    findUniqueOrThrow: jest.fn().mockImplementation((a: { where: { id: bigint } }) => {
      const b = state.batches.find((x) => x.id === a.where.id)!;
      return Promise.resolve(rowOf(b));
    }),
    findFirst: jest
      .fn()
      .mockImplementation((a: { where: { status: string; reportedById: string } }) =>
        Promise.resolve(
          state.batches.find(
            (b) => b.status === a.where.status && b.reportedById === a.where.reportedById,
          ) ?? null,
        ),
      ),
    findMany: jest
      .fn()
      .mockImplementation(
        (a: {
          where: { status?: { not: string }; id?: { not: bigint }; productionOrderId: bigint };
        }) =>
          Promise.resolve(
            state.batches
              .filter((b) => (a.where.status ? b.status !== a.where.status.not : true))
              .filter((b) => (a.where.id ? b.id !== a.where.id.not : true))
              .map((b) => ({
                id: b.id,
                reportedQty: b.reportedQty,
                status: b.status,
                pieceId: b.pieceId,
              })),
          ),
      ),
    aggregate: jest.fn().mockImplementation(() =>
      Promise.resolve({
        _sum: { reportedQty: state.batches.reduce((t, b) => t + b.reportedQty, 0) || null },
      }),
    ),
    create: jest.fn().mockImplementation(
      (a: {
        data: {
          stage: MfgStage;
          reportedQty: number;
          reportedById: string;
          status?: BatchState['status'];
        };
      }) => {
        const b: BatchState = {
          id: ++seq,
          status: a.data.status ?? 'AWAITING_QC',
          reportedQty: a.data.reportedQty,
          reportedById: a.data.reportedById,
          stage: a.data.stage,
          pieceId: 40n,
          reworkOfId: null,
        };
        state.batches.push(b);
        return Promise.resolve(rowOf(b));
      },
    ),
    update: jest
      .fn()
      .mockImplementation((a: { where: { id: bigint }; data: { reportedQty: number } }) => {
        const b = state.batches.find((x) => x.id === a.where.id)!;
        b.reportedQty = a.data.reportedQty;
        return Promise.resolve(rowOf(b));
      }),
    updateMany: jest
      .fn()
      .mockImplementation(
        (a: {
          where: { id: bigint; status: BatchState['status'] };
          data: { status: BatchState['status'] };
        }) => {
          const b = state.batches.find((x) => x.id === a.where.id);
          if (!b || b.status !== a.where.status) return Promise.resolve({ count: 0 });
          b.status = a.data.status;
          return Promise.resolve({ count: 1 });
        },
      ),
  } as MockGroup;
  prisma.productionOrder = {
    findUnique: jest.fn().mockResolvedValue(order),
    findFirst: jest.fn().mockResolvedValue({ id: 9n }),
    findMany: jest.fn().mockResolvedValue([order]),
  };
  prisma.productionInvoiceItem = {
    findUniqueOrThrow: jest.fn().mockResolvedValue({ productionInvoiceId: 500n }),
    findFirst: jest.fn().mockResolvedValue(null),
  };
  prisma.bomPiece = {
    findUnique: jest.fn().mockResolvedValue(bomPieceRow),
    findMany: jest.fn().mockResolvedValue(bomPieceRow ? [{ ...bomPieceRow, piece: PIECE }] : []),
    findFirst: jest.fn().mockResolvedValue({ qtyPerUnit }),
  };
  prisma.pieceBom = {
    findMany: jest.fn().mockResolvedValue([
      { segmentSpecId: 60n, qtyPerPiece: 2, processSteps: ['CAT'] },
      { segmentSpecId: 61n, qtyPerPiece: 1, processSteps: ['CAT'] },
    ]),
  };
  prisma.pieceMaterialYield = {
    findUnique: jest.fn().mockResolvedValue(null),
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
  };
  prisma.pieceStepBatch = {
    findUnique: jest.fn().mockResolvedValue(null),
    aggregate: jest.fn().mockResolvedValue({ _sum: { qty: null } }),
    groupBy: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation((a: { data: { qty: number; step: string } }) =>
      Promise.resolve({
        id: 1n,
        productionOrderId: ORDER_ID,
        pieceId: 40n,
        step: a.data.step,
        qty: a.data.qty,
        reportedById: 'tk-1',
        reportedAt: new Date(),
      }),
    ),
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  };
  prisma.pieceStepBundle = {
    findUnique: jest.fn().mockResolvedValue(null),
    groupBy: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
  };
  prisma.qcReview = {
    findMany: jest.fn().mockResolvedValue([]),
    aggregate: jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve({ _sum: { failedQty: state.reviewFailed, shortQty: null } }),
      ),
  };
  prisma.materialYieldRecipe = { findMany: jest.fn().mockResolvedValue([]) };
  prisma.pieceMaterialItem = { findMany: jest.fn().mockResolvedValue([]) };
  prisma.materialYieldStepBundle = { findMany: jest.fn().mockResolvedValue([]) };
  prisma.materialYieldStepBatch = { groupBy: jest.fn().mockResolvedValue([]) };
  prisma.warehouseTransferPieceItem = { findMany: jest.fn().mockResolvedValue([]) };
  prisma.stockQuant = { findMany: jest.fn().mockResolvedValue([]) };
  prisma.piece = { findUnique: jest.fn().mockResolvedValue(PIECE) };
  prisma.segmentOverage = {
    findUnique: jest.fn().mockResolvedValue(null),
    findFirst: jest
      .fn()
      .mockImplementation((a: { where: { productionBatchId: bigint } }) =>
        Promise.resolve(
          state.overages.find((o) => o.productionBatchId === a.where.productionBatchId) ?? null,
        ),
      ),
    findMany: jest
      .fn()
      .mockImplementation((a: { where: { productionBatchId: { in: bigint[] } | bigint } }) => {
        const w = a.where.productionBatchId;
        const ids = typeof w === 'bigint' ? [w] : w.in;
        return Promise.resolve(
          state.overages
            .filter((o) => ids.includes(o.productionBatchId as bigint))
            .map((o) => ({
              ...o,
              productionInvoice: { code: 'PI-500' },
              productionBatch: { piece: { code: PIECE.code } },
            })),
        );
      }),
    create: jest.fn().mockImplementation((a: { data: Record<string, unknown> }) => {
      state.overages.push(a.data);
      return Promise.resolve({});
    }),
  };
  prisma.stockLedger = {
    findMany: jest
      .fn()
      .mockImplementation((a: { where: { refId: { in: string[] } } }) =>
        Promise.resolve(state.ledger.filter((l) => a.where.refId.in.includes(l.refId))),
      ),
    findFirst: jest
      .fn()
      .mockImplementation((a: { where: { refType: string; refId: string } }) =>
        Promise.resolve(
          state.ledger.find((l) => l.refType === a.where.refType && l.refId === a.where.refId) ??
            null,
        ),
      ),
  };
  prisma.warehouse = {
    findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 90n, code: 'phoi-son-han' }),
    findUnique: jest.fn().mockResolvedValue({ id: 90n, code: 'phoi-son-han' }),
    findFirst: jest.fn().mockResolvedValue({ id: 95n, code: 'phoi-son-han-phoi-pha' }),
  };
  prisma.floorReport = {
    create: jest.fn().mockResolvedValue({ id: 900n }),
    findUnique: jest.fn().mockResolvedValue(null),
  };
  prisma.$queryRaw = jest.fn(() => Promise.resolve([{ floorStage: 'ACTIVE' }]));
  prisma.$executeRaw = jest.fn().mockResolvedValue(undefined);
  prisma.$transaction = jest.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(prisma)));

  const stockLedgerService = { postEntry: jest.fn().mockResolvedValue({}) };
  const segmentStock = {
    consumeForOrder: jest.fn(),
  };
  const notifications = {
    emit: jest.fn().mockResolvedValue(undefined),
    resolve: jest.fn().mockResolvedValue(undefined),
  };
  const sumReceived = jest.fn().mockResolvedValue(100);
  const service = new ProductionBatchesService(
    prisma as unknown as PrismaServiceType,
    stockLedgerService as unknown as StockLedgerService,
    { sumReceived } as unknown as MaterialYieldIssuesService,
    notifications as unknown as NotificationsService,
    {
      publishEntityChanged: jest.fn(),
      publishNotificationCreated: jest.fn(),
    } as unknown as RealtimeService,
    segmentStock as unknown as SegmentStockService,
  );
  return { prisma, state, service, stockLedgerService, segmentStock, notifications, sumReceived };
}

async function errOf(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error('Lẽ ra phải ném lỗi');
}

const addBatch = (
  state: ReturnType<typeof build>['state'],
  over: Partial<BatchState> & { id: bigint },
): BatchState => {
  const b: BatchState = {
    status: 'AWAITING_QC',
    reportedQty: 0,
    reportedById: 'cn-1',
    stage: MfgStage.HAN,
    pieceId: 40n,
    reworkOfId: null,
    ...over,
  };
  state.batches.push(b);
  return b;
};

describe('UB5 production-batches chặn vượt / trừ đoạn lúc chấm (QA)', () => {
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;
  const OLD_ENV = process.env.SEGMENT_STOCK_ENABLED;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    process.env.SEGMENT_STOCK_ENABLED = 'true';
  });
  afterEach(() => {
    warn.mockRestore();
    log.mockRestore();
    if (OLD_ENV === undefined) delete process.env.SEGMENT_STOCK_ENABLED;
    else process.env.SEGMENT_STOCK_ENABLED = OLD_ENV;
  });

  const rec = (s: ProductionBatchesService, qty: number, user = 'cn-1', key?: string) =>
    s.recordProductionBatch('1', { pieceId: '40', qty, stage: MfgStage.HAN }, user, null, key);

  describe('AC22: báo mảnh Hàn vượt số cần', () => {
    it('AC22: cần 240, đã báo 230 (gồm lô đang mở) -> báo 15 nhận 400 "tối đa 10"; sau khi KCS chấm lỗi 12 (số lô ghi đè 230 -> 218) báo 22 được, báo 23 bị chặn; overPlanWarning luôn null', async () => {
      const { service, state } = build();
      const lot = addBatch(state, { id: 650n, status: 'AWAITING_QC', reportedQty: 230 });

      const e1 = await errOf(rec(service, 15));
      expect(e1).toBeInstanceOf(BadRequestException);
      expect(e1.message).toContain('cần 240');
      expect(e1.message).toContain('đã báo 230');
      expect(e1.message).toContain('tối đa 10');
      expect(e1.message).toContain('bạn nhập 15');
      expect(e1.message).toContain('Số cần sai thì báo QLSX.');

      // KCS chấm lô 230, lỗi 12 -> reportedQty = 218 (QC_DONE)
      lot.status = 'QC_DONE';
      lot.reportedQty = 218;
      const e2 = await errOf(rec(service, 23));
      expect(e2.message).toContain('tối đa 22');
      const ok = await rec(service, 22);
      expect(ok.overPlanWarning).toBeNull();
    });

    it('AC22: còn 10, 2 người cùng báo 8 (lần lượt, khoá gom) -> đúng 1 lần qua, lần kia "tối đa 2"; không ghi dòng sổ ở lần bị chặn', async () => {
      const { service, state, prisma } = build();
      addBatch(state, { id: 650n, status: 'QC_DONE', reportedQty: 230 });
      await expect(rec(service, 8, 'cn-1')).resolves.toBeDefined();
      const err = await errOf(rec(service, 8, 'cn-2'));
      expect(err.message).toContain('tối đa 2');
      expect((prisma.floorReport as MockGroup).create).toHaveBeenCalledTimes(1);
    });

    it('AC22: lần báo qua ghi cộng dồn đợt OPEN của chính người báo (không mở đợt thứ 2)', async () => {
      const { service, state } = build();
      await rec(service, 5, 'cn-1');
      await rec(service, 4, 'cn-1');
      const mine = state.batches.filter((b) => b.reportedById === 'cn-1');
      expect(mine).toHaveLength(1);
      expect(mine[0].reportedQty).toBe(9);
    });

    it('AC22: mảnh không có trong định mức (số cần 0) -> câu "Lệnh không cần mảnh ... theo định mức"', async () => {
      const { service } = build({ qtyPerUnit: 0 });
      const err = await errOf(rec(service, 1));
      expect(err.message).toBe(
        'Lệnh không cần mảnh Mảnh tựa theo định mức - báo QLSX để KHSX / Spec kiểm định mức.',
      );
    });

    it('AC22: bị chặn thì có đúng 1 dòng logger.warn và không ghi gì (không đợt, không dòng sổ)', async () => {
      const { service, state, prisma } = build();
      addBatch(state, { id: 650n, status: 'QC_DONE', reportedQty: 240 });
      await expect(rec(service, 1)).rejects.toThrow(BadRequestException);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String((warn.mock.calls as unknown[][])[0][0])).toContain('Chặn báo vượt');
      expect((prisma.productionBatch as MockGroup).create).not.toHaveBeenCalled();
      expect((prisma.floorReport as MockGroup).create).not.toHaveBeenCalled();
    });

    it('MF3: recordProductionBatch lấy khoá advisory production-batch-open TRƯỚC FOR UPDATE production_orders', async () => {
      const { service, prisma } = build();
      await rec(service, 1);
      const keys = ((prisma.$executeRaw as jest.Mock).mock.calls as unknown[][]).map((c) => c[1]);
      expect(keys[0]).toBe('production-batch-open:1:40:HAN');
      expect((prisma.$executeRaw as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
        (prisma.$queryRaw as jest.Mock).mock.invocationCallOrder[0],
      );
    });

    it('MF3 + AC22: create() (tài khoản thống kê) cũng bị chặn vượt, khoá advisory là câu ĐẦU của transaction, overPlanWarning null', async () => {
      const { service, state, prisma } = build();
      addBatch(state, { id: 650n, status: 'QC_DONE', reportedQty: 235 });
      const err = await errOf(
        service.create(
          '1',
          { stage: MfgStage.HAN, pieceId: '40', reportedQty: 6 },
          'tk-1',
          null,
          null,
        ),
      );
      expect(err.message).toContain('tối đa 5');
      const ok = await service.create(
        '1',
        { stage: MfgStage.HAN, pieceId: '40', reportedQty: 5 },
        'tk-1',
        null,
        null,
      );
      expect(ok.overPlanWarning).toBeNull();
      const first = ((prisma.$executeRaw as jest.Mock).mock.calls as unknown[][])[0][1];
      expect(first).toBe('production-batch-open:1:40:HAN');
    });
  });

  describe('AC24: Lưu không đụng kho; tồn đoạn trừ lúc KCS chấm', () => {
    it('AC24: công tắc bật, kho thiếu đoạn: Lưu (recordProductionBatch) và chốt (finishProductionBatch) KHÔNG trừ đoạn, không ghi Sổ báo vượt, không phát tin', async () => {
      const { service, state, stockLedgerService, segmentStock, notifications, prisma } = build();
      await rec(service, 60);
      const lot = state.batches[0];
      await service.finishProductionBatch(String(lot.id), 'kcs-1', null, null, {
        notifyKcs: false,
        gateLabel: 'chốt để chấm',
      });
      expect(lot.status).toBe('AWAITING_QC');
      expect(segmentStock.consumeForOrder).not.toHaveBeenCalled();
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
      expect((prisma.segmentOverage as MockGroup).create).not.toHaveBeenCalled();
      expect(notifications.emit).not.toHaveBeenCalled();
    });

    it('AC24: KCS lưu kết quả (Thực có 60): consumeForOrder mỗi mã đoạn với đúng số; thiếu đoạn thì ghi Sổ báo vượt với NGƯỜI BÁO, rồi afterReviewCommitted phát SEGMENT_OVERAGE_REPORTED với KCS', async () => {
      const { service, state, segmentStock, notifications, prisma } = build();
      const lot = addBatch(state, {
        id: 700n,
        status: 'AWAITING_QC',
        reportedQty: 60,
        reportedById: 'cn-han',
      });
      segmentStock.consumeForOrder.mockResolvedValue({
        takenQty: 100,
        fromHeldQty: 100,
        fromSurplusQty: 0,
        shortageQty: 20,
        duplicate: false,
      });
      await service.consumeSegmentsAtReviewInTx(prisma as unknown as PrismaTx, lot.id, 60, 'kcs-1');
      const qtys = (segmentStock.consumeForOrder.mock.calls as unknown[][]).map(
        (c) => (c[1] as { segmentSpecId: bigint; qty: number }).qty,
      );
      expect(qtys.sort((a, b) => a - b)).toEqual([60, 120]); // 1 và 2 đoạn / mảnh
      const created = (
        (prisma.segmentOverage as MockGroup).create.mock.calls as {
          0: { data: Record<string, unknown> };
        }[]
      ).map((c) => c[0].data);
      expect(created.length).toBeGreaterThan(0);
      for (const d of created) {
        expect(d.reportedById).toBe('cn-han');
        expect(d.shortageQty).toBe(20);
      }
      expect(notifications.emit).not.toHaveBeenCalled(); // chưa phát trong transaction
      await service.afterReviewCommitted(lot.id, 'kcs-1');
      expect(notifications.emit).toHaveBeenCalledWith(
        'SEGMENT_OVERAGE_REPORTED',
        expect.objectContaining({
          actorId: 'kcs-1',
          dedupeKey: `SEGMENT_OVERAGE_REPORTED:${lot.id}`,
        }),
      );
    });

    it('AC24: công tắc tắt -> afterReviewCommitted không phát tin và không đọc gì', async () => {
      process.env.SEGMENT_STOCK_ENABLED = 'false';
      const { service, notifications, prisma } = build();
      await service.afterReviewCommitted(700n, 'kcs-1');
      expect(notifications.emit).not.toHaveBeenCalled();
      expect((prisma.segmentOverage as MockGroup).findMany).not.toHaveBeenCalled();
    });
  });

  describe('AC35 / AC36 / MF10: trừ đoạn đúng số, không trừ trùng, 2 lô cùng chờ chấm', () => {
    const consume = (s: ProductionBatchesService, prisma: unknown, id: bigint, qty: number) =>
      s.consumeSegmentsAtReviewInTx(prisma as PrismaTx, id, qty, 'kcs-1');
    const takeAll =
      (state: ReturnType<typeof build>['state']) =>
      (_tx: unknown, i: { qty: number; refId: string }) => {
        state.ledger.push({ refType: StockLedgerRefType.SEGMENT_CONSUME, refId: i.refId });
        return Promise.resolve({
          takenQty: i.qty,
          fromHeldQty: i.qty,
          fromSurplusQty: 0,
          shortageQty: 0,
          duplicate: false,
        });
      };

    it('AC35: Thực có 56 (báo 60, thiếu 4, lỗi 1) -> trừ đoạn cho 56 mảnh, không phải 60 hay 55', async () => {
      const { service, state, prisma, segmentStock } = build({ qtyPerUnit: 24 });
      const lot = addBatch(state, { id: 700n, reportedQty: 56 }); // BE-1 đã ghi báo - thiếu
      segmentStock.consumeForOrder.mockImplementation(takeAll(state));
      await consume(service, prisma, lot.id, 56);
      const qtys = (segmentStock.consumeForOrder.mock.calls as unknown[][])
        .map((c) => (c[1] as { qty: number }).qty)
        .sort((a, b) => a - b);
      expect(qtys).toEqual([56, 112]);
    });

    it('AC36: lô đã trừ đoạn (có bút toán SEGMENT_CONSUME, bất kỳ khoá) hoặc đã có Sổ báo vượt thì chấm lại KHÔNG trừ lần 2; số thực có 0 không trừ', async () => {
      const a = build();
      const lotA = addBatch(a.state, { id: 700n, reportedQty: 60 });
      a.state.ledger.push({ refType: StockLedgerRefType.SEGMENT_CONSUME, refId: '700' });
      await consume(a.service, a.prisma, lotA.id, 60);
      expect(a.segmentStock.consumeForOrder).not.toHaveBeenCalled();

      const b = build();
      const lotB = addBatch(b.state, { id: 701n, reportedQty: 60 });
      b.state.overages.push({ productionBatchId: 701n });
      await consume(b.service, b.prisma, lotB.id, 60);
      expect(b.segmentStock.consumeForOrder).not.toHaveBeenCalled();

      const c = build();
      const lotC = addBatch(c.state, { id: 702n, reportedQty: 60 });
      await consume(c.service, c.prisma, lotC.id, 0);
      expect(c.segmentStock.consumeForOrder).not.toHaveBeenCalled();
    });

    it('MF10: kế hoạch 100, 2 lô 60 cùng chờ chấm -> lô chấm TRƯỚC không ghi vượt (lô kia chưa trừ gì), lô chấm SAU ghi vượt 20 (tổng vượt 20, không phải 40)', async () => {
      // Lệnh 10 bộ, qtyPerUnit 10 -> kế hoạch 100 mảnh.
      const { service, state, prisma, segmentStock } = build({ qtyPerUnit: 10 });
      const a = addBatch(state, { id: 701n, reportedQty: 60, reportedById: 'cn-a' });
      const b = addBatch(state, { id: 702n, reportedQty: 60, reportedById: 'cn-b' });
      segmentStock.consumeForOrder.mockImplementation(takeAll(state));

      // KCS chấm lô B trước (A vẫn chờ, chưa trừ gì)
      await consume(service, prisma, b.id, 60);
      expect(state.overages).toHaveLength(0);
      b.status = 'QC_DONE';

      // rồi chấm lô A: B đã trừ -> cộng dồn 120 trên kế hoạch 100 -> vượt 20
      await consume(service, prisma, a.id, 60);
      const over = state.overages.filter((o) => (o.overPieces as number) > 0);
      expect(over.length).toBeGreaterThan(0);
      for (const o of over) {
        expect(o.overPieces).toBe(20);
        expect(o.productionBatchId).toBe(701n);
      }
      const totalOverPieces = Math.max(...over.map((o) => o.overPieces as number));
      expect(totalOverPieces).toBe(20);
    });

    it('MF10: lô gửi KCS TRƯỚC deploy đã trừ đoạn (có bút toán) và đang chờ chấm vẫn được tính là "lô trước" của lô sau', async () => {
      const { service, state, prisma, segmentStock } = build({ qtyPerUnit: 10 });
      addBatch(state, { id: 701n, reportedQty: 60, status: 'AWAITING_QC' });
      state.ledger.push({ refType: StockLedgerRefType.SEGMENT_CONSUME, refId: '701' });
      const b = addBatch(state, { id: 702n, reportedQty: 60 });
      segmentStock.consumeForOrder.mockImplementation(takeAll(state));
      await consume(service, prisma, b.id, 60);
      const over = state.overages.filter((o) => (o.overPieces as number) > 0);
      expect(over.length).toBeGreaterThan(0);
      expect(over[0].overPieces).toBe(20);
    });

    it('MF3: lockBatchKeysInTx lấy khoá chia sẻ chuyển đổi tồn đoạn TRƯỚC khoá production-batch-open (công tắc bật); công tắc tắt chỉ lấy production-batch-open', async () => {
      const on = build();
      await on.service.lockBatchKeysInTx(on.prisma as unknown as PrismaTx, {
        productionOrderId: 1n,
        pieceId: 40n,
        stage: MfgStage.HAN,
      });
      const keysOn = ((on.prisma.$executeRaw as jest.Mock).mock.calls as unknown[][]).map(
        (c) => c[1],
      );
      expect(keysOn).toEqual(['segment-legacy-conversion', 'production-batch-open:1:40:HAN']);
      process.env.SEGMENT_STOCK_ENABLED = 'false';
      const off = build();
      await off.service.lockBatchKeysInTx(off.prisma as unknown as PrismaTx, {
        productionOrderId: 1n,
        pieceId: 40n,
        stage: MfgStage.HAN,
      });
      const keysOff = ((off.prisma.$executeRaw as jest.Mock).mock.calls as unknown[][]).map(
        (c) => c[1],
      );
      expect(keysOff).toEqual(['production-batch-open:1:40:HAN']);
    });
  });

  describe('finishProductionBatch - KCS chốt lô (AC6 / AC8 / AC52)', () => {
    const closeOpts = { notifyKcs: false, gateLabel: 'chốt để chấm' };

    it('AC8: chốt khoá production-batch-open TRƯỚC khi đổi trạng thái; KCS chốt (notifyKcs false) không phát BATCH_TO_KCS, QLSX / thống kê gửi (mặc định) vẫn phát', async () => {
      const a = build();
      addBatch(a.state, { id: 700n, status: 'OPEN', reportedQty: 60 });
      await a.service.finishProductionBatch('700', 'kcs-1', null, null, closeOpts);
      const keys = ((a.prisma.$executeRaw as jest.Mock).mock.calls as unknown[][]).map((c) => c[1]);
      expect(keys).toContain('production-batch-open:1:40:HAN');
      expect(a.notifications.emit).not.toHaveBeenCalled();

      const b = build();
      addBatch(b.state, { id: 700n, status: 'OPEN', reportedQty: 60 });
      await b.service.finishProductionBatch('700', 'tk-1', null, null);
      expect(b.notifications.emit).toHaveBeenCalledWith(
        'BATCH_TO_KCS',
        expect.objectContaining({ entityId: '700' }),
      );
    });

    it('AC6: lô đã chốt (không còn OPEN) -> 409 "Lô này vừa được chốt để chấm - tải lại trang."; chốt đồng thời 2 lời gọi chỉ 1 thành công', async () => {
      const { service, state } = build();
      addBatch(state, { id: 700n, status: 'AWAITING_QC', reportedQty: 60 });
      const err = await errOf(service.finishProductionBatch('700', 'kcs-1', null, null, closeOpts));
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe('Lô này vừa được chốt để chấm - tải lại trang.');

      const race = build();
      addBatch(race.state, { id: 701n, status: 'OPEN', reportedQty: 60 });
      const results = await Promise.allSettled([
        race.service.finishProductionBatch('701', 'kcs-1', null, null, closeOpts),
        race.service.finishProductionBatch('701', 'kcs-2', null, null, closeOpts),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect((failed.reason as Error).message).toBe(
        'Lô này vừa được chốt để chấm - tải lại trang.',
      );
    });

    it('lô không còn số nào để chấm (reportedQty 0) -> 400 "Lô này không còn số nào để chấm - tải lại trang."', async () => {
      const { service, state } = build();
      addBatch(state, { id: 700n, status: 'OPEN', reportedQty: 0 });
      const err = await errOf(service.finishProductionBatch('700', 'kcs-1', null, null, closeOpts));
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe('Lô này không còn số nào để chấm - tải lại trang.');
    });

    it('lệnh dừng -> 409 câu floor-gate nhãn "chốt để chấm"; nhãn mặc định "gửi KCS" cho đường cũ', async () => {
      const a = build();
      addBatch(a.state, { id: 700n, status: 'OPEN', reportedQty: 60 });
      (a.prisma.productionOrder as MockGroup).findFirst.mockResolvedValue(null);
      await expect(
        a.service.finishProductionBatch('700', 'kcs-1', null, null, closeOpts),
      ).rejects.toThrow('chưa/không thể chốt để chấm');
      await expect(a.service.finishProductionBatch('700', 'tk-1', null, null)).rejects.toThrow(
        'chưa/không thể gửi KCS',
      );
      expect(a.state.batches[0].status).toBe('OPEN');
    });

    it('AC52 (ghi nhận): lô đã bị xoá thì còn NotFound - việc đổi thành 409 "vừa bị QLSX hủy hết số" thuộc BE-4a', async () => {
      const { service } = build();
      (
        service as unknown as { prisma: { productionBatch: MockGroup } }
      ).prisma.productionBatch.findUnique.mockResolvedValue(null);
      await expect(
        service.finishProductionBatch('999', 'kcs-1', null, null, closeOpts),
      ).rejects.toThrow(/Không tìm thấy/);
    });
  });

  describe('AC53 (mảnh): gửi lại cùng Idempotency-Key sau khi QLSX hủy hết', () => {
    // Dòng sổ đã ghi, vân tay khớp với rec(service, 5, 'cn-1', ...): mảnh 40, 5 cái, tổ Hàn, lệnh 1, không qua máy QR.
    const prevReport = (over: Record<string, unknown> = {}) => ({
      kind: FloorReportKind.PIECE,
      reportedById: 'cn-1',
      workstationId: null,
      productionBatchId: 700n,
      lines: [{ segmentSpecId: null, pieceId: 40n, qty: 5 }],
      stepBatch: null,
      cutBundle: null,
      productionBatch: { stage: MfgStage.HAN, productionOrderId: ORDER_ID, pieceId: 40n },
      ...over,
    });

    it('khoá thuộc lần báo đã bị hủy (productionBatchId null) -> 409 FLOOR_REPORT_REVERSED_REPLAY_MESSAGE, không ghi dòng sổ / đợt mới', async () => {
      const { service, prisma } = build();
      (prisma.floorReport as MockGroup).findUnique.mockResolvedValue(
        prevReport({ productionBatchId: null, productionBatch: null }),
      );
      const err = await errOf(rec(service, 5, 'cn-1', 'K-9'));
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe(FLOOR_REPORT_REVERSED_REPLAY_MESSAGE);
      expect((prisma.productionBatch as MockGroup).create).not.toHaveBeenCalled();
      expect((prisma.floorReport as MockGroup).create).not.toHaveBeenCalled();
    });

    it('khoá đã dùng cho loại báo khác (báo Uốn) -> 422 IdempotencyKeyReusedException (T4-4: trước đây 409), không phải câu "đã bị hủy"', async () => {
      const { service, prisma } = build();
      (prisma.floorReport as MockGroup).findUnique.mockResolvedValue(
        prevReport({ kind: FloorReportKind.STEP, productionBatchId: null, productionBatch: null }),
      );
      const err = await errOf(rec(service, 5, 'cn-1', 'K-10'));
      expect(err).toBeInstanceOf(IdempotencyKeyReusedException);
      expect(err.message).not.toBe(FLOOR_REPORT_REVERSED_REPLAY_MESSAGE);
    });

    it('khoá còn hiệu lực (đợt còn) -> trả đợt cũ, không cộng lần 2', async () => {
      const { service, state, prisma } = build();
      const lot = addBatch(state, { id: 700n, status: 'OPEN', reportedQty: 5 });
      (prisma.floorReport as MockGroup).findUnique.mockResolvedValue(
        prevReport({ productionBatchId: lot.id }),
      );
      const res = await rec(service, 5, 'cn-1', 'K-11');
      expect(res.id).toBe('700');
      expect(lot.reportedQty).toBe(5);
    });
  });

  describe('pat (recordPieceStepBatch / submitPieceStep) - AC23, AC6', () => {
    const patSetup = (
      over: { required?: number; reported?: number; failed?: number; short?: number } = {},
    ) => {
      const ctx = build({ qtyPerUnit: (over.required ?? 300) / 10 });
      const p = ctx.prisma;
      (p.pieceMaterialYield as MockGroup).findMany.mockResolvedValue([
        { materialId: 7n, processSteps: [ProcessStep.CAT, ProcessStep.DAP] },
      ]);
      (p.pieceStepBatch as MockGroup).aggregate.mockResolvedValue({
        _sum: { qty: over.reported ?? 300 },
      });
      (p.qcReview as MockGroup).aggregate.mockResolvedValue({
        _sum: { failedQty: over.failed ?? 0, shortQty: over.short ?? 0 },
      });
      return ctx;
    };
    const dto = (qty: number) => ({
      pieceId: '40',
      step: ProcessStep.DAP,
      qty,
      stage: MfgStage.PHOI,
    });

    const vuotLogs = () =>
      (log.mock.calls as unknown[][])
        .map((c) => String(c[0]))
        .filter((l) => l.includes('Báo vượt'));

    it('AC23 (Câu 6): pat Dập cần 300, đã tính 300 -> lưu thêm 1 VẪN TẠO ĐƯỢC (không 400), ghi dòng báo, có đúng 1 logger.log "Báo vượt ... (cho phép)", không logger.warn', async () => {
      const { service, prisma } = patSetup();
      await expect(service.recordPieceStepBatch('1', dto(1), 'tk-1', null)).resolves.toBeDefined();
      const create = (prisma.pieceStepBatch as MockGroup).create;
      expect(create).toHaveBeenCalledTimes(1);
      expect(
        (create.mock.calls as { 0: { data: Record<string, unknown> } }[])[0][0].data,
      ).toMatchObject({ qty: 1, step: ProcessStep.DAP, productionOrderId: ORDER_ID });
      expect(vuotLogs()).toHaveLength(1);
      expect(vuotLogs()[0]).toContain('(cho phép');
      expect(warn).not.toHaveBeenCalled();
    });

    it('AC23 (Câu 6): báo vượt nhiều (cần 300, đã tính 300, báo 50) cũng qua; số lưu đúng 50', async () => {
      const { service, prisma } = patSetup();
      await expect(service.recordPieceStepBatch('1', dto(50), 'tk-1', null)).resolves.toBeDefined();
      const create = (prisma.pieceStepBatch as MockGroup).create;
      expect((create.mock.calls as { 0: { data: { qty: number } } }[])[0][0].data.qty).toBe(50);
    });

    it('AC23 (Câu 6): KCS lỗi 3 + thiếu 2 (đã tính 295, còn 5): báo 5 qua KHÔNG có log vượt; báo 6 vẫn qua nhưng có log "Báo vượt"', async () => {
      const a = patSetup({ failed: 3, short: 2 });
      await a.service.recordPieceStepBatch('1', dto(5), 'tk-1', null);
      expect(vuotLogs()).toHaveLength(0);
      const b = patSetup({ failed: 3, short: 2 });
      await expect(
        b.service.recordPieceStepBatch('1', dto(6), 'tk-1', null),
      ).resolves.toBeDefined();
      expect(vuotLogs()).toHaveLength(1);
    });

    it('AC23 (Câu 6): số cần 0 (mảnh qtyPerUnit 0) -> cũng tạo được, không 400, có log "Báo vượt"; khoá piece-step-batch vẫn lấy trước FOR UPDATE production_orders', async () => {
      const { service, prisma } = patSetup({ required: 0 });
      await expect(service.recordPieceStepBatch('1', dto(1), 'tk-1', null)).resolves.toBeDefined();
      expect((prisma.pieceStepBatch as MockGroup).create).toHaveBeenCalledTimes(1);
      expect(vuotLogs()).toHaveLength(1);
      const keys = ((prisma.$executeRaw as jest.Mock).mock.calls as unknown[][]).map((c) => c[1]);
      expect(keys[0]).toBe('piece-step-batch:1:40:DAP');
      expect((prisma.$executeRaw as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
        (prisma.$queryRaw as jest.Mock).mock.invocationCallOrder[0],
      );
    });

    it('CĐ-4 (Câu 6): 2 lần báo pat cùng lúc sát số cần (còn 10, mỗi lần 8) -> CẢ 2 thành công, 2 dòng được ghi (không mất lần nào)', async () => {
      const { service, prisma } = patSetup({ reported: 290 });
      const res = await Promise.allSettled([
        service.recordPieceStepBatch('1', dto(8), 'cn-1', null),
        service.recordPieceStepBatch('1', dto(8), 'cn-2', null),
      ]);
      expect(res.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      expect((prisma.pieceStepBatch as MockGroup).create).toHaveBeenCalledTimes(2);
    });

    it('Câu 6 giữ luật khác: công đoạn không có trong định mức vẫn 400; chưa nhận vật tư vẫn 400; không tạo dòng', async () => {
      const a = patSetup();
      const err = await errOf(
        a.service.recordPieceStepBatch(
          '1',
          { pieceId: '40', step: ProcessStep.UON, qty: 1, stage: MfgStage.PHOI },
          'tk-1',
          null,
        ),
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toContain('không có công đoạn');
      expect((a.prisma.pieceStepBatch as MockGroup).create).not.toHaveBeenCalled();

      const b = patSetup();
      b.sumReceived.mockResolvedValue(0);
      await expect(b.service.recordPieceStepBatch('1', dto(1), 'tk-1', null)).rejects.toThrow(
        /chưa được xác nhận nhận/,
      );
      expect((b.prisma.pieceStepBatch as MockGroup).create).not.toHaveBeenCalled();
    });

    it('Câu 6 giữ luật khác: Idempotency-Key đã dùng -> trả dòng cũ, không tạo thêm (kể cả khi đang vượt)', async () => {
      const { service, prisma } = patSetup();
      (prisma.pieceStepBatch as MockGroup).findUnique.mockResolvedValue({
        id: 9n,
        productionOrderId: ORDER_ID,
        pieceId: 40n,
        step: ProcessStep.DAP,
        qty: 4,
        reportedById: 'tk-1',
        reportedAt: new Date(),
      });
      await service.recordPieceStepBatch('1', dto(4), 'tk-1', null, 'K-PAT-1');
      expect((prisma.pieceStepBatch as MockGroup).create).not.toHaveBeenCalled();
    });

    const sub = { pieceId: '40', step: ProcessStep.DAP };
    const NO_PENDING =
      'Pat MANH-TUA công đoạn Dập: không còn lần báo nào chưa chấm (có thể vừa được chốt) - tải lại trang.';

    it('AC6: nhóm pat không còn dòng chưa gom -> 400 câu chung có mã mảnh + công đoạn (dùng chung cho KCS chốt và nút "Gửi KCS"), không tạo bundle', async () => {
      const { service, prisma } = patSetup();
      (prisma.pieceStepBatch as MockGroup).findMany.mockResolvedValue([]);
      const err = await errOf(
        service.submitPieceStep('1', sub, 'kcs-1', null, { gateLabel: 'chốt để chấm' }),
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe(NO_PENDING);
      expect((prisma.pieceStepBundle as MockGroup).create).not.toHaveBeenCalled();
      const err2 = await errOf(service.submitPieceStep('1', sub, 'tk-1', null));
      expect(err2.message).toBe(NO_PENDING);
    });

    it('AC6: gom thiếu dòng (bên kia vừa chốt: updateMany ít hơn số đọc) -> 400 câu chung để rollback', async () => {
      const { service, prisma } = patSetup();
      (prisma.pieceStepBatch as MockGroup).findMany.mockResolvedValue([
        { id: 1n, qty: 30 },
        { id: 2n, qty: 20 },
      ]);
      (prisma.pieceStepBundle as MockGroup).create.mockResolvedValue({ id: 5n, qty: 50 });
      (prisma.pieceStepBatch as MockGroup).updateMany.mockResolvedValue({ count: 1 });
      const err = await errOf(service.submitPieceStep('1', sub, 'kcs-1', null));
      expect(err.message).toBe(NO_PENDING);
    });

    it('AC11: lệnh dừng -> câu floor-gate nhãn "chốt để chấm"; mặc định "gửi KCS công đoạn"', async () => {
      const { service, prisma } = patSetup();
      (prisma.productionOrder as MockGroup).findFirst.mockResolvedValue(null);
      await expect(
        service.submitPieceStep('1', sub, 'kcs-1', null, { gateLabel: 'chốt để chấm' }),
      ).rejects.toThrow('chưa/không thể chốt để chấm');
      await expect(service.submitPieceStep('1', sub, 'tk-1', null)).rejects.toThrow(
        'chưa/không thể gửi KCS công đoạn',
      );
    });
  });

  describe('AC37 (BE-3): pat công đoạn cuối 50 / thiếu 3 / lỗi 1 -> 46', () => {
    const run = async (existing: number[] = []) => {
      const ctx = build();
      const p = ctx.prisma;
      (p.pieceMaterialYield as MockGroup).findMany.mockResolvedValue([
        { processSteps: [ProcessStep.CAT, ProcessStep.DAP] },
      ]);
      (p.pieceStepBundle as MockGroup).findMany.mockResolvedValue([
        { qty: 50, qcReviews: [{ failedQty: 1, shortQty: 3 }] },
      ]);
      (p.productionBatch as MockGroup).findMany.mockResolvedValue(
        existing.map((q) => ({ reportedQty: q })),
      );
      (p.productionBatch as MockGroup).create.mockImplementation(
        (a: { data: { reportedQty: number } }) => Promise.resolve({ id: 777n, ...a.data }),
      );
      (p.productionOrder as MockGroup).findUnique.mockResolvedValue({
        bomRevisionId: 5n,
        productionInvoiceItem: { productionInvoiceId: 500n },
      });
      const post = jest.spyOn(ctx.service, 'postPieceOutputIfFinal').mockResolvedValue(undefined);
      await ctx.service.autoFinalizePieceOutputIfLastStepComplete(
        p as unknown as PrismaTx,
        5n,
        1n,
        40n,
        ProcessStep.DAP,
        'kcs-1',
      );
      return { ...ctx, post };
    };

    it('AC37: sinh lô QC_DONE 46 và ghi mảnh vào kho 46; không đâu có số 49', async () => {
      const { prisma, post } = await run();
      const created = (
        (prisma.productionBatch as MockGroup).create.mock.calls as {
          0: { data: { reportedQty: number; status: string } };
        }[]
      ).map((c) => c[0].data);
      expect(created).toHaveLength(1);
      expect(created[0].reportedQty).toBe(46);
      expect(created[0].status).toBe('QC_DONE');
      expect(post).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ qty: 46 }),
        'kcs-1',
      );
      expect(
        JSON.stringify(post.mock.calls, (_k, v: unknown) =>
          typeof v === 'bigint' ? v.toString() : v,
        ),
      ).not.toContain('49');
    });

    it('AC37: chấm lại / bundle khác không sinh trùng - đã sinh 46 thì delta 0, không tạo lô', async () => {
      const { prisma } = await run([46]);
      expect((prisma.productionBatch as MockGroup).create).not.toHaveBeenCalled();
    });

    it('AC37: công đoạn chưa phải công đoạn cuối (CAT) thì không sinh lô', async () => {
      const ctx = build();
      (ctx.prisma.pieceMaterialYield as MockGroup).findMany.mockResolvedValue([
        { processSteps: [ProcessStep.CAT, ProcessStep.DAP] },
      ]);
      await ctx.service.autoFinalizePieceOutputIfLastStepComplete(
        ctx.prisma as unknown as PrismaTx,
        5n,
        1n,
        40n,
        ProcessStep.CAT,
        'kcs-1',
      );
      expect((ctx.prisma.productionBatch as MockGroup).create).not.toHaveBeenCalled();
    });
  });

  describe('AC35 / AC37 / R4: kế hoạch mảnh - số thiếu ghi riêng, failedQty giữ nghĩa N1', () => {
    it('AC35: lô Hàn báo 60, Thực có 56, lỗi 1 -> passedQty 55, failedQty 1, shortQty 4 (thiếu KHÔNG cộng vào failedQty)', async () => {
      const { service, prisma } = build();
      (prisma.productionBatch as MockGroup).findMany.mockResolvedValue([
        { productionOrderId: 1n, pieceId: 40n, status: 'QC_DONE', reportedQty: 55 },
      ]);
      (prisma.qcReview as MockGroup).findMany.mockResolvedValue([
        { failedQty: 1, shortQty: 4, productionBatch: { productionOrderId: 1n, pieceId: 40n } },
      ]);
      const plan = await service.getBatchPlanBatch(['1'], MfgStage.HAN);
      expect(plan['1'].items[0]).toMatchObject({ passedQty: 55, failedQty: 1, shortQty: 4 });
    });

    it('AC37: pat công đoạn cuối - failedQty của mảnh trong kế hoạch chỉ cộng lỗi (1), shortQty cộng thiếu (3), qua mọi công đoạn', async () => {
      const { service, prisma } = build();
      (prisma.bomPiece as MockGroup).findMany.mockResolvedValue([
        {
          id: 1n,
          bomRevisionId: 5n,
          pieceId: 40n,
          qtyPerUnit: 5,
          needsHan: false,
          needsSon: false,
          piece: PIECE,
        },
      ]);
      (prisma.pieceMaterialYield as MockGroup).findMany.mockResolvedValue([
        {
          bomRevisionId: 5n,
          pieceId: 40n,
          materialId: 7n,
          processSteps: [ProcessStep.CAT, ProcessStep.DAP],
          qtyPerPiece: 1,
        },
      ]);
      (prisma.qcReview as MockGroup).findMany.mockImplementation(
        (a: { where: Record<string, unknown> }) => {
          if ('pieceStepBundle' in a.where) {
            return Promise.resolve([
              {
                failedQty: 1,
                shortQty: 3,
                pieceStepBundle: { productionOrderId: 1n, pieceId: 40n, step: ProcessStep.DAP },
              },
            ]);
          }
          return Promise.resolve([]);
        },
      );
      const plan = await service.getBatchPlanBatch(['1'], MfgStage.PHOI);
      const item = plan['1'].items[0];
      expect(item.failedQty).toBe(1);
      expect(item.shortQty).toBe(3);
    });
  });
});
