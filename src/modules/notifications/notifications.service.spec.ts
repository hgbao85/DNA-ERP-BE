// jest's `expect.objectContaining` is typed `any`, which trips no-unsafe-assignment on
// every `toHaveBeenCalledWith(expect.objectContaining({...}))` below - standard jest usage.
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { NotFoundException } from '@nestjs/common';
import { NotificationAudience } from '../../generated/prisma/client';
import { BUSINESS_ROLES } from '../../common/constants/roles.constant';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { RecipientResolverService } from './recipient-resolver.service';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { NOTIFICATION_TYPES } from './notification-types';

// 2026-09-26: cutting-proposals chỉ còn ĐÚNG 1 type thật (CUTTING_PROPOSAL_AUTO_APPROVED, severity
// SUCCESS) sau khi bỏ 3 type "không thành công" theo quyết định người dùng (xem
// cutting-proposals.service.ts). Các test dưới đây kiểm CƠ CHẾ chung của emit()/resolve() (CRITICAL
// tự thêm BOSS, dedupe, resolve theo type) - không phải hành vi riêng của cắt sắt - nên đăng ký 2
// type GIẢ chỉ dùng trong file test này, tách khỏi registry nghiệp vụ thật để business đổi/xoá type
// sau này không làm vỡ test hạ tầng ở đây.
const TEST_ACTION_TYPE = 'TEST_ACTION_REQUIRED_TYPE';
const TEST_CRITICAL_TYPE = 'TEST_CRITICAL_ALERT_TYPE';

