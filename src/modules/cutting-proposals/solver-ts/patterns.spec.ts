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
    // usable 5990; mỗi đoạn 497+1 = 498 -> tối đa 12 đoạn = 5976, cùi 14 mm ≤ 1 % × 6000 = 60 mm
    // (13/11/2026: hao hụt chỉ tính cùi; tề đầu 10 mm không còn nằm trong waste)
    const { rows, complete } = generatePatterns([497], [1000], STOCK, TRIM, KERF, {
      maxWasteRatio: 0.01,
    });
    expect(complete).toBe(true);
    expect(rows).toEqual([{ counts: [12], used: 12 * 4970, waste: 59900 - 12 * 4980 }]);
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
    expect(rows[0].waste).toBe(0); // vừa khít phần dùng được: cùi 0 (tề đầu 10 mm không tính hao hụt)
  });

  it('số thập phân 660.5 mm được giữ (không làm tròn thành 660/661)', () => {
    const { rows } = generatePatterns([660.5], [100], STOCK, TRIM, KERF, { maxWasteRatio: 1.0 });
    const nine = rows.find((r) => r.counts[0] === 9)!;
    expect(nine.used).toBe(9 * 6605);
    expect(nine.waste).toBe(59900 - 9 * (6605 + 10)); // usable − đoạn − lưỡi, không gồm tề đầu
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

  it('trần hao hụt tính trên CÙI: cùi ≤ ratio × cây, tề đầu không tính (13/11/2026)', () => {
    // cây 6000, tề 10, lưỡi 0, 1 cỡ 1180: 5 đoạn = 5900, cùi 90 mm; 1 % × 6000 = 60 mm -> loại.
    // Ở ngưỡng 1,5 % (90 mm) kiểu này vừa đạt, cùi đúng 90 mm (trước đây tề + cùi = 100 mm sẽ bị
    // loại).
    const strict = generatePatterns([1180], [100], STOCK, TRIM, 0, { maxWasteRatio: 0.01 });
    expect(strict.rows).toEqual([]);
    const ok = generatePatterns([1180], [100], STOCK, TRIM, 0, { maxWasteRatio: 0.015 });
    expect(ok.rows).toEqual([{ counts: [5], used: 59000, waste: 900 }]);
    // Tề 40 mm: usable 5960, 5 đoạn = 5900, cùi đúng 60 mm = trần 1 % -> đạt.
    const edge = generatePatterns([1180], [100], STOCK, 40, 0, { maxWasteRatio: 0.01 });
    expect(edge.rows).toEqual([{ counts: [5], used: 59000, waste: 600 }]);
  });

  it('luật nhát cắt cuối (minLastCutMm): đoạn dài nhất + cùi phải > ngưỡng, so nghiêm ngặt (13/11/2026)', () => {
    // cỡ 40 + lưỡi 1 = 41: usable 5990 -> 146 đoạn = 5986 (cùi 4), 145 đoạn cùi 45, 144 đoạn cùi 86
    // (40 + 86 = 126 > 100 đạt).
    const all = generatePatterns([40], [1000], STOCK, TRIM, KERF, { maxWasteRatio: 1.0 });
    const rule = generatePatterns([40], [1000], STOCK, TRIM, KERF, {
      maxWasteRatio: 1.0,
      minLastCutMm: 100,
    });
    for (const r of rule.rows) expect(400 + r.waste).toBeGreaterThan(1000); // đơn vị ×10
    expect(rule.rows.length).toBeLessThan(all.rows.length);
    expect(rule.rows.some((r) => r.counts[0] === 146)).toBe(false); // cùi 4 -> 44 mm ≤ 100
    expect(rule.rows.some((r) => r.counts[0] === 144)).toBe(true);
    // đúng ngưỡng KHÔNG đạt: 1 cỡ 1180, tề 40 -> cùi 60; đoạn 1180 + 60 = 1240; ngưỡng 1240 loại,
    // 1239 giữ.
    expect(
      generatePatterns([1180], [100], STOCK, 40, 0, { maxWasteRatio: 0.01, minLastCutMm: 1240 })
        .rows,
    ).toEqual([]);
    expect(
      generatePatterns([1180], [100], STOCK, 40, 0, { maxWasteRatio: 0.01, minLastCutMm: 1239 })
        .rows.length,
    ).toBe(1);
    // 0 / âm / không số = không áp
    for (const v of [0, -5, NaN]) {
      expect(
        generatePatterns([40], [1000], STOCK, TRIM, KERF, { maxWasteRatio: 1.0, minLastCutMm: v })
          .rows.length,
      ).toBe(all.rows.length);
    }
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
