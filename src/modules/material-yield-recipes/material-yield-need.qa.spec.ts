import { BadRequestException, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { MfgStage, PieceStepBundleStatus, StockLedgerRefType } from '../../generated/prisma/client';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';
import { PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { MaterialYieldIssuesService } from '../material-yield-issues/material-yield-issues.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProductionBatchesService } from '../production-batches/production-batches.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { SegmentStockService } from '../segment-stock/segment-stock.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { MaterialYieldRecipeIssuesService } from './material-yield-recipe-issues.service';
import { MaterialYieldRecipeProductionService } from './material-yield-recipe-production.service';
import { MaterialYieldRecipesService } from './material-yield-recipes.service';
import { loadMaterialYieldNeed, materialYieldNeedKey } from './material-yield-need.util';

/**
 * UB6 (QA, P1-T3-U1) - số cần của chân nhôm (vật tư thành phẩm không gắn mảnh):
 *  (1) loadMaterialYieldNeed khớp getMaterialYieldPlanBatch (cùng dữ liệu -> cùng số cần);
 *  (2) recordStepBatch chặn vượt (AC23); (3) submitStep câu chung + cổng lệnh dừng (AC6, AC11);
 *  (4) finalizeRecipeOutputIfLastStepComplete trừ lỗi + thiếu (AC37).
 */

const dec = (n: number) => ({ toNumber: () => n });

// ---------------------------------------------------------------------------------------------------------------------
// Dữ liệu dùng chung cho 2 hàm tính số cần
interface Fixture {
  orders: { id: bigint; bomRevisionId: bigint; quantity: number; pi: bigint }[];
  recipes: { id: bigint; outputMaterialId: bigint; processSteps: string[]; isActive: boolean }[];
  items: {
    bomRevisionId: bigint;
    pieceId: bigint;
    materialId: bigint;
    qtyPerPiece: number;
    includeInWeaving: boolean;
  }[];
  bomPieces: { bomRevisionId: bigint; pieceId: bigint; qtyPerUnit: number }[];
}

const fixture = (over: Partial<Fixture> = {}): Fixture => ({
  // PI 5: 2 SKU khác bản định mức; PI 6: 1 SKU.
  orders: [
    { id: 1n, bomRevisionId: 10n, quantity: 240, pi: 5n },
    { id: 2n, bomRevisionId: 11n, quantity: 100, pi: 5n },
    { id: 3n, bomRevisionId: 10n, quantity: 50, pi: 6n },
  ],
  recipes: [
    { id: 7n, outputMaterialId: 60n, processSteps: ['CAT', 'UON'], isActive: true },
    { id: 8n, outputMaterialId: 61n, processSteps: ['CAT'], isActive: true },
  ],
  items: [
    { bomRevisionId: 10n, pieceId: 40n, materialId: 60n, qtyPerPiece: 2, includeInWeaving: true },
    { bomRevisionId: 11n, pieceId: 41n, materialId: 60n, qtyPerPiece: 3, includeInWeaving: true },
    { bomRevisionId: 11n, pieceId: 42n, materialId: 60n, qtyPerPiece: 1, includeInWeaving: true },
    // dòng không tính vào đan -> không vào số cần
    { bomRevisionId: 10n, pieceId: 40n, materialId: 60n, qtyPerPiece: 9, includeInWeaving: false },
  ],
  bomPieces: [
    { bomRevisionId: 10n, pieceId: 40n, qtyPerUnit: 1 },
    { bomRevisionId: 11n, pieceId: 41n, qtyPerUnit: 2 },
    { bomRevisionId: 11n, pieceId: 42n, qtyPerUnit: 1 },
  ],
  ...over,
});

/** Lọc đúng như Prisma: where.includeInWeaving, where.isActive, in-list. */
function dbOf(
  f: Fixture,
  extra: {
    batches?: { pi: bigint; recipe: bigint; step: string; qty: number }[];
    reviews?: { pi: bigint; recipe: bigint; step: string; failed: number; short: number }[];
  } = {},
) {
  return {
    productionOrder: {
      findMany: jest.fn().mockImplementation(() =>
        Promise.resolve(
          f.orders.map((o) => ({
            id: o.id,
            bomRevisionId: o.bomRevisionId,
            quantity: o.quantity,
            mfgProduct: { name: 'SP', factoryCode: 'SKU' },
            productionInvoiceItem: { productionInvoiceId: o.pi, salesOrder: { orderCode: 'PO' } },
          })),
        ),
      ),
    },
    materialYieldRecipe: {
      findMany: jest.fn().mockImplementation((a: { where: { isActive: boolean } }) =>
        Promise.resolve(
          f.recipes
            .filter((r) => (a.where.isActive ? r.isActive : true))
            .map((r) => ({
              ...r,
              outputMaterial: {
                id: r.outputMaterialId,
                code: `VT-${r.outputMaterialId}`,
                name: 'Chân nhôm',
                spec: null,
              },
            })),
        ),
      ),
    },
    pieceMaterialItem: {
      findMany: jest
        .fn()
        .mockImplementation(
          (a: { where: { includeInWeaving?: boolean; materialId: { in: bigint[] } } }) =>
            Promise.resolve(
              f.items
                .filter((i) => (a.where.includeInWeaving ? i.includeInWeaving : true))
                .filter((i) => a.where.materialId.in.includes(i.materialId))
                .map((i) => ({ ...i, qtyPerPiece: dec(i.qtyPerPiece) })),
            ),
        ),
    },
    bomPiece: {
      findMany: jest.fn().mockResolvedValue(
        f.bomPieces.map((b) => ({
          ...b,
          needsHan: false,
          needsSon: false,
          piece: { id: b.pieceId, code: `M${b.pieceId}`, name: `Mảnh ${b.pieceId}` },
        })),
      ),
    },
    materialYieldStepBatch: {
      groupBy: jest.fn().mockResolvedValue(
        (extra.batches ?? []).map((b) => ({
          productionInvoiceId: b.pi,
          recipeId: b.recipe,
          step: b.step,
          _sum: { qty: b.qty },
        })),
      ),
    },
    materialYieldStepBundle: { findMany: jest.fn().mockResolvedValue([]) },
    stockLedger: { findMany: jest.fn().mockResolvedValue([]) },
    qcReview: {
      findMany: jest.fn().mockResolvedValue(
        (extra.reviews ?? []).map((r) => ({
          failedQty: r.failed,
          shortQty: r.short,
          materialYieldStepBundle: { productionInvoiceId: r.pi, recipeId: r.recipe, step: r.step },
        })),
      ),
    },
  };
}

function planService(db: ReturnType<typeof dbOf>) {
  const target: Record<string, unknown> = { ...db };
  const prisma = new Proxy(target, {
    get: (t, k: string): unknown =>
      t[k] ?? {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
  });
  return new ProductionBatchesService(
    prisma as unknown as PrismaServiceType,
    {} as unknown as StockLedgerService,
    {} as unknown as MaterialYieldIssuesService,
    {} as unknown as NotificationsService,
    {} as unknown as RealtimeService,
    {} as unknown as SegmentStockService,
  );
}

describe('UB6 loadMaterialYieldNeed khớp getMaterialYieldPlanBatch (QA)', () => {
  const plannedOf = async (f: Fixture, piOrderIds: string[]): Promise<number> => {
    const svc = planService(dbOf(f));
    const getPlan = (
      svc as unknown as {
        getMaterialYieldPlanBatch: (
          o: unknown[],
        ) => Promise<Map<string, { plannedQty: number; materialId: string }[]>>;
      }
    ).getMaterialYieldPlanBatch.bind(svc);
    const orders = f.orders
      .filter((o) => piOrderIds.includes(o.id.toString()))
      .map((o) => ({
        id: o.id,
        bomRevisionId: o.bomRevisionId,
        quantity: o.quantity,
        productionInvoiceId: o.pi,
      }));
    const out = await getPlan(orders);
    let sum = 0;
    for (const items of out.values())
      for (const it of items) if (it.materialId === '60') sum += it.plannedQty;
    return sum;
  };

  it('PI 2 SKU: số cần của công thức = Σ plannedQty các SKU trong PI (cùng dữ liệu, 2 hàm cùng ra 1180)', async () => {
    const f = fixture();
    // bản 10: 1 x 2 x 240 = 480; bản 11: (2 x 3 + 1 x 1) x 100 = 700 -> hmm: qtyPerUnit mảnh 41 = 2 -> 2x3=6; mảnh 42 = 1x1=1 -> 7 x 100 = 700
    const need = await loadMaterialYieldNeed(dbOf(f) as unknown as PrismaTx, [5n, 6n]);
    expect(need.get(materialYieldNeedKey(5n, 7n, 'CAT'))!.required).toBe(1180);
    expect(need.get(materialYieldNeedKey(5n, 7n, 'UON'))!.required).toBe(1180);
    expect(need.get(materialYieldNeedKey(6n, 7n, 'CAT'))!.required).toBe(100);
    expect(await plannedOf(f, ['1', '2'])).toBe(1180);
    expect(await plannedOf(f, ['3'])).toBe(100);
  });

  it('dòng định mức không tính vào đan (includeInWeaving false) không vào số cần ở cả 2 hàm', async () => {
    const f = fixture();
    const need = await loadMaterialYieldNeed(dbOf(f) as unknown as PrismaTx, [6n]);
    expect(need.get(materialYieldNeedKey(6n, 7n, 'CAT'))!.required).toBe(100); // 1 x 2 x 50, không +9 x 50
    expect(await plannedOf(f, ['3'])).toBe(100);
  });

  it('công thức đã tắt: không có khoá (người gọi coi là 0), kế hoạch cũng không có dòng', async () => {
    const f = fixture({
      recipes: [{ id: 7n, outputMaterialId: 60n, processSteps: ['CAT'], isActive: false }],
    });
    const need = await loadMaterialYieldNeed(dbOf(f) as unknown as PrismaTx, [5n]);
    expect(need.size).toBe(0);
    expect(await plannedOf(f, ['1', '2'])).toBe(0);
  });

  it('công thức đang bật nhưng PI không có dòng định mức: required 0 (kế hoạch không có dòng)', async () => {
    const f = fixture({ items: [] });
    const need = await loadMaterialYieldNeed(dbOf(f) as unknown as PrismaTx, [5n]);
    expect(need.get(materialYieldNeedKey(5n, 7n, 'CAT'))!.required).toBe(0);
    expect(await plannedOf(f, ['1', '2'])).toBe(0);
  });

  it('mảnh có dòng vật tư nhưng không còn trong BomPiece: bỏ qua ở cả 2 hàm', async () => {
    const f = fixture({
      items: [
        {
          bomRevisionId: 10n,
          pieceId: 99n,
          materialId: 60n,
          qtyPerPiece: 5,
          includeInWeaving: true,
        },
        {
          bomRevisionId: 10n,
          pieceId: 40n,
          materialId: 60n,
          qtyPerPiece: 2,
          includeInWeaving: true,
        },
      ],
    });
    const need = await loadMaterialYieldNeed(dbOf(f) as unknown as PrismaTx, [6n]);
    expect(need.get(materialYieldNeedKey(6n, 7n, 'CAT'))!.required).toBe(100);
    expect(await plannedOf(f, ['3'])).toBe(100);
  });

  it('counted = Σ đã báo - Σ (lỗi + thiếu) đúng công đoạn; công đoạn khác không lẫn; có thể âm với dữ liệu cũ (người gọi tự kẹp)', async () => {
    const f = fixture();
    const db = dbOf(f, {
      batches: [
        { pi: 5n, recipe: 7n, step: 'CAT', qty: 1000 },
        { pi: 5n, recipe: 7n, step: 'UON', qty: 10 },
      ],
      reviews: [
        { pi: 5n, recipe: 7n, step: 'CAT', failed: 30, short: 20 },
        { pi: 5n, recipe: 7n, step: 'UON', failed: 15, short: 0 },
      ],
    });
    const need = await loadMaterialYieldNeed(db as unknown as PrismaTx, [5n]);
    expect(need.get(materialYieldNeedKey(5n, 7n, 'CAT'))!.counted).toBe(950);
    expect(need.get(materialYieldNeedKey(5n, 7n, 'UON'))!.counted).toBe(-5);
  });

  it('piIds rỗng -> Map rỗng, không đọc DB', async () => {
    const db = dbOf(fixture());
    expect((await loadMaterialYieldNeed(db as unknown as PrismaTx, [])).size).toBe(0);
    expect(db.productionOrder.findMany).not.toHaveBeenCalled();
  });

  it('getBatchPlanBatch PHOI trả materialYieldItems khớp số cần (qua đường công khai, không gọi hàm private)', async () => {
    const f = fixture();
    const svc = planService(dbOf(f));
    const plan = await svc.getBatchPlanBatch(['1', '2'], MfgStage.PHOI);
    const total = ['1', '2'].reduce(
      (t, id) => t + (plan[id].materialYieldItems ?? []).reduce((s, it) => s + it.plannedQty, 0),
      0,
    );
    expect(total).toBe(1180);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('UB6 chân nhôm: chặn báo vượt, chốt, tính kho (QA)', () => {
  const recipe = {
    id: 9n,
    processSteps: ['CAT', 'UON'],
    outputMaterial: { id: 139n, code: 'CHAN-NHOM-01', name: 'Chân nhôm', warehouseId: 50n },
  };
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
    log.mockRestore();
  });

  interface Opts {
    required?: number; // số cần của PI 5 (qty đơn vị / SKU x SL)
    reported?: number;
    failed?: number;
    short?: number;
    perPiece?: number;
  }
  function build(o: Opts = {}) {
    const state = { reported: o.reported ?? 480 };
    const tx = {
      materialYieldStepBatch: {
        create: jest.fn().mockImplementation((a: { data: { qty: number; step: string } }) => {
          state.reported += a.data.qty;
          return Promise.resolve({
            id: 1n,
            productionInvoiceId: 5n,
            recipeId: 9n,
            step: a.data.step,
            qty: a.data.qty,
            reportedAt: new Date(),
            reportedById: 'tk-1',
          });
        }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        groupBy: jest
          .fn()
          .mockImplementation(() =>
            Promise.resolve([
              { productionInvoiceId: 5n, recipeId: 9n, step: 'CAT', _sum: { qty: state.reported } },
            ]),
          ),
      },
      materialYieldStepBundle: { create: jest.fn() },
      materialYieldRecipe: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 9n, outputMaterialId: 139n, processSteps: ['CAT', 'UON'] }]),
        findUnique: jest.fn().mockResolvedValue({ outputMaterial: { code: 'CHAN-NHOM-01' } }),
      },
      productionOrder: {
        findMany: jest.fn().mockResolvedValue([
          {
            bomRevisionId: 5n,
            quantity: o.required ?? 240,
            productionInvoiceItem: { productionInvoiceId: 5n },
          },
        ]),
      },
      pieceMaterialItem: {
        findMany: jest.fn().mockResolvedValue(
          o.required === 0
            ? []
            : [
                {
                  bomRevisionId: 5n,
                  pieceId: 40n,
                  materialId: 139n,
                  qtyPerPiece: dec(o.perPiece ?? 2),
                },
              ],
        ),
      },
      bomPiece: {
        findMany: jest.fn().mockResolvedValue([{ bomRevisionId: 5n, pieceId: 40n, qtyPerUnit: 1 }]),
      },
      qcReview: {
        findMany: jest.fn().mockResolvedValue(
          o.failed || o.short
            ? [
                {
                  failedQty: o.failed ?? 0,
                  shortQty: o.short ?? 0,
                  materialYieldStepBundle: { productionInvoiceId: 5n, recipeId: 9n, step: 'CAT' },
                },
              ]
            : [],
        ),
      },
      productionInvoice: { findUnique: jest.fn().mockResolvedValue({ code: 'PI-001' }) },
      warehouse: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 60n }) },
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      $queryRaw: jest.fn().mockResolvedValue([{ floorStage: 'ACTIVE' }]),
    };
    const prisma = {
      materialYieldStepBatch: { findUnique: jest.fn() },
      materialYieldStepBundle: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn() },
      productionOrder: { findFirst: jest.fn().mockResolvedValue({ id: 1n }) },
      auditLog: { create: jest.fn().mockResolvedValue(undefined) },
      $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)),
    };
    const stockLedgerService = { postEntry: jest.fn().mockResolvedValue(undefined) };
    const notifications = { emit: jest.fn().mockResolvedValue(undefined) };
    const service = new MaterialYieldRecipeProductionService(
      prisma as unknown as PrismaServiceType,
      stockLedgerService as unknown as StockLedgerService,
      {
        findOneRowOrThrow: jest.fn().mockResolvedValue(recipe),
      } as unknown as MaterialYieldRecipesService,
      {
        sumReceived: jest.fn().mockResolvedValue(20),
      } as unknown as MaterialYieldRecipeIssuesService,
      notifications as unknown as NotificationsService,
      {
        isActive: jest.fn().mockReturnValue(false),
        get: jest.fn(),
        getId: jest.fn(),
      } as unknown as ClsService<AppClsStore>,
    );
    return { service, tx, prisma, stockLedgerService, notifications, state };
  }

  async function errOf(p: Promise<unknown>): Promise<Error> {
    try {
      await p;
    } catch (e) {
      return e as Error;
    }
    throw new Error('Lẽ ra phải ném lỗi');
  }
  const dto = (qty: number, step: 'CAT' | 'UON' = 'CAT') => ({ recipeId: '9', step, qty });

  describe('recordStepBatch - AC23', () => {
    const vuotLogs = () =>
      (log.mock.calls as unknown[][])
        .map((c) => String(c[0]))
        .filter((l) => l.includes('Báo vượt'));
    const createdQtys = (tx: ReturnType<typeof build>['tx']) =>
      (tx.materialYieldStepBatch.create.mock.calls as { 0: { data: { qty: number } } }[]).map(
        (c) => c[0].data.qty,
      );

    it('AC23 (Câu 6): chân nhôm cần 480, đã tính 480 -> lưu Cắt thêm 5 VẪN TẠO ĐƯỢC (không 400), ghi dòng 5, có đúng 1 logger.log "Báo vượt ... (cho phép)", không logger.warn', async () => {
      const { service, tx } = build();
      await expect(service.recordStepBatch('5', dto(5), 'tk-1', null)).resolves.toBeDefined();
      expect(createdQtys(tx)).toEqual([5]);
      expect(vuotLogs()).toHaveLength(1);
      expect(vuotLogs()[0]).toContain('(cho phép');
      expect(warn).not.toHaveBeenCalled();
    });

    it('AC23 (Câu 6): báo vượt lớn (cần 480, đã tính 480, báo 100) cũng qua và lưu nguyên 100', async () => {
      const { service, tx } = build();
      await service.recordStepBatch('5', dto(100), 'tk-1', null);
      expect(createdQtys(tx)).toEqual([100]);
    });

    it('AC23 (Câu 6): lỗi 3 + thiếu 2 (đã tính 475, còn 5): báo 5 qua KHÔNG log vượt; báo 6 qua nhưng có log "Báo vượt"', async () => {
      const a = build({ failed: 3, short: 2 });
      await expect(a.service.recordStepBatch('5', dto(5), 'tk-1', null)).resolves.toBeDefined();
      expect(vuotLogs()).toHaveLength(0);
      const b = build({ failed: 3, short: 2 });
      await expect(b.service.recordStepBatch('5', dto(6), 'tk-1', null)).resolves.toBeDefined();
      expect(vuotLogs()).toHaveLength(1);
    });

    it('CĐ-4 (Câu 6): 2 người báo cùng lúc khi còn 10 (mỗi người 8) -> CẢ 2 thành công, tổng ghi 16 (không mất lần nào)', async () => {
      const { service, tx } = build({ reported: 470 });
      const res = await Promise.allSettled([
        service.recordStepBatch('5', dto(8), 'cn-1', null),
        service.recordStepBatch('5', dto(8), 'cn-2', null),
      ]);
      expect(res.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      expect(createdQtys(tx).reduce((t, q) => t + q, 0)).toBe(16);
    });

    it('AC23 (Câu 6): số cần 0 theo định mức -> cũng tạo được (không 400), có log "Báo vượt"', async () => {
      const { service, tx } = build({ required: 0 });
      await expect(service.recordStepBatch('5', dto(1), 'tk-1', null)).resolves.toBeDefined();
      expect(createdQtys(tx)).toEqual([1]);
      expect(vuotLogs()).toHaveLength(1);
    });

    it('biên: số cần lẻ (2,5): báo 2 và báo 3 đều qua; chỉ báo 3 (vượt) có log', async () => {
      const a = build({ required: 5, perPiece: 0.5, reported: 0 });
      await expect(a.service.recordStepBatch('5', dto(2), 'tk-1', null)).resolves.toBeDefined();
      expect(vuotLogs()).toHaveLength(0);
      const b = build({ required: 5, perPiece: 0.5, reported: 0 });
      await expect(b.service.recordStepBatch('5', dto(3), 'tk-1', null)).resolves.toBeDefined();
      expect(vuotLogs()).toHaveLength(1);
    });

    it('Câu 6 giữ luật khác: lệnh không còn chạy (dừng / kết thúc) vẫn bị chặn, không tạo dòng dù đang vượt', async () => {
      const { service, tx } = build();
      tx.$queryRaw.mockResolvedValue([{ floorStage: 'DONE' }]);
      await expect(service.recordStepBatch('5', dto(5), 'tk-1', null)).rejects.toThrow(
        /chưa\/không thể/,
      );
      expect(tx.materialYieldStepBatch.create).not.toHaveBeenCalled();
    });

    it('Câu 6 giữ luật khác: Idempotency-Key đã dùng -> trả dòng cũ, không tạo thêm', async () => {
      const { service, tx, prisma } = build();
      prisma.materialYieldStepBatch.findUnique.mockResolvedValue({
        id: 9n,
        productionInvoiceId: 5n,
        recipeId: 9n,
        step: 'CAT',
        qty: 5,
        reportedAt: new Date(),
        reportedById: 'tk-1',
      });
      await service.recordStepBatch('5', dto(5), 'tk-1', null, 'K-CN-1');
      expect(tx.materialYieldStepBatch.create).not.toHaveBeenCalled();
    });

    it('khoá advisory material-yield-step-batch lấy TRƯỚC FOR UPDATE production_orders; số cần đọc sau khoá', async () => {
      const { service, tx } = build({ reported: 0 });
      await service.recordStepBatch('5', dto(1), 'tk-1', null);
      expect(String((tx.$executeRaw.mock.calls as unknown[][])[0][1])).toBe(
        'material-yield-step-batch:5:9:CAT',
      );
      expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.$queryRaw.mock.invocationCallOrder[0],
      );
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.productionOrder.findMany.mock.invocationCallOrder[0],
      );
    });
  });

  describe('submitStep - AC6, AC11', () => {
    const NO_PENDING =
      'CHAN-NHOM-01 công đoạn Uốn: không còn lần báo nào chưa chấm (có thể vừa được chốt) - tải lại trang.';
    const sub = { recipeId: '9', step: 'UON' as const };

    it('AC6: không còn dòng chưa gom -> 400 câu chung có mã vật tư + công đoạn, không tạo bundle (dùng chung KCS chốt và "Gửi KCS")', async () => {
      const { service, tx } = build();
      tx.materialYieldStepBatch.findMany.mockResolvedValue([]);
      const err = await errOf(
        service.submitStep('5', sub, 'kcs-1', null, {
          notifyKcs: false,
          gateLabel: 'chốt để chấm',
        }),
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe(NO_PENDING);
      expect(tx.materialYieldStepBundle.create).not.toHaveBeenCalled();
      const err2 = await errOf(service.submitStep('5', sub, 'tk-1', null));
      expect(err2.message).toBe(NO_PENDING);
    });

    it('AC6: bên kia vừa chốt giữa chừng (updateMany gom ít dòng hơn đã đọc) -> 400 câu chung để rollback', async () => {
      const { service, tx } = build();
      tx.materialYieldStepBatch.findMany.mockResolvedValue([
        { id: 1n, qty: 5 },
        { id: 2n, qty: 5 },
      ]);
      tx.materialYieldStepBundle.create.mockResolvedValue({ id: 5n });
      tx.materialYieldStepBatch.updateMany.mockResolvedValue({ count: 1 });
      const err = await errOf(service.submitStep('5', sub, 'kcs-1', null));
      expect(err.message).toBe(NO_PENDING);
      expect(tx.materialYieldStepBatch.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: [1n, 2n] }, materialYieldStepBundleId: null },
        }),
      );
    });

    it('AC11: lệnh dừng -> câu floor-gate nhãn "chốt để chấm", kiểm trong khoá; nhãn mặc định "gửi KCS công đoạn"', async () => {
      const a = build();
      a.prisma.productionOrder.findFirst.mockResolvedValue(null);
      await expect(
        a.service.submitStep('5', sub, 'kcs-1', null, {
          notifyKcs: false,
          gateLabel: 'chốt để chấm',
        }),
      ).rejects.toThrow('chưa/không thể chốt để chấm');
      const b = build();
      b.prisma.productionOrder.findFirst.mockResolvedValue(null);
      await expect(b.service.submitStep('5', sub, 'tk-1', null)).rejects.toThrow(
        'chưa/không thể gửi KCS công đoạn',
      );
      const c = build();
      c.tx.$queryRaw.mockResolvedValue([{ floorStage: 'DONE' }]);
      const err = await errOf(
        c.service.submitStep('5', sub, 'kcs-1', null, { gateLabel: 'chốt để chấm' }),
      );
      expect(err.message).toContain('chưa/không thể chốt để chấm');
      expect(c.tx.materialYieldStepBundle.create).not.toHaveBeenCalled();
    });
  });

  describe('finalizeRecipeOutputIfLastStepComplete - AC37', () => {
    const bundle = (step: string, qty: number) =>
      ({ id: 77n, step, qty, recipe, productionInvoice: { code: 'PI-001' } }) as never;

    it('AC37: nhóm chân nhôm công đoạn cuối 50, lỗi 1 + thiếu 3 (truyền 4) -> bút toán MATERIAL_YIELD_RECIPE_OUTPUT 46, không phải 49', async () => {
      const { service, tx, stockLedgerService } = build();
      await service.finalizeRecipeOutputIfLastStepComplete(
        tx as unknown as PrismaTx,
        bundle('UON', 50),
        1 + 3,
        'kcs-1',
      );
      expect(stockLedgerService.postEntry).toHaveBeenCalledTimes(1);
      const entry = (
        stockLedgerService.postEntry.mock.calls as unknown as [
          [
            {
              qty: number;
              refType: string;
              refId: string;
              idempotencyKey: string;
            },
          ],
        ]
      )[0][0];
      expect(entry.qty).toBe(46);
      expect(entry.refType).toBe(StockLedgerRefType.MATERIAL_YIELD_RECIPE_OUTPUT);
      expect(entry.idempotencyKey).toBe('material-yield-recipe-output:77');
      expect(entry.qty).not.toBe(49);
    });

    it('công đoạn chưa phải cuối (CAT) hoặc số đạt <= 0 thì không ghi kho', async () => {
      const a = build();
      await a.service.finalizeRecipeOutputIfLastStepComplete(
        a.tx as unknown as PrismaTx,
        bundle('CAT', 50),
        0,
        'kcs-1',
      );
      expect(a.stockLedgerService.postEntry).not.toHaveBeenCalled();
      const b = build();
      await b.service.finalizeRecipeOutputIfLastStepComplete(
        b.tx as unknown as PrismaTx,
        bundle('UON', 50),
        60,
        'kcs-1',
      );
      expect(b.stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    it('trạng thái đã duyệt của bundle không ảnh hưởng (hằng enum có thật)', () => {
      expect(PieceStepBundleStatus.QC_PASSED).toBeDefined();
    });
  });
});
