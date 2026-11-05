import { ConflictException } from '@nestjs/common';
import {
  MilestoneBoard,
  MilestoneCell,
  MilestoneRow,
} from '../milestone-board/milestone-board.service';
import type { MaterialsDueRow } from '../materials-due/materials-due.types';
import {
  MILESTONES,
  MilestoneKey,
  MilestoneStatus,
} from '../milestone-board/milestone-board.rules';
import { addDays } from '../../common/utils/timeline-suggest.util';
import type { DailyOutputAlert } from '../production-capacity/production-capacity.types';
import { DailyJobsService, vnHour } from './daily-jobs.service';

const cell = (
  key: MilestoneKey,
  status: MilestoneStatus,
  daysLeft: number | null,
  extra: Partial<MilestoneCell> = {},
): MilestoneCell => ({
  key,
  label: MILESTONES.find((m) => m.key === key)!.label,
  // Hạn = hôm nay (29/10) + daysLeft, để so ngày (M2 rơi về hạn Phôi) khớp daysLeft.
  deadline: daysLeft === null ? null : addDays('2026-10-29', daysLeft),
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
  lsxCode: null, // Phần A – Đợt 2
  displayCode: 'PI-2026-001',
  productionOrderId: `${itemId}0`,
  skuCode: `SKU-${itemId}`,
  skuName: null,
  quantity: 50,
  floorStage: 'ACTIVE',
  phoiStart: null, // Phần A – Đợt 3
  packagingStart: null,
  milestones: MILESTONES.map(
    (m) => cells.find((c) => c.key === m.key) ?? cell(m.key, 'NO_DEADLINE', null),
  ),
  worst: 'LATE',
  missing: { MUA_VT_KHUNG: [], MUA_VT_CON_LAI: [] },
  ...extra,
});

