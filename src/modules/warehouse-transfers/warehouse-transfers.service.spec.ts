import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import {
  MfgStage,
  ReservationStatus,
  StockLedgerRefType,
  TransferStatus,
} from '../../generated/prisma/client';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { StockReservationsService } from '../stock/stock-reservations.service';
import { WarehouseTransfersService } from './warehouse-transfers.service';

describe('WarehouseTransfersService', () => {
  let service: WarehouseTransfersService;
  let stockLedgerService: { postEntry: jest.Mock };
  let stockReservationsService: { getAvailableQty: jest.Mock };
  let prisma: {
    warehouse: { findUnique: jest.Mock };
    warehouseTransfer: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    warehouseTransferReservation: {
      createMany: jest.Mock;
      updateMany: jest.Mock;
    };
    warehouseTransferPieceItem: { findMany: jest.Mock };
    productionOrder: { findMany: jest.Mock };
    bomPiece: { findMany: jest.Mock };
    productionBatch: { findMany: jest.Mock };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };

  const phoiSonHan = { id: 1n, code: 'phoi-son-han', name: 'Phoi Son Han' };
  const vatTuTp = { id: 2n, code: 'vat-tu-tp', name: 'Vat tu TP' };
  const thanhPham = { id: 3n, code: 'thanh-pham', name: 'Thanh pham' };

  const transferRow = (overrides: Record<string, unknown> = {}) => ({
    id: 50n,
    code: 'CK-2026-001',
    fromWarehouseId: 1n,
    toWarehouseId: 2n,
    status: TransferStatus.PENDING,
    planFormId: null,
    rejectionReason: null,
    note: null,
    createdAt: new Date('2026-08-05T00:00:00Z'),
    confirmedAt: null,
    rejectedAt: null,
    fromWarehouse: phoiSonHan,
    toWarehouse: vatTuTp,
    items: [
      {
        id: 500n,
        materialId: 10n,
        materialName: 'Sat 25',
        unit: 'kg',
        quantity: { toNumber: () => 30 },
        note: null,
      },
    ],
    pieceItems: [],
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      warehouse: { findUnique: jest.fn() },
      warehouseTransfer: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      warehouseTransferReservation: {
        createMany: jest.fn(),
        updateMany: jest.fn(),
      },
      warehouseTransferPieceItem: { findMany: jest.fn().mockResolvedValue([]) },
      productionOrder: { findMany: jest.fn().mockResolvedValue([]) },
      bomPiece: { findMany: jest.fn().mockResolvedValue([]) },
      productionBatch: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(prisma))),
    };
    stockLedgerService = { postEntry: jest.fn() };
    // Mặc định trả nguyên onHand (không giữ chỗ nào) - khớp hành vi cũ trước H1 fix cho các test
    // không quan tâm tới reservation.
    stockReservationsService = {
      getAvailableQty: jest.fn((_tx, _warehouseId, _materialId, onHand: number) =>
        Promise.resolve(onHand),
      ),
    };
    service = new WarehouseTransfersService(
      prisma as unknown as PrismaServiceType,
      stockLedgerService as unknown as StockLedgerService,
      stockReservationsService as unknown as StockReservationsService,
    );

    prisma.warehouse.findUnique.mockImplementation(
      ({ where }: { where: { id?: bigint; code?: string } }) => {
        const all = [phoiSonHan, vatTuTp, thanhPham];
        if (where.id !== undefined)
          return Promise.resolve(all.find((w) => w.id === where.id) ?? null);
        return Promise.resolve(all.find((w) => w.code === where.code) ?? null);
      },
    );
  });

  describe('create', () => {
    const dto = {
      fromWarehouseId: '1',
      toWarehouseId: '2',
      items: [{ materialId: '10', materialName: 'Sat 25', unit: 'kg', quantity: 50 }],
    };

    it('rejects a route not in TRANSFER_ROUTES (e.g. skipping a step in the chain)', async () => {
      await expect(
        service.create({ ...dto, fromWarehouseId: '1', toWarehouseId: '3' }, null),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.warehouseTransfer.create).not.toHaveBeenCalled();
    });

    it('rejects when the caller is scoped to a different warehouse than fromWarehouseId', async () => {
      await expect(service.create(dto, 'vat-tu-tp')).rejects.toThrow(ForbiddenException);
    });

    it('allows a caller scoped to the correct fromWarehouse', async () => {
      prisma.$queryRaw.mockResolvedValue([{ qty: { toNumber: () => 100 } }]);
      prisma.warehouseTransfer.create.mockResolvedValue(transferRow());

      await expect(service.create(dto, 'phoi-son-han')).resolves.toBeDefined();
    });

    it('clamps requested quantity down to available stock (onHand - reservations of both kinds, via getAvailableQty)', async () => {
      prisma.$queryRaw.mockResolvedValue([{ qty: { toNumber: () => 40 } }]);
      stockReservationsService.getAvailableQty.mockResolvedValue(25); // 40 onHand - 15 reserved
      prisma.warehouseTransfer.create.mockResolvedValue(transferRow());

      await service.create(dto, null);

      expect(prisma.warehouseTransfer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
          data: expect.objectContaining({
            items: { create: [expect.objectContaining({ quantity: 25 })] }, // 25 < 50 requested
          }),
        }),
      );
    });

    it('reads available stock through StockReservationsService.getAvailableQty (H1 fix) - never re-implements the sum locally', async () => {
      prisma.$queryRaw.mockResolvedValue([{ qty: { toNumber: () => 100 } }]);
      prisma.warehouseTransfer.create.mockResolvedValue(transferRow());

      await service.create(dto, null);

      expect(stockReservationsService.getAvailableQty).toHaveBeenCalledWith(prisma, 1n, 10n, 100);
    });

    it('rejects with 400 when clamped availability is 0 for every item', async () => {
      prisma.$queryRaw.mockResolvedValue([{ qty: { toNumber: () => 0 } }]);

      await expect(service.create(dto, null)).rejects.toThrow(BadRequestException);
      expect(prisma.warehouseTransfer.create).not.toHaveBeenCalled();
    });

    it('trusts the requested quantity as-is for items with no materialId (documented mock-parity gap)', async () => {
      prisma.warehouseTransfer.create.mockResolvedValue(transferRow());

      await service.create(
        { ...dto, items: [{ materialName: 'Khung chua dan', unit: 'cai', quantity: 7 }] },
        null,
      );

      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- jest mock.calls typing
      const call = prisma.warehouseTransfer.create.mock.calls[0][0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest mock.calls typing
      expect(call.data.items.create).toEqual([expect.objectContaining({ quantity: 7 })]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest mock.calls typing
      expect(call.data.items.create[0].materialId).toBeUndefined();
    });

    it('numbers the transfer code sequentially per year, based on the existing count', async () => {
      prisma.$queryRaw.mockResolvedValue([{ qty: { toNumber: () => 100 } }]);
      prisma.warehouseTransfer.count.mockResolvedValue(4);
      prisma.warehouseTransfer.create.mockResolvedValue(transferRow());

      await service.create(dto, null);

      const currentYear = new Date().getFullYear();
      expect(prisma.warehouseTransfer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
          data: expect.objectContaining({ code: `CK-${currentYear}-005` }),
        }),
      );
    });
  });

  describe('confirm', () => {
    it('rejects with 409 when the transfer is not PENDING', async () => {
      prisma.warehouseTransfer.findUnique.mockResolvedValue(
        transferRow({ status: TransferStatus.CONFIRMED }),
      );

      await expect(service.confirm('50', 'user-1', null)).rejects.toThrow(ConflictException);
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    it('rejects when the caller is not scoped to the destination warehouse', async () => {
      prisma.warehouseTransfer.findUnique.mockResolvedValue(transferRow());

      await expect(service.confirm('50', 'user-1', 'phoi-son-han')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('posts exactly 1 ledger entry per material item with a deterministic idempotency key, then releases reservations', async () => {
      prisma.warehouseTransfer.findUnique.mockResolvedValue(transferRow());
      stockLedgerService.postEntry.mockResolvedValue({ id: '999' });
      prisma.warehouseTransfer.findUniqueOrThrow.mockResolvedValue(
        transferRow({ status: TransferStatus.CONFIRMED, confirmedAt: new Date() }),
      );

      await service.confirm('50', 'user-1', 'vat-tu-tp');

      expect(stockLedgerService.postEntry).toHaveBeenCalledTimes(1);
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          fromWarehouseId: 1n,
          toWarehouseId: 2n,
          materialId: 10n,
          qty: 30,
          refType: StockLedgerRefType.WAREHOUSE_TRANSFER,
          refId: '50',
          createdById: 'user-1',
          idempotencyKey: 'warehouse-transfer:50:item:500',
        }),
        prisma,
      );
      expect(prisma.warehouseTransferReservation.updateMany).toHaveBeenCalledWith({
        where: { transferId: 50n, status: ReservationStatus.ACTIVE },
        data: { status: ReservationStatus.RELEASED },
      });
      expect(prisma.warehouseTransfer.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 50n, status: TransferStatus.PENDING },
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
          data: expect.objectContaining({ status: TransferStatus.CONFIRMED }),
        }),
      );
    });

    it('skips items with no materialId (nothing to XOR into the ledger)', async () => {
      prisma.warehouseTransfer.findUnique.mockResolvedValue(
        transferRow({
          items: [
            {
              id: 501n,
              materialId: null,
              materialName: 'Free text',
              unit: 'cai',
              quantity: { toNumber: () => 1 },
              note: null,
            },
          ],
        }),
      );
      prisma.warehouseTransfer.findUniqueOrThrow.mockResolvedValue(transferRow());

      await service.confirm('50', 'user-1', null);

      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
      expect(prisma.warehouseTransferReservation.updateMany).toHaveBeenCalled();
    });

    it('posts a ledger entry per piece item (pieceId leg, no materialId)', async () => {
      prisma.warehouseTransfer.findUnique.mockResolvedValue(
        transferRow({
          items: [],
          pieceItems: [
            {
              id: 700n,
              productionOrderId: 900n,
              pieceId: 30n,
              quantity: 12,
              note: null,
              productionOrder: {
                poNumber: 'PO-31-1',
                productionInvoiceItem: { salesOrder: { code: 'PO-31' } },
              },
              piece: { code: 'M-01', name: 'Manh 01' },
            },
          ],
        }),
      );
      stockLedgerService.postEntry.mockResolvedValue({ id: '999' });
      prisma.warehouseTransfer.findUniqueOrThrow.mockResolvedValue(
        transferRow({ status: TransferStatus.CONFIRMED }),
      );

      await service.confirm('50', 'user-1', 'vat-tu-tp');

      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          fromWarehouseId: 1n,
          toWarehouseId: 2n,
          pieceId: 30n,
          qty: 12,
          refType: StockLedgerRefType.WAREHOUSE_TRANSFER,
          refId: '50',
          idempotencyKey: 'warehouse-transfer:50:piece-item:700',
        }),
        prisma,
      );
    });

    it('rejects with 409 and posts no ledger entry when another request already confirmed/rejected the transfer inside the transaction (race guard)', async () => {
      prisma.warehouseTransfer.findUnique.mockResolvedValue(transferRow());
      prisma.warehouseTransfer.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.confirm('50', 'user-1', 'vat-tu-tp')).rejects.toThrow(ConflictException);
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
      expect(prisma.warehouseTransferReservation.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('getPieceTransferPlan', () => {
    const order = {
      id: 900n,
      poNumber: 'PO-31-1',
      bomRevisionId: 80n,
      quantity: 100,
      mfgProduct: { name: 'San pham A' },
      productionInvoiceItem: { salesOrder: { code: 'PO-31' } },
    };
    const manhPiece = { pieceId: 30n, piece: { code: 'M-01', name: 'Manh 01' } };
    const vatTuPiece = { pieceId: 31n, piece: { code: 'V-01', name: 'Vat tu 01' } };

    it('sums ProductionBatch QC_DONE at the final stage (SON when needsSon) for needsHan=true pieces', async () => {
      prisma.productionOrder.findMany.mockResolvedValue([order]);
      prisma.bomPiece.findMany.mockResolvedValue([
        { ...manhPiece, bomRevisionId: 80n, needsHan: true, needsSon: true },
      ]);
      prisma.productionBatch.findMany.mockResolvedValue([
        { productionOrderId: 900n, pieceId: 30n, stage: MfgStage.SON, reportedQty: 20 },
        { productionOrderId: 900n, pieceId: 30n, stage: MfgStage.SON, reportedQty: 5 },
        // Bỏ qua - không phải mốc cuối (mảnh cần cả Hàn lẫn Sơn thì mốc cuối là SON, không phải HAN).
        { productionOrderId: 900n, pieceId: 30n, stage: MfgStage.HAN, reportedQty: 100 },
      ]);

      const result = await service.getPieceTransferPlan(['900']);

      expect(result).toEqual([
        expect.objectContaining({
          label: 'MANH',
          readyQty: 25,
          transferredQty: 0,
          suggestedQty: 25,
        }),
      ]);
    });

    it('skips needsHan=false pieces without throwing (Critical C2 fix) - SteelIssue gộp theo PI không còn đếm được theo mảnh, nhưng 1 mảnh cấu hình sai không được phép sập cả batch', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      prisma.productionOrder.findMany.mockResolvedValue([order]);
      prisma.bomPiece.findMany.mockResolvedValue([
        { ...vatTuPiece, bomRevisionId: 80n, needsHan: false, needsSon: false },
        { ...manhPiece, bomRevisionId: 80n, needsHan: true, needsSon: false },
      ]);
      prisma.productionBatch.findMany.mockResolvedValue([
        { productionOrderId: 900n, pieceId: 30n, stage: MfgStage.HAN, reportedQty: 20 },
      ]);

      const result = await service.getPieceTransferPlan(['900']);

      // Mảnh needsHan=false (V-01) bị bỏ qua, nhưng mảnh needsHan=true (M-01) cùng batch vẫn trả về.
      expect(result).toEqual([
        expect.objectContaining({ pieceCode: 'M-01', readyQty: 20, suggestedQty: 20 }),
      ]);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('V-01'));
      warnSpy.mockRestore();
    });

    it('subtracts pieces already in a PENDING or CONFIRMED transfer, not just CONFIRMED', async () => {
      prisma.productionOrder.findMany.mockResolvedValue([order]);
      prisma.bomPiece.findMany.mockResolvedValue([
        { ...manhPiece, bomRevisionId: 80n, needsHan: true, needsSon: false },
      ]);
      prisma.productionBatch.findMany.mockResolvedValue([
        { productionOrderId: 900n, pieceId: 30n, stage: MfgStage.HAN, reportedQty: 20 },
      ]);
      prisma.warehouseTransferPieceItem.findMany.mockResolvedValue([
        { productionOrderId: 900n, pieceId: 30n, quantity: 6 },
      ]);

      const result = await service.getPieceTransferPlan(['900']);

      expect(result).toEqual([
        expect.objectContaining({ readyQty: 20, transferredQty: 6, suggestedQty: 14 }),
      ]);
      expect(prisma.warehouseTransferPieceItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
          where: expect.objectContaining({
            transfer: { status: { in: [TransferStatus.PENDING, TransferStatus.CONFIRMED] } },
          }),
        }),
      );
    });

    it('skips the invalid needsHan=false/needsSon=true combination', async () => {
      prisma.productionOrder.findMany.mockResolvedValue([order]);
      prisma.bomPiece.findMany.mockResolvedValue([
        { ...manhPiece, bomRevisionId: 80n, needsHan: false, needsSon: true },
      ]);

      const result = await service.getPieceTransferPlan(['900']);

      expect(result).toEqual([]);
    });
  });

  describe('createPieceTransfer', () => {
    const pieceDto = {
      fromWarehouseId: '1',
      toWarehouseId: '2',
      pieceItems: [{ productionOrderId: '900', pieceId: '30', quantity: 50 }],
    };

    beforeEach(() => {
      prisma.productionOrder.findMany.mockResolvedValue([
        {
          id: 900n,
          poNumber: 'PO-31-1',
          bomRevisionId: 80n,
          quantity: 100,
          mfgProduct: { name: 'San pham A' },
          productionInvoiceItem: { salesOrder: { code: 'PO-31' } },
        },
      ]);
      prisma.bomPiece.findMany.mockResolvedValue([
        {
          bomRevisionId: 80n,
          pieceId: 30n,
          needsHan: true,
          needsSon: false,
          piece: { code: 'M-01', name: 'Manh 01' },
        },
      ]);
      prisma.productionBatch.findMany.mockResolvedValue([
        { productionOrderId: 900n, pieceId: 30n, stage: MfgStage.HAN, reportedQty: 20 },
      ]);
    });

    it('rejects when the caller is scoped to a different warehouse than fromWarehouseId', async () => {
      await expect(service.createPieceTransfer(pieceDto, 'vat-tu-tp')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects a route not in TRANSFER_ROUTES', async () => {
      await expect(
        service.createPieceTransfer(
          { ...pieceDto, fromWarehouseId: '1', toWarehouseId: '3' },
          null,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('clamps requested quantity down to the piece transfer plan suggestedQty (20 ready, 50 requested)', async () => {
      prisma.warehouseTransfer.create.mockResolvedValue(transferRow());

      await service.createPieceTransfer(pieceDto, 'phoi-son-han');

      expect(prisma.warehouseTransfer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
          data: expect.objectContaining({
            pieceItems: { create: [expect.objectContaining({ quantity: 20 })] },
          }),
        }),
      );
    });

    it('rejects with 400 when nothing is ready to transfer', async () => {
      prisma.productionBatch.findMany.mockResolvedValue([]);

      await expect(service.createPieceTransfer(pieceDto, null)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.warehouseTransfer.create).not.toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    it('rejects with 409 when the transfer is not PENDING', async () => {
      prisma.warehouseTransfer.findUnique.mockResolvedValue(
        transferRow({ status: TransferStatus.REJECTED }),
      );

      await expect(service.reject('50', 'ly do', null)).rejects.toThrow(ConflictException);
    });

    it('releases reservations and records the reason without touching the ledger', async () => {
      prisma.warehouseTransfer.findUnique.mockResolvedValue(transferRow());
      prisma.warehouseTransfer.findUniqueOrThrow.mockResolvedValue(
        transferRow({ status: TransferStatus.REJECTED, rejectionReason: 'thieu hang' }),
      );

      await service.reject('50', 'thieu hang', 'vat-tu-tp');

      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
      expect(prisma.warehouseTransferReservation.updateMany).toHaveBeenCalledWith({
        where: { transferId: 50n, status: ReservationStatus.ACTIVE },
        data: { status: ReservationStatus.RELEASED },
      });
      expect(prisma.warehouseTransfer.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 50n, status: TransferStatus.PENDING },
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
          data: expect.objectContaining({
            status: TransferStatus.REJECTED,
            rejectionReason: 'thieu hang',
          }),
        }),
      );
    });

    it('rejects with 409 when another request already confirmed/rejected the transfer inside the transaction (race guard)', async () => {
      prisma.warehouseTransfer.findUnique.mockResolvedValue(transferRow());
      prisma.warehouseTransfer.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.reject('50', 'thieu hang', 'vat-tu-tp')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.warehouseTransferReservation.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('findOne - warehouse scope', () => {
    it('rejects when the caller is scoped to a warehouse unrelated to this transfer', async () => {
      prisma.warehouseTransfer.findUnique.mockResolvedValue(transferRow());

      await expect(service.findOne('50', 'thanh-pham')).rejects.toThrow(ForbiddenException);
    });

    it('allows a caller scoped to either the source or destination warehouse', async () => {
      prisma.warehouseTransfer.findUnique.mockResolvedValue(transferRow());

      await expect(service.findOne('50', 'phoi-son-han')).resolves.toBeDefined();
      await expect(service.findOne('50', 'vat-tu-tp')).resolves.toBeDefined();
    });
  });
});
