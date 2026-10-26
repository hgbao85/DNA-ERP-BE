import { generatePatterns, scale } from './patterns';
import { getHighs, greedyStart, Highs, solveTwoStage, TwoStageInput } from './highs-solver';

/**
 * Kiểm chứng 2 chiến lược (`direct` = đúng 1 model như Python, `byN` = tách theo số cây với cận
 * knapsack) cho CÙNG giá trị tối ưu ở cả 2 tầng trên nhiều ca nhỏ ngẫu nhiên. Cách cắt có thể khác
 * (nhiều phương án cùng tối ưu) nên chỉ so tổng khúc thừa và tổng đoạn dư.
 */
describe('solveTwoStage', () => {
  let highs: Highs;
  beforeAll(async () => {
    highs = await getHighs();
  });

  const STOCK = 6000;
  const TRIM = 10;
  const KERF = 1;

  /** Sinh số giả ngẫu nhiên tái lập được (LCG). */
  const lcg = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  function buildInput(
    sizes: number[],
    demands: number[],
    strategy: 'direct' | 'byN',
  ): TwoStageInput {
    const { rows, complete } = generatePatterns(sizes, demands, STOCK, TRIM, KERF, {
      maxWasteRatio: 0.05,
      maxSizesPerBar: 4,
    });
    expect(complete).toBe(true);
    const kerfS = scale(KERF);
    const cutCostS = sizes.map((l) => scale(l) + kerfS);
    let need = 0;
    for (let k = 0; k < sizes.length; k++) need += demands[k] * cutCostS[k];
    return {
      patterns: rows.map((r) => ({ counts: r.counts, waste: r.waste })),
      demands,
      maxSurplus: 10,
      minTotalBars: Math.ceil(need / (scale(STOCK) - scale(TRIM))),
      timeLimitSec: 60,
      strategy,
      cutCostS,
      stockS: scale(STOCK),
    };
  }

  function evaluate(inp: TwoStageInput, y: number[]): { leftover: number; surplus: number } {
    let leftover = 0;
    const produced = new Array<number>(inp.demands.length).fill(0);
    y.forEach((cnt, p) => {
      leftover += cnt * inp.patterns[p].waste;
      inp.patterns[p].counts.forEach((c, k) => (produced[k] += c * cnt));
    });
    produced.forEach((v, k) => {
      expect(v).toBeGreaterThanOrEqual(inp.demands[k]);
      expect(v).toBeLessThanOrEqual(inp.demands[k] + inp.maxSurplus);
    });
    return { leftover, surplus: produced.reduce((a, v, k) => a + v - inp.demands[k], 0) };
  }

  it('byN và direct cho cùng tổng khúc thừa và tổng đoạn dư (12 ca ngẫu nhiên, 2-5 cỡ)', () => {
    const rnd = lcg(2026);
    for (let t = 0; t < 12; t++) {
      const n = 2 + Math.floor(rnd() * 4);
      const sizes = Array.from({ length: n }, () => 150 + Math.floor(rnd() * 1200));
      const demands = Array.from({ length: n }, () => 5 + Math.floor(rnd() * 120));
      const direct = solveTwoStage(highs, buildInput(sizes, demands, 'direct'));
      const byN = solveTwoStage(highs, buildInput(sizes, demands, 'byN'));
      expect(direct.strategy).toBe('direct');
      expect(byN.strategy).toBe('byN');
      expect(direct.y).not.toBeNull();
      expect(byN.y).not.toBeNull();
      expect(['optimal']).toContain(direct.stage1.status);
      expect(['optimal', 'optimal_by_bound']).toContain(byN.stage1.status);
      const a = evaluate(buildInput(sizes, demands, 'direct'), direct.y!);
      const b = evaluate(buildInput(sizes, demands, 'byN'), byN.y!);
      expect(b.leftover).toBe(a.leftover);
      expect(b.surplus).toBe(a.surplus);
      expect(byN.stage1.objective).toBe(a.leftover);
    }
  });

  it('byN quay về direct khi không truyền stockS (nhiều chiều dài cây)', () => {
    const inp = buildInput([497, 355], [160, 320], 'byN');
    const r = solveTwoStage(highs, { ...inp, stockS: undefined });
    expect(r.strategy).toBe('direct');
    expect(r.stage1.objective).toBe(solveTwoStage(highs, inp).stage1.objective);
  });

  it('vô nghiệm thật (max_surplus=0, nhu cầu lẻ không vừa cây) -> y=null, infeasible', () => {
    // 1 cỡ 2994: cây chứa 2 đoạn; nhu cầu 3 với dư ≤ 0 -> không có cách.
    const { rows } = generatePatterns([2994], [3], STOCK, TRIM, KERF, { maxWasteRatio: 0.01 });
    const r = solveTwoStage(highs, {
      patterns: rows.map((x) => ({ counts: x.counts, waste: x.waste })),
      demands: [3],
      maxSurplus: 0,
      minTotalBars: 2,
      timeLimitSec: 10,
      strategy: 'direct',
    });
    expect(r.y).toBeNull();
    expect(r.stage1.status).toBe('infeasible');
  });

  it('byN: N vô nghiệm KHÔNG tính là trượt, model gốc vô nghiệm -> infeasible (không phải hết giờ)', () => {
    // FI10 sheet I5 MEYING (dữ liệu thật), cây 6000, ngưỡng 1 %: mọi N đều vô nghiệm sau < 1 s. Trước
    // 2026-10-21 tầng 1 trả 'time_limit_no_solution' -> UI báo "hết giờ", mất best_achievable.
    const sizes = [192, 90];
    const demands = [280, 280];
    const { rows } = generatePatterns(sizes, demands, STOCK, TRIM, KERF, { maxWasteRatio: 0.01 });
    const cutCostS = sizes.map((l) => scale(l) + scale(KERF));
    const need = demands.reduce((a, d, k) => a + d * cutCostS[k], 0);
    const inp: TwoStageInput = {
      patterns: rows.map((x) => ({ counts: x.counts, waste: x.waste })),
      demands,
      maxSurplus: 10,
      minTotalBars: Math.ceil(need / (scale(STOCK) - scale(TRIM))),
      timeLimitSec: 20,
      strategy: 'byN',
      cutCostS,
      stockS: scale(STOCK),
    };
    const r = solveTwoStage(highs, inp);
    expect(r.strategy).toBe('byN');
    expect(r.y).toBeNull();
    expect(r.stage1.status).toBe('infeasible');
    const steps = r.stage1.byN!;
    // Hai N trong danh sách đều vô nghiệm và đều được giải (vô nghiệm không làm dừng vòng), rồi tới mốc
    // đuôi danh sách -> model gốc (N=0) cũng vô nghiệm.
    expect(steps.map((s) => [s.N, s.status])).toEqual([
      [14, 'infeasible'],
      [15, 'infeasible'],
      [0, 'infeasible'],
    ]);
    expect(solveTwoStage(highs, { ...inp, strategy: 'direct' }).stage1.status).toBe('infeasible');
  });

  it('byN: mọi N trong danh sách vô nghiệm, danh sách phủ hết N có thể -> infeasible, không cần model gốc', () => {
    const { rows } = generatePatterns([2994], [3], STOCK, TRIM, KERF, { maxWasteRatio: 0.01 });
    const r = solveTwoStage(highs, {
      patterns: rows.map((x) => ({ counts: x.counts, waste: x.waste })),
      demands: [3],
      maxSurplus: 0,
      minTotalBars: 2,
      timeLimitSec: 10,
      strategy: 'byN',
      cutCostS: [scale(2994) + scale(KERF)],
      stockS: scale(STOCK),
    });
    expect(r.strategy).toBe('byN');
    expect(r.y).toBeNull();
    expect(r.stage1.status).toBe('infeasible');
    expect(r.stage1.byN!.every((s) => s.N > 0 && s.status === 'infeasible')).toBe(true);
  });

  it('byN: N tối ưu NGOÀI danh sách ứng viên -> tới mốc đuôi thì về model gốc, ra đúng tối ưu', () => {
    // Dựng tay (đơn vị tuỳ ý, waste = cây − Σ đoạn): cây 10; cỡ X giá 5 chỉ có kiểu [1 X] (thừa 5), cỡ Y
    // giá 3 có kiểu [3 Y] (thừa 1, cận trên 1 cây). w_min = 1 làm cận knapsack tưởng 6-7 cây là đủ, nên
    // danh sách ứng viên dừng ở N=7 (cả 6, 7 đều vô nghiệm); thật ra cần 8 cây X + 1 cây Y = 9 cây.
    const inp: TwoStageInput = {
      patterns: [
        { counts: [1, 0], waste: 5 },
        { counts: [0, 3], waste: 1 },
      ],
      demands: [8, 3],
      maxSurplus: 1,
      minTotalBars: 5,
      timeLimitSec: 10,
      strategy: 'byN',
      cutCostS: [5, 3],
      stockS: 10,
    };
    const r = solveTwoStage(highs, inp);
    expect(r.strategy).toBe('byN');
    expect(r.stage1.byN!.map((s) => [s.N, s.status])).toEqual([
      [6, 'infeasible'],
      [7, 'infeasible'],
      [0, 'optimal'],
    ]);
    expect(r.stage1.status).toBe('optimal');
    expect(r.stage1.objective).toBe(41); // 8×5 + 1×1
    expect(r.y).toEqual([8, 1]);
    const d = solveTwoStage(highs, { ...inp, strategy: 'direct' });
    expect(d.stage1.objective).toBe(41);
    expect(d.y).toEqual([8, 1]);
  });
});

