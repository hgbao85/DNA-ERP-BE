/**
 * Port `optimize_one_material()`, `_best_achievable()`, `_no_solution()` của de_xuat_logic.py.
 * Cho 1 LOẠI sắt (nhiều cỡ đoạn): chấm từng chiều dài chuẩn → retry ×3/×6 nếu hết giờ →
 * (tuỳ chọn) vét cạn dải chiều dài → chọn phương án.
 */
import { BundleOptions, Highs } from './highs-solver';
import { optimizeMaterial } from './optimize-material';
import { LengthEval, MaterialResultOk, OneMaterialResult } from './types';

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
}

export type OptimizeMaterialFn = typeof optimizeMaterial;

interface Eval extends LengthEval {
  result: MaterialResultOk;
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
  const minLen = opts.minLen ?? 4000;
  const maxLen = opts.maxLen ?? 12000;
  const step = opts.step ?? 50;
  const timeLimitSec = opts.timeLimitSec ?? 8.0;
  const maxSurplus = opts.maxSurplus ?? 10;
  const autoScan = opts.autoScan ?? false;
  const stopOnFirst = opts.stopOnFirst ?? false;
  // Bọc một lần để tuỳ chọn máy (bó, cap cỡ) đi theo MỌI lần giải: chuẩn, retry ×3/×6, dò, bestAchievable.
  const baseOptimize: OptimizeMaterialFn = opts.optimizeMaterialImpl ?? optimizeMaterial;
  const machineOpts = {
    bundle: opts.bundle,
    maxSizesPerBar: opts.maxSizesPerBar,
    allowShortage: opts.allowShortage,
  };
  const optimize: OptimizeMaterialFn = (h, cl, dm, sl, t, k, o) =>
    baseOptimize(h, cl, dm, sl, t, k, { ...o, ...machineOpts });

  const threshold = maxWastePct;
  const strictRatio = Math.max(0, maxWastePct / 100);
  let timeouts: number[] = [];
  let scanStoppedEarly = false;

  // 1) Chấm từng chiều dài chuẩn
  const fixedEvals: Eval[] = [];
  for (const L of [...new Set(stockLengths)].sort((a, b) => a - b)) {
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
  fixedEvals.sort((a, b) => a.waste_pct - b.waste_pct);
  const bestFixed = fixedEvals[0] ?? null;

  // 2) Chọn
  let scanOpt: Eval | null = null;
  let chosen: Eval;
  let source: 'fixed' | 'scan';
  if (bestFixed) {
    chosen = bestFixed;
    source = 'fixed';
  } else if (!autoScan) {
    if (timeouts.length) {
      return {
        feasible: false,
        timed_out: true,
        timeout_lengths: timeouts,
        reason: `Hết thời gian ở cả ${timeouts.length} chiều dài đã thử — chưa kết luận được. Hãy tăng thời gian chạy.`,
      };
    }
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
    );
  } else {
    const start = Math.max(Math.trunc(minLen), Math.ceil(Math.max(...sizes) + trim));
    let timeoutStreak = 0;
    let scanAbandoned = false;
    for (let L = start; L <= Math.trunc(maxLen); L += Math.trunc(step)) {
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
        if (
          !scanOpt ||
          rr.waste_pct < scanOpt.waste_pct ||
          (rr.waste_pct === scanOpt.waste_pct && rr.total_bars < scanOpt.bars)
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
    ...(res.bundle_summary ? { bundle_summary: res.bundle_summary } : {}),
    stats: res.stats,
  };
}
