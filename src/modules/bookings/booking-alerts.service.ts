import { Inject, Injectable } from '@nestjs/common';
import { BookingStatus } from '../../generated/prisma/client';
import { vnDayKey } from '../../common/utils/floor-stats.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { BookingShortNotificationParams } from '../notifications/notification-types';
import { NotificationsService } from '../notifications/notifications.service';
import { bookingDue } from './booking-calc.util';
import { BOOKING_INCLUDE, BookingsService } from './bookings.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LINES = 5;
const BOOKING_ENTITY = 'BOOKING';

const ddmmyyyy = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS);
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/**
 * Phần A – Đợt 10a (YC5 5.8): cảnh báo "booking sắp đến hạn mà chưa đủ hàng" (BOOKING_SHORT). Gọi từ việc hằng ngày
 * (`DailyJobsService`, mỗi 10 phút): mở/cập nhật cho booking DRAFT/CONFIRMED có ngày hạn (lấy cont / CUT OFF) ≤ ngày mai mà còn
 * thiếu hàng; đóng khi đủ hàng / ra ngoài cửa sổ / booking đã huỷ hoặc đã xuất. Cùng kiểu `syncDeliveryAlerts`.
 */
@Injectable()
export class BookingAlertsService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly bookings: BookingsService,
    private readonly notifications: NotificationsService,
  ) {}

  async syncShortAlerts(now: Date): Promise<void> {
    const today = vnDayKey(now);
    const tomorrow = addDays(today, 1);
    // Lọc DB thô: ngày lấy cont ≤ ngày mai, hoặc CUT OFF trước 00:00 giờ VN của ngày kia (= 17:00 UTC ngày mai).
    const cutOffLimit = new Date(Date.parse(`${addDays(today, 2)}T00:00:00Z`) - 7 * 60 * 60 * 1000);
    const rows = await this.prisma.booking.findMany({
      where: {
        status: { in: [BookingStatus.DRAFT, BookingStatus.CONFIRMED] },
        OR: [
          { pickupDate: { lte: new Date(`${tomorrow}T00:00:00.000Z`) } },
          { cutOffAt: { lt: cutOffLimit } },
        ],
      },
      include: BOOKING_INCLUDE,
    });

    const dueById = new Map<string, { day: string; kind: 'lấy cont' | 'CUT OFF' }>();
    const inWindow = rows.filter((r) => {
      const due = bookingDue(r);
      if (!due || due.day > tomorrow) return false;
      dueById.set(r.id.toString(), due);
      return true;
    });
    const enriched = await this.bookings.enrichBookings(this.prisma, inWindow);

    const open = await this.prisma.notification.findMany({
      where: { type: 'BOOKING_SHORT', recipients: { some: { resolvedAt: null } } },
      select: { entityId: true, data: true },
    });
    const openData = new Map(
      open.map((n) => [
        n.entityId ?? '',
        (n.data ?? {}) as Partial<BookingShortNotificationParams>,
      ]),
    );

    const stillShort = new Set<string>();
    for (const b of enriched) {
      if (b.totals.shortQty <= 0) continue;
      const due = dueById.get(b.id)!;
      stillShort.add(b.id);
      const shortLines = b.lines
        .filter((l) => l.shortQty > 0)
        .map((l) => `${l.factoryCode} (PO ${l.orderCode}) thiếu ${l.shortQty} bộ`);
      const params: BookingShortNotificationParams = {
        bookingId: b.id,
        bookingNo: b.bookingNo,
        customerName: b.customerName,
        dueKind: due.kind,
        dueDate: ddmmyyyy(due.day),
        daysLeft: dayDiff(due.day, today),
        shortLines: b.totals.shortLines,
        shortQty: b.totals.shortQty,
        lines:
          shortLines.slice(0, MAX_LINES).join('; ') +
          (shortLines.length > MAX_LINES ? `; +${shortLines.length - MAX_LINES} dòng khác` : ''),
        warehouseCode: b.warehouseCode,
      };
      // Chỉ gửi lại khi sang ngày mới (số ngày còn lại đổi) - gộp vào thông báo đang mở sẽ đặt lại "chưa đọc" cho mọi người nhận.
      const prev = openData.get(b.id);
      if (prev && prev.daysLeft === params.daysLeft) continue;
      await this.notifications.emit('BOOKING_SHORT', {
        entityId: b.id,
        dedupeKey: `BOOKING_SHORT:${b.id}`,
        params: params as unknown as Record<string, unknown>,
      });
    }

    for (const entityId of openData.keys()) {
      if (!entityId || stillShort.has(entityId)) continue;
      await this.notifications.resolve({
        entityType: BOOKING_ENTITY,
        entityId,
        types: ['BOOKING_SHORT'],
      });
    }
  }
}
