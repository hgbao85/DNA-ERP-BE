/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- prisma mock */
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { MfgStage, Prisma } from '../../generated/prisma/client';
import { PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SegmentStockService } from '../segment-stock/segment-stock.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { StageHandoverService } from './stage-handover.service';

const dec = (n: number) => ({ toNumber: () => n });
const T = new Date('2026-11-28T01:00:00Z');

/**
 * Đợt 2 lượt 1 (28/11/2026) câu 2 cách 1: đầu kỳ ngày bật giao nhận. Lệnh 100, SKU 70: mảnh 7 Hàn từ đoạn (cỡ 1 ×1), mảnh 8 qua
 * Hàn + Sơn (Sơn nhận khung).
 */
function makeDb(over: Record<string, any> = {}) {
  return {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn(),
    productionOrder: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ productionInvoiceItem: { productionInvoiceId: 100n } }),
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 70n, bomRevisionId: 9n, quantity: 10, status: 'RELEASED' }]),
      findFirst: jest.fn(),
    },
    bomPiece: {
      findMany: jest.fn().mockResolvedValue([
        { bomRevisionId: 9n, pieceId: 7n, qtyPerUnit: 1, needsHan: true, needsSon: false },
        { bomRevisionId: 9n, pieceId: 8n, qtyPerUnit: 1, needsHan: true, needsSon: true },
      ]),
      findUnique: jest.fn(),
    },
    pieceBom: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { bomRevisionId: 9n, pieceId: 7n, segmentSpecId: 1n, qtyPerPiece: 1, processSteps: [] },
        ]),
    },
    productionBatch: { groupBy: jest.fn().mockResolvedValue([]) },
    stageHandoverOverride: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn(),
    },
    issueSlipLine: { findMany: jest.fn().mockResolvedValue([]) },
    warehouseTransferPieceItem: { findMany: jest.fn().mockResolvedValue([]) },
    piece: { findUnique: jest.fn().mockResolvedValue({ name: 'Khung lưng', code: 'KL' }) },
    productionInvoiceItem: { findFirst: jest.fn() },
    warehouse: { findUnique: jest.fn(), findFirst: jest.fn() },
    ...over,
  };
}

