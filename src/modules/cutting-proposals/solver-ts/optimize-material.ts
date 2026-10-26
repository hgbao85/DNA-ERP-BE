/**
 * Port `optimize_material()` của de_xuat_logic.py: với 1 nguyên liệu, sinh pattern cho từng
 * chiều dài cây rồi giải IP 2 tầng chọn số cây mỗi (chiều dài, pattern).
 */
import {
  ENUM_TIME_LIMIT,
  MAX_SIZES_PER_BAR,
  generatePatterns,
  scale,
  SCALING_FACTOR,
} from './patterns';
import { BundleOptions, Highs, IpPattern, solveTwoStage, Strategy } from './highs-solver';
import { BundleSummary, MachineKind, MaterialResult, PlanRow, SolveStats } from './types';

/** Số pattern tối đa đưa vào IP (mặc định) - xem ghi chú tại chỗ dùng. */
export const DEFAULT_MAX_IP_PATTERNS = 5_000;

export interface OptimizeMaterialOptions {
  maxWasteRatio?: number;
  timeLimit?: number;
  allowMix?: boolean;
  maxSurplus?: number;
  /** 'byN' (mặc định) hay 'direct' — xem highs-solver.ts; biến môi trường SOLVER_STRATEGY ghi đè */
  strategy?: Strategy;
  /** nạp nghiệm tham lam làm điểm xuất phát tầng 1 (SOLVER_TS_WARM_START=1 ghi đè mặc định) */
  warmStart?: boolean;
  /** chỉ đưa K pattern ít khúc thừa nhất vào IP (+ bảo đảm mọi cỡ có mặt), 0 = tất cả (SOLVER_TS_MAX_IP_PATTERNS) */
  maxIpPatterns?: number;
  /**
   * MC TỰ ĐỘNG (cắt theo bó) - xem TwoStageInput.bundle. Có mặt = machine 'tu_dong': pattern bị chặn
   * CỨNG ở `maxSizesPerBar` cỡ (mặc định 5, máy chỉ nhập được 5 kích thước; KHÔNG rơi về "không giới
   * hạn" như MC Laser), IP giải theo bó với chiến lược 'direct'.
   */
  bundle?: BundleOptions;
  /** số cỡ tối đa trên 1 pattern khi có `bundle` (mặc định 5) */
  maxSizesPerBar?: number;
  /** CHỈ ĐỂ TEST đối chiếu app cũ (cho thiếu trong maxSurplus) - xem TwoStageInput.allowShortage */
  allowShortage?: boolean;
}

/**
 * Thang ngưỡng hao hụt/cây (giảm dần) để tìm tập kiểu cắt ĐẦY ĐỦ khi liệt kê ở ngưỡng người dùng chạm trần 100.000
 * kiểu (xem chỗ dùng). Ngưỡng nào liệt kê hết thì mọi kiểu ≤ ngưỡng đó có mặt.
 */
export const ENUM_RATIO_LADDER = [0.5, 0.2, 0.1, 0.05, 0.03, 0.02, 0.015, 0.01, 0.005];

/** Số cỡ tối đa trên 1 kiểu cắt của máy MC Tự động (cat_sat/optimization_logic.py: lọc `<= 5`). */
export const MCTD_MAX_SIZES_PER_PATTERN = 5;

function rssMb(): number {
  return process.memoryUsage().rss / 1024 / 1024;
}

function fmtG(v: number): string {
  // Python f"{v:g}"
  return Number(v.toPrecision(6)).toString();
}

