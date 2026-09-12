import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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
    productionOrder: { findUnique: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock };
    productionInvoiceItem: { findUniqueOrThrow: jest.Mock };
    piece: { findUnique: jest.Mock };
    weavingPoint: { findUnique: jest.Mock; findMany: jest.Mock };
    bomPiece: { findUnique: jest.Mock; findMany: jest.Mock };
    materialGroup: { findMany: jest.Mock };
    pieceMaterialItem: { findMany: jest.Mock };
    material: { findUnique: jest.Mock };
    warehouse: { findUniqueOrThrow: jest.Mock };
    weavingIssueMaterial: { create: jest.Mock };
    stockQuant: { findMany: jest.Mock };
    warehouseTransferPieceItem: { findMany: jest.Mock; aggregate: jest.Mock };
    $executeRaw: jest.Mock;
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let stockLedgerService: { postEntry: jest.Mock };
  let stockReservationsService: { getAvailableQty: jest.Mock };

  const order = {
    id: 1n,
    poNumber: 'PO-31-1',
    bomRevisionId: 5n,
    quantity: 10,
    productionInvoiceItemId: 21n,
    productionInvoiceItem: { salesOrder: { orderCode: 'PO-31' } },
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
      // findFirst mặc định trả về 1 order ACTIVE - đa số test case không quan tâm gate
      // assertItemPiHasActiveFloor() (2026-08-31).
      productionOrder: {
        findUnique: jest.fn().mockResolvedValue(order),
        findFirst: jest.fn().mockResolvedValue({ id: 9n }),
        // Mặc định 1 order duy nhất - describe('getIssuePlanBatch') bên dưới tự override cho case
        // nhiều order.
        findMany: jest.fn().mockResolvedValue([order]),
      },
      productionInvoiceItem: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ productionInvoiceId: 500n }),
      },
      piece: { findUnique: jest.fn().mockResolvedValue(piece) },
      weavingPoint: {
        findUnique: jest.fn().mockResolvedValue(weavingPoint),
        findMany: jest.fn().mockResolvedValue([weavingPoint]),
      },
      bomPiece: {
        findUnique: jest.fn().mockResolvedValue(bomPieceRow),
        findMany: jest.fn().mockResolvedValue([]),
      },
      // getIssuePlan()/getIssuePlanBatch() luôn truy vấn kèm định mức Dây/Đinh (xem
      // getWovenMaterialLinesByPiece, 2026-09-11) - mặc định rỗng, các test case về wire/nail
      // tự override.
      materialGroup: { findMany: jest.fn().mockResolvedValue([]) },
      pieceMaterialItem: { findMany: jest.fn().mockResolvedValue([]) },
      // Vật tư THẬT mang kèm mảnh (2026-09-11, issueMaterialsForWeaving) - mặc định rỗng/không
      // gọi tới, các test case về materials tự override.
      material: { findUnique: jest.fn() },
      warehouse: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 999n, code: 'PRODUCTION' }),
      },
      weavingIssueMaterial: { create: jest.fn() },
      stockQuant: { findMany: jest.fn().mockResolvedValue([]) },
      // Số mảnh đã CONFIRMED từ Phân phối nội bộ (2026-09-12, sumReceivedForPiece/receivedByPiece)
      // - create() mặc định dư dả (không chặn test case cũ không quan tâm ràng buộc mới này);
      // getIssuePlan()/getIssuePlanBatch() mặc định rỗng (canIssueQty=0), test case riêng tự override.
      warehouseTransferPieceItem: {
        findMany: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 1_000_000 } }),
      },
      $executeRaw: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(prisma))),
    };
    stockLedgerService = { postEntry: jest.fn().mockResolvedValue(undefined) };
    stockReservationsService = { getAvailableQty: jest.fn().mockResolvedValue(1_000_000) };
    service = new WeavingIssuesService(
      prisma as unknown as PrismaServiceType,
      stockLedgerService as never,
      stockReservationsService as never,
    );
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

    it('2026-09-12: chặn xuất vượt số mảnh THỰC TẾ đã nhận từ Phân phối nội bộ (kho chưa nhận đủ), dù định mức còn cho phép nhiều hơn', async () => {
      // plannedQty = qtyPerUnit(4) × quantity(10) = 40 -> định mức thừa sức cho qty=10, nhưng kho
      // vật tư-TP mới CONFIRMED nhận 6 mảnh - phải chặn theo số thật này, không phải định mức.
      prisma.warehouseTransferPieceItem.aggregate.mockResolvedValue({ _sum: { quantity: 6 } });

      await expect(
        service.create('1', { pieceId: '20', weavingPointId: '40', qty: 10 }, 'user-1', null),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.weavingIssue.create).not.toHaveBeenCalled();
    });

    it('2026-09-12: cho phép xuất đúng bằng số đã nhận thật (biên) - và tính đúng aggregate theo (productionOrderId, pieceId) CONFIRMED', async () => {
      prisma.weavingIssue.create.mockResolvedValue(issueRow);
      prisma.warehouseTransferPieceItem.aggregate.mockResolvedValue({ _sum: { quantity: 10 } });

      await expect(
        service.create('1', { pieceId: '20', weavingPointId: '40', qty: 10 }, 'user-1', null),
      ).resolves.toBeDefined();

      expect(prisma.warehouseTransferPieceItem.aggregate).toHaveBeenCalledWith({
        where: { productionOrderId: 1n, pieceId: 20n, transfer: { status: 'CONFIRMED' } },
        _sum: { quantity: true },
      });
    });

    it('2026-09-11: có materials mang kèm - trừ tồn thật (FOR UPDATE + getAvailableQty + postEntry TRONG transaction), tạo dòng WeavingIssueMaterial', async () => {
      prisma.weavingIssue.create.mockResolvedValue(issueRow);
      prisma.material.findUnique.mockResolvedValue({ id: 60n, code: 'DAY-2LY', warehouseId: 900n });
      prisma.$queryRaw.mockResolvedValue([{ qty: { toNumber: () => 50 } }]);
      stockReservationsService.getAvailableQty.mockResolvedValue(45);

      await service.create(
        '1',
        {
          pieceId: '20',
          weavingPointId: '40',
          qty: 10,
          materials: [{ materialId: '60', qty: 15 }],
        },
        'user-1',
        null,
      );

      expect(stockReservationsService.getAvailableQty).toHaveBeenCalledWith(
        expect.anything(),
        900n,
        60n,
        50,
      );
      expect(prisma.weavingIssueMaterial.create).toHaveBeenCalledWith({
        data: { weavingIssueId: 100n, materialId: 60n, qty: 15 },
      });
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          fromWarehouseId: 900n,
          toWarehouseId: 999n,
          materialId: 60n,
          qty: 15,
          refType: 'WEAVING_ISSUE_MATERIAL',
          refId: '100',
        }),
        expect.anything(),
      );
    });

    it('2026-09-11: tồn khả dụng không đủ cho vật tư mang kèm - ConflictException, không tạo WeavingIssueMaterial/ghi sổ', async () => {
      prisma.weavingIssue.create.mockResolvedValue(issueRow);
      prisma.material.findUnique.mockResolvedValue({ id: 60n, code: 'DAY-2LY', warehouseId: 900n });
      prisma.$queryRaw.mockResolvedValue([{ qty: { toNumber: () => 5 } }]);
      stockReservationsService.getAvailableQty.mockResolvedValue(5);

      await expect(
        service.create(
          '1',
          {
            pieceId: '20',
            weavingPointId: '40',
            qty: 10,
            materials: [{ materialId: '60', qty: 15 }],
          },
          'user-1',
          null,
        ),
      ).rejects.toThrow(ConflictException);

      expect(prisma.weavingIssueMaterial.create).not.toHaveBeenCalled();
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    it('2026-09-11: materialId trùng lặp trong danh sách mang kèm - BadRequestException, không mở transaction', async () => {
      await expect(
        service.create(
          '1',
          {
            pieceId: '20',
            weavingPointId: '40',
            qty: 10,
            materials: [
              { materialId: '60', qty: 5 },
              { materialId: '60', qty: 3 },
            ],
          },
          'user-1',
          null,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.weavingIssue.create).not.toHaveBeenCalled();
    });

    it('2026-09-11: dòng qty<=0 bị lọc bỏ, không tạo WeavingIssueMaterial/gọi tồn kho', async () => {
      prisma.weavingIssue.create.mockResolvedValue(issueRow);

      await service.create(
        '1',
        { pieceId: '20', weavingPointId: '40', qty: 10, materials: [{ materialId: '60', qty: 0 }] },
        'user-1',
        null,
      );

      expect(prisma.material.findUnique).not.toHaveBeenCalled();
      expect(prisma.weavingIssueMaterial.create).not.toHaveBeenCalled();
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

    it('2026-09-03: cho phép caller thuộc kho vat-tu-tp PHỤ (trước đây chỉ đúng literal kho gốc mới qua được, bất đối xứng với nhánh receive() đã vá 08/31)', async () => {
      prisma.weavingIssue.create.mockResolvedValue(issueRow);
      await expect(
        service.create(
          '1',
          { pieceId: '20', weavingPointId: '40', qty: 10 },
          'user-1',
          'vat-tu-tp-2',
        ),
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

    it('chặn caller bị giới hạn ở kho khác kho thành phẩm (nhận đan khác kho với xuất đan)', async () => {
      await expect(
        service.receive(
          '1',
          { pieceId: '20', weavingPointId: '40', qty: 5 },
          'user-1',
          'vat-tu-tp',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.weavingReceipt.create).not.toHaveBeenCalled();
    });

    it('cho phép caller giới hạn ở kho thành phẩm nhận đan (2026-08-31 - trước đây bị chặn nhầm do dùng chung hằng số kho với create())', async () => {
      prisma.weavingIssue.aggregate.mockResolvedValue({ _sum: { qty: 10 } });
      prisma.weavingReceipt.create.mockResolvedValue(receiptRow);
      await expect(
        service.receive(
          '1',
          { pieceId: '20', weavingPointId: '40', qty: 5 },
          'user-1',
          'thanh-pham',
        ),
      ).resolves.toBeDefined();
    });

    it('cho phép caller giới hạn ở kho thành phẩm PHỤ nhận đan (2026-09-03 - trước đây so literal nên chỉ đúng "thanh-pham" gốc mới qua được)', async () => {
      prisma.weavingIssue.aggregate.mockResolvedValue({ _sum: { qty: 10 } });
      prisma.weavingReceipt.create.mockResolvedValue(receiptRow);
      await expect(
        service.receive(
          '1',
          { pieceId: '20', weavingPointId: '40', qty: 5 },
          'user-1',
          'thanh-pham-1735689000000',
        ),
      ).resolves.toBeDefined();
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

  describe('create/receive - QLSX "Bắt đầu" gate (assertItemPiHasActiveFloor, 2026-08-31)', () => {
    it('create: ném ConflictException khi PI của order chưa có SKU nào ACTIVE', async () => {
      prisma.productionOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.create('1', { pieceId: '20', weavingPointId: '40', qty: 10 }, 'user-1', null),
      ).rejects.toThrow(ConflictException);
      expect(prisma.productionInvoiceItem.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 21n },
        select: { productionInvoiceId: true },
      });
      expect(prisma.weavingIssue.create).not.toHaveBeenCalled();
    });

    it('receive: ném ConflictException khi PI của order chưa có SKU nào ACTIVE', async () => {
      prisma.productionOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.receive('1', { pieceId: '20', weavingPointId: '40', qty: 5 }, 'user-1', null),
      ).rejects.toThrow(ConflictException);
      expect(prisma.weavingReceipt.create).not.toHaveBeenCalled();
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

    it('2026-09-12: canIssueQty = min(remainingToIssue định mức, đã nhận thật - đã xuất) - kho chưa nhận đủ thì bị chặn ở số thật, không phải định mức', async () => {
      // plannedQty=40 (định mức thừa), nhưng kho vật tư-TP mới CONFIRMED nhận 15, đã xuất đan 5
      // rồi -> canIssueQty phải = 15 - 5 = 10, KHÔNG phải remainingToIssue = 40 - 5 = 35.
      prisma.bomPiece.findMany.mockResolvedValue([{ ...bomPieceRow, piece }]);
      prisma.weavingIssue.findMany.mockResolvedValue([
        { pieceId: 20n, weavingPointId: 40n, qty: 5, weavingPoint, materials: [] },
      ]);
      prisma.warehouseTransferPieceItem.findMany.mockResolvedValue([
        { pieceId: 20n, quantity: 15 },
      ]);

      const result = await service.getIssuePlan('1');
      expect(result[0].remainingToIssue).toBe(35);
      expect(result[0].canIssueQty).toBe(10);
    });

    it('2026-09-12: canIssueQty không âm khi đã xuất vượt số đã nhận (dữ liệu lịch sử/race hiếm)', async () => {
      prisma.bomPiece.findMany.mockResolvedValue([{ ...bomPieceRow, piece }]);
      prisma.weavingIssue.findMany.mockResolvedValue([
        { pieceId: 20n, weavingPointId: 40n, qty: 20, weavingPoint, materials: [] },
      ]);
      prisma.warehouseTransferPieceItem.findMany.mockResolvedValue([
        { pieceId: 20n, quantity: 15 },
      ]);

      const result = await service.getIssuePlan('1');
      expect(result[0].canIssueQty).toBe(0);
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

    it('2026-09-11: trả kèm định mức Dây/Đinh của mảnh (wire/nail) đúng nhóm, không lẫn nhóm khác', async () => {
      prisma.bomPiece.findMany.mockResolvedValue([{ ...bomPieceRow, piece }]);
      prisma.materialGroup.findMany.mockResolvedValue([
        { id: 900n, systemKey: 'WIRE' },
        { id: 901n, systemKey: 'NAIL' },
      ]);
      prisma.pieceMaterialItem.findMany.mockResolvedValue([
        {
          bomRevisionId: 5n,
          pieceId: 20n,
          materialId: 60n,
          qtyPerPiece: { toNumber: () => 3 },
          material: {
            code: 'DAY-2LY',
            name: 'Dây 2 ly',
            spec: null,
            unit: 'm',
            materialGroupId: 900n,
          },
        },
        {
          bomRevisionId: 5n,
          pieceId: 20n,
          materialId: 61n,
          qtyPerPiece: { toNumber: () => 4 },
          material: {
            code: 'DINH-01',
            name: 'Đinh 01',
            spec: null,
            unit: 'cái',
            materialGroupId: 901n,
          },
        },
        // Nhóm khác (Tán rút/Nút nhựa) - KHÔNG được lẫn vào wire/nail.
        {
          bomRevisionId: 5n,
          pieceId: 20n,
          materialId: 62n,
          qtyPerPiece: { toNumber: () => 1 },
          material: {
            code: 'TAN-01',
            name: 'Tán rút',
            spec: null,
            unit: 'cái',
            materialGroupId: 902n,
          },
        },
      ]);

      const result = await service.getIssuePlan('1');
      expect(result).toHaveLength(1);
      expect(result[0].wire).toEqual([
        {
          materialId: '60',
          materialCode: 'DAY-2LY',
          materialName: 'Dây 2 ly',
          materialSpec: null,
          materialUnit: 'm',
          qtyPerPiece: 3,
          issuedQty: 0,
          onHandQty: 0,
        },
      ]);
      expect(result[0].nail).toEqual([
        {
          materialId: '61',
          materialCode: 'DINH-01',
          materialName: 'Đinh 01',
          materialSpec: null,
          materialUnit: 'cái',
          qtyPerPiece: 4,
          issuedQty: 0,
          onHandQty: 0,
        },
      ]);
    });

    it('2026-09-11: chỉ trả dòng Nút nhựa (plasticButton) đã tick includeInWeaving=true, bỏ qua dòng chưa tick', async () => {
      prisma.bomPiece.findMany.mockResolvedValue([{ ...bomPieceRow, piece }]);
      prisma.materialGroup.findMany.mockResolvedValue([{ id: 905n, systemKey: 'PLASTIC_BUTTON' }]);
      prisma.pieceMaterialItem.findMany.mockResolvedValue([
        {
          bomRevisionId: 5n,
          pieceId: 20n,
          materialId: 70n,
          qtyPerPiece: { toNumber: () => 8 },
          includeInWeaving: true,
          material: {
            code: 'NUT-01',
            name: 'Nút nhựa đi đan',
            spec: null,
            unit: 'cái',
            materialGroupId: 905n,
          },
        },
        {
          bomRevisionId: 5n,
          pieceId: 20n,
          materialId: 71n,
          qtyPerPiece: { toNumber: () => 2 },
          includeInWeaving: false,
          material: {
            code: 'NUT-02',
            name: 'Nút nhựa không đan',
            spec: null,
            unit: 'cái',
            materialGroupId: 905n,
          },
        },
      ]);

      const result = await service.getIssuePlan('1');
      expect(result[0].plasticButton).toEqual([
        {
          materialId: '70',
          materialCode: 'NUT-01',
          materialName: 'Nút nhựa đi đan',
          materialSpec: null,
          materialUnit: 'cái',
          qtyPerPiece: 8,
          issuedQty: 0,
          onHandQty: 0,
        },
      ]);
    });

    it('mảnh chưa có dòng vật tư Dây/Đinh nào - wire/nail trả mảng rỗng, không throw', async () => {
      prisma.bomPiece.findMany.mockResolvedValue([{ ...bomPieceRow, piece }]);

      const result = await service.getIssuePlan('1');
      expect(result[0].wire).toEqual([]);
      expect(result[0].nail).toEqual([]);
      expect(result[0].plasticButton).toEqual([]);
    });

    it('2026-09-11: issuedQty = Σ WeavingIssueMaterial.qty của MỌI điểm đan cho đúng materialId, onHandQty = StockQuant.qty của đúng kho vật tư', async () => {
      prisma.bomPiece.findMany.mockResolvedValue([{ ...bomPieceRow, piece }]);
      prisma.materialGroup.findMany.mockResolvedValue([{ id: 900n, systemKey: 'WIRE' }]);
      prisma.pieceMaterialItem.findMany.mockResolvedValue([
        {
          bomRevisionId: 5n,
          pieceId: 20n,
          materialId: 60n,
          qtyPerPiece: { toNumber: () => 3 },
          material: {
            code: 'DAY-2LY',
            name: 'Dây 2 ly',
            spec: null,
            unit: 'm',
            materialGroupId: 900n,
            warehouseId: 900n,
          },
        },
      ]);
      prisma.stockQuant.findMany.mockResolvedValue([
        { warehouseId: 900n, materialId: 60n, qty: { toNumber: () => 120 } },
      ]);
      // 2 lần xuất đan (2 điểm đan khác nhau) cho cùng mảnh - issuedQty phải CỘNG DỒN cả 2.
      prisma.weavingIssue.findMany.mockResolvedValue([
        {
          pieceId: 20n,
          weavingPointId: 40n,
          qty: 5,
          weavingPoint,
          materials: [{ materialId: 60n, qty: { toNumber: () => 15 } }],
        },
        {
          pieceId: 20n,
          weavingPointId: 41n,
          qty: 5,
          weavingPoint: { id: 41n, code: 'DIEM-B', fullName: 'Điểm đan B', isActive: true },
          materials: [{ materialId: 60n, qty: { toNumber: () => 9 } }],
        },
      ]);

      const result = await service.getIssuePlan('1');
      expect(result[0].wire).toEqual([
        expect.objectContaining({ materialId: '60', issuedQty: 24, onHandQty: 120 }),
      ]);
    });
  });

  describe('getIssuePlanBatch (2026-08-31 - gộp nhiều order 1 lần cho Bảng thống kê)', () => {
    it('mảng rỗng - trả {} ngay, không query gì', async () => {
      const result = await service.getIssuePlanBatch([]);

      expect(result).toEqual({});
      expect(prisma.productionOrder.findMany).not.toHaveBeenCalled();
    });

    it('mọi id truyền vào đều pre-seed [] kể cả khi order không có mảnh đan nào', async () => {
      prisma.productionOrder.findMany.mockResolvedValue([order]);
      prisma.bomPiece.findMany.mockResolvedValue([]);

      const result = await service.getIssuePlanBatch(['1', '2']);

      expect(result).toEqual({ '1': [], '2': [] });
    });

    it('loại bỏ mảnh không thuộc công đoạn Đan (isWoven=false), khớp hành vi getIssuePlan', async () => {
      prisma.productionOrder.findMany.mockResolvedValue([order]);
      prisma.bomPiece.findMany.mockResolvedValue([{ ...bomPieceRow, isWoven: false, piece }]);

      const result = await service.getIssuePlanBatch(['1']);

      expect(result['1']).toHaveLength(0);
    });

    it('2 order khác nhau CÙNG bomRevisionId - dùng chung 1 query bomPiece nhưng KHÔNG lẫn issue/receipt của nhau', async () => {
      const order2 = { ...order, id: 2n, poNumber: 'PO-32-1', quantity: 5 };
      prisma.productionOrder.findMany.mockResolvedValue([order, order2]);
      prisma.bomPiece.findMany.mockResolvedValue([{ ...bomPieceRow, piece }]);
      prisma.weavingIssue.findMany.mockResolvedValue([
        { productionOrderId: 1n, pieceId: 20n, weavingPointId: 40n, qty: 15, weavingPoint },
        { productionOrderId: 2n, pieceId: 20n, weavingPointId: 40n, qty: 3, weavingPoint },
      ]);
      prisma.weavingReceipt.findMany.mockResolvedValue([]);

      const result = await service.getIssuePlanBatch(['1', '2']);

      expect(result['1']).toHaveLength(1);
      expect(result['1'][0].issuedQty).toBe(15);
      expect(result['1'][0].totalQty).toBe(40); // qtyPerUnit(4) × order.quantity(10)
      expect(result['2']).toHaveLength(1);
      expect(result['2'][0].issuedQty).toBe(3);
      expect(result['2'][0].totalQty).toBe(20); // qtyPerUnit(4) × order2.quantity(5)
      // Cùng bomRevisionId (5n) cho cả 2 order - chỉ query bomPiece.findMany đúng 1 lần cho cả batch.
      expect(prisma.bomPiece.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.bomPiece.findMany).toHaveBeenCalledWith({
        where: { bomRevisionId: { in: [5n] } },
        include: { piece: true },
      });
    });

    it('2026-09-12: canIssueQty tính RIÊNG theo từng (productionOrderId, pieceId) - 2 lệnh sản xuất khác nhau CÙNG dùng chung 1 tên mảnh (pieceId=20) KHÔNG được gộp số đã nhận/đã xuất của nhau', async () => {
      const order2 = { ...order, id: 2n, poNumber: 'PO-32-1', quantity: 5 };
      prisma.productionOrder.findMany.mockResolvedValue([order, order2]);
      prisma.bomPiece.findMany.mockResolvedValue([{ ...bomPieceRow, piece }]);
      // Order 1: đã nhận 15, đã xuất 5 -> canIssueQty = 10.
      // Order 2: đã nhận 100 (nhiều hơn hẳn), đã xuất 0 -> canIssueQty phải = 20 (bị chặn bởi
      // remainingToIssue = totalQty(20) - issuedQty(0), KHÔNG phải 100) - nếu code lỡ gộp nhầm
      // theo pieceId toàn cục, order 1 sẽ ăn ké số 100 của order 2 và trả sai canIssueQty=35.
      prisma.weavingIssue.findMany.mockResolvedValue([
        {
          productionOrderId: 1n,
          pieceId: 20n,
          weavingPointId: 40n,
          qty: 5,
          weavingPoint,
          materials: [],
        },
      ]);
      prisma.weavingReceipt.findMany.mockResolvedValue([]);
      prisma.warehouseTransferPieceItem.findMany.mockResolvedValue([
        { productionOrderId: 1n, pieceId: 20n, quantity: 15 },
        { productionOrderId: 2n, pieceId: 20n, quantity: 100 },
      ]);

      const result = await service.getIssuePlanBatch(['1', '2']);

      expect(result['1'][0].canIssueQty).toBe(10); // min(40-5=35, 15-5=10)
      expect(result['2'][0].canIssueQty).toBe(20); // min(20-0=20, 100-0=100)
    });

    it('allocations group đúng theo từng điểm đan trong 1 order của batch, khớp getIssuePlan', async () => {
      const pointB = { id: 41n, code: 'DIEM-B', fullName: 'Điểm đan B', isActive: true };
      prisma.productionOrder.findMany.mockResolvedValue([order]);
      prisma.bomPiece.findMany.mockResolvedValue([{ ...bomPieceRow, piece }]);
      prisma.weavingIssue.findMany.mockResolvedValue([
        { productionOrderId: 1n, pieceId: 20n, weavingPointId: 40n, qty: 15, weavingPoint },
        { productionOrderId: 1n, pieceId: 20n, weavingPointId: 41n, qty: 20, weavingPoint: pointB },
      ]);
      prisma.weavingReceipt.findMany.mockResolvedValue([
        { productionOrderId: 1n, pieceId: 20n, weavingPointId: 40n, qty: 5, weavingPoint },
      ]);

      const result = await service.getIssuePlanBatch(['1']);

      expect(result['1'][0].allocations).toHaveLength(2);
      const allocA = result['1'][0].allocations.find((a) => a.weavingPointId === '40');
      expect(allocA?.remainingToReceive).toBe(10);
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
      expect(result[0].assignments[0].poNumber).toBe('PO-31'); // ưu tiên salesOrder.orderCode
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
