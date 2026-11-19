import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { WorkshopScopeService } from '../../common/workshop-scope/workshop-scope.service';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { MaterialYieldRecipeProductionService } from '../material-yield-recipes/material-yield-recipe-production.service';
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
      findMany: jest.Mock;
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
  let steelIssues: { assertStepsWithinCutAfterReduceInTx: jest.Mock };

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
        findMany: jest.fn().mockResolvedValue([{ id: 900n, segmentSpecId: 52n, qty: 5 }]),
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
    steelIssues = { assertStepsWithinCutAfterReduceInTx: jest.fn().mockResolvedValue(undefined) };
    service = new FloorReviewService(
      prisma as unknown as PrismaServiceType,
      steelIssues as unknown as SteelIssuesService,
      {} as ProductionBatchesService,
      {
        getScope: jest
          .fn()
          .mockResolvedValue({ workshopId: null, workshopName: null, visibleWorkshopIds: null }),
      } as unknown as WorkshopScopeService,
      {} as MaterialYieldRecipeProductionService,
    );
  });

  it('X3 16/11: CUT kiểm Uốn/Dập ≤ số cắt còn lại TRƯỚC khi ghi đảo, với đúng số sẽ trừ', async () => {
    await service.reverse('11', 'đếm lại', 'qlsx-1');
    expect(steelIssues.assertStepsWithinCutAfterReduceInTx).toHaveBeenCalledWith(tx, 53n, [
      { segmentSpecId: 52n, qty: 3 },
    ]);
    const checkOrder = steelIssues.assertStepsWithinCutAfterReduceInTx.mock.invocationCallOrder[0];
    expect(checkOrder).toBeLessThan(tx.floorReport.create.mock.invocationCallOrder[0]);
  });

  it('X3 16/11: hủy làm Uốn/Dập vượt số cắt -> lỗi, không ghi đảo, không trừ', async () => {
    steelIssues.assertStepsWithinCutAfterReduceInTx.mockRejectedValue(
      new BadRequestException('vượt'),
    );
    await expect(service.reverse('11', 'đếm lại', 'qlsx-1')).rejects.toThrow(BadRequestException);
    expect(tx.floorReport.create).not.toHaveBeenCalled();
    expect(tx.cutPatternSegment.update).not.toHaveBeenCalled();
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

  it('P1 [1]: đảo CUT / STEP / PIECE đều mở transaction với maxWait 10s + timeout 20s (không dùng mặc định 5s)', async () => {
    const options = { maxWait: 10_000, timeout: 20_000 };

    await service.reverse('11', 'đếm lại', 'qlsx-1');
    expect(prisma.$transaction).toHaveBeenLastCalledWith(expect.any(Function), options);

    prisma.floorReport.findUnique.mockResolvedValue({
      ...cutReport,
      kind: 'STEP',
      cutBundleId: null,
      stepBatchId: 77n,
    });
    tx.$queryRaw.mockResolvedValue([{ stepBundleId: null }]);
    await service.reverse('11', 'báo nhầm', 'qlsx-1');
    expect(prisma.$transaction).toHaveBeenLastCalledWith(expect.any(Function), options);

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
    expect(prisma.$transaction).toHaveBeenLastCalledWith(expect.any(Function), options);
  });

  it('CUT: đợt KCS đã chốt để chấm -> 409 câu mới (AC15), không ghi gì', async () => {
    tx.$queryRaw.mockResolvedValue([{ status: 'AWAITING_QC' }]);
    await expect(service.reverse('11', 'muộn quá', 'qlsx-1')).rejects.toThrow(
      'KCS đã bắt đầu chấm đợt này - không hủy được nữa. Số sai thì báo KCS ghi “số thực có” khi chấm.',
    );
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

    await expect(service.reverse('11', 'x', 'q')).rejects.toThrow(
      /KCS đã bắt đầu chấm đợt này - không hủy được nữa/,
    );

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

    await expect(service.reverse('11', 'x', 'q')).rejects.toThrow(
      /KCS đã bắt đầu chấm đợt này - không hủy được nữa/,
    );

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

describe('FloorReviewService - KCS chốt để chấm (5 route close)', () => {
  const GATE = 'chốt để chấm';
  const CUT_GONE = 'Đợt cắt này vừa bị QLSX hủy hết số - không còn gì để chấm, tải lại trang.';
  const BATCH_GONE = 'Lô này vừa bị QLSX hủy hết số - không còn gì để chấm, tải lại trang.';
  let prisma: {
    productionBatch: { findUnique: jest.Mock };
    productionOrder: { findMany: jest.Mock };
    user: { findUnique: jest.Mock };
  };
  let steelIssues: { finishCutBundle: jest.Mock; submitStepBundle: jest.Mock };
  let productionBatches: { finishProductionBatch: jest.Mock; submitPieceStep: jest.Mock };
  let yieldProduction: { submitStep: jest.Mock };
  let service: FloorReviewService;

  beforeEach(() => {
    prisma = {
      productionBatch: { findUnique: jest.fn() },
      productionOrder: { findMany: jest.fn().mockResolvedValue([{ id: 41n }]) },
      // KCS gắn xưởng khác cũng chốt được: hàm close không hề hỏi phạm vi xưởng.
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ workshopId: 1n, workshop: { name: 'Xưởng 1', paintsFor: [] } }),
      },
    };
    steelIssues = {
      finishCutBundle: jest.fn().mockResolvedValue({ id: '52' }),
      submitStepBundle: jest.fn().mockResolvedValue({ id: '8' }),
    };
    productionBatches = {
      finishProductionBatch: jest.fn().mockResolvedValue({ id: '106' }),
      submitPieceStep: jest.fn().mockResolvedValue({ id: '21' }),
    };
    yieldProduction = { submitStep: jest.fn().mockResolvedValue({ id: '31' }) };
    service = new FloorReviewService(
      prisma as unknown as PrismaServiceType,
      steelIssues as unknown as SteelIssuesService,
      productionBatches as unknown as ProductionBatchesService,
      new WorkshopScopeService(prisma as unknown as PrismaServiceType),
      yieldProduction as unknown as MaterialYieldRecipeProductionService,
    );
  });

  const stepDto = (over: Record<string, unknown> = {}) =>
    ({
      productionInvoiceId: '45',
      materialId: '7',
      step: 'UON',
      productionOrderId: '41',
      workerId: null,
      ...over,
    }) as Parameters<FloorReviewService['closeStepGroup']>[0];

  it('đợt cắt: gọi finishCutBundle không phát tin KCS, nhãn cổng "chốt để chấm", không hỏi xưởng', async () => {
    await expect(service.closeCutBundle('52', 'kcs-1')).resolves.toEqual({ id: '52' });
    expect(steelIssues.finishCutBundle).toHaveBeenCalledWith('52', {
      notifyKcs: false,
      gateLabel: GATE,
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('đợt cắt vừa bị QLSX hủy hết (404 từ hàm cũ) -> 409 câu "vừa bị QLSX hủy hết số"', async () => {
    steelIssues.finishCutBundle.mockRejectedValue(
      new NotFoundException('Không tìm thấy đợt cắt 52'),
    );
    const err = await service.closeCutBundle('52', 'kcs-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toBe(CUT_GONE);
  });

  it('đợt cắt: lỗi khác (409 vừa chốt, 409 lệnh dừng) ném lại nguyên văn, không bị đổi câu', async () => {
    const stopped = new ConflictException(
      'PI 45 chưa có SKU nào được QLSX bấm "Bắt đầu" (hoặc đã "Kết thúc") - chưa/không thể chốt để chấm',
    );
    steelIssues.finishCutBundle.mockRejectedValue(stopped);
    await expect(service.closeCutBundle('52', 'kcs-1')).rejects.toBe(stopped);
  });

  it('lô mảnh: lấy tổ của chính lô làm vai (HAN), warehouseScope null, notifyKcs false + nhãn cổng', async () => {
    prisma.productionBatch.findUnique.mockResolvedValue({ stage: 'HAN' });
    await expect(service.closeProductionBatch('106', 'kcs-1')).resolves.toEqual({ id: '106' });
    expect(prisma.productionBatch.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 106n } }),
    );
    expect(productionBatches.finishProductionBatch).toHaveBeenCalledWith(
      '106',
      'kcs-1',
      'HAN',
      null,
      { notifyKcs: false, gateLabel: GATE },
    );
  });

  it.each(['PHOI', 'SON'])(
    'lô mảnh tổ %s: truyền đúng vai của tổ, không truyền "KCS"',
    async (stage) => {
      prisma.productionBatch.findUnique.mockResolvedValue({ stage });
      await service.closeProductionBatch('106', 'kcs-1');
      expect((productionBatches.finishProductionBatch.mock.calls as unknown[][])[0][2]).toBe(stage);
    },
  );

  it('lô mảnh không còn (QLSX hủy hết, đã xoá) -> 409 câu "vừa bị QLSX hủy hết số", không chốt', async () => {
    prisma.productionBatch.findUnique.mockResolvedValue(null);
    const err = await service.closeProductionBatch('106', 'kcs-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toBe(BATCH_GONE);
    expect(productionBatches.finishProductionBatch).not.toHaveBeenCalled();
  });

  it('lô mảnh bị xoá giữa chừng (404 từ hàm cũ) -> 409 cùng câu', async () => {
    prisma.productionBatch.findUnique.mockResolvedValue({ stage: 'SON' });
    productionBatches.finishProductionBatch.mockRejectedValue(new NotFoundException('x'));
    await expect(service.closeProductionBatch('106', 'kcs-1')).rejects.toThrow(BATCH_GONE);
  });

  it('nhóm công đoạn: truyền công nhân của nhóm (id / null) + SKU + nhãn cổng', async () => {
    await service.closeStepGroup(stepDto({ workerId: 'w-1' }), 'kcs-1');
    expect(steelIssues.submitStepBundle).toHaveBeenLastCalledWith(
      '45',
      '7',
      'UON',
      'kcs-1',
      '41',
      { id: 'w-1' },
      { gateLabel: GATE },
    );
    await service.closeStepGroup(stepDto({ workerId: null }), 'kcs-1');
    expect((steelIssues.submitStepBundle.mock.calls as unknown[][])[1][5]).toEqual({ id: null });
  });

  it('nhóm công đoạn không gửi workerId -> coi là null, KHÔNG gom hết mọi công nhân', async () => {
    await service.closeStepGroup(stepDto({ workerId: undefined }), 'kcs-1');
    expect((steelIssues.submitStepBundle.mock.calls as unknown[][])[0][5]).toEqual({ id: null });
  });

  it('nhóm chưa gắn SKU (productionOrderId null): PI 1 SKU gộp vào SKU duy nhất', async () => {
    prisma.productionOrder.findMany.mockResolvedValue([{ id: 41n }]);
    await service.closeStepGroup(stepDto({ productionOrderId: null }), 'kcs-1');
    expect((steelIssues.submitStepBundle.mock.calls as unknown[][])[0][4]).toBe('41');
  });

  it('nhóm chưa gắn SKU ở PI nhiều SKU -> 409 "báo IT", không chốt', async () => {
    prisma.productionOrder.findMany.mockResolvedValue([{ id: 41n }, { id: 42n }]);
    await expect(
      service.closeStepGroup(stepDto({ productionOrderId: null }), 'kcs-1'),
    ).rejects.toThrow('Dữ liệu cũ chưa gắn SKU - chưa chấm được, báo IT.');
    expect(steelIssues.submitStepBundle).not.toHaveBeenCalled();
  });

  it('nhóm công đoạn: 400 "không còn lần báo nào chưa chấm" của hàm cũ ném lại nguyên văn', async () => {
    const gone = new BadRequestException('Nhóm Uốn này không còn lần báo nào chưa chấm');
    steelIssues.submitStepBundle.mockRejectedValue(gone);
    await expect(service.closeStepGroup(stepDto(), 'kcs-1')).rejects.toBe(gone);
  });

  it('pat: submitPieceStep với vai PHOI + nhãn cổng, body chỉ có mảnh + công đoạn', async () => {
    await expect(
      service.closePieceStepGroup(
        { productionOrderId: '41', pieceId: '9', step: 'DUC_LO' },
        'kcs-1',
      ),
    ).resolves.toEqual({ id: '21' });
    expect(productionBatches.submitPieceStep).toHaveBeenCalledWith(
      '41',
      { pieceId: '9', step: 'DUC_LO' },
      'kcs-1',
      'PHOI',
      { gateLabel: GATE },
    );
  });

  it('chân nhôm: submitStep với vai PHOI, notifyKcs false + nhãn cổng', async () => {
    await expect(
      service.closeMaterialYieldGroup(
        { productionInvoiceId: '45', recipeId: '3', step: 'DAP' },
        'kcs-1',
      ),
    ).resolves.toEqual({ id: '31' });
    expect(yieldProduction.submitStep).toHaveBeenCalledWith(
      '45',
      { recipeId: '3', step: 'DAP' },
      'kcs-1',
      'PHOI',
      { notifyKcs: false, gateLabel: GATE },
    );
  });
});
