import { VN_OFFSET_MS } from '../../common/utils/floor-stats.util';

/**
 * Đo năng suất máy cắt từ giờ công nhân báo qua mã QR ở máy (floor_reports kind CUT).
 * Phần tính THUẦN (không Prisma); service đọc DB rồi gọi vào đây.
 *
 * Cách đo: các lần báo của 1 máy trong 1 ngày (giờ VN) xếp theo giờ; khoảng cách giữa 2 lần
 * báo liền nhau (đã trừ nghỉ trưa) là thời gian máy làm xong số cây của lần báo SAU.
 * Lần báo đầu ngày chỉ đánh dấu bắt đầu nên không vào tốc độ; khoảng > MAX_GAP_MINUTES
 * coi là nghỉ/bắt đầu lại nên cũng không tính.
 */

export const LUNCH_FROM = '11:30';
export const LUNCH_TO = '13:00';
const LUNCH_FROM_MIN = 11 * 60 + 30;
const LUNCH_TO_MIN = 13 * 60;
export const MAX_GAP_MINUTES = 120;
export const MIN_RATE_MINUTES = 30;
export const MAX_SPAN_DAYS = 62;
export const DEFAULT_BAR_LENGTH_MM = 6000;

const MIN_MS = 60_000;
const DAY_MS = 24 * 60 * MIN_MS;

export type CutMachineKind = 'laser' | 'tu_dong';
const KIND_ORDER: CutMachineKind[] = ['laser', 'tu_dong'];

export interface StatsMachine {
  id: string;
  code: string;
  name: string;
  machineType: CutMachineKind;
  isActive: boolean;
}

export interface StatsReportLine {
  materialId: string;
  /** "tên · quy cách". */
  label: string;
  cutLengthMm: number;
  qty: number;
}

export interface StatsReport {
  machineId: string;
  createdAt: Date;
  productionInvoiceId: string | null;
  lines: StatsReportLine[];
}

export interface BarsParams {
  blade: Record<CutMachineKind, number>;
  trim: Record<CutMachineKind, number>;
  defaultBarLengthMm: number;
  /** Chiều dài cây theo phương án, khoá barLengthKey(PI, loại sắt). Thiếu = defaultBarLengthMm. */
  barLengths: ReadonlyMap<string, number>;
}

export interface CutMachineStatsInput extends BarsParams {
  machines: StatsMachine[];
  reports: StatsReport[];
}

export interface StatsMaterialDay {
  materialId: string;
  label: string;
  bars: number;
}

export interface StatsDay {
  machineId: string;
  day: string;
  reports: number;
  firstAt: string;
  lastAt: string;
  segments: number;
  meters: number;
  bars: number;
  rateBars: number;
  rateMinutes: number;
  barsPerHour: number | null;
  materials: StatsMaterialDay[];
}

export interface StatsByMachine {
  machineId: string;
  daysWithData: number;
  totalBars: number;
  barsPerDayAvg: number;
  barsPerDayMedian: number;
  barsPerHour: number | null;
}

export interface StatsByMachineType {
  machineType: CutMachineKind;
  machines: number;
  machineDays: number;
  barsPerDayAvg: number;
  barsPerDayMedian: number;
  barsPerHour: number | null;
}

export interface StatsByMaterial {
  machineType: CutMachineKind;
  materialId: string;
  label: string;
  bars: number;
  rateBars: number;
  rateMinutes: number;
  barsPerHour: number | null;
}

export interface CutMachineStatsResult {
  days: StatsDay[];
  byMachine: StatsByMachine[];
  byMachineType: StatsByMachineType[];
  byMaterial: StatsByMaterial[];
}

export const barLengthKey = (productionInvoiceId: string, materialId: string) =>
  `${productionInvoiceId}:${materialId}`;

/** Làm tròn 1 chữ số thập phân - CHỈ ở đầu ra. */
export const round1 = (n: number) => Math.round(n * 10) / 10;

/** Số cây quy đổi của 1 dòng: qty × (cắt + lưỡi) / (chiều dài cây − tề đầu). Mẫu ≤ 0 thì 0 cây. */
export function lineBars(
  line: { qty: number; cutLengthMm: number },
  barLengthMm: number,
  bladeMm: number,
  trimMm: number,
): number {
  const usable = barLengthMm - trimMm;
  if (!(usable > 0)) return 0;
  return (line.qty * (line.cutLengthMm + bladeMm)) / usable;
}

