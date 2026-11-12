import { getHighs, Highs } from './highs-solver';
import {
  FIXED_RETRY_FACTORS,
  MAX_SCAN_TIMEOUT_STREAK,
  OptimizeMaterialFn,
  optimizeOneMaterial,
} from './optimize-one-material';
import { MaterialResult, MaterialResultOk, SolveStats } from './types';

const stats: SolveStats = {
  strategy: 'direct',
  warm_start: false,
  patterns_before_cap: null,
  pattern_count: 1,
  enum_seconds: 0,
  stage1_status: 'optimal',
  stage1_seconds: 0,
  stage2_status: 'optimal',
  stage2_seconds: 0,
  stage2_fell_back: false,
  rss_peak_mb: 0,
  stage1_dual_bound: null,
  stage2_dual_bound: null,
  stage1_trace: [],
  stage2_trace: [],
};

/** Kết quả giả cho 1 chiều dài: bars/waste tuỳ ý, đủ trường để optimizeOneMaterial tổng hợp. */
function ok(stockLength: number, bars: number, wastePct: number): MaterialResultOk {
  return {
    feasible: true,
    machine: 'laser',
    cut_lengths: [500],
    demands: [10],
    produced: [10],
    bars_by_length: { [stockLength]: bars },
    total_bars: bars,
    total_purchased_mm: bars * stockLength,
    total_used_mm: 5000,
    total_waste_mm: (bars * stockLength * wastePct) / 100,
    total_surplus_pieces: 0,
    waste_pct: wastePct,
    plan: [{ stock_length: stockLength, counts: [10], bars, waste_per_bar: 1 }],
    patterns_truncated: false,
    limited_sizes_per_bar: null,
    stats,
  };
}
const timedOut: MaterialResult = { feasible: false, timed_out: true, reason: 'hết giờ' };
const infeasible: MaterialResult = { feasible: false, reason: 'vô nghiệm' };

