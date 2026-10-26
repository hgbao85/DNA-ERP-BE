import { getHighs, Highs } from './highs-solver';
import { optimizeMaterial } from './optimize-material';
import { MAX_SIZES_PER_BAR } from './patterns';

describe('optimizeMaterial', () => {
  let highs: Highs;
  beforeAll(async () => {
    highs = await getHighs();
  });

  const TRIM = 10;
  const KERF = 1;

  it('ca tham chiếu h10-20 (2 cỡ): 325 cây, 0,353 %, dư 16 - trùng OR-Tools', () => {
    const r = optimizeMaterial(highs, [497, 355], [1600, 3200], [6000], TRIM, KERF, {
      maxWasteRatio: 0.01,
      timeLimit: 30,
      maxSurplus: 10,
    });
    expect(r.feasible).toBe(true);
    if (!r.feasible) return;
    expect(r.total_bars).toBe(325);
    expect(r.waste_pct).toBeCloseTo(0.353026, 6);
    expect(r.total_surplus_pieces).toBe(16);
    expect(r.total_purchased_mm).toBe(1_950_000);
    expect(r.total_waste_mm).toBe(6884);
    // Như Python: cờ = cap đã dùng để sinh pattern (4) dù 2 cỡ < cap nên cap không có tác dụng.
    expect(r.limited_sizes_per_bar).toBe(4);
    expect(r.patterns_truncated).toBe(false);
  });

  it('đoạn dài hơn cây dùng được -> feasible=false với lý do rõ', () => {
    const r = optimizeMaterial(highs, [6000], [1], [6000], TRIM, KERF);
    expect(r).toEqual({
      feasible: false,
      reason: 'Có đoạn 6000mm dài hơn thanh dùng được 5990mm.',
    });
  });

  it('không pattern nào đạt ngưỡng -> feasible=false, không timed_out', () => {
    // 1 cỡ 1000: tối đa 5 đoạn = 5005/6000 -> hao hụt 16,6 % > 1 %.
    const r = optimizeMaterial(highs, [1000], [50], [6000], TRIM, KERF, { maxWasteRatio: 0.01 });
    expect(r.feasible).toBe(false);
    if (r.feasible) return;
    expect(r.timed_out).toBeUndefined();
    expect(r.reason).toContain('Không có cách cắt nào ≤ 1.0% hao hụt/cây');
  });

  it('nhiều chiều dài cây, allowMix=true: được trộn 2 chiều dài trong cùng phương án', () => {
    // 2 cỡ 2994 (vừa khít 2 đoạn trên cây 6000) và 1994 (vừa khít 2 đoạn trên cây 4000).
    const r = optimizeMaterial(highs, [2994, 1994], [4, 4], [4000, 6000], TRIM, KERF, {
      maxWasteRatio: 0.01,
      timeLimit: 30,
      allowMix: true,
    });
    expect(r.feasible).toBe(true);
    if (!r.feasible) return;
    expect(r.bars_by_length).toEqual({ '4000': 2, '6000': 2 });
    expect(r.total_bars).toBe(4);
    expect(r.total_waste_mm).toBe(40); // 4 cây × tề 10
  });

  it('allowMix=false: chấm từng chiều dài riêng, chọn chiều dài ít hao hụt nhất', () => {
    const r = optimizeMaterial(highs, [2994], [4], [4000, 6000], TRIM, KERF, {
      maxWasteRatio: 1.0,
      timeLimit: 30,
      allowMix: false,
    });
    expect(r.feasible).toBe(true);
    if (!r.feasible) return;
    expect(Object.keys(r.bars_by_length)).toEqual(['6000']);
    expect(r.total_bars).toBe(2);
  });

  it('cap 4 cỡ/cây làm rỗng tập pattern -> sinh lại không giới hạn (lưới an toàn)', () => {
    // 5 cỡ, mỗi cỡ 1 đoạn, tổng 5985 + 5 lưỡi = 5990 = vừa khít cây; ngưỡng 1 % chỉ nhận pattern
    // dùng ≥ 5940 -> bắt buộc đủ 5 cỡ trên 1 cây, cap 4 không có pattern nào.
    const sizes = [1200, 1197, 1196, 1196, 1196];
    const r = optimizeMaterial(highs, sizes, [1, 1, 1, 1, 1], [6000], TRIM, KERF, {
      maxWasteRatio: 0.01,
      timeLimit: 30,
      maxSurplus: 0,
    });
    expect(r.feasible).toBe(true);
    if (!r.feasible) return;
    expect(r.limited_sizes_per_bar).toBeNull();
    expect(r.total_bars).toBe(1);
    expect(r.plan[0].counts).toEqual([1, 1, 1, 1, 1]);
    expect(MAX_SIZES_PER_BAR).toBe(4);
  });

  it('hồi quy dữ liệu thật (proposal 2, loại 4): 4 cỡ nhu cầu lớn, không cắt kín -> 6000 vẫn khả thi, byN = direct', () => {
    // byN từng trả "vô nghiệm" vì danh sách N ứng viên (695..699) không chứa N tối ưu 701 -> optimize_one_material
    // đi vét cạn và chọn 5790 mm, lệch DEXUAT (6000 mm × 701 cây, 0,9399 %).
    const sizes = [615, 610, 500, 255];
    const demands = [2400, 2400, 1200, 2400];
    const byN = optimizeMaterial(highs, sizes, demands, [6000], TRIM, KERF, {
      maxWasteRatio: 0.01,
      timeLimit: 60,
      maxSurplus: 10,
      strategy: 'byN',
    });
    const direct = optimizeMaterial(highs, sizes, demands, [6000], TRIM, KERF, {
      maxWasteRatio: 0.01,
      timeLimit: 60,
      maxSurplus: 10,
      strategy: 'direct',
    });
    expect(byN.feasible && direct.feasible).toBe(true);
    if (!byN.feasible || !direct.feasible) return;
    expect(byN.total_bars).toBe(701);
    expect(byN.waste_pct).toBeCloseTo(0.9399, 3);
    expect(byN.total_waste_mm).toBe(direct.total_waste_mm);
    expect(byN.total_surplus_pieces).toBe(direct.total_surplus_pieces);
    expect(byN.stats.stage1_by_n?.some((s) => s.N === 0)).toBe(true); // đã quay về direct
  }, 120_000);

  it('loại sắt lớn (I5 V15 LSX 316, 27.300 đoạn, N=1794): ra đúng tối ưu trong 20 s nhờ làm tròn LP + phần dư', () => {
    // 2026-10-22: trước khi có roundingStart, HiGHS cần ~60 s mới ra nghiệm đầu tiên cho N=1794 -> hết 20 s
    // không có gì -> propose() chạy > 25 phút. OR-Tools: 1794 cây 0,1667 % (dư 14 ở 20 s/loại, dư 9 ở 120 s).
    const sizes = [850, 840, 665, 445, 436, 425, 415, 405, 375, 365, 145, 135];
    const demands = [650, 1300, 1300, 3900, 3900, 1300, 3250, 1300, 1300, 2600, 2600, 3900];
    const t0 = Date.now();
    const r = optimizeMaterial(highs, sizes, demands, [6000], TRIM, KERF, {
      maxWasteRatio: 0.01,
      timeLimit: 20,
      maxSurplus: 10,
    });
    expect(r.feasible).toBe(true);
    if (!r.feasible) return;
    expect(r.total_bars).toBe(1794);
    expect(r.waste_pct).toBeCloseTo(0.1667, 4);
    expect(r.total_waste_mm).toBe(17940);
    expect(r.total_surplus_pieces).toBeLessThanOrEqual(14);
    expect(r.stats.stage1_status).toBe('optimal_by_bound');
    expect(r.stats.stage1_by_n?.[0]).toMatchObject({ N: 1794, via: 'rounding' });
    // Ngân sách 20 s mỗi tầng: tổng không được vượt 2 tầng (thực đo 13-15 s).
    expect(Date.now() - t0).toBeLessThan(45_000);
  }, 120_000);

  it('ngưỡng hao hụt 100 % (chế độ "Chấp nhận hao hụt cao hơn") KHÔNG làm mất phương án mà ngưỡng 1 % có (proposal 191, SAT-HOP-10X20)', () => {
    // 7 cỡ, tề 10: liệt kê ở ngưỡng ≥ 5 % chạm trần 100.000 kiểu theo thứ tự DFS (toàn kiểu nhiều đoạn đầu), 5.000 kiểu
    // ít phế nhất của tập cắt cụt đó KHÔNG đủ phủ nhu cầu -> trước đây báo "vô nghiệm tồn kho" ở 6000 dù ngưỡng 1 % ra
    // 41 cây 0,17 %. Nay gộp thêm tập ĐẦY ĐỦ ở ngưỡng thấp nhất còn liệt kê hết.
    const sizes = [470, 445, 20, 430, 425, 460, 190];
    const demands = [120, 120, 120, 120, 60, 60, 120];
    const base = { timeLimit: 20, maxSurplus: 10 };
    const wide = optimizeMaterial(highs, sizes, demands, [6000], TRIM, KERF, {
      ...base,
      maxWasteRatio: 1.0,
    });
    expect(wide.feasible).toBe(true);
    if (!wide.feasible) return;
    expect(wide.patterns_truncated).toBe(true); // vẫn báo thật: ở 100 % chưa liệt kê hết
    expect(wide.stats.enum_ratio_used).toBeDefined();
    expect(wide.stats.enum_ratio_used!).toBeLessThan(1);
    expect(wide.total_bars).toBe(41);
    expect(wide.waste_pct).toBeLessThan(0.5);
  }, 120_000);

  it('stats ghi chiến lược và trạng thái 2 tầng', () => {
    const r = optimizeMaterial(highs, [497], [100], [6000], TRIM, KERF, { maxWasteRatio: 0.05 });
    expect(r.feasible).toBe(true);
    if (!r.feasible) return;
    expect(r.stats.strategy).toBe('byN');
    expect(['optimal', 'optimal_by_bound']).toContain(r.stats.stage1_status);
    expect(r.stats.pattern_count).toBeGreaterThan(0);
    expect(r.machine).toBe('laser');
    expect(r.bundle_summary).toBeUndefined();
  });

  describe('MC Tự động (machine tu_dong, cắt theo bó)', () => {
    const BUNDLE = { factors: [14, 16, 18, 20], maxManualBars: 5 };

    it('ca h10-20: ra phương án theo bó - mỗi kiểu cắt = Σ hệ số × số bó, cắt tay ≤ 5, không thiếu', () => {
      // Lưỡi 1 mm như ca laser (lưỡi 2,5 mm thì không kiểu cắt nào đạt 1 % ở cây 6000 cho 2 cỡ này).
      const r = optimizeMaterial(highs, [497, 355], [1600, 3200], [6000], TRIM, KERF, {
        maxWasteRatio: 0.01,
        timeLimit: 30,
        maxSurplus: 10,
        bundle: BUNDLE,
      });
      expect(r.feasible).toBe(true);
      if (!r.feasible) return;
      expect(r.machine).toBe('tu_dong');
      expect(r.stats.strategy).toBe('direct');
      expect(r.limited_sizes_per_bar).toBe(5);
      let manual = 0;
      let bundles = 0;
      for (const row of r.plan) {
        expect(row.bundles).toBeDefined();
        let bars = 0;
        for (const [f, cnt] of Object.entries(row.bundles!)) {
          bars += Number(f) * cnt;
          if (f === '1') manual += cnt;
          else {
            expect(BUNDLE.factors).toContain(Number(f));
            bundles += cnt;
          }
        }
        expect(bars).toBe(row.bars);
      }
      expect(manual).toBeLessThanOrEqual(5);
      expect(r.bundle_summary).toEqual({
        factors: [20, 18, 16, 14],
        total_bundles: bundles,
        manual_bars: manual,
        total_cuts: bundles + manual,
        max_sizes_per_pattern: 5,
      });
      r.produced.forEach((v, k) => {
        expect(v).toBeGreaterThanOrEqual([1600, 3200][k]);
        expect(v).toBeLessThanOrEqual([1600, 3200][k] + 10);
      });
    });

    it('nhiều hơn 5 cỡ: mọi kiểu cắt ≤ 5 cỡ (giới hạn máy), KHÔNG rơi về không giới hạn', () => {
      const sizes = [1210, 980, 760, 640, 530, 420, 310];
      const demands = [40, 40, 40, 40, 40, 40, 40];
      const r = optimizeMaterial(highs, sizes, demands, [6000], TRIM, 2.5, {
        maxWasteRatio: 0.03,
        timeLimit: 30,
        maxSurplus: 10,
        bundle: { factors: [14, 16], maxManualBars: 20 },
      });
      expect(r.feasible).toBe(true);
      if (!r.feasible) return;
      for (const row of r.plan)
        expect(row.counts.filter((c) => c > 0).length).toBeLessThanOrEqual(5);
      expect(r.limited_sizes_per_bar).toBe(5);
    });

    it('loại sắt lớn (I5 V15, 12 cỡ, 27.300 đoạn, tề 0, lưỡi 2,5): RA phương án theo bó trong 20 s/lần giải nhờ đường thu hẹp', () => {
      // 2026-10-23: trước đây giải thẳng bài bó 25.000 cột -> 20 s KHÔNG có nghiệm (60 s mới ra 1805 cây), lệnh hết giờ
      // ở 3 chiều dài dò liên tiếp. Đường thu hẹp: bài không-bó (đường laser) ~4 s, bó trên 17 pattern ~6 s -> 1801 cây.
      const sizes = [850, 840, 665, 445, 436, 425, 415, 405, 375, 365, 145, 135];
      const demands = [650, 1300, 1300, 3900, 3900, 1300, 3250, 1300, 1300, 2600, 2600, 3900];
      const t0 = Date.now();
      const r = optimizeMaterial(highs, sizes, demands, [6000], 0, 2.5, {
        maxWasteRatio: 0.01,
        timeLimit: 20,
        maxSurplus: 10,
        bundle: BUNDLE,
      });
      const secs = (Date.now() - t0) / 1000;
      expect(r.feasible).toBe(true);
      if (!r.feasible) return;
      expect(r.machine).toBe('tu_dong');
      expect(r.total_bars).toBeLessThanOrEqual(1805);
      expect(r.stats.bundle_narrow).toBeDefined();
      expect(r.stats.bundle_narrow!.relaxPatterns).toBeGreaterThan(0);
      let manual = 0;
      for (const row of r.plan) {
        let bars = 0;
        for (const [f, cnt] of Object.entries(row.bundles!)) {
          bars += Number(f) * cnt;
          if (f === '1') manual += cnt;
        }
        expect(bars).toBe(row.bars);
      }
      expect(manual).toBeLessThanOrEqual(5);
      r.produced.forEach((v, k) => {
        expect(v).toBeGreaterThanOrEqual(demands[k]);
        expect(v).toBeLessThanOrEqual(demands[k] + 10);
      });
      // Ngân sách 20 s mỗi tầng (không-bó + thu hẹp + đầy đủ nằm TRONG đó): thực đo ~30 s; quy định ≤ 45 s.
      expect(secs).toBeLessThan(45);
    }, 120_000);

    it('bó không ghép được (cắt tay 0, hệ số 20, cần 20 cây lẻ) -> feasible=false, lý do nhắc bó', () => {
      // 1 cỡ 1000 ×100, ngưỡng 20 %: chỉ kiểu 5 đoạn/cây -> 20 cây; hệ số 14/16 + 0 tay: vô nghiệm.
      const r = optimizeMaterial(highs, [1000], [100], [6000], TRIM, KERF, {
        maxWasteRatio: 0.2,
        timeLimit: 30,
        maxSurplus: 10,
        bundle: { factors: [14, 16], maxManualBars: 0 },
      });
      expect(r.feasible).toBe(false);
      if (r.feasible) return;
      expect(r.timed_out).toBeFalsy();
      expect(r.reason).toContain('bó');
    });
  });
});
