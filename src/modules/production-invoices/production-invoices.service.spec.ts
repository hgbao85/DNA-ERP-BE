import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { SkusService } from '../skus/skus.service';
import { ProductionInvoicesService } from './production-invoices.service';

describe('ProductionInvoicesService', () => {
  let service: ProductionInvoicesService;
  let prisma: {
    salesOrder: { findUnique: jest.Mock };
    productionInvoice: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    productionInvoiceItem: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
    };
    mfgProduct: { findUnique: jest.Mock };
  };
  let skusService: { ensureProductionConfirmPlanForm: jest.Mock };

  const mfgProduct = { id: 2n, factoryCode: 'SKU-01', name: 'Ghe A' };
  const pi = (overrides: Record<string, unknown> = {}) => ({
    id: 7n,
    code: 'PI-7',
    salesOrderId: 1n,
    salesOrder: { code: 'PO-1' },
    status: 'PLANNING',
    deadline: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [],
    ...overrides,
  });
  const piItem = (overrides: Record<string, unknown> = {}) => ({
    id: 20n,
    productionInvoiceId: 7n,
    mfgProductId: 2n,
    mfgProduct,
    productVariantId: null,
    productVariant: null,
    quantity: 10,
    materialDeadline: null,
    deliveryDeadline: null,
    prodApprovalStatus: null,
    requestedAt: null,
    requestedById: null,
    warehouseCode: null,
    warehouseName: null,
    qlsxAt: null,
    qlsxById: null,
    decidedAt: null,
    decidedById: null,
    rejectReason: null,
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      salesOrder: { findUnique: jest.fn() },
      productionInvoice: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      productionInvoiceItem: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
      },
      mfgProduct: { findUnique: jest.fn() },
    };
    skusService = { ensureProductionConfirmPlanForm: jest.fn() };
    service = new ProductionInvoicesService(
      prisma as unknown as PrismaServiceType,
      skusService as unknown as SkusService,
    );
  });

  describe('sendItemToQlsx', () => {
    it('moves an unsent item to WAITING_QLSX', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(piItem());
      prisma.productionInvoiceItem.update.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_QLSX' }),
      );

      const result = await service.sendItemToQlsx('7', '20', 'user-khsx');
      expect(result.prodApprovalStatus).toBe('WAITING_QLSX');
    });

    it('rejects re-sending an item that is already WAITING_BOSS', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_BOSS' }),
      );

      await expect(service.sendItemToQlsx('7', '20', 'user-khsx')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('sendItemToBoss', () => {
    it('rejects when the item is not WAITING_QLSX', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: null }),
      );

      await expect(
        service.sendItemToBoss('7', '20', 'thanh-pham-2', 'Kho Thành phẩm 2', 'user-qlsx'),
      ).rejects.toThrow(ConflictException);
    });

    it('records the chosen warehouse scope/name and moves to WAITING_BOSS', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_QLSX' }),
      );
      prisma.productionInvoiceItem.update.mockResolvedValue(
        piItem({
          prodApprovalStatus: 'WAITING_BOSS',
          warehouseCode: 'thanh-pham-2',
          warehouseName: 'Kho Thành phẩm 2',
        }),
      );

      const result = await service.sendItemToBoss(
        '7',
        '20',
        'thanh-pham-2',
        'Kho Thành phẩm 2',
        'user-qlsx',
      );
      expect(result.prodApprovalStatus).toBe('WAITING_BOSS');
      expect(result.warehouseCode).toBe('thanh-pham-2');
    });
  });

  describe('approveItem', () => {
    it('seeds a PRODUCTION_CONFIRM plan form and flips PI to PRODUCING when this was the last item', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_BOSS' }),
      );
      prisma.productionInvoiceItem.update.mockResolvedValue(
        piItem({ prodApprovalStatus: 'APPROVED' }),
      );
      prisma.productionInvoiceItem.count.mockResolvedValue(0); // no remaining un-approved items

      await service.approveItem('7', '20', 'user-boss');

      expect(skusService.ensureProductionConfirmPlanForm).toHaveBeenCalledWith(
        1n,
        2n,
        7n,
        'user-boss',
      );
      expect(prisma.productionInvoice.update).toHaveBeenCalledWith({
        where: { id: 7n },
        data: { status: 'PRODUCING' },
      });
    });

    it('does not flip PI status when other items are still pending', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_BOSS' }),
      );
      prisma.productionInvoiceItem.update.mockResolvedValue(
        piItem({ prodApprovalStatus: 'APPROVED' }),
      );
      prisma.productionInvoiceItem.count.mockResolvedValue(2);

      await service.approveItem('7', '20', 'user-boss');

      expect(prisma.productionInvoice.update).not.toHaveBeenCalled();
    });

    it('rejects approving an item not in WAITING_BOSS', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_QLSX' }),
      );

      await expect(service.approveItem('7', '20', 'user-boss')).rejects.toThrow(ConflictException);
    });
  });

  describe('rejectItem', () => {
    it('records the rejection reason and decidedBy', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_BOSS' }),
      );
      prisma.productionInvoiceItem.update.mockResolvedValue(
        piItem({ prodApprovalStatus: 'REJECTED', rejectReason: 'Thiếu vật tư' }),
      );

      const result = await service.rejectItem('7', '20', 'Thiếu vật tư', 'user-boss');
      expect(result.rejectReason).toBe('Thiếu vật tư');
    });
  });

  describe('findOne', () => {
    it('throws 404 for a non-existent PI', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(null);
      await expect(service.findOne('999')).rejects.toThrow(NotFoundException);
    });
  });
});
