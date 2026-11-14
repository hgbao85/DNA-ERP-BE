import { CutMachineClass, Prisma } from '../../generated/prisma/client';
import type { SegmentProcessInfo } from '../cutting-proposals/proposal-segment-info.util';
import { allowedMachineIdsFor } from './cut-allocation-machine-rule';
import {
  isPairSufficient,
  materialLabel,
  toMachineType,
  type ReportedSegments,
  type Snapshot,
} from './cut-allocation-snapshot';
import type {
  CutAllocationBoard,
  CutAllocationRow,
  CutAllocationSegment,
  CutMachineProgressInfo,
} from './cut-allocation-types';
import { stepsOf, type PunchedSegments } from './cut-allocation-units';
import { cutMachineStatus, estimateMachineProgress } from './cut-allocation.util';

// Dựng bảng chia máy từ snapshot đã nạp: hàm thuần, không đụng DB.

export function workshopLabel(name: string): string {
  const n = name.trim();
  return /^xưởng\s/i.test(n) ? n : `Xưởng ${n}`;
}

export function readPunched(raw: Prisma.JsonValue | null): PunchedSegments | null {
  if (!Array.isArray(raw)) return null;
  const out: PunchedSegments = [];
  for (const x of raw) {
    if (x && typeof x === 'object' && !Array.isArray(x)) {
      const o = x as Record<string, unknown>;
      out.push({ cutLengthMm: Number(o.cutLengthMm), countPerBar: Number(o.countPerBar) });
    }
  }
  return out;
}

function pieceNames(summary: Prisma.JsonValue | null, cutLengthMm: number): string[] {
  if (!Array.isArray(summary)) return [];
  const names = new Set<string>();
  for (const x of summary) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) continue;
    const o = x as { size?: unknown; names?: unknown };
    if (Number(o.size) !== cutLengthMm || !Array.isArray(o.names)) continue;
    for (const n of o.names) if (typeof n === 'string') names.add(n);
  }
  return [...names];
}

function lineSurplus(
  summary: Prisma.JsonValue | null,
): Array<{ cutLengthMm: number; surplus: number }> {
  if (!Array.isArray(summary)) return [];
  const out: Array<{ cutLengthMm: number; surplus: number }> = [];
  for (const x of summary) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) continue;
    const o = x as { size?: unknown; produced?: unknown; demand?: unknown };
    const surplus = Number(o.produced) - Number(o.demand);
    if (Number.isFinite(surplus) && surplus > 0) out.push({ cutLengthMm: Number(o.size), surplus });
  }
  return out.sort((a, b) => b.cutLengthMm - a.cutLengthMm);
}

function buildRows(snap: Snapshot, info: Map<string, SegmentProcessInfo>): CutAllocationRow[] {
  const orderById = new Map(snap.orders.map((o) => [o.id.toString(), o]));
  const machineIndex = new Map(snap.machines.map((m, i) => [m.id.toString(), i]));
  const allowedByClass = new Map<CutMachineClass, string[]>();
  const allowedFor = (machineClass: CutMachineClass): string[] => {
    let ids = allowedByClass.get(machineClass);
    if (!ids) {
      ids = allowedMachineIdsFor(machineClass, snap.machines, snap.laserAllowed);
      allowedByClass.set(machineClass, ids);
    }
    return [...ids];
  };

  const rows: CutAllocationRow[] = snap.valid.map((r) => {
    const meta = snap.patterns.get(r.patternId.toString())!;
    const order = orderById.get(r.productionInvoiceId.toString())!;
    const segments: CutAllocationSegment[] = meta.segments.map((s) => ({
      cutLengthMm: s.cutLengthMm,
      countPerBar: s.countPerBar,
      steps: stepsOf(info, meta, s.cutLengthMm),
      pieceNames: pieceNames(meta.line.pieceSummary, s.cutLengthMm),
    }));
    const lineMachine = meta.line.machine;
    return {
      id: r.id.toString(),
      workstationId: r.workstationId.toString(),
      seq: r.seq,
      isManual: r.isManual,
      productionInvoiceId: r.productionInvoiceId.toString(),
      piCode: order.code,
      priority: order.priority,
      cuttingProposalId: r.cuttingProposalId.toString(),
      patternId: r.patternId.toString(),
      patternIndex: meta.pattern.patternIndex,
      patternBarCount: meta.pattern.barCount,
      materialId: meta.materialId,
      materialCode: meta.line.material.code,
      materialLabel: materialLabel(meta.line.material),
      barLengthMm: meta.line.bestStockLengthMm ?? null,
      lineMachine: lineMachine ? toMachineType(lineMachine) : null,
      machineClass: r.machineClass,
      barCount: r.barCount,
      segments,
      punchedSegments:
        r.machineClass === CutMachineClass.LASER ? readPunched(r.punchedSegments) : null,
      bundles:
        meta.pattern.bundles && typeof meta.pattern.bundles === 'object'
          ? (meta.pattern.bundles as Record<string, number>)
          : null,
      isBundle: meta.pattern.bundles != null,
      wastePerBarMm: meta.pattern.wastePerBarMm == null ? null : Number(meta.pattern.wastePerBarMm),
      lineSurplus: lineSurplus(meta.line.pieceSummary),
      hasBend: segments.some((s) => s.steps.includes('UON')),
      barsDoneEst: 0,
      allowedMachineIds: allowedFor(r.machineClass),
    };
  });
  rows.sort(
    (a, b) =>
      (machineIndex.get(a.workstationId) ?? 0) - (machineIndex.get(b.workstationId) ?? 0) ||
      a.seq - b.seq ||
      Number(BigInt(a.id) - BigInt(b.id)),
  );
  return rows;
}

