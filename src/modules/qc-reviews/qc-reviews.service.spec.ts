import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { ProductionBatchStatus, SteelIssueStatus } from '../../generated/prisma/client';
import { MaterialYieldRecipeProductionService } from '../material-yield-recipes/material-yield-recipe-production.service';
import { ProductionBatchesService } from '../production-batches/production-batches.service';
import { SegmentProductionService } from '../segment-stock/segment-production.service';
import { SteelIssuesService } from '../steel-issues/steel-issues.service';
import { CloudinaryService } from '../uploads/cloudinary.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaintTransferReminderService } from '../warehouse-transfers/paint-transfer-reminder.service';
import { queueWorkshopIdOfPi } from '../floor/floor-queue-workshop.util';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateSteelIssueQcReviewDto } from './dto/create-steel-issue-qc-review.dto';
import { QcReviewsService } from './qc-reviews.service';

jest.mock('../floor/floor-queue-workshop.util', () => ({ queueWorkshopIdOfPi: jest.fn() }));
import { RealtimeService } from '../../realtime/realtime.service';

const decimal = (n: number) => ({ toNumber: () => n, toString: () => String(n) });

describe('QcReviewsService', () => {
  let service: QcReviewsService;
  let realtimeStub: { publishEntityChanged: jest.Mock; publishNotificationCreated: jest.Mock };
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
    defectReason: { findUnique: jest.Mock };
    segmentSpec: { findMany: jest.Mock };
    cutPatternSegment: { groupBy: jest.Mock };
    stepBatchSegment: { groupBy: jest.Mock };
    steelIssue: { update: jest.Mock; updateMany: jest.Mock; findUnique: jest.Mock };
    cutBundle: {
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
    };
    stepBundle: { findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
    productionBatch: { update: jest.Mock; updateMany: jest.Mock };
    pieceStepBundle: { update: jest.Mock; updateMany: jest.Mock };
    materialYieldStepBundle: { updateMany: jest.Mock };
    productionOrder: { findFirst: jest.Mock; findUniqueOrThrow: jest.Mock; findUnique: jest.Mock };
    productionInvoiceItem: { findUniqueOrThrow: jest.Mock };
    productionInvoice: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let paintReminder: { refreshForOrder: jest.Mock };
  let steelIssuesService: {
    findOneRowOrThrow: jest.Mock;
    syncIssueStatusFromBundles: jest.Mock;
    stepOveruseAfterCutShortage: jest.Mock;
  };
  let productionBatchesService: {
    findOneRowOrThrow: jest.Mock;
    findOnePieceStepBundleRowOrThrow: jest.Mock;
    autoFinalizePieceOutputIfLastStepComplete: jest.Mock;
    postPieceOutputIfFinal: jest.Mock;
    lockBatchKeysInTx: jest.Mock;
    consumeSegmentsAtReviewInTx: jest.Mock;
    afterReviewCommitted: jest.Mock;
  };
  let materialYieldRecipeProductionService: {
    findOneBundleRowOrThrow: jest.Mock;
    finalizeRecipeOutputIfLastStepComplete: jest.Mock;
  };
  let cloudinaryService: { deleteByUrl: jest.Mock };
  let notificationsService: { emit: jest.Mock; resolve: jest.Mock };
  let segmentProductionService: { recomputeAfterQc: jest.Mock };

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
    productionOrder: {
      productionInvoiceItem: { productionInvoice: { code: 'PI-2026-700' } },
    },
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
    productionOrder: {
      bomRevisionId: 5n,
      productionInvoiceItem: { productionInvoice: { code: 'PI-2026-800' } },
    },
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
      // Mặc định lý do lỗi tồn tại; test T4-9 override null.
      defectReason: { findUnique: jest.fn().mockResolvedValue({ id: 9n }) },
      segmentSpec: { findMany: jest.fn().mockResolvedValue([segmentSpecRow]) },
      cutPatternSegment: {
        groupBy: jest.fn().mockResolvedValue([{ segmentSpecId: 30n, _sum: { qty: 8 } }]),
      },
      stepBatchSegment: {
        groupBy: jest.fn().mockResolvedValue([{ segmentSpecId: 30n, _sum: { qty: 8 } }]),
      },
      // updateMany mặc định count:1 (Nghiêm trọng #5, đính chính audit độc lập 09/09 - updateMany+
      // count guard chống 2 request duyệt KCS trùng cho cùng đợt) - test race-guard tự override
      // count:0 để mô phỏng đợt đã bị 1 yêu cầu khác xử lý trước, cùng idiom
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
        // Lô cũ chưa chia đợt cắt (route chấm theo lô chỉ còn cho trường hợp này - X2 16/11).
        count: jest.fn().mockResolvedValue(0),
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
      materialYieldStepBundle: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      // floorStage gate (2026-08-31) - mặc định PI luôn có 1 order ACTIVE, đa số test không quan
      // tâm gate assertPiHasActiveFloorForInvoice()/assertPiHasActiveFloorForOrder(), xem mục
      // riêng "QLSX kiểm soát" bên dưới mới override.
      productionOrder: {
        findFirst: jest.fn().mockResolvedValue({ id: 9n }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ productionInvoiceItemId: 20n }),
        findUnique: jest
          .fn()
          .mockResolvedValue({ productionInvoiceItem: { productionInvoiceId: 30n } }),
      },
      productionInvoiceItem: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ productionInvoiceId: 900n }),
      },
      productionInvoice: {
        findUnique: jest.fn().mockResolvedValue({ code: 'PI-2026-900' }),
      },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    steelIssuesService = {
      findOneRowOrThrow: jest.fn().mockResolvedValue(awaitingIssue),
      syncIssueStatusFromBundles: jest.fn(),
      stepOveruseAfterCutShortage: jest.fn().mockResolvedValue([]),
    };
    productionBatchesService = {
      findOneRowOrThrow: jest.fn().mockResolvedValue(awaitingBatch),
      findOnePieceStepBundleRowOrThrow: jest.fn().mockResolvedValue(awaitingBundle),
      autoFinalizePieceOutputIfLastStepComplete: jest.fn().mockResolvedValue(undefined),
      postPieceOutputIfFinal: jest.fn().mockResolvedValue(undefined),
      lockBatchKeysInTx: jest.fn().mockResolvedValue(undefined),
      consumeSegmentsAtReviewInTx: jest.fn().mockResolvedValue(undefined),
      afterReviewCommitted: jest.fn().mockResolvedValue(undefined),
    };
    cloudinaryService = { deleteByUrl: jest.fn().mockResolvedValue(undefined) };
    notificationsService = {
      emit: jest.fn().mockResolvedValue(undefined),
      resolve: jest.fn().mockResolvedValue(undefined),
    };
    materialYieldRecipeProductionService = {
      findOneBundleRowOrThrow: jest.fn(),
      finalizeRecipeOutputIfLastStepComplete: jest.fn().mockResolvedValue(undefined),
    };
    realtimeStub = { publishEntityChanged: jest.fn(), publishNotificationCreated: jest.fn() };
    segmentProductionService = { recomputeAfterQc: jest.fn().mockResolvedValue(undefined) };
    paintReminder = { refreshForOrder: jest.fn().mockResolvedValue(undefined) };
    (queueWorkshopIdOfPi as jest.Mock).mockReset().mockResolvedValue(null);
    service = new QcReviewsService(
      prisma as unknown as PrismaServiceType,
      steelIssuesService as unknown as SteelIssuesService,
      productionBatchesService as unknown as ProductionBatchesService,
      materialYieldRecipeProductionService as unknown as MaterialYieldRecipeProductionService,
      cloudinaryService as unknown as CloudinaryService,
      notificationsService as unknown as NotificationsService,
      realtimeStub as unknown as RealtimeService,
      segmentProductionService as unknown as SegmentProductionService,
      paintReminder as unknown as PaintTransferReminderService,
    );
  });

  describe('review', () => {
    it('X2 16/11: lô đã chia đợt cắt -> 409, không ghi lượt chấm theo lô (tránh đếm lỗi 2 lần)', async () => {
      prisma.cutBundle.count.mockResolvedValue(2);
      await expect(service.review('100', { segments: [] }, 'user-kcs')).rejects.toThrow(
        /chấm KCS theo từng đợt cắt/,
      );
      expect(prisma.steelIssue.updateMany).not.toHaveBeenCalled();
      expect(prisma.qcReview.create).not.toHaveBeenCalled();
      expect(prisma.cutBundle.count).toHaveBeenCalledWith({ where: { steelIssueId: 100n } });
    });

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
            segments: { create: [{ segmentSpecId: 30n, failedQty: 3, shortQty: 0, scrapQty: 0 }] },
          }),
        }),
      );
    });

    it('P1: route lô cũ vẫn bắt mỗi dòng lỗi >= 1 (dòng 0 -> 400), không ghi gì', async () => {
      await expect(
        service.review('100', { segments: [{ segmentSpecId: '30', failedQty: 0 }] }, 'user-kcs'),
      ).rejects.toThrow(/phải từ 1 trở lên/);
      expect(prisma.qcReview.create).not.toHaveBeenCalled();
    });

    it('P1: route lô cũ bỏ qua shortQty / scrapQty client gửi, lưu 0 (không cộng vào lỗi)', async () => {
      await service.review(
        '100',
        { segments: [{ segmentSpecId: '30', failedQty: 2, shortQty: 5, scrapQty: 2 }] },
        'user-kcs',
      );

      expect(prisma.qcReview.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({
            failedQty: 2,
            segments: { create: [{ segmentSpecId: 30n, failedQty: 2, shortQty: 0, scrapQty: 0 }] },
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
    it('CHẶN (409, rollback) khi đợt đã bị 1 yêu cầu khác duyệt trong lúc đang xử lý', async () => {
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
      steelIssue: {
        productionInvoiceId: 900n,
        materialId: 30n,
        material: { code: 'SAT-30', name: 'Sắt phi 10' },
      },
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

    it('phát entity.changed QC_RECORDED SAU khi commit', async () => {
      await service.reviewCutBundle('1', { segments: [] }, 'user-kcs');

      expect(realtimeStub.publishEntityChanged).toHaveBeenCalledWith({
        entity: 'QC_REVIEW',
        entityId: '1',
        action: 'QC_RECORDED',
        actorId: 'user-kcs',
      });
    });

    // Phase 3b, nhóm 7.5-i, changelog 2026-09-25 mục 19.
    it('duyệt ĐẠT - resolve CUT_BUNDLE_TO_KCS + emit QC_PASSED cho QLSX', async () => {
      await service.reviewCutBundle('1', { segments: [] }, 'user-kcs');

      expect(notificationsService.resolve).toHaveBeenCalledWith({
        entityType: 'CUT_BUNDLE',
        entityId: '1',
        types: ['CUT_BUNDLE_TO_KCS'],
      });
      expect(notificationsService.emit).toHaveBeenCalledWith(
        'QC_PASSED',
        expect.objectContaining({ params: { piCode: 'PI-2026-900' } }),
      );
      expect(notificationsService.emit).not.toHaveBeenCalledWith('QC_FAILED', expect.anything());
    });

    it('duyệt có lỗi (failedQty > 0) - emit QC_FAILED cho Phôi + QLSX, KHÔNG emit QC_PASSED', async () => {
      prisma.cutPatternSegment.groupBy.mockResolvedValue([
        { segmentSpecId: 30n, _sum: { qty: 8 } },
      ]);
      prisma.qcReview.create.mockResolvedValue({ ...bundleQcReview, failedQty: 2 });

      await service.reviewCutBundle(
        '1',
        { segments: [{ segmentSpecId: '30', failedQty: 2 }] },
        'user-kcs',
      );

      expect(notificationsService.emit).toHaveBeenCalledWith(
        'QC_FAILED',
        expect.objectContaining({
          params: {
            piCode: 'PI-2026-900',
            failedQty: 2,
            senderRole: 'PHOI_STAFF',
            detail: 'Cắt Sắt phi 10: 2 đoạn 745mm lỗi',
            todo: 'Báo công nhân cắt lại 2 đoạn 745mm rồi quét mã máy cắt báo cắt bù; KCS tự chấm đợt mới.',
          },
        }),
      );
      expect(notificationsService.emit).not.toHaveBeenCalledWith('QC_PASSED', expect.anything());
    });

    // ---- P1 (18/11/2026): thiếu / bỏ / notes
    describe('P1 thiếu và notes', () => {
      type CutCreate = {
        data: {
          failedQty: number;
          shortQty: number;
          segments: { create: Record<string, number | bigint>[] };
        };
      };
      const createdData = (): CutCreate['data'] =>
        (prisma.qcReview.create.mock.calls as CutCreate[][])[0][0].data;

      it('lưu shortQty theo dòng + tổng; failedQty CHỈ là lỗi; scrapQty luôn 0 dù client gửi', async () => {
        await service.reviewCutBundle(
          '1',
          { segments: [{ segmentSpecId: '30', failedQty: 2, shortQty: 3, scrapQty: 2 }] },
          'user-kcs',
        );

        const data = createdData();
        expect(data.failedQty).toBe(2);
        expect(data.shortQty).toBe(3);
        expect(data.segments.create).toEqual([
          { segmentSpecId: 30n, failedQty: 2, shortQty: 3, scrapQty: 0 },
        ]);
      });

      it('lỗi + thiếu > số đoạn của cỡ trong đợt -> 400, kiểm TRONG transaction, không ghi review', async () => {
        // đợt có 8 đoạn: 5 lỗi + 4 thiếu = 9
        await expect(
          service.reviewCutBundle(
            '1',
            { segments: [{ segmentSpecId: '30', failedQty: 5, shortQty: 4 }] },
            'user-kcs',
          ),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.cutPatternSegment.groupBy).toHaveBeenCalled();
        expect(prisma.cutBundle.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
          prisma.cutPatternSegment.groupBy.mock.invocationCallOrder[0],
        );
        expect(prisma.qcReview.create).not.toHaveBeenCalled();
      });

      it('cỡ gửi trùng 2 dòng thì cộng lại rồi mới so với số đoạn của đợt', async () => {
        await expect(
          service.reviewCutBundle(
            '1',
            {
              segments: [
                { segmentSpecId: '30', failedQty: 0, shortQty: 5 },
                { segmentSpecId: '30', failedQty: 0, shortQty: 4 },
              ],
            },
            'user-kcs',
          ),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.qcReview.create).not.toHaveBeenCalled();
      });

      it('dòng 0 lỗi / 0 thiếu -> 400, chưa mở transaction', async () => {
        await expect(
          service.reviewCutBundle(
            '1',
            { segments: [{ segmentSpecId: '30', failedQty: 0, shortQty: 0 }] },
            'user-kcs',
          ),
        ).rejects.toThrow(/ít nhất 1/);
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it('chỉ thiếu (không lỗi) -> QC_PASSED kèm note câu thiếu; không gọi stepOveruse khi không thiếu', async () => {
        await service.reviewCutBundle(
          '1',
          { segments: [{ segmentSpecId: '30', failedQty: 0, shortQty: 3 }] },
          'user-kcs',
        );

        expect(notificationsService.emit).toHaveBeenCalledWith('QC_PASSED', {
          params: {
            piCode: 'PI-2026-900',
            note: 'KCS ghi thiếu 3 đoạn so với số báo (đã trừ, không tính lỗi, không cần làm bù).',
          },
        });
        expect(notificationsService.emit).not.toHaveBeenCalledWith('QC_FAILED', expect.anything());
      });

      it('đạt hết (không thiếu) -> không gọi stepOveruseAfterCutShortage, notes = []', async () => {
        const result = await service.reviewCutBundle('1', { segments: [] }, 'user-kcs');

        expect(steelIssuesService.stepOveruseAfterCutShortage).not.toHaveBeenCalled();
        expect(result.notes).toEqual([]);
      });

      it('có thiếu mà Uốn đã dùng vượt số đoạn cắt thực có -> notes đúng câu, gọi SAU commit, nối vào tin QLSX', async () => {
        let committed = false;
        prisma.$transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => {
          const r = await cb(prisma);
          committed = true;
          return r;
        });
        steelIssuesService.stepOveruseAfterCutShortage.mockImplementation(() => {
          expect(committed).toBe(true);
          return Promise.resolve([{ step: 'UON', cutLengthMm: 745, overBy: 2, cutCap: 6 }]);
        });
        prisma.cutBundle.findUnique.mockResolvedValue({ ...awaitingBundle, productionOrderId: 7n });

        const result = await service.reviewCutBundle(
          '1',
          { segments: [{ segmentSpecId: '30', failedQty: 1, shortQty: 2 }] },
          'user-kcs',
        );

        expect(steelIssuesService.stepOveruseAfterCutShortage).toHaveBeenCalledWith(900n, 30n, 7n, [
          30n,
        ]);
        const note =
          'Uốn cỡ 745mm đã báo nhiều hơn số đoạn cắt thực có (6) 2 đoạn - Uốn sẽ bị chặn tới khi cắt thêm hoặc KCS Uốn ghi thiếu';
        expect(result.notes).toEqual([note]);
        const call = (
          notificationsService.emit.mock.calls as [string, { params: Record<string, string> }][]
        ).find((c) => c[0] === 'QC_FAILED')!;
        expect(call[1].params.detail).toContain(
          'KCS ghi thiếu 2 đoạn so với số báo (đã trừ, không tính lỗi, không cần làm bù).',
        );
        expect(call[1].params.todo).toContain(`${note}.`);
      });

      it('stepOveruseAfterCutShortage ném lỗi -> lượt chấm vẫn trả kết quả, notes = []', async () => {
        steelIssuesService.stepOveruseAfterCutShortage.mockRejectedValue(new Error('db down'));

        const result = await service.reviewCutBundle(
          '1',
          { segments: [{ segmentSpecId: '30', failedQty: 0, shortQty: 1 }] },
          'user-kcs',
        );

        expect(result.id).toBe('500');
        expect(result.notes).toEqual([]);
      });

      it('trả shortQty tổng + segments[].shortQty / scrapQty', async () => {
        prisma.qcReview.create.mockResolvedValue({
          ...bundleQcReview,
          failedQty: 1,
          shortQty: 2,
          segments: [
            {
              id: 1n,
              segmentSpecId: 30n,
              failedQty: 1,
              shortQty: 2,
              scrapQty: 0,
              segmentSpec: { cutLengthMm: decimal(745) },
            },
          ],
        });

        const result = await service.reviewCutBundle(
          '1',
          { segments: [{ segmentSpecId: '30', failedQty: 1, shortQty: 2 }] },
          'user-kcs',
        );

        expect(result.shortQty).toBe(2);
        expect(result.segments[0]).toMatchObject({ failedQty: 1, shortQty: 2, scrapQty: 0 });
      });

      it('chấm trùng: updateMany count 0 -> 409 câu hợp đồng; đợt đã QC_PASSED cũng 409 câu đó', async () => {
        prisma.cutBundle.updateMany.mockResolvedValue({ count: 0 });
        await expect(service.reviewCutBundle('1', { segments: [] }, 'user-kcs')).rejects.toThrow(
          'Đợt này vừa được KCS khác chấm xong - tải lại trang.',
        );

        prisma.cutBundle.findUnique.mockResolvedValue({ ...awaitingBundle, status: 'QC_PASSED' });
        await expect(service.reviewCutBundle('1', { segments: [] }, 'user-kcs')).rejects.toThrow(
          'Đợt này vừa được KCS khác chấm xong - tải lại trang.',
        );
      });
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
      // Chấm vượt -> không ghi kết quả KCS (transaction huỷ cả bước đổi trạng thái).
      expect(prisma.qcReview.create).not.toHaveBeenCalled();
    });

    it('X1 16/11: số đã cắt đọc TRONG transaction, SAU bước giữ dòng đợt (updateMany có điều kiện AWAITING_QC)', async () => {
      prisma.cutPatternSegment.groupBy.mockResolvedValue([
        { segmentSpecId: 30n, _sum: { qty: 8 } },
      ]);

      await service.reviewCutBundle(
        '1',
        { segments: [{ segmentSpecId: '30', failedQty: 2 }] },
        'user-kcs',
      );

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.cutBundle.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.cutPatternSegment.groupBy.mock.invocationCallOrder[0],
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
    it('CHẶN (409, rollback) khi đợt cắt đã bị 1 yêu cầu khác duyệt trong lúc đang xử lý', async () => {
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

    it('phát entity.changed QC_RECORDED SAU khi commit', async () => {
      await service.reviewStepBundle('800', { segments: [] }, 'user-kcs');

      expect(realtimeStub.publishEntityChanged).toHaveBeenCalledWith({
        entity: 'QC_REVIEW',
        entityId: '800',
        action: 'QC_RECORDED',
        actorId: 'user-kcs',
      });
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

    describe('P1 thiếu / bỏ / làm lại', () => {
      type StepCreate = {
        data: { failedQty: number; shortQty: number; segments: { create: unknown[] } };
      };
      const createdData = (): StepCreate['data'] =>
        (prisma.qcReview.create.mock.calls as StepCreate[][])[0][0].data;

      it('có lỗi mà thiếu scrapQty -> 400 "chọn số đoạn lỗi phải bỏ ... tải lại trang", không ghi gì', async () => {
        const run = service.reviewStepBundle(
          '800',
          { segments: [{ segmentSpecId: '30', failedQty: 2 }] },
          'user-kcs',
        );
        await expect(run).rejects.toThrow(BadRequestException);
        await expect(run).rejects.toThrow(/chọn số đoạn lỗi phải bỏ/);
        await expect(run).rejects.toThrow(/tải lại trang/);
        expect(prisma.stepBundle.updateMany).not.toHaveBeenCalled();
        expect(prisma.qcReview.create).not.toHaveBeenCalled();
      });

      it('scrapQty > failedQty -> 400 "số bỏ (3) lớn hơn số lỗi (2)"', async () => {
        await expect(
          service.reviewStepBundle(
            '800',
            { segments: [{ segmentSpecId: '30', failedQty: 2, scrapQty: 3 }] },
            'user-kcs',
          ),
        ).rejects.toThrow('Cỡ 745mm: số bỏ (3) lớn hơn số lỗi (2).');
        expect(prisma.qcReview.create).not.toHaveBeenCalled();
      });

      it('scrapQty = 0 là hợp lệ (chỉ làm lại); lưu short / scrap, tổng shortQty lên qc_reviews', async () => {
        await service.reviewStepBundle(
          '800',
          { segments: [{ segmentSpecId: '30', failedQty: 2, shortQty: 1, scrapQty: 0 }] },
          'user-kcs',
        );

        const data = createdData();
        expect(data.failedQty).toBe(2);
        expect(data.shortQty).toBe(1);
        expect(data.segments.create).toEqual([
          { segmentSpecId: 30n, failedQty: 2, shortQty: 1, scrapQty: 0 },
        ]);
      });

      it('chỉ thiếu (không lỗi) thì không đòi scrapQty, lưu scrapQty 0', async () => {
        await service.reviewStepBundle(
          '800',
          { segments: [{ segmentSpecId: '30', failedQty: 0, shortQty: 2 }] },
          'user-kcs',
        );

        expect(createdData().segments.create).toEqual([
          { segmentSpecId: 30n, failedQty: 0, shortQty: 2, scrapQty: 0 },
        ]);
      });

      it('lỗi + thiếu > số đã báo của cỡ trong đợt -> 400; dòng 0 / 0 -> 400', async () => {
        // đợt có 8 đoạn
        await expect(
          service.reviewStepBundle(
            '800',
            { segments: [{ segmentSpecId: '30', failedQty: 4, shortQty: 5, scrapQty: 1 }] },
            'user-kcs',
          ),
        ).rejects.toThrow(BadRequestException);
        await expect(
          service.reviewStepBundle(
            '800',
            { segments: [{ segmentSpecId: '30', failedQty: 0, shortQty: 0 }] },
            'user-kcs',
          ),
        ).rejects.toThrow(/ít nhất 1/);
        expect(prisma.qcReview.create).not.toHaveBeenCalled();
      });

      it('KHÔNG gọi stepOveruseAfterCutShortage; notes = []', async () => {
        const result = await service.reviewStepBundle(
          '800',
          { segments: [{ segmentSpecId: '30', failedQty: 0, shortQty: 2 }] },
          'user-kcs',
        );

        expect(steelIssuesService.stepOveruseAfterCutShortage).not.toHaveBeenCalled();
        expect(result.notes).toEqual([]);
      });
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
    it('CHẶN (409, rollback) khi đợt gửi KCS đã bị 1 yêu cầu khác duyệt trong lúc đang xử lý', async () => {
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

    it('phát entity.changed kèm parentId=productionOrderId (2026-10-17, FE lọc banner theo đúng PO đang xem)', async () => {
      await service.reviewProductionBatch('700', { failedQty: 0 }, 'user-kcs');

      expect(realtimeStub.publishEntityChanged).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'QC_REVIEW',
          action: 'QC_RECORDED',
          parentId: 1n,
        }),
      );
    });

    // Phase 3b, nhóm 7.5-i, changelog 2026-09-25 mục 19.
    it('duyệt ĐẠT - resolve BATCH_TO_KCS + emit QC_PASSED', async () => {
      await service.reviewProductionBatch('700', { failedQty: 0 }, 'user-kcs');

      expect(notificationsService.resolve).toHaveBeenCalledWith({
        entityType: 'PRODUCTION_BATCH',
        entityId: '700',
        types: ['BATCH_TO_KCS'],
      });
      expect(notificationsService.emit).toHaveBeenCalledWith(
        'QC_PASSED',
        expect.objectContaining({ params: { piCode: 'PI-2026-700' } }),
      );
    });

    it('duyệt có lỗi (failedQty > 0, stage HAN) - emit QC_FAILED cho Hàn + QLSX', async () => {
      await service.reviewProductionBatch('700', { failedQty: 5 }, 'user-kcs');

      expect(notificationsService.emit).toHaveBeenCalledWith(
        'QC_FAILED',
        expect.objectContaining({
          params: { piCode: 'PI-2026-700', failedQty: 5, senderRole: 'HAN_STAFF' },
        }),
      );
    });

    it('duyệt có lỗi, stage SON - emit QC_FAILED cho Sơn', async () => {
      productionBatchesService.findOneRowOrThrow.mockResolvedValue({
        ...awaitingBatch,
        stage: 'SON',
      });

      await service.reviewProductionBatch('700', { failedQty: 3 }, 'user-kcs');

      expect(notificationsService.emit).toHaveBeenCalledWith(
        'QC_FAILED',
        expect.objectContaining({
          params: { piCode: 'PI-2026-700', failedQty: 3, senderRole: 'SON_STAFF' },
        }),
      );
    });

    // N1 (18/11/2026): tin KCS lô Sơn đi theo xưởng nơi sơn; lô Hàn nhắc thủ kho chuyển mảnh sang Sơn.
    it('lô SON của lệnh Phước An - QC_FAILED / QC_PASSED có params.workshopId = xưởng nơi sơn', async () => {
      productionBatchesService.findOneRowOrThrow.mockResolvedValue({
        ...awaitingBatch,
        stage: 'SON',
      });
      (queueWorkshopIdOfPi as jest.Mock).mockResolvedValue(1n);

      await service.reviewProductionBatch('700', { failedQty: 3 }, 'user-kcs');
      await service.reviewProductionBatch('700', { failedQty: 0 }, 'user-kcs');
      const failedParams = { piCode: 'PI-2026-700', failedQty: 3, senderRole: 'SON_STAFF' };

      expect(queueWorkshopIdOfPi).toHaveBeenCalledWith(prisma, 'SON', 30n);
      expect(notificationsService.emit).toHaveBeenCalledWith(
        'QC_FAILED',
        expect.objectContaining({ params: { ...failedParams, workshopId: '1' } }),
      );
      expect(notificationsService.emit).toHaveBeenCalledWith(
        'QC_PASSED',
        expect.objectContaining({ params: { piCode: 'PI-2026-700', workshopId: '1' } }),
      );
      expect(paintReminder.refreshForOrder).not.toHaveBeenCalled();
    });

    it('lô SON - tra xưởng lỗi thì vẫn gửi tin như cũ (theo mã lệnh), lượt chấm không hỏng', async () => {
      productionBatchesService.findOneRowOrThrow.mockResolvedValue({
        ...awaitingBatch,
        stage: 'SON',
      });
      (queueWorkshopIdOfPi as jest.Mock).mockRejectedValue(new Error('db down'));

      const result = await service.reviewProductionBatch('700', { failedQty: 0 }, 'user-kcs');

      expect(result.id).toBe('501');
      expect(notificationsService.emit).toHaveBeenCalledWith(
        'QC_PASSED',
        expect.objectContaining({ params: { piCode: 'PI-2026-700' } }),
      );
    });

    it('lô HAN - không có workshopId, gọi paintReminder.refreshForOrder(productionOrderId) sau commit', async () => {
      await service.reviewProductionBatch('700', { failedQty: 0 }, 'user-kcs');

      expect(queueWorkshopIdOfPi).not.toHaveBeenCalled();
      expect(notificationsService.emit).toHaveBeenCalledWith(
        'QC_PASSED',
        expect.objectContaining({ params: { piCode: 'PI-2026-700' } }),
      );
      expect(paintReminder.refreshForOrder).toHaveBeenCalledWith('1');
    });

    it('lô HAN - refreshForOrder lỗi thì lượt chấm vẫn trả kết quả', async () => {
      paintReminder.refreshForOrder.mockRejectedValue(new Error('boom'));

      const result = await service.reviewProductionBatch('700', { failedQty: 0 }, 'user-kcs');

      expect(result.id).toBe('501');
    });

    it('có failedQty - reportedQty ghi đè = phần ĐẠT, KHÔNG tạo lô rework mới (2026-09-08: bỏ hẳn phân loại Sửa được/Phế, mirror reviewPieceStep)', async () => {
      await service.reviewProductionBatch('700', { failedQty: 5 }, 'user-kcs');

      // P1: updateMany ghi báo - thiếu = 20 (đoạn dùng thật), rồi update hạ về passed = 20 - 5 = 15
      expect(prisma.productionBatch.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: ProductionBatchStatus.QC_DONE, reportedQty: 20 },
        }),
      );
      expect(prisma.productionBatch.update).toHaveBeenCalledWith({
        where: { id: 700n },
        data: { reportedQty: 15 },
      });
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
    it('CHẶN (409, rollback) khi batch đã bị 1 yêu cầu khác duyệt trong lúc đang xử lý - không ghi đè sai reportedQty', async () => {
      prisma.productionBatch.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.reviewProductionBatch('700', { failedQty: 5 }, 'user-kcs'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.qcReview.create).not.toHaveBeenCalled();
    });
  });

  // P1 (18/11/2026): lô mảnh - thiếu, trừ đoạn lúc chấm, thứ tự khoá, transaction 20 giây.
  describe('reviewProductionBatch P1', () => {
    beforeEach(() => {
      prisma.qcReview.create.mockResolvedValue(batchQcReview);
    });

    it('transaction có timeout 20 giây', async () => {
      await service.reviewProductionBatch('700', { failedQty: 0 }, 'user-kcs');

      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 20_000 });
    });

    it('báo 20, lỗi 3, thiếu 2: trừ đoạn theo 18 (báo - thiếu), reportedQty cuối 15, review có shortQty', async () => {
      await service.reviewProductionBatch('700', { failedQty: 3, shortQty: 2 }, 'user-kcs');

      expect(productionBatchesService.consumeSegmentsAtReviewInTx).toHaveBeenCalledWith(
        prisma,
        700n,
        18,
        'user-kcs',
      );
      expect(prisma.productionBatch.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: ProductionBatchStatus.QC_DONE, reportedQty: 18 },
        }),
      );
      expect(prisma.productionBatch.update).toHaveBeenCalledWith({
        where: { id: 700n },
        data: { reportedQty: 15 },
      });
      expect(productionBatchesService.postPieceOutputIfFinal).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ id: 700n, qty: 15 }),
        'user-kcs',
      );
      expect(prisma.qcReview.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({ productionBatchId: 700n, failedQty: 3, shortQty: 2 }),
        }),
      );
    });

    it('thiếu + không đạt > số đã báo -> 400, chưa mở transaction', async () => {
      await expect(
        service.reviewProductionBatch('700', { failedQty: 15, shortQty: 6 }, 'user-kcs'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('đúng thứ tự trong transaction: khoá -> updateMany -> trừ đoạn -> update -> mảnh vào kho -> tạo review', async () => {
      await service.reviewProductionBatch('700', { failedQty: 3, shortQty: 2 }, 'user-kcs');

      const order = [
        productionBatchesService.lockBatchKeysInTx.mock.invocationCallOrder[0],
        prisma.productionBatch.updateMany.mock.invocationCallOrder[0],
        productionBatchesService.consumeSegmentsAtReviewInTx.mock.invocationCallOrder[0],
        prisma.productionBatch.update.mock.invocationCallOrder[0],
        productionBatchesService.postPieceOutputIfFinal.mock.invocationCallOrder[0],
        prisma.qcReview.create.mock.invocationCallOrder[0],
      ];
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(productionBatchesService.lockBatchKeysInTx).toHaveBeenCalledWith(prisma, {
        productionOrderId: 1n,
        pieceId: 40n,
        stage: 'HAN',
      });
    });

    it('chấm trùng (updateMany count 0) -> 409 câu hợp đồng, KHÔNG trừ đoạn', async () => {
      prisma.productionBatch.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.reviewProductionBatch('700', { failedQty: 0 }, 'user-kcs'),
      ).rejects.toThrow('Đợt này vừa được KCS khác chấm xong - tải lại trang.');
      expect(productionBatchesService.consumeSegmentsAtReviewInTx).not.toHaveBeenCalled();
    });

    it('sau commit theo thứ tự: resolve -> afterReviewCommitted -> tin kết quả -> nhắc kho -> realtime', async () => {
      let committed = false;
      prisma.$transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => {
        const r = await cb(prisma);
        committed = true;
        return r;
      });
      productionBatchesService.afterReviewCommitted.mockImplementation(() => {
        expect(committed).toBe(true);
        return Promise.resolve();
      });

      await service.reviewProductionBatch('700', { failedQty: 0 }, 'user-kcs');

      expect(productionBatchesService.afterReviewCommitted).toHaveBeenCalledWith(700n, 'user-kcs');
      const order = [
        notificationsService.resolve.mock.invocationCallOrder[0],
        productionBatchesService.afterReviewCommitted.mock.invocationCallOrder[0],
        notificationsService.emit.mock.invocationCallOrder[0],
        paintReminder.refreshForOrder.mock.invocationCallOrder[0],
        realtimeStub.publishEntityChanged.mock.invocationCallOrder[0],
      ];
      expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    it('afterReviewCommitted ném lỗi -> lượt chấm vẫn trả kết quả và vẫn phát tin kết quả', async () => {
      productionBatchesService.afterReviewCommitted.mockRejectedValue(new Error('boom'));

      const result = await service.reviewProductionBatch('700', { failedQty: 0 }, 'user-kcs');

      expect(result.id).toBe('501');
      expect(notificationsService.emit).toHaveBeenCalledWith('QC_PASSED', expect.anything());
    });

    it('lô SON có thiếu: QC_PASSED có workshopId + note câu thiếu (đơn vị mảnh)', async () => {
      productionBatchesService.findOneRowOrThrow.mockResolvedValue({
        ...awaitingBatch,
        stage: 'SON',
      });
      (queueWorkshopIdOfPi as jest.Mock).mockResolvedValue(1n);

      await service.reviewProductionBatch('700', { failedQty: 0, shortQty: 4 }, 'user-kcs');

      expect(notificationsService.emit).toHaveBeenCalledWith('QC_PASSED', {
        params: {
          piCode: 'PI-2026-700',
          workshopId: '1',
          note: 'KCS ghi thiếu 4 mảnh so với số báo (đã trừ, không tính lỗi, không cần làm bù).',
        },
      });
    });

    it('lô HAN có lỗi + thiếu: QC_FAILED KHÔNG có todo (câu mặc định), detail có câu thiếu', async () => {
      await service.reviewProductionBatch('700', { failedQty: 3, shortQty: 2 }, 'user-kcs');

      expect(notificationsService.emit).toHaveBeenCalledWith('QC_FAILED', {
        params: {
          piCode: 'PI-2026-700',
          failedQty: 3,
          senderRole: 'HAN_STAFF',
          detail:
            '3 lỗi, KCS ghi thiếu 2 mảnh so với số báo (đã trừ, không tính lỗi, không cần làm bù).',
        },
      });
    });

    it('lô HAN vẫn refreshForOrder sau commit khi có thiếu', async () => {
      await service.reviewProductionBatch('700', { failedQty: 0, shortQty: 1 }, 'user-kcs');

      expect(paintReminder.refreshForOrder).toHaveBeenCalledWith('1');
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

    it('phát entity.changed QC_RECORDED SAU khi commit', async () => {
      await service.reviewPieceStep('800', { failedQty: 0 }, 'user-kcs');

      expect(realtimeStub.publishEntityChanged).toHaveBeenCalledWith({
        entity: 'QC_REVIEW',
        entityId: '800',
        action: 'QC_RECORDED',
        actorId: 'user-kcs',
        parentId: 1n,
      });
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
    it('CHẶN (409, rollback) nếu bundle đã bị 1 yêu cầu khác duyệt trong lúc đang xử lý - không cộng trùng failedQty vào sản lượng', async () => {
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

  // 2026-10-07: KCS duyệt 1 "đợt gửi KCS" của Vật tư thành phẩm (MaterialYieldStepBundle, vd chân
  // nhôm) - cùng khuôn reviewPieceStep() nhưng finalize qua MaterialYieldRecipeProductionService
  // (không phải ProductionBatchesService). Trước 2026-10-07 không có test nào cho method này.
  describe('reviewMaterialYieldStep', () => {
    const awaitingMaterialYieldBundle = {
      id: 850n,
      productionInvoiceId: 900n,
      qty: 10,
      status: 'AWAITING_QC',
    };
    const materialYieldQcReview = {
      ...bundleQcReview,
      id: 503n,
      pieceStepBundleId: null,
      materialYieldStepBundleId: 850n,
    };

    beforeEach(() => {
      materialYieldRecipeProductionService.findOneBundleRowOrThrow.mockResolvedValue(
        awaitingMaterialYieldBundle,
      );
      prisma.qcReview.create.mockResolvedValue(materialYieldQcReview);
    });

    it('duyệt ĐẠT hoàn toàn (failedQty=0) - bundle chuyển QC_PASSED, gọi finalize với đúng tham số', async () => {
      const result = await service.reviewMaterialYieldStep('850', { failedQty: 0 }, 'user-kcs');

      expect(prisma.materialYieldStepBundle.updateMany).toHaveBeenCalledWith({
        where: { id: 850n, status: 'AWAITING_QC' },
        data: { status: 'QC_PASSED' },
      });
      expect(prisma.qcReview.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({
            materialYieldStepBundleId: 850n,
            failedQty: 0,
            reviewedById: 'user-kcs',
          }),
        }),
      );
      expect(
        materialYieldRecipeProductionService.finalizeRecipeOutputIfLastStepComplete,
      ).toHaveBeenCalledWith(prisma, awaitingMaterialYieldBundle, 0, 'user-kcs');
      expect(result.id).toBe('503');
    });

    it('failedQty vượt số lượng đã gửi (bundle.qty) -> 400, không ghi gì', async () => {
      await expect(
        service.reviewMaterialYieldStep('850', { failedQty: 11 }, 'user-kcs'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.qcReview.create).not.toHaveBeenCalled();
    });

    it('bundle không ở AWAITING_QC -> 409, không ghi gì', async () => {
      materialYieldRecipeProductionService.findOneBundleRowOrThrow.mockResolvedValue({
        ...awaitingMaterialYieldBundle,
        status: 'QC_PASSED',
      });

      await expect(
        service.reviewMaterialYieldStep('850', { failedQty: 0 }, 'user-kcs'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.qcReview.create).not.toHaveBeenCalled();
    });

    // Nghiêm trọng (cùng idiom reviewPieceStep/reviewProductionBatch): 2 request duyệt gần đồng
    // thời đều đọc status AWAITING_QC (snapshot ngoài transaction) - updateMany+count guard chặn
    // request thua ngay trong transaction, không để gọi finalize 2 lần cho cùng bundle.
    it('CHẶN (409, rollback) nếu bundle đã bị 1 yêu cầu khác duyệt trong lúc đang xử lý', async () => {
      prisma.materialYieldStepBundle.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.reviewMaterialYieldStep('850', { failedQty: 0 }, 'user-kcs'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.qcReview.create).not.toHaveBeenCalled();
      expect(
        materialYieldRecipeProductionService.finalizeRecipeOutputIfLastStepComplete,
      ).not.toHaveBeenCalled();
    });

    it('phát entity.changed QC_RECORDED SAU khi commit', async () => {
      await service.reviewMaterialYieldStep('850', { failedQty: 0 }, 'user-kcs');

      expect(realtimeStub.publishEntityChanged).toHaveBeenCalledWith({
        entity: 'QC_REVIEW',
        entityId: '850',
        action: 'QC_RECORDED',
        actorId: 'user-kcs',
        parentId: 900n,
      });
    });
  });

  // Lỗi sót: KCS chấm công đoạn phụ sắt / pat theo công đoạn / chân nhôm phải phát tin kết quả
  // (QC_FAILED / QC_PASSED) như đợt cắt và lô mảnh - RecipientResolver cần mã PI thật để chọn QLSX.
  describe('P1 pat / chân nhôm có thiếu', () => {
    it('reviewPieceStep: lưu shortQty, tạo review TRƯỚC rồi mới autoFinalize; tin có câu thiếu (mảnh)', async () => {
      prisma.qcReview.create.mockResolvedValue(bundleQcReview);

      await service.reviewPieceStep('800', { failedQty: 1, shortQty: 3 }, 'user-kcs');

      expect(prisma.qcReview.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({ pieceStepBundleId: 800n, failedQty: 1, shortQty: 3 }),
        }),
      );
      expect(prisma.qcReview.create.mock.invocationCallOrder[0]).toBeLessThan(
        productionBatchesService.autoFinalizePieceOutputIfLastStepComplete.mock
          .invocationCallOrder[0],
      );
      expect(notificationsService.emit).toHaveBeenCalledWith('QC_FAILED', {
        params: {
          piCode: 'PI-2026-800',
          failedQty: 1,
          senderRole: 'PHOI_STAFF',
          detail:
            '1 lỗi, KCS ghi thiếu 3 mảnh so với số báo (đã trừ, không tính lỗi, không cần làm bù).',
        },
      });
    });

    it('reviewPieceStep: thiếu + lỗi > số đã gửi (10) -> 400', async () => {
      await expect(
        service.reviewPieceStep('800', { failedQty: 6, shortQty: 5 }, 'user-kcs'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.pieceStepBundle.updateMany).not.toHaveBeenCalled();
    });

    describe('reviewMaterialYieldStep', () => {
      beforeEach(() => {
        materialYieldRecipeProductionService.findOneBundleRowOrThrow.mockResolvedValue({
          id: 850n,
          productionInvoiceId: 900n,
          qty: 10,
          status: 'AWAITING_QC',
        });
        prisma.qcReview.create.mockResolvedValue({
          ...bundleQcReview,
          materialYieldStepBundleId: 850n,
        });
      });

      it('finalize nhận lỗi + thiếu; review có shortQty; tin chỉ thiếu -> QC_PASSED note (cái)', async () => {
        await service.reviewMaterialYieldStep('850', { failedQty: 0, shortQty: 2 }, 'user-kcs');

        expect(
          materialYieldRecipeProductionService.finalizeRecipeOutputIfLastStepComplete,
        ).toHaveBeenCalledWith(prisma, expect.objectContaining({ id: 850n }), 2, 'user-kcs');
        expect(prisma.qcReview.create).toHaveBeenCalledWith(
          expect.objectContaining({
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
            data: expect.objectContaining({ failedQty: 0, shortQty: 2 }),
          }),
        );
        expect(notificationsService.emit).toHaveBeenCalledWith('QC_PASSED', {
          params: {
            piCode: 'PI-2026-900',
            note: 'KCS ghi thiếu 2 cái so với số báo (đã trừ, không tính lỗi, không cần làm bù).',
          },
        });
      });

      it('lỗi 1 + thiếu 3: finalize nhận 4', async () => {
        await service.reviewMaterialYieldStep('850', { failedQty: 1, shortQty: 3 }, 'user-kcs');

        expect(
          materialYieldRecipeProductionService.finalizeRecipeOutputIfLastStepComplete,
        ).toHaveBeenCalledWith(prisma, expect.anything(), 4, 'user-kcs');
      });

      it('thiếu + lỗi > số đã gửi -> 400', async () => {
        await expect(
          service.reviewMaterialYieldStep('850', { failedQty: 6, shortQty: 5 }, 'user-kcs'),
        ).rejects.toThrow(BadRequestException);
      });
    });
  });

  describe('phát tin kết quả KCS (công đoạn phụ sắt, pat, chân nhôm)', () => {
    type Case = {
      name: string;
      piCode: string;
      setup: () => void;
      run: (failed: number) => Promise<unknown>;
      updateMany: () => jest.Mock;
      /** Hàm tự đọc mã PI theo productionInvoiceId của đợt (pat lấy từ include sẵn có). */
      looksUpPi: boolean;
      /** Trường thêm trong params QC_FAILED (17/11/2026: đợt Phôi có detail + todo; loại khác giữ nguyên). */
      extraParams?: { detail: string; todo: string };
    };
    const cases: Case[] = [
      {
        name: 'reviewStepBundle',
        piCode: 'PI-2026-900',
        setup: () => {
          prisma.stepBundle.findUnique.mockResolvedValue({
            id: 800n,
            productionInvoiceId: 900n,
            materialId: 30n,
            step: 'UON',
            status: 'AWAITING_QC',
            material: { code: 'SAT-30', name: 'Sắt hộp', spec: '25x50' },
          });
          prisma.stepBatchSegment.groupBy.mockResolvedValue([
            { segmentSpecId: 30n, _sum: { qty: 8 } },
          ]);
          prisma.segmentSpec.findMany.mockResolvedValue([segmentSpecRow]);
          prisma.qcReview.create.mockResolvedValue({ ...qcReview, stepBundleId: 800n });
        },
        run: (failed) =>
          service.reviewStepBundle(
            '800',
            {
              segments: failed > 0 ? [{ segmentSpecId: '30', failedQty: failed, scrapQty: 1 }] : [],
            },
            'user-kcs',
          ),
        updateMany: () => prisma.stepBundle.updateMany,
        looksUpPi: true,
        extraParams: {
          detail: 'Uốn Sắt hộp 25x50: 2 đoạn 745mm lỗi', // tên loại sắt kèm quy cách (17/11/2026)
          // 2 lỗi, bỏ 1 -> 1 bỏ (cắt lại) + 1 làm lại
          todo: 'Bỏ 1 đoạn 745mm: cắt lại số đoạn đó ở máy cắt, làm lại các công đoạn trước rồi báo Uốn bù. Làm lại 1 đoạn 745mm: Uốn lại chính các đoạn đó rồi báo bù (không cần cắt).',
        },
      },
      {
        name: 'reviewPieceStep',
        piCode: 'PI-2026-800',
        setup: () => {
          prisma.qcReview.create.mockResolvedValue(bundleQcReview);
        },
        run: (failed) => service.reviewPieceStep('800', { failedQty: failed }, 'user-kcs'),
        updateMany: () => prisma.pieceStepBundle.updateMany,
        looksUpPi: false,
      },
      {
        name: 'reviewMaterialYieldStep',
        piCode: 'PI-2026-900',
        setup: () => {
          materialYieldRecipeProductionService.findOneBundleRowOrThrow.mockResolvedValue({
            id: 850n,
            productionInvoiceId: 900n,
            qty: 10,
            status: 'AWAITING_QC',
          });
          prisma.qcReview.create.mockResolvedValue({
            ...bundleQcReview,
            materialYieldStepBundleId: 850n,
          });
        },
        run: (failed) => service.reviewMaterialYieldStep('850', { failedQty: failed }, 'user-kcs'),
        updateMany: () => prisma.materialYieldStepBundle.updateMany,
        looksUpPi: true,
      },
    ];

    describe.each(cases)('$name', (c) => {
      beforeEach(() => c.setup());

      it('có lỗi - emit QC_FAILED với mã PI thật, failedQty, senderRole PHOI_STAFF', async () => {
        await c.run(2);

        expect(notificationsService.emit).toHaveBeenCalledWith('QC_FAILED', {
          params: { piCode: c.piCode, failedQty: 2, senderRole: 'PHOI_STAFF', ...c.extraParams },
        });
        expect(notificationsService.emit).not.toHaveBeenCalledWith('QC_PASSED', expect.anything());
      });

      it('0 lỗi - emit QC_PASSED với mã PI thật', async () => {
        await c.run(0);

        expect(notificationsService.emit).toHaveBeenCalledWith('QC_PASSED', {
          params: { piCode: c.piCode },
        });
        expect(notificationsService.emit).not.toHaveBeenCalledWith('QC_FAILED', expect.anything());
      });

      it('transaction ném 409 (đợt vừa bị duyệt) - KHÔNG emit', async () => {
        c.updateMany().mockResolvedValue({ count: 0 });

        await expect(c.run(0)).rejects.toThrow(ConflictException);
        expect(notificationsService.emit).not.toHaveBeenCalled();
      });

      it('emit ném lỗi - hàm review vẫn trả kết quả bình thường', async () => {
        notificationsService.emit.mockRejectedValue(new Error('boom'));

        await expect(c.run(0)).resolves.toBeDefined();
      });

      it('phát tin SAU khi transaction chấm đã xong (không phát bên trong)', async () => {
        let committed = false;
        const seen: boolean[] = [];
        prisma.$transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => {
          const r = await cb(prisma);
          committed = true;
          return r;
        });
        notificationsService.emit.mockImplementation(() => {
          seen.push(committed);
          return Promise.resolve();
        });

        await c.run(2);

        expect(seen).toEqual([true]);
      });

      if (c.looksUpPi) {
        it('đọc mã PI theo đúng PI của đợt', async () => {
          await c.run(0);

          expect(prisma.productionInvoice.findUnique).toHaveBeenCalledWith({
            where: { id: 900n },
            select: { code: true },
          });
        });

        it('đọc mã PI ném lỗi (sau commit) - review vẫn trả kết quả, không phát tin', async () => {
          prisma.productionInvoice.findUnique.mockRejectedValue(new Error('db down'));

          await expect(c.run(2)).resolves.toBeDefined();
          expect(notificationsService.emit).not.toHaveBeenCalled();
        });
      }
    });
  });

  // Sửa/xóa CHỈ photoUrl - mở cho CHÍNH người đã chấm review (reviewedById) HOẶC Admin, xem doc
  // comment updatePhoto()/UpdateQcReviewPhotoDto (2026-09-11 lần 2, theo Sếp: "cho người nhập được
  // sửa luôn"). actorUserId/actorRoles giờ là tham số bắt buộc.
  describe('T4-9 (19/11/2026): lý do lỗi không tồn tại -> 400 câu rõ ràng, không ghi gì', () => {
    const MSG = 'Lý do lỗi không tồn tại hoặc đã xoá';
    const cutBundleRow = {
      id: 1n,
      steelIssueId: 100n,
      status: 'AWAITING_QC',
      steelIssue: {
        productionInvoiceId: 900n,
        materialId: 30n,
        material: { code: 'SAT-30', name: 'Sắt phi 10' },
      },
    };
    const stepBundleRow = {
      id: 800n,
      productionInvoiceId: 900n,
      materialId: 30n,
      step: 'UON',
      status: 'AWAITING_QC',
      material: { code: 'SAT-30', name: 'Sắt hộp', spec: '25x50' },
    };
    const myBundleRow = { id: 850n, productionInvoiceId: 900n, qty: 10, status: 'AWAITING_QC' };

    beforeEach(() => {
      prisma.defectReason.findUnique.mockResolvedValue(null);
      prisma.cutBundle.findUnique.mockResolvedValue(cutBundleRow);
      prisma.stepBundle.findUnique.mockResolvedValue(stepBundleRow);
      materialYieldRecipeProductionService.findOneBundleRowOrThrow.mockResolvedValue(myBundleRow);
    });

    it.each([
      ['review', () => service.review('100', { segments: [], defectReasonId: '9' }, 'u')],
      [
        'reviewCutBundle',
        () => service.reviewCutBundle('1', { segments: [], defectReasonId: '9' }, 'u'),
      ],
      [
        'reviewStepBundle',
        () => service.reviewStepBundle('800', { segments: [], defectReasonId: '9' }, 'u'),
      ],
      [
        'reviewProductionBatch',
        () => service.reviewProductionBatch('700', { failedQty: 0, defectReasonId: '9' }, 'u'),
      ],
      [
        'reviewPieceStep',
        () => service.reviewPieceStep('800', { failedQty: 0, defectReasonId: '9' }, 'u'),
      ],
      [
        'reviewMaterialYieldStep',
        () => service.reviewMaterialYieldStep('850', { failedQty: 0, defectReasonId: '9' }, 'u'),
      ],
    ])('%s: defectReasonId không có trong DB -> 400', async (_name, call) => {
      await expect(call()).rejects.toThrow(new BadRequestException(MSG));
      expect(prisma.defectReason.findUnique).toHaveBeenCalledWith({
        where: { id: 9n },
        select: { id: true },
      });
      expect(prisma.qcReview.create).not.toHaveBeenCalled();
    });

    it('không gửi defectReasonId -> không tra bảng lý do lỗi', async () => {
      await service.review('100', { segments: [] }, 'u');
      expect(prisma.defectReason.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('T4-9 DTO chấm KCS theo cỡ: câu lỗi thiếu segments', () => {
    const msgs = async (body: object) =>
      (await validate(plainToInstance(CreateSteelIssueQcReviewDto, body))).flatMap((e) =>
        Object.values(e.constraints ?? {}),
      );

    it('thiếu segments -> câu "thiếu danh sách", không có câu "bị trùng" kiểu cũ', async () => {
      const out = (await msgs({})).join(' | ');
      expect(out).toMatch(/Thiếu danh sách cỡ đoạn/);
      expect(out).not.toMatch(/must be unique/);
    });

    it('[] hợp lệ (đạt hết); trùng cỡ -> câu trùng bằng tiếng Việt', async () => {
      expect(await msgs({ segments: [] })).toEqual([]);
      const dup = await msgs({
        segments: [
          { segmentSpecId: '30', failedQty: 0 },
          { segmentSpecId: '30', failedQty: 1 },
        ],
      });
      expect(dup).toEqual(['Danh sách cỡ đoạn có cỡ bị trùng']);
    });
  });

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

  describe('móc tồn đoạn theo lệnh sau KCS', () => {
    it('review(): gọi recomputeAfterQc với PI của phiếu và reason QC_STEEL_ISSUE', async () => {
      await service.review('100', { segments: [] }, 'user-kcs');

      expect(segmentProductionService.recomputeAfterQc).toHaveBeenCalledTimes(1);
      expect(segmentProductionService.recomputeAfterQc).toHaveBeenCalledWith(
        900n,
        'user-kcs',
        'QC_STEEL_ISSUE:100',
      );
    });

    it('reviewCutBundle(): gọi recomputeAfterQc với PI của lô cha và reason QC_CUT_BUNDLE', async () => {
      prisma.cutBundle.findUnique.mockResolvedValue({
        id: 1n,
        steelIssueId: 100n,
        status: 'AWAITING_QC',
        steelIssue: { productionInvoiceId: 901n, materialId: 30n },
      });
      prisma.qcReview.create.mockResolvedValue({ ...qcReview, cutBundleId: 1n });

      await service.reviewCutBundle('1', { segments: [] }, 'user-kcs');

      expect(segmentProductionService.recomputeAfterQc).toHaveBeenCalledWith(
        901n,
        'user-kcs',
        'QC_CUT_BUNDLE:1',
      );
    });

    it('reviewStepBundle(): gọi recomputeAfterQc với PI của đợt và reason QC_STEP_BUNDLE', async () => {
      prisma.stepBundle.findUnique.mockResolvedValue({
        id: 800n,
        productionInvoiceId: 902n,
        materialId: 30n,
        step: 'UON',
        status: 'AWAITING_QC',
        material: { code: 'SAT-30', name: 'Sắt hộp', spec: '25x50' },
      });
      prisma.qcReview.create.mockResolvedValue({
        ...qcReview,
        cutBundleId: null,
        stepBundleId: 800n,
      });

      await service.reviewStepBundle('800', { segments: [] }, 'user-kcs');

      expect(segmentProductionService.recomputeAfterQc).toHaveBeenCalledWith(
        902n,
        'user-kcs',
        'QC_STEP_BUNDLE:800',
      );
    });

    it('KCS bị từ chối (sai trạng thái) thì KHÔNG gọi recomputeAfterQc', async () => {
      steelIssuesService.findOneRowOrThrow.mockResolvedValue({
        ...awaitingIssue,
        status: SteelIssueStatus.QC_PASSED,
      });

      await expect(service.review('100', { segments: [] }, 'user-kcs')).rejects.toThrow(
        ConflictException,
      );
      expect(segmentProductionService.recomputeAfterQc).not.toHaveBeenCalled();
    });
  });
});
