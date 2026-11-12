import { PrismaServiceType } from '../../prisma/prisma.service';
import { WorkshopScopeService } from '../../common/workshop-scope/workshop-scope.service';
import { WorkQueueService } from './work-queue.service';

/** WorkshopScopeService thật, chỉ giả lập bảng users: 'qlsx-pa' = Phước An (id 2), 'qlsx-phu' = Phú An (id 1, sơn cho Phước An). */
const makeScope = () => {
  const users: Record<string, unknown> = {
    'qlsx-pa': { workshopId: 2n, workshop: { name: 'Xưởng Phước An', paintsFor: [] } },
    'qlsx-phu': { workshopId: 1n, workshop: { name: 'Xưởng Phú An', paintsFor: [{ id: 2n }] } },
  };
  return new WorkshopScopeService({
    user: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(users[where.id] ?? null),
      ),
    },
  } as never);
};

describe('WorkQueueService', () => {
  let service: WorkQueueService;
  let prisma: {
    planForm: { count: jest.Mock };
    productionInvoiceItem: { count: jest.Mock };
    planFormManhReview: { count: jest.Mock };
    planFormDetailReview: { count: jest.Mock };
    purchaseProposalItem: { count: jest.Mock };
    warehouseTransfer: { count: jest.Mock };
    steelIssue: { count: jest.Mock };
    cutBundle: { count: jest.Mock };
    stepBundle: { count: jest.Mock };
    pieceStepBundle: { count: jest.Mock };
    productionBatch: { count: jest.Mock };
    deadlineChangeBatch: { count: jest.Mock }; // Phần A – Đợt 9
  };
  let cuttingProposalsService: { countNeedsAction: jest.Mock };
  let salesOrdersService: { countReadyToShip: jest.Mock };
  let materialsDueService: { countDueNow: jest.Mock }; // Phần A – Đợt 4

  beforeEach(() => {
    prisma = {
      planForm: { count: jest.fn().mockResolvedValue(0) },
      productionInvoiceItem: { count: jest.fn().mockResolvedValue(0) },
      planFormManhReview: { count: jest.fn().mockResolvedValue(0) },
      planFormDetailReview: { count: jest.fn().mockResolvedValue(0) },
      purchaseProposalItem: { count: jest.fn().mockResolvedValue(0) },
      warehouseTransfer: { count: jest.fn().mockResolvedValue(0) },
      steelIssue: { count: jest.fn().mockResolvedValue(0) },
      cutBundle: { count: jest.fn().mockResolvedValue(0) },
      stepBundle: { count: jest.fn().mockResolvedValue(0) },
      pieceStepBundle: { count: jest.fn().mockResolvedValue(0) },
      productionBatch: { count: jest.fn().mockResolvedValue(0) },
      deadlineChangeBatch: { count: jest.fn().mockResolvedValue(0) },
    };
    cuttingProposalsService = { countNeedsAction: jest.fn().mockResolvedValue(0) };
    salesOrdersService = { countReadyToShip: jest.fn().mockResolvedValue(0) };
    materialsDueService = { countDueNow: jest.fn().mockResolvedValue(0) };
    service = new WorkQueueService(
      prisma as unknown as PrismaServiceType,
      cuttingProposalsService as never,
      salesOrdersService as never,
      materialsDueService as never,
      makeScope(),
    );
  });

  it('không có role nào - trả về counts rỗng, không query gì', async () => {
    const result = await service.getWorkQueue({ roles: [], warehouseScope: null });

    expect(result.counts).toEqual({});
    expect(prisma.planForm.count).not.toHaveBeenCalled();
    expect(cuttingProposalsService.countNeedsAction).not.toHaveBeenCalled();
    expect(salesOrdersService.countReadyToShip).not.toHaveBeenCalled();
  });

  it('QLSX (PRODUCTION_MANAGER) - cộng PI WAITING_QLSX với cutting-proposal cần xử lý tay', async () => {
    prisma.productionInvoiceItem.count.mockResolvedValue(3);
    cuttingProposalsService.countNeedsAction.mockResolvedValue(2);

    const result = await service.getWorkQueue({
      roles: ['PRODUCTION_MANAGER'],
      warehouseScope: null,
    });

    expect(result.counts.qlsxProductionQueue).toBe(5);
    expect(prisma.productionInvoiceItem.count).toHaveBeenCalledWith({
      where: { prodApprovalStatus: 'WAITING_QLSX' },
    });
  });

  it('Sếp (BOSS) - trả riêng SKU chờ duyệt và PI WAITING_BOSS', async () => {
    prisma.planForm.count.mockResolvedValue(4);
    prisma.productionInvoiceItem.count.mockResolvedValue(7);

    const result = await service.getWorkQueue({ roles: ['BOSS'], warehouseScope: null });

    expect(result.counts.bossSkuApproval).toBe(4);
    expect(result.counts.bossProductionApproval).toBe(7);
    expect(prisma.planForm.count).toHaveBeenCalledWith({
      where: { status: 'WAITING_BOSS_APPROVAL' },
    });
    expect(prisma.productionInvoiceItem.count).toHaveBeenCalledWith({
      where: { prodApprovalStatus: 'WAITING_BOSS' },
    });
  });

  it('KHSX (PRODUCTION_PLANNER) - cộng định mức mảnh(SAT)+chi tiết(DAY_SON) chờ review, tách riêng PI REJECTED', async () => {
    prisma.planFormManhReview.count.mockResolvedValue(2);
    prisma.planFormDetailReview.count.mockResolvedValue(1);
    prisma.productionInvoiceItem.count.mockResolvedValue(5);

    const result = await service.getWorkQueue({
      roles: ['PRODUCTION_PLANNER'],
      warehouseScope: null,
    });

    expect(result.counts.khsxSkuReview).toBe(3);
    expect(result.counts.khsxProductionRejected).toBe(5);
    expect(prisma.planFormManhReview.count).toHaveBeenCalledWith({
      where: { group: 'SAT', status: null },
    });
    expect(prisma.planFormDetailReview.count).toHaveBeenCalledWith({
      where: { group: 'DAY_SON', status: null },
    });
    expect(prisma.productionInvoiceItem.count).toHaveBeenCalledWith({
      where: { prodApprovalStatus: 'REJECTED' },
    });
  });

  it('Spec Sắt (SPEC_STEEL_STAFF) - loại origin=PRODUCTION_CONFIRM, đếm chưa nộp HOẶC bị trả về', async () => {
    prisma.planForm.count.mockResolvedValue(6);

    const result = await service.getWorkQueue({
      roles: ['SPEC_STEEL_STAFF'],
      warehouseScope: null,
    });

    expect(result.counts.specSteelQuota).toBe(6);
    expect(prisma.planForm.count).toHaveBeenCalledWith({
      where: {
        origin: { not: 'PRODUCTION_CONFIRM' },
        OR: [
          { manhReviews: { none: { group: 'SAT' } } },
          { manhReviews: { some: { group: 'SAT', status: 'REJECTED' } } },
        ],
      },
    });
  });

  it('Spec chi tiết (SPEC_ACCESSORY_PACKAGING_STAFF) - cùng logic cho group DAY_SON', async () => {
    prisma.planForm.count.mockResolvedValue(1);

    const result = await service.getWorkQueue({
      roles: ['SPEC_ACCESSORY_PACKAGING_STAFF'],
      warehouseScope: null,
    });

    expect(result.counts.specDetailQuota).toBe(1);
    expect(prisma.planForm.count).toHaveBeenCalledWith({
      where: {
        origin: { not: 'PRODUCTION_CONFIRM' },
        OR: [
          { detailReviews: { none: { group: 'DAY_SON' } } },
          { detailReviews: { some: { group: 'DAY_SON', status: 'REJECTED' } } },
        ],
      },
    });
  });

  it('Mua hàng (PURCHASER) - dùng PENDING_APPROVAL_STATUSES (NEW/QUOTING/SUBMITTED/REJECTED), không phải chỉ NEW/QUOTING như plan gốc', async () => {
    prisma.purchaseProposalItem.count.mockResolvedValue(9);

    const result = await service.getWorkQueue({ roles: ['PURCHASER'], warehouseScope: null });

    expect(result.counts.purchaserPending).toBe(9);
    expect(prisma.purchaseProposalItem.count).toHaveBeenCalledWith({
      where: { status: { in: ['NEW', 'QUOTING', 'SUBMITTED', 'REJECTED'] } },
    });
  });

  describe('Kho (WAREHOUSE_STAFF)', () => {
    it('warehouseScope null (tổng kho) - đếm mọi kho, không filter theo warehouse', async () => {
      prisma.warehouseTransfer.count.mockResolvedValue(2);
      prisma.purchaseProposalItem.count.mockResolvedValue(3);

      const result = await service.getWorkQueue({
        roles: ['WAREHOUSE_STAFF'],
        warehouseScope: null,
      });

      expect(result.counts.warehouseTransferPending).toBe(2);
      expect(result.counts.warehousePurchaseReceiving).toBe(3);
      expect(prisma.warehouseTransfer.count).toHaveBeenCalledWith({ where: { status: 'PENDING' } });
      expect(prisma.purchaseProposalItem.count).toHaveBeenCalledWith({
        where: { status: 'PURCHASING' },
      });
    });

    it('warehouseScope cụ thể - lọc phiếu chuyển theo toWarehouse.code, hàng mua theo receiveWarehouseCode HOẶC fallback Material.warehouse.code', async () => {
      prisma.warehouseTransfer.count.mockResolvedValue(1);
      prisma.purchaseProposalItem.count.mockResolvedValue(1);

      await service.getWorkQueue({ roles: ['WAREHOUSE_STAFF'], warehouseScope: 'thanh-pham' });

      expect(prisma.warehouseTransfer.count).toHaveBeenCalledWith({
        where: { status: 'PENDING', toWarehouse: { code: 'thanh-pham' } },
      });
      expect(prisma.purchaseProposalItem.count).toHaveBeenCalledWith({
        where: {
          status: 'PURCHASING',
          OR: [
            { receiveWarehouseCode: 'thanh-pham' },
            { receiveWarehouseCode: null, material: { warehouse: { code: 'thanh-pham' } } },
          ],
        },
      });
    });
  });

  it('Phôi (PHOI_STAFF) - đếm steel issue ISSUED chưa nhận', async () => {
    prisma.steelIssue.count.mockResolvedValue(4);

    const result = await service.getWorkQueue({ roles: ['PHOI_STAFF'], warehouseScope: null });

    expect(result.counts.phoiSteelReceiving).toBe(4);
    expect(prisma.steelIssue.count).toHaveBeenCalledWith({ where: { status: 'ISSUED' } });
  });

  it('KCS (KCS_STAFF) - gộp CutBundle+StepBundle+PieceStepBundle+ProductionBatch(PHOI) vào kcsPhoi, tách riêng kcsHan/kcsSon theo stage', async () => {
    prisma.cutBundle.count.mockResolvedValue(1);
    prisma.stepBundle.count.mockResolvedValue(1);
    prisma.pieceStepBundle.count.mockResolvedValue(1);
    prisma.productionBatch.count.mockImplementation(({ where }: { where: { stage: string } }) => {
      if (where.stage === 'PHOI') return Promise.resolve(2);
      if (where.stage === 'HAN') return Promise.resolve(5);
      if (where.stage === 'SON') return Promise.resolve(6);
      throw new Error(`unexpected stage ${where.stage}`);
    });

    const result = await service.getWorkQueue({ roles: ['KCS_STAFF'], warehouseScope: null });

    expect(result.counts.kcsPhoi).toBe(5); // 1+1+1+2
    expect(result.counts.kcsHan).toBe(5);
    expect(result.counts.kcsSon).toBe(6);
  });

  it('Sales (SALES_STAFF) - uỷ quyền hẳn cho SalesOrdersService.countReadyToShip(), không tự lọc SalesOrderItem.status', async () => {
    salesOrdersService.countReadyToShip.mockResolvedValue(8);

    const result = await service.getWorkQueue({ roles: ['SALES_STAFF'], warehouseScope: null });

    expect(result.counts.salesReadyToShip).toBe(8);
    expect(salesOrdersService.countReadyToShip).toHaveBeenCalled();
  });

  it('user có nhiều role cùng lúc (vd account demo "sales": WAREHOUSE_STAFF + SALES_STAFF) - trả đủ mọi khoá liên quan', async () => {
    prisma.warehouseTransfer.count.mockResolvedValue(1);
    prisma.purchaseProposalItem.count.mockResolvedValue(2);
    salesOrdersService.countReadyToShip.mockResolvedValue(3);

    const result = await service.getWorkQueue({
      roles: ['WAREHOUSE_STAFF', 'SALES_STAFF'],
      warehouseScope: null,
    });

    expect(result.counts).toEqual({
      warehouseTransferPending: 1,
      warehousePurchaseReceiving: 2,
      salesReadyToShip: 3,
      materialsDueNow: 0,
    });
  });

  // ─── Phần A – Đợt 4 (YC6): badge Vật tư cần về ───
  describe('materialsDueNow', () => {
    it('người mua: tính theo vật tư mình (truyền id + role), khoá materialsDueNow', async () => {
      materialsDueService.countDueNow.mockResolvedValue(7);

      const result = await service.getWorkQueue({
        id: 'u-buyer',
        roles: ['PURCHASER'],
        warehouseScope: null,
      });

      expect(result.counts.materialsDueNow).toBe(7);
      expect(materialsDueService.countDueNow).toHaveBeenCalledWith({
        id: 'u-buyer',
        roles: ['PURCHASER'],
        warehouseScope: null,
      });
    });

    it('thủ kho: tính theo kho mình (truyền warehouseScope)', async () => {
      materialsDueService.countDueNow.mockResolvedValue(3);

      const result = await service.getWorkQueue({
        id: 'u-wh',
        roles: ['WAREHOUSE_STAFF'],
        warehouseScope: 'son',
      });

      expect(result.counts.materialsDueNow).toBe(3);
      expect(materialsDueService.countDueNow).toHaveBeenCalledWith(
        expect.objectContaining({ warehouseScope: 'son' }),
      );
    });

    it('KHSX / QLSX / Sếp: không có khoá materialsDueNow, không tính', async () => {
      const result = await service.getWorkQueue({
        id: 'u',
        roles: ['PRODUCTION_PLANNER', 'PRODUCTION_MANAGER', 'BOSS'],
        warehouseScope: null,
      });

      expect(result.counts).not.toHaveProperty('materialsDueNow');
      expect(materialsDueService.countDueNow).not.toHaveBeenCalled();
    });
  });

  // Phần A – Đợt 9 (YC2)
  describe('bossDeadlineChange', () => {
    it('Sếp: = số lô đổi mốc PENDING', async () => {
      prisma.deadlineChangeBatch.count.mockResolvedValue(3);
      const result = await service.getWorkQueue({ roles: ['BOSS'], warehouseScope: null });
      expect(result.counts.bossDeadlineChange).toBe(3);
      expect(prisma.deadlineChangeBatch.count).toHaveBeenCalledWith({
        where: { status: 'PENDING' },
      });
    });

    it('KHSX / QLSX: không có khoá bossDeadlineChange', async () => {
      const result = await service.getWorkQueue({
        roles: ['PRODUCTION_PLANNER', 'PRODUCTION_MANAGER'],
        warehouseScope: null,
      });
      expect(result.counts).not.toHaveProperty('bossDeadlineChange');
      expect(prisma.deadlineChangeBatch.count).not.toHaveBeenCalled();
    });
  });

  describe('QLSX theo xưởng (2026-11-12)', () => {
    it('QLSX gắn xưởng: chỉ đếm lệnh chờ của xưởng mình + SKU chưa có xưởng', async () => {
      prisma.productionInvoiceItem.count.mockResolvedValue(2);
      cuttingProposalsService.countNeedsAction.mockResolvedValue(1);

      const result = await service.getWorkQueue({
        id: 'qlsx-pa',
        roles: ['PRODUCTION_MANAGER'],
        warehouseScope: null,
      });

      expect(result.counts.qlsxProductionQueue).toBe(3);
      expect(prisma.productionInvoiceItem.count).toHaveBeenCalledWith({
        where: {
          prodApprovalStatus: 'WAITING_QLSX',
          OR: [{ workshopId: null }, { workshopId: 2n }],
        },
      });
    });

    it('QLSX Phú An: không đếm lệnh Phước An (chỉ xem) - lọc theo xưởng của chính mình', async () => {
      await service.getWorkQueue({
        id: 'qlsx-phu',
        roles: ['PRODUCTION_MANAGER'],
        warehouseScope: null,
      });

      expect(prisma.productionInvoiceItem.count).toHaveBeenCalledWith({
        where: {
          prodApprovalStatus: 'WAITING_QLSX',
          OR: [{ workshopId: null }, { workshopId: 1n }],
        },
      });
    });

    it('QLSX chưa gắn xưởng: đếm như cũ, không lọc', async () => {
      await service.getWorkQueue({
        id: 'qlsx-chua-gan',
        roles: ['PRODUCTION_MANAGER'],
        warehouseScope: null,
      });

      expect(prisma.productionInvoiceItem.count).toHaveBeenCalledWith({
        where: { prodApprovalStatus: 'WAITING_QLSX' },
      });
    });

    it('Sếp / KHSX không bị lọc theo xưởng (số đỏ của Sếp vẫn đếm mọi lệnh)', async () => {
      await service.getWorkQueue({ id: 'qlsx-pa', roles: ['BOSS'], warehouseScope: null });

      expect(prisma.productionInvoiceItem.count).toHaveBeenCalledWith({
        where: { prodApprovalStatus: 'WAITING_BOSS' },
      });
    });
  });
});
