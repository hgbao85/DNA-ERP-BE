/**
 * Bộ giải IP 2 tầng chạy trên HiGHS (WebAssembly, gói npm `highs`).
 *
 * Mô hình đúng như bước 3 của `optimize_material()` trong de_xuat_logic.py:
 *   biến  y_p ∈ Z, 0 ≤ y_p ≤ min_k⌊(demand_k + max_surplus)/counts_pk⌋   (cận trên riêng từng pattern)
 *   ràng  demand_k ≤ Σ_p counts_pk·y_p ≤ demand_k + max_surplus            (0 ≤ dư ≤ max_surplus, KHÔNG cho thiếu)
 *   ràng  Σ_p y_p ≥ ⌈need / (S_max − trim)⌉                                 (cận dưới tổng cây)
 *   Tầng 1: min Σ_p waste_p·y_p
 *   Tầng 2: thêm Σ_p waste_p·y_p ≤ min_leftover (dùng `<=` + nghiệm gợi ý tầng 1 — khác Python dùng `==`
 *           không hint), min Σ_k (produced_k − demand_k) = Σ_p (Σ_k counts_pk)·y_p − const.
 *           Nếu tầng 2 hết giờ không ra nghiệm → GIỮ nghiệm tầng 1 (Python mất nghiệm, xem changelog 4.1.1).
 *
 * Hai chiến lược (cùng nghiệm tối ưu, khác tốc độ chứng minh):
 *   'direct': đúng 1 model như Python, HiGHS tự chứng minh. Ca I3 (9 cỡ) HiGHS dừng ở cận dưới 116 cây
 *             và không chứng minh nổi 117 là tối ưu trong 300 s (xem changelog mục 7.3).
 *   'byN'   : tách theo SỐ CÂY N (chỉ khi 1 chiều dài cây). Đồng nhất thức
 *               tổng_khúc_thừa = stock·N − need − sắt_thành_đoạn_dư
 *             cho cận dưới chính xác từng N bằng một bài knapsack nhỏ (số đoạn dư mỗi cỡ ≤ max_surplus,
 *             tổng sắt dư ≤ stock·N − need − w_min·N). Giải các N theo cận dưới tăng dần, cố định Σy = N,
 *             đặt `objective_target` = cận dưới → HiGHS dừng ngay khi chạm (tối ưu đã chứng minh bên ngoài),
 *             dừng vòng khi cận dưới của N kế ≥ nghiệm tốt nhất. Tầng 2 cũng có cận dưới knapsack:
 *             ít nhất bao nhiêu đoạn dư mới gom đủ lượng sắt dư đó.
 */
import loadHighs from 'highs';

/** Instance HiGHS đã nạp (WASM). Export để khai báo kiểu ở các hàm public (declaration emit). */
export type Highs = Awaited<ReturnType<typeof loadHighs>>;

let highsPromise: Promise<Highs> | null = null;
export function getHighs(): Promise<Highs> {
  if (!highsPromise) highsPromise = loadHighs();
  return highsPromise;
}

export interface IpPattern {
  counts: number[];
  waste: number; // đã scale
}

export type Strategy = 'direct' | 'byN';

export interface TwoStageInput {
  patterns: IpPattern[];
  demands: number[];
  maxSurplus: number;
  /** cận dưới Σy (0 = không áp) */
  minTotalBars: number;
  timeLimitSec: number;
  strategy?: Strategy;
  /** (l_k + kerf) đã scale — cần cho 'byN' */
  cutCostS?: number[];
  /** chiều dài cây đã scale, CHỈ khi mọi pattern cùng một chiều dài — cần cho 'byN' */
  stockS?: number;
  /** nạp nghiệm tham lam (greedyStart) làm điểm xuất phát cho model gốc ở tầng 1 */
  warmStart?: boolean;
  /**
   * MC TỰ ĐỘNG (cắt theo BÓ, port GĐ2 `optimize_distribution` của cat_sat/optimization_logic.py trong
   * D:\cat_sat_iea): mỗi pattern được cắt theo bó f cây một lần (f ∈ factors, vd 14/16/18/20), phần lẻ
   * cắt từng cây = "cắt tay" (hệ số 1), tổng số cây cắt tay ≤ maxManualBars. Có mặt = bật; model theo
   * bó chỉ chạy 'direct' (byN/roundingStart/greedyStart đều tính theo cột = pattern, không theo bó), nhưng
   * ca nhiều pattern đi đường "thu hẹp" - xem solveBundled: giải KHÔNG bó bằng đường laser để lấy tập
   * pattern tốt, giải bó trên tập đó trước rồi mới tới bài đầy đủ.
   */
  bundle?: BundleOptions;
  /**
   * CHỈ ĐỂ TEST đối chiếu với app cũ (cat_sat cho phép THIẾU trong max_stock_over): cận dưới nhu cầu
   * = demand − maxSurplus. ERP không bao giờ bật (propose.ts không đọc cờ này).
   */
  allowShortage?: boolean;
  /**
   * Chỉ giải tầng 1 (min khúc thừa) rồi trả nghiệm đó - dùng cho bài không-bó lấy tập pattern của MC Tự động
   * (solveBundled), nơi chỉ cần biết pattern nào tốt, không cần tối ưu tiếp tổng đoạn dư.
   */
  stage1Only?: boolean;
}

export interface BundleOptions {
  /** hệ số bó (cây/bó), > 1; hệ số 1 (cắt tay) luôn được thêm */
  factors: number[];
  /** tổng số cây cắt tay tối đa (app cũ: "Số lần cắt thủ công tối đa", mặc định 5) */
  maxManualBars: number;
  /** từ chừng này pattern trở lên mới đi đường thu hẹp (mặc định BUNDLE_NARROW_MIN_PATTERNS); ít hơn = giải thẳng */
  narrowMinPatterns?: number;
  /** số pattern ít phế nhất thêm vào tập thu hẹp ngoài các pattern nghiệm không-bó dùng (mặc định BUNDLE_NARROW_EXTRA) */
  narrowExtraPatterns?: number;
  /**
   * CHỈ ĐỂ TEST: ép ngân sách bài ĐẦY ĐỦ (mỗi tầng) về chừng này giây, giả lập "bài đầy đủ hết giờ" mà
   * không phải dựng ca khổng lồ - nghiệm thu hẹp phải được giữ.
   */
  testFullBudgetSec?: number;
  /** CHỈ ĐỂ TEST: ép time_limit của bài không-bó (0 = giả lập "không-bó hết giờ ngay") */
  testRelaxBudgetSec?: number;
}

/** Ghi chú đường thu hẹp của MC Tự động (chẩn đoán; có trong stats khi đi đường này). */
export interface NarrowInfo {
  /** giây giải bài không bó (đường laser) lấy tập pattern */
  relaxSeconds: number;
  /** số pattern nghiệm không-bó dùng */
  relaxPatterns: number;
  relaxStatus: StageStatus;
  /** số pattern trong bài thu hẹp tầng 1 / tầng 2 */
  narrowPatterns1: number;
  narrowPatterns2: number;
  narrowStatus1: StageStatus | null;
  narrowStatus2: StageStatus | null;
  /** trạng thái bài ĐẦY ĐỦ ở mỗi tầng (null = không chạy vì đã chạm cận hoặc hết giờ) */
  fullStatus1: StageStatus | null;
  fullStatus2: StageStatus | null;
  /** nghiệm cuối mỗi tầng lấy từ bài nào */
  stage1From: 'narrow' | 'full' | null;
  stage2From: 'narrow' | 'full' | 'stage1' | null;
}

/** Cột của model khi cắt theo bó: (pattern, hệ số bó); không bó thì mỗi cột = 1 pattern, factor = 1. */
export interface ColumnMap {
  pattern: number;
  factor: number;
}

export type StageStatus =
  | 'optimal'
  | 'optimal_by_bound'
  | 'feasible_time_limit'
  | 'infeasible'
  | 'time_limit_no_solution'
  | 'error';

export interface Incumbent {
  /** giây kể từ lúc HiGHS bắt đầu chạy tầng này */
  t: number;
  obj: number;
}

export interface ByNStep {
  N: number;
  bound: number;
  status: StageStatus;
  objective: number | null;
  seconds: number;
  /** 'rounding' = nghiệm từ roundingStart đã chạm cận; 'rounding-start' = MIP đầy đủ chạy với điểm xuất phát đó */
  via?: 'rounding' | 'rounding-start';
}

export interface StageInfo {
  status: StageStatus;
  seconds: number;
  objective: number | null;
  /** cận dưới tốt nhất HiGHS chứng minh được (null nếu không có sự kiện) */
  dualBound: number | null;
  trace: Incumbent[];
  /** chỉ có ở chiến lược 'byN' */
  byN?: ByNStep[];
}

interface StageRun {
  status: StageStatus;
  y: number[] | null;
  objective: number | null;
  seconds: number;
  trace: Incumbent[];
  dualBound: number | null;
  /** dừng vì abortIfNoIncumbentAfterSec (chưa có nghiệm nào) */
  abortedNoIncumbent?: boolean;
}

export interface TwoStageResult {
  /**
   * Nghiệm cuối cùng theo CỘT hoặc null nếu không có nghiệm. Không bó: cột p = số cây pattern p.
   * Có bó: xem `columns` - y[c] = số BÓ (hoặc số cây cắt tay khi factor = 1) của (pattern, factor).
   */
  y: number[] | null;
  /** chỉ khi có `bundle`: ánh xạ cột -> (pattern, factor) */
  columns?: ColumnMap[];
  strategy: Strategy;
  stage1: StageInfo;
  stage2: StageInfo & { fellBack: boolean };
  /** chỉ khi MC Tự động đi đường thu hẹp (solveBundled) */
  narrow?: NarrowInfo;
}

