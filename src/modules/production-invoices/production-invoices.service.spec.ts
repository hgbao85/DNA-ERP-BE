import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { ProdItemStageType } from '../../generated/prisma/client';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';
import { CuttingProposalsService } from '../cutting-proposals/cutting-proposals.service';
import { ProductionOrdersService } from '../production-orders/production-orders.service';
import { ProductionInvoicesService } from './production-invoices.service';

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
    };
    productionInvoiceItem: {
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    productionInvoiceItemStage: { upsert: jest.Mock };
    mfgProduct: { findUnique: jest.Mock };
    productionOrder: { findUnique: jest.Mock };
    bomPiece: { findMany: jest.Mock; findUnique: jest.Mock };
    transferCheckResult: { findMany: jest.Mock; create: jest.Mock };
    weavingReceipt: { groupBy: jest.Mock };
    packagingRecord: { create: jest.Mock; aggregate: jest.Mock };
    auditLog: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let productionOrdersService: {
    createFromApproval: jest.Mock;
    assertActiveBomRevisionExists: jest.Mock;
  };
  let cuttingProposalsService: { requestForOrder: jest.Mock; requestForInvoice: jest.Mock };
  let cls: { isActive: jest.Mock; get: jest.Mock; getId: jest.Mock };

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
        findFirst: jest.fn(),
        // Mặc định rỗng cho nextProductionInvoiceCode() (đọc MAX mã hiện có) - hầu hết test không
        // quan tâm đúng mã sinh ra, chỉ cần không throw; test nào cần mã cụ thể tự override.
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn(),
        delete: jest.fn(),
      },
      productionInvoiceItem: {
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      productionInvoiceItemStage: { upsert: jest.fn() },
      mfgProduct: { findUnique: jest.fn() },
      productionOrder: { findUnique: jest.fn() },
      bomPiece: { findMany: jest.fn(), findUnique: jest.fn() },
      transferCheckResult: { findMany: jest.fn(), create: jest.fn() },
      weavingReceipt: { groupBy: jest.fn().mockResolvedValue([]) },
      packagingRecord: {
        create: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _sum: { boxesPacked: null } }),
      },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(prisma))),
    };
    productionOrdersService = {
      createFromApproval: jest.fn().mockResolvedValue({ id: 99n }),
      assertActiveBomRevisionExists: jest.fn().mockResolvedValue(undefined),
    };
    cuttingProposalsService = {
      requestForOrder: jest.fn().mockResolvedValue({ id: '1' }),
      requestForInvoice: jest.fn().mockResolvedValue({ id: '2' }),
    };
    cls = { isActive: jest.fn().mockReturnValue(false), get: jest.fn(), getId: jest.fn() };
    service = new ProductionInvoicesService(
      prisma as unknown as PrismaServiceType,
      productionOrdersService as unknown as ProductionOrdersService,
      cuttingProposalsService as unknown as CuttingProposalsService,
      cls as unknown as ClsService<AppClsStore>,
    );
  });

  // ─── Gộp đợt cắt: KHSX gộp SKU, Sếp quyết cả cụm ──────────────────────────────
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

    it('gộp 2 SKU thành PI mới: isMerged, không thuộc đơn nào, hạn theo SKU GẤP NHẤT', async () => {
      const soon = new Date('2026-09-01');
      const later = new Date('2026-09-20');
      prisma.productionInvoiceItem.findMany.mockResolvedValue([
        mergeCandidate(20n, { salesOrderId: 1n, materialDeadline: later }),
        mergeCandidate(21n, { salesOrderId: 2n, materialDeadline: soon }),
      ]);

      await service.mergeItems({ productionInvoiceItemIds: ['20', '21'] }, 'user-khsx');

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

      await service.mergeItems({ productionInvoiceItemIds: ['20', '21'] }, 'user-khsx');

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest.Mock.calls typing
      const moved = prisma.productionInvoiceItem.updateMany.mock.calls[0][0] as {
        where: { id: { in: bigint[] } };
        data: Record<string, unknown>;
      };
      expect(moved.where.id.in).toEqual([20n, 21n]);
      expect(moved.data).toEqual({ productionInvoiceId: 50n });
      expect(moved.data).not.toHaveProperty('salesOrderId');
    });

    it('chặn gộp dưới 2 SKU (trùng id cũng tính là 1)', async () => {
      await expect(
        service.mergeItems({ productionInvoiceItemIds: ['20', '20'] }, 'user-khsx'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.productionInvoice.create).not.toHaveBeenCalled();
    });

    it('chặn gộp SKU Sếp đã duyệt - phần sắt của nó đã được tính rồi', async () => {
      prisma.productionInvoiceItem.findMany.mockResolvedValue([
        mergeCandidate(20n),
        mergeCandidate(21n, { prodApprovalStatus: 'APPROVED' }),
      ]);

      await expect(
        service.mergeItems({ productionInvoiceItemIds: ['20', '21'] }, 'user-khsx'),
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
        service.mergeItems({ productionInvoiceItemIds: ['20', '21'] }, 'user-khsx'),
      ).rejects.toThrow(ConflictException);
    });

    it('báo rõ id nào không tìm thấy thay vì gộp thiếu trong im lặng', async () => {
      prisma.productionInvoiceItem.findMany.mockResolvedValue([mergeCandidate(20n)]);

      await expect(
        service.mergeItems({ productionInvoiceItemIds: ['20', '21'] }, 'user-khsx'),
      ).rejects.toThrow(NotFoundException);
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

      await service.claimSolo('20');

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest.Mock.calls typing
      const created = prisma.productionInvoice.create.mock.calls[0][0] as {
        data: { isMerged: boolean; salesOrderId: bigint | null; deadline: Date };
      };
      expect(created.data.isMerged).toBe(false);
      expect(created.data.salesOrderId).toBe(1n);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest.Mock.calls typing
      const updated = prisma.productionInvoiceItem.update.mock.calls[0][0] as {
        where: { id: bigint };
        data: { productionInvoiceId: bigint };
      };
      expect(updated.where.id).toBe(20n);
      expect(updated.data.productionInvoiceId).toBe(60n);
    });

    it('chặn gọi lại cho SKU đã được gom rồi - không tạo PI mới đè lên', async () => {
      prisma.productionInvoiceItem.findUnique.mockResolvedValue({
        id: 20n,
        productionInvoiceId: 7n,
        salesOrderId: 1n,
        deliveryDeadline: null,
      });

      await expect(service.claimSolo('20')).rejects.toThrow(ConflictException);
      expect(prisma.productionInvoice.create).not.toHaveBeenCalled();
    });

    it('báo 404 khi SKU không tồn tại', async () => {
      prisma.productionInvoiceItem.findUnique.mockResolvedValue(null);

      await expect(service.claimSolo('999')).rejects.toThrow(NotFoundException);
      expect(prisma.productionInvoice.create).not.toHaveBeenCalled();
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
      });
      expect(cuttingProposalsService.requestForOrder).not.toHaveBeenCalled();
      // Mỗi SKU vẫn có lệnh sản xuất riêng của nó (Phôi/Hàn/Sơn chạy theo SKU như cũ).
      expect(productionOrdersService.createFromApproval).toHaveBeenCalledTimes(2);
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
  });

  describe('rejectBatch', () => {
    const mergedPi = (items: unknown[]) =>
      pi({ id: 50n, code: 'PI-50', isMerged: true, salesOrderId: null, salesOrder: null, items });

    it('trả SKU về PI của đơn gốc kèm lý do rồi xoá đợt gộp', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        mergedPi([
          piItem({ id: 20n, salesOrderId: 1n, prodApprovalStatus: 'WAITING_BOSS' }),
          piItem({ id: 21n, salesOrderId: 2n, prodApprovalStatus: 'WAITING_BOSS' }),
        ]),
      );
      // Đơn 1 còn PI cũ để nhận lại; đơn 2 không còn -> phải tạo mới.
      prisma.productionInvoice.findFirst
        .mockResolvedValueOnce({ id: 7n })
        .mockResolvedValueOnce(null);
      prisma.salesOrder.findUnique.mockResolvedValue({ id: 2n, deliveryDate: null });
      prisma.productionInvoice.create.mockResolvedValue({ id: 60n });
      prisma.productionInvoice.update.mockResolvedValue({ id: 60n, code: 'PI-60' });

      const result = await service.rejectBatch('50', 'Hạn quá gấp', 'user-boss');

      const updates = prisma.productionInvoiceItem.update.mock.calls.map(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest.Mock.calls typing
        (c) => (c[0] as { data: Record<string, unknown> }).data,
      );
      expect(updates[0]).toMatchObject({
        productionInvoiceId: 7n,
        prodApprovalStatus: 'REJECTED',
        rejectReason: 'Hạn quá gấp',
        decidedById: 'user-boss',
      });
      expect(updates[1]).toMatchObject({ productionInvoiceId: 60n, rejectReason: 'Hạn quá gấp' });
      expect(prisma.productionInvoice.delete).toHaveBeenCalledWith({ where: { id: 50n } });
      expect(result.movedItemIds).toEqual(['20', '21']);
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

      await service.sendBatchToBoss('7', 'thanh-pham', 'Kho thành phẩm', 'user-qlsx');

      expect(prisma.productionInvoiceItem.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [20n, 21n] } },
        data: expect.objectContaining({
          prodApprovalStatus: 'WAITING_BOSS',
          warehouseCode: 'thanh-pham',
          warehouseName: 'Kho thành phẩm',
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
        service.sendBatchToBoss('7', 'thanh-pham', 'Kho thành phẩm', 'user-qlsx'),
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

      expect(productionOrdersService.createFromApproval).toHaveBeenCalledWith(20n, 2n, 10);
      expect(cuttingProposalsService.requestForOrder).toHaveBeenCalledWith(99n, {
        requestedById: 'user-boss',
      });
      expect(prisma.productionInvoice.update).toHaveBeenCalledWith({
        where: { id: 7n },
        data: { status: 'PRODUCING' },
      });
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
      expect(updateCall.include).toEqual({
        mfgProduct: true,
        productVariant: true,
        stages: true,
        salesOrder: true,
      });
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

    it('PI thường: đọc trạng thái phương án cắt từ ProductionOrder của CHÍNH SKU đó', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({
          isMerged: false,
          cuttingProposals: [],
          items: [
            piItem({
              productionOrder: {
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
          cuttingProposals: [{ status: 'FAILED', requestedAt: new Date('2026-08-14T11:00:00Z') }],
          items: [
            piItem({ id: 20n, productionOrder: { cuttingProposals: [] } }),
            piItem({ id: 21n, productionOrder: { cuttingProposals: [] } }),
          ],
        }),
      );

      const result = await service.findOne('7');

      expect(result.items[0].cuttingProposalStatus).toBe('FAILED');
      expect(result.items[1].cuttingProposalStatus).toBe('FAILED');
    });

    it('SKU chưa duyệt (chưa có ProductionOrder) -> trạng thái null, không throw', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(
        pi({ isMerged: false, cuttingProposals: [], items: [piItem({ productionOrder: null })] }),
      );

      const result = await service.findOne('7');

      expect(result.items[0].cuttingProposalStatus).toBeNull();
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
    });
  });
});
