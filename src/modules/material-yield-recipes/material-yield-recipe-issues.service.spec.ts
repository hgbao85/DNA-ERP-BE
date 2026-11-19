import { BadRequestException, ConflictException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { StockReservationsService } from '../stock/stock-reservations.service';
import { MaterialYieldRecipeIssuesService } from './material-yield-recipe-issues.service';
import { MaterialYieldRecipesService } from './material-yield-recipes.service';

/** N-1 (báo cáo 07/10): nhánh "vật tư thành phẩm không gắn mảnh" từng KHÔNG phát thông báo nào. */
describe('MaterialYieldRecipeIssuesService - thông báo', () => {
  let service: MaterialYieldRecipeIssuesService;
  let prisma: {
    productionOrder: { findFirst: jest.Mock };
    auditLog: { create: jest.Mock };
    materialYieldRecipeIssue: {
      findUnique: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
  };
  let notifications: { emit: jest.Mock; resolve: jest.Mock };

  const issueRow = {
    id: 5n,
    productionInvoiceId: 9n,
    recipeId: 2n,
    status: 'ISSUED',
    issuedQty: { toNumber: () => 10 },
    productionInvoice: { code: 'PI-2026-038' },
    issuedAt: new Date('2026-10-08T00:00:00Z'),
    issuedById: 'u0',
    receivedQty: null,
    receivedAt: null,
    receivedById: null,
    recipe: {
      inputMaterialId: 77n,
      inputMaterial: { code: 'NHOM-01', unit: 'cây', name: 'Thanh nhôm' },
    },
  };

  beforeEach(() => {
    prisma = {
      productionOrder: { findFirst: jest.fn().mockResolvedValue({ id: 1n }) },
      auditLog: { create: jest.fn().mockResolvedValue(undefined) },
      materialYieldRecipeIssue: {
        findUnique: jest.fn().mockResolvedValue(issueRow),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ ...issueRow, status: 'RECEIVED' }),
      },
    };
    notifications = {
      emit: jest.fn().mockResolvedValue(undefined),
      resolve: jest.fn().mockResolvedValue(undefined),
    };
    service = new MaterialYieldRecipeIssuesService(
      prisma as unknown as PrismaServiceType,
      {} as unknown as StockLedgerService,
      {} as unknown as StockReservationsService,
      {} as unknown as MaterialYieldRecipesService,
      notifications as unknown as NotificationsService,
      {
        isActive: jest.fn().mockReturnValue(false),
        get: jest.fn(),
        getId: jest.fn(),
      } as unknown as ClsService<AppClsStore>,
    );
  });

  it('Phôi xác nhận nhận -> tự đóng thông báo "nguyên liệu đã xuất"', async () => {
    await service.receive('5', {}, 'u1', 'PHOI');

    expect(notifications.resolve).toHaveBeenCalledWith({
      entityType: 'MATERIAL_YIELD_RECIPE_ISSUE',
      entityId: '5',
      types: ['MATERIAL_YIELD_RECIPE_ISSUE_TO_PHOI'],
    });
  });

  it('ghi audit khi Phôi xác nhận nhận nguyên liệu (P2 mục 31)', async () => {
    await service.receive('5', {}, 'u1', 'PHOI');

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tableName: 'MaterialYieldRecipeIssue',
        recordId: '5',
        oldValue: { status: 'ISSUED' },
        newValue: { status: 'RECEIVED', receivedQty: 10, issuedQty: 10 },
      }) as unknown,
    });
  });

  it('lỗi đóng thông báo KHÔNG làm hỏng việc xác nhận nhận đã ghi', async () => {
    notifications.resolve.mockRejectedValue(new Error('boom'));

    await expect(service.receive('5', {}, 'u1', 'PHOI')).resolves.toBeDefined();
  });
});