interface Built {
  numCols: number;
  numRows: number;
  colLower: number[];
  colUpper: number[];
  rowLower: number[];
  rowUpper: number[];
  starts: number[];
  indices: number[];
  values: number[];
  integrality: Int32Array;
  /** Σ_k counts_pk × factor (số đoạn một cột tạo ra) */
  pieces: number[];
  /** khúc thừa × factor của một cột */
  wastes: number[];
  /** chỉ số hàng Σ(factor·y) = tổng cây (−1 nếu không có) */
  sumRow: number;
  /** chỉ khi có bó: cột -> (pattern, factor) */
  columns?: ColumnMap[];
}

/** Hệ số bó hợp lệ: nguyên, > 1, bỏ trùng, giảm dần (như app cũ `sorted(set(factors), reverse=True)`). */
export function normalizeBundleFactors(raw: number[]): number[] {
  return [...new Set(raw.map((f) => Math.trunc(f)).filter((f) => f > 1))].sort((a, b) => b - a);
}

function build(highs: Highs, inp: TwoStageInput): Built {
  const { patterns, demands, maxSurplus, minTotalBars } = inp;
  const n = demands.length;
  const P = patterns.length;
  const useLb = minTotalBars > 0;
  // Có bó: thêm hàng "Σ cây cắt tay ≤ maxManualBars" ngay sau hàng Σ cây (nếu có).
  const bundle = inp.bundle ? [...normalizeBundleFactors(inp.bundle.factors), 1] : null;
  const useManual = bundle !== null;
  const sumRow = useLb ? n : -1;
  const manualRow = useManual ? n + (useLb ? 1 : 0) : -1;
  const numRows = n + (useLb ? 1 : 0) + (useManual ? 1 : 0);
  const factors = bundle ?? [1];
  const numCols = P * factors.length;

  const colLower = new Array<number>(numCols).fill(0);
  const colUpper = new Array<number>(numCols);
  const starts: number[] = [0];
  const indices: number[] = [];
  const values: number[] = [];
  const pieces = new Array<number>(numCols);
  const wastes = new Array<number>(numCols);
  const columns: ColumnMap[] = [];

  let col = 0;
  for (let p = 0; p < P; p++) {
    const c = patterns[p].counts;
    // cap = số CÂY tối đa của pattern p (không cỡ nào vượt demand + maxSurplus)
    let cap = Infinity;
    let tot = 0;
    for (let k = 0; k < n; k++) {
      if (c[k] > 0) {
        cap = Math.min(cap, Math.floor((demands[k] + maxSurplus) / c[k]));
        tot += c[k];
      }
    }
    for (const f of factors) {
      for (let k = 0; k < n; k++) {
        if (c[k] > 0) {
          indices.push(k);
          values.push(c[k] * f);
        }
      }
      if (useLb) {
        indices.push(sumRow);
        values.push(f);
      }
      if (useManual && f === 1) {
        indices.push(manualRow);
        values.push(1);
      }
      starts.push(indices.length);
      // Có bó: cận trên số bó = ceil(cap / f) như app cũ (safe_div_ceil) - bó cuối có thể vượt cap
      // về số cây, nhưng ràng buộc hàng (≤ demand + maxSurplus) vẫn chặn đúng.
      colUpper[col] = cap === Infinity ? 0 : f === 1 ? cap : Math.ceil(cap / f);
      pieces[col] = tot * f;
      wastes[col] = patterns[p].waste * f;
      columns.push({ pattern: p, factor: f });
      col++;
    }
  }

  const rowLower = new Array<number>(numRows);
  const rowUpper = new Array<number>(numRows);
  for (let k = 0; k < n; k++) {
    rowLower[k] = inp.allowShortage ? Math.max(0, demands[k] - maxSurplus) : demands[k];
    rowUpper[k] = demands[k] + maxSurplus;
  }
  if (useLb) {
    rowLower[sumRow] = minTotalBars;
    rowUpper[sumRow] = highs.infinity;
  }
  if (useManual) {
    rowLower[manualRow] = 0;
    rowUpper[manualRow] = Math.max(0, Math.trunc(inp.bundle!.maxManualBars));
  }

  return {
    numCols,
    numRows,
    colLower,
    colUpper,
    rowLower,
    rowUpper,
    starts,
    indices,
    values,
    integrality: new Int32Array(numCols).fill(1),
    pieces,
    wastes,
    sumRow,
    ...(useManual ? { columns } : {}),
  };
}

interface RunOpts {
  colCost: number[];
  /** hàng thêm: Σ coef·y ≤ upper (hệ số theo cột, 0 = bỏ) */
  extraRow?: { values: number[]; upper: number };
  /** ghi đè cận của một hàng có sẵn (vd cố định Σy = N) */
  rowBounds?: { row: number; lower: number; upper: number };
  start?: number[] | null;
  timeLimitSec: number;
  /** HiGHS dừng ngay khi nghiệm ≤ target — chỉ dùng khi target là cận dưới ĐÃ CHỨNG MINH bên ngoài */
  objectiveTarget?: number;
  /** giải bài nới lỏng LP (bỏ ràng buộc nguyên), trả y thực KHÔNG làm tròn */
  relax?: boolean;
  /** ngắt sớm nếu sau chừng này giây vẫn CHƯA có nghiệm nào (để chuyển sang roundingStart) */
  abortIfNoIncumbentAfterSec?: number;
}

/**
 * Tuỳ chọn HiGHS thêm cho thử nghiệm (JSON trong biến môi trường SOLVER_HIGHS_OPTIONS, vd
 * '{"presolve":"off"}'). Rỗng = không thêm gì. Chỉ để đo/tinh chỉnh, không phải cấu hình vận hành.
 */
let extraOptionsCache: Record<string, unknown> | null = null;
function extraHighsOptions(): Record<string, unknown> {
  if (extraOptionsCache) return extraOptionsCache;
  const raw = process.env.SOLVER_HIGHS_OPTIONS;
  extraOptionsCache = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  return extraOptionsCache;
}

function runModel(highs: Highs, b: Built, o: RunOpts): StageRun {
  const t0 = performance.now();
  const trace: Incumbent[] = [];
  let dualBound: number | null = null;
  const numRows = b.numRows + (o.extraRow ? 1 : 0);
  let starts = b.starts;
  let indices = b.indices;
  let values = b.values;
  const rowLower = b.rowLower.slice();
  const rowUpper = b.rowUpper.slice();
  if (o.rowBounds) {
    rowLower[o.rowBounds.row] = o.rowBounds.lower;
    rowUpper[o.rowBounds.row] = o.rowBounds.upper;
  }
  if (o.extraRow) {
    // Chèn hàng mới vào CSC: mỗi cột có hệ số ≠ 0 thêm 1 phần tử.
    const ns: number[] = [0];
    const ni: number[] = [];
    const nv: number[] = [];
    for (let p = 0; p < b.numCols; p++) {
      for (let k = b.starts[p]; k < b.starts[p + 1]; k++) {
        ni.push(b.indices[k]);
        nv.push(b.values[k]);
      }
      const w = o.extraRow.values[p];
      if (w !== 0) {
        ni.push(b.numRows);
        nv.push(w);
      }
      ns.push(ni.length);
    }
    starts = ns;
    indices = ni;
    values = nv;
    rowLower.push(-highs.infinity);
    rowUpper.push(o.extraRow.upper);
  }

  const model = highs.createModel({
    numCols: b.numCols,
    numRows,
    colCost: o.colCost,
    colLower: b.colLower,
    colUpper: b.colUpper,
    rowLower,
    rowUpper,
    matrix: { format: 'csc', numRows, numCols: b.numCols, starts, indices, values },
    ...(o.relax ? {} : { integrality: b.integrality }),
  });
  try {
    model.options.set({
      output_flag: false,
      time_limit: Math.max(0.01, o.timeLimitSec),
      // Hàm mục tiêu toàn hệ số nguyên trên biến nguyên → gap tuyệt đối < 1 là đã tối ưu.
      mip_rel_gap: 0,
      mip_abs_gap: 0.999,
      ...(o.objectiveTarget !== undefined ? { objective_target: o.objectiveTarget + 0.5 } : {}),
      ...extraHighsOptions(),
    });
    if (o.start) model.setSolution({ colValue: o.start });
    // Ghi mốc thời gian mỗi lần có nghiệm tốt hơn + cận dưới cuối cùng, để biết "nghiệm tốt nhất
    // xuất hiện ở giây thứ mấy" (quyết định time_limit thực tế) và khoảng cách còn lại khi hết giờ.
    const cb = highs.constants.callbackType;
    const callbacks = {
      [cb.mipImprovingSolution]: (ev: {
        data: { running_time?: number; objective_function_value?: number };
      }) => {
        trace.push({ t: ev.data.running_time ?? -1, obj: ev.data.objective_function_value ?? NaN });
        return undefined;
      },
      // HiGHS WASM vượt `time_limit` 2-3 lần trên model lớn (đo 2026-10-20: 24.184 pattern, limit 20 s
      // -> 58-63 s): giới hạn chỉ được kiểm giữa các nút B&B, phần gốc (presolve/LP/cắt/heuristic) chạy
      // liền. Callback mipInterrupt được gọi đều hơn -> tự ngắt khi quá hạn (nghiệm đang có vẫn lấy được).
      [cb.mipInterrupt]: (ev: { data: { mip_dual_bound?: number }; interrupt: () => void }) => {
        if (typeof ev.data.mip_dual_bound === 'number') dualBound = ev.data.mip_dual_bound;
        const elapsed = performance.now() - t0;
        if (elapsed > o.timeLimitSec * 1000) {
          interrupted = true;
          ev.interrupt();
        } else if (
          o.abortIfNoIncumbentAfterSec !== undefined &&
          trace.length === 0 &&
          elapsed > o.abortIfNoIncumbentAfterSec * 1000
        ) {
          // Chưa có nghiệm nào sau ngần ấy giây -> dừng để người gọi dựng điểm xuất phát (roundingStart).
          interrupted = true;
          abortedNoIncumbent = true;
          ev.interrupt();
        }
        return undefined;
      },
    } as unknown as Parameters<typeof model.run>[0];
    let interrupted = false;
    let abortedNoIncumbent = false;
    const run = model.run(callbacks);
    const ms = highs.constants.modelStatus;
    const primalOk = model.info.get('primal_solution_status') === 2;
    let status: StageStatus;
    if (run.modelStatus === ms.optimal) status = 'optimal';
    else if (run.modelStatus === ms.objectiveTarget && primalOk) status = 'optimal_by_bound';
    else if (run.modelStatus === ms.infeasible) status = 'infeasible';
    else if (primalOk) status = 'feasible_time_limit';
    else if (
      run.modelStatus === ms.timeLimit ||
      (interrupted && run.modelStatus === ms.interrupted)
    )
      status = 'time_limit_no_solution';
    else status = 'error';
    let y: number[] | null = null;
    let objective: number | null = null;
    if (status === 'optimal' || status === 'optimal_by_bound' || status === 'feasible_time_limit') {
      const sol = model.getSolution();
      y = Array.from(sol.colValue, (v) => (o.relax ? v : Math.round(v)));
      // Tính lại objective từ nghiệm nguyên (tránh sai số float của solver).
      objective = 0;
      for (let p = 0; p < b.numCols; p++) objective += o.colCost[p] * y[p];
    }
    return {
      status,
      y,
      objective,
      seconds: (performance.now() - t0) / 1000,
      trace,
      dualBound,
      abortedNoIncumbent,
    };
  } finally {
    model.dispose();
  }
}

