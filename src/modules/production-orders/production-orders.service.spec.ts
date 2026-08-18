import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { BomRevisionStatus } from '../../generated/prisma/client';
import { ProductionOrdersService } from './production-orders.service';

describe('ProductionOrdersService', () => {
  let service: ProductionOrdersService;
  let prisma: {
    bomRevision: { findFirst: jest.Mock };
    productionInvoiceItem: { findUniqueOrThrow: jest.Mock };
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
    poNumber: 'PO-31-1',
    productionInvoiceItemId: 20n,
    mfgProductId: 2n,
    bomRevisionId: 5n,
    quantity: 60,
    status: 'RELEASED',
    releasedAt: new Date(),
    createdAt: new Date(),
    productionInvoiceItem: { salesOrder: { code: 'PO-31' } },
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      bomRevision: { findFirst: jest.fn() },
      productionInvoiceItem: { findUniqueOrThrow: jest.fn() },
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
    it('derives poNumber from the sales order code + SKU sequence when the item is linked to one', async () => {
      prisma.bomRevision.findFirst.mockResolvedValue(activeRevision);
      prisma.productionInvoiceItem.findUniqueOrThrow.mockResolvedValue({
        salesOrderId: 31n,
        salesOrder: { code: 'PO-31' },
      });
      prisma.productionOrder.count.mockResolvedValue(1); // 1 SKU của đơn này đã có PO trước đó
      prisma.productionOrder.create.mockResolvedValue(order({ poNumber: 'PO-31-2' }));

      const result = await service.createFromApproval(20n, 2n, 60);

      expect(prisma.bomRevision.findFirst).toHaveBeenCalledWith({
        where: { mfgProductId: 2n, status: BomRevisionStatus.ACTIVE },
      });
      expect(prisma.productionOrder.count).toHaveBeenCalledWith({
        where: { productionInvoiceItem: { salesOrderId: 31n } },
      });
      expect(prisma.productionOrder.create).toHaveBeenCalledWith({
        data: {
          poNumber: 'PO-31-2',
          productionInvoiceItemId: 20n,
          mfgProductId: 2n,
          bomRevisionId: 5n,
          quantity: 60,
        },
      });
      expect(result.quantity).toBe(60);
    });

    it('falls back to "NB-{itemId}" when the item has no sales order', async () => {
      prisma.bomRevision.findFirst.mockResolvedValue(activeRevision);
      prisma.productionInvoiceItem.findUniqueOrThrow.mockResolvedValue({
        salesOrderId: null,
        salesOrder: null,
      });
      prisma.productionOrder.create.mockResolvedValue(order({ poNumber: 'NB-20' }));

      await service.createFromApproval(20n, 2n, 60);

      expect(prisma.productionOrder.count).not.toHaveBeenCalled();
      expect(prisma.productionOrder.create).toHaveBeenCalledWith({
        data: {
          poNumber: 'NB-20',
          productionInvoiceItemId: 20n,
          mfgProductId: 2n,
          bomRevisionId: 5n,
          quantity: 60,
        },
      });
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
    it('returns the mapped response dto, including the sales order code', async () => {
      prisma.productionOrder.findUnique.mockResolvedValue(order());

      const result = await service.findOne('9');

      expect(result.id).toBe('9');
      expect(result.poNumber).toBe('PO-31-1');
      expect(result.salesOrderCode).toBe('PO-31');
      expect(result.mfgProductId).toBe('2');
    });

    it('returns null salesOrderCode when the item has no sales order', async () => {
      prisma.productionOrder.findUnique.mockResolvedValue(
        order({ productionInvoiceItem: { salesOrder: null } }),
      );

      const result = await service.findOne('9');

      expect(result.salesOrderCode).toBeNull();
    });

    it('throws NotFoundException when not found', async () => {
      prisma.productionOrder.findUnique.mockResolvedValue(null);

      await expect(service.findOne('999')).rejects.toThrow(NotFoundException);
    });
  });
});
