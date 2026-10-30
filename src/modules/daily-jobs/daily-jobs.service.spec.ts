import { ConflictException } from '@nestjs/common';
import {
  MilestoneBoard,
  MilestoneCell,
  MilestoneRow,
  MissingMaterial,
} from '../milestone-board/milestone-board.service';
import {
  MILESTONES,
  MilestoneKey,
  MilestoneStatus,
} from '../milestone-board/milestone-board.rules';
import { DailyJobsService, vnHour } from './daily-jobs.service';

const cell = (
  key: MilestoneKey,
  status: MilestoneStatus,
  daysLeft: number | null,
  extra: Partial<MilestoneCell> = {},
): MilestoneCell => ({
  key,
  label: MILESTONES.find((m) => m.key === key)!.label,
  deadline: daysLeft === null ? null : '2026-10-30',
  status,
  daysLeft,
  percent: 0,
  need: 0,
  done: 0,
  reason: null,
  ...extra,
});

const row = (
  itemId: string,
  cells: MilestoneCell[],
  extra: Partial<MilestoneRow> = {},
): MilestoneRow => ({
  itemId,
  piId: '7',
  piCode: 'PI-2026-001',
  productionOrderId: `${itemId}0`,
  skuCode: `SKU-${itemId}`,
  skuName: null,
  quantity: 50,
  floorStage: 'ACTIVE',
  milestones: MILESTONES.map(
    (m) => cells.find((c) => c.key === m.key) ?? cell(m.key, 'NO_DEADLINE', null),
  ),
  worst: 'LATE',
  missing: { MUA_VT_KHUNG: [], MUA_VT_CON_LAI: [] },
  ...extra,
});

const mat = (
  materialId: string,
  name: string,
  buyerId: string | null,
  warehouseCode: string | null,
  lineId = `line-${materialId}`,
): MissingMaterial => ({
  lineId,
  materialId,
  name,
  unit: 'kg',
  buyQty: 100,
  receivedQty: 40,
  warehouseCode,
  buyerId,
});

const boardOf = (rows: MilestoneRow[]): MilestoneBoard => ({
  today: '2026-10-29',
  generatedAt: '',
  failedSources: [],
  rows,
});

