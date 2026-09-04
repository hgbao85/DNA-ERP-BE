import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MaterialYieldIssueStatus, StockLedgerRefType } from '../../generated/prisma/client';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { MaterialYieldIssuesService } from './material-yield-issues.service';

describe('MaterialYieldIssuesService', () => {
  let service: MaterialYieldIssuesService;
  let stockLedgerService: { postEntry: jest.Mock };
  let prisma: {
    materialYieldIssue: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      aggregate: jest.Mock;
    };
    productionOrder: { findUnique: jest.Mock; findFirst: jest.Mock };
    productionInvoiceItem: { findUniqueOrThrow: jest.Mock };
    material: { findUnique: jest.Mock };
    pieceMaterialYield: { findMany: jest.Mock };
    bomPiece: { findMany: jest.Mock };
    warehouse: { findUniqueOrThrow: jest.Mock };
    $executeRaw: jest.Mock;
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };

  const order = {
    id: 1n,
    poNumber: 'PO-31-1',
    bomRevisionId: 5n,
    quantity: 10,
    productionInvoiceItemId: 20n,
    productionInvoiceItem: { salesOrder: { code: 'PO-31' } },
  };
  const aluminumWarehouse = { id: 5n, code: 'vat-tu-tp' };
  const productionWarehouse = { id: 9n, code: 'PRODUCTION' };
  const material = {
    id: 80n,
    code: 'VTTP-001',
    name: 'Thanh nhôm 2m',
    warehouseId: 5n,
    warehouse: aluminumWarehouse,
  };
  // piece 40: qtyPerUnit=2 -> plannedQty = 2*10 = 20; yieldRow qtyPerPiece=3, piecesPerBar=12
  // -> required = ceil(20*3/12) = 5.
  const bomPieceRow = { id: 1n, bomRevisionId: 5n, pieceId: 40n, qtyPerUnit: 2 };
  const yieldRow = {
    bomRevisionId: 5n,
    pieceId: 40n,
    materialId: 80n,
    piecesPerBar: 12,
    qtyPerPiece: 3,
    material,
  };

  const issueRow = {
    id: 100n,
    productionOrderId: 1n,
    materialId: 80n,
    issuedQty: { toNumber: () => 5 },
    status: MaterialYieldIssueStatus.ISSUED,
    idempotencyKey: null,
    issuedAt: new Date(),
    issuedById: 'user-1',
    receivedQty: null,
    receivedAt: null,
    receivedById: null,
    productionOrder: order,
    material,
  };

  beforeEach(() => {
    prisma = {
      materialYieldIssue: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _sum: { issuedQty: null, receivedQty: null } }),
      },
      productionOrder: {
        findUnique: jest.fn().mockResolvedValue(order),
        findFirst: jest.fn().mockResolvedValue({ id: 9n }),
      },
      productionInvoiceItem: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ productionInvoiceId: 500n }),
      },
      material: { findUnique: jest.fn().mockResolvedValue(material) },
      pieceMaterialYield: { findMany: jest.fn().mockResolvedValue([yieldRow]) },
      bomPiece: { findMany: jest.fn().mockResolvedValue([bomPieceRow]) },
      warehouse: {
        findUniqueOrThrow: jest
          .fn()
          .mockImplementation(({ where }: { where: { code: string } }) =>
            Promise.resolve(where.code === 'vat-tu-tp' ? aluminumWarehouse : productionWarehouse),
          ),
      },
      $executeRaw: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn(() => Promise.resolve([{ floorStage: 'ACTIVE' }])),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(prisma))),
    };
    stockLedgerService = { postEntry: jest.fn().mockResolvedValue(undefined) };
    service = new MaterialYieldIssuesService(
      prisma as unknown as PrismaServiceType,
      stockLedgerService as unknown as StockLedgerService,
    );
  });

  describe('create', () => {
    const dto = { materialId: '80', issuedQty: 5 };

    it('happy path - tạo đợt xuất mới + ghi StockLedger từ Material.warehouseId', async () => {
      prisma.materialYieldIssue.create.mockResolvedValue(issueRow);

      const result = await service.create('1', dto, 'user-1', null);

      expect(prisma.materialYieldIssue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({
            productionOrderId: 1n,
            materialId: 80n,
            issuedQty: 5,
          }),
        }),
      );
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          fromWarehouseId: 5n, // material.warehouseId - KHÔNG phải hằng số cố định
          toWarehouseId: 9n,
          materialId: 80n,
          qty: 5,
          refType: StockLedgerRefType.MATERIAL_YIELD_CONSUME,
          refId: '100',
          idempotencyKey: 'material-yield-issue:100',
        }),
      );
      expect(result.id).toBe('100');
    });

    it('idempotency short-circuit - trả về đợt cũ, không tạo mới, VẪN gọi lại postLedgerEntry (retry-safety)', async () => {
      prisma.materialYieldIssue.findUnique.mockResolvedValue(issueRow);

      const result = await service.create('1', dto, 'user-1', null, 'idem-key-1');

      expect(prisma.materialYieldIssue.create).not.toHaveBeenCalled();
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: 'material-yield-issue:100' }),
      );
      expect(result.id).toBe('100');
    });

    it('ném BadRequestException khi material chưa gán warehouseId', async () => {
      prisma.material.findUnique.mockResolvedValue({
        ...material,
        warehouseId: null,
        warehouse: null,
      });
      await expect(service.create('1', dto, 'user-1', null)).rejects.toThrow(BadRequestException);
      expect(prisma.materialYieldIssue.create).not.toHaveBeenCalled();
    });

    it('chặn caller bị giới hạn ở kho khác kho của material', async () => {
      await expect(service.create('1', dto, 'user-1', 'thanh-pham')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.materialYieldIssue.create).not.toHaveBeenCalled();
    });

    it('cho phép caller không có warehouseScope (tổng kho)', async () => {
      prisma.materialYieldIssue.create.mockResolvedValue(issueRow);
      await expect(service.create('1', dto, 'user-1', null)).resolves.toBeDefined();
    });

    it('ném NotFoundException khi production order không tồn tại', async () => {
      prisma.productionOrder.findUnique.mockResolvedValue(null);
      await expect(service.create('1', dto, 'user-1', null)).rejects.toThrow(NotFoundException);
    });

    it('ném NotFoundException khi vật tư không tồn tại', async () => {
      prisma.material.findUnique.mockResolvedValue(null);
      await expect(service.create('1', dto, 'user-1', null)).rejects.toThrow(NotFoundException);
    });

    it('ném NotFoundException khi material không thuộc PieceMaterialYield nào của revision này', async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([]);
      await expect(service.create('1', dto, 'user-1', null)).rejects.toThrow(NotFoundException);
    });

    it('ném BadRequestException khi vượt quá số lượng còn có thể xuất (required=5)', async () => {
      await expect(service.create('1', { ...dto, issuedQty: 6 }, 'user-1', null)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.materialYieldIssue.create).not.toHaveBeenCalled();
    });

    it('cho phép xuất đúng bằng remaining (biên)', async () => {
      prisma.materialYieldIssue.create.mockResolvedValue(issueRow);
      await expect(
        service.create('1', { ...dto, issuedQty: 5 }, 'user-1', null),
      ).resolves.toBeDefined();
    });

    it('cộng dồn đã xuất từ các đợt trước khi tính remaining', async () => {
      prisma.materialYieldIssue.aggregate.mockResolvedValue({
        _sum: { issuedQty: { toNumber: () => 3 }, receivedQty: null },
      });

      await expect(service.create('1', { ...dto, issuedQty: 3 }, 'user-1', null)).rejects.toThrow(
        BadRequestException,
      );

      prisma.materialYieldIssue.create.mockResolvedValue(issueRow);
      await expect(
        service.create('1', { ...dto, issuedQty: 2 }, 'user-1', null),
      ).resolves.toBeDefined();
    });

    it('gộp required qua NHIỀU piece cùng dùng 1 material trong cùng order', async () => {
      const yieldRow2 = { ...yieldRow, pieceId: 41n, qtyPerPiece: 1, piecesPerBar: 4 };
      const bomPieceRow2 = { ...bomPieceRow, pieceId: 41n, qtyPerUnit: 1 };
      // piece 40: ceil(20*3/12)=5; piece 41: plannedQty=1*10=10, ceil(10*1/4)=3 -> total=8
      prisma.pieceMaterialYield.findMany.mockResolvedValue([yieldRow, yieldRow2]);
      prisma.bomPiece.findMany.mockResolvedValue([bomPieceRow, bomPieceRow2]);

      await expect(service.create('1', { ...dto, issuedQty: 9 }, 'user-1', null)).rejects.toThrow(
        BadRequestException,
      );
      prisma.materialYieldIssue.create.mockResolvedValue(issueRow);
      await expect(
        service.create('1', { ...dto, issuedQty: 8 }, 'user-1', null),
      ).resolves.toBeDefined();
    });

    it('khoá advisory theo (order, material) TRONG transaction trước khi đọc remaining', async () => {
      prisma.materialYieldIssue.create.mockResolvedValue(issueRow);
      await service.create('1', dto, 'user-1', null);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.$executeRaw).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest mock.calls typing
      const rawCall = prisma.$executeRaw.mock.calls[0][0] as TemplateStringsArray;
      expect(rawCall.join('')).toContain('pg_advisory_xact_lock');
    });

    it('ném ConflictException khi PI chưa có SKU nào ACTIVE (QLSX "Bắt đầu" gate)', async () => {
      prisma.productionOrder.findFirst.mockResolvedValue(null);
      await expect(service.create('1', dto, 'user-1', null)).rejects.toThrow(ConflictException);
      expect(prisma.materialYieldIssue.create).not.toHaveBeenCalled();
    });
  });

  describe('receive', () => {
    beforeEach(() => {
      prisma.materialYieldIssue.findUnique.mockResolvedValue(issueRow);
    });

    it('happy path - mfgRole null (quản lý) xác nhận nhận đủ như xuất', async () => {
      prisma.materialYieldIssue.update.mockResolvedValue({
        ...issueRow,
        status: MaterialYieldIssueStatus.RECEIVED,
        receivedQty: { toNumber: () => 5 },
        receivedAt: new Date(),
        receivedById: 'user-2',
      });

      const result = await service.receive('100', {}, 'user-2', null);

      expect(prisma.materialYieldIssue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({
            status: MaterialYieldIssueStatus.RECEIVED,
            receivedQty: 5,
            receivedById: 'user-2',
          }),
        }),
      );
      expect(result.status).toBe(MaterialYieldIssueStatus.RECEIVED);
    });

    it('cho phép mfgRole=PHOI', async () => {
      prisma.materialYieldIssue.update.mockResolvedValue(issueRow);
      await expect(service.receive('100', {}, 'user-2', 'PHOI')).resolves.toBeDefined();
    });

    it('ném ForbiddenException khi mfgRole khác PHOI (vd HAN)', async () => {
      await expect(service.receive('100', {}, 'user-2', 'HAN')).rejects.toThrow(ForbiddenException);
      expect(prisma.materialYieldIssue.update).not.toHaveBeenCalled();
    });

    it('ném ConflictException khi đợt không còn ở trạng thái ISSUED', async () => {
      prisma.materialYieldIssue.findUnique.mockResolvedValue({
        ...issueRow,
        status: MaterialYieldIssueStatus.RECEIVED,
      });
      await expect(service.receive('100', {}, 'user-2', null)).rejects.toThrow(ConflictException);
    });

    it('nhận thiếu (receivedQty < issuedQty) - hợp lệ', async () => {
      prisma.materialYieldIssue.update.mockResolvedValue(issueRow);
      await expect(
        service.receive('100', { receivedQty: 3 }, 'user-2', null),
      ).resolves.toBeDefined();
      expect(prisma.materialYieldIssue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({ receivedQty: 3 }),
        }),
      );
    });

    it('ném BadRequestException khi receivedQty vượt quá issuedQty', async () => {
      await expect(service.receive('100', { receivedQty: 6 }, 'user-2', null)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.materialYieldIssue.update).not.toHaveBeenCalled();
    });

    it('ném ConflictException khi PI đã bị QLSX "Tạm dừng"/"Kết thúc"', async () => {
      prisma.productionOrder.findFirst.mockResolvedValue(null);
      await expect(service.receive('100', {}, 'user-2', null)).rejects.toThrow(ConflictException);
      expect(prisma.materialYieldIssue.update).not.toHaveBeenCalled();
    });
  });

  describe('getIssuePlan', () => {
    it('chưa xuất gì vẫn trả về 1 dòng với remainingToIssue = requiredQty (5)', async () => {
      const result = await service.getIssuePlan('1');
      expect(result).toHaveLength(1);
      expect(result[0].requiredQty).toBe(5);
      expect(result[0].issuedQty).toBe(0);
      expect(result[0].remainingToIssue).toBe(5);
    });

    it('tính đúng issuedQty cộng dồn nhiều đợt cùng material', async () => {
      prisma.materialYieldIssue.findMany.mockResolvedValue([
        { materialId: 80n, issuedQty: { toNumber: () => 2 } },
        { materialId: 80n, issuedQty: { toNumber: () => 1 } },
      ]);
      const result = await service.getIssuePlan('1');
      expect(result[0].issuedQty).toBe(3);
      expect(result[0].remainingToIssue).toBe(2);
    });

    it('không có PieceMaterialYield nào cho revision - trả mảng rỗng', async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([]);
      const result = await service.getIssuePlan('1');
      expect(result).toEqual([]);
    });

    it('gộp required qua NHIỀU piece cùng dùng 1 material (5 + 3 = 8)', async () => {
      const yieldRow2 = { ...yieldRow, pieceId: 41n, qtyPerPiece: 1, piecesPerBar: 4 };
      const bomPieceRow2 = { ...bomPieceRow, pieceId: 41n, qtyPerUnit: 1 };
      prisma.pieceMaterialYield.findMany.mockResolvedValue([yieldRow, yieldRow2]);
      prisma.bomPiece.findMany.mockResolvedValue([bomPieceRow, bomPieceRow2]);

      const result = await service.getIssuePlan('1');
      expect(result).toHaveLength(1);
      expect(result[0].requiredQty).toBe(8);
    });
  });

  describe('sumReceived', () => {
    it('trả về 0 khi chưa có đợt RECEIVED nào', async () => {
      const result = await service.sumReceived(1n, 80n);
      expect(result).toBe(0);
      expect(prisma.materialYieldIssue.aggregate).toHaveBeenCalledWith({
        where: {
          productionOrderId: 1n,
          materialId: 80n,
          status: MaterialYieldIssueStatus.RECEIVED,
        },
        _sum: { receivedQty: true },
      });
    });

    it('trả về Σ receivedQty khi có đợt RECEIVED', async () => {
      prisma.materialYieldIssue.aggregate.mockResolvedValue({
        _sum: { receivedQty: { toNumber: () => 4 } },
      });
      const result = await service.sumReceived(1n, 80n);
      expect(result).toBe(4);
    });
  });
});
