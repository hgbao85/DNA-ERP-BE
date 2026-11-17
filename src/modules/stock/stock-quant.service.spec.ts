import { PrismaServiceType } from '../../prisma/prisma.service';
import { StockQuantService } from './stock-quant.service';

describe('StockQuantService', () => {
  let service: StockQuantService;
  let prisma: { stockQuant: { findMany: jest.Mock } };
  let stockReservationsService: { getReservedQtyMap: jest.Mock };

  const quantRow = (overrides: Record<string, unknown> = {}) => ({
    id: 1n,
    warehouseId: 1n,
    materialId: 10n,
    segmentSpecId: null,
    pieceId: null,
    productVariantId: null,
    qty: { toNumber: () => 42.5 },
    spec: '',
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
    stockReservationsService = { getReservedQtyMap: jest.fn().mockResolvedValue(new Map()) };
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
    stockReservationsService.getReservedQtyMap.mockResolvedValue(new Map([['1:10:', 32.5]]));

    const result = await service.findAll({ warehouseId: '1' });

    // K5 16/11: 1 lần cho mọi dòng (không còn N+1), khoá (kho, vật tư, quy cách).
    expect(stockReservationsService.getReservedQtyMap).toHaveBeenCalledTimes(1);
    expect(stockReservationsService.getReservedQtyMap).toHaveBeenCalledWith([
      { warehouseId: 1n, materialId: 10n },
    ]);
    expect(result).toEqual([expect.objectContaining({ qty: 42.5, availableQty: 10 })]);
  });

  it('K5: phần giữ tách theo quy cách, available kẹp về 0, nhiều dòng chỉ 1 lần lấy giữ chỗ', async () => {
    prisma.stockQuant.findMany.mockResolvedValue([
      quantRow({ id: 1n, spec: 'A' }),
      quantRow({ id: 2n, spec: 'B' }),
      quantRow({ id: 3n, spec: '' }),
    ]);
    stockReservationsService.getReservedQtyMap.mockResolvedValue(
      new Map([
        ['1:10:A', 2.5],
        ['1:10:B', 100],
      ]),
    );

    const result = await service.findAll({});

    expect(stockReservationsService.getReservedQtyMap).toHaveBeenCalledTimes(1);
    expect(result.map((r) => r.availableQty)).toEqual([40, 0, 42.5]);
  });

  it('K5: thủ kho chỉ đọc tồn cả họ kho mình; tổng kho (null) không lọc', async () => {
    prisma.stockQuant.findMany.mockResolvedValue([]);

    await service.findAll({}, 'phoi-son-han-han-pa');
    await service.findAll({}, null);

    const where = (i: number) =>
      (prisma.stockQuant.findMany.mock.calls[i] as [{ where: Record<string, unknown> }])[0].where;
    expect(where(0).warehouse).toEqual({
      OR: [{ code: 'phoi-son-han' }, { code: { startsWith: 'phoi-son-han-' } }],
    });
    expect(where(1).warehouse).toBeUndefined();
  });

  it('rows without a materialId - available === qty, not asked for reservations', async () => {
    prisma.stockQuant.findMany.mockResolvedValue([
      quantRow({
        materialId: null,
        material: null,
        segmentSpecId: 5n,
        segmentSpec: { material: { code: 'SAT-25' }, cutLengthMm: 6000 },
      }),
    ]);

    const result = await service.findAll({});

    expect(stockReservationsService.getReservedQtyMap).toHaveBeenCalledWith([]);
    expect(result).toEqual([
      expect.objectContaining({ materialId: null, qty: 42.5, availableQty: 42.5 }),
    ]);
  });
});