describe('NotificationsService', () => {
  beforeAll(() => {
    NOTIFICATION_TYPES[TEST_ACTION_TYPE] = {
      category: 'ACTION_REQUIRED',
      severity: 'WARNING',
      entityType: 'TEST_ENTITY',
      title: (p: { poNumber: string }) => `Test cần xử lý ${p.poNumber}`,
      message: (p: { blockReason?: string }) => `Lý do: ${p.blockReason ?? 'không rõ'}`,
      recipients: () => ({ roles: [BUSINESS_ROLES.PRODUCTION_MANAGER] }),
    };
    NOTIFICATION_TYPES[TEST_CRITICAL_TYPE] = {
      category: 'ALERT',
      severity: 'CRITICAL',
      entityType: 'TEST_ENTITY',
      title: (p: { poNumber: string }) => `Test lỗi ${p.poNumber}`,
      message: (p: { errorMessage?: string }) => p.errorMessage ?? 'Lỗi không rõ',
      recipients: () => ({ roles: [BUSINESS_ROLES.PRODUCTION_MANAGER] }),
    };
  });

  afterAll(() => {
    delete NOTIFICATION_TYPES[TEST_ACTION_TYPE];
    delete NOTIFICATION_TYPES[TEST_CRITICAL_TYPE];
  });

  let service: NotificationsService;
  let prisma: {
    notification: {
      create: jest.Mock;
      update: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    notificationRecipient: {
      createMany: jest.Mock;
      updateMany: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
      groupBy: jest.Mock;
    };
  };
  let recipientResolver: { resolve: jest.Mock };

  const notification = {
    id: 'notif-1',
    type: 'CUTTING_PROPOSAL_AUTO_APPROVED',
    category: 'RESULT',
    severity: 'SUCCESS',
    title: 'Đề xuất cắt sắt cho PO-1 đã tính xong và tự động duyệt',
    message: 'Đã tự trừ tồn kho...',
    entityType: 'CUTTING_PROPOSAL',
    entityId: '1',
    link: null,
    data: null,
    actorId: null,
    audience: null,
    createdBy: null,
    createdAt: new Date('2026-01-01'),
  };

  const announcement = {
    id: 'notif-2',
    type: null,
    category: 'ANNOUNCEMENT',
    severity: 'INFO',
    title: 'Nghỉ lễ',
    message: 'Công ty nghỉ lễ ngày mai',
    entityType: null,
    entityId: null,
    link: null,
    data: null,
    actorId: null,
    audience: NotificationAudience.ALL,
    createdBy: 'user-boss',
    createdAt: new Date('2026-01-02'),
  };

  beforeEach(() => {
    prisma = {
      notification: {
        create: jest.fn().mockResolvedValue(notification),
        update: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      notificationRecipient: {
        createMany: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };
    recipientResolver = { resolve: jest.fn().mockResolvedValue(['user-1', 'user-2']) };
    service = new NotificationsService(
      prisma as unknown as PrismaServiceType,
      recipientResolver as unknown as RecipientResolverService,
    );
  });

  describe('emit', () => {
    it('resolves recipients theo tiêu chí của type, tạo Notification rồi fan-out NotificationRecipient', async () => {
      await service.emit('CUTTING_PROPOSAL_AUTO_APPROVED', {
        entityId: '1',
        params: { poNumber: 'PO-1', proposalId: '1' },
      });

      expect(recipientResolver.resolve).toHaveBeenCalledWith(
        { roles: [BUSINESS_ROLES.PRODUCTION_MANAGER] },
        [],
        undefined,
      );
      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'CUTTING_PROPOSAL_AUTO_APPROVED',
            category: 'RESULT',
            severity: 'SUCCESS',
            title: 'Đề xuất cắt sắt cho PO-1 đã tính xong và tự động duyệt',
            entityType: 'CUTTING_PROPOSAL',
            entityId: '1',
          }),
        }),
      );
      expect(prisma.notificationRecipient.createMany).toHaveBeenCalledWith({
        data: [
          { notificationId: 'notif-1', userId: 'user-1' },
          { notificationId: 'notif-1', userId: 'user-2' },
        ],
      });
    });

    it('loại actorId khỏi người nhận (không báo cho chính người vừa thao tác)', async () => {
      await service.emit('CUTTING_PROPOSAL_AUTO_APPROVED', {
        entityId: '1',
        actorId: 'user-1',
        params: { poNumber: 'PO-1' },
      });

      expect(recipientResolver.resolve).toHaveBeenCalledWith(
        { roles: [BUSINESS_ROLES.PRODUCTION_MANAGER] },
        ['user-1'],
        undefined,
      );
    });

    it('CRITICAL tự thêm role BOSS vào tiêu chí người nhận', async () => {
      await service.emit(TEST_CRITICAL_TYPE as never, {
        entityId: '1',
        params: { poNumber: 'PO-1', errorMessage: 'lỗi solver' },
      });

      expect(recipientResolver.resolve).toHaveBeenCalledWith(
        { roles: [BUSINESS_ROLES.PRODUCTION_MANAGER, BUSINESS_ROLES.BOSS] },
        [],
        undefined,
      );
    });

    it('không tạo gì khi không có người nhận nào khớp tiêu chí', async () => {
      recipientResolver.resolve.mockResolvedValue([]);

      await service.emit('CUTTING_PROPOSAL_AUTO_APPROVED', {
        entityId: '1',
        params: { poNumber: 'PO-1' },
      });

      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('không throw khi type không tồn tại trong NOTIFICATION_TYPES (log rồi bỏ qua)', async () => {
      await expect(service.emit('KHONG_TON_TAI' as never, { params: {} })).resolves.toBeUndefined();
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('dedupeKey trùng + còn người nhận chưa resolved -> update dòng cũ, không tạo dòng mới', async () => {
      prisma.notification.findFirst.mockResolvedValue({ id: 'notif-existing' });
      prisma.notificationRecipient.findMany.mockResolvedValue([{ userId: 'user-1' }]);

      await service.emit(TEST_ACTION_TYPE as never, {
        entityId: '1',
        dedupeKey: `${TEST_ACTION_TYPE}:1`,
        params: { poNumber: 'PO-1', blockReason: 'thiếu vật tư' },
      });

      expect(prisma.notification.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            dedupeKey: `${TEST_ACTION_TYPE}:1`,
            recipients: { some: { resolvedAt: null } },
          },
        }),
      );
      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(prisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'notif-existing' } }),
      );
      // Đẩy lại CHƯA đọc cho người nhận hiện có - sự kiện vừa tái diễn.
      expect(prisma.notificationRecipient.updateMany).toHaveBeenCalledWith({
        where: { notificationId: 'notif-existing' },
        data: { readAt: null },
      });
      // user-2 khớp tiêu chí lần này nhưng chưa từng nhận -> fan-out bổ sung.
      expect(prisma.notificationRecipient.createMany).toHaveBeenCalledWith({
        data: [{ notificationId: 'notif-existing', userId: 'user-2' }],
      });
    });
  });

  describe('resolve', () => {
    it('đóng mọi NotificationRecipient chưa resolved khớp entityType/entityId', async () => {
      await service.resolve({ entityType: 'CUTTING_PROPOSAL', entityId: '1' });

      expect(prisma.notificationRecipient.updateMany).toHaveBeenCalledWith({
        where: {
          resolvedAt: null,
          notification: { entityType: 'CUTTING_PROPOSAL', entityId: '1' },
        },
        data: { resolvedAt: expect.any(Date) },
      });
    });

    it('lọc thêm theo types khi được truyền', async () => {
      await service.resolve({
        entityType: 'CUTTING_PROPOSAL',
        entityId: '1',
        types: [TEST_ACTION_TYPE as never],
      });

      expect(prisma.notificationRecipient.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            notification: expect.objectContaining({
              type: { in: [TEST_ACTION_TYPE] },
            }),
          }),
        }),
      );
    });
  });

  describe('createAnnouncement', () => {
    beforeEach(() => {
      prisma.notification.create.mockResolvedValue(announcement);
    });

    it('audience=ALL -> resolver nhận allActiveUsers', async () => {
      await service.createAnnouncement(
        { title: 'Nghỉ lễ', message: '...', audience: NotificationAudience.ALL },
        'user-boss',
      );

      expect(recipientResolver.resolve).toHaveBeenCalledWith({ allActiveUsers: true }, []);
      expect(prisma.notificationRecipient.createMany).toHaveBeenCalledWith({
        data: [
          { notificationId: 'notif-2', userId: 'user-1' },
          { notificationId: 'notif-2', userId: 'user-2' },
        ],
      });
    });

    it('audience khác ALL -> resolver nhận roles:[audience]', async () => {
      await service.createAnnouncement(
        { title: 'x', message: 'y', audience: NotificationAudience.BOSS },
        'user-boss',
      );

      expect(recipientResolver.resolve).toHaveBeenCalledWith(
        { roles: [NotificationAudience.BOSS] },
        [],
      );
    });

    it('stamps createdBy và không fan-out gì khi không ai khớp', async () => {
      recipientResolver.resolve.mockResolvedValue([]);

      const result = await service.createAnnouncement(
        { title: 'x', message: 'y', audience: NotificationAudience.BOSS },
        'user-boss',
      );

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ createdBy: 'user-boss' }) }),
      );
      expect(prisma.notificationRecipient.createMany).not.toHaveBeenCalled();
      expect(result.isRead).toBe(false);
    });
  });

  describe('findMyNotifications', () => {
    it('luôn loại trừ archived, mặc định lấy cả đã đọc lẫn chưa đọc', async () => {
      await service.findMyNotifications(
        {
          page: 1,
          limit: 20,
          sortOrder: 'desc',
          status: 'all',
        } as unknown as ListNotificationsQueryDto,
        'user-1',
      );

      expect(prisma.notificationRecipient.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1', archivedAt: null } }),
      );
    });

    it('status=unread thêm điều kiện readAt: null', async () => {
      await service.findMyNotifications(
        {
          page: 1,
          limit: 20,
          sortOrder: 'desc',
          status: 'unread',
        } as unknown as ListNotificationsQueryDto,
        'user-1',
      );

      expect(prisma.notificationRecipient.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', archivedAt: null, readAt: null },
        }),
      );
    });

    it('resolved=false lọc theo resolvedAt: null - KHÁC status=unread (đã đọc rồi vẫn phải hiện nếu chưa xử lý xong, xem "Cần xử lý" của NotificationCenter)', async () => {
      await service.findMyNotifications(
        {
          page: 1,
          limit: 20,
          sortOrder: 'desc',
          category: 'ACTION_REQUIRED',
          resolved: 'false',
        } as unknown as ListNotificationsQueryDto,
        'user-1',
      );

      expect(prisma.notificationRecipient.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'user-1',
            archivedAt: null,
            resolvedAt: null,
            notification: { category: 'ACTION_REQUIRED' },
          },
        }),
      );
    });

    it('resolved=true lọc theo resolvedAt: { not: null }', async () => {
      await service.findMyNotifications(
        {
          page: 1,
          limit: 20,
          sortOrder: 'desc',
          resolved: 'true',
        } as unknown as ListNotificationsQueryDto,
        'user-1',
      );

      expect(prisma.notificationRecipient.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', archivedAt: null, resolvedAt: { not: null } },
        }),
      );
    });

    it('map isRead/isResolved theo ĐÚNG recipient row của người gọi, không phải trạng thái chung', async () => {
      prisma.notificationRecipient.findMany.mockResolvedValue([
        {
          notificationId: 'notif-1',
          userId: 'user-1',
          readAt: new Date('2026-01-03'),
          resolvedAt: null,
          notification,
        },
      ]);

      const result = await service.findMyNotifications(
        {
          page: 1,
          limit: 20,
          sortOrder: 'desc',
          status: 'all',
        } as unknown as ListNotificationsQueryDto,
        'user-1',
      );

      expect(result.data[0].isRead).toBe(true);
      expect(result.data[0].isResolved).toBe(false);
    });
  });

  describe('unreadCount', () => {
    it('đếm theo category từ các NotificationRecipient chưa đọc/chưa ẩn', async () => {
      prisma.notificationRecipient.findMany.mockResolvedValue([
        { notification: { category: 'ACTION_REQUIRED' } },
        { notification: { category: 'ACTION_REQUIRED' } },
        { notification: { category: 'RESULT' } },
      ]);

      const result = await service.unreadCount('user-1');

      expect(prisma.notificationRecipient.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', readAt: null, archivedAt: null },
        select: { notification: { select: { category: true } } },
      });
      expect(result.total).toBe(3);
      expect(result.byCategory).toEqual({ ACTION_REQUIRED: 2, RESULT: 1 });
    });
  });

  describe('markRead', () => {
    it('404 khi người gọi không phải người nhận của thông báo này', async () => {
      prisma.notificationRecipient.findUnique.mockResolvedValue(null);

      await expect(service.markRead('notif-1', 'user-9')).rejects.toThrow(NotFoundException);
      expect(prisma.notificationRecipient.update).not.toHaveBeenCalled();
    });

    it('idempotent: không update lại nếu đã đọc từ trước', async () => {
      prisma.notificationRecipient.findUnique.mockResolvedValue({
        notificationId: 'notif-1',
        userId: 'user-1',
        readAt: new Date('2026-01-02'),
        resolvedAt: null,
        notification,
      });

      await service.markRead('notif-1', 'user-1');

      expect(prisma.notificationRecipient.update).not.toHaveBeenCalled();
    });

    it('đánh dấu readAt khi chưa đọc', async () => {
      prisma.notificationRecipient.findUnique.mockResolvedValue({
        notificationId: 'notif-1',
        userId: 'user-1',
        readAt: null,
        resolvedAt: null,
        notification,
      });
      prisma.notificationRecipient.update.mockResolvedValue({
        notificationId: 'notif-1',
        userId: 'user-1',
        readAt: new Date('2026-01-02'),
        resolvedAt: null,
        notification,
      });

      const result = await service.markRead('notif-1', 'user-1');

      expect(prisma.notificationRecipient.update).toHaveBeenCalledWith({
        where: { notificationId_userId: { notificationId: 'notif-1', userId: 'user-1' } },
        data: { readAt: expect.any(Date) },
        include: { notification: true },
      });
      expect(result.isRead).toBe(true);
    });
  });

  describe('markAllRead', () => {
    it('updateMany mọi dòng chưa đọc của người gọi', async () => {
      prisma.notificationRecipient.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.markAllRead('user-1');

      expect(prisma.notificationRecipient.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', readAt: null },
        data: { readAt: expect.any(Date) },
      });
      expect(result.count).toBe(3);
    });

    it('lọc thêm theo category khi được truyền', async () => {
      prisma.notificationRecipient.updateMany.mockResolvedValue({ count: 1 });

      await service.markAllRead('user-1', 'ACTION_REQUIRED');

      expect(prisma.notificationRecipient.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', readAt: null, notification: { category: 'ACTION_REQUIRED' } },
        data: { readAt: expect.any(Date) },
      });
    });
  });

  describe('archive', () => {
    it('404 khi người gọi không phải người nhận', async () => {
      prisma.notificationRecipient.findUnique.mockResolvedValue(null);

      await expect(service.archive('notif-1', 'user-9')).rejects.toThrow(NotFoundException);
      expect(prisma.notificationRecipient.update).not.toHaveBeenCalled();
    });

    it('set archivedAt cho đúng người gọi', async () => {
      prisma.notificationRecipient.findUnique.mockResolvedValue({
        notificationId: 'notif-1',
        userId: 'user-1',
        readAt: null,
        resolvedAt: null,
        notification,
      });

      await service.archive('notif-1', 'user-1');

      expect(prisma.notificationRecipient.update).toHaveBeenCalledWith({
        where: { notificationId_userId: { notificationId: 'notif-1', userId: 'user-1' } },
        data: { archivedAt: expect.any(Date) },
      });
    });
  });
});