function emptyStage(status: StageStatus): StageInfo {
  return { status, seconds: 0, objective: null, dualBound: null, trace: [] };
}

function proven(s: StageStatus): boolean {
  return s === 'optimal' || s === 'optimal_by_bound';
}

// ---------------------------------------------------------------------------
// Knapsack sắt-thành-đoạn-dư: với mỗi lượng sắt v (đã scale) cho biết có gom được ĐÚNG v bằng các đoạn
// dư (mỗi cỡ ≤ maxSurplus đoạn) không, và ít nhất bao nhiêu đoạn.
// ---------------------------------------------------------------------------
interface SurplusKnapsack {
  V: number;
  minCount: Int32Array; // Int32 max = không gom được
}

const UNREACH = 0x7fffffff;
const KNAPSACK_MAX_V = 20_000_000;

function surplusKnapsack(cutCostS: number[], maxSurplus: number): SurplusKnapsack | null {
  let V = 0;
  for (const c of cutCostS) V += c * maxSurplus;
  if (V > KNAPSACK_MAX_V) return null;
  let cur = new Int32Array(V + 1).fill(UNREACH);
  cur[0] = 0;
  for (const cost of cutCostS) {
    const next = cur.slice();
    for (let v = cost; v <= V; v++) {
      let best = next[v];
      for (let c = 1; c <= maxSurplus && c * cost <= v; c++) {
        const prev = cur[v - c * cost];
        if (prev !== UNREACH && prev + c < best) best = prev + c;
      }
      next[v] = best;
    }
    cur = next;
  }
  return { V, minCount: cur };
}

/** Lượng sắt dư lớn nhất gom được mà ≤ cap. */
function maxReachable(ks: SurplusKnapsack, cap: number): number {
  for (let v = Math.min(cap, ks.V); v >= 0; v--) if (ks.minCount[v] !== UNREACH) return v;
  return 0;
}

// ---------------------------------------------------------------------------

/**
 * Nghiệm tham lam KHẢ THI (không tối ưu) cho IP tầng 1 - dùng làm điểm xuất phát cho HiGHS ở ca model
 * lớn (vài chục nghìn pattern) mà HiGHS mất hàng chục giây mới ra nghiệm đầu tiên, hoặc không kịp trong
 * time_limit (đo 2026-10-20: loại 7 cỡ có đoạn 20 mm × 120 -> 24.184 pattern, nghiệm đầu ở giây 52-60
 * dù time_limit 20 s). Thuật toán: xếp pattern theo khúc thừa tăng dần; vòng 1 lấy pattern nào còn
 * cắt VỪA nhu cầu (không dư) nhiều cây nhất có thể; vòng 2 (phần lẻ cuối) mỗi lần thêm 1 cây của
 * pattern làm dư ít đoạn nhất mà không cỡ nào vượt max_surplus. Trả null nếu kẹt (không nạp gì).
 */
export function greedyStart(
  patterns: IpPattern[],
  demands: number[],
  maxSurplus: number,
): number[] | null {
  const n = demands.length;
  const P = patterns.length;
  const order = Array.from({ length: P }, (_, p) => p).sort(
    (a, c) => patterns[a].waste - patterns[c].waste || a - c,
  );
  const remaining = demands.slice();
  const y = new Array<number>(P).fill(0);
  // Vòng 1: không dư.
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const p of order) {
      const c = patterns[p].counts;
      let t = Infinity;
      for (let k = 0; k < n; k++) if (c[k] > 0) t = Math.min(t, Math.floor(remaining[k] / c[k]));
      if (t === Infinity || t <= 0) continue;
      y[p] += t;
      for (let k = 0; k < n; k++) remaining[k] -= t * c[k];
      progressed = true;
    }
  }
  // Vòng 2: phần lẻ - cho phép dư trong max_surplus.
  let guard = 0;
  while (remaining.some((r) => r > 0)) {
    if (++guard > 100_000) return null;
    let bestP = -1;
    let bestOver = Infinity;
    for (const p of order) {
      const c = patterns[p].counts;
      let over = 0;
      let covers = false;
      let ok = true;
      for (let k = 0; k < n; k++) {
        if (c[k] === 0) continue;
        if (remaining[k] > 0) covers = true;
        // dư sau khi thêm 1 cây = (dư hiện tại) + c[k] - remaining[k] (remaining âm = đã dư)
        if (c[k] - remaining[k] > maxSurplus) {
          ok = false;
          break;
        }
        over += Math.max(0, c[k] - remaining[k]);
      }
      if (!ok || !covers) continue;
      if (over < bestOver) {
        bestOver = over;
        bestP = p;
        if (over === 0) break;
      }
    }
    if (bestP < 0) return null;
    y[bestP] += 1;
    const c = patterns[bestP].counts;
    for (let k = 0; k < n; k++) remaining[k] -= c[k];
  }
  return y;
}

/**
 * Có bó: tầng 2 thêm tie-break "ít bó/lần cắt" sau tổng đoạn dư (app cũ: hao hụt × 10^6 + số bó; bản
 * Excel: giữ hao hụt → |chênh lệch| × 1000 + số bó). Hệ số nguyên nên vẫn hợp với mip_abs_gap 0,999.
 */
const BUNDLE_TIEBREAK_WEIGHT = 1000;

function solveDirect(highs: Highs, b: Built, inp: TwoStageInput): TwoStageResult {
  const bundled = b.columns !== undefined;
  // Tầng 1: min tổng khúc thừa
  const s1 = runModel(highs, b, {
    colCost: b.wastes,
    timeLimitSec: inp.timeLimitSec,
    start:
      inp.warmStart && !bundled ? greedyStart(inp.patterns, inp.demands, inp.maxSurplus) : null,
  });
  if (!s1.y) {
    return {
      y: null,
      ...(bundled ? { columns: b.columns } : {}),
      strategy: 'direct',
      stage1: {
        ...emptyStage(s1.status),
        seconds: s1.seconds,
        dualBound: s1.dualBound,
        trace: s1.trace,
      },
      stage2: { ...emptyStage('error'), fellBack: false },
    };
  }
  const minLeftover = s1.objective!;
  if (inp.stage1Only) {
    return {
      y: s1.y,
      ...(bundled ? { columns: b.columns } : {}),
      strategy: 'direct',
      stage1: {
        status: s1.status,
        seconds: s1.seconds,
        objective: minLeftover,
        dualBound: s1.dualBound,
        trace: s1.trace,
      },
      stage2: { ...emptyStage('error'), fellBack: false },
    };
  }

  // Tầng 2: khoá tầng 1 bằng `<=`, min tồn dư, gợi ý nghiệm tầng 1. Có bó: + tie-break ít bó.
  const s2 = runModel(highs, b, {
    colCost: bundled ? b.pieces.map((v) => v * BUNDLE_TIEBREAK_WEIGHT + 1) : b.pieces,
    extraRow: { values: b.wastes, upper: minLeftover },
    start: s1.y,
    timeLimitSec: inp.timeLimitSec,
  });
  const fellBack = !s2.y;
  return {
    y: s2.y ?? s1.y,
    ...(bundled ? { columns: b.columns } : {}),
    strategy: 'direct',
    stage1: {
      status: s1.status,
      seconds: s1.seconds,
      objective: minLeftover,
      dualBound: s1.dualBound,
      trace: s1.trace,
    },
    stage2: {
      status: s2.status,
      seconds: s2.seconds,
      objective: s2.objective,
      dualBound: s2.dualBound,
      trace: s2.trace,
      fellBack,
    },
  };
}