// Phần A – Đợt 4 (YC6): dòng "Vật tư cần về". Hôm nay 29/10; daysLeft âm = quá hạn.
const dueRow = (over: Partial<MaterialsDueRow> = {}): MaterialsDueRow => {
  const state = over.state ?? 'OVERDUE';
  const daysLeft =
    over.daysLeft !== undefined
      ? over.daysLeft
      : state === 'OVERDUE'
        ? -2
        : state === 'DEADLINE_TODAY'
          ? 0
          : 2;
  const deadline = daysLeft === null ? null : addDays('2026-10-29', daysLeft);
  return {
    lineId: 'l1',
    piId: '7',
    lenhCode: 'MY-313',
    materialId: '31',
    materialName: 'Sơn ABC',
    unit: 'kg',
    group: 'FRAME',
    needQty: 100,
    orderQty: 100,
    receivedQty: 80,
    remainingQty: 20,
    purchaseStatus: 'PURCHASING',
    deadline,
    earliestArrival: deadline ? addDays(deadline, -4) : null,
    daysLeft,
    state,
    skus: [{ itemId: '1', lenhCode: 'MY-313', skuCode: 'SKU-1', deadline }],
    supplierName: null,
    supplierOrderCode: null,
    buyerId: 'b1',
    buyerName: 'Lan',
    warehouseCode: 'phoi-son-han',
    warehouseName: 'Kho Phôi',
    ...over,
  };
};

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
    notification: { findMany: jest.Mock; findFirst: jest.Mock };
  };
  let dataHealth: { run: jest.Mock };
  let board: { getBoard: jest.Mock };
  let notifications: { emit: jest.Mock; resolve: jest.Mock };
  let dailyOutput: { alertsForDay: jest.Mock };
  let bookingAlerts: { syncShortAlerts: jest.Mock };
  let materialsDue: { listAllRows: jest.Mock };
  let service: DailyJobsService;

  beforeEach(() => {
    tx = { $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]) };
    prisma = {
      $transaction: jest
        .fn()
        .mockImplementation((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      dataHealthRun: { findFirst: jest.fn().mockResolvedValue(null) },
      notification: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    dataHealth = { run: jest.fn().mockResolvedValue({}) };
    board = { getBoard: jest.fn().mockResolvedValue(boardOf([])) };
    notifications = {
      emit: jest.fn().mockResolvedValue(undefined),
      resolve: jest.fn().mockResolvedValue(undefined),
    };
    dailyOutput = { alertsForDay: jest.fn().mockResolvedValue([]) };
    bookingAlerts = { syncShortAlerts: jest.fn().mockResolvedValue(undefined) };
    materialsDue = { listAllRows: jest.fn().mockResolvedValue({ rows: [], today: '2026-10-29' }) };
    service = new DailyJobsService(
      prisma as never,
      dataHealth as never,
      board as never,
      notifications as never,
      dailyOutput as never,
      bookingAlerts as never,
      materialsDue as never,
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

    // Phần A – Đợt 10a
    it('có bước cảnh báo booking; bước đó lỗi không chặn bước sau', async () => {
      bookingAlerts.syncShortAlerts.mockRejectedValue(new Error('boom'));
      await service.tick(MORNING);
      expect(bookingAlerts.syncShortAlerts).toHaveBeenCalledWith(MORNING);
      expect(board.getBoard).toHaveBeenCalled();
    });

    // Phần A – Đợt 4 (YC6)
    it('bước cảnh báo vật tư tới hạn chót lỗi không chặn Bảng mốc / tin sáng', async () => {
      materialsDue.listAllRows.mockRejectedValue(new Error('boom'));
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
    // Phần A – Đợt 4 (YC6): nguồn vật tư là màn "Vật tư cần về".
    const lateBoard = boardOf([row('1', [cell('PHOI', 'DUE_SOON', 1), cell('KHUNG', 'LATE', -1)])]);
    const lateRows = [dueRow({ state: 'OVERDUE' })];

    it('trước 07:00 giờ VN không gửi', async () => {
      materialsDue.listAllRows.mockResolvedValue({ rows: lateRows, today: '2026-10-29' });
      await service.sendDigestsIfDue(lateBoard, EARLY);
      expect(notifications.emit).not.toHaveBeenCalled();
    });

    it('sau 07:00: tin vật tư riêng cho NV mua và cho kho, tin tiến độ cho KHSX+QLSX; không gửi lại trong ngày', async () => {
      materialsDue.listAllRows.mockResolvedValue({ rows: lateRows, today: '2026-10-29' });
      await service.sendDigestsIfDue(lateBoard, MORNING);
      expect(notifications.resolve).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'MORNING_DIGEST', entityId: 'materials' }),
      );
      expect(notifications.emit).toHaveBeenCalledWith(
        'MORNING_MATERIALS_DIGEST',
        expect.objectContaining({
          dedupeKey: 'MORNING_MATERIALS_DIGEST:2026-10-29:u:b1',
          params: expect.objectContaining({
            overdue: 1,
            deadlineToday: 0,
            inWindow: 0,
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
      materialsDue.listAllRows.mockResolvedValue({ rows: lateRows, today: '2026-10-29' });
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

    it('nguồn vật tư lỗi: vẫn gửi tin tiến độ, không đánh dấu xong ngày (lần kiểm sau thử lại vật tư)', async () => {
      materialsDue.listAllRows.mockRejectedValueOnce(new Error('db'));
      await service.sendDigestsIfDue(lateBoard, MORNING);
      expect(notifications.emit).toHaveBeenCalledWith(
        'MORNING_PRODUCTION_DIGEST',
        expect.anything(),
      );
      notifications.emit.mockClear();
      materialsDue.listAllRows.mockResolvedValue({ rows: lateRows, today: '2026-10-29' });
      prisma.notification.findMany.mockResolvedValue([
        { dedupeKey: 'MORNING_PRODUCTION_DIGEST:2026-10-29' },
      ]);
      await service.sendDigestsIfDue(lateBoard, MORNING);
      expect(notifications.emit).toHaveBeenCalledWith(
        'MORNING_MATERIALS_DIGEST',
        expect.anything(),
      );
    });

    it('materialsDigests: chỉ OVERDUE / DEADLINE_TODAY / IN_WINDOW; đếm đúng 3 loại', () => {
      const rows = [
        dueRow({ lineId: 'a', state: 'OVERDUE' }),
        dueRow({ lineId: 'b', state: 'OVERDUE' }),
        dueRow({ lineId: 'c', state: 'DEADLINE_TODAY' }),
        dueRow({ lineId: 'd', state: 'IN_WINDOW' }),
        dueRow({ lineId: 'e', state: 'UPCOMING' }),
        dueRow({ lineId: 'f', state: 'NO_DEADLINE', daysLeft: null }),
      ];
      const buyer = DailyJobsService.materialsDigests(rows).find((d) => d.recipientKey === 'u:b1')!;
      expect(buyer.params).toMatchObject({ overdue: 2, deadlineToday: 1, inWindow: 1 });
      expect(DailyJobsService.materialsDigests([rows[4], rows[5]])).toEqual([]);
    });

    it('câu theo MÃ LỆNH (không mã PI): quá hạn / HẠN CHÓT HÔM NAY / còn N ngày', () => {
      const rows = [
        dueRow({ lineId: 'a', state: 'OVERDUE', daysLeft: -2 }),
        dueRow({
          lineId: 'b',
          state: 'DEADLINE_TODAY',
          lenhCode: 'MY-314',
          materialName: 'Đinh',
          unit: 'kg',
          remainingQty: 5,
          skus: [{ itemId: '2', lenhCode: 'MY-314', skuCode: 'SKU-2', deadline: '2026-10-29' }],
        }),
        dueRow({
          lineId: 'c',
          state: 'IN_WINDOW',
          daysLeft: 3,
          lenhCode: 'MY-315',
          materialName: 'Nệm',
          unit: 'cái',
          remainingQty: 7,
          skus: [{ itemId: '3', lenhCode: 'MY-315', skuCode: 'SKU-3', deadline: '2026-11-01' }],
        }),
      ];
      const lines = DailyJobsService.materialsDigests(rows).find((d) => d.recipientKey === 'u:b1')!
        .params.lines;
      expect(lines).toBe(
        'MY-313 (quá hạn 2 ngày): Sơn ABC còn thiếu 20 kg; ' +
          'MY-314 (HẠN CHÓT HÔM NAY): Đinh còn thiếu 5 kg; ' +
          'MY-315 (còn 3 ngày tới hạn chót): Nệm còn thiếu 7 cái.',
      );
      expect(lines).not.toContain('PI-');
    });

    it('lệnh gộp 2 SKU 2 hạn: câu nêu lệnh của SKU có hạn sớm nhất', () => {
      const r = dueRow({
        state: 'OVERDUE',
        daysLeft: -1,
        lenhCode: 'MY-313 + MY-314',
        skus: [
          { itemId: '1', lenhCode: 'MY-313', skuCode: 'A', deadline: '2026-10-28' },
          { itemId: '2', lenhCode: 'MY-314', skuCode: 'B', deadline: '2026-11-05' },
        ],
      });
      const lines = DailyJobsService.materialsDigests([r])[0].params.lines;
      expect(lines.startsWith('MY-313 (quá hạn 1 ngày)')).toBe(true);
      expect(lines).not.toContain('MY-314');
    });

    it('tối đa 5 câu, phần còn lại ghi "+k dòng khác"', () => {
      const rows = Array.from({ length: 7 }, (_, i) =>
        dueRow({
          lineId: `x${i}`,
          lenhCode: `MY-${300 + i}`,
          skus: [
            { itemId: String(i), lenhCode: `MY-${300 + i}`, skuCode: 'S', deadline: '2026-10-27' },
          ],
        }),
      );
      const lines = DailyJobsService.materialsDigests(rows).find((d) => d.recipientKey === 'u:b1')!
        .params.lines;
      expect(lines.split('; ')).toHaveLength(6);
      expect(lines.endsWith('+2 dòng khác.')).toBe(true);
    });

    it('mỗi NV mua và mỗi kho chỉ thấy dòng của mình', () => {
      const rows = [
        dueRow({ lineId: 'a', buyerId: 'b1', warehouseCode: 'phoi-son-han', materialName: 'Sắt' }),
        dueRow({ lineId: 'b', buyerId: 'b2', warehouseCode: 'vat-tu-tp', materialName: 'Dây' }),
        dueRow({ lineId: 'c', buyerId: null, warehouseCode: null, materialName: 'Lạ' }),
      ];
      const digests = DailyJobsService.materialsDigests(rows);
      expect(digests.map((d) => d.recipientKey).sort()).toEqual([
        'u:b1',
        'u:b2',
        'w:phoi-son-han',
        'w:vat-tu-tp',
      ]);
      expect(digests.find((d) => d.recipientKey === 'u:b2')!.params.lines).not.toContain('Sắt');
      expect(digests.find((d) => d.recipientKey === 'w:vat-tu-tp')!.params.lines).toContain('Dây');
    });

    it('lệnh tới ngày Phôi mà QLSX chưa bấm Bắt đầu', () => {
      const b = boardOf([row('1', [cell('PHOI', 'DUE_SOON', 0)], { floorStage: 'PENDING' })]);
      expect(DailyJobsService.productionDigest(b)).toMatchObject({ notStarted: 1, dueSoon: 1 });
      expect(DailyJobsService.productionDigest(b)!.lines).toContain('chưa bấm Bắt đầu');
    });
  });

  // Phần A – Đợt 3 (YC10): M2/M4 + sản lượng ngày gộp vào tin sáng.
  describe('tin sáng - mốc neo M2/M4 và sản lượng ngày', () => {
    const alert = (message: string): DailyOutputAlert => ({
      groupKind: 'WORKSHOP',
      groupCode: 'PHU_AN',
      groupName: 'Xưởng Phú An',
      stage: 'HAN',
      stageLabel: 'Hàn',
      day: '2026-10-28',
      mode: 'CONT_PER_DAY',
      doneCont: 0.6,
      thresholdCont: 1,
      estimated: false,
      itemIds: ['1'],
      displayCodes: ['MY-313'],
      message,
    });

    it('chưa bắt đầu Phôi: tới M2 (phoiStart) dù hạn Phôi còn xa', () => {
      const b = boardOf([
        row('1', [cell('PHOI', 'ON_TRACK', 5)], { floorStage: 'PENDING', phoiStart: '2026-10-29' }),
        row('2', [cell('PHOI', 'ON_TRACK', 5)], { floorStage: 'PENDING', phoiStart: '2026-10-30' }),
      ]);
      const p = DailyJobsService.productionDigest(b)!;
      expect(p).toMatchObject({ notStarted: 1, late: 0, dueSoon: 0 });
      expect(p.lines).toBe('PI-2026-001 · SKU-1: chưa bấm Bắt đầu.');
    });

    it('chưa có M2 thì rơi về hạn Phôi như cũ; Phôi đã xong thì không báo', () => {
      const b = boardOf([
        row('1', [cell('PHOI', 'LATE', -1)], { floorStage: 'PENDING' }),
        row('2', [cell('PHOI', 'DONE', -1)], { floorStage: 'PENDING', phoiStart: '2026-10-20' }),
        row('3', [cell('PHOI', 'LATE', -1)], { floorStage: 'ACTIVE', phoiStart: '2026-10-20' }),
      ]);
      expect(DailyJobsService.productionDigest(b)).toMatchObject({ notStarted: 1 });
    });

    it('tới M4 mà chưa đóng thùng nào -> packagingNotStarted + câu "chưa bắt đầu Đóng gói"', () => {
      const b = boardOf([
        row('1', [cell('DONG_GOI', 'ON_TRACK', 8, { need: 50, done: 0 })], {
          packagingStart: '2026-10-29',
        }),
        row('2', [cell('DONG_GOI', 'ON_TRACK', 8, { need: 50, done: 5 })], {
          packagingStart: '2026-10-28',
        }),
        row('3', [cell('DONG_GOI', 'ON_TRACK', 8, { need: 50, done: 0 })], {
          packagingStart: '2026-10-31',
        }),
        row('4', [cell('DONG_GOI', 'UNKNOWN', 8, { need: null, done: null })], {
          packagingStart: '2026-10-28',
        }),
        row('5', [cell('DONG_GOI', 'NA', 8, { need: 0, done: 0 })], {
          packagingStart: '2026-10-28',
        }),
      ]);
      const p = DailyJobsService.productionDigest(b)!;
      expect(p).toMatchObject({ packagingNotStarted: 1, notStarted: 0 });
      expect(p.lines).toBe('PI-2026-001 · SKU-1: chưa bắt đầu Đóng gói.');
    });

    it('lowOutput: câu cảnh báo vào lines (sau các dòng theo lệnh) + đếm; chỉ có lowOutput vẫn có tin', () => {
      const msg = 'Hàn · Xưởng Phú An 28/10: làm 0,6/1 cont - MY-313';
      expect(DailyJobsService.productionDigest(boardOf([]), [alert(msg)])).toEqual({
        late: 0,
        dueSoon: 0,
        notStarted: 0,
        packagingNotStarted: 0,
        lowOutput: 1,
        lines: `${msg}.`,
      });
      const b = boardOf([row('1', [cell('PHOI', 'LATE', -1)])]);
      const p = DailyJobsService.productionDigest(b, [alert(msg)])!;
      expect(p.lines).toBe(`PI-2026-001 · SKU-1: Phôi trễ 1 ngày; ${msg}.`);
      expect(p.late).toBe(1);
    });

    it('joinLines vẫn cắt 5 dòng khi có nhiều cảnh báo sản lượng', () => {
      const alerts = Array.from({ length: 7 }, (_, i) => alert(`cảnh báo ${i + 1}`));
      const p = DailyJobsService.productionDigest(boardOf([]), alerts)!;
      expect(p.lowOutput).toBe(7);
      expect(p.lines).toBe(
        'cảnh báo 1; cảnh báo 2; cảnh báo 3; cảnh báo 4; cảnh báo 5; +2 dòng khác.',
      );
    });

    it('sendDigestsIfDue chấm sản lượng đúng ngày HÔM QUA giờ VN và đưa vào tin tiến độ', async () => {
      dailyOutput.alertsForDay.mockResolvedValue([alert('Hàn · cảnh báo')]);
      await service.sendDigestsIfDue(boardOf([]), MORNING);
      expect(dailyOutput.alertsForDay).toHaveBeenCalledWith('2026-10-28');
      expect(notifications.emit).toHaveBeenCalledWith(
        'MORNING_PRODUCTION_DIGEST',
        expect.objectContaining({
          params: expect.objectContaining({ lowOutput: 1, lines: 'Hàn · cảnh báo.' }) as unknown,
        }),
      );
    });

    it('08:00 VN ngày 1 tháng: hôm qua là ngày cuối tháng trước', async () => {
      await service.sendDigestsIfDue(boardOf([]), new Date('2026-10-31T23:30:00.000Z')); // 06:30 1/11 VN - chưa tới giờ
      expect(dailyOutput.alertsForDay).not.toHaveBeenCalled();
      await service.sendDigestsIfDue(boardOf([]), new Date('2026-11-01T01:00:00.000Z'));
      expect(dailyOutput.alertsForDay).toHaveBeenCalledWith('2026-10-31');
    });

    it('alertsForDay lỗi -> vẫn gửi tin tiến độ (không có cảnh báo sản lượng)', async () => {
      dailyOutput.alertsForDay.mockRejectedValue(new Error('db'));
      const lateOnly = boardOf([row('1', [cell('PHOI', 'LATE', -1)])]);
      await service.sendDigestsIfDue(lateOnly, MORNING);
      expect(notifications.emit).toHaveBeenCalledWith(
        'MORNING_PRODUCTION_DIGEST',
        expect.objectContaining({
          params: expect.objectContaining({ late: 1, lowOutput: 0 }) as unknown,
        }),
      );
    });

    it('tin tiến độ hôm nay đã gửi -> không chấm lại sản lượng', async () => {
      prisma.notification.findMany.mockResolvedValue([
        { dedupeKey: 'MORNING_PRODUCTION_DIGEST:2026-10-29' },
      ]);
      await service.sendDigestsIfDue(boardOf([]), MORNING);
      expect(dailyOutput.alertsForDay).not.toHaveBeenCalled();
    });
  });

  // Phần A – Đợt 4 (YC6, Sếp câu 1)
  describe('cảnh báo vật tư tới hạn chót chưa về đủ', () => {
    const critical = [
      dueRow({ lineId: 'a', state: 'OVERDUE', daysLeft: -2 }),
      dueRow({
        lineId: 'b',
        state: 'DEADLINE_TODAY',
        lenhCode: 'MY-314',
        materialName: 'Đinh',
        remainingQty: 5,
        buyerName: 'Mai',
        skus: [{ itemId: '2', lenhCode: 'MY-314', skuCode: 'S', deadline: '2026-10-29' }],
      }),
    ];
    const withRows = (rows: MaterialsDueRow[]) =>
      materialsDue.listAllRows.mockResolvedValue({ rows, today: '2026-10-29' });

    it('trước 07:00 không gửi, không đọc nguồn', async () => {
      withRows(critical);
      await service.syncMaterialsDeadlineAlert(EARLY);
      expect(notifications.emit).not.toHaveBeenCalled();
      expect(materialsDue.listAllRows).not.toHaveBeenCalled();
    });

    it('có dòng quá hạn / hạn chót hôm nay: gửi 1 tin CRITICAL theo ngày, đóng tin các ngày trước', async () => {
      withRows(critical);
      await service.syncMaterialsDeadlineAlert(MORNING);
      expect(notifications.resolve).toHaveBeenCalledWith({
        entityType: 'MATERIALS_DUE',
        entityId: 'deadline',
        types: ['MATERIALS_DEADLINE_ALERT'],
      });
      expect(notifications.emit).toHaveBeenCalledTimes(1);
      const [type, opts] = notifications.emit.mock.calls[0] as [
        string,
        { dedupeKey: string; entityId: string; params: Record<string, unknown> },
      ];
      expect(type).toBe('MATERIALS_DEADLINE_ALERT');
      expect(opts.dedupeKey).toBe('MATERIALS_DEADLINE_ALERT:2026-10-29');
      expect(opts.entityId).toBe('deadline');
      expect(opts.params).toMatchObject({ overdue: 1, deadlineToday: 1 });
      expect(opts.params.lines).toBe(
        'MY-313 · quá hạn 2 ngày: Sơn ABC còn thiếu 20 kg (Lan); ' +
          'MY-314 · hạn chót hôm nay: Đinh còn thiếu 5 kg (Mai).',
      );
    });

    it('chỉ IN_WINDOW / UPCOMING (chưa tới hạn chót) thì không gửi', async () => {
      withRows([dueRow({ state: 'IN_WINDOW' }), dueRow({ state: 'UPCOMING' })]);
      await service.syncMaterialsDeadlineAlert(MORNING);
      expect(notifications.emit).not.toHaveBeenCalled();
    });

    it('đã có tin hôm nay (còn mở) và vẫn còn dòng: không gửi lại', async () => {
      withRows(critical);
      prisma.notification.findFirst.mockResolvedValue({ id: 'n1', recipients: [{ userId: 'u' }] });
      await service.syncMaterialsDeadlineAlert(MORNING);
      expect(notifications.emit).not.toHaveBeenCalled();
      expect(notifications.resolve).not.toHaveBeenCalled();
    });

    it('tin hôm nay đang mở mà hàng đã về hết (0 dòng) -> đóng tin', async () => {
      withRows([]);
      prisma.notification.findFirst.mockResolvedValue({ id: 'n1', recipients: [{ userId: 'u' }] });
      await service.syncMaterialsDeadlineAlert(MORNING);
      expect(notifications.resolve).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'MATERIALS_DUE', entityId: 'deadline' }),
      );
      expect(notifications.emit).not.toHaveBeenCalled();
    });

    it('0 dòng và tin hôm nay đã đóng / chưa từng gửi -> không làm gì', async () => {
      withRows([]);
      prisma.notification.findFirst.mockResolvedValue({ id: 'n1', recipients: [] });
      await service.syncMaterialsDeadlineAlert(MORNING);
      prisma.notification.findFirst.mockResolvedValue(null);
      await service.syncMaterialsDeadlineAlert(MORNING);
      expect(notifications.resolve).not.toHaveBeenCalled();
      expect(notifications.emit).not.toHaveBeenCalled();
    });

    it('đã đóng vì hàng về, sau đó lại có dòng quá hạn: không gửi lại trong ngày', async () => {
      withRows(critical);
      prisma.notification.findFirst.mockResolvedValue({ id: 'n1', recipients: [] });
      await service.syncMaterialsDeadlineAlert(MORNING);
      expect(notifications.emit).not.toHaveBeenCalled();
    });

    it('tin cho KHSX, tự thêm Sếp (CRITICAL), link sang màn Vật tư cần về', async () => {
      const { NOTIFICATION_TYPES } = await import('../notifications/notification-types');
      const def = NOTIFICATION_TYPES.MATERIALS_DEADLINE_ALERT;
      const p = { deadlineToday: 1, overdue: 2, lines: 'x.' };
      expect(def.severity).toBe('CRITICAL');
      expect(def.category).toBe('ALERT');
      expect(def.recipients(p)).toEqual({ roles: ['PRODUCTION_PLANNER'] });
      expect(def.title(p)).toBe('Vật tư tới hạn chót chưa về đủ: 1 hạn chót hôm nay, 2 quá hạn');
      expect(def.title({ ...p, deadlineToday: 0 })).toBe(
        'Vật tư tới hạn chót chưa về đủ: 2 quá hạn',
      );
      expect(def.link!(p)).toMatchObject({
        module: 'production_plan',
        page: 'vat-tu-can-ve',
        params: { view: 'all' },
      });
    });

    it('tiêu đề / link tin sáng vật tư theo hợp đồng Đợt 4', async () => {
      const { NOTIFICATION_TYPES } = await import('../notifications/notification-types');
      const def = NOTIFICATION_TYPES.MORNING_MATERIALS_DIGEST;
      const p = {
        overdue: 2,
        deadlineToday: 1,
        inWindow: 5,
        lines: 'x',
        buyerIds: [],
        warehouseCodes: [],
      };
      expect(def.title(p)).toBe('Vật tư cần về: 2 quá hạn, 1 hạn chót hôm nay, 5 trong hạn về');
      expect(def.title({ ...p, overdue: 0, inWindow: 0 })).toBe(
        'Vật tư cần về: 1 hạn chót hôm nay',
      );
      expect(def.link!(p)).toEqual({
        module: 'purchasing',
        page: 'vat-tu-can-ve',
        params: { view: 'today' },
        alternatives: [
          { module: 'inbound_warehouse', page: 'vat-tu-can-ve', params: { view: 'today' } },
        ],
      });
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
