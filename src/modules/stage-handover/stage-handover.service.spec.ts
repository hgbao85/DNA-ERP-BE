import { BadRequestException } from '@nestjs/common';
import { MfgStage, ProductionInvoiceStatus } from '../../generated/prisma/client';
import { PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SegmentStockService } from '../segment-stock/segment-stock.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { HandoverKind } from './dto/stage-handover.dto';
import {
  PreparedSegmentHandover,
  STAGE_HANDOVER_DISABLED_MESSAGE,
  StageHandoverService,
} from './stage-handover.service';

const dec = (n: number) => ({ toNumber: () => n });
const T1 = new Date('2026-11-28T01:00:00Z');
const T2 = new Date('2026-11-28T02:00:00Z');
const T3 = new Date('2026-11-28T03:00:00Z');
const sumQty = (n: number | null) => ({ _sum: { qty: n === null ? null : dec(n) } });

/** Lệnh 100: SKU 70 (bản định mức 9, số lượng 10). Mảnh 7 cần Hàn, 2 mã đoạn (cỡ 1 ×1, cỡ 2 ×2). Mảnh 8 cần Hàn + Sơn, không đoạn. */
function makeDb(over: Record<string, unknown> = {}) {
  const db = {
    $executeRaw: jest.fn().mockResolvedValue(1),
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
      findMany: jest.fn().mockResolvedValue([
        { bomRevisionId: 9n, pieceId: 7n, segmentSpecId: 1n, qtyPerPiece: 1, processSteps: [] },
        { bomRevisionId: 9n, pieceId: 7n, segmentSpecId: 2n, qtyPerPiece: 2, processSteps: [] },
      ]),
    },
    productionBatch: { groupBy: jest.fn().mockResolvedValue([]) },
    stageHandoverOverride: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
    issueSlipLine: {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn(),
    },
    warehouseTransferPieceItem: { findMany: jest.fn().mockResolvedValue([]) },
    piece: { findUnique: jest.fn().mockResolvedValue({ name: 'Chân A', code: 'CA' }) },
    productionInvoice: { findUnique: jest.fn() },
    productionInvoiceItem: { findFirst: jest.fn() },
    warehouse: { findFirst: jest.fn(), findUnique: jest.fn() },
    material: { findUnique: jest.fn() },
    ...over,
  };
  return db;
}

