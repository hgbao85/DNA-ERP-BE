import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import {
  ProductionBatchStatus,
  ReplenishRequestStatus,
  SteelIssueStatus,
} from '../../generated/prisma/client';
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
    replenishRequest: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
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
    scrapQty: null,
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
    scrapQty: null,
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
    scrapQty: null,
    defectReasonId: null,
    defectReason: null,
    reason: null,
    photoUrl: null,
    reviewedAt: new Date(),
    reviewedById: 'user-kcs',
    resolvedQty: 0,
    phoiReportedAt: null as Date | null,
    phoiReportedQty: null as number | null,
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
      replenishRequest: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
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
          data: expect.objectContaining({ failedQty: 0, scrapQty: 0 }),
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
      cutBundleId: 1n,
      step: 'UON',
      status: 'AWAITING_QC',
      cutBundle: { steelIssueId: 100n, steelIssue: { productionInvoiceId: 900n, materialId: 30n } },
    };
    const stepBundleQcReview = { ...qcReview, cutBundleId: null, stepBundleId: 800n };

    beforeEach(() => {
      prisma.stepBundle.findUnique.mockResolvedValue(awaitingStepBundle);
      prisma.qcReview.create.mockResolvedValue(stepBundleQcReview);
    });

    it('duyệt ĐẠT hoàn toàn - đóng StepBundle QC_PASSED, KHÔNG đụng CutBundle.status', async () => {
      const result = await service.reviewStepBundle('800', { segments: [] }, 'user-kcs');

      expect(prisma.stepBundle.update).toHaveBeenCalledWith({
        where: { id: 800n },
        data: { status: 'QC_PASSED' },
      });
      expect(prisma.cutBundle.update).not.toHaveBeenCalled();
      expect(prisma.qcReview.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({ steelIssueId: 100n, stepBundleId: 800n, failedQty: 0 }),
        }),
      );
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

  // Chỉ test phần "chọn ĐÚNG scope" (stepBundleId) - logic outstanding/phoiReportedAt dùng chung
  // reportSegmentDoneForRow()/recheckForReview() đã có test đầy đủ ở describe('reportSegmentDone')
  // bên dưới, không lặp lại ở đây.
  describe('reportSegmentDoneForStepBundle / recheckForStepBundle', () => {
    const reviewWithFailedSegment = {
      ...qcReview,
      stepBundleId: 800n,
      segments: [
        {
          id: 900n,
          segmentSpecId: 30n,
          failedQty: 5,
          resolvedQty: 2,
          phoiReportedAt: null as Date | null,
          segmentSpec: { cutLengthMm: decimal(745) },
        },
      ],
    };

    beforeEach(() => {
      prisma.qcReview.findFirst.mockResolvedValue(reviewWithFailedSegment);
      prisma.qcReview.findUniqueOrThrow.mockResolvedValue(reviewWithFailedSegment);
    });

    it('reportSegmentDoneForStepBundle - tìm review ĐÚNG theo stepBundleId, báo bù đủ thành công', async () => {
      await service.reportSegmentDoneForStepBundle('800', '30', { qty: 3 });

      expect(prisma.qcReview.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { stepBundleId: 800n } }),
      );
      expect(prisma.qcReviewSegment.update).toHaveBeenCalledWith({
        where: { id: 900n },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
        data: { phoiReportedAt: expect.any(Date), phoiReportedQty: 3 },
      });
    });

    it('recheckForStepBundle - tìm review ĐÚNG theo stepBundleId, duyệt lại thành công', async () => {
      prisma.qcReview.findFirst.mockResolvedValue({
        ...reviewWithFailedSegment,
        segments: [
          {
            ...reviewWithFailedSegment.segments[0],
            phoiReportedAt: new Date(),
            phoiReportedQty: 3,
          },
        ],
      });

      await service.recheckForStepBundle('800', {
        segments: [{ segmentSpecId: '30', remainingFailedQty: 0 }],
      });

      expect(prisma.qcReview.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { stepBundleId: 800n } }),
      );
      expect(prisma.qcReviewSegment.update).toHaveBeenCalledWith({
        where: { id: 900n },
        data: { resolvedQty: 5, phoiReportedAt: expect.any(Date) as unknown, phoiReportedQty: 3 },
      });
    });

    it('reportSegmentDoneForStepBundle - ném NotFoundException nếu chưa có KCS chấm nào', async () => {
      prisma.qcReview.findFirst.mockResolvedValue(null);

      await expect(service.reportSegmentDoneForStepBundle('800', '30', { qty: 1 })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reportSegmentDone', () => {
    const reviewWithFailedSegment = {
      ...qcReview,
      segments: [
        {
          id: 900n,
          segmentSpecId: 30n,
          failedQty: 5,
          resolvedQty: 2,
          phoiReportedAt: null as Date | null,
          segmentSpec: { cutLengthMm: decimal(745) },
        },
      ],
    };

    beforeEach(() => {
      prisma.qcReview.findFirst.mockResolvedValue(reviewWithFailedSegment);
      prisma.qcReview.findUniqueOrThrow.mockResolvedValue(reviewWithFailedSegment);
    });

    it('báo bù đủ thành công - set phoiReportedAt + phoiReportedQty (outstanding = 5 - 2 = 3 > 0)', async () => {
      await service.reportSegmentDone('100', '30', { qty: 3 });

      expect(prisma.qcReviewSegment.update).toHaveBeenCalledWith({
        where: { id: 900n },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
        data: { phoiReportedAt: expect.any(Date), phoiReportedQty: 3 },
      });
    });

    it('cho báo bù MỘT PHẦN outstanding (qty < outstanding) - lưu đúng qty đã khai', async () => {
      await service.reportSegmentDone('100', '30', { qty: 1 });

      expect(prisma.qcReviewSegment.update).toHaveBeenCalledWith({
        where: { id: 900n },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
        data: { phoiReportedAt: expect.any(Date), phoiReportedQty: 1 },
      });
    });

    it('ném BadRequestException nếu qty vượt outstanding (3)', async () => {
      await expect(service.reportSegmentDone('100', '30', { qty: 4 })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.qcReviewSegment.update).not.toHaveBeenCalled();
    });

    it('ném ConflictException nếu cỡ đoạn đã hết lỗi (outstanding = 0)', async () => {
      prisma.qcReview.findFirst.mockResolvedValue({
        ...reviewWithFailedSegment,
        segments: [{ ...reviewWithFailedSegment.segments[0], resolvedQty: 5 }],
      });

      await expect(service.reportSegmentDone('100', '30', { qty: 1 })).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.qcReviewSegment.update).not.toHaveBeenCalled();
    });

    it('ném ConflictException nếu đã báo bù đủ rồi - đang chờ KCS duyệt lại', async () => {
      prisma.qcReview.findFirst.mockResolvedValue({
        ...reviewWithFailedSegment,
        segments: [{ ...reviewWithFailedSegment.segments[0], phoiReportedAt: new Date() }],
      });

      await expect(service.reportSegmentDone('100', '30', { qty: 3 })).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.qcReviewSegment.update).not.toHaveBeenCalled();
    });

    it('ném NotFoundException nếu đợt sắt chưa có KCS chấm nào', async () => {
      prisma.qcReview.findFirst.mockResolvedValue(null);

      await expect(service.reportSegmentDone('100', '30', { qty: 3 })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('ném NotFoundException nếu cỡ đoạn đó không có lỗi trong lần chấm', async () => {
      await expect(service.reportSegmentDone('100', '999', { qty: 1 })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('ném ConflictException khi PI đã bị QLSX "Tạm dừng"/"Kết thúc" (assertPiHasActiveFloor, 2026-09-01)', async () => {
      prisma.productionOrder.findFirst.mockResolvedValue(null);

      await expect(service.reportSegmentDone('100', '30', { qty: 3 })).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.qcReviewSegment.update).not.toHaveBeenCalled();
    });
  });

  describe('recheck', () => {
    const reviewAwaitingRecheck = {
      ...qcReview,
      segments: [
        {
          id: 900n,
          segmentSpecId: 30n,
          failedQty: 5,
          resolvedQty: 2,
          phoiReportedAt: new Date('2026-08-24T00:00:00.000Z') as Date | null,
          phoiReportedQty: 3 as number | null,
          segmentSpec: { cutLengthMm: decimal(745) },
        },
      ],
    };

    beforeEach(() => {
      prisma.qcReview.findFirst.mockResolvedValue(reviewAwaitingRecheck);
      prisma.qcReview.findUniqueOrThrow.mockResolvedValue(reviewAwaitingRecheck);
    });

    it('duyệt lại đạt hết (remainingFailedQty=0) - resolvedQty = failedQty, phoiReportedAt/Qty giữ nguyên làm lịch sử', async () => {
      await service.recheck('100', { segments: [{ segmentSpecId: '30', remainingFailedQty: 0 }] });

      // outstanding = 5 - 2 = 3; resolvedQty = 2 + (3 - 0) = 5
      expect(prisma.qcReviewSegment.update).toHaveBeenCalledWith({
        where: { id: 900n },
        data: {
          resolvedQty: 5,
          phoiReportedAt: reviewAwaitingRecheck.segments[0].phoiReportedAt,
          phoiReportedQty: 3,
        },
      });
    });

    it('duyệt lại còn hỏng (remainingFailedQty=1) - cộng phần đạt, phoiReportedAt/Qty reset về null', async () => {
      await service.recheck('100', { segments: [{ segmentSpecId: '30', remainingFailedQty: 1 }] });

      // resolvedQty = 2 + (3 - 1) = 4
      expect(prisma.qcReviewSegment.update).toHaveBeenCalledWith({
        where: { id: 900n },
        data: { resolvedQty: 4, phoiReportedAt: null, phoiReportedQty: null },
      });
    });

    it('ném BadRequestException nếu remainingFailedQty vượt outstanding (3)', async () => {
      await expect(
        service.recheck('100', { segments: [{ segmentSpecId: '30', remainingFailedQty: 4 }] }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.qcReviewSegment.update).not.toHaveBeenCalled();
    });

    it('ném ConflictException nếu cỡ đoạn chưa được Phôi báo "Bù đủ" (phoiReportedAt null)', async () => {
      prisma.qcReview.findFirst.mockResolvedValue({
        ...reviewAwaitingRecheck,
        segments: [{ ...reviewAwaitingRecheck.segments[0], phoiReportedAt: null }],
      });

      await expect(
        service.recheck('100', { segments: [{ segmentSpecId: '30', remainingFailedQty: 0 }] }),
      ).rejects.toThrow(ConflictException);
    });

    it('ném NotFoundException nếu đợt sắt chưa có KCS chấm nào', async () => {
      prisma.qcReview.findFirst.mockResolvedValue(null);

      await expect(service.recheck('100', { segments: [] })).rejects.toThrow(NotFoundException);
    });

    it('ném NotFoundException nếu cỡ đoạn không có trong lần chấm', async () => {
      await expect(
        service.recheck('100', { segments: [{ segmentSpecId: '999', remainingFailedQty: 0 }] }),
      ).rejects.toThrow(NotFoundException);
    });

    it('ném ConflictException khi PI đã bị QLSX "Tạm dừng"/"Kết thúc" (assertPiHasActiveFloor, 2026-09-01)', async () => {
      prisma.productionOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.recheck('100', { segments: [{ segmentSpecId: '30', remainingFailedQty: 0 }] }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.qcReviewSegment.update).not.toHaveBeenCalled();
    });
  });

  // 2026-09-05: cùng report-done/recheck nhưng tra review theo cutBundleId thay vì steelIssueId -
  // cần thiết khi 1 lô có NHIỀU đợt cắt cùng bị lỗi cùng 1 cỡ đoạn (tra theo issueId sẽ lấy nhầm
  // review của đợt khác cùng lô).
  describe('reportSegmentDoneForBundle / recheckForBundle', () => {
    const reviewWithFailedSegment = {
      ...qcReview,
      cutBundleId: 1n,
      segments: [
        {
          id: 900n,
          segmentSpecId: 30n,
          failedQty: 5,
          resolvedQty: 2,
          phoiReportedAt: null as Date | null,
          segmentSpec: { cutLengthMm: decimal(745) },
        },
      ],
    };

    beforeEach(() => {
      prisma.qcReview.findFirst.mockResolvedValue(reviewWithFailedSegment);
      prisma.qcReview.findUniqueOrThrow.mockResolvedValue(reviewWithFailedSegment);
    });

    it('reportSegmentDoneForBundle() tra review theo cutBundleId (không phải steelIssueId)', async () => {
      await service.reportSegmentDoneForBundle('1', '30', { qty: 3 });

      expect(prisma.qcReview.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { cutBundleId: 1n } }),
      );
      expect(prisma.qcReviewSegment.update).toHaveBeenCalledWith({
        where: { id: 900n },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
        data: { phoiReportedAt: expect.any(Date), phoiReportedQty: 3 },
      });
    });

    it('ném BadRequestException nếu qty vượt outstanding (3) của đợt cắt', async () => {
      await expect(service.reportSegmentDoneForBundle('1', '30', { qty: 4 })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.qcReviewSegment.update).not.toHaveBeenCalled();
    });

    it('recheckForBundle() tra review theo cutBundleId, cùng phép tính resolvedQty như recheck()', async () => {
      const reviewAwaitingRecheck = {
        ...reviewWithFailedSegment,
        segments: [
          {
            ...reviewWithFailedSegment.segments[0],
            phoiReportedAt: new Date(),
            phoiReportedQty: 3,
          },
        ],
      };
      prisma.qcReview.findFirst.mockResolvedValue(reviewAwaitingRecheck);

      await service.recheckForBundle('1', {
        segments: [{ segmentSpecId: '30', remainingFailedQty: 0 }],
      });

      expect(prisma.qcReview.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { cutBundleId: 1n } }),
      );
      expect(prisma.qcReviewSegment.update).toHaveBeenCalledWith({
        where: { id: 900n },
        data: {
          resolvedQty: 5,
          phoiReportedAt: reviewAwaitingRecheck.segments[0].phoiReportedAt,
          phoiReportedQty: 3,
        },
      });
    });

    it('ném NotFoundException nếu đợt cắt chưa có KCS chấm nào', async () => {
      prisma.qcReview.findFirst.mockResolvedValue(null);

      await expect(service.reportSegmentDoneForBundle('1', '30', { qty: 3 })).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.recheckForBundle('1', { segments: [] })).rejects.toThrow(
        NotFoundException,
      );
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
      expect(prisma.replenishRequest.create).not.toHaveBeenCalled();
      expect(result.id).toBe('501');
    });

    it('có phần fail (rework + scrap) - reportedQty ghi đè = phần ĐẠT, KHÔNG tạo lô rework mới', async () => {
      await service.reviewProductionBatch('700', { failedQty: 5, scrapQty: 2 }, 'user-kcs');

      // passed = 20 - 5 = 15
      expect(prisma.productionBatch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: ProductionBatchStatus.QC_DONE, reportedQty: 15 },
        }),
      );
      expect(prisma.replenishRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { qcReviewId: 501n, qty: 2 } }),
      );
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

    it('ném BadRequestException nếu scrapQty vượt failedQty', async () => {
      await expect(
        service.reviewProductionBatch('700', { failedQty: 2, scrapQty: 3 }, 'user-kcs'),
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

  // 2026-09-07: "Bù đủ" cho lô Hàn/Sơn/VTTP - ngữ nghĩa giống reportSegmentDone/recheck bên Sắt
  // nhưng Ở CẤP REVIEW (không có "cỡ đoạn"), và recheck THẬT SỰ cộng vào ProductionBatch.reportedQty
  // (khác Sắt chỉ tracking) - xem doc comment service.
  describe('reportProductionBatchDone / recheckProductionBatch', () => {
    const reworkReview = {
      ...batchQcReview,
      failedQty: 5,
      scrapQty: 2,
      resolvedQty: 0,
      phoiReportedAt: null as Date | null,
      phoiReportedQty: null as number | null,
    };

    beforeEach(() => {
      prisma.qcReview.findFirst.mockResolvedValue(reworkReview);
      prisma.qcReview.findUniqueOrThrow.mockResolvedValue(reworkReview);
    });

    it('báo bù đủ thành công - set phoiReportedAt/Qty (reworkable = 5-2 = 3, outstanding = 3)', async () => {
      await service.reportProductionBatchDone('700', { qty: 3 });

      expect(prisma.qcReview.update).toHaveBeenCalledWith({
        where: { id: 501n },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
        data: { phoiReportedAt: expect.any(Date), phoiReportedQty: 3 },
      });
    });

    it('cho báo bù MỘT PHẦN outstanding', async () => {
      await service.reportProductionBatchDone('700', { qty: 1 });

      expect(prisma.qcReview.update).toHaveBeenCalledWith({
        where: { id: 501n },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
        data: { phoiReportedAt: expect.any(Date), phoiReportedQty: 1 },
      });
    });

    it('ném BadRequestException nếu qty vượt outstanding (3)', async () => {
      await expect(service.reportProductionBatchDone('700', { qty: 4 })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.qcReview.update).not.toHaveBeenCalled();
    });

    it('ném ConflictException nếu lô đã hết lỗi (outstanding = 0)', async () => {
      prisma.qcReview.findFirst.mockResolvedValue({ ...reworkReview, resolvedQty: 3 });

      await expect(service.reportProductionBatchDone('700', { qty: 1 })).rejects.toThrow(
        ConflictException,
      );
    });

    it('ném ConflictException nếu đã báo bù đủ rồi - đang chờ KCS duyệt lại', async () => {
      prisma.qcReview.findFirst.mockResolvedValue({ ...reworkReview, phoiReportedAt: new Date() });

      await expect(service.reportProductionBatchDone('700', { qty: 1 })).rejects.toThrow(
        ConflictException,
      );
    });

    it('ném NotFoundException nếu lô chưa có KCS chấm nào', async () => {
      prisma.qcReview.findFirst.mockResolvedValue(null);

      await expect(service.reportProductionBatchDone('700', { qty: 1 })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('ném ConflictException khi PI của order chưa có SKU nào ACTIVE (assertOrderPiHasActiveFloor)', async () => {
      prisma.productionOrder.findFirst.mockResolvedValue(null);

      await expect(service.reportProductionBatchDone('700', { qty: 1 })).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.qcReview.update).not.toHaveBeenCalled();
    });

    it('duyệt lại đạt hết (remainingFailedQty=0) - cộng THẲNG vào ProductionBatch.reportedQty', async () => {
      prisma.qcReview.findFirst.mockResolvedValue({
        ...reworkReview,
        phoiReportedAt: new Date(),
        phoiReportedQty: 3,
      });

      await service.recheckProductionBatch('700', { remainingFailedQty: 0 });

      // outstanding = 3 - 0 = 3; justResolved = 3 - 0 = 3
      expect(prisma.qcReview.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 501n },

          data: expect.objectContaining({ resolvedQty: 3 }) as unknown,
        }),
      );
      expect(prisma.productionBatch.update).toHaveBeenCalledWith({
        where: { id: 700n },
        data: { reportedQty: { increment: 3 } },
      });
    });

    it('duyệt lại còn hỏng (remainingFailedQty=1) - cộng phần đạt, phoiReportedAt/Qty reset null', async () => {
      prisma.qcReview.findFirst.mockResolvedValue({
        ...reworkReview,
        phoiReportedAt: new Date(),
        phoiReportedQty: 3,
      });

      await service.recheckProductionBatch('700', { remainingFailedQty: 1 });

      // justResolved = 3 - 1 = 2
      expect(prisma.qcReview.update).toHaveBeenCalledWith({
        where: { id: 501n },
        data: { resolvedQty: 2, phoiReportedAt: null, phoiReportedQty: null },
      });
      expect(prisma.productionBatch.update).toHaveBeenCalledWith({
        where: { id: 700n },
        data: { reportedQty: { increment: 2 } },
      });
    });

    it('ném BadRequestException nếu remainingFailedQty vượt outstanding', async () => {
      prisma.qcReview.findFirst.mockResolvedValue({
        ...reworkReview,
        phoiReportedAt: new Date(),
        phoiReportedQty: 3,
      });

      await expect(
        service.recheckProductionBatch('700', { remainingFailedQty: 4 }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.productionBatch.update).not.toHaveBeenCalled();
    });

    it('ném ConflictException nếu chưa được báo "Bù đủ" (phoiReportedAt null)', async () => {
      await expect(
        service.recheckProductionBatch('700', { remainingFailedQty: 0 }),
      ).rejects.toThrow(ConflictException);
    });

    it('ném NotFoundException nếu lô chưa có KCS chấm nào', async () => {
      prisma.qcReview.findFirst.mockResolvedValue(null);

      await expect(
        service.recheckProductionBatch('700', { remainingFailedQty: 0 }),
      ).rejects.toThrow(NotFoundException);
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

    it('có failedQty - vẫn chuyển QC_PASSED, KHÔNG tạo ReplenishRequest (mirror Phôi/Sắt - không có khái niệm phế)', async () => {
      await service.reviewPieceStep('800', { failedQty: 5 }, 'user-kcs');

      expect(prisma.pieceStepBundle.update).toHaveBeenCalledWith({
        where: { id: 800n },
        data: { status: 'QC_PASSED' },
      });
      expect(prisma.replenishRequest.create).not.toHaveBeenCalled();
    });

    it('scrapQty trong dto (nếu có gửi) bị BỎ QUA hoàn toàn - không validate, không tạo ReplenishRequest', async () => {
      await expect(
        service.reviewPieceStep('800', { failedQty: 2, scrapQty: 999 }, 'user-kcs'),
      ).resolves.toBeDefined();
      expect(prisma.replenishRequest.create).not.toHaveBeenCalled();
      const createCall = prisma.qcReview.create.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      expect(createCall[0].data).not.toHaveProperty('scrapQty');
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

  // 2026-09-07: "Bù đủ" cho đợt công đoạn (PieceStepBundle) - CÙNG khuôn reportProductionBatchDone/
  // recheckProductionBatch NHƯNG recheck KHÔNG cộng vào đâu cả (khác productionBatchId phải cộng
  // ProductionBatch.reportedQty) - resolvedQty tăng CHỈ để tracking, bundle không sinh sản lượng.
  describe('reportPieceStepDone / recheckPieceStep', () => {
    const reworkReview = {
      ...bundleQcReview,
      failedQty: 5,
      scrapQty: 2,
      resolvedQty: 0,
      phoiReportedAt: null as Date | null,
      phoiReportedQty: null as number | null,
    };

    beforeEach(() => {
      prisma.qcReview.findFirst.mockResolvedValue(reworkReview);
      prisma.qcReview.findUniqueOrThrow.mockResolvedValue(reworkReview);
    });

    it('báo bù đủ thành công (reworkable = 5-2 = 3, outstanding = 3)', async () => {
      await service.reportPieceStepDone('800', { qty: 3 });

      expect(prisma.qcReview.update).toHaveBeenCalledWith({
        where: { id: 502n },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
        data: { phoiReportedAt: expect.any(Date), phoiReportedQty: 3 },
      });
    });

    it('ném BadRequestException nếu qty vượt outstanding (3)', async () => {
      await expect(service.reportPieceStepDone('800', { qty: 4 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('ném ConflictException nếu đợt đã hết lỗi (outstanding = 0)', async () => {
      prisma.qcReview.findFirst.mockResolvedValue({ ...reworkReview, resolvedQty: 3 });

      await expect(service.reportPieceStepDone('800', { qty: 1 })).rejects.toThrow(
        ConflictException,
      );
    });

    it('ném NotFoundException nếu đợt chưa có KCS chấm nào', async () => {
      prisma.qcReview.findFirst.mockResolvedValue(null);

      await expect(service.reportPieceStepDone('800', { qty: 1 })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('duyệt lại đạt hết (remainingFailedQty=0) - CHỈ cộng resolvedQty, KHÔNG đụng PieceStepBundle/ProductionBatch', async () => {
      prisma.qcReview.findFirst.mockResolvedValue({
        ...reworkReview,
        phoiReportedAt: new Date(),
        phoiReportedQty: 3,
      });

      await service.recheckPieceStep('800', { remainingFailedQty: 0 });

      expect(prisma.qcReview.update).toHaveBeenCalledWith({
        where: { id: 502n },
        data: { resolvedQty: 3, phoiReportedAt: expect.any(Date) as unknown, phoiReportedQty: 3 },
      });
      expect(prisma.pieceStepBundle.update).not.toHaveBeenCalled();
      expect(prisma.productionBatch.update).not.toHaveBeenCalled();
    });

    it('duyệt lại còn hỏng (remainingFailedQty=1) - cộng phần đạt, phoiReportedAt/Qty reset null', async () => {
      prisma.qcReview.findFirst.mockResolvedValue({
        ...reworkReview,
        phoiReportedAt: new Date(),
        phoiReportedQty: 3,
      });

      await service.recheckPieceStep('800', { remainingFailedQty: 1 });

      expect(prisma.qcReview.update).toHaveBeenCalledWith({
        where: { id: 502n },
        data: { resolvedQty: 2, phoiReportedAt: null, phoiReportedQty: null },
      });
    });

    it('ném BadRequestException nếu remainingFailedQty vượt outstanding', async () => {
      prisma.qcReview.findFirst.mockResolvedValue({
        ...reworkReview,
        phoiReportedAt: new Date(),
        phoiReportedQty: 3,
      });

      await expect(service.recheckPieceStep('800', { remainingFailedQty: 4 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('ném ConflictException nếu chưa được báo "Bù đủ" (phoiReportedAt null)', async () => {
      await expect(service.recheckPieceStep('800', { remainingFailedQty: 0 })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('fulfillReplenishRequest', () => {
    const openRequest = {
      id: 900n,
      qcReviewId: 500n,
      status: ReplenishRequestStatus.OPEN,
      qty: 2,
      fulfilledByIssueId: null,
      fulfilledAt: null,
      fulfilledById: null,
      rejectionReason: null,
      qcReview: {
        steelIssueId: 100n,
        steelIssue: { materialId: 30n, productionInvoiceId: 7n },
      },
    };
    const newIssue = { id: 300n, materialId: 30n, productionInvoiceId: 7n };

    it('cấp bù thành công - OPEN -> FULFILLED', async () => {
      prisma.replenishRequest.findUnique.mockResolvedValue(openRequest);
      prisma.steelIssue.findUnique.mockResolvedValue(newIssue);
      prisma.replenishRequest.update.mockResolvedValue({
        ...openRequest,
        status: ReplenishRequestStatus.FULFILLED,
        fulfilledByIssueId: 300n,
        qcReview: openRequest.qcReview,
      });

      const result = await service.fulfillReplenishRequest(
        '900',
        { steelIssueId: '300' },
        'user-kho',
      );

      expect(prisma.replenishRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({
            status: ReplenishRequestStatus.FULFILLED,
            fulfilledByIssueId: 300n,
            fulfilledById: 'user-kho',
          }),
        }),
      );
      expect(result.status).toBe(ReplenishRequestStatus.FULFILLED);
    });

    it('ném BadRequestException nếu request sinh từ nhánh Hàn/Sơn (BLOCKED, chưa có quyết định nghiệp vụ)', async () => {
      prisma.replenishRequest.findUnique.mockResolvedValue({
        ...openRequest,
        qcReview: { steelIssueId: null, steelIssue: null },
      });

      await expect(
        service.fulfillReplenishRequest('900', { steelIssueId: '300' }, 'user-kho'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.replenishRequest.update).not.toHaveBeenCalled();
    });

    it('ném ConflictException nếu request không còn OPEN', async () => {
      prisma.replenishRequest.findUnique.mockResolvedValue({
        ...openRequest,
        status: ReplenishRequestStatus.FULFILLED,
      });

      await expect(
        service.fulfillReplenishRequest('900', { steelIssueId: '300' }, 'user-kho'),
      ).rejects.toThrow(ConflictException);
    });

    it('ném NotFoundException nếu steelIssueId cấp bù không tồn tại', async () => {
      prisma.replenishRequest.findUnique.mockResolvedValue(openRequest);
      prisma.steelIssue.findUnique.mockResolvedValue(null);

      await expect(
        service.fulfillReplenishRequest('900', { steelIssueId: '999' }, 'user-kho'),
      ).rejects.toThrow(NotFoundException);
    });

    it('ném BadRequestException nếu đợt cấp bù khác loại sắt với đợt gốc', async () => {
      prisma.replenishRequest.findUnique.mockResolvedValue(openRequest);
      prisma.steelIssue.findUnique.mockResolvedValue({ id: 300n, materialId: 999n });

      await expect(
        service.fulfillReplenishRequest('900', { steelIssueId: '300' }, 'user-kho'),
      ).rejects.toThrow(BadRequestException);
    });

    // Medium fix: trước đây điều kiện chặn chỉ so materialId, không so PI - cấp bù của PI-A có
    // thể bị gắn nhầm vào 1 SteelIssue đã xuất trước đó cho PI-B (cùng loại sắt, khác PI), làm kế
    // hoạch xuất sắt của cả 2 PI lệch khỏi thực tế vật lý.
    it('ném BadRequestException nếu đợt cấp bù cùng loại sắt nhưng KHÁC PI với đợt gốc', async () => {
      prisma.replenishRequest.findUnique.mockResolvedValue(openRequest);
      prisma.steelIssue.findUnique.mockResolvedValue({
        id: 300n,
        materialId: 30n,
        productionInvoiceId: 8n, // khác PI 7n của đợt gốc
      });

      await expect(
        service.fulfillReplenishRequest('900', { steelIssueId: '300' }, 'user-kho'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.replenishRequest.update).not.toHaveBeenCalled();
    });

    it('cho phép cấp bù khi cùng PI (không chặn nhầm luồng hợp lệ)', async () => {
      prisma.replenishRequest.findUnique.mockResolvedValue(openRequest);
      prisma.steelIssue.findUnique.mockResolvedValue(newIssue); // cùng productionInvoiceId 7n
      prisma.replenishRequest.update.mockResolvedValue({
        ...openRequest,
        status: ReplenishRequestStatus.FULFILLED,
        fulfilledByIssueId: 300n,
        qcReview: openRequest.qcReview,
      });

      const result = await service.fulfillReplenishRequest(
        '900',
        { steelIssueId: '300' },
        'user-kho',
      );

      expect(result.status).toBe(ReplenishRequestStatus.FULFILLED);
    });
  });

  describe('rejectReplenishRequest', () => {
    it('từ chối thành công - OPEN -> REJECTED', async () => {
      prisma.replenishRequest.findUnique.mockResolvedValue({
        id: 900n,
        status: ReplenishRequestStatus.OPEN,
        qcReview: { steelIssue: null },
      });
      prisma.replenishRequest.update.mockResolvedValue({
        id: 900n,
        qcReviewId: 500n,
        status: ReplenishRequestStatus.REJECTED,
        qty: 2,
        fulfilledByIssueId: null,
        fulfilledAt: null,
        fulfilledById: null,
        rejectionReason: 'hết hàng',
      });

      const result = await service.rejectReplenishRequest('900', { reason: 'hết hàng' });

      expect(result.status).toBe(ReplenishRequestStatus.REJECTED);
      expect(result.rejectionReason).toBe('hết hàng');
    });

    it('ném ConflictException nếu request không còn OPEN', async () => {
      prisma.replenishRequest.findUnique.mockResolvedValue({
        id: 900n,
        status: ReplenishRequestStatus.FULFILLED,
        qcReview: { steelIssue: null },
      });

      await expect(service.rejectReplenishRequest('900', {})).rejects.toThrow(ConflictException);
    });
  });
});
