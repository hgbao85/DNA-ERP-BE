import { ReservationStatus } from '../../generated/prisma/client';
import { PrismaTx } from '../../prisma/prisma.service';
import { heldInOtherWorkshop, materialLabel, type Snapshot } from './cut-allocation-snapshot';
import type { SteelGap } from './cut-allocation-types';

/**
 * Các cặp (lệnh, loại sắt) trong `pairKeys` đã xuất ít hơn số cần (issued = Σ steelIssue.barCount,
 * bỏ phiếu làm lại).
 */
export async function loadSteelGaps(
  db: PrismaTx,
  snap: Snapshot,
  pairKeys: string[],
): Promise<Map<string, SteelGap>> {
  const out = new Map<string, SteelGap>();
  if (pairKeys.length === 0) return out;
  const parsed = pairKeys.map((k) => {
    const [pi, mat] = k.split(':');
    return { key: k, piId: BigInt(pi), materialId: BigInt(mat) };
  });
  const issues = await db.steelIssue.groupBy({
    by: ['productionInvoiceId', 'materialId'],
    where: {
      productionInvoiceId: { in: [...new Set(parsed.map((p) => p.piId))] },
      materialId: { in: [...new Set(parsed.map((p) => p.materialId))] },
      reworkOfId: null,
    },
    _sum: { barCount: true },
  });
  const issuedBy = new Map<string, number>();
  for (const i of issues) {
    issuedBy.set(`${i.productionInvoiceId}:${i.materialId}`, i._sum.barCount ?? 0);
  }
  const gaps = parsed.flatMap((p) => {
    const pair = snap.pairs.get(p.key);
    if (!pair) return [];
    const issuedBars = issuedBy.get(p.key) ?? 0;
    return issuedBars < pair.required ? [{ p, pair, issuedBars }] : [];
  });
  if (gaps.length === 0) return out;
  const reservations = await db.stockReservation.findMany({
    where: {
      productionInvoiceId: { in: gaps.map((g) => g.p.piId) },
      materialId: { in: gaps.map((g) => g.p.materialId) },
      status: ReservationStatus.ACTIVE,
    },
    select: {
      productionInvoiceId: true,
      materialId: true,
      quantity: true,
      consumedQty: true,
      warehouse: { select: { code: true, workshopId: true } },
    },
  });
  for (const g of gaps) {
    const codes = new Set<string>();
    for (const r of reservations) {
      if (`${r.productionInvoiceId}:${r.materialId}` !== g.p.key) continue;
      if (heldInOtherWorkshop(r.warehouse.workshopId, snap.workshop.id)) continue;
      if (r.quantity.toNumber() - r.consumedQty.toNumber() > 0) codes.add(r.warehouse.code);
    }
    out.set(g.p.key, {
      materialId: g.p.materialId.toString(),
      materialCode: g.pair.material.code,
      materialLabel: materialLabel(g.pair.material),
      requiredBars: g.pair.required,
      issuedBars: g.issuedBars,
      missingBars: g.pair.required - g.issuedBars,
      warehouseCodes: [...codes].sort(),
    });
  }
  return out;
}
