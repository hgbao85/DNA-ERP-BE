import { PrismaServiceType } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaintTransferReminderService } from './paint-transfer-reminder.service';
import { WarehouseTransfersService } from './warehouse-transfers.service';

/**
 * Xưởng 1 = có kho Sơn riêng (Phú An); xưởng 2 = không có kho Sơn (Phước An, sơn ở xưởng 1).
 * Kho Hàn: 'han-1' (xưởng 1, id 11), 'han-2' (xưởng 2, id 12). Kho Sơn: 'son' (id 50).
 */
const WELD: Record<string, { id: bigint; code: string; name: string }> = {
  '1': { id: 11n, code: 'han-1', name: 'Kho Hàn Phú An' },
  '2': { id: 12n, code: 'han-2', name: 'Kho Hàn Phước An' },
};

type OrderRow = {
  id: bigint;
  productionInvoiceItem: {
    productionInvoiceId: bigint;
    workshopId: bigint;
    productionInvoice: { code: string };
  };
};

const order = (id: bigint, piId: bigint, workshopId: bigint, code = `GP-${piId}`): OrderRow => ({
  id,
  productionInvoiceItem: { productionInvoiceId: piId, workshopId, productionInvoice: { code } },
});

const planItem = (productionOrderId: string, pieceId: string, suggestedQty: number) => ({
  productionOrderId,
  pieceId,
  suggestedQty,
});

