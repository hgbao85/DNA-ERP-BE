import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { BomRevisionsService } from '../bom-revisions/bom-revisions.service';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { SkusService } from './skus.service';

/** Id giả lập cho các nhóm vật tư hệ thống (seed sẵn ở prisma/seed.ts) - dùng xuyên suốt các
 *  test dưới đây thay cho MaterialKind đã xoá. Sơn/Phụ kiện/Bao bì đều dùng chung OTHER. */
const SYSTEM_GROUP_IDS = {
  STEEL_BAR: 901n,
  WIRE: 902n,
  NAIL: 903n,
  OTHER: 904n,
  PLASTIC_BUTTON: 905n,
  RIVET: 906n,
} as const;

describe('SkusService', () => {
  let service: SkusService;
  let bomRevisionsService: { create: jest.Mock; activateInTransaction: jest.Mock };
  let prisma: {
    salesOrder: { findUnique: jest.Mock };
    mfgProduct: { findUnique: jest.Mock };
    salesOrderItem: { findFirst: jest.Mock; findUnique: jest.Mock };
    planForm: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      count: jest.Mock;
    };
    planFormManhReview: { upsert: jest.Mock; deleteMany: jest.Mock };
    planFormDetailReview: { upsert: jest.Mock; deleteMany: jest.Mock };
    productionInvoice: { create: jest.Mock; update: jest.Mock; findMany: jest.Mock };
    productionInvoiceItem: { create: jest.Mock };
    bomRevision: { findFirst: jest.Mock; findMany: jest.Mock };
    piece: { findMany: jest.Mock; create: jest.Mock; update: jest.Mock };
    segmentSpec: { upsert: jest.Mock };
    material: { findMany: jest.Mock; update: jest.Mock };
    materialGroup: { findUnique: jest.Mock; findMany: jest.Mock };
    bomPiece: { deleteMany: jest.Mock; createMany: jest.Mock; findMany: jest.Mock };
    pieceBom: { deleteMany: jest.Mock; createMany: jest.Mock; findMany: jest.Mock };
    pieceMaterialItem: { deleteMany: jest.Mock; createMany: jest.Mock; findMany: jest.Mock };
    pieceMaterialYield: { deleteMany: jest.Mock; createMany: jest.Mock; findMany: jest.Mock };
    consumableBom: { deleteMany: jest.Mock; createMany: jest.Mock; findMany: jest.Mock };
    bomAccessoryItem: { deleteMany: jest.Mock; createMany: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  const mfgProduct = { id: 2n, factoryCode: 'SKU-01', name: 'Ghe A' };
  const planForm = (overrides: Record<string, unknown> = {}) => ({
    id: 5n,
    salesOrderId: 1n,
    mfgProductId: 2n,
    productionInvoiceId: null,
    status: 'IN_PROGRESS',
    note: null,
    origin: null,
    bossApproveIdempotencyKey: null,
    bossRejectReason: null,
    manhForwardedAt: null,
    detailForwardedAt: null,
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
      salesOrderItem: { findFirst: jest.fn(), findUnique: jest.fn() },
      planForm: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn(),
        count: jest.fn(),
      },
      planFormManhReview: { upsert: jest.fn(), deleteMany: jest.fn() },
      planFormDetailReview: { upsert: jest.fn(), deleteMany: jest.fn() },
      productionInvoice: {
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      productionInvoiceItem: { create: jest.fn() },
      // Mặc định "chưa có BomRevision nào" (reconstructQuotaBatch trả manhData/detailQuota
      // null nhanh, không chạm tới các bảng dòng con) - test nào cần dữ liệu thật sẽ override.
      bomRevision: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      piece: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
      },
      segmentSpec: { upsert: jest.fn() },
      material: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      // Mặc định: mọi lookup theo systemKey trả đúng nhóm hệ thống giả lập (mirror seed.ts
      // thật) - test nào muốn giả lập "seed chưa chạy" tự override findUnique -> null.
      materialGroup: {
        findUnique: jest.fn((args: { where: { systemKey?: string } }) => {
          const key = args.where.systemKey as keyof typeof SYSTEM_GROUP_IDS | undefined;
          const id = key ? SYSTEM_GROUP_IDS[key] : undefined;
          return Promise.resolve(id != null ? { id, name: key, systemKey: key } : null);
        }),
        findMany: jest.fn().mockResolvedValue(
          Object.entries(SYSTEM_GROUP_IDS).map(([systemKey, id]) => ({
            id,
            name: systemKey,
            systemKey,
          })),
        ),
      },
      bomPiece: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      pieceBom: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      pieceMaterialItem: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      pieceMaterialYield: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      consumableBom: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      bomAccessoryItem: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(prisma))),
    };
    bomRevisionsService = { create: jest.fn(), activateInTransaction: jest.fn() };
    service = new SkusService(
      prisma as unknown as PrismaServiceType,
      bomRevisionsService as unknown as BomRevisionsService,
    );
  });

  describe('create', () => {
    it('resolves an existing PI for the (salesOrder, product) pair instead of creating a new one', async () => {
      prisma.salesOrder.findUnique.mockResolvedValue({ id: 1n, customer: { name: 'Khach A' } });
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

    // Audit 2026-08-20 (Medium "resolveProductionInvoice lấy dòng đầu tiên") - xác nhận với
    // nghiệp vụ: 1 Sales Order CÓ THỂ có 2 dòng cùng mfgProductId (vd giao 2 đợt khác ngày), nên
    // tự dò findFirst không đủ tin cậy khi ghim quantity/deliveryDeadline vào PI mới. Caller biết
    // chắc dòng nào (vd FE truyền salesOrderItemId tường minh) phải ghim ĐÚNG dòng đó, không phải
    // dòng đầu tiên tìm thấy.
    it('dùng đúng salesOrderItemId tường minh để ghim PI mới, không tự dò findFirst khi có sẵn', async () => {
      prisma.salesOrder.findUnique.mockResolvedValue({ id: 1n, customer: { name: 'Khach A' } });
      prisma.mfgProduct.findUnique.mockResolvedValue(mfgProduct);
      prisma.planForm.findFirst.mockResolvedValue(null); // chưa có PI nào cho cặp này
      prisma.salesOrderItem.findUnique.mockResolvedValue({
        id: 77n,
        salesOrderId: 1n,
        mfgProductId: 2n,
        totalQty: 60,
        deliveryDate: new Date('2026-09-01'),
      });
      prisma.productionInvoice.create.mockResolvedValue({ id: 500n });
      prisma.planForm.create.mockResolvedValue(planForm({ productionInvoiceId: 500n }));

      await service.create(
        { salesOrderId: '1', mfgProductId: '2', salesOrderItemId: '77' },
        'user-1',
      );

      expect(prisma.salesOrderItem.findFirst).not.toHaveBeenCalled();
      expect(prisma.salesOrderItem.findUnique).toHaveBeenCalledWith({ where: { id: 77n } });
      expect(prisma.productionInvoiceItem.create).toHaveBeenCalledWith({
        data: {
          productionInvoiceId: 500n,
          mfgProductId: 2n,
          quantity: 60,
          deliveryDeadline: new Date('2026-09-01'),
        },
      });
    });

    it('từ chối salesOrderItemId không thuộc đúng đơn hàng/sản phẩm đang tạo SKU', async () => {
      prisma.salesOrder.findUnique.mockResolvedValue({ id: 1n, customer: { name: 'Khach A' } });
      prisma.mfgProduct.findUnique.mockResolvedValue(mfgProduct);
      prisma.planForm.findFirst.mockResolvedValue(null);
      // Dòng này thuộc salesOrderId=2 (khác đơn đang tạo SKU, id=1) - phải bị từ chối.
      prisma.salesOrderItem.findUnique.mockResolvedValue({
        id: 77n,
        salesOrderId: 2n,
        mfgProductId: 2n,
        totalQty: 60,
        deliveryDate: null,
      });

      await expect(
        service.create({ salesOrderId: '1', mfgProductId: '2', salesOrderItemId: '77' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.productionInvoice.create).not.toHaveBeenCalled();
    });
  });

  describe('updateManhQuota (segments Sắt)', () => {
    it('resolves-or-creates Piece + SegmentSpec and writes BomPiece/PieceBom on a lazily-created DRAFT revision', async () => {
      prisma.planForm.findUnique.mockResolvedValue(planForm({ status: 'IN_PROGRESS' }));
      prisma.bomRevision.findFirst.mockResolvedValue(null); // chưa có revision nào
      bomRevisionsService.create.mockResolvedValue({ id: '10' });
      prisma.piece.findMany.mockResolvedValue([]); // Piece chưa tồn tại -> tạo mới
      prisma.piece.create.mockResolvedValue({ id: 20n });
      prisma.material.findMany.mockResolvedValue([
        { id: 30n, code: 'SAT-25', materialGroupId: null },
      ]);
      prisma.segmentSpec.upsert.mockResolvedValue({ id: 40n });
      // Không còn auto-advance status khi nhập liệu (2 nhánh giờ độc lập) - status giữ IN_PROGRESS.
      prisma.planForm.update.mockResolvedValue(planForm({ status: 'IN_PROGRESS' }));

      const result = await service.updateManhQuota('5', {
        pieces: [
          {
            name: 'Manh tua',
            qtyPerUnit: 2,
            segments: [{ materialId: '30', cutLengthMm: 930, qtyPerPiece: 4 }],
          },
        ],
        enteredBy: 'NV Sat',
      });

      expect(result.status).toBe('IN_PROGRESS');
      expect(bomRevisionsService.create).toHaveBeenCalledWith('2', '5');
      // Vật tư chưa thuộc nhóm nào (materialGroupId: null) -> tự gán vào nhóm Sắt hệ thống.
      expect(prisma.material.update).toHaveBeenCalledWith({
        where: { id: 30n },
        data: { materialGroupId: SYSTEM_GROUP_IDS.STEEL_BAR },
      });
      expect(prisma.pieceBom.deleteMany).toHaveBeenCalledWith({ where: { bomRevisionId: 10n } });
      expect(prisma.bomPiece.deleteMany).toHaveBeenCalledWith({ where: { bomRevisionId: 10n } });
      expect(prisma.bomPiece.createMany).toHaveBeenCalledWith({
        data: [
          {
            bomRevisionId: 10n,
            pieceId: 20n,
            qtyPerUnit: 2,
            isWoven: false,
            needsHan: true,
            needsSon: true,
          },
        ],
      });
      expect(prisma.pieceBom.createMany).toHaveBeenCalledWith({
        data: [
          {
            bomRevisionId: 10n,
            mfgProductId: 2n,
            pieceId: 20n,
            segmentSpecId: 40n,
            qtyPerPiece: 4,
            processSteps: [],
            note: null,
          },
        ],
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest.Mock.calls typing
      const upsertCall = prisma.planFormManhReview.upsert.mock.calls[0][0] as { update: unknown };
      expect(upsertCall.update).toEqual(
        expect.objectContaining({ status: null, reason: null, reviewedAt: null }),
      );
    });

    it('clears manhForwardedAt (and reverts WAITING_BOSS_APPROVAL back to IN_PROGRESS) when the manh track is re-submitted after already having been forwarded', async () => {
      prisma.planForm.findUnique.mockResolvedValue(
        planForm({
          status: 'WAITING_BOSS_APPROVAL',
          manhForwardedAt: new Date(),
          detailForwardedAt: new Date(),
        }),
      );
      prisma.bomRevision.findFirst.mockResolvedValue({ id: 10n, status: 'DRAFT' });
      prisma.piece.findMany.mockResolvedValue([]);
      prisma.piece.create.mockResolvedValue({ id: 20n });
      prisma.material.findMany.mockResolvedValue([
        { id: 30n, code: 'SAT-25', materialGroupId: SYSTEM_GROUP_IDS.STEEL_BAR },
      ]);
      prisma.segmentSpec.upsert.mockResolvedValue({ id: 40n });
      prisma.planForm.update.mockResolvedValue(planForm({ status: 'IN_PROGRESS' }));

      await service.updateManhQuota('5', {
        pieces: [
          {
            name: 'Manh tua',
            qtyPerUnit: 2,
            segments: [{ materialId: '30', cutLengthMm: 930, qtyPerPiece: 4 }],
          },
        ],
        enteredBy: 'NV Sat',
      });

      expect(prisma.planForm.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { manhForwardedAt: null, status: 'IN_PROGRESS' },
        }),
      );
    });

    it('rejects a segment whose material belongs to a different group', async () => {
      prisma.planForm.findUnique.mockResolvedValue(planForm({ status: 'IN_PROGRESS' }));
      prisma.bomRevision.findFirst.mockResolvedValue({ id: 10n, status: 'DRAFT' });
      prisma.piece.findMany.mockResolvedValue([{ id: 20n, name: 'Manh tua', code: 'MANH-TUA' }]);
      prisma.material.findMany.mockResolvedValue([
        { id: 30n, code: 'SON-01', materialGroupId: SYSTEM_GROUP_IDS.OTHER },
      ]);

      await expect(
        service.updateManhQuota('5', {
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
      prisma.planForm.findUnique.mockResolvedValue(planForm({ status: 'IN_PROGRESS' }));
      prisma.bomRevision.findFirst.mockResolvedValue({ id: 10n, status: 'ACTIVE' });

      await expect(
        service.updateManhQuota('5', { pieces: [], enteredBy: 'NV Sat' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateManhQuota (materialLines Dây/Đinh/Tán rút/Nút nhựa trong mảnh)', () => {
    it('resolves the "Dây" system MaterialGroup and writes PieceMaterialItem for a WIRE line', async () => {
      prisma.planForm.findUnique.mockResolvedValue(planForm({ status: 'IN_PROGRESS' }));
      prisma.bomRevision.findFirst.mockResolvedValue({ id: 10n, status: 'DRAFT' });
      prisma.piece.findMany.mockResolvedValue([{ id: 20n, name: 'Manh tua', code: 'MANH-TUA' }]);
      prisma.material.findMany.mockResolvedValue([
        { id: 60n, code: 'DAY-2LY', materialGroupId: null },
      ]);
      prisma.planForm.update.mockResolvedValue(planForm({ status: 'IN_PROGRESS' }));

      await service.updateManhQuota('5', {
        pieces: [
          {
            name: 'Manh tua',
            qtyPerUnit: 2,
            segments: [],
            materialLines: [{ group: 'WIRE', materialId: '60', qtyPerPiece: 3 }],
          },
        ],
        enteredBy: 'NV Day',
      });

      expect(prisma.material.update).toHaveBeenCalledWith({
        where: { id: 60n },
        data: { materialGroupId: SYSTEM_GROUP_IDS.WIRE },
      });
      expect(prisma.pieceMaterialItem.createMany).toHaveBeenCalledWith({
        data: [
          {
            bomRevisionId: 10n,
            mfgProductId: 2n,
            pieceId: 20n,
            materialId: 60n,
            qtyPerPiece: 3,
            note: null,
          },
        ],
      });
    });

    it('sets Piece.isWoven = true once a piece has all 3 of Dây + Đinh + Nút nhựa', async () => {
      prisma.planForm.findUnique.mockResolvedValue(planForm({ status: 'IN_PROGRESS' }));
      prisma.bomRevision.findFirst.mockResolvedValue({ id: 10n, status: 'DRAFT' });
      prisma.piece.findMany.mockResolvedValue([
        { id: 20n, name: 'Manh tua', code: 'MANH-TUA', isWoven: false },
      ]);
      prisma.material.findMany.mockResolvedValue([
        { id: 60n, code: 'DAY-2LY', materialGroupId: SYSTEM_GROUP_IDS.WIRE },
        { id: 61n, code: 'DINH-01', materialGroupId: SYSTEM_GROUP_IDS.NAIL },
        { id: 62n, code: 'NN-01', materialGroupId: SYSTEM_GROUP_IDS.PLASTIC_BUTTON },
      ]);
      prisma.planForm.update.mockResolvedValue(planForm({ status: 'IN_PROGRESS' }));

      await service.updateManhQuota('5', {
        pieces: [
          {
            name: 'Manh tua',
            qtyPerUnit: 2,
            segments: [],
            materialLines: [
              { group: 'WIRE', materialId: '60', qtyPerPiece: 3 },
              { group: 'NAIL', materialId: '61', qtyPerPiece: 4 },
              { group: 'PLASTIC_BUTTON', materialId: '62', qtyPerPiece: 1 },
            ],
          },
        ],
        enteredBy: 'NV Day',
      });

      expect(prisma.piece.update).toHaveBeenCalledWith({
        where: { id: 20n },
        data: { isWoven: true },
      });
    });

    it('resets Piece.isWoven = false once a previously-woven piece loses one of the 3 groups', async () => {
      prisma.planForm.findUnique.mockResolvedValue(planForm({ status: 'IN_PROGRESS' }));
      prisma.bomRevision.findFirst.mockResolvedValue({ id: 10n, status: 'DRAFT' });
      prisma.piece.findMany.mockResolvedValue([
        { id: 20n, name: 'Manh tua', code: 'MANH-TUA', isWoven: true },
      ]);
      prisma.material.findMany.mockResolvedValue([
        { id: 60n, code: 'DAY-2LY', materialGroupId: SYSTEM_GROUP_IDS.WIRE },
      ]);
      prisma.planForm.update.mockResolvedValue(planForm({ status: 'IN_PROGRESS' }));

      await service.updateManhQuota('5', {
        pieces: [
          {
            name: 'Manh tua',
            qtyPerUnit: 2,
            segments: [],
            materialLines: [{ group: 'WIRE', materialId: '60', qtyPerPiece: 3 }],
          },
        ],
        enteredBy: 'NV Day',
      });

      expect(prisma.piece.update).toHaveBeenCalledWith({
        where: { id: 20n },
        data: { isWoven: false },
      });
    });

    it('does not touch Piece.isWoven when the desired value already matches', async () => {
      prisma.planForm.findUnique.mockResolvedValue(planForm({ status: 'IN_PROGRESS' }));
      prisma.bomRevision.findFirst.mockResolvedValue({ id: 10n, status: 'DRAFT' });
      prisma.piece.findMany.mockResolvedValue([
        { id: 20n, name: 'Manh tua', code: 'MANH-TUA', isWoven: false },
      ]);
      prisma.material.findMany.mockResolvedValue([
        { id: 60n, code: 'DAY-2LY', materialGroupId: SYSTEM_GROUP_IDS.WIRE },
      ]);
      prisma.planForm.update.mockResolvedValue(planForm({ status: 'IN_PROGRESS' }));

      await service.updateManhQuota('5', {
        pieces: [
          {
            name: 'Manh tua',
            qtyPerUnit: 2,
            segments: [],
            materialLines: [{ group: 'WIRE', materialId: '60', qtyPerPiece: 3 }],
          },
        ],
        enteredBy: 'NV Day',
      });

      expect(prisma.piece.update).not.toHaveBeenCalled();
    });
  });

  describe('updateManhQuota (materialYields - vật tư thành phẩm, vd chân nhôm)', () => {
    it('viết PieceMaterialYield cho piece needsHan=false, không ràng buộc nhóm vật tư của material', async () => {
      prisma.planForm.findUnique.mockResolvedValue(planForm({ status: 'IN_PROGRESS' }));
      prisma.bomRevision.findFirst.mockResolvedValue({ id: 10n, status: 'DRAFT' });
      prisma.piece.findMany.mockResolvedValue([{ id: 20n, name: 'Chan nhom', code: 'CHAN-NHOM' }]);
      prisma.material.findMany.mockResolvedValue([
        { id: 80n, code: 'NHOM-01', materialGroupId: null },
      ]);
      prisma.planForm.update.mockResolvedValue(planForm({ status: 'IN_PROGRESS' }));

      await service.updateManhQuota('5', {
        pieces: [
          {
            name: 'Chan nhom',
            qtyPerUnit: 4,
            needsHan: false,
            needsSon: false,
            segments: [],
            materialYields: [{ materialId: '80', piecesPerBar: 12 }],
          },
        ],
        enteredBy: 'NV Sat',
      });

      // Khác materialLines (WIRE/NAIL/...) - KHÔNG gọi material.update gán nhóm, vì nhóm "Vật tư
      // thành phẩm" do admin tự tạo (systemKey=null) "vô hình với logic Spec" (xem schema.prisma).
      expect(prisma.material.update).not.toHaveBeenCalled();
      expect(prisma.pieceMaterialYield.createMany).toHaveBeenCalledWith({
        data: [
          { bomRevisionId: 10n, mfgProductId: 2n, pieceId: 20n, materialId: 80n, piecesPerBar: 12 },
        ],
      });
    });

    // 2026-08-22: needsHan=true KHÔNG còn bị chặn - "pat" (cắt từ tấm sắt lá theo tỷ lệ cố định,
    // vẫn cần Hàn sau khi cắt) là vd thật. needsHan chỉ còn quyết định piece có báo thêm ở HAN
    // hay không, không còn quyết định piece có dùng materialYields được hay không.
    it('cho phép materialYields gắn cho piece needsHan=true ("pat", cắt từ tấm sắt lá nhưng vẫn cần Hàn)', async () => {
      prisma.planForm.findUnique.mockResolvedValue(planForm({ status: 'IN_PROGRESS' }));
      prisma.bomRevision.findFirst.mockResolvedValue({ id: 10n, status: 'DRAFT' });
      prisma.piece.findMany.mockResolvedValue([{ id: 21n, name: 'Pat', code: 'PAT-01' }]);
      prisma.material.findMany.mockResolvedValue([
        { id: 81n, code: 'TAM-SAT-LA-01', materialGroupId: null },
      ]);
      prisma.planForm.update.mockResolvedValue(planForm({ status: 'IN_PROGRESS' }));

      await service.updateManhQuota('5', {
        pieces: [
          {
            name: 'Pat',
            qtyPerUnit: 2,
            needsHan: true,
            segments: [],
            materialYields: [{ materialId: '81', piecesPerBar: 6 }],
          },
        ],
        enteredBy: 'NV Sat',
      });

      expect(prisma.pieceMaterialYield.createMany).toHaveBeenCalledWith({
        data: [
          { bomRevisionId: 10n, mfgProductId: 2n, pieceId: 21n, materialId: 81n, piecesPerBar: 6 },
        ],
      });
    });
  });

  describe('updateDetailQuota', () => {
    it('rejects a DAY_SON material that belongs to a different group', async () => {
      prisma.planForm.findUnique.mockResolvedValue(planForm({ status: 'IN_PROGRESS' }));
      prisma.bomRevision.findFirst.mockResolvedValue({ id: 10n, status: 'DRAFT' });
      prisma.material.findMany.mockResolvedValue([
        { id: 70n, code: 'DAY-01', materialGroupId: SYSTEM_GROUP_IDS.WIRE },
      ]);

      await expect(
        service.updateDetailQuota('5', {
          detailLines: [{ group: 'DAY_SON', materialId: '70', qtyPerUnit: 1 }],
          enteredBy: 'NV Son',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('writes BomAccessoryItem for VAT_TU_PHU_KIEN without touching status (nhập liệu không còn auto-advance)', async () => {
      prisma.planForm.findUnique.mockResolvedValue(planForm({ status: 'IN_PROGRESS' }));
      prisma.bomRevision.findFirst.mockResolvedValue({ id: 10n, status: 'DRAFT' });
      prisma.material.findMany.mockResolvedValue([
        {
          id: 80n,
          code: 'PK-01',
          materialGroupId: SYSTEM_GROUP_IDS.OTHER,
          detailKind: 'ACCESSORY',
        },
      ]);
      prisma.planForm.update.mockResolvedValue(planForm({ status: 'IN_PROGRESS' }));

      const result = await service.updateDetailQuota('5', {
        detailLines: [{ group: 'VAT_TU_PHU_KIEN', materialId: '80', qtyPerUnit: 5 }],
        enteredBy: 'NV PK',
      });

      expect(result.status).toBe('IN_PROGRESS');
      expect(prisma.bomAccessoryItem.deleteMany).toHaveBeenCalledWith({
        where: { bomRevisionId: 10n, kind: 'ACCESSORY' },
      });
      expect(prisma.bomAccessoryItem.createMany).toHaveBeenCalledWith({
        data: [{ bomRevisionId: 10n, materialId: 80n, kind: 'ACCESSORY', qtyPerUnit: 5 }],
      });
    });

    it('clears detailForwardedAt (and reverts WAITING_BOSS_APPROVAL back to IN_PROGRESS) when the detail track is re-submitted after already having been forwarded', async () => {
      prisma.planForm.findUnique.mockResolvedValue(
        planForm({
          status: 'WAITING_BOSS_APPROVAL',
          manhForwardedAt: new Date(),
          detailForwardedAt: new Date(),
        }),
      );
      prisma.bomRevision.findFirst.mockResolvedValue({ id: 10n, status: 'DRAFT' });
      prisma.material.findMany.mockResolvedValue([
        {
          id: 80n,
          code: 'PK-01',
          materialGroupId: SYSTEM_GROUP_IDS.OTHER,
          detailKind: 'ACCESSORY',
        },
      ]);
      prisma.planForm.update.mockResolvedValue(planForm({ status: 'IN_PROGRESS' }));

      await service.updateDetailQuota('5', {
        detailLines: [{ group: 'VAT_TU_PHU_KIEN', materialId: '80', qtyPerUnit: 5 }],
        enteredBy: 'NV PK',
      });

      expect(prisma.planForm.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { detailForwardedAt: null, status: 'IN_PROGRESS' },
        }),
      );
    });

    it('rejects a material submitted as Bao bì whose detailKind is actually Phụ kiện (also covers "same material in both lists" - detailKind can only match one)', async () => {
      prisma.planForm.findUnique.mockResolvedValue(planForm({ status: 'IN_PROGRESS' }));
      prisma.bomRevision.findFirst.mockResolvedValue({ id: 10n, status: 'DRAFT' });
      prisma.material.findMany.mockResolvedValue([
        {
          id: 80n,
          code: 'PK-01',
          materialGroupId: SYSTEM_GROUP_IDS.OTHER,
          detailKind: 'ACCESSORY',
        },
      ]);

      await expect(
        service.updateDetailQuota('5', {
          detailLines: [{ group: 'BAO_BI_DONG_GOI', materialId: '80', qtyPerUnit: 2 }],
          enteredBy: 'NV PK',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.bomAccessoryItem.createMany).not.toHaveBeenCalled();
    });
  });

  describe('missing system material group (seed chưa chạy)', () => {
    it('throws 500 với thông báo rõ ràng thay vì âm thầm tạo nhóm mới (khác resolveMaterialGroupId cũ)', async () => {
      prisma.planForm.findUnique.mockResolvedValue(planForm({ status: 'IN_PROGRESS' }));
      prisma.bomRevision.findFirst.mockResolvedValue({ id: 10n, status: 'DRAFT' });
      prisma.materialGroup.findUnique.mockResolvedValue(null);

      await expect(
        service.updateManhQuota('5', { pieces: [], enteredBy: 'NV Day' }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('reconstructQuotaBatch - Phụ kiện vs Bao bì (read-back regression guard)', () => {
    it('tách đúng dòng kind ACCESSORY vào vatTuPhuKien và kind PACKAGING vào baoBiDongGoi', async () => {
      prisma.planForm.findUnique.mockResolvedValue(planForm({ origin: null }));
      prisma.bomRevision.findMany.mockResolvedValueOnce([
        { id: 10n, mfgProductId: 2n, sourcePlanFormId: 5n, status: 'DRAFT' },
      ]);
      prisma.bomAccessoryItem.findMany.mockResolvedValue([
        {
          id: 1n,
          bomRevisionId: 10n,
          materialId: 80n,
          kind: 'ACCESSORY',
          qtyPerUnit: { toNumber: () => 5 },
          material: {
            code: 'PK-01',
            name: 'Phu kien A',
            unit: 'cai',
            materialGroupId: SYSTEM_GROUP_IDS.OTHER,
          },
        },
        {
          id: 2n,
          bomRevisionId: 10n,
          materialId: 81n,
          kind: 'PACKAGING',
          qtyPerUnit: { toNumber: () => 2 },
          material: {
            code: 'BB-01',
            name: 'Bao bi A',
            unit: 'cai',
            materialGroupId: SYSTEM_GROUP_IDS.OTHER,
          },
        },
      ]);

      const result = await service.findOne('5');

      expect(result.detailQuota).toMatchObject({
        vatTuPhuKien: [expect.objectContaining({ materialCode: 'PK-01' })],
        baoBiDongGoi: [expect.objectContaining({ materialCode: 'BB-01' })],
      });
    });
  });

  describe('approveParts', () => {
    it('rejects when the (single) manh group SAT is not approved yet', async () => {
      prisma.planForm.findUnique.mockResolvedValue(planForm({ manhReviews: [] }));

      await expect(service.approveParts('5')).rejects.toThrow(ConflictException);
      expect(prisma.planForm.update).not.toHaveBeenCalled();
    });

    it('sets manhForwardedAt but keeps IN_PROGRESS when detail has not been forwarded yet (2 nhánh độc lập)', async () => {
      prisma.planForm.findUnique.mockResolvedValue(
        planForm({ manhReviews: [{ group: 'SAT', status: 'APPROVED' }] }),
      );
      prisma.planForm.update.mockResolvedValue(
        planForm({ status: 'IN_PROGRESS', manhForwardedAt: new Date() }),
      );

      const result = await service.approveParts('5');

      expect(result.status).toBe('IN_PROGRESS');
      expect(result.manhForwardedAt).not.toBeNull();
      expect(prisma.planForm.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { manhForwardedAt: expect.any(Date) as Date } }),
      );
    });

    it('advances straight to WAITING_BOSS_APPROVAL when the detail track had already been forwarded earlier (thứ tự ngược: chi tiết trước, mảnh sau)', async () => {
      prisma.planForm.findUnique.mockResolvedValue(
        planForm({
          manhReviews: [{ group: 'SAT', status: 'APPROVED' }],
          detailForwardedAt: new Date(),
        }),
      );
      prisma.planForm.update.mockResolvedValue(planForm({ status: 'WAITING_BOSS_APPROVAL' }));

      const result = await service.approveParts('5');

      expect(result.status).toBe('WAITING_BOSS_APPROVAL');
      expect(prisma.planForm.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { manhForwardedAt: expect.any(Date) as Date, status: 'WAITING_BOSS_APPROVAL' },
        }),
      );
    });
  });

  describe('approveDetail', () => {
    it('rejects when the (single) detail group DAY_SON is not approved yet - regardless of manh state', async () => {
      prisma.planForm.findUnique.mockResolvedValue(
        planForm({ manhReviews: [], detailReviews: [] }),
      );

      await expect(service.approveDetail('5')).rejects.toThrow(ConflictException);
      expect(prisma.planForm.update).not.toHaveBeenCalled();
    });

    it('forwards the detail track even when manh has not been touched at all (order-independent - đây là hành vi chính cần thêm)', async () => {
      prisma.planForm.findUnique.mockResolvedValue(
        planForm({ manhReviews: [], detailReviews: [{ group: 'DAY_SON', status: 'APPROVED' }] }),
      );
      prisma.planForm.update.mockResolvedValue(
        planForm({ status: 'IN_PROGRESS', detailForwardedAt: new Date() }),
      );

      const result = await service.approveDetail('5');

      expect(result.status).toBe('IN_PROGRESS');
      expect(result.detailForwardedAt).not.toBeNull();
      expect(prisma.planForm.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { detailForwardedAt: expect.any(Date) as Date } }),
      );
    });

    it('advances straight to WAITING_BOSS_APPROVAL once BOTH tracks have been forwarded (bước QLSX đã bỏ) - thuận thứ tự: mảnh trước, chi tiết sau', async () => {
      prisma.planForm.findUnique.mockResolvedValue(
        planForm({
          manhForwardedAt: new Date(),
          detailReviews: [{ group: 'DAY_SON', status: 'APPROVED' }],
        }),
      );
      prisma.planForm.update.mockResolvedValue(planForm({ status: 'WAITING_BOSS_APPROVAL' }));

      const result = await service.approveDetail('5');

      expect(result.status).toBe('WAITING_BOSS_APPROVAL');
      expect(prisma.planForm.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { detailForwardedAt: expect.any(Date) as Date, status: 'WAITING_BOSS_APPROVAL' },
        }),
      );
    });
  });

  describe('approve', () => {
    it('activates the owned DRAFT revision when the boss gives final approval, in 1 transaction', async () => {
      prisma.planForm.findUnique.mockResolvedValue(planForm({ status: 'WAITING_BOSS_APPROVAL' }));
      prisma.bomRevision.findFirst.mockResolvedValue({ id: 10n, status: 'DRAFT' });
      prisma.planForm.updateMany.mockResolvedValue({ count: 1 });
      prisma.planForm.findUniqueOrThrow.mockResolvedValue(planForm({ status: 'APPROVED' }));

      const result = await service.approve('5', 'key-1');

      expect(result.status).toBe('APPROVED');
      expect(bomRevisionsService.activateInTransaction).toHaveBeenCalledWith(prisma, '10');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.planForm.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
          data: expect.objectContaining({ bossApproveIdempotencyKey: 'key-1' }),
        }),
      );
    });

    it('does not call activateInTransaction when the plan form never had any quota entered', async () => {
      prisma.planForm.findUnique.mockResolvedValue(planForm({ status: 'WAITING_BOSS_APPROVAL' }));
      prisma.bomRevision.findFirst.mockResolvedValue(null);
      prisma.planForm.updateMany.mockResolvedValue({ count: 1 });
      prisma.planForm.findUniqueOrThrow.mockResolvedValue(planForm({ status: 'APPROVED' }));

      await service.approve('5', 'key-1');

      expect(bomRevisionsService.activateInTransaction).not.toHaveBeenCalled();
    });

    it('rolls back the whole approve (never touches PlanForm.status) when activating the BOM revision fails midway', async () => {
      prisma.planForm.findUnique.mockResolvedValue(planForm({ status: 'WAITING_BOSS_APPROVAL' }));
      prisma.bomRevision.findFirst.mockResolvedValue({ id: 10n, status: 'DRAFT' });
      // Ví dụ lỗi giữa chừng: 1 request khác vừa activate xong đúng lúc này, draft không còn
      // ở trạng thái DRAFT nữa - activateInTransaction() (chạy trong cùng transaction) throw.
      bomRevisionsService.activateInTransaction.mockRejectedValue(
        new ConflictException('bom_revision không còn DRAFT'),
      );

      await expect(service.approve('5', 'key-1')).rejects.toThrow(ConflictException);

      // All-or-nothing: transaction throw trước khi chạm tới planForm.updateMany, nên PlanForm
      // không bị kẹt nửa chừng (BomRevision lỗi nhưng PlanForm lỡ đã APPROVED) như bug cũ.
      expect(prisma.planForm.updateMany).not.toHaveBeenCalled();
    });

    it('rejects when another request already moved the plan form out of WAITING_BOSS_APPROVAL mid-transaction', async () => {
      prisma.planForm.findUnique.mockResolvedValue(planForm({ status: 'WAITING_BOSS_APPROVAL' }));
      prisma.bomRevision.findFirst.mockResolvedValue(null);
      // updateMany's WHERE guard (id + status=WAITING_BOSS_APPROVAL) không khớp dòng nào nữa.
      prisma.planForm.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.approve('5', 'key-1')).rejects.toThrow(ConflictException);
      expect(prisma.planForm.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it('replays the cached result on retry with the same key instead of erroring, without re-running the transaction', async () => {
      prisma.planForm.findUnique.mockResolvedValue(
        planForm({ status: 'APPROVED', bossApproveIdempotencyKey: 'key-1' }),
      );

      const result = await service.approve('5', 'key-1');

      expect(result.status).toBe('APPROVED');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a genuinely stale retry (different key, already approved) instead of silently no-op-ing', async () => {
      prisma.planForm.findUnique.mockResolvedValue(
        planForm({ status: 'APPROVED', bossApproveIdempotencyKey: 'key-1' }),
      );

      await expect(service.approve('5', 'key-2')).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('rejectByBoss', () => {
    it('rewinds to IN_PROGRESS, clears both forwarded flags, and wipes review decisions but not quota data', async () => {
      prisma.planForm.findUnique.mockResolvedValue(
        planForm({
          status: 'WAITING_BOSS_APPROVAL',
          manhForwardedAt: new Date(),
          detailForwardedAt: new Date(),
        }),
      );
      prisma.planForm.update.mockResolvedValue(planForm({ status: 'IN_PROGRESS' }));

      const result = await service.rejectByBoss('5');

      expect(result.status).toBe('IN_PROGRESS');
      expect(prisma.planForm.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            status: 'IN_PROGRESS',
            manhForwardedAt: null,
            detailForwardedAt: null,
            bossRejectReason: null,
          },
        }),
      );
      expect(prisma.planFormManhReview.deleteMany).toHaveBeenCalledWith({
        where: { planFormId: 5n },
      });
      expect(prisma.planFormDetailReview.deleteMany).toHaveBeenCalledWith({
        where: { planFormId: 5n },
      });
      // rewindToDetailReview không đụng BomRevision - dữ liệu định mức giữ nguyên.
      expect(bomRevisionsService.activateInTransaction).not.toHaveBeenCalled();
    });

    it('stores the boss rejection reason on the plan form when provided', async () => {
      prisma.planForm.findUnique.mockResolvedValue(
        planForm({
          status: 'WAITING_BOSS_APPROVAL',
          manhForwardedAt: new Date(),
          detailForwardedAt: new Date(),
        }),
      );
      prisma.planForm.update.mockResolvedValue(
        planForm({ status: 'IN_PROGRESS', bossRejectReason: 'Sai quy cách sơn' }),
      );

      const result = await service.rejectByBoss('5', 'Sai quy cách sơn');

      expect(result.bossRejectReason).toBe('Sai quy cách sơn');
      expect(prisma.planForm.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ bossRejectReason: 'Sai quy cách sơn' }) as unknown,
        }),
      );
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

      expect(result.manhData).toEqual({ pieces: [] });
      expect(result.detailQuota).toEqual({ daySon: [], vatTuPhuKien: [], baoBiDongGoi: [] });
    });
  });
});
