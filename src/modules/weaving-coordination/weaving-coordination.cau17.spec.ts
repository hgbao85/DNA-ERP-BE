/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- prisma mock */
import type { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../../common/interfaces/cls-store.interface';
import { BUSINESS_ROLES } from '../../common/constants/roles.constant';
import type { PrismaServiceType } from '../../prisma/prisma.service';
import { NOTIFICATION_TYPES } from '../notifications/notification-types';
import type { NotificationsService } from '../notifications/notifications.service';
import { WeavingCoordinationService } from './weaving-coordination.service';
import { WeavingFollowUpReminderService } from './weaving-follow-up-reminder.service';

/** Đợt 2 lượt 4 (28/11/2026) - câu 17 chốt 25/11: lệnh huỷ ẩn trừ khi điểm đan còn giữ hàng; nhắc mọi Điều phối đan. */
describe('Điều phối đan - câu 17', () => {
  const prev = { dpd: process.env.DIEU_PHOI_DAN_ENABLED, env: process.env.NODE_ENV };
  afterEach(() => {
    if (prev.dpd === undefined) delete process.env.DIEU_PHOI_DAN_ENABLED;
    else process.env.DIEU_PHOI_DAN_ENABLED = prev.dpd;
    process.env.NODE_ENV = prev.env;
  });

  describe('getBoard - lệnh đã huỷ', () => {
    // Điểm đan 1: lệnh 10 (đang chạy, giữ 2), lệnh 20 (đã huỷ, giữ 3), lệnh 30 (đã huỷ, đã trả hết).
    const build = () => {
      const g = (orderId: bigint, qty: number) => ({
        weavingPointId: 1n,
        productionOrderId: orderId,
        pieceId: 5n,
        _sum: { qty },
        _max: { issuedAt: new Date('2026-11-20'), receivedAt: new Date('2026-11-21') },
      });
      const order = (id: bigint, status: string) => ({
        id,
        poNumber: `PO-${id}`,
        status,
        mfgProduct: { name: 'Ghế' },
        productionInvoiceItem: {
          lsxCode: null,
          salesOrder: null,
          productionInvoice: { code: 'PI' },
          stages: [],
        },
      });
      const prisma: any = {
        weavingIssue: { groupBy: jest.fn().mockResolvedValue([g(10n, 5), g(20n, 5), g(30n, 4)]) },
        weavingReceipt: { groupBy: jest.fn().mockResolvedValue([g(10n, 3), g(20n, 2), g(30n, 4)]) },
        weavingPoint: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 1n,
              code: 'DD1',
              fullName: 'Điểm 1',
              contactPerson: null,
              phone: null,
              isActive: true,
            },
          ]),
        },
        productionOrder: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              order(10n, 'RELEASED'),
              order(20n, 'CANCELLED'),
              order(30n, 'CANCELLED'),
            ]),
        },
        piece: { findMany: jest.fn().mockResolvedValue([{ id: 5n, code: 'MG', name: 'Mặt ghế' }]) },
        weavingFollowUp: { findMany: jest.fn().mockResolvedValue([]) },
      };
      return new WeavingCoordinationService(
        prisma as PrismaServiceType,
        {} as ClsService<AppClsStore>,
        {} as NotificationsService,
      );
    };

    it('lệnh huỷ còn giữ hàng: vẫn hiện, gắn cancelled; lệnh huỷ đã trả hết: ẩn kể cả ở tab Đã trả đủ', async () => {
      process.env.DIEU_PHOI_DAN_ENABLED = 'true';
      const s = build();
      const open = await s.getBoard({});
      expect(open.rows.map((r) => [r.productionOrderId, r.cancelled, r.held])).toEqual(
        expect.arrayContaining([
          ['10', false, 2],
          ['20', true, 3],
        ]),
      );
      expect(open.rows).toHaveLength(2);
      expect(open.tiles.piecesOut).toBe(5);
      const done = await s.getBoard({ status: 'DONE' } as any);
      expect(done.rows.map((r) => r.productionOrderId)).not.toContain('30');
    });
  });

  it('tin nhắc hẹn trả gửi mọi Điều phối đan + người ghi hẹn', () => {
    const r = NOTIFICATION_TYPES.WEAVING_PROMISE_DUE.recipients({ createdById: 'admin-1' } as any);
    expect(r).toEqual({ roles: [BUSINESS_ROLES.WEAVING_COORDINATOR], userIds: ['admin-1'] });
  });

  it('lượt nhắc nền không còn phụ thuộc FLOOR_ALERTS (tắt riêng bằng WEAVING_REMINDERS=off)', () => {
    jest.useFakeTimers();
    const prevFa = process.env.FLOOR_ALERTS;
    const prevWr = process.env.WEAVING_REMINDERS;
    try {
      process.env.NODE_ENV = 'development';
      process.env.FLOOR_ALERTS = 'off';
      delete process.env.WEAVING_REMINDERS;
      const svc = new WeavingFollowUpReminderService(
        {} as PrismaServiceType,
        {} as NotificationsService,
      );
      svc.onModuleInit();
      expect((svc as any).interval).not.toBeNull();
      svc.onModuleDestroy();
      process.env.WEAVING_REMINDERS = 'off';
      const off = new WeavingFollowUpReminderService(
        {} as PrismaServiceType,
        {} as NotificationsService,
      );
      off.onModuleInit();
      expect((off as any).interval).toBeNull();
    } finally {
      jest.useRealTimers();
      if (prevFa === undefined) delete process.env.FLOOR_ALERTS;
      else process.env.FLOOR_ALERTS = prevFa;
      if (prevWr === undefined) delete process.env.WEAVING_REMINDERS;
      else process.env.WEAVING_REMINDERS = prevWr;
    }
  });
});
