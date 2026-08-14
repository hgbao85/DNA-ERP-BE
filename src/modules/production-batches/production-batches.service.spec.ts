import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MfgRole, MfgStage, StockLedgerRefType } from '../../generated/prisma/client';
import { PrismaServiceType } from '../../prisma/prisma.service';
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
    productionOrder: { findUnique: jest.Mock };
    bomPart: { findUnique: jest.Mock };
    partBom: { findMany: jest.Mock };
    warehouse: { findUniqueOrThrow: jest.Mock };
  };
  let stockLedgerService: { postEntry: jest.Mock };

  const order = { id: 1n, poNumber: 'PO-1', bomRevisionId: 5n, quantity: 10 };
  const part = { id: 40n, code: 'KHUNG-TUA', name: 'Khung tựa' };
  const bomPartRow = { id: 1n, bomRevisionId: 5n, partId: 40n, qtyPerUnit: 2 };
  const steelWarehouse = { id: 90n, code: 'phoi-son-han' };
  const productionWarehouse = { id: 91n, code: 'PRODUCTION' };

  const batchRow = {
    id: 700n,
    stage: MfgStage.HAN,
    productionOrderId: 1n,
    partId: 40n,
    reportedQty: 20,
    status: 'AWAITING_QC',
    idempotencyKey: null,
    reportedAt: new Date(),
    reportedById: 'user-han',
    reworkOfId: null,
    productionOrder: order,
    part,
  };

  beforeEach(() => {
    prisma = {
      productionBatch: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
      },
      productionOrder: { findUnique: jest.fn().mockResolvedValue(order) },
      bomPart: { findUnique: jest.fn().mockResolvedValue(bomPartRow) },
      // Mặc định rỗng - đa số test case không quan tâm tới nhánh trừ tồn đoạn (mục "Trừ tồn đoạn
      // sắt (SEGMENT_CONSUME)" bên dưới mới override).
      partBom: { findMany: jest.fn().mockResolvedValue([]) },
      warehouse: {
        findUniqueOrThrow: jest
          .fn()
          .mockImplementation(({ where: { code } }: { where: { code: string } }) =>
            Promise.resolve(code === 'phoi-son-han' ? steelWarehouse : productionWarehouse),
          ),
      },
    };
    stockLedgerService = { postEntry: jest.fn().mockResolvedValue({}) };
    service = new ProductionBatchesService(
      prisma as unknown as PrismaServiceType,
      stockLedgerService as unknown as StockLedgerService,
    );
  });

  describe('create', () => {
    const dto = { stage: MfgStage.HAN, partId: '40', reportedQty: 20 };

    it('happy path - mfgRole null (quản lý) tạo lô mới', async () => {
      prisma.productionBatch.create.mockResolvedValue(batchRow);

      const result = await service.create('1', dto, 'user-han', null);

      expect(prisma.productionBatch.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({
            stage: MfgStage.HAN,
            productionOrderId: 1n,
            partId: 40n,
            reportedQty: 20,
          }),
        }),
      );
      expect(result.id).toBe('700');
    });

    it('idempotency short-circuit - trả về lô cũ, không tạo mới, nhưng vẫn gọi lại postSegmentConsumeEntries (retry-safety)', async () => {
      prisma.productionBatch.findUnique.mockResolvedValue(batchRow);
      prisma.partBom.findMany.mockResolvedValue([
        { id: 1n, bomRevisionId: 5n, partId: 40n, segmentSpecId: 60n, qtyPerPart: 3 },
      ]);

      const result = await service.create('1', dto, 'user-han', null, 'idem-key-1');

      expect(prisma.productionBatch.create).not.toHaveBeenCalled();
      expect(result.id).toBe('700');
      // Xem describe('trừ tồn đoạn sắt (SEGMENT_CONSUME)') bên dưới cho assertion đầy đủ của
      // postEntry - test này chỉ xác nhận retry-safety (vẫn gọi lại dù không tạo bản ghi mới).
      expect(stockLedgerService.postEntry).toHaveBeenCalled();
    });

    it('cho phép mfgRole khớp đúng stage (HAN)', async () => {
      prisma.productionBatch.create.mockResolvedValue(batchRow);
      await expect(service.create('1', dto, 'user-han', MfgRole.HAN)).resolves.toBeDefined();
    });

    it('ném ForbiddenException khi mfgRole không khớp stage (SON báo hộ HAN)', async () => {
      await expect(service.create('1', dto, 'user-son', MfgRole.SON)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.productionBatch.create).not.toHaveBeenCalled();
    });

    it('ném BadRequestException khi stage không phải HAN/SON', async () => {
      await expect(
        service.create('1', { ...dto, stage: MfgStage.PHOI }, 'user-1', null),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.productionBatch.create).not.toHaveBeenCalled();
    });

    it('ném NotFoundException khi production order không tồn tại', async () => {
      prisma.productionOrder.findUnique.mockResolvedValue(null);
      await expect(service.create('1', dto, 'user-han', null)).rejects.toThrow(NotFoundException);
    });

    it('ném NotFoundException khi chi tiết không thuộc BOM của lệnh sản xuất này', async () => {
      prisma.bomPart.findUnique.mockResolvedValue(null);
      await expect(service.create('1', dto, 'user-han', null)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create - trừ tồn đoạn sắt (SEGMENT_CONSUME)', () => {
    const dto = { stage: MfgStage.HAN, partId: '40', reportedQty: 20 };

    it('không có PartBom nào cho part - không gọi postEntry, không query warehouse', async () => {
      prisma.productionBatch.create.mockResolvedValue(batchRow);
      prisma.partBom.findMany.mockResolvedValue([]);

      await service.create('1', dto, 'user-han', null);

      expect(prisma.partBom.findMany).toHaveBeenCalledWith({
        where: { bomRevisionId: order.bomRevisionId, partId: 40n },
      });
      expect(prisma.warehouse.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    it('1 PartBom - ghi đúng 1 dòng StockLedger, qty = qtyPerPart × reportedQty', async () => {
      prisma.productionBatch.create.mockResolvedValue(batchRow);
      prisma.partBom.findMany.mockResolvedValue([
        { id: 1n, bomRevisionId: 5n, partId: 40n, segmentSpecId: 60n, qtyPerPart: 3 },
      ]);

      await service.create('1', dto, 'user-han', null);

      expect(stockLedgerService.postEntry).toHaveBeenCalledTimes(1);
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith({
        fromWarehouseId: steelWarehouse.id,
        toWarehouseId: productionWarehouse.id,
        segmentSpecId: 60n,
        qty: 60, // 3 × reportedQty(20)
        refType: StockLedgerRefType.SEGMENT_CONSUME,
        refId: '700',
        createdById: 'user-han',
        idempotencyKey: 'production-batch-segment-consume:700:60',
      });
    });

    it('nhiều PartBom (1 Part ghép từ nhiều cỡ đoạn) - ghi đủ N dòng StockLedger, mỗi dòng đúng segmentSpecId/qty riêng', async () => {
      prisma.productionBatch.create.mockResolvedValue(batchRow);
      prisma.partBom.findMany.mockResolvedValue([
        { id: 1n, bomRevisionId: 5n, partId: 40n, segmentSpecId: 60n, qtyPerPart: 3 },
        { id: 2n, bomRevisionId: 5n, partId: 40n, segmentSpecId: 61n, qtyPerPart: 1 },
      ]);

      await service.create('1', dto, 'user-han', null);

      expect(stockLedgerService.postEntry).toHaveBeenCalledTimes(2);
      expect(stockLedgerService.postEntry).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ segmentSpecId: 60n, qty: 60 }),
      );
      expect(stockLedgerService.postEntry).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ segmentSpecId: 61n, qty: 20 }),
      );
    });

    // Quyết định nghiệp vụ #6 (docs/quy-doi-doan-phoi.md): tồn đoạn được phép âm khi báo sản
    // lượng vượt tồn thực tế. Không có test riêng cho "tồn không đủ" ở tầng unit vì service
    // KHÔNG gọi StockQuant để kiểm tra số dư trước khi postEntry() - test '1 PartBom' ở trên
    // đã chứng minh điều này gián tiếp (không có nhánh throw/guard nào giữa lúc query PartBom
    // và lúc gọi postEntry). Số dư âm thật sự chỉ quan sát được ở StockQuant sau khi trigger DB
    // materialize - thuộc phạm vi test tích hợp/E2E, không phải unit test service này.
  });
});
