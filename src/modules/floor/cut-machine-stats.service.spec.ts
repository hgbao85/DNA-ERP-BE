import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type {
  WorkshopScope,
  WorkshopScopeService,
} from '../../common/workshop-scope/workshop-scope.service';
import type { PrismaServiceType } from '../../prisma/prisma.service';
import { CutMachineStatsService } from './cut-machine-stats.service';

const vn = (ymd: string, hm: string) => new Date(`${ymd}T${hm}:00+07:00`);
type FindManyArgs = { where: Record<string, unknown> & { OR: unknown[]; status: string } };
const whereOf = (m: jest.Mock): FindManyArgs['where'] =>
  (m.mock.calls[0] as [FindManyArgs])[0].where;
const dayStart = (ymd: string) => new Date(`${ymd}T00:00:00+07:00`);

describe('CutMachineStatsService', () => {
  const PHU_AN = { id: 5n, code: 'PHU_AN', name: 'Phú An', isActive: true };
  const unscoped: WorkshopScope = {
    workshopId: null,
    workshopName: null,
    visibleWorkshopIds: null,
  };
  const scopedPhuAn: WorkshopScope = {
    workshopId: 5n,
    workshopName: 'Phú An',
    visibleWorkshopIds: [5n],
  };

  let scope: WorkshopScope;
  let workshop: typeof PHU_AN | null;
  let machines: Array<Record<string, unknown>>;
  let reports: Array<Record<string, unknown>>;
  let proposals: Array<Record<string, unknown>>;
  let db: {
    workshop: { findUnique: jest.Mock };
    systemConfig: { findUnique: jest.Mock };
    workstation: { findMany: jest.Mock };
    floorReport: { findMany: jest.Mock };
    cuttingProposal: { findMany: jest.Mock };
  };
  let service: CutMachineStatsService;

  const reportRow = (over: Record<string, unknown> = {}) => ({
    workstationId: 1n,
    createdAt: vn('2026-11-10', '08:00'),
    productionInvoiceId: 100n,
    lines: [
      {
        qty: 100,
        segmentSpec: {
          materialId: 7n,
          cutLengthMm: { toString: () => '1000.0', valueOf: () => 1000 },
          material: { name: 'Sắt hộp', spec: '25x50' },
        },
      },
    ],
    ...over,
  });

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(vn('2026-11-14', '10:00'));
    scope = scopedPhuAn;
    workshop = PHU_AN;
    machines = [
      { id: 1n, code: 'L1', name: 'Laze 1', cutMachineType: 'laser', isActive: true },
      { id: 2n, code: 'T1', name: 'Tự động 1', cutMachineType: 'tu_dong', isActive: false },
    ];
    reports = [reportRow()];
    proposals = [];
    db = {
      workshop: { findUnique: jest.fn(() => Promise.resolve(workshop)) },
      systemConfig: {
        findUnique: jest.fn().mockResolvedValue({
          solverStockLengths: [6000, 12000],
          solverBladeWidthMm: 1,
          solverTrimStartMm: 10,
          solverMctdBladeWidthMm: 2.5,
          solverMctdTrimStartMm: 10,
        }),
      },
      workstation: { findMany: jest.fn(() => Promise.resolve(machines)) },
      floorReport: { findMany: jest.fn(() => Promise.resolve(reports)) },
      cuttingProposal: { findMany: jest.fn(() => Promise.resolve(proposals)) },
    };
    const scopeSvc = { getScope: jest.fn(() => Promise.resolve(scope)) };
    service = new CutMachineStatsService(
      db as unknown as PrismaServiceType,
      scopeSvc as unknown as WorkshopScopeService,
    );
  });

  afterEach(() => jest.useRealTimers());

  describe('phạm vi xưởng', () => {
    it('QLSX gắn xưởng gửi xưởng khác -> 403', async () => {
      await expect(service.getStats('u1', { workshopId: '9' })).rejects.toThrow(ForbiddenException);
      expect(db.floorReport.findMany).not.toHaveBeenCalled();
    });

    it('QLSX gắn xưởng không gửi workshopId (hoặc gửi đúng xưởng mình) -> xưởng của mình', async () => {
      const a = await service.getStats('u1', {});
      const b = await service.getStats('u1', { workshopId: '5' });
      expect(a.workshop).toEqual({ id: '5', code: 'PHU_AN', name: 'Phú An' });
      expect(b.workshop.id).toBe('5');
      expect(db.workshop.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 5n } }),
      );
    });

    it('người không gắn xưởng thiếu workshopId -> 400', async () => {
      scope = unscoped;
      await expect(service.getStats('boss', {})).rejects.toThrow(
        new BadRequestException('Chọn xưởng để xem năng suất máy cắt'),
      );
    });

    it('người không gắn xưởng chọn xưởng -> xem được xưởng đó', async () => {
      scope = unscoped;
      const r = await service.getStats('boss', { workshopId: '5' });
      expect(r.workshop.id).toBe('5');
    });

    it('xưởng không tồn tại hoặc đã ngừng -> 400', async () => {
      scope = unscoped;
      workshop = null;
      await expect(service.getStats('boss', { workshopId: '5' })).rejects.toThrow(
        'Xưởng không tồn tại hoặc đã ngừng hoạt động',
      );
      workshop = { ...PHU_AN, isActive: false };
      await expect(service.getStats('boss', { workshopId: '5' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('khoảng ngày (giờ VN)', () => {
    it('mặc định 14 ngày kết thúc hôm nay', async () => {
      const r = await service.getStats('u1', {});
      expect(r.range).toEqual({
        from: '2026-11-01',
        to: '2026-11-14',
        timezone: 'Asia/Ho_Chi_Minh',
      });
      const where = whereOf(db.floorReport.findMany);
      expect(where.createdAt).toEqual({ gte: dayStart('2026-11-01'), lt: dayStart('2026-11-15') });
    });

    it('chỉ gửi to thì from = to - 13 ngày', async () => {
      const r = await service.getStats('u1', { to: '2026-03-05' });
      expect(r.range.from).toBe('2026-02-20');
    });

    it('from > to -> 400; sai dạng/ngày không có thật -> 400', async () => {
      await expect(
        service.getStats('u1', { from: '2026-11-10', to: '2026-11-01' }),
      ).rejects.toThrow('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc');
      await expect(
        service.getStats('u1', { from: '2026-02-30', to: '2026-03-05' }),
      ).rejects.toThrow('Ngày không hợp lệ');
      await expect(service.getStats('u1', { to: 'abc' })).rejects.toThrow(BadRequestException);
    });

    it('dài hơn 62 ngày -> 400; đúng 62 ngày thì được', async () => {
      await expect(
        service.getStats('u1', { from: '2026-09-01', to: '2026-11-14' }),
      ).rejects.toThrow('Xem tối đa 62 ngày - chọn khoảng ngắn hơn');
      await expect(
        service.getStats('u1', { from: '2026-09-14', to: '2026-11-14' }),
      ).resolves.toBeDefined(); // 18 + 31 + 14 - ... = 62 ngày
    });
  });

  describe('truy vấn', () => {
    it('lần báo: CUT, đúng máy của xưởng, bỏ dòng Hoàn tác và lần đã bị Hoàn tác', async () => {
      await service.getStats('u1', {});
      expect(db.workstation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { workshopId: 5n, kind: 'CUT' } }),
      );
      const where = whereOf(db.floorReport.findMany);
      expect(where).toMatchObject({
        kind: 'CUT',
        workstationId: { in: [1n, 2n] },
        reversalOfId: null,
        reversedBy: null,
      });
    });

    it('xưởng chưa có máy cắt: không truy vấn lần báo/phương án, trả rỗng', async () => {
      machines = [];
      const r = await service.getStats('u1', {});
      expect(r.machines).toEqual([]);
      expect(r.days).toEqual([]);
      expect(db.floorReport.findMany).not.toHaveBeenCalled();
      expect(db.cuttingProposal.findMany).not.toHaveBeenCalled();
    });

    it('tối đa 4 truy vấn dữ liệu, không N+1 (nhiều lần báo cùng PI vẫn 1 truy vấn phương án)', async () => {
      reports = [
        reportRow(),
        reportRow({ createdAt: vn('2026-11-10', '09:00') }),
        reportRow({ productionInvoiceId: 101n }),
      ];
      await service.getStats('u1', {});
      expect(db.systemConfig.findUnique).toHaveBeenCalledTimes(1);
      expect(db.workstation.findMany).toHaveBeenCalledTimes(1);
      expect(db.floorReport.findMany).toHaveBeenCalledTimes(1);
      expect(db.cuttingProposal.findMany).toHaveBeenCalledTimes(1);
      const where = whereOf(db.cuttingProposal.findMany);
      expect(where.status).toBe('APPROVED');
      expect(where.OR[0]).toEqual({ productionInvoiceId: { in: [100n, 101n] } });
      expect(where.OR[1]).toEqual({
        productionOrder: { productionInvoiceItem: { productionInvoiceId: { in: [100n, 101n] } } },
      });
    });

    it('lần báo không gắn PI: không truy vấn phương án, dùng chiều dài mặc định', async () => {
      reports = [reportRow({ productionInvoiceId: null })];
      const r = await service.getStats('u1', {});
      expect(db.cuttingProposal.findMany).not.toHaveBeenCalled();
      expect(r.days[0].bars).toBe(Math.round(((100 * 1001) / 5990) * 10) / 10);
    });
  });

  describe('kết quả', () => {
    it('chiều dài cây lấy từ phương án (neo PI hoặc neo PO), phương án đầu tiên có giá trị thắng', async () => {
      proposals = [
        {
          productionInvoiceId: 100n,
          productionOrder: null,
          lines: [{ materialId: 7n, bestStockLengthMm: 12000 }],
        },
        {
          productionInvoiceId: 100n,
          productionOrder: null,
          lines: [{ materialId: 7n, bestStockLengthMm: 6000 }],
        },
      ];
      const r = await service.getStats('u1', {});
      expect(r.days[0].bars).toBe(Math.round(((100 * 1001) / 11990) * 10) / 10); // 8,3

      proposals = [
        {
          productionInvoiceId: null,
          productionOrder: { productionInvoiceItem: { productionInvoiceId: 100n } },
          lines: [{ materialId: 7n, bestStockLengthMm: 12000 }],
        },
      ];
      const po = await service.getStats('u1', {});
      expect(po.days[0].bars).toBe(8.3);
    });

    it('trả đủ khối: workshop, method (mặc định cây = phần tử đầu solverStockLengths), machines kể cả máy chưa có số, bigint là chuỗi', async () => {
      const r = await service.getStats('u1', {});
      expect(r.method).toEqual({
        lunchBreak: { from: '11:30', to: '13:00' },
        maxGapMinutes: 120,
        minRateMinutes: 30,
        defaultBarLengthMm: 6000,
        blade: { laser: 1, tu_dong: 2.5 },
        trim: { laser: 10, tu_dong: 10 },
      });
      expect(r.machines).toEqual([
        { id: '1', code: 'L1', name: 'Laze 1', machineType: 'laser', isActive: true },
        { id: '2', code: 'T1', name: 'Tự động 1', machineType: 'tu_dong', isActive: false },
      ]);
      expect(r.days).toHaveLength(1);
      expect(r.days[0]).toMatchObject({
        machineId: '1',
        day: '2026-11-10',
        reports: 1,
        segments: 100,
        meters: 100,
        materials: [{ materialId: '7', label: 'Sắt hộp · 25x50', bars: 16.7 }],
      });
      expect(r.byMachine.map((m) => m.machineId)).toEqual(['1']);
      expect(typeof r.generatedAt).toBe('string');
    });

    it('chiều dài mặc định: solverStockLengths rỗng/không phải số -> 6000; cutMachineType null coi là laser', async () => {
      db.systemConfig.findUnique.mockResolvedValue({
        solverStockLengths: [],
        solverBladeWidthMm: 1,
        solverTrimStartMm: 10,
        solverMctdBladeWidthMm: 2.5,
        solverMctdTrimStartMm: 10,
      });
      machines = [{ id: 1n, code: 'L1', name: 'Laze 1', cutMachineType: null, isActive: true }];
      const r = await service.getStats('u1', {});
      expect(r.method.defaultBarLengthMm).toBe(6000);
      expect(r.machines[0].machineType).toBe('laser');

      db.systemConfig.findUnique.mockResolvedValue({
        solverStockLengths: [9000],
        solverBladeWidthMm: 1,
        solverTrimStartMm: 10,
        solverMctdBladeWidthMm: 2.5,
        solverMctdTrimStartMm: 10,
      });
      expect((await service.getStats('u1', {})).method.defaultBarLengthMm).toBe(9000);
    });

    it('dòng không có segmentSpec bị bỏ', async () => {
      reports = [reportRow({ lines: [{ qty: 5, segmentSpec: null }] })];
      const r = await service.getStats('u1', {});
      expect(r.days).toEqual([]);
    });
  });
});
