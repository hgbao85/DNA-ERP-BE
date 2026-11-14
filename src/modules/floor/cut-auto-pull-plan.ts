import type { SegmentProcessInfo } from '../cutting-proposals/proposal-segment-info.util';
import {
  planAllocation,
  sortMachineRows,
  type AllocOrder,
  type CutMachineType,
} from './cut-allocation.util';
import {
  AllocationRecord,
  materialLabel,
  type Snapshot,
  type WorkshopRef,
} from './cut-allocation-snapshot';
import type { CutAutoPullResult, SteelGap } from './cut-allocation-types';
import { hasBend, type UnitMeta } from './cut-allocation-units';

// Máy rảnh kéo lệnh kế tiếp: phần lập kế hoạch và dựng kết quả (hàm thuần, DB nằm ở service).

export interface PullPick {
  unitKey: string;
  machineId: string;
  bars: number;
}

/**
 * Duyệt từng lệnh theo ưu tiên, chia thử lên MỌI máy của xưởng (như bấm Chia); lệnh nào không có
 * phần nào rơi vào máy còn thiếu việc thì để dành. Lệnh nhận thì nhận TOÀN BỘ dòng của nó. Dừng khi
 * mọi máy đã có việc. GHI VÀO `load` và `needWork` (cộng cây đã nhận, bỏ máy đã có việc) để các
 * lệnh sau thấy tải mới.
 */
export function planPulls(input: {
  orders: AllocOrder[];
  machines: Array<{ id: string; type: CutMachineType }>;
  laserAllowed: boolean;
  load: Map<string, number>;
  needWork: Set<string>;
}): PullPick[] {
  const { load, needWork } = input;
  const picks: PullPick[] = [];
  for (const order of input.orders) {
    if (needWork.size === 0) break;
    const plan = planAllocation({
      orders: [order],
      machines: input.machines,
      laserAllowed: input.laserAllowed,
      initialLoad: new Map(load),
    });
    if (!plan.rows.some((r) => needWork.has(r.machineId))) continue;
    for (const r of plan.rows) {
      picks.push({ unitKey: r.unitKey, machineId: r.machineId, bars: r.bars });
      load.set(r.machineId, (load.get(r.machineId) ?? 0) + r.bars);
      needWork.delete(r.machineId);
    }
  }
  return picks;
}

/**
 * seq nối vào cuối việc của từng máy (không đụng seq dòng cũ, kể cả dòng cũ/stale đang nằm trên
 * máy). Trả về map: chỉ số trong `picks` -> seq.
 */
export function assignPullSeq(
  picks: PullPick[],
  snap: Snapshot,
  info: Map<string, SegmentProcessInfo>,
  unitMeta: Map<string, UnitMeta>,
): Map<number, number> {
  const orderRank = new Map(snap.orders.map((o, i) => [o.id.toString(), i]));
  const maxSeq = new Map<string, number>();
  for (const r of [...snap.valid, ...snap.stale]) {
    const k = r.workstationId.toString();
    maxSeq.set(k, Math.max(maxSeq.get(k) ?? 0, r.seq));
  }
  const seqOf = new Map<number, number>();
  for (const machineId of new Set(picks.map((p) => p.machineId))) {
    const sorted = sortMachineRows(
      picks.flatMap((p, i) => {
        if (p.machineId !== machineId) return [];
        const u = unitMeta.get(p.unitKey)!;
        return [
          {
            id: BigInt(i),
            orderRank: orderRank.get(u.meta.piId) ?? 0,
            materialId: u.meta.materialId,
            hasBend: hasBend(info, u.meta),
            patternIndex: u.meta.pattern.patternIndex,
            machineClass: u.machineClass,
            barCount: p.bars,
          },
        ];
      }),
    );
    const base = maxSeq.get(machineId) ?? 0;
    sorted.forEach((row, n) => seqOf.set(Number(row.id), base + n + 1));
  }
  return seqOf;
}

type MaterialSummary = {
  label: string;
  bars: number;
  machines: Map<string, { id: string; name: string; bars: number }>;
};

/** Gộp các dòng vừa tạo của 1 lệnh theo loại sắt, rồi theo máy. */
function summarizeByMaterial(
  mine: AllocationRecord[],
  snap: Snapshot,
  machineName: Map<string, string>,
): Map<string, MaterialSummary> {
  const byMaterial = new Map<string, MaterialSummary>();
  for (const c of mine) {
    const meta = snap.patterns.get(c.patternId.toString())!;
    const cur = byMaterial.get(meta.materialId) ?? {
      label: materialLabel(meta.line.material),
      bars: 0,
      machines: new Map<string, { id: string; name: string; bars: number }>(),
    };
    cur.bars += c.barCount;
    const mid = c.workstationId.toString();
    const mm = cur.machines.get(mid) ?? { id: mid, name: machineName.get(mid) ?? mid, bars: 0 };
    mm.bars += c.barCount;
    cur.machines.set(mid, mm);
    byMaterial.set(meta.materialId, cur);
  }
  return byMaterial;
}

/** Kết quả báo theo lệnh (thứ tự ưu tiên của snapshot) + máy rảnh đã nhận việc. */
export function buildPullResult(input: {
  workshop: WorkshopRef;
  snap: Snapshot;
  created: AllocationRecord[];
  gaps: Map<string, SteelGap>;
  machineName: Map<string, string>;
  idleStart: Set<string>;
  load: Map<string, number>;
}): CutAutoPullResult {
  const { workshop, snap, created, gaps, machineName, idleStart, load } = input;
  const orders: CutAutoPullResult['orders'] = [];
  for (const order of snap.orders) {
    const piId = order.id.toString();
    const mine = created.filter((c) => c.productionInvoiceId === order.id);
    if (mine.length === 0) continue;
    const idleNames = [
      ...new Set(
        mine
          .map((c) => c.workstationId.toString())
          .filter((id) => idleStart.has(id))
          .map((id) => machineName.get(id) ?? id),
      ),
    ];
    orders.push({
      productionInvoiceId: piId,
      piCode: order.code,
      firstAllocationId: mine
        .reduce((best, c) => (c.id < best ? c.id : best), mine[0].id)
        .toString(),
      lines: [...summarizeByMaterial(mine, snap, machineName)].map(([materialId, v]) => ({
        materialId,
        materialLabel: v.label,
        bars: v.bars,
        machines: [...v.machines.values()],
      })),
      idleMachineNames: idleNames,
      steelGaps: [...gaps].filter(([k]) => k.startsWith(`${piId}:`)).map(([, g]) => g),
    });
  }
  const received = [...idleStart].filter((id) => (load.get(id) ?? 0) > 0);
  return {
    workshopId: workshop.id.toString(),
    workshopName: workshop.name,
    machines: received.map((id) => ({ id, name: machineName.get(id) ?? id })),
    orders,
  };
}
