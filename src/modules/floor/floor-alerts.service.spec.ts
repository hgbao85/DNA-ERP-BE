import { PrismaServiceType } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FloorAdminService } from './floor-admin.service';
import { FloorAlertsService, STALE_HOURS } from './floor-alerts.service';

describe('FloorAlertsService', () => {
  let prisma: {
    floorQueueEntry: { findMany: jest.Mock };
    notification: { findMany: jest.Mock; findFirst: jest.Mock };
    cutBundle: { count: jest.Mock };
    stepBatch: { findMany: jest.Mock };
    productionBatch: { groupBy: jest.Mock };
  };
  let admin: { computeProgress: jest.Mock };
  let notifications: { emit: jest.Mock; resolve: jest.Mock };
  let service: FloorAlertsService;

  const running = (id: bigint, stage: string, code: string) => ({
    id,
    stage,
    productionInvoiceId: 45n,
    productionInvoice: { code },
  });
  const progress = (complete: boolean) => ({
    required: 10,
    reported: complete ? 10 : 4,
    percent: 40,
    complete,
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
    };
    admin = { computeProgress: jest.fn().mockResolvedValue(progress(false)) };
    notifications = {
      emit: jest.fn().mockResolvedValue(undefined),
      resolve: jest.fn().mockResolvedValue(undefined),
    };
    service = new FloorAlertsService(
      prisma as unknown as PrismaServiceType,
      admin as unknown as FloorAdminService,
      notifications as unknown as NotificationsService,
    );
  });

  describe('tổ báo đủ số của PI đang chạy', () => {
    it('đủ số, chưa có nhắc đang mở -> nhắc QLSX 1 lần, khoá theo từng dòng hàng đợi', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([running(7n, 'PHOI', 'PI-45')]);
      admin.computeProgress.mockResolvedValue(progress(true));

      await service.evaluate();

      expect(notifications.emit).toHaveBeenCalledWith('FLOOR_STAGE_COMPLETE', {
        entityId: '7',
        dedupeKey: 'floor-stage-complete:7',
        params: { stage: 'PHOI', piCode: 'PI-45' },
      });
    });

    it('ĐÃ có nhắc đang mở -> KHÔNG phát lại (emit() sẽ gộp và đánh dấu chưa đọc lại = nhắc lặp mỗi lần quét)', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([running(7n, 'PHOI', 'PI-45')]);
      admin.computeProgress.mockResolvedValue(progress(true));
      prisma.notification.findFirst.mockResolvedValue({ id: 'n1' });

      await service.evaluate();
      await service.evaluate();

      expect(notifications.emit).not.toHaveBeenCalled();
    });

    it('chưa đủ số -> không nhắc; tính tiến độ lỗi (null) cũng không làm hỏng lượt kiểm tra', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([
        running(7n, 'PHOI', 'PI-45'),
        running(8n, 'HAN', 'PI-45'),
      ]);
      admin.computeProgress
        .mockResolvedValueOnce(progress(false))
        .mockRejectedValueOnce(new Error('boom'));

      await expect(service.evaluate()).resolves.toBeUndefined();

      expect(notifications.emit).not.toHaveBeenCalled();
    });

    it('PI không còn chạy (QLSX đã Chuyển PI tiếp) -> đóng nhắc cũ của dòng đó', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([running(9n, 'PHOI', 'PI-46')]); // dòng 7 đã DONE
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
