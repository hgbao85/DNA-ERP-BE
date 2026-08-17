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

describe('QcReviewsService', () => {
  let service: QcReviewsService;
  let prisma: {
    qcReview: { create: jest.Mock; findMany: jest.Mock; count: jest.Mock };
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
  };

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
  };

  beforeEach(() => {
    prisma = {
      qcReview: {
        create: jest.fn().mockResolvedValue(qcReview),
        findMany: jest.fn(),
        count: jest.fn(),
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
    it('duyệt ĐẠT hoàn toàn (failedQty=0) - đóng QC_PASSED, không rework/replenish', async () => {
      const result = await service.review('100', { failedQty: 0 }, 'user-kcs');

      expect(prisma.steelIssue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 100n },
          data: { status: SteelIssueStatus.QC_PASSED },
        }),
      );
      expect(prisma.replenishRequest.create).not.toHaveBeenCalled();
      expect(steelIssuesService.createReworkIssue).not.toHaveBeenCalled();
      expect(result.id).toBe('500');
    });

    it('có phần sửa được (failedQty > scrapQty) - sinh đợt rework sau khi transaction commit', async () => {
      await service.review('100', { failedQty: 5, scrapQty: 2 }, 'user-kcs');

      expect(prisma.replenishRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { qcReviewId: 500n, qty: 2 } }),
      );
      expect(steelIssuesService.createReworkIssue).toHaveBeenCalledWith(awaitingIssue, 3);
    });

    it('toàn bộ phế (failedQty = scrapQty) - chỉ sinh replenish, không rework', async () => {
      await service.review('100', { failedQty: 4, scrapQty: 4 }, 'user-kcs');

      expect(prisma.replenishRequest.create).toHaveBeenCalled();
      expect(steelIssuesService.createReworkIssue).not.toHaveBeenCalled();
    });

    it('ném ConflictException nếu đợt không ở AWAITING_QC', async () => {
      steelIssuesService.findOneRowOrThrow.mockResolvedValue({
        ...awaitingIssue,
        status: SteelIssueStatus.RECEIVED,
      });

      await expect(service.review('100', { failedQty: 0 }, 'user-kcs')).rejects.toThrow(
        ConflictException,
      );
    });

    it('ném BadRequestException nếu failedQty vượt số cây đã báo cắt', async () => {
      await expect(service.review('100', { failedQty: 999 }, 'user-kcs')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('ném BadRequestException nếu scrapQty vượt failedQty', async () => {
      await expect(
        service.review('100', { failedQty: 2, scrapQty: 3 }, 'user-kcs'),
      ).rejects.toThrow(BadRequestException);
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
      qcReview: { steelIssueId: 100n, steelIssue: { pieceId: 20n, materialId: 30n } },
    };
    const newIssue = { id: 300n, pieceId: 20n, materialId: 30n };

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

    it('ném BadRequestException nếu đợt cấp bù khác mảnh/loại sắt với đợt gốc', async () => {
      prisma.replenishRequest.findUnique.mockResolvedValue(openRequest);
      prisma.steelIssue.findUnique.mockResolvedValue({ id: 300n, pieceId: 999n, materialId: 30n });

      await expect(
        service.fulfillReplenishRequest('900', { steelIssueId: '300' }, 'user-kho'),
      ).rejects.toThrow(BadRequestException);
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