export function optimizeMaterial(
  highs: Highs,
  cutLengths: number[],
  demands: number[],
  stockLengths: number[],
  trim: number,
  kerf: number,
  opts: OptimizeMaterialOptions = {},
): MaterialResult {
  const maxWasteRatio = opts.maxWasteRatio ?? 0.2;
  const timeLimit = opts.timeLimit ?? 8.0;
  const allowMix = opts.allowMix ?? true;
  const maxSurplus = opts.maxSurplus ?? 10;
  const strategy: Strategy =
    opts.strategy ?? (process.env.SOLVER_STRATEGY === 'direct' ? 'direct' : 'byN');
  const n = cutLengths.length;
  const bundle = opts.bundle;
  const machine: MachineKind = bundle ? 'tu_dong' : 'laser';
  const mctdCap = bundle ? (opts.maxSizesPerBar ?? MCTD_MAX_SIZES_PER_PATTERN) : null;

  // Chế độ KHÔNG trộn: đánh giá từng chiều dài đơn, chọn cái tốt nhất
  if (!allowMix && stockLengths.length > 1) {
    let best: MaterialResult | null = null;
    let bestKey: [number, number] | null = null;
    for (const L of stockLengths) {
      const r = optimizeMaterial(highs, cutLengths, demands, [L], trim, kerf, {
        maxWasteRatio,
        timeLimit,
        allowMix: true,
        maxSurplus,
        strategy,
        bundle,
        maxSizesPerBar: opts.maxSizesPerBar,
        allowShortage: opts.allowShortage,
      });
      if (!r.feasible) continue;
      const key: [number, number] = [Math.round(r.waste_pct * 1e4) / 1e4, r.total_purchased_mm];
      if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
        best = r;
        bestKey = key;
      }
    }
    return best ?? { feasible: false, reason: 'Không có chiều dài đơn nào khả thi.' };
  }

  // 1) Kiểm tra khả thi cơ bản
  const longestBarUsable = Math.max(...stockLengths) - trim;
  if (Math.max(...cutLengths) > longestBarUsable) {
    return {
      feasible: false,
      reason: `Có đoạn ${fmtG(Math.max(...cutLengths))}mm dài hơn thanh dùng được ${fmtG(longestBarUsable)}mm.`,
    };
  }

  // 2) Sinh pattern (MC Laser: cap 4 cỡ/cây trước, rỗng thì sinh lại không giới hạn; MC Tự động: chặn
  //    CỨNG mctdCap cỡ - máy không nhập được hơn, nên không có bước "sinh lại không giới hạn")
  const enumBudget = Math.max(1.0, Math.min(timeLimit, ENUM_TIME_LIMIT));
  const tEnum = performance.now();
  let limitedSizesUsed = false;
  let patternsComplete = true;
  let enumRatioUsed: number | null = null;
  type AllPat = { S: number; S_s: number; counts: number[]; waste: number };
  let allPatterns: AllPat[] = [];
  const capPlan: Array<number | null> = mctdCap !== null ? [mctdCap] : [MAX_SIZES_PER_BAR, null];
  for (const cap of capPlan) {
    allPatterns = [];
    patternsComplete = true;
    for (const S of stockLengths) {
      const gen = (ratio: number) =>
        generatePatterns(cutLengths, demands, S, trim, kerf, {
          maxWasteRatio: ratio,
          timeLimitSec: enumBudget,
          maxSizesPerBar: cap,
        });
      const tGen = performance.now();
      const first = gen(maxWasteRatio);
      let rows = first.rows;
      const complete = first.complete;
      // Ngưỡng cao (vd chế độ "Chấp nhận hao hụt cao hơn" gửi 100 %) làm liệt kê chạm trần 100.000 kiểu theo thứ tự DFS -
      // tập đó thiên về kiểu nhiều đoạn đầu tiên, KHÔNG chứa kiểu ít phế nên IP có thể "vô nghiệm tồn kho" oan (proposal 191:
      // SAT-HOP-10X20 ở 6000 báo không cắt được trong khi ngưỡng 1 % cắt được 41 cây 0 %). Tăng ngưỡng không được làm mất
      // phương án => bổ sung tập ĐẦY ĐỦ ở ngưỡng thấp nhất còn liệt kê hết (thang ENUM_RATIO_LADDER), gộp với tập cắt cụt.
      // Chỉ chạy khi lần liệt kê đầu hụt MÀ không phải do hết giờ; ca ngưỡng thấp/đủ trần không đi qua đây.
      if (!complete && first.rows.length && (performance.now() - tGen) / 1000 < enumBudget * 0.5) {
        for (const r of ENUM_RATIO_LADDER) {
          if (r >= maxWasteRatio) continue;
          const low = gen(r);
          if (!low.complete) continue;
          const seen = new Set(low.rows.map((x) => x.counts.join(',')));
          rows = [...low.rows, ...first.rows.filter((x) => !seen.has(x.counts.join(',')))];
          enumRatioUsed = r;
          break;
        }
      }
      patternsComplete = patternsComplete && complete;
      const S_s = scale(S);
      for (const r of rows) allPatterns.push({ S, S_s, counts: r.counts, waste: r.waste });
    }
    if (allPatterns.length) {
      limitedSizesUsed = cap !== null;
      break;
    }
  }
  const enumSeconds = (performance.now() - tEnum) / 1000;
  let rssPeak = rssMb();

  if (!allPatterns.length) {
    if (!patternsComplete) {
      return {
        feasible: false,
        timed_out: true,
        patterns_truncated: true,
        reason:
          `Hết ${timeLimit.toFixed(0)}s mà chưa liệt kê xong các kiểu cắt ` +
          `(${cutLengths.length} cỡ đoạn là rất nặng) — CHƯA kết luận được. ` +
          `Hãy tăng thời gian chạy hoặc tách bớt cỡ đoạn.`,
      };
    }
    return {
      feasible: false,
      reason:
        `Không có cách cắt nào ≤ ${(maxWasteRatio * 100).toFixed(1)}% hao hụt/cây ` +
        `với các chiều dài đã cho` +
        (mctdCap !== null && n > mctdCap
          ? ` (MC Tự động: tối đa ${mctdCap} cỡ mỗi kiểu cắt)`
          : '') +
        `. Hãy tăng % hoặc bật Tự dò chiều dài.`,
    };
  }

  // 3) IP 2 tầng
  const kerfS = scale(kerf);
  let needS = 0;
  // Cận dưới số cây tính từ nhu cầu PHẢI cắt: cho thiếu (chỉ test) thì nhu cầu tối thiểu = demand − maxSurplus.
  for (let k = 0; k < n; k++)
    needS +=
      (opts.allowShortage ? Math.max(0, demands[k] - maxSurplus) : demands[k]) *
      (scale(cutLengths[k]) + kerfS);
  const maxUsableS = scale(Math.max(...stockLengths)) - scale(trim);
  const minTotalBars = maxUsableS > 0 ? Math.ceil(needS / maxUsableS) : 0;

  // Mặc định (đo 2026-10-20, changelog 7.7): BẬT nghiệm tham lam làm điểm xuất phát và CHỈ đưa
  // DEFAULT_MAX_IP_PATTERNS pattern ít phế nhất vào IP. Loại 7 cỡ/24.184 pattern, limit 20 s: không cắt
  // -> 1,4-1,6 GB RAM, HiGHS vượt giới hạn 3 lần (58-64 s), kết quả 0,20-0,38 %; cắt 10.000 -> 0,1786 %
  // chưa chứng minh; cắt 5.000 + tham lam -> 0,7 GB, 28 s, TỐI ƯU 0,1667 %. Loại 11 cỡ/41.842 pattern:
  // 10.000 -> 325 cây chưa chứng minh, 5.000 -> 324 cây tối ưu 22 s. 4 ca tham chiếu (3-12.343 pattern)
  // vẫn trùng OR-Tools với 5.000. Biến môi trường SOLVER_TS_WARM_START=0 / SOLVER_TS_MAX_IP_PATTERNS=0
  // tắt (ngữ nghĩa Python: đưa hết tới 100.000 pattern).
  const warmStart = opts.warmStart ?? process.env.SOLVER_TS_WARM_START !== '0';
  const maxIpPatterns =
    opts.maxIpPatterns ??
    parseInt(process.env.SOLVER_TS_MAX_IP_PATTERNS ?? String(DEFAULT_MAX_IP_PATTERNS), 10);
  // Giới hạn số pattern đưa vào IP (như tool Excel: 20.000 pattern ít phế nhất) - KHÔNG phải ngữ nghĩa
  // Python (đưa hết tới 100.000). Chỉ bật khi đo thấy cần; giữ pattern ít phế nhất + bảo đảm mỗi cỡ có
  // mặt trong ít nhất 1 pattern (ensure_coverage) để IP không vô nghiệm oan.
  let patternsBeforeCap: number | null = null;
  if (maxIpPatterns > 0 && allPatterns.length > maxIpPatterns) {
    const order = allPatterns
      .map((_, i) => i)
      .sort((a, c) => allPatterns[a].waste - allPatterns[c].waste || a - c);
    const keep = new Set<number>(order.slice(0, maxIpPatterns));
    for (let k = 0; k < n; k++) {
      if ([...keep].some((i) => allPatterns[i].counts[k] > 0)) continue;
      const first = order.find((i) => allPatterns[i].counts[k] > 0);
      if (first !== undefined) keep.add(first);
    }
    patternsBeforeCap = allPatterns.length;
    allPatterns = allPatterns.filter((_, i) => keep.has(i));
  }
  const ipPatterns: IpPattern[] = allPatterns.map((p) => ({ counts: p.counts, waste: p.waste }));
  const res = solveTwoStage(highs, {
    patterns: ipPatterns,
    demands,
    maxSurplus,
    minTotalBars,
    timeLimitSec: timeLimit,
    strategy,
    cutCostS: cutLengths.map((c) => scale(c) + kerfS),
    // 'byN' chỉ áp dụng khi mọi pattern cùng một chiều dài cây.
    stockS: stockLengths.length === 1 ? scale(stockLengths[0]) : undefined,
    warmStart,
    bundle,
    allowShortage: opts.allowShortage,
  });
  rssPeak = Math.max(rssPeak, rssMb());

  const stats: SolveStats = {
    strategy: res.strategy,
    warm_start: warmStart,
    patterns_before_cap: patternsBeforeCap,
    ...(enumRatioUsed !== null ? { enum_ratio_used: enumRatioUsed } : {}),
    pattern_count: allPatterns.length,
    enum_seconds: enumSeconds,
    stage1_status: res.stage1.status,
    stage1_seconds: res.stage1.seconds,
    stage2_status: res.stage2.status,
    stage2_seconds: res.stage2.seconds,
    stage2_fell_back: res.stage2.fellBack,
    rss_peak_mb: rssPeak,
    stage1_dual_bound: res.stage1.dualBound,
    stage2_dual_bound: res.stage2.dualBound,
    stage1_trace: res.stage1.trace,
    stage2_trace: res.stage2.trace,
    stage1_by_n: res.stage1.byN,
    stage2_by_n: res.stage2.byN,
    ...(res.narrow ? { bundle_narrow: res.narrow } : {}),
  };

  if (!res.y) {
    const timedOut = res.stage1.status === 'time_limit_no_solution';
    return {
      feasible: false,
      timed_out: timedOut,
      ...(!patternsComplete ? { patterns_truncated: true } : {}),
      reason: timedOut
        ? `Hết ${timeLimit.toFixed(0)}s mà chưa tìm ra nghiệm — CHƯA kết luận được chiều dài này tốt hay xấu. Hãy tăng thời gian chạy.`
        : `Không có phương án nào thoả ràng buộc tồn kho (tối đa ${maxSurplus} đoạn dư mỗi cỡ)` +
          // Có bó: vô nghiệm có thể do tồn kho (cắt từng cây cũng không ra - đo 2026-10-23: I3 H10-20/V10, J55 FI6 ở
          // 6000) HOẶC do bó (J55 FI4: cần ~6 cây, bó nhỏ nhất 14, cắt tay ≤ 5) - không giải lại để phân biệt (tốn giờ).
          (bundle
            ? ` hoặc ràng buộc bó của MC Tự động (hệ số ${bundle.factors.join('/')}, cắt tay ≤ ${bundle.maxManualBars} cây). Hãy nới chênh lệch cho phép hoặc số lần cắt tay, hoặc dò chiều dài khác.`
            : '.') +
          // Liệt kê kiểu cắt chưa đủ (chạm trần 100.000): "vô nghiệm" chỉ chắc chắn trên tập đã liệt kê.
          (!patternsComplete
            ? ' Lưu ý: chưa liệt kê hết các kiểu cắt ở ngưỡng hao hụt này nên kết luận có thể chưa chắc chắn.'
            : ''),
      stats,
    };
  }

  // 4) Tổng hợp kết quả. Có bó: cột = (pattern, hệ số) -> gom về số cây mỗi pattern + số bó từng hệ số.
  const barsPerPattern = new Array<number>(allPatterns.length).fill(0);
  const bundlesPerPattern: Array<Record<string, number>> | null = res.columns
    ? allPatterns.map(() => ({}))
    : null;
  if (res.columns) {
    res.columns.forEach(({ pattern, factor }, c) => {
      const cnt = res.y![c];
      if (cnt <= 0) return;
      barsPerPattern[pattern] += cnt * factor;
      const key = String(factor);
      bundlesPerPattern![pattern][key] = (bundlesPerPattern![pattern][key] ?? 0) + cnt;
    });
  } else {
    for (let p = 0; p < allPatterns.length; p++) barsPerPattern[p] = res.y[p];
  }
  const plan: PlanRow[] = [];
  const barsByLength = new Map<number, number>();
  const produced = new Array<number>(n).fill(0);
  let totalPurchasedS = 0;
  let totalLeftoverS = 0;
  for (let p = 0; p < allPatterns.length; p++) {
    const cnt = barsPerPattern[p];
    if (cnt <= 0) continue;
    const { S, S_s, counts, waste } = allPatterns[p];
    barsByLength.set(S, (barsByLength.get(S) ?? 0) + cnt);
    totalPurchasedS += S_s * cnt;
    totalLeftoverS += waste * cnt;
    for (let k = 0; k < n; k++) produced[k] += counts[k] * cnt;
    plan.push({
      stock_length: S,
      counts,
      bars: cnt,
      waste_per_bar: waste / SCALING_FACTOR,
      ...(bundlesPerPattern ? { bundles: bundlesPerPattern[p] } : {}),
    });
  }
  let bundleSummary: BundleSummary | undefined;
  if (bundle && bundlesPerPattern) {
    let totalBundles = 0;
    let manualBars = 0;
    for (const b of bundlesPerPattern)
      for (const [f, cnt] of Object.entries(b)) {
        if (f === '1') manualBars += cnt;
        else totalBundles += cnt;
      }
    bundleSummary = {
      factors: [...new Set(bundle.factors.map((f) => Math.trunc(f)).filter((f) => f > 1))].sort(
        (a, b) => b - a,
      ),
      total_bundles: totalBundles,
      manual_bars: manualBars,
      total_cuts: totalBundles + manualBars,
      max_sizes_per_pattern: mctdCap ?? MCTD_MAX_SIZES_PER_PATTERN,
    };
  }
  let totalUsedS = 0;
  for (let k = 0; k < n; k++) totalUsedS += demands[k] * scale(cutLengths[k]);
  let totalSurplus = 0;
  for (let k = 0; k < n; k++) totalSurplus += produced[k] - demands[k];
  plan.sort((a, b) => a.stock_length - b.stock_length || b.bars - a.bars);

  const bbl: Record<string, number> = {};
  for (const L of [...barsByLength.keys()].sort((a, b) => a - b))
    bbl[String(L)] = barsByLength.get(L)!;
  let totalBars = 0;
  for (const v of barsByLength.values()) totalBars += v;

  return {
    feasible: true,
    cut_lengths: cutLengths,
    demands,
    produced,
    bars_by_length: bbl,
    total_bars: totalBars,
    total_purchased_mm: totalPurchasedS / SCALING_FACTOR,
    total_used_mm: totalUsedS / SCALING_FACTOR,
    total_waste_mm: totalLeftoverS / SCALING_FACTOR,
    total_surplus_pieces: totalSurplus,
    waste_pct: totalPurchasedS ? (totalLeftoverS / totalPurchasedS) * 100 : 0,
    plan,
    patterns_truncated: !patternsComplete,
    limited_sizes_per_bar: limitedSizesUsed ? (mctdCap ?? MAX_SIZES_PER_BAR) : null,
    machine,
    ...(bundleSummary ? { bundle_summary: bundleSummary } : {}),
    stats,
  };
}
