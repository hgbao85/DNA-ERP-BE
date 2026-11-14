/**
 * Thuật toán "Chia máy cắt" - HÀM THUẦN, không đụng DB. Luật nghiệp vụ: "Quy tắc chia sắt cho máy
 * cắt". CutAllocationService gom dữ liệu rồi gọi các hàm ở đây.
 *
 * - `comparePriority`: khoá ưu tiên lệnh (N1 sớm, booking gần, hạn PI, id).
 * - `waterFill`: rải N cây lên k máy sao cho máy nặng nhất nhẹ nhất có thể.
 * - `chooseMachineCounts`: số máy cho mỗi quy cách của 1 lệnh trong 1 nhóm máy.
 * - `planAllocation`: chia các đơn vị (kiểu cắt × lớp máy) của các lệnh đã sắp ưu tiên lên các máy.
 * - `sortMachineRows`: thứ tự cắt (seq) trên 1 máy.
 */

export type CutMachineType = 'laser' | 'tu_dong';
export type CutClass = 'TU_DONG' | 'LASER';

// ─── Khoá ưu tiên ────────────────────────────────────────────────────────────

export interface PriorityKey {
  /** Ngày 'YYYY-MM-DD' (giờ VN) - null xếp cuối. */
  phoiStart: string | null;
  bookingDue: string | null;
  deadline: string | null;
  /** Id lệnh (số nguyên dạng chuỗi hoặc bigint). */
  id: string | bigint;
}

function compareNullableDay(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

export function compareIds(a: string | bigint, b: string | bigint): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Âm khi `a` làm trước `b`: N1 (Bắt đầu Phôi) sớm → booking gần → hạn PI → id nhỏ; thiếu ngày xếp
 * cuối.
 */
export function comparePriority(a: PriorityKey, b: PriorityKey): number {
  return (
    compareNullableDay(a.phoiStart, b.phoiStart) ||
    compareNullableDay(a.bookingDue, b.bookingDue) ||
    compareNullableDay(a.deadline, b.deadline) ||
    compareIds(a.id, b.id)
  );
}

// ─── waterFill ───────────────────────────────────────────────────────────────

/**
 * Rải `total` cây (số nguyên) lên các máy đang mang tải `loads` sao cho max(tải + x) nhỏ nhất, Σx =
 * total. Phần dư (do chia không đều) dồn cho máy đứng TRƯỚC trong số máy cùng mức thấp nhất. Trả về
 * x theo đúng thứ tự `loads`.
 */
export function waterFill(loads: number[], total: number): number[] {
  const n = loads.length;
  const x = new Array<number>(n).fill(0);
  if (n === 0 || total <= 0) return x;

  // L nhỏ nhất sao cho Σ max(0, L − tải) >= total.
  const capacity = (level: number) => loads.reduce((s, l) => s + Math.max(0, level - l), 0);
  let lo = Math.min(...loads);
  let hi = Math.max(...loads) + total;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (capacity(mid) >= total) hi = mid;
    else lo = mid + 1;
  }
  const level = lo;
  // Đổ đầy tới mức L-1 (chắc chắn < total), phần còn lại mỗi máy +1 lên mức L theo thứ tự máy.
  let used = 0;
  for (let i = 0; i < n; i++) {
    x[i] = Math.max(0, level - 1 - loads[i]);
    used += x[i];
  }
  let rest = total - used;
  for (let i = 0; i < n && rest > 0; i++) {
    if (loads[i] + x[i] <= level - 1) {
      x[i] += 1;
      rest -= 1;
    }
  }
  return x;
}

// ─── Chọn số máy cho quy cách ────────────────────────────────────────────────

export interface MaterialDemand {
  materialId: string;
  /** Tổng cây còn chia của quy cách trong nhóm máy. */
  bars: number;
  /** Số máy tối đa có thể giao: Σ (tách được ? cây : 1) của các đơn vị. */
  cap: number;
}

function compareDemand(a: MaterialDemand, b: MaterialDemand): number {
  if (a.bars !== b.bars) return b.bars - a.bars;
  return a.materialId < b.materialId ? -1 : a.materialId > b.materialId ? 1 : 0;
}

