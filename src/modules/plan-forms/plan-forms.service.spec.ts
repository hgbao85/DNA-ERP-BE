import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { BomRevisionsService } from '../bom-revisions/bom-revisions.service';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { PlanFormsService } from './plan-forms.service';

describe('PlanFormsService', () => {
  let service: PlanFormsService;
  let bomRevisionsService: { create: jest.Mock; activate: jest.Mock };
  let prisma: {
    salesOrder: { findUnique: jest.Mock };
    mfgProduct: { findUnique: jest.Mock };
    salesOrderItem: { findFirst: jest.Mock };
    planForm: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    planFormManhReview: { upsert: jest.Mock; deleteMany: jest.Mock };
    planFormDetailReview: { upsert: jest.Mock; deleteMany: jest.Mock };
    productionInvoice: { create: jest.Mock; update: jest.Mock };
    productionInvoiceItem: { create: jest.Mock };
    bomRevision: { findFirst: jest.Mock; findMany: jest.Mock };
    piece: { findFirst: jest.Mock; findUnique: jest.Mock; create: jest.Mock };
    segmentSpec: { upsert: jest.Mock };
    material: { findUnique: jest.Mock; update: jest.Mock };
    materialGroup: { findUnique: jest.Mock; create: jest.Mock };
    bomPiece: { deleteMany: jest.Mock; create: jest.Mock; findMany: jest.Mock };
    pieceBom: { deleteMany: jest.Mock; create: jest.Mock; findMany: jest.Mock };
    consumableBom: { deleteMany: jest.Mock; create: jest.Mock; findMany: jest.Mock };
    bomAccessoryItem: { deleteMany: jest.Mock; create: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  const mfgProduct = { id: 2n, factoryCode: 'SKU-01', name: 'Ghe A' };
  const planForm = (overrides: Record<string, unknown> = {}) => ({
    id: 5n,
    salesOrderId: 1n,
    mfgProductId: 2n,
    productionInvoiceId: null,
    status: 'WAITING_PARTS',
    note: null,
    origin: null,
    qlsxReviewedAt: null,
    createdById: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    mfgProduct,
    salesOrder: { customer: { name: 'Khach A' } },
    productionInvoice: null,
    manhReviews: [],
    detailReviews: [],
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      salesOrder: { findUnique: jest.fn() },
      mfgProduct: { findUnique: jest.fn() },
      salesOrderItem: { findFirst: jest.fn() },
      planForm: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      planFormManhReview: { upsert: jest.fn(), deleteMany: jest.fn() },
      planFormDetailReview: { upsert: jest.fn(), deleteMany: jest.fn() },
      productionInvoice: { create: jest.fn(), update: jest.fn() },
      productionInvoiceItem: { create: jest.fn() },
      // Mặc định "chưa có BomRevision nào" (reconstructQuotaBatch trả manhData/detailQuota
      // null nhanh, không chạm tới các bảng dòng con) - test nào cần dữ liệu thật sẽ override.
      bomRevision: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      piece: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
      segmentSpec: { upsert: jest.fn() },
      material: { findUnique: jest.fn(), update: jest.fn() },
      materialGroup: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
      bomPiece: {
        deleteMany: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      pieceBom: {
        deleteMany: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      consumableBom: {
        deleteMany: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      bomAccessoryItem: {
        deleteMany: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(prisma))),
    };
    bomRevisionsService = { create: jest.fn(), activate: jest.fn() };
    service = new PlanFormsService(
      prisma as unknown as PrismaServiceType,
      bomRevisionsService as unknown as BomRevisionsService,
    );
  });

  describe('create', () => {
    it('resolves an existing PI for the (salesOrder, product) pair instead of creating a new one', async () => {
      prisma.salesOrder.findUnique.mockResolvedValue({ id: 1n });
      prisma.mfgProduct.findUnique.mockResolvedValue(mfgProduct);
      prisma.planForm.findFirst.mockResolvedValue({ productionInvoiceId: 99n });
      prisma.planForm.create.mockResolvedValue(planForm({ productionInvoiceId: 99n }));

      const result = await service.create({ salesOrderId: '1', mfgProductId: '2' }, 'user-1');

      expect(result.productionInvoiceId).toBe('99');
      expect(prisma.productionInvoice.create).not.toHaveBeenCalled();
    });

    it('throws 404 when the sales order does not exist', async () => {
      prisma.salesOrder.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ salesOrderId: '999', mfgProductId: '2' }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateManhQuota (group=SAT)', () => {
    it('resolves-or-creates Piece + SegmentSpec and writes BomPiece/PieceBom on a lazily-created DRAFT revision', async () => {
      prisma.planForm.findUnique.mockResolvedValue(planForm({ status: 'WAITING_PARTS' }));
      prisma.bomRevision.findFirst.mockResolvedValue(null); // chưa có revision nào
      bomRevisionsService.create.mockResolvedValue({ id: '10' });
      prisma.piece.findFirst.mockResolvedValue(null); // Piece chưa tồn tại -> tạo mới
      prisma.piece.findUnique.mockResolvedValue(null); // code chưa trùng
      prisma.piece.create.mockResolvedValue({ id: 20n });
      prisma.material.findUnique.mockResolvedValue({ id: 30n, code: 'SAT-25', kind: 'STEEL_BAR' });
      prisma.segmentSpec.upsert.mockResolvedValue({ id: 40n });
      prisma.planForm.update.mockResolvedValue(planForm({ status: 'APPROVED_PARTS' }));

      const result = await service.updateManhQuota('5', 'SAT', {
        pieces: [
          {
            name: 'Manh tua',
            qtyPerUnit: 2,
            segments: [{ materialId: '30', cutLengthMm: 930, qtyPerPiece: 4 }],
          },
        ],
        enteredBy: 'NV Sat',
      });

      expect(result.status).toBe('APPROVED_PARTS');
      expect(bomRevisionsService.create).toHaveBeenCalledWith('2', '5');
      expect(prisma.pieceBom.deleteMany).toHaveBeenCalledWith({ where: { bomRevisionId: 10n } });
      expect(prisma.bomPiece.deleteMany).toHaveBeenCalledWith({ where: { bomRevisionId: 10n } });
      expect(prisma.bomPiece.create).toHaveBeenCalledWith({
        data: { bomRevisionId: 10n, pieceId: 20n, qtyPerUnit: 2 },
      });
      expect(prisma.pieceBom.create).toHaveBeenCalledWith({
        data: {
          bomRevisionId: 10n,
          mfgProductId: 2n,
          pieceId: 20n,
          segmentSpecId: 40n,
          qtyPerPiece: 4,
          needsHan: true,
          needsSon: true,
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest.Mock.calls typing
      const upsertCall = prisma.planFormManhReview.upsert.mock.calls[0][0] as { update: unknown };
      expect(upsertCall.update).toEqual(
        expect.objectContaining({ status: null, reason: null, reviewedAt: null }),
      );
    });

    it('rejects a segment whose material is not kind=STEEL_BAR', async () => {
      prisma.planForm.findUnique.mockResolvedValue(planForm({ status: 'WAITING_PARTS' }));
      prisma.bomRevision.findFirst.mockResolvedValue({ id: 10n, status: 'DRAFT' });
      prisma.piece.findFirst.mockResolvedValue({ id: 20n });
      prisma.material.findUnique.mockResolvedValue({ id: 30n, code: 'SON-01', kind: 'PAINT' });

      await expect(
        service.updateManhQuota('5', 'SAT', {
          pieces: [
            {
              name: 'Manh tua',
              qtyPerUnit: 2,
              segments: [{ materialId: '30', cutLengthMm: 930, qtyPerPiece: 4 }],
            },
          ],
          enteredBy: 'NV Sat',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects editing quota once the owned revision is no longer DRAFT (already approved)', async () => {
      prisma.planForm.findUnique.mockResolvedValue(planForm({ status: 'WAITING_PARTS' }));
      prisma.bomRevision.findFirst.mockResolvedValue({ id: 10n, status: 'ACTIVE' });

      await expect(
        service.updateManhQuota('5', 'SAT', { pieces: [], enteredBy: 'NV Sat' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateManhQuota (group=DAY/DINH)', () => {
    it('resolves-or-creates the "Dây" MaterialGroup and writes ConsumableBom(stage=DAN)', async () => {
      prisma.planForm.findUnique.mockResolvedValue(planForm({ status: 'APPROVED_PARTS' }));
      prisma.bomRevision.findFirst.mockResolvedValue({ id: 10n, status: 'DRAFT' });
      prisma.materialGroup.findUnique.mockResolvedValue(null);
      prisma.materialGroup.create.mockResolvedValue({ id: 50n, name: 'Dây' });
      prisma.material.findUnique.mockResolvedValue({
        id: 60n,
        code: 'DAY-2LY',
        kind: 'CONSUMABLE',
        materialGroupId: null,
      });
      prisma.planForm.update.mockResolvedValue(planForm({ status: 'APPROVED_PARTS' }));

      await service.updateManhQuota('5', 'DAY', {
        items: [{ materialId: '60', qtyPerUnit: 3 }],
        enteredBy: 'NV Day',
      });

      expect(prisma.materialGroup.create).toHaveBeenCalledWith({ data: { name: 'Dây' } });
      expect(prisma.consumableBom.deleteMany).toHaveBeenCalledWith({
        where: { bomRevisionId: 10n, stage: 'DAN', material: { materialGroupId: 50n } },
      });
      expect(prisma.material.update).toHaveBeenCalledWith({
        where: { id: 60n },
        data: { materialGroupId: 50n },
      });
      expect(prisma.consumableBom.create).toHaveBeenCalledWith({
        data: { bomRevisionId: 10n, stage: 'DAN', materialId: 60n, qtyPerUnit: 3 },
      });
    });
  });

  describe('updateDetailQuota', () => {
    it('rejects a DAY_SON material that is not kind=PAINT', async () => {
      prisma.planForm.findUnique.mockResolvedValue(planForm({ status: 'WAITING_DETAIL' }));
      prisma.bomRevision.findFirst.mockResolvedValue({ id: 10n, status: 'DRAFT' });
      prisma.material.findUnique.mockResolvedValue({ id: 70n, code: 'DAY-01', kind: 'CONSUMABLE' });

      await expect(
        service.updateDetailQuota('5', 'DAY_SON', {
          items: [{ materialId: '70', qtyPerUnit: 1 }],
          enteredBy: 'NV Son',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('writes BomAccessoryItem for VAT_TU_PHU_KIEN and auto-advances WAITING_DETAIL -> APPROVED_DETAIL', async () => {
      prisma.planForm.findUnique.mockResolvedValue(planForm({ status: 'WAITING_DETAIL' }));
      prisma.bomRevision.findFirst.mockResolvedValue({ id: 10n, status: 'DRAFT' });
      prisma.material.findUnique.mockResolvedValue({ id: 80n, code: 'PK-01', kind: 'ACCESSORY' });
      prisma.planForm.update.mockResolvedValue(planForm({ status: 'APPROVED_DETAIL' }));

      const result = await service.updateDetailQuota('5', 'VAT_TU_PHU_KIEN', {
        items: [{ materialId: '80', qtyPerUnit: 5 }],
        enteredBy: 'NV PK',
      });

      expect(result.status).toBe('APPROVED_DETAIL');
      expect(prisma.bomAccessoryItem.deleteMany).toHaveBeenCalledWith({
        where: { bomRevisionId: 10n, material: { kind: 'ACCESSORY' } },
      });
      expect(prisma.bomAccessoryItem.create).toHaveBeenCalledWith({
        data: { bomRevisionId: 10n, materialId: 80n, qtyPerUnit: 5 },
      });
    });
  });

  describe('approveParts', () => {
    it('rejects when not all 3 manh groups are approved', async () => {
      prisma.planForm.findUnique.mockResolvedValue(
        planForm({ manhReviews: [{ group: 'SAT', status: 'APPROVED' }] }),
      );

      await expect(service.approveParts('5')).rejects.toThrow(ConflictException);
      expect(prisma.planForm.update).not.toHaveBeenCalled();
    });

    it('advances to WAITING_DETAIL once all 3 groups are approved', async () => {
      prisma.planForm.findUnique.mockResolvedValue(
        planForm({
          manhReviews: [
            { group: 'SAT', status: 'APPROVED' },
            { group: 'DAY', status: 'APPROVED' },
            { group: 'DINH', status: 'APPROVED' },
          ],
        }),
      );
      prisma.planForm.update.mockResolvedValue(planForm({ status: 'WAITING_DETAIL' }));

      const result = await service.approveParts('5');
      expect(result.status).toBe('WAITING_DETAIL');
    });
  });

  describe('requestBossApproval', () => {
    it('rejects when the plan form is not in WAITING_QLSX_APPROVAL', async () => {
      prisma.planForm.findUnique.mockResolvedValue(planForm({ status: 'APPROVED_DETAIL' }));

      await expect(service.requestBossApproval('5')).rejects.toThrow(ConflictException);
    });
  });

  describe('approve', () => {
    it('activates the owned DRAFT revision when the boss gives final approval', async () => {
      prisma.planForm.findUnique.mockResolvedValue(planForm({ status: 'WAITING_BOSS_APPROVAL' }));
      prisma.bomRevision.findFirst.mockResolvedValue({ id: 10n, status: 'DRAFT' });
      prisma.planForm.update.mockResolvedValue(planForm({ status: 'APPROVED' }));

      const result = await service.approve('5');

      expect(result.status).toBe('APPROVED');
      expect(bomRevisionsService.activate).toHaveBeenCalledWith('10');
    });

    it('does not call activate when the plan form never had any quota entered', async () => {
      prisma.planForm.findUnique.mockResolvedValue(planForm({ status: 'WAITING_BOSS_APPROVAL' }));
      prisma.bomRevision.findFirst.mockResolvedValue(null);
      prisma.planForm.update.mockResolvedValue(planForm({ status: 'APPROVED' }));

      await service.approve('5');

      expect(bomRevisionsService.activate).not.toHaveBeenCalled();
    });
  });

  describe('rejectByBoss', () => {
    it('rewinds to APPROVED_DETAIL and wipes review decisions but not quota data', async () => {
      prisma.planForm.findUnique.mockResolvedValue(planForm({ status: 'WAITING_BOSS_APPROVAL' }));
      prisma.planForm.update.mockResolvedValue(planForm({ status: 'APPROVED_DETAIL' }));

      const result = await service.rejectByBoss('5');

      expect(result.status).toBe('APPROVED_DETAIL');
      expect(prisma.planFormManhReview.deleteMany).toHaveBeenCalledWith({
        where: { planFormId: 5n },
      });
      expect(prisma.planFormDetailReview.deleteMany).toHaveBeenCalledWith({
        where: { planFormId: 5n },
      });
      // rewindToDetailReview không đụng BomRevision - dữ liệu định mức giữ nguyên.
      expect(bomRevisionsService.activate).not.toHaveBeenCalled();
    });
  });

  describe('findOne - quota reconstruction (§3d regression guard)', () => {
    it('returns manhData: null for a brand-new PlanForm that never had quota entered (does not borrow another revision)', async () => {
      prisma.planForm.findUnique.mockResolvedValue(planForm({ origin: null }));
      prisma.bomRevision.findMany.mockResolvedValue([]); // chưa sở hữu revision nào

      const result = await service.findOne('5');

      expect(result.manhData).toBeNull();
      expect(result.detailQuota).toBeNull();
    });

    it('falls back to the product ACTIVE revision for a PRODUCTION_CONFIRM plan form with no quota of its own', async () => {
      prisma.planForm.findUnique.mockResolvedValue(planForm({ origin: 'PRODUCTION_CONFIRM' }));
      prisma.bomRevision.findMany
        .mockResolvedValueOnce([]) // không sở hữu revision riêng (sourcePlanFormId)
        .mockResolvedValueOnce([{ id: 99n, mfgProductId: 2n, status: 'ACTIVE' }]); // ACTIVE của sản phẩm

      const result = await service.findOne('5');

      expect(result.manhData).toEqual({ sat: [], day: [], dinh: [] });
      expect(result.detailQuota).toEqual({ daySon: [], vatTuPhuKien: [], baoBiDongGoi: [] });
    });
  });
});
