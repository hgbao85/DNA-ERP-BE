/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- mock dạng jest.fn */
import { BookingResponseDto, BookingTotalsDto } from './dto/booking-response.dto';
import { BookingAlertsService } from './booking-alerts.service';

describe('BookingAlertsService (Phần A – Đợt 10a)', () => {
  // 10:00 ngày 03/11/2026 giờ VN
  const NOW = new Date('2026-11-03T03:00:00.000Z');

  const row = (id: bigint, o: Record<string, unknown> = {}) => ({
    id,
    status: 'CONFIRMED',
    pickupDate: new Date('2026-11-04'),
    cutOffAt: null,
    lines: [],
    ...o,
  });
  const enriched = (id: string, shortQty: number, o: Record<string, unknown> = {}) =>
    new BookingResponseDto({
      id,
      bookingNo: `BK${id}`,
      customerName: 'ACME',
      warehouseCode: 'thanh-pham',
      totals: new BookingTotalsDto({ shortQty, shortLines: shortQty > 0 ? 2 : 0 }),
      lines: [
        { factoryCode: 'A', orderCode: 'PO-1', shortQty } as never,
        { factoryCode: 'B', orderCode: 'PO-2', shortQty: 0 } as never,
        { factoryCode: 'C', orderCode: 'PO-3', shortQty } as never,
      ],
      ...o,
    });

  let prisma: { booking: { findMany: jest.Mock }; notification: { findMany: jest.Mock } };
  let bookings: { enrichBookings: jest.Mock };
  let notifications: { emit: jest.Mock; resolve: jest.Mock };
  let service: BookingAlertsService;

  beforeEach(() => {
    prisma = {
      booking: { findMany: jest.fn().mockResolvedValue([]) },
      notification: { findMany: jest.fn().mockResolvedValue([]) },
    };
    bookings = { enrichBookings: jest.fn().mockResolvedValue([]) };
    notifications = {
      emit: jest.fn().mockResolvedValue(undefined),
      resolve: jest.fn().mockResolvedValue(undefined),
    };
    service = new BookingAlertsService(prisma as never, bookings as never, notifications as never);
  });

  it('hạn ngày mai + còn thiếu -> báo BOOKING_SHORT với tham số đúng', async () => {
    prisma.booking.findMany.mockResolvedValue([row(1n)]);
    bookings.enrichBookings.mockResolvedValue([enriched('1', 12)]);

    await service.syncShortAlerts(NOW);

    expect(notifications.emit).toHaveBeenCalledWith('BOOKING_SHORT', {
      entityId: '1',
      dedupeKey: 'BOOKING_SHORT:1',
      params: {
        bookingId: '1',
        bookingNo: 'BK1',
        customerName: 'ACME',
        dueKind: 'lấy cont',
        dueDate: '04/11/2026',
        daysLeft: 1,
        shortLines: 2,
        shortQty: 12,
        lines: 'A (PO PO-1) thiếu 12 bộ; C (PO PO-3) thiếu 12 bộ',
        warehouseCode: 'thanh-pham',
      },
    });
    expect(prisma.booking.findMany.mock.calls[0][0].where.status).toEqual({
      in: ['DRAFT', 'CONFIRMED'],
    });
  });

  it('CUT OFF sớm hơn ngày lấy cont -> dueKind CUT OFF', async () => {
    // 2026-11-02T17:30Z = 03/11 00:30 giờ VN
    prisma.booking.findMany.mockResolvedValue([
      row(1n, {
        pickupDate: new Date('2026-11-05'),
        cutOffAt: new Date('2026-11-02T17:30:00.000Z'),
      }),
    ]);
    bookings.enrichBookings.mockResolvedValue([enriched('1', 3)]);
    await service.syncShortAlerts(NOW);
    const params = notifications.emit.mock.calls[0][1].params;
    expect(params).toMatchObject({ dueKind: 'CUT OFF', dueDate: '03/11/2026', daysLeft: 0 });
  });

  it('đã trễ (daysLeft âm) vẫn báo', async () => {
    prisma.booking.findMany.mockResolvedValue([row(1n, { pickupDate: new Date('2026-11-01') })]);
    bookings.enrichBookings.mockResolvedValue([enriched('1', 5)]);
    await service.syncShortAlerts(NOW);
    expect(notifications.emit.mock.calls[0][1].params.daysLeft).toBe(-2);
  });

  it('ngày hạn còn xa hơn ngày mai -> bỏ qua (lọc thô DB lọt vào cũng bị loại)', async () => {
    prisma.booking.findMany.mockResolvedValue([row(1n, { pickupDate: new Date('2026-11-10') })]);
    await service.syncShortAlerts(NOW);
    expect(bookings.enrichBookings).toHaveBeenCalledWith(prisma, []);
    expect(notifications.emit).not.toHaveBeenCalled();
  });

  it('đủ hàng -> không báo, đóng thông báo đang mở', async () => {
    prisma.booking.findMany.mockResolvedValue([row(1n)]);
    bookings.enrichBookings.mockResolvedValue([enriched('1', 0)]);
    prisma.notification.findMany.mockResolvedValue([{ entityId: '1', data: { daysLeft: 1 } }]);

    await service.syncShortAlerts(NOW);

    expect(notifications.emit).not.toHaveBeenCalled();
    expect(notifications.resolve).toHaveBeenCalledWith({
      entityType: 'BOOKING',
      entityId: '1',
      types: ['BOOKING_SHORT'],
    });
  });

  it('booking đã huỷ / đã xuất / ra ngoài cửa sổ (không còn trong danh sách) -> đóng thông báo cũ', async () => {
    prisma.notification.findMany.mockResolvedValue([{ entityId: '7', data: { daysLeft: 0 } }]);
    await service.syncShortAlerts(NOW);
    expect(notifications.resolve).toHaveBeenCalledWith({
      entityType: 'BOOKING',
      entityId: '7',
      types: ['BOOKING_SHORT'],
    });
  });

  it('đã mở cùng daysLeft -> không gửi lại và không đóng; sang ngày mới (daysLeft đổi) -> gửi lại', async () => {
    prisma.booking.findMany.mockResolvedValue([row(1n)]);
    bookings.enrichBookings.mockResolvedValue([enriched('1', 4)]);
    prisma.notification.findMany.mockResolvedValue([{ entityId: '1', data: { daysLeft: 1 } }]);

    await service.syncShortAlerts(NOW);
    expect(notifications.emit).not.toHaveBeenCalled();
    expect(notifications.resolve).not.toHaveBeenCalled();

    prisma.notification.findMany.mockResolvedValue([{ entityId: '1', data: { daysLeft: 2 } }]);
    await service.syncShortAlerts(NOW);
    expect(notifications.emit).toHaveBeenCalledTimes(1);
  });

  it('tối đa 5 dòng trong tin, phần còn lại ghi "+k dòng khác"', async () => {
    prisma.booking.findMany.mockResolvedValue([row(1n)]);
    const many = Array.from({ length: 7 }, (_, i) => ({
      factoryCode: `S${i}`,
      orderCode: 'PO',
      shortQty: 1,
    }));
    bookings.enrichBookings.mockResolvedValue([
      enriched('1', 7, {
        lines: many,
        totals: new BookingTotalsDto({ shortQty: 7, shortLines: 7 }),
      }),
    ]);
    await service.syncShortAlerts(NOW);
    const text: string = notifications.emit.mock.calls[0][1].params.lines;
    expect(text.split('; ')).toHaveLength(6);
    expect(text.endsWith('; +2 dòng khác')).toBe(true);
  });
});
