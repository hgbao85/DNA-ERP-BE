import { PrismaTx } from '../../prisma/prisma.service';
import { NOT_CANCELLED_ORDER } from '../../common/utils/cancelled-order.util';

/** Số cần / số đã tính của 1 công đoạn vật tư thành phẩm không gắn mảnh (chân nhôm) của 1 PI. */
export interface MaterialYieldNeed {
  /** Σ nhu cầu của MỌI SKU trong PI (BomPiece.qtyPerUnit × PieceMaterialItem.qtyPerPiece × SL SKU). Mỗi công đoạn của công thức cần đủ số này. */
  required: number;
  /** Σ MaterialYieldStepBatch.qty - Σ (lỗi + thiếu) KCS đã ghi của đúng công đoạn này. Số lỗi / thiếu được báo bù. */
  counted: number;
}

/** Khoá của kết quả: `${productionInvoiceId}:${recipeId}:${step}`. */
export function materialYieldNeedKey(
  productionInvoiceId: bigint | string,
  recipeId: bigint | string,
  step: string,
): string {
  return `${productionInvoiceId}:${recipeId}:${step}`;
}

/**
 * Số cần + số đã tính của từng (PI, công thức, công đoạn) cho vật tư thành phẩm không gắn mảnh (P1, 18/11/2026). Cùng công thức
 * `required` với ProductionBatchesService.getMaterialYieldPlanBatch (Σ theo mọi SKU của PI, công thức đang bật, chỉ dòng
 * định mức "tính vào đan"): dùng cho số cần ghi log báo vượt (recordStepBatch, không chặn - quyết định 19/11) và cho nhóm chân nhôm ở màn KCS.
 * Công thức không có dòng định mức nào ở PI -> required = 0 (người gọi hiểu là "không cần theo định mức").
 * Chỉ đọc; `db` là tx khi gọi trong khoá.
 */
export async function loadMaterialYieldNeed(
  db: PrismaTx,
  piIds: bigint[],
): Promise<Map<string, MaterialYieldNeed>> {
  const result = new Map<string, MaterialYieldNeed>();
  if (piIds.length === 0) return result;

  const [piOrders, recipes] = await Promise.all([
    db.productionOrder.findMany({
      where: { productionInvoiceItem: { productionInvoiceId: { in: piIds } }, ...NOT_CANCELLED_ORDER },
      select: {
        bomRevisionId: true,
        quantity: true,
        productionInvoiceItem: { select: { productionInvoiceId: true } },
      },
    }),
    db.materialYieldRecipe.findMany({
      where: { isActive: true },
      select: { id: true, outputMaterialId: true, processSteps: true },
    }),
  ]);
  if (recipes.length === 0) return result;

  const revisionIds = [...new Set(piOrders.map((o) => o.bomRevisionId))];
  const [lines, bomPieces] =
    revisionIds.length === 0
      ? [[], []]
      : await Promise.all([
          db.pieceMaterialItem.findMany({
            where: {
              bomRevisionId: { in: revisionIds },
              materialId: { in: recipes.map((r) => r.outputMaterialId) },
              includeInWeaving: true,
            },
            select: { bomRevisionId: true, pieceId: true, materialId: true, qtyPerPiece: true },
          }),
          db.bomPiece.findMany({
            where: { bomRevisionId: { in: revisionIds } },
            select: { bomRevisionId: true, pieceId: true, qtyPerUnit: true },
          }),
        ]);

  const qtyPerUnitByRevPiece = new Map(
    bomPieces.map((bp) => [`${bp.bomRevisionId}:${bp.pieceId}`, bp.qtyPerUnit]),
  );
  // Định mức vật tư ra / 1 đơn vị SKU, khoá `${revisionId}:${materialId}`.
  const perUnitByRevMaterial = new Map<string, number>();
  for (const line of lines) {
    const qtyPerUnit = qtyPerUnitByRevPiece.get(`${line.bomRevisionId}:${line.pieceId}`);
    if (qtyPerUnit == null) continue;
    const key = `${line.bomRevisionId}:${line.materialId}`;
    perUnitByRevMaterial.set(
      key,
      (perUnitByRevMaterial.get(key) ?? 0) + qtyPerUnit * line.qtyPerPiece.toNumber(),
    );
  }

  const [batchRows, reviewRows] = await Promise.all([
    db.materialYieldStepBatch.groupBy({
      by: ['productionInvoiceId', 'recipeId', 'step'],
      where: { productionInvoiceId: { in: piIds } },
      _sum: { qty: true },
    }),
    db.qcReview.findMany({
      where: { materialYieldStepBundle: { productionInvoiceId: { in: piIds } } },
      select: {
        failedQty: true,
        shortQty: true,
        materialYieldStepBundle: {
          select: { productionInvoiceId: true, recipeId: true, step: true },
        },
      },
    }),
  ]);
  const reportedByKey = new Map<string, number>();
  for (const r of batchRows) {
    reportedByKey.set(
      materialYieldNeedKey(r.productionInvoiceId, r.recipeId, r.step),
      r._sum.qty ?? 0,
    );
  }
  const notPassedByKey = new Map<string, number>();
  for (const r of reviewRows) {
    const b = r.materialYieldStepBundle;
    if (!b) continue;
    const key = materialYieldNeedKey(b.productionInvoiceId, b.recipeId, b.step);
    notPassedByKey.set(key, (notPassedByKey.get(key) ?? 0) + r.failedQty + r.shortQty);
  }

  for (const piId of piIds) {
    const ordersOfPi = piOrders.filter((o) => o.productionInvoiceItem.productionInvoiceId === piId);
    for (const recipe of recipes) {
      let required = 0;
      for (const o of ordersOfPi) {
        required +=
          (perUnitByRevMaterial.get(`${o.bomRevisionId}:${recipe.outputMaterialId}`) ?? 0) *
          o.quantity;
      }
      for (const step of recipe.processSteps) {
        const key = materialYieldNeedKey(piId, recipe.id, step);
        result.set(key, {
          required,
          counted: (reportedByKey.get(key) ?? 0) - (notPassedByKey.get(key) ?? 0),
        });
      }
    }
  }
  return result;
}