/** Rà soát 14/11 XK3: xuất theo công thức chặn vượt định mức như các luồng tiêu hao / vật tư thành phẩm / đóng gói. */
describe('MaterialYieldRecipeIssuesService - trần định mức (XK3)', () => {
  const prepared = {
    piId: 9n,
    recipeBigId: 2n,
    inputMaterial: { id: 77n, name: 'Thanh nhôm' },
    warehouse: { id: 6n, code: 'phoi-son-han' },
    issuedQty: 5,
    plannedQty: 12,
  };
  let tx: {
    $executeRaw: jest.Mock;
    $queryRaw: jest.Mock;
    materialYieldRecipeIssue: { aggregate: jest.Mock; create: jest.Mock };
  };
  let service: MaterialYieldRecipeIssuesService;
  let reservations: { getAvailableQty: jest.Mock; drainPoolBestEffort: jest.Mock };

  beforeEach(() => {
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest
        .fn()
        // floor gate (FOR UPDATE lệnh) rồi dòng tồn.
        .mockResolvedValueOnce([{ floorStage: 'ACTIVE' }])
        .mockResolvedValueOnce([{ qty: { toNumber: () => 100 } }]),
      materialYieldRecipeIssue: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { issuedQty: { toNumber: () => 8 } } }),
        create: jest.fn(),
      },
    };
    reservations = {
      getAvailableQty: jest.fn().mockResolvedValue(100),
      drainPoolBestEffort: jest.fn().mockResolvedValue(undefined),
    };
    service = new MaterialYieldRecipeIssuesService(
      {} as unknown as PrismaServiceType,
      {} as unknown as StockLedgerService,
      reservations as unknown as StockReservationsService,
      {} as unknown as MaterialYieldRecipesService,
      {} as unknown as NotificationsService,
      {} as unknown as ClsService<AppClsStore>,
    );
  });

  it('xuất vượt định mức còn lại (định mức − đã xuất của PI + công thức) -> 400, không ghi', async () => {
    const err = await service.createInTx(tx as never, prepared, 'u1').catch((e: Error) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toContain('định mức 12, đã xuất 8, còn 4');
    expect(tx.materialYieldRecipeIssue.aggregate).toHaveBeenCalledWith({
      where: { productionInvoiceId: 9n, recipeId: 2n },
      _sum: { issuedQty: true },
    });
    expect(tx.materialYieldRecipeIssue.create).not.toHaveBeenCalled();
  });

  it('HS3 18/11: khoá đúng ô tồn chiều dài 0 + quy cách rỗng', async () => {
    tx.materialYieldRecipeIssue.aggregate.mockResolvedValue({
      _sum: { issuedQty: { toNumber: () => 0 } },
    });
    reservations.getAvailableQty.mockResolvedValue(0);
    await service.createInTx(tx as never, prepared, 'u1').catch(() => undefined);
    const stockQuery = (tx.$queryRaw.mock.calls[1] as [TemplateStringsArray])[0].join('?');
    expect(stockQuery).toContain('"stockLengthMm" = 0 AND "spec" = \'\'');
  });

  it('HS1 18/11: tồn 100 nhưng PI khác giữ hết (khả dụng 3) -> 409, không ghi; trừ giữ chỗ của PI khác, không trừ của chính PI', async () => {
    tx.materialYieldRecipeIssue.aggregate.mockResolvedValue({
      _sum: { issuedQty: { toNumber: () => 0 } },
    });
    reservations.getAvailableQty.mockResolvedValue(3);
    const err = await service.createInTx(tx as never, prepared, 'u1').catch((e: Error) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(reservations.getAvailableQty).toHaveBeenCalledWith(tx, 6n, 77n, 100, undefined, 9n);
    expect(tx.materialYieldRecipeIssue.create).not.toHaveBeenCalled();
    expect(reservations.drainPoolBestEffort).not.toHaveBeenCalled();
  });
});

describe('MaterialYieldRecipesService.plannedInputQtyForPi (XK3)', () => {
  it('⌈Σ vật tư ra theo định mức các SKU của PI ÷ số thanh ra/cây⌉, không trừ tồn vật tư ra', async () => {
    const db = {
      productionOrder: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1n, bomRevisionId: 5n, quantity: 10 },
          { id: 2n, bomRevisionId: 6n, quantity: 3 },
        ]),
      },
      pieceMaterialItem: {
        findMany: jest.fn().mockResolvedValue([
          { bomRevisionId: 5n, pieceId: 20n, materialId: 88n, qtyPerPiece: { toNumber: () => 2 } },
          { bomRevisionId: 6n, pieceId: 21n, materialId: 88n, qtyPerPiece: { toNumber: () => 1 } },
        ]),
      },
      bomPiece: {
        findMany: jest.fn().mockResolvedValue([
          { bomRevisionId: 5n, pieceId: 20n, qtyPerUnit: 4 },
          { bomRevisionId: 6n, pieceId: 21n, qtyPerUnit: 2 },
        ]),
      },
    };
    const recipes = new MaterialYieldRecipesService(db as unknown as PrismaServiceType);
    // 2×4×10 + 1×2×3 = 86 chân nhôm, 4 chân/cây -> ⌈21.5⌉ = 22 cây.
    await expect(
      recipes.plannedInputQtyForPi(db as never, 9n, { outputMaterialId: 88n, piecesPerBar: 4 }),
    ).resolves.toBe(22);
  });
});