/** Tổng hợp từng máy; ghi `barsDoneEst` vào các dòng của máy. */
function buildMachines(
  snap: Snapshot,
  rows: CutAllocationRow[],
  reported: ReportedSegments,
): CutAllocationBoard['machines'] {
  return snap.machines.map((m) => {
    const mine = rows.filter((r) => r.workstationId === m.id.toString());
    const pairs = new Set(mine.map((r) => `${r.productionInvoiceId}:${r.materialId}`));
    let reportedSegments = 0;
    for (const p of pairs) reportedSegments += reported.byPair.get(`${m.id}:${p}`) ?? 0;
    const est = estimateMachineProgress(
      mine,
      reported.byMachine.get(m.id.toString()) ?? new Map<string, number>(),
    );
    const doneById = new Map(est.lines.map((l) => [String(l.id), l.barsDone]));
    for (const r of mine) r.barsDoneEst = doneById.get(r.id) ?? 0;
    return {
      id: m.id.toString(),
      code: m.code,
      name: m.name,
      cutMachineType: toMachineType(m.cutMachineType),
      totalBars: mine.reduce((s, r) => s + r.barCount, 0),
      rowCount: mine.length,
      plannedSegments: mine.reduce(
        (s, r) => s + r.barCount * r.segments.reduce((a, g) => a + g.countPerBar, 0),
        0,
      ),
      reportedSegments,
      barsDoneEst: est.barsDone,
      barsLeftEst: est.barsLeft,
      status: cutMachineStatus(mine.length, est.barsLeft),
    };
  });
}

/** Cặp (lệnh, loại sắt) chưa chia hết: đủ sắt thì vào "chưa chia", chưa đủ thì vào "chờ sắt". */
function splitUnallocatedAndWaiting(snap: Snapshot): {
  unallocated: CutAllocationBoard['unallocated'];
  waiting: CutAllocationBoard['waiting'];
} {
  const allocatedByPair = new Map<string, number>();
  for (const r of snap.valid) {
    const meta = snap.patterns.get(r.patternId.toString())!;
    const k = `${meta.piId}:${meta.materialId}`;
    allocatedByPair.set(k, (allocatedByPair.get(k) ?? 0) + r.barCount);
  }
  const unallocated: CutAllocationBoard['unallocated'] = [];
  const waiting: CutAllocationBoard['waiting'] = [];
  for (const order of snap.orders) {
    const entries = [...snap.pairs]
      .filter(([k, p]) => k.startsWith(`${order.id}:`) && p.hasPatterns)
      .sort(([a], [b]) => (BigInt(a.split(':')[1]) < BigInt(b.split(':')[1]) ? -1 : 1));
    for (const [k, pair] of entries) {
      const materialId = k.split(':')[1];
      const label = materialLabel(pair.material);
      const bars = pair.patternBars - (allocatedByPair.get(k) ?? 0);
      const base = {
        productionInvoiceId: order.id.toString(),
        piCode: order.code,
        materialId,
        materialLabel: label,
      };
      if (isPairSufficient(snap, k)) {
        if (bars > 0) unallocated.push({ ...base, bars });
      } else if (pair.required > 0 && bars > 0) {
        // Đã "Chia luôn" đủ cây thì thôi nhắc chờ sắt.
        const availableBars = snap.available.get(k) ?? 0;
        waiting.push({
          ...base,
          requiredBars: pair.required,
          availableBars,
          shortBars: pair.required - availableBars,
          heldElsewhereBars: snap.heldElsewhere.get(k) ?? 0,
        });
      }
    }
  }
  return { unallocated, waiting };
}

export function buildBoardData(
  snap: Snapshot,
  info: Map<string, SegmentProcessInfo>,
  reported: ReportedSegments,
  extraWarnings: string[],
): CutAllocationBoard {
  const warnings = [...extraWarnings];
  if (snap.machines.length === 0) {
    warnings.push(
      `${workshopLabel(snap.workshop.name)} chưa khai máy cắt (Sản lượng xưởng › Máy & tem QR)`,
    );
  }
  const rows = buildRows(snap, info);
  const machines = buildMachines(snap, rows, reported);
  const { unallocated, waiting } = splitUnallocatedAndWaiting(snap);
  return {
    workshop: {
      id: snap.workshop.id.toString(),
      code: snap.workshop.code,
      name: snap.workshop.name,
      laserAllowed: snap.laserAllowed,
    },
    machines,
    rows,
    unallocated,
    waiting,
    staleCount: snap.stale.length,
    warnings,
  };
}

/** Lệnh khác nhau của các dòng (seq nhỏ trước, rồi id dòng). */
export function distinctPis(
  rows: CutAllocationRow[],
): Array<{ productionInvoiceId: string; code: string }> {
  const sorted = [...rows].sort((a, b) => a.seq - b.seq || Number(BigInt(a.id) - BigInt(b.id)));
  const seen = new Set<string>();
  const out: Array<{ productionInvoiceId: string; code: string }> = [];
  for (const r of sorted) {
    if (seen.has(r.productionInvoiceId)) continue;
    seen.add(r.productionInvoiceId);
    out.push({ productionInvoiceId: r.productionInvoiceId, code: r.piCode });
  }
  return out;
}

export function toMachineProgress(board: CutAllocationBoard): CutMachineProgressInfo[] {
  return board.machines.map((m) => {
    const mine = board.rows.filter((r) => r.workstationId === m.id);
    const maxId = mine.reduce((best, r) => (BigInt(r.id) > best ? BigInt(r.id) : best), 0n);
    return {
      workstationId: m.id,
      name: m.name,
      workshopId: board.workshop.id,
      workshopName: board.workshop.name,
      totalBars: m.totalBars,
      barsLeft: m.barsLeftEst,
      status: m.status,
      signature: `${m.totalBars}:${maxId}`,
    };
  });
}
