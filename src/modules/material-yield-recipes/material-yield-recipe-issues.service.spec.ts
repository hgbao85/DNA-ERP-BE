import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
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