/**
 * Số máy k của từng quy cách (M = số máy trong nhóm).
 * - Số quy cách S < M: mỗi quy cách 1 máy; M − S máy còn lại lần lượt giao cho quy cách có bars/k
 *   lớn nhất (hoà → bars lớn hơn → materialId nhỏ hơn), bỏ qua quy cách đã đạt cap.
 * - S >= M: r = floor(cây lớn nhất / cây lớn thứ hai): r < 2 → 1 máy, 2 <= r < 3 → 2 máy, r >= 3 →
 *   3 máy (tối đa 3, không quá M và cap); các quy cách còn lại 1 máy.
 */
export function chooseMachineCounts(
  demands: MaterialDemand[],
  machineCount: number,
): Map<string, number> {
  const result = new Map<string, number>();
  const sorted = [...demands].sort(compareDemand);
  const m = Math.max(0, machineCount);
  if (sorted.length === 0 || m === 0) return result;

  for (const d of sorted) result.set(d.materialId, 1);

  if (sorted.length < m) {
    for (let extra = m - sorted.length; extra > 0; extra--) {
      let best: MaterialDemand | null = null;
      for (const d of sorted) {
        if ((result.get(d.materialId) ?? 1) >= d.cap) continue;
        if (!best) {
          best = d;
          continue;
        }
        // bars/k lớn hơn (so sánh chéo, tránh số thực); hoà → thứ tự sorted (bars lớn, materialId
        // nhỏ) giữ nguyên.
        const left = d.bars * (result.get(best.materialId) ?? 1);
        const right = best.bars * (result.get(d.materialId) ?? 1);
        if (left > right) best = d;
      }
      if (!best) break;
      result.set(best.materialId, (result.get(best.materialId) ?? 1) + 1);
    }
    return result;
  }

  const first = sorted[0];
  const second = sorted[1];
  const ratio = second && second.bars > 0 ? Math.floor(first.bars / second.bars) : 3;
  const want = ratio < 2 ? 1 : ratio < 3 ? 2 : 3;
  result.set(first.materialId, Math.max(1, Math.min(want, m, first.cap)));
  return result;
}

// ─── Chia các đơn vị lên máy ────────────────────────────────────────────────

export interface AllocMachine {
  id: string;
  type: CutMachineType;
}

/** 1 đơn vị chia = (kiểu cắt, lớp máy) với số cây CÒN PHẢI CHIA. */
export interface AllocUnit {
  /** Khoá duy nhất toàn cục, vd `${patternId}:${machineClass}`. */
  key: string;
  materialId: string;
  patternIndex: number;
  machineClass: CutClass;
  hasBend: boolean;
  /** Số cây còn phải chia (> 0; đơn vị 0 cây bị bỏ qua). */
  bars: number;
  /** Kiểu cắt theo bó (MC Tự động) không tách sang 2 máy. */
  splittable: boolean;
}

export interface AllocOrder {
  orderId: string;
  units: AllocUnit[];
}

export interface PlanInput {
  /** Đã sắp theo thứ tự ưu tiên (làm trước đứng trước). */
  orders: AllocOrder[];
  /** Máy cắt đang dùng, theo thứ tự máy (hoà tải → máy đứng trước). */
  machines: AllocMachine[];
  laserAllowed: boolean;
  /** Tải ban đầu của máy = Σ barCount các dòng đang giữ. */
  initialLoad: Map<string, number>;
}

export interface PlanRow {
  unitKey: string;
  machineId: string;
  bars: number;
}

export interface PlanResult {
  rows: PlanRow[];
  warnings: string[];
}

export const WARN_NO_LASER =
  'Xưởng chưa có máy laze: cây có đoạn dập chia sang máy tự động, lỗ làm tay';
export const WARN_NO_AUTO = 'Xưởng chưa có MC Tự động: cây không dập chia sang máy laze';

type PoolName = 'laser' | 'tu_dong';