describe('optimizeOneMaterial (các nhánh điều khiển, optimizeMaterial giả)', () => {
  const highs = {} as Highs;
  let calls: Array<{ L: number; timeLimit: number; ratio: number }>;
  const fake =
    (answer: (L: number, timeLimit: number, ratio: number) => MaterialResult): OptimizeMaterialFn =>
    (_h, _s, _d, stock, _t, _k, opts) => {
      const L = stock[0];
      calls.push({ L, timeLimit: opts?.timeLimit ?? 0, ratio: opts?.maxWasteRatio ?? 0 });
      return answer(L, opts?.timeLimit ?? 0, opts?.maxWasteRatio ?? 0);
    };
  beforeEach(() => {
    calls = [];
  });

  it('chấm các chiều dài chuẩn (sắp xếp, bỏ trùng) và chọn chiều dài ít hao hụt nhất', () => {
    const r = optimizeOneMaterial(highs, [500], [10], [6000, 5850, 6000], 10, 1, 1.0, {
      timeLimitSec: 8,
      optimizeMaterialImpl: fake((L) => (L === 5850 ? ok(5850, 3, 0.9) : ok(6000, 2, 1.5))),
    });
    expect(calls.map((c) => c.L)).toEqual([5850, 6000]);
    expect(calls[0].ratio).toBe(0.01);
    expect(r.feasible).toBe(true);
    if (!r.feasible) return;
    expect(r.best_length).toBe(5850);
    expect(r.source).toBe('fixed');
    expect(r.over_waste).toBe(false);
    expect(r.fixed_evals).toEqual([
      { length: 5850, bars: 3, waste_pct: 0.9 },
      { length: 6000, bars: 2, waste_pct: 1.5 },
    ]);
  });

  it('chiều dài chuẩn cắt được nhưng VƯỢT ngưỡng -> vẫn dùng, over_waste=true, không vét cạn', () => {
    const r = optimizeOneMaterial(highs, [500], [10], [6000], 10, 1, 1.0, {
      autoScan: true,
      optimizeMaterialImpl: fake(() => ok(6000, 2, 2.5)),
    });
    expect(r.feasible && r.over_waste).toBe(true);
    expect(calls.length).toBe(1); // không chạy vét cạn
  });

  it('hết giờ ở mọi chiều dài chuẩn -> giải lại ×3 rồi ×6, lần ×6 ra nghiệm', () => {
    const r = optimizeOneMaterial(highs, [500], [10], [6000], 10, 1, 1.0, {
      timeLimitSec: 8,
      optimizeMaterialImpl: fake((L, t) => (t >= 48 ? ok(6000, 2, 0.5) : timedOut)),
    });
    expect(calls.map((c) => c.timeLimit)).toEqual([8, 24, 48]);
    expect(FIXED_RETRY_FACTORS).toEqual([3, 6]);
    expect(r.feasible).toBe(true);
    if (!r.feasible) return;
    expect(r.timeout_count).toBe(0); // đã giải xong, không còn chiều dài hết giờ
  });

  it('hết giờ cả ×6, auto_scan tắt -> feasible=false, timed_out=true, timeout_lengths', () => {
    const r = optimizeOneMaterial(highs, [500], [10], [6000, 5850], 10, 1, 1.0, {
      timeLimitSec: 8,
      optimizeMaterialImpl: fake(() => timedOut),
    });
    expect(calls.length).toBe(6); // 2 chiều dài × (1 + 2 lần retry)
    expect(r).toMatchObject({ feasible: false, timed_out: true, timeout_lengths: [5850, 6000] });
  });

  it('vô nghiệm thật, auto_scan tắt -> best_achievable (nới ngưỡng 100 %) trong lý do', () => {
    const r = optimizeOneMaterial(highs, [500], [10], [6000], 10, 1, 1.0, {
      optimizeMaterialImpl: fake((L, _t, ratio) => (ratio >= 1 ? ok(6000, 4, 7.25) : infeasible)),
    });
    expect(r.feasible).toBe(false);
    if (r.feasible) return;
    expect(r.best_achievable).toEqual({ length: 6000, waste_pct: 7.25, bars: 4 });
    expect(r.reason).toContain('Tốt nhất có thể: 7.25% (6000mm × 4 cây)');
    // Có best_achievable thì KHÔNG kèm gợi ý bật dò chiều dài (đúng _no_solution() của Python).
    expect(r.reason).not.toContain('Giữ đúng chiều dài đã định');
  });

  it('vô nghiệm, không nới được, KHÔNG dò (đơn gấp: chỉ cây đã định) -> nêu đúng cây, KHÔNG khuyên dò chiều dài', () => {
    const r = optimizeOneMaterial(highs, [500], [10], [6000], 10, 1, 1.0, {
      optimizeMaterialImpl: fake(() => infeasible),
    });
    expect(r.feasible).toBe(false);
    if (r.feasible) return;
    expect(r.best_achievable).toBeUndefined();
    expect(r.reason).toContain('Cây 6000mm không cắt được loại này');
    expect(r.reason).toContain('ràng buộc tồn kho');
    // ô tick "Giữ đúng chiều dài đã định" đã bỏ (2026-10-24) - không được bảo KHSX đi tìm nó
    expect(r.reason).not.toMatch(/tick|dò chiều dài/);
  });

  it('vô nghiệm vì đoạn dài hơn cây -> nói thẳng đoạn nào, phần dùng được bao nhiêu', () => {
    const r = optimizeOneMaterial(highs, [5995], [2], [6000], 10, 1, 1.0, {
      optimizeMaterialImpl: fake(() => infeasible),
    });
    expect(r.feasible).toBe(false);
    if (r.feasible) return;
    expect(r.reason).toContain('có đoạn 5995mm dài hơn phần dùng được của cây (5990mm)');
  });

  it('vô nghiệm ở MC Tự động -> nêu ràng buộc bó + khuyên chọn MC Laser', () => {
    const r = optimizeOneMaterial(highs, [3500], [8], [6000], 0, 2.5, 1.0, {
      optimizeMaterialImpl: fake(() => infeasible),
      bundle: { factors: [14, 16, 18, 20], maxManualBars: 5 },
    });
    expect(r.feasible).toBe(false);
    if (r.feasible) return;
    expect(r.reason).toContain('MC Tự động phải cắt theo bó (14/16/18/20 cây/bó');
    expect(r.reason).toContain('cắt tay ≤ 5 cây');
    expect(r.reason).toContain('Chọn MC Laser cho đợt này');
  });

  it('vô nghiệm sau khi đã dò dải chiều dài -> "Không chiều dài nào cắt được"', () => {
    const r = optimizeOneMaterial(highs, [500], [10], [6000], 10, 1, 1.0, {
      autoScan: true,
      minLen: 5900,
      maxLen: 6000,
      step: 100,
      optimizeMaterialImpl: fake(() => infeasible),
    });
    expect(r.feasible).toBe(false);
    if (r.feasible) return;
    expect(r.reason).toContain('Không chiều dài nào cắt được loại này');
  });

  it('auto_scan: quét dải bội 50 từ max(min_len, đoạn dài nhất + tề) làm tròn lên, chọn %thấp nhất rồi ít cây nhất', () => {
    const r = optimizeOneMaterial(highs, [3000, 500], [10, 10], [6000], 10, 1, 1.0, {
      autoScan: true,
      minLen: 1000,
      maxLen: 4200,
      step: 100,
      optimizeMaterialImpl: fake((L) => {
        if (L === 6000) return infeasible; // chiều dài chuẩn không đạt -> mới vét cạn
        if (L === 3150) return ok(3150, 20, 0.8);
        if (L === 3650) return ok(3650, 15, 0.8); // cùng %, ít cây hơn -> thắng
        return L === 4150 ? ok(4150, 9, 0.9) : infeasible;
      }),
    });
    // bắt đầu từ làm tròn lên bội 50 của max(1000, 3000 + 10) = 3050, bước 100, tới 4150 (≤ 4200)
    expect(calls.map((c) => c.L)).toEqual([
      6000,
      ...Array.from({ length: 12 }, (_, i) => 3050 + 100 * i),
    ]);
    expect(r.feasible).toBe(true);
    if (!r.feasible) return;
    expect(r.source).toBe('scan');
    expect(r.best_length).toBe(3650);
    expect(r.total_bars).toBe(15);
    expect(r.scan_optimal).toEqual({ length: 3650, bars: 15, waste_pct: 0.8 });
    expect(r.scan_stopped_early).toBe(false);
    expect(r.fixed_evals).toEqual([]);
  });

  it('auto_scan + stop_on_first: dừng ở chiều dài đầu tiên ĐẠT ngưỡng', () => {
    const r = optimizeOneMaterial(highs, [500], [10], [6000], 10, 1, 1.0, {
      autoScan: true,
      stopOnFirst: true,
      minLen: 4000,
      maxLen: 4500,
      step: 50,
      optimizeMaterialImpl: fake((L) =>
        L === 6000 ? infeasible : L >= 4100 ? ok(L, 3, 0.5) : ok(L, 3, 1.4),
      ),
    });
    expect(r.feasible).toBe(true);
    if (!r.feasible) return;
    expect(r.best_length).toBe(4100); // 4000, 4050 vượt ngưỡng; 4100 đạt -> dừng
    expect(r.scan_stopped_early).toBe(true);
    expect(calls.map((c) => c.L)).toEqual([6000, 4000, 4050, 4100]);
  });

  it('auto_scan: hết giờ ở mọi điểm quét -> timed_out với danh sách chiều dài', () => {
    const r = optimizeOneMaterial(highs, [500], [10], [6000], 10, 1, 1.0, {
      autoScan: true,
      minLen: 4000,
      maxLen: 4100,
      step: 50,
      optimizeMaterialImpl: fake((L) => (L === 6000 ? infeasible : timedOut)),
    });
    expect(r).toMatchObject({
      feasible: false,
      timed_out: true,
      timeout_lengths: [4000, 4050, 4100],
    });
  });

  it('auto_scan: 3 chiều dài dò LIÊN TIẾP hết giờ -> dừng dò sớm, báo hết giờ rõ (không dò hết 101 chiều dài)', () => {
    const r = optimizeOneMaterial(highs, [500], [10], [6000], 10, 1, 1.0, {
      autoScan: true,
      timeLimitSec: 20,
      minLen: 5000,
      maxLen: 6000,
      step: 10,
      optimizeMaterialImpl: fake(() => timedOut),
    });
    // 6000 chuẩn: 20 s, ×3, ×6 (như Python) + đúng MAX_SCAN_TIMEOUT_STREAK chiều dài dò rồi dừng.
    // Bước cấu hình 10 bị nâng lên 50.
    expect(calls.map((c) => c.L)).toEqual([6000, 6000, 6000, 5000, 5050, 5100]);
    expect(MAX_SCAN_TIMEOUT_STREAK).toBe(3);
    expect(r).toMatchObject({
      feasible: false,
      timed_out: true,
      timeout_lengths: [6000, 5000, 5050, 5100],
    });
    if (r.feasible) return;
    expect(r.reason).toContain('đã dừng dò sớm');
  });

  it('auto_scan: chiều dài vô nghiệm xen giữa làm đếm hết giờ lại từ 0', () => {
    const r = optimizeOneMaterial(highs, [500], [10], [6000], 10, 1, 1.0, {
      autoScan: true,
      minLen: 5000,
      maxLen: 5500,
      step: 50,
      optimizeMaterialImpl: fake((L) => (L === 6000 || L === 5100 ? infeasible : timedOut)),
    });
    // 5000, 5050 hết giờ (2), 5100 vô nghiệm -> về 0; 5150..5250 hết giờ (3) -> dừng trước 5300.
    expect(calls.map((c) => c.L)).toEqual([6000, 5000, 5050, 5100, 5150, 5200, 5250]);
    expect(r).toMatchObject({ feasible: false, timed_out: true });
  });

  it('auto_scan: đã có phương án thì KHÔNG dừng sớm vì hết giờ - dò hết dải như Python', () => {
    const r = optimizeOneMaterial(highs, [500], [10], [6000], 10, 1, 1.0, {
      autoScan: true,
      minLen: 5000,
      maxLen: 5500,
      step: 50,
      optimizeMaterialImpl: fake((L) =>
        L === 6000 ? infeasible : L === 5050 ? ok(5050, 3, 0.5) : timedOut,
      ),
    });
    expect(calls).toHaveLength(1 + 11); // 6000 + 5000..5500
    expect(r).toMatchObject({
      feasible: true,
      best_length: 5050,
      source: 'scan',
      timeout_count: 10,
    });
  });
});

