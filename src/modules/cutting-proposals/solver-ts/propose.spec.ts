/* eslint-disable @typescript-eslint/no-unsafe-assignment -- expect.any() trả any trong toEqual() */
import { explodeBom, listMaterialGroups, normalizeSpec, propose, toFloat, toInt } from './propose';

describe('normalizeSpec / toFloat / toInt (giống views.py + de_xuat_logic.py)', () => {
  it('quy mọi ký hiệu nhân về x, gộp khoảng trắng', () => {
    expect(normalizeSpec('10*20')).toBe('10x20');
    expect(normalizeSpec('10 X 20')).toBe('10x20');
    expect(normalizeSpec('10 × 20')).toBe('10x20');
    expect(normalizeSpec(' Ø21 ')).toBe('Ø21');
    expect(normalizeSpec('0.6  x 1.5')).toBe('0.6x1.5'); // dấu chấm thập phân giữ nguyên
    expect(normalizeSpec(null)).toBe('');
  });
  it('ép số chịu được chuỗi, rỗng, rác', () => {
    expect(toFloat('2.5')).toBe(2.5);
    expect(toFloat('', 7)).toBe(7);
    expect(toFloat('abc', 3)).toBe(3);
    expect(toInt('4.0')).toBe(4);
    expect(toInt('2.5')).toBe(2); // int(round(2.5)) của Python = 2 (half-to-even)
    expect(toInt('3.5')).toBe(4);
  });
});

describe('explodeBom / listMaterialGroups', () => {
  it('gom theo material + spec đã chuẩn hoá, nhân qty_per_set × qty_per_part × num_sets, bỏ dòng ≤ 0', () => {
    const groups = listMaterialGroups(
      [
        {
          part: 'a',
          qty_per_set: 2,
          material: 'Sắt hộp',
          spec: '10*20',
          cut_length: 660.5,
          qty_per_part: 3,
        },
        {
          part: 'b',
          qty_per_set: 1,
          material: 'Sắt  hộp',
          spec: '10x20',
          cut_length: 660.5,
          qty_per_part: 1,
        },
        {
          part: 'c',
          qty_per_set: 1,
          material: 'Sắt hộp',
          spec: '10x20',
          cut_length: 300.04,
          qty_per_part: 1,
        },
        {
          part: 'd',
          qty_per_set: 1,
          material: 'Sắt hộp',
          spec: '10x20',
          cut_length: 0,
          qty_per_part: 1,
        },
        {
          part: 'e',
          qty_per_set: 0,
          material: 'Sắt tròn',
          spec: 'Ø8',
          cut_length: 100,
          qty_per_part: 1,
        },
      ],
      10,
    );
    expect(groups).toEqual([{ material: 'Sắt hộp 10x20', sizes: [660.5, 300], demands: [70, 10] }]);
    expect([...explodeBom([], 1).keys()]).toEqual([]);
  });
});

