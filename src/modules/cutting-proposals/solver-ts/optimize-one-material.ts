/**
 * Port `optimize_one_material()`, `_best_achievable()`, `_no_solution()` của de_xuat_logic.py.
 * Cho 1 LOẠI sắt (nhiều cỡ đoạn): chấm từng chiều dài chuẩn → retry ×3/×6 nếu hết giờ →
 * (tuỳ chọn) dò dải chiều dài TỪ TÂM RA 2 PHÍA (13/11/2026; trước: tăng dần từ ngắn) → chọn phương
 * án.
 * Bọc ngoài là thang số cỡ/cây của luật xưởng (`maxSizesPerBarStart`): mỗi mức chạy trọn quy trình
 * trên.
 */
import { BundleOptions, Highs } from './highs-solver';
import { laserTailReason, MCTD_MAX_SIZES_PER_PATTERN, optimizeMaterial } from './optimize-material';
import { MAX_SIZES_PER_BAR } from './patterns';
import {
  roundDownToStockGrid,
  roundUpToStockGrid,
  STOCK_LENGTH_GRID_MM,
} from './stock-length-grid';
import { LengthEval, MaterialResultOk, OneMaterialOk, OneMaterialResult } from './types';

export const FIXED_RETRY_FACTORS = [3, 6];

/**
 * Dò chiều dài (auto_scan) dừng sớm khi gặp chừng này chiều dài LIÊN TIẾP hết giờ mà chưa chiều dài nào ra phương
 * án. KHÁC Python (dò hết dải dù mọi điểm hết giờ): ca loại sắt quá nặng cho time_limit, Python/bản TS cũ dò 101
 * chiều dài × 20 s rồi mới báo hết giờ (đo 2026-10-22, I5 V15 LSX 316 trước khi có roundingStart: > 25 phút).
 * Hết giờ ở 3 chiều dài liền nhau gần như chắc chắn là "bài quá nặng cho time_limit" chứ không phải chiều dài xấu,
 * nên báo sớm để người dùng tăng thời gian hoặc tách cỡ. Chiều dài vô nghiệm/khả thi xen giữa làm đếm lại từ 0.
 */
export const MAX_SCAN_TIMEOUT_STREAK = 3;

export interface OneMaterialOptions {
  minLen?: number;
  maxLen?: number;
  step?: number;
  timeLimitSec?: number;
  maxSurplus?: number;
  autoScan?: boolean;
  stopOnFirst?: boolean;
  /** CHỈ để test: thay bản optimizeMaterial thật bằng bản giả (giả lập hết giờ, vô nghiệm...). */
  optimizeMaterialImpl?: OptimizeMaterialFn;
  /** MC Tự động (cắt theo bó) - truyền thẳng xuống optimizeMaterial ở MỌI lần giải (chuẩn, retry, dò) */
  bundle?: BundleOptions;
  maxSizesPerBar?: number;
  /** CHỈ ĐỂ TEST đối chiếu app cũ - xem TwoStageInput.allowShortage */
  allowShortage?: boolean;
  /**
   * Tâm dò chiều dài (mm), làm tròn về lưới 50; thiếu = chiều dài đầu tiên của `stockLengths`. Dò
   * theo thứ tự
   * tâm, tâm−bước, tâm+bước, tâm−2·bước… Cũng phá hoà ở bước chiều dài cố định (bằng % thì lấy
   * chiều dài gần tâm hơn).
   */
  scanCenter?: number;
  /**
   * Luật xưởng "tối đa N cỡ đoạn/cây" - mức khởi đầu (≥ 1). Thang: N, N+1, … tới giới hạn máy
   * (laser MAX_SIZES_PER_BAR,
   * tu_dong `maxSizesPerBar`); mỗi mức < giới hạn là trần CỨNG, mức cuối = hành vi mặc định của
   * máy. Dừng ở mức đầu tiên
   * khả thi và không vượt ngưỡng. null/undefined/≥ giới hạn máy = không có luật (hành vi cũ, không
   * trả sizes_*).
   */
  maxSizesPerBarStart?: number | null;
  /** Trần cứng số cỡ/cây cho riêng lần chạy này (do thang số cỡ đặt, không đặt tay). */
  hardMaxSizesPerBar?: number | null;
  /**
   * NỘI BỘ (thang số cỡ, 13/11/2026 đợt 2): 'all' = cố định + dò (mặc định, hành vi cũ); 'fixed' =
   * CHỈ bước chiều dài cố định
   * (không dò dù autoScan bật); 'scan' = CHỈ phần dò (bỏ bước cố định - phần đó đã giải ở giai đoạn
   * 1 cùng trần).
   */
  phase?: 'all' | 'fixed' | 'scan';
  /**
   * NỘI BỘ: không chạy bestAchievable khi vô nghiệm (mức trung gian của thang chỉ cần biết "không
   * đạt").
   */
  cheapFail?: boolean;
  /** NỘI BỘ: chiều dài hết giờ ở giai đoạn 'fixed', chuyển sang giai đoạn 'scan' để báo đủ. */
  seedTimeouts?: number[];
  /**
   * Luật laze "nhát cắt cuối" (mm, 13/11/2026, Sếp câu 11): kiểu cắt hợp lệ khi đoạn dài nhất trên
   * cây + cùi > số này. Chỉ cho cắt
   * từng cây - bị bỏ qua khi có `bundle` (MC Tự động). Thiếu / ≤ 0 = không áp. Đi theo MỌI lần giải
   * (chuẩn, retry, dò, bestAchievable).
   */
  laserMinTailMm?: number;
}