/**
 * Số N được phép KHÔNG chạm cận dưới knapsack trước khi coi cận này là lỏng (ca không "cắt kín") và về
 * 'direct'. Đo: 2 lần thử tốn thêm ~17 s ở ca 15 cỡ mà không giúp gì; 1 lần là đủ vì N có cận thấp nhất
 * mà không đạt cận thì các N sau cũng gần như không đạt.
 *
 * N VÔ NGHIỆM KHÔNG tính là trượt: HiGHS đã chứng minh N đó không có nghiệm -> chỉ loại N đó, xét N kế.
 * (Từ 2026-10-21. Trước đó tính là trượt để vá lỗi "N tối ưu nằm ngoài danh sách ứng viên" - proposal 2,
 * loại 4: N=695..699 đều vô nghiệm, tối ưu 701 ngoài danh sách - nhưng làm chiều dài vô nghiệm thật bị gắn
 * nhãn "hết giờ" (dữ liệu thật MZ I5: FI4/FI6/FI10 mất best_achievable). Lỗi 701 giờ được chặn đúng chỗ:
 * mốc "đuôi danh sách" trong solveByN.)
 */
const MAX_BYN_MISSES = 1;

/** Phần ngân sách tầng 1 (mỗi N) dành cho roundingStart; phần còn lại cho MIP đầy đủ nếu cần. */
const ROUNDING_FRACTION = 0.4;
/** MIP đầy đủ chưa có nghiệm nào sau chừng này phần ngân sách -> ngắt, chuyển sang roundingStart. */
const ROUNDING_PROBE_FRACTION = 0.25;
/** Từ chừng này cây (N) trở lên thì chạy roundingStart TRƯỚC MIP đầy đủ (xem chỗ dùng trong solveByN). */
const ROUNDING_MIN_BARS = 1000;
/** Phần cây đã làm tròn được nhả lại cho bài phần dư, theo thứ tự thử (xem roundingStart). */
const ROUNDING_FREE_FRACTIONS = [0.05, 0.1, 0.02];

/** In vết gỡ lỗi khi SOLVER_TS_DEBUG=1 (stderr). */
function dbg(msg: string): void {
  if (process.env.SOLVER_TS_DEBUG === '1') process.stderr.write(`${msg}\n`);
}

/** Tắt bước "làm tròn LP + giải phần dư" (roundingStart) để so sánh: SOLVER_TS_ROUNDING=0. */
function roundingEnabled(): boolean {
  return process.env.SOLVER_TS_ROUNDING !== '0';
}

/**
 * Nghiệm KHẢ THI cho tầng 1 với ĐÚNG N cây, dựng bằng "làm tròn LP + giải phần dư" (cách chuẩn của bài toán
 * cắt): (1) giải LP nới lỏng (Σy = N, min khúc thừa) - vài mili giây; (2) làm tròn xuống y; (3) phần nhu cầu
 * còn thiếu là bài toán NHỎ (cỡ vài chục cây) -> giải MIP phần dư với đúng số cây còn lại; nghiệm ghép = nghiệm
 * khả thi của bài gốc. Phần dư phải lấp kín đúng số cây còn lại: KHÔNG nhả cây nào thì rất khó (đo I5 V15: 7,9 s),
 * nhả một ít cây đã làm tròn cho phần dư có chỗ xoay xở thì nhanh hơn nhiều (nhả 3-10 %: 2-3 s, cùng chạm cận;
 * 20 %: 5,6 s) -> thử 5 %, 10 %, 2 % (luôn nhả ít nhất 1 cây).
 *
 * Lý do (đo 2026-10-22, I5 V15 LSX 316: 12 cỡ, 27.300 đoạn, 39.259 pattern còn 5.000): byN cố định N=1794 nhưng
 * HiGHS mất ~60 s mới ra NGHIỆM ĐẦU TIÊN (cắt kín, không có điểm xuất phát) -> hết 20 s không có gì -> retry
 * ×3, ×6 rồi dò chiều dài, >25 phút. greedyStart không giúp được: nó chỉ dùng ở nhánh model gốc và không ép
 * đúng N cây (thường thừa vài cây so với cận) nên không hợp lệ cho model cố định N.
 *
 * Trả null nếu không dựng được (LP vô nghiệm/hết giờ, phần dư không ra) - khi đó MIP đầy đủ chạy như cũ.
 */
function roundingStart(
  highs: Highs,
  b: Built,
  inp: TwoStageInput,
  N: number,
  target: number,
  budgetSec: number,
): { y: number[]; obj: number } | null {
  const t0 = performance.now();
  const left = () => budgetSec - (performance.now() - t0) / 1000;
  const lp = runModel(highs, b, {
    colCost: b.wastes,
    rowBounds: { row: b.sumRow, lower: N, upper: N },
    timeLimitSec: Math.max(0.05, left()),
    relax: true,
  });
  dbg(
    `roundingStart N=${N}: LP ${lp.status} ${lp.seconds.toFixed(2)}s obj=${String(lp.objective)} bound=${target}`,
  );
  if (!lp.y || (lp.status !== 'optimal' && lp.status !== 'feasible_time_limit')) return null;
  const n = inp.demands.length;
  const P = b.numCols;
  const base = lp.y.map((v) => Math.floor(v + 1e-9));
  for (const freeFrac of ROUNDING_FREE_FRACTIONS) {
    if (left() <= 0) return null;
    const yF = base.slice();
    // Nhả thêm cây (theo tỉ lệ, ưu tiên kiểu nhiều cây nhất) để phần dư có chỗ xoay xở.
    let toFree = Math.max(1, Math.ceil(freeFrac * N));
    if (toFree > 0) {
      const order = yF
        .map((v, p) => p)
        .filter((p) => yF[p] > 0)
        .sort((a, c) => yF[c] - yF[a]);
      while (toFree > 0 && order.length) {
        let freed = false;
        for (const p of order) {
          if (toFree <= 0) break;
          if (yF[p] > 0) {
            yF[p] -= 1;
            toFree -= 1;
            freed = true;
          }
        }
        if (!freed) break;
      }
    }
    const prod = new Array<number>(n).fill(0);
    let nF = 0;
    let objF = 0;
    for (let p = 0; p < P; p++) {
      if (!yF[p]) continue;
      nF += yF[p];
      objF += yF[p] * b.wastes[p];
      for (let k = b.starts[p]; k < b.starts[p + 1]; k++) {
        if (b.indices[k] < n) prod[b.indices[k]] += b.values[k] * yF[p];
      }
    }
    const lo = inp.demands.map((d, k) => Math.max(0, d - prod[k]));
    const hi = inp.demands.map((d, k) => d + inp.maxSurplus - prod[k]);
    if (hi.some((h) => h < 0) || nF > N) continue;
    // Bài phần dư: cùng ma trận, cận hàng = phần còn thiếu, cận cột co lại theo phần còn thiếu.
    const colUpper = new Array<number>(P);
    for (let p = 0; p < P; p++) {
      let cap = Infinity;
      for (let k = b.starts[p]; k < b.starts[p + 1]; k++) {
        if (b.indices[k] < n) cap = Math.min(cap, Math.floor(hi[b.indices[k]] / b.values[k]));
      }
      colUpper[p] = cap === Infinity ? 0 : Math.max(0, cap);
    }
    const rowLower = b.rowLower.slice();
    const rowUpper = b.rowUpper.slice();
    for (let k = 0; k < n; k++) {
      rowLower[k] = lo[k];
      rowUpper[k] = hi[k];
    }
    const residual: Built = { ...b, colUpper, rowLower, rowUpper };
    const r = runModel(highs, residual, {
      colCost: b.wastes,
      rowBounds: { row: b.sumRow, lower: N - nF, upper: N - nF },
      timeLimitSec: Math.max(0.05, Math.min(left(), budgetSec / 2)),
      objectiveTarget: target - objF,
    });
    dbg(
      `  phần dư free=${freeFrac}: còn ${N - nF} cây, thiếu ${lo.reduce((a, v) => a + v, 0)} đoạn -> ${r.status} ${r.seconds.toFixed(2)}s obj=${String(r.objective)} (target ${target - objF})`,
    );
    if (!r.y) continue;
    const y = yF.map((v, p) => v + r.y![p]);
    let obj = 0;
    for (let p = 0; p < P; p++) obj += y[p] * b.wastes[p];
    return { y, obj };
  }
  return null;
}

/**
 * Phần ngân sách tầng mà mỗi N ứng viên của byN được dùng (1 = trọn ngân sách). Đã thử 0,5 (dành nửa cho model
 * gốc nếu byN không chứng minh được) khi chưa cắt pattern: loại 7 cỡ/24.184 pattern byN tiêu hết 20 s mà không
 * chứng minh (0,38 %). Nhưng với cắt 5.000 pattern (mặc định) byN chứng minh tối ưu 0,1667 % ở giây 19/20, còn
 * chia đôi lại làm ca đó hụt (42 cây 0,188 % trên 3/50 request thật) -> giữ 1. Hết giờ ở byN vẫn tính là 1 lần
 * trượt (về model gốc nếu còn giờ).
 */
const BYN_BUDGET_FRACTION = 1;

