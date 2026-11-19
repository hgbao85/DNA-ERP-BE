import { Logger } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CutAllocationService } from './cut-allocation.service';
import { CutSnapshotCache } from './cut-allocation-snapshot';
import { FloorAdminService } from './floor-admin.service';
import { PaintTransferReminderService } from '../warehouse-transfers/paint-transfer-reminder.service';
import { CutAllocationFollowUpService } from './cut-allocation-follow-up.service';
import { FloorAlertsService, MIN_EVALUATE_GAP_MS } from './floor-alerts.service';
import {
  KCS_STALE_HOURS,
  listKcsPendingItems,
  type KcsBlockedReason,
  type KcsPendingItem,
} from './kcs-pending.util';

jest.mock('./kcs-pending.util', () => ({
  ...jest.requireActual<typeof import('./kcs-pending.util')>('./kcs-pending.util'),
  listKcsPendingItems: jest.fn(),
}));
const listPending = listKcsPendingItems as jest.MockedFunction<typeof listKcsPendingItems>;

describe('FloorAlertsService', () => {
  let prisma: {
    floorQueueEntry: { findMany: jest.Mock };
    notification: { findMany: jest.Mock; findFirst: jest.Mock };
    cutBundle: { findMany: jest.Mock };
    stepBatch: { findMany: jest.Mock };
    productionBatch: { findMany: jest.Mock };
    workstation: { findMany: jest.Mock };
    productionInvoiceItem: { findMany: jest.Mock };
    warehouse: { findUnique: jest.Mock };
    workshop: { findMany: jest.Mock; findFirst: jest.Mock };
    productionInvoice: { findMany: jest.Mock };
  };
  let followUp: { afterAllocated: jest.Mock; queueMissingPhoi: jest.Mock };
  let paintReminder: { syncAll: jest.Mock };
  let admin: {
    computeProgress: jest.Mock;
    autoCompletePhoi: jest.Mock;
    ensurePhoiQueued: jest.Mock;
  };
  let cutAllocation: {
    machineProgressByWorkshop: jest.Mock;
    autoPull: jest.Mock;
    steelGapsByPi: jest.Mock;
    startedAllocationPiIds: jest.Mock;
  };
  let realtime: { publishEntityChanged: jest.Mock };
  let notifications: { emit: jest.Mock; resolve: jest.Mock; updateOpenContent: jest.Mock };
  let service: FloorAlertsService;

  const running = (id: bigint, stage: string, code: string, status = 'RUNNING') => ({
    id,
    stage,
    status,
    productionInvoiceId: 45n,
    workshopId: 5n,
    productionInvoice: { code },
  });
  const progress = (complete: boolean) => ({
    required: 10,
    reported: complete ? 10 : 4,
    percent: 40,
    complete,
    passed: complete ? 10 : 4,
  });
  const machine = (over: Partial<Record<string, unknown>>) => ({
    workstationId: '12',
    name: 'Máy 1',
    workshopId: '5',
    workshopName: 'Phú An',
    totalBars: 30,
    barsLeft: 30,
    status: 'BUSY',
    signature: '30:9',
    ...over,
  });

  beforeEach(() => {
    prisma = {
      floorQueueEntry: { findMany: jest.fn().mockResolvedValue([]) },
      notification: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      cutBundle: { findMany: jest.fn().mockResolvedValue([]) },
      stepBatch: { findMany: jest.fn().mockResolvedValue([]) },
      productionBatch: { findMany: jest.fn().mockResolvedValue([]) },
      workstation: { findMany: jest.fn().mockResolvedValue([]) },
      // Lệnh 45 thuộc Phú An (5), lệnh 46 thuộc Phước An (6, sơn nhờ Phú An); lệnh khác: chưa có xưởng.
      productionInvoiceItem: {
        findMany: jest
          .fn()
          .mockImplementation(({ where }: { where: { productionInvoiceId: { in: bigint[] } } }) => {
            const ws: Record<string, bigint> = { '45': 5n, '46': 6n };
            return Promise.resolve(
              where.productionInvoiceId.in
                .filter((id) => ws[id.toString()] != null)
                .map((id) => ({ productionInvoiceId: id, workshopId: ws[id.toString()] })),
            );
          }),
      },
      warehouse: { findUnique: jest.fn().mockResolvedValue(null) },
      productionInvoice: { findMany: jest.fn().mockResolvedValue([]) },
      workshop: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { id: { in: bigint[] } } }) => {
          const all = [
            { id: 5n, name: 'Phú An', paintWorkshopId: null },
            { id: 6n, name: 'Phước An', paintWorkshopId: 5n },
          ];
          return Promise.resolve(all.filter((w) => where.id.in.includes(w.id)));
        }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    admin = {
      computeProgress: jest.fn().mockResolvedValue(progress(false)),
      autoCompletePhoi: jest.fn().mockResolvedValue({ closed: true, nextPiCode: null }),
      ensurePhoiQueued: jest.fn().mockResolvedValue([]),
    };
    cutAllocation = {
      machineProgressByWorkshop: jest.fn().mockResolvedValue([]),
      autoPull: jest.fn().mockResolvedValue(null),
      steelGapsByPi: jest.fn().mockResolvedValue(new Map()),
      startedAllocationPiIds: jest.fn().mockResolvedValue([]),
    };
    followUp = {
      afterAllocated: jest.fn().mockResolvedValue(undefined),
      queueMissingPhoi: jest.fn().mockResolvedValue(undefined),
    };
    paintReminder = { syncAll: jest.fn().mockResolvedValue(undefined) };
    realtime = { publishEntityChanged: jest.fn() };
    notifications = {
      emit: jest.fn().mockResolvedValue(undefined),
      resolve: jest.fn().mockResolvedValue(undefined),
      updateOpenContent: jest.fn().mockResolvedValue(true),
    };
    service = new FloorAlertsService(
      prisma as unknown as PrismaServiceType,
      admin as unknown as FloorAdminService,
      notifications as unknown as NotificationsService,
      cutAllocation as unknown as CutAllocationService,
      realtime as unknown as RealtimeService,
      followUp as unknown as CutAllocationFollowUpService,
      paintReminder as unknown as PaintTransferReminderService,
    );
  });

  const pendingItem = (
    stage: 'PHOI' | 'HAN' | 'SON',
    piId: bigint | null,
    blockedReason: KcsBlockedReason = null,
    state: 'OPEN' | 'AWAITING_QC' = 'OPEN',
  ): KcsPendingItem => ({
    stage,
    productionInvoiceId: piId,
    kind: stage === 'PHOI' ? 'CUT' : 'PIECE_BATCH',
    state,
    waitingSince: new Date('2026-10-13T00:00:00Z'),
    blockedReason,
  });
  /** Dựng `n` đợt cắt Phôi chờ KCS quá hạn của lệnh `piId` (nguồn listKcsPendingItems đã mock). */
  const staleCut = (n: number, piId = 45n) =>
    listPending.mockResolvedValue(Array.from({ length: n }, () => pendingItem('PHOI', piId)));
  const staleBatch = (stage: 'PHOI' | 'HAN' | 'SON', piId: bigint) => pendingItem(stage, piId);

  beforeEach(() => {
    listPending.mockReset();
    listPending.mockResolvedValue([]);
  });

  afterEach(() => {
    delete process.env.CUT_AUTO_PULL;
  });

  describe('tổ Hàn/Sơn báo đủ số của PI đang chạy', () => {
    it('đủ số, chưa có nhắc đang mở -> nhắc QLSX 1 lần, khoá theo từng dòng hàng đợi', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([running(7n, 'HAN', 'PI-45')]);
      admin.computeProgress.mockResolvedValue(progress(true));

      await service.evaluate();

      expect(notifications.emit).toHaveBeenCalledWith('FLOOR_STAGE_COMPLETE', {
        entityId: '7',
        dedupeKey: 'floor-stage-complete:7',
        params: { stage: 'HAN', piCode: 'PI-45', workshopId: '5' },
      });
    });

    it('ĐÃ có nhắc đang mở -> KHÔNG phát lại (emit() sẽ gộp và đánh dấu chưa đọc lại = nhắc lặp mỗi lần quét)', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([running(7n, 'SON', 'PI-45')]);
      admin.computeProgress.mockResolvedValue(progress(true));
      prisma.notification.findFirst.mockResolvedValue({ id: 'n1' });

      await service.evaluate();
      await service.evaluate();

      expect(notifications.emit).not.toHaveBeenCalled();
    });

    it('chưa đủ số -> không nhắc; tính tiến độ lỗi (null) cũng không làm hỏng lượt kiểm tra', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([
        running(7n, 'SON', 'PI-45'),
        running(8n, 'HAN', 'PI-45'),
      ]);
      admin.computeProgress
        .mockResolvedValueOnce(progress(false))
        .mockRejectedValueOnce(new Error('boom'));

      await expect(service.evaluate()).resolves.toBeUndefined();

      expect(notifications.emit).not.toHaveBeenCalled();
    });

    it('PI không còn chạy (QLSX đã Chuyển PI tiếp) -> đóng nhắc cũ của dòng đó', async () => {
      // dòng 7 đã DONE
      prisma.floorQueueEntry.findMany.mockResolvedValue([running(9n, 'HAN', 'PI-46')]);
      prisma.notification.findMany.mockResolvedValue([{ entityId: '7' }, { entityId: '9' }]);

      await service.evaluate();

      expect(notifications.resolve).toHaveBeenCalledWith({
        entityType: 'FLOOR_QUEUE_ENTRY',
        entityId: '7',
        types: ['FLOOR_STAGE_COMPLETE'],
      });
      expect(notifications.resolve).not.toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'FLOOR_QUEUE_ENTRY', entityId: '9' }),
      );
    });
  });

  describe('xong Phôi tự tính', () => {
    const phoiDone = (over: Partial<Record<string, unknown>> = {}) => ({
      required: 10,
      passed: 10,
      reported: 10,
      complete: true,
      ...over,
    });

    it('mọi dòng KCS đạt đủ (required > 0 && passed >= required) -> tự đóng + báo QLSX, KHÔNG nhắc Chuyển PI tiếp', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([running(7n, 'PHOI', 'PI-45')]);
      admin.computeProgress.mockResolvedValue(phoiDone());
      admin.autoCompletePhoi.mockResolvedValue({ closed: true, nextPiCode: 'PI-46' });

      await service.evaluate();

      expect(admin.computeProgress).toHaveBeenCalledWith('PHOI', 45n);
      expect(admin.autoCompletePhoi).toHaveBeenCalledWith(7n);
      expect(notifications.emit).toHaveBeenCalledWith('FLOOR_PHOI_DONE', {
        entityId: '7',
        dedupeKey: 'floor-phoi-done:7',
        params: { piCode: 'PI-45', nextPiCode: 'PI-46', workshopId: '5' },
      });
      expect(notifications.emit).not.toHaveBeenCalledWith(
        'FLOOR_STAGE_COMPLETE',
        expect.anything(),
      );
    });

    it('dòng đang CHỜ (QUEUED) mà đã đủ cũng tự đóng', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([running(8n, 'PHOI', 'PI-47', 'QUEUED')]);
      admin.computeProgress.mockResolvedValue(phoiDone());

      await service.evaluate();

      expect(admin.autoCompletePhoi).toHaveBeenCalledWith(8n);
    });

    it('báo đủ nhưng còn đoạn chờ KCS / chưa gửi (passed < required) -> chưa đóng', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([running(7n, 'PHOI', 'PI-45')]);
      admin.computeProgress.mockResolvedValue(phoiDone({ passed: 8, reported: 10 }));

      await service.evaluate();

      expect(admin.autoCompletePhoi).not.toHaveBeenCalled();
      expect(notifications.emit).not.toHaveBeenCalled();
    });

    it('required = 0 (chưa có việc Phôi nào) -> không đóng', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([running(7n, 'PHOI', 'PI-45')]);
      admin.computeProgress.mockResolvedValue(phoiDone({ required: 0, passed: 0, reported: 0 }));

      await service.evaluate();

      expect(admin.autoCompletePhoi).not.toHaveBeenCalled();
    });

    it('autoCompletePhoi không đóng gì (đã đóng rồi) -> không báo lại', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([running(7n, 'PHOI', 'PI-45')]);
      admin.computeProgress.mockResolvedValue(phoiDone());
      admin.autoCompletePhoi.mockResolvedValue({ closed: false, nextPiCode: null });

      await service.evaluate();

      expect(notifications.emit).not.toHaveBeenCalled();
    });

    it('HAN / SON đủ số KHÔNG tự đóng (vẫn chỉ nhắc)', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([
        running(7n, 'HAN', 'PI-45'),
        running(8n, 'SON', 'PI-45'),
      ]);
      admin.computeProgress.mockResolvedValue(phoiDone());

      await service.evaluate();

      expect(admin.autoCompletePhoi).not.toHaveBeenCalled();
      expect(notifications.emit).toHaveBeenCalledWith(
        'FLOOR_STAGE_COMPLETE',
        expect.objectContaining({ entityId: '7' }),
      );
    });

    it('nhắc FLOOR_STAGE_COMPLETE cũ của tổ Phôi đang mở -> đóng', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([running(7n, 'PHOI', 'PI-45')]);
      prisma.notification.findMany.mockResolvedValue([{ entityId: '7' }]);

      await service.evaluate();

      expect(notifications.resolve).toHaveBeenCalledWith({
        entityType: 'FLOOR_QUEUE_ENTRY',
        entityId: '7',
        types: ['FLOOR_STAGE_COMPLETE'],
      });
    });

    it('tự đóng lỗi -> chỉ log, evaluate không vỡ', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([running(7n, 'PHOI', 'PI-45')]);
      admin.computeProgress.mockResolvedValue(phoiDone());
      admin.autoCompletePhoi.mockRejectedValue(new Error('boom'));

      await expect(service.evaluate()).resolves.toBeUndefined();
      expect(notifications.emit).not.toHaveBeenCalled();
    });
  });

  describe('máy cắt sắp hết / hết việc được chia', () => {
    beforeEach(() => {
      prisma.workstation.findMany.mockResolvedValue([{ workshopId: 5n }]);
    });

    it('LOW -> nhắc 1 lần theo (máy, signature), có workshopId trong params; đóng nhắc IDLE', async () => {
      cutAllocation.machineProgressByWorkshop.mockResolvedValue([
        machine({ status: 'LOW', barsLeft: 18 }),
      ]);

      await service.evaluate();

      expect(cutAllocation.machineProgressByWorkshop).toHaveBeenCalledWith(
        5n,
        expect.any(CutSnapshotCache),
      );
      expect(notifications.emit).toHaveBeenCalledWith('CUT_MACHINE_LOW_WORK', {
        entityId: '12',
        dedupeKey: 'cut-machine-low:12:30:9',
        params: {
          workshopId: '5',
          workshopName: 'Phú An',
          machineName: 'Máy 1',
          barsLeft: 18,
          autoPull: true,
        },
      });
      expect(notifications.resolve).toHaveBeenCalledWith({
        entityType: 'WORKSTATION',
        entityId: '12',
        types: ['CUT_MACHINE_IDLE'],
      });
    });

    it('IDLE -> nhắc máy rảnh; đóng nhắc LOW', async () => {
      cutAllocation.machineProgressByWorkshop.mockResolvedValue([
        machine({ status: 'IDLE', barsLeft: 0 }),
      ]);

      await service.evaluate();

      expect(notifications.emit).toHaveBeenCalledWith('CUT_MACHINE_IDLE', {
        entityId: '12',
        dedupeKey: 'cut-machine-idle:12:30:9',
        params: expect.objectContaining({ workshopId: '5', barsLeft: 0 }) as unknown,
      });
      expect(notifications.emit).not.toHaveBeenCalledWith(
        'CUT_MACHINE_LOW_WORK',
        expect.anything(),
      );
      expect(notifications.resolve).toHaveBeenCalledWith({
        entityType: 'WORKSTATION',
        entityId: '12',
        types: ['CUT_MACHINE_LOW_WORK'],
      });
    });

    it('máy đã có nhắc cùng loại đang mở (kể cả khác signature: chia thêm vài cây mà vẫn LOW) -> không nhắc chồng', async () => {
      cutAllocation.machineProgressByWorkshop.mockResolvedValue([
        machine({ status: 'LOW', barsLeft: 15, signature: '33:11' }),
      ]);
      prisma.notification.findFirst.mockResolvedValue({ id: 'n1' });

      await service.evaluate();

      expect(prisma.notification.findFirst).toHaveBeenCalledWith({
        where: {
          type: 'CUT_MACHINE_LOW_WORK',
          entityType: 'WORKSTATION',
          entityId: '12',
          recipients: { some: { resolvedAt: null } },
        },
        select: { id: true },
      });
      expect(notifications.emit).not.toHaveBeenCalled();
    });

    it('BUSY (còn > 20 cây) -> không nhắc, đóng cả 2 loại nhắc cũ', async () => {
      cutAllocation.machineProgressByWorkshop.mockResolvedValue([
        machine({ status: 'BUSY', barsLeft: 25 }),
      ]);

      await service.evaluate();

      expect(notifications.emit).not.toHaveBeenCalled();
      for (const type of ['CUT_MACHINE_LOW_WORK', 'CUT_MACHINE_IDLE']) {
        expect(notifications.resolve).toHaveBeenCalledWith({
          entityType: 'WORKSTATION',
          entityId: '12',
          types: [type],
        });
      }
    });

    it('EMPTY (dòng chia biến mất, vd lệnh đã xong Phôi) -> không nhắc, đóng LOW nhưng GIỮ nhắc máy rảnh', async () => {
      cutAllocation.machineProgressByWorkshop.mockResolvedValue([
        machine({ workstationId: '13', status: 'EMPTY', barsLeft: 0, totalBars: 0 }),
      ]);

      await service.evaluate();

      expect(notifications.emit).not.toHaveBeenCalled();
      expect(notifications.resolve).toHaveBeenCalledWith({
        entityType: 'WORKSTATION',
        entityId: '13',
        types: ['CUT_MACHINE_LOW_WORK'],
      });
      expect(notifications.resolve).not.toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'WORKSTATION',
          types: expect.arrayContaining(['CUT_MACHINE_IDLE']) as unknown,
        }),
      );
    });

    it('máy không còn trong danh sách (ngưng dùng / bỏ xưởng) -> đóng cả 2 loại nhắc của máy đó', async () => {
      cutAllocation.machineProgressByWorkshop.mockResolvedValue([
        machine({ status: 'BUSY', barsLeft: 25 }),
      ]);
      prisma.notification.findMany.mockImplementation((args: { where: { type: unknown } }) =>
        Promise.resolve(
          typeof args.where.type === 'object' ? [{ entityId: '12' }, { entityId: '99' }] : [],
        ),
      );

      await service.evaluate();

      expect(notifications.resolve).toHaveBeenCalledWith({
        entityType: 'WORKSTATION',
        entityId: '99',
        types: ['CUT_MACHINE_LOW_WORK', 'CUT_MACHINE_IDLE'],
      });
      expect(notifications.resolve).not.toHaveBeenCalledWith({
        entityType: 'WORKSTATION',
        entityId: '12',
        types: ['CUT_MACHINE_LOW_WORK', 'CUT_MACHINE_IDLE'],
      });
    });

    it('có xưởng dựng tiến độ lỗi -> không dọn nhắc máy (khỏi đóng nhầm)', async () => {
      cutAllocation.machineProgressByWorkshop.mockRejectedValue(new Error('boom'));
      prisma.notification.findMany.mockResolvedValue([{ entityId: '99' }]);

      await service.evaluate();

      expect(notifications.resolve).not.toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'WORKSTATION', entityId: '99' }),
      );
    });

    it('lỗi dựng tiến độ máy -> chỉ log, các bước khác (nhắc quá hạn KCS) vẫn chạy', async () => {
      cutAllocation.machineProgressByWorkshop.mockRejectedValue(new Error('boom'));
      staleCut(1);

      await expect(service.evaluate()).resolves.toBeUndefined();

      expect(notifications.emit).toHaveBeenCalledWith(
        'KCS_BATCH_STALE',
        expect.objectContaining({ entityId: 'PHOI:5' }),
      );
    });
  });

  describe('máy rảnh tự kéo lệnh kế tiếp', () => {
    beforeEach(() => {
      prisma.workstation.findMany.mockResolvedValue([{ workshopId: 5n }]);
    });

    const gap = {
      materialId: '7',
      materialCode: 'S7',
      materialLabel: 'Sắt hộp 6zem 10x20',
      requiredBars: 12,
      issuedBars: 0,
      missingBars: 12,
      warehouseCodes: ['kho-sat', 'kho-sat-2'],
    };
    const pulled = (steelGaps: unknown[] = []) => ({
      workshopId: '5',
      workshopName: 'Phú An',
      machines: [{ id: '12', name: 'Máy 1' }],
      orders: [
        {
          productionInvoiceId: '45',
          piCode: 'PI-45',
          firstAllocationId: '900',
          lines: [
            {
              materialId: '7',
              materialLabel: 'Sắt hộp 6zem 10x20',
              bars: 12,
              machines: [{ id: '12', name: 'Máy 1', bars: 12 }],
            },
          ],
          idleMachineNames: ['Máy 1'],
          steelGaps,
        },
      ],
    });

    it('có máy IDLE/EMPTY -> kéo (chỉ truyền id máy rảnh), thêm lệnh vào hàng đợi Phôi, báo CUT_ORDER_PULLED, phát realtime', async () => {
      cutAllocation.machineProgressByWorkshop
        .mockResolvedValueOnce([
          machine({ workstationId: '12', status: 'IDLE', barsLeft: 0 }),
          machine({ workstationId: '13', status: 'EMPTY', barsLeft: 0, totalBars: 0 }),
          machine({ workstationId: '14', status: 'BUSY', barsLeft: 40 }),
        ])
        .mockResolvedValue([]);
      cutAllocation.autoPull.mockResolvedValue(pulled());

      await service.evaluate();

      expect(cutAllocation.autoPull).toHaveBeenCalledWith(5n, ['12', '13']);
      expect(followUp.afterAllocated).toHaveBeenCalledWith({
        workshopId: '5',
        orders: [{ productionInvoiceId: '45', piCode: 'PI-45', steelGaps: [] }],
        source: 'AUTO_PULL',
      });
      expect(notifications.emit).toHaveBeenCalledWith('CUT_ORDER_PULLED', {
        entityId: '45',
        dedupeKey: 'cut-order-pulled:45:900',
        params: {
          piCode: 'PI-45',
          workshopId: '5',
          workshopName: 'Phú An',
          machineNames: 'Máy 1',
          summary: 'Sắt hộp 6zem 10x20: 12 cây (Máy 1 12)',
          steelPending: false,
        },
      });
      expect(notifications.emit).not.toHaveBeenCalledWith(
        'CUT_PULL_STEEL_TO_ISSUE',
        expect.anything(),
      );
      expect(realtime.publishEntityChanged).toHaveBeenCalledWith({
        entity: 'FLOOR_REPORT',
        entityId: 'cut-auto-pull',
        action: 'UPDATED',
        actorId: null,
      });
    });

    it('tính lại tiến độ sau khi kéo: máy vừa nhận việc (BUSY) không bị nhắc máy rảnh', async () => {
      cutAllocation.machineProgressByWorkshop
        .mockResolvedValueOnce([machine({ status: 'IDLE', barsLeft: 0 })])
        .mockResolvedValueOnce([machine({ status: 'BUSY', barsLeft: 30 })]);
      cutAllocation.autoPull.mockResolvedValue(pulled());

      await service.evaluate();

      expect(cutAllocation.machineProgressByWorkshop).toHaveBeenCalledTimes(2);
      expect(notifications.emit).not.toHaveBeenCalledWith('CUT_MACHINE_IDLE', expect.anything());
      expect(notifications.resolve).toHaveBeenCalledWith({
        entityType: 'WORKSTATION',
        entityId: '12',
        types: ['CUT_MACHINE_IDLE'],
      });
    });

    it('lệnh còn thiếu sắt -> giao follow-up (source AUTO_PULL) lo xếp hàng đợi Phôi + báo thủ kho; floor-alerts không tự emit tin xuất sắt', async () => {
      cutAllocation.machineProgressByWorkshop.mockResolvedValue([
        machine({ status: 'IDLE', barsLeft: 0 }),
      ]);
      cutAllocation.autoPull.mockResolvedValue(pulled([gap]));

      await service.evaluate();

      expect(followUp.afterAllocated).toHaveBeenCalledWith({
        workshopId: '5',
        orders: [{ productionInvoiceId: '45', piCode: 'PI-45', steelGaps: [gap] }],
        source: 'AUTO_PULL',
      });
      expect(notifications.emit).not.toHaveBeenCalledWith(
        'CUT_PULL_STEEL_TO_ISSUE',
        expect.anything(),
      );
    });

    it('thiếu sắt -> CUT_ORDER_PULLED có steelPending = true', async () => {
      cutAllocation.machineProgressByWorkshop.mockResolvedValue([
        machine({ status: 'IDLE', barsLeft: 0 }),
      ]);
      cutAllocation.autoPull.mockResolvedValue(pulled([gap]));

      await service.evaluate();

      expect(notifications.emit).toHaveBeenCalledWith(
        'CUT_ORDER_PULLED',
        expect.objectContaining({
          params: expect.objectContaining({ steelPending: true }) as unknown,
        }),
      );
    });

    it('CUT_AUTO_PULL=off -> không kéo, nhắc máy rảnh dùng câu cũ (autoPull=false)', async () => {
      process.env.CUT_AUTO_PULL = 'off';
      cutAllocation.machineProgressByWorkshop.mockResolvedValue([
        machine({ status: 'IDLE', barsLeft: 0 }),
      ]);

      await service.evaluate();

      expect(cutAllocation.autoPull).not.toHaveBeenCalled();
      expect(notifications.emit).toHaveBeenCalledWith('CUT_MACHINE_IDLE', {
        entityId: '12',
        dedupeKey: 'cut-machine-idle:12:30:9',
        params: expect.objectContaining({ autoPull: false }) as unknown,
      });
    });

    it('không kéo được (null) -> không tính lại tiến độ, vẫn nhắc máy rảnh với autoPull=true', async () => {
      cutAllocation.machineProgressByWorkshop.mockResolvedValue([
        machine({ status: 'IDLE', barsLeft: 0 }),
      ]);

      await service.evaluate();

      expect(cutAllocation.autoPull).toHaveBeenCalledTimes(1);
      expect(cutAllocation.machineProgressByWorkshop).toHaveBeenCalledTimes(1);
      expect(admin.ensurePhoiQueued).not.toHaveBeenCalled();
      expect(realtime.publishEntityChanged).not.toHaveBeenCalled();
      expect(notifications.emit).toHaveBeenCalledWith('CUT_MACHINE_IDLE', {
        entityId: '12',
        dedupeKey: 'cut-machine-idle:12:30:9',
        params: expect.objectContaining({ autoPull: true }) as unknown,
      });
    });

    it('autoPull lỗi -> chỉ log, evaluate không vỡ, các nhắc khác vẫn chạy', async () => {
      cutAllocation.machineProgressByWorkshop.mockResolvedValue([
        machine({ status: 'IDLE', barsLeft: 0 }),
      ]);
      cutAllocation.autoPull.mockRejectedValue(new Error('boom'));
      staleCut(1);

      await expect(service.evaluate()).resolves.toBeUndefined();

      expect(notifications.emit).toHaveBeenCalledWith('CUT_MACHINE_IDLE', expect.anything());
      expect(notifications.emit).toHaveBeenCalledWith(
        'KCS_BATCH_STALE',
        expect.objectContaining({ entityId: 'PHOI:5' }),
      );
      expect(realtime.publishEntityChanged).not.toHaveBeenCalled();
    });

    it('đối soát hàng đợi Phôi: mỗi xưởng gọi queueMissingPhoi(startedAllocationPiIds); lỗi không làm hỏng lượt', async () => {
      cutAllocation.machineProgressByWorkshop.mockResolvedValue([machine({ status: 'BUSY' })]);
      cutAllocation.startedAllocationPiIds.mockResolvedValue([45n]);

      await service.evaluate();

      expect(cutAllocation.startedAllocationPiIds).toHaveBeenCalledWith(
        5n,
        expect.any(CutSnapshotCache),
      );
      expect(followUp.queueMissingPhoi).toHaveBeenCalledWith([45n]);

      followUp.queueMissingPhoi.mockRejectedValue(new Error('boom'));
      await expect(service.evaluate()).resolves.toBeUndefined();
      expect(paintReminder.syncAll).toHaveBeenCalledTimes(2);
    });

    describe('tự đóng nhắc xuất sắt của thủ kho', () => {
      const openNotes = () =>
        prisma.notification.findMany.mockImplementation((args: { where: { type: unknown } }) =>
          Promise.resolve(
            args.where.type === 'CUT_PULL_STEEL_TO_ISSUE'
              ? [
                  { entityId: '45', data: { workshopId: '5' } },
                  { entityId: '46', data: { workshopId: '5' } },
                ]
              : [],
          ),
        );

      it('lệnh không còn thiếu sắt -> đóng; lệnh còn thiếu -> giữ', async () => {
        openNotes();
        cutAllocation.steelGapsByPi.mockResolvedValue(new Map([['46', [gap]]]));

        await service.evaluate();

        expect(cutAllocation.steelGapsByPi).toHaveBeenCalledWith(5n, expect.any(CutSnapshotCache));
        expect(notifications.resolve).toHaveBeenCalledWith({
          entityType: 'PRODUCTION_INVOICE',
          entityId: '45',
          types: ['CUT_PULL_STEEL_TO_ISSUE'],
        });
        expect(notifications.resolve).not.toHaveBeenCalledWith(
          expect.objectContaining({ entityId: '46', entityType: 'PRODUCTION_INVOICE' }),
        );
      });

      it('không có nhắc đang mở -> bước đóng tin không truy vấn; chỉ đối soát tra 1 lần cho xưởng', async () => {
        await service.evaluate();
        expect(cutAllocation.steelGapsByPi).toHaveBeenCalledTimes(1);
      });

      it('tính thiếu sắt lỗi -> không đóng nhầm, evaluate không vỡ', async () => {
        openNotes();
        cutAllocation.steelGapsByPi.mockRejectedValue(new Error('boom'));

        await expect(service.evaluate()).resolves.toBeUndefined();

        expect(notifications.resolve).not.toHaveBeenCalledWith(
          expect.objectContaining({ entityType: 'PRODUCTION_INVOICE' }),
        );
      });
    });

    describe('đối soát tin xuất sắt (RECONCILE)', () => {
      const PULL = 'CUT_PULL_STEEL_TO_ISSUE';
      const lines = 'Sắt hộp 6zem 10x20: còn 12 cây';
      /** Lệnh 45 đang chạy (có SKU ACTIVE) ở xưởng 5, có dòng chia, còn thiếu sắt và còn kho giữ. */
      const setup = (over: { started?: bigint[]; recheck?: boolean; gaps?: unknown[] } = {}) => {
        cutAllocation.steelGapsByPi.mockResolvedValue(new Map([['45', over.gaps ?? [gap]]]));
        cutAllocation.startedAllocationPiIds.mockResolvedValue(over.started ?? [45n]);
        prisma.productionInvoice.findMany.mockResolvedValue([
          { id: 45n, code: 'PI-45', cuttingRecheckRequired: over.recheck ?? false },
        ]);
      };
      const openTin = (data: Record<string, unknown>) =>
        prisma.notification.findFirst.mockImplementation((args: { where: { type: unknown } }) =>
          Promise.resolve(args.where.type === PULL ? { data } : null),
        );
      const pullEmits = () =>
        (notifications.emit.mock.calls as unknown[][]).filter((c) => c[0] === PULL);

      it('chưa có tin mở -> phát tin mới, source RECONCILE, đủ loại sắt + kho', async () => {
        setup();
        await service.evaluate();
        expect(prisma.notification.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              type: PULL,
              dedupeKey: 'cut-pull-steel:45',
              recipients: { some: { resolvedAt: null } },
            },
          }),
        );
        expect(notifications.emit).toHaveBeenCalledWith(PULL, {
          entityId: '45',
          dedupeKey: 'cut-pull-steel:45',
          params: {
            piCode: 'PI-45',
            workshopId: '5',
            lines,
            warehouseCodes: ['kho-sat', 'kho-sat-2'],
            source: 'RECONCILE',
          },
        });
      });

      it('đã có tin mở, nội dung y nguyên -> không phát, không cập nhật', async () => {
        setup();
        openTin({ lines, warehouseCodes: ['kho-sat', 'kho-sat-2'], source: 'MANUAL' });
        await service.evaluate();
        expect(pullEmits()).toEqual([]);
        expect(notifications.updateOpenContent).not.toHaveBeenCalled();
      });

      it('lệnh cờ cuttingRecheckRequired -> không phát', async () => {
        setup({ recheck: true });
        await service.evaluate();
        expect(pullEmits()).toEqual([]);
      });

      it('lệnh chưa chạy (không có SKU ACTIVE ở xưởng) -> không phát', async () => {
        setup({ started: [] });
        await service.evaluate();
        expect(pullEmits()).toEqual([]);
      });

      it('thiếu sắt nhưng không kho nào còn giữ chỗ -> không phát', async () => {
        setup({ gaps: [{ ...gap, warehouseCodes: [] }] });
        await service.evaluate();
        expect(pullEmits()).toEqual([]);
        expect(prisma.productionInvoice.findMany).not.toHaveBeenCalled();
      });

      it('tin mở mà chỉ danh sách loại sắt đổi (kho cũ) -> updateOpenContent giữ nguồn cũ, không emit', async () => {
        setup();
        openTin({
          lines: 'Sắt hộp 6zem 10x20: còn 20 cây',
          warehouseCodes: ['kho-sat', 'kho-sat-2'],
          source: 'MANUAL',
        });
        await service.evaluate();
        expect(pullEmits()).toEqual([]);
        expect(notifications.updateOpenContent).toHaveBeenCalledWith(PULL, 'cut-pull-steel:45', {
          piCode: 'PI-45',
          workshopId: '5',
          lines,
          warehouseCodes: ['kho-sat', 'kho-sat-2'],
          source: 'MANUAL',
        });
      });

      it('tin mở mà có kho mới chưa trong tin -> emit gộp để thêm người nhận', async () => {
        setup();
        openTin({ lines, warehouseCodes: ['kho-sat'], source: 'AUTO_PULL' });
        await service.evaluate();
        expect(notifications.emit).toHaveBeenCalledWith(
          PULL,
          expect.objectContaining({
            entityId: '45',
            dedupeKey: 'cut-pull-steel:45',
            params: expect.objectContaining({
              warehouseCodes: ['kho-sat', 'kho-sat-2'],
            }) as unknown,
          }),
        );
        expect(notifications.updateOpenContent).not.toHaveBeenCalled();
      });

      it('updateOpenContent trả false (tin vừa đóng) -> phát tin mới', async () => {
        setup();
        openTin({ lines: 'cũ', warehouseCodes: ['kho-sat', 'kho-sat-2'] });
        notifications.updateOpenContent.mockResolvedValue(false);
        await service.evaluate();
        expect(pullEmits()).toHaveLength(1);
      });

      it('lệnh hết thiếu sắt -> vẫn đóng tin như cũ và không phát mới', async () => {
        prisma.notification.findMany.mockImplementation((args: { where: { type: unknown } }) =>
          Promise.resolve(
            args.where.type === PULL ? [{ entityId: '45', data: { workshopId: '5' } }] : [],
          ),
        );
        cutAllocation.steelGapsByPi.mockResolvedValue(new Map());
        cutAllocation.startedAllocationPiIds.mockResolvedValue([45n]);
        await service.evaluate();
        expect(notifications.resolve).toHaveBeenCalledWith({
          entityType: 'PRODUCTION_INVOICE',
          entityId: '45',
          types: [PULL],
        });
        expect(pullEmits()).toEqual([]);
      });

      it('xưởng lỗi thì chỉ log, evaluate không vỡ và các bước sau vẫn chạy', async () => {
        cutAllocation.steelGapsByPi.mockRejectedValue(new Error('boom'));
        await expect(service.evaluate()).resolves.toBeUndefined();
        expect(paintReminder.syncAll).toHaveBeenCalledTimes(1);
      });

      it('lỗi emit 1 lệnh không cản lệnh khác', async () => {
        cutAllocation.steelGapsByPi.mockResolvedValue(
          new Map([
            ['45', [gap]],
            ['46', [gap]],
          ]),
        );
        cutAllocation.startedAllocationPiIds.mockResolvedValue([45n, 46n]);
        prisma.productionInvoice.findMany.mockResolvedValue([
          { id: 45n, code: 'PI-45', cuttingRecheckRequired: false },
          { id: 46n, code: 'PI-46', cuttingRecheckRequired: false },
        ]);
        notifications.emit.mockImplementation((type: string, o: { entityId: string }) =>
          type === PULL && o.entityId === '45' ? Promise.reject(new Error('x')) : Promise.resolve(),
        );
        await service.evaluate();
        expect(pullEmits()).toHaveLength(2);
      });
    });

    it('autoCompletePhoi đóng được dòng -> phát realtime để màn hàng đợi tự tải lại', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([running(7n, 'PHOI', 'PI-45')]);
      admin.computeProgress.mockResolvedValue({
        required: 10,
        reported: 10,
        percent: 100,
        complete: true,
        passed: 10,
      });

      await service.evaluate();

      expect(realtime.publishEntityChanged).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'FLOOR_REPORT', actorId: null }),
      );
    });
  });

  describe('đợt chờ KCS chấm quá lâu (KCS_BATCH_STALE, theo tổ x xưởng)', () => {
    const staleParams = (stage: string, count: number, ws: string, name: string) => ({
      stage,
      count,
      hours: KCS_STALE_HOURS,
      workshopId: ws,
      workshopName: name,
    });
    /** Danh sách tin đang mở theo type (mặc định rỗng). */
    const openByType = (byType: Record<string, Array<{ entityId: string }>>) =>
      prisma.notification.findMany.mockImplementation((args: { where: { type: string } }) =>
        Promise.resolve(byType[args.where.type] ?? []),
      );

    it('AC18: 2 xưởng + Sơn nhờ -> 3 tin KCS_BATCH_STALE riêng, entityId <tổ>:<xưởng>', async () => {
      listPending.mockResolvedValue([
        pendingItem('PHOI', 45n),
        ...Array.from({ length: 4 }, () => pendingItem('PHOI', 46n)),
        staleBatch('SON', 46n),
      ]);

      await service.evaluate();

      expect(notifications.emit).toHaveBeenCalledWith('KCS_BATCH_STALE', {
        entityId: 'PHOI:5',
        dedupeKey: 'KCS_BATCH_STALE:PHOI:5',
        params: staleParams('PHOI', 1, '5', 'Phú An'),
      });
      expect(notifications.emit).toHaveBeenCalledWith('KCS_BATCH_STALE', {
        entityId: 'PHOI:6',
        dedupeKey: 'KCS_BATCH_STALE:PHOI:6',
        params: staleParams('PHOI', 4, '6', 'Phước An'),
      });
      // lô Sơn của lệnh Phước An nằm ở xưởng nơi sơn = Phú An
      expect(notifications.emit).toHaveBeenCalledWith('KCS_BATCH_STALE', {
        entityId: 'SON:5',
        dedupeKey: 'KCS_BATCH_STALE:SON:5',
        params: staleParams('SON', 1, '5', 'Phú An'),
      });
      expect(notifications.emit).toHaveBeenCalledTimes(3);
      expect(notifications.emit).not.toHaveBeenCalledWith('FLOOR_BATCH_STALE', expect.anything());
    });

    it('đợt không suy ra được xưởng -> nhóm none, params KHÔNG có khoá workshopId', async () => {
      staleCut(2, 999n);

      await service.evaluate();

      expect(notifications.emit).toHaveBeenCalledWith('KCS_BATCH_STALE', {
        entityId: 'PHOI:none',
        dedupeKey: 'KCS_BATCH_STALE:PHOI:none',
        params: { stage: 'PHOI', count: 2, hours: KCS_STALE_HOURS },
      });
    });

    it('đợt đã chốt chờ chấm (AWAITING_QC) cũng tính', async () => {
      listPending.mockResolvedValue([pendingItem('HAN', 45n, null, 'AWAITING_QC')]);

      await service.evaluate();

      expect(notifications.emit).toHaveBeenCalledWith(
        'KCS_BATCH_STALE',
        expect.objectContaining({ entityId: 'HAN:5' }),
      );
    });

    it('dòng bị chặn (lệnh dừng / chưa gắn SKU) không tính vào tin', async () => {
      listPending.mockResolvedValue([
        pendingItem('PHOI', 45n, 'LENH_DUNG'),
        pendingItem('PHOI', 45n, 'CHUA_GAN_SKU'),
        pendingItem('PHOI', 45n),
      ]);

      await service.evaluate();

      expect(notifications.emit).toHaveBeenCalledTimes(1);
      expect(notifications.emit).toHaveBeenCalledWith(
        'KCS_BATCH_STALE',
        expect.objectContaining({ params: staleParams('PHOI', 1, '5', 'Phú An') }),
      );
    });

    it('mốc = bây giờ - KCS_STALE_HOURS, truyền xuống listKcsPendingItems', async () => {
      const now = new Date('2026-10-13T12:00:00Z');

      await service.evaluate(now);

      expect(listPending).toHaveBeenCalledWith(prisma, {
        staleBefore: new Date(now.getTime() - KCS_STALE_HOURS * 3_600_000),
      });
    });

    it('AC4: tin đang mở, số đổi -> updateOpenContent (không emit lại, giữ đã đọc)', async () => {
      staleCut(6, 46n);
      prisma.notification.findFirst.mockResolvedValue({
        id: 'n1',
        data: { count: 4, workshopName: 'Phước An' },
      });

      await service.evaluate();

      expect(notifications.updateOpenContent).toHaveBeenCalledWith(
        'KCS_BATCH_STALE',
        'KCS_BATCH_STALE:PHOI:6',
        staleParams('PHOI', 6, '6', 'Phước An'),
      );
      expect(notifications.emit).not.toHaveBeenCalled();
    });

    it('tin đang mở, số không đổi -> không làm gì', async () => {
      staleCut(4, 46n);
      prisma.notification.findFirst.mockResolvedValue({
        id: 'n1',
        data: { count: 4, workshopName: 'Phước An' },
      });

      await service.evaluate();

      expect(notifications.updateOpenContent).not.toHaveBeenCalled();
      expect(notifications.emit).not.toHaveBeenCalled();
    });

    it('updateOpenContent trả false (tin vừa đóng) -> phát tin mới', async () => {
      staleCut(2, 45n);
      prisma.notification.findFirst.mockResolvedValueOnce({ id: 'n1', data: { count: 1 } });
      notifications.updateOpenContent.mockResolvedValue(false);

      await service.evaluate();

      expect(notifications.emit).toHaveBeenCalledWith(
        'KCS_BATCH_STALE',
        expect.objectContaining({ entityId: 'PHOI:5' }),
      );
    });

    it('hết đợt -> đóng đúng tin KCS_BATCH_STALE của nhóm hết; nhóm còn thì giữ', async () => {
      staleCut(1, 45n);
      openByType({ KCS_BATCH_STALE: [{ entityId: 'PHOI:6' }, { entityId: 'PHOI:5' }] });

      await service.evaluate();

      expect(notifications.resolve).toHaveBeenCalledWith({
        entityType: 'FLOOR_STAGE',
        entityId: 'PHOI:6',
        types: ['KCS_BATCH_STALE'],
      });
      expect(notifications.resolve).not.toHaveBeenCalledWith(
        expect.objectContaining({ entityId: 'PHOI:5', types: ['KCS_BATCH_STALE'] }),
      );
    });

    it('2 xưởng: xưởng B hết, xưởng A giữ nguyên -> chỉ đóng tin B, không tạo tin mới', async () => {
      staleCut(3, 45n); // chỉ còn xưởng A (5)
      prisma.notification.findFirst.mockResolvedValue({
        id: 'nA',
        data: { count: 3, workshopName: 'Phú An' },
      });
      openByType({ KCS_BATCH_STALE: [{ entityId: 'PHOI:5' }, { entityId: 'PHOI:6' }] });

      await service.evaluate();

      expect(notifications.emit).not.toHaveBeenCalled();
      expect(notifications.updateOpenContent).not.toHaveBeenCalled();
      expect(notifications.resolve).toHaveBeenCalledWith({
        entityType: 'FLOOR_STAGE',
        entityId: 'PHOI:6',
        types: ['KCS_BATCH_STALE'],
      });
      expect(notifications.resolve).not.toHaveBeenCalledWith(
        expect.objectContaining({ entityId: 'PHOI:5', types: ['KCS_BATCH_STALE'] }),
      );
    });

    it('FLOOR_BATCH_STALE không phát nữa; tin cũ còn mở (kể cả entityId kiểu cũ) bị đóng hết', async () => {
      staleCut(2, 45n);
      openByType({
        FLOOR_BATCH_STALE: [{ entityId: 'PHOI' }, { entityId: 'PHOI:5' }, { entityId: 'HAN:none' }],
      });

      await service.evaluate();

      expect(notifications.emit).not.toHaveBeenCalledWith('FLOOR_BATCH_STALE', expect.anything());
      for (const id of ['PHOI', 'PHOI:5', 'HAN:none']) {
        expect(notifications.resolve).toHaveBeenCalledWith({
          entityType: 'FLOOR_STAGE',
          entityId: id,
          types: ['FLOOR_BATCH_STALE'],
        });
      }
    });
  });

  describe('nhắc chuyển mảnh Hàn -> Sơn', () => {
    it('evaluate có bước paintTransfer: gọi paintReminder.syncAll', async () => {
      await service.evaluate();
      expect(paintReminder.syncAll).toHaveBeenCalledTimes(1);
    });

    it('syncAll lỗi -> chỉ log, các bước khác vẫn chạy và evaluate không vỡ', async () => {
      paintReminder.syncAll.mockRejectedValue(new Error('boom'));
      staleCut(1);

      await expect(service.evaluate()).resolves.toBeUndefined();

      expect(notifications.emit).toHaveBeenCalledWith(
        'KCS_BATCH_STALE',
        expect.objectContaining({ entityId: 'PHOI:5' }),
      );
    });
  });

  describe('giới hạn tần suất evaluate do thao tác /floor gây ra', () => {
    const DEBOUNCE = 3_000;
    const runs = () => prisma.floorQueueEntry.findMany.mock.calls.length;

    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      service.onModuleDestroy();
      jest.useRealTimers();
    });

    it('lượt đầu chạy sau debounce 3 giây', async () => {
      service.requestEvaluate();
      await jest.advanceTimersByTimeAsync(DEBOUNCE - 1);
      expect(runs()).toBe(0);
      await jest.advanceTimersByTimeAsync(1);
      expect(runs()).toBe(1);
    });

    it('FLOOR_ALERTS=off: cả yêu cầu thường lẫn urgent đều không chạy evaluate', async () => {
      const old = process.env.FLOOR_ALERTS;
      process.env.FLOOR_ALERTS = 'off';
      try {
        service.requestEvaluate();
        service.requestEvaluate({ urgent: true });
        await jest.advanceTimersByTimeAsync(DEBOUNCE + MIN_EVALUATE_GAP_MS * 2);
        expect(runs()).toBe(0);
        expect(listPending).not.toHaveBeenCalled();
        expect(notifications.emit).not.toHaveBeenCalled();
      } finally {
        if (old === undefined) delete process.env.FLOOR_ALERTS;
        else process.env.FLOOR_ALERTS = old;
      }
    });

    it('yêu cầu liên tiếp chỉ chạy tối đa 1 lần / 30 giây, có đúng 1 lượt chạy bù cuối khoảng', async () => {
      service.requestEvaluate();
      await jest.advanceTimersByTimeAsync(DEBOUNCE);
      expect(runs()).toBe(1); // t = 3s: bắt đầu lượt 1

      // Nhiều yêu cầu trong khoảng: không chạy thêm cho tới cuối khoảng.
      for (let i = 0; i < 5; i++) {
        service.requestEvaluate();
        await jest.advanceTimersByTimeAsync(DEBOUNCE);
      }
      expect(runs()).toBe(1);

      await jest.advanceTimersByTimeAsync(MIN_EVALUATE_GAP_MS); // quá cuối khoảng
      expect(runs()).toBe(2); // lượt bù

      await jest.advanceTimersByTimeAsync(MIN_EVALUATE_GAP_MS * 2);
      expect(runs()).toBe(2); // không còn yêu cầu nào -> không chạy thêm
    });

    it('lượt bù chạy đúng lúc đủ MIN_EVALUATE_GAP_MS kể từ lượt trước', async () => {
      service.requestEvaluate();
      await jest.advanceTimersByTimeAsync(DEBOUNCE); // lượt 1 bắt đầu tại t=3s
      service.requestEvaluate(); // debounce tới t=6s, hẹn bù tới t=33s
      await jest.advanceTimersByTimeAsync(MIN_EVALUATE_GAP_MS - 1);
      expect(runs()).toBe(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(runs()).toBe(2);
    });

    it('qua khoảng 30 giây rồi thì yêu cầu mới chạy ngay sau debounce, không chờ thêm', async () => {
      service.requestEvaluate();
      await jest.advanceTimersByTimeAsync(DEBOUNCE);
      await jest.advanceTimersByTimeAsync(MIN_EVALUATE_GAP_MS);
      service.requestEvaluate();
      await jest.advanceTimersByTimeAsync(DEBOUNCE);
      expect(runs()).toBe(2);
    });

    it('urgent: gom 3 giây như cũ nhưng bỏ qua khoảng 30 giây', async () => {
      service.requestEvaluate();
      await jest.advanceTimersByTimeAsync(DEBOUNCE);
      expect(runs()).toBe(1);

      service.requestEvaluate({ urgent: true });
      await jest.advanceTimersByTimeAsync(DEBOUNCE - 1);
      expect(runs()).toBe(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(runs()).toBe(2);
    });

    it('urgent đến khi yêu cầu thường đang chờ debounce: lượt đó bỏ qua khoảng 30 giây', async () => {
      service.requestEvaluate();
      await jest.advanceTimersByTimeAsync(DEBOUNCE);
      service.requestEvaluate();
      await jest.advanceTimersByTimeAsync(1_000);
      service.requestEvaluate({ urgent: true });
      await jest.advanceTimersByTimeAsync(DEBOUNCE);
      expect(runs()).toBe(2);
      await jest.advanceTimersByTimeAsync(MIN_EVALUATE_GAP_MS * 2);
      expect(runs()).toBe(2);
    });

    it('urgent đến khi đã hẹn lượt bù: chạy luôn sau debounce và huỷ lượt bù', async () => {
      service.requestEvaluate();
      await jest.advanceTimersByTimeAsync(DEBOUNCE);
      service.requestEvaluate();
      await jest.advanceTimersByTimeAsync(DEBOUNCE); // đã hẹn bù
      service.requestEvaluate({ urgent: true });
      await jest.advanceTimersByTimeAsync(DEBOUNCE);
      expect(runs()).toBe(2);
      await jest.advanceTimersByTimeAsync(MIN_EVALUATE_GAP_MS * 2);
      expect(runs()).toBe(2);
    });

    describe('không làm rơi yêu cầu đến giữa lúc đang chạy', () => {
      let release: () => void;
      beforeEach(() => {
        // Lượt đầu bị giữ lại cho tới khi gọi release(); các lượt sau chạy ngay.
        prisma.floorQueueEntry.findMany.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              release = () => resolve([]);
            }),
        );
      });

      it('urgent đến lúc đang chạy: chạy 1 lượt ngay sau khi lượt hiện tại xong, không chạy chồng', async () => {
        service.requestEvaluate();
        await jest.advanceTimersByTimeAsync(DEBOUNCE);
        expect(runs()).toBe(1); // đang chạy (bị giữ)

        service.requestEvaluate({ urgent: true });
        await jest.advanceTimersByTimeAsync(DEBOUNCE);
        expect(runs()).toBe(1); // vẫn chỉ 1: không chạy chồng

        release();
        await jest.advanceTimersByTimeAsync(0);
        expect(runs()).toBe(2); // lượt xếp sau chạy ngay
      });

      it('yêu cầu thường đến lúc đang chạy: vẫn được chạy, đúng lúc đủ khoảng 30 giây', async () => {
        service.requestEvaluate();
        await jest.advanceTimersByTimeAsync(DEBOUNCE);
        service.requestEvaluate();
        await jest.advanceTimersByTimeAsync(DEBOUNCE);
        expect(runs()).toBe(1);

        release();
        await jest.advanceTimersByTimeAsync(0);
        expect(runs()).toBe(1); // chưa đủ khoảng
        await jest.advanceTimersByTimeAsync(MIN_EVALUATE_GAP_MS);
        expect(runs()).toBe(2);
      });

      it('nhiều yêu cầu đến lúc đang chạy chỉ xếp đúng 1 lượt sau', async () => {
        service.requestEvaluate();
        await jest.advanceTimersByTimeAsync(DEBOUNCE);
        for (let i = 0; i < 4; i++) {
          service.requestEvaluate({ urgent: true });
          await jest.advanceTimersByTimeAsync(DEBOUNCE);
        }
        release();
        await jest.advanceTimersByTimeAsync(MIN_EVALUATE_GAP_MS * 3);
        expect(runs()).toBe(2);
      });
    });
  });

  describe('đo thời gian mỗi lượt evaluate', () => {
    let warn: jest.SpyInstance;
    let debug: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    });
    afterEach(() => {
      warn.mockRestore();
      debug.mockRestore();
      jest.useRealTimers();
    });

    it('lượt nhanh: log debug kèm thời gian từng bước, không warn', async () => {
      await service.evaluate();
      expect(warn).not.toHaveBeenCalled();
      expect(debug).toHaveBeenCalledWith(
        expect.stringMatching(
          /stageComplete=\d+ms, stale=\d+ms, cutMachines=\d+ms, pullSteelIssued=\d+ms/,
        ),
      );
    });

    it('lượt chậm > 2000 ms: log warn kèm thời gian từng bước', async () => {
      jest.useFakeTimers();
      prisma.floorQueueEntry.findMany.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 2_500)),
      );
      const done = service.evaluate();
      await jest.advanceTimersByTimeAsync(2_600);
      await done;
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('stageComplete=2500ms'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('pullSteelIssued='));
    });
  });

  describe('snapshot chia máy dùng chung trong 1 lượt', () => {
    beforeEach(() => {
      prisma.workstation.findMany.mockResolvedValue([{ workshopId: 5n }]);
      prisma.notification.findMany.mockImplementation(({ where }: { where: { type?: unknown } }) =>
        Promise.resolve(
          where.type === 'CUT_PULL_STEEL_TO_ISSUE'
            ? [{ entityId: '46', data: { workshopId: '5' } }]
            : [],
        ),
      );
    });

    it('tiến độ máy và thiếu sắt dùng CHUNG một cache của lượt, lượt sau lập cache mới', async () => {
      await service.evaluate();
      await service.evaluate();
      const progressCalls = cutAllocation.machineProgressByWorkshop.mock.calls as Array<
        [bigint, CutSnapshotCache]
      >;
      const gapCalls = cutAllocation.steelGapsByPi.mock.calls as Array<[bigint, CutSnapshotCache]>;
      expect(progressCalls).toHaveLength(2);
      // Mỗi lượt tra thiếu sắt 2 lần (đóng tin + đối soát), cùng 1 cache của lượt.
      expect(gapCalls).toHaveLength(4);
      expect(gapCalls[0][1]).toBe(progressCalls[0][1]);
      expect(gapCalls[1][1]).toBe(progressCalls[0][1]);
      expect(gapCalls[2][1]).toBe(progressCalls[1][1]);
      expect(gapCalls[3][1]).toBe(progressCalls[1][1]);
      expect(progressCalls[1][1]).not.toBe(progressCalls[0][1]);
    });

    it('sau khi autoPull ghi dòng chia thì bỏ cache của xưởng đó, rồi mới tính lại tiến độ', async () => {
      const order: string[] = [];
      const invalidate = jest
        .spyOn(CutSnapshotCache.prototype, 'invalidate')
        .mockImplementation(() => {
          order.push('invalidate');
        });
      cutAllocation.machineProgressByWorkshop.mockImplementation(() => {
        order.push('progress');
        return Promise.resolve([machine({ status: 'IDLE', barsLeft: 0 })]);
      });
      cutAllocation.autoPull.mockImplementation(() => {
        order.push('pull');
        return Promise.resolve({
          workshopId: '5',
          workshopName: 'Phú An',
          machines: [{ id: '12', name: 'Máy 1' }],
          orders: [],
        });
      });
      try {
        await service.evaluate();
        expect(order.slice(0, 4)).toEqual(['progress', 'pull', 'invalidate', 'progress']);
        expect(invalidate).toHaveBeenCalledWith(5n);
      } finally {
        invalidate.mockRestore();
      }
    });

    it('autoPull không kéo được (null) thì không bỏ cache', async () => {
      const invalidate = jest.spyOn(CutSnapshotCache.prototype, 'invalidate');
      cutAllocation.machineProgressByWorkshop.mockResolvedValue([
        machine({ status: 'IDLE', barsLeft: 0 }),
      ]);
      try {
        await service.evaluate();
        expect(cutAllocation.autoPull).toHaveBeenCalledTimes(1);
        expect(invalidate).not.toHaveBeenCalled();
      } finally {
        invalidate.mockRestore();
      }
    });
  });

  it('requestEvaluate gom nhiều thao tác ghi dồn dập thành 1 lần kiểm tra', () => {
    jest.useFakeTimers();
    try {
      const spy = jest.spyOn(service, 'evaluate').mockResolvedValue(undefined);
      service.requestEvaluate();
      service.requestEvaluate();
      service.requestEvaluate();
      expect(spy).not.toHaveBeenCalled();
      jest.advanceTimersByTime(3_500);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('không chạy chồng: evaluate đang chạy thì lần gọi thứ 2 bị bỏ qua', async () => {
    prisma.floorQueueEntry.findMany.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([]), 30)),
    );

    await Promise.all([service.evaluate(), service.evaluate()]);

    expect(prisma.floorQueueEntry.findMany).toHaveBeenCalledTimes(1);
  });
});