export type OptimizeMaterialFn = typeof optimizeMaterial;

interface Eval extends LengthEval {
  result: MaterialResultOk;
}

/** Làm tròn tới bội lưới 50 gần nhất (hoà thì lên). */
function roundToStockGrid(mm: number): number {
  return Math.round(mm / STOCK_LENGTH_GRID_MM) * STOCK_LENGTH_GRID_MM;
}

/**
 * Thứ tự dò chiều dài từ tâm ra 2 phía: tâm, tâm−bước, tâm+bước, tâm−2·bước, tâm+2·bước… Chỉ lấy
 * giá trị trong
 * [start, max]; hết một phía thì đi tiếp phía còn lại (cùng khoảng cách: ngắn trước).
 */
export function scanOrderFromCenter(
  center: number,
  step: number,
  start: number,
  max: number,
): number[] {
  const out: number[] = [];
  if (step <= 0 || start > max) return out;
  for (let k = 0; ; k++) {
    const lo = center - k * step;
    const hi = center + k * step;
    if (lo < start && hi > max) break;
    if (lo >= start && lo <= max) out.push(lo);
    if (k > 0 && hi >= start && hi <= max) out.push(hi);
  }
  return out;
}

function bestAchievable(
  highs: Highs,
  sizes: number[],
  demands: number[],
  stockLengths: number[],
  trim: number,
  kerf: number,
  timeLimitSec: number,
  maxSurplus: number,
  optimize: OptimizeMaterialFn,
): LengthEval | null {
  let best: LengthEval | null = null;
  for (const L of [...new Set(stockLengths)].sort((a, b) => a - b)) {
    const r = optimize(highs, sizes, demands, [L], trim, kerf, {
      maxWasteRatio: 1.0,
      timeLimit: timeLimitSec,
      maxSurplus,
    });
    if (r.feasible && (!best || r.waste_pct < best.waste_pct)) {
      best = { length: L, waste_pct: r.waste_pct, bars: r.total_bars };
    }
  }
  return best;
}