describe('StageHandoverService - giao nhận giữa tổ (24/11/2026)', () => {
  const prev = {
    seg: process.env.SEGMENT_STOCK_ENABLED,
    sh: process.env.STAGE_HANDOVER_ENABLED,
  };
  let db: ReturnType<typeof makeDb>;
  let segmentStock: { lockAndReadOrderCell: jest.Mock; handoverOrderHoldings: jest.Mock };
  let notifications: { emit: jest.Mock };
  let service: StageHandoverService;
  const on = () => {
    process.env.SEGMENT_STOCK_ENABLED = 'true';
    process.env.STAGE_HANDOVER_ENABLED = 'true';
  };

  beforeEach(() => {
    on();
    db = makeDb();
    segmentStock = { lockAndReadOrderCell: jest.fn(), handoverOrderHoldings: jest.fn() };
    notifications = { emit: jest.fn().mockResolvedValue(undefined) };
    service = new StageHandoverService(
      db as unknown as PrismaServiceType,
      segmentStock as unknown as SegmentStockService,
      { postEntry: jest.fn() } as unknown as StockLedgerService,
      notifications as unknown as NotificationsService,
    );
  });

  afterAll(() => {
    process.env.SEGMENT_STOCK_ENABLED = prev.seg;
    process.env.STAGE_HANDOVER_ENABLED = prev.sh;
    if (prev.seg === undefined) delete process.env.SEGMENT_STOCK_ENABLED;
    if (prev.sh === undefined) delete process.env.STAGE_HANDOVER_ENABLED;
  });

  const tx = () => db as unknown as PrismaTx;

  describe('công tắc', () => {
    it('tắt (hoặc tắt tồn đoạn) -> cổng báo không đọc gì, lập phiếu giao báo 400 rõ ràng', async () => {
      process.env.STAGE_HANDOVER_ENABLED = 'false';
      await service.assertReceivedCapInTx(tx(), {
        productionOrderId: 70n,
        pieceId: 7n,
        stage: MfgStage.HAN,
        qty: 999,
      });
      expect(db.productionOrder.findUnique).not.toHaveBeenCalled();
      expect(db.$executeRaw).not.toHaveBeenCalled();
      expect(() => service.assertEnabled()).toThrow(STAGE_HANDOVER_DISABLED_MESSAGE);

      process.env.STAGE_HANDOVER_ENABLED = 'true';
      process.env.SEGMENT_STOCK_ENABLED = 'false';
      expect(() => service.assertEnabled()).toThrow(BadRequestException);
    });

    it('tắt -> bảng QLSX và danh sách giao của kho trả ngay, không dựng số từng lệnh; mở chặn báo 400', async () => {
      process.env.STAGE_HANDOVER_ENABLED = 'false';
      await expect(service.getBoard()).resolves.toEqual({ enabled: false, pis: [] });
      expect(db.productionInvoice.findUnique).not.toHaveBeenCalled();

      db.warehouse.findUnique.mockResolvedValue({
        id: 5n,
        code: 'PHOI-PA',
        name: 'Kho Phôi',
        kind: 'PHOI',
        workshopId: 1n,
      });
      const plan = await service.getPlan({ kind: HandoverKind.SEGMENT }, 'PHOI-PA');
      expect(plan).toMatchObject({ enabled: false, kind: HandoverKind.SEGMENT, pis: [] });
      expect(db.productionInvoice.findUnique).not.toHaveBeenCalled();

      await expect(
        service.createOverride(
          {
            productionInvoiceId: '100',
            stage: MfgStage.HAN,
            qty: 5,
            reason: 'kho vắng người',
          },
          'u1',
        ),
      ).rejects.toThrow(STAGE_HANDOVER_DISABLED_MESSAGE);
    });
  });

  describe('assertReceivedCapInTx - Hàn theo đoạn đã nhận', () => {
    beforeEach(() => {
      // Đã giao cho Hàn: cỡ 1 × 6, cỡ 2 × 10 -> mảnh 7 còn min(6/1, 10/2) = 5.
      db.issueSlipLine.findMany.mockResolvedValue([
        { segmentSpecId: 1n, segmentSteps: '', qty: dec(6), slip: { issuedAt: T1, createdAt: T1 } },
        {
          segmentSpecId: 2n,
          segmentSteps: '',
          qty: dec(10),
          slip: { issuedAt: T1, createdAt: T1 },
        },
      ]);
    });

    it('trong số còn -> qua, có khoá cổng theo lệnh + tổ', async () => {
      await service.assertReceivedCapInTx(tx(), {
        productionOrderId: 70n,
        pieceId: 7n,
        stage: MfgStage.HAN,
        qty: 5,
      });
      expect(db.$executeRaw).toHaveBeenCalledWith(expect.anything(), 'stage-handover-cap:100:HAN');
    });

    it('vượt -> 400 "đã nhận / đã làm / còn"; đã làm trừ cả lô chờ KCS / đang mở (đếm 1 lần)', async () => {
      db.productionBatch.groupBy.mockResolvedValue([
        { productionOrderId: 70n, pieceId: 7n, _sum: { reportedQty: 2 } },
      ]);
      const err = await service
        .assertReceivedCapInTx(tx(), {
          productionOrderId: 70n,
          pieceId: 7n,
          stage: MfgStage.HAN,
          qty: 4,
        })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as Error).message).toContain('đã nhận 5, đã làm 2, còn 3');
      expect((err as Error).message).toContain('qua kho Phôi');
    });

    it('QLSX mở chặn N mảnh nâng phần còn theo hàng đã nhận', async () => {
      db.stageHandoverOverride.findMany.mockResolvedValue([
        { productionOrderId: 70n, pieceId: 7n, qty: dec(2), createdAt: T2 },
      ]);
      await expect(
        service.assertReceivedCapInTx(tx(), {
          productionOrderId: 70n,
          pieceId: 7n,
          stage: MfgStage.HAN,
          qty: 7,
        }),
      ).resolves.toBeUndefined();
    });

    it('mảnh không có định mức đoạn ở Hàn -> không chặn', async () => {
      await expect(
        service.assertReceivedCapInTx(tx(), {
          productionOrderId: 70n,
          pieceId: 8n,
          stage: MfgStage.HAN,
          qty: 100,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('assertReceivedCapInTx - Sơn theo mảnh đã hàn đã nhận', () => {
    it('nhận qua phiếu giao + phiếu chuyển kho vào kho Sơn đã xác nhận', async () => {
      db.issueSlipLine.findMany.mockResolvedValue([
        { productionOrderId: 70n, pieceId: 8n, qty: dec(3), slip: { issuedAt: T1, createdAt: T1 } },
      ]);
      db.warehouseTransferPieceItem.findMany.mockResolvedValue([
        {
          productionOrderId: 70n,
          pieceId: 8n,
          quantity: 2,
          transfer: { confirmedAt: T1, createdAt: T1 },
        },
      ]);
      db.productionBatch.groupBy.mockResolvedValue([
        { productionOrderId: 70n, pieceId: 8n, _sum: { reportedQty: 1 } },
      ]);
      await service.assertReceivedCapInTx(tx(), {
        productionOrderId: 70n,
        pieceId: 8n,
        stage: MfgStage.SON,
        qty: 4,
      });
      const err = await service
        .assertReceivedCapInTx(tx(), {
          productionOrderId: 70n,
          pieceId: 8n,
          stage: MfgStage.SON,
          qty: 5,
        })
        .catch((e: unknown) => e);
      expect((err as Error).message).toContain('đã nhận 5, đã làm 1, còn 4');
      expect((err as Error).message).toContain('qua kho Hàn');
    });

    it('lượt 1 (28/11, cách a): mở chặn 2 rồi kho lập phiếu bù 2 -> chỉ tính 1 lần, không cộng thành 4', async () => {
      // Đã nhận 3 lúc T1, đã làm 5 (3 + 2 mở chặn lúc T2), phiếu bù 2 lúc T3.
      db.issueSlipLine.findMany.mockResolvedValue([
        { productionOrderId: 70n, pieceId: 8n, qty: dec(3), slip: { issuedAt: T1, createdAt: T1 } },
        { productionOrderId: 70n, pieceId: 8n, qty: dec(2), slip: { issuedAt: T3, createdAt: T3 } },
      ]);
      db.stageHandoverOverride.findMany.mockResolvedValue([
        { productionOrderId: 70n, pieceId: 8n, qty: dec(2), createdAt: T2 },
      ]);
      db.productionBatch.groupBy.mockResolvedValue([
        { productionOrderId: 70n, pieceId: 8n, _sum: { reportedQty: 5 } },
      ]);
      const err = await service
        .assertReceivedCapInTx(tx(), {
          productionOrderId: 70n,
          pieceId: 8n,
          stage: MfgStage.SON,
          qty: 1,
        })
        .catch((e: unknown) => e);
      expect((err as Error).message).toContain('đã nhận 5, đã làm 5, còn 0');
    });

    it('phiếu lập TRƯỚC lần mở chặn không trả phần mở chặn', async () => {
      db.issueSlipLine.findMany.mockResolvedValue([
        { productionOrderId: 70n, pieceId: 8n, qty: dec(3), slip: { issuedAt: T1, createdAt: T1 } },
      ]);
      db.stageHandoverOverride.findMany.mockResolvedValue([
        { productionOrderId: 70n, pieceId: 8n, qty: dec(2), createdAt: T2 },
      ]);
      db.productionBatch.groupBy.mockResolvedValue([
        { productionOrderId: 70n, pieceId: 8n, _sum: { reportedQty: 3 } },
      ]);
      await expect(
        service.assertReceivedCapInTx(tx(), {
          productionOrderId: 70n,
          pieceId: 8n,
          stage: MfgStage.SON,
          qty: 2,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('assertSegmentCapInTx - trần giao đoạn', () => {
    const p: PreparedSegmentHandover = {
      productionInvoiceId: 100n,
      segmentSpecId: 1n,
      segmentSteps: '',
      stage: MfgStage.HAN,
      qty: 4,
      warehouse: { id: 10n, code: 'phoi-a' },
      toWarehouse: { id: 11n, code: 'han-a' },
      label: 'SAT @ 441mm · Trơn',
    };

    it('đoạn Phôi đạt KCS đã ở kho: giữ 5 + dư 0 - chờ ký 2 = 3 < 4 -> 400 (không cần bước nhận kho)', async () => {
      segmentStock.lockAndReadOrderCell.mockResolvedValue({
        onHandQty: 5,
        ownRemainingQty: 5,
        surplusQty: 0,
      });
      db.issueSlipLine.aggregate.mockResolvedValue(sumQty(2)); // chờ ký
      await expect(service.assertSegmentCapInTx(tx(), p, null)).rejects.toThrow('còn giao được 3');
      await expect(
        service.assertSegmentCapInTx(tx(), { ...p, qty: 3 }, null),
      ).resolves.toBeUndefined();
    });

    it('theo tồn: giữ 1 + dư 2 - chờ ký 0 = 3 < 4 -> 400; đủ thì qua, khoá ô kho Phôi của lệnh', async () => {
      segmentStock.lockAndReadOrderCell.mockResolvedValue({
        onHandQty: 3,
        ownRemainingQty: 1,
        surplusQty: 2,
      });
      db.issueSlipLine.aggregate.mockResolvedValue(sumQty(null));
      await expect(service.assertSegmentCapInTx(tx(), p, 5n)).rejects.toThrow(
        '1 đoạn giữ cho lệnh + 2 dư',
      );
      await expect(
        service.assertSegmentCapInTx(tx(), { ...p, qty: 3 }, 5n),
      ).resolves.toBeUndefined();
      expect(segmentStock.lockAndReadOrderCell).toHaveBeenCalledWith(
        db,
        { warehouseId: 10n, segmentSpecId: 1n, segmentSteps: '' },
        100n,
      );
      // Phiếu đang xác nhận không tự trừ chính nó.
      expect(db.issueSlipLine.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            slip: expect.objectContaining({ id: { not: 5n } }) as unknown,
          }) as unknown,
        }),
      );
    });
  });

  describe('createOverride', () => {
    beforeEach(() => {
      db.productionInvoice.findUnique.mockResolvedValue({
        id: 100n,
        code: 'PI-1',
        status: ProductionInvoiceStatus.PRODUCING,
      });
    });

    it('Hàn: cần SKU + mảnh, mảnh phải qua tổ đó', async () => {
      await expect(
        service.createOverride(
          { productionInvoiceId: '100', stage: MfgStage.HAN, qty: 2, reason: 'Kho vắng' },
          'qlsx',
        ),
      ).rejects.toThrow('cần SKU');
      db.productionOrder.findFirst.mockResolvedValue({
        bomRevisionId: 9n,
        mfgProduct: { factoryCode: 'SKU1' },
      });
      db.bomPiece.findUnique.mockResolvedValue({ needsHan: false, needsSon: true });
      await expect(
        service.createOverride(
          {
            productionInvoiceId: '100',
            stage: MfgStage.HAN,
            productionOrderId: '70',
            pieceId: '7',
            qty: 2,
            reason: 'Kho vắng',
          },
          'qlsx',
        ),
      ).rejects.toThrow('không qua tổ Hàn');
      await expect(
        service.createOverride(
          { productionInvoiceId: '100', stage: MfgStage.DAN, qty: 1, reason: 'abc' },
          'qlsx',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(db.stageHandoverOverride.create).not.toHaveBeenCalled();
    });

    it('Phôi: theo loại sắt (mm), ghi dòng + báo Sếp / QLSX', async () => {
      db.material.findUnique.mockResolvedValue({ code: 'SAT-1' });
      db.stageHandoverOverride.create.mockResolvedValue({
        id: 1n,
        productionInvoiceId: 100n,
        productionOrderId: null,
        stage: MfgStage.PHOI,
        pieceId: null,
        materialId: 3n,
        qty: dec(500),
        reason: 'Cây lẻ nhập lại',
        createdById: 'qlsx',
        createdAt: new Date(),
      });
      const out = await service.createOverride(
        {
          productionInvoiceId: '100',
          stage: MfgStage.PHOI,
          materialId: '3',
          qty: 500,
          reason: '  Cây lẻ nhập lại ',
        },
        'qlsx',
      );
      expect(db.stageHandoverOverride.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          stage: MfgStage.PHOI,
          materialId: 3n,
          qty: 500,
          reason: 'Cây lẻ nhập lại',
        }) as unknown,
      });
      expect(notifications.emit).toHaveBeenCalledWith(
        'STAGE_HANDOVER_OVERRIDE',
        expect.objectContaining({
          entityId: '100',
          params: expect.objectContaining({
            piCode: 'PI-1',
            unit: 'mm',
            target: 'sắt SAT-1',
          }) as unknown,
        }),
      );
      expect(out).toEqual(expect.objectContaining({ qty: 500, unit: 'mm' }));
    });
  });

  describe('prepareFrameHandover', () => {
    it('xưởng không có kho Sơn (Phước An) -> 400, giữ phiếu chuyển kho như cũ', async () => {
      db.productionOrder.findFirst.mockResolvedValue({
        id: 70n,
        bomRevisionId: 9n,
        productionInvoiceItem: {
          productionInvoiceId: 100n,
          productionInvoice: { code: 'PI-1', status: ProductionInvoiceStatus.PRODUCING },
        },
      });
      db.bomPiece.findUnique.mockResolvedValue({ needsHan: true, needsSon: true });
      db.productionInvoiceItem.findFirst.mockResolvedValue({ workshopId: 2n });
      db.warehouse.findFirst.mockResolvedValue(null);
      await expect(
        service.prepareFrameHandover({ productionOrderId: '70', pieceId: '8', qty: 1 }, null),
      ).rejects.toThrow('phiếu chuyển kho');
    });

    it('số mảnh phải nguyên dương', async () => {
      await expect(
        service.prepareFrameHandover({ productionOrderId: '70', pieceId: '8', qty: 1.5 }, null),
      ).rejects.toThrow('số nguyên');
    });
  });
});
