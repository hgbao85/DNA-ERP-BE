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
    };
    qcReviewSegment: { update: jest.Mock };
    segmentSpec: { findMany: jest.Mock };
    cutPatternSegment: { groupBy: jest.Mock };
    steelIssue: { update: jest.Mock; findUnique: jest.Mock };
    productionBatch: { update: jest.Mock };
    replenishRequest: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let steelIssuesService: { findOneRowOrThrow: jest.Mock; createReworkIssue: jest.Mock };
  let productionBatchesService: { findOneRowOrThrow: jest.Mock };

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
    segments: [] as { id: bigint; segmentSpecId: bigint; failedQty: number; segmentSpec: { cutLengthMm: ReturnType<typeof decimal> } }[],
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
    segments: [] as { id: bigint; segmentSpecId: bigint; failedQty: number; segmentSpec: { cutLengthMm: ReturnType<typeof decimal> } }[],
  };

  beforeEach(() => {
    prisma = {
      qcReview: {
        create: jest.fn().mockResolvedValue(qcReview),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      qcReviewSegment: { update: jest.fn() },
      segmentSpec: { findMany: jest.fn().mockResolvedValue([segmentSpecRow]) },
      cutPatternSegment: {
        groupBy: jest.fn().mockResolvedValue([{ segmentSpecId: 30n, _sum: { qty: 8 } }]),
      },
      steelIssue: { update: jest.fn(), findUnique: jest.fn() },
      productionBatch: { update: jest.fn() },
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
    };
    productionBatchesService = {
      findOneRowOrThrow: jest.fn().mockResolvedValue(awaitingBatch),
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
      await service.review('100', { segments: [{ segmentSpecId: '30', failedQty: 3 }] }, 'user-kcs');

      expect(prisma.qcReview.create).toHaveBeenCalledWith(
        expect.objectContaining({
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

    it('báo bù đủ thành công - set phoiReportedAt (outstanding = 5 - 2 = 3 > 0)', async () => {
      await service.reportSegmentDone('100', '30');

      expect(prisma.qcReviewSegment.update).toHaveBeenCalledWith({
        where: { id: 900n },
        data: { phoiReportedAt: expect.any(Date) as unknown as Date },
      });
    });

    it('ném ConflictException nếu cỡ đoạn đã hết lỗi (outstanding = 0)', async () => {
      prisma.qcReview.findFirst.mockResolvedValue({
        ...reviewWithFailedSegment,
        segments: [{ ...reviewWithFailedSegment.segments[0], resolvedQty: 5 }],
      });

      await expect(service.reportSegmentDone('100', '30')).rejects.toThrow(ConflictException);
      expect(prisma.qcReviewSegment.update).not.toHaveBeenCalled();
    });

    it('ném ConflictException nếu đã báo bù đủ rồi - đang chờ KCS duyệt lại', async () => {
      prisma.qcReview.findFirst.mockResolvedValue({
        ...reviewWithFailedSegment,
        segments: [{ ...reviewWithFailedSegment.segments[0], phoiReportedAt: new Date() }],
      });

      await expect(service.reportSegmentDone('100', '30')).rejects.toThrow(ConflictException);
      expect(prisma.qcReviewSegment.update).not.toHaveBeenCalled();
    });

    it('ném NotFoundException nếu đợt sắt chưa có KCS chấm nào', async () => {
      prisma.qcReview.findFirst.mockResolvedValue(null);

      await expect(service.reportSegmentDone('100', '30')).rejects.toThrow(NotFoundException);
    });

    it('ném NotFoundException nếu cỡ đoạn đó không có lỗi trong lần chấm', async () => {
      await expect(service.reportSegmentDone('100', '999')).rejects.toThrow(NotFoundException);
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
          segmentSpec: { cutLengthMm: decimal(745) },
        },
      ],
    };

    beforeEach(() => {
      prisma.qcReview.findFirst.mockResolvedValue(reviewAwaitingRecheck);
      prisma.qcReview.findUniqueOrThrow.mockResolvedValue(reviewAwaitingRecheck);
    });

    it('duyệt lại đạt hết (remainingFailedQty=0) - resolvedQty = failedQty, phoiReportedAt giữ nguyên', async () => {
      await service.recheck('100', { segments: [{ segmentSpecId: '30', remainingFailedQty: 0 }] });

      // outstanding = 5 - 2 = 3; resolvedQty = 2 + (3 - 0) = 5
      expect(prisma.qcReviewSegment.update).toHaveBeenCalledWith({
        where: { id: 900n },
        data: { resolvedQty: 5, phoiReportedAt: reviewAwaitingRecheck.segments[0].phoiReportedAt },
      });
    });

    it('duyệt lại còn hỏng (remainingFailedQty=1) - cộng phần đạt, phoiReportedAt reset về null', async () => {
      await service.recheck('100', { segments: [{ segmentSpecId: '30', remainingFailedQty: 1 }] });

      // resolvedQty = 2 + (3 - 1) = 4
      expect(prisma.qcReviewSegment.update).toHaveBeenCalledWith({
        where: { id: 900n },
        data: { resolvedQty: 4, phoiReportedAt: null },
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