function noSolution(
  highs: Highs,
  sizes: number[],
  demands: number[],
  stockLengths: number[],
  trim: number,
  kerf: number,
  timeLimitSec: number,
  maxSurplus: number,
  maxWastePct: number,
  scanned: boolean,
  optimize: OptimizeMaterialFn,
  bundle?: BundleOptions,
  /**
   * Luật laze nhát cắt cuối (mm, > 0 = đang áp) + bản giải KHÔNG áp luật để xác định luật có phải
   * thủ phạm không.
   */
  tail?: { minTailMm: number; optimizeNoRule: OptimizeMaterialFn },
): OneMaterialResult {
  const hint = bestAchievable(
    highs,
    sizes,
    demands,
    stockLengths,
    trim,
    kerf,
    timeLimitSec,
    maxSurplus,
    optimize,
  );
  // 13/11/2026 (Sếp câu 11): cùng ngưỡng hao hụt mà BỎ luật nhát cắt cuối thì ra kiểu cắt => luật
  // là nguyên nhân, nói rõ.
  if (tail) {
    const ruleIsCause = [...new Set(stockLengths)].some(
      (L) =>
        tail.optimizeNoRule(highs, sizes, demands, [L], trim, kerf, {
          maxWasteRatio: Math.max(0, maxWastePct / 100),
          timeLimit: timeLimitSec,
          maxSurplus,
        }).feasible,
    );
    if (ruleIsCause)
      return {
        feasible: false,
        ...(hint ? { best_achievable: hint } : {}),
        reason: laserTailReason(tail.minTailMm),
      };
  }
  if (hint && hint.waste_pct <= maxWastePct + 1e-9) {
    // Tổng hao hụt tốt nhất ĐÃ dưới ngưỡng mà vẫn vô nghiệm: ngưỡng là bộ lọc TỪNG CÂY, nên thứ chặn là
    // "mọi cây ≤ ngưỡng" cộng với trần đoạn dư max_surplus (vd I5 FI6 60 mm × 2240: kiểu duy nhất đạt 1 %/cây
    // là 98 đoạn, 23 cây dư 14 > 10). Khuyên "nâng ngưỡng lên ≥ 0,54 %" (bản cũ, giống DEXUAT) là vô nghĩa
    // vì ngưỡng đang là 1 %. Chỉ đổi chuỗi lý do - các trường JSON giữ nguyên như DEXUAT.
    return {
      feasible: false,
      best_achievable: hint,
      reason:
        `Không có cách cắt nào mà mọi cây đều ≤ ${maxWastePct}% hao hụt và dư ≤ ${maxSurplus} đoạn mỗi cỡ. ` +
        `Tốt nhất có thể: ${hint.waste_pct.toFixed(2)}% tính trên cả lô (${hint.length}mm × ${hint.bars} cây) - ` +
        `đã dưới ngưỡng nhưng cần vài cây thừa nhiều hơn ${maxWastePct}%. ` +
        `Nới số đoạn dư tối đa (đang ${maxSurplus}) hoặc ngưỡng hao hụt mỗi cây, hoặc đổi số lượng/kích thước đoạn cắt.`,
    };
  }
  if (hint) {
    return {
      feasible: false,
      best_achievable: hint,
      reason:
        `Không có cách cắt nào đạt ngưỡng ${maxWastePct}% hao hụt. ` +
        `Tốt nhất có thể: ${hint.waste_pct.toFixed(2)}% (${hint.length}mm × ${hint.bars} cây). ` +
        `Nâng ngưỡng lên ≥ ${hint.waste_pct.toFixed(2)}% nếu chấp nhận được, hoặc đổi kích thước đoạn cắt.`,
    };
  }
  // Nói ĐÚNG nguyên nhân (2026-10-24): đơn gấp chỉ cắt trên cây đã định (không còn ô tick "Giữ đúng chiều dài đã định" để bảo
  // KHSX bỏ), nên lời khuyên "dò chiều dài khác" là sai. Không giới hạn hao hụt (bestAchievable ở trên chạy 100 %) mà vẫn không ra
  // thì chỉ còn: đoạn dài hơn cây, MC Tự động không ghép được bó (bó ≥ hệ số nhỏ nhất, mọi cây trong bó cùng kiểu, cắt tay ≤ N cây,
  // không thiếu, dư ≤ maxSurplus - vd 8 đoạn 3500 mm cần 8 cây: 5 cây tay thiếu, 1 bó 14 cây ra ≥ 14 đoạn > 8 + 10), hoặc tồn kho.
  const lens = [...new Set(stockLengths)].sort((a, b) => a - b);
  const longest = Math.max(...sizes);
  const usable = Math.max(...lens) - trim;
  const head = scanned
    ? 'Không chiều dài nào cắt được loại này'
    : `Cây ${lens.join('/')}mm không cắt được loại này`;
  let cause: string;
  if (longest > usable) {
    cause = ` — có đoạn ${longest}mm dài hơn phần dùng được của cây (${usable}mm). Kiểm tra lại định mức.`;
  } else if (bundle) {
    cause =
      ` — MC Tự động phải cắt theo bó (${bundle.factors.join('/')} cây/bó, mọi cây trong bó cùng một kiểu cắt; cắt tay ≤ ` +
      `${bundle.maxManualBars} cây) mà không được cắt thiếu và dư ≤ ${maxSurplus} đoạn mỗi cỡ, nên số lượng loại này không ` +
      `ghép được thành bó. Chọn MC Laser cho đợt này hoặc gộp thêm SKU dùng chung loại sắt.`;
  } else {
    cause =
      ` — ràng buộc tồn kho quá chặt (không được cắt thiếu, dư ≤ ${maxSurplus} đoạn mỗi cỡ). ` +
      `Gộp thêm SKU dùng chung loại sắt hoặc đổi số lượng/kích thước đoạn cắt.`;
  }
  return { feasible: false, reason: head + cause };
}

