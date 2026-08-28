import { PrismaServiceType } from '../../prisma/prisma.service';
import { StockQuantService } from './stock-quant.service';

describe('StockQuantService', () => {
  let service: StockQuantService;
  let prisma: { stockQuant: { findMany: jest.Mock } };
  let stockReservationsService: { getAvailableQty: jest.Mock };

  const quantRow = (overrides: Record<string, unknown> = {}) => ({
    id: 1n,
    warehouseId: 1n,
    materialId: 10n,
    segmentSpecId: null,
    pieceId: null,
    productVariantId: null,
    qty: { toNumber: () => 42.5 },
    updatedAt: new Date('2026-08-05T00:00:00Z'),
    warehouse: { id: 1n, code: 'vat-tu-tp' },
    material: { id: 10n, code: 'SAT-25' },
    segmentSpec: null,
    piece: null,
    productVariant: null,
    ...overrides,
  });

  beforeEach(() => {
    prisma = { stockQuant: { findMany: jest.fn() } };
    // available mặc định = onHand (không giữ chỗ gì) - test riêng "vấn đề #13" ghi đè khi cần.
    stockReservationsService = {
      getAvailableQty: jest.fn((_tx, _wh, _mat, onHand: number) => Promise.resolve(onHand)),
    };
    service = new StockQuantService(
      prisma as unknown as PrismaServiceType,
      stockReservationsService as unknown as import('./stock-reservations.service').StockReservationsService,
    );
  });

  it('returns the balance for every (warehouse, goods) row matching the filter', async () => {
    prisma.stockQuant.findMany.mockResolvedValue([quantRow()]);

    const result = await service.findAll({ warehouseId: '1' });

    expect(prisma.stockQuant.findMany).toHaveBeenCalledWith(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
      expect.objectContaining({ where: expect.objectContaining({ warehouseId: 1n }) }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: '1',
        warehouseId: '1',
        warehouseCode: 'vat-tu-tp',
        materialId: '10',
        materialCode: 'SAT-25',
        segmentSpecId: null,
        pieceId: null,
        productVariantId: null,
        qty: 42.5,
        availableQty: 42.5,
      }),
    ]);
  });

  it('returns an empty array when nothing matches, not an error', async () => {
    prisma.stockQuant.findMany.mockResolvedValue([]);

    const result = await service.findAll({});

    expect(result).toEqual([]);
  });

  it('subtracts active reservations from onHand for rows with a materialId (Vấn đề #13)', async () => {
    prisma.stockQuant.findMany.mockResolvedValue([quantRow()]);
    stockReservationsService.getAvailableQty.mockResolvedValue(10);

    const result = await service.findAll({ warehouseId: '1' });

    expect(stockReservationsService.getAvailableQty).toHaveBeenCalledWith(undefined, 1n, 10n, 42.5);
    expect(result).toEqual([expect.objectContaining({ qty: 42.5, availableQty: 10 })]);
  });

  it('does not call getAvailableQty for rows without a materialId - available === qty', async () => {
    prisma.stockQuant.findMany.mockResolvedValue([
      quantRow({
        materialId: null,
        material: null,
        segmentSpecId: 5n,
        segmentSpec: { material: { code: 'SAT-25' }, cutLengthMm: 6000 },
      }),
    ]);

    const result = await service.findAll({});

    expect(stockReservationsService.getAvailableQty).not.toHaveBeenCalled();
    expect(result).toEqual([
      expect.objectContaining({ materialId: null, qty: 42.5, availableQty: 42.5 }),
    ]);
  });
});
