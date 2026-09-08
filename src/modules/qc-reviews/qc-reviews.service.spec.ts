import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { ProductionBatchStatus, SteelIssueStatus } from '../../generated/prisma/client';
import { ProductionBatchesService } from '../production-batches/production-batches.service';
import { SteelIssuesService } from '../steel-issues/steel-issues.service';
import { QcReviewsService } from './qc-reviews.service';

const decimal = (n: number) => ({ toNumber: () => n, toString: () => String(n) });

describe('QcReviewsService', () => {
  let service: QcReviewsService;
  let prisma: {
    qcReview: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findFirst: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
    };
    qcReviewSegment: { update: jest.Mock };
    segmentSpec: { findMany: jest.Mock };
    cutPatternSegment: { groupBy: jest.Mock };
    stepBatchSegment: { groupBy: jest.Mock };
    steelIssue: { update: jest.Mock; findUnique: jest.Mock };
    cutBundle: { findUnique: jest.Mock; update: jest.Mock };
    stepBundle: { findUnique: jest.Mock; update: jest.Mock };
    productionBatch: { update: jest.Mock };
    pieceStepBundle: { update: jest.Mock };
    productionOrder: { findFirst: jest.Mock; findUniqueOrThrow: jest.Mock };
    productionInvoiceItem: { findUniqueOrThrow: jest.Mock };
    $transaction: jest.Mock;
  };
  let steelIssuesService: {
    findOneRowOrThrow: jest.Mock;
    createReworkIssue: jest.Mock;
    syncIssueStatusFromBundles: jest.Mock;
  };
  let productionBatchesService: {
    findOneRowOrThrow: jest.Mock;
    findOnePieceStepBundleRowOrThrow: jest.Mock;
  };

  const awaitingIssue = {
    id: 100n,
    pieceId: 20n,
    materialId: 30n,
    barLengthMm: 6000,
    barCount: 20,
    actualBarCount: 19,
    status: SteelIssueStatus.AWAITING_QC,
    issuedById: 'user-kho',
    productionOrderId: 1n,
    productionInvoiceId: 900n,
  };

  const qcReview = {
    id: 500n,
    steelIssueId: 100n,
    productionBatchId: null,
    failedQty: 0,
    defectReasonId: null,
    defectReason: null,
    reason: null,
    photoUrl: null,
    reviewedAt: new Date(),
    reviewedById: 'user-kcs',
    segments: [] as {
      id: bigint;
      segmentSpecId: bigint;
      failedQty: number;
      segmentSpec: { cutLengthMm: ReturnType<typeof decimal> };
    }[],
  };

  // Cỡ đoạn 745mm, cùng materialId 30n với awaitingIssue - đã cắt 8 đoạn trong CHÍNH đợt 100n.
  const segmentSpecRow = { id: 30n, materialId: 30n, cutLengthMm: decimal(745) };

  const awaitingBatch = {
    id: 700n,
    stage: 'HAN',
    productionOrderId: 1n,
    pieceId: 40n,
    reportedQty: 20,
    status: ProductionBatchStatus.AWAITING_QC,
    reportedById: 'user-han',
  };

  const batchQcReview = {
    id: 501n,
    steelIssueId: null,
    productionBatchId: 700n,
    failedQty: 0,
    defectReasonId: null,
    defectReason: null,
    reason: null,
    photoUrl: null,
    reviewedAt: new Date(),
    reviewedById: 'user-kcs',
    segments: [] as {
      id: bigint;
      segmentSpecId: bigint;
      failedQty: number;
      segmentSpec: { cutLengthMm: ReturnType<typeof decimal> };
    }[],
  };

  const awaitingBundle = {
    id: 800n,
    productionOrderId: 1n,
    pieceId: 40n,
    step: 'CAT',
    qty: 10,
    status: 'AWAITING_QC',
    submittedById: 'user-phoi',
  };

  const bundleQcReview = {
    id: 502n,
    steelIssueId: null,
    productionBatchId: null,
    pieceStepBundleId: 800n,
    failedQty: 0,
    defectReasonId: null,
    defectReason: null,
    reason: null,
    photoUrl: null,
    reviewedAt: new Date(),
    reviewedById: 'user-kcs',
    segments: [] as {
      id: bigint;
      segmentSpecId: bigint;
      failedQty: number;
      segmentSpec: { cutLengthMm: ReturnType<typeof decimal> };
    }[],
  };

  beforeEach(() => {
    prisma = {
      qcReview: {
        create: jest.fn().mockResolvedValue(qcReview),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      qcReviewSegment: { update: jest.fn() },
      segmentSpec: { findMany: jest.fn().mockResolvedValue([segmentSpecRow]) },
      cutPatternSegment: {
        groupBy: jest.fn().mockResolvedValue([{ segmentSpecId: 30n, _sum: { qty: 8 } }]),
      },
      stepBatchSegment: {
        groupBy: jest.fn().mockResolvedValue([{ segmentSpecId: 30n, _sum: { qty: 8 } }]),
      },
      steelIssue: { update: jest.fn(), findUnique: jest.fn() },
      cutBundle: { findUnique: jest.fn(), update: jest.fn() },
      stepBundle: { findUnique: jest.fn(), update: jest.fn() },
      productionBatch: { update: jest.fn() },
      pieceStepBundle: { update: jest.fn() },
      // floorStage gate (2026-08-31) - mặc định PI luôn có 1 order ACTIVE, đa số test không quan
      // tâm gate assertPiHasActiveFloorForInvoice()/assertPiHasActiveFloorForOrder(), xem mục
      // riêng "QLSX kiểm soát" bên dưới mới override.
      productionOrder: {
        findFirst: jest.fn().mockResolvedValue({ id: 9n }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ productionInvoiceItemId: 20n }),
      },
      productionInvoiceItem: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ productionInvoiceId: 900n }),
      },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    steelIssuesService = {
      findOneRowOrThrow: jest.fn().mockResolvedValue(awaitingIssue),
      createReworkIssue: jest.fn(),
      syncIssueStatusFromBundles: jest.fn(),
    };
    productionBatchesService = {
      findOneRowOrThrow: jest.fn().mockResolvedValue(awaitingBatch),
      findOnePieceStepBundleRowOrThrow: jest.fn().mockResolvedValue(awaitingBundle),
    };
    service = new QcReviewsService(
      prisma as unknown as PrismaServiceType,
      steelIssuesService as unknown as SteelIssuesService,
      productionBatchesService as unknown as ProductionBatchesService,
    );
  });

  describe('review', () => {
    it('duyệt ĐẠT hoàn toàn (segments=[]) - đóng QC_PASSED, failedQty tổng = 0', async () => {
      const result = await service.review('100', { segments: [] }, 'user-kcs');

      expect(prisma.steelIssue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 100n },
          data: { status: SteelIssueStatus.QC_PASSED },
        }),
      );
      expect(prisma.qcReview.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({ failedQty: 0 }),
        }),
      );
      expect(result.id).toBe('500');
    });

    it('chấm lỗi 1 cỡ đoạn - tạo QcReviewSegment, failedQty tổng = đúng cỡ đó', async () => {
      await service.review(
        '100',
        { segments: [{ segmentSpecId: '30', failedQty: 3 }] },
        'user-kcs',
      );

      expect(prisma.qcReview.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({
            failedQty: 3,
            segments: { create: [{ segmentSpecId: 30n, failedQty: 3 }] },
          }),
        }),
      );
    });

    it('ném ConflictException nếu đợt không ở AWAITING_QC', async () => {
      steelIssuesService.findOneRowOrThrow.mockResolvedValue({
        ...awaitingIssue,
        status: SteelIssueStatus.RECEIVED,
      });

      await expect(service.review('100', { segments: [] }, 'user-kcs')).rejects.toThrow(
        ConflictException,
      );
    });

    it('ném BadRequestException nếu failedQty của 1 cỡ vượt số đã cắt CHÍNH ĐỢT này', async () => {
      // đã cắt 8 đoạn cỡ 745mm (mock cutPatternSegment.groupBy), chấm lỗi 9 là vượt
      await expect(
        service.review('100', { segments: [{ segmentSpecId: '30', failedQty: 9 }] }, 'user-kcs'),
      ).rejects.toThrow(BadRequestException);
    });

    it('ném BadRequestException nếu cỡ đoạn thuộc LOẠI SẮT KHÁC với đợt xuất', async () => {
      prisma.segmentSpec.findMany.mockResolvedValue([{ ...segmentSpecRow, materialId: 999n }]);

      await expect(
        service.review('100', { segments: [{ segmentSpecId: '30', failedQty: 1 }] }, 'user-kcs'),
      ).rejects.toThrow(BadRequestException);
    });

    it('ném NotFoundException nếu segmentSpecId không tồn tại', async () => {
      prisma.segmentSpec.findMany.mockResolvedValue([]);

      await expect(
        service.review('100', { segments: [{ segmentSpecId: '999', failedQty: 1 }] }, 'user-kcs'),
      ).rejects.toThrow(NotFoundException);
    });

    // 2026-08-31: KCS nằm trong chuỗi kiểm soát của QLSX - dừng "Bắt đầu" (hoặc đã "Kết thúc") thì
    // KCS cũng không duyệt được nữa, dù đợt sắt đang AWAITING_QC thật.
    it('ném ConflictException khi PI của đợt sắt chưa có SKU nào ACTIVE', async () => {
      prisma.productionOrder.findFirst.mockResolvedValue(null);

      await expect(service.review('100', { segments: [] }, 'user-kcs')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.productionOrder.findFirst).toHaveBeenCalledWith({
        where: { productionInvoiceItem: { productionInvoiceId: 900n }, floorStage: 'ACTIVE' },
        select: { id: true },
      });
      expect(prisma.qcReview.create).not.toHaveBeenCalled();
    });

    it('cho phép duyệt khi PI có ÍT NHẤT 1 SKU ACTIVE, kể cả khi KHÔNG PHẢI chính SKU của đợt sắt', async () => {
      prisma.productionOrder.findFirst.mockResolvedValue({ id: 999n }); // SKU khác trong cùng PI

      await expect(service.review('100', { segments: [] }, 'user-kcs')).resolves.toBeDefined();
    });
  });

  // 2026-09-05: chấm theo ĐỢT CẮT (CutBundle) thay vì cả lô nhận - 1 lô có thể có NHIỀU đợt cắt
  // cùng AWAITING_QC, "vượt số đã cắt" phải đối chiếu đúng đợt đang chấm.
  describe('reviewCutBundle', () => {
    const awaitingBundle = {
      id: 1n,
      steelIssueId: 100n,
      status: 'AWAITING_QC',
      steelIssue: { productionInvoiceId: 900n, materialId: 30n },
    };
    const bundleQcReview = { ...qcReview, cutBundleId: 1n };

    beforeEach(() => {
      prisma.cutBundle.findUnique.mockResolvedValue(awaitingBundle);
      prisma.qcReview.create.mockResolvedValue(bundleQcReview);
    });

    it('duyệt ĐẠT hoàn toàn - đóng bundle QC_PASSED, KHÔNG đụng SteelIssue.status trực tiếp (roll-up riêng)', async () => {
      const result = await service.reviewCutBundle('1', { segments: [] }, 'user-kcs');

      expect(prisma.cutBundle.update).toHaveBeenCalledWith({
        where: { id: 1n },
        data: { status: 'QC_PASSED' },
      });
      expect(prisma.qcReview.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({ steelIssueId: 100n, cutBundleId: 1n, failedQty: 0 }),
        }),
      );
      expect(steelIssuesService.syncIssueStatusFromBundles).toHaveBeenCalledWith(100n);
      expect(result.id).toBe('500');
    });

    it('vượt số đã cắt của ĐÚNG bundle này (groupBy lọc theo cutBundleId, không cộng dồn cả lô)', async () => {
      prisma.cutPatternSegment.groupBy.mockResolvedValue([
        { segmentSpecId: 30n, _sum: { qty: 8 } },
      ]);

      await expect(
        service.reviewCutBundle(
          '1',
          { segments: [{ segmentSpecId: '30', failedQty: 9 }] },
          'user-kcs',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.cutPatternSegment.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: { cutBundleId: 1n } }),
      );
    });

    it('ném ConflictException nếu bundle không ở AWAITING_QC', async () => {
      prisma.cutBundle.findUnique.mockResolvedValue({ ...awaitingBundle, status: 'CUTTING' });

      await expect(service.reviewCutBundle('1', { segments: [] }, 'user-kcs')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.qcReview.create).not.toHaveBeenCalled();
    });

    it('ném NotFoundException nếu đợt cắt không tồn tại', async () => {
      prisma.cutBundle.findUnique.mockResolvedValue(null);

      await expect(service.reviewCutBundle('999', { segments: [] }, 'user-kcs')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('ném ConflictException khi PI của đợt cắt chưa có SKU nào ACTIVE', async () => {
      prisma.productionOrder.findFirst.mockResolvedValue(null);

      await expect(service.reviewCutBundle('1', { segments: [] }, 'user-kcs')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.qcReview.create).not.toHaveBeenCalled();
    });
  });

  // 2026-09-07: KCS duyệt 1 "đợt gửi KCS theo công đoạn PHỤ" (StepBundle - Uốn/Dập/Tán/...) - CÙNG
  // khuôn reviewCutBundle() nhưng validate qua StepBatchSegment (không phải CutPatternSegment) và
  // KHÔNG đụng CutBundle.status (vòng đời StepBundle độc lập hoàn toàn với vòng đời Cắt).
  describe('reviewStepBundle', () => {
    const awaitingStepBundle = {
      id: 800n,
      productionInvoiceId: 900n,
      materialId: 30n,
      step: 'UON',
      status: 'AWAITING_QC',
      material: { code: 'SAT-30', name: 'Sắt hộp', spec: '25x50' },
    };
    const stepBundleQcReview = { ...qcReview, cutBundleId: null, stepBundleId: 800n };

    beforeEach(() => {
      prisma.stepBundle.findUnique.mockResolvedValue(awaitingStepBundle);
      prisma.qcReview.create.mockResolvedValue(stepBundleQcReview);
    });

    it('duyệt ĐẠT hoàn toàn - đóng StepBundle QC_PASSED, KHÔNG ghi steelIssueId (leg XOR)', async () => {
      const result = await service.reviewStepBundle('800', { segments: [] }, 'user-kcs');

      expect(prisma.stepBundle.update).toHaveBeenCalledWith({
        where: { id: 800n },
        data: { status: 'QC_PASSED' },
      });
      expect(prisma.cutBundle.update).not.toHaveBeenCalled();
      expect(prisma.qcReview.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({ stepBundleId: 800n, failedQty: 0 }),
        }),
      );
      const calls = prisma.qcReview.create.mock.calls as { data: { steelIssueId?: bigint } }[][];
      expect(calls[0][0].data.steelIssueId).toBeUndefined();
      expect(result.id).toBe('500');
    });

    it('vượt số đã báo của ĐÚNG stepBundle này (groupBy lọc theo stepBatch.stepBundleId)', async () => {
      prisma.stepBatchSegment.groupBy.mockResolvedValue([{ segmentSpecId: 30n, _sum: { qty: 5 } }]);

      await expect(
        service.reviewStepBundle(
          '800',
          { segments: [{ segmentSpecId: '30', failedQty: 6 }] },
          'user-kcs',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.stepBatchSegment.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { segmentSpecId: { in: [30n] }, stepBatch: { stepBundleId: 800n } },
        }),
      );
    });

    it('ném ConflictException nếu bundle không ở AWAITING_QC', async () => {
      prisma.stepBundle.findUnique.mockResolvedValue({
        ...awaitingStepBundle,
        status: 'QC_PASSED',
      });

      await expect(service.reviewStepBundle('800', { segments: [] }, 'user-kcs')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.qcReview.create).not.toHaveBeenCalled();
    });

    it('ném NotFoundException nếu đợt gửi KCS không tồn tại', async () => {
      prisma.stepBundle.findUnique.mockResolvedValue(null);

      await expect(service.reviewStepBundle('999', { segments: [] }, 'user-kcs')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('ném ConflictException khi PI chưa có SKU nào ACTIVE', async () => {
      prisma.productionOrder.findFirst.mockResolvedValue(null);

      await expect(service.reviewStepBundle('800', { segments: [] }, 'user-kcs')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.qcReview.create).not.toHaveBeenCalled();
    });
  });

  describe('reviewProductionBatch', () => {
    beforeEach(() => {
      prisma.qcReview.create.mockResolvedValue(batchQcReview);
    });

    it('duyệt ĐẠT hoàn toàn (failedQty=0) - đóng QC_DONE, reportedQty giữ nguyên', async () => {
      const result = await service.reviewProductionBatch('700', { failedQty: 0 }, 'user-kcs');

      expect(prisma.productionBatch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 700n },
          data: { status: ProductionBatchStatus.QC_DONE, reportedQty: 20 },
        }),
      );
      expect(result.id).toBe('501');
    });

    it('có failedQty - reportedQty ghi đè = phần ĐẠT, KHÔNG tạo lô rework mới (2026-09-08: bỏ hẳn phân loại Sửa được/Phế, mirror reviewPieceStep)', async () => {
      await service.reviewProductionBatch('700', { failedQty: 5 }, 'user-kcs');

      // passed = 20 - 5 = 15
      expect(prisma.productionBatch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: ProductionBatchStatus.QC_DONE, reportedQty: 15 },
        }),
      );
      const createCall = prisma.qcReview.create.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      expect(createCall[0].data).not.toHaveProperty('scrapQty');
    });

    it('ném ConflictException nếu batch không ở AWAITING_QC', async () => {
      productionBatchesService.findOneRowOrThrow.mockResolvedValue({
        ...awaitingBatch,
        status: ProductionBatchStatus.QC_DONE,
      });

      await expect(
        service.reviewProductionBatch('700', { failedQty: 0 }, 'user-kcs'),
      ).rejects.toThrow(ConflictException);
    });

    it('ném BadRequestException nếu failedQty vượt reportedQty', async () => {
      await expect(
        service.reviewProductionBatch('700', { failedQty: 999 }, 'user-kcs'),
      ).rejects.toThrow(BadRequestException);
    });

    // 2026-08-31: KCS nằm trong chuỗi kiểm soát của QLSX - cùng gate đã thêm cho review() (Phôi).
    it('ném ConflictException khi PI của order chưa có SKU nào ACTIVE', async () => {
      prisma.productionOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.reviewProductionBatch('700', { failedQty: 0 }, 'user-kcs'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.productionOrder.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 1n },
        select: { productionInvoiceItemId: true },
      });
      expect(prisma.productionBatch.update).not.toHaveBeenCalled();
    });

    it('cho phép duyệt khi PI có ÍT NHẤT 1 SKU ACTIVE, kể cả khi KHÔNG PHẢI chính order của batch', async () => {
      prisma.productionOrder.findFirst.mockResolvedValue({ id: 999n });

      await expect(
        service.reviewProductionBatch('700', { failedQty: 0 }, 'user-kcs'),
      ).resolves.toBeDefined();
    });
  });

  // 2026-09-07: KCS duyệt 1 "đợt gửi KCS theo công đoạn" (PieceStepBundle) - cùng khuôn
  // reviewProductionBatch() nhưng KHÔNG đụng ProductionBatch.reportedQty (bundle không sinh sản
  // lượng, thuần cổng kiểm tra chất lượng theo công đoạn).
  describe('reviewPieceStep', () => {
    beforeEach(() => {
      prisma.qcReview.create.mockResolvedValue(bundleQcReview);
    });

    it('duyệt ĐẠT hoàn toàn (failedQty=0) - bundle chuyển QC_PASSED, KHÔNG đụng ProductionBatch', async () => {
      const result = await service.reviewPieceStep('800', { failedQty: 0 }, 'user-kcs');

      expect(prisma.pieceStepBundle.update).toHaveBeenCalledWith({
        where: { id: 800n },
        data: { status: 'QC_PASSED' },
      });
      expect(prisma.productionBatch.update).not.toHaveBeenCalled();
      expect(result.id).toBe('502');
    });

    it('có failedQty - vẫn chuyển QC_PASSED (mirror Phôi/Sắt - không có khái niệm phế)', async () => {
      await service.reviewPieceStep('800', { failedQty: 5 }, 'user-kcs');

      expect(prisma.pieceStepBundle.update).toHaveBeenCalledWith({
        where: { id: 800n },
        data: { status: 'QC_PASSED' },
      });
    });

    it('ném ConflictException nếu bundle không ở AWAITING_QC', async () => {
      productionBatchesService.findOnePieceStepBundleRowOrThrow.mockResolvedValue({
        ...awaitingBundle,
        status: 'QC_PASSED',
      });

      await expect(service.reviewPieceStep('800', { failedQty: 0 }, 'user-kcs')).rejects.toThrow(
        ConflictException,
      );
    });

    it('ném BadRequestException nếu failedQty vượt qty đã gửi', async () => {
      await expect(service.reviewPieceStep('800', { failedQty: 999 }, 'user-kcs')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('ném ConflictException khi PI của order chưa có SKU nào ACTIVE', async () => {
      prisma.productionOrder.findFirst.mockResolvedValue(null);

      await expect(service.reviewPieceStep('800', { failedQty: 0 }, 'user-kcs')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.pieceStepBundle.update).not.toHaveBeenCalled();
    });
  });
});