function solveByN(
  highs: Highs,
  b: Built,
  inp: TwoStageInput,
  ks: SurplusKnapsack,
  stockS: number,
  cutCostS: number[],
): TwoStageResult {
  const n = inp.demands.length;
  let need = 0;
  let demandTotal = 0;
  for (let k = 0; k < n; k++) {
    need += inp.demands[k] * cutCostS[k];
    demandTotal += inp.demands[k];
  }
  let wMin = Infinity;
  let yCap = 0;
  for (let p = 0; p < b.numCols; p++) {
    wMin = Math.min(wMin, b.wastes[p]);
    yCap += b.colUpper[p];
  }
  // Ứng viên N với cận dưới chính xác: bound(N) = stock·N − need − S(N),
  // S(N) = sắt dư gom được nhiều nhất ≤ stock·N − need − w_min·N.
  const cands: Array<{ N: number; bound: number }> = [];
  // N nhỏ nhất NGOÀI danh sách mà vẫn có thể khả thi (0 = không có: danh sách phủ hết tới yCap).
  let tailN = 0;
  for (let N = Math.max(1, inp.minTotalBars); N <= yCap; N++) {
    const cap = stockS * N - need - wMin * N;
    if (cap < 0) continue;
    const bound = stockS * N - need - maxReachable(ks, cap);
    cands.push({ N, bound });
    // Khi sắt dư đã gom tối đa (S = V) thì bound chỉ còn tăng theo N → đủ rồi.
    if (cap >= ks.V && cands.length > 1 && bound > cands[cands.length - 2].bound) {
      if (N < yCap) tailN = N + 1;
      break;
    }
  }
  cands.sort((a, c) => a.bound - c.bound || a.N - c.N);
  // Cận dưới của N ≥ tailN: cap ≥ V nên S(N) = V, cận tăng đúng 1 cây mỗi N. Danh sách ứng viên KHÔNG
  // chứa các N này nên chưa chắc chứa N khả thi (proposal 2, loại 4: N=695..699 vô nghiệm, tối ưu 701).
  const tailBound = (N: number) => stockS * N - need - ks.V;

  const pushTrace = (dst: Incumbent[], r: StageRun, t0: number) => {
    const offset = (performance.now() - t0) / 1000 - r.seconds;
    for (const e of r.trace) dst.push({ t: e.t + offset, obj: e.obj });
  };

  // ---- Tầng 1 ----
  const t1 = performance.now();
  const deadline1 = t1 + inp.timeLimitSec * 1000;
  const steps1: ByNStep[] = [];
  const trace1: Incumbent[] = [];
  let best: { y: number[]; obj: number } | null = null;
  let proven1 = true; // mọi N đã xét đều chứng minh xong (tối ưu/vô nghiệm) và vòng dừng do cận
  let ranOut1 = false;
  let misses = 0;
  let fallback1 = false;
  let heavySkipped = false; // stage1Only: đã bỏ MIP đầy đủ ở bài lớn -> cũng bỏ luôn lần chạy model gốc
  // Mốc đuôi xếp chung theo cận: tới được nó (chưa có nghiệm nào ≤ cận đuôi) = còn N ngoài danh sách có
  // thể tốt hơn -> model gốc tự tìm. Có nghiệm ≤ cận đuôi thì vòng dừng do cận trước khi tới mốc.
  const queue1: Array<{ N: number; bound: number; tail?: true }> = [...cands];
  if (tailN > 0) {
    queue1.push({ N: tailN, bound: tailBound(tailN), tail: true });
    queue1.sort((a, c) => a.bound - c.bound || (a.tail ? 1 : 0) - (c.tail ? 1 : 0) || a.N - c.N);
  }
  for (const c of queue1) {
    if (best && c.bound >= best.obj) break; // mọi N còn lại (kể cả ngoài danh sách) không thể tốt hơn
    if (c.tail || misses >= MAX_BYN_MISSES) {
      fallback1 = true;
      break;
    }
    const remain = (deadline1 - performance.now()) / 1000;
    if (remain <= 0) {
      ranOut1 = true;
      proven1 = false;
      break;
    }
    // Điểm xuất phát bằng "làm tròn LP + giải phần dư" (roundingStart) cho bài LỚN (N ≥ ROUNDING_MIN_BARS): HiGHS
    // cần rất lâu mới ra nghiệm đầu tiên (I5 V15, N=1794: ~60 s) và trong pha gốc không gọi callback nên không ngắt
    // sớm được. Bài nhỏ hơn đi ĐÚNG đường cũ (MIP đầy đủ ngay): chạy roundingStart cho mọi N làm J55 V18 (N=134)
    // chậm từ 3,3 s lên 7 s, ca tham chiếu (c) (N=234) từ 4,5-11,7 s lên 13,7 s mà không được gì.
    // Vẫn giữ lối ngắt "chưa có nghiệm sau ROUNDING_PROBE_FRACTION ngân sách" cho bài nhỏ, phòng khi HiGHS có
    // gọi callback (ngoài pha gốc) - khi đó cũng chuyển sang roundingStart.
    const tN = performance.now();
    const fullBudget = () =>
      Math.max(
        0.05,
        Math.min((deadline1 - performance.now()) / 1000, inp.timeLimitSec * BYN_BUDGET_FRACTION),
      );
    const roundingBudget = () =>
      Math.min((deadline1 - performance.now()) / 1000, inp.timeLimitSec) * ROUNDING_FRACTION;
    let via: ByNStep['via'];
    let r: StageRun | null = null;
    let start: { y: number[]; obj: number } | null = null;
    const big = roundingEnabled() && c.N >= ROUNDING_MIN_BARS;
    if (big) {
      start = roundingStart(highs, b, inp, c.N, c.bound, roundingBudget());
      if (start && start.obj <= c.bound) {
        // Chạm cận = tối ưu đã chứng minh cho N này, khỏi chạy MIP đầy đủ.
        r = {
          status: 'optimal_by_bound',
          y: start.y,
          objective: start.obj,
          seconds: 0,
          trace: [],
          dualBound: null,
        };
        via = 'rounding';
      }
    }
    if (!r && big && inp.stage1Only) {
      // Bài không-bó của MC Tự động (solveBundled) chỉ là bước phụ lấy tập pattern: roundingStart hụt ở bài LỚN thì
      // MIP đầy đủ cũng không ra trong time_limit mà còn KHÔNG NGẮT ĐƯỢC pha gốc (đo I3 V15 T=5: bài không-bó
      // 37,8 s thay vì 10 s) -> bỏ cuộc ngay, để người gọi báo hết giờ đúng hạn.
      heavySkipped = true;
      r = {
        status: 'time_limit_no_solution',
        y: null,
        objective: null,
        seconds: 0,
        trace: [],
        dualBound: null,
      };
    }
    if (!r) {
      r = runModel(highs, b, {
        colCost: b.wastes,
        rowBounds: { row: b.sumRow, lower: c.N, upper: c.N },
        timeLimitSec: fullBudget(),
        objectiveTarget: c.bound,
        start: start?.y ?? null,
        ...(roundingEnabled() && !big
          ? { abortIfNoIncumbentAfterSec: inp.timeLimitSec * ROUNDING_PROBE_FRACTION }
          : {}),
      });
      pushTrace(trace1, r, t1);
      if (start) via = 'rounding-start';
      if (r.abortedNoIncumbent) {
        start = roundingStart(highs, b, inp, c.N, c.bound, roundingBudget());
        if (start && start.obj <= c.bound) {
          r = { ...r, status: 'optimal_by_bound', y: start.y, objective: start.obj };
          via = 'rounding';
        } else {
          const r2 = runModel(highs, b, {
            colCost: b.wastes,
            rowBounds: { row: b.sumRow, lower: c.N, upper: c.N },
            timeLimitSec: fullBudget(),
            objectiveTarget: c.bound,
            start: start?.y ?? null,
          });
          pushTrace(trace1, r2, t1);
          r = r2;
          if (start) via = 'rounding-start';
        }
      }
      // MIP hết giờ mà không giữ được nghiệm -> vẫn còn nghiệm làm tròn (khả thi, đúng N cây).
      if (!r.y && start)
        r = { ...r, status: 'feasible_time_limit', y: start.y, objective: start.obj };
    }
    steps1.push({
      N: c.N,
      bound: c.bound,
      status: r.status,
      objective: r.objective,
      seconds: (performance.now() - tN) / 1000,
      ...(via ? { via } : {}),
    });
    if (r.y && r.objective !== null && (!best || r.objective < best.obj))
      best = { y: r.y, obj: r.objective };
    // Chạm cận = tối ưu cho N này; vô nghiệm = đã chứng minh, chỉ loại N này. Cả hai xét tiếp N kế.
    if (r.status === 'optimal_by_bound' || r.status === 'infeasible') continue;
    // Không chạm cận (kể cả hết phần ngân sách của byN) = 1 lần trượt -> về model gốc với phần còn lại.
    if (!proven(r.status)) proven1 = false;
    misses++;
  }
  // Hết danh sách (không có đuôi) mà còn N chưa chứng minh xong -> model gốc nếu còn giờ. Mọi N đều vô
  // nghiệm (proven1 vẫn true) = vô nghiệm đã chứng minh: N < minTotalBars, N > yCap và N có cap < 0 đều
  // không thể có nghiệm, mọi N khác đã giải.
  if (!proven1 && !ranOut1) fallback1 = true;
  if (fallback1 && heavySkipped) {
    proven1 = false;
    ranOut1 = !best;
  } else if (fallback1 && deadline1 - performance.now() <= 0) {
    // Cần model gốc mà hết giờ: chưa kết luận được.
    proven1 = false;
    ranOut1 = !best;
  } else if (fallback1) {
    // Cận knapsack lỏng → để HiGHS tự chứng minh trên model gốc. KHÔNG nạp nghiệm byN làm điểm xuất phát:
    // đo ca 15 cỡ, có gợi ý 70–87 s, không gợi ý 26–30 s (HiGHS tự tìm cùng nghiệm ở giây 3 rồi chứng minh
    // nhanh hơn — gợi ý làm nó đi đường khác). Nghiệm byN vẫn được giữ nếu kết quả direct không tốt hơn.
    const remain = (deadline1 - performance.now()) / 1000;
    const r = runModel(highs, b, {
      colCost: b.wastes,
      start: inp.warmStart ? greedyStart(inp.patterns, inp.demands, inp.maxSurplus) : null,
      timeLimitSec: remain,
    });
    pushTrace(trace1, r, t1);
    steps1.push({
      N: 0,
      bound: r.dualBound ?? NaN,
      status: r.status,
      objective: r.objective,
      seconds: r.seconds,
    });
    if (r.y && r.objective !== null && (!best || r.objective <= best.obj))
      best = { y: r.y, obj: r.objective };
    // Model gốc vô nghiệm = vô nghiệm đã chứng minh (không phải "hết giờ").
    proven1 = r.status === 'optimal' || (!best && r.status === 'infeasible');
    ranOut1 = !best && r.status === 'time_limit_no_solution';
  }
  const sec1 = (performance.now() - t1) / 1000;
  if (!best) {
    const st: StageStatus = ranOut1 || !proven1 ? 'time_limit_no_solution' : 'infeasible';
    return {
      y: null,
      strategy: 'byN',
      stage1: { ...emptyStage(st), seconds: sec1, trace: trace1, byN: steps1 },
      stage2: { ...emptyStage('error'), fellBack: false },
    };
  }
  const minLeftover = best.obj;
  let bestN = 0;
  for (const v of best.y) bestN += v;
  const stage1: StageInfo = {
    status: proven1 ? (fallback1 ? 'optimal' : 'optimal_by_bound') : 'feasible_time_limit',
    seconds: sec1,
    objective: minLeftover,
    dualBound: cands.length ? cands[0].bound : null,
    trace: trace1,
    byN: steps1,
  };

  if (inp.stage1Only)
    return {
      y: best.y,
      strategy: 'byN',
      stage1,
      stage2: { ...emptyStage('error'), fellBack: false },
    };

  // ---- Tầng 2: min tổng đoạn dư, leftover ≤ minLeftover ----
  // Mọi N có bound(N) ≤ minLeftover đều có thể đạt cùng khúc thừa → phải xét hết (thường chỉ có N*).
  const t2 = performance.now();
  const deadline2 = t2 + inp.timeLimitSec * 1000;
  const steps2: ByNStep[] = [];
  const trace2: Incumbent[] = [];
  let best2: { y: number[]; obj: number } | null = null;
  let proven2 = true;
  let ranOut2 = false;
  let misses2 = 0;
  let fallback2 = false;
  const nList = cands.filter((c) => c.bound <= minLeftover).map((c) => c.N);
  // N ngoài danh sách tầng 1 cũng có thể đạt cùng khúc thừa (vd tầng 1 về model gốc ra N=701 ngoài danh sách).
  if (tailN > 0) for (let N = tailN; N <= yCap && tailBound(N) <= minLeftover; N++) nList.push(N);
  if (!nList.includes(bestN)) nList.unshift(bestN);
  // N* trước (có nghiệm gợi ý), rồi các N khác theo cận dưới knapsack của tầng 2 tăng dần.
  const withTarget = nList
    .map((N) => {
      const surplusS = stockS * N - need - minLeftover; // sắt dư phải gom ĐÚNG bằng này
      const cnt = surplusS < 0 || surplusS > ks.V ? UNREACH : ks.minCount[surplusS];
      return { N, target: cnt === UNREACH ? Infinity : demandTotal + cnt };
    })
    .filter((x) => Number.isFinite(x.target))
    .sort((a, c) => (a.N === bestN ? -1 : c.N === bestN ? 1 : a.target - c.target));
  for (const { N, target } of withTarget) {
    if (best2 && target >= best2.obj) continue;
    if (misses2 >= MAX_BYN_MISSES) {
      fallback2 = true;
      break;
    }
    const remain = (deadline2 - performance.now()) / 1000;
    if (remain <= 0) {
      ranOut2 = true;
      proven2 = false;
      break;
    }
    const r = runModel(highs, b, {
      colCost: b.pieces,
      extraRow: { values: b.wastes, upper: minLeftover },
      rowBounds: { row: b.sumRow, lower: N, upper: N },
      start: N === bestN ? best.y : null,
      timeLimitSec: remain,
      objectiveTarget: target,
    });
    pushTrace(trace2, r, t2);
    steps2.push({ N, bound: target, status: r.status, objective: r.objective, seconds: r.seconds });
    if (r.y && r.objective !== null && (!best2 || r.objective < best2.obj))
      best2 = { y: r.y, obj: r.objective };
    if (r.status === 'optimal_by_bound' || r.status === 'infeasible') continue;
    if (!proven(r.status)) {
      proven2 = false;
      if (r.status === 'time_limit_no_solution' || r.status === 'feasible_time_limit')
        ranOut2 = true;
    }
    misses2++;
  }
  if (!best2 && !ranOut2) fallback2 = true;
  if (fallback2 && !ranOut2) {
    const remain = (deadline2 - performance.now()) / 1000;
    const r = runModel(highs, b, {
      colCost: b.pieces,
      extraRow: { values: b.wastes, upper: minLeftover },
      start: best2?.y ?? best.y,
      timeLimitSec: remain,
    });
    pushTrace(trace2, r, t2);
    steps2.push({
      N: 0,
      bound: r.dualBound ?? NaN,
      status: r.status,
      objective: r.objective,
      seconds: r.seconds,
    });
    if (r.y && r.objective !== null && (!best2 || r.objective <= best2.obj))
      best2 = { y: r.y, obj: r.objective };
    proven2 = r.status === 'optimal';
    ranOut2 = !r.y && r.status === 'time_limit_no_solution';
  }
  const sec2 = (performance.now() - t2) / 1000;
  return {
    y: best2 ? best2.y : best.y,
    strategy: 'byN',
    stage1,
    stage2: {
      status: best2
        ? proven2
          ? fallback2
            ? 'optimal'
            : 'optimal_by_bound'
          : 'feasible_time_limit'
        : ranOut2
          ? 'time_limit_no_solution'
          : 'error',
      seconds: sec2,
      objective: best2 ? best2.obj : null,
      dualBound: null,
      trace: trace2,
      byN: steps2,
      fellBack: !best2,
    },
  };
}

