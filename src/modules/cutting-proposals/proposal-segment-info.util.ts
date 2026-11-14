import { ProcessStep } from '../../generated/prisma/client';
import type { PrismaTx } from '../../prisma/prisma.service';

/**
 * Dữ liệu định mức dùng chung cho phân loại máy của phương án cắt (13/11/2026):
 * `classifyProposalMachines` (findOne) và
 * bảng "Chia máy cắt" (floor/cut-allocation). Chạy GỘP cho nhiều phương án - số truy vấn không phụ
 * thuộc số phương án.
 *
 * Bước 1 `resolveProposalBomEntries`: nguồn định mức + số bộ theo loại phương án (giống
 * buildOrderJob/buildInvoiceJob/buildBatchJob).
 * Bước 2 `loadSegmentProcessInfo`: nhu cầu đoạn DẬP và các bước công đoạn theo (loại sắt, chiều dài
 * đoạn).
 */

/** 1 định mức + số bộ cần làm của phương án. */
export interface BomEntry {
  bomRevisionId: bigint;
  quantity: number;
}

/** Phần của phương án cắt dùng để suy ra định mức. */
export interface ProposalBomSource {
  id: bigint;
  productionInvoiceId: bigint | null;
  productionOrder: { bomRevisionId: bigint; quantity: number } | null;
  /** Ảnh chụp đầu vào của lượt tính trước PI (CuttingProposalItem). */
  items: BomEntry[];
  /**
   * Lệnh SX của mọi dòng PI nếu người gọi đã nạp sẵn (bỏ truy vấn bổ sung cho phương án neo PI).
   */
  invoiceOrders?: BomEntry[] | null;
}

/** Các bước công đoạn phụ của đoạn mà bảng chia máy quan tâm. */
export const SEGMENT_STEPS = [
  ProcessStep.UON,
  ProcessStep.DAP,
  ProcessStep.DUC_LO,
  ProcessStep.TAN,
] as const;
export type SegmentStep = (typeof SEGMENT_STEPS)[number];

export interface SegmentProcessInfo {
  /** Nhu cầu đoạn DẬP: materialId -> chiều dài (chuỗi) -> { cutLengthMm, count }. */
  punchedByMaterial: Map<string, Map<string, { cutLengthMm: number; count: number }>>;
  /** Các bước công đoạn của đoạn, khoá `${materialId}:${cutLengthMm}`. */
  stepsByMaterialLength: Map<string, Set<SegmentStep>>;
}

export function segmentStepKey(materialId: bigint | string, cutLengthMm: number): string {
  return `${materialId}:${cutLengthMm}`;
}

/**
 * Bước 1: định mức + số bộ của từng phương án.
 * - Có `items` (lượt tính trước PI): đúng ảnh chụp đầu vào của solver.
 * - Neo lệnh SX (PO): định mức + số lượng của PO.
 * - Neo PI: mọi lệnh SX của các dòng PI.
 * Tối đa 1 truy vấn (chỉ khi có phương án neo PI mà không có items/PO và chưa nạp sẵn
 * `invoiceOrders`).
 */
export async function resolveProposalBomEntries(
  prisma: Pick<PrismaTx, 'productionOrder'>,
  proposals: ProposalBomSource[],
): Promise<Map<string, BomEntry[]>> {
  const result = new Map<string, BomEntry[]>();
  const needInvoice = new Set<bigint>();
  for (const p of proposals) {
    if (p.items.length > 0) {
      result.set(
        p.id.toString(),
        p.items.map((it) => ({ bomRevisionId: it.bomRevisionId, quantity: it.quantity })),
      );
    } else if (p.productionOrder) {
      result.set(p.id.toString(), [
        {
          bomRevisionId: p.productionOrder.bomRevisionId,
          quantity: p.productionOrder.quantity,
        },
      ]);
    } else if (p.invoiceOrders) {
      result.set(
        p.id.toString(),
        p.invoiceOrders.map((o) => ({ bomRevisionId: o.bomRevisionId, quantity: o.quantity })),
      );
    } else if (p.productionInvoiceId != null) {
      needInvoice.add(p.productionInvoiceId);
    } else {
      result.set(p.id.toString(), []);
    }
  }

  if (needInvoice.size > 0) {
    const orders = await prisma.productionOrder.findMany({
      where: { productionInvoiceItem: { productionInvoiceId: { in: [...needInvoice] } } },
      select: {
        bomRevisionId: true,
        quantity: true,
        productionInvoiceItem: { select: { productionInvoiceId: true } },
      },
    });
    const byInvoice = new Map<string, BomEntry[]>();
    for (const o of orders) {
      const key = o.productionInvoiceItem.productionInvoiceId?.toString();
      if (!key) continue;
      const list = byInvoice.get(key) ?? [];
      list.push({ bomRevisionId: o.bomRevisionId, quantity: o.quantity });
      byInvoice.set(key, list);
    }
    for (const p of proposals) {
      if (result.has(p.id.toString())) continue;
      result.set(p.id.toString(), byInvoice.get(String(p.productionInvoiceId)) ?? []);
    }
  }
  return result;
}

