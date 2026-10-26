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
      total_waste_mm: 6884,
      total_surplus_pieces: 16,
      waste_percentage: 0.353,
      any_over_threshold: false,
    });
    const [a, b] = res.purchase_plan;
    expect(a).toMatchObject({
      material: 'A',
      feasible: true,
      best_stock_length: 6000,
      length_source: 'fixed',
      total_bars: 325,
      waste_percentage: 0.353,
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
      [1, [7, 7], 192, 22],
      [2, [2, 14], 133, 20],
    ]);
    expect(a.cutting_patterns[0].pieces_breakdown).toEqual([
      { size: 497, count: 7 },
      { size: 355, count: 7 },
    ]);
    expect(a.length_comparison).toEqual([{ length: 6000, bars: 325, waste_pct: 0.353 }]);
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
});