/**
 * Một lần chạy trọn quy trình chọn chiều dài (cố định + dò) với trần số cỡ/cây
 * `opts.hardMaxSizesPerBar` (nếu có).
 */
function optimizeOneMaterialAtCap(
  highs: Highs,
  sizes: number[],
  demands: number[],
  stockLengths: number[],
  trim: number,
  kerf: number,
  maxWastePct: number,
  opts: OneMaterialOptions = {},
): OneMaterialResult {
  const minLen = opts.minLen ?? 4000;
  const maxLen = opts.maxLen ?? 12000;
  const step = opts.step ?? 50;
  const timeLimitSec = opts.timeLimitSec ?? 8.0;
  const maxSurplus = opts.maxSurplus ?? 10;
  const autoScan = opts.autoScan ?? false;
  const stopOnFirst = opts.stopOnFirst ?? false;
  // Bọc một lần để tuỳ chọn máy (bó, cap cỡ) đi theo MỌI lần giải: chuẩn, retry ×3/×6, dò, bestAchievable.
  const baseOptimize: OptimizeMaterialFn = opts.optimizeMaterialImpl ?? optimizeMaterial;
  const minTail =
    !opts.bundle && opts.laserMinTailMm !== undefined && opts.laserMinTailMm > 0
      ? opts.laserMinTailMm
      : 0;
  const baseMachineOpts = {
    bundle: opts.bundle,
    maxSizesPerBar: opts.maxSizesPerBar,
    allowShortage: opts.allowShortage,
    ...(opts.hardMaxSizesPerBar != null ? { hardMaxSizesPerBar: opts.hardMaxSizesPerBar } : {}),
  };
  const machineOpts = { ...baseMachineOpts, ...(minTail > 0 ? { laserMinTailMm: minTail } : {}) };
  const optimize: OptimizeMaterialFn = (h, cl, dm, sl, t, k, o) =>
    baseOptimize(h, cl, dm, sl, t, k, { ...o, ...machineOpts });
  const optimizeNoRule: OptimizeMaterialFn = (h, cl, dm, sl, t, k, o) =>
    baseOptimize(h, cl, dm, sl, t, k, { ...o, ...baseMachineOpts });
  const tailInfo = minTail > 0 ? { minTailMm: minTail, optimizeNoRule } : undefined;

  const threshold = maxWastePct;
  const center = roundToStockGrid(opts.scanCenter ?? stockLengths[0] ?? 6000);
  const distToCenter = (len: number) => Math.abs(len - center);
  const strictRatio = Math.max(0, maxWastePct / 100);
  const phase = opts.phase ?? 'all';
  const cheapFail: OneMaterialResult = {
    feasible: false,
    reason: 'Không đạt ở mức này (kết quả trung gian của thang số cỡ).',
  };
  let timeouts: number[] = [...(opts.seedTimeouts ?? [])];
  let scanStoppedEarly = false;

  // 1) Chấm từng chiều dài chuẩn (giai đoạn 'scan' bỏ qua: đã giải ở giai đoạn 'fixed' cùng trần)
  const fixedEvals: Eval[] = [];
  for (const L of phase === 'scan' ? [] : [...new Set(stockLengths)].sort((a, b) => a - b)) {
    const r = optimize(highs, sizes, demands, [L], trim, kerf, {
      maxWasteRatio: strictRatio,
      timeLimit: timeLimitSec,
      maxSurplus,
    });
    if (r.feasible)
      fixedEvals.push({ length: L, bars: r.total_bars, waste_pct: r.waste_pct, result: r });
    else if (r.timed_out) timeouts.push(L);
  }
  // 1b) Hết giờ ≠ vô nghiệm: giải lại với ×3, ×6
  if (!fixedEvals.length && timeouts.length) {
    for (const factor of FIXED_RETRY_FACTORS) {
      const still: number[] = [];
      for (const L of timeouts) {
        const r = optimize(highs, sizes, demands, [L], trim, kerf, {
          maxWasteRatio: strictRatio,
          timeLimit: timeLimitSec * factor,
          maxSurplus,
        });
        if (r.feasible)
          fixedEvals.push({ length: L, bars: r.total_bars, waste_pct: r.waste_pct, result: r });
        else if (r.timed_out) still.push(L);
      }
      timeouts = still;
      if (fixedEvals.length || !timeouts.length) break;
    }
  }
  // Bằng % (sai số 1e-9) thì lấy chiều dài GẦN TÂM nhất (cây chuẩn thắng chiều dài tồn kho khi bằng
  // nhau), rồi ngắn hơn.
  fixedEvals.sort((a, b) =>
    Math.abs(a.waste_pct - b.waste_pct) > 1e-9
      ? a.waste_pct - b.waste_pct
      : distToCenter(a.length) - distToCenter(b.length) || a.length - b.length,
  );
  const bestFixed = fixedEvals[0] ?? null;

  // 2) Chọn
  let scanOpt: Eval | null = null;
  let chosen: Eval;
  let source: 'fixed' | 'scan';
  if (bestFixed) {
    chosen = bestFixed;
    source = 'fixed';
  } else if (!autoScan || phase === 'fixed') {
    if (phase === 'fixed' && autoScan) {
      // Giai đoạn dò sẽ chạy sau: chỉ báo "cố định không đạt", mang theo chiều dài hết giờ.
      return { ...cheapFail, timeout_lengths: timeouts };
    }
    if (timeouts.length) {
      return {
        feasible: false,
        timed_out: true,
        timeout_lengths: timeouts,
        reason: `Hết thời gian ở cả ${timeouts.length} chiều dài đã thử — chưa kết luận được. Hãy tăng thời gian chạy.`,
      };
    }
    if (opts.cheapFail) return cheapFail;
    return noSolution(
      highs,
      sizes,
      demands,
      stockLengths,
      trim,
      kerf,
      timeLimitSec,
      maxSurplus,
      maxWastePct,
      false,
      optimize,
      opts.bundle,
      tailInfo,
    );
  } else {
    // Chỉ thử chiều dài bội 5 cm trong [min, max]; bước cấu hình làm tròn lên bội 5 cm (tối thiểu 5 cm).
    const start = roundUpToStockGrid(
      Math.max(Math.trunc(minLen), Math.ceil(Math.max(...sizes) + trim)),
    );
    const gridStep = Math.max(STOCK_LENGTH_GRID_MM, roundUpToStockGrid(Math.trunc(step)));
    const gridMax = roundDownToStockGrid(Math.trunc(maxLen));
    let timeoutStreak = 0;
    let scanAbandoned = false;
    // Bỏ qua chiều dài đã giải ở bước chiều dài cố định.
    const solvedFixed = new Set(stockLengths);
    const scanLengths = scanOrderFromCenter(center, gridStep, start, gridMax).filter(
      (x) => !solvedFixed.has(x),
    );
    for (const L of scanLengths) {
      if (!scanOpt && timeoutStreak >= MAX_SCAN_TIMEOUT_STREAK) {
        scanAbandoned = true;
        break;
      }
      const rr = optimize(highs, sizes, demands, [L], trim, kerf, {
        maxWasteRatio: strictRatio,
        timeLimit: timeLimitSec,
        maxSurplus,
      });
      timeoutStreak = !rr.feasible && rr.timed_out ? timeoutStreak + 1 : 0;
      if (rr.feasible) {
        // % thấp nhất; hoà thì ít cây hơn; hoà nữa thì gần tâm hơn.
        if (
          !scanOpt ||
          rr.waste_pct < scanOpt.waste_pct ||
          (rr.waste_pct === scanOpt.waste_pct &&
            (rr.total_bars < scanOpt.bars ||
              (rr.total_bars === scanOpt.bars && distToCenter(L) < distToCenter(scanOpt.length))))
        ) {
          scanOpt = { length: L, bars: rr.total_bars, waste_pct: rr.waste_pct, result: rr };
        }
        if (stopOnFirst && rr.waste_pct <= threshold + 1e-9) {
          scanStoppedEarly = true;
          break;
        }
      } else if (rr.timed_out) {
        timeouts.push(L);
      }
    }
    if (scanOpt) {
      chosen = scanOpt;
      source = 'scan';
    } else {
      if (scanAbandoned) {
        return {
          feasible: false,
          timed_out: true,
          timeout_lengths: timeouts,
          reason:
            `Hết thời gian ở ${MAX_SCAN_TIMEOUT_STREAK} chiều dài dò liên tiếp (và ở chiều dài chuẩn) — loại sắt này quá nặng ` +
            `so với ${timeLimitSec}s mỗi lần giải, đã dừng dò sớm. Chưa kết luận được: hãy tăng thời gian chạy hoặc tách bớt cỡ đoạn.`,
        };
      }
      if (timeouts.length) {
        return {
          feasible: false,
          timed_out: true,
          timeout_lengths: timeouts,
          reason: `Hết thời gian ở toàn bộ ${timeouts.length} chiều dài đã thử — chưa kết luận được. Hãy tăng thời gian chạy.`,
        };
      }
      if (opts.cheapFail) return cheapFail;
      return noSolution(
        highs,
        sizes,
        demands,
        stockLengths,
        trim,
        kerf,
        timeLimitSec,
        maxSurplus,
        maxWastePct,
        true,
        optimize,
        opts.bundle,
        tailInfo,
      );
    }
  }

  const res = chosen.result;
  return {
    feasible: true,
    cut_lengths: res.cut_lengths,
    demands: res.demands,
    produced: res.produced,
    best_length: chosen.length,
    source,
    total_bars: res.total_bars,
    waste_pct: res.waste_pct,
    plan: res.plan,
    total_waste_mm: res.total_waste_mm,
    total_purchased_mm: res.total_purchased_mm,
    total_surplus_pieces: res.total_surplus_pieces,
    over_waste: res.waste_pct > threshold + 1e-9,
    max_waste_pct: maxWastePct,
    timeout_count: timeouts.length,
    timeout_lengths: timeouts.slice(0, 20),
    auto_scan: autoScan,
    scan_stopped_early: scanStoppedEarly,
    patterns_truncated: res.patterns_truncated,
    fixed_evals: fixedEvals.map((e) => ({
      length: e.length,
      bars: e.bars,
      waste_pct: e.waste_pct,
    })),
    scan_optimal: scanOpt
      ? { length: scanOpt.length, bars: scanOpt.bars, waste_pct: scanOpt.waste_pct }
      : null,
    machine: res.machine,
    limited_sizes_per_bar: res.limited_sizes_per_bar,
    ...(res.bundle_summary ? { bundle_summary: res.bundle_summary } : {}),
    stats: res.stats,
  };
}