/**
 * Bước 2: với mỗi khoá (phương án) -> nhu cầu đoạn DẬP + các bước công đoạn theo (loại sắt, chiều
 * dài).
 * - Nhu cầu dập = số mảnh/bộ × số đoạn/mảnh × số bộ, chỉ tính từ dòng định mức có bước DAP.
 * - Các bước (UON/DAP/DUC_LO/TAN) hợp từ mọi dòng định mức của phương án có cùng (loại sắt, chiều
 *   dài).
 * 2 truy vấn cho mọi phương án. `withPunchDemand = false` bỏ truy vấn số mảnh/bộ (chỉ lấy các bước,
 * 1 truy vấn).
 */
export async function loadSegmentProcessInfo(
  prisma: Pick<PrismaTx, 'pieceBom' | 'bomPiece'>,
  entriesByKey: Map<string, BomEntry[]>,
  options: { withPunchDemand?: boolean } = {},
): Promise<Map<string, SegmentProcessInfo>> {
  const withPunchDemand = options.withPunchDemand ?? true;
  const result = new Map<string, SegmentProcessInfo>();
  const revisionIds = new Set<bigint>();
  for (const [key, entries] of entriesByKey) {
    result.set(key, { punchedByMaterial: new Map(), stepsByMaterialLength: new Map() });
    for (const e of entries) revisionIds.add(e.bomRevisionId);
  }
  if (revisionIds.size === 0) return result;

  const ids = [...revisionIds];
  const [pieceBoms, bomPieces] = await Promise.all([
    prisma.pieceBom.findMany({
      where: { bomRevisionId: { in: ids }, processSteps: { hasSome: [...SEGMENT_STEPS] } },
      select: {
        bomRevisionId: true,
        pieceId: true,
        qtyPerPiece: true,
        processSteps: true,
        segmentSpec: { select: { materialId: true, cutLengthMm: true } },
      },
    }),
    withPunchDemand
      ? prisma.bomPiece.findMany({
          where: { bomRevisionId: { in: ids } },
          select: { bomRevisionId: true, pieceId: true, qtyPerUnit: true },
        })
      : Promise.resolve([] as { bomRevisionId: bigint; pieceId: bigint; qtyPerUnit: number }[]),
  ]);
  const qtyPerUnit = new Map(
    bomPieces.map((bp) => [`${bp.bomRevisionId}:${bp.pieceId}`, bp.qtyPerUnit]),
  );

  const rowsByRevision = new Map<string, typeof pieceBoms>();
  for (const row of pieceBoms) {
    const k = row.bomRevisionId.toString();
    const list = rowsByRevision.get(k) ?? [];
    list.push(row);
    rowsByRevision.set(k, list);
  }

  for (const [key, entries] of entriesByKey) {
    const info = result.get(key)!;
    const qtyByRevision = new Map<string, number>();
    for (const e of entries) {
      const k = e.bomRevisionId.toString();
      qtyByRevision.set(k, (qtyByRevision.get(k) ?? 0) + e.quantity);
    }
    for (const [revision, sets] of qtyByRevision) {
      for (const row of rowsByRevision.get(revision) ?? []) {
        const materialKey = row.segmentSpec.materialId.toString();
        const cutLengthMm = row.segmentSpec.cutLengthMm.toNumber();

        const stepKey = segmentStepKey(materialKey, cutLengthMm);
        const steps = info.stepsByMaterialLength.get(stepKey) ?? new Set<SegmentStep>();
        for (const s of SEGMENT_STEPS) if (row.processSteps?.includes(s)) steps.add(s);
        if (steps.size > 0) info.stepsByMaterialLength.set(stepKey, steps);

        if (!withPunchDemand || !row.processSteps?.includes(ProcessStep.DAP)) continue;
        const count =
          (qtyPerUnit.get(`${row.bomRevisionId}:${row.pieceId}`) ?? 0) * row.qtyPerPiece * sets;
        if (count <= 0) continue;
        const byMaterial =
          info.punchedByMaterial.get(materialKey) ??
          new Map<string, { cutLengthMm: number; count: number }>();
        const k = String(cutLengthMm);
        const cur = byMaterial.get(k);
        if (cur) cur.count += count;
        else byMaterial.set(k, { cutLengthMm, count });
        info.punchedByMaterial.set(materialKey, byMaterial);
      }
    }
  }
  return result;
}
