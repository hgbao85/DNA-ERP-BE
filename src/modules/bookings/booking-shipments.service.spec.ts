import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { BookingStatus } from '../../generated/prisma/client';
import { BookingShipmentsService } from './booking-shipments.service';

jest.mock('../../common/utils/advisory-lock.util', () => ({
  lockBusinessKey: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../common/utils/audit-event.util', () => ({
  auditEvent: jest.fn().mockResolvedValue(undefined),
}));

describe('BookingShipmentsService - kho thành phẩm xuất hàng theo booking (Đợt 10b)', () => {
  const line = (id: bigint, qty: number, shippedQty = 0, soi = 500n, pii = 900n) => ({
    id,
    qty,
    shippedQty,
    salesOrderItemId: soi,
    productionInvoiceItemId: pii,
    productionInvoiceItem: { mfgProduct: { factoryCode: `SKU-${id}` } },
  });
  const booking = (over: Record<string, unknown> = {}) => ({
    id: 1n,
    bookingNo: 'BK-1',
    status: BookingStatus.CONFIRMED,
    warehouseCode: 'thanh-pham',
    createdById: 'sales-1',
    customer: { name: 'MEIYING' },
    lines: [line(11n, 100), line(12n, 50, 0, 501n, 901n)],
    ...over,
  });

  let prisma: {
    booking: { findUnique: jest.Mock; update: jest.Mock };
    bookingLine: { update: jest.Mock };
    salesOrderItem: { findMany: jest.Mock };
    packagingRecord: { groupBy: jest.Mock };
    reservedSlipCode: { updateMany: jest.Mock };
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let bookings: { findAll: jest.Mock; findOne: jest.Mock };
  let notifications: { emit: jest.Mock; resolve: jest.Mock };
  let realtime: { publishEntityChanged: jest.Mock };
  let service: BookingShipmentsService;

  beforeEach(() => {
    prisma = {
      booking: {
        findUnique: jest.fn(({ where }: { where: { id?: bigint; shipKey?: string } }) =>
          Promise.resolve(where.shipKey ? null : booking()),
        ),
        update: jest.fn(),
      },
      bookingLine: { update: jest.fn() },
      salesOrderItem: { findMany: jest.fn().mockResolvedValue([{ salesOrderId: 70n }]) },
      packagingRecord: {
        groupBy: jest.fn().mockResolvedValue([
          { productionInvoiceItemId: 900n, _sum: { boxesPacked: 120 } },
          { productionInvoiceItemId: 901n, _sum: { boxesPacked: 30 } },
        ]),
      },
      reservedSlipCode: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $queryRaw: jest.fn().mockResolvedValue([
        { id: 500n, totalQty: 200, shippedQty: 0 },
        { id: 501n, totalQty: 50, shippedQty: 0 },
      ]),
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));
    bookings = {
      findAll: jest.fn().mockResolvedValue([
        { id: '1', warehouseCode: 'thanh-pham' },
        { id: '2', warehouseCode: 'thanh-pham-2' },
      ]),
      findOne: jest.fn().mockResolvedValue({ id: '1', status: BookingStatus.SHIPPED }),
    };
    notifications = { emit: jest.fn(), resolve: jest.fn() };
    realtime = { publishEntityChanged: jest.fn() };
    service = new BookingShipmentsService(
      prisma as never,
      bookings as never,
      notifications as never,
      realtime as never,
      { get: jest.fn() } as never,
    );
  });

  const dto = (lines: { lineId: string; qty: number }[]) => ({
    slipCode: 'XK-261109-001',
    signedSlipUrls: ['https://x/phieu.jpg'],
    lines,
  });

  it('thủ kho chỉ thấy booking đã xác nhận của kho mình; tổng kho thấy hết', async () => {
    expect(await service.listToShip('thanh-pham')).toEqual([
      { id: '1', warehouseCode: 'thanh-pham' },
    ]);
    expect(await service.listToShip(null)).toHaveLength(2);
    expect(bookings.findAll).toHaveBeenCalledWith({ status: BookingStatus.CONFIRMED });
  });

  it('xác nhận xuất: cộng đã xuất dòng booking + dòng đơn, dùng số phiếu XK, booking SHIPPED, báo Sales + đóng việc chờ kho', async () => {
    await service.ship(
      '1',
      dto([
        { lineId: '11', qty: 100 },
        { lineId: '12', qty: 30 },
      ]),
      'kho-tp',
      'thanh-pham',
      'k1',
    );

    expect(prisma.bookingLine.update).toHaveBeenCalledWith({
      where: { id: 11n },
      data: { shippedQty: { increment: 100 } },
    });
    expect(prisma.bookingLine.update).toHaveBeenCalledWith({
      where: { id: 12n },
      data: { shippedQty: { increment: 30 } },
    });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    const [slipArg] = prisma.reservedSlipCode.updateMany.mock.calls[0] as [
      { where: Record<string, unknown>; data: { usedAt: unknown } },
    ];
    expect(slipArg.where).toEqual({ code: 'XK-261109-001', kind: 'XK', usedAt: null });
    expect(slipArg.data.usedAt).toBeInstanceOf(Date);
    const [upd] = prisma.booking.update.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(upd.data).toMatchObject({
      status: BookingStatus.SHIPPED,
      shippedById: 'kho-tp',
      shipSlipCode: 'XK-261109-001',
      shipSlipUrls: ['https://x/phieu.jpg'],
      shipKey: 'k1',
    });
    expect(notifications.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'BOOKING', entityId: '1' }),
    );
    const [type, opts] = notifications.emit.mock.calls[0] as [
      string,
      { params: Record<string, unknown> },
    ];
    expect(type).toBe('BOOKING_SHIPPED');
    expect(opts.params).toMatchObject({ shippedQty: 130, bookedQty: 150, createdById: 'sales-1' });
    expect(realtime.publishEntityChanged).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'SALES_ORDER', entityId: '70' }),
    );
  });

  it('bấm lại cùng Idempotency-Key -> trả booking đã xuất, không ghi lần 2', async () => {
    prisma.booking.findUnique.mockImplementation(({ where }: { where: { shipKey?: string } }) =>
      Promise.resolve(where.shipKey ? { id: 1n } : booking()),
    );
    await service.ship('1', dto([{ lineId: '11', qty: 10 }]), 'kho-tp', 'thanh-pham', 'k1');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(bookings.findOne).toHaveBeenCalledWith('1');
  });

  it('thủ kho kho khác -> 403; booking chưa xác nhận / đã xuất -> 409', async () => {
    await expect(
      service.ship('1', dto([{ lineId: '11', qty: 10 }]), 'u', 'thanh-pham-2', 'k1'),
    ).rejects.toThrow(ForbiddenException);
    prisma.booking.findUnique.mockImplementation(({ where }: { where: { shipKey?: string } }) =>
      Promise.resolve(where.shipKey ? null : booking({ status: BookingStatus.DRAFT })),
    );
    await expect(
      service.ship('1', dto([{ lineId: '11', qty: 10 }]), 'u', null, 'k2'),
    ).rejects.toThrow(ConflictException);
    prisma.booking.findUnique.mockImplementation(({ where }: { where: { shipKey?: string } }) =>
      Promise.resolve(where.shipKey ? null : booking({ status: BookingStatus.SHIPPED })),
    );
    await expect(
      service.ship('1', dto([{ lineId: '11', qty: 10 }]), 'u', null, 'k3'),
    ).rejects.toThrow(ConflictException);
    expect(prisma.bookingLine.update).not.toHaveBeenCalled();
  });

  it('không xuất vượt số còn của booking, không vượt hàng đã đóng gói chưa xuất', async () => {
    await expect(
      service.ship('1', dto([{ lineId: '12', qty: 51 }]), 'u', null, 'k1'),
    ).rejects.toThrow(BadRequestException);
    // dòng 12: đóng gói 30 bộ, chưa xuất -> xuất 40 bị chặn
    await expect(
      service.ship('1', dto([{ lineId: '12', qty: 40 }]), 'u', null, 'k2'),
    ).rejects.toThrow(/chỉ còn 30 bộ đã đóng gói/);
    expect(prisma.bookingLine.update).not.toHaveBeenCalled();
  });

  it('thiếu ảnh phiếu / số phiếu không hợp lệ / không nhập số nào -> chặn', async () => {
    await expect(
      service.ship(
        '1',
        { ...dto([{ lineId: '11', qty: 1 }]), signedSlipUrls: [' '] },
        'u',
        null,
        'k1',
      ),
    ).rejects.toThrow(/ảnh phiếu/);
    prisma.reservedSlipCode.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.ship('1', dto([{ lineId: '11', qty: 1 }]), 'u', null, 'k2'),
    ).rejects.toThrow(/Số phiếu/);
    await expect(
      service.ship('1', dto([{ lineId: '11', qty: 0 }]), 'u', null, 'k3'),
    ).rejects.toThrow(/ít nhất 1 dòng/);
  });
});
