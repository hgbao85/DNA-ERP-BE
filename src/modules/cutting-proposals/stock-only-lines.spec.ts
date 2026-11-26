import { emptySolverResponse, withStockOnlyLines } from './cutting-proposals.service';

/** Review IT 26/11 mục 3.5: loại sắt / cả lệnh được đoạn dư trong kho phủ hết vẫn có dòng "chỉ dùng kho". */
describe('withStockOnlyLines', () => {
  const lookup = new Map<string, bigint>([
    ['33:600', 531n],
    ['33:400', 534n],
    ['34:450', 532n],
  ]);
  const use = (spec: string, qty: number) => ({
    warehouse_id: '6',
    segment_spec_id: spec,
    segment_steps: '',
    qty,
  });

  it('cả lệnh phủ hết: kết quả rỗng + mỗi loại sắt 1 dòng 0 cây, pieces là các cỡ lấy từ kho', () => {
    const r = withStockOnlyLines(
      emptySolverResponse(),
      [use('531', 2), use('534', 4), use('532', 2)],
      lookup,
      { machine: 'laser', thresholdPct: 1 },
    );
    expect(r.summary.total_bars_all).toBe(0);
    expect(r.purchase_plan).toHaveLength(2);
    const m33 = r.purchase_plan.find((p) => p.material === '33')!;
    expect(m33).toMatchObject({ feasible: true, total_bars: 0, cutting_patterns: [] });
    expect(m33.pieces?.map((p) => p.size).sort()).toEqual([400, 600]);
    expect(m33.best_stock_length).toBeUndefined();
  });

  it('loại sắt đã có dòng từ bộ giải thì không thêm; loại phủ hết thì thêm', () => {
    const solved = {
      ...emptySolverResponse(),
      purchase_plan: [{ material: '33', feasible: true, total_bars: 3 }],
    };
    const r = withStockOnlyLines(solved, [use('534', 4), use('532', 2)], lookup, {
      machine: 'tu_dong',
      thresholdPct: 1,
    });
    expect(r.purchase_plan.map((p) => p.material)).toEqual(['33', '34']);
    expect(r.purchase_plan[1]).toMatchObject({ total_bars: 0, machine: 'tu_dong' });
  });

  it('không lấy gì từ kho thì giữ nguyên kết quả', () => {
    const solved = emptySolverResponse();
    expect(withStockOnlyLines(solved, [], lookup, { machine: 'laser', thresholdPct: 1 })).toBe(
      solved,
    );
  });
});
