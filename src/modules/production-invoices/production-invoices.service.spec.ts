import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { Prisma, ProdItemStageType } from '../../generated/prisma/client';
import { instanceToPlain } from 'class-transformer';
import { ProductionInvoiceItemResponseDto } from './dto/production-invoice-item-response.dto';
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

const ACTOR = { id: 'khsx-1', roles: ['PRODUCTION_PLANNER'] };

/** 3 cột thông số cắt KHSX đề nghị, đọc lại từ payload productionInvoice.create(). */
type SolverOverrideColumns = {
  solverMaxWastePctOverride: number | null;
  solverAllowCustomLength: boolean | null;
  solverMachine: string | null;
  solverOverrideReason: string | null;
};

describe('ProductionInvoicesService', () => {
  let service: ProductionInvoicesService;
  let prisma: {
    salesOrder: { findUnique: jest.Mock };
    productionInvoice: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      delete: jest.Mock;
      updateMany: jest.Mock;
    };
    cuttingProposal: { count: jest.Mock };
    productionInvoiceItem: {
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    // Phần A – Đợt 2
    workshop: { findUnique: jest.Mock };
    steelIssue: { count: jest.Mock };
    materialYieldIssue: { count: jest.Mock };
    stockReservation: { count: jest.Mock };
    purchaseProposalItem: { count: jest.Mock };
    productionInvoiceItemStage: { upsert: jest.Mock; findFirst: jest.Mock };
    mfgProduct: { findUnique: jest.Mock };
    productionOrder: { findUnique: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock };
    bomPiece: { findMany: jest.Mock; findUnique: jest.Mock };
    transferCheckResult: { findMany: jest.Mock; create: jest.Mock; aggregate: jest.Mock };
    transferCheckDefect: {
      findUnique: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    weavingReceipt: { groupBy: jest.Mock; aggregate: jest.Mock };
    warehouseTransferPieceItem: { groupBy: jest.Mock; aggregate: jest.Mock };
    packagingRecord: { create: jest.Mock; aggregate: jest.Mock; groupBy: jest.Mock };
    auditLog: { create: jest.Mock };
    systemConfig: { findUniqueOrThrow: jest.Mock };
    $transaction: jest.Mock;
  };
  let productionOrdersService: {
    createFromApproval: jest.Mock;
    assertActiveBomRevisionExists: jest.Mock;
    assertChoiceMatchesRevision: jest.Mock;
    fetchActiveBomRevisionIds: jest.Mock;
  };
  let cuttingProposalsService: {
    requestForOrder: jest.Mock;
    requestForInvoice: jest.Mock;
    previewBatch: jest.Mock;
    getProposalLineWaste: jest.Mock;
    assertReadyForInvoice: jest.Mock;
    attachToInvoice: jest.Mock;
    findPreSolvedForInvoice: jest.Mock;
    assertReadyForApproval: jest.Mock;
    releaseForInvoice: jest.Mock;
    approve: jest.Mock;
  };
  let pieceMaterialYieldPurchaseService: { computeAndUpsertProposals: jest.Mock };
  let consumableMaterialPurchaseService: { computeAndUpsertProposals: jest.Mock };
  let materialYieldRecipePurchaseService: { computeAndUpsertProposals: jest.Mock };
  let cls: { isActive: jest.Mock; get: jest.Mock; getId: jest.Mock };
  let cloudinaryService: { deleteByUrl: jest.Mock };
  let notificationsService: { emit: jest.Mock; resolve: jest.Mock };
  let workshopMove: { afterWorkshopChanged: jest.Mock };
  let deadlineChanges: {
    previewEntries: jest.Mock;
    saveEntries: jest.Mock;
    pendingByItem: jest.Mock;
  };

  const mfgProduct = { id: 2n, factoryCode: 'SKU-01', name: 'Ghe A' };
  const pi = (overrides: Record<string, unknown> = {}) => ({
    id: 7n,
    code: 'PI-7',
    salesOrderId: 1n,
    salesOrder: { orderCode: 'PO-1' },
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
    finishedMaterialDeadline: null,
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
    // Phần A – Đợt 2: mặc định đã có số LSX (KHSX bắt buộc nhập trước khi gửi QLSX) và chưa có xưởng
    lsxCode: 'MY-313',
    workshopId: null,
    workshop: null,
    stages: [],
    ...overrides,
  });
  const workshopPA = { id: 3n, code: 'PA', name: 'Phú An', isActive: true };
  const workshopMY = { id: 4n, code: 'MY', name: 'Mỹ Yến', isActive: true };

  beforeEach(() => {
    prisma = {
      salesOrder: { findUnique: jest.fn() },
      productionInvoice: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        // Mặc định rỗng cho nextProductionInvoiceCode() (đọc MAX mã hiện có) - hầu hết test không
        // quan tâm đúng mã sinh ra, chỉ cần không throw; test nào cần mã cụ thể tự override.
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn(),
        delete: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      // Phần A: đếm phương án cắt APPROVED khi đổi xưởng - mặc định 0 (không bật cờ).
      cuttingProposal: { count: jest.fn().mockResolvedValue(0) },
      productionInvoiceItem: {
        create: jest.fn(),
        update: jest.fn(),
        // count:1 mặc định (updateMany+count guard, Medium fix "race điều kiện chuỗi duyệt/từ
        // chối PI item") - test race-guard tự override count:0 để mô phỏng đã bị xử lý trước.
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn(),
        // Đợt 9 phần 2: đọc lại dòng trong giao dịch sau khi ghi mốc (kiểm thứ tự) - mặc định = dòng không đổi.
        findUniqueOrThrow: jest.fn().mockImplementation(() => Promise.resolve(piItem())),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      // Phần A – Đợt 2: mặc định xưởng Phú An còn dùng, chưa xuất sắt/vật tư.
      workshop: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 3n, code: 'PA', name: 'Phú An', isActive: true }),
      },
      steelIssue: { count: jest.fn().mockResolvedValue(0) },
      materialYieldIssue: { count: jest.fn().mockResolvedValue(0) },
      stockReservation: { count: jest.fn().mockResolvedValue(0) },
      purchaseProposalItem: { count: jest.fn().mockResolvedValue(0) },
      productionInvoiceItemStage: {
        upsert: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      mfgProduct: { findUnique: jest.fn() },
      // findFirst mặc định trả về 1 order ACTIVE - đa số test (transfer-check/packaging) không
      // quan tâm gate assertPiHasActiveFloor() (2026-08-31), tự override khi cần test gate.
      productionOrder: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({ id: 9n }),
        // Mặc định rỗng - describe('listTransferCheckPiecesBatch')/describe('getPackagingBatch')
        // bên dưới tự override.
        findMany: jest.fn().mockResolvedValue([]),
      },
      bomPiece: { findMany: jest.fn(), findUnique: jest.fn() },
      transferCheckResult: {
        findMany: jest.fn(),
        create: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _sum: { checkedQty: null } }),
      },
      transferCheckDefect: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      weavingReceipt: {
        groupBy: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({ _sum: { qty: 100 } }),
      },
      warehouseTransferPieceItem: {
        groupBy: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: null } }),
      },
      packagingRecord: {
        create: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _sum: { boxesPacked: null } }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      auditLog: { create: jest.fn() },
      // Luật gộp (2026-10-24) đọc trong transaction: mốc cần sắt ≤ 3 ngày, ≤ 5 SKU.
      systemConfig: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ solverMergeWindowDays: 3, solverMergeMaxSkus: 5, lsxPrefixes: [] }),
      },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(prisma))),
    };
    productionOrdersService = {
      createFromApproval: jest.fn().mockResolvedValue({ id: 99n }),
      assertActiveBomRevisionExists: jest.fn().mockResolvedValue(undefined),
      assertChoiceMatchesRevision: jest.fn().mockResolvedValue(undefined),
      // Mặc định "không có bản ACTIVE nào khớp" -> bomOutOfDate=false cho MỌI item có
      // ProductionOrder (không phá các test sẵn có không quan tâm field này) - test riêng của
      // bomOutOfDate tự override lại mock này.
      fetchActiveBomRevisionIds: jest.fn().mockResolvedValue(new Map()),
    };
    cuttingProposalsService = {
      // Mock gọi luôn onComplete (nếu có) để mô phỏng finally block thật của runSolverAndSave() -
      // các test bên dưới cần pieceMaterialYieldPurchaseService/consumableMaterialPurchaseService
      // thực sự được gọi sau requestForOrder, đúng thứ tự "Đề xuất mua hàng hiển thị sau khi Tính
      // đề xuất mua sắt xong" (2026-08-24).
      requestForOrder: jest.fn(
        async (_id: bigint, options?: { onComplete?: () => void | Promise<void> }) => {
          await options?.onComplete?.();
          return { id: '1' };
        },
      ),
      requestForInvoice: jest.fn(
        async (_id: bigint, options?: { onComplete?: () => void | Promise<void> }) => {
          await options?.onComplete?.();
          return { id: '2' };
        },
      ),
      // buildOverrideEvidence() gọi nhờ previewBatch để CHỤP số làm bằng chứng cho Sếp.
      previewBatch: jest
        .fn()
        .mockResolvedValue({ lines: [], totalBarsSaved: 0, daysCutEarly: null }),
      // Hao hụt THẬT từng loại của phương án đã tính (bằng chứng đặc cách ưu tiên số này hơn ước tính best-fill).
      getProposalLineWaste: jest.fn().mockResolvedValue([]),
      // Luồng "Solve trước → tạo PI" (2026-09-30): mặc định cổng cho qua với phương án 1000, thông số
      // cắt rỗng; PI mặc định KHÔNG có phương án tính sẵn (đường duyệt cũ) - test luồng mới tự override.
      assertReadyForInvoice: jest.fn().mockResolvedValue({ id: 1000n, solverOptions: {} }),
      attachToInvoice: jest.fn().mockResolvedValue(undefined),
      findPreSolvedForInvoice: jest.fn().mockResolvedValue(null),
      assertReadyForApproval: jest
        .fn()
        .mockResolvedValue({ revisionByItemId: new Map<bigint, bigint>() }),
      releaseForInvoice: jest.fn().mockResolvedValue(undefined),
      approve: jest.fn().mockResolvedValue({ id: '1000' }),
    };
    pieceMaterialYieldPurchaseService = {
      computeAndUpsertProposals: jest.fn().mockResolvedValue([]),
    };
    consumableMaterialPurchaseService = {
      computeAndUpsertProposals: jest.fn().mockResolvedValue([]),
    };
    materialYieldRecipePurchaseService = {
      computeAndUpsertProposals: jest.fn().mockResolvedValue([]),
    };
    workshopMove = { afterWorkshopChanged: jest.fn().mockResolvedValue(() => Promise.resolve()) };
    deadlineChanges = {
      previewEntries: jest.fn().mockResolvedValue([]),
      saveEntries: jest.fn().mockResolvedValue({ applied: [], batch: null, skipped: [] }),
      pendingByItem: jest.fn().mockResolvedValue(new Map()),
    };
    cls = { isActive: jest.fn().mockReturnValue(false), get: jest.fn(), getId: jest.fn() };
    cloudinaryService = { deleteByUrl: jest.fn().mockResolvedValue(undefined) };
    notificationsService = {
      emit: jest.fn().mockResolvedValue(undefined),
      resolve: jest.fn().mockResolvedValue(undefined),
    };
    const realtimeStub = { publishEntityChanged: jest.fn(), publishNotificationCreated: jest.fn() };
    service = new ProductionInvoicesService(
      prisma as unknown as PrismaServiceType,
      productionOrdersService as unknown as ProductionOrdersService,
      cuttingProposalsService as unknown as CuttingProposalsService,
      pieceMaterialYieldPurchaseService as unknown as PieceMaterialYieldPurchaseService,
      consumableMaterialPurchaseService as unknown as ConsumableMaterialPurchaseService,
      materialYieldRecipePurchaseService as unknown as MaterialYieldRecipePurchaseService,
      cls as unknown as ClsService<AppClsStore>,
      cloudinaryService as unknown as CloudinaryService,
      notificationsService as unknown as NotificationsService,
      realtimeStub as unknown as RealtimeService,
      // Phần A – Đợt 9 (YC2): đường ghi mốc dùng chung (thật) + lõi đổi mốc (mock - test riêng ở deadline-changes.service.spec.ts)
      new ItemDeadlineWriter(
        prisma as unknown as PrismaServiceType,
        cls as unknown as ClsService<AppClsStore>,
        notificationsService as unknown as NotificationsService,
      ),
      deadlineChanges as unknown as DeadlineChangesService,
      workshopMove as never,
    );
  });

  // Đợt 9: updateItem / updateItemsDeadlines nhận thêm actor - các test cũ (dòng chưa duyệt) chỉ cần một actor KHSX bất kỳ.
  const updateItemAs = (
    ...args: [string, string, Parameters<ProductionInvoicesService['updateItem']>[2]]
  ) => service.updateItem(args[0], args[1], args[2], ACTOR);
  const updateItemsDeadlinesAs = (
    ...args: [string, Parameters<ProductionInvoicesService['updateItemsDeadlines']>[1]]
  ) => service.updateItemsDeadlines(args[0], args[1], ACTOR);

  describe('create', () => {
    // Medium fix: create() trước đây tạo xong với code đúng định dạng "PI-2026-0xx"
    // (nextProductionInvoiceCode) rồi NGAY SAU ĐÓ update() ghi đè thành "PI-{id}" - 2 định dạng mã
    // cùng tồn tại trong hệ thống, gây khó tra cứu/đối chiếu (regression từ commit b939b780 đè lên
    // fix trước đó ở 127edda6). Giờ chỉ create() 1 lần, giữ nguyên mã tuần tự theo năm.
    it('keeps the sequential "PI-{year}-0xx" code from nextProductionInvoiceCode(), does not overwrite it with "PI-{id}"', async () => {
      prisma.productionInvoice.findMany.mockResolvedValue([{ code: 'PI-2026-005' }]);
      prisma.productionInvoice.create.mockResolvedValue(pi({ id: 8n, code: 'PI-2026-006' }));

      const result = await service.create({});

      expect(prisma.productionInvoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ code: 'PI-2026-006' }) as unknown,
        }),
      );
      expect(prisma.productionInvoice.update).not.toHaveBeenCalled();
      expect(result.code).toBe('PI-2026-006');
    });
  });

  // ─── Gộp đợt cắt: KHSX gộp SKU, Sếp quyết cả cụm ──────────────────────────────
  describe('updateItemsDeadlines (Sửa thời hạn cả PI, 2026-10-24)', () => {
    const mergedPi = () => pi({ id: 50n, code: 'PI-50', isMerged: true });
    const withDeadline = (id: bigint, d: string) =>
      piItem({ id, productionInvoiceId: 50n, materialDeadline: new Date(d) });

    beforeEach(() => {
      prisma.productionInvoice.findUnique.mockResolvedValue(mergedPi());
      prisma.productionInvoiceItem.findUnique.mockImplementation(
        ({ where }: { where: { id: bigint } }) =>
          Promise.resolve(piItem({ id: where.id, productionInvoiceId: 50n })),
      );
    });

    it('lệnh gộp: mốc cần sắt sau khi lưu cách nhau quá 3 ngày -> 400 (rollback), không gửi thông báo', async () => {
      prisma.productionInvoiceItem.findMany.mockResolvedValue([
        withDeadline(20n, '2026-11-01'),
        withDeadline(21n, '2026-11-10'),
      ]);

      await expect(
        updateItemsDeadlinesAs('50', {
          items: [{ itemId: '21', materialDeadline: '2026-11-10T00:00:00.000Z' }],
        }),
      ).rejects.toThrow(/lệnh gộp cách nhau 9 ngày.*tách SKU ra lệnh riêng/);
    });

    it('dời CẢ NHÓM cùng lúc (vẫn trong 3 ngày) -> lưu được trong 1 giao dịch', async () => {
      prisma.productionInvoiceItem.findMany.mockResolvedValue([
        withDeadline(20n, '2026-11-06'),
        withDeadline(21n, '2026-11-08'),
      ]);

      await updateItemsDeadlinesAs('50', {
        deadline: '2026-11-20T00:00:00.000Z',
        items: [
          { itemId: '20', materialDeadline: '2026-11-06T00:00:00.000Z' },
          { itemId: '21', materialDeadline: '2026-11-08T00:00:00.000Z' },
        ],
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.productionInvoiceItem.update).toHaveBeenCalledTimes(2);
    });
  });

  // Phần A – Đợt 9 (YC2): dòng đã Sếp duyệt không ghi thẳng mà gửi yêu cầu qua DeadlineChangesService
  describe('sửa mốc dòng đã duyệt (Đợt 9)', () => {
    const approvedItem = (id: bigint) =>
      piItem({ id, productionInvoiceId: 7n, prodApprovalStatus: 'APPROVED' });

    beforeEach(() => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockImplementation(
        ({ where }: { where: { id: bigint } }) =>
          Promise.resolve(
            where.id === 21n
              ? approvedItem(21n)
              : piItem({ id: where.id, productionInvoiceId: 7n }),
          ),
      );
    });

    it('updateItem dòng đã duyệt: gọi saveEntries (strict, MANUAL, bỏ hạn giao), KHÔNG ghi thẳng', async () => {
      await updateItemAs('7', '21', {
        materialDeadline: '2026-11-10T00:00:00.000Z',
        deliveryDeadline: '2026-12-01T00:00:00.000Z',
        stages: [{ stageType: ProdItemStageType.FRAME_HAN, deadline: '2026-11-14' }],
      });
      expect(prisma.productionInvoiceItem.update).not.toHaveBeenCalled();
      expect(deadlineChanges.saveEntries).toHaveBeenCalledWith(
        ACTOR,
        [
          {
            itemId: '21',
            newValues: { materialDeadline: '2026-11-10', 'stage.FRAME_HAN': '2026-11-14' },
          },
        ],
        'MANUAL',
        { strict: true },
      );
    });

    it('PI đã huỷ → 400, không ghi / gửi gì', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi({ status: 'CANCELLED' }));
      await expect(updateItemAs('7', '20', { materialDeadline: '2026-11-10' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        updateItemsDeadlinesAs('7', { items: [{ itemId: '20', materialDeadline: '2026-11-10' }] }),
      ).rejects.toThrow(/huỷ/);
      expect(deadlineChanges.saveEntries).not.toHaveBeenCalled();
    });

    it('updateItemsDeadlines hỗn hợp: dòng chưa duyệt ghi thẳng (cả hạn giao), dòng đã duyệt → yêu cầu; hạn PI không ghi khi PI có dòng đã duyệt', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({ items: [piItem({ id: 20n }), approvedItem(21n)] }),
      );
      deadlineChanges.previewEntries.mockResolvedValue([{ itemId: '21', errors: [] }]);
      deadlineChanges.saveEntries.mockResolvedValue({
        applied: [],
        batch: { id: '50' },
        skipped: [],
      });
      const result = await updateItemsDeadlinesAs('7', {
        deadline: '2026-12-20T00:00:00.000Z',
        items: [
          { itemId: '20', materialDeadline: '2026-11-10', deliveryDeadline: '2026-12-01' },
          { itemId: '21', materialDeadline: '2026-11-11' },
        ],
      });
      expect(prisma.productionInvoice.update).not.toHaveBeenCalled();
      expect(prisma.productionInvoiceItem.update).toHaveBeenCalledTimes(1);
      expect(prisma.productionInvoiceItem.update).toHaveBeenCalledWith({
        where: { id: 20n },
        data: expect.objectContaining({
          materialDeadline: new Date('2026-11-10'),
          deliveryDeadline: new Date('2026-12-01'),
        }) as unknown,
      });
      expect(deadlineChanges.saveEntries).toHaveBeenCalledWith(
        ACTOR,
        [{ itemId: '21', newValues: { materialDeadline: '2026-11-11' } }],
        'MANUAL',
        { strict: true },
      );
      expect(result.deadlineSave?.batch).toEqual({ id: '50' });
      expect(result.deadlineSave?.applied.map((c) => c.itemId)).toEqual(['20']);
    });

    it('dòng đã duyệt có lỗi → 400 TRƯỚC khi ghi dòng chưa duyệt', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({ items: [piItem({ id: 20n }), approvedItem(21n)] }),
      );
      deadlineChanges.previewEntries.mockResolvedValue([
        { itemId: '21', lenhCode: 'MY-21', skuCode: 'SKU', errors: ['Lệnh đã Kết thúc'] },
      ]);
      await expect(
        updateItemsDeadlinesAs('7', {
          items: [
            { itemId: '20', materialDeadline: '2026-11-10' },
            { itemId: '21', materialDeadline: '2026-11-11' },
          ],
        }),
      ).rejects.toThrow(/MY-21 · SKU: Lệnh đã Kết thúc/);
      expect(prisma.productionInvoiceItem.update).not.toHaveBeenCalled();
      expect(deadlineChanges.saveEntries).not.toHaveBeenCalled();
    });
  });

  // Phần A – Đợt 9 phần 2: Q9-2 (thứ tự mốc ngược → chặn) + Q9-3 (lệnh đã bắt đầu sản xuất → không sửa mốc).
  describe('sửa thẳng dòng chưa duyệt - chặn thứ tự ngược + lệnh đã bắt đầu (Đợt 9 phần 2)', () => {
    const stage = (stageType: string, d: string) => ({ stageType, deadline: new Date(d) });
    beforeEach(() => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi({ items: [piItem()] }));
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(piItem());
    });

    it('updateItem: Hàn sớm hơn Phôi → 400, giao dịch ném lỗi', async () => {
      prisma.productionInvoiceItem.findUniqueOrThrow.mockResolvedValue(
        piItem({
          stages: [stage('FRAME_PHOI', '2026-11-13'), stage('FRAME_HAN', '2026-11-12')],
        }),
      );
      await expect(
        updateItemAs('7', '20', {
          stages: [
            { stageType: ProdItemStageType.FRAME_PHOI, deadline: '2026-11-13' },
            { stageType: ProdItemStageType.FRAME_HAN, deadline: '2026-11-12' },
          ],
        }),
      ).rejects.toThrow(/MY-313 · SKU-01: Hàn \(12\/11\) sớm hơn Phôi \(13\/11\)/);
      expect(notificationsService.emit).not.toHaveBeenCalled();
    });

    it('updateItem: thứ tự đúng → vẫn lưu', async () => {
      prisma.productionInvoiceItem.findUniqueOrThrow.mockResolvedValue(
        piItem({
          stages: [stage('FRAME_PHOI', '2026-11-12'), stage('FRAME_HAN', '2026-11-13')],
        }),
      );
      await expect(
        updateItemAs('7', '20', {
          stages: [
            { stageType: ProdItemStageType.FRAME_PHOI, deadline: '2026-11-12' },
            { stageType: ProdItemStageType.FRAME_HAN, deadline: '2026-11-13' },
          ],
        }),
      ).resolves.toBeDefined();
      expect(prisma.productionInvoiceItemStage.upsert).toHaveBeenCalledTimes(2);
    });

    it('updateItem: dòng KHÔNG đổi gì thì không kiểm (dữ liệu cũ sai thứ tự không chặn)', async () => {
      const bad = piItem({
        stages: [stage('FRAME_PHOI', '2026-11-13'), stage('FRAME_HAN', '2026-11-12')],
      });
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(bad);
      prisma.productionInvoiceItem.findUniqueOrThrow.mockResolvedValue(bad);
      await expect(updateItemAs('7', '20', {})).resolves.toBeDefined();
    });

    it('updateItemsDeadlines: thứ tự ngược → 400 và giao dịch ném lỗi (hạn PI nằm trong cùng giao dịch)', async () => {
      prisma.productionInvoiceItem.findUniqueOrThrow.mockResolvedValue(
        piItem({
          materialDeadline: new Date('2026-11-20'),
          stages: [stage('PACKAGING_START', '2026-11-10')],
        }),
      );
      await expect(
        updateItemsDeadlinesAs('7', {
          deadline: '2026-12-20T00:00:00.000Z',
          items: [
            {
              itemId: '20',
              materialDeadline: '2026-11-20',
              stages: [{ stageType: ProdItemStageType.PACKAGING_START, deadline: '2026-11-10' }],
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('updateItemsDeadlines: thứ tự đúng → lưu, applied không còn cảnh báo', async () => {
      prisma.productionInvoiceItem.findUniqueOrThrow.mockResolvedValue(
        piItem({ materialDeadline: new Date('2026-11-10') }),
      );
      const result = await updateItemsDeadlinesAs('7', {
        items: [{ itemId: '20', materialDeadline: '2026-11-10' }],
      });
      expect(result.deadlineSave?.applied[0].warnings).toEqual([]);
    });

    it.each(['ACTIVE', 'PAUSED', 'FINISHED'])(
      'lệnh SX đã bắt đầu (%s) → 400, chưa ghi gì (cả updateItem lẫn updateItemsDeadlines)',
      async (floorStage) => {
        prisma.productionOrder.findMany.mockResolvedValue([
          { productionInvoiceItemId: 20n, floorStage },
        ]);
        await expect(updateItemAs('7', '20', { materialDeadline: '2026-11-10' })).rejects.toThrow(
          /đã bắt đầu sản xuất \(cắt phôi\)/,
        );
        await expect(
          updateItemsDeadlinesAs('7', {
            items: [{ itemId: '20', materialDeadline: '2026-11-10' }],
          }),
        ).rejects.toThrow(/MY-313 · SKU-01: Lệnh đã bắt đầu sản xuất/);
        expect(prisma.productionInvoiceItem.update).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );

    it('lệnh SX còn PENDING → vẫn sửa được', async () => {
      prisma.productionOrder.findMany.mockResolvedValue([
        { productionInvoiceItemId: 20n, floorStage: 'PENDING' },
      ]);
      await expect(
        updateItemAs('7', '20', { materialDeadline: '2026-11-10' }),
      ).resolves.toBeDefined();
    });
  });

  describe('mergeItems', () => {
    /** SKU kèm PI cha + hạn - đúng shape mergeItems truy vấn. */
    const mergeCandidate = (id: bigint, over: Record<string, unknown> = {}) => ({
      ...piItem({ id, ...over }),
      productionInvoice: { id: 7n, code: 'PI-7', isMerged: false, deadline: null },
    });

    beforeEach(() => {
      prisma.productionInvoice.create.mockResolvedValue({ id: 50n });
      prisma.productionInvoice.update.mockResolvedValue({ id: 50n, code: 'PI-50' });
      prisma.productionInvoiceItem.updateMany.mockResolvedValue({ count: 2 });
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({ id: 50n, code: 'PI-50', isMerged: true, salesOrderId: null, salesOrder: null }),
      );
    });

    it('bằng chứng đặc cách tính theo ĐÚNG chiều dài cây KHSX chọn cho TỪNG quy cách', async () => {
      // Ca thật (2026-09-16): KHSX chọn 20x20=6000, 25x50=6000, 30x50=5800 rồi mới bấm "Chấp
      // nhận hao hụt cao hơn". Số Sếp đọc PHẢI tính trên đúng bộ cây đó, không phải cây chuẩn:
      // ngưỡng đặc cách được solver áp lên CÂY ĐANG CẮT, nên bằng chứng tính trên cây chuẩn vừa
      // đọc ra vô lý ("xin 15% vì ước tính 1.88%") vừa dẫn tới xin thiếu -> phương án FAILED sau
      // khi Sếp đã ký.
      prisma.productionInvoiceItem.findMany.mockResolvedValue([
        mergeCandidate(20n, { salesOrderId: 1n }),
        mergeCandidate(21n, { salesOrderId: 2n }),
      ]);
      cuttingProposalsService.previewBatch.mockResolvedValue({
        lines: [
          {
            materialId: '9',
            materialCode: 'SAT-HOP-30X50',
            thresholdPct: 1,
            stockLengthMm: 5800,
            minWastePct: 13.74,
            meetsThreshold: false,
          },
        ],
        totalBarsSaved: 0,
        daysCutEarly: null,
      });

      // Thông số cắt lấy từ CHÍNH lượt tính (không nhận lại từ client) - xem assertReadyForInvoice.
      cuttingProposalsService.assertReadyForInvoice.mockResolvedValue({
        id: 1000n,
        solverOptions: {
          solverMaxWastePctOverride: 15,
          solverOverrideReason: 'PO gấp',
          solverStockLengthsByMaterial: { '7': 6000, '8': 6000, '9': 5800 },
        },
      });

      await service.mergeItems(
        { productionInvoiceItemIds: ['20', '21'], cuttingProposalId: '1000' },
        'user-khsx',
      );

      // Chiều dài phải đi TỚI previewBatch - thiếu chỗ này là bằng chứng lặng lẽ quay về cây chuẩn.
      expect(cuttingProposalsService.previewBatch).toHaveBeenCalledWith({
        productionInvoiceItemIds: ['20', '21'],
        stockLengthsByMaterial: { '7': 6000, '8': 6000, '9': 5800 },
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest.Mock.calls typing
      const created = prisma.productionInvoice.create.mock.calls[0][0] as {
        data: { solverOverrideEvidence?: { materialCode: string; estimatedWastePct: number } };
      };
      expect(created.data.solverOverrideEvidence?.materialCode).toBe('SAT-HOP-30X50');
      expect(created.data.solverOverrideEvidence?.estimatedWastePct).toBe(13.74);
    });

    it('bằng chứng đặc cách lấy % THẬT của dòng trong phương án đã tính, không phải ước tính best-fill (UX-6, PI-2026-041)', async () => {
      // SAT-VUONG-50X50: ước tính cận dưới 0,55 % (1 cây lý tưởng) nhưng phương án thật 55,83 % - Sếp duyệt chi thêm tiền
      // sắt trên số này nên PHẢI là số thật. Loại không có dòng thật dùng được giữ ước tính.
      prisma.productionInvoiceItem.findMany.mockResolvedValue([
        mergeCandidate(20n, { salesOrderId: 1n }),
        mergeCandidate(21n, { salesOrderId: 2n }),
      ]);
      cuttingProposalsService.previewBatch.mockResolvedValue({
        lines: [
          {
            materialId: '9',
            materialCode: 'SAT-VUONG-50X50',
            thresholdPct: 1,
            stockLengthMm: 6000,
            minWastePct: 0.55,
            meetsThreshold: true,
          },
          {
            materialId: '8',
            materialCode: 'SAT-HOP-10X20',
            thresholdPct: 1,
            stockLengthMm: 6000,
            minWastePct: 0.2,
            meetsThreshold: true,
          },
        ],
        totalBarsSaved: 0,
        daysCutEarly: null,
      });
      cuttingProposalsService.getProposalLineWaste.mockResolvedValue([
        { materialCode: 'SAT-VUONG-50X50', wastePct: 55.833, stockLengthMm: 6000 },
        { materialCode: 'SAT-HOP-10X20', wastePct: null, stockLengthMm: null }, // vô nghiệm: giữ ước tính
      ]);
      cuttingProposalsService.assertReadyForInvoice.mockResolvedValue({
        id: 1000n,
        solverOptions: { solverMaxWastePctOverride: 100, solverOverrideReason: 'PO gấp' },
      });

      await service.mergeItems(
        { productionInvoiceItemIds: ['20', '21'], cuttingProposalId: '1000' },
        'user-khsx',
      );

      expect(cuttingProposalsService.getProposalLineWaste).toHaveBeenCalledWith(1000n);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest.Mock.calls typing
      const created = prisma.productionInvoice.create.mock.calls[0][0] as {
        data: {
          solverOverrideEvidence?: {
            materialCode: string;
            estimatedWastePct: number;
            normalThresholdPct: number;
            stockLengthMm: number;
          };
        };
      };
      expect(created.data.solverOverrideEvidence).toEqual({
        materialCode: 'SAT-VUONG-50X50',
        estimatedWastePct: 55.833,
        normalThresholdPct: 1,
        stockLengthMm: 6000,
        fromProposal: true,
      });
    });

    it('gộp 2 SKU thành PI mới: isMerged, không thuộc đơn nào, hạn theo SKU GẤP NHẤT', async () => {
      // Cách nhau 2 ngày - trong luật gộp 3 ngày (2026-10-24; bản cũ dùng 19 ngày, nay bị chặn - xem test luật gộp bên dưới).
      const soon = new Date('2026-09-01');
      const later = new Date('2026-09-03');
      prisma.productionInvoiceItem.findMany.mockResolvedValue([
        mergeCandidate(20n, { salesOrderId: 1n, materialDeadline: later }),
        mergeCandidate(21n, { salesOrderId: 2n, materialDeadline: soon }),
      ]);

      await service.mergeItems(
        { productionInvoiceItemIds: ['20', '21'], cuttingProposalId: '1000' },
        'user-khsx',
      );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest.Mock.calls typing
      const created = prisma.productionInvoice.create.mock.calls[0][0] as {
        data: {
          isMerged: boolean;
          salesOrderId: bigint | null;
          deadline: Date;
          mergedById: string;
        };
      };
      expect(created.data.isMerged).toBe(true);
      // Nhóm có SKU của 2 đơn khác nhau nên không quy về 1 đơn được.
      expect(created.data.salesOrderId).toBeNull();
      // Cả nhóm cắt cùng lúc -> phải theo đơn gấp nhất, lấy hạn muộn là để đơn gấp trễ hẹn.
      expect(created.data.deadline).toEqual(soon);
      expect(created.data.mergedById).toBe('user-khsx');
    });

    it('KHÔNG đụng salesOrderId của SKU - đó là đường duy nhất truy ra đơn gốc sau khi gộp', async () => {
      prisma.productionInvoiceItem.findMany.mockResolvedValue([
        mergeCandidate(20n, { salesOrderId: 1n }),
        mergeCandidate(21n, { salesOrderId: 2n }),
      ]);

      await service.mergeItems(
        { productionInvoiceItemIds: ['20', '21'], cuttingProposalId: '1000' },
        'user-khsx',
      );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest.Mock.calls typing
      const moved = prisma.productionInvoiceItem.updateMany.mock.calls[0][0] as {
        where: { id: { in: bigint[] } };
        data: Record<string, unknown>;
      };
      expect(moved.where.id.in).toEqual([20n, 21n]);
      // productionInvoiceId đổi + reset sạch chu kỳ duyệt cũ (2026-08-24) - xem rejectItem/
      // claimSolo cùng lý do. salesOrderId KHÔNG được đụng tới - đó là đường duy nhất truy ra
      // đơn gốc của từng SKU sau khi gộp.
      expect(moved.data).toEqual({
        productionInvoiceId: 50n,
        prodApprovalStatus: null,
        rejectReason: null,
        requestedAt: null,
        requestedById: null,
        warehouseCode: null,
        warehouseName: null,
        workshopId: null, // Phần A – Đợt 2 (lsxCode KHÔNG bị xoá)
        qlsxAt: null,
        qlsxById: null,
        decidedAt: null,
        decidedById: null,
      });
      expect(moved.data).not.toHaveProperty('salesOrderId');
      expect(moved.data).not.toHaveProperty('lsxCode');
    });

    it('chặn gộp dưới 2 SKU (trùng id cũng tính là 1)', async () => {
      await expect(
        service.mergeItems(
          { productionInvoiceItemIds: ['20', '20'], cuttingProposalId: '1000' },
          'user-khsx',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.productionInvoice.create).not.toHaveBeenCalled();
    });

    it('LUẬT GỘP: mốc cần sắt cách nhau quá 3 ngày -> 400, nêu SKU sớm/muộn nhất, không tạo PI (Sếp Nhân 2026-10-24)', async () => {
      prisma.productionInvoiceItem.findMany.mockResolvedValue([
        mergeCandidate(20n, { materialDeadline: new Date('2026-09-01') }),
        mergeCandidate(21n, { materialDeadline: new Date('2026-09-08') }),
      ]);

      const err = (await service
        .mergeItems(
          { productionInvoiceItemIds: ['20', '21'], cuttingProposalId: '1000' },
          'user-khsx',
        )
        .catch((e: Error) => e)) as Error;
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toContain('cách nhau 7 ngày');
      expect(err.message).toContain('trong khung 3 ngày');
      expect(prisma.productionInvoice.create).not.toHaveBeenCalled();
    });

    it('LUẬT GỘP: quá trần số SKU -> 400', async () => {
      prisma.systemConfig.findUniqueOrThrow.mockResolvedValue({
        solverMergeWindowDays: 3,
        solverMergeMaxSkus: 1,
      });
      prisma.productionInvoiceItem.findMany.mockResolvedValue([
        mergeCandidate(20n),
        mergeCandidate(21n),
      ]);

      await expect(
        service.mergeItems(
          { productionInvoiceItemIds: ['20', '21'], cuttingProposalId: '1000' },
          'user-khsx',
        ),
      ).rejects.toThrow('tối đa 1 SKU');
    });

    it('chặn gộp SKU Sếp đã duyệt - phần sắt của nó đã được tính rồi', async () => {
      prisma.productionInvoiceItem.findMany.mockResolvedValue([
        mergeCandidate(20n),
        mergeCandidate(21n, { prodApprovalStatus: 'APPROVED' }),
      ]);

      await expect(
        service.mergeItems(
          { productionInvoiceItemIds: ['20', '21'], cuttingProposalId: '1000' },
          'user-khsx',
        ),
      ).rejects.toThrow(ConflictException);
      expect(prisma.productionInvoice.create).not.toHaveBeenCalled();
    });

    it('chặn gộp chồng SKU đang nằm trong đợt gộp khác', async () => {
      prisma.productionInvoiceItem.findMany.mockResolvedValue([
        mergeCandidate(20n),
        {
          ...piItem({ id: 21n }),
          productionInvoice: { id: 9n, code: 'PI-9', isMerged: true, deadline: null },
        },
      ]);

      await expect(
        service.mergeItems(
          { productionInvoiceItemIds: ['20', '21'], cuttingProposalId: '1000' },
          'user-khsx',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('báo rõ id nào không tìm thấy thay vì gộp thiếu trong im lặng', async () => {
      prisma.productionInvoiceItem.findMany.mockResolvedValue([mergeCandidate(20n)]);

      await expect(
        service.mergeItems(
          { productionInvoiceItemIds: ['20', '21'], cuttingProposalId: '1000' },
          'user-khsx',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('KHSX để theo mặc định (solverOptions không có máy) -> PI ghi máy THỰC SỰ đã dùng; máy KHSX chọn thắng', async () => {
      prisma.productionInvoiceItem.findMany.mockResolvedValue([
        mergeCandidate(20n),
        mergeCandidate(21n),
      ]);

      cuttingProposalsService.assertReadyForInvoice.mockResolvedValueOnce({
        id: 1000n,
        solverOptions: {},
        usedMachine: 'tu_dong',
      });
      await service.mergeItems(
        { productionInvoiceItemIds: ['20', '21'], cuttingProposalId: '1000' },
        'user-khsx',
      );
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest.Mock.calls typing
      const byDefault = prisma.productionInvoice.create.mock.calls[0][0] as {
        data: SolverOverrideColumns;
      };
      expect(byDefault.data.solverMachine).toBe('tu_dong');

      cuttingProposalsService.assertReadyForInvoice.mockResolvedValueOnce({
        id: 1000n,
        solverOptions: { solverMachine: 'laser' },
        usedMachine: 'laser',
      });
      await service.mergeItems(
        { productionInvoiceItemIds: ['20', '21'], cuttingProposalId: '1000' },
        'user-khsx',
      );
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest.Mock.calls typing
      const chosen = prisma.productionInvoice.create.mock.calls[1][0] as {
        data: SolverOverrideColumns;
      };
      expect(chosen.data.solverMachine).toBe('laser');
    });

    it('lưu thông số cắt KHSX đề nghị cho đợt gộp này (2026-09-14) - null hết khi không xin gì', async () => {
      prisma.productionInvoiceItem.findMany.mockResolvedValue([
        mergeCandidate(20n),
        mergeCandidate(21n),
      ]);

      cuttingProposalsService.assertReadyForInvoice.mockResolvedValueOnce({
        id: 1000n,
        solverOptions: {
          solverMaxWastePctOverride: 5,
          solverAllowCustomLength: false,
          solverMachine: 'tu_dong',
          solverOverrideReason: 'PO-4 giao gấp',
        },
      });
      await service.mergeItems(
        { productionInvoiceItemIds: ['20', '21'], cuttingProposalId: '1000' },
        'user-khsx',
      );
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest.Mock.calls typing
      const created = prisma.productionInvoice.create.mock.calls[0][0] as {
        data: SolverOverrideColumns;
      };
      expect(created.data.solverMaxWastePctOverride).toBe(5);
      expect(created.data.solverAllowCustomLength).toBe(false);
      // Máy cắt KHSX chọn ở lượt tính trước được copy sang PI (2026-10-23).
      expect(created.data.solverMachine).toBe('tu_dong');
      expect(created.data.solverOverrideReason).toBe('PO-4 giao gấp');

      await service.mergeItems(
        { productionInvoiceItemIds: ['20', '21'], cuttingProposalId: '1000' },
        'user-khsx',
      );
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest.Mock.calls typing
      const createdNoChoice = prisma.productionInvoice.create.mock.calls[1][0] as {
        data: SolverOverrideColumns;
      };
      expect(createdNoChoice.data.solverMaxWastePctOverride).toBeNull();
      expect(createdNoChoice.data.solverAllowCustomLength).toBeNull();
      expect(createdNoChoice.data.solverMachine).toBeNull();
      expect(createdNoChoice.data.solverOverrideReason).toBeNull();
    });
  });

  describe('mergeItems - luồng "Solve trước → tạo PI" (2026-09-30)', () => {
    const mergeCandidate = (id: bigint) => ({
      ...piItem({ id }),
      productionInvoice: { id: 7n, code: 'PI-7', isMerged: false, deadline: null },
    });

    beforeEach(() => {
      prisma.productionInvoice.create.mockResolvedValue({ id: 50n });
      prisma.productionInvoiceItem.updateMany.mockResolvedValue({ count: 2 });
      prisma.productionInvoiceItem.findMany.mockResolvedValue([
        mergeCandidate(20n),
        mergeCandidate(21n),
      ]);
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({ id: 50n, code: 'PI-50', isMerged: true, salesOrderId: null, salesOrder: null }),
      );
    });

    it('cổng phương án cắt chặn (vô nghiệm/lỗi thời/lệch tập SKU) -> KHÔNG tạo PI, KHÔNG gắn phương án', async () => {
      cuttingProposalsService.assertReadyForInvoice.mockRejectedValue(
        new ConflictException('Định mức của 1 SKU đã đổi kể từ lúc tính'),
      );

      await expect(
        service.mergeItems(
          { productionInvoiceItemIds: ['20', '21'], cuttingProposalId: '1000' },
          'user-khsx',
        ),
      ).rejects.toThrow(ConflictException);

      expect(prisma.productionInvoice.create).not.toHaveBeenCalled();
      expect(cuttingProposalsService.attachToInvoice).not.toHaveBeenCalled();
    });

    it('gắn ĐÚNG phương án đã tính vào PI vừa tạo, cùng transaction', async () => {
      await service.mergeItems(
        { productionInvoiceItemIds: ['20', '21'], cuttingProposalId: '1000' },
        'user-khsx',
      );

      expect(cuttingProposalsService.assertReadyForInvoice).toHaveBeenCalledWith('1000', [
        20n,
        21n,
      ]);
      expect(cuttingProposalsService.attachToInvoice).toHaveBeenCalledWith(prisma, 1000n, 50n);
    });
  });

  // ─── "Tiến hành cắt riêng" (2026-08-20): đúng 1 SKU chưa được gom, tạo PI thường của riêng nó ──
  describe('claimSolo', () => {
    it('tạo PI thường (không isMerged) cho đúng SKU chưa được gom, gắn productionInvoiceId', async () => {
      prisma.productionInvoiceItem.findUnique.mockResolvedValue({
        id: 20n,
        productionInvoiceId: null,
        salesOrderId: 1n,
        deliveryDeadline: new Date('2026-10-10'),
      });
      prisma.productionInvoice.create.mockResolvedValue({ id: 60n });
      prisma.productionInvoiceItem.update.mockResolvedValue({});
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({ id: 60n, code: 'PI-60', isMerged: false, salesOrderId: 1n }),
      );

      await service.claimSolo('20', { cuttingProposalId: '1000' });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest.Mock.calls typing
      const created = prisma.productionInvoice.create.mock.calls[0][0] as {
        data: { isMerged: boolean; salesOrderId: bigint | null; deadline: Date };
      };
      expect(created.data.isMerged).toBe(false);
      expect(created.data.salesOrderId).toBe(1n);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest.Mock.calls typing
      const updated = prisma.productionInvoiceItem.update.mock.calls[0][0] as {
        where: { id: bigint };
        data: { productionInvoiceId: bigint; workshopId: null };
      };
      expect(updated.where.id).toBe(20n);
      expect(updated.data.productionInvoiceId).toBe(60n);
      // Phần A – Đợt 2: xưởng reset cùng warehouseCode, lsxCode giữ
      expect(updated.data.workshopId).toBeNull();
      expect(updated.data).not.toHaveProperty('lsxCode');
    });

    it('chặn gọi lại cho SKU đã được gom rồi - không tạo PI mới đè lên', async () => {
      prisma.productionInvoiceItem.findUnique.mockResolvedValue({
        id: 20n,
        productionInvoiceId: 7n,
        salesOrderId: 1n,
        deliveryDeadline: null,
      });

      await expect(service.claimSolo('20', { cuttingProposalId: '1000' })).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.productionInvoice.create).not.toHaveBeenCalled();
    });

    it('báo 404 khi SKU không tồn tại', async () => {
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(null);

      await expect(service.claimSolo('999', { cuttingProposalId: '1000' })).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.productionInvoice.create).not.toHaveBeenCalled();
    });

    it('cắt riêng: KHSX để theo mặc định -> PI ghi máy thực sự đã dùng của lượt tính', async () => {
      prisma.productionInvoiceItem.findUnique.mockResolvedValue({
        id: 20n,
        productionInvoiceId: null,
        salesOrderId: 1n,
        deliveryDeadline: new Date('2026-10-10'),
      });
      prisma.productionInvoice.create.mockResolvedValue({ id: 60n });
      prisma.productionInvoiceItem.update.mockResolvedValue({});
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({ id: 60n, code: 'PI-60', isMerged: false, salesOrderId: 1n }),
      );
      cuttingProposalsService.assertReadyForInvoice.mockResolvedValueOnce({
        id: 1000n,
        solverOptions: {},
        usedMachine: 'tu_dong',
      });

      await service.claimSolo('20', { cuttingProposalId: '1000' });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest.Mock.calls typing
      const created = prisma.productionInvoice.create.mock.calls[0][0] as {
        data: SolverOverrideColumns;
      };
      expect(created.data.solverMachine).toBe('tu_dong');
    });

    it('lưu thông số cắt KHSX đề nghị cho SKU này (2026-09-14) - null hết khi không truyền gì', async () => {
      prisma.productionInvoiceItem.findUnique.mockResolvedValue({
        id: 20n,
        productionInvoiceId: null,
        salesOrderId: 1n,
        deliveryDeadline: new Date('2026-10-10'),
      });
      prisma.productionInvoice.create.mockResolvedValue({ id: 60n });
      prisma.productionInvoiceItem.update.mockResolvedValue({});
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({ id: 60n, code: 'PI-60', isMerged: false, salesOrderId: 1n }),
      );

      cuttingProposalsService.assertReadyForInvoice.mockResolvedValueOnce({
        id: 1000n,
        solverOptions: {
          solverMaxWastePctOverride: 5,
          solverAllowCustomLength: false,
          solverMachine: 'laser',
          solverOverrideReason: 'khách gấp',
        },
      });
      await service.claimSolo('20', { cuttingProposalId: '1000' });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest.Mock.calls typing
      const created = prisma.productionInvoice.create.mock.calls[0][0] as {
        data: SolverOverrideColumns;
      };
      expect(created.data.solverMaxWastePctOverride).toBe(5);
      expect(created.data.solverAllowCustomLength).toBe(false);
      expect(created.data.solverMachine).toBe('laser');
      expect(created.data.solverOverrideReason).toBe('khách gấp');

      await service.claimSolo('20', { cuttingProposalId: '1000' });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest.Mock.calls typing
      const createdNoChoice = prisma.productionInvoice.create.mock.calls[1][0] as {
        data: SolverOverrideColumns;
      };
      expect(createdNoChoice.data.solverMaxWastePctOverride).toBeNull();
      expect(createdNoChoice.data.solverAllowCustomLength).toBeNull();
      expect(createdNoChoice.data.solverMachine).toBeNull();
      expect(createdNoChoice.data.solverOverrideReason).toBeNull();
    });
  });

  describe('approveBatch', () => {
    const mergedPi = (items: unknown[]) =>
      pi({ id: 50n, code: 'PI-50', isMerged: true, salesOrderId: null, salesOrder: null, items });

    it('chạy solver ĐÚNG MỘT LẦN cho cả nhóm, không phải mỗi SKU một lần', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        mergedPi([
          piItem({ id: 20n, salesOrderId: 1n, prodApprovalStatus: 'WAITING_BOSS' }),
          piItem({ id: 21n, salesOrderId: 2n, prodApprovalStatus: 'WAITING_BOSS' }),
        ]),
      );
      prisma.productionInvoiceItem.updateMany.mockResolvedValue({ count: 2 });

      await service.approveBatch('50', 'user-boss');

      // Cốt lõi của tính năng: gộp chỉ tiết kiệm sắt khi cả nhóm vào CHUNG một bài toán.
      expect(cuttingProposalsService.requestForInvoice).toHaveBeenCalledTimes(1);
      expect(cuttingProposalsService.requestForInvoice).toHaveBeenCalledWith(50n, {
        requestedById: 'user-boss',
        onComplete: expect.any(Function) as () => void,
      });
      expect(cuttingProposalsService.requestForOrder).not.toHaveBeenCalled();
      // Mỗi SKU vẫn có lệnh sản xuất riêng của nó (Phôi/Hàn/Sơn chạy theo SKU như cũ).
      expect(productionOrdersService.createFromApproval).toHaveBeenCalledTimes(2);
      // Cùng idiom approveItem() (2026-08-24) - PI gộp giờ cũng trigger 2 đề xuất mua VTTP/tiêu
      // hao, dồn vào onComplete để chạy SAU khi đề xuất mua sắt của cả cụm tính xong.
      expect(pieceMaterialYieldPurchaseService.computeAndUpsertProposals).toHaveBeenCalledWith(
        '50',
      );
      expect(consumableMaterialPurchaseService.computeAndUpsertProposals).toHaveBeenCalledWith(
        '50',
      );
    });

    it('best-effort: vẫn duyệt cả cụm thành công dù trigger tính nhu cầu mua vật tư thành phẩm/tiêu hao lỗi', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        mergedPi([piItem({ id: 20n, salesOrderId: 1n, prodApprovalStatus: 'WAITING_BOSS' })]),
      );
      prisma.productionInvoiceItem.updateMany.mockResolvedValue({ count: 1 });
      pieceMaterialYieldPurchaseService.computeAndUpsertProposals.mockRejectedValue(
        new Error('material chưa có Kho'),
      );
      consumableMaterialPurchaseService.computeAndUpsertProposals.mockRejectedValue(
        new Error('material chưa có Kho'),
      );

      await service.approveBatch('50', 'user-boss');

      expect(cuttingProposalsService.requestForInvoice).toHaveBeenCalledTimes(1);
    });

    it('kiểm định mức của MỌI SKU trước khi ghi gì - thiếu 1 cái là dừng cả cụm', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        mergedPi([
          piItem({ id: 20n, prodApprovalStatus: 'WAITING_BOSS' }),
          piItem({ id: 21n, prodApprovalStatus: 'WAITING_BOSS' }),
        ]),
      );
      productionOrdersService.assertActiveBomRevisionExists
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new ConflictException('thiếu định mức'));

      await expect(service.approveBatch('50', 'user-boss')).rejects.toThrow(ConflictException);
      expect(prisma.productionInvoiceItem.updateMany).not.toHaveBeenCalled();
      expect(cuttingProposalsService.requestForInvoice).not.toHaveBeenCalled();
    });

    it('từ chối duyệt cụm trên PI thường - PI thường duyệt theo từng SKU', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({ items: [piItem({ prodApprovalStatus: 'WAITING_BOSS' })] }),
      );

      await expect(service.approveBatch('7', 'user-boss')).rejects.toThrow(ConflictException);
    });

    // (Đính chính 2026-08-29, audit độc lập 28/08 mục Nghiêm trọng #3) trước đây updateMany() ghi
    // vô điều kiện theo productionInvoiceId - không chặn được rejectBatch() xoá PI + ghi đè REJECTED
    // đúng lúc request duyệt này đang chạy: 1 item bị "duyệt" xong dù PI cha đã không còn tồn tại.
    it('CHẶN (409) nếu 1 item đã bị rejectBatch() ghi đè trong lúc đang duyệt cả cụm', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({
          id: 50n,
          code: 'PI-50',
          isMerged: true,
          items: [
            piItem({ id: 20n, prodApprovalStatus: 'WAITING_BOSS' }),
            piItem({ id: 21n, prodApprovalStatus: 'WAITING_BOSS' }),
          ],
        }),
      );
      // Chỉ 1/2 dòng còn khớp WAITING_BOSS lúc updateMany chạy - dòng kia vừa bị rejectBatch()
      // ghi REJECTED.
      prisma.productionInvoiceItem.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.approveBatch('50', 'user-boss')).rejects.toThrow(ConflictException);
      expect(productionOrdersService.createFromApproval).not.toHaveBeenCalled();
      expect(cuttingProposalsService.requestForInvoice).not.toHaveBeenCalled();
    });
  });

  // ─── Luồng "Solve trước → tạo PI" (2026-09-30): PI đã có phương án cắt tính sẵn ──────────────
  describe('duyệt/từ chối PI có phương án cắt tính sẵn', () => {
    const preSolved = { id: 1000n, status: 'DRAFT' };

    beforeEach(() => {
      cuttingProposalsService.findPreSolvedForInvoice.mockResolvedValue(preSolved);
      cuttingProposalsService.assertReadyForApproval.mockResolvedValue({
        revisionByItemId: new Map<bigint, bigint>([[20n, 555n]]),
      });
    });

    it('approveItem: duyệt ĐÚNG phương án có sẵn, KHÔNG chạy solver, PO ghim revision đã tính', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_BOSS' }),
      );
      prisma.productionInvoiceItem.count.mockResolvedValue(0);

      await service.approveItem('7', '20', 'user-boss');

      // Cổng kiểm phương án chạy TRƯỚC khi ghi APPROVED (thay cho kiểm BOM active).
      expect(cuttingProposalsService.assertReadyForApproval).toHaveBeenCalledWith(1000n, 7n);
      expect(productionOrdersService.assertActiveBomRevisionExists).not.toHaveBeenCalled();
      expect(productionOrdersService.createFromApproval).toHaveBeenCalledWith(20n, 2n, 10, 555n);
      expect(cuttingProposalsService.approve).toHaveBeenCalledWith('1000', 'user-boss');
      expect(cuttingProposalsService.requestForOrder).not.toHaveBeenCalled();
      // 2 nguồn đề xuất mua còn lại vẫn chạy sau đó.
      expect(pieceMaterialYieldPurchaseService.computeAndUpsertProposals).toHaveBeenCalledWith('7');
      expect(consumableMaterialPurchaseService.computeAndUpsertProposals).toHaveBeenCalledWith('7');
    });

    it('approveItem: phương án lỗi thời -> 409 TRƯỚC khi ghi APPROVED/tạo PO', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_BOSS' }),
      );
      cuttingProposalsService.assertReadyForApproval.mockRejectedValue(
        new ConflictException('Định mức đã đổi kể từ lúc tính'),
      );

      await expect(service.approveItem('7', '20', 'user-boss')).rejects.toThrow(ConflictException);

      expect(prisma.productionInvoiceItem.updateMany).not.toHaveBeenCalled();
      expect(productionOrdersService.createFromApproval).not.toHaveBeenCalled();
      expect(cuttingProposalsService.approve).not.toHaveBeenCalled();
    });

    it('approveItem: duyệt phương án lỗi -> vẫn duyệt SKU + vẫn tính 2 nguồn mua còn lại (best-effort)', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_BOSS' }),
      );
      prisma.productionInvoiceItem.count.mockResolvedValue(0);
      cuttingProposalsService.approve.mockRejectedValue(new Error('kho lỗi'));

      await expect(service.approveItem('7', '20', 'user-boss')).resolves.toBeDefined();

      expect(consumableMaterialPurchaseService.computeAndUpsertProposals).toHaveBeenCalledWith('7');
    });

    it('approveBatch: cả cụm duyệt 1 phương án duy nhất, KHÔNG gọi requestForInvoice', async () => {
      cuttingProposalsService.assertReadyForApproval.mockResolvedValue({
        revisionByItemId: new Map<bigint, bigint>([
          [20n, 555n],
          [21n, 556n],
        ]),
      });
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({
          id: 50n,
          code: 'PI-50',
          isMerged: true,
          salesOrderId: null,
          salesOrder: null,
          items: [
            piItem({ id: 20n, mfgProductId: 2n, prodApprovalStatus: 'WAITING_BOSS' }),
            piItem({ id: 21n, mfgProductId: 3n, prodApprovalStatus: 'WAITING_BOSS' }),
          ],
        }),
      );
      prisma.productionInvoiceItem.updateMany.mockResolvedValue({ count: 2 });
      cuttingProposalsService.findPreSolvedForInvoice.mockResolvedValue(preSolved);

      await service.approveBatch('50', 'user-boss');

      expect(cuttingProposalsService.assertReadyForApproval).toHaveBeenCalledWith(1000n, 50n);
      expect(productionOrdersService.createFromApproval).toHaveBeenCalledWith(20n, 2n, 10, 555n);
      expect(productionOrdersService.createFromApproval).toHaveBeenCalledWith(21n, 3n, 10, 556n);
      expect(cuttingProposalsService.approve).toHaveBeenCalledTimes(1);
      expect(cuttingProposalsService.approve).toHaveBeenCalledWith('1000', 'user-boss');
      expect(cuttingProposalsService.requestForInvoice).not.toHaveBeenCalled();
    });

    it('retryProductionOrder: PO đã có nhưng phương án còn DRAFT -> duyệt lại phương án, không giải lại', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'APPROVED' }),
      );
      prisma.productionOrder.findUnique.mockResolvedValue({ id: 99n, poNumber: 'PO-1-1' });

      await service.retryProductionOrder('7', '20', 'admin-1');

      expect(cuttingProposalsService.approve).toHaveBeenCalledWith('1000', 'admin-1');
      expect(productionOrdersService.createFromApproval).not.toHaveBeenCalled();
      expect(cuttingProposalsService.requestForOrder).not.toHaveBeenCalled();
    });

    it('rejectBatch: gỡ phương án khỏi PI TRƯỚC khi xoá PI (FK)', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({
          id: 50n,
          code: 'PI-50',
          isMerged: true,
          salesOrderId: null,
          salesOrder: null,
          items: [
            piItem({ id: 20n, prodApprovalStatus: 'WAITING_BOSS' }),
            piItem({ id: 21n, prodApprovalStatus: 'WAITING_BOSS' }),
          ],
        }),
      );
      prisma.productionInvoiceItem.updateMany.mockResolvedValue({ count: 2 });
      const order: string[] = [];
      cuttingProposalsService.releaseForInvoice.mockImplementation(() => {
        order.push('release');
        return Promise.resolve();
      });
      prisma.productionInvoice.delete.mockImplementation(() => {
        order.push('delete');
        return Promise.resolve({});
      });

      await service.rejectBatch('50', 'Hạn quá gấp', 'user-boss');

      expect(cuttingProposalsService.releaseForInvoice).toHaveBeenCalledWith(prisma, 50n);
      expect(order).toEqual(['release', 'delete']);
    });
  });

  describe('rejectBatch', () => {
    const mergedPi = (items: unknown[]) =>
      pi({ id: 50n, code: 'PI-50', isMerged: true, salesOrderId: null, salesOrder: null, items });

    it('trả SKU về trạng thái chưa gom (productionInvoiceId=null) kèm lý do rồi xoá đợt gộp', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        mergedPi([
          piItem({ id: 20n, salesOrderId: 1n, prodApprovalStatus: 'WAITING_BOSS' }),
          piItem({ id: 21n, salesOrderId: 2n, prodApprovalStatus: 'WAITING_BOSS' }),
        ]),
      );
      // updateMany lọc kèm WAITING_BOSS cho CẢ 2 item cùng lúc (race-guard) - 2 = itemIds.length.
      prisma.productionInvoiceItem.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.rejectBatch('50', 'Hạn quá gấp', 'user-boss');

      expect(prisma.productionInvoiceItem.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [20n, 21n] }, prodApprovalStatus: 'WAITING_BOSS' },
        data: expect.objectContaining({
          productionInvoiceId: null,
          prodApprovalStatus: 'REJECTED',
          rejectReason: 'Hạn quá gấp',
          decidedById: 'user-boss',
        }) as unknown,
      });
      expect(prisma.productionInvoice.delete).toHaveBeenCalledWith({ where: { id: 50n } });
      expect(result.movedItemIds).toEqual(['20', '21']);
    });

    // (Đính chính 2026-08-29, audit độc lập 28/08 mục Nghiêm trọng #3) trước đây vòng lặp update()
    // KHÔNG ĐIỀU KIỆN theo id không chặn được approveBatch() ghi APPROVED xong đúng lúc request này
    // đang chạy - rejectBatch() vẫn ghi đè REJECTED + xoá PI, để lại ProductionOrder mồ côi.
    it('CHẶN (409, rollback) nếu 1 item đã bị approveBatch() ghi APPROVED trong lúc đang từ chối cả cụm', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        mergedPi([
          piItem({ id: 20n, prodApprovalStatus: 'WAITING_BOSS' }),
          piItem({ id: 21n, prodApprovalStatus: 'WAITING_BOSS' }),
        ]),
      );
      // Chỉ 1/2 dòng còn khớp WAITING_BOSS lúc updateMany chạy - dòng kia vừa bị approveBatch()
      // ghi APPROVED.
      prisma.productionInvoiceItem.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.rejectBatch('50', 'Hạn quá gấp', 'user-boss')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.productionInvoice.delete).not.toHaveBeenCalled();
    });

    it('không xoá được đợt đã có SKU duyệt - lệnh sản xuất đã sinh, xoá sẽ để lại rác', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        mergedPi([
          piItem({ id: 20n, prodApprovalStatus: 'APPROVED' }),
          piItem({ id: 21n, prodApprovalStatus: 'WAITING_BOSS' }),
        ]),
      );

      await expect(service.rejectBatch('50', 'lý do', 'user-boss')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.productionInvoice.delete).not.toHaveBeenCalled();
    });
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
      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest matcher typing */
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tableName: 'ProductionInvoiceItem',
          recordId: '20',
          action: 'UPDATE',
          oldValue: expect.objectContaining({ prodApprovalStatus: null }),
          newValue: expect.objectContaining({ prodApprovalStatus: 'WAITING_QLSX' }),
        }),
      });
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
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

    // Medium fix "race điều kiện chuỗi duyệt/từ chối PI item" - 2 request gần như đồng thời đều
    // pass check in-memory (assertNoApprovalOrRejected) rồi cùng update, ghi đè lẫn nhau trong
    // audit trail. updateMany+count guard chặn: count=0 nghĩa là 1 yêu cầu khác đã đổi status
    // của dòng này TRƯỚC khi request này kịp ghi.
    it('rejects with ConflictException when another request already moved the item away from NULL/REJECTED (race guard)', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(piItem());
      prisma.productionInvoiceItem.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.sendItemToQlsx('7', '20', 'user-khsx')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });
  });

  // Gửi cả phiếu 1 lần (2026-08-18) - bù chỗ lệch: Sếp đã có approveBatch/rejectBatch từ trước,
  // KHSX/QLSX thì vẫn phải mở hộp thoại chọn lại từng SKU dù PI gộp có nhiều SKU.
  describe('sendBatchToQlsx', () => {
    it('gửi MỌI SKU đủ điều kiện trong 1 lần (chưa gửi + bị QLSX trả lại), bỏ qua SKU đã gửi rồi', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({
          items: [
            piItem({ id: 20n, prodApprovalStatus: null }), // chưa gửi -> gửi
            piItem({ id: 21n, prodApprovalStatus: 'REJECTED' }), // bị trả lại -> gửi lại
            piItem({ id: 22n, prodApprovalStatus: 'WAITING_BOSS' }), // đã đi tiếp -> BỎ QUA
          ],
        }),
      );
      prisma.productionInvoiceItem.updateMany.mockResolvedValue({ count: 2 });

      await service.sendBatchToQlsx('7', 'user-khsx');

      // Chỉ 2 SKU đủ điều kiện được đụng tới - SKU đang WAITING_BOSS không bị kéo ngược trạng thái.
      expect(prisma.productionInvoiceItem.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [20n, 21n] } },
        data: expect.objectContaining({
          prodApprovalStatus: 'WAITING_QLSX',
          requestedById: 'user-khsx',
          rejectReason: null,
        }) as unknown,
      });
      // Audit ghi cho ĐÚNG 2 SKU vừa đổi, không phải cả 3.
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(2);
    });

    it('ném ConflictException khi không còn SKU nào gửi được (không im lặng làm gì cả)', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({ items: [piItem({ prodApprovalStatus: 'WAITING_BOSS' })] }),
      );

      await expect(service.sendBatchToQlsx('7', 'user-khsx')).rejects.toThrow(ConflictException);
      expect(prisma.productionInvoiceItem.updateMany).not.toHaveBeenCalled();
    });

    it('itemIds THU HẸP tập gửi (người dùng bỏ tick vài SKU) nhưng KHÔNG nới điều kiện trạng thái', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({
          items: [
            piItem({ id: 20n, prodApprovalStatus: null }),
            piItem({ id: 21n, prodApprovalStatus: null }), // bị bỏ tick
            piItem({ id: 22n, prodApprovalStatus: 'WAITING_BOSS' }), // có tick nhưng KHÔNG đủ điều kiện
          ],
        }),
      );
      prisma.productionInvoiceItem.updateMany.mockResolvedValue({ count: 1 });

      await service.sendBatchToQlsx('7', 'user-khsx', ['20', '22']);

      // Chỉ 20n: 21n bị bỏ tick, 22n có tick nhưng đã WAITING_BOSS nên vẫn bị loại.
      expect(prisma.productionInvoiceItem.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [20n] } },
        data: expect.objectContaining({ prodApprovalStatus: 'WAITING_QLSX' }) as unknown,
      });
    });

    // KHÁC approveBatch có chủ đích: gửi đi xử lý không có ràng buộc "cắt chung cây sắt" nên PI
    // thường nhiều SKU cũng phải gộp gửi được (xem comment tại service).
    it('CHẠY ĐƯỢC trên PI thường (không phải đợt gộp) - khác approveBatch', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({ isMerged: false, items: [piItem({ id: 20n, prodApprovalStatus: null })] }),
      );
      prisma.productionInvoiceItem.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.sendBatchToQlsx('7', 'user-khsx')).resolves.toBeDefined();
    });
  });

  describe('sendBatchToBoss', () => {
    it('gửi mọi SKU đang chờ QLSX lên Sếp với CHUNG 1 kho thành phẩm', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({
          items: [
            piItem({ id: 20n, prodApprovalStatus: 'WAITING_QLSX' }),
            piItem({ id: 21n, prodApprovalStatus: 'WAITING_QLSX' }),
            piItem({ id: 22n, prodApprovalStatus: null }), // chưa tới lượt -> BỎ QUA
          ],
        }),
      );
      prisma.productionInvoiceItem.updateMany.mockResolvedValue({ count: 2 });

      await service.sendBatchToBoss('7', 'thanh-pham', 'Kho thành phẩm', '3', 'user-qlsx');

      expect(prisma.productionInvoiceItem.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [20n, 21n] } },
        data: expect.objectContaining({
          prodApprovalStatus: 'WAITING_BOSS',
          warehouseCode: 'thanh-pham',
          warehouseName: 'Kho thành phẩm',
          workshopId: 3n,
          qlsxById: 'user-qlsx',
        }) as unknown,
      });
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(2);
    });

    it('ném ConflictException khi không SKU nào đang chờ QLSX', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({ items: [piItem({ prodApprovalStatus: 'WAITING_BOSS' })] }),
      );

      await expect(
        service.sendBatchToBoss('7', 'thanh-pham', 'Kho thành phẩm', '3', 'user-qlsx'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.productionInvoiceItem.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('sendItemToBoss', () => {
    it('rejects when the item is not WAITING_QLSX', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: null }),
      );

      await expect(
        service.sendItemToBoss('7', '20', 'thanh-pham-2', 'Kho Thành phẩm 2', '3', 'user-qlsx'),
      ).rejects.toThrow(ConflictException);
    });

    it('records the chosen warehouse scope/name and moves to WAITING_BOSS', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      // Lần 1 = đọc trước khi ghi, lần 2 = đọc lại sau khi ghi (khối workshop phải là xưởng MỚI).
      prisma.productionInvoiceItem.findUnique
        .mockResolvedValueOnce(piItem({ prodApprovalStatus: 'WAITING_QLSX' }))
        .mockResolvedValueOnce(
          piItem({
            prodApprovalStatus: 'WAITING_BOSS',
            warehouseCode: 'thanh-pham-2',
            warehouseName: 'Kho Thành phẩm 2',
            workshopId: 3n,
            workshop: workshopPA,
          }),
        );

      const result = await service.sendItemToBoss(
        '7',
        '20',
        'thanh-pham-2',
        'Kho Thành phẩm 2',
        '3',
        'user-qlsx',
      );
      expect(result.prodApprovalStatus).toBe('WAITING_BOSS');
      expect(result.warehouseCode).toBe('thanh-pham-2');
      expect(result.workshop).toEqual({ id: '3', code: 'PA', name: 'Phú An' });
      expect(prisma.productionInvoiceItem.updateMany).toHaveBeenCalledWith({
        where: { id: 20n, prodApprovalStatus: 'WAITING_QLSX' },
        data: expect.objectContaining({ workshopId: 3n }) as unknown,
      });
      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest matcher typing */
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          newValue: expect.objectContaining({ workshopId: '3' }),
        }),
      });
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it('rejects with ConflictException when another request already moved the item away from WAITING_QLSX (race guard)', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_QLSX' }),
      );
      prisma.productionInvoiceItem.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.sendItemToBoss('7', '20', 'thanh-pham-2', 'Kho Thành phẩm 2', '3', 'user-qlsx'),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── Phần A – Đợt 3 (YC10): tự lưu ngày đề xuất lúc gửi QLSX + báo KHSX khi xưởng đổi số ngày ───
  describe('tự lưu ngày đề xuất khi KHSX gửi QLSX (Phần A – Đợt 3, Q2)', () => {
    const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
    const mfg240 = { ...mfgProduct, loadCont: 80 };
    // 240 bộ, load 80 = 3 cont; 1,3 cont/ngày -> X = Xđg = 3. FRAME đã lưu 13/11 -> N = 13/11 - (3+1) = 09/11.
    const item240 = (o: Record<string, unknown> = {}) =>
      piItem({
        quantity: 240,
        mfgProduct: mfg240,
        stages: [{ stageType: 'FRAME', deadline: day('2026-11-13') }],
        ...o,
      });
    const upserts = () =>
      (
        prisma.productionInvoiceItemStage.upsert.mock.calls as [
          {
            where: { productionInvoiceItemId_stageType: { productionInvoiceItemId: bigint } };
            create: { productionInvoiceItemId: bigint; stageType: string; deadline: Date };
            update: object;
          },
        ][]
      ).map((c) => c[0]);
    const createdStages = (itemId?: bigint) =>
      Object.fromEntries(
        upserts()
          .filter((u) => itemId === undefined || u.create.productionInvoiceItemId === itemId)
          .map((u) => [u.create.stageType, u.create.deadline.toISOString().slice(0, 10)]),
      );

    beforeEach(() => {
      prisma.systemConfig.findUniqueOrThrow.mockResolvedValue({
        solverMergeWindowDays: 3,
        solverMergeMaxSkus: 5,
        lsxPrefixes: [],
        capacityContPerDay: { toNumber: () => 1.3 },
        daysPerContPhuocAn: 4,
      });
    });

    it('ghi MỌI mốc còn trống đúng công thức, KHÔNG ghi đè mốc đã có (FRAME), KHÔNG đụng deliveryDeadline', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(item240());

      await service.sendItemToQlsx('7', '20', 'user-khsx');

      expect(prisma.productionInvoiceItem.update).toHaveBeenCalledTimes(1);
      expect(prisma.productionInvoiceItem.update).toHaveBeenCalledWith({
        where: { id: 20n },
        data: {
          materialDeadline: day('2026-11-08'),
          finishedMaterialDeadline: day('2026-11-16'),
        },
      });
      expect(createdStages()).toEqual({
        PHOI_START: '2026-11-09',
        FRAME_PHOI: '2026-11-11',
        FRAME_HAN: '2026-11-12',
        FRAME_SON: '2026-11-13',
        // FRAME đã có (13/11) -> không ghi lại
        WEAVING: '2026-11-21',
        TRANSFER_CHECK: '2026-11-22',
        PACKAGING_START: '2026-11-23',
        PACKAGING: '2026-11-25',
      });
      // upsert luôn update: {} -> không bao giờ ghi đè mốc vừa có người đặt giữa chừng
      expect(upserts().every((u) => Object.keys(u.update).length === 0)).toBe(true);
      const updateData = (
        prisma.productionInvoiceItem.update.mock.calls as [{ data: Record<string, unknown> }][]
      )[0][0].data;
      expect(updateData).not.toHaveProperty('deliveryDeadline');
      // Audit riêng cho lần tự lưu, kèm nguồn; KHÔNG báo ai.
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tableName: 'ProductionInvoiceItem',
          recordId: '20',
          oldValue: expect.objectContaining({ materialDeadline: null }) as unknown,
          newValue: expect.objectContaining({
            source: 'AUTO_FILL_ON_SEND_QLSX',
            materialDeadline: '2026-11-08T00:00:00.000Z',
            'stage.PHOI_START': '2026-11-09T00:00:00.000Z',
          }) as unknown,
        }) as unknown,
      });
      expect(notificationsService.emit).not.toHaveBeenCalledWith(
        'PI_ITEM_DEADLINE_CHANGED',
        expect.anything(),
      );
    });

    it('mốc đã có thì GIỮ NGUYÊN: chỉ ghi các mốc còn trống, N lấy từ PHOI_START đã lưu', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        item240({
          materialDeadline: day('2026-11-01'),
          stages: [
            { stageType: 'PHOI_START', deadline: day('2026-11-10') },
            { stageType: 'WEAVING', deadline: day('2026-11-30') },
          ],
        }),
      );

      await service.sendItemToQlsx('7', '20', 'user-khsx');

      // N = 10/11: M3 = (N+14) - 7 = 17/11; M1 đã có nên KHÔNG có trong data.
      expect(prisma.productionInvoiceItem.update).toHaveBeenCalledWith({
        where: { id: 20n },
        data: { finishedMaterialDeadline: day('2026-11-17') },
      });
      const created = createdStages();
      expect(created).not.toHaveProperty('PHOI_START');
      expect(created).not.toHaveProperty('WEAVING');
      expect(created.FRAME_PHOI).toBe('2026-11-12');
      expect(created.FRAME).toBe('2026-11-14');
      expect(created.TRANSFER_CHECK).toBe('2026-11-23');
    });

    it('dòng chưa có load cont: X = 1 (Phôi = Hàn = Sơn mỗi công đoạn 1 ngày)', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        item240({ mfgProduct: { ...mfgProduct, loadCont: null } }),
      );

      await service.sendItemToQlsx('7', '20', 'user-khsx');

      // FRAME 13/11, X = 1 -> N = 11/11; Phôi xong 11/11, Hàn 12/11, Sơn 13/11.
      expect(createdStages()).toMatchObject({
        PHOI_START: '2026-11-11',
        FRAME_PHOI: '2026-11-11',
        FRAME_HAN: '2026-11-12',
        FRAME_SON: '2026-11-13',
      });
    });

    it('không mốc nào để tính N (chưa mốc nào, chưa hạn giao) -> không ghi gì', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(item240({ stages: [] }));

      await service.sendItemToQlsx('7', '20', 'user-khsx');

      expect(prisma.productionInvoiceItem.update).not.toHaveBeenCalled();
      expect(prisma.productionInvoiceItemStage.upsert).not.toHaveBeenCalled();
    });

    it('chỉ có hạn giao của lệnh -> N = hạn giao - (Xđg + 16) = 10/12 - 19 = 21/11', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi({ deadline: day('2026-12-10') }));
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(item240({ stages: [] }));

      await service.sendItemToQlsx('7', '20', 'user-khsx');

      expect(createdStages().PHOI_START).toBe('2026-11-21');
    });

    it('xưởng của dòng là Phước An (DAYS_PER_CONT, 4 ngày/cont): X = 12, N = 13/11 - 13 = 31/10', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        item240({
          workshopId: 5n,
          workshop: {
            id: 5n,
            code: 'PHUOC_AN',
            name: 'Xưởng Phước An',
            capacityMode: 'DAYS_PER_CONT',
          },
        }),
      );

      await service.sendItemToQlsx('7', '20', 'user-khsx');

      expect(createdStages()).toMatchObject({
        PHOI_START: '2026-10-31',
        FRAME_PHOI: '2026-11-11',
      });
    });

    it('PI gộp vi phạm luật gộp -> 400 kèm gợi ý "Sửa thời hạn", không đổi trạng thái, không audit chuyển trạng thái', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi({ isMerged: true }));
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(item240());
      prisma.productionInvoiceItem.findMany.mockResolvedValue([
        piItem({ id: 20n, materialDeadline: day('2026-11-08') }),
        piItem({ id: 21n, materialDeadline: day('2026-11-20') }),
      ]);

      await expect(service.sendItemToQlsx('7', '20', 'user-khsx')).rejects.toThrow(
        /lệnh gộp cách nhau 12 ngày.*mở "Sửa thời hạn" đặt mốc Mua VT khung & đan/,
      );
      expect(prisma.productionInvoiceItem.updateMany).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('gửi cả phiếu: tự lưu cho từng SKU trống mốc trong 1 giao dịch, rồi mới đổi trạng thái', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({
          items: [
            item240({ id: 20n }),
            item240({ id: 21n }),
            item240({ id: 22n, prodApprovalStatus: 'WAITING_BOSS' }),
          ],
        }),
      );
      prisma.productionInvoiceItem.updateMany.mockResolvedValue({ count: 2 });

      await service.sendBatchToQlsx('7', 'user-khsx');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // 2 SKU gửi được (22 đã WAITING_BOSS -> bỏ qua): mỗi SKU 1 lần update cột + 8 mốc stage
      expect(prisma.productionInvoiceItem.update).toHaveBeenCalledTimes(2);
      expect(Object.keys(createdStages(20n))).toHaveLength(8);
      expect(Object.keys(createdStages(21n))).toHaveLength(8);
      expect(createdStages(22n)).toEqual({});
      expect(prisma.productionInvoiceItem.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [20n, 21n] } },
        data: expect.objectContaining({ prodApprovalStatus: 'WAITING_QLSX' }) as unknown,
      });
    });
  });

  describe('báo KHSX khi QLSX chọn xưởng làm số ngày khác (Phần A – Đợt 3, V4-5)', () => {
    const phuAn = {
      id: 3n,
      code: 'PHU_AN',
      name: 'Xưởng Phú An',
      isActive: true,
      capacityMode: 'CONT_PER_DAY',
    };
    const phuocAn = {
      id: 5n,
      code: 'PHUOC_AN',
      name: 'Xưởng Phước An',
      isActive: true,
      capacityMode: 'DAYS_PER_CONT',
    };
    const mfg240 = { ...mfgProduct, loadCont: 80 };
    const replanEmits = () =>
      (notificationsService.emit.mock.calls as unknown[][]).filter(
        (c) => c[0] === 'PI_TIMELINE_NEEDS_REPLAN',
      );
    /** findUnique theo code PHU_AN = xưởng dự kiến; theo id = xưởng QLSX chọn. */
    const pickWorkshop = (chosen: typeof phuAn) =>
      prisma.workshop.findUnique.mockImplementation(({ where }: { where: { code?: string } }) =>
        Promise.resolve(where.code === 'PHU_AN' ? phuAn : chosen),
      );
    const waitingQlsx = (o: Record<string, unknown> = {}) =>
      piItem({ prodApprovalStatus: 'WAITING_QLSX', quantity: 240, mfgProduct: mfg240, ...o });

    beforeEach(() => {
      prisma.systemConfig.findUniqueOrThrow.mockResolvedValue({
        solverMergeWindowDays: 3,
        solverMergeMaxSkus: 5,
        lsxPrefixes: [],
        capacityContPerDay: { toNumber: () => 1.3 },
        daysPerContPhuocAn: 4,
      });
    });

    it('sendItemToBoss chọn Phước An cho dòng 240 bộ load 80 chưa có xưởng -> emit (Phú An 3 ngày vs Phước An 12 ngày)', async () => {
      const item = waitingQlsx();
      prisma.productionInvoice.findUnique.mockResolvedValue(pi({ items: [item] }));
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(item);
      pickWorkshop(phuocAn);

      await service.sendItemToBoss('7', '20', 'thanh-pham', 'Kho thành phẩm', '5', 'user-qlsx');

      expect(replanEmits()).toEqual([
        [
          'PI_TIMELINE_NEEDS_REPLAN',
          {
            entityId: '7',
            actorId: 'user-qlsx',
            params: {
              piCode: 'PI-7',
              displayCode: 'MY-313',
              workshopName: 'Xưởng Phước An',
              lines: [
                'SKU-01: Phôi/Hàn/Sơn cần 12 ngày mỗi công đoạn ở Xưởng Phước An (mốc đang đặt theo Xưởng Phú An: 3 ngày)',
              ],
            },
          },
        ],
      ]);
    });

    it('chọn Phú An (xưởng đã dùng để đề xuất) -> KHÔNG emit', async () => {
      const item = waitingQlsx();
      prisma.productionInvoice.findUnique.mockResolvedValue(pi({ items: [item] }));
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(item);
      pickWorkshop(phuAn);

      await service.sendItemToBoss('7', '20', 'thanh-pham', 'Kho thành phẩm', '3', 'user-qlsx');

      expect(replanEmits()).toHaveLength(0);
    });

    it('dòng chưa có load cont: X luôn 1 -> chọn Phước An cũng KHÔNG emit', async () => {
      const item = waitingQlsx({ mfgProduct: { ...mfgProduct, loadCont: null } });
      prisma.productionInvoice.findUnique.mockResolvedValue(pi({ items: [item] }));
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(item);
      pickWorkshop(phuocAn);

      await service.sendItemToBoss('7', '20', 'thanh-pham', 'Kho thành phẩm', '5', 'user-qlsx');

      expect(replanEmits()).toHaveLength(0);
    });

    it('sendBatchToBoss: gom các dòng lệch của PI thành 1 thông báo, bỏ dòng không lệch', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({
          items: [
            waitingQlsx({ id: 20n, lsxCode: 'MY-313' }),
            waitingQlsx({
              id: 21n,
              lsxCode: 'MY-314',
              mfgProduct: { ...mfgProduct, factoryCode: 'J55', loadCont: 240 },
            }), // 1 cont -> 1 ngày vs 4 ngày
            waitingQlsx({
              id: 22n,
              lsxCode: 'MY-315',
              mfgProduct: { ...mfgProduct, loadCont: null },
            }), // không lệch
          ],
        }),
      );
      prisma.productionInvoiceItem.updateMany.mockResolvedValue({ count: 3 });
      pickWorkshop(phuocAn);

      await service.sendBatchToBoss('7', 'thanh-pham', 'Kho thành phẩm', '5', 'user-qlsx');

      expect(replanEmits()).toHaveLength(1);
      const [, payload] = replanEmits()[0] as [string, { params: { lines: string[] } }];
      expect(payload.params.lines).toEqual([
        'SKU-01: Phôi/Hàn/Sơn cần 12 ngày mỗi công đoạn ở Xưởng Phước An (mốc đang đặt theo Xưởng Phú An: 3 ngày)',
        'J55: Phôi/Hàn/Sơn cần 4 ngày mỗi công đoạn ở Xưởng Phước An (mốc đang đặt theo Xưởng Phú An: 1 ngày)',
      ]);
    });

    it('emit lỗi không chặn việc gửi Sếp (best-effort)', async () => {
      const item = waitingQlsx();
      prisma.productionInvoice.findUnique.mockResolvedValue(pi({ items: [item] }));
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(item);
      pickWorkshop(phuocAn);
      notificationsService.emit.mockImplementation((type: string) =>
        type === 'PI_TIMELINE_NEEDS_REPLAN'
          ? Promise.reject(new Error('boom'))
          : Promise.resolve(undefined),
      );

      await expect(
        service.sendItemToBoss('7', '20', 'thanh-pham', 'Kho thành phẩm', '5', 'user-qlsx'),
      ).resolves.toBeDefined();
    });

    it('changeWorkshop Phú An -> Phước An -> emit; Phước An -> Phú An (Phôi/Hàn/Sơn 12 -> 3 ngày) -> cũng emit', async () => {
      const sent = (workshop: typeof phuAn) =>
        pi({
          items: [
            piItem({
              id: 20n,
              prodApprovalStatus: 'WAITING_BOSS',
              quantity: 240,
              mfgProduct: mfg240,
              workshopId: workshop.id,
              workshop,
            }),
          ],
        });
      prisma.productionInvoiceItem.updateMany.mockResolvedValue({ count: 1 });

      prisma.productionInvoice.findUnique.mockResolvedValue(sent(phuAn));
      prisma.workshop.findUnique.mockResolvedValue(phuocAn);
      await service.changeWorkshop('7', '5', 'Phú An quá tải', 'user-qlsx');
      expect(replanEmits()).toHaveLength(1);
      expect(replanEmits()[0][1]).toMatchObject({
        entityId: '7',
        actorId: 'user-qlsx',
        params: {
          workshopName: 'Xưởng Phước An',
          lines: [
            'SKU-01: Phôi/Hàn/Sơn cần 12 ngày mỗi công đoạn ở Xưởng Phước An (mốc đang đặt theo Xưởng Phú An: 3 ngày)',
          ],
        },
      });

      notificationsService.emit.mockClear();
      prisma.productionInvoice.findUnique.mockResolvedValue(sent(phuocAn));
      prisma.workshop.findUnique.mockResolvedValue(phuAn);
      await service.changeWorkshop('7', '3', 'Đổi lại', 'user-qlsx');
      expect(replanEmits()).toHaveLength(1);
    });

    it('changeWorkshop giữa 2 xưởng cùng chế độ -> KHÔNG emit', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({
          items: [
            piItem({
              id: 20n,
              prodApprovalStatus: 'WAITING_BOSS',
              quantity: 240,
              mfgProduct: mfg240,
              workshopId: phuAn.id,
              workshop: phuAn,
            }),
          ],
        }),
      );
      prisma.productionInvoiceItem.updateMany.mockResolvedValue({ count: 1 });
      prisma.workshop.findUnique.mockResolvedValue({
        ...phuAn,
        id: 9n,
        code: 'MY',
        name: 'Mỹ Yến',
      });

      await service.changeWorkshop('7', '9', 'lý do', 'user-qlsx');

      expect(replanEmits()).toHaveLength(0);
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

      const result = await updateItemAs('7', '20', {
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

      await updateItemAs('7', '20', {
        stages: [{ stageType: ProdItemStageType.PACKAGING, deadline: '2026-08-17' }],
      });

      expect(prisma.productionInvoiceItem.update).not.toHaveBeenCalled();
      expect(prisma.productionInvoiceItemStage.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateItem - audit + thông báo đổi thời hạn (P2, changelog 31.3)', () => {
    const emitted = () =>
      (notificationsService.emit.mock.calls as unknown[][]).filter(
        (c) => c[0] === 'PI_ITEM_DEADLINE_CHANGED',
      ) as unknown as [
        string,
        { params: { roles: string[]; warehouseIds: string[]; changes: string[] } },
      ][];

    it('đổi mốc Hàn + Đan + giao hàng → audit 1 dòng và báo HAN, thủ kho Đan, Sales', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValueOnce(piItem()).mockResolvedValueOnce(
        piItem({
          deliveryDeadline: new Date('2026-08-20'),
          stages: [
            { stageType: 'FRAME_HAN', deadline: new Date('2026-08-10') },
            { stageType: 'WEAVING', deadline: new Date('2026-08-15') },
          ],
        }),
      );

      await updateItemAs('7', '20', {
        deliveryDeadline: '2026-08-20',
        stages: [
          { stageType: ProdItemStageType.FRAME_HAN, deadline: '2026-08-10' },
          { stageType: ProdItemStageType.WEAVING, deadline: '2026-08-15' },
        ],
      });

      const calls = emitted();
      expect(calls).toHaveLength(1);
      // Phần A – Đợt 3 (V4-20): mọi lần đổi mốc báo thêm QLSX.
      expect(calls[0][1].params.roles.sort()).toEqual(
        ['HAN_STAFF', 'SALES_STAFF', 'PRODUCTION_MANAGER'].sort(),
      );
      expect(calls[0][1].params.warehouseIds).toEqual(['phoi-son-han', 'vat-tu-tp']);
      expect(calls[0][1].params.changes).toHaveLength(3);
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('Mua VT khung & đan + Mua VT còn lại (2026-10-27) → lưu cả hai, báo Mua hàng + kho VTTP/thành phẩm', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValueOnce(piItem()).mockResolvedValueOnce(
        piItem({
          materialDeadline: new Date('2026-09-23'),
          finishedMaterialDeadline: new Date('2026-10-01'),
        }),
      );

      const result = await updateItemAs('7', '20', {
        materialDeadline: '2026-09-23',
        finishedMaterialDeadline: '2026-10-01',
      });

      expect(prisma.productionInvoiceItem.update).toHaveBeenCalledWith({
        where: { id: 20n },
        data: {
          materialDeadline: new Date('2026-09-23'),
          finishedMaterialDeadline: new Date('2026-10-01'),
          deliveryDeadline: undefined,
        },
      });
      expect(result.finishedMaterialDeadline).toEqual(new Date('2026-10-01'));
      const calls = emitted();
      expect(calls).toHaveLength(1);
      expect(calls[0][1].params.roles).toEqual(['PURCHASER', 'PRODUCTION_MANAGER']);
      expect(calls[0][1].params.warehouseIds).toEqual(['vat-tu-tp', 'thanh-pham']);
      expect(calls[0][1].params.changes).toEqual([
        expect.stringMatching(/^Mua VT khung & đan: \(chưa có\) → /),
        expect.stringMatching(/^Mua VT còn lại: \(chưa có\) → /),
      ]);
    });

    it('chỉ gửi Mua VT còn lại → không đụng mốc khác', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(piItem());

      await updateItemAs('7', '20', { finishedMaterialDeadline: '2026-10-01' });

      const call = prisma.productionInvoiceItem.update.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      expect(call[0].data.finishedMaterialDeadline).toEqual(new Date('2026-10-01'));
      expect(call[0].data.materialDeadline).toBeUndefined();
      expect(call[0].data.deliveryDeadline).toBeUndefined();
      expect(prisma.productionInvoiceItemStage.upsert).not.toHaveBeenCalled();
    });

    // Phần A – Đợt 3 (YC10): nhãn mới + người nhận mới
    it('nhãn mới: WEAVING = "Nhập đan", TRANSFER_CHECK = "Chuyền kiểm", PHOI_START = "Bắt đầu Phôi"; báo Phôi + QLSX', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValueOnce(piItem()).mockResolvedValueOnce(
        piItem({
          stages: [
            { stageType: 'PHOI_START', deadline: new Date('2026-11-09') },
            { stageType: 'WEAVING', deadline: new Date('2026-11-21') },
            { stageType: 'TRANSFER_CHECK', deadline: new Date('2026-11-22') },
            { stageType: 'PACKAGING_START', deadline: new Date('2026-11-23') },
          ],
        }),
      );

      await updateItemAs('7', '20', {
        stages: [
          { stageType: ProdItemStageType.PHOI_START, deadline: '2026-11-09' },
          { stageType: ProdItemStageType.WEAVING, deadline: '2026-11-21' },
          { stageType: ProdItemStageType.TRANSFER_CHECK, deadline: '2026-11-22' },
          { stageType: ProdItemStageType.PACKAGING_START, deadline: '2026-11-23' },
        ],
      });

      const [call] = emitted();
      expect(call[1].params.changes).toEqual([
        expect.stringMatching(/^Bắt đầu Phôi: \(chưa có\) → /),
        expect.stringMatching(/^Nhập đan: \(chưa có\) → /),
        expect.stringMatching(/^Chuyền kiểm: \(chưa có\) → /),
        expect.stringMatching(/^Bắt đầu đóng gói: \(chưa có\) → /),
      ]);
      expect(call[1].params.roles.sort()).toEqual(['PHOI_STAFF', 'PRODUCTION_MANAGER']);
      expect(call[1].params.warehouseIds.sort()).toEqual(
        ['phoi-son-han', 'thanh-pham', 'vat-tu-tp'].sort(),
      );
    });

    it('lưu lại y nguyên giá trị cũ → không audit, không báo', async () => {
      const same = piItem({
        stages: [{ stageType: 'FRAME_HAN', deadline: new Date('2026-08-10') }],
      });
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(same);

      await updateItemAs('7', '20', {
        stages: [{ stageType: ProdItemStageType.FRAME_HAN, deadline: '2026-08-10' }],
      });

      expect(emitted()).toHaveLength(0);
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });
  });

  // 2026-09-11 lần 2: đồng bộ lại - FRAME_PHOI/FRAME_HAN/FRAME_SON quay về CHỈ 1 mốc `deadline`
  // như WEAVING/TRANSFER_CHECK/PACKAGING, bỏ hẳn "khoảng thời gian"/ràng buộc "nằm trong khung
  // cha" (assertFrameSubStagesWithinRange() đã xoá - xem doc comment schema.prisma). Test cũ cho
  // hàm đó đã xoá, thay bằng test xác nhận 3 mốc con giờ lưu/đọc như mọi stageType khác.
  describe('updateItem - FRAME_PHOI/FRAME_HAN/FRAME_SON (2026-09-11 lần 2, chỉ còn 1 deadline)', () => {
    beforeEach(() => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(piItem());
    });

    it('lưu được 3 mốc con Phôi/Hàn/Sơn CHỒNG LẤN nhau, không cần Khung cơ khí (FRAME) đặt trước', async () => {
      await updateItemAs('7', '20', {
        stages: [
          { stageType: ProdItemStageType.FRAME_PHOI, deadline: '2026-06-20' },
          { stageType: ProdItemStageType.FRAME_HAN, deadline: '2026-06-10' },
          { stageType: ProdItemStageType.FRAME_SON, deadline: '2026-06-15' },
        ],
      });

      expect(prisma.productionInvoiceItemStage.upsert).toHaveBeenCalledTimes(3);
      const calls = prisma.productionInvoiceItemStage.upsert.mock.calls as {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }[][];
      expect(calls[0][0].update).toEqual({ deadline: new Date('2026-06-20') });
      expect(calls[0][0].create.startDate).toBeUndefined();
    });
  });

  describe('approveItem', () => {
    it('flips PI to PRODUCING when this was the last item', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_BOSS' }),
      );
      prisma.productionInvoiceItem.update.mockResolvedValue(
        piItem({ prodApprovalStatus: 'APPROVED' }),
      );
      prisma.productionInvoiceItem.count.mockResolvedValue(0); // no remaining un-approved items

      await service.approveItem('7', '20', 'user-boss');

      expect(productionOrdersService.createFromApproval).toHaveBeenCalledWith(
        20n,
        2n,
        10,
        undefined, // luồng cũ: không ghim revision (lấy ACTIVE)
      );
      expect(cuttingProposalsService.requestForOrder).toHaveBeenCalledWith(99n, {
        requestedById: 'user-boss',
        onComplete: expect.any(Function) as () => void,
      });
      expect(prisma.productionInvoice.update).toHaveBeenCalledWith({
        where: { id: 7n },
        data: { status: 'PRODUCING' },
      });
      // Cùng idiom trigger cắt sắt - tính lại nhu cầu mua "vật tư thành phẩm" cho CẢ PI mỗi khi
      // có SKU được duyệt, không có nút bấm riêng (xem changelog 2026-08-22 mục 15).
      expect(pieceMaterialYieldPurchaseService.computeAndUpsertProposals).toHaveBeenCalledWith('7');
      // Cùng idiom - vật tư tiêu hao phẳng (Dây/Đinh/Sơn/Phụ kiện/Bao bì), thay thế "Lệnh kiểm
      // tra vật tư" thủ công chưa từng được cài đặt (mục 15b).
      expect(consumableMaterialPurchaseService.computeAndUpsertProposals).toHaveBeenCalledWith('7');
    });

    it('best-effort: vẫn duyệt SKU thành công dù trigger tính nhu cầu mua vật tư thành phẩm lỗi', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_BOSS' }),
      );
      prisma.productionInvoiceItem.update.mockResolvedValue(
        piItem({ prodApprovalStatus: 'APPROVED' }),
      );
      prisma.productionInvoiceItem.count.mockResolvedValue(2);
      pieceMaterialYieldPurchaseService.computeAndUpsertProposals.mockRejectedValue(
        new Error('material chưa có Kho'),
      );

      const result = await service.approveItem('7', '20', 'user-boss');

      expect(result.prodApprovalStatus).toBe('APPROVED');
      // Không bị lẫn với trigger cắt sắt - lỗi ở nhánh này không chặn nhánh kia.
      expect(cuttingProposalsService.requestForOrder).toHaveBeenCalled();
    });

    it('best-effort: vẫn duyệt SKU thành công dù trigger tính nhu cầu mua vật tư tiêu hao phẳng lỗi', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_BOSS' }),
      );
      prisma.productionInvoiceItem.update.mockResolvedValue(
        piItem({ prodApprovalStatus: 'APPROVED' }),
      );
      prisma.productionInvoiceItem.count.mockResolvedValue(2);
      consumableMaterialPurchaseService.computeAndUpsertProposals.mockRejectedValue(
        new Error('material chưa có Kho'),
      );

      const result = await service.approveItem('7', '20', 'user-boss');

      expect(result.prodApprovalStatus).toBe('APPROVED');
      expect(cuttingProposalsService.requestForOrder).toHaveBeenCalled();
      expect(pieceMaterialYieldPurchaseService.computeAndUpsertProposals).toHaveBeenCalled();
    });

    // L2 (2026-08-26): bất biến "mỗi SKU chỉ được phủ bởi ĐÚNG 1 phương án cắt". PI gộp phải duyệt
    // CẢ CỤM (approveBatch -> requestForInvoice, 1 phương án phủ mọi SKU). Duyệt lẻ 1 SKU của PI
    // gộp sinh thêm phương án neo PO cho riêng SKU đó -> cùng nhu cầu bị lập kế hoạch 2 lần (giữ
    // chỗ tồn 2 lần + đề xuất mua trùng). Đây là cổng đối xứng với assertMergedPi() vốn chỉ chặn
    // chiều ngược lại (PI thường không được duyệt cả cụm).
    it('CHẶN duyệt lẻ 1 SKU của PI GỘP - không ghi gì, không tạo phương án cắt (L2)', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi({ isMerged: true }));

      await expect(service.approveItem('7', '20', 'user-boss')).rejects.toThrow(ConflictException);
      expect(prisma.productionInvoiceItem.updateMany).not.toHaveBeenCalled();
      expect(productionOrdersService.createFromApproval).not.toHaveBeenCalled();
      expect(cuttingProposalsService.requestForOrder).not.toHaveBeenCalled();
    });

    it('still approves the item even when ProductionOrder creation fails unexpectedly after the BOM check already passed (rare race)', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_BOSS' }),
      );
      prisma.productionInvoiceItem.update.mockResolvedValue(
        piItem({ prodApprovalStatus: 'APPROVED' }),
      );
      prisma.productionInvoiceItem.count.mockResolvedValue(2);
      // assertActiveBomRevisionExists (mock default) vẫn resolve OK - mô phỏng đúng ca race hiếm:
      // BOM còn active lúc kiểm, nhưng createFromApproval tự truy vấn lại thì đã không còn.
      productionOrdersService.createFromApproval.mockRejectedValue(
        new Error('no ACTIVE bom revision'),
      );

      const result = await service.approveItem('7', '20', 'user-boss');

      expect(result.prodApprovalStatus).toBe('APPROVED');
      // productionOrder không tạo được -> không có id để trigger solver.
      expect(cuttingProposalsService.requestForOrder).not.toHaveBeenCalled();
      expect(pieceMaterialYieldPurchaseService.computeAndUpsertProposals).not.toHaveBeenCalled();
      expect(consumableMaterialPurchaseService.computeAndUpsertProposals).not.toHaveBeenCalled();
    });

    it('rejects approving (ghi gì cả) khi sản phẩm chưa có BomRevision ACTIVE - D.p1-bom-check', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_BOSS' }),
      );
      productionOrdersService.assertActiveBomRevisionExists.mockRejectedValue(
        new ConflictException('Sản phẩm 2 chưa có định mức (BOM) đang active'),
      );

      await expect(service.approveItem('7', '20', 'user-boss')).rejects.toThrow(ConflictException);
      expect(productionOrdersService.assertActiveBomRevisionExists).toHaveBeenCalledWith(2n);
      // Chặn TRƯỚC khi ghi - PI item không được flip APPROVED khi chưa có BOM (đây chính là
      // hành vi lỗ hổng cũ: trước fix, item vẫn APPROVED dù ProductionOrder tạo thất bại).
      expect(prisma.productionInvoiceItem.update).not.toHaveBeenCalled();
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

    it('rejects with ConflictException when another request already approved/moved the item away from WAITING_BOSS (race guard) - also prevents a double createFromApproval', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_BOSS' }),
      );
      prisma.productionInvoiceItem.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.approveItem('7', '20', 'user-boss')).rejects.toThrow(ConflictException);
      expect(productionOrdersService.createFromApproval).not.toHaveBeenCalled();
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

    it('rejects with ConflictException when another request already moved the item away from WAITING_BOSS (race guard)', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_BOSS' }),
      );
      prisma.productionInvoiceItem.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.rejectItem('7', '20', 'Thiếu vật tư', 'user-boss')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('rejectBatchByQlsx', () => {
    // 2026-08-28: đổi hành vi để GIỐNG HỆT rejectBatch của Sếp - trả mọi SKU về "chưa gom"
    // (productionInvoiceId=null) rồi xoá cả PI, thay vì chỉ đổi trạng thái và giữ SKU lại trong PI.
    it('trả mọi SKU về "chưa gom" (productionInvoiceId=null) rồi xoá cả PI', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({
          items: [
            piItem({ id: 20n, prodApprovalStatus: 'WAITING_QLSX' }),
            piItem({ id: 21n, prodApprovalStatus: 'WAITING_QLSX' }),
          ],
        }),
      );
      // updateMany lọc kèm WAITING_QLSX cho CẢ 2 item cùng lúc (race-guard) - 2 = itemIds.length.
      prisma.productionInvoiceItem.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.rejectBatchByQlsx('7', 'Không đủ kho', 'user-qlsx');

      expect(prisma.productionInvoiceItem.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [20n, 21n] }, prodApprovalStatus: 'WAITING_QLSX' },
        data: expect.objectContaining({
          productionInvoiceId: null,
          prodApprovalStatus: 'REJECTED',
          rejectReason: 'Không đủ kho',
          decidedById: 'user-qlsx',
        }) as unknown,
      });
      expect(prisma.productionInvoice.delete).toHaveBeenCalledWith({ where: { id: 7n } });
      expect(result.movedItemIds).toEqual(['20', '21']);
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(2);
    });

    // (Đính chính 2026-08-29, audit độc lập 28/08 mục Nghiêm trọng #3) trước đây vòng lặp update()
    // KHÔNG ĐIỀU KIỆN theo id không chặn được 1 yêu cầu khác ghi status khác đúng lúc đang chạy -
    // xoá PI kéo nhầm SKU không còn ở WAITING_QLSX ra theo, không ai kiểm soát được.
    it('CHẶN (409, rollback) nếu 1 item đã bị 1 yêu cầu khác ghi đè status trong lúc QLSX từ chối cả phiếu', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({
          items: [
            piItem({ id: 20n, prodApprovalStatus: 'WAITING_QLSX' }),
            piItem({ id: 21n, prodApprovalStatus: 'WAITING_QLSX' }),
          ],
        }),
      );
      prisma.productionInvoiceItem.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.rejectBatchByQlsx('7', 'Không đủ kho', 'user-qlsx')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.productionInvoice.delete).not.toHaveBeenCalled();
    });

    // Không "xoá cả PI" khi có SKU chưa tới lượt QLSX xử lý (VD còn REJECTED từ lượt trước, KHSX
    // chưa gửi lại) - xoá PI lúc đó sẽ kéo nhầm SKU ở trạng thái khác ra theo không kiểm soát được
    // (chốt nghiệp vụ 2026-08-28, khác Sếp: rejectBatch của Sếp không gặp ca này vì sendBatchToBoss
    // luôn gửi cả cụm cùng lúc).
    it('chặn nếu có SKU chưa tới lượt QLSX xử lý (trạng thái khác WAITING_QLSX)', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({
          items: [
            piItem({ id: 20n, prodApprovalStatus: 'WAITING_QLSX' }),
            piItem({ id: 22n, prodApprovalStatus: 'REJECTED' }),
          ],
        }),
      );

      await expect(service.rejectBatchByQlsx('7', 'lý do', 'user-qlsx')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.productionInvoiceItem.update).not.toHaveBeenCalled();
      expect(prisma.productionInvoice.delete).not.toHaveBeenCalled();
    });

    it('ném ConflictException khi không SKU nào đang chờ QLSX', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({ items: [piItem({ prodApprovalStatus: 'WAITING_BOSS' })] }),
      );

      await expect(service.rejectBatchByQlsx('7', 'lý do', 'user-qlsx')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.productionInvoiceItem.update).not.toHaveBeenCalled();
    });
  });

  // Vá điểm kẹt "SKU đã APPROVED nhưng ProductionOrder tạo thất bại -> kẹt vĩnh viễn" (race hiếm:
  // BOM bị deactivate đúng khoảnh khắc giữa 2 lệnh, xem doc-comment ProductionInvoiceItemResponseDto
  // .productionOrderId - trước đây field này tồn tại nhưng KHÔNG có method nào tạo lại được).
  describe('retryProductionOrder', () => {
    it('tạo lại ProductionOrder cho item đã APPROVED nhưng chưa có lệnh (kẹt)', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'APPROVED' }),
      );
      prisma.productionOrder.findUnique.mockResolvedValue(null);

      const result = await service.retryProductionOrder('7', '20', 'admin-1');

      expect(productionOrdersService.assertActiveBomRevisionExists).toHaveBeenCalledWith(2n);
      expect(productionOrdersService.createFromApproval).toHaveBeenCalledWith(
        20n,
        2n,
        10,
        undefined, // luồng cũ: không ghim revision (lấy ACTIVE)
      );
      expect(cuttingProposalsService.requestForOrder).toHaveBeenCalledWith(99n, {
        requestedById: 'admin-1',
        onComplete: expect.any(Function) as () => void,
      });
      expect(result).toBeDefined();
    });

    it('CHẶN (409) nếu item chưa APPROVED', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_BOSS' }),
      );

      await expect(service.retryProductionOrder('7', '20', 'admin-1')).rejects.toThrow(
        ConflictException,
      );
      expect(productionOrdersService.createFromApproval).not.toHaveBeenCalled();
    });

    it('CHẶN (409) nếu ProductionOrder đã tồn tại - không cần tạo lại', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'APPROVED' }),
      );
      prisma.productionOrder.findUnique.mockResolvedValue({ id: 5n, poNumber: 'PO-5' });

      await expect(service.retryProductionOrder('7', '20', 'admin-1')).rejects.toThrow(
        ConflictException,
      );
      expect(productionOrdersService.createFromApproval).not.toHaveBeenCalled();
    });
  });

  describe('rejectItemByQlsx', () => {
    // 2026-08-28: đổi hành vi để GIỐNG HỆT rejectItem của Sếp - kéo SKU RA KHỎI PI
    // (productionInvoiceId=null), không còn để SKU ở lại PI cũ chờ gửi lại.
    it('kéo SKU ra khỏi PI (productionInvoiceId=null), gửi về "chưa gom"', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_QLSX' }),
      );
      prisma.productionInvoiceItem.count.mockResolvedValue(1); // còn SKU khác -> không xoá PI
      const result = await service.rejectItemByQlsx('7', '20', 'Không đủ kho', 'user-qlsx');

      // updateMany+count guard (Medium fix) thay cho update() đơn - xem sendItemToQlsx.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest.Mock.calls typing
      const updateCall = prisma.productionInvoiceItem.updateMany.mock.calls[0][0] as {
        where: { id: bigint; prodApprovalStatus: string };
        data: {
          productionInvoiceId: null;
          prodApprovalStatus: string;
          rejectReason: string;
          decidedAt: Date;
          decidedById: string;
        };
      };
      expect(updateCall.where).toEqual({ id: 20n, prodApprovalStatus: 'WAITING_QLSX' });
      expect(updateCall.data.productionInvoiceId).toBeNull();
      expect(updateCall.data.prodApprovalStatus).toBe('REJECTED');
      expect(updateCall.data.rejectReason).toBe('Không đủ kho');
      expect(updateCall.data.decidedById).toBe('user-qlsx');
      expect(updateCall.data.decidedAt).toBeInstanceOf(Date);
      expect(result.rejectReason).toBe('Không đủ kho');
      expect(prisma.productionInvoice.delete).not.toHaveBeenCalled();
    });

    // PI cắt riêng luôn chỉ chứa đúng 1 SKU (claimSolo) - kéo SKU đó ra thì PI rỗng, xoá theo
    // (mirror rejectItem của Sếp), không để lại PI mồ côi.
    it('xoá PI khi kéo SKU cuối cùng ra khỏi PI', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_QLSX' }),
      );
      prisma.productionInvoiceItem.count.mockResolvedValue(0);

      await service.rejectItemByQlsx('7', '20', 'Không đủ kho', 'user-qlsx');

      expect(prisma.productionInvoice.delete).toHaveBeenCalledWith({ where: { id: 7n } });
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

    it('rejects with ConflictException when another request already moved the item away from WAITING_QLSX (race guard)', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_QLSX' }),
      );
      prisma.productionInvoiceItem.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.rejectItemByQlsx('7', '20', 'lý do', 'user-qlsx')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // Phase 3a, mục 7.2 changelog 2026-09-25/26 - notification tại từng transition. Best-effort
  // (catch+log, xem notifyPi()/resolvePiNotifications()) nên chỉ kiểm ĐÚNG type/entityId/params
  // được gọi, không kiểm nội dung title/message render (đã ở notification-types.ts nếu cần).
  // ─── Phần A – Đợt 2: số LSX + xưởng cơ khí ──────────────────────────────────────
  describe('updateItemLsx (Phần A – Đợt 2)', () => {
    const khsx = { id: 'user-khsx', roles: ['PRODUCTION_PLANNER'] };
    const admin = { id: 'user-admin', roles: ['ADMIN'] };

    const setup = (itemOverrides: Record<string, unknown> = {}) => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ lsxCode: null, ...itemOverrides }),
      );
    };

    it('chuẩn hoá "my 313" -> "MY-313", ghi audit + realtime và trả dòng đọc lại từ DB', async () => {
      setup();
      prisma.productionInvoiceItem.findUnique
        .mockResolvedValueOnce(piItem({ lsxCode: null }))
        .mockResolvedValueOnce(piItem({ lsxCode: 'MY-313' }));

      const result = await service.updateItemLsx('7', '20', ' my 313 ', khsx);

      expect(prisma.productionInvoiceItem.update).toHaveBeenCalledWith({
        where: { id: 20n },
        data: { lsxCode: 'MY-313' },
      });
      expect(result.lsxCode).toBe('MY-313');
      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest matcher typing */
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tableName: 'ProductionInvoiceItem',
          recordId: '20',
          oldValue: { lsxCode: null },
          newValue: { lsxCode: 'MY-313' },
        }),
      });
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it('chuỗi rỗng/chỉ trắng và null = xoá số', async () => {
      setup({ lsxCode: 'MY-313' });
      await service.updateItemLsx('7', '20', '   ', khsx);
      expect(prisma.productionInvoiceItem.update).toHaveBeenCalledWith({
        where: { id: 20n },
        data: { lsxCode: null },
      });
      await service.updateItemLsx('7', '20', null, khsx);
      expect(prisma.productionInvoiceItem.update).toHaveBeenCalledTimes(2);
    });

    it.each(['abc', 'MY-', '1234', 'TOOLONGPREFIX-1', 'MY-1234567'])(
      'sai dạng "%s" -> 400',
      async (raw) => {
        setup();
        await expect(service.updateItemLsx('7', '20', raw, khsx)).rejects.toThrow(
          /Số LSX phải dạng TIỀN TỐ-SỐ/,
        );
        expect(prisma.productionInvoiceItem.update).not.toHaveBeenCalled();
      },
    );

    it('tiền tố ngoài danh sách Cấu hình hệ thống -> 400 nêu danh sách đang có', async () => {
      setup();
      prisma.systemConfig.findUniqueOrThrow.mockResolvedValue({ lsxPrefixes: ['MY', 'GP'] });
      await expect(service.updateItemLsx('7', '20', 'XX-5', khsx)).rejects.toThrow(
        'Tiền tố XX chưa có trong Cấu hình hệ thống (đang có: MY, GP)',
      );
      await expect(service.updateItemLsx('7', '20', 'gp-176', khsx)).resolves.toBeDefined();
    });

    it('danh sách tiền tố rỗng = chấp nhận mọi tiền tố đúng dạng', async () => {
      setup();
      prisma.systemConfig.findUniqueOrThrow.mockResolvedValue({ lsxPrefixes: [] });
      await expect(service.updateItemLsx('7', '20', 'zz-9', khsx)).resolves.toBeDefined();
      expect(prisma.productionInvoiceItem.update).toHaveBeenCalledWith({
        where: { id: 20n },
        data: { lsxCode: 'ZZ-9' },
      });
    });

    it('trùng số ở dòng của lệnh khác -> 409 nêu mã hiển thị của lệnh đó + SKU', async () => {
      setup();
      prisma.productionInvoiceItem.findFirst.mockResolvedValue({
        id: 30n,
        productionInvoiceId: 9n,
        lsxCode: 'MY-313',
        mfgProduct: { factoryCode: 'GHE-9' },
      });
      prisma.productionInvoice.findMany.mockResolvedValue([{ id: 9n, code: 'PI-9' }]);
      prisma.productionInvoiceItem.findMany.mockResolvedValue([
        { productionInvoiceId: 9n, lsxCode: 'MY-313' },
        { productionInvoiceId: 9n, lsxCode: 'MY-314' },
      ]);

      await expect(service.updateItemLsx('7', '20', 'MY-313', khsx)).rejects.toThrow(
        new ConflictException('Số LSX MY-313 đang dùng ở lệnh MY-313 + MY-314 (SKU GHE-9)'),
      );
      expect(prisma.productionInvoiceItem.update).not.toHaveBeenCalled();
    });

    it('trùng với SKU chưa gom vào lệnh -> câu "SKU chưa gom vào lệnh"', async () => {
      setup();
      prisma.productionInvoiceItem.findFirst.mockResolvedValue({
        id: 30n,
        productionInvoiceId: null,
        mfgProduct: { factoryCode: 'GHE-9' },
      });
      await expect(service.updateItemLsx('7', '20', 'MY-313', khsx)).rejects.toThrow(
        'Số LSX MY-313 đang dùng ở lệnh SKU chưa gom vào lệnh (SKU GHE-9)',
      );
    });

    it('P2002 lúc update (2 người cùng lúc) -> 409 cùng câu', async () => {
      setup();
      prisma.productionInvoiceItem.findFirst
        .mockResolvedValueOnce(null) // kiểm trước: chưa ai giữ
        .mockResolvedValueOnce({
          id: 31n,
          productionInvoiceId: null,
          mfgProduct: { factoryCode: 'GHE-9' },
        }); // sau khi unique index chặn: đã có người giữ
      prisma.productionInvoiceItem.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      const attempt = service.updateItemLsx('7', '20', 'MY-313', khsx);
      await expect(attempt).rejects.toThrow(ConflictException);
      await expect(attempt).rejects.toThrow(/Số LSX MY-313 đang dùng ở lệnh/);
    });

    it('dòng APPROVED đã có số: KHSX đổi/xoá -> 403, không ghi', async () => {
      setup({ prodApprovalStatus: 'APPROVED', lsxCode: 'MY-313' });
      await expect(service.updateItemLsx('7', '20', 'MY-400', khsx)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.updateItemLsx('7', '20', null, khsx)).rejects.toThrow(
        'Lệnh đã được Sếp duyệt - số LSX chỉ được bổ sung khi đang trống; muốn đổi phải nhờ Admin',
      );
      expect(prisma.productionInvoiceItem.update).not.toHaveBeenCalled();
    });

    it('dòng APPROVED đã có số: Admin đổi được', async () => {
      setup({ prodApprovalStatus: 'APPROVED', lsxCode: 'MY-313' });
      await service.updateItemLsx('7', '20', 'MY-400', admin);
      expect(prisma.productionInvoiceItem.update).toHaveBeenCalledWith({
        where: { id: 20n },
        data: { lsxCode: 'MY-400' },
      });
    });

    it('dòng APPROVED đang trống: KHSX điền được', async () => {
      setup({ prodApprovalStatus: 'APPROVED', lsxCode: null });
      await service.updateItemLsx('7', '20', 'MY-400', khsx);
      expect(prisma.productionInvoiceItem.update).toHaveBeenCalledTimes(1);
    });

    it('dòng chưa APPROVED (đang chờ Sếp) có số: KHSX sửa tự do', async () => {
      setup({ prodApprovalStatus: 'WAITING_BOSS', lsxCode: 'MY-313' });
      await service.updateItemLsx('7', '20', 'MY-400', khsx);
      expect(prisma.productionInvoiceItem.update).toHaveBeenCalledTimes(1);
    });

    it('giống giá trị cũ (sau chuẩn hoá) -> trả dòng, KHÔNG ghi, KHÔNG audit', async () => {
      setup({ lsxCode: 'MY-313' });
      const result = await service.updateItemLsx('7', '20', 'my313', khsx);
      expect(result.lsxCode).toBe('MY-313');
      expect(prisma.productionInvoiceItem.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('gửi QLSX bắt buộc số LSX (Phần A – Đợt 2)', () => {
    it('sendItemToQlsx: dòng thiếu LSX -> 400 nêu mã SKU, không ghi', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(piItem({ lsxCode: null }));
      await expect(service.sendItemToQlsx('7', '20', 'user-khsx')).rejects.toThrow(
        new BadRequestException("Chưa nhập số LSX cho SKU SKU-01 - nhập ở ô 'Số LSX' rồi gửi lại"),
      );
      expect(prisma.productionInvoiceItem.updateMany).not.toHaveBeenCalled();
    });

    it('sendBatchToQlsx: liệt kê MỌI SKU thiếu LSX trong tập sẽ gửi, không gửi gì', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({
          items: [
            piItem({ id: 20n, lsxCode: 'MY-1' }),
            piItem({
              id: 21n,
              lsxCode: null,
              mfgProduct: { ...mfgProduct, factoryCode: 'SKU-02' },
            }),
            piItem({
              id: 22n,
              lsxCode: null,
              mfgProduct: { ...mfgProduct, factoryCode: 'SKU-03' },
            }),
          ],
        }),
      );
      await expect(service.sendBatchToQlsx('7', 'user-khsx')).rejects.toThrow(/SKU-02, SKU-03/);
      expect(prisma.productionInvoiceItem.updateMany).not.toHaveBeenCalled();
    });

    it('sendBatchToQlsx: SKU thiếu LSX nhưng bị bỏ tick (ngoài tập gửi) thì không chặn', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({
          items: [piItem({ id: 20n, lsxCode: 'MY-1' }), piItem({ id: 21n, lsxCode: null })],
        }),
      );
      await expect(service.sendBatchToQlsx('7', 'user-khsx', ['20'])).resolves.toBeDefined();
    });

    it('sendItemToBoss/approve KHÔNG chặn thiếu LSX (lệnh cũ đang chờ sẵn)', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_QLSX', lsxCode: null }),
      );
      await expect(
        service.sendItemToBoss('7', '20', 'thanh-pham', 'Kho thành phẩm', '3', 'user-qlsx'),
      ).resolves.toBeDefined();
    });
  });

  describe('gửi Sếp kèm xưởng cơ khí (Phần A – Đợt 2)', () => {
    const waitingQlsxPi = (extraItems: unknown[] = []) =>
      pi({
        items: [piItem({ id: 20n, prodApprovalStatus: 'WAITING_QLSX' }), ...extraItems],
      });

    it('sendItemToBoss thiếu workshopId -> 400 có chữ "tải lại trang"', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(waitingQlsxPi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ id: 20n, prodApprovalStatus: 'WAITING_QLSX' }),
      );
      await expect(
        service.sendItemToBoss('7', '20', 'thanh-pham', 'Kho thành phẩm', undefined, 'u'),
      ).rejects.toThrow(/tải lại trang/);
      expect(prisma.productionInvoiceItem.updateMany).not.toHaveBeenCalled();
    });

    it('sendBatchToBoss thiếu workshopId -> 400 có chữ "tải lại trang"', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(waitingQlsxPi());
      await expect(
        service.sendBatchToBoss('7', 'thanh-pham', 'Kho thành phẩm', undefined, 'u'),
      ).rejects.toThrow(/tải lại trang/);
      expect(prisma.productionInvoiceItem.updateMany).not.toHaveBeenCalled();
    });

    it('xưởng không tồn tại hoặc đã ngừng dùng -> 400', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(waitingQlsxPi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ id: 20n, prodApprovalStatus: 'WAITING_QLSX' }),
      );
      prisma.workshop.findUnique.mockResolvedValueOnce(null);
      await expect(service.sendItemToBoss('7', '20', 'tp', 'Kho', '99', 'u')).rejects.toThrow(
        'Xưởng cơ khí không tồn tại hoặc đã ngừng dùng',
      );
      prisma.workshop.findUnique.mockResolvedValueOnce({ ...workshopPA, isActive: false });
      await expect(service.sendBatchToBoss('7', 'tp', 'Kho', '3', 'u')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.productionInvoiceItem.updateMany).not.toHaveBeenCalled();
    });

    it('dòng KHÁC của PI đã WAITING_BOSS/APPROVED ở xưởng khác -> 409 nêu tên xưởng đó', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        waitingQlsxPi([
          piItem({
            id: 21n,
            lsxCode: 'MY-314',
            prodApprovalStatus: 'APPROVED',
            workshopId: 4n,
            workshop: workshopMY,
          }),
        ]),
      );
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ id: 20n, prodApprovalStatus: 'WAITING_QLSX' }),
      );
      await expect(service.sendItemToBoss('7', '20', 'tp', 'Kho', '3', 'u')).rejects.toThrow(
        'Lệnh MY-313 + MY-314 đã có SKU gửi Sếp ở Mỹ Yến - mọi SKU của một lệnh phải cùng 1 xưởng',
      );
      await expect(service.sendBatchToBoss('7', 'tp', 'Kho', '3', 'u')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.productionInvoiceItem.updateMany).not.toHaveBeenCalled();
    });

    it('dòng khác đã ở CÙNG xưởng -> gửi được', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        waitingQlsxPi([
          piItem({
            id: 21n,
            prodApprovalStatus: 'WAITING_BOSS',
            workshopId: 3n,
            workshop: workshopPA,
          }),
        ]),
      );
      await expect(service.sendBatchToBoss('7', 'tp', 'Kho', '3', 'u')).resolves.toBeDefined();
      expect(prisma.productionInvoiceItem.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [20n] } },
        data: expect.objectContaining({ workshopId: 3n }) as unknown,
      });
    });

    it('sendBatchToBoss ghi workshopId vào audit của từng dòng', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(waitingQlsxPi());
      await service.sendBatchToBoss('7', 'tp', 'Kho', '3', 'u');
      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest matcher typing */
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          newValue: expect.objectContaining({ workshopId: '3' }),
        }),
      });
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });
  });

  describe('changeWorkshop (Phần A – Đợt 2)', () => {
    const sentPi = (itemOverrides: Record<string, unknown>[] = [{}, {}]) =>
      pi({
        items: itemOverrides.map((o, i) =>
          piItem({
            id: BigInt(20 + i),
            lsxCode: `MY-${313 + i}`,
            prodApprovalStatus: 'WAITING_BOSS',
            workshopId: 3n,
            workshop: workshopPA,
            ...o,
          }),
        ),
      });
    beforeEach(() => {
      prisma.workshop.findUnique.mockResolvedValue(workshopMY);
      prisma.productionInvoiceItem.updateMany.mockResolvedValue({ count: 2 });
    });

    it('đổi xưởng mọi dòng, audit từng dòng, emit PI_WORKSHOP_CHANGED đúng params, trả PI mới', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        sentPi([{}, { prodApprovalStatus: 'APPROVED' }]),
      );

      const result = await service.changeWorkshop('7', '4', 'Phú An quá tải', 'user-qlsx');

      expect(prisma.productionInvoiceItem.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: [20n, 21n] },
          prodApprovalStatus: { in: ['WAITING_BOSS', 'APPROVED'] },
        },
        data: { workshopId: 4n },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(2);
      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest matcher typing */
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          recordId: '20',
          oldValue: { workshopId: '3', workshopCode: 'PA' },
          newValue: { workshopId: '4', workshopCode: 'MY', reason: 'Phú An quá tải' },
        }),
      });
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
      expect(notificationsService.emit).toHaveBeenCalledWith('PI_WORKSHOP_CHANGED', {
        entityId: '7',
        actorId: 'user-qlsx',
        params: {
          piCode: 'PI-7',
          displayCode: 'MY-313 + MY-314',
          fromWorkshop: 'Phú An',
          toWorkshop: 'Mỹ Yến',
          reason: 'Phú An quá tải',
          count: 2,
        },
      });
      expect(result.displayCode).toBe('MY-313 + MY-314');
    });

    it('có phương án cắt APPROVED -> bật cờ cần kiểm lại + emit PI_CUTTING_RECHECK_REQUIRED', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(sentPi());
      prisma.cuttingProposal.count.mockResolvedValue(1);

      await service.changeWorkshop('7', '4', 'Phú An quá tải', 'user-qlsx');

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest matcher typing */
      expect(prisma.cuttingProposal.count).toHaveBeenCalledWith({
        where: expect.objectContaining({ status: 'APPROVED' }),
      });
      expect(prisma.productionInvoice.update).toHaveBeenCalledWith({
        where: { id: 7n },
        data: {
          cuttingRecheckRequired: true,
          cuttingRecheckRequiredAt: expect.any(Date),
          cuttingRecheckedAt: null,
          cuttingRecheckedById: null,
        },
      });
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
      expect(notificationsService.emit).toHaveBeenCalledWith('PI_CUTTING_RECHECK_REQUIRED', {
        entityId: '7',
        actorId: 'user-qlsx',
        params: {
          piCode: 'PI-7',
          displayCode: 'MY-313 + MY-314',
          fromWorkshop: 'Phú An',
          toWorkshop: 'Mỹ Yến',
        },
      });
    });

    it('chưa có phương án cắt APPROVED -> KHÔNG bật cờ, KHÔNG emit PI_CUTTING_RECHECK_REQUIRED', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(sentPi());
      prisma.cuttingProposal.count.mockResolvedValue(0);

      await service.changeWorkshop('7', '4', 'lý do', 'user-qlsx');

      expect(prisma.productionInvoice.update).not.toHaveBeenCalled();
      expect(
        notificationsService.emit.mock.calls.some(
          (c: unknown[]) => c[0] === 'PI_CUTTING_RECHECK_REQUIRED',
        ),
      ).toBe(false);
    });

    it('emit lỗi vẫn không làm hỏng việc đổi xưởng (best-effort)', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(sentPi());
      notificationsService.emit.mockRejectedValueOnce(new Error('boom'));
      await expect(service.changeWorkshop('7', '4', 'lý do', 'u')).resolves.toBeDefined();
    });

    it('PI có SteelIssue -> 409 "đã xuất sắt", không ghi', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(sentPi());
      prisma.steelIssue.count.mockResolvedValue(1);
      await expect(service.changeWorkshop('7', '4', 'lý do', 'u')).rejects.toThrow(
        'Lệnh MY-313 + MY-314 đã xuất sắt - không đổi xưởng được',
      );
      expect(prisma.productionInvoiceItem.updateMany).not.toHaveBeenCalled();
    });

    it('có MaterialYieldIssue của production order thuộc dòng PI -> 409 "đã xuất vật tư"', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(sentPi());
      prisma.materialYieldIssue.count.mockResolvedValue(2);
      await expect(service.changeWorkshop('7', '4', 'lý do', 'u')).rejects.toThrow(
        /đã xuất vật tư cho xưởng - không đổi xưởng được/,
      );
      expect(prisma.materialYieldIssue.count).toHaveBeenCalledWith({
        where: { productionOrder: { productionInvoiceItemId: { in: [20n, 21n] } } },
      });
      expect(prisma.productionInvoiceItem.updateMany).not.toHaveBeenCalled();
    });

    it('10/11: lệnh đã giữ chỗ / đang mua ở kho xưởng cũ vẫn đổi được - gọi phần kho/mua TRONG transaction, thông báo sau commit', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(sentPi());
      prisma.stockReservation.count.mockResolvedValue(3);
      prisma.purchaseProposalItem.count.mockResolvedValue(2);
      const notify = jest.fn().mockResolvedValue(undefined);
      workshopMove.afterWorkshopChanged.mockResolvedValue(notify);

      await expect(service.changeWorkshop('7', '4', 'lý do', 'u')).resolves.toBeDefined();
      expect(workshopMove.afterWorkshopChanged).toHaveBeenCalledWith(prisma, 7n, 4n, 'u');
      expect(prisma.productionInvoiceItem.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        workshopMove.afterWorkshopChanged.mock.invocationCallOrder[0],
      );
      expect(notify).toHaveBeenCalledTimes(1);
    });

    it('10/11: phần kho/mua lỗi -> cả việc đổi xưởng lỗi (không gửi thông báo)', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(sentPi());
      workshopMove.afterWorkshopChanged.mockRejectedValue(new Error('kho lỗi'));
      await expect(service.changeWorkshop('7', '4', 'lý do', 'u')).rejects.toThrow('kho lỗi');
      expect(notificationsService.emit).not.toHaveBeenCalledWith(
        'PI_WORKSHOP_CHANGED',
        expect.anything(),
      );
    });

    it('xuất sắt chen vào giữa lúc đổi (kiểm lại TRONG transaction) -> 409, không ghi', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(sentPi());
      prisma.steelIssue.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
      await expect(service.changeWorkshop('7', '4', 'lý do', 'u')).rejects.toThrow(/đã xuất sắt/);
      expect(prisma.productionInvoiceItem.updateMany).not.toHaveBeenCalled();
    });

    it('có dòng WAITING_QLSX -> 409 nêu SKU và trạng thái', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        sentPi([{}, { prodApprovalStatus: 'WAITING_QLSX' }]),
      );
      await expect(service.changeWorkshop('7', '4', 'lý do', 'u')).rejects.toThrow(
        'Chỉ đổi xưởng khi mọi SKU của lệnh đã gửi Sếp hoặc đã duyệt (còn SKU SKU-01: WAITING_QLSX)',
      );
    });

    it('PI không còn dòng -> 409', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi({ items: [] }));
      await expect(service.changeWorkshop('7', '4', 'lý do', 'u')).rejects.toThrow(
        ConflictException,
      );
    });

    it('mọi dòng đã ở đúng xưởng này -> 400', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(sentPi());
      prisma.workshop.findUnique.mockResolvedValue(workshopPA);
      await expect(service.changeWorkshop('7', '3', 'lý do', 'u')).rejects.toThrow(
        'Lệnh đang ở Phú An rồi',
      );
    });

    it('xưởng không dùng -> 400', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(sentPi());
      prisma.workshop.findUnique.mockResolvedValue({ ...workshopMY, isActive: false });
      await expect(service.changeWorkshop('7', '4', 'lý do', 'u')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('updateMany đếm lệch số dòng (có người đổi trạng thái giữa chừng) -> 409', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(sentPi());
      prisma.productionInvoiceItem.updateMany.mockResolvedValue({ count: 1 });
      await expect(service.changeWorkshop('7', '4', 'lý do', 'u')).rejects.toThrow(/tải lại trang/);
      expect(notificationsService.emit).not.toHaveBeenCalled();
    });
  });

  describe('confirmCuttingRecheck (cờ cần kiểm lại phương án cắt)', () => {
    beforeEach(() => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({ items: [piItem({ id: 20n, lsxCode: 'MY-313' })] }),
      );
    });

    it('tắt cờ, ghi người + giờ, resolve thông báo, trả PI', async () => {
      prisma.productionInvoice.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.confirmCuttingRecheck('7', 'user-khsx');

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest matcher typing */
      expect(prisma.productionInvoice.updateMany).toHaveBeenCalledWith({
        where: { id: 7n, cuttingRecheckRequired: true },
        data: {
          cuttingRecheckRequired: false,
          cuttingRecheckedAt: expect.any(Date),
          cuttingRecheckedById: 'user-khsx',
        },
      });
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
      expect(notificationsService.resolve).toHaveBeenCalledWith({
        entityType: 'PRODUCTION_INVOICE',
        entityId: '7',
        types: ['PI_CUTTING_RECHECK_REQUIRED'],
      });
      expect(result.displayCode).toBe('MY-313');
    });

    it('cờ không bật (hoặc người khác vừa bấm) -> 409', async () => {
      prisma.productionInvoice.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.confirmCuttingRecheck('7', 'user-khsx')).rejects.toThrow(
        /MY-313 không có phương án cắt cần kiểm lại/,
      );
      expect(notificationsService.resolve).not.toHaveBeenCalled();
    });
  });

  describe('response: displayCode / lsxCodes / hasMaterialIssue / search (Phần A – Đợt 2)', () => {
    it('PI chưa dòng nào có LSX -> displayCode = mã PI, lsxCodes rỗng', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({
          cuttingProposals: [],
          items: [piItem({ lsxCode: null }), piItem({ id: 21n, lsxCode: null })],
        }),
      );
      const result = await service.findOne('7');
      expect(result.displayCode).toBe('PI-7');
      expect(result.lsxCodes).toEqual([]);
    });

    it('PI gộp 2 dòng -> displayCode "MY-313 + MY-314"; cùng số ở 2 dòng chỉ hiện 1 lần', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({
          isMerged: true,
          cuttingProposals: [],
          items: [
            piItem({ id: 20n, lsxCode: 'MY-313' }),
            piItem({ id: 21n, lsxCode: 'MY-314' }),
            piItem({ id: 22n, lsxCode: 'MY-313' }),
          ],
        }),
      );
      const result = await service.findOne('7');
      expect(result.displayCode).toBe('MY-313 + MY-314');
      expect(result.lsxCodes).toEqual(['MY-313', 'MY-314']);
    });

    it('create/update (toResponseDto) cũng có displayCode và lsxCodes, hasMaterialIssue để undefined', async () => {
      prisma.productionInvoice.create.mockResolvedValue(
        pi({ items: [piItem({ lsxCode: 'GP-176' })] }),
      );
      const result = await service.create({});
      expect(result.displayCode).toBe('GP-176');
      expect(result.lsxCodes).toEqual(['GP-176']);
      expect(result.hasMaterialIssue).toBeUndefined();
    });

    it('hasMaterialIssue = true khi có SteelIssue của PI, hoặc MaterialYieldIssue ở production order của dòng bất kỳ', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValueOnce(
        pi({ cuttingProposals: [], _count: { steelIssues: 1 }, items: [piItem()] }),
      );
      expect((await service.findOne('7')).hasMaterialIssue).toBe(true);

      prisma.productionInvoice.findUnique.mockResolvedValueOnce(
        pi({
          cuttingProposals: [],
          _count: { steelIssues: 0 },
          items: [
            piItem({
              productionOrder: {
                mfgProductId: 2n,
                bomRevisionId: 5n,
                cuttingProposals: [],
                _count: { materialYieldIssues: 3 },
              },
            }),
          ],
        }),
      );
      expect((await service.findOne('7')).hasMaterialIssue).toBe(true);

      prisma.productionInvoice.findUnique.mockResolvedValueOnce(
        pi({ cuttingProposals: [], _count: { steelIssues: 0 }, items: [piItem()] }),
      );
      expect((await service.findOne('7')).hasMaterialIssue).toBe(false);
    });

    it('findAll search khớp mã PI HOẶC số LSX của dòng, vẫn giữ điều kiện items: { some: {} }', async () => {
      prisma.productionInvoice.findMany.mockResolvedValue([]);
      prisma.productionInvoice.count.mockResolvedValue(0);
      await service.findAll({ search: 'my-31', page: 1, limit: 10, sortOrder: 'desc' } as never);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest.Mock.calls typing
      const args = prisma.productionInvoice.findMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
      };
      expect(args.where).toEqual({
        items: { some: {} },
        AND: [
          {
            OR: [
              { code: { contains: 'my-31', mode: 'insensitive' } },
              { items: { some: { lsxCode: { contains: 'my-31', mode: 'insensitive' } } } },
            ],
          },
        ],
      });
    });

    it('item DTO có workshop: instanceToPlain giữ đủ field con id/code/name và lsxCode', () => {
      const dto = new ProductionInvoiceItemResponseDto({
        id: '20',
        lsxCode: 'MY-313',
        workshop: { id: '3', code: 'PA', name: 'Phú An' },
      });
      const plain = instanceToPlain(dto);
      expect(plain.lsxCode).toBe('MY-313');
      expect(plain.workshop).toEqual({ id: '3', code: 'PA', name: 'Phú An' });
    });
  });

  describe('notifications (Phase 3a, mục 7.2)', () => {
    it('sendItemToQlsx() emit PI_SENT_TO_QLSX với count=1, dedupeKey theo PI, loại trừ actor', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(piItem());
      prisma.productionInvoiceItem.update.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_QLSX' }),
      );

      await service.sendItemToQlsx('7', '20', 'user-khsx');

      expect(notificationsService.emit).toHaveBeenCalledWith(
        'PI_SENT_TO_QLSX',
        expect.objectContaining({
          entityId: '7',
          actorId: 'user-khsx',
          dedupeKey: 'PI_SENT_TO_QLSX:7',
          params: expect.objectContaining({ piCode: 'PI-7', count: 1 }) as unknown,
        }),
      );
    });

    it('sendBatchToQlsx() emit count = số SKU đủ điều kiện của lần gửi này', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({
          items: [
            piItem({ id: 20n, prodApprovalStatus: null }),
            piItem({ id: 21n, prodApprovalStatus: 'REJECTED' }),
            piItem({ id: 22n, prodApprovalStatus: 'WAITING_BOSS' }),
          ],
        }),
      );
      prisma.productionInvoiceItem.updateMany.mockResolvedValue({ count: 2 });

      await service.sendBatchToQlsx('7', 'user-khsx');

      expect(notificationsService.emit).toHaveBeenCalledWith(
        'PI_SENT_TO_QLSX',
        expect.objectContaining({ params: expect.objectContaining({ count: 2 }) as unknown }),
      );
    });

    it('sendItemToBoss() resolve PI_SENT_TO_QLSX khi KHÔNG còn SKU nào khác đang WAITING_QLSX, rồi emit PI_SENT_TO_BOSS', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi()); // items:[] mặc định
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_QLSX' }),
      );
      prisma.productionInvoiceItem.update.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_BOSS' }),
      );

      await service.sendItemToBoss('7', '20', 'thanh-pham', 'Kho thành phẩm', '3', 'user-qlsx');

      expect(notificationsService.resolve).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'PRODUCTION_INVOICE',
          entityId: '7',
          types: ['PI_SENT_TO_QLSX'],
        }),
      );
      expect(notificationsService.emit).toHaveBeenCalledWith(
        'PI_SENT_TO_BOSS',
        expect.objectContaining({
          entityId: '7',
          dedupeKey: 'PI_SENT_TO_BOSS:7',
          params: expect.objectContaining({ count: 1 }) as unknown,
        }),
      );
    });

    it('sendItemToBoss() KHÔNG resolve PI_SENT_TO_QLSX khi còn SKU khác của PI này đang WAITING_QLSX', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({ items: [piItem({ id: 20n, prodApprovalStatus: 'WAITING_QLSX' })] }),
      );
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ id: 21n, prodApprovalStatus: 'WAITING_QLSX' }),
      );
      prisma.productionInvoiceItem.update.mockResolvedValue(
        piItem({ id: 21n, prodApprovalStatus: 'WAITING_BOSS' }),
      );

      await service.sendItemToBoss('7', '21', 'thanh-pham', 'Kho thành phẩm', '3', 'user-qlsx');

      expect(notificationsService.resolve).not.toHaveBeenCalled();
    });

    it('rejectItemByQlsx() resolve PI_SENT_TO_QLSX (item cuối) rồi emit PI_REJECTED_BY_QLSX kèm lý do', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_QLSX' }),
      );
      prisma.productionInvoiceItem.count.mockResolvedValue(0);

      await service.rejectItemByQlsx('7', '20', 'Không đủ kho', 'user-qlsx');

      expect(notificationsService.resolve).toHaveBeenCalledWith(
        expect.objectContaining({ entityId: '7', types: ['PI_SENT_TO_QLSX'] }),
      );
      expect(notificationsService.emit).toHaveBeenCalledWith(
        'PI_REJECTED_BY_QLSX',
        expect.objectContaining({
          entityId: '7',
          params: expect.objectContaining({ reason: 'Không đủ kho', count: 1 }) as unknown,
        }),
      );
    });

    it('rejectBatchByQlsx() luôn resolve PI_SENT_TO_QLSX (đòi mọi item đang WAITING_QLSX) và emit count đúng tổng SKU', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({
          items: [
            piItem({ id: 20n, prodApprovalStatus: 'WAITING_QLSX' }),
            piItem({ id: 21n, prodApprovalStatus: 'WAITING_QLSX' }),
          ],
        }),
      );
      prisma.productionInvoiceItem.updateMany.mockResolvedValue({ count: 2 });

      await service.rejectBatchByQlsx('7', 'Hết giờ SX', 'user-qlsx');

      expect(notificationsService.resolve).toHaveBeenCalledWith(
        expect.objectContaining({ entityId: '7', types: ['PI_SENT_TO_QLSX'] }),
      );
      expect(notificationsService.emit).toHaveBeenCalledWith(
        'PI_REJECTED_BY_QLSX',
        expect.objectContaining({
          params: expect.objectContaining({ reason: 'Hết giờ SX', count: 2 }) as unknown,
        }),
      );
    });

    it('approveItem() resolve PI_SENT_TO_BOSS (item cuối) rồi emit PI_APPROVED_BY_BOSS', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_BOSS' }),
      );
      prisma.productionInvoiceItem.update.mockResolvedValue(
        piItem({ prodApprovalStatus: 'APPROVED' }),
      );
      prisma.productionInvoiceItem.count.mockResolvedValue(0);

      await service.approveItem('7', '20', 'user-boss');

      expect(notificationsService.resolve).toHaveBeenCalledWith(
        expect.objectContaining({ entityId: '7', types: ['PI_SENT_TO_BOSS'] }),
      );
      expect(notificationsService.emit).toHaveBeenCalledWith(
        'PI_APPROVED_BY_BOSS',
        expect.objectContaining({
          entityId: '7',
          actorId: 'user-boss',
          params: expect.objectContaining({ count: 1 }) as unknown,
        }),
      );
    });

    it('approveItem() emit PI_PRODUCTION_ORDER_FAILED (entityType item) cho ADMIN khi createFromApproval lỗi', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_BOSS' }),
      );
      prisma.productionInvoiceItem.update.mockResolvedValue(
        piItem({ prodApprovalStatus: 'APPROVED' }),
      );
      prisma.productionInvoiceItem.count.mockResolvedValue(0);
      productionOrdersService.createFromApproval.mockRejectedValue(
        new Error('no ACTIVE bom revision'),
      );

      await service.approveItem('7', '20', 'user-boss');

      expect(notificationsService.emit).toHaveBeenCalledWith(
        'PI_PRODUCTION_ORDER_FAILED',
        expect.objectContaining({
          entityId: '20',
          params: expect.objectContaining({
            errorMessage: 'no ACTIVE bom revision',
          }) as unknown,
        }),
      );
    });

    it('approveBatch() luôn resolve PI_SENT_TO_BOSS và emit PI_APPROVED_BY_BOSS count=tổng SKU', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({
          id: 50n,
          code: 'PI-50',
          isMerged: true,
          items: [
            piItem({ id: 20n, prodApprovalStatus: 'WAITING_BOSS' }),
            piItem({ id: 21n, prodApprovalStatus: 'WAITING_BOSS' }),
          ],
        }),
      );
      prisma.productionInvoiceItem.updateMany.mockResolvedValue({ count: 2 });

      await service.approveBatch('50', 'user-boss');

      expect(notificationsService.resolve).toHaveBeenCalledWith(
        expect.objectContaining({ entityId: '50', types: ['PI_SENT_TO_BOSS'] }),
      );
      expect(notificationsService.emit).toHaveBeenCalledWith(
        'PI_APPROVED_BY_BOSS',
        expect.objectContaining({ params: expect.objectContaining({ count: 2 }) as unknown }),
      );
    });

    it('rejectItem() resolve PI_SENT_TO_BOSS (item cuối) rồi emit PI_REJECTED_BY_BOSS kèm lý do', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_BOSS' }),
      );
      prisma.productionInvoiceItem.update.mockResolvedValue(
        piItem({ prodApprovalStatus: 'REJECTED', rejectReason: 'Thiếu vật tư' }),
      );

      await service.rejectItem('7', '20', 'Thiếu vật tư', 'user-boss');

      expect(notificationsService.resolve).toHaveBeenCalledWith(
        expect.objectContaining({ entityId: '7', types: ['PI_SENT_TO_BOSS'] }),
      );
      expect(notificationsService.emit).toHaveBeenCalledWith(
        'PI_REJECTED_BY_BOSS',
        expect.objectContaining({
          params: expect.objectContaining({ reason: 'Thiếu vật tư', count: 1 }) as unknown,
        }),
      );
    });

    it('rejectBatch() luôn resolve PI_SENT_TO_BOSS và emit count đúng tổng SKU', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({
          id: 50n,
          code: 'PI-50',
          isMerged: true,
          items: [
            piItem({ id: 20n, prodApprovalStatus: 'WAITING_BOSS' }),
            piItem({ id: 21n, prodApprovalStatus: 'WAITING_BOSS' }),
          ],
        }),
      );
      prisma.productionInvoiceItem.updateMany.mockResolvedValue({ count: 2 });

      await service.rejectBatch('50', 'Sai kỹ thuật', 'user-boss');

      expect(notificationsService.resolve).toHaveBeenCalledWith(
        expect.objectContaining({ entityId: '50', types: ['PI_SENT_TO_BOSS'] }),
      );
      expect(notificationsService.emit).toHaveBeenCalledWith(
        'PI_REJECTED_BY_BOSS',
        expect.objectContaining({
          params: expect.objectContaining({ reason: 'Sai kỹ thuật', count: 2 }) as unknown,
        }),
      );
    });

    it('retryProductionOrder() thành công thì resolve PI_PRODUCTION_ORDER_FAILED (entityType item)', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'APPROVED' }),
      );
      prisma.productionOrder.findUnique.mockResolvedValue(null);

      await service.retryProductionOrder('7', '20', 'admin-1');

      expect(notificationsService.resolve).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'PRODUCTION_INVOICE_ITEM',
          entityId: '20',
          types: ['PI_PRODUCTION_ORDER_FAILED'],
        }),
      );
    });

    it('lỗi ghi notification (emit/resolve) không được làm hỏng request nghiệp vụ chính (best-effort)', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi());
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(
        piItem({ prodApprovalStatus: 'WAITING_BOSS' }),
      );
      prisma.productionInvoiceItem.update.mockResolvedValue(
        piItem({ prodApprovalStatus: 'APPROVED' }),
      );
      prisma.productionInvoiceItem.count.mockResolvedValue(0);
      notificationsService.resolve.mockRejectedValueOnce(new Error('DB down'));
      notificationsService.emit.mockRejectedValueOnce(new Error('DB down'));

      const result = await service.approveItem('7', '20', 'user-boss');

      expect(result.prodApprovalStatus).toBe('APPROVED');
    });
  });

  describe('findOne', () => {
    it('throws 404 for a non-existent PI', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(null);
      await expect(service.findOne('999')).rejects.toThrow(NotFoundException);
    });

    it('PI thường: đọc trạng thái phương án cắt từ ProductionOrder của CHÍNH SKU đó', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({
          isMerged: false,
          cuttingProposals: [],
          items: [
            piItem({
              productionOrder: {
                mfgProductId: 2n,
                bomRevisionId: 5n,
                cuttingProposals: [
                  { status: 'CALCULATING', requestedAt: new Date('2026-08-14T10:00:00Z') },
                ],
              },
            }),
          ],
        }),
      );

      const result = await service.findOne('7');

      expect(result.items[0].cuttingProposalStatus).toBe('CALCULATING');
      expect(result.items[0].cuttingProposalRequestedAt).toEqual(new Date('2026-08-14T10:00:00Z'));
    });

    it('PI gộp: MỌI SKU đọc chung 1 phương án cấp PI, KHÔNG đọc theo ProductionOrder riêng', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({
          isMerged: true,
          cuttingProposals: [
            {
              id: 900n,
              status: 'FAILED',
              totalBarsAll: null,
              wastePercentage: null,
              requestedAt: new Date('2026-08-14T11:00:00Z'),
            },
          ],
          items: [
            piItem({
              id: 20n,
              productionOrder: { mfgProductId: 2n, bomRevisionId: 5n, cuttingProposals: [] },
            }),
            piItem({
              id: 21n,
              productionOrder: { mfgProductId: 2n, bomRevisionId: 5n, cuttingProposals: [] },
            }),
          ],
        }),
      );

      const result = await service.findOne('7');

      expect(result.items[0].cuttingProposalStatus).toBe('FAILED');
      expect(result.items[1].cuttingProposalStatus).toBe('FAILED');
      // Tóm tắt phương án neo PI cho QLSX/Sếp xem trên màn duyệt.
      expect(result.cuttingPlan).toEqual({
        proposalId: '900',
        status: 'FAILED',
        totalBars: null,
        wastePercentage: null,
        hasOverThreshold: false,
        // Phương án cũ không ghi máy -> MC Laser (mọi phương án trước tính năng máy cắt).
        machine: 'laser',
      });
    });

    it('PI có phương án tính sẵn (Solve trước): trả tổng số cây + % hao hụt để duyệt trên số thật', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({
          isMerged: false,
          cuttingProposals: [
            {
              id: 901n,
              status: 'DRAFT',
              hasOverThreshold: true,
              totalBarsAll: 387,
              wastePercentage: { toString: () => '0.8', valueOf: () => 0.8 },
              requestedAt: new Date('2026-09-30T10:00:00Z'),
            },
          ],
          items: [piItem({ id: 20n })],
        }),
      );

      const result = await service.findOne('7');

      expect(result.cuttingPlan).toEqual({
        proposalId: '901',
        status: 'DRAFT',
        totalBars: 387,
        wastePercentage: 0.8,
        // QLSX/Sếp phải thấy cảnh báo vượt ngưỡng ngay trên PI.
        hasOverThreshold: true,
        machine: 'laser',
      });
    });

    it('cuttingPlan.machine = máy THỰC SỰ đã dùng (requestParams.machine), kể cả khi PI.solverMachine = null (theo mặc định công ty)', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({
          isMerged: false,
          solverMachine: null,
          cuttingProposals: [
            {
              id: 902n,
              status: 'DRAFT',
              hasOverThreshold: false,
              totalBarsAll: 40,
              wastePercentage: null,
              // Máy đã resolve (đợt ?? mặc định công ty) mà runSolverAndSave ghi vào body gửi solver.
              requestParams: { machine: 'tu_dong', bundle_factors: [14, 16] },
              requestedAt: new Date('2026-10-23T10:00:00Z'),
            },
          ],
          items: [piItem({ id: 20n })],
        }),
      );

      const result = await service.findOne('7');

      expect(result.solverMachine).toBeNull();
      expect(result.cuttingPlan?.machine).toBe('tu_dong');
    });

    it('cuttingPlan.machine: phương án chưa có requestParams.machine -> rơi về máy của PI', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({
          isMerged: false,
          solverMachine: 'tu_dong',
          cuttingProposals: [
            {
              id: 903n,
              status: 'CALCULATING',
              requestedAt: new Date('2026-10-23T10:00:00Z'),
            },
          ],
          items: [piItem({ id: 20n })],
        }),
      );

      const result = await service.findOne('7');

      expect(result.solverMachine).toBe('tu_dong');
      expect(result.cuttingPlan?.machine).toBe('tu_dong');
    });

    it('PI chưa có phương án neo PI -> cuttingPlan null', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(pi({ items: [piItem({ id: 20n })] }));

      const result = await service.findOne('7');

      expect(result.cuttingPlan).toBeNull();
    });

    it('SKU chưa duyệt (chưa có ProductionOrder) -> trạng thái null, không throw', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({ isMerged: false, cuttingProposals: [], items: [piItem({ productionOrder: null })] }),
      );

      const result = await service.findOne('7');

      expect(result.items[0].cuttingProposalStatus).toBeNull();
      expect(result.items[0].bomOutOfDate).toBeNull();
    });

    // Việc 3b (changelog-2026-09-11-bom-revision-ghim-cu-canh-bao.md mục 8) - "Nạp lại định mức"
    // ở ThongKePagePlan.tsx chỉ hiện khi field này true.
    describe('bomOutOfDate', () => {
      it('true khi bomRevisionId đã ghim KHÁC bản ACTIVE hiện tại của sản phẩm', async () => {
        productionOrdersService.fetchActiveBomRevisionIds.mockResolvedValue(new Map([['2', 7n]]));
        prisma.productionInvoice.findUnique.mockResolvedValue(
          pi({
            isMerged: false,
            cuttingProposals: [],
            items: [
              piItem({
                productionOrder: { mfgProductId: 2n, bomRevisionId: 5n, cuttingProposals: [] },
              }),
            ],
          }),
        );

        const result = await service.findOne('7');

        expect(result.items[0].bomOutOfDate).toBe(true);
        expect(productionOrdersService.fetchActiveBomRevisionIds).toHaveBeenCalledWith([2n]);
      });

      it('false khi bomRevisionId đã ghim vẫn đúng bản ACTIVE hiện tại', async () => {
        productionOrdersService.fetchActiveBomRevisionIds.mockResolvedValue(new Map([['2', 5n]]));
        prisma.productionInvoice.findUnique.mockResolvedValue(
          pi({
            isMerged: false,
            cuttingProposals: [],
            items: [
              piItem({
                productionOrder: { mfgProductId: 2n, bomRevisionId: 5n, cuttingProposals: [] },
              }),
            ],
          }),
        );

        const result = await service.findOne('7');

        expect(result.items[0].bomOutOfDate).toBe(false);
      });
    });
  });

  describe('transfer-check (Chuyền kiểm)', () => {
    const productionOrder = { id: 99n, bomRevisionId: 5n, quantity: 10 };
    const bomPieceRow = (overrides: Record<string, unknown> = {}) => ({
      bomRevisionId: 5n,
      pieceId: 30n,
      qtyPerUnit: 2,
      isWoven: true,
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
        prisma.transferCheckResult.create.mockResolvedValue({ id: 100n });
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

      // Phase 3b, nhóm 7.5-v, changelog 2026-09-25 mục 24.
      it('emit TRANSFER_CHECK_DEFECT_FOUND khi có defects - đúng piCode/pieceName/defectCount/reason (lỗi đầu tiên)', async () => {
        prisma.productionInvoice.findUnique.mockResolvedValue(pi());
        prisma.productionInvoiceItem.findUnique.mockResolvedValue(piItem());
        prisma.productionOrder.findUnique.mockResolvedValue(productionOrder);
        prisma.bomPiece.findUnique.mockResolvedValue(bomPieceRow());
        prisma.bomPiece.findMany.mockResolvedValue([bomPieceRow()]);
        prisma.transferCheckResult.create.mockResolvedValue({ id: 100n });
        prisma.transferCheckResult.findMany.mockResolvedValue([
          { pieceId: 30n, checkedQty: 4, defects: [{ id: 1n }, { id: 2n }] },
        ]);

        await service.recordTransferCheck(
          '7',
          '20',
          {
            pieceId: '30',
            checkedQty: 4,
            defects: [{ reason: 'Móp góc' }, { reason: 'Trầy sơn' }],
          },
          'user-kho',
        );

        expect(notificationsService.emit).toHaveBeenCalledWith('TRANSFER_CHECK_DEFECT_FOUND', {
          entityId: '100',
          params: {
            piCode: 'PI-7',
            pieceName: 'Thân trên',
            defectCount: 2,
            reason: 'Móp góc',
          },
        });
      });

      it('KHÔNG emit TRANSFER_CHECK_DEFECT_FOUND khi kiểm không có lỗi', async () => {
        prisma.productionInvoice.findUnique.mockResolvedValue(pi());
        prisma.productionInvoiceItem.findUnique.mockResolvedValue(piItem());
        prisma.productionOrder.findUnique.mockResolvedValue(productionOrder);
        prisma.bomPiece.findUnique.mockResolvedValue(bomPieceRow());
        prisma.bomPiece.findMany.mockResolvedValue([bomPieceRow()]);
        prisma.transferCheckResult.create.mockResolvedValue({ id: 101n });
        prisma.transferCheckResult.findMany.mockResolvedValue([
          { pieceId: 30n, checkedQty: 4, defects: [] },
        ]);

        await service.recordTransferCheck('7', '20', { pieceId: '30', checkedQty: 4 }, 'user-kho');

        expect(notificationsService.emit).not.toHaveBeenCalled();
      });

      it('chặn kiểm vượt "Hiện có" của mảnh có đan (SUM WeavingReceipt trừ đã kiểm)', async () => {
        prisma.productionInvoice.findUnique.mockResolvedValue(pi());
        prisma.productionInvoiceItem.findUnique.mockResolvedValue(piItem());
        prisma.productionOrder.findUnique.mockResolvedValue(productionOrder);
        prisma.bomPiece.findUnique.mockResolvedValue(bomPieceRow());
        prisma.weavingReceipt.aggregate.mockResolvedValue({ _sum: { qty: 10 } });
        prisma.transferCheckResult.aggregate.mockResolvedValue({ _sum: { checkedQty: 7 } });

        await expect(
          service.recordTransferCheck('7', '20', { pieceId: '30', checkedQty: 4 }, 'user-kho'),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.transferCheckResult.create).not.toHaveBeenCalled();
      });

      it('mảnh không đan lấy "Hiện có" từ phiếu chuyển kho CONFIRMED, không đọc WeavingReceipt', async () => {
        prisma.productionInvoice.findUnique.mockResolvedValue(pi());
        prisma.productionInvoiceItem.findUnique.mockResolvedValue(piItem());
        prisma.productionOrder.findUnique.mockResolvedValue(productionOrder);
        prisma.bomPiece.findUnique.mockResolvedValue(bomPieceRow({ isWoven: false }));
        prisma.bomPiece.findMany.mockResolvedValue([bomPieceRow({ isWoven: false })]);
        prisma.transferCheckResult.findMany.mockResolvedValue([]);
        prisma.warehouseTransferPieceItem.aggregate.mockResolvedValue({ _sum: { quantity: 3 } });

        await expect(
          service.recordTransferCheck('7', '20', { pieceId: '30', checkedQty: 4 }, 'user-kho'),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.weavingReceipt.aggregate).not.toHaveBeenCalled();

        await service.recordTransferCheck('7', '20', { pieceId: '30', checkedQty: 3 }, 'user-kho');
        expect(prisma.transferCheckResult.create).toHaveBeenCalledTimes(1);
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

      it('ném ConflictException khi PI chưa có SKU nào được QLSX bấm "Bắt đầu" (2026-08-31)', async () => {
        prisma.productionInvoice.findUnique.mockResolvedValue(pi());
        prisma.productionInvoiceItem.findUnique.mockResolvedValue(piItem());
        prisma.productionOrder.findUnique.mockResolvedValue(productionOrder);
        prisma.productionOrder.findFirst.mockResolvedValue(null);

        await expect(
          service.recordTransferCheck('7', '20', { pieceId: '30', checkedQty: 1 }, 'user-kho'),
        ).rejects.toThrow(ConflictException);
        expect(prisma.transferCheckResult.create).not.toHaveBeenCalled();
      });
    });

    describe('listTransferCheckPiecesBatch (2026-08-31 - gộp nhiều item 1 lần cho Bảng thống kê)', () => {
      it('mảng rỗng - trả {} ngay, không query gì', async () => {
        const result = await service.listTransferCheckPiecesBatch([]);

        expect(result).toEqual({});
        expect(prisma.productionOrder.findMany).not.toHaveBeenCalled();
      });

      it('không item nào có ProductionOrder - trả {} pre-seed cho mọi id, không query bomPiece/transferCheckResult/weavingReceipt', async () => {
        prisma.productionOrder.findMany.mockResolvedValue([]);

        const result = await service.listTransferCheckPiecesBatch(['20', '21']);

        expect(result).toEqual({ '20': [], '21': [] });
        expect(prisma.bomPiece.findMany).not.toHaveBeenCalled();
        expect(prisma.transferCheckResult.findMany).not.toHaveBeenCalled();
        expect(prisma.weavingReceipt.groupBy).not.toHaveBeenCalled();
      });

      it('item không có ProductionOrder riêng vẫn trả [] thay vì throw (khác bản đơn ném ConflictException)', async () => {
        const orderFor20 = {
          id: 99n,
          bomRevisionId: 5n,
          quantity: 10,
          productionInvoiceItemId: 20n,
        };
        prisma.productionOrder.findMany.mockResolvedValue([orderFor20]);
        prisma.bomPiece.findMany.mockResolvedValue([bomPieceRow()]);
        prisma.transferCheckResult.findMany.mockResolvedValue([]);

        const result = await service.listTransferCheckPiecesBatch(['20', '21']);

        expect(result['20']).toHaveLength(1);
        expect(result['21']).toEqual([]); // item 21 không có order - [] chứ không throw
      });

      it('trả đúng totalQty/readyQty/checkedQty/defectCount cho 1 item, khớp listTransferCheckPieces', async () => {
        const orderFor20 = {
          id: 99n,
          bomRevisionId: 5n,
          quantity: 10,
          productionInvoiceItemId: 20n,
        };
        prisma.productionOrder.findMany.mockResolvedValue([orderFor20]);
        prisma.bomPiece.findMany.mockResolvedValue([bomPieceRow()]);
        prisma.transferCheckResult.findMany.mockResolvedValue([
          { productionInvoiceItemId: 20n, pieceId: 30n, checkedQty: 3, defects: [{ id: 1n }] },
          { productionInvoiceItemId: 20n, pieceId: 30n, checkedQty: 2, defects: [] },
        ]);
        prisma.weavingReceipt.groupBy.mockResolvedValue([
          { pieceId: 30n, productionOrderId: 99n, _sum: { qty: 7 } },
        ]);

        const result = await service.listTransferCheckPiecesBatch(['20']);

        expect(result['20'][0]).toMatchObject({
          pieceId: '30',
          pieceName: 'Thân trên',
          totalQty: 20,
          readyQty: 7,
          checkedQty: 5,
          defectCount: 1,
        });
      });

      it('2 item khác order CÙNG pieceId - readyQty không lẫn giữa 2 order (key gộp cả productionOrderId lẫn pieceId, khác bản đơn chỉ key theo pieceId)', async () => {
        const order20 = { id: 99n, bomRevisionId: 5n, quantity: 10, productionInvoiceItemId: 20n };
        const order21 = { id: 100n, bomRevisionId: 5n, quantity: 10, productionInvoiceItemId: 21n };
        prisma.productionOrder.findMany.mockResolvedValue([order20, order21]);
        prisma.bomPiece.findMany.mockResolvedValue([bomPieceRow()]);
        prisma.transferCheckResult.findMany.mockResolvedValue([]);
        prisma.weavingReceipt.groupBy.mockResolvedValue([
          { pieceId: 30n, productionOrderId: 99n, _sum: { qty: 7 } },
          { pieceId: 30n, productionOrderId: 100n, _sum: { qty: 12 } },
        ]);

        const result = await service.listTransferCheckPiecesBatch(['20', '21']);

        expect(result['20'][0].readyQty).toBe(7);
        expect(result['21'][0].readyQty).toBe(12);
        // Cùng bomRevisionId (5n) cho cả 2 order - chỉ query bomPiece.findMany đúng 1 lần cho cả batch.
        expect(prisma.bomPiece.findMany).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('packaging (Đóng gói)', () => {
    const productionOrder = { id: 99n, bomRevisionId: 5n, quantity: 10 };

    describe('getPackaging', () => {
      it('computes totalQty from ProductionOrder.quantity and packedQty via SUM', async () => {
        prisma.productionInvoice.findUnique.mockResolvedValue(pi());
        prisma.productionInvoiceItem.findUnique.mockResolvedValue(piItem());
        prisma.productionOrder.findUnique.mockResolvedValue(productionOrder);
        prisma.packagingRecord.aggregate.mockResolvedValue({ _sum: { boxesPacked: 4 } });

        const result = await service.getPackaging('7', '20');

        expect(result).toMatchObject({ totalQty: 10, packedQty: 4, remainingQty: 6 });
      });

      it('packedQty = 0 khi chưa đóng gói lần nào (không crash)', async () => {
        prisma.productionInvoice.findUnique.mockResolvedValue(pi());
        prisma.productionInvoiceItem.findUnique.mockResolvedValue(piItem());
        prisma.productionOrder.findUnique.mockResolvedValue(productionOrder);
        prisma.packagingRecord.aggregate.mockResolvedValue({ _sum: { boxesPacked: null } });

        const result = await service.getPackaging('7', '20');

        expect(result).toMatchObject({ totalQty: 10, packedQty: 0, remainingQty: 10 });
      });

      it('rejects when the item has no ProductionOrder yet (chưa được Sếp duyệt)', async () => {
        prisma.productionInvoice.findUnique.mockResolvedValue(pi());
        prisma.productionInvoiceItem.findUnique.mockResolvedValue(piItem());
        prisma.productionOrder.findUnique.mockResolvedValue(null);

        await expect(service.getPackaging('7', '20')).rejects.toThrow(ConflictException);
      });
    });

    describe('recordPackaging', () => {
      it('creates a new record (append-only) and returns the updated aggregate', async () => {
        prisma.productionInvoice.findUnique.mockResolvedValue(pi());
        prisma.productionInvoiceItem.findUnique.mockResolvedValue(piItem());
        prisma.productionOrder.findUnique.mockResolvedValue(productionOrder);
        prisma.packagingRecord.aggregate
          .mockResolvedValueOnce({ _sum: { boxesPacked: 4 } })
          .mockResolvedValueOnce({ _sum: { boxesPacked: 6 } });

        const result = await service.recordPackaging(
          '7',
          '20',
          { boxesPacked: 2, note: 'Đợt 2' },
          'user-kho',
        );

        expect(prisma.packagingRecord.create).toHaveBeenCalledWith({
          data: {
            productionInvoiceItemId: 20n,
            boxesPacked: 2,
            note: 'Đợt 2',
            packedById: 'user-kho',
          },
        });
        expect(result).toMatchObject({ totalQty: 10, packedQty: 6, remainingQty: 4 });
      });

      // Phase 3b, nhóm 7.5-vi, changelog 2026-09-25 mục 25.
      it('emit PI_ITEM_PACKAGING_COMPLETE khi đóng ĐỦ totalQty VÀ item có gắn đơn hàng', async () => {
        prisma.productionInvoice.findUnique.mockResolvedValue(pi());
        prisma.productionInvoiceItem.findUnique.mockResolvedValue(
          piItem({ salesOrderId: 1n, salesOrder: { orderCode: 'PO-31' } }),
        );
        prisma.productionOrder.findUnique.mockResolvedValue(productionOrder);
        prisma.packagingRecord.aggregate
          .mockResolvedValueOnce({ _sum: { boxesPacked: 8 } })
          .mockResolvedValueOnce({ _sum: { boxesPacked: 10 } });

        await service.recordPackaging('7', '20', { boxesPacked: 2 }, 'user-kho');

        expect(notificationsService.emit).toHaveBeenCalledWith('PI_ITEM_PACKAGING_COMPLETE', {
          entityId: '20',
          params: {
            piCode: 'PI-7',
            factoryCode: mfgProduct.factoryCode,
            productName: mfgProduct.name,
            salesOrderCode: 'PO-31',
          },
        });
      });

      it('KHÔNG emit khi đóng CHƯA đủ totalQty (còn phải đóng thêm)', async () => {
        prisma.productionInvoice.findUnique.mockResolvedValue(pi());
        prisma.productionInvoiceItem.findUnique.mockResolvedValue(
          piItem({ salesOrderId: 1n, salesOrder: { orderCode: 'PO-31' } }),
        );
        prisma.productionOrder.findUnique.mockResolvedValue(productionOrder);
        prisma.packagingRecord.aggregate
          .mockResolvedValueOnce({ _sum: { boxesPacked: 4 } })
          .mockResolvedValueOnce({ _sum: { boxesPacked: 6 } });

        await service.recordPackaging('7', '20', { boxesPacked: 2 }, 'user-kho');

        expect(notificationsService.emit).not.toHaveBeenCalled();
      });

      it('KHÔNG emit khi đóng ĐỦ nhưng item KHÔNG gắn đơn hàng nào (SalesOrder null)', async () => {
        prisma.productionInvoice.findUnique.mockResolvedValue(pi());
        prisma.productionInvoiceItem.findUnique.mockResolvedValue(piItem());
        prisma.productionOrder.findUnique.mockResolvedValue(productionOrder);
        prisma.packagingRecord.aggregate
          .mockResolvedValueOnce({ _sum: { boxesPacked: 8 } })
          .mockResolvedValueOnce({ _sum: { boxesPacked: 10 } });

        await service.recordPackaging('7', '20', { boxesPacked: 2 }, 'user-kho');

        expect(notificationsService.emit).not.toHaveBeenCalled();
      });

      it('rejects khi vượt quá totalQty (không chặn theo readyQty/checkedQty của Chuyền kiểm)', async () => {
        prisma.productionInvoice.findUnique.mockResolvedValue(pi());
        prisma.productionInvoiceItem.findUnique.mockResolvedValue(piItem());
        prisma.productionOrder.findUnique.mockResolvedValue(productionOrder);
        prisma.packagingRecord.aggregate.mockResolvedValue({ _sum: { boxesPacked: 9 } });

        await expect(
          service.recordPackaging('7', '20', { boxesPacked: 2 }, 'user-kho'),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.packagingRecord.create).not.toHaveBeenCalled();
      });

      it('rejects when the item has no ProductionOrder yet', async () => {
        prisma.productionInvoice.findUnique.mockResolvedValue(pi());
        prisma.productionInvoiceItem.findUnique.mockResolvedValue(piItem());
        prisma.productionOrder.findUnique.mockResolvedValue(null);

        await expect(
          service.recordPackaging('7', '20', { boxesPacked: 2 }, 'user-kho'),
        ).rejects.toThrow(ConflictException);
        expect(prisma.packagingRecord.create).not.toHaveBeenCalled();
      });

      it('ném ConflictException khi PI chưa có SKU nào được QLSX bấm "Bắt đầu" (2026-08-31)', async () => {
        prisma.productionInvoice.findUnique.mockResolvedValue(pi());
        prisma.productionInvoiceItem.findUnique.mockResolvedValue(piItem());
        prisma.productionOrder.findUnique.mockResolvedValue(productionOrder);
        prisma.productionOrder.findFirst.mockResolvedValue(null);

        await expect(
          service.recordPackaging('7', '20', { boxesPacked: 2 }, 'user-kho'),
        ).rejects.toThrow(ConflictException);
        expect(prisma.packagingRecord.create).not.toHaveBeenCalled();
      });
    });

    describe('getPackagingBatch (2026-08-31 - gộp nhiều item 1 lần cho Bảng thống kê)', () => {
      it('mảng rỗng - trả {} ngay, không query gì', async () => {
        const result = await service.getPackagingBatch([]);

        expect(result).toEqual({});
        expect(prisma.productionOrder.findMany).not.toHaveBeenCalled();
      });

      it('item không có ProductionOrder - trả 0/0/0 thay vì throw (khác bản đơn ném ConflictException)', async () => {
        prisma.productionOrder.findMany.mockResolvedValue([]);

        const result = await service.getPackagingBatch(['20']);

        expect(result['20']).toMatchObject({ totalQty: 0, packedQty: 0, remainingQty: 0 });
      });

      it('trả đúng totalQty/packedQty/remainingQty cho 1 item, khớp getPackaging', async () => {
        const orderFor20 = {
          id: 99n,
          bomRevisionId: 5n,
          quantity: 10,
          productionInvoiceItemId: 20n,
        };
        prisma.productionOrder.findMany.mockResolvedValue([orderFor20]);
        prisma.packagingRecord.groupBy.mockResolvedValue([
          { productionInvoiceItemId: 20n, _sum: { boxesPacked: 4 } },
        ]);

        const result = await service.getPackagingBatch(['20']);

        expect(result['20']).toMatchObject({ totalQty: 10, packedQty: 4, remainingQty: 6 });
      });

      it('2 item khác order - packedQty không lẫn giữa 2 item (key theo productionInvoiceItemId riêng từng item)', async () => {
        const order20 = { id: 99n, bomRevisionId: 5n, quantity: 10, productionInvoiceItemId: 20n };
        const order21 = { id: 100n, bomRevisionId: 5n, quantity: 8, productionInvoiceItemId: 21n };
        prisma.productionOrder.findMany.mockResolvedValue([order20, order21]);
        prisma.packagingRecord.groupBy.mockResolvedValue([
          { productionInvoiceItemId: 20n, _sum: { boxesPacked: 4 } },
          { productionInvoiceItemId: 21n, _sum: { boxesPacked: 1 } },
        ]);

        const result = await service.getPackagingBatch(['20', '21']);

        expect(result['20']).toMatchObject({ totalQty: 10, packedQty: 4, remainingQty: 6 });
        expect(result['21']).toMatchObject({ totalQty: 8, packedQty: 1, remainingQty: 7 });
      });

      it('packedQty = 0 khi chưa đóng gói lần nào (không crash)', async () => {
        const orderFor20 = {
          id: 99n,
          bomRevisionId: 5n,
          quantity: 10,
          productionInvoiceItemId: 20n,
        };
        prisma.productionOrder.findMany.mockResolvedValue([orderFor20]);
        prisma.packagingRecord.groupBy.mockResolvedValue([]);

        const result = await service.getPackagingBatch(['20']);

        expect(result['20']).toMatchObject({ totalQty: 10, packedQty: 0, remainingQty: 10 });
      });
    });
  });

  // Admin quản lý ảnh lỗi kiểm chuyển kho (2026-09-11) - xem doc comment
  // listTransferCheckDefects()/updateTransferCheckDefectPhoto()/UpdateTransferCheckDefectPhotoDto.
  describe('listTransferCheckDefects / updateTransferCheckDefectPhoto', () => {
    const defectRow = {
      id: 5n,
      transferCheckResultId: 50n,
      reason: 'Rách vải',
      imageUrl: 'https://old.jpg',
      transferCheckResult: {
        productionInvoiceItemId: 20n,
        pieceId: 30n,
        checkedById: 'user-kho',
        checkedAt: new Date('2026-09-11T00:00:00Z'),
      },
    };

    it('listTransferCheckDefects trả về danh sách đã dẹt phẳng, lọc sẵn có ảnh', async () => {
      prisma.transferCheckDefect.findMany.mockResolvedValue([defectRow]);
      prisma.transferCheckDefect.count.mockResolvedValue(1);

      const result = await service.listTransferCheckDefects({ page: 1, limit: 20 } as never);

      expect(prisma.transferCheckDefect.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { imageUrl: { not: null } },
        }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        id: '5',
        productionInvoiceItemId: '20',
        pieceId: '30',
        imageUrl: 'https://old.jpg',
      });
    });

    it('người ĐÃ GHI lần kiểm này tự sửa được ảnh, ghi audit tay và dọn ảnh cũ trên Cloudinary', async () => {
      prisma.transferCheckDefect.findUnique.mockResolvedValue(defectRow);
      prisma.transferCheckDefect.update.mockResolvedValue({
        ...defectRow,
        imageUrl: 'https://new.jpg',
      });

      const result = await service.updateTransferCheckDefectPhoto(
        '5',
        { imageUrl: 'https://new.jpg' },
        'user-kho',
        ['WAREHOUSE_STAFF'],
      );

      expect(prisma.transferCheckDefect.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 5n },
          data: { imageUrl: 'https://new.jpg' },
        }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
          data: expect.objectContaining({
            tableName: 'TransferCheckDefect',
            recordId: '5',
          }),
        }),
      );
      expect(cloudinaryService.deleteByUrl).toHaveBeenCalledWith('https://old.jpg');
      expect(result.imageUrl).toBe('https://new.jpg');
    });

    it('ADMIN sửa được ảnh của lần kiểm do NGƯỜI KHÁC ghi', async () => {
      prisma.transferCheckDefect.findUnique.mockResolvedValue(defectRow);
      prisma.transferCheckDefect.update.mockResolvedValue({
        ...defectRow,
        imageUrl: 'https://new.jpg',
      });

      await service.updateTransferCheckDefectPhoto(
        '5',
        { imageUrl: 'https://new.jpg' },
        'user-admin',
        ['ADMIN'],
      );

      expect(prisma.transferCheckDefect.update).toHaveBeenCalled();
    });

    it('ném ForbiddenException nếu KHÔNG phải người đã ghi lần kiểm này và KHÔNG phải Admin', async () => {
      prisma.transferCheckDefect.findUnique.mockResolvedValue(defectRow);

      await expect(
        service.updateTransferCheckDefectPhoto(
          '5',
          { imageUrl: 'https://new.jpg' },
          'user-kho-khac',
          ['WAREHOUSE_STAFF'],
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.transferCheckDefect.update).not.toHaveBeenCalled();
    });

    it('ném NotFoundException nếu defect không tồn tại', async () => {
      prisma.transferCheckDefect.findUnique.mockResolvedValue(null);

      await expect(
        service.updateTransferCheckDefectPhoto('999', { imageUrl: null }, 'user-admin', ['ADMIN']),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.transferCheckDefect.update).not.toHaveBeenCalled();
    });
  });
});
