import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { WeavingIssuesService } from './weaving-issues.service';

describe('WeavingIssuesService', () => {
  let service: WeavingIssuesService;
  let prisma: {
    weavingIssue: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      aggregate: jest.Mock;
    };
    weavingReceipt: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      aggregate: jest.Mock;
    };
    productionOrder: { findUnique: jest.Mock };
    piece: { findUnique: jest.Mock };
    weavingPoint: { findUnique: jest.Mock; findMany: jest.Mock };
    bomPiece: { findUnique: jest.Mock; findMany: jest.Mock };
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
  };

  const order = {
    id: 1n,
    poNumber: 'PO-31-1',
    bomRevisionId: 5n,
    quantity: 10,
    productionInvoiceItem: { salesOrder: { code: 'PO-31' } },
    mfgProduct: { name: 'Ghế xoay demo' },
  };
  const piece = { id: 20n, code: 'MANH-DAN', name: 'Mảnh Đan', isWoven: true };
  const weavingPoint = { id: 40n, code: 'DIEM-A', fullName: 'Điểm đan A', isActive: true };
  // isWoven ở đây là SNAPSHOT trên BomPiece (theo đúng bomRevisionId), không phải piece.isWoven
  // (global) - xem findBomPieceOrThrow/getIssuePlan.
  const bomPieceRow = { id: 1n, bomRevisionId: 5n, pieceId: 20n, qtyPerUnit: 4, isWoven: true }; // plannedQty = 4*10 = 40

  const issueRow = {
    id: 100n,
    productionOrderId: 1n,
    pieceId: 20n,
    weavingPointId: 40n,
    qty: 10,
    idempotencyKey: null,
    issuedAt: new Date(),
    issuedById: 'user-1',
    productionOrder: order,
    piece,
    weavingPoint,
  };

  const receiptRow = {
    id: 200n,
    productionOrderId: 1n,
    pieceId: 20n,
    weavingPointId: 40n,
    qty: 5,
    idempotencyKey: null,
    receivedAt: new Date(),
    receivedById: 'user-1',
    productionOrder: order,
    piece,
    weavingPoint,
  };

  beforeEach(() => {
    prisma = {
      weavingIssue: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _sum: { qty: null } }),
      },
      weavingReceipt: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _sum: { qty: null } }),
      },
      productionOrder: { findUnique: jest.fn().mockResolvedValue(order) },
      piece: { findUnique: jest.fn().mockResolvedValue(piece) },
      weavingPoint: {
        findUnique: jest.fn().mockResolvedValue(weavingPoint),
        findMany: jest.fn().mockResolvedValue([weavingPoint]),
      },
      bomPiece: {
        findUnique: jest.fn().mockResolvedValue(bomPieceRow),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(prisma))),
    };
    service = new WeavingIssuesService(prisma as unknown as PrismaServiceType);
  });

  describe('create', () => {
    it('happy path - tạo đợt xuất đan mới', async () => {
      prisma.weavingIssue.create.mockResolvedValue(issueRow);

      const result = await service.create(
        '1',
        { pieceId: '20', weavingPointId: '40', qty: 10 },
        'user-1',
        null,
      );

      expect(prisma.weavingIssue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({
            productionOrderId: 1n,
            pieceId: 20n,
            weavingPointId: 40n,
            qty: 10,
          }),
        }),
      );
      expect(result.id).toBe('100');
    });

    it('idempotency short-circuit - trả về đợt cũ, không tạo mới', async () => {
      prisma.weavingIssue.findUnique.mockResolvedValue(issueRow);

      const result = await service.create(
        '1',
        { pieceId: '20', weavingPointId: '40', qty: 10 },
        'user-1',
        null,
        'idem-key-1',
      );

      expect(prisma.weavingIssue.create).not.toHaveBeenCalled();
      expect(result.id).toBe('100');
    });

    it('chặn caller bị giới hạn ở kho khác kho vật tư-TP', async () => {
      await expect(
        service.create(
          '1',
          { pieceId: '20', weavingPointId: '40', qty: 10 },
          'user-1',
          'thanh-pham',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.weavingIssue.create).not.toHaveBeenCalled();
    });

    it('cho phép caller không có warehouseScope (tổng kho)', async () => {
      prisma.weavingIssue.create.mockResolvedValue(issueRow);
      await expect(
        service.create('1', { pieceId: '20', weavingPointId: '40', qty: 10 }, 'user-1', null),
      ).resolves.toBeDefined();
    });

    it('ném NotFoundException khi production order không tồn tại', async () => {
      prisma.productionOrder.findUnique.mockResolvedValue(null);
      await expect(
        service.create('1', { pieceId: '20', weavingPointId: '40', qty: 10 }, 'user-1', null),
      ).rejects.toThrow(NotFoundException);
    });

    it('ném NotFoundException khi mảnh không tồn tại', async () => {
      prisma.piece.findUnique.mockResolvedValue(null);
      await expect(
        service.create('1', { pieceId: '20', weavingPointId: '40', qty: 10 }, 'user-1', null),
      ).rejects.toThrow(NotFoundException);
    });

    it('ném BadRequestException khi mảnh không thuộc công đoạn Đan (isWoven=false trên BomPiece của revision này)', async () => {
      prisma.bomPiece.findUnique.mockResolvedValue({ ...bomPieceRow, isWoven: false });
      await expect(
        service.create('1', { pieceId: '20', weavingPointId: '40', qty: 10 }, 'user-1', null),
      ).rejects.toThrow(BadRequestException);
    });

    it('ném NotFoundException khi điểm đan không tồn tại', async () => {
      prisma.weavingPoint.findUnique.mockResolvedValue(null);
      await expect(
        service.create('1', { pieceId: '20', weavingPointId: '40', qty: 10 }, 'user-1', null),
      ).rejects.toThrow(NotFoundException);
    });

    it('ném BadRequestException khi điểm đan đã ngừng hoạt động', async () => {
      prisma.weavingPoint.findUnique.mockResolvedValue({ ...weavingPoint, isActive: false });
      await expect(
        service.create('1', { pieceId: '20', weavingPointId: '40', qty: 10 }, 'user-1', null),
      ).rejects.toThrow(BadRequestException);
    });

    it('ném NotFoundException khi mảnh không thuộc BOM của lệnh sản xuất này', async () => {
      prisma.bomPiece.findUnique.mockResolvedValue(null);
      await expect(
        service.create('1', { pieceId: '20', weavingPointId: '40', qty: 10 }, 'user-1', null),
      ).rejects.toThrow(NotFoundException);
    });

    it('ném BadRequestException khi vượt quá số lượng còn có thể xuất', async () => {
      // plannedQty = 40, chưa xuất gì -> remaining = 40
      await expect(
        service.create('1', { pieceId: '20', weavingPointId: '40', qty: 41 }, 'user-1', null),
      ).rejects.toThrow(BadRequestException);
    });

    it('cho phép xuất đúng bằng remaining (biên)', async () => {
      prisma.weavingIssue.create.mockResolvedValue(issueRow);
      await expect(
        service.create('1', { pieceId: '20', weavingPointId: '40', qty: 40 }, 'user-1', null),
      ).resolves.toBeDefined();
    });

    it('cộng dồn đã xuất từ MỌI điểm đan khác khi tính remaining', async () => {
      // đã xuất 35 (tổng mọi điểm đan) -> remaining = 40 - 35 = 5
      prisma.weavingIssue.aggregate.mockResolvedValue({ _sum: { qty: 35 } });

      await expect(
        service.create('1', { pieceId: '20', weavingPointId: '41', qty: 6 }, 'user-1', null),
      ).rejects.toThrow(BadRequestException);

      prisma.weavingIssue.create.mockResolvedValue(issueRow);
      await expect(
        service.create('1', { pieceId: '20', weavingPointId: '41', qty: 5 }, 'user-1', null),
      ).resolves.toBeDefined();
    });

    it('khoá advisory theo (order, piece) TRONG transaction trước khi đọc remaining (H4 fix - chặn race đọc-rồi-ghi)', async () => {
      prisma.weavingIssue.create.mockResolvedValue(issueRow);

      await service.create('1', { pieceId: '20', weavingPointId: '40', qty: 10 }, 'user-1', null);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.$executeRaw).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest mock.calls typing
      const rawCall = prisma.$executeRaw.mock.calls[0][0] as TemplateStringsArray;
      expect(rawCall.join('')).toContain('pg_advisory_xact_lock');
    });
  });

  describe('receive', () => {
    it('happy path - tạo đợt nhập đan mới', async () => {
      prisma.weavingIssue.aggregate.mockResolvedValue({ _sum: { qty: 10 } });
      prisma.weavingReceipt.create.mockResolvedValue(receiptRow);

      const result = await service.receive(
        '1',
        { pieceId: '20', weavingPointId: '40', qty: 5 },
        'user-1',
        null,
      );

      expect(prisma.weavingReceipt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({
            productionOrderId: 1n,
            pieceId: 20n,
            weavingPointId: 40n,
            qty: 5,
          }),
        }),
      );
      expect(result.id).toBe('200');
    });

    it('idempotency short-circuit - trả về đợt cũ, không tạo mới', async () => {
      prisma.weavingReceipt.findUnique.mockResolvedValue(receiptRow);

      const result = await service.receive(
        '1',
        { pieceId: '20', weavingPointId: '40', qty: 5 },
        'user-1',
        null,
        'idem-key-1',
      );

      expect(prisma.weavingReceipt.create).not.toHaveBeenCalled();
      expect(result.id).toBe('200');
    });

    it('chặn caller bị giới hạn ở kho khác kho vật tư-TP', async () => {
      await expect(
        service.receive(
          '1',
          { pieceId: '20', weavingPointId: '40', qty: 5 },
          'user-1',
          'thanh-pham',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.weavingReceipt.create).not.toHaveBeenCalled();
    });

    it('ném NotFoundException khi production order/mảnh/điểm đan không tồn tại', async () => {
      prisma.productionOrder.findUnique.mockResolvedValue(null);
      await expect(
        service.receive('1', { pieceId: '20', weavingPointId: '40', qty: 5 }, 'user-1', null),
      ).rejects.toThrow(NotFoundException);
    });

    it('ném BadRequestException khi vượt quá số lượng điểm đan còn giữ', async () => {
      // đã xuất 10, đã nhập 8 tại điểm này -> remaining = 2
      prisma.weavingIssue.aggregate.mockResolvedValue({ _sum: { qty: 10 } });
      prisma.weavingReceipt.aggregate.mockResolvedValue({ _sum: { qty: 8 } });

      await expect(
        service.receive('1', { pieceId: '20', weavingPointId: '40', qty: 3 }, 'user-1', null),
      ).rejects.toThrow(BadRequestException);
    });

    it('cho phép nhập đúng bằng remaining-tại-điểm (biên)', async () => {
      prisma.weavingIssue.aggregate.mockResolvedValue({ _sum: { qty: 10 } });
      prisma.weavingReceipt.aggregate.mockResolvedValue({ _sum: { qty: 8 } });
      prisma.weavingReceipt.create.mockResolvedValue(receiptRow);

      await expect(
        service.receive('1', { pieceId: '20', weavingPointId: '40', qty: 2 }, 'user-1', null),
      ).resolves.toBeDefined();
    });

    it('cách ly theo điểm đan - cap luôn tính riêng cho weavingPointId trong dto, không lẫn điểm khác', async () => {
      // Điểm B đã xuất 10, đã nhập đủ 10 (remaining = 0) - phải chặn nhập thêm dù điểm A khác
      // còn dư rất nhiều, vì aggregate luôn được gọi với where.weavingPointId = điểm trong dto.
      prisma.weavingIssue.aggregate.mockResolvedValue({ _sum: { qty: 10 } });
      prisma.weavingReceipt.aggregate.mockResolvedValue({ _sum: { qty: 10 } });

      await expect(
        service.receive('1', { pieceId: '20', weavingPointId: '41', qty: 1 }, 'user-1', null),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.weavingIssue.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          where: expect.objectContaining({ weavingPointId: 41n }),
        }),
      );
      expect(prisma.weavingReceipt.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          where: expect.objectContaining({ weavingPointId: 41n }),
        }),
      );
    });

    it('khoá advisory theo (order, piece, weavingPoint) TRONG transaction trước khi đọc remaining (H4 fix - chặn race đọc-rồi-ghi)', async () => {
      prisma.weavingIssue.aggregate.mockResolvedValue({ _sum: { qty: 10 } });
      prisma.weavingReceipt.create.mockResolvedValue(receiptRow);

      await service.receive('1', { pieceId: '20', weavingPointId: '40', qty: 5 }, 'user-1', null);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.$executeRaw).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest mock.calls typing
      const rawCall = prisma.$executeRaw.mock.calls[0][0] as TemplateStringsArray;
      expect(rawCall.join('')).toContain('pg_advisory_xact_lock');
    });
  });

  describe('getIssuePlan', () => {
    it('loại bỏ mảnh không thuộc công đoạn Đan (isWoven=false trên snapshot BomPiece)', async () => {
      prisma.bomPiece.findMany.mockResolvedValue([{ ...bomPieceRow, isWoven: false, piece }]);

      const result = await service.getIssuePlan('1');
      expect(result).toHaveLength(0);
    });

    it('mảnh có đan nhưng chưa xuất gì vẫn trả về 1 dòng', async () => {
      prisma.bomPiece.findMany.mockResolvedValue([{ ...bomPieceRow, piece }]);

      const result = await service.getIssuePlan('1');
      expect(result).toHaveLength(1);
      expect(result[0].totalQty).toBe(40);
      expect(result[0].issuedQty).toBe(0);
      expect(result[0].remainingToIssue).toBe(40);
      expect(result[0].allocations).toHaveLength(0);
    });

    it('allocations group đúng theo từng điểm đan khi có ≥2 điểm', async () => {
      const pointB = { id: 41n, code: 'DIEM-B', fullName: 'Điểm đan B', isActive: true };
      prisma.bomPiece.findMany.mockResolvedValue([{ ...bomPieceRow, piece }]);
      prisma.weavingIssue.findMany.mockResolvedValue([
        { pieceId: 20n, weavingPointId: 40n, qty: 15, weavingPoint },
        { pieceId: 20n, weavingPointId: 41n, qty: 20, weavingPoint: pointB },
      ]);
      prisma.weavingReceipt.findMany.mockResolvedValue([
        { pieceId: 20n, weavingPointId: 40n, qty: 5, weavingPoint },
      ]);

      const result = await service.getIssuePlan('1');
      expect(result).toHaveLength(1);
      expect(result[0].issuedQty).toBe(35);
      expect(result[0].remainingToIssue).toBe(5);
      expect(result[0].allocations).toHaveLength(2);

      const allocA = result[0].allocations.find((a) => a.weavingPointId === '40');
      expect(allocA?.issuedQty).toBe(15);
      expect(allocA?.receivedQty).toBe(5);
      expect(allocA?.remainingToReceive).toBe(10);

      const allocB = result[0].allocations.find((a) => a.weavingPointId === '41');
      expect(allocB?.issuedQty).toBe(20);
      expect(allocB?.receivedQty).toBe(0);
      expect(allocB?.remainingToReceive).toBe(20);
    });
  });

  describe('findAllGroupedByPoint', () => {
    it('trả về mảng rỗng khi chưa có WeavingIssue/WeavingReceipt nào', async () => {
      const result = await service.findAllGroupedByPoint();
      expect(result).toHaveLength(0);
    });

    it('gộp 1 (PO, mảnh) tại 1 điểm đan - quantity/completed/holding đúng', async () => {
      prisma.weavingIssue.findMany.mockResolvedValue([{ ...issueRow, qty: 15 }]);
      prisma.weavingReceipt.findMany.mockResolvedValue([{ ...receiptRow, qty: 5 }]);

      const result = await service.findAllGroupedByPoint();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('40');
      expect(result[0].code).toBe('DIEM-A');
      expect(result[0].assignments).toHaveLength(1);
      expect(result[0].assignments[0].poNumber).toBe('PO-31'); // ưu tiên salesOrder.code
      expect(result[0].assignments[0].productLabel).toBe('Ghế xoay demo');
      expect(result[0].assignments[0].quantity).toBe(15);
      expect(result[0].assignments[0].completed).toBe(5);
      expect(result[0].assignments[0].holding).toBe(10);
      expect(result[0].totalHolding).toBe(10);
    });

    it('tách riêng 2 điểm đan khác nhau, không lẫn assignment', async () => {
      const pointB = { id: 41n, code: 'DIEM-B', fullName: 'Điểm đan B', phone: null };
      prisma.weavingIssue.findMany.mockResolvedValue([
        { ...issueRow, qty: 15 },
        { ...issueRow, weavingPointId: 41n, weavingPoint: pointB, qty: 8 },
      ]);
      prisma.weavingPoint.findMany.mockResolvedValue([weavingPoint, pointB]);

      const result = await service.findAllGroupedByPoint();
      expect(result).toHaveLength(2);
      const groupA = result.find((g) => g.id === '40')!;
      const groupB = result.find((g) => g.id === '41')!;
      expect(groupA.assignments).toHaveLength(1);
      expect(groupA.totalHolding).toBe(15);
      expect(groupB.assignments).toHaveLength(1);
      expect(groupB.totalHolding).toBe(8);
    });

    it('fallback poNumber về ProductionOrder.poNumber khi không có salesOrder (PO gộp tự tạo)', async () => {
      const orderNoSales = { ...order, productionInvoiceItem: { salesOrder: null } };
      prisma.weavingIssue.findMany.mockResolvedValue([
        { ...issueRow, productionOrder: orderNoSales },
      ]);

      const result = await service.findAllGroupedByPoint();
      expect(result[0].assignments[0].poNumber).toBe('PO-31-1');
    });
  });
});
