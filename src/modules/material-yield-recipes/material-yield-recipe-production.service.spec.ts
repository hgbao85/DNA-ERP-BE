import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PieceStepBundleStatus, StockLedgerRefType } from '../../generated/prisma/client';
import { PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';
import { NotificationsService } from '../notifications/notifications.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { MaterialYieldRecipeIssuesService } from './material-yield-recipe-issues.service';
import { MaterialYieldRecipeProductionService } from './material-yield-recipe-production.service';
import { MaterialYieldRecipesService } from './material-yield-recipes.service';

describe('MaterialYieldRecipeProductionService', () => {
  let service: MaterialYieldRecipeProductionService;
  let prisma: {
    materialYieldStepBatch: { findUnique: jest.Mock };
    materialYieldStepBundle: { findMany: jest.Mock; count: jest.Mock; findUnique: jest.Mock };
    productionOrder: { findFirst: jest.Mock };
    auditLog: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let tx: {
    materialYieldStepBatch: { create: jest.Mock; findMany: jest.Mock; updateMany: jest.Mock };
    materialYieldStepBundle: { create: jest.Mock };
    warehouse: { findUniqueOrThrow: jest.Mock };
    $executeRaw: jest.Mock;
    $queryRaw: jest.Mock;
  };
  let stockLedgerService: { postEntry: jest.Mock };
  let materialYieldRecipesService: { findOneRowOrThrow: jest.Mock };
  let materialYieldRecipeIssuesService: { sumReceived: jest.Mock };
  let notifications: { emit: jest.Mock };

  const recipe = {
    id: 9n,
    processSteps: ['CAT', 'UON'],
    outputMaterial: { id: 139n, code: 'CHAN-NHOM-01', name: 'Chân nhôm', warehouseId: 50n },
  };

  const bundleRow = {
    id: 77n,
    productionInvoiceId: 5n,
    recipeId: 9n,
    step: 'UON',
    qty: 10,
    status: PieceStepBundleStatus.AWAITING_QC,
    submittedAt: new Date('2026-10-01T00:00:00Z'),
    submittedById: 'u1',
    productionInvoice: { code: 'PI-001' },
    recipe,
  };

  beforeEach(() => {
    tx = {
      materialYieldStepBatch: { create: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
      materialYieldStepBundle: { create: jest.fn() },
      warehouse: { findUniqueOrThrow: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      $queryRaw: jest.fn().mockResolvedValue([{ floorStage: 'ACTIVE' }]),
    };
    prisma = {
      materialYieldStepBatch: { findUnique: jest.fn() },
      materialYieldStepBundle: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn() },
      productionOrder: { findFirst: jest.fn().mockResolvedValue({ id: 1n }) },
      auditLog: { create: jest.fn().mockResolvedValue(undefined) },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    };
    stockLedgerService = { postEntry: jest.fn().mockResolvedValue(undefined) };
    materialYieldRecipesService = { findOneRowOrThrow: jest.fn().mockResolvedValue(recipe) };
    materialYieldRecipeIssuesService = { sumReceived: jest.fn().mockResolvedValue(20) };
    notifications = { emit: jest.fn().mockResolvedValue(undefined) };

    service = new MaterialYieldRecipeProductionService(
      prisma as unknown as PrismaServiceType,
      stockLedgerService as unknown as StockLedgerService,
      materialYieldRecipesService as unknown as MaterialYieldRecipesService,
      materialYieldRecipeIssuesService as unknown as MaterialYieldRecipeIssuesService,
      notifications as unknown as NotificationsService,
      {
        isActive: jest.fn().mockReturnValue(false),
        get: jest.fn(),
        getId: jest.fn(),
      } as unknown as ClsService<AppClsStore>,
    );
  });

  describe('recordStepBatch', () => {
    const dto = { recipeId: '9', step: 'CAT' as const, qty: 5 };

    it('tạo batch khi recipe đã nhận nguyên liệu và step hợp lệ', async () => {
      tx.materialYieldStepBatch.create.mockResolvedValue({
        id: 1n,
        productionInvoiceId: 5n,
        recipeId: 9n,
        step: 'CAT',
        qty: 5,
        reportedAt: new Date(),
        reportedById: 'u1',
      });

      const result = await service.recordStepBatch('5', dto, 'u1', 'PHOI');

      expect(result.qty).toBe(5);
      expect(tx.materialYieldStepBatch.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
          data: expect.objectContaining({
            productionInvoiceId: 5n,
            recipeId: 9n,
            step: 'CAT',
            qty: 5,
          }),
        }),
      );
    });

    it('từ chối khi chưa nhận nguyên liệu (sumReceived <= 0)', async () => {
      materialYieldRecipeIssuesService.sumReceived.mockResolvedValue(0);
      await expect(service.recordStepBatch('5', dto, 'u1', 'PHOI')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('từ chối khi step không thuộc processSteps của recipe', async () => {
      await expect(
        service.recordStepBatch('5', { recipeId: '9', step: 'DAP' as const, qty: 5 }, 'u1', 'PHOI'),
      ).rejects.toThrow(BadRequestException);
    });

    it('từ chối khi mfgRole không phải PHOI', async () => {
      await expect(service.recordStepBatch('5', dto, 'u1', 'KCS')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('idempotencyKey trả lại batch cũ, không tạo mới', async () => {
      prisma.materialYieldStepBatch.findUnique.mockResolvedValue({
        id: 1n,
        productionInvoiceId: 5n,
        recipeId: 9n,
        step: 'CAT',
        qty: 5,
        reportedAt: new Date(),
        reportedById: 'u1',
      });
      const result = await service.recordStepBatch('5', dto, 'u1', 'PHOI', 'idem-1');
      expect(result.id).toBe('1');
      expect(tx.materialYieldStepBatch.create).not.toHaveBeenCalled();
    });
  });

  describe('submitStep', () => {
    it('gộp các batch chưa gửi thành 1 bundle', async () => {
      tx.materialYieldStepBatch.findMany.mockResolvedValue([
        { id: 1n, qty: 3 },
        { id: 2n, qty: 4 },
      ]);
      tx.materialYieldStepBundle.create.mockResolvedValue(bundleRow);

      const result = await service.submitStep('5', { recipeId: '9', step: 'UON' }, 'u1', 'PHOI');

      expect(tx.materialYieldStepBundle.create).toHaveBeenCalledWith(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
        expect.objectContaining({ data: expect.objectContaining({ qty: 7 }) }),
      );
      expect(tx.materialYieldStepBatch.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1n, 2n] } },
        data: { materialYieldStepBundleId: 77n },
      });
      expect(result.outputMaterialCode).toBe('CHAN-NHOM-01');
    });

    it('báo KCS (MATERIAL_YIELD_STEP_BUNDLE_TO_KCS) sau khi tạo bundle - nhánh chân nhôm từng im lặng (N-1)', async () => {
      tx.materialYieldStepBatch.findMany.mockResolvedValue([{ id: 1n, qty: 3 }]);
      tx.materialYieldStepBundle.create.mockResolvedValue(bundleRow);

      await service.submitStep('5', { recipeId: '9', step: 'UON' }, 'u1', 'PHOI');

      expect(notifications.emit).toHaveBeenCalledWith('MATERIAL_YIELD_STEP_BUNDLE_TO_KCS', {
        entityId: '77',
        params: { piCode: 'PI-001' },
      });
    });

    it('ghi audit khi Phôi gửi bundle sang KCS (P2 mục 31)', async () => {
      tx.materialYieldStepBatch.findMany.mockResolvedValue([{ id: 1n, qty: 3 }]);
      tx.materialYieldStepBundle.create.mockResolvedValue(bundleRow);

      await service.submitStep('5', { recipeId: '9', step: 'UON' }, 'u1', 'PHOI');

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tableName: 'MaterialYieldStepBundle',
          recordId: '77',
        }) as unknown,
      });
    });

    it('lỗi phát thông báo KHÔNG làm hỏng việc gửi KCS đã commit', async () => {
      tx.materialYieldStepBatch.findMany.mockResolvedValue([{ id: 1n, qty: 3 }]);
      tx.materialYieldStepBundle.create.mockResolvedValue(bundleRow);
      notifications.emit.mockRejectedValue(new Error('boom'));

      await expect(
        service.submitStep('5', { recipeId: '9', step: 'UON' }, 'u1', 'PHOI'),
      ).resolves.toBeDefined();
    });

    it('từ chối khi không có batch nào chưa gửi', async () => {
      tx.materialYieldStepBatch.findMany.mockResolvedValue([]);
      await expect(
        service.submitStep('5', { recipeId: '9', step: 'UON' }, 'u1', 'PHOI'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findBundlesForInvoice', () => {
    it('trả về danh sách bundle đã map, sắp theo submittedAt desc', async () => {
      prisma.materialYieldStepBundle.findMany.mockResolvedValue([bundleRow]);
      const result = await service.findBundlesForInvoice('5');
      expect(prisma.materialYieldStepBundle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { productionInvoiceId: 5n },
          orderBy: { submittedAt: 'desc' },
        }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('77');
      expect(result[0].piCode).toBe('PI-001');
    });
  });

  describe('findAllBundles', () => {
    it('lọc theo status khi có truyền, phân trang đúng', async () => {
      prisma.materialYieldStepBundle.findMany.mockResolvedValue([bundleRow]);
      prisma.materialYieldStepBundle.count.mockResolvedValue(1);

      const result = await service.findAllBundles({
        status: PieceStepBundleStatus.AWAITING_QC,
        page: 1,
        limit: 20,
        skip: 0,
      } as never);

      expect(prisma.materialYieldStepBundle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: PieceStepBundleStatus.AWAITING_QC } }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('không lọc status khi không truyền', async () => {
      prisma.materialYieldStepBundle.findMany.mockResolvedValue([]);
      prisma.materialYieldStepBundle.count.mockResolvedValue(0);

      await service.findAllBundles({ page: 1, limit: 20, skip: 0 } as never);

      expect(prisma.materialYieldStepBundle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });
  });

  describe('finalizeRecipeOutputIfLastStepComplete', () => {
    it('credit StockLedger khi step vừa duyệt là công đoạn CUỐI và có qty đạt', async () => {
      tx.warehouse.findUniqueOrThrow.mockResolvedValue({ id: 1n, code: 'PRODUCTION' });
      await service.finalizeRecipeOutputIfLastStepComplete(
        tx as unknown as PrismaTx,
        bundleRow as never,
        2,
        'kcs1',
      );

      expect(tx.warehouse.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { code: 'PRODUCTION' },
      });
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          toWarehouseId: 50n,
          materialId: 139n,
          qty: 8, // qty(10) - failedQty(2)
          refType: StockLedgerRefType.MATERIAL_YIELD_RECIPE_OUTPUT,
          refId: '77',
        }),
        tx,
      );
    });

    it('không làm gì nếu step vừa duyệt KHÔNG phải công đoạn cuối', async () => {
      await service.finalizeRecipeOutputIfLastStepComplete(
        tx as unknown as PrismaTx,
        { ...bundleRow, step: 'CAT' } as never,
        0,
        'kcs1',
      );
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    it('không làm gì nếu toàn bộ qty đều fail (passedQty = 0)', async () => {
      await service.finalizeRecipeOutputIfLastStepComplete(
        tx as unknown as PrismaTx,
        bundleRow as never,
        10,
        'kcs1',
      );
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    it('báo lỗi rõ ràng nếu outputMaterial chưa được gán kho', async () => {
      const noWarehouseBundle = {
        ...bundleRow,
        recipe: { ...recipe, outputMaterial: { ...recipe.outputMaterial, warehouseId: null } },
      };
      await expect(
        service.finalizeRecipeOutputIfLastStepComplete(
          tx as unknown as PrismaTx,
          noWarehouseBundle as never,
          0,
          'kcs1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