describe('greedyStart', () => {
  const STOCK = 6000;
  const lcg = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  it('luôn trả nghiệm KHẢ THI (đủ nhu cầu, dư ≤ max_surplus) trên 30 ca ngẫu nhiên 2-6 cỡ', () => {
    const rnd = lcg(7);
    let found = 0;
    for (let t = 0; t < 30; t++) {
      const n = 2 + Math.floor(rnd() * 5);
      const sizes = Array.from({ length: n }, () => 150 + Math.floor(rnd() * 1200));
      const demands = Array.from({ length: n }, () => 5 + Math.floor(rnd() * 200));
      const { rows } = generatePatterns(sizes, demands, STOCK, 10, 1, {
        maxWasteRatio: 0.05,
        maxSizesPerBar: 4,
      });
      const patterns = rows.map((r) => ({ counts: r.counts, waste: r.waste }));
      const y = greedyStart(patterns, demands, 10);
      if (!y) continue; // được phép kẹt (null) - chỉ là gợi ý
      found += 1;
      const produced = new Array<number>(n).fill(0);
      y.forEach((cnt, p) => patterns[p].counts.forEach((c, k) => (produced[k] += c * cnt)));
      produced.forEach((v, k) => {
        expect(v).toBeGreaterThanOrEqual(demands[k]);
        expect(v).toBeLessThanOrEqual(demands[k] + 10);
      });
    }
    expect(found).toBeGreaterThan(20);
  });

  it('ca h10-20: nghiệm tham lam khả thi, không tệ hơn 10 % so với tối ưu 325 cây', () => {
    const { rows } = generatePatterns([497, 355], [1600, 3200], STOCK, 10, 1, {
      maxWasteRatio: 0.01,
    });
    const y = greedyStart(
      rows.map((r) => ({ counts: r.counts, waste: r.waste })),
      [1600, 3200],
      10,
    );
    expect(y).not.toBeNull();
    const bars = y!.reduce((a, b) => a + b, 0);
    expect(bars).toBeGreaterThanOrEqual(325);
    expect(bars).toBeLessThanOrEqual(357);
  });

  describe('MC Tự động - cắt theo bó (bundle)', () => {
    let highs: Highs;
    beforeAll(async () => {
      highs = await getHighs();
    });
    const TRIM = 10;
    const KERF = 1;
    // 1 cỡ 1000 mm, ngưỡng 20 % -> chỉ còn kiểu cắt 5 đoạn/cây (5005/6000). Cần 100 đoạn = 20 cây.
    const bundleInput = (maxManualBars: number, maxSurplus = 10): TwoStageInput => {
      const { rows } = generatePatterns([1000], [100], STOCK, TRIM, KERF, { maxWasteRatio: 0.2 });
      expect(rows).toEqual([{ counts: [5], used: 50000, waste: 9950 }]);
      return {
        patterns: rows.map((r) => ({ counts: r.counts, waste: r.waste })),
        demands: [100],
        maxSurplus,
        minTotalBars: 0,
        timeLimitSec: 30,
        bundle: { factors: [14, 16], maxManualBars },
      };
    };

    it('20 cây = 1 bó 16 + 4 cây cắt tay (bó 14 + 6 tay vượt 5; 2 bó = 28 cây dư 40 đoạn > 10)', () => {
      const r = solveTwoStage(highs, bundleInput(5));
      expect(r.strategy).toBe('direct');
      expect(r.y).not.toBeNull();
      expect(r.columns).toEqual([
        { pattern: 0, factor: 16 },
        { pattern: 0, factor: 14 },
        { pattern: 0, factor: 1 },
      ]);
      expect(r.y).toEqual([1, 0, 4]);
      expect(r.stage1.objective).toBe(9950 * 20);
    });

    it('cắt tay ≤ 3 -> vô nghiệm đã chứng minh (không phải hết giờ)', () => {
      const r = solveTwoStage(highs, bundleInput(3));
      expect(r.y).toBeNull();
      expect(r.stage1.status).toBe('infeasible');
    });

    it('bundle rỗng (chỉ hệ số 1, cắt tay không giới hạn) ra đúng như không bó', () => {
      const base = bundleInput(1_000_000);
      const plain = solveTwoStage(highs, { ...base, bundle: undefined, strategy: 'direct' });
      const bundled = solveTwoStage(highs, {
        ...base,
        bundle: { factors: [], maxManualBars: 1e6 },
      });
      expect(plain.y).toEqual([20]);
      expect(bundled.y).toEqual([20]);
      expect(bundled.columns).toEqual([{ pattern: 0, factor: 1 }]);
    });

    it('allowShortage (chỉ test): nhu cầu 100 được thiếu ≤ 10 -> 18..22 cây; không cắt tay', () => {
      // Hệ số 14/16 không ghép ra 18..22 cây (14, 16, 28...) -> vô nghiệm đã chứng minh.
      const none = solveTwoStage(highs, { ...bundleInput(0, 10), allowShortage: true });
      expect(none.y).toBeNull();
      expect(none.stage1.status).toBe('infeasible');
      // Hệ số 18: đúng 1 bó = 18 cây = 90 đoạn (thiếu 10, trong phạm vi) -> khả thi, không cây tay.
      const base = bundleInput(0, 10);
      const ok18 = solveTwoStage(highs, {
        ...base,
        allowShortage: true,
        bundle: { factors: [18], maxManualBars: 0 },
      });
      expect(ok18.columns).toEqual([
        { pattern: 0, factor: 18 },
        { pattern: 0, factor: 1 },
      ]);
      expect(ok18.y).toEqual([1, 0]);
      // Không bật allowShortage thì 90 < 100 -> vô nghiệm.
      const strict = solveTwoStage(highs, { ...base, bundle: { factors: [18], maxManualBars: 0 } });
      expect(strict.y).toBeNull();
    });
  });
});