function compareUnitsForFill(a: AllocUnit, b: AllocUnit): number {
  if (a.hasBend !== b.hasBend) return a.hasBend ? -1 : 1;
  if (a.patternIndex !== b.patternIndex) return a.patternIndex - b.patternIndex;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

type PutFn = (unitKey: string, machineId: string, bars: number) => void;

function groupUnitsByPool(
  units: AllocUnit[],
  resolvePool: (unit: AllocUnit) => PoolName | null,
): Map<PoolName, AllocUnit[]> {
  const byPool = new Map<PoolName, AllocUnit[]>();
  for (const unit of units) {
    if (unit.bars <= 0) continue;
    const pool = resolvePool(unit);
    if (!pool) continue;
    const list = byPool.get(pool) ?? [];
    list.push(unit);
    byPool.set(pool, list);
  }
  return byPool;
}

/** Chọn k máy chưa bị loại khác chiếm, tải thấp nhất trước; thiếu thì lấy thêm từ phần còn lại. */
function chooseMachines(
  pool: AllocMachine[],
  taken: Set<string>,
  k: number,
  load: Map<string, number>,
): AllocMachine[] {
  const byLoad = (a: AllocMachine, b: AllocMachine) =>
    (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || pool.indexOf(a) - pool.indexOf(b);
  const chosen: AllocMachine[] = pool.filter((m) => !taken.has(m.id)).sort(byLoad);
  chosen.length = Math.min(chosen.length, k);
  if (chosen.length < k) {
    const extra = pool.filter((m) => !chosen.includes(m)).sort(byLoad);
    chosen.push(...extra.slice(0, k - chosen.length));
  }
  return chosen;
}

/** Đổ các đơn vị của 1 loại sắt vào các máy đã chọn. */
function placeUnits(
  list: AllocUnit[],
  chosen: AllocMachine[],
  load: Map<string, number>,
  put: PutFn,
): void {
  // 1) Đơn vị không tách được: cả đơn vị vào máy tải nhỏ nhất trong k máy.
  const whole = list
    .filter((u) => !u.splittable)
    .sort((a, b) => b.bars - a.bars || compareUnitsForFill(a, b));
  for (const u of whole) {
    let target = chosen[0];
    for (const m of chosen) if ((load.get(m.id) ?? 0) < (load.get(target.id) ?? 0)) target = m;
    put(u.key, target.id, u.bars);
  }
  // 2) Phần tách được: waterFill rồi đổ lần lượt các đơn vị vào các máy theo đúng x.
  const splittable = list.filter((u) => u.splittable).sort(compareUnitsForFill);
  const total = splittable.reduce((s, u) => s + u.bars, 0);
  if (total <= 0) return;
  const x = waterFill(
    chosen.map((m) => load.get(m.id) ?? 0),
    total,
  );
  let mi = 0;
  for (const u of splittable) {
    let left = u.bars;
    while (left > 0 && mi < chosen.length) {
      const give = Math.min(left, x[mi]);
      if (give > 0) {
        put(u.key, chosen[mi].id, give);
        left -= give;
        x[mi] -= give;
      }
      if (x[mi] <= 0) mi++;
    }
  }
}

/** Chia các đơn vị của 1 lệnh trong 1 nhóm máy: số máy cho từng loại sắt rồi đổ việc vào. */
function planPool(
  pool: AllocMachine[],
  units: AllocUnit[],
  load: Map<string, number>,
  put: PutFn,
): void {
  const byMaterial = new Map<string, AllocUnit[]>();
  for (const u of units) {
    const list = byMaterial.get(u.materialId) ?? [];
    list.push(u);
    byMaterial.set(u.materialId, list);
  }
  const demands: MaterialDemand[] = [...byMaterial].map(([materialId, list]) => ({
    materialId,
    bars: list.reduce((s, u) => s + u.bars, 0),
    cap: list.reduce((s, u) => s + (u.splittable ? u.bars : 1), 0),
  }));
  const counts = chooseMachineCounts(demands, pool.length);

  const taken = new Set<string>();
  for (const d of [...demands].sort(compareDemand)) {
    const chosen = chooseMachines(pool, taken, counts.get(d.materialId) ?? 1, load);
    for (const m of chosen) taken.add(m.id);
    placeUnits(byMaterial.get(d.materialId) ?? [], chosen, load, put);
  }
}

export function planAllocation(input: PlanInput): PlanResult {
  const warnings = new Set<string>();
  const merged = new Map<string, PlanRow>();
  const load = new Map<string, number>();
  for (const m of input.machines) load.set(m.id, input.initialLoad.get(m.id) ?? 0);

  const pools: Record<PoolName, AllocMachine[]> = {
    laser: input.machines.filter((m) => m.type === 'laser'),
    tu_dong: input.machines.filter((m) => m.type === 'tu_dong'),
  };

  /** Nhóm máy của đơn vị (null = xưởng không có máy nào). */
  const resolvePool = (unit: AllocUnit): PoolName | null => {
    if (unit.machineClass === 'LASER' && input.laserAllowed) {
      if (pools.laser.length > 0) return 'laser';
      if (pools.tu_dong.length > 0) {
        warnings.add(WARN_NO_LASER);
        return 'tu_dong';
      }
      return null;
    }
    if (pools.tu_dong.length > 0) return 'tu_dong';
    if (pools.laser.length > 0) {
      warnings.add(WARN_NO_AUTO);
      return 'laser';
    }
    return null;
  };

  const put: PutFn = (unitKey, machineId, bars) => {
    if (bars <= 0) return;
    load.set(machineId, (load.get(machineId) ?? 0) + bars);
    const k = `${machineId}|${unitKey}`;
    const cur = merged.get(k);
    if (cur) cur.bars += bars;
    else merged.set(k, { unitKey, machineId, bars });
  };

  for (const order of input.orders) {
    for (const [poolName, units] of groupUnitsByPool(order.units, resolvePool)) {
      planPool(pools[poolName], units, load, put);
    }
  }
  return { rows: [...merged.values()], warnings: [...warnings] };
}

// ─── Thứ tự cắt trên máy ─────────────────────────────────────────────────────

export interface SeqRow {
  id: string | bigint;
  /** Thứ hạng ưu tiên của lệnh (0 = làm trước). */
  orderRank: number;
  materialId: string;
  hasBend: boolean;
  patternIndex: number;
  machineClass: CutClass;
  barCount: number;
}

/**
 * Thứ tự cắt (seq) trên MỘT máy: lệnh theo ưu tiên; trong lệnh nhóm theo loại sắt (loại có kiểu cắt
 * uốn trước, rồi tổng cây trên máy giảm dần, rồi materialId); trong loại sắt: có uốn trước, rồi
 * patternIndex, rồi lớp máy, rồi id.
 */
export function sortMachineRows<T extends SeqRow>(rows: T[]): T[] {
  const groups = new Map<string, { bend: boolean; bars: number }>();
  const groupKey = (r: SeqRow) => `${r.orderRank}|${r.materialId}`;
  for (const r of rows) {
    const g = groups.get(groupKey(r)) ?? { bend: false, bars: 0 };
    g.bend ||= r.hasBend;
    g.bars += r.barCount;
    groups.set(groupKey(r), g);
  }
  return [...rows].sort((a, b) => {
    if (a.orderRank !== b.orderRank) return a.orderRank - b.orderRank;
    if (a.materialId !== b.materialId) {
      const ga = groups.get(groupKey(a))!;
      const gb = groups.get(groupKey(b))!;
      if (ga.bend !== gb.bend) return ga.bend ? -1 : 1;
      if (ga.bars !== gb.bars) return gb.bars - ga.bars;
      return a.materialId < b.materialId ? -1 : 1;
    }
    if (a.hasBend !== b.hasBend) return a.hasBend ? -1 : 1;
    if (a.patternIndex !== b.patternIndex) return a.patternIndex - b.patternIndex;
    if (a.machineClass !== b.machineClass) return a.machineClass < b.machineClass ? -1 : 1;
    return compareIds(a.id, b.id);
  });
}

// ─── Ước tiến độ máy ───────────────────────────────────────────────

/** Máy còn ≤ ngần này cây (và > 0) thì báo KHSX / QLSX chuẩn bị việc tiếp. */
export const CUT_MACHINE_LOW_WORK_BARS = 20;

export type CutMachineStatus = 'EMPTY' | 'IDLE' | 'LOW' | 'BUSY';

export interface MachineProgressLine {
  id: string | bigint;
  productionInvoiceId: string | bigint;
  materialId: string | bigint;
  seq: number;
  barCount: number;
  segments: Array<{ cutLengthMm: number; countPerBar: number }>;
}

export interface MachineProgress {
  lines: Array<{ id: string | bigint; barsDone: number; barsLeft: number }>;
  totalBars: number;
  barsDone: number;
  barsLeft: number;
}

/** Khoá số đoạn đã báo: `${lệnh}|${loại sắt}|${cỡ đoạn 1 số lẻ}` (đoạn báo ở CHÍNH máy đó). */
export function reportedSegmentKey(
  productionInvoiceId: string | bigint,
  materialId: string | bigint,
  cutLengthMm: number,
): string {
  return `${productionInvoiceId}|${materialId}|${cutLengthMm.toFixed(1)}`;
}

/**
 * Ước số cây đã cắt của từng dòng chia trên MỘT máy từ số ĐOẠN công nhân báo (báo theo đoạn, không
 * báo theo cây). Duyệt dòng theo seq tăng dần: cây xong của dòng = min(barCount, min theo cỡ đoạn
 * của floor(số đoạn còn trong pool / số đoạn mỗi cây)); phần đã dùng bị trừ khỏi pool để dòng sau
 * (cùng lệnh + loại sắt + cỡ đoạn) ăn phần còn lại.
 */
export function estimateMachineProgress(
  lines: MachineProgressLine[],
  reported: Map<string, number>,
): MachineProgress {
  const pool = new Map(reported);
  const sorted = [...lines].sort((a, b) => a.seq - b.seq);
  const out: MachineProgress['lines'] = [];
  let totalBars = 0;
  let barsDone = 0;
  for (const line of sorted) {
    let done = line.barCount;
    let counted = false;
    for (const s of line.segments) {
      if (s.countPerBar <= 0) continue;
      const key = reportedSegmentKey(line.productionInvoiceId, line.materialId, s.cutLengthMm);
      done = Math.min(done, Math.floor((pool.get(key) ?? 0) / s.countPerBar));
      counted = true;
    }
    if (!counted) done = 0;
    done = Math.max(0, done);
    for (const s of line.segments) {
      if (s.countPerBar <= 0) continue;
      const key = reportedSegmentKey(line.productionInvoiceId, line.materialId, s.cutLengthMm);
      pool.set(key, (pool.get(key) ?? 0) - done * s.countPerBar);
    }
    out.push({ id: line.id, barsDone: done, barsLeft: line.barCount - done });
    totalBars += line.barCount;
    barsDone += done;
  }
  return { lines: out, totalBars, barsDone, barsLeft: totalBars - barsDone };
}

/** EMPTY: không có dòng; IDLE: cắt hết; LOW: còn 1..20 cây; BUSY: còn nhiều hơn. */
export function cutMachineStatus(rowCount: number, barsLeft: number): CutMachineStatus {
  if (rowCount === 0) return 'EMPTY';
  if (barsLeft <= 0) return 'IDLE';
  return barsLeft <= CUT_MACHINE_LOW_WORK_BARS ? 'LOW' : 'BUSY';
}

// ─── Tải còn lại của máy ───────────────────────────────────────────

export interface LoadRow extends MachineProgressLine {
  /** Máy đang giữ dòng. */
  machineId: string;
}

/**
 * Tải CÒN LẠI (ước) của từng máy = Σ max(0, barCount − barsDoneEst) các dòng được tính (`include`,
 * mặc định mọi dòng). Số cây đã cắt ước trên TẤT CẢ dòng của máy (theo seq,
 * `estimateMachineProgress`) rồi mới lọc `include` - để dòng không tính (vd dòng tự chia sắp bị xoá
 * khi "Chia lại") vẫn ăn phần đoạn đã báo của nó, không dồn sang dòng giữ lại. Máy không có dòng ->
 * không có khoá (tải 0). `reportedByMachine`: khoá máy -> (khoá reportedSegmentKey -> số đoạn đã
 * báo), như loadReported().byMachine.
 */
export function remainingLoadByMachine(
  rows: LoadRow[],
  reportedByMachine: Map<string, Map<string, number>>,
  include: (row: LoadRow) => boolean = () => true,
): Map<string, number> {
  const byMachine = new Map<string, LoadRow[]>();
  for (const r of rows) {
    const list = byMachine.get(r.machineId) ?? [];
    list.push(r);
    byMachine.set(r.machineId, list);
  }
  const out = new Map<string, number>();
  for (const [machineId, list] of byMachine) {
    const est = estimateMachineProgress(
      list,
      reportedByMachine.get(machineId) ?? new Map<string, number>(),
    );
    const doneById = new Map(est.lines.map((l) => [String(l.id), l.barsDone]));
    let left = 0;
    for (const r of list) {
      if (!include(r)) continue;
      left += Math.max(0, r.barCount - (doneById.get(String(r.id)) ?? 0));
    }
    out.set(machineId, left);
  }
  return out;
}
