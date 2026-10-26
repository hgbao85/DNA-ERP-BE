/**
 * Port `explode_bom()`, `list_material_groups()`, `normalize_spec()` (de_xuat_logic.py) và
 * `api_de_xuat_propose()` (api/views.py): nhận body JSON giống hệt, trả response giống hệt.
 */
import { BundleOptions, getHighs, normalizeBundleFactors } from './highs-solver';
import { MCTD_MAX_SIZES_PER_PATTERN } from './optimize-material';
import { optimizeOneMaterial } from './optimize-one-material';
import { roundHalfEven } from './patterns';
import {
  CuttingPattern,
  LengthEval,
  MachineKind,
  PieceRow,
  ProposeRequest,
  ProposeResponse,
  PurchasePlanItem,
} from './types';

/** Mặc định form MC Tự động của app cũ (cat_sat/forms.py): "Cây/bó" 14 16 18 20, cắt tay ≤ 5. */
export const MCTD_DEFAULT_FACTORS = [14, 16, 18, 20];
export const MCTD_DEFAULT_MAX_MANUAL = 5;

const SEP_CHARS = ['*', 'X', '×', '·'];

/** Python str() cho giá trị JSON: null/undefined -> '', đối tượng -> JSON (không ra '[object Object]'). */
function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  return JSON.stringify(v);
}

export function normalizeSpec(spec: unknown): string {
  let s = str(spec).trim();
  for (const ch of SEP_CHARS) s = s.split(ch).join('x');
  s = s.replace(/\s*x\s*/g, 'x');
  return s.replace(/\s+/g, ' ');
}

export function normalizeMaterialKey(k: unknown): string {
  return str(k).replace(/\s+/g, ' ').trim();
}

export function toFloat(v: unknown, def = 0): number {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return Number(def);
  const f = Number(v);
  return Number.isFinite(f) ? f : Number(def);
}

/** Python `int(round(float(v)))`: round() half-to-even -> '2.5' = 2, '3.5' = 4. */
export function toInt(v: unknown, def = 0): number {
  return roundHalfEven(toFloat(v, def));
}

export interface BomRow {
  part: string;
  qty_per_set: number;
  material: string;
  spec: string;
  cut_length: number;
  qty_per_part: number;
}

export interface MaterialGroup {
  material: string;
  sizes: number[];
  demands: number[];
}

export function explodeBom(rows: BomRow[], numSets: number): Map<string, Map<number, number>> {
  const groups = new Map<string, Map<number, number>>();
  for (const r of rows) {
    const cutLen = Math.round(r.cut_length * 10) / 10;
    if (cutLen <= 0) continue;
    const demand = Math.trunc(r.qty_per_set) * Math.trunc(r.qty_per_part) * Math.trunc(numSets);
    if (demand <= 0) continue;
    const mat = normalizeMaterialKey(r.material);
    const key = `${mat} ${normalizeSpec(r.spec)}`.trim();
    let g = groups.get(key);
    if (!g) {
      g = new Map();
      groups.set(key, g);
    }
    g.set(cutLen, (g.get(cutLen) ?? 0) + demand);
  }
  return groups;
}

export function listMaterialGroups(rows: BomRow[], numSets: number): MaterialGroup[] {
  const out: MaterialGroup[] = [];
  for (const [material, dm] of explodeBom(rows, numSets)) {
    const sizes = [...dm.keys()].sort((a, b) => b - a);
    out.push({ material, sizes, demands: sizes.map((s) => dm.get(s)!) });
  }
  return out;
}

function parseLengths(raw: unknown): number[] {
  const parts = Array.isArray(raw) ? raw.map(str) : str(raw).replace(/,/g, ' ').split(/\s+/);
  const set = new Set<number>();
  for (const p of parts) if (p.trim()) set.add(toFloat(p));
  return [...set].filter((L) => L > 0).sort((a, b) => a - b);
}

function parseMaxWastePctByMaterial(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const pct = Number(v);
    if (!Number.isFinite(pct) || !(pct > 0 && pct <= 100)) continue;
    const key = normalizeMaterialKey(k);
    if (key) out[key] = pct;
  }
  return out;
}

function parseStockLengthsByMaterial(raw: unknown): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const lengths = parseLengths(v);
    if (!lengths.length) continue;
    const key = normalizeMaterialKey(k);
    if (key) out[key] = lengths;
  }
  return out;
}

