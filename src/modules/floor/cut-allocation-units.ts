import {
  SEGMENT_STEPS,
  segmentStepKey,
  type SegmentProcessInfo,
  type SegmentStep,
} from '../cutting-proposals/proposal-segment-info.util';
import { classifyPatternMachines } from '../cutting-proposals/pattern-machine-class.util';
import {
  remainingLoadByMachine,
  type AllocOrder,
  type AllocUnit,
  type CutClass,
  type LoadRow,
} from './cut-allocation.util';
import type {
  AllocationRecord,
  PatternMeta,
  ProposalRow,
  ReportedSegments,
  Snapshot,
} from './cut-allocation-snapshot';

// Dựng "đơn vị chia" từ snapshot cho thuật toán planAllocation (hàm thuần, không đụng DB).

export type PunchedSegments = Array<{ cutLengthMm: number; countPerBar: number }>;

export interface UnitMeta {
  meta: PatternMeta;
  machineClass: CutClass;
  punched: PunchedSegments;
}

type ProposalLine = ProposalRow['lines'][number];
type ClassAggregate = { bars: number; punched: PunchedSegments; best: number };

export function stepsOf(
  info: Map<string, SegmentProcessInfo>,
  meta: PatternMeta,
  cutLengthMm: number,
): SegmentStep[] {
  const set = info
    .get(meta.proposalId)
    ?.stepsByMaterialLength.get(segmentStepKey(meta.materialId, cutLengthMm));
  return set ? SEGMENT_STEPS.filter((s) => set.has(s)) : [];
}

export function hasBend(info: Map<string, SegmentProcessInfo>, meta: PatternMeta): boolean {
  return meta.segments.some((s) => stepsOf(info, meta, s.cutLengthMm).includes('UON'));
}

/** Tải còn lại (ước) của từng máy từ dòng hiện hành; `include` lọc dòng được cộng. */
export function remainingLoad(
  snap: Snapshot,
  reported: Pick<ReportedSegments, 'byMachine'>,
  include?: (row: LoadRow) => boolean,
): Map<string, number> {
  const rows: LoadRow[] = snap.valid.map((r) => {
    const meta = snap.patterns.get(r.patternId.toString())!;
    return {
      id: r.id.toString(),
      machineId: r.workstationId.toString(),
      productionInvoiceId: r.productionInvoiceId.toString(),
      materialId: meta.materialId,
      seq: r.seq,
      barCount: r.barCount,
      segments: meta.segments,
    };
  });
  return remainingLoadByMachine(rows, reported.byMachine, include);
}

/** Số cây đang giữ theo (kiểu cắt, lớp máy) và theo kiểu cắt. */
function countHeld(held: AllocationRecord[]) {
  const byUnit = new Map<string, number>();
  const byPattern = new Map<string, number>();
  for (const r of held) {
    const k = `${r.patternId}:${r.machineClass}`;
    byUnit.set(k, (byUnit.get(k) ?? 0) + r.barCount);
    const p = r.patternId.toString();
    byPattern.set(p, (byPattern.get(p) ?? 0) + r.barCount);
  }
  return { byUnit, byPattern };
}

/**
 * Gộp các nhóm cùng lớp máy của 1 kiểu cắt thành 1 đơn vị; đoạn dập lấy theo nhóm đông cây nhất.
 */
function aggregateByClass(
  groups: Array<{ bars: number; machineClass: CutClass; punchedSegments: PunchedSegments }>,
): Map<CutClass, ClassAggregate> {
  const perClass = new Map<CutClass, ClassAggregate>();
  for (const g of groups) {
    if (g.bars <= 0) continue;
    const cur = perClass.get(g.machineClass) ?? { bars: 0, punched: [], best: 0 };
    cur.bars += g.bars;
    if (g.bars > cur.best) {
      cur.best = g.bars;
      cur.punched = g.punchedSegments;
    }
    perClass.set(g.machineClass, cur);
  }
  return perClass;
}

function unitsOfPattern(
  pat: ProposalLine['patterns'][number],
  line: ProposalLine,
  perClass: Map<CutClass, ClassAggregate>,
  ctx: {
    snap: Snapshot;
    info: Map<string, SegmentProcessInfo>;
    held: ReturnType<typeof countHeld>;
    unitMeta: Map<string, UnitMeta>;
  },
): AllocUnit[] {
  const meta = ctx.snap.patterns.get(pat.id.toString())!;
  const bend = hasBend(ctx.info, meta);
  const units: AllocUnit[] = [];
  // Không chia quá số cây của kiểu cắt: dòng sửa tay có thể đã lấn sang phần của lớp máy kia (vd
  // xoá dòng TU_DONG rồi tăng số cây dòng LASER). LASER xét trước vì chỉ cắt được máy laze.
  let patternLeft = pat.barCount - (ctx.held.byPattern.get(pat.id.toString()) ?? 0);
  for (const machineClass of ['LASER', 'TU_DONG'] as const) {
    const agg = perClass.get(machineClass);
    if (!agg) continue;
    const key = `${pat.id}:${machineClass}`;
    const bars = Math.min(agg.bars - (ctx.held.byUnit.get(key) ?? 0), patternLeft);
    if (bars <= 0) continue;
    patternLeft -= bars;
    ctx.unitMeta.set(key, {
      meta,
      machineClass,
      punched: machineClass === 'LASER' ? agg.punched : [],
    });
    units.push({
      key,
      materialId: line.materialId.toString(),
      patternIndex: pat.patternIndex,
      machineClass,
      hasBend: bend,
      bars,
      splittable: pat.bundles == null,
    });
  }
  return units;
}

function unitsOfLine(
  line: ProposalLine,
  proposalInfo: SegmentProcessInfo | undefined,
  ctx: Parameters<typeof unitsOfPattern>[3],
): AllocUnit[] {
  const demand = [
    ...(proposalInfo?.punchedByMaterial.get(line.materialId.toString())?.values() ?? []),
  ];
  const classified = classifyPatternMachines({
    patterns: line.patterns.map((p) => ({
      key: p.id.toString(),
      barCount: p.barCount,
      segments: p.segments.map((s) => ({
        cutLengthMm: Number(s.segmentSpec.cutLengthMm),
        countPerBar: s.countPerBar,
      })),
    })),
    punchedDemand: demand,
  });
  return line.patterns.flatMap((pat) =>
    unitsOfPattern(pat, line, aggregateByClass(classified.get(pat.id.toString()) ?? []), ctx),
  );
}

/** Đơn vị chia của các lệnh đã sắp ưu tiên; chỉ các cặp (lệnh, loại sắt) mà `eligible` cho phép. */
export function buildUnits(
  snap: Snapshot,
  info: Map<string, SegmentProcessInfo>,
  held: AllocationRecord[],
  eligible: (pairKey: string) => boolean,
): { orders: AllocOrder[]; unitMeta: Map<string, UnitMeta> } {
  const unitMeta = new Map<string, UnitMeta>();
  const ctx = { snap, info, held: countHeld(held), unitMeta };
  const orders: AllocOrder[] = [];
  for (const order of snap.orders) {
    const units: AllocUnit[] = [];
    for (const proposal of snap.proposalsByPi.get(order.id.toString()) ?? []) {
      const proposalInfo = info.get(proposal.id.toString());
      for (const line of proposal.lines) {
        if (line.patterns.length === 0) continue;
        if (!eligible(`${order.id}:${line.materialId}`)) continue;
        units.push(...unitsOfLine(line, proposalInfo, ctx));
      }
    }
    if (units.length > 0) orders.push({ orderId: order.id.toString(), units });
  }
  return { orders, unitMeta };
}
