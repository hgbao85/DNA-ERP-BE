import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Prisma, PurchaseProposalStatus, SupplierOrderStatus } from '../../generated/prisma/client';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { PurchaseProposalsService } from './purchase-proposals.service';
import { SupplierOrdersService } from './supplier-orders.service';
import { vnYear } from './supplier-order-code.util';

const decimal = (n: number) => new Prisma.Decimal(n);

describe('SupplierOrdersService (bản v8 mục 4.10 - đơn đặt hàng NCC)', () => {
  let service: SupplierOrdersService;
  let prisma: {
    supplier: { findUnique: jest.Mock; findMany: jest.Mock };
    purchaseProposalItem: { findMany: jest.Mock; updateMany: jest.Mock; update: jest.Mock };
    supplierOrder: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      aggregate: jest.Mock;
      groupBy: jest.Mock;
    };
    supplierOrderCounter: { findUnique: jest.Mock; findMany: jest.Mock; upsert: jest.Mock };
    stockQuant: { groupBy: jest.Mock };
    productionInvoice: { findMany: jest.Mock };
    productionInvoiceItem: { findMany: jest.Mock };
    purchaseProposal: { update: jest.Mock };
    auditLog: { create: jest.Mock };
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let proposals: { bossApprove: jest.Mock };

  const supplier = { id: 7n, name: 'Kim Phát', isActive: true, deletedAt: null };
  const pendingItem = (overrides: Record<string, unknown> = {}) => ({
    id: 400n,
    proposalId: 300n,
    status: PurchaseProposalStatus.NEW,
    supplierOrderId: null,
    buyQty: decimal(6),
    orderQty: null,
    receivedQty: decimal(0),
    stockLengthMm: null,
    spec: null,
    materialId: 30n,
    material: { code: 'KHI-CO2', name: 'Khí CO2', unit: 'bình', buyerId: 'buyer-1', spec: null },
    proposal: { productionInvoiceId: 50n },
    ...overrides,
  });
  const order = (overrides: Record<string, unknown> = {}) => ({
    id: 90n,
    supplierId: 7n,
    year: 2026,
    seq: 53,
    status: SupplierOrderStatus.DRAFT,
    createdById: 'buyer-1',
    approvalFileUrl: null,
    approvedAt: null,
    cancelledAt: null,
    cancelReason: null,
    revision: 0,
    revisedAt: null,
    reviseReason: null,
    createdAt: new Date('2026-11-04T03:00:00Z'),
    supplier,
    createdBy: { firstName: 'Nghi', lastName: 'Trần' },
    items: [pendingItem({ supplierOrderId: 90n })],
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      supplier: { findUnique: jest.fn().mockResolvedValue(supplier), findMany: jest.fn() },
      purchaseProposalItem: {
        findMany: jest.fn().mockResolvedValue([pendingItem()]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      supplierOrder: {
        create: jest.fn().mockResolvedValue({ id: 90n }),
        findUnique: jest.fn().mockResolvedValue(order()),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        aggregate: jest.fn().mockResolvedValue({ _max: { seq: 0 } }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      supplierOrderCounter: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(),
      },
      auditLog: { create: jest.fn() },
      stockQuant: { groupBy: jest.fn().mockResolvedValue([]) },
      // Mã lệnh hiển thị (loadLenhDisplayCodes của người A): PI 50 có dòng mang số LSX MY-313.
      productionInvoice: {
        findMany: jest.fn().mockResolvedValue([{ id: 50n, code: 'PI-2026-031' }]),
      },
      productionInvoiceItem: {
        findMany: jest.fn().mockResolvedValue([{ productionInvoiceId: 50n, lsxCode: 'MY-313' }]),
      },
      // recomputeProposalStatus() sau THAY PHIẾU: đọc status mọi dòng rồi ghi rollup lên đề xuất.
      purchaseProposal: { update: jest.fn() },
      // Mặc định: bộ đếm trả số tiếp theo 53; khoá dòng đơn trả DRAFT.
      $queryRaw: jest.fn().mockResolvedValue([{ lastSeq: 53, status: SupplierOrderStatus.DRAFT }]),
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    proposals = { bossApprove: jest.fn().mockResolvedValue({}) };
    const cls = { isActive: jest.fn().mockReturnValue(false), get: jest.fn(), getId: jest.fn() };
    service = new SupplierOrdersService(
      prisma as unknown as PrismaServiceType,
      proposals as unknown as PurchaseProposalsService,
      cls as unknown as ClsService<AppClsStore>,
      { publishEntityChanged: jest.fn() } as unknown as RealtimeService,
    );
  });

  describe('create', () => {
    it('cấp số đơn tiếp theo của NCC trong năm, gắn các dòng vào đơn', async () => {
      const res = await service.create({ supplierId: '7', itemIds: ['400'] }, 'buyer-1', [
        'PURCHASER',
      ]);

      expect(prisma.supplierOrder.create).toHaveBeenCalledWith({
        data: { supplierId: 7n, year: vnYear(), seq: 53, createdById: 'buyer-1' },
      });
      expect(prisma.purchaseProposalItem.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: [400n] },
          supplierOrderId: null,
          status: { in: expect.any(Array) as unknown },
        },
        data: { supplierOrderId: 90n },
      });
      expect(res).toMatchObject({ code: '53/2026', supplierName: 'Kim Phát' });
      expect(res.items[0].orderCode).toBe('MY-313');
    });

    it('bắt buộc NCC tồn tại và còn hợp tác', async () => {
      prisma.supplier.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.create({ supplierId: '7', itemIds: ['400'] }, 'buyer-1', ['PURCHASER']),
      ).rejects.toThrow(NotFoundException);

      prisma.supplier.findUnique.mockResolvedValueOnce({ ...supplier, isActive: false });
      await expect(
        service.create({ supplierId: '7', itemIds: ['400'] }, 'buyer-1', ['PURCHASER']),
      ).rejects.toThrow(BadRequestException);
    });

    it('chặn dòng của người mua khác (403), dòng đã duyệt hoặc đã nằm trong đơn khác (409)', async () => {
      prisma.purchaseProposalItem.findMany.mockResolvedValueOnce([
        pendingItem({ material: { code: 'X', name: 'X', unit: 'c', buyerId: 'buyer-2' } }),
      ]);
      await expect(
        service.create({ supplierId: '7', itemIds: ['400'] }, 'buyer-1', ['PURCHASER']),
      ).rejects.toThrow(ForbiddenException);

      prisma.purchaseProposalItem.findMany.mockResolvedValueOnce([
        pendingItem({ status: PurchaseProposalStatus.PURCHASING }),
      ]);
      await expect(
        service.create({ supplierId: '7', itemIds: ['400'] }, 'buyer-1', ['PURCHASER']),
      ).rejects.toThrow(ConflictException);

      prisma.purchaseProposalItem.findMany.mockResolvedValueOnce([
        pendingItem({ supplierOrderId: 88n }),
      ]);
      await expect(
        service.create({ supplierId: '7', itemIds: ['400'] }, 'buyer-1', ['PURCHASER']),
      ).rejects.toThrow(ConflictException);
      expect(prisma.supplierOrder.create).not.toHaveBeenCalled();
    });

    it('409 nếu dòng vừa bị thao tác khác xử lý giữa lúc kiểm và lúc ghi (cả đơn rollback)', async () => {
      prisma.purchaseProposalItem.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(
        service.create({ supplierId: '7', itemIds: ['400'] }, 'buyer-1', ['PURCHASER']),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('approve', () => {
    it('duyệt đúng các dòng của đơn qua bossApprove() theo từng đề xuất, rồi đánh dấu đơn APPROVED', async () => {
      prisma.supplierOrder.findUnique.mockResolvedValue(
        order({
          items: [
            pendingItem({ id: 400n, proposalId: 300n }),
            pendingItem({ id: 401n, proposalId: 301n }),
            pendingItem({ id: 402n, proposalId: 300n }),
          ],
        }),
      );

      await service.approve('90', 'https://file/ky.pdf', 'buyer-1', ['PURCHASER']);

      expect(proposals.bossApprove).toHaveBeenCalledWith(
        '300',
        'buyer-1',
        ['PURCHASER'],
        { approvalFileUrl: 'https://file/ky.pdf' },
        [400n, 402n],
      );
      expect(proposals.bossApprove).toHaveBeenCalledWith(
        '301',
        'buyer-1',
        ['PURCHASER'],
        { approvalFileUrl: 'https://file/ky.pdf' },
        [401n],
      );
      expect(prisma.supplierOrder.updateMany).toHaveBeenCalledWith({
        where: { id: 90n, status: SupplierOrderStatus.DRAFT },
        data: expect.objectContaining({
          status: SupplierOrderStatus.APPROVED,
          approvalFileUrl: 'https://file/ky.pdf',
        }) as unknown,
      });
    });

    it('không duyệt lại đơn đã duyệt hoặc đã huỷ; người mua khác không duyệt hộ được', async () => {
      prisma.supplierOrder.findUnique.mockResolvedValueOnce(
        order({ status: SupplierOrderStatus.APPROVED }),
      );
      await expect(service.approve('90', 'https://f', 'buyer-1', ['PURCHASER'])).rejects.toThrow(
        ConflictException,
      );

      await expect(service.approve('90', 'https://f', 'buyer-2', ['PURCHASER'])).rejects.toThrow(
        ForbiddenException,
      );
      expect(proposals.bossApprove).not.toHaveBeenCalled();
    });
  });

  describe('removeItem / cancel', () => {
    it('gỡ dòng cuối cùng thì đơn tự huỷ, số đơn giữ nguyên', async () => {
      await service.removeItem('90', '400', 'buyer-1', ['PURCHASER']);

      expect(prisma.purchaseProposalItem.update).toHaveBeenCalledWith({
        where: { id: 400n },
        data: { supplierOrderId: null },
      });
      expect(prisma.supplierOrder.update).toHaveBeenCalledWith({
        where: { id: 90n },
        data: expect.objectContaining({ status: SupplierOrderStatus.CANCELLED }) as unknown,
      });
    });

    it('huỷ đơn: các dòng quay về chờ gom đơn', async () => {
      await service.cancel('90', 'Đổi NCC', 'buyer-1', ['PURCHASER']);

      expect(prisma.purchaseProposalItem.updateMany).toHaveBeenCalledWith({
        where: { supplierOrderId: 90n },
        data: { supplierOrderId: null },
      });
      expect(prisma.supplierOrder.update).toHaveBeenCalledWith({
        where: { id: 90n },
        data: expect.objectContaining({
          status: SupplierOrderStatus.CANCELLED,
          cancelReason: 'Đổi NCC',
        }) as unknown,
      });
    });

    it('409 nếu đơn vừa được duyệt ở nơi khác lúc đang khoá', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ status: SupplierOrderStatus.APPROVED }]);
      await expect(service.cancel('90', 'x', 'buyer-1', ['PURCHASER'])).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('setCounter (bản v8 mục 4.13 - nạp số cuối năm)', () => {
    it('nạp số đơn cuối cùng của NCC trong năm', async () => {
      prisma.supplier.findMany.mockResolvedValue([supplier]);
      prisma.supplierOrderCounter.findMany.mockResolvedValue([
        { supplierId: 7n, year: 2026, lastSeq: 52 },
      ]);

      const res = await service.setCounter('7', 2026, 52);

      expect(prisma.supplierOrderCounter.upsert).toHaveBeenCalledWith({
        where: { supplierId_year: { supplierId: 7n, year: 2026 } },
        create: { supplierId: 7n, year: 2026, lastSeq: 52 },
        update: { lastSeq: 52 },
      });
      expect(res).toMatchObject({ supplierName: 'Kim Phát', lastSeq: 52 });
    });

    it('không cho nạp thấp hơn số hệ thống đã cấp', async () => {
      prisma.supplierOrder.aggregate.mockResolvedValueOnce({ _max: { seq: 60 } });
      await expect(service.setCounter('7', 2026, 52)).rejects.toThrow(BadRequestException);
      expect(prisma.supplierOrderCounter.upsert).not.toHaveBeenCalled();
    });
  });

  describe('revise - THAY PHIẾU (bản v8 mục 7.2, 7.11)', () => {
    const approved = (items: unknown[]) =>
      order({ status: SupplierOrderStatus.APPROVED, approvalFileUrl: 'https://f/old.pdf', items });

    it('đơn đã ký về DRAFT, revision + 1; chỉ dòng chưa nhận quay về chờ duyệt', async () => {
      prisma.supplierOrder.findUnique.mockResolvedValue(
        approved([
          pendingItem({ id: 400n, status: PurchaseProposalStatus.PURCHASING }),
          pendingItem({
            id: 401n,
            status: PurchaseProposalStatus.PURCHASING,
            receivedQty: decimal(2),
          }),
        ]),
      );
      prisma.purchaseProposalItem.findMany.mockResolvedValue([
        { status: PurchaseProposalStatus.NEW },
        { status: PurchaseProposalStatus.PURCHASING },
      ]);

      await service.revise('90', 'Bỏ bớt 1 dòng', 'buyer-1', ['PURCHASER']);

      expect(prisma.supplierOrder.updateMany).toHaveBeenCalledWith({
        where: { id: 90n, status: SupplierOrderStatus.APPROVED },
        data: expect.objectContaining({
          status: SupplierOrderStatus.DRAFT,
          revision: { increment: 1 },
          reviseReason: 'Bỏ bớt 1 dòng',
          approvalFileUrl: null,
        }) as unknown,
      });
      expect(prisma.purchaseProposalItem.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [400n] }, status: PurchaseProposalStatus.PURCHASING, receivedQty: 0 },
        data: expect.objectContaining({
          status: PurchaseProposalStatus.NEW,
          approvalFileUrl: null,
        }) as unknown,
      });
    });

    it('đơn chưa ký thì không cần thay phiếu; mọi dòng đã nhận thì không còn gì để thay', async () => {
      await expect(service.revise('90', 'x', 'buyer-1', ['PURCHASER'])).rejects.toThrow(
        ConflictException,
      );

      prisma.supplierOrder.findUnique.mockResolvedValueOnce(
        approved([
          pendingItem({ status: PurchaseProposalStatus.PURCHASING, receivedQty: decimal(6) }),
        ]),
      );
      await expect(service.revise('90', 'x', 'buyer-1', ['PURCHASER'])).rejects.toThrow(
        ConflictException,
      );
    });

    it('sau thay phiếu: dòng đã nhận một phần không gỡ được, không huỷ được cả đơn', async () => {
      prisma.supplierOrder.findUnique.mockResolvedValue(
        order({
          revision: 1,
          items: [
            pendingItem({ id: 400n }),
            pendingItem({
              id: 401n,
              status: PurchaseProposalStatus.PURCHASING,
              receivedQty: decimal(2),
            }),
          ],
        }),
      );

      await expect(service.removeItem('90', '401', 'buyer-1', ['PURCHASER'])).rejects.toThrow(
        ConflictException,
      );
      await expect(service.cancel('90', 'x', 'buyer-1', ['PURCHASER'])).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.purchaseProposalItem.update).not.toHaveBeenCalled();
    });
  });

  describe('print', () => {
    it('trả file .xlsx (base64) đặt tên theo NCC + số đơn', async () => {
      const res = await service.print('90');

      expect(res.fileName).toBe('phieu-de-xuat-Kim Phát-53-2026.xlsx');
      expect(Buffer.from(res.base64, 'base64').subarray(0, 2).toString()).toBe('PK');
    });

    it('không in đơn đã huỷ', async () => {
      prisma.supplierOrder.findUnique.mockResolvedValueOnce(
        order({ status: SupplierOrderStatus.CANCELLED }),
      );
      await expect(service.print('90')).rejects.toThrow(ConflictException);
    });
  });
});
