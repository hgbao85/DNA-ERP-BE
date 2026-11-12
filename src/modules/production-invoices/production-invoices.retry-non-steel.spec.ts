import { ConflictException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';
import { CuttingProposalsService } from '../cutting-proposals/cutting-proposals.service';
import { ProductionOrdersService } from '../production-orders/production-orders.service';
import { CloudinaryService } from '../uploads/cloudinary.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ConsumableMaterialPurchaseService } from './consumable-material-purchase.service';
import { MaterialYieldRecipePurchaseService } from './material-yield-recipe-purchase.service';
import { PieceMaterialYieldPurchaseService } from './piece-material-yield-purchase.service';
import { ProductionInvoicesService } from './production-invoices.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { ItemDeadlineWriter } from './item-deadline-writer.service';
import { DeadlineChangesService } from './deadline-changes/deadline-changes.service';

/** Thử lại tạo dòng mua ngoài sắt cho SKU đã có lệnh sản xuất (task 2026-11-10). */
describe('ProductionInvoicesService.retryProductionOrder - mua ngoài sắt', () => {
  let service: ProductionInvoicesService;
  let prisma: {
    productionInvoice: { findUnique: jest.Mock };
    productionInvoiceItem: { findUnique: jest.Mock };
    productionOrder: { findUnique: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let productionOrdersService: {
    createFromApproval: jest.Mock;
    assertActiveBomRevisionExists: jest.Mock;
    assertChoiceMatchesRevision: jest.Mock;
    fetchActiveBomRevisionIds: jest.Mock;
  };
  let cuttingProposalsService: {
    findPreSolvedForInvoice: jest.Mock;
    assertReadyForApproval: jest.Mock;
    approve: jest.Mock;
    requestForOrder: jest.Mock;
  };
  let pieceSvc: { computeAndUpsertProposals: jest.Mock };
  let consumableSvc: { computeAndUpsertProposals: jest.Mock };
  let recipeSvc: { computeAndUpsertProposals: jest.Mock };
  let notificationsService: { emit: jest.Mock; resolve: jest.Mock };

  const mfgProduct = { id: 2n, factoryCode: 'SKU-01', name: 'Ghe A' };
  const pi = (status = 'PLANNING') => ({
    id: 7n,
    code: 'PI-7',
    salesOrderId: 1n,
    salesOrder: { orderCode: 'PO-1' },
    status,
    deadline: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [],
  });
  const item = () => ({
    id: 20n,
    productionInvoiceId: 7n,
    mfgProductId: 2n,
    mfgProduct,
    productVariantId: null,
    productVariant: null,
    quantity: 10,
    materialDeadline: null,
    finishedMaterialDeadline: null,
    deliveryDeadline: null,
    prodApprovalStatus: 'APPROVED',
    requestedAt: null,
    requestedById: null,
    warehouseCode: null,
    warehouseName: null,
    qlsxAt: null,
    qlsxById: null,
    decidedAt: null,
    decidedById: null,
    rejectReason: null,
    lsxCode: 'MY-313',
    workshopId: null,
    workshop: null,
    stages: [],
  });

  const setup = (opts: { piStatus?: string; preSolved: { id: bigint; status: string } | null }) => {
    prisma.productionInvoice.findUnique.mockResolvedValue(pi(opts.piStatus));
    prisma.productionInvoiceItem.findUnique.mockResolvedValue(item());
    prisma.productionOrder.findUnique.mockResolvedValue({ id: 5n, poNumber: 'PO-5' });
    cuttingProposalsService.findPreSolvedForInvoice.mockResolvedValue(opts.preSolved);
  };

  const steps: Array<[string, () => jest.Mock, RegExp]> = [
    ['pat/vật tư thành phẩm', () => pieceSvc.computeAndUpsertProposals, /pat/],
    ['vật tư tiêu hao', () => consumableSvc.computeAndUpsertProposals, /tiêu hao/],
    ['nguyên liệu chân nhôm', () => recipeSvc.computeAndUpsertProposals, /chân nhôm/],
  ];

  const expectAllStepsCalled = () => {
    expect(pieceSvc.computeAndUpsertProposals).toHaveBeenCalledWith('7');
    expect(consumableSvc.computeAndUpsertProposals).toHaveBeenCalledWith('7');
    expect(recipeSvc.computeAndUpsertProposals).toHaveBeenCalledWith('7');
  };

  const expectNoStepsCalled = () => {
    expect(pieceSvc.computeAndUpsertProposals).not.toHaveBeenCalled();
    expect(consumableSvc.computeAndUpsertProposals).not.toHaveBeenCalled();
    expect(recipeSvc.computeAndUpsertProposals).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    prisma = {
      productionInvoice: { findUnique: jest.fn() },
      productionInvoiceItem: { findUnique: jest.fn() },
      productionOrder: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({ id: 9n }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(prisma))),
    };
    productionOrdersService = {
      createFromApproval: jest.fn().mockResolvedValue({ id: 99n }),
      assertActiveBomRevisionExists: jest.fn().mockResolvedValue(undefined),
      assertChoiceMatchesRevision: jest.fn().mockResolvedValue(undefined),
      fetchActiveBomRevisionIds: jest.fn().mockResolvedValue(new Map()),
    };
    cuttingProposalsService = {
      findPreSolvedForInvoice: jest.fn().mockResolvedValue(null),
      assertReadyForApproval: jest
        .fn()
        .mockResolvedValue({ revisionByItemId: new Map<bigint, bigint>() }),
      approve: jest.fn().mockResolvedValue({ id: '1000' }),
      requestForOrder: jest.fn().mockResolvedValue({ id: '1' }),
    };
    pieceSvc = { computeAndUpsertProposals: jest.fn().mockResolvedValue([]) };
    consumableSvc = { computeAndUpsertProposals: jest.fn().mockResolvedValue([]) };
    recipeSvc = { computeAndUpsertProposals: jest.fn().mockResolvedValue([]) };
    notificationsService = {
      emit: jest.fn().mockResolvedValue(undefined),
      resolve: jest.fn().mockResolvedValue(undefined),
    };
    const cls = { isActive: jest.fn().mockReturnValue(false), get: jest.fn(), getId: jest.fn() };
    const realtimeStub = { publishEntityChanged: jest.fn(), publishNotificationCreated: jest.fn() };
    service = new ProductionInvoicesService(
      prisma as unknown as PrismaServiceType,
      productionOrdersService as unknown as ProductionOrdersService,
      cuttingProposalsService as unknown as CuttingProposalsService,
      pieceSvc as unknown as PieceMaterialYieldPurchaseService,
      consumableSvc as unknown as ConsumableMaterialPurchaseService,
      recipeSvc as unknown as MaterialYieldRecipePurchaseService,
      cls as unknown as ClsService<AppClsStore>,
      { deleteByUrl: jest.fn() } as unknown as CloudinaryService,
      notificationsService as unknown as NotificationsService,
      realtimeStub as unknown as RealtimeService,
      new ItemDeadlineWriter(
        prisma as unknown as PrismaServiceType,
        cls as unknown as ClsService<AppClsStore>,
        notificationsService as unknown as NotificationsService,
      ),
      {
        previewEntries: jest.fn(),
        saveEntries: jest.fn(),
        pendingByItem: jest.fn().mockResolvedValue(new Map()),
      } as unknown as DeadlineChangesService,
      { afterWorkshopChanged: jest.fn() } as never,
      {
        getScope: jest
          .fn()
          .mockResolvedValue({ workshopId: null, workshopName: null, visibleWorkshopIds: null }),
      } as never,
    );
  });

  describe.each([
    ['AC1 (phương án APPROVED)', { id: 1000n, status: 'APPROVED' }],
    ['AC2 (không có phương án, đường cũ)', null],
  ])('%s', (_label, preSolved) => {
    it('tính lại 3 nguồn mua, đóng thông báo, trả DTO, không duyệt lại/tạo lệnh', async () => {
      setup({ preSolved });

      const result = await service.retryProductionOrder('7', '20', 'admin-1');

      expectAllStepsCalled();
      expect(notificationsService.resolve).toHaveBeenCalledWith({
        entityType: 'PRODUCTION_INVOICE_ITEM',
        entityId: '20',
        types: ['PI_PRODUCTION_ORDER_FAILED'],
      });
      expect(result).toBeDefined();
      expect(result.id).toBe('20');
      expect(cuttingProposalsService.approve).not.toHaveBeenCalled();
      expect(productionOrdersService.createFromApproval).not.toHaveBeenCalled();
    });

    it.each(steps)(
      'một bước lỗi (%s): 2 bước kia vẫn chạy, ném 409 tiếng Việt nêu tên bước, không đóng thông báo',
      async (_name, getMock, nameRe) => {
        setup({ preSolved });
        getMock().mockRejectedValue(new Error('boom-secret-raw'));

        const err = await service
          .retryProductionOrder('7', '20', 'admin-1')
          .catch((e: unknown) => e);

        expect(err).toBeInstanceOf(ConflictException);
        const msg = String((err as ConflictException).message);
        expect(msg).toMatch(nameRe);
        expect(msg).not.toContain('boom-secret-raw');
        expectAllStepsCalled();
        expect(notificationsService.resolve).not.toHaveBeenCalled();
      },
    );
  });

  describe('AC4 (phương án còn DRAFT)', () => {
    it.each(steps)(
      'một bước lỗi (%s): vẫn duyệt phương án, ném 409 nêu tên bước, không đóng thông báo',
      async (_name, getMock, nameRe) => {
        setup({ preSolved: { id: 1000n, status: 'DRAFT' } });
        getMock().mockRejectedValue(new Error('boom-secret-raw'));

        const err = await service
          .retryProductionOrder('7', '20', 'admin-1')
          .catch((e: unknown) => e);

        expect(cuttingProposalsService.approve).toHaveBeenCalledWith('1000', 'admin-1');
        expect(err).toBeInstanceOf(ConflictException);
        const msg = String((err as ConflictException).message);
        expect(msg).toMatch(nameRe);
        expect(msg).not.toContain('boom-secret-raw');
        expect(notificationsService.resolve).not.toHaveBeenCalled();
      },
    );
  });

  describe('AC5 (PI đã huỷ)', () => {
    it.each([
      ['APPROVED', { id: 1000n, status: 'APPROVED' }],
      ['null', null],
      ['DRAFT', { id: 1000n, status: 'DRAFT' }],
    ])(
      'preSolved %s: 409, không tính mua, không duyệt, không đóng thông báo',
      async (_l, preSolved) => {
        setup({ piStatus: 'CANCELLED', preSolved });

        await expect(service.retryProductionOrder('7', '20', 'admin-1')).rejects.toThrow(
          ConflictException,
        );

        expectNoStepsCalled();
        expect(cuttingProposalsService.approve).not.toHaveBeenCalled();
        expect(notificationsService.resolve).not.toHaveBeenCalled();
      },
    );
  });
});
