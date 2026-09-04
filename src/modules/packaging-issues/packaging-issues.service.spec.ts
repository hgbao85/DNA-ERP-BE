import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AccessoryItemKind, StockLedgerRefType } from '../../generated/prisma/client';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { StockReservationsService } from '../stock/stock-reservations.service';
import { PackagingIssuesService } from './packaging-issues.service';

describe('PackagingIssuesService', () => {
  let service: PackagingIssuesService;
  let stockLedgerService: { postEntry: jest.Mock };
  let stockReservationsService: { getAvailableQty: jest.Mock };
  // Vấn đề #1 audit 26/08 - $queryRaw (khoá + đọc stock_quant) điều khiển bởi biến này, mặc định
  // dư dả để không ảnh hưởng các test có sẵn (chỉ quan tâm định mức BOM).
  let physicalStockQty: number;
  let prisma: {
    packagingIssue: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      aggregate: jest.Mock;
    };
    productionOrder: { findUnique: jest.Mock; findMany: jest.Mock; findFirst: jest.Mock };
    productionInvoiceItem: { findUniqueOrThrow: jest.Mock };
    material: { findUnique: jest.Mock };
    bomAccessoryItem: { findUnique: jest.Mock; findMany: jest.Mock };
    bomPiece: { findMany: jest.Mock };
    transferCheckResult: { groupBy: jest.Mock };
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
    productionInvoiceItemId: 21n,
    mfgProduct: { name: 'Ghế xoay demo' },
    productionInvoiceItem: { salesOrder: { code: 'PO-31' } },
  };
  // warehouseId/warehouse (2026-09-03): findMaterialWarehouseOrThrow() giờ đọc động Kho của vật
  // tư này thay vì hardcode literal 'vat-tu-tp' - mirror CuttingProposalsService.approve().
  const material = {
    id: 30n,
    code: 'TEM-01',
    name: 'Tem nhãn sản phẩm',
    unit: 'tờ',
    warehouseId: 2n,
    warehouse: { id: 2n, code: 'vat-tu-tp' },
  };
  const accessoryRow = {
    id: 1n,
    bomRevisionId: 5n,
    materialId: 30n,
    kind: AccessoryItemKind.PACKAGING,
    qtyPerUnit: { toNumber: () => 3 }, // plannedQty = 3*10 = 30
  };
  // Chuyền kiểm gate (2026-09-04) - mảnh của order (rev 5n) và order2 (rev 7n, xem describe
  // 'getBulkPlan'). qtyPerUnit=1 để checkedUnits = checkedQty trực tiếp, dễ tính tay trong test.
  const bomPieceRows = [
    { bomRevisionId: 5n, pieceId: 40n, qtyPerUnit: 1 },
    { bomRevisionId: 7n, pieceId: 41n, qtyPerUnit: 1 },
  ];
  const vatTuTp = { id: 2n, code: 'vat-tu-tp', name: 'Kho Vật tư thành phẩm' };
  const thanhPham = { id: 6n, code: 'thanh-pham', name: 'Kho Thành phẩm' };
  const thanhPham2 = { id: 7n, code: 'thanh-pham-2', name: 'Kho thành phẩm 2' };

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
    physicalStockQty = 9999;
    prisma = {
      packagingIssue: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _sum: { issuedQty: null } }),
      },
      // findFirst mặc định trả về 1 order ACTIVE - đa số test case không quan tâm gate
      // assertItemPiHasActiveFloor() (2026-08-31).
      productionOrder: {
        findUnique: jest.fn().mockResolvedValue(order),
        findMany: jest.fn().mockResolvedValue([order]),
        findFirst: jest.fn().mockResolvedValue({ id: 9n }),
      },
      productionInvoiceItem: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ productionInvoiceId: 500n }),
      },
      material: { findUnique: jest.fn().mockResolvedValue(material) },
      bomAccessoryItem: {
        findUnique: jest.fn().mockResolvedValue(accessoryRow),
        findMany: jest.fn().mockResolvedValue([{ ...accessoryRow, material }]),
      },
      // mockImplementation lọc theo where.bomRevisionId thật (thay vì trả tĩnh mọi mảnh của mọi
      // revision) - cần thiết vì resolveCheckedUnits() gọi với 1 bomRevisionId (equality) còn
      // getBulkPlan() gọi với { in: [...] }; trả tĩnh sẽ lẫn mảnh của order khác vào phép Math.min().
      bomPiece: {
        findMany: jest.fn(
          (
            { where }: { where: { bomRevisionId: bigint | { in: bigint[] } } } = {
              where: { bomRevisionId: { in: [] } },
            },
          ) => {
            const ids =
              typeof where.bomRevisionId === 'bigint'
                ? [where.bomRevisionId]
                : where.bomRevisionId.in;
            return Promise.resolve(bomPieceRows.filter((bp) => ids.includes(bp.bomRevisionId)));
          },
        ),
      },
      // Mặc định dư dả (999) để không ảnh hưởng các test có sẵn (chỉ quan tâm định mức BOM/tồn
      // kho) - cùng idiom physicalStockQty ở trên. Đủ field cho cả 2 call site: resolveCheckedUnits()
      // (group theo 1 pieceId) và getBulkPlan() (group theo cả productionInvoiceItemId+pieceId).
      transferCheckResult: {
        groupBy: jest.fn().mockResolvedValue([
          { productionInvoiceItemId: 21n, pieceId: 40n, _sum: { checkedQty: 999 } },
          { productionInvoiceItemId: 21n, pieceId: 41n, _sum: { checkedQty: 999 } },
        ]),
      },
      warehouse: {
        findUniqueOrThrow: jest
          .fn()
          .mockImplementation(({ where }: { where: { code: string } }) =>
            Promise.resolve(
              where.code === 'vat-tu-tp'
                ? vatTuTp
                : where.code === 'thanh-pham-2'
                  ? thanhPham2
                  : thanhPham,
            ),
          ),
      },
      $executeRaw: jest.fn().mockResolvedValue(0),
      // 2026-09-03: assertItemPiHasActiveFloorLocked() (vá race TOCTOU) giờ cũng dùng $queryRaw
      // (FOR UPDATE lên production_orders) ngay dòng đầu transaction create() - phải phân nhánh
      // theo nội dung câu SQL, không còn chỉ có 1 loại câu raw duy nhất như trước.
      $queryRaw: jest.fn((strings: TemplateStringsArray) =>
        strings.join('').includes('production_orders')
          ? Promise.resolve([{ floorStage: 'ACTIVE' }])
          : Promise.resolve([{ qty: { toNumber: () => physicalStockQty } }]),
      ),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(prisma))),
    };
    stockLedgerService = { postEntry: jest.fn().mockResolvedValue(undefined) };
    stockReservationsService = {
      getAvailableQty: jest.fn((_tx, _wh, _mat, onHand: number) => Promise.resolve(onHand)),
    };
    service = new PackagingIssuesService(
      prisma as unknown as PrismaServiceType,
      stockLedgerService as unknown as StockLedgerService,
      stockReservationsService as unknown as StockReservationsService,
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

    it('ghi StockLedger tới ĐÚNG kho thành phẩm PHỤ mà QLSX đã chọn (2026-09-03 - trước đây hard-code luôn về kho gốc "thanh-pham" bất kể QLSX chọn kho nào lúc gửi Sếp duyệt)', async () => {
      const issueRowWithSubWarehouse = {
        ...issueRow,
        productionOrder: {
          ...order,
          productionInvoiceItem: { salesOrder: { code: 'PO-31' }, warehouseCode: 'thanh-pham-2' },
        },
      };
      prisma.packagingIssue.create.mockResolvedValue(issueRowWithSubWarehouse);

      await service.create('1', dto, 'user-1', null);

      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({ fromWarehouseId: 2n, toWarehouseId: 7n }),
      );
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

    it('2026-09-03: chỉ Thủ kho của ĐÚNG kho vat-tu-tp PHỤ mà vật tư này nằm mới xuất được - kho gốc vat-tu-tp bị chặn dù cùng gia đình', async () => {
      const materialAtSubWarehouse = {
        ...material,
        warehouseId: 8n,
        warehouse: { id: 8n, code: 'vat-tu-tp-2' },
      };
      prisma.material.findUnique.mockResolvedValue(materialAtSubWarehouse);

      await expect(service.create('1', dto, 'user-1', 'vat-tu-tp')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.packagingIssue.create).not.toHaveBeenCalled();
    });

    it('ném BadRequestException khi vật tư chưa được Admin cấu hình Kho (Material.warehouseId null)', async () => {
      prisma.material.findUnique.mockResolvedValue({
        ...material,
        warehouseId: null,
        warehouse: null,
      });
      await expect(service.create('1', dto, 'user-1', null)).rejects.toThrow(BadRequestException);
      expect(prisma.packagingIssue.create).not.toHaveBeenCalled();
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

    it('khoá advisory theo (order, material) TRONG transaction trước khi đọc remaining (H3 fix - chặn race đọc-rồi-ghi)', async () => {
      prisma.packagingIssue.create.mockResolvedValue(issueRow);

      await service.create('1', dto, 'user-1', null);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.$executeRaw).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest mock.calls typing
      const rawCall = prisma.$executeRaw.mock.calls[0][0] as TemplateStringsArray;
      expect(rawCall.join('')).toContain('pg_advisory_xact_lock');
    });

    // Vấn đề #1 audit 26/08 (Nghiêm trọng) - trước đây chỉ check định mức BOM, không đối chiếu
    // tồn kho vật lý, nên xuất vượt tồn thật vẫn được chấp nhận.
    it('ném ConflictException khi tồn kho thật không đủ dù trong định mức BOM (Vấn đề #1)', async () => {
      physicalStockQty = 2;
      await expect(service.create('1', { ...dto, issuedQty: 5 }, 'user-1', null)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.packagingIssue.create).not.toHaveBeenCalled();
    });

    it('cho phép xuất khi tồn kho thật đủ, đúng bằng số cần xuất', async () => {
      physicalStockQty = 5;
      prisma.packagingIssue.create.mockResolvedValue(issueRow);
      await expect(
        service.create('1', { ...dto, issuedQty: 5 }, 'user-1', null),
      ).resolves.toBeDefined();
    });

    it('khoá dòng stock_quant bằng FOR UPDATE trước khi đọc tồn (chặn race giữa 2 lệnh SX khác nhau)', async () => {
      prisma.packagingIssue.create.mockResolvedValue(issueRow);
      await service.create('1', dto, 'user-1', null);

      expect(prisma.$queryRaw).toHaveBeenCalled();
      // 2026-09-03: $queryRaw giờ cũng nhận call của assertItemPiHasActiveFloorLocked() (FOR UPDATE
      // lên production_orders) chạy TRƯỚC - lọc đúng call chứa "stock_quant" thay vì giả định [0].
      const rawCall = prisma.$queryRaw.mock.calls

        .map(([strings]) => strings as TemplateStringsArray)
        .find((strings) => strings.join('').includes('stock_quant'))!;
      expect(rawCall.join('')).toContain('FOR UPDATE');
      expect(rawCall.join('')).toContain('stock_quant');
    });

    it('dùng getAvailableQty() (trừ giữ chỗ chuyển kho) thay vì tồn thô - vật tư đang bị giữ chỗ vẫn bị chặn dù tồn thô đủ', async () => {
      physicalStockQty = 100;
      stockReservationsService.getAvailableQty.mockResolvedValue(3);
      await expect(service.create('1', { ...dto, issuedQty: 5 }, 'user-1', null)).rejects.toThrow(
        ConflictException,
      );
      expect(stockReservationsService.getAvailableQty).toHaveBeenCalledWith(
        expect.anything(),
        2n,
        30n,
        100,
      );
    });
  });

  describe('create - QLSX "Bắt đầu" gate (assertItemPiHasActiveFloor, 2026-08-31)', () => {
    const dto = { materialId: '30', issuedQty: 5 };

    it('ném ConflictException khi PI của order chưa có SKU nào ACTIVE', async () => {
      prisma.productionOrder.findFirst.mockResolvedValue(null);

      await expect(service.create('1', dto, 'user-1', null)).rejects.toThrow(ConflictException);
      expect(prisma.productionInvoiceItem.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 21n },
        select: { productionInvoiceId: true },
      });
      expect(prisma.packagingIssue.create).not.toHaveBeenCalled();
    });

    it('cho phép xuất khi PI có ÍT NHẤT 1 SKU ACTIVE, kể cả khi KHÔNG PHẢI chính order này', async () => {
      prisma.productionOrder.findFirst.mockResolvedValue({ id: 999n });
      prisma.packagingIssue.create.mockResolvedValue(issueRow);

      await expect(service.create('1', dto, 'user-1', null)).resolves.toBeDefined();
    });

    // 2026-09-03: assertItemPiHasActiveFloor() ở trên đọc TRƯỚC khi mở transaction (fast-path) -
    // không tự chốt được race QLSX bấm "Tạm dừng" đúng lúc giữa đọc và ghi.
    // assertItemPiHasActiveFloorLocked() (FOR UPDATE, chạy NGAY ĐẦU transaction) mới là nguồn đúng
    // cuối cùng - test này giả lập đúng race đó: pre-check thấy ACTIVE (findFirst mock không đổi)
    // nhưng câu SELECT FOR UPDATE bên trong transaction đọc lại thấy PAUSED.
    it('ném ConflictException khi race: pre-check thấy ACTIVE nhưng SELECT FOR UPDATE trong transaction đọc lại thấy PAUSED (TOCTOU)', async () => {
      prisma.$queryRaw.mockImplementation((strings: TemplateStringsArray) =>
        strings.join('').includes('production_orders')
          ? Promise.resolve([{ floorStage: 'PAUSED' }])
          : Promise.resolve([{ qty: { toNumber: () => physicalStockQty } }]),
      );

      await expect(service.create('1', dto, 'user-1', null)).rejects.toThrow(ConflictException);
      expect(prisma.packagingIssue.create).not.toHaveBeenCalled();
    });
  });

  describe('create - gate Chuyền kiểm bắt buộc trước Đóng gói (2026-09-04)', () => {
    const dto = { materialId: '30', issuedQty: 5 };

    it('ném ConflictException khi CHƯA có Chuyền kiểm nào (checkedQty=0) dù đủ định mức BOM/tồn kho', async () => {
      prisma.transferCheckResult.groupBy.mockResolvedValue([]);
      await expect(service.create('1', dto, 'user-1', null)).rejects.toThrow(ConflictException);
      expect(prisma.packagingIssue.create).not.toHaveBeenCalled();
    });

    it('chặn xuất vượt quá số đã qua Chuyền kiểm dù trong định mức BOM và đủ tồn kho', async () => {
      // qtyPerUnit=3 (accessoryRow), checkedQty=1 -> checkedUnits=floor(1/1)=1 -> checkedCappedQty=3
      prisma.transferCheckResult.groupBy.mockResolvedValue([
        { productionInvoiceItemId: 21n, pieceId: 40n, _sum: { checkedQty: 1 } },
      ]);
      await expect(service.create('1', { ...dto, issuedQty: 4 }, 'user-1', null)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.packagingIssue.create).not.toHaveBeenCalled();
    });

    it('cho phép xuất đúng bằng trần Chuyền kiểm (biên)', async () => {
      prisma.transferCheckResult.groupBy.mockResolvedValue([
        { productionInvoiceItemId: 21n, pieceId: 40n, _sum: { checkedQty: 1 } },
      ]);
      prisma.packagingIssue.create.mockResolvedValue(issueRow);
      // checkedUnits=1 -> checkedCappedQty=3*1=3
      await expect(
        service.create('1', { ...dto, issuedQty: 3 }, 'user-1', null),
      ).resolves.toBeDefined();
    });

    it('đồng bộ: mảnh có Chuyền kiểm THẤP NHẤT quyết định checkedUnits, không phải trung bình hay mảnh cao nhất', async () => {
      // order (rev 5n) chỉ có 1 mảnh (pieceId 40n) theo bomPieceRows mặc định - test này thêm 1
      // mảnh thứ 2 CÙNG rev 5n để kiểm tra Math.min() qua nhiều mảnh. mockResolvedValue (không
      // filter theo where như default) nên CHỈ liệt kê đúng 2 mảnh của rev 5n, không lẫn piece
      // 41n (rev 7n, thuộc order2 ở describe khác) - nếu không checkedByPiece sẽ thiếu piece 41n
      // và Math.min() sai lệch về 0.
      prisma.bomPiece.findMany.mockResolvedValue([
        { bomRevisionId: 5n, pieceId: 40n, qtyPerUnit: 1 },
        { bomRevisionId: 5n, pieceId: 42n, qtyPerUnit: 1 },
      ]);
      prisma.transferCheckResult.groupBy.mockResolvedValue([
        { productionInvoiceItemId: 21n, pieceId: 40n, _sum: { checkedQty: 10 } },
        { productionInvoiceItemId: 21n, pieceId: 42n, _sum: { checkedQty: 2 } }, // mảnh yếu nhất
      ]);
      // checkedUnits = min(10, 2) = 2 -> checkedCappedQty = 3*2 = 6
      await expect(service.create('1', { ...dto, issuedQty: 7 }, 'user-1', null)).rejects.toThrow(
        ConflictException,
      );
      prisma.packagingIssue.create.mockResolvedValue(issueRow);
      await expect(
        service.create('1', { ...dto, issuedQty: 6 }, 'user-1', null),
      ).resolves.toBeDefined();
    });

    it('cộng dồn đã xuất trước khi tính trần Chuyền kiểm (giống cách tính trần BOM)', async () => {
      prisma.transferCheckResult.groupBy.mockResolvedValue([
        { productionInvoiceItemId: 21n, pieceId: 40n, _sum: { checkedQty: 2 } },
      ]);
      // checkedCappedQty = 3*2 = 6, đã xuất 5 (issueRow.issuedQty mặc định) -> còn 1
      prisma.packagingIssue.aggregate.mockResolvedValue({
        _sum: { issuedQty: { toNumber: () => 5 } },
      });
      await expect(service.create('1', { ...dto, issuedQty: 2 }, 'user-1', null)).rejects.toThrow(
        ConflictException,
      );
      prisma.packagingIssue.create.mockResolvedValue(issueRow);
      await expect(
        service.create('1', { ...dto, issuedQty: 1 }, 'user-1', null),
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

    // 2026-09-04: materialWarehouseCode - phát hiện qua test sống PO-41 (Ghế tình yêu) rằng vật tư
    // đóng gói KHÔNG phải lúc nào cũng mặc định về vat-tu-tp (vd VTK-009 "Thùng" lại gán kho gốc
    // "thanh-pham") - FE cần field này để biết ĐÚNG kho nào mới thấy được dòng vật tư, không còn
    // giả định cứng "mọi vật tư đóng gói đều ở vat-tu-tp".
    it('materialWarehouseCode phản ánh đúng kho THẬT của vật tư (Material.warehouseId), không phải hằng số cố định', async () => {
      const result = await service.getBulkPlan(['1']);
      expect(result[0].materialWarehouseCode).toBe('vat-tu-tp');
    });

    it('materialWarehouseCode = kho thành phẩm khi vật tư đóng gói được gán kho mặc định khác vat-tu-tp', async () => {
      const materialAtThanhPham = {
        ...material,
        warehouseId: 6n,
        warehouse: { id: 6n, code: 'thanh-pham' },
      };
      prisma.bomAccessoryItem.findMany.mockResolvedValue([
        { ...accessoryRow, material: materialAtThanhPham },
      ]);
      const result = await service.getBulkPlan(['1']);
      expect(result[0].materialWarehouseCode).toBe('thanh-pham');
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

    it('remainingToIssue bị chặn bởi Chuyền kiểm (2026-09-04) dù requiredQty theo BOM còn nhiều', async () => {
      // qtyPerUnit=3, checkedQty=2 -> checkedUnits=2 -> checkedCappedQty=6 < requiredQty=30
      prisma.transferCheckResult.groupBy.mockResolvedValue([
        { productionInvoiceItemId: 21n, pieceId: 40n, _sum: { checkedQty: 2 } },
      ]);
      const result = await service.getBulkPlan(['1']);
      expect(result[0].requiredQty).toBe(30);
      expect(result[0].remainingToIssue).toBe(6);
    });

    it('remainingToIssue không âm khi đã xuất vượt trần Chuyền kiểm hiện tại (biên đã xuất trước khi bug này tồn tại)', async () => {
      prisma.transferCheckResult.groupBy.mockResolvedValue([
        { productionInvoiceItemId: 21n, pieceId: 40n, _sum: { checkedQty: 1 } },
      ]);
      prisma.packagingIssue.findMany.mockResolvedValue([
        { productionOrderId: 1n, materialId: 30n, issuedQty: { toNumber: () => 5 } },
      ]);
      // checkedCappedQty = 3*1 = 3, đã xuất 5 -> Math.min(30,3) - 5 = -2 (không clamp về 0 ở DTO,
      // FE tự Math.max(0,...) khi hiển thị - service chỉ trả số thật để không giấu bất thường).
      const result = await service.getBulkPlan(['1']);
      expect(result[0].remainingToIssue).toBe(-2);
    });
  });
});
