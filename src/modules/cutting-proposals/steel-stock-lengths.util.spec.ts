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
    // Kho mặc định của SAT 200/201 là kho Phôi 11 của xưởng 3 (đúng xưởng làm lệnh -> resolver giữ nguyên, không tra thêm).
    const phoi = (id: bigint, workshopId: bigint) => ({
      id,
      code: `phoi-${id}`,
      kind: 'PHOI',
      workshopId,
    });
    const makePrisma = (over: Record<string, unknown> = {}) => {
      const prisma = {
        material: {
          findMany: jest.fn().mockResolvedValue([
            { id: 200n, warehouse: phoi(11n, 3n) },
            { id: 201n, warehouse: phoi(11n, 3n) },
          ]),
        },
        warehouse: { findFirst: jest.fn().mockResolvedValue(null) },
        productionInvoiceItem: { findFirst: jest.fn() },
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
    const resv = (warehouseId: bigint, len: number, quantity: number, consumed: number) => ({
      warehouseId,
      materialId: 200n,
      stockLengthMm: len,
      spec: '',
      quantity: dec(quantity),
      consumedQty: dec(consumed),
    });

    it('không có vật tư nào -> không truy vấn', async () => {
      const prisma = makePrisma();
      expect((await loadAvailableStockLengths(asPrisma(prisma), [], filter, 3n)).size).toBe(0);
      expect(prisma.material.findMany).not.toHaveBeenCalled();
    });

    it('CS2: chưa biết xưởng làm lệnh -> rỗng, không truy vấn gì', async () => {
      const prisma = makePrisma();
      expect((await loadAvailableStockLengths(asPrisma(prisma), [200n], filter, null)).size).toBe(
        0,
      );
      expect(prisma.material.findMany).not.toHaveBeenCalled();
    });

    it('vật tư chưa gán kho -> rỗng, không đọc tồn', async () => {
      const prisma = makePrisma({
        material: { findMany: jest.fn().mockResolvedValue([{ id: 200n, warehouse: null }]) },
      });
      expect((await loadAvailableStockLengths(asPrisma(prisma), [200n], filter, 3n)).size).toBe(0);
      expect(prisma.stockQuant.findMany).not.toHaveBeenCalled();
    });

    // Review Sang 21/11: lúc tính cộng mọi kho Phôi của xưởng + mọi quy cách, lúc duyệt chỉ đọc 1 kho + quy cách rỗng -> 409 lặp mãi.
    it('đọc ĐÚNG kho approve() dùng (kho mặc định resolve theo xưởng) và chỉ ô quy cách rỗng', async () => {
      const prisma = makePrisma({
        material: {
          findMany: jest.fn().mockResolvedValue([{ id: 200n, warehouse: phoi(6n, 1n) }]),
        },
        warehouse: { findFirst: jest.fn().mockResolvedValue(phoi(21n, 3n)) },
        stockQuant: {
          findMany: jest.fn().mockResolvedValue([
            quant(21n, 200n, 5800, 2),
            quant(6n, 200n, 5650, 4), // kho Phôi xưởng khác - không tính
          ]),
        },
      });
      const res = await loadAvailableStockLengths(asPrisma(prisma), [200n], filter, 3n);
      expect(res.get('200')).toEqual([{ length: 5800, count: 2 }]);
      expect(prisma.warehouse.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ kind: 'PHOI', workshopId: 3n }) as unknown,
        }),
      );
      expect(prisma.stockQuant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ warehouseId: { in: [21n] }, spec: '' }) as unknown,
        }),
      );
      expect(prisma.stockReservation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ spec: '' }) as unknown }),
      );
    });

    it('xưởng làm lệnh chưa có kho Phôi -> ném lỗi (nơi gọi bắt, tính như không có cây lẻ)', async () => {
      const prisma = makePrisma({
        material: {
          findMany: jest.fn().mockResolvedValue([{ id: 200n, warehouse: phoi(6n, 1n) }]),
        },
      });
      await expect(loadAvailableStockLengths(asPrisma(prisma), [200n], filter, 3n)).rejects.toThrow(
        /chưa có kho/,
      );
    });

    it('khả dụng = tồn - giữ chỗ còn hiệu lực (quantity - consumedQty); sắp tăng dần; gộp truy vấn', async () => {
      const prisma = makePrisma({
        stockQuant: {
          findMany: jest.fn().mockResolvedValue([
            quant(11n, 200n, 5950, 1), // giữ 1 -> hết
            quant(11n, 200n, 5900, 2), // giữ chỗ 2 -> hết
            quant(11n, 200n, 5800, 3), // giữ 3 đã lấy 1 -> còn 1
            quant(11n, 201n, 5700, 5),
          ]),
        },
        stockReservation: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              resv(11n, 5950, 1, 0),
              resv(11n, 5900, 2, 0),
              resv(11n, 5800, 3, 1),
            ]),
        },
      });

      const res = await loadAvailableStockLengths(asPrisma(prisma), [200n, 201n], filter, 3n);

      expect(res.get('200')).toEqual([{ length: 5800, count: 1 }]);
      expect(res.get('201')).toEqual([{ length: 5700, count: 5 }]);
      expect(prisma.stockQuant.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.stockReservation.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.warehouseTransferReservation.findMany).toHaveBeenCalledTimes(1);
    });

    // Review Sang 21/11: "Tính lại" không được coi cây lẻ chính lệnh đang giữ (qua phương án sắp bị thay) là của lệnh khác.
    it('excludeCuttingProposalIds: không trừ giữ chỗ của phương án cũ cùng lệnh sắp bị thay', async () => {
      const prisma = makePrisma();
      await loadAvailableStockLengths(asPrisma(prisma), [200n], filter, 3n, {
        excludeCuttingProposalIds: [77n, 78n],
      });
      expect(prisma.stockReservation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            NOT: { refType: 'CUTTING_PROPOSAL', refId: { in: ['77', '78'] } },
          }) as unknown,
        }),
      );
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
      const res = await loadAvailableStockLengths(asPrisma(prisma), [200n], filter, 3n);
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
      const res = await loadAvailableStockLengths(asPrisma(prisma), [200n], filter, 3n);
      expect(res.get('200')).toEqual([{ length: 5600, count: 1 }]);
    });
  });
});