describe('dò chiều dài chỉ thử bội 50 mm (optimizeMaterial giả)', () => {
  const highs = {} as Highs;
  let calls: number[];
  const fakeAll =
    (answer: (L: number) => MaterialResult): OptimizeMaterialFn =>
    (_h, _s, _d, stock) => {
      calls.push(stock[0]);
      return answer(stock[0]);
    };
  const range = (from: number, to: number, step: number) =>
    Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + step * i);
  beforeEach(() => {
    calls = [];
  });

  it('sizes [5350], trim 10, step 10 -> thử 5400, 5450, ..., 6000 (không có 5360)', () => {
    optimizeOneMaterial(highs, [5350], [10], [6000], 10, 1, 1.0, {
      autoScan: true,
      minLen: 5000,
      maxLen: 6000,
      step: 10,
      optimizeMaterialImpl: fakeAll(() => infeasible),
    });
    // 6000 cuối: lần giải bestAchievable ở chiều dài chuẩn khi dò hết mà không đạt
    expect(calls).toEqual([6000, ...range(5400, 6000, 50), 6000]);
    expect(calls).not.toContain(5360);
  });

  it('step 60 được nâng lên bội 50 gần nhất phía trên (100) -> 5400, 5500, ..., 6000', () => {
    optimizeOneMaterial(highs, [5350], [10], [6000], 10, 1, 1.0, {
      autoScan: true,
      minLen: 5000,
      maxLen: 6000,
      step: 60,
      optimizeMaterialImpl: fakeAll(() => infeasible),
    });
    expect(calls).toEqual([6000, ...range(5400, 6000, 100), 6000]);
  });

  it('max 6020 -> chiều dài lớn nhất thử là 6000', () => {
    optimizeOneMaterial(highs, [5350], [10], [6000], 10, 1, 1.0, {
      autoScan: true,
      minLen: 5000,
      maxLen: 6020,
      step: 10,
      optimizeMaterialImpl: fakeAll(() => infeasible),
    });
    expect(Math.max(...calls.slice(1))).toBe(6000);
    expect(calls.slice(1).every((L) => L % 50 === 0)).toBe(true);
  });

  it('min 5010 với đoạn ngắn -> chiều dài đầu tiên là 5050', () => {
    optimizeOneMaterial(highs, [500], [10], [6000], 10, 1, 1.0, {
      autoScan: true,
      minLen: 5010,
      maxLen: 5200,
      step: 10,
      optimizeMaterialImpl: fakeAll(() => infeasible),
    });
    expect(calls[1]).toBe(5050);
    expect(calls.slice(1)).toEqual([5050, 5100, 5150, 5200, 6000]);
  });

  it('best_length và scan_optimal là L bội 50 đã thử; bars/waste lấy từ lần giải ở đúng L đó', () => {
    const r = optimizeOneMaterial(highs, [5350], [10], [6000], 10, 1, 1.0, {
      autoScan: true,
      minLen: 5000,
      maxLen: 6000,
      step: 10,
      optimizeMaterialImpl: fakeAll((L) => {
        if (L === 5400) return ok(5400, 12, 0.9);
        if (L === 5450) return ok(5450, 11, 0.4);
        return infeasible;
      }),
    });
    expect(r.feasible).toBe(true);
    if (!r.feasible) return;
    expect(r.best_length).toBe(5450);
    expect(r.best_length % 50).toBe(0);
    expect(r.total_bars).toBe(11);
    expect(r.waste_pct).toBe(0.4);
    expect(r.scan_optimal).toEqual({ length: 5450, bars: 11, waste_pct: 0.4 });
  });

  it('stopOnFirst dừng ở L bội 50 đầu tiên đạt ngưỡng', () => {
    const r = optimizeOneMaterial(highs, [5350], [10], [6000], 10, 1, 1.0, {
      autoScan: true,
      stopOnFirst: true,
      minLen: 5000,
      maxLen: 6000,
      step: 10,
      optimizeMaterialImpl: fakeAll((L) =>
        L === 6000 ? infeasible : ok(L, 3, L >= 5450 ? 0.5 : 1.4),
      ),
    });
    expect(r.feasible).toBe(true);
    if (!r.feasible) return;
    expect(r.best_length).toBe(5450);
    expect(r.scan_stopped_early).toBe(true);
    expect(calls).toEqual([6000, 5400, 5450]);
  });
});