describe('propose (hợp đồng api_de_xuat_propose)', () => {
  const bom = [
    { part: 'ngang', qty_per_set: 16, material: 'A', spec: '', cut_length: 497, qty_per_part: 1 },
    { part: 'dọc', qty_per_set: 32, material: 'A', spec: '', cut_length: 355, qty_per_part: 1 },
    { part: 'chốt', qty_per_set: 1, material: 'B', spec: '', cut_length: 7000, qty_per_part: 1 },
  ];

  it('lỗi đầu vào trả status=error + code + http_status 400 như Django', async () => {
    expect(await propose({ num_sets: 0, bom })).toMatchObject({
      status: 'error',
      code: 'INVALID_INPUT',
      http_status: 400,
    });
    expect(await propose({ bom: [] })).toMatchObject({
      code: 'INVALID_INPUT',
      message: 'bom phải là array không rỗng',
    });
    expect(await propose({ bom: [{ material: 'A' }] })).toMatchObject({
      message: 'Định mức rỗng hoặc không hợp lệ',
    });
    expect(await propose({ bom, stock_lengths: '' })).toMatchObject({
      message: 'stock_lengths không hợp lệ',
    });
  });

  it('ca h10-20: summary + purchase_plan đúng dạng, loại B (đoạn dài hơn cây) feasible=false', async () => {
    const res = await propose({
      num_sets: 100,
      bom,
      stock_lengths: '5850 6000',
      stock_lengths_by_material: { A: [6000], 'không có': '5850' },
      max_waste_percentage: 1.0,
      max_waste_percentage_by_material: { B: 2.5, A: 150 },
      trim_start: 10,
      blade_width: 1.0,
      max_surplus: 10,
      auto_scan: false,
      time_limit_seconds: 30,
    });
    expect(res.status).toBe('success');
    if (res.status !== 'success') return;
    expect(res.summary).toEqual({
      num_sets: 100,
      num_material_groups: 1,
      total_solve_seconds: expect.any(Number),
      total_bars_all: 325,
      total_purchased_mm: 1_950_000,
      total_waste_mm: 3634, // 13/11/2026: chỉ cùi (cũ 6884 gồm tề 325 × 10)
      total_surplus_pieces: 16,
      waste_percentage: 0.1864,
      any_over_threshold: false,
    });
    const [a, b] = res.purchase_plan;
    expect(a).toMatchObject({
      material: 'A',
      feasible: true,
      best_stock_length: 6000,
      length_source: 'fixed',
      total_bars: 325,
      waste_percentage: 0.1864,
      total_surplus_pieces: 16,
      over_threshold: false,
      max_waste_pct_threshold: 1, // 150 ngoài (0,100] -> bỏ qua, dùng mặc định
      timeout_count: 0,
      optimal_custom_length: null,
    });
    if (!a.feasible) return;
    expect(a.pieces).toEqual([
      { size: 497, demand: 1600, produced: 1610, surplus: 10 },
      { size: 355, demand: 3200, produced: 3206, surplus: 6 },
    ]);
    expect(
      a.cutting_patterns.map((p) => [p.pattern_id, p.counts, p.bars, p.waste_per_bar]),
    ).toEqual([
      [1, [7, 7], 192, 12], // cùi 12 mm (cũ 22 gồm tề 10)
      [2, [2, 14], 133, 10],
    ]);
    expect(a.cutting_patterns[0].pieces_breakdown).toEqual([
      { size: 497, count: 7 },
      { size: 355, count: 7 },
    ]);
    expect(a.length_comparison).toEqual([{ length: 6000, bars: 325, waste_pct: 0.1864 }]);
    expect(b).toEqual({
      material: 'B',
      feasible: false,
      timed_out: false,
      best_achievable: null,
      reason: expect.stringContaining('dài hơn phần dùng được của cây (5990mm)'),
      max_waste_pct_threshold: 2.5,
      solve_seconds: expect.any(Number),
    });
    expect(res.input_echo).toMatchObject({
      stock_lengths: [5850, 6000],
      max_waste_percentage_by_material: { B: 2.5 },
      resolved_max_waste_pct_by_group: { A: 1, B: 2.5 },
      stock_lengths_by_material: { A: [6000], 'không có': [5850] },
      resolved_stock_lengths_by_group: { A: [6000], B: [5850, 6000] },
      min_length: 4000,
      max_length: 12000,
      length_step: 50,
      auto_scan: false,
      stop_on_first: false,
    });
  });

  it('stock_lengths nhận cả mảng số lẫn chuỗi có dấu phẩy', async () => {
    const r1 = await propose({
      bom: bom.slice(0, 2),
      stock_lengths: [6000, 5850, 6000],
      time_limit_seconds: 30,
    });
    const r2 = await propose({
      bom: bom.slice(0, 2),
      stock_lengths: '6000, 5850',
      time_limit_seconds: 30,
    });
    expect(r1.status === 'success' && r1.input_echo.stock_lengths).toEqual([5850, 6000]);
    expect(r2.status === 'success' && r2.input_echo.stock_lengths).toEqual([5850, 6000]);
  });

  it('chiều dài riêng từng loại sắt lẻ 5360 -> giải trên cây đã tròn 5400; loại khác vẫn dùng stock_lengths', async () => {
    const res = await propose({
      num_sets: 10,
      bom: [
        {
          part: 'ngang',
          qty_per_set: 16,
          material: 'A',
          spec: '',
          cut_length: 497,
          qty_per_part: 1,
        },
        { part: 'dọc', qty_per_set: 32, material: 'C', spec: '', cut_length: 355, qty_per_part: 1 },
      ],
      stock_lengths: '6000',
      stock_lengths_by_material: { A: [5360] },
      max_waste_percentage: 100,
      trim_start: 10,
      blade_width: 1.0,
      auto_scan: false,
      time_limit_seconds: 30,
    });
    expect(res.status).toBe('success');
    if (res.status !== 'success') return;
    const a = res.purchase_plan.find((p) => p.material === 'A');
    const c = res.purchase_plan.find((p) => p.material === 'C');
    expect(a).toMatchObject({ feasible: true, best_stock_length: 5400 });
    expect(c).toMatchObject({ feasible: true, best_stock_length: 6000 });
  });

  it("machine mặc định 'laser', echo đủ trường máy; machine lạ -> INVALID_INPUT", async () => {
    const r = await propose({
      bom: bom.slice(0, 2),
      stock_lengths: '6000',
      time_limit_seconds: 30,
    });
    expect(r.status).toBe('success');
    if (r.status !== 'success') return;
    expect(r.input_echo).toMatchObject({
      machine: 'laser',
      bundle_factors: [],
      max_manual_cuts: 0,
      max_sizes_per_pattern: 0,
    });
    expect(r.purchase_plan[0]).toMatchObject({ machine: 'laser' });
    expect((r.purchase_plan[0] as { bundle_summary?: unknown }).bundle_summary).toBeUndefined();
    expect(await propose({ bom, stock_lengths: '6000', machine: 'plasma' })).toMatchObject({
      status: 'error',
      code: 'INVALID_INPUT',
    });
  });

  it("machine 'tu_dong': hệ số bó từ chuỗi, mặc định 14 16 18 20 / cắt tay 5 / 5 cỡ; kết quả có bó", async () => {
    const r = await propose({
      bom: bom.slice(0, 2),
      stock_lengths: '6000',
      blade_width: 1,
      machine: 'tu_dong',
      bundle_factors: '16, 14 20',
      max_manual_cuts: '4',
      time_limit_seconds: 30,
    });
    expect(r.status).toBe('success');
    if (r.status !== 'success') return;
    expect(r.input_echo).toMatchObject({
      machine: 'tu_dong',
      bundle_factors: [20, 16, 14],
      max_manual_cuts: 4,
      max_sizes_per_pattern: 5,
    });
    const a = r.purchase_plan[0];
    expect(a.feasible).toBe(true);
    if (!a.feasible) return;
    expect(a.machine).toBe('tu_dong');
    expect(a.bundle_summary).toMatchObject({ factors: [20, 16, 14], max_sizes_per_pattern: 5 });
    expect(a.bundle_summary!.manual_bars).toBeLessThanOrEqual(4);
    expect(a.bundle_summary!.total_cuts).toBe(
      a.bundle_summary!.total_bundles + a.bundle_summary!.manual_bars,
    );
    for (const p of a.cutting_patterns) {
      expect(p.bundles).toBeDefined();
      const bars = Object.entries(p.bundles!).reduce((s, [f, c]) => s + Number(f) * c, 0);
      expect(bars).toBe(p.bars);
    }
    const def = await propose({ bom: bom.slice(0, 2), stock_lengths: '6000', machine: 'tu_dong' });
    expect(def.status === 'success' && def.input_echo).toMatchObject({
      bundle_factors: [20, 18, 16, 14],
      max_manual_cuts: 5,
      max_sizes_per_pattern: 5,
    });
    expect(
      await propose({ bom, stock_lengths: '6000', machine: 'tu_dong', bundle_factors: '1 0' }),
    ).toMatchObject({ status: 'error', code: 'INVALID_INPUT' });
  });
  describe('bundle_factors_by_material (13/11/2026 đợt 2)', () => {
    const mk = (material: string, cut: number, qty: number) => ({
      part: 'p',
      qty_per_set: 1,
      material,
      spec: '',
      cut_length: cut,
      qty_per_part: qty,
    });
    const rows = [
      mk('A', 497, 480),
      mk('A', 355, 960),
      mk('B', 100, 590),
      mk('C', 497, 480),
      mk('C', 355, 960),
    ];

    it('A hệ số riêng [6, 8], B = null (cắt từng cây, lưỡi fallback), C không khoá (hệ số chung)', async () => {
      const r = await propose({
        bom: rows,
        stock_lengths: '6000',
        machine: 'tu_dong',
        bundle_factors: '14 16',
        blade_width: 5, // lưỡi MC Tự động - loại B KHÔNG được dùng
        fallback_trim_start: 10,
        fallback_blade_width: 1.0,
        bundle_factors_by_material: { A: [6, 8], B: null },
        max_waste_percentage: 100,
        max_surplus: 100,
        time_limit_seconds: 60,
      });
      expect(r.status).toBe('success');
      if (r.status !== 'success') return;
      const [a, b, c] = ['A', 'B', 'C'].map((m) => r.purchase_plan.find((p) => p.material === m)!);
      expect(a.feasible && b.feasible && c.feasible).toBe(true);
      if (!a.feasible || !b.feasible || !c.feasible) return;
      // A: hệ số riêng
      expect(a.machine).toBe('tu_dong');
      expect(a.bundle_summary!.factors).toEqual([8, 6]);
      for (const p of a.cutting_patterns) {
        for (const f of Object.keys(p.bundles!)) expect([1, 6, 8]).toContain(Number(f));
      }
      expect(a.bundle_summary!.manual_bars).toBeLessThanOrEqual(5);
      // B: cắt từng cây
      expect(b.machine).toBe('laser');
      expect(b.bundle_summary).toBeUndefined();
      expect(Math.max(...b.cutting_patterns.flatMap((p) => p.counts))).toBe(59); // lưỡi 1,0 (lưỡi 5 chỉ được 57)
      // C: hệ số chung
      expect(c.machine).toBe('tu_dong');
      expect(c.bundle_summary!.factors).toEqual([16, 14]);
    });

    it('lưỡi fallback 2,5 cho số đoạn/cây khác lưỡi 1,0', async () => {
      const run = async (blade: number) => {
        const r = await propose({
          bom: [mk('B', 100, 590)],
          stock_lengths: '6000',
          machine: 'tu_dong',
          bundle_factors_by_material: { B: null },
          fallback_blade_width: blade,
          max_waste_percentage: 100,
          max_surplus: 100,
          time_limit_seconds: 60,
        });
        const x = r.status === 'success' ? r.purchase_plan[0] : null;
        if (!x || !x.feasible) throw new Error('không khả thi');
        return Math.max(...x.cutting_patterns.flatMap((p) => p.counts));
      };
      const one = await run(1.0);
      const two = await run(2.5);
      expect(one).not.toBe(two);
      expect(one).toBeGreaterThan(two);
    });

    it('danh sách riêng không hợp lệ -> INVALID_INPUT; khoá không hiệu lực khi máy laser', async () => {
      expect(
        await propose({
          bom: rows,
          stock_lengths: '6000',
          machine: 'tu_dong',
          bundle_factors_by_material: { A: [1, 0] },
        }),
      ).toMatchObject({ status: 'error', code: 'INVALID_INPUT' });
      const laser = await propose({
        bom: [mk('B', 100, 590)],
        stock_lengths: '6000',
        bundle_factors_by_material: { B: [1, 0] },
        max_waste_percentage: 100,
        max_surplus: 100,
        time_limit_seconds: 60,
      });
      expect(laser.status).toBe('success');
    });

    it('hệ số riêng có bó nhỏ nhất lớn (60): lệnh cần ít cây vẫn cắt được - phần lẻ không đủ bó thì cắt lẻ, tới (bó nhỏ nhất − 1) cây', async () => {
      // 240 đoạn 497 mm: 12 đoạn/cây (12 × 497 + 12 × 2,5 lưỡi + 10 tề = 6004 > 6000 -> 11
      // đoạn/cây) => ~22 cây, ít hơn 1 bó 60.
      // Với trần cắt tay chung (5) bài này vô nghiệm hoặc bị ép lên 60 + 5 cây; theo quy tắc "phần
      // lẻ cắt lẻ" thì 22 cây cắt lẻ.
      const r = await propose({
        bom: [mk('A', 497, 240)],
        stock_lengths: '6000',
        machine: 'tu_dong',
        trim_start: 10,
        blade_width: 2.5,
        max_manual_cuts: 5,
        bundle_factors_by_material: { A: [60, 64, 68] },
        max_waste_percentage: 100,
        max_surplus: 10,
        time_limit_seconds: 60,
      });
      expect(r.status).toBe('success');
      if (r.status !== 'success') return;
      const a = r.purchase_plan[0];
      expect(a.feasible).toBe(true);
      if (!a.feasible) return;
      expect(a.total_bars).toBeLessThan(60);
      expect(a.bundle_summary!.total_bundles).toBe(0);
      expect(a.bundle_summary!.manual_bars).toBe(a.total_bars);
      expect(a.bundle_summary!.manual_bars).toBeLessThanOrEqual(59);
    });
  });

  it('ví dụ của Sếp (13/11/2026): cây 6000, MC Tự động, lưỡi 2,5, tề 10, đoạn 427 × 1180 + 425 × 295 + 422 × 590 - % chỉ tính cùi', async () => {
    // Ví dụ trong góp ý 12/11: kiểu 427×8 + 425×2 + 422×4 = 5954 mm + 14 lưỡi × 2,5 + tề đầu 10 =
    // 5999 -> cùi 1 mm (đạt);
    // kiểu 427×13 cùi 406,5 mm = 6,8 % (không đạt). Trước 13/11 cùng phương án 148 cây báo 1626 mm
    // = 0,18 % vì cộng cả tề đầu
    // (148 × 10 = 1480 mm); theo luật mới chỉ còn phần cùi.
    const bom = [
      { part: 'a', qty_per_set: 1, material: 'X', spec: '', cut_length: 427, qty_per_part: 1180 },
      { part: 'b', qty_per_set: 1, material: 'X', spec: '', cut_length: 425, qty_per_part: 295 },
      { part: 'c', qty_per_set: 1, material: 'X', spec: '', cut_length: 422, qty_per_part: 590 },
    ];
    const r = await propose({
      bom,
      stock_lengths: '6000',
      machine: 'tu_dong',
      trim_start: 10,
      blade_width: 2.5,
      max_surplus: 10,
      max_waste_percentage: 1,
      time_limit_seconds: 60,
    });
    expect(r.status).toBe('success');
    if (r.status !== 'success') return;
    const a = r.purchase_plan[0];
    expect(a.feasible).toBe(true);
    if (!a.feasible) return;
    expect(a.over_threshold).toBe(false);
    expect(a.total_bars).toBeLessThanOrEqual(148);
    // mọi kiểu cắt có cùi ≤ 1 % × 6000 = 60 mm
    for (const p of a.cutting_patterns) expect(p.waste_per_bar).toBeLessThanOrEqual(60 + 1e-9);
    // total_waste_mm = Σ cùi; % = Σ cùi / Σ chiều dài cây mua (6000 × số cây); tề đầu không nằm
    // trong đó
    const sum = a.cutting_patterns.reduce((t, p) => t + p.waste_per_bar * p.bars, 0);
    expect(a.total_waste_mm).toBeCloseTo(sum, 6);
    expect(a.total_purchased_mm).toBe(6000 * a.total_bars);
    expect(a.waste_percentage).toBeCloseTo((a.total_waste_mm / a.total_purchased_mm) * 100, 3);
    expect(a.waste_percentage).toBeLessThanOrEqual(0.05);
  }, 120_000);

  describe('luật laze nhát cắt cuối laser_min_tail_mm (13/11/2026, câu 11)', () => {
    const shortBom = (qty: number) => [
      { part: 's', qty_per_set: 1, material: 'S', spec: '', cut_length: 40, qty_per_part: qty },
    ];
    const run = async (extra: Record<string, unknown>, qty = 1000) => {
      const r = await propose({
        bom: shortBom(qty),
        stock_lengths: '6000',
        trim_start: 10,
        blade_width: 1,
        max_surplus: 10,
        time_limit_seconds: 60,
        ...extra,
      });
      expect(r.status).toBe('success');
      if (r.status !== 'success') throw new Error('lỗi');
      return r.purchase_plan[0];
    };
    /** nhát cuối của mỗi kiểu = đoạn dài nhất trên cây + cùi */
    const lastCuts = (p: {
      pieces_breakdown: Array<{ size: number; count: number }>;
      waste_per_bar: number;
    }) =>
      Math.max(...p.pieces_breakdown.filter((x) => x.count > 0).map((x) => x.size)) +
      p.waste_per_bar;

    it('(a)(b) laser đoạn 40 mm: mọi kiểu cắt có đoạn dài nhất + cùi > 100; tắt luật (0) thì ra kiểu cùi nhỏ hơn', async () => {
      const on = await run({ max_waste_percentage: 5, laser_min_tail_mm: 100 });
      const off = await run({ max_waste_percentage: 5, laser_min_tail_mm: 0 });
      expect(on.feasible && off.feasible).toBe(true);
      if (!on.feasible || !off.feasible) return;
      for (const p of on.cutting_patterns) expect(lastCuts(p)).toBeGreaterThan(100);
      expect(Math.min(...off.cutting_patterns.map((p) => lastCuts(p)))).toBeLessThanOrEqual(100);
      expect(Math.min(...off.cutting_patterns.map((p) => p.waste_per_bar))).toBeLessThan(
        Math.min(...on.cutting_patterns.map((p) => p.waste_per_bar)),
      );
      expect(on.total_waste_mm).toBeGreaterThan(off.total_waste_mm);
    }, 120_000);

    it('thiếu / chuỗi rác = không áp luật (giống 0); đoạn ≥ 100 mm: luật không đổi kết quả', async () => {
      const a = await run({ max_waste_percentage: 5 });
      const b = await run({ max_waste_percentage: 5, laser_min_tail_mm: 'abc' });
      expect(a.feasible && b.feasible).toBe(true);
      if (!a.feasible || !b.feasible) return;
      expect(b.total_bars).toBe(a.total_bars);
      const longBom = [
        { part: 'l', qty_per_set: 1, material: 'L', spec: '', cut_length: 497, qty_per_part: 480 },
      ];
      const go = async (tail: number) => {
        const r = await propose({
          bom: longBom,
          stock_lengths: '6000',
          max_waste_percentage: 1,
          laser_min_tail_mm: tail,
          time_limit_seconds: 60,
        });
        const x = r.status === 'success' ? r.purchase_plan[0] : null;
        if (!x || !x.feasible) throw new Error('không khả thi');
        return x;
      };
      const [x0, x100] = [await go(0), await go(100)];
      expect(x100.total_bars).toBe(x0.total_bars);
      expect(x100.total_waste_mm).toBe(x0.total_waste_mm);
    }, 120_000);

    it('(c) MC Tự động (cắt theo bó) KHÔNG bị luật ràng buộc', async () => {
      // 2044 = 14 cây × 146 đoạn: cùi 4 mm/cây, 40 + 4 = 44 ≤ 100 -> vẫn dùng được vì cắt bó không
      // áp luật.
      const p = await run(
        { machine: 'tu_dong', max_waste_percentage: 1, laser_min_tail_mm: 100 },
        2044,
      );
      expect(p.feasible).toBe(true);
      if (!p.feasible) return;
      expect(p.machine).toBe('tu_dong');
      expect(p.cutting_patterns.some((c) => lastCuts(c) <= 100)).toBe(true);
    }, 120_000);

    it('(d) loại sắt bundle_factors_by_material = null trong lượt tu_dong (cắt từng cây) CÓ bị ràng buộc', async () => {
      const p = await run({
        machine: 'tu_dong',
        max_waste_percentage: 5,
        laser_min_tail_mm: 100,
        bundle_factors_by_material: { S: null },
      });
      expect(p.feasible).toBe(true);
      if (!p.feasible) return;
      expect(p.machine).toBe('laser');
      for (const c of p.cutting_patterns) expect(lastCuts(c)).toBeGreaterThan(100);
    }, 120_000);

    it('(e) không còn kiểu hợp lệ vì luật -> infeasible, lý do nói rõ luật nhát cắt cuối', async () => {
      // 1022 = 7 cây × 146 đoạn. Ngưỡng 1 % => cùi ≤ 60 mm; 40 + 60 = 100 không > 100 nên không
      // kiểu nào hợp lệ. Bỏ luật thì cắt được.
      const on = await run({ max_waste_percentage: 1, laser_min_tail_mm: 100 }, 1022);
      expect(on.feasible).toBe(false);
      if (on.feasible) return;
      expect(on.reason).toContain('Máy laze cần nhát cắt cuối ra đoạn dài hơn 100 mm (gồm cùi)');
      const off = await run({ max_waste_percentage: 1, laser_min_tail_mm: 0 }, 1022);
      expect(off.feasible).toBe(true);
    }, 120_000);
  });

  it('scan_center_length được đọc; thiếu thì lấy chiều dài chuẩn đầu tiên; luật xưởng max_sizes_per_bar_start trả sizes_per_bar_*', async () => {
    const base = {
      bom: [
        { part: 'a', qty_per_set: 1, material: 'X', spec: '', cut_length: 800, qty_per_part: 40 },
        { part: 'b', qty_per_set: 1, material: 'X', spec: '', cut_length: 600, qty_per_part: 40 },
        { part: 'c', qty_per_set: 1, material: 'X', spec: '', cut_length: 450, qty_per_part: 40 },
      ],
      stock_lengths: '6000',
      max_waste_percentage: 5,
      time_limit_seconds: 30,
    };
    const none = await propose({ ...base });
    expect(none.status === 'success' && none.purchase_plan[0]).not.toHaveProperty(
      'sizes_per_bar_start',
    );
    for (const bad of [null, '', 'abc', 0, -3]) {
      const r = await propose({ ...base, max_sizes_per_bar_start: bad });
      expect(r.status === 'success' && r.purchase_plan[0]).not.toHaveProperty(
        'sizes_per_bar_start',
      );
    }
    const ruled = await propose({ ...base, max_sizes_per_bar_start: '2.9' });
    expect(ruled.status).toBe('success');
    if (ruled.status !== 'success') return;
    const a = ruled.purchase_plan[0];
    expect(a.feasible).toBe(true);
    if (!a.feasible) return;
    expect(a.sizes_per_bar_start).toBe(2); // '2.9' ép số nguyên 2
    expect(a.sizes_per_bar_limit).not.toBeUndefined();
    const lim = a.sizes_per_bar_limit;
    if (lim !== null && lim !== undefined) {
      expect(lim).toBeGreaterThanOrEqual(2);
      for (const p of a.cutting_patterns)
        expect(p.counts.filter((c) => c > 0).length).toBeLessThanOrEqual(lim);
    }
  }, 120_000);
});
