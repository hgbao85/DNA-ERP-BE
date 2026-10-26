import { generatePatterns, scale, SCALING_FACTOR, SOLUTION_LIMIT } from './patterns';

/** Mọi số kỳ vọng tính TAY theo công thức generate_patterns() của de_xuat_logic.py (đơn vị ×10). */
describe('scale', () => {
  it('nhân 10 và làm tròn half-to-even như Python round()', () => {
    expect(scale(660.5)).toBe(6605);
    expect(scale(1.2)).toBe(12);
    expect(scale(0.25)).toBe(2); // 2.5 -> 2 (even), Math.round sẽ cho 3
    expect(scale(0.35)).toBe(4); // 3.5 -> 4
    expect(SCALING_FACTOR).toBe(10);
  });
});

describe('generatePatterns', () => {
  const STOCK = 6000;
  const TRIM = 10;
  const KERF = 1;

  it('1 cỡ: chỉ có pattern đầy nhất đạt ngưỡng 1 %', () => {
    // usable 5990; mỗi đoạn 497+1 = 498 -> tối đa 12 đoạn = 5976 ≥ 59400/10 = 5940 (99 %)
    const { rows, complete } = generatePatterns([497], [1000], STOCK, TRIM, KERF, {
      maxWasteRatio: 0.01,
    });
    expect(complete).toBe(true);
    expect(rows).toEqual([{ counts: [12], used: 12 * 4970, waste: 60000 - 12 * 4980 }]);
  });

  it('cận trên bám nhu cầu: nhu cầu 5 đoạn thì không sinh pattern 12 đoạn', () => {
    const { rows } = generatePatterns([497], [5], STOCK, TRIM, KERF, { maxWasteRatio: 1.0 });
    expect(Math.max(...rows.map((r) => r.counts[0]))).toBe(5);
  });

  it('lọc theo TỔNG sắt dùng (đoạn + lưỡi), không phải chỉ phần đoạn', () => {
    // 2 cỡ 2995 & 2994: 2 đoạn 2995 -> đoạn 5990 + lưỡi 2 = 5992 > 5990 (không vừa).
    // 1×2995 + 1×2994 = 5989 + 2 lưỡi = 5991 > 5990 (không vừa). 2×2994 = 5988 + 2 = 5990 vừa khít.
    const { rows } = generatePatterns([2995, 2994], [10, 10], STOCK, TRIM, KERF, {
      maxWasteRatio: 0.01,
    });
    expect(rows.map((r) => r.counts)).toEqual([[0, 2]]);
    expect(rows[0].waste).toBe(100); // chỉ còn tề đầu 10 mm
  });

  it('số thập phân 660.5 mm được giữ (không làm tròn thành 660/661)', () => {
    const { rows } = generatePatterns([660.5], [100], STOCK, TRIM, KERF, { maxWasteRatio: 1.0 });
    const nine = rows.find((r) => r.counts[0] === 9)!;
    expect(nine.used).toBe(9 * 6605);
    expect(nine.waste).toBe(60000 - 9 * (6605 + 10));
  });

  it('giới hạn 4 cỡ/cây khi có hơn 4 cỡ; không áp khi ≤ 4 cỡ', () => {
    const sizes = [500, 400, 300, 200, 100];
    const demands = [50, 50, 50, 50, 50];
    const capped = generatePatterns(sizes, demands, STOCK, TRIM, KERF, {
      maxWasteRatio: 1.0,
      maxSizesPerBar: 4,
    });
    expect(capped.rows.every((r) => r.counts.filter((x) => x > 0).length <= 4)).toBe(true);
    const free = generatePatterns(sizes, demands, STOCK, TRIM, KERF, {
      maxWasteRatio: 1.0,
      maxSizesPerBar: null,
    });
    expect(free.rows.length).toBeGreaterThan(capped.rows.length);
    expect(free.rows.some((r) => r.counts.every((x) => x > 0))).toBe(true);
  });

  it('dừng ở maxPatterns và báo complete=false', () => {
    const { rows, complete } = generatePatterns([300, 200, 100], [50, 50, 50], STOCK, TRIM, KERF, {
      maxWasteRatio: 1.0,
      maxPatterns: 25,
    });
    expect(rows.length).toBe(25);
    expect(complete).toBe(false);
    expect(SOLUTION_LIMIT).toBe(100000);
  });

  it('cây không dùng được (tề đầu ≥ cây) -> rỗng, complete=true', () => {
    expect(generatePatterns([100], [10], 10, 10, 1)).toEqual({ rows: [], complete: true });
  });
});
