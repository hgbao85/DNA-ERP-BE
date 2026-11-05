import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { ProductionCapacityService } from './production-capacity.service';

const d = (day: string) => new Date(`${day}T00:00:00.000Z`);

describe('ProductionCapacityService', () => {
  // 09:00 sáng 10/11 giờ VN.
  const NOW = new Date('2026-11-10T02:00:00.000Z');
  let prisma: {
    systemConfig: { findUnique: jest.Mock };
    productionInvoiceItem: { findMany: jest.Mock };
    productionInvoice: { findMany: jest.Mock };
    workshop: { findMany: jest.Mock };
  };
  let service: ProductionCapacityService;

  const PHU_AN = {
    code: 'PHU_AN',
    name: 'Xưởng Phú An',
    capacityMode: 'CONT_PER_DAY',
    paintWorkshop: null,
  };

  const row = (
    id: bigint,
    stages: Record<string, string>,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    productionInvoiceId: 7n,
    quantity: 240,
    warehouseCode: null,
    warehouseName: null,
    mfgProduct: { factoryCode: `SKU-${id}`, loadCont: 80 },
    workshop: PHU_AN,
    stages: Object.entries(stages).map(([stageType, day]) => ({ stageType, deadline: d(day) })),
    ...extra,
  });

  beforeEach(() => {
    prisma = {
      systemConfig: {
        findUnique: jest.fn().mockResolvedValue({
          capacityContPerDay: new Prisma.Decimal(1.3),
          daysPerContPhuocAn: 4,
        }),
      },
      productionInvoiceItem: { findMany: jest.fn().mockResolvedValue([]) },
      productionInvoice: {
        findMany: jest.fn().mockResolvedValue([{ id: 7n, code: 'PI-7', lsxCode: 'MY-313' }]),
      },
      workshop: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new ProductionCapacityService(prisma as never);
  });

  describe('getBoard', () => {
    it('mặc định from = hôm nay VN, to = from + 13', async () => {
      const board = await service.getBoard(undefined, undefined, NOW);
      expect(board.from).toBe('2026-11-10');
      expect(board.to).toBe('2026-11-23');
      expect(board.capacityContPerDay).toBe(1.3);
      expect(board.daysPerContPhuocAn).toBe(4);
      expect(board.rows).toEqual([]);
    });

    it('báo 400 khi sai dạng ngày, from > to, hoặc quá 62 ngày', async () => {
      await expect(service.getBoard('10-11-2026', undefined, NOW)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.getBoard('2026-02-30', undefined, NOW)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.getBoard('2026-11-10', 'abc', NOW)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.getBoard('2026-11-10', '2026-11-09', NOW)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.getBoard('2026-11-01', '2026-01-02', NOW)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.getBoard('2026-11-01', '2027-01-03', NOW)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      // đúng 62 ngày thì được
      await expect(service.getBoard('2026-11-01', '2027-01-01', NOW)).resolves.toBeDefined();
    });

    it('gom cont các lệnh đang chạy và cảnh báo vượt trần', async () => {
      const stages = { PHOI_START: '2026-11-12', FRAME_PHOI: '2026-11-12' };
      prisma.productionInvoiceItem.findMany.mockResolvedValue([
        row(1n, stages, { quantity: 80 }),
        row(2n, stages, { quantity: 40 }),
      ]);
      const board = await service.getBoard('2026-11-10', '2026-11-14', NOW);
      const phoi = board.rows.find((r) => r.stage === 'PHOI')!;
      expect(phoi.days).toHaveLength(5);
      expect(phoi.days.find((x) => x.day === '2026-11-12')!.cont).toBe(1.5);
      expect(board.warnings).toHaveLength(1);
      expect(board.warnings[0].message).toContain('1,5 cont > 1,3');
    });

    it('liệt kê dòng thiếu load cont', async () => {
      prisma.productionInvoiceItem.findMany.mockResolvedValue([
        row(
          1n,
          { FRAME_PHOI: '2026-11-12' },
          { mfgProduct: { factoryCode: 'SKU-X', loadCont: null } },
        ),
      ]);
      const board = await service.getBoard('2026-11-10', '2026-11-14', NOW);
      expect(board.rows).toEqual([]);
      expect(board.missingLoadCont.map((m) => m.itemId)).toEqual(['1']);
    });
  });

  describe('check', () => {
    // Lần gọi findMany thứ nhất = loadCapacityItems, thứ hai = loadItemsByIds.
    const mockLoads = (running: unknown[], tried: unknown[]) => {
      prisma.productionInvoiceItem.findMany.mockImplementation(
        (args: { where: { id?: unknown } }) => Promise.resolve(args.where.id ? tried : running),
      );
    };

    it('chỉ trả cảnh báo của dòng thử, thay đúng mốc, bỏ bản cũ của dòng thử khỏi tập đang chạy', async () => {
      const other = row(
        2n,
        { PHOI_START: '2026-11-12', FRAME_PHOI: '2026-11-12' },
        { quantity: 80 },
      ); // 1 cont ngày 12
      const unrelated = row(
        3n,
        { PHOI_START: '2026-11-20', FRAME_PHOI: '2026-11-20' },
        { quantity: 200 },
      ); // 2,5 cont ngày 20 (over, nhưng không liên quan)
      const unrelated2 = row(
        4n,
        { PHOI_START: '2026-11-20', FRAME_PHOI: '2026-11-20' },
        { quantity: 200 },
      );
      const oldTried = row(
        1n,
        { PHOI_START: '2026-11-25', FRAME_PHOI: '2026-11-25' },
        { quantity: 80 },
      );
      mockLoads([oldTried, other, unrelated, unrelated2], [oldTried]);

      const res = await service.check([
        { itemId: '1', stages: { PHOI_START: '2026-11-12', FRAME_PHOI: '2026-11-12' } },
      ]);
      expect(res.warnings).toHaveLength(1);
      expect(res.warnings[0].day).toBe('2026-11-12');
      expect(res.warnings[0].itemIds).toEqual(['1', '2']);
      expect(res.warnings[0].message).toContain('2 cont > 1,3');
      expect(res.missingLoadCont).toEqual([]);
    });

    it('mốc không gửi thì dùng ngày đã lưu', async () => {
      const other = row(
        2n,
        { PHOI_START: '2026-11-12', FRAME_PHOI: '2026-11-12' },
        { quantity: 80 },
      );
      const tried = row(
        1n,
        { PHOI_START: '2026-11-12', FRAME_PHOI: '2026-11-12' },
        { quantity: 80 },
      );
      mockLoads([tried, other], [tried]);
      const res = await service.check([{ itemId: '1', stages: {} }]);
      expect(res.warnings).toHaveLength(1);
    });

    it('đổi sang xưởng Phước An thì kiểm theo chồng lệnh', async () => {
      const other = row(
        2n,
        { PHOI_START: '2026-11-10', FRAME_PHOI: '2026-11-13' },
        {
          workshop: {
            code: 'PHUOC_AN',
            name: 'Xưởng Phước An',
            capacityMode: 'DAYS_PER_CONT',
            paintWorkshop: PHU_AN,
          },
          quantity: 80,
          productionInvoiceId: 8n, // lệnh SX khác - Phước An đếm chồng theo lệnh, không theo dòng
        },
      );
      const tried = row(1n, { PHOI_START: '2026-11-12' });
      mockLoads([other], [tried]);
      prisma.workshop.findMany.mockResolvedValue([
        {
          id: 9n,
          code: 'PHUOC_AN',
          name: 'Xưởng Phước An',
          capacityMode: 'DAYS_PER_CONT',
          isActive: true,
          paintWorkshop: PHU_AN,
        },
      ]);
      const res = await service.check([{ itemId: '1', workshopId: '9' }]);
      const phoi = res.warnings.find((w) => w.stage === 'PHOI');
      expect(phoi).toBeDefined();
      expect(phoi!.groupCode).toBe('PHUOC_AN');
      expect(phoi!.message).toContain('lệnh cùng chiếm ngày');
    });

    it('xưởng không tồn tại hoặc ngừng dùng -> 400', async () => {
      mockLoads([], [row(1n, {})]);
      prisma.workshop.findMany.mockResolvedValue([]);
      await expect(service.check([{ itemId: '1', workshopId: '99' }])).rejects.toBeInstanceOf(
        BadRequestException,
      );
      prisma.workshop.findMany.mockResolvedValue([
        {
          id: 99n,
          code: 'X',
          name: 'X',
          capacityMode: 'CONT_PER_DAY',
          isActive: false,
          paintWorkshop: null,
        },
      ]);
      await expect(service.check([{ itemId: '1', workshopId: '99' }])).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('ngày mốc sai dạng, dòng không tồn tại -> 400', async () => {
      mockLoads([], [row(1n, {})]);
      await expect(
        service.check([{ itemId: '1', stages: { PACKAGING: '2026-13-01' } }]),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.check([{ itemId: '5' }])).rejects.toBeInstanceOf(BadRequestException);
    });

    it('thử kho đóng gói: dùng mã kho; cùng mã kho đã lưu thì giữ tên', async () => {
      const other = row(
        2n,
        { PACKAGING_START: '2026-11-20', PACKAGING: '2026-11-22' },
        {
          quantity: 240,
          warehouseCode: 'KHO_A',
          warehouseName: 'Kho A',
        },
      );
      const tried = row(
        1n,
        { PACKAGING_START: '2026-11-20', PACKAGING: '2026-11-22' },
        {
          quantity: 240,
          warehouseCode: null,
        },
      );
      mockLoads([other], [tried]);
      const res = await service.check([{ itemId: '1', warehouseCode: 'KHO_A' }]);
      expect(res.warnings.length).toBeGreaterThan(0);
      expect(res.warnings[0].groupKind).toBe('WAREHOUSE');
      expect(res.warnings[0].groupName).toBe('Kho A');
    });

    it('missingLoadCont chỉ của dòng thử', async () => {
      const running = row(
        3n,
        { FRAME_PHOI: '2026-11-12' },
        { mfgProduct: { factoryCode: 'SKU-3', loadCont: null } },
      );
      const tried = row(
        1n,
        { FRAME_PHOI: '2026-11-12' },
        { mfgProduct: { factoryCode: 'SKU-1', loadCont: null } },
      );
      mockLoads([running, tried], [tried]);
      const res = await service.check([{ itemId: '1' }]);
      expect(res.warnings).toEqual([]);
      expect(res.missingLoadCont.map((m) => m.itemId)).toEqual(['1']);
    });
  });
});
