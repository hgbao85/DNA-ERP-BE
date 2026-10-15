import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { ProductionBatchesService } from '../production-batches/production-batches.service';
import { SteelIssuesService } from '../steel-issues/steel-issues.service';
import { FloorReviewService } from './floor-review.service';

describe('FloorReviewService.reverse', () => {
  let tx: {
    $executeRaw: jest.Mock;
    $queryRaw: jest.Mock;
    floorReport: { create: jest.Mock };
    cutPatternSegment: {
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
    };
    cutBundle: { delete: jest.Mock };
    productionBatch: { findUniqueOrThrow: jest.Mock; update: jest.Mock; delete: jest.Mock };
  };
  let prisma: {
    floorReport: { findUnique: jest.Mock };
    productionBatch: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: FloorReviewService;

  const cutReport = {
    id: 11n,
    kind: 'CUT',
    reversalOfId: null,
    reversedBy: null,
    cutBundleId: 53n,
    stepBatchId: null,
    productionBatchId: null,
    workstationId: 1n,
    productionInvoiceId: 45n,
    lines: [{ segmentSpecId: 52n, pieceId: null, qty: 3 }],
  };

  beforeEach(() => {
    tx = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([{ status: 'CUTTING' }]),
      floorReport: { create: jest.fn() },
      cutPatternSegment: {
        findUnique: jest.fn().mockResolvedValue({ id: 900n, qty: 5 }),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
      },
      cutBundle: { delete: jest.fn() },
      productionBatch: {
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    prisma = {
      floorReport: { findUnique: jest.fn().mockResolvedValue(cutReport) },
      productionBatch: { findUnique: jest.fn() },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    service = new FloorReviewService(
      prisma as unknown as PrismaServiceType,
      {} as SteelIssuesService,
      {} as ProductionBatchesService,
    );
  });

  it('CUT: ghi dòng đảo (âm, có lý do, cùng máy + PI) rồi trừ đúng số của lần đó', async () => {
    await service.reverse('11', '  Đếm lại chỉ có 0 đoạn  ', 'qlsx-1');

    expect(tx.floorReport.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'CUT',
        reportedById: 'qlsx-1',
        reversalOfId: 11n,
        workstationId: 1n,
        productionInvoiceId: 45n,
        reason: 'Đếm lại chỉ có 0 đoạn',
        cutBundleId: 53n,
        lines: { create: [{ segmentSpecId: 52n, pieceId: undefined, qty: -3 }] },
      }) as unknown,
    });
    expect(tx.cutPatternSegment.update).toHaveBeenCalledWith({
      where: { id: 900n },
      data: { qty: 2 },
    });
    expect(tx.cutBundle.delete).not.toHaveBeenCalled();
  });

  it('CUT: đợt đã gửi KCS -> 409, không ghi gì', async () => {
    tx.$queryRaw.mockResolvedValue([{ status: 'AWAITING_QC' }]);
    await expect(service.reverse('11', 'muộn quá', 'qlsx-1')).rejects.toThrow(ConflictException);
    expect(tx.floorReport.create).not.toHaveBeenCalled();
  });

  it('lần báo đã bị đảo / bản thân là dòng đảo -> không đảo được', async () => {
    prisma.floorReport.findUnique.mockResolvedValue({ ...cutReport, reversedBy: { id: 13n } });
    await expect(service.reverse('11', 'lần 2', 'q')).rejects.toThrow(ConflictException);
    prisma.floorReport.findUnique.mockResolvedValue({ ...cutReport, reversalOfId: 8n });
    await expect(service.reverse('11', 'đảo dòng đảo', 'q')).rejects.toThrow(BadRequestException);
  });

  it('PIECE: đợt OPEN -> trừ reportedQty; về 0 thì xoá đợt', async () => {
    prisma.floorReport.findUnique.mockResolvedValue({
      ...cutReport,
      kind: 'PIECE',
      cutBundleId: null,
      productionBatchId: 106n,
      lines: [{ segmentSpecId: null, pieceId: 73n, qty: 4 }],
    });
    const batch = { id: 106n, productionOrderId: 41n, pieceId: 73n, stage: 'HAN' };
    prisma.productionBatch.findUnique.mockResolvedValue(batch);
    tx.productionBatch.findUniqueOrThrow.mockResolvedValue({
      ...batch,
      status: 'OPEN',
      reportedQty: 4,
    });

    await service.reverse('11', 'báo nhầm SKU', 'qlsx-1');

    expect(tx.productionBatch.delete).toHaveBeenCalledWith({ where: { id: 106n } });
    expect(tx.productionBatch.update).not.toHaveBeenCalled();
  });
});
