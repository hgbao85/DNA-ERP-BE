/**
 * CS2 (anh Nhân 20/11/2026): cây lẻ trong kho Phôi của xưởng làm lệnh. Bộ giải THẬT (HiGHS):
 * - dùng cây lẻ trước khi nó BỚT được cây phải mua, tối đa đúng số cây đang có (kể cả khi cây lẻ hao hơn cây mua);
 * - phần còn thiếu cắt từ chiều dài mua (1 chiều dài);
 * - cây lẻ không cắt được đoạn nào thì không dùng.
 */
import { getHighs, Highs } from './highs-solver';
import { optimizeMaterial } from './optimize-material';
import { optimizeOneMaterial } from './optimize-one-material';
import { propose } from './propose';

describe('CS2 - cây lẻ trong kho (bộ giải thật)', () => {
  let highs: Highs;
  beforeAll(async () => {
    highs = await getHighs();
  });

  const TRIM = 10;
  const KERF = 1;
  // Đoạn 1990 mm × 6: cây 6000 (dùng được 5990) cắt 3 đoạn, cùi 17 mm -> toàn cây 6000 cần 2 cây, gần như không hao.
  // Cây lẻ 4500 (dùng được 4490) chỉ cắt 2 đoạn, cùi 508 mm -> HAO HƠN cây 6000.
  const SIZES = [1990];
  const DEMANDS = [6];
  const OPTS = { maxWasteRatio: 0.2, timeLimit: 10, maxSurplus: 10 };

  it('không có cây lẻ: toàn cây 6000 (đối chứng)', () => {
    const r = optimizeMaterial(highs, SIZES, DEMANDS, [6000], TRIM, KERF, OPTS);
    expect(r.feasible).toBe(true);
    if (!r.feasible) return;
    expect(r.bars_by_length).toEqual({ '6000': 2 });
  });

  // 23/11 (review Sang): cây lẻ chỉ được cắt khi BỚT được cây phải mua (tầng 0 = ít cây mua nhất).
  it('cây lẻ bớt được 1 cây mua (5 đoạn 1990, 1 cây lẻ 4500): dùng cây lẻ dù hao hơn, chỉ mua 1 cây 6000', () => {
    const r = optimizeMaterial(highs, SIZES, [5], [6000, 4500], TRIM, KERF, {
      ...OPTS,
      lengthCaps: { 4500: 1 },
    });
    expect(r.feasible).toBe(true);
    if (!r.feasible) return;
    expect(r.bars_by_length['4500']).toBe(1);
    expect(r.bars_by_length['6000']).toBe(1);
    expect(r.produced[0]).toBeGreaterThanOrEqual(5);
  });

  it('cây lẻ KHÔNG bớt được cây mua nào (6 đoạn: vẫn phải mua 2 cây 6000) -> không cắt cây lẻ', () => {
    const r = optimizeMaterial(highs, SIZES, DEMANDS, [6000, 4500], TRIM, KERF, {
      ...OPTS,
      lengthCaps: { 4500: 1 },
    });
    expect(r.feasible).toBe(true);
    if (!r.feasible) return;
    expect(r.bars_by_length).toEqual({ '6000': 2 });
  });

  it('không dùng quá số cây lẻ đang có (có 2 cây nhưng chỉ cần 3 cây 4500 thì phải bù cây 6000)', () => {
    const r = optimizeMaterial(highs, SIZES, DEMANDS, [6000, 4500], TRIM, KERF, {
      ...OPTS,
      lengthCaps: { 4500: 2 },
    });
    expect(r.feasible).toBe(true);
    if (!r.feasible) return;
    expect(r.bars_by_length['4500']).toBe(2);
    expect(r.bars_by_length['6000']).toBe(1);
  });

  it('cây lẻ ngắn hơn mọi đoạn -> không dùng, không làm hỏng bài', () => {
    const r = optimizeMaterial(highs, SIZES, DEMANDS, [6000, 1500], TRIM, KERF, {
      ...OPTS,
      lengthCaps: { 1500: 3 },
    });
    expect(r.feasible).toBe(true);
    if (!r.feasible) return;
    expect(r.bars_by_length).toEqual({ '6000': 2 });
  });

  // Review Sang 21/11: bản đầu tối đa số CÂY lẻ -> 30 cây lẻ 5800 cho 20 đoạn 500 bị dùng hết, mỗi cây 1 đoạn (hao 91 %).
  it('nhiều cây lẻ: chỉ dùng đủ số cây cần (20 đoạn 500, có 30 cây lẻ 5800 -> 2 cây), không phá hết cây lẻ', () => {
    const r = optimizeMaterial(highs, [500], [20], [6000, 5800], TRIM, KERF, {
      ...OPTS,
      lengthCaps: { 5800: 30 },
    });
    expect(r.feasible).toBe(true);
    if (!r.feasible) return;
    expect(r.bars_by_length['5800']).toBe(2);
    expect(r.bars_by_length['6000'] ?? 0).toBe(0);
  });

  it('nhiều cây lẻ qua optimizeOneMaterial (ngưỡng 1 %): vẫn 2 cây lẻ, không mua', () => {
    const r = optimizeOneMaterial(highs, [500], [20], [6000], TRIM, KERF, 1, {
      timeLimitSec: 10,
      maxSurplus: 10,
      leftovers: [{ length: 5800, count: 30 }],
    });
    expect(r.feasible).toBe(true);
    if (!r.feasible) return;
    const byLen = new Map<number, number>();
    for (const p of r.plan) byLen.set(p.stock_length, (byLen.get(p.stock_length) ?? 0) + p.bars);
    expect(byLen.get(5800)).toBe(2);
    expect(byLen.get(6000) ?? 0).toBe(0);
  });

  it('kiểu cắt trên cây MUA vẫn giữ ngưỡng hao hụt từng cây khi có cây lẻ', () => {
    // Đoạn 4000: cây 6000 cắt 1 đoạn hao ~33 % > 20 % -> không có kiểu cắt cây mua hợp lệ; cây lẻ 4100 thì hợp lệ (cây lẻ nới ngưỡng).
    const r = optimizeMaterial(highs, [4000], [3], [6000, 4100], TRIM, KERF, {
      ...OPTS,
      lengthCaps: { 4100: 1 },
    });
    expect(r.feasible).toBe(false);
  });

  // Review Sang 21/11 (2c): MC Tự động + cây lẻ trước đây bỏ đường thu hẹp bó, loại sắt lớn hết giờ không ra nghiệm (đo 23/11).
  it('MC Tự động (đường thu hẹp bó) + cây lẻ: ra phương án theo bó, cây lẻ cắt tay, không quá số cây lẻ', () => {
    const r = optimizeMaterial(highs, [1990], [61], [6000, 4500], TRIM, KERF, {
      ...OPTS,
      lengthCaps: { 4500: 1 },
      bundle: { factors: [14, 16], maxManualBars: 5, narrowMinPatterns: 1 },
    });
    expect(r.feasible).toBe(true);
    if (!r.feasible) return;
    expect(r.machine).toBe('tu_dong');
    // 61 đoạn: cây 6000 cắt 3 -> 20 cây + 1 đoạn; cây lẻ 4500 (2 đoạn) bớt được 1 cây mua.
    expect(r.bars_by_length['4500']).toBe(1);
    expect(r.bars_by_length['6000']).toBe(20);
    for (const row of r.plan) {
      let bars = 0;
      for (const [f, cnt] of Object.entries(row.bundles!)) bars += Number(f) * cnt;
      expect(bars).toBe(row.bars);
    }
  });

  it('optimizeOneMaterial: chiều dài mua vẫn là 1 (6000), cây lẻ đi kèm trong kiểu cắt', () => {
    const r = optimizeOneMaterial(highs, SIZES, [5], [6000], TRIM, KERF, 20, {
      timeLimitSec: 10,
      maxSurplus: 10,
      leftovers: [{ length: 4500, count: 1 }],
    });
    expect(r.feasible).toBe(true);
    if (!r.feasible) return;
    expect(r.best_length).toBe(6000);
    const byLen = new Map<number, number>();
    for (const p of r.plan) byLen.set(p.stock_length, (byLen.get(p.stock_length) ?? 0) + p.bars);
    expect(byLen.get(4500)).toBe(1);
  });

  it('cây lẻ trùng chiều dài mua đang thử -> không thêm giới hạn riêng (mua chiều dài đó như thường)', () => {
    const r = optimizeOneMaterial(highs, SIZES, DEMANDS, [4500], TRIM, KERF, 20, {
      timeLimitSec: 10,
      maxSurplus: 10,
      leftovers: [{ length: 4500, count: 1 }],
    });
    expect(r.feasible).toBe(true);
    if (!r.feasible) return;
    expect(r.best_length).toBe(4500);
    expect(r.total_bars).toBe(3);
  });

  it('propose(): đọc leftover_stock_by_material theo mã sắt, cutting_patterns ghi chiều dài cây từng kiểu', async () => {
    const res = await propose({
      bom: [
        {
          part: 'P',
          qty_per_set: 5,
          material: 'SAT-A',
          spec: '',
          cut_length: 1990,
          qty_per_part: 1,
        },
      ],
      stock_lengths: [6000],
      trim_start: TRIM,
      blade_width: KERF,
      max_waste_percentage: 20,
      time_limit_seconds: 10,
      leftover_stock_by_material: { 'SAT-A': [{ length: 4500, count: 1 }] },
    });
    expect(res.status).toBe('success');
    if (res.status !== 'success') return;
    const line = res.purchase_plan[0];
    expect(line.feasible).toBe(true);
    if (!line.feasible) return;
    expect(line.best_stock_length).toBe(6000);
    const lens = line.cutting_patterns.map((p) => p.stock_length);
    expect(lens).toContain(4500);
    expect(
      line.cutting_patterns.filter((p) => p.stock_length === 4500).reduce((s, p) => s + p.bars, 0),
    ).toBe(1);
  });
});

