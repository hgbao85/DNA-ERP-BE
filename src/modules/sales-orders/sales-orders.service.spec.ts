import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { Prisma, SalesOrderItemStatus } from '../../generated/prisma/client';
import { SalesOrdersService } from './sales-orders.service';

describe('SalesOrdersService', () => {
  let service: SalesOrdersService;
  let prisma: {
    customer: { findUnique: jest.Mock };
    mfgProduct: { findUnique: jest.Mock };
    salesOrder: {
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    salesOrderItem: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    productionInvoice: {
      create: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    productionInvoiceItem: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      createMany: jest.Mock;
      count: jest.Mock;
      deleteMany: jest.Mock;
    };
    planForm: { findFirst: jest.Mock; findMany: jest.Mock; update: jest.Mock };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };

  const customer = { id: 1n, name: 'Khach A' };
  const product = { id: 2n, factoryCode: 'SKU-01', name: 'Ghe A' };
  const orderWithItems = (overrides: Record<string, unknown> = {}) => ({
    id: 10n,
    code: 'PO-10',
    orderCode: 'DH-KHACH-A-01',
    customerId: 1n,
    customer,
    orderDate: new Date('2026-01-01'),
    deliveryDate: null,
    depositAmount: { toNumber: () => 0 },
    depositConfirmed: false,
    paidAmount: { toNumber: () => 0 },
    attachmentName: null,
    attachmentUrl: null,
    note: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [],
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      customer: { findUnique: jest.fn() },
      mfgProduct: { findUnique: jest.fn() },
      salesOrder: {
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        // Dùng chung cho cả "tìm theo id" (findOneOrThrow, các test khác tự override) LẪN pre-check
        // "orderCode đã tồn tại chưa" trong create() (10/09) - mặc định null = orderCode chưa dùng,
        // test tạo trùng orderCode tự override thành 1 order giả.
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      salesOrderItem: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        deleteMany: jest.fn(),
      },

      productionInvoice: {
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        // 10/09: remove() xoá luôn vỏ PI rỗng (nếu có) gắn riêng cho đơn - mặc định không có vỏ
        // nào để xoá (deleteMany no-op an toàn khi where không khớp gì).
        deleteMany: jest.fn(),
      },
      // Medium fix "chặn sửa totalQty khi đã ghim PI/PO" - mặc định chưa ghim gì (null), test nào
      // cần mô phỏng đã ghim PI tự override.
      productionInvoiceItem: {
        findFirst: jest.fn().mockResolvedValue(null),
        // 10/09: findAll() gộp check "đã gộp PI" qua 1 query findMany duy nhất cho cả trang -
        // mặc định chưa có order nào gộp PI (mảng rỗng), test nào cần mô phỏng đã gộp tự override.
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn(),
        // Medium fix "chặn xoá đơn đã gộp PI" (remove()) - mặc định chưa gộp PI nào (0).
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn(),
      },

      // 10/09: remove() gỡ liên kết (KHÔNG xoá) mọi PlanForm/SKU còn gắn vào đơn - mặc định chưa
      // gắn SKU nào (mảng rỗng), test nào cần mô phỏng đã gắn tự override.
      planForm: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      $queryRaw: jest.fn(),
      // 10/09: remove() giờ bọc xoá cascade (productionInvoiceItem/salesOrderItem) +
      // salesOrder.delete() trong 1 $transaction - test chạy callback thẳng với `prisma` (đủ vì
      // các mock ở trên dùng chung namespace, không tách tx riêng).
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    service = new SalesOrdersService(prisma as unknown as PrismaServiceType);
  });

  describe('create', () => {
    it('creates an order with items, creating ProductionInvoiceItem rows with no PI yet (2026-08-20)', async () => {
      prisma.customer.findUnique.mockResolvedValue(customer);
      prisma.mfgProduct.findUnique.mockResolvedValue(product);
      prisma.salesOrder.create.mockResolvedValue(orderWithItems({ code: 'PO-TMP-x' }));
      prisma.salesOrder.update.mockResolvedValue(
        orderWithItems({
          code: 'PO-10',
          items: [
            {
              id: 100n,
              salesOrderId: 10n,
              mfgProductId: 2n,
              mfgProduct: product,
              totalQty: 5,
              shippedQty: 0,
              skuName: null,
              deliveryDate: null,
            },
          ],
        }),
      );
      prisma.productionInvoiceItem.createMany.mockResolvedValue({ count: 1 });
      prisma.planForm.findFirst.mockResolvedValue(null);

      const result = await service.create({
        orderCode: 'DH-KHACH-A-01',
        customerId: '1',
        orderDate: '2026-01-01',
        items: [{ mfgProductId: '2', totalQty: 5 }],
      });

      expect(result.code).toBe('PO-10');
      expect(prisma.salesOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { code: 'PO-10' } }),
      );
      // PI KHÔNG còn tự sinh ngay lúc tạo PO (2026-08-20) - chỉ item được tạo, productionInvoiceId
      // để null cho tới khi KHSX chủ động gom (GomDotCatPage - "Xác nhận gộp"/"Tiến hành cắt riêng").
      expect(prisma.productionInvoiceItem.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              productionInvoiceId: null,
              mfgProductId: 2n,
              salesOrderId: 10n,
              quantity: 5,
            }),
          ],
        }),
      );
      expect(prisma.planForm.update).not.toHaveBeenCalled();
    });

    it('links an existing unlinked SKU for the same product to the new PO/PI', async () => {
      prisma.customer.findUnique.mockResolvedValue(customer);
      prisma.mfgProduct.findUnique.mockResolvedValue(product);
      prisma.salesOrder.create.mockResolvedValue(orderWithItems({ code: 'PO-TMP-x' }));
      prisma.salesOrder.update.mockResolvedValue(
        orderWithItems({
          code: 'PO-10',
          items: [
            {
              id: 100n,
              salesOrderId: 10n,
              mfgProductId: 2n,
              mfgProduct: product,
              skuName: null,
              totalQty: 5,
              shippedQty: 0,
              status: 'LEN_KE_HOACH',
              deliveryDate: null,
            },
          ],
        }),
      );
      prisma.productionInvoiceItem.createMany.mockResolvedValue({ count: 1 });
      prisma.planForm.findFirst.mockResolvedValue({ id: 7n });

      await service.create({
        orderCode: 'DH-KHACH-A-01',
        customerId: '1',
        orderDate: '2026-01-01',
        items: [{ mfgProductId: '2', totalQty: 5 }],
      });

      expect(prisma.planForm.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { mfgProductId: 2n, salesOrderId: null } }),
      );
      // productionInvoiceId null (2026-08-20) - PI chưa tồn tại lúc tạo PO, gắn sau lúc KHSX gom.
      expect(prisma.planForm.update).toHaveBeenCalledWith({
        where: { id: 7n },
        data: { salesOrderId: 10n, productionInvoiceId: null },
      });
    });

    it('rejects when the customer does not exist', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(
        service.create({
          orderCode: 'DH-KHACH-A-01',
          customerId: '999',
          orderDate: '2026-01-01',
          items: [{ mfgProductId: '2', totalQty: 1 }],
        }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.salesOrder.create).not.toHaveBeenCalled();
    });

    it('rejects when an item references a non-existent product', async () => {
      prisma.customer.findUnique.mockResolvedValue(customer);
      prisma.mfgProduct.findUnique.mockResolvedValue(null);

      await expect(
        service.create({
          orderCode: 'DH-KHACH-A-01',
          customerId: '1',
          orderDate: '2026-01-01',
          items: [{ mfgProductId: '999', totalQty: 1 }],
        }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.salesOrder.create).not.toHaveBeenCalled();
    });

    // 10/09: orderCode (Sales tự gõ tay) bắt buộc + unique - đây là lần đầu SalesOrder có thể
    // trùng mã lúc tạo (code cũ luôn tự sinh, không bao giờ trùng).
    it('rejects when orderCode is already used by another order (pre-check)', async () => {
      prisma.customer.findUnique.mockResolvedValue(customer);
      prisma.mfgProduct.findUnique.mockResolvedValue(product);
      prisma.salesOrder.findUnique.mockResolvedValue(orderWithItems({ id: 99n }));

      await expect(
        service.create({
          orderCode: 'DH-KHACH-A-01',
          customerId: '1',
          orderDate: '2026-01-01',
          items: [{ mfgProductId: '2', totalQty: 1 }],
        }),
      ).rejects.toThrow(
        new ConflictException('Mã đơn hàng "DH-KHACH-A-01" đã được dùng cho đơn khác'),
      );
      expect(prisma.salesOrder.create).not.toHaveBeenCalled();
    });

    // Race: 2 request tạo cùng orderCode gần như đồng thời đều qua được pre-check (đọc "chưa tồn
    // tại"), request thua bị DB unique constraint chặn thật (P2002) - phải bắt lại thành lỗi
    // nghiệp vụ rõ ràng, không để lọt ra AllExceptionsFilter thành "Duplicate value for: ...".
    it('race: rejects with the friendly orderCode-conflict 409 when create() loses on unique constraint (P2002)', async () => {
      prisma.customer.findUnique.mockResolvedValue(customer);
      prisma.mfgProduct.findUnique.mockResolvedValue(product);
      prisma.salesOrder.findUnique.mockResolvedValue(null); // pre-check "chưa thấy"
      const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.9.0',
        meta: { target: ['orderCode'] },
      });
      prisma.salesOrder.create.mockRejectedValue(p2002);

      await expect(
        service.create({
          orderCode: 'DH-KHACH-A-01',
          customerId: '1',
          orderDate: '2026-01-01',
          items: [{ mfgProductId: '2', totalQty: 1 }],
        }),
      ).rejects.toThrow(
        new ConflictException('Mã đơn hàng "DH-KHACH-A-01" đã được dùng cho đơn khác'),
      );
    });
  });

  describe('update', () => {
    // 10/09: update() cũng trả deleteBlockedReason đúng (không hardcode null) dù chỉ sửa
    // attachmentName/note/depositConfirmed/isActive - các field này không ảnh hưởng gộp PI/giao
    // hàng, nhưng response vẫn phải phản ánh đúng trạng thái deletable hiện tại của order.
    it('deleteBlockedReason phản ánh đúng trạng thái đã gộp PI, không hardcode null', async () => {
      prisma.salesOrder.findUnique.mockResolvedValue(orderWithItems());
      prisma.salesOrder.update.mockResolvedValue(orderWithItems());
      prisma.productionInvoiceItem.count.mockResolvedValue(1);

      const result = await service.update('10', { note: 'x' });
      expect(result.deleteBlockedReason).toContain('gộp vào Phiếu sản xuất');
    });
  });

  describe('findOne', () => {
    it('throws 404 for a non-existent id', async () => {
      prisma.salesOrder.findUnique.mockResolvedValue(null);

      await expect(service.findOne('999')).rejects.toThrow(NotFoundException);
    });

    // 10/09: disable nút Xoá khi biết trước sẽ bị chặn - findOne() giờ trả deleteBlockedReason,
    // dùng chung buildDeleteBlockReason() với remove() để không lệch nội dung/logic.
    it('deleteBlockedReason = null khi chưa gộp PI và chưa giao hàng gì', async () => {
      prisma.salesOrder.findUnique.mockResolvedValue(orderWithItems());
      prisma.productionInvoiceItem.count.mockResolvedValue(0);

      const result = await service.findOne('10');
      expect(result.deleteBlockedReason).toBeNull();
    });

    it('deleteBlockedReason có giá trị khi đã gộp vào 1 PI', async () => {
      prisma.salesOrder.findUnique.mockResolvedValue(orderWithItems());
      prisma.productionInvoiceItem.count.mockResolvedValue(2);

      const result = await service.findOne('10');
      expect(result.deleteBlockedReason).toContain('gộp vào Phiếu sản xuất');
    });

    it('deleteBlockedReason có giá trị khi đã giao hàng một phần', async () => {
      prisma.salesOrder.findUnique.mockResolvedValue(
        orderWithItems({
          items: [
            {
              id: 100n,
              salesOrderId: 10n,
              mfgProductId: 2n,
              mfgProduct: product,
              skuName: 'Ghe A',
              totalQty: 10,
              shippedQty: 3,
            },
          ],
        }),
      );
      prisma.productionInvoiceItem.count.mockResolvedValue(0);

      const result = await service.findOne('10');
      expect(result.deleteBlockedReason).toContain('đã giao hàng một phần');
    });
  });

  describe('findAll', () => {
    it('gộp deleteBlockedReason cho nhiều order qua đúng 1 query findMany, không count() riêng từng order (N+1)', async () => {
      prisma.salesOrder.findMany.mockResolvedValue([
        orderWithItems({ id: 10n, code: 'PO-10' }),
        orderWithItems({ id: 20n, code: 'PO-20' }),
      ]);
      prisma.salesOrder.count.mockResolvedValue(2);
      prisma.productionInvoiceItem.findMany.mockResolvedValue([
        { salesOrderId: 10n, productionInvoice: null },
      ]);

      const result = await service.findAll({ page: 1, limit: 20, sortOrder: 'desc' } as never);

      expect(result.data.find((o) => o.id === '10')?.deleteBlockedReason).toContain(
        'gộp vào Phiếu sản xuất',
      );
      expect(result.data.find((o) => o.id === '20')?.deleteBlockedReason).toBeNull();
      expect(prisma.productionInvoiceItem.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.productionInvoiceItem.count).not.toHaveBeenCalled();
    });
  });

  // Đính chính audit toàn diện 09/09 (Trung bình/Bán hàng): remove() trước đây không kiểm tra gì -
  // xoá được đơn đã gộp PI/đã giao hàng một phần, "biến mất" khỏi Sales trong khi nhà máy vẫn sản
  // xuất/giao hàng theo đơn đó.
  describe('remove', () => {
    it('ném ConflictException khi đơn có dòng đã gộp vào 1 PI (productionInvoiceId != null)', async () => {
      prisma.salesOrder.findUnique.mockResolvedValue(orderWithItems());
      prisma.productionInvoiceItem.count.mockResolvedValue(1);

      await expect(service.remove('10')).rejects.toThrow(ConflictException);
      expect(prisma.salesOrder.delete).not.toHaveBeenCalled();
    });

    it('ném ConflictException khi đơn có dòng đã giao hàng một phần (shippedQty > 0)', async () => {
      prisma.salesOrder.findUnique.mockResolvedValue(
        orderWithItems({
          items: [
            {
              id: 100n,
              salesOrderId: 10n,
              mfgProductId: 2n,
              mfgProduct: product,
              skuName: 'Ghe A',
              totalQty: 10,
              shippedQty: 3,
            },
          ],
        }),
      );

      await expect(service.remove('10')).rejects.toThrow(ConflictException);
      expect(prisma.salesOrder.delete).not.toHaveBeenCalled();
    });

    // 10/09: người dùng yêu cầu xoá PO phải cascade luôn ProductionInvoiceItem/SalesOrderItem sinh
    // cùng lúc tạo PO - không để lại "dữ liệu sản xuất mồ côi không có PO đứng sau". An toàn vì
    // guard ở trên đã đảm bảo productionInvoiceId = null cho mọi item (chưa gộp PI thật).
    it('xoá bình thường: cascade xoá productionInvoiceItem + salesOrderItem + vỏ ProductionInvoice rỗng TRONG transaction trước khi hard-delete order thật', async () => {
      prisma.salesOrder.findUnique.mockResolvedValue(
        orderWithItems({
          items: [
            {
              id: 100n,
              salesOrderId: 10n,
              mfgProductId: 2n,
              mfgProduct: product,
              skuName: 'Ghe A',
              totalQty: 10,
              shippedQty: 0,
            },
          ],
        }),
      );

      await service.remove('10');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.productionInvoice.deleteMany).toHaveBeenCalledWith({
        where: { salesOrderId: 10n },
      });
      expect(prisma.productionInvoiceItem.deleteMany).toHaveBeenCalledWith({
        where: { salesOrderId: 10n },
      });
      expect(prisma.salesOrderItem.deleteMany).toHaveBeenCalledWith({
        where: { salesOrderId: 10n },
      });
      expect(prisma.salesOrder.delete).toHaveBeenCalledWith({ where: { id: 10n } });

      // Thứ tự: mọi deleteMany PHẢI chạy trước salesOrder.delete (con trước cha).
      const deleteOrderCallOrder = prisma.salesOrder.delete.mock.invocationCallOrder[0];
      const piDeleteCallOrder = prisma.productionInvoice.deleteMany.mock.invocationCallOrder[0];
      const piItemDeleteCallOrder =
        prisma.productionInvoiceItem.deleteMany.mock.invocationCallOrder[0];
      const orderItemDeleteCallOrder = prisma.salesOrderItem.deleteMany.mock.invocationCallOrder[0];
      expect(piDeleteCallOrder).toBeLessThan(deleteOrderCallOrder);
      expect(piItemDeleteCallOrder).toBeLessThan(deleteOrderCallOrder);
      expect(orderItemDeleteCallOrder).toBeLessThan(deleteOrderCallOrder);
    });

    // 10/09: SKU (PlanForm) gắn sẵn vào đơn qua linkExistingSkus() KHÔNG bị xoá khi xoá PO - chỉ
    // gỡ liên kết (salesOrderId = null), giữ nguyên dữ liệu độc lập của KHSX (định mức, lịch sử
    // duyệt...). Bắt buộc phải gỡ vì SalesOrder giờ hard-delete thật - nếu không gỡ, Postgres sẽ
    // chặn bởi lỗi khoá ngoại (PlanForm.salesOrderId vẫn trỏ về đơn sắp bị xoá).
    it('gỡ liên kết (KHÔNG xoá) PlanForm/SKU còn gắn vào đơn trước khi hard-delete order', async () => {
      prisma.salesOrder.findUnique.mockResolvedValue(orderWithItems());
      prisma.planForm.findMany.mockResolvedValue([{ id: 500n, salesOrderId: 10n }]);

      await service.remove('10');

      expect(prisma.planForm.update).toHaveBeenCalledWith({
        where: { id: 500n },
        data: { salesOrderId: null },
      });
      const skuUnlinkCallOrder = prisma.planForm.update.mock.invocationCallOrder[0];
      const deleteOrderCallOrder = prisma.salesOrder.delete.mock.invocationCallOrder[0];
      expect(skuUnlinkCallOrder).toBeLessThan(deleteOrderCallOrder);
    });
  });

  describe('updateItem', () => {
    it('throws 404 when the item does not belong to the order', async () => {
      prisma.salesOrder.findUnique.mockResolvedValue(orderWithItems());
      prisma.salesOrderItem.findUnique.mockResolvedValue({ id: 5n, salesOrderId: 999n });

      await expect(service.updateItem('10', '5', { totalQty: 2 })).rejects.toThrow(
        NotFoundException,
      );
    });

    // Medium fix: totalQty trước đây sửa được vô hạn định kể cả sau khi đã ghim vào
    // ProductionInvoiceItem.quantity (chỉ ghim 1 lần lúc PI tạo, không tự đồng bộ lại) - sản xuất
    // làm theo số cũ trong khi đơn hàng thực tế đã đổi, không ai được cảnh báo.
    const linkedItem = {
      id: 5n,
      salesOrderId: 10n,
      mfgProductId: 2n,
      totalQty: 10,
      mfgProduct: product,
    };

    it('chặn sửa totalQty khi sản phẩm đã ghim vào 1 ProductionInvoiceItem (PI gộp - salesOrderId ghim thẳng trên item)', async () => {
      prisma.salesOrder.findUnique.mockResolvedValue(orderWithItems());
      prisma.salesOrderItem.findUnique.mockResolvedValue(linkedItem);
      prisma.productionInvoiceItem.findFirst.mockResolvedValue({ id: 77n });

      await expect(service.updateItem('10', '5', { totalQty: 20 })).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.salesOrderItem.update).not.toHaveBeenCalled();
      expect(prisma.productionInvoiceItem.findFirst).toHaveBeenCalledWith({
        where: {
          mfgProductId: 2n,
          OR: [{ salesOrderId: 10n }, { productionInvoice: { salesOrderId: 10n } }],
        },
      });
    });

    it('cho phép sửa totalQty khi chưa ghim PI nào', async () => {
      prisma.salesOrder.findUnique.mockResolvedValue(orderWithItems());
      prisma.salesOrderItem.findUnique.mockResolvedValue(linkedItem);
      prisma.productionInvoiceItem.findFirst.mockResolvedValue(null);
      prisma.salesOrderItem.update.mockResolvedValue({ ...linkedItem, totalQty: 20 });

      const result = await service.updateItem('10', '5', { totalQty: 20 });
      expect(result.totalQty).toBe(20);
    });

    it('vẫn cho sửa field KHÁC (vd status) dù đã ghim PI, miễn không đổi totalQty', async () => {
      prisma.salesOrder.findUnique.mockResolvedValue(orderWithItems());
      prisma.salesOrderItem.findUnique.mockResolvedValue(linkedItem);
      prisma.productionInvoiceItem.findFirst.mockResolvedValue({ id: 77n });
      prisma.salesOrderItem.update.mockResolvedValue({
        ...linkedItem,
        status: SalesOrderItemStatus.DONG_GOI,
      });

      await service.updateItem('10', '5', { status: SalesOrderItemStatus.DONG_GOI, totalQty: 10 });
      expect(prisma.salesOrderItem.update).toHaveBeenCalled();
    });
  });

  describe('shipItem', () => {
    it('cộng dồn shippedQty qua 1 câu UPDATE nguyên tử, không đọc-rồi-ghi', async () => {
      prisma.$queryRaw.mockResolvedValue([{ id: 5n }]);
      prisma.salesOrderItem.findUnique.mockResolvedValue({
        id: 5n,
        salesOrderId: 10n,
        mfgProductId: 2n,
        skuName: 'Ghe A',
        totalQty: 10,
        shippedQty: 7,
        status: 'LEN_KE_HOACH',
        deliveryDate: null,
        mfgProduct: product,
      });

      const result = await service.shipItem('10', '5', { qty: 3 });

      expect(result.shippedQty).toBe(7);
      // Phép cộng + điều kiện trần nằm chung 1 câu SQL - không có findUnique nào xen giữa để đọc
      // "current" trước khi ghi, đúng thứ tự khoá dòng ở DB thay vì tính ở tầng ứng dụng.
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('từ chối khi ship sẽ vượt totalQty, không âm thầm ghi đè', async () => {
      prisma.$queryRaw.mockResolvedValue([]); // WHERE ...<= totalQty không khớp dòng nào
      prisma.salesOrderItem.findUnique.mockResolvedValue({
        id: 5n,
        salesOrderId: 10n,
        totalQty: 10,
        shippedQty: 9,
      });

      await expect(service.shipItem('10', '5', { qty: 5 })).rejects.toThrow(ConflictException);
    });

    it('2 request ship gần như đồng thời không lệch số dư: request sau cộng dồn trên kết quả request trước', async () => {
      // Mô phỏng 2 lần gọi $queryRaw tuần tự cho đúng cùng 1 dòng - lần 2 phải thấy ảnh hưởng
      // của lần 1 (7 -> 9) vì phép cộng chạy ở DB, không phải tính trước rồi PATCH giá trị tuyệt đối.
      prisma.$queryRaw.mockResolvedValue([{ id: 5n }]);
      prisma.salesOrderItem.findUnique
        .mockResolvedValueOnce({
          id: 5n,
          salesOrderId: 10n,
          mfgProductId: 2n,
          totalQty: 10,
          shippedQty: 9, // sau request 1: 7 + 2
          mfgProduct: product,
        })
        .mockResolvedValueOnce({
          id: 5n,
          salesOrderId: 10n,
          mfgProductId: 2n,
          totalQty: 10,
          shippedQty: 10, // sau request 2: 9 + 1
          mfgProduct: product,
        });

      const first = await service.shipItem('10', '5', { qty: 2 });
      const second = await service.shipItem('10', '5', { qty: 1 });

      expect(first.shippedQty).toBe(9);
      expect(second.shippedQty).toBe(10);
    });

    it('throws 404 when the item does not belong to the order', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.salesOrderItem.findUnique.mockResolvedValue({ id: 5n, salesOrderId: 999n });

      await expect(service.shipItem('10', '5', { qty: 1 })).rejects.toThrow(NotFoundException);
    });
  });
});