describe('optimizeOneMaterial (HiGHS thật)', () => {
  let highs: Highs;
  beforeAll(async () => {
    highs = await getHighs();
  });

  it('ca h10-20 qua đủ pipeline: 6000 chuẩn đạt ngưỡng -> fixed, 325 cây', () => {
    const r = optimizeOneMaterial(highs, [497, 355], [1600, 3200], [6000], 10, 1, 1.0, {
      timeLimitSec: 30,
    });
    expect(r.feasible).toBe(true);
    if (!r.feasible) return;
    expect(r).toMatchObject({
      best_length: 6000,
      source: 'fixed',
      total_bars: 325,
      over_waste: false,
    });
    expect(r.waste_pct).toBeCloseTo(0.353026, 6);
  });

  // Dữ liệu thật MZ I5 MEYING (LSX 310), cây 6000, tề 10, lưỡi 1, ngưỡng 1 %, dư ≤ 10. Số tham chiếu là của
  // OR-Tools (worktree test-real-i5, test/solver-real-data/results/i5.json). Trước 2026-10-21 byN gắn nhãn
  // "hết giờ" cho chiều dài vô nghiệm thật -> timed_out=true, mất best_achievable, cấu hình A timeout_count>0.
  //
  // Cấu hình B: chỉ cây 6000, không dò, 120 s -> VÔ NGHIỆM (đã chứng minh sau < 1 s).
  it.each([
    ['FI10', [192, 90], [280, 280], 14, 1.9524],
    ['FI4', [60], [840], 9, 3.9815],
    ['FI6', [60], [2240], 23, 0.5435],
  ])(
    'I5 %s cấu hình B (chỉ 6000, 120 s): vô nghiệm thật -> timed_out=false, best_achievable như OR-Tools',
    (_m, sizes, demands, bars, pct) => {
      const r = optimizeOneMaterial(highs, sizes, demands, [6000], 10, 1, 1.0, {
        timeLimitSec: 120,
        maxSurplus: 10,
        autoScan: false,
      });
      expect(r.feasible).toBe(false);
      if (r.feasible) return;
      expect(r.timed_out).toBeFalsy();
      expect(r.timeout_lengths ?? []).toEqual([]);
      expect(r.best_achievable).toMatchObject({ length: 6000, bars });
      expect(r.best_achievable!.waste_pct).toBeCloseTo(pct, 3);
      expect(r.reason).not.toContain('Hết thời gian');
      if (pct <= 1) {
        // Tổng đã dưới ngưỡng -> không khuyên "nâng ngưỡng lên ≥ 0,54 %" vô nghĩa, chỉ đúng thứ chặn.
        expect(r.reason).toContain('mọi cây đều ≤ 1% hao hụt và dư ≤ 10 đoạn mỗi cỡ');
        expect(r.reason).not.toContain('Nâng ngưỡng lên');
      } else {
        expect(r.reason).toContain(`Nâng ngưỡng lên ≥ ${pct.toFixed(2)}%`);
      }
    },
  );

  it('I5 FI6: lời khuyên "nới số đoạn dư" là đúng - max_surplus 14 thì 6000 cắt được ở 1 %/cây', () => {
    // Kiểu duy nhất đạt 1 %/cây là 98 đoạn (98 × 61 = 5978 ≤ 5990); 23 cây cho 2254 đoạn = dư 14.
    const r = optimizeOneMaterial(highs, [60], [2240], [6000], 10, 1, 1.0, {
      timeLimitSec: 120,
      maxSurplus: 14,
    });
    expect(r.feasible).toBe(true);
    if (!r.feasible) return;
    expect(r).toMatchObject({ best_length: 6000, total_bars: 23, total_surplus_pieces: 14 });
  });

  // Cấu hình A = SystemConfig mặc định của ERP: dò 5000-6000 bước 10, dừng ở chiều dài đầu tiên đạt, 20 s.
  it.each([
    ['FI10', [192, 90], [280, 280], 5000, 16, 207, 3],
    ['FI4', [60], [840], 5150, 10, null, null],
    ['FI6', [60], [2240], 5100, 27, null, 1],
  ])(
    'I5 %s cấu hình A (dò 5000-6000 bước 10 nâng lên 50, 20 s): đúng phương án OR-Tools, timeout_count=0',
    (_m, sizes, demands, length, bars, wasteMm, surplus) => {
      const r = optimizeOneMaterial(highs, sizes, demands, [6000], 10, 1, 1.0, {
        timeLimitSec: 20,
        maxSurplus: 10,
        autoScan: true,
        stopOnFirst: true,
        minLen: 5000,
        maxLen: 6000,
        step: 10,
      });
      expect(r.feasible).toBe(true);
      if (!r.feasible) return;
      expect(r).toMatchObject({
        best_length: length,
        total_bars: bars,
        source: 'scan',
        timeout_count: 0,
      });
      expect(r.timeout_lengths).toEqual([]);
      if (wasteMm !== null) expect(r.total_waste_mm).toBe(wasteMm);
      if (surplus !== null) expect(r.total_surplus_pieces).toBe(surplus);
    },
  );
});
