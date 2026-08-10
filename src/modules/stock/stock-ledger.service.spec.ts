import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma, StockLedgerRefType } from '../../generated/prisma/client';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { StockLedgerService } from './stock-ledger.service';

describe('StockLedgerService', () => {
  let service: StockLedgerService;
  let prisma: {
    stockLedger: {
      findUnique: jest.Mock;
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    warehouse: { findMany: jest.Mock };
  };

  const fromWh = { id: 1n, code: 'phoi-son-han', name: 'Phoi Son Han' };
  const toWh = { id: 2n, code: 'vat-tu-tp', name: 'Vat tu TP' };
  const material = { id: 10n, code: 'SAT-25' };

  const ledgerRow = (overrides: Record<string, unknown> = {}) => ({
    id: 100n,
    fromWarehouseId: 1n,
    toWarehouseId: 2n,
    materialId: 10n,
    segmentSpecId: null,
    pieceId: null,
    productVariantId: null,
    qty: { toNumber: () => 5 } as unknown as Prisma.Decimal,
    refType: StockLedgerRefType.ADJUST,
    refId: null,
    idempotencyKey: null,
    note: null,
    createdAt: new Date('2026-08-05T00:00:00Z'),
    createdById: 'user-1',
    fromWarehouse: fromWh,
    toWarehouse: toWh,
    material,
    segmentSpec: null,
    piece: null,
    productVariant: null,
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      stockLedger: {
        findUnique: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      warehouse: { findMany: jest.fn().mockResolvedValue([fromWh, toWh]) },
    };
    service = new StockLedgerService(prisma as unknown as PrismaServiceType);
  });

  describe('postEntry - XOR 4 chân hàng', () => {
    it('rejects when no goods leg is set', async () => {
      await expect(
        service.postEntry({
          fromWarehouseId: 1n,
          toWarehouseId: 2n,
          qty: 5,
          refType: StockLedgerRefType.ADJUST,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.stockLedger.create).not.toHaveBeenCalled();
    });

    it('rejects when 2 goods legs are set at once', async () => {
      await expect(
        service.postEntry({
          fromWarehouseId: 1n,
          toWarehouseId: 2n,
          materialId: 10n,
          pieceId: 20n,
          qty: 5,
          refType: StockLedgerRefType.ADJUST,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it.each([
      ['materialId', { materialId: 10n }],
      ['segmentSpecId', { segmentSpecId: 11n }],
      ['pieceId', { pieceId: 12n }],
      ['productVariantId', { productVariantId: 13n }],
    ])('accepts exactly 1 leg set (%s)', async (_label, leg) => {
      prisma.stockLedger.create.mockResolvedValue(ledgerRow(leg));

      await expect(
        service.postEntry({
          fromWarehouseId: 1n,
          toWarehouseId: 2n,
          ...leg,
          qty: 5,
          refType: StockLedgerRefType.ADJUST,
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('postEntry - business rules', () => {
    it('rejects fromWarehouseId === toWarehouseId', async () => {
      await expect(
        service.postEntry({
          fromWarehouseId: 1n,
          toWarehouseId: 1n,
          materialId: 10n,
          qty: 5,
          refType: StockLedgerRefType.ADJUST,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.stockLedger.create).not.toHaveBeenCalled();
    });

    it('rejects qty <= 0', async () => {
      await expect(
        service.postEntry({
          fromWarehouseId: 1n,
          toWarehouseId: 2n,
          materialId: 10n,
          qty: 0,
          refType: StockLedgerRefType.ADJUST,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('postEntry - idempotency (POST /stock-ledger/adjust)', () => {
    it('creates a new row when the idempotency key has not been used', async () => {
      prisma.stockLedger.findUnique.mockResolvedValue(null);
      prisma.stockLedger.create.mockResolvedValue(ledgerRow());

      const result = await service.postEntry({
        fromWarehouseId: 1n,
        toWarehouseId: 2n,
        materialId: 10n,
        qty: 5,
        refType: StockLedgerRefType.ADJUST,
        idempotencyKey: 'key-1',
      });

      expect(prisma.stockLedger.create).toHaveBeenCalledTimes(1);
      expect(result.id).toBe('100');
    });

    it('returns the existing row without creating a duplicate when the key was already used', async () => {
      prisma.stockLedger.findUnique.mockResolvedValue(ledgerRow());

      const result = await service.postEntry({
        fromWarehouseId: 1n,
        toWarehouseId: 2n,
        materialId: 10n,
        qty: 5,
        refType: StockLedgerRefType.ADJUST,
        idempotencyKey: 'key-1',
      });

      expect(prisma.stockLedger.create).not.toHaveBeenCalled();
      expect(result.id).toBe('100');
    });

    it('resolves to the winning row when 2 requests race on the same key (P2002)', async () => {
      prisma.stockLedger.findUnique
        .mockResolvedValueOnce(null) // pre-check: chưa thấy
        .mockResolvedValueOnce(ledgerRow()); // fetch lại sau khi thua race
      const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.9.0',
      });
      prisma.stockLedger.create.mockRejectedValue(p2002);

      const result = await service.postEntry({
        fromWarehouseId: 1n,
        toWarehouseId: 2n,
        materialId: 10n,
        qty: 5,
        refType: StockLedgerRefType.ADJUST,
        idempotencyKey: 'key-1',
      });

      expect(result.id).toBe('100');
    });

    it('rethrows a P2002 with no idempotencyKey involved (not a replay, a real conflict)', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.9.0',
      });
      prisma.stockLedger.create.mockRejectedValue(p2002);

      await expect(
        service.postEntry({
          fromWarehouseId: 1n,
          toWarehouseId: 2n,
          materialId: 10n,
          qty: 5,
          refType: StockLedgerRefType.ADJUST,
        }),
      ).rejects.toBe(p2002);
    });
  });

  describe('adjust', () => {
    it('posts an ADJUST entry carrying the caller and the idempotency key through', async () => {
      prisma.stockLedger.findUnique.mockResolvedValue(null);
      prisma.stockLedger.create.mockResolvedValue(ledgerRow());

      await service.adjust(
        { fromWarehouseId: '1', toWarehouseId: '2', materialId: '10', qty: 5, note: 'kiểm kê' },
        'idem-key-1',
        'user-1',
        null,
      );

      expect(prisma.stockLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
          data: expect.objectContaining({
            refType: StockLedgerRefType.ADJUST,
            note: 'kiểm kê',
            idempotencyKey: 'idem-key-1',
            createdBy: { connect: { id: 'user-1' } },
          }),
        }),
      );
    });

    it('allows a scoped caller whose warehouseScope matches one leg of the entry', async () => {
      prisma.stockLedger.findUnique.mockResolvedValue(null);
      prisma.stockLedger.create.mockResolvedValue(ledgerRow());

      await service.adjust(
        { fromWarehouseId: '1', toWarehouseId: '2', materialId: '10', qty: 5 },
        'idem-key-2',
        'user-1',
        toWh.code,
      );

      expect(prisma.stockLedger.create).toHaveBeenCalled();
    });

    it('rejects a scoped caller whose warehouseScope touches neither leg of the entry', async () => {
      await expect(
        service.adjust(
          { fromWarehouseId: '1', toWarehouseId: '2', materialId: '10', qty: 5 },
          'idem-key-3',
          'user-1',
          'thanh-pham',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.stockLedger.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('filters by warehouseId on either leg (from OR to)', async () => {
      prisma.stockLedger.findMany.mockResolvedValue([ledgerRow()]);
      prisma.stockLedger.count.mockResolvedValue(1);

      await service.findAll({
        page: 1,
        limit: 20,
        sortOrder: 'desc' as never,
        warehouseId: '1',
      } as never);

      expect(prisma.stockLedger.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
          where: expect.objectContaining({
            OR: [{ fromWarehouseId: 1n }, { toWarehouseId: 1n }],
          }),
        }),
      );
    });
  });
});