/**
 * MC Tự động - đường "thu hẹp" (solveBundled): giải bài không-bó lấy tập pattern, giải bó trên tập đó trước, bài bó
 * ĐẦY ĐỦ sau với nghiệm thu hẹp làm điểm xuất phát. Bất biến cần giữ: không bao giờ "không ra" khi bài thu hẹp đã
 * ra; nghiệm luôn hợp lệ; vô nghiệm đã chứng minh KHÔNG bị gắn nhãn hết giờ; không tuyên bố tối ưu khi chỉ tối ưu
 * trong tập thu hẹp.
 */
describe('solveTwoStage - MC Tự động đường thu hẹp', () => {
  let highs: Highs;
  beforeAll(async () => {
    highs = await getHighs();
  });
  const STOCK = 6000;
  const TRIM = 0;
  const KERF = 2.5;
  const FACTORS = [14, 16, 18, 20];
  // J55 V15 (dữ liệu thật 3 file định mức mới): 4 cỡ, đủ pattern để thu hẹp có nghĩa nhưng giải trong vài giây.
  const SIZES = [460, 440, 400, 230];
  const DEMANDS = [478, 239, 478, 478];

  function input(bundleExtra: Partial<NonNullable<TwoStageInput['bundle']>> = {}): TwoStageInput {
    const { rows } = generatePatterns(SIZES, DEMANDS, STOCK, TRIM, KERF, {
      maxWasteRatio: 0.01,
      maxSizesPerBar: 5,
    });
    const kerfS = scale(KERF);
    const cutCostS = SIZES.map((l) => scale(l) + kerfS);
    let need = 0;
    SIZES.forEach((_, k) => (need += DEMANDS[k] * cutCostS[k]));
    return {
      patterns: rows.map((r) => ({ counts: r.counts, waste: r.waste })),
      demands: DEMANDS,
      maxSurplus: 10,
      minTotalBars: Math.ceil(need / (scale(STOCK) - scale(TRIM))),
      timeLimitSec: 30,
      strategy: 'byN',
      cutCostS,
      stockS: scale(STOCK),
      bundle: { factors: FACTORS, maxManualBars: 5, narrowMinPatterns: 1, ...bundleExtra },
    };
  }

  /** Kiểm nghiệm theo bó hợp lệ: Σ hệ số × bó = số cây mỗi pattern, cắt tay ≤ giới hạn, đủ nhu cầu và dư ≤ maxSurplus. */
  function expectValid(inp: TwoStageInput, r: ReturnType<typeof solveTwoStage>): number {
    expect(r.y).not.toBeNull();
    expect(r.columns).toBeDefined();
    const produced = new Array<number>(inp.demands.length).fill(0);
    let manual = 0;
    let leftover = 0;
    r.y!.forEach((cnt, c) => {
      if (cnt <= 0) return;
      const { pattern, factor } = r.columns![c];
      expect([...FACTORS, 1]).toContain(factor);
      if (factor === 1) manual += cnt;
      const bars = cnt * factor;
      leftover += bars * inp.patterns[pattern].waste;
      inp.patterns[pattern].counts.forEach((k, i) => (produced[i] += k * bars));
    });
    expect(manual).toBeLessThanOrEqual(inp.bundle!.maxManualBars);
    produced.forEach((v, k) => {
      expect(v).toBeGreaterThanOrEqual(inp.demands[k]);
      expect(v).toBeLessThanOrEqual(inp.demands[k] + inp.maxSurplus);
    });
    return leftover;
  }

  it('cùng khúc thừa và tổng đoạn dư tối ưu như giải thẳng bài đầy đủ (ca nhỏ giải được hết)', () => {
    const direct = solveTwoStage(highs, input({ narrowMinPatterns: 1_000_000 }));
    const narrow = solveTwoStage(highs, input());
    expect(direct.narrow).toBeUndefined();
    expect(narrow.narrow).toBeDefined();
    expect(narrow.narrow!.relaxPatterns).toBeGreaterThan(0);
    expect(narrow.strategy).toBe('direct');
    expect(expectValid(input(), direct)).toBe(direct.stage1.objective);
    expect(expectValid(input(), narrow)).toBe(narrow.stage1.objective);
    expect(['optimal', 'optimal_by_bound']).toContain(direct.stage1.status);
    expect(['optimal', 'optimal_by_bound']).toContain(narrow.stage1.status);
    expect(narrow.stage1.objective).toBe(direct.stage1.objective);
    expect(narrow.stage2.status).toBe('optimal');
    expect(narrow.stage2.objective).toBe(direct.stage2.objective);
  });

  it('bài ĐẦY ĐỦ hết giờ (ngân sách ép còn 0,01 s) -> vẫn giữ nghiệm thu hẹp, hợp lệ, không bị "không ra"', () => {
    // Tập chặt (chỉ pattern nghiệm không-bó) vô nghiệm bó, nới thêm 5 pattern thì ra nghiệm (khúc thừa 350 > tối ưu
    // 125): nghiệm đó phải được giữ dù bài đầy đủ không kịp làm gì, và KHÔNG được gắn nhãn tối ưu.
    const inp = input({ testFullBudgetSec: 0.01, narrowExtraPatterns: 5 });
    const r = solveTwoStage(highs, inp);
    expect(r.stage1.status).not.toBe('time_limit_no_solution');
    expect(r.stage1.status).not.toBe('infeasible');
    expect(r.narrow!.narrowStatus1).not.toBeNull();
    expectValid(inp, r);
    const ref = solveTwoStage(highs, input({ narrowMinPatterns: 1_000_000 }));
    expect(r.stage1.objective!).toBeGreaterThanOrEqual(ref.stage1.objective!);
    if (r.stage1.objective! > ref.stage1.objective!)
      expect(r.stage1.status).toBe('feasible_time_limit');
    // Tầng 2 cũng phải trả nghiệm hợp lệ (không bao giờ thua nghiệm tầng 1) dù bài đầy đủ bị ép hết giờ.
    expect(r.stage2.fellBack).toBe(false);
    expect(r.stage2.objective).not.toBeNull();
  });

  it('vô nghiệm TRONG tập thu hẹp ≠ vô nghiệm thật: bài đầy đủ hết giờ thì nhãn là hết giờ, không phải infeasible', () => {
    const r = solveTwoStage(highs, input({ testFullBudgetSec: 0.01, narrowExtraPatterns: 0 }));
    expect(r.y).toBeNull();
    expect(r.narrow!.narrowStatus1).toBe('infeasible');
    expect(r.stage1.status).toBe('time_limit_no_solution');
  });

  it('nghiệm thu hẹp chạm cận không-bó = tối ưu tầng 1 đã chứng minh, khỏi chạy bài đầy đủ tầng 1', () => {
    // Nới 20 pattern thì bó đạt đúng khúc thừa tối ưu của bài không-bó (125) - cận dưới hợp lệ vì bài bó là bài hạn chế.
    const inp = input({ narrowExtraPatterns: 20 });
    const r = solveTwoStage(highs, inp);
    expectValid(inp, r);
    const ref = solveTwoStage(highs, input({ narrowMinPatterns: 1_000_000 }));
    expect(r.stage1.objective).toBe(ref.stage1.objective);
    expect(r.stage1.status).toBe('optimal_by_bound');
    expect(r.narrow!.stage1From).toBe('narrow');
    expect(r.narrow!.fullStatus1).toBeNull();
    expect(r.stage1.dualBound).toBe(r.stage1.objective);
  });

  it('bài không-bó vô nghiệm đã chứng minh -> bó vô nghiệm ngay (infeasible, không phải hết giờ), chưa chạy bài bó', () => {
    // 1 cỡ 2994: cây chứa 2 đoạn; nhu cầu 3 với dư ≤ 0 -> không có cách (như test direct ở trên).
    const { rows } = generatePatterns([2994], [3], STOCK, 10, 1, { maxWasteRatio: 0.01 });
    const r = solveTwoStage(highs, {
      patterns: rows.map((x) => ({ counts: x.counts, waste: x.waste })),
      demands: [3],
      maxSurplus: 0,
      minTotalBars: 2,
      timeLimitSec: 10,
      strategy: 'byN',
      cutCostS: [scale(2994) + scale(1)],
      stockS: scale(STOCK),
      bundle: { factors: FACTORS, maxManualBars: 5, narrowMinPatterns: 1 },
    });
    expect(r.y).toBeNull();
    expect(r.stage1.status).toBe('infeasible');
    expect(r.narrow!.relaxStatus).toBe('infeasible');
    expect(r.narrow!.narrowStatus1).toBeNull();
    expect(r.narrow!.fullStatus1).toBeNull();
  });

  it('không-bó ra nhưng bó vô nghiệm (cắt tay 0, cần 20 cây lẻ) -> infeasible đã chứng minh qua đường thu hẹp', () => {
    // 1 cỡ 1000 ×100, ngưỡng 20 % -> chỉ kiểu 5 đoạn/cây = 20 cây; hệ số 14/16 và 0 cắt tay: không ghép được.
    const { rows } = generatePatterns([1000], [100], STOCK, 10, 1, { maxWasteRatio: 0.2 });
    const r = solveTwoStage(highs, {
      patterns: rows.map((x) => ({ counts: x.counts, waste: x.waste })),
      demands: [100],
      maxSurplus: 10,
      minTotalBars: 0,
      timeLimitSec: 20,
      cutCostS: [scale(1000) + scale(1)],
      stockS: scale(STOCK),
      bundle: { factors: [14, 16], maxManualBars: 0, narrowMinPatterns: 1 },
    });
    expect(r.y).toBeNull();
    expect(r.stage1.status).toBe('infeasible');
  });

  it('bài không-bó hết giờ ngay và đã ăn hết time_limit -> time_limit_no_solution NGAY, không chạy bài bó đầy đủ', () => {
    // time_limit 0: bài không-bó trả hết giờ tức thì (relaxSeconds ≥ T) -> không rơi về model bó đầy đủ (pha gốc
    // không ngắt được, từng làm một lần giải ở T=5 tốn 24-41 s).
    const t0 = Date.now();
    const r = solveTwoStage(highs, { ...input(), timeLimitSec: 0 });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r.y).toBeNull();
    expect(r.stage1.status).toBe('time_limit_no_solution');
    expect(r.narrow!.relaxStatus).toBe('time_limit_no_solution');
    expect(r.narrow!.narrowStatus1).toBeNull();
    expect(r.narrow!.fullStatus1).toBeNull();
    expect(r.stage1.seconds).toBeGreaterThanOrEqual(r.narrow!.relaxSeconds);
  });

  it('bài không-bó hết giờ SỚM (còn ≥ nửa time_limit) -> rơi về bài đầy đủ với phần còn lại, stage1.seconds gồm bài không-bó', () => {
    const inp = input({ testRelaxBudgetSec: 0 });
    const r = solveTwoStage(highs, { ...inp, timeLimitSec: 30 });
    expect(r.narrow!.relaxStatus).toBe('time_limit_no_solution');
    expect(r.narrow!.relaxPatterns).toBe(0);
    expectValid(inp, r);
    expect(['optimal', 'optimal_by_bound', 'feasible_time_limit']).toContain(r.stage1.status);
    expect(r.stage1.seconds).toBeGreaterThanOrEqual(r.narrow!.relaxSeconds);
    // Nghiệm trực tiếp cho cùng khúc thừa tối ưu như đường thu hẹp (ca nhỏ giải được hết).
    const ref = solveTwoStage(highs, input({ narrowMinPatterns: 1_000_000 }));
    expect(r.stage1.objective).toBe(ref.stage1.objective);
  });

  it('allowShortage (chỉ test) không đi đường thu hẹp: cận dưới không-bó không còn đúng', () => {
    const r = solveTwoStage(highs, { ...input(), allowShortage: true });
    expect(r.narrow).toBeUndefined();
  });
});
