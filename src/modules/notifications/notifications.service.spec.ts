// jest's `expect.objectContaining` is typed `any`, which trips no-unsafe-assignment on
// every `toHaveBeenCalledWith(expect.objectContaining({...}))` below - standard jest usage.
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { NotFoundException } from '@nestjs/common';
import { NotificationAudience } from '../../generated/prisma/client';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: {
    notification: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
    };
    notificationRead: { upsert: jest.Mock };
  };

  const baseUser: AuthenticatedUser = {
    id: 'user-1',
    username: 'kho01',
    email: 'kho01@demo.com',
    roles: [],
    permissions: [],
    mfgRole: null,
    warehouseScope: null,
  };

  const notification = {
    id: 'notif-1',
    title: 'Đơn hàng mới',
    message: 'PO-1 vừa được tạo',
    audience: NotificationAudience.ALL,
    createdBy: 'user-boss',
    createdAt: new Date('2026-01-01'),
    reads: [],
  };

  beforeEach(() => {
    prisma = {
      notification: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
      },
      notificationRead: { upsert: jest.fn() },
    };

    service = new NotificationsService(prisma as unknown as PrismaServiceType);
  });

  describe('create', () => {
    it('stamps createdBy and reports isRead=false for a brand-new notification', async () => {
      prisma.notification.create.mockResolvedValue(notification);

      const result = await service.create(
        { title: 'Đơn hàng mới', message: 'PO-1 vừa được tạo', audience: NotificationAudience.ALL },
        'user-boss',
      );

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ createdBy: 'user-boss' }) }),
      );
      expect(result.isRead).toBe(false);
    });
  });

  describe('findAllForUser - audience filter', () => {
    beforeEach(() => {
      prisma.notification.findMany.mockResolvedValue([]);
      prisma.notification.count.mockResolvedValue(0);
    });

    it('always includes ALL, even for a role with no dedicated audience', async () => {
      await service.findAllForUser({ page: 1, limit: 20 } as any, {
        ...baseUser,
        roles: ['KCS_STAFF'],
      });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { audience: { in: [NotificationAudience.ALL] } } }),
      );
    });

    it('adds BOSS, WAREHOUSE_STAFF and PRODUCTION_MANAGER together when the user holds all three roles', async () => {
      await service.findAllForUser({ page: 1, limit: 20 } as any, {
        ...baseUser,
        roles: ['BOSS', 'WAREHOUSE_STAFF', 'PRODUCTION_MANAGER'],
      });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            audience: {
              in: [
                NotificationAudience.ALL,
                NotificationAudience.BOSS,
                NotificationAudience.WAREHOUSE_STAFF,
                NotificationAudience.PRODUCTION_MANAGER,
              ],
            },
          },
        }),
      );
    });

    it('scopes the read flag to the requesting user only', async () => {
      await service.findAllForUser({ page: 1, limit: 20 } as any, baseUser);

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ include: { reads: { where: { userId: 'user-1' } } } }),
      );
    });
  });

  describe('markRead', () => {
    it('throws 404 and never upserts when the notification does not exist', async () => {
      prisma.notification.findUnique.mockResolvedValue(null);

      await expect(service.markRead('missing', baseUser)).rejects.toThrow(NotFoundException);
      expect(prisma.notificationRead.upsert).not.toHaveBeenCalled();
    });

    it('is idempotent: repeat calls upsert on the same composite key with an empty update', async () => {
      prisma.notification.findUnique.mockResolvedValue(notification);
      prisma.notificationRead.upsert.mockResolvedValue({
        notificationId: 'notif-1',
        userId: 'user-1',
        readAt: new Date('2026-01-02'),
      });

      await service.markRead('notif-1', baseUser);

      expect(prisma.notificationRead.upsert).toHaveBeenCalledWith({
        where: { notificationId_userId: { notificationId: 'notif-1', userId: 'user-1' } },
        update: {},
        create: { notificationId: 'notif-1', userId: 'user-1' },
      });
    });

    it('throws 404 and never upserts when the notification is outside the caller audience', async () => {
      prisma.notification.findUnique.mockResolvedValue({
        ...notification,
        audience: NotificationAudience.BOSS,
      });

      await expect(
        service.markRead('notif-1', { ...baseUser, roles: ['KCS_STAFF'] }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.notificationRead.upsert).not.toHaveBeenCalled();
    });

    it('allows marking read when the caller role matches the notification audience', async () => {
      prisma.notification.findUnique.mockResolvedValue({
        ...notification,
        audience: NotificationAudience.BOSS,
      });
      prisma.notificationRead.upsert.mockResolvedValue({
        notificationId: 'notif-1',
        userId: 'user-1',
        readAt: new Date('2026-01-02'),
      });

      await service.markRead('notif-1', { ...baseUser, roles: ['BOSS'] });

      expect(prisma.notificationRead.upsert).toHaveBeenCalled();
    });
  });
});
