import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { ProductionBatchStatus, SteelIssueStatus } from '../../generated/prisma/client';
import { ProductionBatchesService } from '../production-batches/production-batches.service';
import { SteelIssuesService } from '../steel-issues/steel-issues.service';
import { CloudinaryService } from '../uploads/cloudinary.service';
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
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
    };
    qcReviewSegment: { update: jest.Mock };
    segmentSpec: { findMany: jest.Mock };
    cutPatternSegment: { groupBy: jest.Mock };
    stepBatchSegment: { groupBy: jest.Mock };
    steelIssue: { update: jest.Mock; updateMany: jest.Mock; findUnique: jest.Mock };
    cutBundle: { findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
    stepBundle: { findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
    productionBatch: { update: jest.Mock; updateMany: jest.Mock };
    pieceStepBundle: { update: jest.Mock; updateMany: jest.Mock };
    productionOrder: { findFirst: jest.Mock; findUniqueOrThrow: jest.Mock };
    productionInvoiceItem: { findUniqueOrThrow: jest.Mock };
    $transaction: jest.Mock;
  };
  let steelIssuesService: {
    findOneRowOrThrow: jest.Mock;
    syncIssueStatusFromBundles: jest.Mock;
  };
  let productionBatchesService: {
    findOneRowOrThrow: jest.Mock;
    findOnePieceStepBundleRowOrThrow: jest.Mock;
    autoFinalizePieceOutputIfLastStepComplete: jest.Mock;
  };
  let cloudinaryService: { deleteByUrl: jest.Mock };

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
    productionOrder: { bomRevisionId: 5n },
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
        findUnique: jest.fn(),
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
      // updateMany mặc định count:1 (Nghiêm trọng #5, đính chính audit độc lập 09/09 - updateMany+
      // count guard chống 2 request duyệt KCS trùng cho cùng đợt) - test race-guard tự override
      // count:0 để mô phỏng đợt đã bị 1 request khác xử lý trước, cùng idiom
      // ProductionInvoicesService.approveItem().
      steelIssue: {
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn(),
      },
      cutBundle: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      stepBundle: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      productionBatch: { update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      pieceStepBundle: {
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
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
      syncIssueStatusFromBundles: jest.fn(),
    };
    productionBatchesService = {
      findOneRowOrThrow: jest.fn().mockResolvedValue(awaitingBatch),
      findOnePieceStepBundleRowOrThrow: jest.fn().mockResolvedValue(awaitingBundle),
      autoFinalizePieceOutputIfLastStepComplete: jest.fn().mockResolvedValue(undefined),
    };
    cloudinaryService = { deleteByUrl: jest.fn().mockResolvedValue(undefined) };
    service = new QcReviewsService(
      prisma as unknown as PrismaServiceType,
      steelIssuesService as unknown as SteelIssuesService,
      productionBatchesService as unknown as ProductionBatchesService,
      cloudinaryService as unknown as CloudinaryService,
    );
  });

  describe('review', () => {
    it('duyệt ĐẠT hoàn toàn (segments=[]) - đóng QC_PASSED, failedQty tổng = 0', async () => {
      const result = await service.review('100', { segments: [] }, 'user-kcs');

      // Nghiêm trọng #5 (đính chính audit độc lập 09/09): update() vô điều kiện đổi sang
      // updateMany() lọc kèm status AWAITING_QC + so count (chống 2 request duyệt trùng).
      expect(prisma.steelIssue.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 100n, status: SteelIssueStatus.AWAITING_QC },
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

    // Nghiêm trọng #5 (đính chính audit độc lập 09/09): trước đây update() vô điều kiện - 2 request
    // duyệt gần đồng thời (double-click, mạng chập chờn tự gửi lại) cho cùng đợt đều pass check
    // status (snapshot đọc NGOÀI transaction), đều tạo QcReview trùng.
    it('CHẶN (409, rollback) khi đợt đã bị 1 request khác duyệt trong lúc đang xử lý', async () => {
      prisma.steelIssue.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.review('100', { segments: [] }, 'user-kcs')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.qcReview.create).not.toHaveBeenCalled();
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

      expect(prisma.cutBundle.updateMany).toHaveBeenCalledWith({
        where: { id: 1n, status: 'AWAITING_QC' },
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

    // Nghiêm trọng #5 (đính chính audit độc lập 09/09) - cùng lý do/cùng fix mục 'review' ở trên.
    it('CHẶN (409, rollback) khi đợt cắt đã bị 1 request khác duyệt trong lúc đang xử lý', async () => {
      prisma.cutBundle.updateMany.mockResolvedValue({ count: 0 });

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

      expect(prisma.stepBundle.updateMany).toHaveBeenCalledWith({
        where: { id: 800n, status: 'AWAITING_QC' },
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

    // Nghiêm trọng #5 (đính chính audit độc lập 09/09) - cùng lý do/cùng fix mục 'review' ở trên.
    it('CHẶN (409, rollback) khi đợt gửi KCS đã bị 1 request khác duyệt trong lúc đang xử lý', async () => {
      prisma.stepBundle.updateMany.mockResolvedValue({ count: 0 });

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

      expect(prisma.productionBatch.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 700n, status: ProductionBatchStatus.AWAITING_QC },
          data: { status: ProductionBatchStatus.QC_DONE, reportedQty: 20 },
        }),
      );
      expect(result.id).toBe('501');
    });

    it('có failedQty - reportedQty ghi đè = phần ĐẠT, KHÔNG tạo lô rework mới (2026-09-08: bỏ hẳn phân loại Sửa được/Phế, mirror reviewPieceStep)', async () => {
      await service.reviewProductionBatch('700', { failedQty: 5 }, 'user-kcs');

      // passed = 20 - 5 = 15
      expect(prisma.productionBatch.updateMany).toHaveBeenCalledWith(
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
      expect(prisma.productionBatch.updateMany).not.toHaveBeenCalled();
    });

    it('cho phép duyệt khi PI có ÍT NHẤT 1 SKU ACTIVE, kể cả khi KHÔNG PHẢI chính order của batch', async () => {
      prisma.productionOrder.findFirst.mockResolvedValue({ id: 999n });

      await expect(
        service.reviewProductionBatch('700', { failedQty: 0 }, 'user-kcs'),
      ).resolves.toBeDefined();
    });

    // Nghiêm trọng #5 (đính chính audit độc lập 09/09): đặc biệt quan trọng ở đây vì reportedQty bị
    // GHI ĐÈ (không cộng dồn) - 2 request duyệt trùng không chặn sẽ làm sản lượng đã chốt SAI LỆCH
    // THẬT, không chỉ lost-update audit trail.
    it('CHẶN (409, rollback) khi batch đã bị 1 request khác duyệt trong lúc đang xử lý - không ghi đè sai reportedQty', async () => {
      prisma.productionBatch.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.reviewProductionBatch('700', { failedQty: 5 }, 'user-kcs'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.qcReview.create).not.toHaveBeenCalled();
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

      expect(prisma.pieceStepBundle.updateMany).toHaveBeenCalledWith({
        where: { id: 800n, status: 'AWAITING_QC' },
        data: { status: 'QC_PASSED' },
      });
      expect(prisma.productionBatch.update).not.toHaveBeenCalled();
      expect(result.id).toBe('502');
    });

    it('2026-09-08: gọi autoFinalizePieceOutputIfLastStepComplete() trong CÙNG transaction, đúng tham số từ bundle', async () => {
      await service.reviewPieceStep('800', { failedQty: 0 }, 'user-kcs');

      expect(
        productionBatchesService.autoFinalizePieceOutputIfLastStepComplete,
      ).toHaveBeenCalledWith(prisma, 5n, 1n, 40n, 'CAT', 'user-kcs');
    });

    it('có failedQty - vẫn chuyển QC_PASSED (mirror Phôi/Sắt - không có khái niệm phế)', async () => {
      await service.reviewPieceStep('800', { failedQty: 5 }, 'user-kcs');

      expect(prisma.pieceStepBundle.updateMany).toHaveBeenCalledWith({
        where: { id: 800n, status: 'AWAITING_QC' },
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
      expect(prisma.pieceStepBundle.updateMany).not.toHaveBeenCalled();
    });

    // Nghiêm trọng #5 (đính chính audit độc lập 09/09): trước đây update() vô điều kiện - 2 request
    // duyệt gần đồng thời cho cùng bundle đều pass check status (snapshot đọc NGOÀI transaction),
    // đều tạo QcReview -> autoFinalizePieceOutputIfLastStepComplete() cộng TRÙNG failedQty vào sản
    // lượng đã chốt. updateMany+count guard chặn request thua ngay khi vào transaction.
    it('CHẶN (409, rollback) nếu bundle đã bị 1 request khác duyệt trong lúc đang xử lý - không cộng trùng failedQty vào sản lượng', async () => {
      prisma.pieceStepBundle.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.reviewPieceStep('800', { failedQty: 5 }, 'user-kcs')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.qcReview.create).not.toHaveBeenCalled();
      expect(
        productionBatchesService.autoFinalizePieceOutputIfLastStepComplete,
      ).not.toHaveBeenCalled();
    });
  });

  // Sửa/xóa CHỈ photoUrl - mở cho CHÍNH người đã chấm review (reviewedById) HOẶC Admin, xem doc
  // comment updatePhoto()/UpdateQcReviewPhotoDto (2026-09-11 lần 2, theo Sếp: "cho người nhập được
  // sửa luôn"). actorUserId/actorRoles giờ là tham số bắt buộc.
  describe('updatePhoto', () => {
    it('người ĐÃ CHẤM review này tự sửa được ảnh, xóa ảnh cũ trên Cloudinary khi bị thay bằng ảnh khác', async () => {
      prisma.qcReview.findUnique.mockResolvedValue({
        id: 1n,
        photoUrl: 'https://old.jpg',
        reviewedById: 'user-kcs',
      });
      prisma.qcReview.update.mockResolvedValue({
        ...qcReview,
        photoUrl: 'https://new.jpg',
      });

      const result = await service.updatePhoto('1', { photoUrl: 'https://new.jpg' }, 'user-kcs', [
        'KCS_STAFF',
      ]);

      expect(prisma.qcReview.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1n },
          data: { photoUrl: 'https://new.jpg' },
        }),
      );
      expect(cloudinaryService.deleteByUrl).toHaveBeenCalledWith('https://old.jpg');
      expect(result.photoUrl).toBe('https://new.jpg');
    });

    it('ADMIN sửa được ảnh của review do NGƯỜI KHÁC chấm', async () => {
      prisma.qcReview.findUnique.mockResolvedValue({
        id: 1n,
        photoUrl: 'https://old.jpg',
        reviewedById: 'user-kcs',
      });
      prisma.qcReview.update.mockResolvedValue({ ...qcReview, photoUrl: 'https://new.jpg' });

      await service.updatePhoto('1', { photoUrl: 'https://new.jpg' }, 'user-admin', ['ADMIN']);

      expect(prisma.qcReview.update).toHaveBeenCalled();
    });

    it('ném ForbiddenException nếu KHÔNG phải người đã chấm review này và KHÔNG phải Admin', async () => {
      prisma.qcReview.findUnique.mockResolvedValue({
        id: 1n,
        photoUrl: 'https://old.jpg',
        reviewedById: 'user-kcs',
      });

      await expect(
        service.updatePhoto('1', { photoUrl: 'https://new.jpg' }, 'user-kcs-khac', ['KCS_STAFF']),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.qcReview.update).not.toHaveBeenCalled();
    });

    it('xóa hẳn photoUrl (null) và vẫn dọn ảnh cũ trên Cloudinary', async () => {
      prisma.qcReview.findUnique.mockResolvedValue({
        id: 1n,
        photoUrl: 'https://old.jpg',
        reviewedById: 'user-kcs',
      });
      prisma.qcReview.update.mockResolvedValue({ ...qcReview, photoUrl: null });

      await service.updatePhoto('1', { photoUrl: null }, 'user-kcs', ['KCS_STAFF']);

      expect(prisma.qcReview.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1n },
          data: { photoUrl: null },
        }),
      );
      expect(cloudinaryService.deleteByUrl).toHaveBeenCalledWith('https://old.jpg');
    });

    it('KHÔNG gọi Cloudinary nếu chưa từng có ảnh cũ', async () => {
      prisma.qcReview.findUnique.mockResolvedValue({
        id: 1n,
        photoUrl: null,
        reviewedById: 'user-kcs',
      });
      prisma.qcReview.update.mockResolvedValue({ ...qcReview, photoUrl: 'https://new.jpg' });

      await service.updatePhoto('1', { photoUrl: 'https://new.jpg' }, 'user-kcs', ['KCS_STAFF']);

      expect(cloudinaryService.deleteByUrl).not.toHaveBeenCalled();
    });

    it('ném NotFoundException nếu review không tồn tại', async () => {
      prisma.qcReview.findUnique.mockResolvedValue(null);

      await expect(
        service.updatePhoto('999', { photoUrl: null }, 'user-admin', ['ADMIN']),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.qcReview.update).not.toHaveBeenCalled();
    });
  });
});
