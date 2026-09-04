import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MfgRole, MfgStage, StockLedgerRefType } from '../../generated/prisma/client';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { MaterialYieldIssuesService } from '../material-yield-issues/material-yield-issues.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { ProductionBatchesService } from './production-batches.service';

describe('ProductionBatchesService', () => {
  let service: ProductionBatchesService;
  let prisma: {
    productionBatch: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
    };
    productionOrder: { findUnique: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock };
    productionInvoiceItem: { findUniqueOrThrow: jest.Mock };
    bomPiece: { findUnique: jest.Mock; findMany: jest.Mock };
    pieceBom: { findMany: jest.Mock };
    pieceMaterialYield: { findUnique: jest.Mock; findMany: jest.Mock };
    pieceStepBatch: {
      findUnique: jest.Mock;
      aggregate: jest.Mock;
      groupBy: jest.Mock;
      create: jest.Mock;
    };
    stockQuant: { findMany: jest.Mock };
    warehouseTransferPieceItem: { findMany: jest.Mock };
    warehouse: { findUniqueOrThrow: jest.Mock };
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let stockLedgerService: { postEntry: jest.Mock };
  let materialYieldIssuesService: { sumReceived: jest.Mock };

  const order = {
    id: 1n,
    poNumber: 'PO-31-1',
    bomRevisionId: 5n,
    quantity: 10,
    productionInvoiceItemId: 20n,
    mfgProduct: { name: 'SP-1' },
    productionInvoiceItem: { salesOrder: { code: 'PO-31' } },
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
  const steelWarehouse2 = { id: 95n, code: 'phoi-son-han-2' };
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
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
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
      },
      bomPiece: {
        findUnique: jest.fn().mockResolvedValue(bomPieceRow),
        findMany: jest.fn().mockResolvedValue([{ ...bomPieceRow, piece }]),
      },
      // Mặc định rỗng - đa số test case không quan tâm tới nhánh trừ tồn đoạn (mục "Trừ tồn đoạn
      // sắt (SEGMENT_CONSUME)" bên dưới mới override).
      pieceBom: { findMany: jest.fn().mockResolvedValue([]) },
      // Mặc định rỗng - đa số test case không quan tâm tới nhánh vật tư thành phẩm (định mức
      // PieceMaterialYield, xem mục "trừ tồn nguyên liệu" bên dưới mới override).
      pieceMaterialYield: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      // Mặc định rỗng - đa số test case không quan tâm tới tiến độ công đoạn vật tư thành phẩm
      // (xem mục 'recordPieceStepBatch' và 'stepProgress trong getBatchPlan' bên dưới).
      pieceStepBatch: {
        findUnique: jest.fn().mockResolvedValue(null),
        aggregate: jest.fn().mockResolvedValue({ _sum: { qty: null } }),
        groupBy: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
      },
      stockQuant: { findMany: jest.fn().mockResolvedValue([]) },
      warehouseTransferPieceItem: { findMany: jest.fn().mockResolvedValue([]) },
      warehouse: {
        findUniqueOrThrow: jest
          .fn()
          .mockImplementation(({ where: { code } }: { where: { code: string } }) =>
            Promise.resolve(
              code === 'phoi-son-han'
                ? steelWarehouse
                : code === 'phoi-son-han-2'
                  ? steelWarehouse2
                  : productionWarehouse,
            ),
          ),
      },
      // assertItemPiHasActiveFloorLocked() (vá race TOCTOU, 2026-09-03) - FOR UPDATE lên
      // production_orders ngay dòng đầu transaction create(). Mặc định ACTIVE, đa số test case
      // không quan tâm gate.
      $queryRaw: jest.fn(() => Promise.resolve([{ floorStage: 'ACTIVE' }])),
      // lockBusinessKey() (recordPieceStepBatch) - pg_advisory_xact_lock, no-op trong test.
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(prisma))),
    };
    stockLedgerService = { postEntry: jest.fn().mockResolvedValue({}) };
    // Mặc định "đã nhận đủ" (100) - đa số test case không quan tâm ràng buộc mới "chưa nhận thì
    // chưa báo được" (2026-09-04), xem mục 'assertMaterialYieldReceived' bên dưới mới override 0.
    materialYieldIssuesService = { sumReceived: jest.fn().mockResolvedValue(100) };
    service = new ProductionBatchesService(
      prisma as unknown as PrismaServiceType,
      stockLedgerService as unknown as StockLedgerService,
      materialYieldIssuesService as unknown as MaterialYieldIssuesService,
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

    it('idempotency short-circuit - trả về lô cũ, không tạo mới, nhưng vẫn gọi lại postSegmentConsumeEntries (retry-safety)', async () => {
      prisma.productionBatch.findUnique.mockResolvedValue(batchRow);
      prisma.pieceBom.findMany.mockResolvedValue([
        { id: 1n, bomRevisionId: 5n, pieceId: 40n, segmentSpecId: 60n, qtyPerPiece: 3 },
      ]);

      const result = await service.create('1', dto, 'user-han', null, null, 'idem-key-1');

      expect(prisma.productionBatch.create).not.toHaveBeenCalled();
      expect(result.id).toBe('700');
      // Xem describe('trừ tồn đoạn sắt (SEGMENT_CONSUME)') bên dưới cho assertion đầy đủ của
      // postEntry - test này chỉ xác nhận retry-safety (vẫn gọi lại dù không tạo bản ghi mới).
      expect(stockLedgerService.postEntry).toHaveBeenCalled();
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
        prisma.pieceMaterialYield.findUnique.mockResolvedValue({
          id: 5n,
          bomRevisionId: 5n,
          pieceId: 40n,
          materialId: 90n,
          piecesPerBar: 6,
          material: { warehouse: { id: 96n, code: 'kho-tam-sat-la' } },
        });
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

  describe('create - trừ tồn đoạn sắt (SEGMENT_CONSUME)', () => {
    const dto = { stage: MfgStage.HAN, pieceId: '40', reportedQty: 20 };

    it('không có PieceBom nào cho mảnh - không gọi postEntry, không query warehouse', async () => {
      prisma.productionBatch.create.mockResolvedValue(batchRow);
      prisma.pieceBom.findMany.mockResolvedValue([]);

      await service.create('1', dto, 'user-han', null, null);

      expect(prisma.pieceBom.findMany).toHaveBeenCalledWith({
        where: { bomRevisionId: order.bomRevisionId, pieceId: 40n },
      });
      expect(prisma.warehouse.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    it('1 PieceBom - ghi đúng 1 dòng StockLedger, qty = qtyPerPiece × reportedQty', async () => {
      prisma.productionBatch.create.mockResolvedValue(batchRow);
      prisma.pieceBom.findMany.mockResolvedValue([
        { id: 1n, bomRevisionId: 5n, pieceId: 40n, segmentSpecId: 60n, qtyPerPiece: 3 },
      ]);

      await service.create('1', dto, 'user-han', null, null);

      expect(stockLedgerService.postEntry).toHaveBeenCalledTimes(1);
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        {
          fromWarehouseId: steelWarehouse.id,
          toWarehouseId: productionWarehouse.id,
          segmentSpecId: 60n,
          qty: 60, // 3 × reportedQty(20)
          refType: StockLedgerRefType.SEGMENT_CONSUME,
          refId: '700',
          createdById: 'user-han',
          idempotencyKey: 'production-batch-segment-consume:700:60',
        },
        prisma, // tx - create() + postSegmentConsumeEntries giờ chạy trong cùng $transaction
      );
    });

    it('2026-09-03: người báo scoped ở kho phoi-son-han PHỤ thì trừ tồn đúng kho phụ đó, không còn hardcode về kho gốc', async () => {
      prisma.productionBatch.create.mockResolvedValue(batchRow);
      prisma.pieceBom.findMany.mockResolvedValue([
        { id: 1n, bomRevisionId: 5n, pieceId: 40n, segmentSpecId: 60n, qtyPerPiece: 3 },
      ]);

      await service.create('1', dto, 'user-han', null, 'phoi-son-han-2');

      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({ fromWarehouseId: steelWarehouse2.id }),
        prisma,
      );
    });

    it('2026-09-03: warehouseScope KHÔNG thuộc gia đình phoi-son-han (dữ liệu bất thường) thì fallback về kho gốc thay vì trừ nhầm kho khác', async () => {
      prisma.productionBatch.create.mockResolvedValue(batchRow);
      prisma.pieceBom.findMany.mockResolvedValue([
        { id: 1n, bomRevisionId: 5n, pieceId: 40n, segmentSpecId: 60n, qtyPerPiece: 3 },
      ]);

      await service.create('1', dto, 'user-han', null, 'vat-tu-tp');

      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({ fromWarehouseId: steelWarehouse.id }),
        prisma,
      );
    });

    it('nhiều PieceBom (1 mảnh ghép từ nhiều cỡ đoạn) - ghi đủ N dòng StockLedger, mỗi dòng đúng segmentSpecId/qty riêng', async () => {
      prisma.productionBatch.create.mockResolvedValue(batchRow);
      prisma.pieceBom.findMany.mockResolvedValue([
        { id: 1n, bomRevisionId: 5n, pieceId: 40n, segmentSpecId: 60n, qtyPerPiece: 3 },
        { id: 2n, bomRevisionId: 5n, pieceId: 40n, segmentSpecId: 61n, qtyPerPiece: 1 },
      ]);

      await service.create('1', dto, 'user-han', null, null);

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

    it('postEntry lỗi giữa chừng (dòng 2/3) - lỗi propagate ra ngoài, không nuốt (transaction bao ngoài sẽ rollback cả productionBatch.create)', async () => {
      prisma.productionBatch.create.mockResolvedValue(batchRow);
      prisma.pieceBom.findMany.mockResolvedValue([
        { id: 1n, bomRevisionId: 5n, pieceId: 40n, segmentSpecId: 60n, qtyPerPiece: 3 },
        { id: 2n, bomRevisionId: 5n, pieceId: 40n, segmentSpecId: 61n, qtyPerPiece: 1 },
      ]);
      stockLedgerService.postEntry
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('mất kết nối DB giữa chừng'));

      await expect(service.create('1', dto, 'user-han', null, null)).rejects.toThrow(
        'mất kết nối DB giữa chừng',
      );
      // create() + postSegmentConsumeEntries chạy trong CÙNG $transaction - lỗi ở dòng ledger thứ
      // 2 phải làm cả gọi $transaction() reject (Prisma thật sẽ rollback productionBatch.create
      // theo cùng cơ chế), không được để lộ ra thành công một phần.
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    // Quyết định nghiệp vụ #6 (docs/quy-doi-doan-phoi.md): tồn đoạn được phép âm khi báo sản
    // lượng vượt tồn thực tế. Không có test riêng cho "tồn không đủ" ở tầng unit vì service
    // KHÔNG gọi StockQuant để kiểm tra số dư trước khi postEntry() - test '1 PieceBom' ở trên
    // đã chứng minh điều này gián tiếp (không có nhánh throw/guard nào giữa lúc query PieceBom
    // và lúc gọi postEntry). Số dư âm thật sự chỉ quan sát được ở StockQuant sau khi trigger DB
    // materialize - thuộc phạm vi test tích hợp/E2E, không phải unit test service này.

    // 2026-09-03: mảnh cần CẢ Hàn+Sơn (bomPieceRow mặc định needsHan=true+needsSon=true) trước
    // đây bị trừ tồn đoạn sắt 2 LẦN - 1 lần khi Hàn báo (test '1 PieceBom' ở trên, stage=HAN), 1
    // lần khi Sơn báo lại CÙNG mảnh đó (dto ở đây). Giờ chỉ trừ đúng 1 lần ở Hàn (bước lắp ráp
    // thật) - Sơn báo không tiêu thêm đoạn nào.
    it('mảnh cần CẢ Hàn+Sơn - Sơn báo KHÔNG trừ tồn đoạn lần 2 (đã trừ ở Hàn)', async () => {
      const sonDto = { stage: MfgStage.SON, pieceId: '40', reportedQty: 20 };
      prisma.productionBatch.create.mockResolvedValue({ ...batchRow, stage: MfgStage.SON });
      prisma.pieceBom.findMany.mockResolvedValue([
        { id: 1n, bomRevisionId: 5n, pieceId: 40n, segmentSpecId: 60n, qtyPerPiece: 3 },
      ]);
      // bomPieceRow mặc định (beforeEach) đã needsHan=true+needsSon=true, không cần override.

      await service.create('1', sonDto, 'user-son', null, null);

      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    it('mảnh CHỈ cần Sơn (needsHan=false) - Sơn báo VẪN trừ tồn đoạn (không có Hàn nào trừ trước)', async () => {
      const sonDto = { stage: MfgStage.SON, pieceId: '40', reportedQty: 20 };
      prisma.bomPiece.findUnique.mockResolvedValue({
        ...bomPieceRow,
        needsHan: false,
        needsSon: true,
      });
      prisma.productionBatch.create.mockResolvedValue({ ...batchRow, stage: MfgStage.SON });
      prisma.pieceBom.findMany.mockResolvedValue([
        { id: 1n, bomRevisionId: 5n, pieceId: 40n, segmentSpecId: 60n, qtyPerPiece: 3 },
      ]);

      await service.create('1', sonDto, 'user-son', null, null);

      expect(stockLedgerService.postEntry).toHaveBeenCalledTimes(1);
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({ segmentSpecId: 60n, qty: 60 }),
        prisma,
      );
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
    });

    it('2 order khác nhau CÙNG bomRevisionId - dùng chung 1 query bomPiece nhưng KHÔNG lẫn awaiting/passed qty của nhau', async () => {
      const order2 = {
        ...order,
        id: 2n,
        poNumber: 'PO-32-1',
        quantity: 5,
        productionInvoiceItem: { salesOrder: { code: 'PO-32' } },
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
        { step: 'CAT', requiredQty: plannedQty, doneQty: 15 },
        { step: 'UON', requiredQty: plannedQty, doneQty: 5 },
      ]);
    });

    it('nhiều order CÙNG PI cùng bomRevisionId - doneQty theo bước KHÔNG lẫn giữa 2 order (getBatchPlanBatch)', async () => {
      const order2 = {
        ...order,
        id: 2n,
        poNumber: 'PO-32-1',
        quantity: 5,
        productionInvoiceItem: { salesOrder: { code: 'PO-32' } },
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

    it('happy path - bước ĐẦU TIÊN (CAT), tạo đúng dòng, KHÔNG cap theo plannedQty', async () => {
      prisma.pieceMaterialYield.findUnique.mockResolvedValue(yieldRow);
      prisma.pieceStepBatch.create.mockResolvedValue(createdRow);

      // plannedQty = 2×10 = 20, báo 999 vẫn phải qua được vì đây là bước đầu tiên (CAT), không cap.
      const bigDto = { ...dto, qty: 999 };
      const result = await service.recordPieceStepBatch('1', bigDto, 'user-phoi', 'PHOI');

      expect(result.id).toBe('900');
      expect(result.qty).toBe(10); // trả nguyên createdRow, không phải bigDto.qty
      expect(prisma.pieceStepBatch.create).toHaveBeenCalledWith({
        data: {
          productionOrderId: 1n,
          pieceId: 40n,
          step: 'CAT',
          qty: 999,
          reportedById: 'user-phoi',
          idempotencyKey: undefined,
        },
      });
    });

    it('processSteps RỖNG - BadRequest, bắt buộc dùng luồng cũ (báo thẳng qua create())', async () => {
      prisma.pieceMaterialYield.findUnique.mockResolvedValue({ ...yieldRow, processSteps: [] });

      await expect(service.recordPieceStepBatch('1', dto, 'user-phoi', 'PHOI')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.pieceStepBatch.create).not.toHaveBeenCalled();
    });

    it('mảnh không có PieceMaterialYield - BadRequest', async () => {
      prisma.pieceMaterialYield.findUnique.mockResolvedValue(null);

      await expect(service.recordPieceStepBatch('1', dto, 'user-phoi', 'PHOI')).rejects.toThrow(
        BadRequestException,
      );
    });

    it("step 'DAP' không nằm trong processSteps đã khai (['CAT','UON']) - BadRequest", async () => {
      prisma.pieceMaterialYield.findUnique.mockResolvedValue(yieldRow);

      await expect(
        service.recordPieceStepBatch('1', { ...dto, step: 'DAP' as const }, 'user-phoi', 'PHOI'),
      ).rejects.toThrow(BadRequestException);
    });

    it('báo bước SAU (UON) vượt số đã báo bước TRƯỚC (CAT) - BadRequest', async () => {
      prisma.pieceMaterialYield.findUnique.mockResolvedValue(yieldRow);
      prisma.pieceStepBatch.aggregate
        .mockResolvedValueOnce({ _sum: { qty: 10 } }) // donePrev (CAT) = 10
        .mockResolvedValueOnce({ _sum: { qty: 0 } }); // doneThis (UON) = 0

      await expect(
        service.recordPieceStepBatch(
          '1',
          { ...dto, step: 'UON' as const, qty: 11 },
          'user-phoi',
          'PHOI',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.pieceStepBatch.create).not.toHaveBeenCalled();
    });

    it('báo bước SAU (UON) ĐÚNG BẰNG số còn lại của bước trước - cho qua', async () => {
      prisma.pieceMaterialYield.findUnique.mockResolvedValue(yieldRow);
      prisma.pieceStepBatch.aggregate
        .mockResolvedValueOnce({ _sum: { qty: 10 } }) // donePrev (CAT) = 10
        .mockResolvedValueOnce({ _sum: { qty: 0 } }); // doneThis (UON) = 0
      prisma.pieceStepBatch.create.mockResolvedValue({
        ...createdRow,
        step: 'UON',
        qty: 10,
      });

      await expect(
        service.recordPieceStepBatch(
          '1',
          { ...dto, step: 'UON' as const, qty: 10 },
          'user-phoi',
          'PHOI',
        ),
      ).resolves.toBeDefined();
    });

    it("processSteps lưu LỘN XỘN thứ tự (['UON','CAT']) - vẫn hiểu CAT là bước trước UON khi tính 'vượt bước trước'", async () => {
      prisma.pieceMaterialYield.findUnique.mockResolvedValue({
        ...yieldRow,
        processSteps: ['UON', 'CAT'],
      });
      prisma.pieceStepBatch.aggregate
        .mockResolvedValueOnce({ _sum: { qty: 5 } }) // donePrev (CAT) = 5, dù lưu SAU UON trong mảng DB
        .mockResolvedValueOnce({ _sum: { qty: 0 } });

      await expect(
        service.recordPieceStepBatch(
          '1',
          { ...dto, step: 'UON' as const, qty: 6 },
          'user-phoi',
          'PHOI',
        ),
      ).rejects.toThrow(BadRequestException); // 6 > 5 (donePrev CAT) => vẫn bị chặn đúng
    });

    it('idempotency - cùng key gọi 2 lần chỉ tạo 1 bản ghi, lần 2 trả lại bản ghi cũ', async () => {
      prisma.pieceMaterialYield.findUnique.mockResolvedValue(yieldRow);
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
      expect(prisma.pieceMaterialYield.findUnique).not.toHaveBeenCalled();
    });

    it("mfgRole='HAN' báo hộ PHOI - Forbidden", async () => {
      await expect(service.recordPieceStepBatch('1', dto, 'user-han', MfgRole.HAN)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.pieceMaterialYield.findUnique).not.toHaveBeenCalled();
    });

    it('dto.stage khác PHOI - BadRequest ngay, không query gì', async () => {
      await expect(
        service.recordPieceStepBatch('1', { ...dto, stage: MfgStage.HAN }, 'user-phoi', 'PHOI'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.pieceMaterialYield.findUnique).not.toHaveBeenCalled();
    });

    it('PI không có SKU nào ACTIVE (floor-gate) - ConflictException, không tạo dòng', async () => {
      prisma.productionOrder.findFirst.mockResolvedValue(null);
      prisma.pieceMaterialYield.findUnique.mockResolvedValue(yieldRow);

      await expect(service.recordPieceStepBatch('1', dto, 'user-phoi', 'PHOI')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.pieceStepBatch.create).not.toHaveBeenCalled();
    });
  });

  // 2026-09-04: "chưa nhận vật tư thành phẩm (Sắt La/thanh nhôm) từ kho thì chưa báo sản lượng
  // được" - mirror SteelIssue chặn báo cắt khi status khác RECEIVED. Áp dụng ở CẢ create() (chốt
  // & gửi KCS) lẫn recordPieceStepBatch() (báo từng công đoạn), CHỈ khi stage=PHOI và piece có
  // PieceMaterialYield - không đụng Hàn/Sơn/piece Sắt thường.
  describe('create/recordPieceStepBatch - chặn khi chưa nhận vật tư thành phẩm (2026-09-04)', () => {
    const phoiDto = { stage: MfgStage.PHOI, pieceId: '40', reportedQty: 24 };
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

    it('create() - piece có PieceMaterialYield nhưng CHƯA nhận (sumReceived=0) - BadRequest, không tạo batch', async () => {
      prisma.pieceMaterialYield.findUnique.mockResolvedValue(yieldRow);
      materialYieldIssuesService.sumReceived.mockResolvedValue(0);

      await expect(service.create('1', phoiDto, 'user-phoi', null, null)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.productionBatch.create).not.toHaveBeenCalled();
    });

    it('create() - piece có PieceMaterialYield và ĐÃ nhận (sumReceived>0) - cho qua', async () => {
      prisma.pieceMaterialYield.findUnique.mockResolvedValue(yieldRow);
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
      prisma.pieceMaterialYield.findUnique.mockResolvedValue(null);
      prisma.productionBatch.create.mockResolvedValue({
        ...batchRow,
        stage: MfgStage.PHOI,
        reportedById: 'user-phoi',
      });

      await service.create('1', phoiDto, 'user-phoi', null, null);

      expect(materialYieldIssuesService.sumReceived).not.toHaveBeenCalled();
    });

    it('create() - stage=HAN/SON - không gọi sumReceived (ràng buộc chỉ áp dụng PHÔI)', async () => {
      const hanDto = { stage: MfgStage.HAN, pieceId: '40', reportedQty: 24 };
      prisma.bomPiece.findUnique.mockResolvedValue({ ...bomPieceRow, needsHan: true });
      prisma.pieceMaterialYield.findUnique.mockResolvedValue(yieldRow);
      prisma.productionBatch.create.mockResolvedValue({ ...batchRow, stage: MfgStage.HAN });

      await service.create('1', hanDto, 'user-han', null, null);

      expect(materialYieldIssuesService.sumReceived).not.toHaveBeenCalled();
    });

    it('recordPieceStepBatch() - CHƯA nhận (sumReceived=0) - BadRequest, không tạo dòng', async () => {
      prisma.pieceMaterialYield.findUnique.mockResolvedValue({
        ...yieldRow,
        processSteps: ['CAT'],
      });
      materialYieldIssuesService.sumReceived.mockResolvedValue(0);
      const stepDto = { stage: MfgStage.PHOI, pieceId: '40', step: 'CAT' as const, qty: 1 };

      await expect(service.recordPieceStepBatch('1', stepDto, 'user-phoi', 'PHOI')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.pieceStepBatch.create).not.toHaveBeenCalled();
    });
  });
});
