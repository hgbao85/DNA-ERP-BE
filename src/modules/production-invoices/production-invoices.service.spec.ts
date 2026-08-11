import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { ProdItemStageType } from '../../generated/prisma/client';
import { CuttingProposalsService } from '../cutting-proposals/cutting-proposals.service';
import { ProductionOrdersService } from '../production-orders/production-orders.service';
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
    productionOrder: { findUnique: jest.Mock };
    bomPiece: { findMany: jest.Mock; findUnique: jest.Mock };
    transferCheckResult: { findMany: jest.Mock; create: jest.Mock };
    weavingReceipt: { groupBy: jest.Mock };
    $transaction: jest.Mock;
  };
  let skusService: { ensureProductionConfirmPlanForm: jest.Mock };
  let productionOrdersService: { createFromApproval: jest.Mock };
  let cuttingProposalsService: { requestForOrder: jest.Mock };

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
      productionOrder: { findUnique: jest.fn() },
      bomPiece: { findMany: jest.fn(), findUnique: jest.fn() },
      transferCheckResult: { findMany: jest.fn(), create: jest.fn() },
      weavingReceipt: { groupBy: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(prisma))),
    };
    skusService = { ensureProductionConfirmPlanForm: jest.fn() };
    productionOrdersService = {
      createFromApproval: jest.fn().mockResolvedValue({ id: 99n }),
    };
    cuttingProposalsService = { requestForOrder: jest.fn().mockResolvedValue({ id: '1' }) };
    service = new ProductionInvoicesService(
      prisma as unknown as PrismaServiceType,
      skusService as unknown as SkusService,
      productionOrdersService as unknown as ProductionOrdersService,
      cuttingProposalsService as unknown as CuttingProposalsService,
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
      expect(productionOrdersService.createFromApproval).toHaveBeenCalledWith(20n, 2n, 10);
      expect(cuttingProposalsService.requestForOrder).toHaveBeenCalledWith(99n, {
        requestedById: 'user-boss',
      });
      expect(prisma.productionInvoice.update).toHaveBeenCalledWith({
        where: { id: 7n },
        data: { status: 'PRODUCING' },
      });
    });

    it('still approves the item even when the auto cutting-proposal trigger fails', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_BOSS' }),
      );
      prisma.productionInvoiceItem.update.mockResolvedValue(
        piItem({ prodApprovalStatus: 'APPROVED' }),
      );
      prisma.productionInvoiceItem.count.mockResolvedValue(2);
      productionOrdersService.createFromApproval.mockRejectedValue(
        new Error('no ACTIVE bom revision'),
      );

      const result = await service.approveItem('7', '20', 'user-boss');

      expect(result.prodApprovalStatus).toBe('APPROVED');
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

  describe('transfer-check (Chuyền kiểm)', () => {
    const productionOrder = { id: 99n, bomRevisionId: 5n, quantity: 10 };
    const bomPieceRow = (overrides: Record<string, unknown> = {}) => ({
      bomRevisionId: 5n,
      pieceId: 30n,
      qtyPerUnit: 2,
      piece: { id: 30n, name: 'Thân trên' },
      ...overrides,
    });

    describe('listTransferCheckPieces', () => {
      it('computes totalQty from BomPiece.qtyPerUnit × ProductionOrder.quantity and sums checked results', async () => {
        prisma.productionInvoice.findUnique.mockResolvedValue(pi());
        prisma.productionInvoiceItem.findUnique.mockResolvedValue(piItem());
        prisma.productionOrder.findUnique.mockResolvedValue(productionOrder);
        prisma.bomPiece.findMany.mockResolvedValue([bomPieceRow()]);
        prisma.transferCheckResult.findMany.mockResolvedValue([
          { pieceId: 30n, checkedQty: 3, defects: [{ id: 1n }] },
          { pieceId: 30n, checkedQty: 2, defects: [] },
        ]);
        prisma.weavingReceipt.groupBy.mockResolvedValue([{ pieceId: 30n, _sum: { qty: 7 } }]);

        const [result] = await service.listTransferCheckPieces('7', '20');

        expect(result).toMatchObject({
          pieceId: '30',
          pieceName: 'Thân trên',
          totalQty: 20, // 2 qtyPerUnit × 10 quantity
          readyQty: 7, // SUM(WeavingReceipt.qty) - xem WeavingIssuesModule
          checkedQty: 5, // 3 + 2, cộng dồn qua SUM, không phải đọc-rồi-ghi
          defectCount: 1,
        });
      });

      it('readyQty = 0 khi mảnh chưa có WeavingReceipt nào (không crash)', async () => {
        prisma.productionInvoice.findUnique.mockResolvedValue(pi());
        prisma.productionInvoiceItem.findUnique.mockResolvedValue(piItem());
        prisma.productionOrder.findUnique.mockResolvedValue(productionOrder);
        prisma.bomPiece.findMany.mockResolvedValue([bomPieceRow()]);
        prisma.transferCheckResult.findMany.mockResolvedValue([]);
        prisma.weavingReceipt.groupBy.mockResolvedValue([]);

        const [result] = await service.listTransferCheckPieces('7', '20');

        expect(result.readyQty).toBe(0);
      });

      it('rejects when the item has no ProductionOrder yet (chưa được Sếp duyệt)', async () => {
        prisma.productionInvoice.findUnique.mockResolvedValue(pi());
        prisma.productionInvoiceItem.findUnique.mockResolvedValue(piItem());
        prisma.productionOrder.findUnique.mockResolvedValue(null);

        await expect(service.listTransferCheckPieces('7', '20')).rejects.toThrow(ConflictException);
      });
    });

    describe('recordTransferCheck', () => {
      it('creates a new check row (append-only) with defects and returns the updated aggregate', async () => {
        prisma.productionInvoice.findUnique.mockResolvedValue(pi());
        prisma.productionInvoiceItem.findUnique.mockResolvedValue(piItem());
        prisma.productionOrder.findUnique.mockResolvedValue(productionOrder);
        prisma.bomPiece.findUnique.mockResolvedValue(bomPieceRow());
        prisma.bomPiece.findMany.mockResolvedValue([bomPieceRow()]);
        prisma.transferCheckResult.findMany.mockResolvedValue([
          { pieceId: 30n, checkedQty: 4, defects: [{ id: 1n }] },
        ]);

        const result = await service.recordTransferCheck(
          '7',
          '20',
          { pieceId: '30', checkedQty: 4, defects: [{ reason: 'Móp góc' }] },
          'user-kho',
        );

        expect(prisma.transferCheckResult.create).toHaveBeenCalledWith(
          expect.objectContaining({
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
            data: expect.objectContaining({
              productionInvoiceItemId: 20n,
              pieceId: 30n,
              checkedQty: 4,
              checkedById: 'user-kho',

              defects: { create: [{ reason: 'Móp góc', imageUrl: undefined }] },
            }),
          }),
        );
        expect(result.checkedQty).toBe(4);
        expect(result.defectCount).toBe(1);
      });

      it('rejects a piece that is not part of the item BOM instead of silently recording it', async () => {
        prisma.productionInvoice.findUnique.mockResolvedValue(pi());
        prisma.productionInvoiceItem.findUnique.mockResolvedValue(piItem());
        prisma.productionOrder.findUnique.mockResolvedValue(productionOrder);
        prisma.bomPiece.findUnique.mockResolvedValue(null);

        await expect(
          service.recordTransferCheck('7', '20', { pieceId: '999', checkedQty: 1 }, 'user-kho'),
        ).rejects.toThrow(NotFoundException);
        expect(prisma.transferCheckResult.create).not.toHaveBeenCalled();
      });

      it('2 lần kiểm liên tiếp cùng 1 mảnh cộng dồn đúng, không ghi đè lẫn nhau', async () => {
        prisma.productionInvoice.findUnique.mockResolvedValue(pi());
        prisma.productionInvoiceItem.findUnique.mockResolvedValue(piItem());
        prisma.productionOrder.findUnique.mockResolvedValue(productionOrder);
        prisma.bomPiece.findUnique.mockResolvedValue(bomPieceRow());
        prisma.bomPiece.findMany.mockResolvedValue([bomPieceRow()]);
        prisma.transferCheckResult.findMany
          .mockResolvedValueOnce([{ pieceId: 30n, checkedQty: 3, defects: [] }])
          .mockResolvedValueOnce([
            { pieceId: 30n, checkedQty: 3, defects: [] },
            { pieceId: 30n, checkedQty: 2, defects: [] },
          ]);

        const first = await service.recordTransferCheck(
          '7',
          '20',
          { pieceId: '30', checkedQty: 3 },
          'user-kho',
        );
        const second = await service.recordTransferCheck(
          '7',
          '20',
          { pieceId: '30', checkedQty: 2 },
          'user-kho',
        );

        expect(first.checkedQty).toBe(3);
        expect(second.checkedQty).toBe(5);
        expect(prisma.transferCheckResult.create).toHaveBeenCalledTimes(2);
      });
    });
  });
});