// ---------------------------------------------------------------------------
// MC TỰ ĐỘNG: đường "thu hẹp" (nghiệm không-bó -> tập pattern -> bài bó thu hẹp -> bài bó đầy đủ).
// ---------------------------------------------------------------------------

/** Từ chừng này pattern trở lên mới thu hẹp; ít hơn thì bài đầy đủ vốn đã nhỏ -> giải thẳng như cũ. */
export const BUNDLE_NARROW_MIN_PATTERNS = 300;
/** Số pattern ít phế nhất thêm vào tập thu hẹp (ngoài các pattern nghiệm không-bó dùng). */
export const BUNDLE_NARROW_EXTRA = 200;
/**
 * Hệ số nhân time_limit cho bài không-bó lấy tập pattern (đường laser: byN + roundingStart; chỉ tầng 1). Ngân sách
 * nội bộ của roundingStart tỉ lệ theo time_limit (40 % cho cả bước, một nửa cho bài phần dư): đo I5 V15 (tề 0, lưỡi 2,5)
 * bài phần dư cần 3,4-3,9 s để chạm cận 0 - với 0,4×T=8 s nó chỉ có 1,6 s, với 0,6×T chỉ 2,4 s, với T đúng 4,0 s (sát
 * ngưỡng, dễ trượt khi máy bận) -> không ra nghiệm. Với 2×T nó có 8 s. Thời gian THẬT dùng vẫn ~4 s (nghiệm ra là dừng),
 * hệ số chỉ nới trần cho trường hợp xấu.
 */
const BUNDLE_RELAX_FACTOR = 2;
/** Phần time_limit cho bài bó thu hẹp tầng 2: tập chặt, tập rộng (còn lại dành cho bài đầy đủ). */
const BUNDLE_NARROW_S2_TIGHT = 0.4;
const BUNDLE_NARROW_S2_WIDE = 0.2;
/**
 * Trần tầng 1 (tính từ lúc bắt đầu, GỒM bài không-bó) khi CHƯA có nghiệm bó nào: 1,5×T; tầng 2 thêm T => một lần
 * giải theo bó ≤ ~2,5×T ở mọi nhánh. Đã có nghiệm thu hẹp thì bài đầy đủ tầng 1 chỉ được tới mốc T như trước.
 */
const BUNDLE_S1_HARD_FACTOR = 1.5;
/** Bậc thu hẹp tầng 1 được dùng chừng này phần giờ còn lại tới trần (bậc 1 / bậc 2); phần dư cho bậc sau và bài đầy đủ. */
const BUNDLE_RUNG1_SHARE = 0.8;
const BUNDLE_RUNG2_SHARE = 0.6;
/** Bậc thu hẹp tầng 2 đã chứng minh tối ưu TRONG tập thì bài đầy đủ chỉ còn chừng này phần time_limit. */
const BUNDLE_S2_FULL_AFTER_PROVEN = 0.3;
/** Dưới chừng này giây ngân sách còn lại thì không bắt đầu một lần giải mới. */
const MIN_RUN_SEC = 0.05;

/** Tập chỉ số pattern: các pattern đã dùng + `extra` pattern ít phế nhất + bảo đảm mọi cỡ có mặt. */
function pickNarrowSet(
  inp: TwoStageInput,
  order: number[],
  support: Iterable<number>,
  extra: number,
): number[] {
  const sel = new Set<number>(support);
  for (let i = 0; i < extra && i < order.length; i++) sel.add(order[i]);
  const n = inp.demands.length;
  for (let k = 0; k < n; k++) {
    if (inp.demands[k] <= 0) continue;
    let covered = false;
    for (const p of sel) {
      if (inp.patterns[p].counts[k] > 0) {
        covered = true;
        break;
      }
    }
    if (covered) continue;
    const first = order.find((p) => inp.patterns[p].counts[k] > 0);
    if (first !== undefined) sel.add(first);
  }
  return [...sel].sort((a, c) => a - c);
}

