import type { PrismaServiceType } from '../../prisma/prisma.service';
import {
  buildSizesRelaxNote,
  isUsableStockLength,
  loadAvailableStockLengths,
  mergeStandardAndStockLengths,
  parseMaxSizesPerBarByWorkshop,
  workshopLabel,
} from './steel-stock-lengths.util';

const dec = (n: number) => ({ toNumber: () => n });

describe('steel-stock-lengths.util', () => {
  const filter = { minMm: 4000, maxMm: 6500, standardLengths: [6000] };

  describe('isUsableStockLength', () => {
    it('nhận chiều dài dương, bội 50, trong dải, khác chiều dài chuẩn', () => {
      expect(isUsableStockLength(5950, filter)).toBe(true);
      expect(isUsableStockLength(4000, filter)).toBe(true);
      expect(isUsableStockLength(6500, filter)).toBe(true);
    });

    it('loại: không bội 50, ngoài dải, trùng chuẩn, <= 0, không nguyên', () => {
      expect(isUsableStockLength(5925, filter)).toBe(false);
      expect(isUsableStockLength(3950, filter)).toBe(false);
      expect(isUsableStockLength(6550, filter)).toBe(false);
      expect(isUsableStockLength(6000, filter)).toBe(false);
      expect(isUsableStockLength(0, filter)).toBe(false);
      expect(isUsableStockLength(-50, filter)).toBe(false);
      expect(isUsableStockLength(5950.5, filter)).toBe(false);
    });
  });

  it('mergeStandardAndStockLengths: chuẩn trước, tồn sau, khử trùng', () => {
    expect(mergeStandardAndStockLengths([6000], [5950, 5900, 6000])).toEqual([6000, 5950, 5900]);
  });

  describe('parseMaxSizesPerBarByWorkshop', () => {
    it('giữ số nguyên 1..10, bỏ giá trị không hợp lệ', () => {
      expect(
        parseMaxSizesPerBarByWorkshop({ PHUOC_AN: 2, A: 0, B: 11, C: 2.5, D: '2', E: null, F: 10 }),
      ).toEqual({ PHUOC_AN: 2, F: 10 });
    });

    it('không phải object -> rỗng (không ném lỗi)', () => {
      expect(parseMaxSizesPerBarByWorkshop(undefined)).toEqual({});
      expect(parseMaxSizesPerBarByWorkshop(null)).toEqual({});
      expect(parseMaxSizesPerBarByWorkshop([2])).toEqual({});
      expect(parseMaxSizesPerBarByWorkshop('x')).toEqual({});
    });
  });

  describe('workshopLabel / buildSizesRelaxNote', () => {
    it('thêm "Xưởng" khi tên chưa có, giữ nguyên khi đã có', () => {
      expect(workshopLabel('Phước An')).toBe('Xưởng Phước An');
      expect(workshopLabel('Xưởng Phước An')).toBe('Xưởng Phước An');
      expect(workshopLabel('xưởng An Dương')).toBe('xưởng An Dương');
      expect(workshopLabel(null)).toBe('Xưởng');
    });

    it('không nới (limit = start) hoặc không có luật -> null', () => {
      const base = { workshopName: 'Phước An', thresholdPct: 1 };
      expect(buildSizesRelaxNote({ ...base, start: 2, limit: 2 })).toBeNull();
      expect(buildSizesRelaxNote({ ...base, start: undefined, limit: undefined })).toBeNull();
      expect(buildSizesRelaxNote({ ...base, start: null, limit: 3 })).toBeNull();
      expect(buildSizesRelaxNote({ ...base, start: 2, limit: undefined })).toBeNull();
    });

    it('nới lên N cỡ / bỏ giới hạn', () => {
      expect(
        buildSizesRelaxNote({ workshopName: 'Phước An', start: 2, limit: 3, thresholdPct: 1 }),
      ).toBe('Xưởng Phước An tối đa 2 cỡ đoạn/cây: không đạt ngưỡng 1% nên nới lên 3 cỡ');
      expect(
        buildSizesRelaxNote({ workshopName: 'Phước An', start: 2, limit: null, thresholdPct: 1.5 }),
      ).toBe('Xưởng Phước An tối đa 2 cỡ đoạn/cây: không đạt ngưỡng 1.5% nên bỏ giới hạn số cỡ');
    });
  });

  describe('loadAvailableStockLengths', () => {
    const makePrisma = (over: Record<string, unknown> = {}) => {
      const prisma = {
        warehouse: { findMany: jest.fn().mockResolvedValue([{ id: 11n }, { id: 12n }]) },
        stockQuant: { findMany: jest.fn().mockResolvedValue([]) },
        stockReservation: { findMany: jest.fn().mockResolvedValue([]) },
        warehouseTransferReservation: { findMany: jest.fn().mockResolvedValue([]) },
        ...over,
      };
      return prisma;
    };
    const asPrisma = (p: unknown) => p as PrismaServiceType;
    const quant = (warehouseId: bigint, materialId: bigint, len: number, qty: number) => ({
      warehouseId,
      materialId,
      stockLengthMm: len,
      spec: '',
      qty: dec(qty),
    });

    it('không có vật tư nào -> không truy vấn', async () => {
      const prisma = makePrisma();
      expect((await loadAvailableStockLengths(asPrisma(prisma), [], filter)).size).toBe(0);
      expect(prisma.warehouse.findMany).not.toHaveBeenCalled();
    });

    it('không có kho Phôi nào đang hoạt động -> rỗng, không đọc tồn', async () => {
      const prisma = makePrisma({ warehouse: { findMany: jest.fn().mockResolvedValue([]) } });
      const res = await loadAvailableStockLengths(asPrisma(prisma), [200n], filter);
      expect(res.size).toBe(0);
      expect(prisma.stockQuant.findMany).not.toHaveBeenCalled();
    });

    it('chỉ lọc kho Phôi đang hoạt động (truy vấn đúng điều kiện)', async () => {
      const prisma = makePrisma();
      await loadAvailableStockLengths(asPrisma(prisma), [200n], filter);
      expect(prisma.warehouse.findMany).toHaveBeenCalledWith({
        where: { kind: 'PHOI', isActive: true, deletedAt: null },
        select: { id: true },
      });
    });

    it('khả dụng = tồn - giữ chỗ còn hiệu lực (quantity - consumedQty); cộng tồn nhiều kho; sắp tăng dần', async () => {
      const prisma = makePrisma({
        stockQuant: {
          findMany: jest.fn().mockResolvedValue([
            quant(11n, 200n, 5950, 1),
            quant(12n, 200n, 5950, 1), // kho 12 còn tự do dù kho 11 bị giữ hết
            quant(11n, 200n, 5900, 2), // giữ chỗ 2 -> hết
            quant(11n, 200n, 5800, 3), // giữ 3 đã lấy 1 -> còn 1
            quant(11n, 201n, 5700, 5),
          ]),
        },
        stockReservation: {
          findMany: jest.fn().mockResolvedValue([
            {
              warehouseId: 11n,
              materialId: 200n,
              stockLengthMm: 5950,
              spec: '',
              quantity: dec(1),
              consumedQty: dec(0),
            },
            {
              warehouseId: 11n,
              materialId: 200n,
              stockLengthMm: 5900,
              spec: '',
              quantity: dec(2),
              consumedQty: dec(0),
            },
            {
              warehouseId: 11n,
              materialId: 200n,
              stockLengthMm: 5800,
              spec: '',
              quantity: dec(3),
              consumedQty: dec(1),
            },
          ]),
        },
      });

      const res = await loadAvailableStockLengths(asPrisma(prisma), [200n, 201n], filter);

      expect(res.get('200')).toEqual([5800, 5950]);
      expect(res.get('201')).toEqual([5700]);
      // Gộp truy vấn: 1 lần mỗi bảng cho mọi vật tư.
      expect(prisma.stockQuant.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.stockReservation.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.warehouseTransferReservation.findMany).toHaveBeenCalledTimes(1);
    });

    it('giữ chỗ chuyển kho (không có chiều dài) trừ vào mọi chiều dài của (kho, vật tư)', async () => {
      const prisma = makePrisma({
        stockQuant: { findMany: jest.fn().mockResolvedValue([quant(11n, 200n, 5950, 1)]) },
        warehouseTransferReservation: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              { warehouseId: 11n, materialId: 200n, spec: '', quantity: dec(1) },
            ]),
        },
      });
      const res = await loadAvailableStockLengths(asPrisma(prisma), [200n], filter);
      expect(res.has('200')).toBe(false);
    });

    it('bỏ chiều dài không bội 50 / ngoài dải / chuẩn / chưa đủ 1 cây', async () => {
      const prisma = makePrisma({
        stockQuant: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              quant(11n, 200n, 5925, 9),
              quant(11n, 200n, 3500, 9),
              quant(11n, 200n, 6000, 9),
              quant(11n, 200n, 5500, 0.5),
              quant(11n, 200n, 5600, 1),
            ]),
        },
      });
      const res = await loadAvailableStockLengths(asPrisma(prisma), [200n], filter);
      expect(res.get('200')).toEqual([5600]);
    });
  });
});
