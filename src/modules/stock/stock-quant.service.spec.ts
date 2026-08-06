import { PrismaServiceType } from '../../prisma/prisma.service';
import { StockQuantService } from './stock-quant.service';

describe('StockQuantService', () => {
  let service: StockQuantService;
  let prisma: { stockQuant: { findMany: jest.Mock } };

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
    service = new StockQuantService(prisma as unknown as PrismaServiceType);
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
      }),
    ]);
  });

  it('returns an empty array when nothing matches, not an error', async () => {
    prisma.stockQuant.findMany.mockResolvedValue([]);

    const result = await service.findAll({});

    expect(result).toEqual([]);
  });
});
