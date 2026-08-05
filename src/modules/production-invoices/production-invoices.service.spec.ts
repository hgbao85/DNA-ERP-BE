import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { ProdItemStageType } from '../../generated/prisma/client';
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
    productionInvoiceItemStage: { upsert: jest.Mock };
    mfgProduct: { findUnique: jest.Mock };
    $transaction: jest.Mock;
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
    stages: [],
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
      productionInvoiceItemStage: { upsert: jest.fn() },
      mfgProduct: { findUnique: jest.fn() },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(prisma))),
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

  describe('updateItem', () => {
    it('updates materialDeadline/deliveryDeadline and upserts each stage deadline', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique
        .mockResolvedValueOnce(piItem()) // findItemOrThrow trước khi ghi
        .mockResolvedValueOnce(
          piItem({
            materialDeadline: new Date('2026-08-01'),
            deliveryDeadline: new Date('2026-08-20'),
            stages: [
              { stageType: 'FRAME', deadline: new Date('2026-08-10') },
              { stageType: 'WEAVING', deadline: new Date('2026-08-15') },
            ],
          }),
        ); // findItemOrThrow đọc lại sau khi ghi

      const result = await service.updateItem('7', '20', {
        materialDeadline: '2026-08-01',
        deliveryDeadline: '2026-08-20',
        stages: [
          { stageType: ProdItemStageType.FRAME, deadline: '2026-08-10' },
          { stageType: ProdItemStageType.WEAVING, deadline: '2026-08-15' },
        ],
      });

      expect(prisma.productionInvoiceItem.update).toHaveBeenCalledWith({
        where: { id: 20n },
        data: {
          materialDeadline: new Date('2026-08-01'),
          deliveryDeadline: new Date('2026-08-20'),
        },
      });
      expect(prisma.productionInvoiceItemStage.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.productionInvoiceItemStage.upsert).toHaveBeenCalledWith({
        where: {
          productionInvoiceItemId_stageType: { productionInvoiceItemId: 20n, stageType: 'FRAME' },
        },
        create: {
          productionInvoiceItemId: 20n,
          stageType: 'FRAME',
          deadline: new Date('2026-08-10'),
        },
        update: { deadline: new Date('2026-08-10') },
      });
      expect(result.stages).toHaveLength(2);
    });

    it('does not touch item fields when only stages are sent', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(piItem());

      await service.updateItem('7', '20', {
        stages: [{ stageType: ProdItemStageType.PACKAGING, deadline: '2026-08-17' }],
      });

      expect(prisma.productionInvoiceItem.update).not.toHaveBeenCalled();
      expect(prisma.productionInvoiceItemStage.upsert).toHaveBeenCalledTimes(1);
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

  describe('rejectItemByQlsx', () => {
    it('rejects an item still WAITING_QLSX, sending it back to KHSX', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_QLSX' }),
      );
      prisma.productionInvoiceItem.update.mockResolvedValue(
        piItem({ prodApprovalStatus: 'REJECTED', rejectReason: 'Không đủ kho' }),
      );

      const result = await service.rejectItemByQlsx('7', '20', 'Không đủ kho', 'user-qlsx');

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest.Mock.calls typing
      const updateCall = prisma.productionInvoiceItem.update.mock.calls[0][0] as {
        where: { id: bigint };
        data: {
          prodApprovalStatus: string;
          rejectReason: string;
          decidedAt: Date;
          decidedById: string;
        };
        include: unknown;
      };
      expect(updateCall.where).toEqual({ id: 20n });
      expect(updateCall.data.prodApprovalStatus).toBe('REJECTED');
      expect(updateCall.data.rejectReason).toBe('Không đủ kho');
      expect(updateCall.data.decidedById).toBe('user-qlsx');
      expect(updateCall.data.decidedAt).toBeInstanceOf(Date);
      expect(updateCall.include).toEqual({ mfgProduct: true, productVariant: true, stages: true });
      expect(result.rejectReason).toBe('Không đủ kho');
    });

    it('rejects rejecting an item not in WAITING_QLSX', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_BOSS' }),
      );

      await expect(service.rejectItemByQlsx('7', '20', 'lý do', 'user-qlsx')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('findOne', () => {
    it('throws 404 for a non-existent PI', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(null);
      await expect(service.findOne('999')).rejects.toThrow(NotFoundException);
    });
  });
});
