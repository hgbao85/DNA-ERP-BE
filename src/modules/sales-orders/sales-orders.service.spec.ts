import { NotFoundException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { SalesOrdersService } from './sales-orders.service';

describe('SalesOrdersService', () => {
  let service: SalesOrdersService;
  let prisma: {
    customer: { findUnique: jest.Mock };
    mfgProduct: { findUnique: jest.Mock };
    salesOrder: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    salesOrderItem: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
    productionInvoice: { create: jest.Mock; update: jest.Mock };
  };

  const customer = { id: 1n, name: 'Khach A' };
  const product = { id: 2n, factoryCode: 'SKU-01', name: 'Ghe A' };
  const orderWithItems = (overrides: Record<string, unknown> = {}) => ({
    id: 10n,
    code: 'PO-10',
    customerId: 1n,
    customer,
    orderDate: new Date('2026-01-01'),
    deliveryDate: null,
    depositAmount: { toNumber: () => 0 },
    depositConfirmed: false,
    paidAmount: { toNumber: () => 0 },
    attachmentName: null,
    attachmentUrl: null,
    note: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [],
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      customer: { findUnique: jest.fn() },
      mfgProduct: { findUnique: jest.fn() },
      salesOrder: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      salesOrderItem: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      productionInvoice: { create: jest.fn(), update: jest.fn() },
    };
    service = new SalesOrdersService(prisma as unknown as PrismaServiceType);
  });

  describe('create', () => {
    it('creates an order with items and assigns a code derived from the new id', async () => {
      prisma.customer.findUnique.mockResolvedValue(customer);
      prisma.mfgProduct.findUnique.mockResolvedValue(product);
      prisma.salesOrder.create.mockResolvedValue(orderWithItems({ code: 'PO-TMP-x' }));
      prisma.salesOrder.update.mockResolvedValue(orderWithItems({ code: 'PO-10' }));
      prisma.productionInvoice.create.mockResolvedValue({ id: 50n });
      prisma.productionInvoice.update.mockResolvedValue({ id: 50n, code: 'PI-50' });

      const result = await service.create({
        customerId: '1',
        orderDate: '2026-01-01',
        items: [{ mfgProductId: '2', totalQty: 5 }],
      });

      expect(result.code).toBe('PO-10');
      expect(prisma.salesOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { code: 'PO-10' } }),
      );
      expect(prisma.productionInvoice.create).toHaveBeenCalledWith(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
        expect.objectContaining({ data: expect.objectContaining({ salesOrderId: 10n }) }),
      );
    });

    it('rejects when the customer does not exist', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(
        service.create({
          customerId: '999',
          orderDate: '2026-01-01',
          items: [{ mfgProductId: '2', totalQty: 1 }],
        }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.salesOrder.create).not.toHaveBeenCalled();
    });

    it('rejects when an item references a non-existent product', async () => {
      prisma.customer.findUnique.mockResolvedValue(customer);
      prisma.mfgProduct.findUnique.mockResolvedValue(null);

      await expect(
        service.create({
          customerId: '1',
          orderDate: '2026-01-01',
          items: [{ mfgProductId: '999', totalQty: 1 }],
        }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.salesOrder.create).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('throws 404 for a non-existent id', async () => {
      prisma.salesOrder.findUnique.mockResolvedValue(null);

      await expect(service.findOne('999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateItem', () => {
    it('throws 404 when the item does not belong to the order', async () => {
      prisma.salesOrder.findUnique.mockResolvedValue(orderWithItems());
      prisma.salesOrderItem.findUnique.mockResolvedValue({ id: 5n, salesOrderId: 999n });

      await expect(service.updateItem('10', '5', { totalQty: 2 })).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
