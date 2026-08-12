import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { BomRevisionStatus } from '../../generated/prisma/client';
import { ProductionOrdersService } from './production-orders.service';

describe('ProductionOrdersService', () => {
  let service: ProductionOrdersService;
  let prisma: {
    bomRevision: { findFirst: jest.Mock };
    productionOrder: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
  };

  const activeRevision = { id: 5n, mfgProductId: 2n, status: BomRevisionStatus.ACTIVE };
  const order = (overrides: Record<string, unknown> = {}) => ({
    id: 9n,
    poNumber: 'PO-9',
    productionInvoiceItemId: 20n,
    mfgProductId: 2n,
    bomRevisionId: 5n,
    quantity: 60,
    status: 'RELEASED',
    releasedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      bomRevision: { findFirst: jest.fn() },
      productionOrder: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };
    service = new ProductionOrdersService(prisma as unknown as PrismaServiceType);
  });

  describe('createFromApproval', () => {
    it('snapshots quantity and pins the ACTIVE bom revision at creation time', async () => {
      prisma.bomRevision.findFirst.mockResolvedValue(activeRevision);
      prisma.productionOrder.create.mockResolvedValue(order({ poNumber: 'PENDING-20' }));
      prisma.productionOrder.update.mockResolvedValue(order());

      const result = await service.createFromApproval(20n, 2n, 60);

      expect(prisma.bomRevision.findFirst).toHaveBeenCalledWith({
        where: { mfgProductId: 2n, status: BomRevisionStatus.ACTIVE },
      });
      expect(prisma.productionOrder.create).toHaveBeenCalledWith({
        data: {
          poNumber: 'PENDING-20',
          productionInvoiceItemId: 20n,
          mfgProductId: 2n,
          bomRevisionId: 5n,
          quantity: 60,
        },
      });
      expect(prisma.productionOrder.update).toHaveBeenCalledWith({
        where: { id: 9n },
        data: { poNumber: 'PO-9' },
      });
      expect(result.quantity).toBe(60);
    });

    it('throws NotFoundException when the product has no ACTIVE bom revision', async () => {
      prisma.bomRevision.findFirst.mockResolvedValue(null);

      await expect(service.createFromApproval(20n, 2n, 60)).rejects.toThrow(NotFoundException);
      expect(prisma.productionOrder.create).not.toHaveBeenCalled();
    });
  });

  describe('assertActiveBomRevisionExists — D.p1-bom-check', () => {
    it('resolves silently when an ACTIVE bom revision exists', async () => {
      prisma.bomRevision.findFirst.mockResolvedValue(activeRevision);

      await expect(service.assertActiveBomRevisionExists(2n)).resolves.toBeUndefined();
    });

    it('throws ConflictException (not NotFoundException) when no ACTIVE bom revision exists', async () => {
      prisma.bomRevision.findFirst.mockResolvedValue(null);

      await expect(service.assertActiveBomRevisionExists(2n)).rejects.toThrow(ConflictException);
      expect(prisma.bomRevision.findFirst).toHaveBeenCalledWith({
        where: { mfgProductId: 2n, status: BomRevisionStatus.ACTIVE },
      });
    });
  });

  describe('findOne', () => {
    it('returns the mapped response dto', async () => {
      prisma.productionOrder.findUnique.mockResolvedValue(order());

      const result = await service.findOne('9');

      expect(result.id).toBe('9');
      expect(result.poNumber).toBe('PO-9');
      expect(result.mfgProductId).toBe('2');
    });

    it('throws NotFoundException when not found', async () => {
      prisma.productionOrder.findUnique.mockResolvedValue(null);

      await expect(service.findOne('999')).rejects.toThrow(NotFoundException);
    });
  });
});