describe('DailyJobsService', () => {
  // 08:00 sáng 29/10 giờ VN = 01:00 UTC.
  const MORNING = new Date('2026-10-29T01:00:00.000Z');
  // 06:30 sáng giờ VN.
  const EARLY = new Date('2026-10-28T23:30:00.000Z');
  let tx: { $queryRaw: jest.Mock };
  let prisma: {
    $transaction: jest.Mock;
    dataHealthRun: { findFirst: jest.Mock };
    notification: { findMany: jest.Mock };
  };
  let dataHealth: { run: jest.Mock };
  let board: { getBoard: jest.Mock };
  let notifications: { emit: jest.Mock; resolve: jest.Mock };
  let service: DailyJobsService;

  beforeEach(() => {
    tx = { $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]) };
    prisma = {
      $transaction: jest
        .fn()
        .mockImplementation((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      dataHealthRun: { findFirst: jest.fn().mockResolvedValue(null) },
      notification: { findMany: jest.fn().mockResolvedValue([]) },
    };
    dataHealth = { run: jest.fn().mockResolvedValue({}) };
    board = { getBoard: jest.fn().mockResolvedValue(boardOf([])) };
    notifications = {
      emit: jest.fn().mockResolvedValue(undefined),
      resolve: jest.fn().mockResolvedValue(undefined),
    };
    service = new DailyJobsService(
      prisma as never,
      dataHealth as never,
      board as never,
      notifications as never,
    );
  });

  it('vnHour theo giờ VN', () => {
    expect(vnHour(MORNING)).toBe(8);
    expect(vnHour(EARLY)).toBe(6);
  });

  describe('tick', () => {
    it('lấy được khoá -> chạy đủ các bước; 1 bước lỗi không chặn bước sau', async () => {
      prisma.dataHealthRun.findFirst.mockRejectedValue(new Error('db'));
      await service.tick(MORNING);
      expect(board.getBoard).toHaveBeenCalled();
    });

    it('tiến trình khác đang giữ khoá (deploy chồng / nhiều instance) -> bỏ qua lần này', async () => {
      tx.$queryRaw.mockResolvedValue([{ locked: false }]);
      await service.tick(MORNING);
      expect(prisma.dataHealthRun.findFirst).not.toHaveBeenCalled();
      expect(board.getBoard).not.toHaveBeenCalled();
    });

    it('lỗi mở transaction không làm sập tiến trình', async () => {
      prisma.$transaction.mockRejectedValue(new Error('pool timeout'));
      await expect(service.tick(MORNING)).resolves.toBeUndefined();
    });
  });

  describe('kiểm tra dữ liệu 1 lần/ngày', () => {
    it('hôm nay chưa có lần tự chạy ĐÃ XONG -> chạy, tra theo 00:00 giờ VN', async () => {
      await service.runDataHealthIfDue(MORNING);
      expect(prisma.dataHealthRun.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            trigger: 'CRON',
            startedAt: { gte: new Date('2026-10-28T17:00:00.000Z') },
            finishedAt: { not: null },
          },
        }),
      );
      expect(dataHealth.run).toHaveBeenCalledWith('CRON');
    });

    it('đã chạy xong hôm nay -> bỏ qua', async () => {
      prisma.dataHealthRun.findFirst.mockResolvedValue({ id: 1n });
      await service.runDataHealthIfDue(MORNING);
      expect(dataHealth.run).not.toHaveBeenCalled();
    });

    it('Admin đang bấm "Kiểm ngay" (409) -> nuốt lỗi, lần sau kiểm lại', async () => {
      dataHealth.run.mockRejectedValue(new ConflictException());
      await expect(service.runDataHealthIfDue(MORNING)).resolves.toBeUndefined();
    });
  });

  describe('tin sáng', () => {
    const lateBoard = boardOf([
      row('1', [cell('MUA_VT_KHUNG', 'LATE', -2), cell('PHOI', 'DUE_SOON', 1)], {
        missing: { MUA_VT_KHUNG: [mat('31', 'Sơn', 'b1', 'phoi-son-han')], MUA_VT_CON_LAI: [] },
      }),
    ]);

    it('trước 07:00 giờ VN không gửi', async () => {
      await service.sendDigestsIfDue(lateBoard, EARLY);
      expect(notifications.emit).not.toHaveBeenCalled();
    });

    it('sau 07:00: tin vật tư riêng cho NV mua và cho kho, tin tiến độ cho KHSX+QLSX; không gửi lại trong ngày', async () => {
      await service.sendDigestsIfDue(lateBoard, MORNING);
      expect(notifications.resolve).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'MORNING_DIGEST', entityId: 'materials' }),
      );
      expect(notifications.emit).toHaveBeenCalledWith(
        'MORNING_MATERIALS_DIGEST',
        expect.objectContaining({
          dedupeKey: 'MORNING_MATERIALS_DIGEST:2026-10-29:u:b1',
          params: expect.objectContaining({
            late: 1,
            buyerIds: ['b1'],
            warehouseCodes: [],
          }) as unknown,
        }),
      );
      expect(notifications.emit).toHaveBeenCalledWith(
        'MORNING_MATERIALS_DIGEST',
        expect.objectContaining({
          dedupeKey: 'MORNING_MATERIALS_DIGEST:2026-10-29:w:phoi-son-han',
          params: expect.objectContaining({
            buyerIds: [],
            warehouseCodes: ['phoi-son-han'],
          }) as unknown,
        }),
      );
      expect(notifications.emit).toHaveBeenCalledWith(
        'MORNING_PRODUCTION_DIGEST',
        expect.objectContaining({
          params: expect.objectContaining({ late: 1, dueSoon: 1, notStarted: 0 }) as unknown,
        }),
      );
      notifications.emit.mockClear();
      await service.sendDigestsIfDue(lateBoard, new Date('2026-10-29T05:00:00.000Z'));
      expect(notifications.emit).not.toHaveBeenCalled();
    });

    it('khởi động lại trong ngày: chỉ gửi tin người nhận nào CHƯA có, không đóng nhầm tin hôm nay đã gửi', async () => {
      prisma.notification.findMany.mockResolvedValue([
        { dedupeKey: 'MORNING_MATERIALS_DIGEST:2026-10-29:u:b1' },
        { dedupeKey: 'MORNING_PRODUCTION_DIGEST:2026-10-29' },
      ]);
      await service.sendDigestsIfDue(lateBoard, MORNING);
      expect(notifications.resolve).not.toHaveBeenCalled();
      expect(notifications.emit).toHaveBeenCalledTimes(1);
      expect(
        (notifications.emit.mock.calls[0] as [string, { dedupeKey: string }])[1].dedupeKey,
      ).toBe('MORNING_MATERIALS_DIGEST:2026-10-29:w:phoi-son-han');
    });

    it('không có gì để báo thì không gửi', async () => {
      await service.sendDigestsIfDue(boardOf([row('1', [cell('PHOI', 'ON_TRACK', 5)])]), MORNING);
      expect(notifications.emit).not.toHaveBeenCalled();
    });

    it('vật tư mua chung cả PI (có ở mọi SKU) chỉ đếm 1 lần, lấy hạn gấp nhất', () => {
      const shared = mat('30', 'Sắt', 'b1', 'phoi-son-han');
      const b = boardOf(
        ['1', '2', '3'].map((id, i) =>
          row(id, [cell('MUA_VT_KHUNG', 'LATE', -1 - i)], {
            missing: { MUA_VT_KHUNG: [shared], MUA_VT_CON_LAI: [] },
          }),
        ),
      );
      const buyer = DailyJobsService.materialsDigests(b).find((d) => d.recipientKey === 'u:b1')!;
      expect(buyer.params.late).toBe(1);
      expect(buyer.params.lines).toBe('PI-2026-001 (trễ 3 ngày): Sắt 40/100 kg.');
    });

    it('2 dòng mua cùng vật tư (khác chiều dài cây / quy cách nệm) vẫn là 2 dòng, không gộp mất 1', () => {
      const b = boardOf([
        row('1', [cell('MUA_VT_KHUNG', 'LATE', -1)], {
          missing: {
            MUA_VT_KHUNG: [
              mat('30', 'Sắt (6.000 mm)', 'b1', 'phoi-son-han', 'l1'),
              mat('30', 'Sắt (5.020 mm)', 'b1', 'phoi-son-han', 'l2'),
            ],
            MUA_VT_CON_LAI: [],
          },
        }),
      ]);
      const buyer = DailyJobsService.materialsDigests(b).find((d) => d.recipientKey === 'u:b1')!;
      expect(buyer.params.late).toBe(2);
      expect(buyer.params.lines).toBe(
        'PI-2026-001 (trễ 1 ngày): Sắt (6.000 mm) 40/100 kg, Sắt (5.020 mm) 40/100 kg.',
      );
    });

    it('mỗi NV mua chỉ thấy vật tư mình phụ trách', () => {
      const b = boardOf([
        row('1', [cell('MUA_VT_KHUNG', 'LATE', -1)], {
          missing: {
            MUA_VT_KHUNG: [
              mat('30', 'Sắt', 'b1', 'phoi-son-han'),
              mat('40', 'Dây', 'b2', 'vat-tu-tp'),
            ],
            MUA_VT_CON_LAI: [],
          },
        }),
      ]);
      const digests = DailyJobsService.materialsDigests(b);
      expect(digests.map((d) => d.recipientKey).sort()).toEqual([
        'u:b1',
        'u:b2',
        'w:phoi-son-han',
        'w:vat-tu-tp',
      ]);
      expect(digests.find((d) => d.recipientKey === 'u:b2')!.params.lines).not.toContain('Sắt');
    });

    it('vật tư chỉ "sắp tới hạn" (còn > 0 ngày) chưa vào tin vật tư hôm nay', () => {
      const b = boardOf([
        row('1', [cell('MUA_VT_KHUNG', 'DUE_SOON', 2)], {
          missing: { MUA_VT_KHUNG: [mat('31', 'Sơn', 'b1', null)], MUA_VT_CON_LAI: [] },
        }),
      ]);
      expect(DailyJobsService.materialsDigests(b)).toEqual([]);
    });

    it('lệnh tới ngày Phôi mà QLSX chưa bấm Bắt đầu', () => {
      const b = boardOf([row('1', [cell('PHOI', 'DUE_SOON', 0)], { floorStage: 'PENDING' })]);
      expect(DailyJobsService.productionDigest(b)).toMatchObject({ notStarted: 1, dueSoon: 1 });
      expect(DailyJobsService.productionDigest(b)!.lines).toContain('chưa bấm Bắt đầu');
    });
  });

  describe('cảnh báo nguy cơ trễ hạn giao', () => {
    const risky = boardOf([
      row('1', [
        cell('HAN_GIAO', 'DUE_SOON', 1),
        cell('DONG_GOI', 'ON_TRACK', 20, { need: 50, done: 10 }),
      ]),
      row('2', [cell('HAN_GIAO', 'UNKNOWN', 1)]),
    ]);

    it('dòng mới có nguy cơ -> phát CRITICAL theo dòng', async () => {
      await service.syncDeliveryAlerts(risky);
      expect(notifications.emit).toHaveBeenCalledTimes(1);
      expect(notifications.emit).toHaveBeenCalledWith(
        'DELIVERY_AT_RISK',
        expect.objectContaining({
          entityId: '1',
          dedupeKey: 'DELIVERY_AT_RISK:1',
          params: expect.objectContaining({
            daysLeft: 1,
            packed: 10,
            total: 50,
            deliveryDate: '30/10/2026',
          }) as unknown,
        }),
      );
    });

    it('đang mở cùng số ngày -> không phát lại, kể cả khi vừa đóng thêm thùng (không đặt lại "chưa đọc" mỗi 10 phút)', async () => {
      prisma.notification.findMany.mockResolvedValue([
        { entityId: '1', data: { daysLeft: 1, packed: 5 } },
      ]);
      await service.syncDeliveryAlerts(risky);
      expect(notifications.emit).not.toHaveBeenCalled();
      expect(notifications.resolve).not.toHaveBeenCalled();
    });

    it('sang ngày mới (số ngày đổi) -> phát lại 1 lần', async () => {
      prisma.notification.findMany.mockResolvedValue([
        { entityId: '1', data: { daysLeft: 2, packed: 10 } },
      ]);
      await service.syncDeliveryAlerts(risky);
      expect(notifications.emit).toHaveBeenCalledTimes(1);
    });

    it('hết nguy cơ / lệnh Kết thúc -> đóng; "Chưa biết" thì giữ', async () => {
      prisma.notification.findMany.mockResolvedValue([
        { entityId: '2', data: {} },
        { entityId: '9', data: {} },
      ]);
      await service.syncDeliveryAlerts(boardOf([row('2', [cell('HAN_GIAO', 'UNKNOWN', 1)])]));
      expect(notifications.resolve).toHaveBeenCalledTimes(1);
      expect(notifications.resolve).toHaveBeenCalledWith({
        entityType: 'PRODUCTION_INVOICE_ITEM',
        entityId: '9',
        types: ['DELIVERY_AT_RISK'],
      });
    });
  });
});
