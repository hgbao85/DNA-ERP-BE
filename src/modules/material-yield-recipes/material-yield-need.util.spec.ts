import { PrismaTx } from '../../prisma/prisma.service';
import { loadMaterialYieldNeed, materialYieldNeedKey } from './material-yield-need.util';

describe('loadMaterialYieldNeed (P1, 18/11/2026)', () => {
  let db: {
    productionOrder: { findMany: jest.Mock };
    materialYieldRecipe: { findMany: jest.Mock };
    pieceMaterialItem: { findMany: jest.Mock };
    bomPiece: { findMany: jest.Mock };
    materialYieldStepBatch: { groupBy: jest.Mock };
    qcReview: { findMany: jest.Mock };
  };
  const run = (piIds: bigint[]) => loadMaterialYieldNeed(db as unknown as PrismaTx, piIds);

  beforeEach(() => {
    db = {
      // PI 5: 2 SKU (bản định mức 10 x 240 bộ, bản định mức 11 x 100 bộ); PI 6: 1 SKU 50 bộ.
      productionOrder: {
        findMany: jest.fn().mockResolvedValue([
          { bomRevisionId: 10n, quantity: 240, productionInvoiceItem: { productionInvoiceId: 5n } },
          { bomRevisionId: 11n, quantity: 100, productionInvoiceItem: { productionInvoiceId: 5n } },
          { bomRevisionId: 10n, quantity: 50, productionInvoiceItem: { productionInvoiceId: 6n } },
        ]),
      },
      materialYieldRecipe: {
        findMany: jest.fn().mockResolvedValue([
          { id: 7n, outputMaterialId: 60n, processSteps: ['CAT', 'UON'] },
          { id: 8n, outputMaterialId: 61n, processSteps: ['CAT'] },
        ]),
      },
      pieceMaterialItem: {
        findMany: jest.fn().mockResolvedValue([
          // bản 10: mảnh 40 cần 2 chân nhôm (60); bản 11: mảnh 41 cần 3 chân nhôm (60) và mảnh 42 cần 1 (60)
          { bomRevisionId: 10n, pieceId: 40n, materialId: 60n, qtyPerPiece: { toNumber: () => 2 } },
          { bomRevisionId: 11n, pieceId: 41n, materialId: 60n, qtyPerPiece: { toNumber: () => 3 } },
          { bomRevisionId: 11n, pieceId: 42n, materialId: 60n, qtyPerPiece: { toNumber: () => 1 } },
          // dòng của mảnh không còn trong BomPiece: bỏ qua
          { bomRevisionId: 10n, pieceId: 99n, materialId: 60n, qtyPerPiece: { toNumber: () => 5 } },
        ]),
      },
      bomPiece: {
        findMany: jest.fn().mockResolvedValue([
          { bomRevisionId: 10n, pieceId: 40n, qtyPerUnit: 1 },
          { bomRevisionId: 11n, pieceId: 41n, qtyPerUnit: 2 },
          { bomRevisionId: 11n, pieceId: 42n, qtyPerUnit: 1 },
        ]),
      },
      materialYieldStepBatch: { groupBy: jest.fn().mockResolvedValue([]) },
      qcReview: { findMany: jest.fn().mockResolvedValue([]) },
    };
  });

  it('piIds rỗng -> Map rỗng, không truy vấn gì', async () => {
    const result = await run([]);

    expect(result.size).toBe(0);
    expect(db.productionOrder.findMany).not.toHaveBeenCalled();
  });

  it('không có công thức đang bật -> Map rỗng', async () => {
    db.materialYieldRecipe.findMany.mockResolvedValue([]);

    expect((await run([5n])).size).toBe(0);
  });

  it('required = Σ mọi SKU của PI (qtyPerUnit × qtyPerPiece × SL), mỗi công đoạn của công thức cùng số; công thức khác tính riêng', async () => {
    const result = await run([5n, 6n]);

    // PI 5: bản 10: 1 × 2 × 240 = 480; bản 11: (2 × 3 + 1 × 1) × 100 = 700 -> 1180.
    expect(result.get(materialYieldNeedKey(5n, 7n, 'CAT'))).toEqual({ required: 1180, counted: 0 });
    expect(result.get(materialYieldNeedKey(5n, 7n, 'UON'))).toEqual({ required: 1180, counted: 0 });
    // PI 6: 1 × 2 × 50 = 100.
    expect(result.get(materialYieldNeedKey(6n, 7n, 'CAT'))?.required).toBe(100);
    // Công thức 8 (vật tư ra 61) không có dòng định mức nào: required 0 ("không cần theo định mức").
    expect(result.get(materialYieldNeedKey(5n, 8n, 'CAT'))).toEqual({ required: 0, counted: 0 });
    // Khoá chỉ có công đoạn của công thức.
    expect(result.has(materialYieldNeedKey(5n, 8n, 'UON'))).toBe(false);
  });

  it('chỉ lấy công thức đang bật và dòng định mức "tính vào đan" (cùng điều kiện getMaterialYieldPlanBatch)', async () => {
    await run([5n]);

    expect(db.materialYieldRecipe.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
    expect(db.pieceMaterialItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          bomRevisionId: { in: [10n, 11n] },
          materialId: { in: [60n, 61n] },
          includeInWeaving: true,
        }) as unknown,
      }),
    );
  });

  it('counted = Σ qty đã báo - Σ (lỗi + thiếu) KCS của đúng công đoạn; công đoạn khác và PI khác không lẫn', async () => {
    db.materialYieldStepBatch.groupBy.mockResolvedValue([
      { productionInvoiceId: 5n, recipeId: 7n, step: 'CAT', _sum: { qty: 300 } },
      { productionInvoiceId: 5n, recipeId: 7n, step: 'UON', _sum: { qty: 100 } },
      { productionInvoiceId: 6n, recipeId: 7n, step: 'CAT', _sum: { qty: 40 } },
    ]);
    const review = (pi: bigint, step: string, failedQty: number, shortQty: number) => ({
      failedQty,
      shortQty,
      materialYieldStepBundle: { productionInvoiceId: pi, recipeId: 7n, step },
    });
    db.qcReview.findMany.mockResolvedValue([
      review(5n, 'CAT', 10, 5),
      review(5n, 'CAT', 0, 3),
      review(5n, 'UON', 2, 0),
      review(6n, 'CAT', 1, 1),
    ]);

    const result = await run([5n, 6n]);

    expect(result.get(materialYieldNeedKey(5n, 7n, 'CAT'))?.counted).toBe(282); // 300 - (15 + 3)
    expect(result.get(materialYieldNeedKey(5n, 7n, 'UON'))?.counted).toBe(98);
    expect(result.get(materialYieldNeedKey(6n, 7n, 'CAT'))?.counted).toBe(38);
    expect(db.materialYieldStepBatch.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { productionInvoiceId: { in: [5n, 6n] } } }),
    );
  });

  it('lỗi / thiếu có thể làm counted âm khi dữ liệu cũ (báo thiếu số): giữ nguyên, người gọi tự kẹp', async () => {
    db.qcReview.findMany.mockResolvedValue([
      {
        failedQty: 5,
        shortQty: 0,
        materialYieldStepBundle: { productionInvoiceId: 5n, recipeId: 7n, step: 'CAT' },
      },
    ]);

    expect((await run([5n])).get(materialYieldNeedKey(5n, 7n, 'CAT'))?.counted).toBe(-5);
  });
});
