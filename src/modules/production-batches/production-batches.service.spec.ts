import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MfgRole, MfgStage } from '../../generated/prisma/client';
import { PrismaServiceType } from '../../prisma/prisma.service';
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
  };

  const order = { id: 1n, poNumber: 'PO-1', bomRevisionId: 5n, quantity: 10 };
  const part = { id: 40n, code: 'KHUNG-TUA', name: 'Khung tựa' };
  const bomPartRow = { id: 1n, bomRevisionId: 5n, partId: 40n, qtyPerUnit: 2 };

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
    };
    service = new ProductionBatchesService(prisma as unknown as PrismaServiceType);
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

    it('idempotency short-circuit - trả về lô cũ, không tạo mới', async () => {
      prisma.productionBatch.findUnique.mockResolvedValue(batchRow);

      const result = await service.create('1', dto, 'user-han', null, 'idem-key-1');

      expect(prisma.productionBatch.create).not.toHaveBeenCalled();
      expect(result.id).toBe('700');
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
});
