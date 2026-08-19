import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AccessoryItemKind, StockLedgerRefType } from '../../generated/prisma/client';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { PackagingIssuesService } from './packaging-issues.service';

describe('PackagingIssuesService', () => {
  let service: PackagingIssuesService;
  let stockLedgerService: { postEntry: jest.Mock };
  let prisma: {
    packagingIssue: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      aggregate: jest.Mock;
    };
    productionOrder: { findUnique: jest.Mock; findMany: jest.Mock };
    bomAccessoryItem: { findUnique: jest.Mock; findMany: jest.Mock };
    warehouse: { findUniqueOrThrow: jest.Mock };
  };

  const order = {
    id: 1n,
    poNumber: 'PO-31-1',
    bomRevisionId: 5n,
    quantity: 10,
    mfgProduct: { name: 'Ghế xoay demo' },
    productionInvoiceItem: { salesOrder: { code: 'PO-31' } },
  };
  const material = { id: 30n, code: 'TEM-01', name: 'Tem nhãn sản phẩm', unit: 'tờ' };
  const accessoryRow = {
    id: 1n,
    bomRevisionId: 5n,
    materialId: 30n,
    kind: AccessoryItemKind.PACKAGING,
    qtyPerUnit: { toNumber: () => 3 }, // plannedQty = 3*10 = 30
  };
  const vatTuTp = { id: 2n, code: 'vat-tu-tp', name: 'Kho Vật tư thành phẩm' };
  const thanhPham = { id: 6n, code: 'thanh-pham', name: 'Kho Thành phẩm' };

  const issueRow = {
    id: 100n,
    productionOrderId: 1n,
    materialId: 30n,
    issuedQty: { toNumber: () => 5 },
    idempotencyKey: null,
    issuedAt: new Date(),
    issuedById: 'user-1',
    note: null,
    productionOrder: order,
    material,
  };

  beforeEach(() => {
    prisma = {
      packagingIssue: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _sum: { issuedQty: null } }),
      },
      productionOrder: {
        findUnique: jest.fn().mockResolvedValue(order),
        findMany: jest.fn().mockResolvedValue([order]),
      },
      bomAccessoryItem: {
        findUnique: jest.fn().mockResolvedValue(accessoryRow),
        findMany: jest.fn().mockResolvedValue([{ ...accessoryRow, material }]),
      },
      warehouse: {
        findUniqueOrThrow: jest
          .fn()
          .mockImplementation(({ where }: { where: { code: string } }) =>
            Promise.resolve(where.code === 'vat-tu-tp' ? vatTuTp : thanhPham),
          ),
      },
    };
    stockLedgerService = { postEntry: jest.fn().mockResolvedValue(undefined) };
    service = new PackagingIssuesService(
      prisma as unknown as PrismaServiceType,
      stockLedgerService as unknown as StockLedgerService,
    );
  });

  describe('create', () => {
    const dto = { materialId: '30', issuedQty: 5 };

    it('happy path - tạo đợt xuất mới + ghi StockLedger vat-tu-tp -> thanh-pham', async () => {
      prisma.packagingIssue.create.mockResolvedValue(issueRow);

      const result = await service.create('1', dto, 'user-1', null);

      expect(prisma.packagingIssue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({
            productionOrderId: 1n,
            materialId: 30n,
            issuedQty: 5,
          }),
        }),
      );
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          fromWarehouseId: 2n,
          toWarehouseId: 6n,
          materialId: 30n,
          qty: 5,
          refType: StockLedgerRefType.PACKAGING_ISSUE,
          refId: '100',
          idempotencyKey: 'packaging-issue:100',
        }),
      );
      expect(result.id).toBe('100');
    });

    it('idempotency short-circuit - trả về đợt cũ, không tạo mới, vẫn đảm bảo ledger đã ghi', async () => {
      prisma.packagingIssue.findUnique.mockResolvedValue(issueRow);

      const result = await service.create('1', dto, 'user-1', null, 'idem-key-1');

      expect(prisma.packagingIssue.create).not.toHaveBeenCalled();
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: 'packaging-issue:100' }),
      );
      expect(result.id).toBe('100');
    });

    it('chặn caller bị giới hạn ở kho khác kho vật tư-TP', async () => {
      await expect(service.create('1', dto, 'user-1', 'thanh-pham')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.packagingIssue.create).not.toHaveBeenCalled();
    });

    it('cho phép caller không có warehouseScope (tổng kho)', async () => {
      prisma.packagingIssue.create.mockResolvedValue(issueRow);
      await expect(service.create('1', dto, 'user-1', null)).resolves.toBeDefined();
    });

    it('ném NotFoundException khi production order không tồn tại', async () => {
      prisma.productionOrder.findUnique.mockResolvedValue(null);
      await expect(service.create('1', dto, 'user-1', null)).rejects.toThrow(NotFoundException);
    });

    it('ném NotFoundException khi không có BomAccessoryItem cho vật tư này', async () => {
      prisma.bomAccessoryItem.findUnique.mockResolvedValue(null);
      await expect(service.create('1', dto, 'user-1', null)).rejects.toThrow(NotFoundException);
    });

    it('ném NotFoundException khi item tồn tại nhưng kind=ACCESSORY (không phải PACKAGING)', async () => {
      prisma.bomAccessoryItem.findUnique.mockResolvedValue({
        ...accessoryRow,
        kind: AccessoryItemKind.ACCESSORY,
      });
      await expect(service.create('1', dto, 'user-1', null)).rejects.toThrow(NotFoundException);
    });

    it('ném BadRequestException khi vượt quá số lượng còn có thể xuất', async () => {
      // plannedQty = 30, chưa xuất gì -> remaining = 30
      await expect(service.create('1', { ...dto, issuedQty: 31 }, 'user-1', null)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('cho phép xuất đúng bằng remaining (biên)', async () => {
      prisma.packagingIssue.create.mockResolvedValue(issueRow);
      await expect(
        service.create('1', { ...dto, issuedQty: 30 }, 'user-1', null),
      ).resolves.toBeDefined();
    });

    it('cộng dồn đã xuất từ các đợt trước khi tính remaining', async () => {
      // đã xuất 27 -> remaining = 30 - 27 = 3
      prisma.packagingIssue.aggregate.mockResolvedValue({
        _sum: { issuedQty: { toNumber: () => 27 } },
      });

      await expect(service.create('1', { ...dto, issuedQty: 4 }, 'user-1', null)).rejects.toThrow(
        BadRequestException,
      );

      prisma.packagingIssue.create.mockResolvedValue(issueRow);
      await expect(
        service.create('1', { ...dto, issuedQty: 3 }, 'user-1', null),
      ).resolves.toBeDefined();
    });
  });

  describe('getBulkPlan', () => {
    it('ném BadRequestException khi không truyền productionOrderId nào', async () => {
      await expect(service.getBulkPlan([])).rejects.toThrow(BadRequestException);
    });

    it('chưa xuất gì vẫn trả về 1 dòng với remainingToIssue = requiredQty', async () => {
      const result = await service.getBulkPlan(['1']);
      expect(result).toHaveLength(1);
      expect(result[0].productionOrderId).toBe('1');
      expect(result[0].poNumber).toBe('PO-31-1');
      expect(result[0].salesOrderCode).toBe('PO-31');
      expect(result[0].productName).toBe('Ghế xoay demo');
      expect(result[0].requiredQty).toBe(30);
      expect(result[0].issuedQty).toBe(0);
      expect(result[0].remainingToIssue).toBe(30);
    });

    it('tính đúng issuedQty cộng dồn nhiều đợt cùng (PO, material)', async () => {
      prisma.packagingIssue.findMany.mockResolvedValue([
        { productionOrderId: 1n, materialId: 30n, issuedQty: { toNumber: () => 5 } },
        { productionOrderId: 1n, materialId: 30n, issuedQty: { toNumber: () => 8 } },
      ]);

      const result = await service.getBulkPlan(['1']);
      expect(result[0].issuedQty).toBe(13);
      expect(result[0].remainingToIssue).toBe(17);
    });

    it('gộp đúng nhiều PO khác nhau, không lẫn định mức/đã xuất', async () => {
      const order2 = { ...order, id: 2n, poNumber: 'PO-32-1', bomRevisionId: 7n, quantity: 4 };
      const accessoryRow2 = { ...accessoryRow, bomRevisionId: 7n, material };
      prisma.productionOrder.findMany.mockResolvedValue([order, order2]);
      prisma.bomAccessoryItem.findMany.mockResolvedValue([
        { ...accessoryRow, material },
        accessoryRow2,
      ]);
      prisma.packagingIssue.findMany.mockResolvedValue([
        { productionOrderId: 1n, materialId: 30n, issuedQty: { toNumber: () => 10 } },
      ]);

      const result = await service.getBulkPlan(['1', '2']);
      expect(result).toHaveLength(2);
      const row1 = result.find((r) => r.productionOrderId === '1')!;
      const row2 = result.find((r) => r.productionOrderId === '2')!;
      expect(row1.requiredQty).toBe(30);
      expect(row1.issuedQty).toBe(10);
      expect(row2.requiredQty).toBe(12); // 3 * 4
      expect(row2.issuedQty).toBe(0);
    });
  });
});
