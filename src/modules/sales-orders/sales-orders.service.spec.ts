import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { SalesOrdersService } from './sales-orders.service';

describe('SalesOrdersService', () => {
  let service: SalesOrdersService;
  let prisma: {
    customer: { findUnique: jest.Mock };
    mfgProduct: { findUnique: jest.Mock };
    salesOrder: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    salesOrderItem: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
    productionInvoiceItem: { createMany: jest.Mock };
    planForm: { findFirst: jest.Mock; update: jest.Mock };
    $queryRaw: jest.Mock;
  };

  const customer = { id: 1n, name: 'Khach A' };
  const product = { id: 2n, factoryCode: 'SKU-01', name: 'Ghe A' };
  const orderWithItems = (overrides: Record<string, unknown> = {}) => ({
    id: 10n,
    code: 'PO-10',
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
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      salesOrderItem: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      productionInvoiceItem: { createMany: jest.fn() },
      planForm: { findFirst: jest.fn(), update: jest.fn() },
      $queryRaw: jest.fn(),
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
          customerId: '1',
          orderDate: '2026-01-01',
          items: [{ mfgProductId: '999', totalQty: 1 }],
        }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.salesOrder.create).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('throws 404 for a non-existent id', async () => {
      prisma.salesOrder.findUnique.mockResolvedValue(null);

      await expect(service.findOne('999')).rejects.toThrow(NotFoundException);
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