function solveBundledSorted(highs: Highs, full: Built, inp: TwoStageInput): TwoStageResult {
  const T = inp.timeLimitSec;
  const tStart = performance.now();
  const P = inp.patterns.length;
  const opt = inp.bundle!;
  const nf = full.numCols / Math.max(1, P); // số cột mỗi pattern = số hệ số bó + hệ số 1
  const columns = full.columns!;
  const secSince = (t: number) => (performance.now() - t) / 1000;

  // (1) Bài KHÔNG bó trên cùng pattern/nhu cầu bằng đường laser (byN + roundingStart): bài bó là bài hạn chế
  // của bài này (mọi nghiệm bó đều là nghiệm không-bó có cùng số cây mỗi pattern) nên (a) vô nghiệm không-bó
  // => vô nghiệm bó, (b) khúc thừa tối ưu không-bó là CẬN DƯỚI cho tầng 1 bó, (c) pattern nó dùng là ứng
  // viên tốt nhất cho bài bó. Đo I5 V15 (12 cỡ, 5.000 pattern, tề 0): không-bó 3,9 s; bài bó đầy đủ 60 s
  // vẫn chỉ 1805 cây, còn bài bó trên 17 pattern đó ra 1801 cây sau ~25 s.
  const order = Array.from({ length: P }, (_, p) => p); // pattern đã sắp khúc thừa tăng dần (xem solveBundled)
  const relaxed = solveTwoStage(highs, {
    ...inp,
    bundle: undefined,
    stage1Only: true,
    timeLimitSec: opt.testRelaxBudgetSec ?? T * BUNDLE_RELAX_FACTOR,
  });
  const relaxSeconds = secSince(tStart);
  /** Ghi chú chẩn đoán; nhánh nào cũng có relaxStatus/relaxSeconds (bài không-bó có thể là thứ ăn hết giờ). */
  const narrowInfo = (o: Partial<NarrowInfo> = {}): NarrowInfo => ({
    relaxSeconds,
    relaxPatterns: 0,
    relaxStatus: relaxed.stage1.status,
    narrowPatterns1: 0,
    narrowPatterns2: 0,
    narrowStatus1: null,
    narrowStatus2: null,
    fullStatus1: null,
    fullStatus2: null,
    stage1From: null,
    stage2From: null,
    ...o,
  });
  if (!relaxed.y) {
    if (relaxed.stage1.status === 'infeasible') {
      // Vô nghiệm đã chứng minh ở bài lỏng hơn -> bài bó cũng vô nghiệm (không phải hết giờ).
      return {
        y: null,
        columns,
        strategy: 'direct',
        stage1: { ...emptyStage('infeasible'), seconds: relaxSeconds },
        stage2: { ...emptyStage('error'), fellBack: false },
        narrow: narrowInfo(),
      };
    }
    // Bài không-bó hết giờ/lỗi: không có gì để thu hẹp. Nếu nó đã ăn hết time_limit thì dừng NGAY (chưa kết luận
    // được = hết giờ) - đo I5 V15 ở T=5 (trước 2026-10-23 sửa lần 2): bài không-bó vượt giờ tới 22,9 s rồi còn chạy
    // thẳng bài đầy đủ 2 tầng, tổng 24-27 s (I3 V15: 41 s), nhân retry ×3/×6 của optimizeOneMaterial thành hàng trăm giây.
    // Còn ≥ nửa time_limit thì rơi về bài đầy đủ với ĐÚNG phần còn lại (T − đã dùng) mỗi tầng, tổng ≤ 2T.
    const left = T - relaxSeconds;
    dbg(
      `bundled: bài không-bó ${relaxed.stage1.status} sau ${relaxSeconds.toFixed(1)}s, còn ${left.toFixed(1)}s`,
    );
    // Model bó đầy đủ có pha gốc không ngắt được (hàng chục giây ở 25.000 cột) nên chỉ rơi về nó khi còn ≥ nửa time_limit.
    if (left < T * 0.5) {
      return {
        y: null,
        columns,
        strategy: 'direct',
        stage1: { ...emptyStage('time_limit_no_solution'), seconds: relaxSeconds },
        stage2: { ...emptyStage('error'), fellBack: false },
        narrow: narrowInfo(),
      };
    }
    const d = solveDirect(highs, full, { ...inp, timeLimitSec: left });
    return {
      ...d,
      stage1: { ...d.stage1, seconds: d.stage1.seconds + relaxSeconds },
      narrow: narrowInfo(),
    };
  }
  const relaxedProven = proven(relaxed.stage1.status) && relaxed.stage1.objective !== null;
  /** cận dưới ĐÃ CHỨNG MINH của tầng 1 bó (khúc thừa tối ưu không-bó) - đặt làm objective_target. */
  const bound1 = relaxedProven ? relaxed.stage1.objective! : undefined;

  const patternsOfY = (y: number[]): Set<number> => {
    const s = new Set<number>();
    y.forEach((v, c) => {
      if (v > 0) s.add(Math.floor(c / nf));
    });
    return s;
  };
  const relaxSupport = new Set<number>();
  relaxed.y.forEach((v, p) => {
    if (v > 0) relaxSupport.add(p);
  });
  const extra = Math.max(0, opt.narrowExtraPatterns ?? BUNDLE_NARROW_EXTRA);

  /** Model bó chỉ trên các pattern `idx` (cột sắp theo pattern-chính, cùng thứ tự hệ số như `full`). */
  const narrowModel = (idx: number[]): Built =>
    build(highs, { ...inp, patterns: idx.map((i) => inp.patterns[i]) });
  const lift = (idx: number[], ySub: number[]): number[] => {
    const y = new Array<number>(full.numCols).fill(0);
    ySub.forEach((v, c) => {
      if (v) y[idx[Math.floor(c / nf)] * nf + (c % nf)] = v;
    });
    return y;
  };
  const drop = (idx: number[], yFull: number[]): number[] | null => {
    const pos = new Map<number, number>(idx.map((p, i) => [p, i]));
    const y = new Array<number>(idx.length * nf).fill(0);
    for (let c = 0; c < yFull.length; c++) {
      if (!yFull[c]) continue;
      const sp = pos.get(Math.floor(c / nf));
      if (sp === undefined) return null;
      y[sp * nf + (c % nf)] = yFull[c];
    }
    return y;
  };
  const pushTrace = (dst: Incumbent[], r: StageRun, t0: number) => {
    const offset = (performance.now() - t0) / 1000 - r.seconds;
    for (const e of r.trace) dst.push({ t: e.t + offset, obj: e.obj });
  };
  const fullCap = opt.testFullBudgetSec;

  // ---- Tầng 1: min khúc thừa ----
  // Hai mốc: trần cứng 1,5×T (chưa có nghiệm bó nào) và mốc mềm T (đã có nghiệm thu hẹp - bài đầy đủ chỉ để cải thiện).
  const hard1 = tStart + T * BUNDLE_S1_HARD_FACTOR * 1000;
  const soft1 = tStart + T * 1000;
  const remainHard1 = () => (hard1 - performance.now()) / 1000;
  const remain1 = () => ((best1 ? soft1 : hard1) - performance.now()) / 1000;
  const fullBudget1 = () => Math.min(remain1(), fullCap ?? Infinity);
  // Còn giờ thật (ngân sách tầng) mới chạy bài đầy đủ; `fullCap` chỉ rút ngắn lần chạy chứ không bỏ nó.
  const hasTime1 = () => remain1() > MIN_RUN_SEC;
  const trace1: Incumbent[] = [];
  let narrowStatus1: StageStatus | null = null;
  let fullStatus1: StageStatus | null = null;
  let best1: { y: number[]; obj: number; from: 'narrow' | 'full' } | null = null;
  let status1: StageStatus = 'time_limit_no_solution';
  let nPat1 = 0;
  let idx1: number[] = [];
  const reached = (obj: number) => bound1 !== undefined && obj <= bound1;
  // Bậc thu hẹp tầng 1: tập CHẶT (chỉ pattern nghiệm không-bó) trước; chỉ khi không ra nghiệm mới nới thêm `extra`
  // pattern ít phế nhất, rồi mới tới bài đầy đủ. Đo I5 V15: 17 pattern ra nghiệm ở giây 5,8; 217 pattern (cùng 17 +
  // 200) KHÔNG ra trong 8 s - nhiều cột hơn thì tìm nghiệm khả thi đầu tiên chậm hơn, nên nhỏ trước.
  const rungs = [0, extra];
  for (let ri = 0; ri < rungs.length && !best1; ri++) {
    const idx = pickNarrowSet(inp, order, relaxSupport, rungs[ri]);
    if (idx.length >= P * 0.8) break; // gần bằng bài đầy đủ -> khỏi thu hẹp
    if (ri > 0 && idx.length === nPat1) continue; // bậc này trùng bậc vừa thất bại
    const nb = narrowModel(idx);
    // Bậc 1 được dùng gần hết phần giờ còn lại tới trần (P* ra nghiệm ở ~6 s; hết giờ ở bậc 1 mà nhảy sang bậc 2
    // nhiều cột hơn chỉ chậm hơn - đo I5 V15 T=10: bậc 1 hết 4 s, bậc 2 hết 2,5 s, không ra gì).
    const lim = remainHard1() * (ri === 0 ? BUNDLE_RUNG1_SHARE : BUNDLE_RUNG2_SHARE);
    if (lim <= MIN_RUN_SEC) break;
    const r = runModel(highs, nb, {
      colCost: nb.wastes,
      timeLimitSec: lim,
      objectiveTarget: bound1,
    });
    pushTrace(trace1, r, tStart);
    narrowStatus1 = r.status;
    idx1 = idx;
    nPat1 = idx.length;
    dbg(
      `bundled S1 thu hẹp K=${rungs[ri]} (${idx.length} pattern): ${r.status} ${r.seconds.toFixed(2)}s obj=${String(r.objective)} bound=${String(bound1)}`,
    );
    if (r.y && r.objective !== null) {
      best1 = { y: lift(idx, r.y), obj: r.objective, from: 'narrow' };
      status1 = reached(r.objective) ? 'optimal_by_bound' : 'feasible_time_limit';
    }
  }
  if (!(best1 && reached(best1.obj)) && hasTime1()) {
    // Chưa chạm cận: bài ĐẦY ĐỦ với nghiệm thu hẹp làm điểm xuất phát (nếu có) trong phần giờ còn lại.
    const r = runModel(highs, full, {
      colCost: full.wastes,
      start: best1?.y ?? null,
      timeLimitSec: fullBudget1(),
      objectiveTarget: bound1,
    });
    pushTrace(trace1, r, tStart);
    fullStatus1 = r.status;
    dbg(
      `bundled S1 đầy đủ: ${r.status} ${r.seconds.toFixed(2)}s obj=${String(r.objective)} (start ${String(best1?.obj ?? null)})`,
    );
    if (r.y && r.objective !== null && (!best1 || r.objective <= best1.obj)) {
      best1 = { y: r.y, obj: r.objective, from: 'full' };
      status1 = proven(r.status) ? r.status : 'feasible_time_limit';
    } else if (!best1) {
      status1 = r.status;
    }
    // Nghiệm thu hẹp tốt hơn/bằng mà bài đầy đủ không chứng minh được: giữ thu hẹp, KHÔNG tuyên bố tối ưu.
  }
  const sec1 = secSince(tStart);
  const stage1Dual = bound1 ?? null;
  if (!best1) {
    // Không có nghiệm nào: nhãn theo bài đầy đủ (vô nghiệm đã chứng minh chỉ khi chính bài đầy đủ nói vậy).
    return {
      y: null,
      columns,
      strategy: 'direct',
      stage1: {
        ...emptyStage(status1 === 'infeasible' ? 'infeasible' : 'time_limit_no_solution'),
        seconds: sec1,
        dualBound: stage1Dual,
        trace: trace1,
      },
      stage2: { ...emptyStage('error'), fellBack: false },
      narrow: narrowInfo({
        relaxPatterns: relaxSupport.size,
        narrowPatterns1: nPat1,
        narrowStatus1,
        fullStatus1,
      }),
    };
  }
  const minLeftover = best1.obj;
  const stage1: StageInfo = {
    status: status1,
    seconds: sec1,
    objective: minLeftover,
    dualBound: stage1Dual,
    trace: trace1,
  };

  // ---- Tầng 2: khoá khúc thừa ≤ minLeftover, min tổng đoạn dư (+ tie-break ít bó) ----
  const t2 = performance.now();
  const deadline2 = t2 + T * 1000;
  const remain2 = () => (deadline2 - performance.now()) / 1000;
  // Bậc thu hẹp đã chứng minh tối ưu TRONG tập => bài đầy đủ chỉ thử cải thiện thêm một lúc ngắn (đo proposal 188 loại
  // '6': tập rộng optimal 0,37 s nhưng bài đầy đủ chạy thêm 19,6 s mà không đổi gì).
  let provenInSet2 = false;
  const fullBudget2 = () =>
    Math.min(
      remain2(),
      fullCap ?? Infinity,
      provenInSet2 ? T * BUNDLE_S2_FULL_AFTER_PROVEN : Infinity,
    );
  const hasTime2 = () => remain2() > MIN_RUN_SEC;
  const trace2: Incumbent[] = [];
  let best2: { y: number[]; obj: number; from: 'narrow' | 'full' } | null = null;
  let narrowStatus2: StageStatus | null = null;
  let fullStatus2: StageStatus | null = null;
  let status2: StageStatus = 'time_limit_no_solution';
  const costOf = (pieces: number[]) => pieces.map((v) => v * BUNDLE_TIEBREAK_WEIGHT + 1);
  // Tầng 2 cũng đi từ nhỏ tới lớn, mỗi bậc nhận nghiệm tốt nhất đang có làm điểm xuất phát: (1) tập CHẶT = pattern
  // nghiệm tầng 1 + pattern nghiệm không-bó dùng; (2) tập RỘNG = chặt + K pattern ít phế nhất; (3) bài đầy đủ.
  // HiGHS cải thiện nhanh ở bài nhỏ rồi đứng yên (I5 V15: 17 pattern -> 1801 cây; 217 pattern 30 s không nhích
  // khỏi nghiệm xuất phát), nên chia nhỏ ngân sách cho nhiều bậc có lợi hơn dồn hết vào một bài lớn.
  const support2 = new Set<number>([...idx1, ...patternsOfY(best1.y), ...relaxSupport]);
  const tight = pickNarrowSet(
    inp,
    order,
    new Set<number>([...patternsOfY(best1.y), ...relaxSupport]),
    0,
  );
  const wide = pickNarrowSet(inp, order, support2, extra);
  const steps2: Array<{ idx: number[]; share: number }> = [];
  if (tight.length < P * 0.8) steps2.push({ idx: tight, share: BUNDLE_NARROW_S2_TIGHT });
  if (wide.length > tight.length && wide.length < P * 0.8)
    steps2.push({ idx: wide, share: BUNDLE_NARROW_S2_WIDE });
  let nPat2 = 0;
  for (const st of steps2) {
    if (!hasTime2()) break;
    const nb = narrowModel(st.idx);
    const cur = best2?.y ?? best1.y;
    const start = drop(st.idx, cur);
    if (!start) continue; // nghiệm đang có nằm ngoài tập (không xảy ra: tập luôn chứa pattern nghiệm tầng 1)
    nPat2 = st.idx.length;
    const r = runModel(highs, nb, {
      colCost: costOf(nb.pieces),
      extraRow: { values: nb.wastes, upper: minLeftover },
      start,
      timeLimitSec: Math.max(MIN_RUN_SEC, Math.min(remain2(), T * st.share)),
    });
    pushTrace(trace2, r, t2);
    narrowStatus2 = r.status;
    if (r.status === 'optimal') provenInSet2 = true;
    dbg(
      `bundled S2 thu hẹp (${st.idx.length} pattern): ${r.status} ${r.seconds.toFixed(2)}s obj=${String(r.objective)} lastImp=${String(r.trace.at(-1)?.t.toFixed(1))}`,
    );
    if (r.y && r.objective !== null && (!best2 || r.objective <= best2.obj))
      best2 = { y: lift(st.idx, r.y), obj: r.objective, from: 'narrow' };
  }
  if (hasTime2()) {
    const r = runModel(highs, full, {
      colCost: costOf(full.pieces),
      extraRow: { values: full.wastes, upper: minLeftover },
      start: best2?.y ?? best1.y,
      timeLimitSec: fullBudget2(),
    });
    pushTrace(trace2, r, t2);
    fullStatus2 = r.status;
    dbg(
      `bundled S2 đầy đủ: ${r.status} ${r.seconds.toFixed(2)}s obj=${String(r.objective)} (start ${String(best2?.obj ?? null)})`,
    );
    if (r.y && r.objective !== null && (!best2 || r.objective <= best2.obj))
      best2 = { y: r.y, obj: r.objective, from: 'full' };
    if (!best2) status2 = r.status;
  }
  const sec2 = secSince(t2);
  if (best2) {
    // Chỉ nhận "đã chứng minh" khi chính bài ĐẦY ĐỦ đã chứng minh (bài thu hẹp tối ưu ≠ tối ưu toàn cục).
    status2 =
      best2.from === 'full' && fullStatus2 !== null && proven(fullStatus2)
        ? fullStatus2
        : 'feasible_time_limit';
  }
  return {
    y: best2 ? best2.y : best1.y,
    columns,
    strategy: 'direct',
    stage1,
    stage2: {
      status: status2,
      seconds: sec2,
      objective: best2 ? best2.obj : null,
      dualBound: null,
      trace: trace2,
      fellBack: !best2,
    },
    narrow: narrowInfo({
      relaxPatterns: relaxSupport.size,
      narrowPatterns1: nPat1,
      narrowPatterns2: nPat2,
      narrowStatus1,
      narrowStatus2,
      fullStatus1,
      fullStatus2,
      stage1From: best1.from,
      stage2From: best2 ? best2.from : 'stage1',
    }),
  };
}

