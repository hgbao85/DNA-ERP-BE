import { instanceToPlain } from 'class-transformer';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FLOOR_REPORT_REVERSED_REPLAY_MESSAGE } from '../../common/utils/floor-report.util';
import {
  IdempotencyKeyInUseException,
  IdempotencyKeyReusedException,
} from '../../common/utils/idempotency.util';
import { MfgRole, MfgStage, StockLedgerRefType } from '../../generated/prisma/client';
import { PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { MaterialYieldIssuesService } from '../material-yield-issues/material-yield-issues.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProductionBatchesService } from './production-batches.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { SegmentStockService } from '../segment-stock/segment-stock.service';
import {
  loadMaterialYieldNeed,
  materialYieldNeedKey,
} from '../material-yield-recipes/material-yield-need.util';

describe('ProductionBatchesService', () => {
  let service: ProductionBatchesService;
  let prisma: {
    productionBatch: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findFirst: jest.Mock;
      aggregate: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    productionOrder: { findUnique: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock };
    floorReport: { create: jest.Mock; findUnique: jest.Mock };
    productionInvoiceItem: { findUniqueOrThrow: jest.Mock; findFirst: jest.Mock };
    bomPiece: { findUnique: jest.Mock; findMany: jest.Mock; findFirst: jest.Mock };
    pieceBom: { findMany: jest.Mock };
    pieceMaterialYield: { findUnique: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock };
    pieceStepBatch: {
      findUnique: jest.Mock;
      aggregate: jest.Mock;
      groupBy: jest.Mock;
      create: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
    };
    pieceStepBundle: {
      findUnique: jest.Mock;
      groupBy: jest.Mock;
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    qcReview: { findMany: jest.Mock; aggregate: jest.Mock };
    piece: { findUnique: jest.Mock };
    segmentOverage: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
    };
    stockQuant: { findMany: jest.Mock };
    materialYieldRecipe: { findMany: jest.Mock };
    pieceMaterialItem: { findMany: jest.Mock };
    materialYieldStepBundle: { findMany: jest.Mock };
    materialYieldStepBatch: { groupBy: jest.Mock };
    stockLedger: { findMany: jest.Mock; findFirst: jest.Mock };
    warehouseTransferPieceItem: { findMany: jest.Mock };
    warehouse: { findUniqueOrThrow: jest.Mock; findUnique: jest.Mock; findFirst: jest.Mock };
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let stockLedgerService: { postEntry: jest.Mock };
  let segmentStock: { consumeForOrder: jest.Mock };
  let materialYieldIssuesService: { sumReceived: jest.Mock };
  let notificationsService: { emit: jest.Mock; resolve: jest.Mock };
  let realtimeStub: { publishEntityChanged: jest.Mock; publishNotificationCreated: jest.Mock };

  const order = {
    id: 1n,
    poNumber: 'PO-31-1',
    bomRevisionId: 5n,
    quantity: 10,
    productionInvoiceItemId: 20n,
    mfgProduct: { name: 'SP-1', factoryCode: 'SKU-1' },
    productionInvoiceItem: { productionInvoiceId: 500n, salesOrder: { orderCode: 'PO-31' } },
  };
  const piece = { id: 40n, code: 'MANH-TUA', name: 'Mảnh tựa' };
  const bomPieceRow = {
    id: 1n,
    bomRevisionId: 5n,
    pieceId: 40n,
    qtyPerUnit: 2,
    needsHan: true,
    needsSon: true,
  };
  const steelWarehouse = { id: 90n, code: 'phoi-son-han' };
  const steelWarehouse2 = { id: 95n, code: 'phoi-son-han-phoi-pha' };
  const productionWarehouse = { id: 91n, code: 'PRODUCTION' };

  const batchRow = {
    id: 700n,
    stage: MfgStage.HAN,
    productionOrderId: 1n,
    pieceId: 40n,
    reportedQty: 20,
    status: 'AWAITING_QC',
    idempotencyKey: null,
    reportedAt: new Date(),
    reportedById: 'user-han',
    reworkOfId: null,
    productionOrder: order,
    piece,
  };

  beforeEach(() => {
    prisma = {
      productionBatch: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        aggregate: jest.fn().mockResolvedValue({ _sum: { reportedQty: null } }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn(),
        // Nghiêm trọng/Cao H3 (đính chính audit độc lập 09/09, xác nhận thật qua test trực tiếp
        // trên server+DB dev: 12/13 lần tái hiện được race giữa "Lưu đợt" và "Gửi KCS") - updateMany
        // + count guard mặc định count:1 (thành công), test race-guard tự override count:0.
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      // findFirst mặc định trả về 1 order ACTIVE - đa số test case không quan tâm gate
      // assertPiHasActiveFloor() (2026-08-31), xem mục riêng "QLSX Bắt đầu" bên dưới mới override
      // để test rớt gate.
      productionOrder: {
        findUnique: jest.fn().mockResolvedValue(order),
        findFirst: jest.fn().mockResolvedValue({ id: 9n }),
        // Mặc định 1 order duy nhất - describe('getBatchPlanBatch') bên dưới tự override cho case
        // nhiều order.
        findMany: jest.fn().mockResolvedValue([order]),
      },
      productionInvoiceItem: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ productionInvoiceId: 500n }),
        // Đợt 7: xưởng của lệnh - mặc định chưa chọn xưởng (đoạn sắt trừ ở kho Phôi gốc).
        findFirst: jest.fn().mockResolvedValue(null),
      },
      bomPiece: {
        findUnique: jest.fn().mockResolvedValue(bomPieceRow),
        findMany: jest.fn().mockResolvedValue([{ ...bomPieceRow, piece }]),
        findFirst: jest.fn().mockResolvedValue({ qtyPerUnit: 2 }),
      },
      // Mặc định rỗng - đa số test case không quan tâm tới nhánh trừ tồn đoạn (mục "Trừ tồn đoạn
      // sắt (SEGMENT_CONSUME)" bên dưới mới override).
      pieceBom: { findMany: jest.fn().mockResolvedValue([]) },
      // Mặc định rỗng - đa số test case không quan tâm tới nhánh vật tư thành phẩm (định mức
      // PieceMaterialYield, xem mục "trừ tồn nguyên liệu" bên dưới mới override).
      pieceMaterialYield: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      // Mặc định rỗng - đa số test case không quan tâm tới tiến độ công đoạn vật tư thành phẩm
      // (xem mục 'recordPieceStepBatch' và 'stepProgress trong getBatchPlan' bên dưới).
      pieceStepBatch: {
        findUnique: jest.fn().mockResolvedValue(null),
        aggregate: jest.fn().mockResolvedValue({ _sum: { qty: null } }),
        groupBy: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
      },
      // Mặc định rỗng - đa số test case không quan tâm tới đợt gửi KCS theo công đoạn (xem mục
      // 'submitPieceStep' và 'stepProgress' bên dưới).
      pieceStepBundle: {
        findUnique: jest.fn().mockResolvedValue(null),
        groupBy: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      qcReview: {
        findMany: jest.fn().mockResolvedValue([]),
        // P1: chặn báo vượt công đoạn pat đọc Σ lỗi + thiếu của các lần KCS chấm.
        aggregate: jest.fn().mockResolvedValue({ _sum: { failedQty: null, shortQty: null } }),
      },
      piece: { findUnique: jest.fn().mockResolvedValue(piece) },
      // Sổ báo vượt đoạn (trừ đoạn lúc KCS chấm) - mặc định chưa có dòng nào.
      segmentOverage: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
      },
      stockQuant: { findMany: jest.fn().mockResolvedValue([]) },
      // Mặc định rỗng - vật tư thành phẩm không gắn mảnh (chân nhôm, MaterialYieldRecipe) chỉ được
      // test ở mục 'vật tư thành phẩm không gắn mảnh' bên dưới mới override.
      materialYieldRecipe: { findMany: jest.fn().mockResolvedValue([]) },
      pieceMaterialItem: { findMany: jest.fn().mockResolvedValue([]) },
      materialYieldStepBundle: { findMany: jest.fn().mockResolvedValue([]) },
      materialYieldStepBatch: { groupBy: jest.fn().mockResolvedValue([]) },
      stockLedger: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      warehouseTransferPieceItem: { findMany: jest.fn().mockResolvedValue([]) },
      warehouse: {
        findUniqueOrThrow: jest
          .fn()
          .mockImplementation(({ where: { code } }: { where: { code: string } }) =>
            Promise.resolve(
              code === 'phoi-son-han'
                ? steelWarehouse
                : code === steelWarehouse2.code
                  ? steelWarehouse2
                  : productionWarehouse,
            ),
          ),
        findUnique: jest.fn().mockResolvedValue(steelWarehouse),
        findFirst: jest.fn().mockResolvedValue(steelWarehouse2),
      },
      // assertItemPiHasActiveFloorLocked() (vá race TOCTOU, 2026-09-03) - FOR UPDATE lên
      // production_orders ngay dòng đầu transaction create(). Mặc định ACTIVE, đa số test case
      // không quan tâm gate.
      $queryRaw: jest.fn(() => Promise.resolve([{ floorStage: 'ACTIVE' }])),
      // lockBusinessKey() (recordPieceStepBatch) - pg_advisory_xact_lock, no-op trong test.
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      // Sổ ghi từng lần báo (2026-10-12) - mặc định chưa có khoá nào.
      floorReport: {
        create: jest.fn().mockResolvedValue({ id: 900n }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(prisma))),
    };
    stockLedgerService = { postEntry: jest.fn().mockResolvedValue({}) };
    segmentStock = { consumeForOrder: jest.fn() };
    // Mặc định "đã nhận đủ" (100) - đa số test case không quan tâm ràng buộc mới "chưa nhận thì
    // chưa báo được" (2026-09-04), xem mục 'assertMaterialYieldReceived' bên dưới mới override 0.
    materialYieldIssuesService = { sumReceived: jest.fn().mockResolvedValue(100) };
    notificationsService = {
      emit: jest.fn().mockResolvedValue(undefined),
      resolve: jest.fn().mockResolvedValue(undefined),
    };
    realtimeStub = { publishEntityChanged: jest.fn(), publishNotificationCreated: jest.fn() };
    service = new ProductionBatchesService(
      prisma as unknown as PrismaServiceType,
      stockLedgerService as unknown as StockLedgerService,
      materialYieldIssuesService as unknown as MaterialYieldIssuesService,
      notificationsService as unknown as NotificationsService,
      realtimeStub as unknown as RealtimeService,
      segmentStock as unknown as SegmentStockService,
    );
  });

  describe('create', () => {
    const dto = { stage: MfgStage.HAN, pieceId: '40', reportedQty: 20 };

    it('happy path - mfgRole null (quản lý) tạo lô mới', async () => {
      prisma.productionBatch.create.mockResolvedValue(batchRow);

      const result = await service.create('1', dto, 'user-han', null, null);

      expect(prisma.productionBatch.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({
            stage: MfgStage.HAN,
            productionOrderId: 1n,
            pieceId: 40n,
            reportedQty: 20,
          }),
        }),
      );
      expect(result.id).toBe('700');
    });

    it('idempotency short-circuit - trả về lô cũ, không tạo mới, KHÔNG trừ đoạn (P1: trừ lúc KCS chấm)', async () => {
      prisma.productionBatch.findUnique.mockResolvedValue(batchRow);

      const result = await service.create('1', dto, 'user-han', null, null, 'idem-key-1');

      expect(prisma.productionBatch.create).not.toHaveBeenCalled();
      expect(result.id).toBe('700');
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    // MF3: khoá advisory production-batch-open là câu ĐẦU TIÊN của transaction, trước FOR UPDATE production_orders.
    it('MF3: create() lấy khoá production-batch-open TRƯỚC câu FOR UPDATE production_orders (cùng thứ tự recordProductionBatch)', async () => {
      prisma.productionBatch.create.mockResolvedValue(batchRow);

      await service.create('1', dto, 'user-han', null, null);

      const [first] = prisma.$executeRaw.mock.calls as [TemplateStringsArray, string][];
      expect(first[1]).toBe('production-batch-open:1:40:HAN');
      expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.$queryRaw.mock.invocationCallOrder[0],
      );
    });

    describe('chặn báo vượt (P1, cùng luật recordProductionBatch)', () => {
      it('cần 20, đã báo 15 (chờ KCS): báo 6 -> 400 "tối đa 5", không tạo đợt; overPlanWarning luôn null khi qua', async () => {
        prisma.productionBatch.aggregate.mockResolvedValue({ _sum: { reportedQty: 15 } });

        const err = await service
          .create('1', { ...dto, reportedQty: 6 }, 'u', null, null)
          .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as Error).message).toContain('lần này báo được tối đa 5, bạn nhập 6');
        expect(prisma.productionBatch.create).not.toHaveBeenCalled();

        prisma.productionBatch.create.mockResolvedValue(batchRow);
        const ok = await service.create('1', { ...dto, reportedQty: 5 }, 'u', null, null);
        expect(ok.overPlanWarning).toBeNull();
      });
    });

    it('cho phép mfgRole khớp đúng stage (HAN)', async () => {
      prisma.productionBatch.create.mockResolvedValue(batchRow);
      await expect(service.create('1', dto, 'user-han', MfgRole.HAN, null)).resolves.toBeDefined();
    });

    it('ném ForbiddenException khi mfgRole không khớp stage (SON báo hộ HAN)', async () => {
      await expect(service.create('1', dto, 'user-son', MfgRole.SON, null)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.productionBatch.create).not.toHaveBeenCalled();
    });

    it('ném BadRequestException khi stage không phải PHOI/HAN/SON', async () => {
      await expect(
        service.create('1', { ...dto, stage: MfgStage.DAN }, 'user-1', null, null),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.productionBatch.create).not.toHaveBeenCalled();
    });

    // Thêm 21/08/2026: PHOI giờ là stage hợp lệ thứ 3, dành riêng cho mảnh needsHan=false ("vật
    // tư thành phẩm", vd chân nhôm - cắt xong là hết, không hàn). Xem
    // WarehouseTransfersService.getPieceTransferPlan() cho lý do cần luồng này (trước đây
    // needsHan=false hoàn toàn không có cách nào báo/chuyển kho).
    describe('stage PHOI - "vật tư thành phẩm" (needsHan=false)', () => {
      const phoiDto = { stage: MfgStage.PHOI, pieceId: '40', reportedQty: 20 };
      const phoiBatchRow = { ...batchRow, stage: MfgStage.PHOI, reportedById: 'user-phoi' };

      it('ném BadRequestException khi báo PHOI cho mảnh needsHan=true (mảnh thường, phải qua Hàn)', async () => {
        await expect(service.create('1', phoiDto, 'user-phoi', null, null)).rejects.toThrow(
          BadRequestException,
        );
        expect(prisma.productionBatch.create).not.toHaveBeenCalled();
      });

      it('happy path - báo PHOI cho mảnh needsHan=false thành công', async () => {
        prisma.bomPiece.findUnique.mockResolvedValue({
          ...bomPieceRow,
          needsHan: false,
          needsSon: false,
        });
        prisma.productionBatch.create.mockResolvedValue(phoiBatchRow);

        const result = await service.create('1', phoiDto, 'user-phoi', null, null);

        expect(prisma.productionBatch.create).toHaveBeenCalledWith(
          expect.objectContaining({
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
            data: expect.objectContaining({ stage: MfgStage.PHOI, pieceId: 40n, reportedQty: 20 }),
          }),
        );
        expect(result.id).toBe('700');
      });

      it('cho phép mfgRole khớp đúng stage (PHOI)', async () => {
        prisma.bomPiece.findUnique.mockResolvedValue({
          ...bomPieceRow,
          needsHan: false,
          needsSon: false,
        });
        prisma.productionBatch.create.mockResolvedValue(phoiBatchRow);
        await expect(
          service.create('1', phoiDto, 'user-phoi', MfgRole.PHOI, null),
        ).resolves.toBeDefined();
      });

      it('ném ForbiddenException khi mfgRole không khớp stage (HAN báo hộ PHOI)', async () => {
        await expect(service.create('1', phoiDto, 'user-han', MfgRole.HAN, null)).rejects.toThrow(
          ForbiddenException,
        );
        expect(prisma.productionBatch.create).not.toHaveBeenCalled();
      });

      // 2026-08-22: "pat" - needsHan=true NHƯNG có PieceMaterialYield (cắt từ tấm sắt lá theo tỷ
      // lệ cố định) - vẫn báo được ở PHOI (bước cắt), khác hẳn mảnh sắt bin-packing thường
      // (needsHan=true, KHÔNG có PieceMaterialYield) vẫn bị chặn ở test đầu tiên phía trên.
      it('cho phép báo PHOI cho piece needsHan=true CÓ PieceMaterialYield ("pat", vẫn cần Hàn sau khi cắt)', async () => {
        prisma.bomPiece.findUnique.mockResolvedValue({ ...bomPieceRow, needsHan: true });
        prisma.pieceMaterialYield.findFirst.mockResolvedValue({ id: 5n });
        prisma.pieceMaterialYield.findMany.mockResolvedValue([
          {
            id: 5n,
            bomRevisionId: 5n,
            pieceId: 40n,
            materialId: 90n,
            piecesPerBar: 6,
            processSteps: [],
            material: { warehouse: { id: 96n, code: 'kho-tam-sat-la' } },
          },
        ]);
        prisma.productionBatch.create.mockResolvedValue(phoiBatchRow);

        await expect(service.create('1', phoiDto, 'user-phoi', null, null)).resolves.toBeDefined();
        expect(prisma.productionBatch.create).toHaveBeenCalled();
      });
    });

    it('ném NotFoundException khi production order không tồn tại', async () => {
      prisma.productionOrder.findUnique.mockResolvedValue(null);
      await expect(service.create('1', dto, 'user-han', null, null)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('ném NotFoundException khi mảnh không thuộc BOM của lệnh sản xuất này', async () => {
      prisma.bomPiece.findUnique.mockResolvedValue(null);
      await expect(service.create('1', dto, 'user-han', null, null)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('ném BadRequestException khi mảnh không cần qua đúng stage (needsHan=false báo HAN)', async () => {
      prisma.bomPiece.findUnique.mockResolvedValue({ ...bomPieceRow, needsHan: false });
      await expect(service.create('1', dto, 'user-han', null, null)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.productionBatch.create).not.toHaveBeenCalled();
    });

    it('ném BadRequestException khi mảnh không cần qua đúng stage (needsSon=false báo SON)', async () => {
      prisma.bomPiece.findUnique.mockResolvedValue({ ...bomPieceRow, needsSon: false });
      await expect(
        service.create('1', { ...dto, stage: MfgStage.SON }, 'user-son', null, null),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.productionBatch.create).not.toHaveBeenCalled();
    });
  });

  describe('create - QLSX "Bắt đầu" gate (assertPiHasActiveFloor, 2026-08-31)', () => {
    const dto = { stage: MfgStage.HAN, pieceId: '40', reportedQty: 20 };

    it('ném ConflictException khi PI của order chưa có SKU nào ACTIVE - áp dụng cho cả PHOI/HAN/SON vì create() dùng chung', async () => {
      prisma.productionOrder.findFirst.mockResolvedValue(null);

      await expect(service.create('1', dto, 'user-han', null, null)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.productionInvoiceItem.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 20n },
        select: { productionInvoiceId: true },
      });
      expect(prisma.productionOrder.findFirst).toHaveBeenCalledWith({
        where: {
          productionInvoiceItem: { productionInvoiceId: 500n },
          floorStage: 'ACTIVE',
        },
        select: { id: true },
      });
      expect(prisma.productionBatch.create).not.toHaveBeenCalled();
    });

    it('cho phép báo khi PI có ÍT NHẤT 1 SKU ACTIVE, kể cả khi KHÔNG PHẢI chính order này', async () => {
      prisma.productionOrder.findFirst.mockResolvedValue({ id: 999n }); // SKU khác trong cùng PI
      prisma.productionBatch.create.mockResolvedValue(batchRow);

      await expect(service.create('1', dto, 'user-han', null, null)).resolves.toBeDefined();
    });

    // 2026-09-03: assertItemPiHasActiveFloor() ở trên đọc TRƯỚC khi mở transaction (fast-path) -
    // không tự chốt được race QLSX bấm "Tạm dừng" đúng lúc giữa đọc và ghi.
    // assertItemPiHasActiveFloorLocked() (FOR UPDATE, chạy NGAY ĐẦU transaction) mới là nguồn đúng
    // cuối cùng - test này giả lập đúng race đó: pre-check thấy ACTIVE (findFirst mock không đổi)
    // nhưng câu SELECT FOR UPDATE bên trong transaction đọc lại thấy PAUSED.
    it('ném ConflictException khi race: pre-check thấy ACTIVE nhưng SELECT FOR UPDATE trong transaction đọc lại thấy PAUSED (TOCTOU)', async () => {
      prisma.$queryRaw.mockResolvedValue([{ floorStage: 'PAUSED' }]);

      await expect(service.create('1', dto, 'user-han', null, null)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.productionBatch.create).not.toHaveBeenCalled();
    });
  });

  // P1 (18/11/2026): trừ đoạn dời sang LÚC KCS CHẤM (consumeSegmentsAtReviewInTx). create() / chốt không còn trừ đoạn.
  // 13/11/2026: tồn đoạn theo lệnh (SEGMENT_STOCK_ENABLED) - trừ theo mã đoạn qua SegmentStockService, thiếu / vượt thì ghi sổ
  // báo vượt, KHÔNG chặn.
  describe('consumeSegmentsAtReviewInTx - trừ tồn đoạn theo lệnh lúc KCS chấm (bật SEGMENT_STOCK_ENABLED)', () => {
    const env = process.env.SEGMENT_STOCK_ENABLED;
    const tx = () => prisma as unknown as PrismaTx;
    const consume = (qty = 20) => service.consumeSegmentsAtReviewInTx(tx(), 700n, qty, 'kcs-1');
    // Đủ đoạn: lấy đúng số cần.
    const takeAll = (_tx: unknown, i: { qty: number }) =>
      Promise.resolve({
        takenQty: i.qty,
        fromHeldQty: i.qty,
        fromSurplusQty: 0,
        shortageQty: 0,
        duplicate: false,
      });
    beforeEach(() => {
      process.env.SEGMENT_STOCK_ENABLED = 'true';
      prisma.qcReview.aggregate.mockResolvedValue({ _sum: { failedQty: 0 } });
      // Dòng lô đang chấm: người báo = công nhân Hàn (không phải KCS).
      prisma.productionBatch.findUniqueOrThrow.mockResolvedValue({
        id: 700n,
        pieceId: 40n,
        stage: MfgStage.HAN,
        reportedById: 'user-han',
        productionOrderId: 1n,
        reworkOfId: null,
        productionOrder: {
          bomRevisionId: 5n,
          quantity: 10,
          productionInvoiceItem: { productionInvoiceId: 500n },
        },
      });
      // Định mức mảnh: 2 dòng 460 mm (Dập + trơn) + 1 dòng cỡ khác; bộ công đoạn lưu lộn thứ tự vẫn ra cùng mã.
      prisma.pieceBom.findMany.mockResolvedValue([
        { segmentSpecId: 60n, qtyPerPiece: 2, processSteps: ['CAT', 'DAP'] },
        { segmentSpecId: 60n, qtyPerPiece: 1, processSteps: ['CAT'] },
        { segmentSpecId: 61n, qtyPerPiece: 1, processSteps: ['CAT'] },
      ]);
    });
    afterEach(() => {
      if (env === undefined) delete process.env.SEGMENT_STOCK_ENABLED;
      else process.env.SEGMENT_STOCK_ENABLED = env;
    });

    it('trừ từng MÃ đoạn qua consumeForOrder (không ghi sổ kho kiểu cũ); đủ đoạn, không vượt thì không ghi sổ báo vượt', async () => {
      // Lệnh 10 bộ × 2 mảnh/bộ = 20 mảnh: lô 20 không vượt.
      segmentStock.consumeForOrder.mockImplementation(takeAll);

      await consume();

      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
      expect(segmentStock.consumeForOrder).toHaveBeenCalledTimes(3);
      expect(segmentStock.consumeForOrder).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          productionInvoiceId: 500n,
          segmentSpecId: 60n,
          segmentSteps: 'DAP',
          qty: 40,
          idempotencyKey: 'production-batch-segment-consume:700:60:DAP',
        }),
      );
      expect(segmentStock.consumeForOrder).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ segmentSpecId: 60n, segmentSteps: '', qty: 20 }),
      );
      expect(prisma.segmentOverage.create).not.toHaveBeenCalled();
    });

    it('trừ theo SỐ THỰC CÓ (báo - thiếu) người gọi truyền, không theo số báo của lô', async () => {
      segmentStock.consumeForOrder.mockImplementation(takeAll);

      await consume(16); // báo 20, KCS ghi thiếu 4

      expect(segmentStock.consumeForOrder).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ segmentSpecId: 60n, segmentSteps: '', qty: 16 }),
      );
      expect(segmentStock.consumeForOrder).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ segmentSpecId: 60n, segmentSteps: 'DAP', qty: 32 }),
      );
    });

    it('S7: thiếu đoạn KHÔNG chặn, ghi sổ báo vượt với NGƯỜI BÁO của lô (không phải KCS); tin SEGMENT_OVERAGE_REPORTED phát sau commit với KCS', async () => {
      segmentStock.consumeForOrder.mockResolvedValue({
        takenQty: 5,
        fromHeldQty: 5,
        fromSurplusQty: 0,
        shortageQty: 15,
        duplicate: false,
      });

      await consume();

      expect(prisma.segmentOverage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          productionBatchId: 700n,
          takenQty: 5,
          shortageQty: 15,
          extraQty: 0,
          extraKind: null,
          reportedById: 'user-han',
        }) as unknown,
      });
      // Chưa phát tin trong transaction.
      expect(notificationsService.emit).not.toHaveBeenCalled();

      prisma.segmentOverage.findMany.mockResolvedValue([
        {
          stage: MfgStage.HAN,
          shortageQty: 15,
          extraQty: 0,
          extraKind: null,
          productionInvoice: { code: 'PI-2026-500' },
          productionBatch: { piece: { code: 'M40' } },
        },
      ]);
      await service.afterReviewCommitted(700n, 'kcs-1');
      expect(notificationsService.emit).toHaveBeenCalledWith(
        'SEGMENT_OVERAGE_REPORTED',
        expect.objectContaining({
          entityId: '700',
          actorId: 'kcs-1',
          dedupeKey: 'SEGMENT_OVERAGE_REPORTED:700',
          params: expect.objectContaining({ piCode: 'PI-2026-500', shortageQty: 15 }) as unknown,
        }),
      );
    });

    it('afterReviewCommitted: công tắc tắt hoặc lô không có dòng chưa đóng thì không phát tin; lỗi emit chỉ ghi log', async () => {
      await service.afterReviewCommitted(700n, 'kcs-1');
      expect(notificationsService.emit).not.toHaveBeenCalled();

      prisma.segmentOverage.findMany.mockResolvedValue([
        {
          stage: MfgStage.SON,
          shortageQty: 1,
          extraQty: 2,
          extraKind: 'REWORK',
          productionInvoice: { code: 'PI-1' },
          productionBatch: { piece: { code: 'M40' } },
        },
      ]);
      notificationsService.emit.mockRejectedValue(new Error('boom'));
      await expect(service.afterReviewCommitted(700n, 'kcs-1')).resolves.toBeUndefined();
    });

    it('báo vượt số lượng tổng của lệnh: ghi số lấy thêm; đã có KCS lỗi trước thì là làm lại (REWORK)', async () => {
      // Đã chấm (QC_DONE) trước 15, lô này 20 -> tổng 35 / lệnh 20 mảnh -> vượt 15 mảnh.
      prisma.productionBatch.findMany.mockResolvedValue([
        { id: 650n, reportedQty: 15, status: 'QC_DONE' },
      ]);
      prisma.qcReview.aggregate.mockResolvedValue({ _sum: { failedQty: 3 } });
      segmentStock.consumeForOrder.mockImplementation((_tx: unknown, i: { qty: number }) =>
        Promise.resolve({
          takenQty: i.qty,
          fromHeldQty: 0,
          fromSurplusQty: i.qty,
          shortageQty: 0,
          duplicate: false,
        }),
      );

      await consume();

      expect(prisma.segmentOverage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          segmentSpecId: 60n,
          segmentSteps: 'DAP',
          overPieces: 15,
          extraQty: 30,
          extraKind: 'REWORK',
        }) as unknown,
      });
      expect(prisma.segmentOverage.create).toHaveBeenCalledTimes(3);
    });

    it('rà soát 14/11 TĐ2: trừ (khoá ô) theo thứ tự mã đoạn cố định, không theo thứ tự định mức trả về', async () => {
      prisma.pieceBom.findMany.mockResolvedValue([
        { segmentSpecId: 61n, qtyPerPiece: 1, processSteps: ['CAT'] },
        { segmentSpecId: 60n, qtyPerPiece: 2, processSteps: ['CAT', 'DAP'] },
        { segmentSpecId: 60n, qtyPerPiece: 1, processSteps: ['CAT'] },
      ]);
      segmentStock.consumeForOrder.mockImplementation(takeAll);

      await consume();

      const order = (
        segmentStock.consumeForOrder.mock.calls as [
          unknown,
          { segmentSpecId: bigint; segmentSteps: string },
        ][]
      ).map(([, i]) => `${i.segmentSpecId}|${i.segmentSteps}`);
      expect(order).toEqual(['60|', '60|DAP', '61|']);
    });

    it('MF10 (phản biện 10): chỉ cộng các lô ĐÃ trừ đoạn (QC_DONE, hoặc đã có bút toán / sổ báo vượt) - lô khác đang chờ chấm chưa trừ gì thì KHÔNG cộng', async () => {
      // Kế hoạch 20 mảnh. Lô 900 đã chấm (QC_DONE) 12; lô 901 chờ chấm 30, chưa trừ gì; lô 902 gửi trước khi cập nhật, đã có bút toán 5;
      // lô 903 gửi trước khi cập nhật, chỉ có dòng sổ báo vượt 4. Lô này 20 -> trước đó 12 + 5 + 4 = 21 (đã vượt) + 20 -> vượt thêm 20.
      prisma.productionBatch.findMany.mockResolvedValue([
        { id: 900n, reportedQty: 12, status: 'QC_DONE' },
        { id: 901n, reportedQty: 30, status: 'AWAITING_QC' },
        { id: 902n, reportedQty: 5, status: 'AWAITING_QC' },
        { id: 903n, reportedQty: 4, status: 'AWAITING_QC' },
      ]);
      prisma.stockLedger.findMany.mockResolvedValue([{ refId: '902' }]);
      prisma.segmentOverage.findMany.mockResolvedValue([{ productionBatchId: 903n }]);
      segmentStock.consumeForOrder.mockImplementation(takeAll);

      await consume();

      expect(prisma.productionBatch.findMany).toHaveBeenCalledWith({
        where: {
          productionOrderId: 1n,
          pieceId: 40n,
          stage: MfgStage.HAN,
          status: { not: 'OPEN' },
          id: { not: 700n },
        },
        select: { id: true, reportedQty: true, status: true },
      });
      // Chỉ tra bút toán / sổ báo vượt của lô CHƯA QC_DONE.
      expect(prisma.stockLedger.findMany).toHaveBeenCalledWith({
        where: { refType: 'SEGMENT_CONSUME', refId: { in: ['901', '902', '903'] } },
        select: { refId: true },
      });
      expect(prisma.segmentOverage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ overPieces: 20, extraKind: 'OVER_REPORT' }) as unknown,
      });
    });

    it('MF10: kế hoạch 100, 2 lô 60 - lô chấm trước không vượt; lô chấm sau vượt đúng 20', async () => {
      // Kế hoạch: lệnh 50 bộ × 2 mảnh = 100.
      const planRow = (id: bigint) => ({
        id,
        pieceId: 40n,
        stage: MfgStage.HAN,
        reportedById: 'user-han',
        productionOrderId: 1n,
        reworkOfId: null,
        productionOrder: {
          bomRevisionId: 5n,
          quantity: 50,
          productionInvoiceItem: { productionInvoiceId: 500n },
        },
      });
      prisma.pieceBom.findMany.mockResolvedValue([
        { segmentSpecId: 60n, qtyPerPiece: 1, processSteps: ['CAT'] },
      ]);
      segmentStock.consumeForOrder.mockImplementation(takeAll);

      // Lô 1 chấm trước: lô 2 còn AWAITING_QC chưa trừ gì -> không cộng.
      prisma.productionBatch.findUniqueOrThrow.mockResolvedValue(planRow(700n));
      prisma.productionBatch.findMany.mockResolvedValue([
        { id: 701n, reportedQty: 60, status: 'AWAITING_QC' },
      ]);
      await service.consumeSegmentsAtReviewInTx(tx(), 700n, 60, 'kcs-1');
      expect(prisma.segmentOverage.create).not.toHaveBeenCalled();

      // Lô 2 chấm sau: lô 1 đã QC_DONE 60 -> 120 / 100 = vượt 20.
      prisma.productionBatch.findUniqueOrThrow.mockResolvedValue(planRow(701n));
      prisma.productionBatch.findMany.mockResolvedValue([
        { id: 700n, reportedQty: 60, status: 'QC_DONE' },
      ]);
      await service.consumeSegmentsAtReviewInTx(tx(), 701n, 60, 'kcs-2');
      expect(prisma.segmentOverage.create).toHaveBeenCalledTimes(1);
      expect(prisma.segmentOverage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ productionBatchId: 701n, overPieces: 20 }) as unknown,
      });
    });

    it('rà soát 14/11 TĐ5: giữ khoá chuyển đổi dữ liệu cũ (dùng chung) rồi mới tới khoá đợt (lockBatchKeysInTx), lấy lại khi trừ không chờ', async () => {
      segmentStock.consumeForOrder.mockImplementation(takeAll);

      await consume();

      const locks = (prisma.$executeRaw.mock.calls as [TemplateStringsArray, string][]).map(
        ([sql, key]) => `${sql.join('?').includes('_shared') ? 'shared' : 'excl'}:${key}`,
      );
      expect(locks).toEqual([
        'shared:segment-legacy-conversion',
        'excl:production-batch-open:1:40:HAN',
        'shared:segment-legacy-conversion',
        'excl:production-batch-open:1:40:HAN',
      ]);
    });

    it('gọi lại cùng lô: mã đoạn đã có dòng sổ báo vượt thì bỏ qua, không trừ lần 2', async () => {
      prisma.productionBatch.findMany.mockResolvedValue([]);
      prisma.segmentOverage.findUnique.mockResolvedValue({ id: 1n });

      await consume();

      expect(segmentStock.consumeForOrder).not.toHaveBeenCalled();
    });

    it.each([
      ['đã có bút toán SEGMENT_CONSUME refId = id lô (khoá bất kỳ)', 'ledger'],
      ['đã có dòng sổ báo vượt đoạn của lô', 'overage'],
    ])('AC36: lô gửi KCS trước khi cập nhật (%s) - BỎ QUA, không trừ lần 2', async (_n, kind) => {
      if (kind === 'ledger') prisma.stockLedger.findFirst.mockResolvedValue({ id: 5n });
      else prisma.segmentOverage.findFirst.mockResolvedValue({ id: 6n });

      await consume(16);

      expect(prisma.stockLedger.findFirst).toHaveBeenCalledWith({
        where: { refType: 'SEGMENT_CONSUME', refId: '700' },
        select: { id: true },
      });
      expect(segmentStock.consumeForOrder).not.toHaveBeenCalled();
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
      expect(prisma.segmentOverage.create).not.toHaveBeenCalled();
    });

    it('thực có = 0 (toàn bộ là thiếu): vẫn lấy khoá nhưng không trừ gì', async () => {
      await consume(0);

      expect(prisma.$executeRaw).toHaveBeenCalled();
      expect(segmentStock.consumeForOrder).not.toHaveBeenCalled();
    });
  });

  describe('consumeSegmentsAtReviewInTx - công tắc TẮT (cách trừ cũ, bút toán SEGMENT_CONSUME)', () => {
    const env = process.env.SEGMENT_STOCK_ENABLED;
    const tx = () => prisma as unknown as PrismaTx;
    const lot = (over: Record<string, unknown> = {}) => ({
      id: 700n,
      pieceId: 40n,
      stage: MfgStage.HAN,
      reportedById: 'user-han',
      productionOrderId: 1n,
      productionOrder: { bomRevisionId: 5n },
      ...over,
    });
    beforeEach(() => {
      delete process.env.SEGMENT_STOCK_ENABLED;
      prisma.productionBatch.findUniqueOrThrow.mockResolvedValue(lot());
    });
    afterEach(() => {
      if (env === undefined) delete process.env.SEGMENT_STOCK_ENABLED;
      else process.env.SEGMENT_STOCK_ENABLED = env;
    });

    it('create() KHÔNG còn trừ đoạn và không phát SEGMENT_OVERAGE_REPORTED (dời sang lúc KCS chấm)', async () => {
      prisma.productionBatch.create.mockResolvedValue(batchRow);
      prisma.pieceBom.findMany.mockResolvedValue([
        { id: 1n, bomRevisionId: 5n, pieceId: 40n, segmentSpecId: 60n, qtyPerPiece: 3 },
      ]);

      await service.create(
        '1',
        { stage: MfgStage.HAN, pieceId: '40', reportedQty: 20 },
        'u',
        null,
        null,
      );

      expect(prisma.pieceBom.findMany).not.toHaveBeenCalled();
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
      expect(notificationsService.emit).not.toHaveBeenCalled();
    });

    it('không có PieceBom nào cho mảnh - không gọi postEntry, không query kho đoạn', async () => {
      prisma.pieceBom.findMany.mockResolvedValue([]);

      await service.consumeSegmentsAtReviewInTx(tx(), 700n, 20, 'kcs-1');

      expect(prisma.pieceBom.findMany).toHaveBeenCalledWith({
        where: { bomRevisionId: order.bomRevisionId, pieceId: 40n },
      });
      expect(prisma.warehouse.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    it('1 PieceBom - ghi đúng 1 dòng StockLedger, qty = qtyPerPiece × số thực có; người ghi = người báo của lô', async () => {
      prisma.pieceBom.findMany.mockResolvedValue([
        { id: 1n, bomRevisionId: 5n, pieceId: 40n, segmentSpecId: 60n, qtyPerPiece: 3 },
      ]);

      await service.consumeSegmentsAtReviewInTx(tx(), 700n, 20, 'kcs-1');

      expect(stockLedgerService.postEntry).toHaveBeenCalledTimes(1);
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        {
          fromWarehouseId: steelWarehouse.id,
          toWarehouseId: productionWarehouse.id,
          segmentSpecId: 60n,
          qty: 60, // 3 × thực có(20)
          refType: StockLedgerRefType.SEGMENT_CONSUME,
          refId: '700',
          createdById: 'user-han',
          idempotencyKey: 'production-batch-segment-consume:700:60',
        },
        prisma,
      );
    });

    it('lô thiếu 4 (báo 20, thực có 16): trừ theo 16, không theo 20', async () => {
      prisma.pieceBom.findMany.mockResolvedValue([
        { id: 1n, bomRevisionId: 5n, pieceId: 40n, segmentSpecId: 60n, qtyPerPiece: 3 },
      ]);

      await service.consumeSegmentsAtReviewInTx(tx(), 700n, 16, 'kcs-1');

      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({ segmentSpecId: 60n, qty: 48 }),
        prisma,
      );
    });

    // 13/11/2026: 1 mảnh có 2 dòng định mức CÙNG cỡ đoạn khác công đoạn (vd 460 mm có Dập + 460 mm trơn) - trước đây dòng thứ
    // 2 đụng khoá chống trùng (đợt, cỡ đoạn) nên bị bỏ, trừ thiếu đoạn.
    it('2 dòng định mức cùng cỡ đoạn khác công đoạn: gộp lại, trừ đủ trong 1 bút toán', async () => {
      prisma.pieceBom.findMany.mockResolvedValue([
        { id: 1n, segmentSpecId: 60n, qtyPerPiece: 2, processSteps: ['CAT', 'DAP'] },
        { id: 2n, segmentSpecId: 60n, qtyPerPiece: 1, processSteps: ['CAT'] },
        { id: 3n, segmentSpecId: 61n, qtyPerPiece: 4, processSteps: ['CAT'] },
      ]);

      await service.consumeSegmentsAtReviewInTx(tx(), 700n, 20, 'kcs-1');

      expect(stockLedgerService.postEntry).toHaveBeenCalledTimes(2);
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          segmentSpecId: 60n,
          qty: 60, // (2 + 1) × 20
          idempotencyKey: 'production-batch-segment-consume:700:60',
        }),
        prisma,
      );
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({ segmentSpecId: 61n, qty: 80 }),
        prisma,
      );
    });

    it('Đợt 7: lệnh làm ở xưởng Phước An thì trừ đoạn sắt ở kho Phôi Phước An (tra mã kho bằng chính tx)', async () => {
      prisma.pieceBom.findMany.mockResolvedValue([
        { id: 1n, bomRevisionId: 5n, pieceId: 40n, segmentSpecId: 60n, qtyPerPiece: 3 },
      ]);
      prisma.productionInvoiceItem.findFirst.mockResolvedValue({ workshopId: 2n });

      await service.consumeSegmentsAtReviewInTx(tx(), 700n, 20, 'kcs-1');

      const [findArg] = prisma.warehouse.findFirst.mock.calls[0] as [
        { where: { kind: string; workshopId: bigint } },
      ];
      expect(findArg.where).toMatchObject({ kind: 'PHOI', workshopId: 2n });
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({ fromWarehouseId: steelWarehouse2.id }),
        prisma,
      );
    });

    it('nhiều PieceBom (1 mảnh ghép từ nhiều cỡ đoạn) - ghi đủ N dòng StockLedger, mỗi dòng đúng segmentSpecId/qty riêng', async () => {
      prisma.pieceBom.findMany.mockResolvedValue([
        { id: 1n, bomRevisionId: 5n, pieceId: 40n, segmentSpecId: 60n, qtyPerPiece: 3 },
        { id: 2n, bomRevisionId: 5n, pieceId: 40n, segmentSpecId: 61n, qtyPerPiece: 1 },
      ]);

      await service.consumeSegmentsAtReviewInTx(tx(), 700n, 20, 'kcs-1');

      expect(stockLedgerService.postEntry).toHaveBeenCalledTimes(2);
      expect(stockLedgerService.postEntry).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ segmentSpecId: 60n, qty: 60 }),
        prisma,
      );
      expect(stockLedgerService.postEntry).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ segmentSpecId: 61n, qty: 20 }),
        prisma,
      );
    });

    it('postEntry lỗi giữa chừng (dòng 2/2) - lỗi propagate ra ngoài, không nuốt (transaction chấm của KCS sẽ rollback cả lần chấm)', async () => {
      prisma.pieceBom.findMany.mockResolvedValue([
        { id: 1n, bomRevisionId: 5n, pieceId: 40n, segmentSpecId: 60n, qtyPerPiece: 3 },
        { id: 2n, bomRevisionId: 5n, pieceId: 40n, segmentSpecId: 61n, qtyPerPiece: 1 },
      ]);
      stockLedgerService.postEntry
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('mất kết nối DB giữa chừng'));

      await expect(service.consumeSegmentsAtReviewInTx(tx(), 700n, 20, 'kcs-1')).rejects.toThrow(
        'mất kết nối DB giữa chừng',
      );
    });

    // Quyết định nghiệp vụ #6 (docs/quy-doi-doan-phoi.md): tồn đoạn được phép âm khi báo sản lượng vượt tồn thực tế - service
    // KHÔNG gọi StockQuant kiểm số dư trước khi postEntry().

    // 2026-09-03: mảnh cần CẢ Hàn+Sơn chỉ trừ đoạn đúng 1 lần ở Hàn (bước lắp ráp thật) - Sơn không tiêu thêm đoạn nào.
    it('mảnh cần CẢ Hàn+Sơn - lô Sơn chấm KHÔNG trừ tồn đoạn lần 2 (đã trừ ở Hàn)', async () => {
      prisma.productionBatch.findUniqueOrThrow.mockResolvedValue(lot({ stage: MfgStage.SON }));
      prisma.pieceBom.findMany.mockResolvedValue([
        { id: 1n, bomRevisionId: 5n, pieceId: 40n, segmentSpecId: 60n, qtyPerPiece: 3 },
      ]);

      await service.consumeSegmentsAtReviewInTx(tx(), 700n, 20, 'kcs-2');

      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    it('mảnh CHỈ cần Sơn (needsHan=false) - lô Sơn chấm VẪN trừ tồn đoạn (không có Hàn nào trừ trước)', async () => {
      prisma.bomPiece.findUnique.mockResolvedValue({
        ...bomPieceRow,
        needsHan: false,
        needsSon: true,
      });
      prisma.productionBatch.findUniqueOrThrow.mockResolvedValue(lot({ stage: MfgStage.SON }));
      prisma.pieceBom.findMany.mockResolvedValue([
        { id: 1n, bomRevisionId: 5n, pieceId: 40n, segmentSpecId: 60n, qtyPerPiece: 3 },
      ]);

      await service.consumeSegmentsAtReviewInTx(tx(), 700n, 20, 'kcs-2');

      expect(stockLedgerService.postEntry).toHaveBeenCalledTimes(1);
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({ segmentSpecId: 60n, qty: 60 }),
        prisma,
      );
    });
  });

  // "Lưu đợt"/"Gửi KCS" (2026-09-08 VTTP ChotPanel, mở rộng 2026-09-09 cho cả Phôi/Hàn/Sơn) - xem
  // doc comment 2 method: trừ tồn đoạn sắt Ở finishProductionBatch(), KHÔNG PHẢI recordProductionBatch()
  // (idempotencyKey cố định theo batch.id sẽ trừ THIẾU nếu gọi lúc reportedQty còn có thể tăng).
  describe('recordProductionBatch / finishProductionBatch (Lưu đợt / Gửi KCS)', () => {
    const recordDto = { stage: MfgStage.HAN, pieceId: '40', qty: 5 };

    it('recordProductionBatch - chưa có dòng OPEN nào - tạo mới, KHÔNG trừ tồn đoạn sắt', async () => {
      prisma.productionBatch.findFirst.mockResolvedValue(null);
      prisma.productionBatch.create.mockResolvedValue({
        ...batchRow,
        status: 'OPEN',
        reportedQty: 5,
      });

      await service.recordProductionBatch('1', recordDto, 'user-han', null);

      expect(prisma.productionBatch.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            stage: MfgStage.HAN,
            productionOrderId: 1n,
            pieceId: 40n,
            reportedQty: 5,
            reportedById: 'user-han',
            status: 'OPEN',
          },
        }),
      );
      expect(prisma.productionBatch.update).not.toHaveBeenCalled();
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    it('2026-10-29: "Lưu đợt" trên web phát realtime PROGRESS (Bảng mốc tính phần chưa gửi KCS); báo QR tại máy thì không phát trùng', async () => {
      prisma.productionBatch.findFirst.mockResolvedValue(null);
      prisma.productionBatch.create.mockResolvedValue({
        ...batchRow,
        status: 'OPEN',
        reportedQty: 5,
      });

      await service.recordProductionBatch('1', recordDto, 'user-han', null);
      expect(realtimeStub.publishEntityChanged).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'PRODUCTION_BATCH', action: 'PROGRESS' }),
      );

      realtimeStub.publishEntityChanged.mockClear();
      await service.recordProductionBatch('1', recordDto, 'cn-han-2', null, 'key-qr', {
        workstationId: 5n,
      });
      expect(realtimeStub.publishEntityChanged).not.toHaveBeenCalled();
    });

    it('P1: transaction giữ khoá FOR UPDATE của cả PI có maxWait 10s + timeout 20s (không dùng mặc định 5s)', async () => {
      prisma.productionBatch.findFirst.mockResolvedValue(null);
      prisma.productionBatch.create.mockResolvedValue({
        ...batchRow,
        status: 'OPEN',
        reportedQty: 5,
      });

      await service.recordProductionBatch('1', recordDto, 'user-han', null);

      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        maxWait: 10_000,
        timeout: 20_000,
      });
    });

    it('2026-10-12: mỗi lần "Lưu đợt" ghi 1 dòng sổ PIECE (người báo, mảnh, số) kể cả khi cộng dồn vào đợt OPEN', async () => {
      prisma.productionBatch.findFirst.mockResolvedValue({
        ...batchRow,
        id: 77n,
        status: 'OPEN',
        reportedQty: 3,
      });
      prisma.productionBatch.update.mockResolvedValue({
        ...batchRow,
        id: 77n,
        status: 'OPEN',
        reportedQty: 8,
      });

      await service.recordProductionBatch('1', recordDto, 'cn-han-2', null, 'key-h');

      expect(prisma.floorReport.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          kind: 'PIECE',
          reportedById: 'cn-han-2',
          idempotencyKey: 'key-h',
          productionBatchId: 77n,
          lines: { create: [{ segmentSpecId: undefined, pieceId: 40n, qty: 5 }] },
        }) as unknown,
      });
    });

    it('2026-10-12: gửi lại CÙNG khoá - trả đợt cũ, KHÔNG cộng reportedQty lần 2', async () => {
      prisma.floorReport.findUnique.mockResolvedValue({
        id: 9n,
        kind: 'PIECE',
        reportedById: 'cn-han-2',
        workstationId: null,
        productionBatchId: 77n,
        lines: [{ segmentSpecId: null, pieceId: 40n, qty: 5 }],
        productionBatch: { stage: MfgStage.HAN, productionOrderId: 1n, pieceId: 40n },
      });
      prisma.productionBatch.findUniqueOrThrow.mockResolvedValue({
        ...batchRow,
        id: 77n,
        status: 'OPEN',
        reportedQty: 8,
      });

      const res = await service.recordProductionBatch('1', recordDto, 'cn-han-2', null, 'key-h');

      expect(res.id).toBe('77');
      expect(prisma.productionBatch.update).not.toHaveBeenCalled();
      expect(prisma.productionBatch.create).not.toHaveBeenCalled();
      expect(prisma.floorReport.create).not.toHaveBeenCalled();
    });

    describe('chặn báo vượt (P1, 18/11/2026)', () => {
      const order240 = { ...order, quantity: 120 }; // qtyPerUnit 2 × 120 = 240 mảnh
      const openRow = { ...batchRow, status: 'OPEN', reportedQty: 15 };

      it('cần 240, đã báo 230, báo 15 -> 400 "tối đa 10", không ghi gì; có logger.warn', async () => {
        prisma.productionOrder.findUnique.mockResolvedValue(order240);
        prisma.productionBatch.aggregate.mockResolvedValue({ _sum: { reportedQty: 230 } });
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

        const err = await service
          .recordProductionBatch('1', { ...recordDto, qty: 15 }, 'user-han', null)
          .catch((e: unknown) => e);

        expect(err).toBeInstanceOf(BadRequestException);
        const message = (err as Error).message;
        expect(message).toContain('cần 240 mảnh, đã báo 230');
        expect(message).toContain('lần này báo được tối đa 10, bạn nhập 15');
        expect(message).toContain('Mảnh tựa (SKU SKU-1, tổ Hàn)');
        expect(message.endsWith('Số cần sai thì báo QLSX.')).toBe(true);
        expect(prisma.productionBatch.create).not.toHaveBeenCalled();
        expect(prisma.productionBatch.update).not.toHaveBeenCalled();
        expect(prisma.floorReport.create).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Chặn báo vượt'));
        warn.mockRestore();
      });

      it('KCS chấm lỗi 12 (đợt QC_DONE bị ghi đè = báo - lỗi, tổng đã báo 218): báo 22 được, overPlanWarning luôn null; báo 23 bị chặn', async () => {
        prisma.productionOrder.findUnique.mockResolvedValue(order240);
        prisma.productionBatch.findFirst.mockResolvedValue(null);
        prisma.productionBatch.create.mockResolvedValue(openRow);
        prisma.productionBatch.aggregate.mockResolvedValue({ _sum: { reportedQty: 218 } });

        const res = await service.recordProductionBatch(
          '1',
          { ...recordDto, qty: 22 },
          'user-han',
          null,
        );
        expect(res.overPlanWarning).toBeNull();
        expect(prisma.productionBatch.create).toHaveBeenCalled();

        await expect(
          service.recordProductionBatch('1', { ...recordDto, qty: 23 }, 'user-han', null),
        ).rejects.toThrow('tối đa 22');
      });

      it('đã đủ: báo thêm 1 -> "tối đa 0"; khoá advisory lấy TRƯỚC khi đọc tổng đã báo (đọc trong khoá)', async () => {
        prisma.productionBatch.aggregate.mockResolvedValue({ _sum: { reportedQty: 20 } });

        await expect(
          service.recordProductionBatch('1', { ...recordDto, qty: 1 }, 'user-han', null),
        ).rejects.toThrow('tối đa 0');

        expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
          prisma.productionBatch.aggregate.mock.invocationCallOrder[0],
        );
      });

      it('mảnh không có trong định mức (số cần 0) -> câu "không cần theo định mức"', async () => {
        prisma.bomPiece.findUnique.mockResolvedValue({ ...bomPieceRow, qtyPerUnit: 0 });

        await expect(
          service.recordProductionBatch('1', recordDto, 'user-han', null),
        ).rejects.toThrow('Lệnh không cần mảnh Mảnh tựa theo định mức');
      });

      it('vai của tổ: HAN / SON / PHOI báo đúng tổ mình thì qua phép kiểm vai', async () => {
        prisma.productionBatch.findFirst.mockResolvedValue(null);
        prisma.productionBatch.create.mockResolvedValue(openRow);
        for (const [stage, role] of [
          [MfgStage.HAN, MfgRole.HAN],
          [MfgStage.SON, MfgRole.SON],
          [MfgStage.PHOI, MfgRole.PHOI],
        ] as const) {
          prisma.bomPiece.findUnique.mockResolvedValue({
            ...bomPieceRow,
            needsHan: stage === MfgStage.HAN,
            needsSon: stage === MfgStage.SON,
          });
          await expect(
            service.recordProductionBatch('1', { ...recordDto, stage }, 'u', role),
          ).resolves.toBeDefined();
        }
      });
    });

    it('overPlanWarning luôn null (không còn cảnh báo vượt nhu cầu)', async () => {
      prisma.productionBatch.findFirst.mockResolvedValue(null);
      prisma.productionBatch.create.mockResolvedValue({
        ...batchRow,
        status: 'OPEN',
        reportedQty: 5,
      });
      prisma.productionBatch.aggregate.mockResolvedValue({ _sum: { reportedQty: 5 } });

      const res = await service.recordProductionBatch('1', recordDto, 'user-han', null);

      expect(res.overPlanWarning).toBeNull();
    });

    // T4-4 (20/11/2026): dòng sổ đã ghi với khoá K - vân tay khớp với recordDto (mảnh 40, 5 cái, HAN, lệnh 1).
    const prevPiece = (over: Record<string, unknown> = {}) => ({
      id: 9n,
      kind: 'PIECE',
      reportedById: 'cn-han-2',
      workstationId: null,
      productionBatchId: 77n,
      lines: [{ segmentSpecId: null, pieceId: 40n, qty: 5 }],
      stepBatch: null,
      cutBundle: null,
      productionBatch: { stage: MfgStage.HAN, productionOrderId: 1n, pieceId: 40n },
      ...over,
    });

    it('gửi lại cùng khoá sau khi QLSX hủy hết (dòng sổ không còn gắn đợt) -> 409 câu hủy, không ghi dòng sổ mới', async () => {
      prisma.floorReport.findUnique.mockResolvedValue(
        prevPiece({ productionBatchId: null, productionBatch: null }),
      );

      await expect(
        service.recordProductionBatch('1', recordDto, 'cn-han-2', null, 'key-h'),
      ).rejects.toThrow(FLOOR_REPORT_REVERSED_REPLAY_MESSAGE);
      expect(prisma.floorReport.create).not.toHaveBeenCalled();
      expect(prisma.productionBatch.create).not.toHaveBeenCalled();
    });

    it('khoá đã dùng cho loại báo khác -> 422 IdempotencyKeyReusedException (trước đây 409)', async () => {
      prisma.floorReport.findUnique.mockResolvedValue(
        prevPiece({ kind: 'CUT', productionBatchId: null, productionBatch: null }),
      );

      const err = await service
        .recordProductionBatch('1', recordDto, 'cn-han-2', null, 'key-h')
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(IdempotencyKeyReusedException);
    });

    describe('T4-4: vân tay khi gửi lại cùng khoá', () => {
      const send = (
        over: {
          qty?: number;
          pieceId?: string;
          user?: string;
          ctx?: { workstationId: bigint };
        } = {},
      ) =>
        service.recordProductionBatch(
          '1',
          { ...recordDto, qty: over.qty ?? 5, pieceId: over.pieceId ?? '40' },
          over.user ?? 'cn-han-2',
          null,
          'key-h',
          over.ctx,
        );
      const lotRow = { ...batchRow, id: 77n, status: 'OPEN', reportedQty: 8 };

      beforeEach(() => {
        prisma.productionBatch.findUniqueOrThrow.mockResolvedValue(lotRow);
      });

      it('cùng người, mảnh, số lượng -> trả đợt cũ, không cộng lần 2, không ghi sổ', async () => {
        prisma.floorReport.findUnique.mockResolvedValue(prevPiece());
        const res = await send();
        expect(res.id).toBe('77');
        expect(prisma.floorReport.create).not.toHaveBeenCalled();
        expect(prisma.productionBatch.update).not.toHaveBeenCalled();
        expect(realtimeStub.publishEntityChanged).not.toHaveBeenCalled();
      });

      it.each([
        ['khác số lượng', { qty: 3 }],
        ['khác mảnh', { pieceId: '41' }],
        ['khác người (tổ Sơn dùng khoá của tổ Hàn)', { user: 'cn-son-1' }],
        ['khác máy', { ctx: { workstationId: 4n } }],
      ])('%s -> 422, không trả đợt của người trước, không ghi sổ', async (_l, over) => {
        prisma.floorReport.findUnique.mockResolvedValue(prevPiece());
        const err = await send(over).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(IdempotencyKeyReusedException);
        expect(prisma.productionBatch.findUniqueOrThrow).not.toHaveBeenCalled();
        expect(prisma.floorReport.create).not.toHaveBeenCalled();
      });

      it('đợt cũ thuộc lệnh / tổ khác -> 422', async () => {
        prisma.floorReport.findUnique.mockResolvedValue(
          prevPiece({
            productionBatch: { stage: MfgStage.SON, productionOrderId: 1n, pieceId: 40n },
          }),
        );
        await expect(send()).rejects.toBeInstanceOf(IdempotencyKeyReusedException);
      });

      it('câu ĐẦU của transaction là try-lock khoá chống trùng, TRƯỚC khoá nghiệp vụ', async () => {
        prisma.productionBatch.create.mockResolvedValue({ ...lotRow, reportedQty: 5 });
        await send();
        const lockCall = prisma.$queryRaw.mock.invocationCallOrder[0];
        const bizLock = prisma.$executeRaw.mock.invocationCallOrder[0];
        expect(lockCall).toBeLessThan(bizLock);
        const [tpl, ...args] = prisma.$queryRaw.mock.calls[0] as unknown as [
          TemplateStringsArray,
          ...string[],
        ];
        expect(tpl.join('?')).toContain('pg_try_advisory_xact_lock');
        expect(args).toEqual(['idem:floor_reports', 'key-h']);
      });

      it('bản trùng đang chạy (try-lock thất bại) -> 409 IdempotencyKeyInUseException, không ghi gì', async () => {
        prisma.$queryRaw.mockResolvedValueOnce([{ ok: false }]);
        const err = await send().catch((e: unknown) => e);
        expect(err).toBeInstanceOf(IdempotencyKeyInUseException);
        expect(prisma.floorReport.create).not.toHaveBeenCalled();
        expect(prisma.productionBatch.create).not.toHaveBeenCalled();
      });

      it('đọc lại trong transaction thấy lần báo vừa commit -> trả đợt cũ, không ghi, không phát realtime', async () => {
        prisma.floorReport.findUnique
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(prevPiece())
          .mockResolvedValue(prevPiece());
        const res = await send();
        expect(res.id).toBe('77');
        expect(prisma.productionBatch.create).not.toHaveBeenCalled();
        expect(prisma.floorReport.create).not.toHaveBeenCalled();
        expect(realtimeStub.publishEntityChanged).not.toHaveBeenCalled();
      });

      it('không có khoá thì không khoá chống trùng', async () => {
        prisma.productionBatch.create.mockResolvedValue({ ...lotRow, reportedQty: 5 });
        await service.recordProductionBatch('1', recordDto, 'cn-han-2', null);
        const tpls = (prisma.$queryRaw.mock.calls as unknown as [TemplateStringsArray][]).map(
          (c) => (Array.isArray(c[0]) ? c[0].join('?') : ''),
        );
        expect(tpls.some((t) => t.includes('pg_try_advisory_xact_lock'))).toBe(false);
      });
    });

    it('recordProductionBatch - đã có dòng OPEN - CỘNG DỒN reportedQty vào đúng dòng đó, không tạo mới', async () => {
      prisma.productionBatch.findFirst.mockResolvedValue({ id: 700n, reportedQty: 5 });
      prisma.productionBatch.update.mockResolvedValue({
        ...batchRow,
        status: 'OPEN',
        reportedQty: 8,
      });

      await service.recordProductionBatch('1', { ...recordDto, qty: 3 }, 'user-han', null);

      expect(prisma.productionBatch.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 700n }, data: { reportedQty: 8 } }),
      );
      expect(prisma.productionBatch.create).not.toHaveBeenCalled();
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    // 2026-10-13 (QR tại máy, mục 22): mỗi công nhân 1 đợt riêng.
    it('recordProductionBatch - chỉ tìm đợt OPEN do CHÍNH người báo mở; sổ ghi máy + PI', async () => {
      prisma.productionBatch.findFirst.mockResolvedValue(null);
      prisma.productionBatch.create.mockResolvedValue({ ...batchRow, status: 'OPEN' });

      await service.recordProductionBatch('1', recordDto, 'cn-han-3', null, 'k-9', {
        workstationId: 4n,
      });

      expect(prisma.productionBatch.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({ status: 'OPEN', reportedById: 'cn-han-3' }) as unknown,
      });
      expect(prisma.floorReport.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ workstationId: 4n, productionInvoiceId: 500n }) as unknown,
      });
    });

    it('recordProductionBatch - stage DAN (không consumable) - BadRequest, không tạo/cộng dồn gì', async () => {
      await expect(
        service.recordProductionBatch('1', { ...recordDto, stage: 'DAN' }, 'user-han', null),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.productionBatch.create).not.toHaveBeenCalled();
    });

    it('finishProductionBatch - batch không ở OPEN - 409 câu "vừa được chốt để chấm"', async () => {
      prisma.productionBatch.findUnique.mockResolvedValue({ ...batchRow, status: 'AWAITING_QC' });

      const err = await service
        .finishProductionBatch('700', 'user-han', null, null)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as Error).message).toBe('Lô này vừa được chốt để chấm - tải lại trang.');
    });

    it('finishProductionBatch - reportedQty = 0 - 400 câu "không còn số nào để chấm"', async () => {
      prisma.productionBatch.findUnique.mockResolvedValue({
        ...batchRow,
        status: 'OPEN',
        reportedQty: 0,
      });

      const err = await service
        .finishProductionBatch('700', 'user-han', null, null)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as Error).message).toBe('Lô này không còn số nào để chấm - tải lại trang.');
    });

    it('opts.gateLabel: lệnh dừng -> 409 câu floor-gate với nhãn "chốt để chấm" (mặc định "gửi KCS")', async () => {
      prisma.productionBatch.findUnique.mockResolvedValue({ ...batchRow, status: 'OPEN' });
      prisma.productionOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.finishProductionBatch('700', 'kcs-1', 'HAN', null, { gateLabel: 'chốt để chấm' }),
      ).rejects.toThrow(
        'PI 500 chưa có SKU nào được QLSX bấm "Bắt đầu" (hoặc đã "Kết thúc") - chưa/không thể chốt để chấm',
      );
      await expect(service.finishProductionBatch('700', 'user-han', null, null)).rejects.toThrow(
        'chưa/không thể gửi KCS',
      );
      expect(prisma.productionBatch.updateMany).not.toHaveBeenCalled();
    });

    it('opts.notifyKcs = false (KCS tự chấm): không phát BATCH_TO_KCS, vẫn phát realtime; vai của tổ (HAN / SON / PHOI) qua phép kiểm vai', async () => {
      for (const [stage, role] of [
        [MfgStage.HAN, 'HAN'],
        [MfgStage.SON, 'SON'],
        [MfgStage.PHOI, 'PHOI'],
      ] as const) {
        prisma.productionBatch.findUnique.mockResolvedValue({
          ...batchRow,
          stage,
          status: 'OPEN',
        });
        prisma.productionBatch.findUniqueOrThrow.mockResolvedValue({
          ...batchRow,
          stage,
          status: 'AWAITING_QC',
        });

        await service.finishProductionBatch('700', 'kcs-1', role, null, {
          notifyKcs: false,
          gateLabel: 'chốt để chấm',
        });
      }

      expect(notificationsService.emit).not.toHaveBeenCalled();
      expect(realtimeStub.publishEntityChanged).toHaveBeenCalledTimes(3);
    });

    it('finishProductionBatch - KHÔNG trừ đoạn: chỉ đổi OPEN -> AWAITING_QC, không đọc định mức đoạn, không ghi sổ kho', async () => {
      prisma.productionBatch.findUnique.mockResolvedValue({
        ...batchRow,
        status: 'OPEN',
        reportedQty: 8,
      });
      prisma.productionBatch.findUniqueOrThrow.mockResolvedValue({
        ...batchRow,
        status: 'AWAITING_QC',
        reportedQty: 8,
      });
      prisma.pieceBom.findMany.mockResolvedValue([
        { id: 1n, bomRevisionId: 5n, pieceId: 40n, segmentSpecId: 60n, qtyPerPiece: 3 },
      ]);

      await service.finishProductionBatch('700', 'user-han', null, null);

      expect(prisma.productionBatch.updateMany).toHaveBeenCalledWith({
        where: { id: 700n, status: 'OPEN', reportedQty: { gt: 0 } },
        data: { status: 'AWAITING_QC' },
      });
      expect(prisma.pieceBom.findMany).not.toHaveBeenCalled();
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
      expect(segmentStock.consumeForOrder).not.toHaveBeenCalled();
      expect(prisma.segmentOverage.create).not.toHaveBeenCalled();
    });

    it('finishProductionBatch - AC52: QLSX vừa hủy hết số (lô mất / còn 0) đúng lúc chốt -> 409 "vừa bị QLSX hủy hết số", không phải "vừa được chốt"', async () => {
      prisma.productionBatch.findUnique
        .mockResolvedValueOnce({ ...batchRow, status: 'OPEN', reportedQty: 8 })
        .mockResolvedValueOnce(null);
      prisma.productionBatch.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.finishProductionBatch('700', 'user-han', null, null)).rejects.toThrow(
        'Lô này vừa bị QLSX hủy hết số - không còn gì để chấm, tải lại trang.',
      );
    });

    it('finishProductionBatch - lô vẫn còn số mà không chốt được (KCS khác vừa chốt) -> 409 "vừa được chốt"', async () => {
      prisma.productionBatch.findUnique
        .mockResolvedValueOnce({ ...batchRow, status: 'OPEN', reportedQty: 8 })
        .mockResolvedValueOnce({ reportedQty: 8 });
      prisma.productionBatch.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.finishProductionBatch('700', 'user-han', null, null)).rejects.toThrow(
        'Lô này vừa được chốt để chấm - tải lại trang.',
      );
    });

    it('finishProductionBatch - phát entity.changed kèm parentId=productionOrderId (2026-10-17, FE lọc banner theo đúng PO đang xem)', async () => {
      prisma.productionBatch.findUnique.mockResolvedValue({ ...batchRow, status: 'OPEN' });
      prisma.productionBatch.findUniqueOrThrow.mockResolvedValue({
        ...batchRow,
        status: 'AWAITING_QC',
      });
      prisma.pieceBom.findMany.mockResolvedValue([]);

      await service.finishProductionBatch('700', 'user-han', null, null);

      expect(realtimeStub.publishEntityChanged).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'PRODUCTION_BATCH',
          entityId: 700n,
          action: 'FINISHED',
          parentId: 1n,
        }),
      );
    });

    // Phase 3b, nhóm 7.5-i, changelog 2026-09-25 mục 19.
    it('emit BATCH_TO_KCS sau khi Hàn/Sơn báo xong đợt', async () => {
      const orderWithPiCode = {
        ...order,
        productionInvoiceItem: {
          salesOrder: { orderCode: 'PO-31' },
          productionInvoice: { code: 'PI-31' },
        },
      };
      prisma.productionBatch.findUnique.mockResolvedValue({
        ...batchRow,
        status: 'OPEN',
        reportedQty: 8,
        productionOrder: orderWithPiCode,
      });
      prisma.productionBatch.findUniqueOrThrow.mockResolvedValue({
        ...batchRow,
        status: 'AWAITING_QC',
        reportedQty: 8,
        productionOrder: orderWithPiCode,
      });
      prisma.pieceBom.findMany.mockResolvedValue([
        { id: 1n, bomRevisionId: 5n, pieceId: 40n, segmentSpecId: 60n, qtyPerPiece: 3 },
      ]);

      await service.finishProductionBatch('700', 'user-han', null, null);

      expect(notificationsService.emit).toHaveBeenCalledWith(
        'BATCH_TO_KCS',
        expect.objectContaining({ entityId: '700', params: { piCode: 'PI-31', stage: 'HAN' } }),
      );
    });

    // mục 22.2 (2026-09-28): `stage` mới thêm vào params để notification-types.ts chọn đúng tab
    // KCS (kcs-han/kcs-son/kcs-phoi) - PHOI cũng có thể ra ProductionBatch (piece không qua
    // CutBundle, xem assertMfgRoleMatchesStage()), phải truyền đúng qua emit() cho cả 3 nhánh.
    it.each([
      [MfgStage.SON, 'user-son'],
      [MfgStage.PHOI, 'user-phoi'],
    ])(
      'emit BATCH_TO_KCS kèm đúng stage=%s để notification-types.ts chọn đúng tab KCS',
      async (stage, reportedById) => {
        const orderWithPiCode = {
          ...order,
          productionInvoiceItem: {
            salesOrder: { orderCode: 'PO-31' },
            productionInvoice: { code: 'PI-31' },
          },
        };
        prisma.productionBatch.findUnique.mockResolvedValue({
          ...batchRow,
          stage,
          status: 'OPEN',
          reportedQty: 8,
          productionOrder: orderWithPiCode,
        });
        prisma.productionBatch.findUniqueOrThrow.mockResolvedValue({
          ...batchRow,
          stage,
          status: 'AWAITING_QC',
          reportedQty: 8,
          productionOrder: orderWithPiCode,
        });
        prisma.pieceBom.findMany.mockResolvedValue(
          stage === MfgStage.PHOI
            ? []
            : [{ id: 1n, bomRevisionId: 5n, pieceId: 40n, segmentSpecId: 60n, qtyPerPiece: 3 }],
        );

        await service.finishProductionBatch('700', reportedById, null, null);

        expect(notificationsService.emit).toHaveBeenCalledWith(
          'BATCH_TO_KCS',
          expect.objectContaining({ entityId: '700', params: { piCode: 'PI-31', stage } }),
        );
      },
    );

    it('finishProductionBatch - không có PieceBom (VTTP) - chuyển AWAITING_QC, KHÔNG gọi postEntry', async () => {
      prisma.productionBatch.findUnique.mockResolvedValue({
        ...batchRow,
        status: 'OPEN',
        reportedQty: 8,
      });
      prisma.productionBatch.findUniqueOrThrow.mockResolvedValue({
        ...batchRow,
        status: 'AWAITING_QC',
        reportedQty: 8,
      });
      prisma.pieceBom.findMany.mockResolvedValue([]);

      await service.finishProductionBatch('700', 'user-phoi', null, null);

      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    // Nghiêm trọng/Cao H3 (đính chính audit độc lập 09/09) - xác nhận có thật qua test trực tiếp
    // trên server+DB dev đang chạy (script gọi HTTP thật, không chỉ suy luận qua đọc code): 12/13
    // lần tái hiện được race giữa "Lưu đợt" (recordProductionBatch) và "Gửi KCS"
    // (finishProductionBatch) cho cùng batch - batch cuối cùng hiển thị AWAITING_QC nhưng
    // reportedQty bị "Lưu đợt" ghi tăng SAU KHI đã gửi KCS, trong khi postSegmentConsumeEntries đã
    // trừ tồn theo số CŨ (thấp hơn) - sai lệch vĩnh viễn giữa sản lượng hiển thị và tồn kho đã trừ.
    it('CHẶN (409, rollback) nếu batch đã bị 1 request "Lưu đợt" khác đóng/ghi đè trong lúc đang gửi KCS - không trừ tồn sai theo số cũ', async () => {
      prisma.productionBatch.findUnique.mockResolvedValue({
        ...batchRow,
        status: 'OPEN',
        reportedQty: 8,
      });
      prisma.productionBatch.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.finishProductionBatch('700', 'user-han', null, null)).rejects.toThrow(
        ConflictException,
      );
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    it('khoá advisory CÙNG key với recordProductionBatch() ("Lưu đợt") - 2 thao tác tự loại trừ lẫn nhau', async () => {
      prisma.productionBatch.findUnique.mockResolvedValue({
        ...batchRow,
        status: 'OPEN',
        reportedQty: 8,
      });
      prisma.productionBatch.findUniqueOrThrow.mockResolvedValue({
        ...batchRow,
        status: 'AWAITING_QC',
        reportedQty: 8,
      });
      prisma.pieceBom.findMany.mockResolvedValue([]);

      await service.finishProductionBatch('700', 'user-han', null, null);

      expect(prisma.$executeRaw).toHaveBeenCalled();
      const lockCallOrder = prisma.$executeRaw.mock.invocationCallOrder[0];
      const updateManyCallOrder = prisma.productionBatch.updateMany.mock.invocationCallOrder[0];
      expect(lockCallOrder).toBeLessThan(updateManyCallOrder);
    });

    it('rà soát 14/11 TĐ5: bật tồn đoạn thì Gửi KCS giữ khoá chuyển đổi (dùng chung) TRƯỚC khoá đợt - không khoá chéo với lượt chuyển đổi', async () => {
      const env = process.env.SEGMENT_STOCK_ENABLED;
      process.env.SEGMENT_STOCK_ENABLED = 'true';
      try {
        prisma.productionBatch.findUnique.mockResolvedValue({
          ...batchRow,
          status: 'OPEN',
          reportedQty: 8,
        });
        prisma.productionBatch.findUniqueOrThrow.mockResolvedValue({
          ...batchRow,
          status: 'AWAITING_QC',
          reportedQty: 8,
        });
        prisma.pieceBom.findMany.mockResolvedValue([]);

        await service.finishProductionBatch('700', 'user-han', null, null);

        const [first, second] = prisma.$executeRaw.mock.calls as [TemplateStringsArray, string][];
        expect(first[0].join('?')).toContain('pg_advisory_xact_lock_shared');
        expect(first[1]).toBe('segment-legacy-conversion');
        expect(second[1]).toMatch(/^production-batch-open:/);
      } finally {
        if (env === undefined) delete process.env.SEGMENT_STOCK_ENABLED;
        else process.env.SEGMENT_STOCK_ENABLED = env;
      }
    });
  });

  // 2026-09-04: postMaterialYieldConsumeEntry() đã bị XOÁ (trừ tồn kép với MaterialYieldIssuesService
  // - xem production-batches.service.ts). describe('create - trừ tồn nguyên liệu vật tư thành phẩm
  // (MATERIAL_YIELD_CONSUME)') cũ đã xoá theo (kể cả bản đã cập nhật tham số warehouseScope từ
  // nhánh khotp-instance, PR #34 - vẫn xoá vì hành vi bị test không còn tồn tại) - test cho việc
  // trừ tồn giờ nằm ở material-yield-issues.service.spec.ts. Test ràng buộc "chưa nhận thì chưa
  // báo được" mới ở describe('create/recordPieceStepBatch - chặn khi chưa nhận vật tư thành phẩm')
  // bên dưới.

  describe('getBatchPlan', () => {
    it('lọc bomPiece theo needsHan=true khi stage=HAN', async () => {
      await service.getBatchPlan('1', MfgStage.HAN);

      expect(prisma.bomPiece.findMany).toHaveBeenCalledWith({
        where: { bomRevisionId: order.bomRevisionId, needsHan: true },
        include: { piece: true },
      });
    });

    it('lọc bomPiece theo needsSon=true khi stage=SON', async () => {
      await service.getBatchPlan('1', MfgStage.SON);

      expect(prisma.bomPiece.findMany).toHaveBeenCalledWith({
        where: { bomRevisionId: order.bomRevisionId, needsSon: true },
        include: { piece: true },
      });
    });

    it('lọc bomPiece theo needsHan=false khi stage=PHOI ("vật tư thành phẩm")', async () => {
      await service.getBatchPlan('1', MfgStage.PHOI);

      expect(prisma.bomPiece.findMany).toHaveBeenCalledWith({
        where: { bomRevisionId: order.bomRevisionId, needsHan: false },
        include: { piece: true },
      });
    });

    it('trả về đúng mảnh khi có needsHan=true (không bị lọc mất)', async () => {
      const result = await service.getBatchPlan('1', MfgStage.HAN);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].pieceId).toBe('40');
    });

    it('stage=HAN không query PieceMaterialYield/StockQuant (rawMaterialOnHand luôn null)', async () => {
      const result = await service.getBatchPlan('1', MfgStage.HAN);

      expect(prisma.pieceMaterialYield.findMany).not.toHaveBeenCalled();
      expect(prisma.stockQuant.findMany).not.toHaveBeenCalled();
      expect(result.items[0].rawMaterialOnHand).toBeNull();
    });

    it('stage=PHOI với piece có PieceMaterialYield - trả rawMaterialOnHand = Σ StockQuant.qty của material đó', async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([
        { pieceId: 40n, materialId: 80n, piecesPerBar: 12, processSteps: [], qtyPerPiece: null },
      ]);
      prisma.stockQuant.findMany.mockResolvedValue([
        { materialId: 80n, qty: { toNumber: () => 5 } },
        { materialId: 80n, qty: { toNumber: () => 3 } },
      ]);

      const result = await service.getBatchPlan('1', MfgStage.PHOI);

      expect(result.items[0].rawMaterialOnHand).toBe(8);
    });

    it('stage=PHOI không có PieceMaterialYield nào - rawMaterialOnHand null, không query StockQuant', async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([]);

      const result = await service.getBatchPlan('1', MfgStage.PHOI);

      expect(prisma.stockQuant.findMany).not.toHaveBeenCalled();
      expect(result.items[0].rawMaterialOnHand).toBeNull();
    });

    // 2026-08-22: "pat" - piece 41 needsHan=true, KHÔNG nằm trong kết quả needsHan=false, nhưng
    // vẫn phải xuất hiện ở danh sách báo PHOI vì có PieceMaterialYield (cắt từ tấm sắt lá).
    it('stage=PHOI gộp thêm piece needsHan=true CÓ PieceMaterialYield ("pat") vào danh sách, cạnh piece needsHan=false', async () => {
      const patPiece = { id: 41n, code: 'PAT-01', name: 'Pat' };
      const patBomPiece = {
        id: 2n,
        bomRevisionId: 5n,
        pieceId: 41n,
        qtyPerUnit: 3,
        needsHan: true,
        needsSon: false,
        piece: patPiece,
      };
      prisma.bomPiece.findMany
        // Cuộc gọi 1: needsHan=false (mock mặc định đã trả [{...bomPieceRow, piece}] - piece 40)
        .mockResolvedValueOnce([{ ...bomPieceRow, piece }])
        // Cuộc gọi 2 (extra, cho pieceId có yield nhưng chưa nằm trong needsHan=false): trả pat.
        .mockResolvedValueOnce([patBomPiece]);
      prisma.pieceMaterialYield.findMany.mockResolvedValue([
        { pieceId: 41n, materialId: 90n, piecesPerBar: 6, processSteps: [], qtyPerPiece: null },
      ]);

      const result = await service.getBatchPlan('1', MfgStage.PHOI);

      expect(result.items.map((i) => i.pieceId)).toEqual(['40', '41']);
      expect(prisma.bomPiece.findMany).toHaveBeenNthCalledWith(2, {
        where: { bomRevisionId: order.bomRevisionId, pieceId: { in: [41n] } },
        include: { piece: true },
      });
    });
  });

  describe('getBatchPlanBatch (2026-08-31 - gộp nhiều order 1 lần cho Bảng thống kê)', () => {
    it('mảng rỗng - trả {} ngay, không query gì', async () => {
      const result = await service.getBatchPlanBatch([], MfgStage.HAN);

      expect(result).toEqual({});
      expect(prisma.productionOrder.findMany).not.toHaveBeenCalled();
    });

    it('chặn stage không hợp lệ (assertConsumableStage) trước khi query gì', async () => {
      await expect(service.getBatchPlanBatch(['1'], MfgStage.DAN)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.productionOrder.findMany).not.toHaveBeenCalled();
    });

    it('trả đúng plan cho 1 order, khớp getBatchPlan (stage=HAN)', async () => {
      const result = await service.getBatchPlanBatch(['1'], MfgStage.HAN);

      expect(result['1'].poNumber).toBe(order.poNumber);
      expect(result['1'].items).toHaveLength(1);
      expect(result['1'].items[0].pieceId).toBe('40');
      expect(result['1'].items[0].plannedQty).toBe(bomPieceRow.qtyPerUnit * order.quantity);
      expect(result['1'].items[0].qtyPerUnit).toBe(bomPieceRow.qtyPerUnit);
    });

    it('getBatchPlan trả qtyPerUnit và có trong JSON sau serialize (lỗi B, 17/11/2026)', async () => {
      const result = await service.getBatchPlan('1', MfgStage.HAN);

      expect(result.items[0].qtyPerUnit).toBe(bomPieceRow.qtyPerUnit);
      expect(result.items[0].plannedQty).toBe(result.items[0].qtyPerUnit * order.quantity);
      const plain = instanceToPlain(result.items[0]);
      expect(plain.qtyPerUnit).toBe(bomPieceRow.qtyPerUnit);
    });

    it('2 order khác nhau CÙNG bomRevisionId - dùng chung 1 query bomPiece nhưng KHÔNG lẫn awaiting/passed qty của nhau', async () => {
      const order2 = {
        ...order,
        id: 2n,
        poNumber: 'PO-32-1',
        quantity: 5,
        productionInvoiceItem: { salesOrder: { orderCode: 'PO-32' } },
      };
      prisma.productionOrder.findMany.mockResolvedValue([order, order2]);
      prisma.productionBatch.findMany.mockResolvedValue([
        { productionOrderId: 1n, pieceId: 40n, status: 'AWAITING_QC', reportedQty: 20 },
        { productionOrderId: 2n, pieceId: 40n, status: 'AWAITING_QC', reportedQty: 7 },
      ]);

      const result = await service.getBatchPlanBatch(['1', '2'], MfgStage.HAN);

      expect(result['1'].items[0].awaitingQcQty).toBe(20);
      expect(result['2'].items[0].awaitingQcQty).toBe(7);
      // Cùng bomRevisionId (5n) cho cả 2 order - chỉ query bomPiece.findMany đúng 1 lần cho cả batch.
      expect(prisma.bomPiece.findMany).toHaveBeenCalledTimes(1);
    });

    it('2026-10-16: đợt OPEN (đã Lưu đợt, chưa gửi KCS) cộng vào openQty của ĐÚNG order, không lẫn sang chờ/đạt', async () => {
      const order2 = { ...order, id: 2n, poNumber: 'PO-32-1', quantity: 5 };
      prisma.productionOrder.findMany.mockResolvedValue([order, order2]);
      prisma.productionBatch.findMany.mockResolvedValue([
        { productionOrderId: 1n, pieceId: 40n, status: 'OPEN', reportedQty: 4 },
        { productionOrderId: 1n, pieceId: 40n, status: 'OPEN', reportedQty: 2 },
        { productionOrderId: 1n, pieceId: 40n, status: 'QC_DONE', reportedQty: 9 },
        { productionOrderId: 2n, pieceId: 40n, status: 'AWAITING_QC', reportedQty: 7 },
      ]);

      const result = await service.getBatchPlanBatch(['1', '2'], MfgStage.HAN);

      expect(result['1'].items[0]).toMatchObject({ openQty: 6, awaitingQcQty: 0, passedQty: 9 });
      expect(result['2'].items[0]).toMatchObject({ openQty: 0, awaitingQcQty: 7, passedQty: 0 });
    });

    it('getBatchPlan (1 order) cũng trả openQty', async () => {
      prisma.productionBatch.findMany.mockResolvedValue([
        { productionOrderId: 1n, pieceId: 40n, status: 'OPEN', reportedQty: 3 },
        { productionOrderId: 1n, pieceId: 40n, status: 'AWAITING_QC', reportedQty: 5 },
      ]);

      const result = await service.getBatchPlan('1', MfgStage.HAN);

      expect(result.items[0]).toMatchObject({ openQty: 3, awaitingQcQty: 5, passedQty: 0 });
    });

    it('query productionBatch.findMany với where IN theo mọi orderId + đúng stage đang lọc', async () => {
      await service.getBatchPlanBatch(['1'], MfgStage.SON);

      expect(prisma.productionBatch.findMany).toHaveBeenCalledWith({
        where: { productionOrderId: { in: [1n] }, stage: MfgStage.SON },
        select: { productionOrderId: true, pieceId: true, status: true, reportedQty: true },
      });
    });

    // 2026-08-22 "pat": cùng logic gộp needsHan=false + PieceMaterialYield như getBatchPlan(),
    // chỉ khác chạy theo revision cho cả batch thay vì 1 order.
    it('stage=PHOI vẫn gộp đúng piece "pat" (needsHan=true nhưng có PieceMaterialYield)', async () => {
      const patPiece = { id: 41n, code: 'PAT-01', name: 'Pat' };
      const patBomPiece = {
        id: 2n,
        bomRevisionId: 5n,
        pieceId: 41n,
        qtyPerUnit: 3,
        needsHan: true,
        needsSon: false,
        piece: patPiece,
      };
      prisma.bomPiece.findMany
        .mockResolvedValueOnce([{ ...bomPieceRow, piece }])
        .mockResolvedValueOnce([patBomPiece]);
      prisma.pieceMaterialYield.findMany.mockResolvedValue([
        {
          bomRevisionId: 5n,
          pieceId: 41n,
          materialId: 90n,
          piecesPerBar: 6,
          processSteps: [],
          qtyPerPiece: null,
        },
      ]);

      const result = await service.getBatchPlanBatch(['1'], MfgStage.PHOI);

      expect(result['1'].items.map((i) => i.pieceId)).toEqual(['40', '41']);
    });
  });

  describe('getReadyPoolQty', () => {
    it('trả Map rỗng khi truyền mảng pieceIds rỗng - không query gì', async () => {
      const result = await service.getReadyPoolQty([]);

      expect(result.size).toBe(0);
      expect(prisma.productionBatch.findMany).not.toHaveBeenCalled();
    });

    it('gộp Σ reportedQty (QC_DONE, stage=PHOI) TOÀN HỆ THỐNG - không lọc theo productionOrderId, trừ đi phần đã chuyển kho', async () => {
      prisma.productionBatch.findMany.mockResolvedValue([
        { pieceId: 40n, reportedQty: 20 }, // đơn hàng A
        { pieceId: 40n, reportedQty: 15 }, // đơn hàng B khác - vẫn cộng chung 1 pool
      ]);
      prisma.warehouseTransferPieceItem.findMany.mockResolvedValue([
        { pieceId: 40n, quantity: 10 },
      ]);

      const result = await service.getReadyPoolQty([40n]);

      expect(result.get('40')).toBe(25); // (20 + 15) - 10
    });

    it('không âm - qty đã chuyển vượt qty QC_DONE thì kẹp về 0', async () => {
      prisma.productionBatch.findMany.mockResolvedValue([{ pieceId: 40n, reportedQty: 5 }]);
      prisma.warehouseTransferPieceItem.findMany.mockResolvedValue([{ pieceId: 40n, quantity: 8 }]);

      const result = await service.getReadyPoolQty([40n]);

      expect(result.get('40')).toBe(0);
    });
  });

  // 2026-09-04: tiến độ theo công đoạn (Cắt/Uốn/...) cho vật tư thành phẩm - mirror
  // getStepProgress() bên Sắt (SteelIssuesService) nhưng đơn vị = SỐ MẢNH, không theo cỡ đoạn.
  describe('getBatchPlan/getBatchPlanBatch - failedQty (lỗi KCS cộng dồn, 18/11/2026)', () => {
    const review = (orderId: bigint, pieceId: bigint, failedQty: number, shortQty = 0) => ({
      failedQty,
      shortQty,
      productionBatch: { productionOrderId: orderId, pieceId },
    });

    it('đợt 10 mảnh KCS chấm lỗi 4 -> passedQty 6, failedQty 4', async () => {
      prisma.productionBatch.findMany.mockResolvedValue([
        { pieceId: 40n, status: 'QC_DONE', reportedQty: 6 },
      ]);
      prisma.qcReview.findMany.mockResolvedValue([review(1n, 40n, 4)]);

      const result = await service.getBatchPlan('1', MfgStage.HAN);

      expect(result.items[0]).toMatchObject({ passedQty: 6, failedQty: 4 });
      expect(instanceToPlain(result.items[0]).failedQty).toBe(4);
    });

    it('P1: KCS ghi thiếu 2 (lô 10: lỗi 4 + thiếu 2 -> đạt 4) -> shortQty 2 ghi RIÊNG, failedQty vẫn chỉ là lỗi (4), không cộng thiếu', async () => {
      prisma.productionBatch.findMany.mockResolvedValue([
        { pieceId: 40n, status: 'QC_DONE', reportedQty: 4 },
      ]);
      prisma.qcReview.findMany.mockResolvedValue([review(1n, 40n, 4, 2)]);

      const result = await service.getBatchPlan('1', MfgStage.HAN);

      expect(result.items[0]).toMatchObject({ passedQty: 4, failedQty: 4, shortQty: 2 });
      expect(instanceToPlain(result.items[0]).shortQty).toBe(2);
    });

    it('thêm đợt bù 4 đạt -> passedQty 10, failedQty vẫn 4', async () => {
      prisma.productionBatch.findMany.mockResolvedValue([
        { pieceId: 40n, status: 'QC_DONE', reportedQty: 6 },
        { pieceId: 40n, status: 'QC_DONE', reportedQty: 4 },
      ]);
      prisma.qcReview.findMany.mockResolvedValue([review(1n, 40n, 4), review(1n, 40n, 0)]);

      const result = await service.getBatchPlan('1', MfgStage.HAN);

      expect(result.items[0]).toMatchObject({ passedQty: 10, failedQty: 4 });
    });

    it('mảnh chưa có đợt chấm -> failedQty 0; truy vấn gộp đúng 1 lần, lọc QC_DONE theo lệnh + stage', async () => {
      const result = await service.getBatchPlan('1', MfgStage.HAN);

      expect(result.items[0].failedQty).toBe(0);
      expect(prisma.qcReview.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.qcReview.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            productionBatch: {
              productionOrderId: { in: [order.id] },
              stage: MfgStage.HAN,
              status: 'QC_DONE',
            },
          },
        }),
      );
    });

    it('getBatchPlanBatch: 2 lệnh không lẫn failedQty của nhau', async () => {
      const order2 = { ...order, id: 2n, poNumber: 'PO-32-1', quantity: 5 };
      prisma.productionOrder.findMany.mockResolvedValue([order, order2]);
      prisma.qcReview.findMany.mockResolvedValue([
        review(1n, 40n, 4),
        review(1n, 40n, 1),
        review(2n, 40n, 3),
      ]);

      const result = await service.getBatchPlanBatch(['1', '2'], MfgStage.HAN);

      expect(result['1'].items[0].failedQty).toBe(5);
      expect(result['2'].items[0].failedQty).toBe(3);
      expect(result['1'].items[0].shortQty).toBe(0);
      expect(prisma.qcReview.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('getBatchPlan/getBatchPlanBatch - stepProgress vật tư thành phẩm (2026-09-04)', () => {
    it('stage=HAN không có processSteps/stepProgress (luôn rỗng), KHÔNG query PieceStepBatch', async () => {
      const result = await service.getBatchPlan('1', MfgStage.HAN);

      expect(prisma.pieceStepBatch.groupBy).not.toHaveBeenCalled();
      expect(result.items[0].processSteps).toEqual([]);
      expect(result.items[0].stepProgress).toEqual([]);
      expect(result.items[0].qtyPerPiece).toBeNull();
    });

    it('stage=PHOI, piece có PieceMaterialYield nhưng processSteps RỖNG - stepProgress rỗng (tương thích ngược với luồng cũ)', async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([
        { pieceId: 40n, materialId: 80n, piecesPerBar: 12, processSteps: [], qtyPerPiece: 3 },
      ]);

      const result = await service.getBatchPlan('1', MfgStage.PHOI);

      expect(result.items[0].processSteps).toEqual([]);
      expect(result.items[0].stepProgress).toEqual([]);
      // qtyPerPiece vẫn trả về dù processSteps rỗng - chỉ là phụ chú hiển thị, không phụ thuộc bước.
      expect(result.items[0].qtyPerPiece).toBe(3);
    });

    it('stage=PHOI, processSteps lưu LỘN XỘN thứ tự trong DB (Uốn trước Cắt) - vẫn chuẩn hoá đúng Cắt trước Uốn', async () => {
      const plannedQty = bomPieceRow.qtyPerUnit * order.quantity;
      prisma.pieceMaterialYield.findMany.mockResolvedValue([
        {
          pieceId: 40n,
          materialId: 80n,
          piecesPerBar: 12,
          processSteps: ['UON', 'CAT'],
          qtyPerPiece: 1,
        },
      ]);
      prisma.pieceStepBatch.groupBy.mockResolvedValue([
        { productionOrderId: 1n, pieceId: 40n, step: 'CAT', _sum: { qty: 15 } },
        { productionOrderId: 1n, pieceId: 40n, step: 'UON', _sum: { qty: 5 } },
      ]);

      const result = await service.getBatchPlan('1', MfgStage.PHOI);

      expect(result.items[0].processSteps).toEqual(['CAT', 'UON']);
      expect(result.items[0].stepProgress).toEqual([
        {
          step: 'CAT',
          requiredQty: plannedQty,
          doneQty: 15,
          submittedQty: 0,
          passedQty: 0,
          failedQty: 0,
          shortQty: 0,
        },
        {
          step: 'UON',
          requiredQty: plannedQty,
          doneQty: 5,
          submittedQty: 0,
          passedQty: 0,
          failedQty: 0,
          shortQty: 0,
        },
      ]);
    });

    it('stage=PHOI, có PieceStepBundle AWAITING_QC + QC_PASSED - submittedQty gộp cả 2, passedQty CHỈ tính QC_PASSED', async () => {
      const plannedQty = bomPieceRow.qtyPerUnit * order.quantity;
      prisma.pieceMaterialYield.findMany.mockResolvedValue([
        { pieceId: 40n, materialId: 80n, piecesPerBar: 12, processSteps: ['CAT'], qtyPerPiece: 1 },
      ]);
      prisma.pieceStepBatch.groupBy.mockResolvedValue([
        { productionOrderId: 1n, pieceId: 40n, step: 'CAT', _sum: { qty: 20 } },
      ]);
      prisma.pieceStepBundle.groupBy.mockResolvedValue([
        { productionOrderId: 1n, pieceId: 40n, step: 'CAT', status: 'QC_PASSED', _sum: { qty: 6 } },
        {
          productionOrderId: 1n,
          pieceId: 40n,
          step: 'CAT',
          status: 'AWAITING_QC',
          _sum: { qty: 4 },
        },
      ]);

      const result = await service.getBatchPlan('1', MfgStage.PHOI);

      expect(result.items[0].stepProgress[0]).toEqual({
        step: 'CAT',
        requiredQty: plannedQty,
        doneQty: 20,
        submittedQty: 10,
        passedQty: 6,
        failedQty: 0,
        shortQty: 0,
      });
    });

    it('stage=PHOI, mảnh có khai công đoạn (vd pat Cắt -> Uốn): failedQty của mảnh = tổng lỗi KCS mọi công đoạn (18/11/2026)', async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([
        {
          pieceId: 40n,
          materialId: 80n,
          piecesPerBar: 12,
          processSteps: ['CAT', 'UON'],
          qtyPerPiece: 1,
        },
      ]);
      const stepReview = (step: string, failedQty: number, shortQty = 0) => ({
        failedQty,
        shortQty,
        pieceStepBundle: { productionOrderId: 1n, pieceId: 40n, step },
      });
      // Cùng 1 hàm prisma cho 2 truy vấn: lỗi theo đợt mảnh (productionBatch) và lỗi theo công đoạn (pieceStepBundle).
      prisma.qcReview.findMany.mockImplementation((args: { where: Record<string, unknown> }) =>
        Promise.resolve(
          'pieceStepBundle' in args.where ? [stepReview('CAT', 3, 1), stepReview('UON', 2, 4)] : [],
        ),
      );

      const result = await service.getBatchPlan('1', MfgStage.PHOI);

      expect(result.items[0].stepProgress.map((s) => s.failedQty)).toEqual([3, 2]);
      expect(result.items[0].failedQty).toBe(5);
      // P1: thiếu theo từng công đoạn + Σ mọi công đoạn ở mảnh; failedQty (N1) không đổi nghĩa.
      expect(result.items[0].stepProgress.map((s) => s.shortQty)).toEqual([1, 4]);
      expect(result.items[0].shortQty).toBe(5);
    });

    it('nhiều order CÙNG PI cùng bomRevisionId - doneQty theo bước KHÔNG lẫn giữa 2 order (getBatchPlanBatch)', async () => {
      const order2 = {
        ...order,
        id: 2n,
        poNumber: 'PO-32-1',
        quantity: 5,
        productionInvoiceItem: { salesOrder: { orderCode: 'PO-32' } },
      };
      prisma.productionOrder.findMany.mockResolvedValue([order, order2]);
      prisma.pieceMaterialYield.findMany.mockResolvedValue([
        {
          bomRevisionId: 5n,
          pieceId: 40n,
          materialId: 80n,
          piecesPerBar: 12,
          processSteps: ['CAT'],
          qtyPerPiece: 1,
        },
      ]);
      prisma.pieceStepBatch.groupBy.mockResolvedValue([
        { productionOrderId: 1n, pieceId: 40n, step: 'CAT', _sum: { qty: 8 } },
        { productionOrderId: 2n, pieceId: 40n, step: 'CAT', _sum: { qty: 3 } },
      ]);

      const result = await service.getBatchPlanBatch(['1', '2'], MfgStage.PHOI);

      expect(result['1'].items[0].stepProgress[0].doneQty).toBe(8);
      expect(result['2'].items[0].stepProgress[0].doneQty).toBe(3);
    });
  });

  // 2026-09-04: Phôi báo tiến độ TỪNG công đoạn - khuôn chép MaterialIssuesService.create()
  // (Idempotency-Key + $transaction + lockBusinessKey), KHÔNG chép SteelIssuesService.
  // recordStepBatch() (khe TOCTOU thật, xem comment recordPieceStepBatch()).
  describe('recordPieceStepBatch', () => {
    const dto = { stage: MfgStage.PHOI, pieceId: '40', step: 'CAT' as const, qty: 10 };
    const yieldRow = {
      bomRevisionId: 5n,
      pieceId: 40n,
      materialId: 80n,
      piecesPerBar: 12,
      processSteps: ['CAT', 'UON'],
      qtyPerPiece: 1,
    };
    const createdRow = {
      id: 900n,
      productionOrderId: 1n,
      pieceId: 40n,
      step: 'CAT',
      qty: 10,
      reportedAt: new Date(),
      reportedById: 'user-phoi',
    };

    it('happy path - bước ĐẦU TIÊN (CAT), tạo đúng dòng (báo đúng số cần 2 × 10 = 20)', async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([yieldRow]);
      prisma.pieceStepBatch.create.mockResolvedValue(createdRow);

      const fullDto = { ...dto, qty: 20 };
      const result = await service.recordPieceStepBatch('1', fullDto, 'user-phoi', 'PHOI');

      expect(result.id).toBe('900');
      expect(result.qty).toBe(10); // trả nguyên createdRow, không phải fullDto.qty
      expect(prisma.pieceStepBatch.create).toHaveBeenCalledWith({
        data: {
          productionOrderId: 1n,
          pieceId: 40n,
          step: 'CAT',
          qty: 20,
          reportedById: 'user-phoi',
          idempotencyKey: undefined,
        },
      });
    });

    it('P1: transaction có maxWait + timeout 20s; sau commit phát realtime PROGRESS (topic production-batches) cho lệnh', async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([yieldRow]);
      prisma.pieceStepBatch.create.mockResolvedValue(createdRow);

      await service.recordPieceStepBatch('1', { ...dto, qty: 20 }, 'user-phoi', 'PHOI');

      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        maxWait: 10_000,
        timeout: 20_000,
      });
      expect(realtimeStub.publishEntityChanged).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'PRODUCTION_BATCH',
          entityId: 900n,
          action: 'PROGRESS',
          actorId: 'user-phoi',
          parentId: 1n,
        }),
      );
    });

    describe('báo vượt theo (lệnh, mảnh, công đoạn) được phép - P1, quyết định 19/11 (Câu 6)', () => {
      beforeEach(() => {
        prisma.pieceMaterialYield.findMany.mockResolvedValue([yieldRow]);
        prisma.pieceStepBatch.create.mockResolvedValue(createdRow);
      });

      it('cần 20, đã tính 15 (báo 20, KCS ghi lỗi 3 + thiếu 2): báo 6 vẫn tạo được + logger.log "Báo vượt pat"; báo 5 không log', async () => {
        prisma.pieceStepBatch.aggregate.mockResolvedValue({ _sum: { qty: 20 } });
        prisma.qcReview.aggregate.mockResolvedValue({ _sum: { failedQty: 3, shortQty: 2 } });
        const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

        await expect(
          service.recordPieceStepBatch('1', { ...dto, qty: 6 }, 'user-phoi', 'PHOI'),
        ).resolves.toBeDefined();
        expect(prisma.pieceStepBatch.create).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith(
          expect.stringContaining(
            'Báo vượt pat: lệnh 1, mảnh 40, CAT, cần 20, đã tính 15, nhập 6 (cho phép, quyết định 19/11)',
          ),
        );

        log.mockClear();
        await expect(
          service.recordPieceStepBatch('1', { ...dto, qty: 5 }, 'user-phoi', 'PHOI'),
        ).resolves.toBeDefined();
        expect(log).not.toHaveBeenCalledWith(expect.stringContaining('Báo vượt pat'));
        // Đọc theo ĐÚNG công đoạn, trong khoá piece-step-batch (khoá trước khi đọc).
        expect(prisma.pieceStepBatch.aggregate).toHaveBeenCalledWith({
          where: { productionOrderId: 1n, pieceId: 40n, step: 'CAT' },
          _sum: { qty: true },
        });
        expect(prisma.qcReview.aggregate).toHaveBeenCalledWith({
          where: { pieceStepBundle: { productionOrderId: 1n, pieceId: 40n, step: 'CAT' } },
          _sum: { failedQty: true, shortQty: true },
        });
        expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
          prisma.pieceStepBatch.aggregate.mock.invocationCallOrder[0],
        );
        log.mockRestore();
      });

      it('đã đủ -> báo thêm 1 vẫn tạo được, có log, vẫn phát realtime', async () => {
        prisma.pieceStepBatch.aggregate.mockResolvedValue({ _sum: { qty: 20 } });
        const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
        realtimeStub.publishEntityChanged.mockClear();

        await expect(
          service.recordPieceStepBatch('1', { ...dto, qty: 1 }, 'user-phoi', 'PHOI'),
        ).resolves.toBeDefined();
        expect(prisma.pieceStepBatch.create).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith(expect.stringContaining('Báo vượt pat'));
        expect(realtimeStub.publishEntityChanged).toHaveBeenCalled();
        log.mockRestore();
      });

      it('số cần 0 (mảnh không có trong định mức của lệnh) vẫn tạo được + có log', async () => {
        prisma.bomPiece.findUnique.mockResolvedValue(null);
        const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

        await expect(
          service.recordPieceStepBatch('1', dto, 'user-phoi', 'PHOI'),
        ).resolves.toBeDefined();
        expect(prisma.pieceStepBatch.create).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith(expect.stringContaining('cần 0'));
        log.mockRestore();
      });
    });

    // 2026-10-03: piece có thể có NHIỀU dòng Tự tính (khác material) - công đoạn hợp lệ là HỢP của
    // mọi dòng, và TẤT CẢ material phải đã nhận trước khi báo.
    it('piece có 2 dòng Tự tính (processSteps khác nhau) - công đoạn hợp lệ là HỢP của cả 2, TẤT CẢ material phải đã nhận', async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([
        { ...yieldRow, materialId: 80n, processSteps: ['CAT'] },
        { ...yieldRow, materialId: 81n, processSteps: ['DUC_LO'] },
      ]);
      materialYieldIssuesService.sumReceived.mockResolvedValue(5); // cả 2 material đều đã nhận
      prisma.pieceStepBatch.create.mockResolvedValue(createdRow);

      // 'DUC_LO' chỉ khai ở material 81, KHÔNG có trong processSteps của material 80 - vẫn hợp lệ
      // vì validate theo HỢP, không theo từng material riêng.
      await expect(
        service.recordPieceStepBatch('1', { ...dto, step: 'DUC_LO' as const }, 'user-phoi', 'PHOI'),
      ).resolves.toBeDefined();
      expect(materialYieldIssuesService.sumReceived).toHaveBeenCalledWith(expect.anything(), 80n);
      expect(materialYieldIssuesService.sumReceived).toHaveBeenCalledWith(expect.anything(), 81n);
    });

    it('piece có 2 dòng Tự tính - CHỈ 1 material đã nhận, material còn lại CHƯA - vẫn chặn (BadRequest)', async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([
        { ...yieldRow, materialId: 80n, processSteps: ['CAT'] },
        { ...yieldRow, materialId: 81n, processSteps: ['CAT'] },
      ]);
      materialYieldIssuesService.sumReceived.mockImplementation(
        (_orderId: bigint, materialId: bigint) => Promise.resolve(materialId === 80n ? 5 : 0),
      );

      await expect(service.recordPieceStepBatch('1', dto, 'user-phoi', 'PHOI')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.pieceStepBatch.create).not.toHaveBeenCalled();
    });

    it('processSteps RỖNG - BadRequest, bắt buộc dùng luồng cũ (báo thẳng qua create())', async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([{ ...yieldRow, processSteps: [] }]);

      await expect(service.recordPieceStepBatch('1', dto, 'user-phoi', 'PHOI')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.pieceStepBatch.create).not.toHaveBeenCalled();
    });

    it('mảnh không có PieceMaterialYield - BadRequest', async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([]);

      await expect(service.recordPieceStepBatch('1', dto, 'user-phoi', 'PHOI')).rejects.toThrow(
        BadRequestException,
      );
    });

    it("step 'DAP' không nằm trong processSteps đã khai (['CAT','UON']) - BadRequest", async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([yieldRow]);

      await expect(
        service.recordPieceStepBatch('1', { ...dto, step: 'DAP' as const }, 'user-phoi', 'PHOI'),
      ).rejects.toThrow(BadRequestException);
    });

    // 2026-09-07: BỎ ràng buộc "bước sau vượt bước liền trước" (quyết định nghiệp vụ, xem doc
    // comment recordPieceStepBatch()) - 3 test dưới thay 3 test CŨ đã xoá (từng assert BadRequest
    // cho đúng các case này), giờ khẳng định NGƯỢC LẠI: không còn chặn theo bước liền trước (P1 chỉ chặn theo số cần của CHÍNH
    // công đoạn đó - aggregate chỉ đọc đúng step đang báo).
    it('báo bước SAU (UON) vượt xa số đã báo bước TRƯỚC (CAT) - KHÔNG còn chặn, tạo bình thường', async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([yieldRow]);
      prisma.pieceStepBatch.create.mockResolvedValue({ ...createdRow, step: 'UON', qty: 11 });

      await expect(
        service.recordPieceStepBatch(
          '1',
          { ...dto, step: 'UON' as const, qty: 11 },
          'user-phoi',
          'PHOI',
        ),
      ).resolves.toBeDefined();
      expect(prisma.pieceStepBatch.aggregate).toHaveBeenCalledTimes(1);
      expect(prisma.pieceStepBatch.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ step: 'UON' }) as unknown }),
      );
    });

    it("processSteps lưu LỘN XỘN thứ tự (['UON','CAT']) - vẫn không chặn báo UON dù CAT chưa báo gì", async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([
        { ...yieldRow, processSteps: ['UON', 'CAT'] },
      ]);
      prisma.pieceStepBatch.create.mockResolvedValue({ ...createdRow, step: 'UON', qty: 6 });

      await expect(
        service.recordPieceStepBatch(
          '1',
          { ...dto, step: 'UON' as const, qty: 6 },
          'user-phoi',
          'PHOI',
        ),
      ).resolves.toBeDefined();
    });

    it('idempotency - cùng key gọi 2 lần chỉ tạo 1 bản ghi, lần 2 trả lại bản ghi cũ', async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([yieldRow]);
      prisma.pieceStepBatch.findUnique.mockResolvedValue(createdRow);

      const result = await service.recordPieceStepBatch(
        '1',
        dto,
        'user-phoi',
        'PHOI',
        'idem-key-1',
      );

      expect(result.id).toBe('900');
      expect(prisma.pieceStepBatch.create).not.toHaveBeenCalled();
      expect(prisma.pieceMaterialYield.findMany).not.toHaveBeenCalled();
    });

    it("mfgRole='HAN' báo hộ PHOI - Forbidden", async () => {
      await expect(service.recordPieceStepBatch('1', dto, 'user-han', MfgRole.HAN)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.pieceMaterialYield.findMany).not.toHaveBeenCalled();
    });

    it('dto.stage khác PHOI - BadRequest ngay, không query gì', async () => {
      await expect(
        service.recordPieceStepBatch('1', { ...dto, stage: MfgStage.HAN }, 'user-phoi', 'PHOI'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.pieceMaterialYield.findMany).not.toHaveBeenCalled();
    });

    it('PI không có SKU nào ACTIVE (floor-gate) - ConflictException, không tạo dòng', async () => {
      prisma.productionOrder.findFirst.mockResolvedValue(null);
      prisma.pieceMaterialYield.findMany.mockResolvedValue([yieldRow]);

      await expect(service.recordPieceStepBatch('1', dto, 'user-phoi', 'PHOI')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.pieceStepBatch.create).not.toHaveBeenCalled();
    });
  });

  // 2026-09-07: Phôi gom PieceStepBatch CHƯA gửi (pieceStepBundleId NULL) thành 1 "đợt gửi KCS"
  // theo công đoạn - xem PieceStepBundle doc comment (schema.prisma) tại sao KHÔNG re-validate
  // BOM/định mức ở đây (đã validate lúc recordPieceStepBatch() tạo từng dòng).
  describe('submitPieceStep', () => {
    const dto = { pieceId: '40', step: 'CAT' as const };
    const pendingRows = [
      {
        id: 901n,
        productionOrderId: 1n,
        pieceId: 40n,
        step: 'CAT',
        qty: 6,
        pieceStepBundleId: null,
      },
      {
        id: 902n,
        productionOrderId: 1n,
        pieceId: 40n,
        step: 'CAT',
        qty: 4,
        pieceStepBundleId: null,
      },
    ];
    const createdBundle = {
      id: 500n,
      productionOrderId: 1n,
      pieceId: 40n,
      step: 'CAT',
      qty: 10,
      status: 'AWAITING_QC',
      submittedAt: new Date(),
      submittedById: 'user-phoi',
      productionOrder: order,
      piece,
    };

    beforeEach(() => {
      prisma.pieceStepBatch.updateMany.mockResolvedValue({ count: 2 });
    });

    it('P1: transaction gom có maxWait 10s + timeout 20s', async () => {
      prisma.pieceStepBatch.findMany.mockResolvedValue(pendingRows);
      prisma.pieceStepBundle.create.mockResolvedValue(createdBundle);

      await service.submitPieceStep('1', dto, 'user-phoi', 'PHOI');

      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        maxWait: 10_000,
        timeout: 20_000,
      });
    });

    it('happy path - gom 2 dòng CHƯA gửi (qty 6+4), tạo bundle qty=10, gán lại pieceStepBundleId cho cả 2 dòng', async () => {
      prisma.pieceStepBatch.findMany.mockResolvedValue(pendingRows);
      prisma.pieceStepBundle.create.mockResolvedValue(createdBundle);

      const result = await service.submitPieceStep('1', dto, 'user-phoi', 'PHOI');

      expect(result.id).toBe('500');
      expect(result.qty).toBe(10);
      expect(result.status).toBe('AWAITING_QC');
      expect(prisma.pieceStepBatch.findMany).toHaveBeenCalledWith({
        where: { productionOrderId: 1n, pieceId: 40n, step: 'CAT', pieceStepBundleId: null },
      });
      expect(prisma.pieceStepBundle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            productionOrderId: 1n,
            pieceId: 40n,
            step: 'CAT',
            qty: 10,
            submittedById: 'user-phoi',
          },
        }),
      );
      // P1: updateMany thêm điều kiện "chưa gom" (pieceStepBundleId null) và so số dòng.
      expect(prisma.pieceStepBatch.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [901n, 902n] }, pieceStepBundleId: null },
        data: { pieceStepBundleId: 500n },
      });
    });

    it('P1: không còn lần báo nào chưa chấm (bên kia vừa chốt) - 400 câu CHUNG có mã mảnh + công đoạn (không phải "chưa có gì mới"), không tạo bundle', async () => {
      prisma.pieceStepBatch.findMany.mockResolvedValue([]);

      const err = await service
        .submitPieceStep('1', dto, 'user-phoi', 'PHOI')
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as Error).message).toBe(
        'Pat MANH-TUA công đoạn Cắt: không còn lần báo nào chưa chấm (có thể vừa được chốt) - tải lại trang.',
      );
      expect(prisma.pieceStepBundle.create).not.toHaveBeenCalled();
    });

    it('P1: updateMany chỉ gom được ít dòng hơn đã đọc (1 dòng vừa bị bên khác gom) - 400 câu chung, không để bundle sót lại', async () => {
      prisma.pieceStepBatch.findMany.mockResolvedValue(pendingRows);
      prisma.pieceStepBundle.create.mockResolvedValue(createdBundle);
      prisma.pieceStepBatch.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.submitPieceStep('1', dto, 'user-phoi', 'PHOI')).rejects.toThrow(
        'không còn lần báo nào chưa chấm (có thể vừa được chốt) - tải lại trang.',
      );
    });

    it('P1: opts.gateLabel dùng cho cổng lệnh dừng (ngoài VÀ trong khoá): 409 "chưa/không thể chốt để chấm"; mặc định "gửi KCS công đoạn"', async () => {
      prisma.productionOrder.findFirst.mockResolvedValue(null);
      await expect(
        service.submitPieceStep('1', dto, 'kcs-1', 'PHOI', { gateLabel: 'chốt để chấm' }),
      ).rejects.toThrow('chưa/không thể chốt để chấm');
      await expect(service.submitPieceStep('1', dto, 'user-phoi', 'PHOI')).rejects.toThrow(
        'chưa/không thể gửi KCS công đoạn',
      );

      // Race: pre-check thấy ACTIVE, FOR UPDATE trong khoá thấy PAUSED -> cùng nhãn mới.
      prisma.productionOrder.findFirst.mockResolvedValue({ id: 9n });
      prisma.$queryRaw.mockResolvedValue([{ floorStage: 'PAUSED' }]);
      await expect(
        service.submitPieceStep('1', dto, 'kcs-1', 'PHOI', { gateLabel: 'chốt để chấm' }),
      ).rejects.toThrow('chưa/không thể chốt để chấm');
      expect(prisma.pieceStepBundle.create).not.toHaveBeenCalled();
    });

    it('P1: không phát tin nào (pat không có tin *_TO_KCS)', async () => {
      prisma.pieceStepBatch.findMany.mockResolvedValue(pendingRows);
      prisma.pieceStepBundle.create.mockResolvedValue(createdBundle);

      await service.submitPieceStep('1', dto, 'kcs-1', 'PHOI', { gateLabel: 'chốt để chấm' });

      expect(notificationsService.emit).not.toHaveBeenCalled();
    });

    it('mfgRole khác PHOI (vd HAN) - ForbiddenException', async () => {
      await expect(service.submitPieceStep('1', dto, 'user-han', 'HAN')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.pieceStepBundle.create).not.toHaveBeenCalled();
    });

    it('mfgRole null (quản lý báo hộ) - cho qua', async () => {
      prisma.pieceStepBatch.findMany.mockResolvedValue(pendingRows);
      prisma.pieceStepBundle.create.mockResolvedValue(createdBundle);

      await expect(service.submitPieceStep('1', dto, 'user-boss', null)).resolves.toBeDefined();
    });

    it('PI không có SKU nào ACTIVE (floor-gate) - ConflictException, không tạo bundle', async () => {
      prisma.productionOrder.findFirst.mockResolvedValue(null);

      await expect(service.submitPieceStep('1', dto, 'user-phoi', 'PHOI')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.pieceStepBundle.create).not.toHaveBeenCalled();
    });
  });

  describe('findPieceStepBundlesForOrder', () => {
    it('trả về mọi bundle của order, KHÔNG lọc status, mới nhất trước', async () => {
      prisma.pieceStepBundle.findMany.mockResolvedValue([
        {
          id: 800n,
          productionOrderId: 1n,
          pieceId: 40n,
          step: 'CAT',
          qty: 10,
          status: 'AWAITING_QC',
          submittedAt: new Date(),
          submittedById: 'user-phoi',
          productionOrder: order,
          piece,
        },
      ]);

      const result = await service.findPieceStepBundlesForOrder('1');

      expect(prisma.pieceStepBundle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { productionOrderId: 1n } }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('800');
    });
  });

  describe('findAllPieceStepBundles', () => {
    it('lọc theo status khi truyền query.status', async () => {
      prisma.pieceStepBundle.findMany.mockResolvedValue([]);
      prisma.pieceStepBundle.count.mockResolvedValue(0);

      await service.findAllPieceStepBundles({
        status: 'AWAITING_QC',
        page: 1,
        limit: 20,
      } as unknown as Parameters<typeof service.findAllPieceStepBundles>[0]);

      expect(prisma.pieceStepBundle.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'AWAITING_QC' } }),
      );
    });

    it('không lọc gì khi query.status rỗng', async () => {
      prisma.pieceStepBundle.findMany.mockResolvedValue([]);
      prisma.pieceStepBundle.count.mockResolvedValue(0);

      await service.findAllPieceStepBundles({
        page: 1,
        limit: 20,
      } as unknown as Parameters<typeof service.findAllPieceStepBundles>[0]);

      expect(prisma.pieceStepBundle.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });
  });

  // 2026-09-04: "chưa nhận vật tư thành phẩm (Sắt La/thanh nhôm) từ kho thì chưa báo sản lượng
  // được" - mirror SteelIssue chặn báo cắt khi status khác RECEIVED. Áp dụng ở CẢ create() (chốt
  // & gửi KCS) lẫn recordPieceStepBatch() (báo từng công đoạn), CHỈ khi stage=PHOI và piece có
  // PieceMaterialYield - không đụng Hàn/Sơn/piece Sắt thường.
  describe('create/recordPieceStepBatch - chặn khi chưa nhận vật tư thành phẩm (2026-09-04)', () => {
    const phoiDto = { stage: MfgStage.PHOI, pieceId: '40', reportedQty: 20 }; // = số cần (2 × 10), qua phép chặn vượt
    const yieldRow = {
      materialId: 80n,
      pieceId: 40n,
      piecesPerBar: 12,
      qtyPerPiece: 1,
      processSteps: [],
    };

    beforeEach(() => {
      prisma.bomPiece.findUnique.mockResolvedValue({
        ...bomPieceRow,
        needsHan: false,
        needsSon: false,
      });
      prisma.pieceBom.findMany.mockResolvedValue([]); // rỗng - piece dùng PieceMaterialYield, không phải Sắt
    });

    it('create() - piece có 2 dòng Tự tính, CHỈ 1 material đã nhận - vẫn chặn (TẤT CẢ phải nhận đủ)', async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([
        { ...yieldRow, materialId: 80n },
        { ...yieldRow, materialId: 81n },
      ]);
      materialYieldIssuesService.sumReceived.mockImplementation(
        (_orderId: bigint, materialId: bigint) => Promise.resolve(materialId === 80n ? 5 : 0),
      );

      await expect(service.create('1', phoiDto, 'user-phoi', null, null)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.productionBatch.create).not.toHaveBeenCalled();
    });

    it('create() - piece có PieceMaterialYield nhưng CHƯA nhận (sumReceived=0) - BadRequest, không tạo batch', async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([yieldRow]);
      materialYieldIssuesService.sumReceived.mockResolvedValue(0);

      await expect(service.create('1', phoiDto, 'user-phoi', null, null)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.productionBatch.create).not.toHaveBeenCalled();
    });

    it('create() - piece có PieceMaterialYield và ĐÃ nhận (sumReceived>0) - cho qua', async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([yieldRow]);
      materialYieldIssuesService.sumReceived.mockResolvedValue(5);
      prisma.productionBatch.create.mockResolvedValue({
        ...batchRow,
        stage: MfgStage.PHOI,
        reportedById: 'user-phoi',
      });

      await expect(service.create('1', phoiDto, 'user-phoi', null, null)).resolves.toBeDefined();
      expect(materialYieldIssuesService.sumReceived).toHaveBeenCalledWith(1n, 80n);
    });

    it('create() - piece KHÔNG có PieceMaterialYield (Sắt thường) - không gọi sumReceived', async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([]);
      prisma.productionBatch.create.mockResolvedValue({
        ...batchRow,
        stage: MfgStage.PHOI,
        reportedById: 'user-phoi',
      });

      await service.create('1', phoiDto, 'user-phoi', null, null);

      expect(materialYieldIssuesService.sumReceived).not.toHaveBeenCalled();
    });

    it('create() - stage=HAN/SON - không gọi sumReceived (ràng buộc chỉ áp dụng PHÔI)', async () => {
      const hanDto = { stage: MfgStage.HAN, pieceId: '40', reportedQty: 20 };
      prisma.bomPiece.findUnique.mockResolvedValue({ ...bomPieceRow, needsHan: true });
      prisma.pieceMaterialYield.findMany.mockResolvedValue([yieldRow]);
      prisma.productionBatch.create.mockResolvedValue({ ...batchRow, stage: MfgStage.HAN });

      await service.create('1', hanDto, 'user-han', null, null);

      expect(materialYieldIssuesService.sumReceived).not.toHaveBeenCalled();
    });

    it('recordPieceStepBatch() - CHƯA nhận (sumReceived=0) - BadRequest, không tạo dòng', async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([
        { ...yieldRow, processSteps: ['CAT'] },
      ]);
      materialYieldIssuesService.sumReceived.mockResolvedValue(0);
      const stepDto = { stage: MfgStage.PHOI, pieceId: '40', step: 'CAT' as const, qty: 1 };

      await expect(service.recordPieceStepBatch('1', stepDto, 'user-phoi', 'PHOI')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.pieceStepBatch.create).not.toHaveBeenCalled();
    });
  });

  // 2026-09-08: bỏ hẳn "Chốt & gửi KCS" thủ công cho mảnh VTTP CÓ khai processSteps - gọi từ
  // QcReviewsService.reviewPieceStep() ngay trong transaction duyệt. Xem doc comment method.
  describe('autoFinalizePieceOutputIfLastStepComplete', () => {
    const yieldRowTwoSteps = { processSteps: ['CAT', 'DUC_LO'] };
    // Đợt 7: ghi mảnh vào kho tách riêng (postPieceOutputIfFinal có test riêng) - ở đây chỉ xác nhận có gọi.
    beforeEach(() => {
      prisma.productionBatch.create.mockResolvedValue({ id: 777n });
      jest.spyOn(service, 'postPieceOutputIfFinal').mockResolvedValue(undefined);
    });

    // 2026-10-03: piece có 2 dòng Tự tính (khác material), mỗi dòng khai processSteps riêng - "bước
    // cuối của piece" là bước cuối trong HỢP của cả 2 dòng (CAT, UON, DUC_LO -> cuối cùng DUC_LO
    // theo thứ tự chuẩn), KHÔNG phải bước cuối riêng của 1 material nào.
    it('piece có 2 dòng Tự tính (processSteps khác nhau) - bước cuối là bước cuối của HỢP cả 2 dòng', async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([
        { processSteps: ['CAT'] },
        { processSteps: ['UON', 'DUC_LO'] },
      ]);
      prisma.pieceStepBundle.findMany.mockResolvedValue([
        { qty: 10, qcReviews: [{ failedQty: 0, shortQty: 0 }] },
      ]);
      prisma.productionBatch.findMany.mockResolvedValue([]);

      // 'UON' KHÔNG phải bước cuối của HỢP (CAT, UON, DUC_LO) - không tạo.
      await service.autoFinalizePieceOutputIfLastStepComplete(
        prisma as unknown as PrismaTx,
        5n,
        1n,
        40n,
        'UON',
        'user-kcs',
      );
      expect(prisma.productionBatch.create).not.toHaveBeenCalled();

      // 'DUC_LO' LÀ bước cuối của HỢP - tạo ProductionBatch.
      await service.autoFinalizePieceOutputIfLastStepComplete(
        prisma as unknown as PrismaTx,
        5n,
        1n,
        40n,
        'DUC_LO',
        'user-kcs',
      );
      expect(prisma.productionBatch.create).toHaveBeenCalledWith({
        data: {
          stage: MfgStage.PHOI,
          productionOrderId: 1n,
          pieceId: 40n,
          reportedQty: 10,
          reportedById: 'user-kcs',
          status: 'QC_DONE',
        },
      });
    });

    it('step vừa duyệt KHÔNG phải bước cuối - không tạo ProductionBatch', async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([yieldRowTwoSteps]);

      await service.autoFinalizePieceOutputIfLastStepComplete(
        prisma as unknown as PrismaTx,
        5n,
        1n,
        40n,
        'CAT',
        'user-kcs',
      );

      expect(prisma.productionBatch.create).not.toHaveBeenCalled();
    });

    it('mảnh không có PieceMaterialYield (yieldRow null) - không làm gì', async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([]);

      await service.autoFinalizePieceOutputIfLastStepComplete(
        prisma as unknown as PrismaTx,
        5n,
        1n,
        40n,
        'DUC_LO',
        'user-kcs',
      );

      expect(prisma.productionBatch.create).not.toHaveBeenCalled();
    });

    it('bước cuối, chưa có bundle nào QC_PASSED - totalPassed=0, không tạo', async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([yieldRowTwoSteps]);
      prisma.pieceStepBundle.findMany.mockResolvedValue([]);
      prisma.productionBatch.findMany.mockResolvedValue([]);

      await service.autoFinalizePieceOutputIfLastStepComplete(
        prisma as unknown as PrismaTx,
        5n,
        1n,
        40n,
        'DUC_LO',
        'user-kcs',
      );

      expect(prisma.productionBatch.create).not.toHaveBeenCalled();
    });

    it('bước cuối, có bundle QC_PASSED lần đầu (chưa từng tạo ProductionBatch) - tạo QC_DONE, reportedQty = passed (trừ đúng failedQty)', async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([yieldRowTwoSteps]);
      prisma.pieceStepBundle.findMany.mockResolvedValue([
        { qty: 10, qcReviews: [{ failedQty: 3, shortQty: 0 }] },
      ]);
      prisma.productionBatch.findMany.mockResolvedValue([]);

      await service.autoFinalizePieceOutputIfLastStepComplete(
        prisma as unknown as PrismaTx,
        5n,
        1n,
        40n,
        'DUC_LO',
        'user-kcs',
      );

      expect(prisma.productionBatch.create).toHaveBeenCalledWith({
        data: {
          stage: MfgStage.PHOI,
          productionOrderId: 1n,
          pieceId: 40n,
          reportedQty: 7,
          reportedById: 'user-kcs',
          status: 'QC_DONE',
        },
      });
    });

    it('bước cuối, gọi LẦN 2 sau khi đã tạo đủ (delta=0) - KHÔNG tạo trùng', async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([yieldRowTwoSteps]);
      prisma.pieceStepBundle.findMany.mockResolvedValue([{ qty: 10, qcReviews: [] }]);
      prisma.productionBatch.findMany.mockResolvedValue([{ reportedQty: 10 }]);

      await service.autoFinalizePieceOutputIfLastStepComplete(
        prisma as unknown as PrismaTx,
        5n,
        1n,
        40n,
        'DUC_LO',
        'user-kcs',
      );

      expect(prisma.productionBatch.create).not.toHaveBeenCalled();
    });

    it('bước cuối, thêm 1 bundle Bù đủ mới (2 bundle QC_PASSED cộng dồn) - chỉ tạo phần CHÊNH LỆCH', async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([yieldRowTwoSteps]);
      prisma.pieceStepBundle.findMany.mockResolvedValue([
        { qty: 10, qcReviews: [{ failedQty: 3, shortQty: 0 }] }, // đã đạt 7, đã sinh ProductionBatch rồi
        { qty: 3, qcReviews: [{ failedQty: 0, shortQty: 0 }] }, // bù đủ mới đạt thêm 3
      ]);
      prisma.productionBatch.findMany.mockResolvedValue([{ reportedQty: 7 }]);

      await service.autoFinalizePieceOutputIfLastStepComplete(
        prisma as unknown as PrismaTx,
        5n,
        1n,
        40n,
        'DUC_LO',
        'user-kcs',
      );

      expect(prisma.productionBatch.create).toHaveBeenCalledWith({
        data: {
          stage: MfgStage.PHOI,
          productionOrderId: 1n,
          pieceId: 40n,
          reportedQty: 3,
          reportedById: 'user-kcs',
          status: 'QC_DONE',
        },
      });
    });

    it('P1 AC37: bundle 50, KCS ghi thiếu 3 + lỗi 1 -> sinh lô QC_DONE 46 (trừ cả thiếu), không phải 49', async () => {
      const postOutput = jest.spyOn(service, 'postPieceOutputIfFinal');
      prisma.pieceMaterialYield.findMany.mockResolvedValue([yieldRowTwoSteps]);
      prisma.pieceStepBundle.findMany.mockResolvedValue([
        { qty: 50, qcReviews: [{ failedQty: 1, shortQty: 3 }] },
      ]);
      prisma.productionBatch.findMany.mockResolvedValue([]);

      await service.autoFinalizePieceOutputIfLastStepComplete(
        prisma as unknown as PrismaTx,
        5n,
        1n,
        40n,
        'DUC_LO',
        'user-kcs',
      );

      expect(prisma.pieceStepBundle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: { qty: true, qcReviews: { select: { failedQty: true, shortQty: true } } },
        }),
      );
      expect(prisma.productionBatch.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ reportedQty: 46 }) as unknown,
      });
      expect(postOutput).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ qty: 46 }),
        'user-kcs',
      );
    });

    it('P1: lấy khoá production-batch-open:{lệnh}:{mảnh}:PHOI NGAY SAU piece-auto-finalize (loại trừ với báo mảnh Phôi), trước khi đọc / ghi lô', async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([yieldRowTwoSteps]);
      prisma.pieceStepBundle.findMany.mockResolvedValue([
        { qty: 10, qcReviews: [{ failedQty: 0, shortQty: 0 }] },
      ]);
      prisma.productionBatch.findMany.mockResolvedValue([]);

      await service.autoFinalizePieceOutputIfLastStepComplete(
        prisma as unknown as PrismaTx,
        5n,
        1n,
        40n,
        'DUC_LO',
        'user-kcs',
      );

      const keys = (prisma.$executeRaw.mock.calls as [TemplateStringsArray, string][]).map(
        ([, key]) => key,
      );
      expect(keys).toEqual(['piece-auto-finalize:1:40', 'production-batch-open:1:40:PHOI']);
      expect(prisma.$executeRaw.mock.invocationCallOrder[1]).toBeLessThan(
        prisma.productionBatch.findMany.mock.invocationCallOrder[0],
      );
    });
  });

  describe('getBatchPlan/getBatchPlanBatch - vật tư thành phẩm không gắn mảnh (chân nhôm, 2026-10-06)', () => {
    const chanNhomRecipe = {
      id: 7n,
      outputMaterialId: 60n,
      isActive: true,
      processSteps: ['CAT'],
      outputMaterial: { id: 60n, code: 'CHAN-NHOM-01', name: 'Chân nhôm', spec: 'Ø25 · Chân' },
    };
    const chanNhomLine = {
      bomRevisionId: 5n,
      pieceId: 40n,
      materialId: 60n,
      qtyPerPiece: { toNumber: () => 2 },
    };

    it('getBatchPlan stage=PHOI: nhu cầu = qtyPerUnit × qtyPerPiece × SL SKU; tiến độ lấy từ đợt KCS công đoạn cuối, qua StockLedger', async () => {
      prisma.materialYieldRecipe.findMany.mockResolvedValue([chanNhomRecipe]);
      prisma.pieceMaterialItem.findMany.mockResolvedValue([chanNhomLine]);
      prisma.materialYieldStepBundle.findMany.mockResolvedValue([
        {
          id: 100n,
          productionInvoiceId: 500n,
          recipeId: 7n,
          step: 'CAT',
          qty: 40,
          status: 'QC_PASSED',
          submittedAt: new Date('2026-10-05T10:00:00Z'),
        },
      ]);
      prisma.stockLedger.findMany.mockResolvedValue([
        { refId: '100', qty: { toNumber: () => 40 } },
      ]);

      const result = await service.getBatchPlan('1', MfgStage.PHOI);

      expect(result.materialYieldItems).toEqual([
        {
          materialId: '60',
          materialCode: 'CHAN-NHOM-01',
          materialName: 'Chân nhôm',
          plannedQty: 40,
          awaitingQcQty: 0,
          passedQty: 40,
          materialSpec: 'Ø25 · Chân',
          lastUpdatedAt: '2026-10-05T10:00:00.000Z',
        },
      ]);
      expect(prisma.stockLedger.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ refId: { in: ['100'] } }) as unknown,
        }),
      );
    });

    it('getBatchPlan stage=HAN: không tính vật tư thành phẩm không gắn mảnh (chỉ PHOI)', async () => {
      prisma.materialYieldRecipe.findMany.mockResolvedValue([chanNhomRecipe]);
      prisma.pieceMaterialItem.findMany.mockResolvedValue([chanNhomLine]);

      const result = await service.getBatchPlan('1', MfgStage.HAN);

      expect(result.materialYieldItems).toEqual([]);
      expect(prisma.materialYieldRecipe.findMany).not.toHaveBeenCalled();
    });

    it('phân bổ theo tỷ lệ nhu cầu khi 1 PI có 2 SKU: SKU 10 cái (40 nhu cầu) nhận 1/4 tiến độ PI (passed 80 → 20)', async () => {
      prisma.materialYieldRecipe.findMany.mockResolvedValue([chanNhomRecipe]);
      prisma.pieceMaterialItem.findMany.mockResolvedValue([chanNhomLine]);
      prisma.productionOrder.findMany.mockResolvedValue([
        { ...order, id: 1n, quantity: 10, productionInvoiceItem: { productionInvoiceId: 500n } },
        { ...order, id: 2n, quantity: 30, productionInvoiceItem: { productionInvoiceId: 500n } },
      ]);
      prisma.materialYieldStepBundle.findMany.mockResolvedValue([
        {
          id: 100n,
          productionInvoiceId: 500n,
          recipeId: 7n,
          step: 'CAT',
          qty: 80,
          status: 'QC_PASSED',
        },
      ]);
      prisma.stockLedger.findMany.mockResolvedValue([
        { refId: '100', qty: { toNumber: () => 80 } },
      ]);

      const result = await service.getBatchPlan('1', MfgStage.PHOI);

      expect(result.materialYieldItems[0]).toMatchObject({ plannedQty: 40, passedQty: 20 });
    });

    it('P1: loadMaterialYieldNeed ra CÙNG số cần với getMaterialYieldPlanBatch (Σ plannedQty mọi SKU của PI)', async () => {
      prisma.materialYieldRecipe.findMany.mockResolvedValue([chanNhomRecipe]);
      prisma.pieceMaterialItem.findMany.mockResolvedValue([chanNhomLine]);
      prisma.productionOrder.findMany.mockResolvedValue([
        { ...order, id: 1n, quantity: 10, productionInvoiceItem: { productionInvoiceId: 500n } },
        { ...order, id: 2n, quantity: 30, productionInvoiceItem: { productionInvoiceId: 500n } },
      ]);

      const plan = await service.getBatchPlanBatch(['1', '2'], MfgStage.PHOI);
      const planned = ['1', '2'].reduce(
        (sum, id) => sum + (plan[id].materialYieldItems[0]?.plannedQty ?? 0),
        0,
      );
      const need = await loadMaterialYieldNeed(prisma as unknown as PrismaTx, [500n]);

      expect(planned).toBe(160); // (2 × 2) × (10 + 30)
      expect(need.get(materialYieldNeedKey(500n, 7n, 'CAT'))?.required).toBe(planned);
    });

    it('getBatchPlanBatch stage=PHOI: mỗi order nhận materialYieldItems riêng', async () => {
      prisma.productionOrder.findMany.mockResolvedValue([order]);
      prisma.materialYieldRecipe.findMany.mockResolvedValue([chanNhomRecipe]);
      prisma.pieceMaterialItem.findMany.mockResolvedValue([chanNhomLine]);

      const result = await service.getBatchPlanBatch(['1'], MfgStage.PHOI);

      expect(result['1'].materialYieldItems).toEqual([
        expect.objectContaining({ materialCode: 'CHAN-NHOM-01', plannedQty: 40 }),
      ]);
    });
  });

  describe('postPieceOutputIfFinal - ghi mảnh vào kho của công đoạn cuối (Đợt 7)', () => {
    const PA = 1n;
    const PHA = 2n;
    const khoPhoiPA = { id: 90n, code: 'phoi-son-han', kind: 'PHOI', workshopId: PA };
    const khoHanPA = { id: 92n, code: 'phoi-son-han-han-pa', kind: 'HAN', workshopId: PA };
    const khoSonPA = { id: 93n, code: 'phoi-son-han-son-pa', kind: 'SON', workshopId: PA };
    const khoPhoiPHA = { id: 95n, code: 'phoi-son-han-phoi-pha', kind: 'PHOI', workshopId: PHA };
    const khoHanPHA = { id: 96n, code: 'phoi-son-han-han-pha', kind: 'HAN', workshopId: PHA };
    const all = [khoPhoiPA, khoHanPA, khoSonPA, khoPhoiPHA, khoHanPHA];

    const setup = (needsHan: boolean, needsSon: boolean, workshopId: bigint) => {
      prisma.productionOrder.findUnique.mockResolvedValue(order);
      prisma.bomPiece.findUnique.mockResolvedValue({ needsHan, needsSon });
      prisma.productionInvoiceItem.findFirst.mockResolvedValue({ workshopId });
      prisma.warehouse.findFirst.mockImplementation(
        ({ where }: { where: { kind: string; workshopId?: bigint } }) =>
          Promise.resolve(
            all.find(
              (w) =>
                w.kind === where.kind &&
                (where.workshopId === undefined || w.workshopId === where.workshopId),
            ) ?? null,
          ),
      );
      prisma.warehouse.findUniqueOrThrow.mockResolvedValue(productionWarehouse);
    };
    const run = (stage: MfgStage, qty = 15) =>
      service.postPieceOutputIfFinal(
        prisma as unknown as PrismaTx,
        { id: 800n, productionOrderId: 1n, pieceId: 40n, stage, qty },
        'user-kcs',
      );
    const postedTo = () =>
      (stockLedgerService.postEntry.mock.calls as [{ toWarehouseId: bigint; qty: number }][]).map(
        ([e]) => [e.toWarehouseId, e.qty],
      );

    it('mảnh cần hàn + sơn ở Phú An: chỉ KCS Sơn đạt mới ghi, vào kho Sơn; KCS Hàn không ghi', async () => {
      setup(true, true, PA);
      await run(MfgStage.HAN);
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
      await run(MfgStage.SON);
      expect(postedTo()).toEqual([[khoSonPA.id, 15]]);
      const [entry] = stockLedgerService.postEntry.mock.calls[0] as [Record<string, unknown>];
      expect(entry).toMatchObject({
        fromWarehouseId: productionWarehouse.id,
        pieceId: 40n,
        refType: StockLedgerRefType.FRAME_OUTPUT,
        refId: '800',
        idempotencyKey: 'piece-output:800',
      });
    });

    it('mảnh cần hàn + sơn ở Phước An (không có kho Sơn): ghi vào kho Hàn Phước An lúc KCS Hàn đạt; KCS Sơn không ghi thêm', async () => {
      setup(true, true, PHA);
      await run(MfgStage.HAN);
      expect(postedTo()).toEqual([[khoHanPHA.id, 15]]);
      stockLedgerService.postEntry.mockClear();
      await run(MfgStage.SON);
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    it('mảnh chỉ cần hàn -> kho Hàn của xưởng; vật tư thành phẩm (không hàn/sơn) -> kho Phôi của xưởng', async () => {
      setup(true, false, PHA);
      await run(MfgStage.HAN);
      setup(false, false, PA);
      await run(MfgStage.PHOI, 4);
      expect(postedTo()).toEqual([
        [khoHanPHA.id, 15],
        [khoPhoiPA.id, 4],
      ]);
    });

    it('số đạt = 0 -> không ghi', async () => {
      setup(true, false, PA);
      await run(MfgStage.HAN, 0);
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });
  });

  describe('replayLegacySegmentConsume - kho Phôi tra bằng đúng tx (P1 [6])', () => {
    it('gọi phoiWarehouseCodeOfOrder với tx của giao dịch chuyển đổi, không mượn kết nối ngoài giao dịch', async () => {
      const tx = {
        productionBatch: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 5n,
            pieceId: 40n,
            reportedQty: 3,
            stage: MfgStage.HAN,
            reportedById: 'u1',
            productionOrder: {
              id: 11n,
              bomRevisionId: 5n,
              productionInvoiceItem: { productionInvoiceId: 3n },
            },
          }),
        },
        pieceBom: { findMany: jest.fn().mockResolvedValue([{ qtyPerPiece: 1 }]) },
        bomPiece: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ needsHan: true, needsSon: false, qtyPerUnit: 1 }),
        },
        warehouse: {
          findUniqueOrThrow: jest.fn().mockRejectedValue(new Error('dừng sau tra kho')),
        },
      };
      const spy = jest
        .spyOn(
          service as unknown as { phoiWarehouseCodeOfOrder: (...a: unknown[]) => Promise<string> },
          'phoiWarehouseCodeOfOrder',
        )
        .mockResolvedValue('PHOI-X');

      await expect(service.replayLegacySegmentConsume(tx as never, 5n, 'admin')).rejects.toThrow(
        'dừng sau tra kho',
      );

      expect(spy).toHaveBeenCalledWith(11n, tx);
    });
  });
});