export function optimizeOneMaterial(
  highs: Highs,
  sizes: number[],
  demands: number[],
  stockLengths: number[],
  trim: number,
  kerf: number,
  maxWastePct: number,
  opts: OneMaterialOptions = {},
): OneMaterialResult {
  const startRaw = opts.maxSizesPerBarStart;
  const start =
    startRaw !== null && startRaw !== undefined && Number.isFinite(Number(startRaw))
      ? Math.trunc(Number(startRaw))
      : 0;
  // Giới hạn của máy: laser MAX_SIZES_PER_BAR (rồi mức cuối bỏ giới hạn), tu_dong số cỡ tối đa của
  // máy.
  const machineLimit = opts.bundle
    ? (opts.maxSizesPerBar ?? MCTD_MAX_SIZES_PER_PATTERN)
    : MAX_SIZES_PER_BAR;
  if (start < 1 || start >= machineLimit || opts.hardMaxSizesPerBar != null) {
    return optimizeOneMaterialAtCap(
      highs,
      sizes,
      demands,
      stockLengths,
      trim,
      kerf,
      maxWastePct,
      opts,
    );
  }

  // Thang mức start..machineLimit−1 là trần CỨNG; mức cuối (machineLimit) = hành vi mặc định của
  // máy.
  // 13/11/2026 (đợt 2): 2 GIAI ĐOẠN, ưu tiên giữ chiều dài cố định (cây chuẩn + chiều dài tồn) hơn
  // là ép ít cỡ:
  //  1) chỉ chiều dài cố định, theo thang N, N+1…, mức cuối; mức đầu đạt -> dừng;
  // 2) (chỉ khi autoScan) không mức nào đạt ở giai đoạn 1 -> dò chiều dài đặt riêng, lại theo thang
  //   từ mức start.
  // Giai đoạn 2 bỏ bước cố định (đã giải ở giai đoạn 1 cùng trần) và loại các chiều dài cố định
  // khỏi dải dò -> không giải lại.
  const levels: Array<number | null> = [];
  for (let cap = start; cap < machineLimit; cap++) {
    levels.push(cap);
    // Đã đủ chỗ cho mọi cỡ (cap ≥ số cỡ) mà vẫn không đạt: các mức kế tiếp y hệt, nhảy thẳng tới
    // mức cuối.
    if (cap >= sizes.length) break;
  }
  levels.push(null); // mức cuối = hành vi mặc định của máy (không đặt trần cứng)

  const run = (
    cap: number | null,
    phase: 'fixed' | 'scan',
    cheapFail: boolean,
    seedTimeouts?: number[],
  ) =>
    optimizeOneMaterialAtCap(highs, sizes, demands, stockLengths, trim, kerf, maxWastePct, {
      ...opts,
      hardMaxSizesPerBar: cap,
      phase,
      cheapFail,
      seedTimeouts,
    });
  const tag = (r: OneMaterialResult, limit: number | null): OneMaterialResult =>
    r.feasible ? { ...r, sizes_per_bar_start: start, sizes_per_bar_limit: limit } : r;
  const limitOf = (cap: number | null, r: OneMaterialOk) =>
    cap === null ? (r.limited_sizes_per_bar ?? null) : cap;

  // Kết quả khả thi nhưng vượt ngưỡng tốt nhất (hao hụt thấp nhất; mức cuối thắng khi hoà như code
  // cũ).
  let bestFeasible: { r: OneMaterialOk; limit: number | null } | null = null;
  const consider = (cap: number | null, r: OneMaterialOk) => {
    const better =
      !bestFeasible ||
      (cap === null
        ? r.waste_pct <= bestFeasible.r.waste_pct
        : r.waste_pct < bestFeasible.r.waste_pct);
    if (better) bestFeasible = { r, limit: limitOf(cap, r) };
  };
  let lastRes: OneMaterialResult | null = null;
  const fixedFeasibleAt = new Set<number | null>();
  const fixedTimeouts = new Map<number | null, number[]>();

  // Giai đoạn 1: chỉ chiều dài cố định.
  for (const cap of levels) {
    const r = run(cap, 'fixed', cap !== null || !!opts.autoScan);
    lastRes = r;
    if (r.feasible) {
      if (!r.over_waste) return tag(r, limitOf(cap, r));
      fixedFeasibleAt.add(cap); // cố định cắt được nhưng vượt ngưỡng: như cũ, không dò ở mức này
      consider(cap, r);
    } else if (r.timeout_lengths?.length) {
      fixedTimeouts.set(cap, r.timeout_lengths);
    }
  }

  // Giai đoạn 2: dò chiều dài đặt riêng (chỉ khi được dò).
  if (opts.autoScan) {
    for (const cap of levels) {
      if (fixedFeasibleAt.has(cap)) continue;
      const r = run(cap, 'scan', cap !== null, fixedTimeouts.get(cap));
      lastRes = r;
      if (r.feasible) {
        if (!r.over_waste) return tag(r, limitOf(cap, r));
        consider(cap, r);
      }
    }
  }

  // Không đạt ở đâu: khả thi-vượt ngưỡng tốt nhất, hoặc kết quả vô nghiệm của mức cuối.
  if (bestFeasible) {
    const b: { r: OneMaterialOk; limit: number | null } = bestFeasible;
    return tag(b.r, b.limit);
  }
  return lastRes as OneMaterialResult;
}