/**
 * Đường thu hẹp cho MC Tự động. Sắp pattern theo khúc thừa tăng dần TRƯỚC khi dựng bất kỳ model nào: HiGHS rất nhạy
 * với thứ tự cột (I5 V15 tề 0, cùng 5.000 pattern: thứ tự liệt kê DFS -> bài không-bó KHÔNG ra nghiệm trong 20 s, thứ
 * tự khúc thừa tăng -> ra ở giây 3,6), và "K pattern ít phế nhất" cũng chính là K cột đầu. Cột trả về đã đổi lại
 * chỉ số pattern gốc nên người gọi không thấy khác biệt.
 */
function solveBundled(highs: Highs, inp: TwoStageInput): TwoStageResult {
  const perm = Array.from({ length: inp.patterns.length }, (_, p) => p).sort(
    (a, c) => inp.patterns[a].waste - inp.patterns[c].waste || a - c,
  );
  const sorted: TwoStageInput = { ...inp, patterns: perm.map((p) => inp.patterns[p]) };
  const r = solveBundledSorted(highs, build(highs, sorted), sorted);
  return r.columns
    ? { ...r, columns: r.columns.map((c) => ({ pattern: perm[c.pattern], factor: c.factor })) }
    : r;
}

export function solveTwoStage(highs: Highs, inp: TwoStageInput): TwoStageResult {
  if (
    inp.bundle &&
    !inp.allowShortage &&
    inp.patterns.length >= (inp.bundle.narrowMinPatterns ?? BUNDLE_NARROW_MIN_PATTERNS)
  )
    return solveBundled(highs, inp);
  const b = build(highs, inp);
  const want = inp.bundle ? 'direct' : (inp.strategy ?? 'byN');
  if (want === 'byN' && inp.stockS !== undefined && inp.cutCostS && b.sumRow >= 0) {
    const ks = surplusKnapsack(inp.cutCostS, inp.maxSurplus);
    if (ks) return solveByN(highs, b, inp, ks, inp.stockS, inp.cutCostS);
  }
  return solveDirect(highs, b, inp);
}
