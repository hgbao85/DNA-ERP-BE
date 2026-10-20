import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MFG_FLOOR_WAREHOUSE_SCOPE } from '../../common/constants/role-permissions.constant';
import { Prisma } from '../../generated/prisma/client';
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
    stepBatchSegment: { deleteMany: jest.Mock };
    stepBatch: { delete: jest.Mock };
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
      stepBatchSegment: { deleteMany: jest.fn() },
      stepBatch: { delete: jest.fn() },
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

  // ─── đảo: các nhánh còn lại ───────────────────────────────────────────────────

  const stepReport = { ...cutReport, kind: 'STEP', cutBundleId: null, stepBatchId: 77n };
  const pieceReport = {
    ...cutReport,
    kind: 'PIECE',
    cutBundleId: null,
    productionBatchId: 106n,
    lines: [{ segmentSpecId: null, pieceId: 73n, qty: 4 }],
  };
  const pieceBatch = { id: 106n, productionOrderId: 41n, pieceId: 73n, stage: 'HAN' };

  it('lần báo không tồn tại -> 404, không mở giao dịch', async () => {
    prisma.floorReport.findUnique.mockResolvedValue(null);
    await expect(service.reverse('11', 'x', 'q')).rejects.toThrow(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('CUT: 2 QLSX cùng đảo 1 lần báo (trùng reversalOfId, P2002) -> 409 "vừa được người khác hủy", không trừ số', async () => {
    tx.floorReport.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
    );
    await expect(service.reverse('11', 'x', 'q')).rejects.toThrow(/vừa được người khác hủy/);
    expect(tx.cutPatternSegment.update).not.toHaveBeenCalled();
  });

  it('lỗi khác không bị nuốt thành 409 (ném lại nguyên văn)', async () => {
    tx.floorReport.create.mockRejectedValue(new Error('mất kết nối'));
    await expect(service.reverse('11', 'x', 'q')).rejects.toThrow('mất kết nối');
  });

  it('CUT: lần báo không còn gắn đợt cắt / dòng đợt đã bị xoá -> 409', async () => {
    prisma.floorReport.findUnique.mockResolvedValue({ ...cutReport, cutBundleId: null });
    await expect(service.reverse('11', 'x', 'q')).rejects.toThrow(ConflictException);
    prisma.floorReport.findUnique.mockResolvedValue(cutReport);
    tx.$queryRaw.mockResolvedValue([]);
    await expect(service.reverse('11', 'x', 'q')).rejects.toThrow(/không còn/);
    expect(tx.floorReport.create).not.toHaveBeenCalled();
  });

  it('CUT: trừ hết số của cỡ đoạn thì xoá dòng đoạn; hết đoạn thì xoá luôn đợt (sổ vẫn còn)', async () => {
    tx.cutPatternSegment.findUnique.mockResolvedValue({ id: 900n, qty: 3 });
    tx.cutPatternSegment.count.mockResolvedValue(0);

    await service.reverse('11', 'x', 'q');

    expect(tx.cutPatternSegment.delete).toHaveBeenCalledWith({ where: { id: 900n } });
    expect(tx.cutPatternSegment.update).not.toHaveBeenCalled();
    expect(tx.cutBundle.delete).toHaveBeenCalledWith({ where: { id: 53n } });
    expect(tx.floorReport.create).toHaveBeenCalledTimes(1);
  });

  it('CUT: dòng không có cỡ đoạn / cỡ đoạn đã bị xoá khỏi đợt thì bỏ qua, vẫn ghi dòng đảo', async () => {
    prisma.floorReport.findUnique.mockResolvedValue({
      ...cutReport,
      lines: [
        { segmentSpecId: null, pieceId: null, qty: 2 },
        { segmentSpecId: 52n, pieceId: null, qty: 3 },
      ],
    });
    tx.cutPatternSegment.findUnique.mockResolvedValue(null);

    await service.reverse('11', 'x', 'q');

    expect(tx.cutPatternSegment.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.cutPatternSegment.update).not.toHaveBeenCalled();
    expect(tx.cutPatternSegment.delete).not.toHaveBeenCalled();
    expect(tx.floorReport.create).toHaveBeenCalledTimes(1);
  });

  it('STEP: đợt chưa gửi KCS -> ghi dòng đảo (âm) rồi xoá các dòng + đợt công đoạn đó', async () => {
    prisma.floorReport.findUnique.mockResolvedValue({
      ...stepReport,
      lines: [{ segmentSpecId: 52n, pieceId: null, qty: 3 }],
    });
    tx.$queryRaw.mockResolvedValue([{ stepBundleId: null }]);

    await service.reverse('11', '  nhầm máy  ', 'qlsx-1');

    expect(tx.floorReport.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'STEP',
        reportedById: 'qlsx-1',
        reversalOfId: 11n,
        reason: 'nhầm máy',
        stepBatchId: 77n,
        lines: { create: [{ segmentSpecId: 52n, pieceId: undefined, qty: -3 }] },
      }) as unknown,
    });
    expect(tx.stepBatchSegment.deleteMany).toHaveBeenCalledWith({ where: { stepBatchId: 77n } });
    expect(tx.stepBatch.delete).toHaveBeenCalledWith({ where: { id: 77n } });
  });

  it('STEP: đã vào đợt gửi KCS -> 409, không ghi sổ, không xoá gì', async () => {
    prisma.floorReport.findUnique.mockResolvedValue(stepReport);
    tx.$queryRaw.mockResolvedValue([{ stepBundleId: 5n }]);

    await expect(service.reverse('11', 'x', 'q')).rejects.toThrow(/đã gửi KCS/);

    expect(tx.floorReport.create).not.toHaveBeenCalled();
    expect(tx.stepBatchSegment.deleteMany).not.toHaveBeenCalled();
    expect(tx.stepBatch.delete).not.toHaveBeenCalled();
  });

  it('STEP: lần báo không còn gắn đợt / đợt đã bị xoá -> 409', async () => {
    prisma.floorReport.findUnique.mockResolvedValue({ ...stepReport, stepBatchId: null });
    await expect(service.reverse('11', 'x', 'q')).rejects.toThrow(ConflictException);
    prisma.floorReport.findUnique.mockResolvedValue(stepReport);
    tx.$queryRaw.mockResolvedValue([]);
    await expect(service.reverse('11', 'x', 'q')).rejects.toThrow(/không còn/);
    expect(tx.stepBatch.delete).not.toHaveBeenCalled();
  });

  it('PIECE: đợt còn dư sau khi trừ -> cập nhật reportedQty, không xoá đợt', async () => {
    prisma.floorReport.findUnique.mockResolvedValue(pieceReport);
    prisma.productionBatch.findUnique.mockResolvedValue(pieceBatch);
    tx.productionBatch.findUniqueOrThrow.mockResolvedValue({
      ...pieceBatch,
      status: 'OPEN',
      reportedQty: 10,
    });

    await service.reverse('11', 'x', 'q');

    expect(tx.productionBatch.update).toHaveBeenCalledWith({
      where: { id: 106n },
      data: { reportedQty: 6 },
    });
    expect(tx.productionBatch.delete).not.toHaveBeenCalled();
    expect(tx.floorReport.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productionBatchId: 106n,
        lines: { create: [{ segmentSpecId: undefined, pieceId: 73n, qty: -4 }] },
      }) as unknown,
    });
  });

  it('PIECE: số cần trừ lớn hơn số còn trong đợt (đợt đã bị sửa tay) -> về 0, không âm', async () => {
    prisma.floorReport.findUnique.mockResolvedValue(pieceReport);
    prisma.productionBatch.findUnique.mockResolvedValue(pieceBatch);
    tx.productionBatch.findUniqueOrThrow.mockResolvedValue({
      ...pieceBatch,
      status: 'OPEN',
      reportedQty: 3,
    });

    await service.reverse('11', 'x', 'q');

    expect(tx.productionBatch.delete).toHaveBeenCalledWith({ where: { id: 106n } });
    expect(tx.productionBatch.update).not.toHaveBeenCalled();
  });

  it('PIECE: đợt đã gửi KCS (kiểm lại SAU khi khoá) -> 409, không ghi sổ', async () => {
    prisma.floorReport.findUnique.mockResolvedValue(pieceReport);
    prisma.productionBatch.findUnique.mockResolvedValue(pieceBatch);
    tx.productionBatch.findUniqueOrThrow.mockResolvedValue({
      ...pieceBatch,
      status: 'AWAITING_QC',
      reportedQty: 4,
    });

    await expect(service.reverse('11', 'x', 'q')).rejects.toThrow(/đã gửi KCS/);

    expect(tx.floorReport.create).not.toHaveBeenCalled();
    expect(tx.productionBatch.update).not.toHaveBeenCalled();
    expect(tx.productionBatch.delete).not.toHaveBeenCalled();
  });

  it('PIECE: lần báo không còn gắn đợt / đợt đã bị xoá -> 409, không mở giao dịch', async () => {
    prisma.floorReport.findUnique.mockResolvedValue({ ...pieceReport, productionBatchId: null });
    await expect(service.reverse('11', 'x', 'q')).rejects.toThrow(ConflictException);
    prisma.floorReport.findUnique.mockResolvedValue(pieceReport);
    prisma.productionBatch.findUnique.mockResolvedValue(null);
    await expect(service.reverse('11', 'x', 'q')).rejects.toThrow(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('FloorReviewService - gửi KCS', () => {
  let prisma: { productionBatch: { findUnique: jest.Mock } };
  let steelIssues: { finishCutBundle: jest.Mock; submitStepBundle: jest.Mock };
  let productionBatches: { finishProductionBatch: jest.Mock };
  let service: FloorReviewService;

  beforeEach(() => {
    prisma = { productionBatch: { findUnique: jest.fn() } };
    steelIssues = {
      finishCutBundle: jest.fn().mockResolvedValue({ id: '52' }),
      submitStepBundle: jest.fn().mockResolvedValue({ id: '8' }),
    };
    productionBatches = { finishProductionBatch: jest.fn().mockResolvedValue({ id: '106' }) };
    service = new FloorReviewService(
      prisma as unknown as PrismaServiceType,
      steelIssues as unknown as SteelIssuesService,
      productionBatches as unknown as ProductionBatchesService,
    );
  });

  it('đợt cắt: chuyển thẳng cho finishCutBundle (luật "Gửi KCS" vẫn nằm ở một nơi)', async () => {
    await expect(service.sendCutBundle('52')).resolves.toEqual({ id: '52' });
    expect(steelIssues.finishCutBundle).toHaveBeenCalledWith('52');
  });

  it('lô mảnh: tổ của chính đợt làm "vai" người gửi, kho trừ tồn là kho xưởng', async () => {
    prisma.productionBatch.findUnique.mockResolvedValue({ stage: 'HAN' });

    await service.sendProductionBatch('106', 'qlsx-1');

    expect(prisma.productionBatch.findUnique).toHaveBeenCalledWith({
      where: { id: 106n },
      select: { stage: true },
    });
    expect(productionBatches.finishProductionBatch).toHaveBeenCalledWith(
      '106',
      'qlsx-1',
      'HAN',
      MFG_FLOOR_WAREHOUSE_SCOPE,
    );
  });

  it('lô mảnh không tồn tại -> 404, không gửi', async () => {
    prisma.productionBatch.findUnique.mockResolvedValue(null);
    await expect(service.sendProductionBatch('106', 'qlsx-1')).rejects.toThrow(NotFoundException);
    expect(productionBatches.finishProductionBatch).not.toHaveBeenCalled();
  });

  it.each([
    ['không chỉ định công nhân -> gom hết như màn Phôi cũ', undefined, undefined],
    ['đợt cũ chưa biết người (null)', null, { id: null }],
    ['một công nhân cụ thể', 'w-1', { id: 'w-1' }],
  ])('nhóm công đoạn phụ: %s', async (_label, workerId, expected) => {
    await service.sendStepGroup(
      {
        productionInvoiceId: '45',
        materialId: '7',
        step: 'UON',
        productionOrderId: '41',
        workerId,
      },
      'qlsx-1',
    );

    expect(steelIssues.submitStepBundle).toHaveBeenCalledWith(
      '45',
      '7',
      'UON',
      'qlsx-1',
      '41',
      expected,
    );
  });
});
