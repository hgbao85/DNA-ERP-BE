import { Logger } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CutAllocationService } from './cut-allocation.service';
import { CutSnapshotCache } from './cut-allocation-snapshot';
import { FloorAdminService } from './floor-admin.service';
import { FloorAlertsService, MIN_EVALUATE_GAP_MS, STALE_HOURS } from './floor-alerts.service';

describe('FloorAlertsService', () => {
  let prisma: {
    floorQueueEntry: { findMany: jest.Mock };
    notification: { findMany: jest.Mock; findFirst: jest.Mock };
    cutBundle: { count: jest.Mock };
    stepBatch: { findMany: jest.Mock };
    productionBatch: { groupBy: jest.Mock };
    workstation: { findMany: jest.Mock };
  };
  let admin: {
    computeProgress: jest.Mock;
    autoCompletePhoi: jest.Mock;
    ensurePhoiQueued: jest.Mock;
  };
  let cutAllocation: {
    machineProgressByWorkshop: jest.Mock;
    autoPull: jest.Mock;
    steelGapsByPi: jest.Mock;
  };
  let realtime: { publishEntityChanged: jest.Mock };
  let notifications: { emit: jest.Mock; resolve: jest.Mock };
  let service: FloorAlertsService;

  const running = (id: bigint, stage: string, code: string, status = 'RUNNING') => ({
    id,
    stage,
    status,
    productionInvoiceId: 45n,
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
      cutBundle: { count: jest.fn().mockResolvedValue(0) },
      stepBatch: { findMany: jest.fn().mockResolvedValue([]) },
      productionBatch: { groupBy: jest.fn().mockResolvedValue([]) },
      workstation: { findMany: jest.fn().mockResolvedValue([]) },
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
    };
    realtime = { publishEntityChanged: jest.fn() };
    notifications = {
      emit: jest.fn().mockResolvedValue(undefined),
      resolve: jest.fn().mockResolvedValue(undefined),
    };
    service = new FloorAlertsService(
      prisma as unknown as PrismaServiceType,
      admin as unknown as FloorAdminService,
      notifications as unknown as NotificationsService,
      cutAllocation as unknown as CutAllocationService,
      realtime as unknown as RealtimeService,
    );
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
        params: { stage: 'HAN', piCode: 'PI-45' },
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
        params: { piCode: 'PI-45', nextPiCode: 'PI-46' },
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
      prisma.cutBundle.count.mockResolvedValue(1);

      await expect(service.evaluate()).resolves.toBeUndefined();

      expect(notifications.emit).toHaveBeenCalledWith(
        'FLOOR_BATCH_STALE',
        expect.objectContaining({ entityId: 'PHOI' }),
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
      expect(admin.ensurePhoiQueued).toHaveBeenCalledWith([45n]);
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

    it('lệnh còn thiếu sắt xuất xuống Phôi -> báo thủ kho CUT_PULL_STEEL_TO_ISSUE (emit cùng dedupeKey để gộp/cập nhật)', async () => {
      cutAllocation.machineProgressByWorkshop.mockResolvedValue([
        machine({ status: 'IDLE', barsLeft: 0 }),
      ]);
      cutAllocation.autoPull.mockResolvedValue(pulled([gap]));
      // thông báo xuất sắt của lệnh còn mở từ lần kéo trước: vẫn phải emit để cập nhật nội dung.
      prisma.notification.findFirst.mockResolvedValue({ id: 'old' });

      await service.evaluate();

      expect(notifications.emit).toHaveBeenCalledWith('CUT_PULL_STEEL_TO_ISSUE', {
        entityId: '45',
        dedupeKey: 'cut-pull-steel:45',
        params: {
          piCode: 'PI-45',
          workshopId: '5',
          lines: 'Sắt hộp 6zem 10x20: còn 12 cây',
          warehouseCodes: ['kho-sat', 'kho-sat-2'],
        },
      });
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
      prisma.cutBundle.count.mockResolvedValue(1);

      await expect(service.evaluate()).resolves.toBeUndefined();

      expect(notifications.emit).toHaveBeenCalledWith('CUT_MACHINE_IDLE', expect.anything());
      expect(notifications.emit).toHaveBeenCalledWith(
        'FLOOR_BATCH_STALE',
        expect.objectContaining({ entityId: 'PHOI' }),
      );
      expect(realtime.publishEntityChanged).not.toHaveBeenCalled();
    });

    it('thêm hàng đợi Phôi lỗi -> vẫn báo và phát realtime (dòng chia đã ghi)', async () => {
      cutAllocation.machineProgressByWorkshop.mockResolvedValue([
        machine({ status: 'IDLE', barsLeft: 0 }),
      ]);
      cutAllocation.autoPull.mockResolvedValue(pulled());
      admin.ensurePhoiQueued.mockRejectedValue(new Error('boom'));

      await expect(service.evaluate()).resolves.toBeUndefined();

      expect(notifications.emit).toHaveBeenCalledWith('CUT_ORDER_PULLED', expect.anything());
      expect(realtime.publishEntityChanged).toHaveBeenCalledTimes(1);
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

      it('không có nhắc đang mở -> không truy vấn thiếu sắt', async () => {
        await service.evaluate();
        expect(cutAllocation.steelGapsByPi).not.toHaveBeenCalled();
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

  describe('đợt chờ gửi KCS quá lâu', () => {
    it('tổ có đợt quá hạn -> nhắc đúng tổ đó; tổ không có -> đóng nhắc cũ', async () => {
      prisma.cutBundle.count.mockResolvedValue(2);
      prisma.productionBatch.groupBy.mockResolvedValue([{ stage: 'HAN', _count: { _all: 1 } }]);
      prisma.stepBatch.findMany.mockResolvedValue([{ id: 1n }]);

      await service.evaluate();

      // Phôi = 2 đợt cắt + 1 nhóm công đoạn phụ
      expect(notifications.emit).toHaveBeenCalledWith('FLOOR_BATCH_STALE', {
        entityId: 'PHOI',
        dedupeKey: 'floor-batch-stale:PHOI',
        params: { stage: 'PHOI', count: 3, hours: STALE_HOURS },
      });
      expect(notifications.emit).toHaveBeenCalledWith(
        'FLOOR_BATCH_STALE',
        expect.objectContaining({ entityId: 'HAN' }),
      );
      expect(notifications.emit).not.toHaveBeenCalledWith(
        'FLOOR_BATCH_STALE',
        expect.objectContaining({ entityId: 'SON' }),
      );
      expect(notifications.resolve).toHaveBeenCalledWith({
        entityType: 'FLOOR_STAGE',
        entityId: 'SON',
        types: ['FLOOR_BATCH_STALE'],
      });
    });

    it('ngưỡng tính theo lần báo CÒN HIỆU LỰC đầu tiên (bỏ lần đã bị đảo), mốc = bây giờ - STALE_HOURS', async () => {
      const now = new Date('2026-10-13T12:00:00Z');

      await service.evaluate(now);

      const where = (prisma.cutBundle.count.mock.calls as unknown[][])[0][0] as {
        where: { status: string; floorReports: { some: Record<string, unknown> } };
      };
      expect(where.where.status).toBe('CUTTING');
      expect(where.where.floorReports.some).toEqual({
        createdAt: { lt: new Date(now.getTime() - STALE_HOURS * 3_600_000) },
        reversalOfId: null,
        reversedBy: { is: null },
      });
    });

    it('đã có nhắc quá hạn đang mở -> không phát lại', async () => {
      prisma.cutBundle.count.mockResolvedValue(1);
      prisma.notification.findFirst.mockResolvedValue({ id: 'n1' });

      await service.evaluate();

      expect(notifications.emit).not.toHaveBeenCalled();
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
      expect(gapCalls).toHaveLength(2);
      expect(gapCalls[0][1]).toBe(progressCalls[0][1]);
      expect(gapCalls[1][1]).toBe(progressCalls[1][1]);
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