describe('StageHandoverService - đầu kỳ ngày bật (câu 2, 28/11/2026)', () => {
  const prev = { seg: process.env.SEGMENT_STOCK_ENABLED, sh: process.env.STAGE_HANDOVER_ENABLED };
  beforeEach(() => {
    process.env.SEGMENT_STOCK_ENABLED = 'true';
    process.env.STAGE_HANDOVER_ENABLED = 'true';
  });
  afterAll(() => {
    if (prev.seg === undefined) delete process.env.SEGMENT_STOCK_ENABLED;
    else process.env.SEGMENT_STOCK_ENABLED = prev.seg;
    if (prev.sh === undefined) delete process.env.STAGE_HANDOVER_ENABLED;
    else process.env.STAGE_HANDOVER_ENABLED = prev.sh;
  });
  const build = (db: any, postEntry = jest.fn()) =>
    new StageHandoverService(
      db as PrismaServiceType,
      {} as SegmentStockService,
      { postEntry } as unknown as StockLedgerService,
      {} as NotificationsService,
    );

  describe('cổng báo tính đầu kỳ là đã nhận thật', () => {
    it('Hàn từ đoạn: làm 40 trước ngày bật, đầu kỳ 40 + phiếu giao đoạn 40 -> còn 40 (trước: bị chặn ngay)', async () => {
      const db = makeDb();
      db.productionBatch.groupBy.mockResolvedValue([
        { productionOrderId: 70n, pieceId: 7n, _sum: { reportedQty: 40 } },
      ]);
      db.issueSlipLine.findMany.mockResolvedValue([
        { segmentSpecId: 1n, segmentSteps: '', qty: dec(40), slip: { issuedAt: T, createdAt: T } },
      ]);
      db.stageHandoverOverride.findMany.mockResolvedValue([
        { productionOrderId: 70n, pieceId: 7n, qty: dec(40), createdAt: T, kind: 'OPENING_DONE' },
      ]);
      const s = build(db);
      const p = { productionOrderId: 70n, pieceId: 7n, stage: MfgStage.HAN, qty: 40 };
      await expect(s.assertReceivedCapInTx(db as unknown as PrismaTx, p)).resolves.toBeUndefined();
      const err = await s
        .assertReceivedCapInTx(db as unknown as PrismaTx, { ...p, qty: 41 })
        .catch((e: unknown) => e);
      expect((err as Error).message).toContain('đã nhận 80, đã làm 40, còn 40');
    });

    it('Sơn nhận khung: đầu kỳ khung chờ Sơn không bị phiếu giao sau đó "trả" như mở chặn', async () => {
      const db = makeDb();
      db.productionBatch.groupBy.mockResolvedValue([
        { productionOrderId: 70n, pieceId: 8n, _sum: { reportedQty: 30 } },
      ]);
      db.issueSlipLine.findMany.mockResolvedValue([
        { productionOrderId: 70n, pieceId: 8n, qty: dec(10), slip: { issuedAt: T, createdAt: T } },
      ]);
      db.stageHandoverOverride.findMany.mockResolvedValue([
        { productionOrderId: 70n, pieceId: 8n, qty: dec(30), createdAt: T, kind: 'OPENING_DONE' },
        {
          productionOrderId: 70n,
          pieceId: 8n,
          qty: dec(100),
          createdAt: T,
          kind: 'OPENING_WAITING',
        },
      ]);
      const s = build(db);
      const err = await s
        .assertReceivedCapInTx(db as unknown as PrismaTx, {
          productionOrderId: 70n,
          pieceId: 8n,
          stage: MfgStage.SON,
          qty: 111,
        })
        .catch((e: unknown) => e);
      expect((err as Error).message).toContain('đã nhận 140, đã làm 30, còn 110');
    });
  });

  describe('createOpeningDone', () => {
    const withTx = (db: any) => {
      db.$transaction.mockImplementation((fn: (tx: any) => unknown) => fn(db));
      return db;
    };

    it('ghi số đã báo của (SKU, mảnh, tổ) có cổng nhận; mảnh 7 ở Sơn (không qua Sơn) bị bỏ', async () => {
      const db = withTx(makeDb());
      db.productionBatch.groupBy.mockResolvedValue([
        { productionOrderId: 70n, pieceId: 7n, stage: 'HAN', _sum: { reportedQty: 40 } },
        { productionOrderId: 70n, pieceId: 8n, stage: 'SON', _sum: { reportedQty: 12 } },
        { productionOrderId: 70n, pieceId: 7n, stage: 'SON', _sum: { reportedQty: 5 } },
        { productionOrderId: 70n, pieceId: 8n, stage: 'HAN', _sum: { reportedQty: 0 } },
      ]);
      db.productionOrder.findMany.mockImplementation(({ select }: any) =>
        Promise.resolve(
          select.productionInvoiceItem
            ? [{ id: 70n, productionInvoiceItem: { productionInvoiceId: 100n } }]
            : [{ id: 70n, bomRevisionId: 9n, quantity: 10, status: 'RELEASED' }],
        ),
      );
      db.stageHandoverOverride.createMany.mockImplementation(({ data }: any) =>
        Promise.resolve({ count: data.length }),
      );
      const out = await build(db).createOpeningDone('qlsx-1');
      expect(out).toEqual({ created: 2, lenh: 1 });
      const rows = db.stageHandoverOverride.createMany.mock.calls[0][0].data;
      expect(rows.map((r: any) => [r.pieceId, r.stage, r.qty, r.kind])).toEqual([
        [7n, 'HAN', 40, 'OPENING_DONE'],
        [8n, 'SON', 12, 'OPENING_DONE'],
      ]);
      expect(db.$executeRaw).toHaveBeenCalledWith(expect.anything(), 'stage-handover-opening');
    });

    it('đã ghi rồi -> 409, không ghi thêm', async () => {
      const db = withTx(makeDb());
      db.stageHandoverOverride.findFirst.mockResolvedValue({ createdAt: T });
      await expect(build(db).createOpeningDone('qlsx-1')).rejects.toBeInstanceOf(ConflictException);
      expect(db.stageHandoverOverride.createMany).not.toHaveBeenCalled();
    });

    it('tắt công tắc -> 400', async () => {
      process.env.STAGE_HANDOVER_ENABLED = 'false';
      await expect(build(makeDb()).createOpeningDone('qlsx-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('createOpeningWaiting', () => {
    // Xưởng 1 (Phú An) có kho Sơn: kho Hàn 'han-pa' (id 3), kho Sơn 'son-pa' (id 4), kho ảo OPENING_BALANCE (id 99).
    const setup = () => {
      const db = makeDb({
        productionInvoiceItem: { findFirst: jest.fn().mockResolvedValue({ workshopId: 1n }) },
        warehouse: {
          findUnique: jest.fn().mockResolvedValue({ id: 99n }),
          findFirst: jest.fn(({ where }: any) =>
            Promise.resolve(
              where.kind === 'SON'
                ? { id: 4n, code: 'son-pa', name: 'Sơn PA', kind: 'SON', workshopId: 1n }
                : where.kind === 'HAN'
                  ? { id: 3n, code: 'han-pa', name: 'Hàn PA', kind: 'HAN', workshopId: 1n }
                  : null,
            ),
          ),
          findMany: jest.fn().mockResolvedValue([]),
        },
        workshop: { findUnique: jest.fn().mockResolvedValue({ id: 1n }) },
      });
      db.productionOrder.findFirst.mockResolvedValue({
        bomRevisionId: 9n,
        mfgProduct: { factoryCode: 'PBG-3' },
        productionInvoiceItem: {
          productionInvoiceId: 100n,
          productionInvoice: { code: 'PI-100', status: 'IN_PROGRESS' },
        },
      });
      db.bomPiece.findUnique.mockResolvedValue({ needsHan: true, needsSon: true });
      db.$transaction.mockImplementation((fn: (tx: any) => unknown) => fn(db));
      db.stageHandoverOverride.create.mockResolvedValue({
        id: 5n,
        productionInvoiceId: 100n,
        productionOrderId: 70n,
        stage: 'SON',
        pieceId: 8n,
        materialId: null,
        qty: dec(100),
        reason: 'x',
        createdById: 'tk-han',
        createdAt: T,
        kind: 'OPENING_WAITING',
      });
      return db;
    };
    const dto = { productionOrderId: '70', pieceId: '8', qty: 100 };

    it('thủ kho kho Sơn (không phải kho Hàn của xưởng) -> 403', async () => {
      const db = setup();
      const s = build(db);
      jest.spyOn(s as any, 'assertScope');
      await expect(
        s.createOpeningWaiting(dto, {
          id: 'tk',
          roles: ['WAREHOUSE_STAFF'],
          warehouseScope: 'son-pa',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('nhập 1 lần: 409 khi trùng (SKU, mảnh)', async () => {
      const db = setup();
      db.stageHandoverOverride.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
      );
      await expect(
        build(db).createOpeningWaiting(dto, { id: 'a', roles: ['ADMIN'], warehouseScope: null }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
