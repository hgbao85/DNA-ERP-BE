/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any -- mock prisma dạng jest.fn */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { instanceToPlain } from 'class-transformer';
import { BookingsService } from './bookings.service';

/** Phần A – Đợt 10a: kiểm nghiệp vụ booking (xếp hàng có khoá dòng đơn, trùng số, trạng thái, response). */
describe('BookingsService (Phần A – Đợt 10a)', () => {
  const pii = (o: Record<string, unknown> = {}) => ({
    id: 11n,
    lsxCode: 'MY-313',
    warehouseCode: null,
    warehouseName: null,
    salesOrderId: 5n,
    salesOrderItemId: 7n,
    mfgProduct: {
      id: 2n,
      factoryCode: 'SKU-A',
      name: 'Ghế A',
      boxVolumeM3: 0.5,
      boxesPerSet: 1,
      loadCont: 100,
    },
    productionInvoice: { id: 3n, code: 'PI-1', status: 'PLANNING' },
    salesOrder: { id: 5n, orderCode: 'PO-1', customerId: 1n, isActive: true, deletedAt: null },
    salesOrderItem: { id: 7n, totalQty: 100, shippedQty: 0, skuName: null, deliveryDate: null },
    ...o,
  });

  const bookingRow = (o: Record<string, unknown> = {}) => ({
    id: 100n,
    bookingNo: 'BK0000123',
    customerId: 1n,
    containerType: '40HC',
    containerQty: 1,
    pod: 'LA',
    cutSiAt: null,
    pickupDate: null,
    cutOffAt: null,
    etd: null,
    pickupPlace: null,
    vesselVoyage: null,
    warehouseCode: 'thanh-pham',
    note: null,
    attachments: [
      { name: 'bk.pdf', url: 'https://x/bk.pdf', uploadedAt: '2026-11-01T00:00:00.000Z' },
    ],
    status: 'DRAFT',
    createdById: 'u1',
    confirmedAt: null,
    confirmedById: null,
    cancelledAt: null,
    cancelledById: null,
    cancelReason: null,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    customer: { name: 'ACME' },
    createdBy: { firstName: 'An', lastName: 'Nguyễn' },
    lines: [
      {
        id: 1n,
        bookingId: 100n,
        productionInvoiceItemId: 11n,
        salesOrderItemId: 7n,
        qty: 40,
        shippedQty: 0,
      },
    ],
    ...o,
  });

  let state: { existing: any[]; others: any[]; active: any[] };
  let prisma: ReturnType<typeof makePrisma>;
  /** Đích của $transaction (= prisma) - biến riêng để kiểu của makePrisma không tự tham chiếu. */
  let txTarget: unknown;
  let notifications: { resolve: jest.Mock; emit: jest.Mock };
  let service: BookingsService;

  /** Mock prisma có kiểu (mỗi hàm là jest.Mock) - khỏi `any` làm hỏng luật no-unsafe-call. */
  const makePrisma = () => ({
    customer: { findUnique: jest.fn().mockResolvedValue({ id: 1n }) },
    warehouse: {
      findFirst: jest.fn().mockResolvedValue({ id: 1n }),
      findMany: jest.fn().mockResolvedValue([{ code: 'thanh-pham', name: 'Kho thành phẩm' }]),
    },
    systemConfig: { findUnique: jest.fn().mockResolvedValue({ containerVolumeM3: 68 }) },
    booking: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(bookingRow()),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue(bookingRow({ lines: [] })),
      update: jest.fn().mockImplementation(({ data }: any) => bookingRow(data)),
    },
    bookingLine: {
      findMany: jest.fn().mockImplementation((args: any) => {
        const b = args.where?.bookingId;
        if (typeof b === 'bigint') return Promise.resolve(state.existing);
        if (b && b.not !== undefined) return Promise.resolve(state.others);
        return Promise.resolve(state.active);
      }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    productionInvoiceItem: { findMany: jest.fn().mockResolvedValue([pii()]) },
    salesOrderItem: {
      findMany: jest.fn().mockResolvedValue([{ id: 7n, totalQty: 100, shippedQty: 0 }]),
    },
    packagingRecord: { groupBy: jest.fn().mockResolvedValue([]) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(0),
    $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(txTarget)),
  });

  beforeEach(() => {
    state = { existing: [], others: [], active: [] };
    prisma = makePrisma();
    txTarget = prisma;
    notifications = {
      resolve: jest.fn().mockResolvedValue(undefined),
      emit: jest.fn().mockResolvedValue(undefined),
    };
    service = new BookingsService(
      prisma as never,
      notifications as never,
      {
        get: jest.fn().mockReturnValue('u1'),
      } as never,
    );
  });

  const baseDto = {
    bookingNo: '  BK0000123 ',
    customerId: '1',
    pod: ' LA ',
    warehouseCode: 'thanh-pham',
  };

  describe('create', () => {
    it('tạo OK: trim số booking/POD, khoá dòng đơn TRƯỚC khi đọc booking_lines khác, ghi dòng hàng', async () => {
      const res = await service.create({
        ...baseDto,
        lines: [{ productionInvoiceItemId: '11', qty: 40 }],
      });

      expect(prisma.booking.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          bookingNo: 'BK0000123',
          pod: 'LA',
          customerId: 1n,
          containerType: '40HC',
          containerQty: 1,
          createdById: 'u1',
        }),
      });
      expect(prisma.bookingLine.createMany).toHaveBeenCalledWith({
        data: [{ bookingId: 100n, productionInvoiceItemId: 11n, salesOrderItemId: 7n, qty: 40 }],
      });
      // $queryRaw (FOR UPDATE) chạy trước lần đọc các booking_lines của booking khác.
      const lockOrder = prisma.$queryRaw.mock.invocationCallOrder[0];
      const othersCall = prisma.bookingLine.findMany.mock.calls.findIndex(
        (c: any[]) => c[0].where.bookingId?.not !== undefined,
      );
      expect(othersCall).toBeGreaterThanOrEqual(0);
      expect(lockOrder).toBeLessThan(
        prisma.bookingLine.findMany.mock.invocationCallOrder[othersCall],
      );
      expect(res.bookingNo).toBe('BK0000123');
      expect(res.warehouseName).toBe('Kho thành phẩm');
    });

    it('khách của dòng hàng không khớp khách booking -> 400', async () => {
      prisma.productionInvoiceItem.findMany.mockResolvedValue([
        pii({
          salesOrder: {
            id: 5n,
            orderCode: 'PO-1',
            customerId: 2n,
            isActive: true,
            deletedAt: null,
          },
        }),
      ]);
      await expect(
        service.create({ ...baseDto, lines: [{ productionInvoiceItemId: '11', qty: 1 }] }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.bookingLine.createMany).not.toHaveBeenCalled();
    });

    it('dòng lệnh không gắn dòng đơn -> 400', async () => {
      prisma.productionInvoiceItem.findMany.mockResolvedValue([pii({ salesOrderItemId: null })]);
      await expect(
        service.create({ ...baseDto, lines: [{ productionInvoiceItemId: '11', qty: 1 }] }),
      ).rejects.toThrow(/không gắn với đơn hàng/);
    });

    it('chọn trùng 1 dòng lệnh 2 lần -> 400', async () => {
      await expect(
        service.create({
          ...baseDto,
          lines: [
            { productionInvoiceItemId: '11', qty: 1 },
            { productionInvoiceItemId: '11', qty: 2 },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('vượt số còn được xếp (đã xếp ở booking khác chưa huỷ) -> 400 nêu từng dòng', async () => {
      state.others = [{ salesOrderItemId: 7n, qty: 60, shippedQty: 0 }];
      await expect(
        service.create({
          ...baseDto,
          lines: [{ productionInvoiceItemId: '11', qty: 50 }],
        }),
      ).rejects.toThrow('SKU SKU-A (PO PO-1, lệnh MY-313) chỉ còn 40 bộ được xếp - đang nhập 50');
      // Chỉ tính booking DRAFT/CONFIRMED: SHIPPED/CANCELLED không bị đọc vào "đã xếp ở booking khác".
      const call = prisma.bookingLine.findMany.mock.calls.find(
        (c: any[]) => c[0].where.bookingId?.not !== undefined,
      );
      expect(call[0].where.booking).toEqual({ status: { in: ['DRAFT', 'CONFIRMED'] } });
    });

    it('trừ cả phần đã xuất của dòng đơn; booking khác đã xuất 1 phần chỉ tính phần chưa xuất', async () => {
      prisma.salesOrderItem.findMany.mockResolvedValue([{ id: 7n, totalQty: 100, shippedQty: 30 }]);
      state.others = [{ salesOrderItemId: 7n, qty: 20, shippedQty: 20 }]; // chưa xuất = 0
      await expect(
        service.create({
          ...baseDto,
          lines: [{ productionInvoiceItemId: '11', qty: 71 }],
        }),
      ).rejects.toThrow(/chỉ còn 70 bộ/);
      await expect(
        service.create({
          ...baseDto,
          lines: [{ productionInvoiceItemId: '11', qty: 70 }],
        }),
      ).resolves.toBeDefined();
    });

    it('lệnh chưa lên PI/LSX ghi "chưa lên lệnh"', async () => {
      prisma.productionInvoiceItem.findMany.mockResolvedValue([
        pii({ lsxCode: null, productionInvoice: null }),
      ]);
      state.others = [{ salesOrderItemId: 7n, qty: 100, shippedQty: 0 }];
      await expect(
        service.create({ ...baseDto, lines: [{ productionInvoiceItemId: '11', qty: 1 }] }),
      ).rejects.toThrow(/lệnh chưa lên lệnh/);
    });

    it('số booking trùng booking chưa huỷ -> 409; so khớp không phân biệt hoa thường, bỏ qua booking đã huỷ', async () => {
      prisma.booking.findFirst.mockResolvedValue({ id: 9n, customer: { name: 'BETA' } });
      await expect(service.create(baseDto as never)).rejects.toThrow(
        'Số booking BK0000123 đã có ở booking khác (khách BETA)',
      );
      expect(prisma.booking.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            bookingNo: { equals: 'BK0000123', mode: 'insensitive' },
            status: { not: 'CANCELLED' },
          },
        }),
      );
      expect(prisma.booking.create).not.toHaveBeenCalled();
    });

    it('số trùng với booking đã huỷ (findFirst không thấy) -> tạo được', async () => {
      prisma.booking.findFirst.mockResolvedValue(null);
      await expect(service.create(baseDto as never)).resolves.toBeDefined();
      expect(prisma.booking.create).toHaveBeenCalled();
    });

    it('kho không phải kho thành phẩm -> 400', async () => {
      await expect(service.create({ ...baseDto, warehouseCode: 'vat-tu-tp' })).rejects.toThrow(
        'Kho vat-tu-tp không phải kho thành phẩm đang dùng',
      );
      prisma.warehouse.findFirst.mockResolvedValue(null);
      await expect(service.create(baseDto as never)).rejects.toThrow(/không phải kho thành phẩm/);
    });

    it('khách không tồn tại -> 400', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);
      await expect(service.create(baseDto as never)).rejects.toThrow(BadRequestException);
    });

    it('file đính kèm mới có uploadedAt = lúc lưu', async () => {
      await service.create({
        ...baseDto,
        attachments: [{ name: 'a.pdf', url: 'https://x/a.pdf' }],
      });
      const data = prisma.booking.create.mock.calls[0][0].data;
      expect(data.attachments).toHaveLength(1);
      expect(typeof data.attachments[0].uploadedAt).toBe('string');
    });
  });

  describe('update', () => {
    it.each(['SHIPPED', 'CANCELLED'])('booking %s -> 409 không sửa được', async (status) => {
      prisma.booking.findUnique.mockResolvedValue(bookingRow({ status }));
      await expect(service.update('100', { pod: 'NY' })).rejects.toThrow(ConflictException);
      expect(prisma.booking.update).not.toHaveBeenCalled();
    });

    it('đổi khách khi đang có hàng mà không gửi lines -> 400', async () => {
      await expect(service.update('100', { customerId: '2' })).rejects.toThrow(
        'Đổi khách hàng thì phải chọn lại hàng',
      );
    });

    it('đổi khách kèm lines mới -> OK', async () => {
      prisma.productionInvoiceItem.findMany.mockResolvedValue([
        pii({
          salesOrder: {
            id: 5n,
            orderCode: 'PO-1',
            customerId: 2n,
            isActive: true,
            deletedAt: null,
          },
        }),
      ]);
      state.existing = [
        {
          id: 1n,
          productionInvoiceItemId: 11n,
          qty: 40,
          shippedQty: 0,
          productionInvoiceItem: { mfgProduct: { factoryCode: 'SKU-A' } },
        },
      ];
      await expect(
        service.update('100', {
          customerId: '2',
          lines: [{ productionInvoiceItemId: '11', qty: 10 }],
        }),
      ).resolves.toBeDefined();
      expect(prisma.bookingLine.update).toHaveBeenCalledWith({
        where: { id: 1n },
        data: { qty: 10 },
      });
    });

    it('thay hàng: gỡ dòng không còn trong danh sách, thêm dòng mới', async () => {
      state.existing = [
        {
          id: 1n,
          productionInvoiceItemId: 11n,
          qty: 40,
          shippedQty: 0,
          productionInvoiceItem: { mfgProduct: { factoryCode: 'SKU-A' } },
        },
      ];
      prisma.productionInvoiceItem.findMany.mockResolvedValue([
        pii({ id: 12n, salesOrderItemId: 8n }),
      ]);
      prisma.salesOrderItem.findMany.mockResolvedValue([{ id: 8n, totalQty: 10, shippedQty: 0 }]);
      await service.update('100', { lines: [{ productionInvoiceItemId: '12', qty: 5 }] });
      expect(prisma.bookingLine.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [1n] } } });
      expect(prisma.bookingLine.createMany).toHaveBeenCalledWith({
        data: [{ bookingId: 100n, productionInvoiceItemId: 12n, salesOrderItemId: 8n, qty: 5 }],
      });
    });

    it('dòng đã có hàng xuất thực tế không được gỡ -> 409', async () => {
      state.existing = [
        {
          id: 1n,
          productionInvoiceItemId: 11n,
          qty: 40,
          shippedQty: 10,
          productionInvoiceItem: { mfgProduct: { factoryCode: 'SKU-A' } },
        },
      ];
      await expect(service.update('100', { lines: [] })).rejects.toThrow(ConflictException);
      await expect(
        service.update('100', { lines: [{ productionInvoiceItemId: '11', qty: 5 }] }),
      ).rejects.toThrow(ConflictException);
    });

    it('PATCH giữ uploadedAt của file cũ trùng url', async () => {
      await service.update('100', {
        attachments: [{ name: 'bk.pdf', url: 'https://x/bk.pdf' }],
      });
      const data = prisma.booking.update.mock.calls[0][0].data;
      expect(data.attachments[0].uploadedAt).toBe('2026-11-01T00:00:00.000Z');
    });

    it('booking không tồn tại -> 404', async () => {
      prisma.booking.findUnique.mockResolvedValue(null);
      await expect(service.update('100', { pod: 'NY' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('confirm', () => {
    it('thiếu hàng -> 400', async () => {
      prisma.booking.findUnique.mockResolvedValue(bookingRow({ lines: [] }));
      await expect(service.confirm('100')).rejects.toThrow(/Chưa có hàng|chưa có hàng/);
    });

    it('thiếu kho thành phẩm gom hàng -> 400', async () => {
      prisma.booking.findUnique.mockResolvedValue(bookingRow({ warehouseCode: null }));
      await expect(service.confirm('100')).rejects.toThrow(
        'Chọn kho thành phẩm gom hàng trước khi xác nhận (5.6)',
      );
    });

    it('đã xác nhận -> 409', async () => {
      prisma.booking.findUnique.mockResolvedValue(bookingRow({ status: 'CONFIRMED' }));
      await expect(service.confirm('100')).rejects.toThrow(/đã xác nhận/);
    });

    it('DRAFT đủ hàng + kho -> CONFIRMED, ghi người/giờ xác nhận', async () => {
      await service.confirm('100');
      expect(prisma.booking.update).toHaveBeenCalledWith({
        where: { id: 100n },
        data: { status: 'CONFIRMED', confirmedAt: expect.any(Date), confirmedById: 'u1' },
      });
    });
  });

  describe('cancel', () => {
    it('huỷ -> CANCELLED + lý do + đóng thông báo BOOKING_SHORT', async () => {
      await service.cancel('100', { reason: ' khách đổi lịch ' });
      expect(prisma.booking.update).toHaveBeenCalledWith({
        where: { id: 100n },
        data: expect.objectContaining({
          status: 'CANCELLED',
          cancelledById: 'u1',
          cancelReason: 'khách đổi lịch',
        }),
      });
      expect(notifications.resolve).toHaveBeenCalledWith({
        entityType: 'BOOKING',
        entityId: '100',
        types: ['BOOKING_SHORT'],
      });
    });

    it('đã huỷ -> 409; có dòng đã xuất -> 409', async () => {
      prisma.booking.findUnique.mockResolvedValue(bookingRow({ status: 'CANCELLED' }));
      await expect(service.cancel('100', { reason: 'x' })).rejects.toThrow(ConflictException);
      prisma.booking.findUnique.mockResolvedValue(
        bookingRow({ lines: [{ ...bookingRow().lines[0], shippedQty: 5 }] }),
      );
      await expect(service.cancel('100', { reason: 'x' })).rejects.toThrow(ConflictException);
    });

    it('lỗi khi đóng thông báo không làm hỏng việc huỷ', async () => {
      notifications.resolve.mockRejectedValue(new Error('boom'));
      await expect(service.cancel('100', { reason: 'x' })).resolves.toBeDefined();
    });
  });

  describe('đọc', () => {
    it('findOne: response qua instanceToPlain giữ đủ lines / totals / attachments lồng nhau', async () => {
      state.active = [
        {
          bookingId: 100n,
          productionInvoiceItemId: 11n,
          salesOrderItemId: 7n,
          qty: 40,
          shippedQty: 0,
          booking: { pickupDate: null, cutOffAt: null },
        },
      ];
      prisma.packagingRecord.groupBy.mockResolvedValue([
        { productionInvoiceItemId: 11n, _sum: { boxesPacked: 25 } },
      ]);
      const plain: any = instanceToPlain(await service.findOne('100'));

      expect(plain.id).toBe('100');
      expect(plain.customerName).toBe('ACME');
      expect(plain.createdByName).toBe('Nguyễn An');
      expect(plain.warehouseName).toBe('Kho thành phẩm');
      expect(plain.attachments).toEqual([
        { name: 'bk.pdf', url: 'https://x/bk.pdf', uploadedAt: '2026-11-01T00:00:00.000Z' },
      ]);
      expect(plain.orderCodes).toEqual(['PO-1']);
      expect(plain.lenhCodes).toEqual(['MY-313']);
      expect(plain.lines).toHaveLength(1);
      expect(plain.lines[0]).toMatchObject({
        id: '1',
        qty: 40,
        packedQty: 25,
        readyQty: 25,
        shortQty: 15,
        orderQty: 100,
        // availableQty của dòng booking = số tối đa CHÍNH booking này được giữ (không trừ phần của nó) - hợp đồng booking-response.dto.
        bookedOtherQty: 0,
        availableQty: 100,
        lineM3: 20,
        setVolumeM3: 0.5,
      });
      expect(plain.totals).toMatchObject({
        qty: 40,
        totalM3: 20,
        capacityM3: 68,
        fillPct: 29.4,
        shortQty: 15,
        shortLines: 1,
        missingVolumeSkus: [],
      });
    });

    it('findOne: 404 khi không có; id không phải số -> 400', async () => {
      prisma.booking.findUnique.mockResolvedValue(null);
      await expect(service.findOne('5')).rejects.toThrow(NotFoundException);
      await expect(service.findOne('abc')).rejects.toThrow(BadRequestException);
    });

    it('findAll: mặc định loại booking đã huỷ, sắp theo ngày lấy cont, tối đa 500, gom truy vấn theo lô', async () => {
      prisma.booking.findMany.mockResolvedValue([
        bookingRow(),
        bookingRow({ id: 101n, lines: [{ ...bookingRow().lines[0], id: 2n, bookingId: 101n }] }),
      ]);
      const res = await service.findAll({});
      expect(res).toHaveLength(2);
      const args = prisma.booking.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ AND: [{ status: { not: 'CANCELLED' } }] });
      expect(args.take).toBe(500);
      // Không N+1: 1 lần đọc PII / 1 lần groupBy / 1 lần đọc config cho cả lô.
      expect(prisma.productionInvoiceItem.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.packagingRecord.groupBy).toHaveBeenCalledTimes(1);
      expect(prisma.systemConfig.findUnique).toHaveBeenCalledTimes(1);
    });

    it('findAll: from/to đổi sang khoảng ngày VN cho cột timestamp, includeCancelled bỏ lọc huỷ', async () => {
      await service.findAll({
        from: '2026-11-01',
        to: '2026-11-30',
        includeCancelled: true,
      });
      const where = prisma.booking.findMany.mock.calls[0][0].where;
      const or = where.AND[0].OR;
      expect(or[0]).toEqual({
        pickupDate: {
          gte: new Date('2026-11-01T00:00:00Z'),
          lte: new Date('2026-11-30T00:00:00Z'),
        },
      });
      expect(or[3]).toEqual({
        cutOffAt: {
          gte: new Date('2026-10-31T17:00:00Z'),
          lt: new Date('2026-11-30T17:00:00Z'),
        },
      });
    });

    it('getMeta: chỉ kho thành phẩm, mặc định 68 m3 khi chưa có cấu hình', async () => {
      prisma.warehouse.findMany.mockResolvedValue([
        { code: 'thanh-pham-2', name: 'TP 2' },
        { code: 'phoi-son-han', name: 'Phôi' },
        { code: 'thanh-pham', name: 'TP' },
      ]);
      prisma.systemConfig.findUnique.mockResolvedValue(null);
      const meta = await service.getMeta();
      expect(meta.finishedWarehouses.map((w) => w.code)).toEqual(['thanh-pham', 'thanh-pham-2']);
      expect(meta.containerVolumeM3).toBe(68);
    });
  });

  describe('getCandidates', () => {
    it('availableQty / readyQty / currentQty; dòng hết hàng chỉ hiện khi đang nằm trong booking; lọc PI huỷ ở truy vấn', async () => {
      prisma.productionInvoiceItem.findMany.mockResolvedValue([
        pii(), // soi 7: 100, booking khác giữ 20 -> còn 80
        pii({
          id: 12n,
          salesOrderItemId: 8n,
          salesOrderItem: {
            id: 8n,
            totalQty: 10,
            shippedQty: 10,
            skuName: 'B',
            deliveryDate: null,
          },
        }), // hết hàng nhưng đang nằm trong booking này
        pii({
          id: 13n,
          salesOrderItemId: 9n,
          salesOrderItem: {
            id: 9n,
            totalQty: 10,
            shippedQty: 10,
            skuName: 'C',
            deliveryDate: null,
          },
        }), // hết hàng, không nằm trong booking -> bỏ
      ]);
      state.existing = [{ productionInvoiceItemId: 12n, qty: 5 }];
      state.active = [
        {
          bookingId: 50n,
          productionInvoiceItemId: 11n,
          salesOrderItemId: 7n,
          qty: 20,
          shippedQty: 0,
          booking: { pickupDate: null, cutOffAt: null },
        },
      ];
      prisma.packagingRecord.groupBy.mockResolvedValue([
        { productionInvoiceItemId: 11n, _sum: { boxesPacked: 30 } },
      ]);

      const res = await service.getCandidates({ customerId: '1', bookingId: '100' });

      expect(res.map((r) => r.productionInvoiceItemId)).toEqual(['11', '12']);
      expect(res[0]).toMatchObject({
        orderQty: 100,
        bookedOtherQty: 20,
        availableQty: 80,
        packedQty: 30,
        readyQty: 30,
        currentQty: 0,
        piStatus: 'PLANNING',
      });
      expect(res[1]).toMatchObject({ availableQty: 0, currentQty: 5 });
      const where = prisma.productionInvoiceItem.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { productionInvoiceId: null },
        { productionInvoice: { status: { not: 'CANCELLED' } } },
      ]);
      expect(where.salesOrder).toEqual({ customerId: 1n, isActive: true, deletedAt: null });
    });

    it('booking đang sửa: số đã xếp của chính nó không tính vào "booking khác"', async () => {
      state.active = [
        {
          bookingId: 100n,
          productionInvoiceItemId: 11n,
          salesOrderItemId: 7n,
          qty: 40,
          shippedQty: 0,
          booking: { pickupDate: null, cutOffAt: null },
        },
      ];
      state.existing = [{ productionInvoiceItemId: 11n, qty: 40 }];
      const res = await service.getCandidates({ customerId: '1', bookingId: '100' });
      expect(res[0]).toMatchObject({ bookedOtherQty: 0, availableQty: 100, currentQty: 40 });
    });
  });
});