describe('CS2 - câu 2b: dùng cây lẻ kể cả khi vượt ngưỡng (KHSX xin đặc cách)', () => {
  let highs: Highs;
  beforeAll(async () => {
    highs = await getHighs();
  });

  // 20/11 bản đầu cắt cả cây lẻ 5800 lẫn 1 cây 6000 cho ca này (2 cây cho việc 1 cây làm được) - sai, sửa 23/11.
  it('ca thật SAT-001 (650 x4, 420 x8, ngưỡng 1 %): cây lẻ 5800 không chứa hết -> vẫn mua 1 cây 6000, KHÔNG cắt cây lẻ', () => {
    const r = optimizeOneMaterial(highs, [650, 420], [4, 8], [6000], 10, 2.5, 1, {
      timeLimitSec: 10,
      maxSurplus: 10,
      leftovers: [{ length: 5800, count: 1 }],
    });
    expect(r.feasible).toBe(true);
    if (!r.feasible) return;
    expect(r.plan.filter((p) => p.stock_length === 5800)).toEqual([]);
    expect(r.total_bars).toBe(1);
    expect(r.over_waste).toBe(false);
  });

  it('cây lẻ 5800 chứa hết (650 x4, 420 x6): không mua, dùng cây lẻ dù hao vượt 1 % -> báo vượt ngưỡng', () => {
    const r = optimizeOneMaterial(highs, [650, 420], [4, 6], [6000], 10, 2.5, 1, {
      timeLimitSec: 10,
      maxSurplus: 10,
      leftovers: [{ length: 5800, count: 1 }],
    });
    expect(r.feasible).toBe(true);
    if (!r.feasible) return;
    const at5800 = r.plan.filter((p) => p.stock_length === 5800).reduce((s, p) => s + p.bars, 0);
    expect(at5800).toBe(1);
    expect(r.plan.filter((p) => p.stock_length === 6000)).toEqual([]);
    expect(r.best_length).toBe(6000);
    expect(r.over_waste).toBe(true);
  });

  it('không có cây lẻ: cùng ca vẫn 1 cây 6000 dưới ngưỡng (đối chứng, không đổi hành vi cũ)', () => {
    const r = optimizeOneMaterial(highs, [650, 420], [4, 8], [6000], 10, 2.5, 1, {
      timeLimitSec: 10,
      maxSurplus: 10,
    });
    expect(r.feasible).toBe(true);
    if (!r.feasible) return;
    expect(r.total_bars).toBe(1);
    expect(r.over_waste).toBe(false);
  });
});