function round4(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

export async function propose(body: ProposeRequest): Promise<ProposeResponse> {
  const err = (code: 'INVALID_INPUT', message: string): ProposeResponse => ({
    status: 'error',
    code,
    message,
    http_status: 400,
  });

  const numSets = toInt(body.num_sets ?? 1, 1);
  if (numSets < 1) return err('INVALID_INPUT', 'num_sets phải ≥ 1');
  const bom = body.bom;
  if (!Array.isArray(bom) || !bom.length)
    return err('INVALID_INPUT', 'bom phải là array không rỗng');

  const bomRows: BomRow[] = [];
  for (const row of bom) {
    if (!row || typeof row !== 'object') continue;
    const cutLen = row.cut_length;
    const material = row.material;
    if (
      cutLen === null ||
      cutLen === undefined ||
      cutLen === '' ||
      material === null ||
      material === undefined ||
      material === ''
    )
      continue;
    bomRows.push({
      part: String(row.part ?? ''),
      qty_per_set: toInt(row.qty_per_set ?? 1, 1),
      material: String(material).trim(),
      spec: String(row.spec ?? '').trim(),
      cut_length: toFloat(cutLen, 0),
      qty_per_part: toInt(row.qty_per_part ?? 1, 1),
    });
  }
  if (!bomRows.length) return err('INVALID_INPUT', 'Định mức rỗng hoặc không hợp lệ');

  const stockLengths = parseLengths(body.stock_lengths);
  if (!stockLengths.length) return err('INVALID_INPUT', 'stock_lengths không hợp lệ');

  const minLen = Math.max(100, toInt(body.min_length ?? 4000, 4000));
  const maxLen = Math.max(minLen, toInt(body.max_length ?? 12000, 12000));
  const step = Math.max(1, toInt(body.length_step ?? 50, 50));
  const trimStart = Math.max(0, toFloat(body.trim_start ?? 10, 10));
  const bladeWidth = Math.max(0, toFloat(body.blade_width ?? 1.0, 1.0));
  const maxWastePct = toFloat(body.max_waste_percentage ?? 1.0, 1.0);
  const maxWastePctByMaterial = parseMaxWastePctByMaterial(body.max_waste_percentage_by_material);
  const stockLengthsByMaterial = parseStockLengthsByMaterial(body.stock_lengths_by_material);
  const maxSurplus = Math.max(0, toInt(body.max_surplus ?? 10, 10));
  const autoScan = Boolean(body.auto_scan ?? false);
  const stopOnFirst = Boolean(body.stop_on_first ?? false);
  const timeLimitSec = Math.max(5, toFloat(body.time_limit_seconds ?? 480, 480));

  // Máy cắt (2026-10-23): mặc định 'laser' = hành vi cũ y nguyên. 'tu_dong' = cắt theo bó như module
  // cat_sat của cat_sat_iea; mặc định các ô như form app cũ (14 16 18 20 cây/bó, cắt tay ≤ 5, ≤ 5 cỡ).
  const machineRaw = str(body.machine ?? 'laser')
    .trim()
    .toLowerCase();
  if (machineRaw !== 'laser' && machineRaw !== 'tu_dong')
    return err('INVALID_INPUT', "machine phải là 'laser' hoặc 'tu_dong'");
  const machine: MachineKind = machineRaw;
  const bundleFactors =
    machine === 'tu_dong'
      ? normalizeBundleFactors(
          body.bundle_factors === undefined || body.bundle_factors === null
            ? MCTD_DEFAULT_FACTORS
            : parseLengths(body.bundle_factors),
        )
      : [];
  if (machine === 'tu_dong' && !bundleFactors.length)
    return err('INVALID_INPUT', 'bundle_factors (cây/bó) phải có ít nhất một hệ số > 1');
  const maxManualCuts =
    machine === 'tu_dong'
      ? Math.max(0, toInt(body.max_manual_cuts ?? MCTD_DEFAULT_MAX_MANUAL, 5))
      : 0;
  const maxSizesPerPattern =
    machine === 'tu_dong'
      ? Math.max(1, toInt(body.max_sizes_per_pattern ?? MCTD_MAX_SIZES_PER_PATTERN, 5))
      : 0;
  const bundle: BundleOptions | undefined =
    machine === 'tu_dong' ? { factors: bundleFactors, maxManualBars: maxManualCuts } : undefined;

  const groups = listMaterialGroups(bomRows, numSets);
  if (!groups.length) return err('INVALID_INPUT', 'Không tách được loại sắt nào từ BOM');

  const highs = await getHighs();
  const resolvedMaxWaste: Record<string, number> = {};
  const resolvedStock: Record<string, number[]> = {};
  const purchasePlan: PurchasePlanItem[] = [];
  let totalBarsAll = 0;
  let totalPurchased = 0;
  let totalWaste = 0;
  let totalSurplus = 0;
  let anyOver = false;
  let totalSolve = 0;
  let feasibleCount = 0;

  for (const g of groups) {
    const key = normalizeMaterialKey(g.material);
    const gMaxWaste = maxWastePctByMaterial[key] ?? maxWastePct;
    resolvedMaxWaste[g.material] = gMaxWaste;
    const gStock = stockLengthsByMaterial[key] ?? stockLengths;
    resolvedStock[g.material] = gStock;

    const t0 = performance.now();
    const res = optimizeOneMaterial(
      highs,
      g.sizes,
      g.demands,
      gStock,
      trimStart,
      bladeWidth,
      gMaxWaste,
      {
        minLen,
        maxLen,
        step,
        timeLimitSec,
        maxSurplus,
        autoScan,
        stopOnFirst,
        ...(bundle ? { bundle, maxSizesPerBar: maxSizesPerPattern } : {}),
      },
    );
    const solveSeconds = Math.round(((performance.now() - t0) / 1000) * 100) / 100;
    totalSolve += solveSeconds;

    if (!res.feasible) {
      purchasePlan.push({
        material: g.material,
        feasible: false,
        timed_out: Boolean(res.timed_out),
        best_achievable: res.best_achievable ?? null,
        reason: res.reason,
        max_waste_pct_threshold: resolvedMaxWaste[g.material],
        solve_seconds: solveSeconds,
      });
      continue;
    }
    feasibleCount++;
    const pieces: PieceRow[] = res.cut_lengths.map((cl, i) => ({
      size: cl,
      demand: res.demands[i] ?? 0,
      produced: res.produced[i] ?? 0,
      surplus: (res.produced[i] ?? 0) - (res.demands[i] ?? 0),
    }));
    const cuttingPatterns: CuttingPattern[] = res.plan.map((pr, idx) => ({
      pattern_id: idx + 1,
      stock_length: pr.stock_length,
      counts: [...pr.counts],
      bars: pr.bars,
      waste_per_bar: pr.waste_per_bar,
      pieces_breakdown: res.cut_lengths.map((cl, j) => ({ size: cl, count: pr.counts[j] })),
      ...(pr.bundles ? { bundles: pr.bundles } : {}),
    }));
    const lengthComparison: LengthEval[] = res.fixed_evals.map((fe) => ({
      length: fe.length,
      bars: fe.bars,
      waste_pct: round4(fe.waste_pct),
    }));
    purchasePlan.push({
      material: g.material,
      feasible: true,
      best_stock_length: res.best_length,
      length_source: res.source,
      total_bars: res.total_bars,
      total_purchased_mm: res.total_purchased_mm,
      total_waste_mm: res.total_waste_mm,
      waste_percentage: round4(res.waste_pct),
      total_surplus_pieces: res.total_surplus_pieces,
      over_threshold: res.over_waste,
      max_waste_pct_threshold: res.max_waste_pct,
      timeout_count: res.timeout_count,
      timeout_lengths: res.timeout_lengths,
      solve_seconds: solveSeconds,
      pieces,
      cutting_patterns: cuttingPatterns,
      length_comparison: lengthComparison,
      optimal_custom_length: res.scan_optimal ? res.scan_optimal.length : null,
      machine: res.machine,
      ...(res.bundle_summary ? { bundle_summary: res.bundle_summary } : {}),
    });
    totalBarsAll += res.total_bars;
    totalPurchased += res.total_purchased_mm;
    totalWaste += res.total_waste_mm;
    totalSurplus += res.total_surplus_pieces;
    if (res.over_waste) anyOver = true;
  }

  return {
    status: 'success',
    summary: {
      num_sets: numSets,
      num_material_groups: feasibleCount,
      total_solve_seconds: Math.round(totalSolve * 100) / 100,
      total_bars_all: totalBarsAll,
      total_purchased_mm: totalPurchased,
      total_waste_mm: totalWaste,
      total_surplus_pieces: totalSurplus,
      waste_percentage: round4(totalPurchased ? (totalWaste / totalPurchased) * 100 : 0),
      any_over_threshold: anyOver,
    },
    purchase_plan: purchasePlan,
    input_echo: {
      num_sets: numSets,
      stock_lengths: stockLengths,
      trim_start: trimStart,
      blade_width: bladeWidth,
      max_waste_percentage: maxWastePct,
      max_waste_percentage_by_material: maxWastePctByMaterial,
      resolved_max_waste_pct_by_group: resolvedMaxWaste,
      stock_lengths_by_material: stockLengthsByMaterial,
      resolved_stock_lengths_by_group: resolvedStock,
      max_surplus: maxSurplus,
      min_length: minLen,
      max_length: maxLen,
      length_step: step,
      auto_scan: autoScan,
      stop_on_first: stopOnFirst,
      machine,
      bundle_factors: bundleFactors,
      max_manual_cuts: maxManualCuts,
      max_sizes_per_pattern: maxSizesPerPattern,
    },
  };
}