/** Số phút giữa a và b (a ≤ b) trừ phần trùng với nghỉ trưa 11:30-13:00 giờ VN của ngày chứa a. */
export function gapMinutesExcludingLunch(a: Date, b: Date): number {
  const shiftedA = a.getTime() + VN_OFFSET_MS;
  const shiftedB = b.getTime() + VN_OFFSET_MS;
  const dayBase = Math.floor(shiftedA / DAY_MS) * DAY_MS;
  const lunchStart = dayBase + LUNCH_FROM_MIN * MIN_MS;
  const lunchEnd = dayBase + LUNCH_TO_MIN * MIN_MS;
  const overlap = Math.max(0, Math.min(shiftedB, lunchEnd) - Math.max(shiftedA, lunchStart));
  return (shiftedB - shiftedA - overlap) / MIN_MS;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** cây/giờ nếu đủ MIN_RATE_MINUTES, không thì null (mẫu quá ít để tin). */
export function ratePerHour(rateBars: number, rateMinutes: number): number | null {
  return rateMinutes >= MIN_RATE_MINUTES ? round1(rateBars / (rateMinutes / 60)) : null;
}

const dayKeyOf = (d: Date) => {
  const t = new Date(d.getTime() + VN_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
};

interface ReportCalc {
  at: Date;
  segments: number;
  meters: number;
  bars: number;
  /** Số cây theo loại sắt của lần báo (đã chia theo từng loại). */
  byMaterial: Map<string, { label: string; bars: number }>;
}

function calcReport(r: StatsReport, kind: CutMachineKind, p: BarsParams): ReportCalc | null {
  const calc: ReportCalc = {
    at: r.createdAt,
    segments: 0,
    meters: 0,
    bars: 0,
    byMaterial: new Map(),
  };
  for (const l of r.lines) {
    const fromProposal = r.productionInvoiceId
      ? p.barLengths.get(barLengthKey(r.productionInvoiceId, l.materialId))
      : undefined;
    const barLen = fromProposal != null && fromProposal > 0 ? fromProposal : p.defaultBarLengthMm;
    const bars = lineBars(l, barLen, p.blade[kind], p.trim[kind]);
    calc.segments += l.qty;
    calc.meters += (l.qty * l.cutLengthMm) / 1000;
    calc.bars += bars;
    const cur = calc.byMaterial.get(l.materialId) ?? { label: l.label, bars: 0 };
    cur.bars += bars;
    calc.byMaterial.set(l.materialId, cur);
  }
  return r.lines.length > 0 ? calc : null;
}

interface Acc {
  rateBars: number;
  rateMinutes: number;
}

interface DayGroup {
  machine: StatsMachine;
  day: string;
  calcs: ReportCalc[];
}

interface MaterialAcc {
  label: string;
  bars: number;
  rate: Acc;
}

interface DayRow {
  machine: StatsMachine;
  out: StatsDay;
  bars: number;
  rateBars: number;
  rateMinutes: number;
  byMaterial: Array<{ materialId: string; label: string; bars: number; rate: Acc }>;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Gom các lần báo có số liệu theo (máy, ngày VN). */
function groupByMachineDay(input: CutMachineStatsInput): Map<string, DayGroup> {
  const machineById = new Map(input.machines.map((m) => [m.id, m]));
  const groups = new Map<string, DayGroup>();
  for (const r of input.reports) {
    const machine = machineById.get(r.machineId);
    if (!machine) continue;
    const calc = calcReport(r, machine.machineType, input);
    if (!calc) continue;
    const day = dayKeyOf(r.createdAt);
    const key = `${machine.id}|${day}`;
    const g = groups.get(key) ?? { machine, day, calcs: [] };
    g.calcs.push(calc);
    groups.set(key, g);
  }
  return groups;
}

/** Cộng số cây của lần báo vào tổng theo loại sắt của ngày. */
function addReportBars(c: ReportCalc, mats: Map<string, MaterialAcc>): void {
  for (const [mid, mv] of c.byMaterial) {
    const cur = mats.get(mid) ?? {
      label: mv.label,
      bars: 0,
      rate: { rateBars: 0, rateMinutes: 0 },
    };
    cur.bars += mv.bars;
    mats.set(mid, cur);
  }
}

/** Cộng mẫu tốc độ (cây + phút) của lần báo; gap chia cho các loại sắt theo tỷ lệ cây. */
function addReportRate(
  c: ReportCalc,
  gap: number,
  rate: Acc,
  mats: Map<string, MaterialAcc>,
): void {
  rate.rateBars += c.bars;
  rate.rateMinutes += gap;
  // Tổng các loại = gap, không đếm đôi giờ máy.
  const n = c.byMaterial.size;
  for (const [mid, mv] of c.byMaterial) {
    const share = c.bars > 0 ? mv.bars / c.bars : 1 / n;
    const m = mats.get(mid)!;
    m.rate.rateBars += mv.bars;
    m.rate.rateMinutes += gap * share;
  }
}

/** Số liệu 1 máy trong 1 ngày. */
function buildDayRow(g: DayGroup): DayRow {
  g.calcs.sort((a, b) => a.at.getTime() - b.at.getTime());
  let bars = 0;
  let segments = 0;
  let meters = 0;
  const rate: Acc = { rateBars: 0, rateMinutes: 0 };
  const mats = new Map<string, MaterialAcc>();
  g.calcs.forEach((c, i) => {
    bars += c.bars;
    segments += c.segments;
    meters += c.meters;
    addReportBars(c, mats);
    if (i === 0) return; // lần báo đầu ngày = đánh dấu bắt đầu
    const gap = gapMinutesExcludingLunch(g.calcs[i - 1].at, c.at);
    if (!(gap > 0 && gap <= MAX_GAP_MINUTES)) return;
    addReportRate(c, gap, rate, mats);
  });
  const first = g.calcs[0].at;
  const last = g.calcs[g.calcs.length - 1].at;
  const materials = [...mats.entries()]
    .map(([materialId, v]) => ({ materialId, label: v.label, bars: v.bars, rate: v.rate }))
    .sort((a, b) => b.bars - a.bars || cmp(a.materialId, b.materialId));
  return {
    machine: g.machine,
    bars,
    rateBars: rate.rateBars,
    rateMinutes: rate.rateMinutes,
    byMaterial: materials,
    out: {
      machineId: g.machine.id,
      day: g.day,
      reports: g.calcs.length,
      firstAt: first.toISOString(),
      lastAt: last.toISOString(),
      segments,
      meters: round1(meters),
      bars: round1(bars),
      rateBars: round1(rate.rateBars),
      rateMinutes: Math.round(rate.rateMinutes),
      barsPerHour: ratePerHour(rate.rateBars, rate.rateMinutes),
      materials: materials.map((m) => ({
        materialId: m.materialId,
        label: m.label,
        bars: round1(m.bars),
      })),
    },
  };
}

function summarizeRows(rows: DayRow[]) {
  const total = rows.reduce((s, r) => s + r.bars, 0);
  const rb = rows.reduce((s, r) => s + r.rateBars, 0);
  const rm = rows.reduce((s, r) => s + r.rateMinutes, 0);
  return {
    totalBars: total,
    avg: rows.length ? total / rows.length : 0,
    median: median(rows.map((r) => r.bars)),
    perHour: ratePerHour(rb, rm),
  };
}

function buildByMachine(dayRows: DayRow[]): StatsByMachine[] {
  const byMachineMap = new Map<string, DayRow[]>();
  for (const d of dayRows) {
    const list = byMachineMap.get(d.machine.id) ?? [];
    list.push(d);
    byMachineMap.set(d.machine.id, list);
  }
  return [...byMachineMap.entries()]
    .map(([machineId, rows]) => {
      const s = summarizeRows(rows);
      return {
        code: rows[0].machine.code,
        row: {
          machineId,
          daysWithData: rows.length,
          totalBars: round1(s.totalBars),
          barsPerDayAvg: round1(s.avg),
          barsPerDayMedian: round1(s.median),
          barsPerHour: s.perHour,
        },
      };
    })
    .sort((a, b) => cmp(a.code, b.code))
    .map((x) => x.row);
}

function buildByMachineType(dayRows: DayRow[]): StatsByMachineType[] {
  const out: StatsByMachineType[] = [];
  for (const kind of KIND_ORDER) {
    const rows = dayRows.filter((d) => d.machine.machineType === kind);
    if (rows.length === 0) continue;
    const s = summarizeRows(rows);
    out.push({
      machineType: kind,
      machines: new Set(rows.map((r) => r.machine.id)).size,
      machineDays: rows.length,
      barsPerDayAvg: round1(s.avg),
      barsPerDayMedian: round1(s.median),
      barsPerHour: s.perHour,
    });
  }
  return out;
}

/** Theo (loại máy, loại sắt). */
function buildByMaterial(dayRows: DayRow[]): StatsByMaterial[] {
  const matAgg = new Map<
    string,
    { kind: CutMachineKind; materialId: string; label: string; bars: number; rate: Acc }
  >();
  for (const d of dayRows) {
    for (const m of d.byMaterial) {
      const key = `${d.machine.machineType}|${m.materialId}`;
      const cur = matAgg.get(key) ?? {
        kind: d.machine.machineType,
        materialId: m.materialId,
        label: m.label,
        bars: 0,
        rate: { rateBars: 0, rateMinutes: 0 },
      };
      cur.bars += m.bars;
      cur.rate.rateBars += m.rate.rateBars;
      cur.rate.rateMinutes += m.rate.rateMinutes;
      matAgg.set(key, cur);
    }
  }
  return [...matAgg.values()]
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        b.bars - a.bars ||
        cmp(a.materialId, b.materialId),
    )
    .map((m) => ({
      machineType: m.kind,
      materialId: m.materialId,
      label: m.label,
      bars: round1(m.bars),
      rateBars: round1(m.rate.rateBars),
      rateMinutes: Math.round(m.rate.rateMinutes),
      barsPerHour: ratePerHour(m.rate.rateBars, m.rate.rateMinutes),
    }));
}

export function computeCutMachineStats(input: CutMachineStatsInput): CutMachineStatsResult {
  const dayRows = [...groupByMachineDay(input).values()].map(buildDayRow);
  dayRows.sort((a, b) => cmp(a.out.day, b.out.day) || cmp(a.machine.code, b.machine.code));
  return {
    days: dayRows.map((d) => d.out),
    byMachine: buildByMachine(dayRows),
    byMachineType: buildByMachineType(dayRows),
    byMaterial: buildByMaterial(dayRows),
  };
}