describe('PaintTransferReminderService', () => {
  let service: PaintTransferReminderService;
  let prisma: {
    productionOrder: { findMany: jest.Mock; findUnique: jest.Mock };
    warehouse: { findFirst: jest.Mock; findUnique: jest.Mock };
    stockQuant: { findMany: jest.Mock };
    warehouseTransferPieceItem: { findMany: jest.Mock };
    notification: { findFirst: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
    $executeRaw: jest.Mock;
  };
  let transfers: { getPieceTransferPlan: jest.Mock };
  let notifications: { emit: jest.Mock; resolve: jest.Mock; updateOpenContent: jest.Mock };
  const savedEnv = process.env.FLOOR_ALERTS;

  beforeEach(() => {
    delete process.env.FLOOR_ALERTS;
    prisma = {
      productionOrder: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest
          .fn()
          .mockResolvedValue({ productionInvoiceItem: { productionInvoiceId: 7n } }),
      },
      warehouse: {
        findFirst: jest.fn(
          ({ where }: { where: { kind: string; workshopId?: bigint } }): Promise<unknown> => {
            if (where.kind === 'SON') {
              // workshopHasPaint (có workshopId) / kho Sơn dùng chung (không có workshopId)
              if (where.workshopId === undefined) {
                return Promise.resolve({ id: 50n, code: 'son', kind: 'SON', workshopId: 1n });
              }
              return Promise.resolve(where.workshopId === 1n ? { id: 50n } : null);
            }
            const w = WELD[String(where.workshopId)];
            return Promise.resolve(
              w ? { id: w.id, code: w.code, kind: 'HAN', workshopId: where.workshopId } : null,
            );
          },
        ),
        findUnique: jest.fn(
          ({ where }: { where: { id?: bigint; code?: string } }): Promise<unknown> => {
            if (where.id === 50n) return Promise.resolve({ name: 'Kho Sơn Phú An' });
            const byId = Object.values(WELD).find((w) => w.id === where.id);
            if (byId) return Promise.resolve(byId);
            if (where.code === 'han-1') return Promise.resolve({ kind: 'HAN', workshopId: 1n });
            if (where.code === 'han-2') return Promise.resolve({ kind: 'HAN', workshopId: 2n });
            if (where.code === 'son') return Promise.resolve({ kind: 'SON', workshopId: 1n });
            return Promise.resolve(null);
          },
        ),
      },
      stockQuant: { findMany: jest.fn().mockResolvedValue([]) },
      warehouseTransferPieceItem: { findMany: jest.fn().mockResolvedValue([]) },
      notification: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(),
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
    transfers = { getPieceTransferPlan: jest.fn().mockResolvedValue([]) };
    notifications = {
      emit: jest.fn().mockResolvedValue(undefined),
      resolve: jest.fn().mockResolvedValue(undefined),
      updateOpenContent: jest.fn().mockResolvedValue(true),
    };
    service = new PaintTransferReminderService(
      prisma as unknown as PrismaServiceType,
      transfers as unknown as WarehouseTransfersService,
      notifications as unknown as NotificationsService,
    );
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.FLOOR_ALERTS;
    else process.env.FLOOR_ALERTS = savedEnv;
  });

  /** Lệnh 7 của xưởng 2 (Phước An) có 1 PO (id 70) và mảnh 900 sẵn sàng `qty`, tồn kho Hàn đủ. */
  const setupPendingPi7 = (qty: number, stock = 1000) => {
    prisma.productionOrder.findMany.mockResolvedValue([order(70n, 7n, 2n, 'GP-7')]);
    transfers.getPieceTransferPlan.mockResolvedValue([planItem('70', '900', qty)]);
    prisma.stockQuant.findMany.mockResolvedValue([
      { warehouseId: 12n, pieceId: 900n, qty: { toNumber: () => stock } },
    ]);
  };

  describe('pendingByPi', () => {
    it('chỉ lệnh của xưởng không có kho Sơn mới có pending; lệnh Phú An (có kho Sơn) bị bỏ', async () => {
      prisma.productionOrder.findMany.mockResolvedValue([order(70n, 7n, 2n), order(80n, 8n, 1n)]);
      transfers.getPieceTransferPlan.mockResolvedValue([
        planItem('70', '900', 200),
        planItem('80', '901', 50),
      ]);
      prisma.stockQuant.findMany.mockResolvedValue([
        { warehouseId: 12n, pieceId: 900n, qty: { toNumber: () => 500 } },
        { warehouseId: 11n, pieceId: 901n, qty: { toNumber: () => 500 } },
      ]);

      const map = await service.pendingByPi();

      expect([...map.keys()]).toEqual(['7']);
      expect(map.get('7')).toMatchObject({
        pendingQty: 200,
        weldWarehouseCode: 'han-2',
        weldWarehouseName: 'Kho Hàn Phước An',
        paintWarehouseName: 'Kho Sơn Phú An',
      });
      expect(transfers.getPieceTransferPlan).toHaveBeenCalledWith(['70'], prisma, 'TO_PAINT');
    });

    it('lọc lệnh theo tập hiện ở màn Xuất theo đơn hàng: PO RELEASED / IN_PROGRESS, lệnh chưa DONE / CANCELLED, có SKU ACTIVE', async () => {
      await service.pendingByPi();

      const [args] = prisma.productionOrder.findMany.mock.calls[0] as [{ where: unknown }];
      expect(args.where).toMatchObject({
        status: { in: ['RELEASED', 'IN_PROGRESS'] },
        productionInvoiceItem: {
          productionInvoice: {
            status: { notIn: ['DONE', 'CANCELLED'] },
            items: { some: { productionOrder: { floorStage: 'ACTIVE' } } },
          },
        },
      });
    });

    it('không có đơn nào -> không gọi getPieceTransferPlan (hàm này ném lỗi khi danh sách rỗng)', async () => {
      const map = await service.pendingByPi();

      expect(map.size).toBe(0);
      expect(transfers.getPieceTransferPlan).not.toHaveBeenCalled();
    });

    it('chỉ có lệnh Phú An -> cũng không gọi getPieceTransferPlan', async () => {
      prisma.productionOrder.findMany.mockResolvedValue([order(80n, 8n, 1n)]);

      const map = await service.pendingByPi();

      expect(map.size).toBe(0);
      expect(transfers.getPieceTransferPlan).not.toHaveBeenCalled();
    });

    it('giới hạn theo tồn mảnh thật ở kho Hàn trừ phiếu chờ nhận (như createPieceTransfer)', async () => {
      setupPendingPi7(300, 250);
      prisma.warehouseTransferPieceItem.findMany.mockResolvedValue([
        { pieceId: 900n, quantity: 100, transfer: { fromWarehouseId: 12n } },
      ]);

      const map = await service.pendingByPi();

      // suggested 300, tồn 250 - phiếu chờ 100 = 150
      expect(map.get('7')?.pendingQty).toBe(150);
    });

    it('mảnh không còn tồn (dữ liệu trước khi ghi mảnh vào kho) -> không tính vào pending', async () => {
      setupPendingPi7(300, 0);

      const map = await service.pendingByPi();

      expect(map.get('7')?.pendingQty).toBe(0);
    });

    it('2 lệnh dùng chung 1 mảnh: tồn chia dần, không tính đôi', async () => {
      prisma.productionOrder.findMany.mockResolvedValue([order(70n, 7n, 2n), order(71n, 9n, 2n)]);
      transfers.getPieceTransferPlan.mockResolvedValue([
        planItem('70', '900', 80),
        planItem('71', '900', 80),
      ]);
      prisma.stockQuant.findMany.mockResolvedValue([
        { warehouseId: 12n, pieceId: 900n, qty: { toNumber: () => 100 } },
      ]);

      const map = await service.pendingByPi();

      expect(map.get('7')?.pendingQty).toBe(80);
      expect(map.get('9')?.pendingQty).toBe(20);
    });
  });

  describe('countPendingOrders', () => {
    it('kho Hàn Phước An: đếm số lệnh pending > 0', async () => {
      prisma.productionOrder.findMany.mockResolvedValue([
        order(70n, 7n, 2n),
        order(71n, 9n, 2n),
        order(72n, 10n, 2n),
      ]);
      transfers.getPieceTransferPlan.mockResolvedValue([
        planItem('70', '900', 10),
        planItem('71', '901', 20),
        planItem('72', '902', 0), // không còn gì chờ
      ]);
      prisma.stockQuant.findMany.mockResolvedValue([
        { warehouseId: 12n, pieceId: 900n, qty: { toNumber: () => 100 } },
        { warehouseId: 12n, pieceId: 901n, qty: { toNumber: () => 100 } },
      ]);

      await expect(service.countPendingOrders('han-2')).resolves.toBe(2);
    });

    it('kho khác (Hàn Phú An, kho Sơn, không có kho) = 0, không tính gì', async () => {
      await expect(service.countPendingOrders('han-1')).resolves.toBe(0);
      await expect(service.countPendingOrders('son')).resolves.toBe(0);
      await expect(service.countPendingOrders(null)).resolves.toBe(0);
      expect(prisma.productionOrder.findMany).not.toHaveBeenCalled();
    });
  });

  describe('refreshForOrder', () => {
    it('lần đầu: emit với đúng kho Hàn của xưởng lệnh, dedupeKey theo lệnh', async () => {
      setupPendingPi7(200);

      await service.refreshForOrder('70');

      expect(notifications.emit).toHaveBeenCalledWith('PIECES_TO_PAINT_PENDING', {
        entityId: '7',
        dedupeKey: 'pieces-to-paint-pending:7',
        params: {
          piCode: 'GP-7',
          piId: '7',
          pendingQty: 200,
          weldWarehouseCodes: ['han-2'],
          weldWarehouseName: 'Kho Hàn Phước An',
          paintWarehouseName: 'Kho Sơn Phú An',
        },
      });
      // chạy dưới khoá theo lệnh
      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it('số tăng -> emit (gộp, hiện lại chưa đọc), không dùng updateOpenContent', async () => {
      setupPendingPi7(300);
      prisma.notification.findFirst.mockResolvedValue({ data: { pendingQty: 200 } });

      await service.refreshForOrder('70');

      expect(notifications.emit).toHaveBeenCalledTimes(1);
      expect(notifications.updateOpenContent).not.toHaveBeenCalled();
    });

    it('số giảm -> updateOpenContent (giữ đã đọc), không emit', async () => {
      setupPendingPi7(180);
      prisma.notification.findFirst.mockResolvedValue({ data: { pendingQty: 300 } });

      await service.refreshForOrder('70');

      expect(notifications.updateOpenContent).toHaveBeenCalledWith(
        'PIECES_TO_PAINT_PENDING',
        'pieces-to-paint-pending:7',
        expect.objectContaining({ pendingQty: 180 }),
      );
      expect(notifications.emit).not.toHaveBeenCalled();
    });

    it('số giảm nhưng tin vừa bị đóng giữa chừng (updateOpenContent trả false) -> emit tin mới', async () => {
      setupPendingPi7(180);
      prisma.notification.findFirst.mockResolvedValue({ data: { pendingQty: 300 } });
      notifications.updateOpenContent.mockResolvedValue(false);

      await service.refreshForOrder('70');

      expect(notifications.emit).toHaveBeenCalledTimes(1);
    });

    it('số không đổi -> không làm gì', async () => {
      setupPendingPi7(200);
      prisma.notification.findFirst.mockResolvedValue({ data: { pendingQty: 200 } });

      await service.refreshForOrder('70');

      expect(notifications.emit).not.toHaveBeenCalled();
      expect(notifications.updateOpenContent).not.toHaveBeenCalled();
    });

    it('về 0 -> resolve PRODUCTION_INVOICE / PIECES_TO_PAINT_PENDING của lệnh', async () => {
      setupPendingPi7(0);

      await service.refreshForOrder('70');

      expect(notifications.resolve).toHaveBeenCalledWith({
        entityType: 'PRODUCTION_INVOICE',
        entityId: '7',
        types: ['PIECES_TO_PAINT_PENDING'],
      });
      expect(notifications.emit).not.toHaveBeenCalled();
    });

    it('lệnh Phú An (có kho Sơn): không có tin, và đóng tin cũ nếu còn', async () => {
      prisma.productionOrder.findUnique.mockResolvedValue({
        productionInvoiceItem: { productionInvoiceId: 8n },
      });
      prisma.productionOrder.findMany.mockResolvedValue([order(80n, 8n, 1n)]);

      await service.refreshForOrder('80');

      expect(notifications.emit).not.toHaveBeenCalled();
      expect(notifications.resolve).toHaveBeenCalledWith(
        expect.objectContaining({ entityId: '8', types: ['PIECES_TO_PAINT_PENDING'] }),
      );
    });

    it('FLOOR_ALERTS=off -> không phát gì (không có lượt nền nào đóng tin)', async () => {
      process.env.FLOOR_ALERTS = 'off';
      setupPendingPi7(200);

      await service.refreshForOrder('70');

      expect(notifications.emit).not.toHaveBeenCalled();
      expect(prisma.productionOrder.findMany).not.toHaveBeenCalled();
    });
  });

  describe('syncAll', () => {
    it('đóng tin của lệnh rời khỏi tập (DONE / CANCELLED / đổi xưởng / hết SKU ACTIVE)', async () => {
      setupPendingPi7(200);
      prisma.notification.findMany.mockResolvedValue([{ entityId: '7' }, { entityId: '99' }]);
      prisma.notification.findFirst.mockResolvedValue({ data: { pendingQty: 200 } });

      await service.syncAll();

      expect(notifications.resolve).toHaveBeenCalledTimes(1);
      expect(notifications.resolve).toHaveBeenCalledWith({
        entityType: 'PRODUCTION_INVOICE',
        entityId: '99',
        types: ['PIECES_TO_PAINT_PENDING'],
      });
    });

    it('số tăng giữa lúc syncAll tính map và lúc syncOne chạy -> syncOne dùng số mới (không hạ số, không đóng tin)', async () => {
      setupPendingPi7(5);
      // Lần tính đầu (map của syncAll) ra 5; lần tính lại trong syncOne (sau khoá) ra 12.
      transfers.getPieceTransferPlan
        .mockResolvedValueOnce([planItem('70', '900', 5)])
        .mockResolvedValue([planItem('70', '900', 12)]);
      prisma.notification.findFirst.mockResolvedValue({ data: { pendingQty: 10 } });

      await service.syncAll();

      expect(notifications.updateOpenContent).not.toHaveBeenCalled();
      expect(notifications.resolve).not.toHaveBeenCalled();
      expect(notifications.emit).toHaveBeenCalledTimes(1);
      const arg = (
        notifications.emit.mock.calls as [string, { params: { pendingQty: number } }][]
      )[0];
      expect(arg[0]).toBe('PIECES_TO_PAINT_PENDING');
      expect(arg[1].params.pendingQty).toBe(12);
    });

    it('syncAll: lệnh có tin đang mở nhưng map đầu không có lệnh đó -> syncOne vẫn tính lại, số mới > 0 thì không đóng tin', async () => {
      prisma.notification.findMany.mockResolvedValue([{ entityId: '7' }]);
      prisma.productionOrder.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValue([order(70n, 7n, 2n, 'GP-7')]);
      transfers.getPieceTransferPlan.mockResolvedValue([planItem('70', '900', 8)]);
      prisma.stockQuant.findMany.mockResolvedValue([
        { warehouseId: 12n, pieceId: 900n, qty: { toNumber: () => 1000 } },
      ]);
      prisma.notification.findFirst.mockResolvedValue({ data: { pendingQty: 8 } });

      await service.syncAll();

      expect(notifications.resolve).not.toHaveBeenCalled();
    });

    it('lệnh còn pending nhưng tin chưa có -> phát; một lệnh lỗi không chặn lệnh khác', async () => {
      prisma.productionOrder.findMany.mockResolvedValue([order(70n, 7n, 2n), order(71n, 9n, 2n)]);
      transfers.getPieceTransferPlan.mockResolvedValue([
        planItem('70', '900', 10),
        planItem('71', '901', 20),
      ]);
      prisma.stockQuant.findMany.mockResolvedValue([
        { warehouseId: 12n, pieceId: 900n, qty: { toNumber: () => 100 } },
        { warehouseId: 12n, pieceId: 901n, qty: { toNumber: () => 100 } },
      ]);
      notifications.emit.mockRejectedValueOnce(new Error('boom'));

      await expect(service.syncAll()).resolves.toBeUndefined();

      expect(notifications.emit).toHaveBeenCalledTimes(2);
    });
  });
});
