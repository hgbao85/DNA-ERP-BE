import {
  chooseMachineCounts,
  comparePriority,
  CUT_MACHINE_LOW_WORK_BARS,
  cutMachineStatus,
  estimateMachineProgress,
  remainingLoadByMachine,
  reportedSegmentKey,
  planAllocation,
  sortMachineRows,
  waterFill,
  WARN_NO_AUTO,
  WARN_NO_LASER,
  type AllocUnit,
  type AllocMachine,
  type LoadRow,
  type MachineProgressLine,
  type PlanRow,
} from './cut-allocation.util';

const unit = (over: Partial<AllocUnit> & Pick<AllocUnit, 'key' | 'bars'>): AllocUnit => ({
  materialId: '1',
  patternIndex: 0,
  machineClass: 'TU_DONG',
  hasBend: false,
  splittable: true,
  ...over,
});

const auto = (n: number): AllocMachine[] =>
  Array.from({ length: n }, (_, i) => ({ id: `a${i + 1}`, type: 'tu_dong' as const }));
const laser = (n: number): AllocMachine[] =>
  Array.from({ length: n }, (_, i) => ({ id: `l${i + 1}`, type: 'laser' as const }));

const barsOn = (rows: PlanRow[], machineId: string) =>
  rows.filter((r) => r.machineId === machineId).reduce((s, r) => s + r.bars, 0);

describe('comparePriority', () => {
  const base = { phoiStart: null, bookingDue: null, deadline: null };

  it('N1 sớm làm trước, thiếu ngày xếp cuối', () => {
    const a = { ...base, phoiStart: '2026-11-10', id: '9' };
    const b = { ...base, phoiStart: '2026-11-12', id: '1' };
    const none = { ...base, id: '0' };
    expect(comparePriority(a, b)).toBeLessThan(0);
    expect(comparePriority(none, b)).toBeGreaterThan(0);
  });

  it('cùng N1: booking gần làm trước, rồi hạn PI, rồi id (so như số)', () => {
    const n1 = { phoiStart: '2026-11-10' };
    expect(
      comparePriority(
        { ...base, ...n1, bookingDue: '2026-11-20', id: '2' },
        { ...base, ...n1, bookingDue: '2026-11-25', id: '1' },
      ),
    ).toBeLessThan(0);
    expect(
      comparePriority(
        { ...base, ...n1, deadline: '2026-12-01', id: '2' },
        { ...base, ...n1, deadline: '2026-11-30', id: '1' },
      ),
    ).toBeGreaterThan(0);
    expect(comparePriority({ ...base, id: '9' }, { ...base, id: '10' })).toBeLessThan(0);
  });
});

describe('waterFill', () => {
  it('chia đều, phần dư cho máy đứng trước', () => {
    expect(waterFill([0, 0], 3)).toEqual([2, 1]);
    expect(waterFill([0, 0, 0], 10)).toEqual([4, 3, 3]);
  });

  it('đổ vào máy nhẹ tải trước để các máy xong cùng lúc', () => {
    expect(waterFill([10, 0, 0], 20)).toEqual([0, 10, 10]);
    expect(waterFill([5, 0], 2)).toEqual([0, 2]);
    expect(waterFill([5, 0], 7)).toEqual([1, 6]);
  });

  it('không có cây hoặc không có máy', () => {
    expect(waterFill([3, 4], 0)).toEqual([0, 0]);
    expect(waterFill([], 5)).toEqual([]);
  });

  it('luôn đủ tổng, không âm, và max(tải + x) nhỏ nhất (so với vét cạn)', () => {
    const brute = (loads: number[], total: number): number => {
      let best = Infinity;
      const go = (i: number, left: number, cur: number) => {
        if (i === loads.length - 1) {
          best = Math.min(best, Math.max(cur, loads[i] + left));
          return;
        }
        for (let x = 0; x <= left; x++) go(i + 1, left - x, Math.max(cur, loads[i] + x));
      };
      go(0, total, 0);
      return best;
    };
    for (const loads of [
      [0, 0, 0],
      [3, 0, 7],
      [2, 2],
      [9, 1, 4, 0],
    ]) {
      for (let total = 0; total <= 12; total++) {
        const x = waterFill(loads, total);
        expect(x.reduce((s, v) => s + v, 0)).toBe(total);
        expect(x.every((v) => v >= 0 && Number.isInteger(v))).toBe(true);
        expect(Math.max(...x.map((v, i) => v + loads[i]))).toBe(brute(loads, total));
      }
    }
  });
});

describe('chooseMachineCounts', () => {
  const d = (materialId: string, bars: number, cap = bars) => ({ materialId, bars, cap });

  it("ít quy cách hơn số máy: máy dư giao theo bars/k lớn nhất (D'Hondt)", () => {
    const k = chooseMachineCounts([d('1', 100), d('2', 10)], 4);
    expect(k.get('1')).toBe(3);
    expect(k.get('2')).toBe(1);
  });

  it('không giao quá cap của quy cách, máy dư chuyển cho quy cách khác', () => {
    const k = chooseMachineCounts([d('1', 100, 2), d('2', 10)], 4);
    expect(k.get('1')).toBe(2);
    expect(k.get('2')).toBe(2);
  });

  it('hoà bars/k: quy cách nhiều cây hơn, rồi materialId nhỏ hơn', () => {
    const k = chooseMachineCounts([d('B', 20), d('A', 40)], 4);
    // S=2, M=4, dư 2 máy: A (40/1) -> A=2; rồi A 40/2 = 20 hoà B 20/1 -> chọn quy cách nhiều cây
    // hơn (A) -> A=3
    expect(k.get('A')).toBe(3);
    expect(k.get('B')).toBe(1);
    const tie = chooseMachineCounts([d('2', 10), d('1', 10)], 3);
    expect(tie.get('1')).toBe(2);
    expect(tie.get('2')).toBe(1);
  });

  it('nhiều quy cách (S >= M): r = floor(lớn nhất / lớn nhì) quyết định 1/2/3 máy', () => {
    expect(chooseMachineCounts([d('1', 59), d('2', 30), d('3', 5), d('4', 5)], 4).get('1')).toBe(1);
    expect(chooseMachineCounts([d('1', 60), d('2', 30), d('3', 5), d('4', 5)], 4).get('1')).toBe(2);
    expect(chooseMachineCounts([d('1', 90), d('2', 30), d('3', 5), d('4', 5)], 4).get('1')).toBe(3);
    expect(chooseMachineCounts([d('1', 900), d('2', 30), d('3', 5), d('4', 5)], 4).get('1')).toBe(
      3,
    );
  });

  it('k bị chặn bởi số máy và cap; các quy cách còn lại 1 máy', () => {
    const byMachines = chooseMachineCounts([d('1', 90), d('2', 30)], 2);
    expect(byMachines.get('1')).toBe(2);
    expect(byMachines.get('2')).toBe(1);
    const byCap = chooseMachineCounts([d('1', 90, 1), d('2', 30), d('3', 5)], 3);
    expect(byCap.get('1')).toBe(1);
  });

  it('1 quy cách, 1 máy / không có máy', () => {
    expect(chooseMachineCounts([d('1', 5)], 1).get('1')).toBe(1);
    expect(chooseMachineCounts([d('1', 5)], 0).size).toBe(0);
  });
});

describe('planAllocation', () => {
  const run = (
    units: AllocUnit[],
    machines: AllocMachine[],
    opts: { laserAllowed?: boolean; load?: Record<string, number> } = {},
  ) =>
    planAllocation({
      orders: [{ orderId: 'o1', units }],
      machines,
      laserAllowed: opts.laserAllowed ?? true,
      initialLoad: new Map(Object.entries(opts.load ?? {})),
    });

  it('1 quy cách, 2 máy tự động: chia đều số cây', () => {
    const r = run([unit({ key: 'p1:TU_DONG', bars: 11 })], auto(2));
    expect(barsOn(r.rows, 'a1')).toBe(6);
    expect(barsOn(r.rows, 'a2')).toBe(5);
    expect(r.warnings).toEqual([]);
  });

  it('ít quy cách hơn số máy: quy cách lớn được nhiều máy hơn', () => {
    const r = run(
      [
        unit({ key: 'p1:TU_DONG', materialId: '1', bars: 30 }),
        unit({ key: 'p2:TU_DONG', materialId: '2', bars: 10 }),
      ],
      auto(4),
    );
    // S=2 < M=4: quy cách 1 được 3 máy, quy cách 2 được 1 máy.
    const m2 = r.rows.filter((x) => x.unitKey === 'p2:TU_DONG');
    expect(m2).toHaveLength(1);
    expect(
      new Set(r.rows.filter((x) => x.unitKey === 'p1:TU_DONG').map((x) => x.machineId)).size,
    ).toBe(3);
    expect(r.rows.reduce((s, x) => s + x.bars, 0)).toBe(40);
    // quy cách 2 không chung máy với quy cách 1
    const used1 = r.rows.filter((x) => x.unitKey === 'p1:TU_DONG').map((x) => x.machineId);
    expect(used1).not.toContain(m2[0].machineId);
  });

  it('nhiều quy cách (S >= M): mỗi quy cách nhỏ 1 máy, tải dồn máy nhẹ nhất', () => {
    const r = run(
      [
        unit({ key: 'p1:TU_DONG', materialId: '1', bars: 50 }),
        unit({ key: 'p2:TU_DONG', materialId: '2', bars: 30 }),
        unit({ key: 'p3:TU_DONG', materialId: '3', bars: 20 }),
      ],
      auto(2),
    );
    // r = floor(50/30) = 1 -> mỗi quy cách 1 máy: 50 -> a1, 30 -> a2, 20 -> a2 (a2 nhẹ hơn: 30 <
    // 50)
    expect(barsOn(r.rows, 'a1')).toBe(50);
    expect(barsOn(r.rows, 'a2')).toBe(50);
  });

  it('tải ban đầu (dòng đang giữ) quyết định máy được chọn', () => {
    const r = run([unit({ key: 'p1:TU_DONG', bars: 6 })], auto(3), {
      load: { a1: 100, a2: 0, a3: 50 },
    });
    // S=1 < M=3 -> k=3 (cap 6), waterFill [100,0,50] total 6 -> toàn bộ vào a2 (0 -> 6)
    expect(barsOn(r.rows, 'a2')).toBe(6);
  });

  it('đơn vị không tách được (kiểu cắt theo bó) vào nguyên 1 máy', () => {
    const r = run(
      [
        unit({ key: 'p1:TU_DONG', bars: 14, splittable: false }),
        unit({ key: 'p2:TU_DONG', bars: 14, splittable: false, patternIndex: 1 }),
      ],
      auto(2),
    );
    const byUnit = (k: string) => r.rows.filter((x) => x.unitKey === k);
    expect(byUnit('p1:TU_DONG')).toHaveLength(1);
    expect(byUnit('p2:TU_DONG')).toHaveLength(1);
    expect(byUnit('p1:TU_DONG')[0].machineId).not.toBe(byUnit('p2:TU_DONG')[0].machineId);
  });

  it('đơn vị có uốn được đổ trước (vào máy đứng trước)', () => {
    const r = run(
      [
        unit({ key: 'p1:TU_DONG', bars: 5, patternIndex: 0 }),
        unit({ key: 'p2:TU_DONG', bars: 5, patternIndex: 1, hasBend: true }),
      ],
      auto(2),
    );
    // 10 cây / 2 máy = 5 + 5: kiểu có uốn (p2) đổ trước nên nằm trọn trên máy đầu (a1).
    expect(r.rows.find((x) => x.unitKey === 'p2:TU_DONG')).toMatchObject({
      machineId: 'a1',
      bars: 5,
    });
    expect(r.rows.find((x) => x.unitKey === 'p1:TU_DONG')).toMatchObject({
      machineId: 'a2',
      bars: 5,
    });
  });

  it('cây có đoạn dập (LASER) vào máy laze; cây không dập vào máy tự động', () => {
    const r = run(
      [
        unit({ key: 'p1:LASER', machineClass: 'LASER', bars: 4 }),
        unit({ key: 'p1:TU_DONG', machineClass: 'TU_DONG', bars: 10 }),
      ],
      [...laser(2), ...auto(1)],
    );
    for (const row of r.rows.filter((x) => x.unitKey === 'p1:LASER'))
      expect(row.machineId).toMatch(/^l/);
    for (const row of r.rows.filter((x) => x.unitKey === 'p1:TU_DONG'))
      expect(row.machineId).toBe('a1');
  });

  it('xưởng không có máy laze: cây dập sang máy tự động kèm cảnh báo', () => {
    const r = run([unit({ key: 'p1:LASER', machineClass: 'LASER', bars: 4 })], auto(2));
    expect(r.rows.every((x) => x.machineId.startsWith('a'))).toBe(true);
    expect(r.warnings).toEqual([WARN_NO_LASER]);
  });

  it('xưởng không có MC tự động: cây không dập sang máy laze kèm cảnh báo', () => {
    const r = run([unit({ key: 'p1:TU_DONG', bars: 4 })], laser(2));
    expect(r.rows.every((x) => x.machineId.startsWith('l'))).toBe(true);
    expect(r.warnings).toEqual([WARN_NO_AUTO]);
  });

  it('xưởng khoá máy tự động (laserAllowed = false): mọi cây vào máy tự động, không cảnh báo', () => {
    const r = run(
      [unit({ key: 'p1:LASER', machineClass: 'LASER', bars: 4 })],
      [...laser(1), ...auto(2)],
      { laserAllowed: false },
    );
    expect(r.rows.every((x) => x.machineId.startsWith('a'))).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('lệnh sau thấy tải do lệnh trước để lại; tổng cây luôn đủ; không có dòng 0 cây', () => {
    const r = planAllocation({
      orders: [
        { orderId: 'o1', units: [unit({ key: 'p1:TU_DONG', materialId: '1', bars: 9 })] },
        { orderId: 'o2', units: [unit({ key: 'p2:TU_DONG', materialId: '1', bars: 1 })] },
      ],
      machines: auto(3),
      laserAllowed: true,
      initialLoad: new Map(),
    });
    expect(r.rows.reduce((s, x) => s + x.bars, 0)).toBe(10);
    expect(r.rows.every((x) => x.bars > 0)).toBe(true);
    // lệnh 1: 3/3/3, lệnh 2: 1 cây vào máy đầu (hoà tải -> thứ tự máy)
    expect(r.rows.find((x) => x.unitKey === 'p2:TU_DONG')).toMatchObject({
      machineId: 'a1',
      bars: 1,
    });
  });

  it('bỏ qua đơn vị 0 cây và xưởng không có máy', () => {
    expect(run([unit({ key: 'p1:TU_DONG', bars: 0 })], auto(2)).rows).toEqual([]);
    expect(run([unit({ key: 'p1:TU_DONG', bars: 5 })], []).rows).toEqual([]);
  });

  it('gộp dòng trùng (cùng máy + cùng đơn vị)', () => {
    const r = run([unit({ key: 'p1:TU_DONG', bars: 7 })], auto(1));
    expect(r.rows).toEqual([{ unitKey: 'p1:TU_DONG', machineId: 'a1', bars: 7 }]);
  });
});

describe('sortMachineRows', () => {
  const row = (over: Partial<Parameters<typeof sortMachineRows>[0][number]> & { id: string }) => ({
    orderRank: 0,
    materialId: '1',
    hasBend: false,
    patternIndex: 0,
    machineClass: 'TU_DONG' as const,
    barCount: 1,
    ...over,
  });

  it('lệnh theo ưu tiên; trong lệnh, loại sắt có uốn trước rồi nhiều cây trước', () => {
    const rows = [
      row({ id: '1', orderRank: 1 }),
      row({ id: '2', materialId: '5', barCount: 50 }),
      row({ id: '3', materialId: '6', barCount: 5, hasBend: true }),
      row({ id: '4', materialId: '7', barCount: 80 }),
    ];
    expect(sortMachineRows(rows).map((r) => r.id)).toEqual(['3', '4', '2', '1']);
  });

  it('trong loại sắt: có uốn trước, patternIndex, lớp máy, id', () => {
    const rows = [
      row({ id: '4', patternIndex: 2 }),
      row({ id: '3', patternIndex: 1, machineClass: 'TU_DONG' }),
      row({ id: '2', patternIndex: 1, machineClass: 'LASER' }),
      row({ id: '9', patternIndex: 5, hasBend: true }),
    ];
    expect(sortMachineRows(rows).map((r) => r.id)).toEqual(['9', '2', '3', '4']);
  });

  it('cùng loại sắt thì không bị xen kẽ loại khác', () => {
    const rows = [
      row({ id: '1', materialId: '5', barCount: 10 }),
      row({ id: '2', materialId: '6', barCount: 12 }),
      row({ id: '3', materialId: '5', barCount: 10, patternIndex: 1 }),
    ];
    expect(sortMachineRows(rows).map((r) => r.id)).toEqual(['1', '3', '2']);
  });
});

describe('estimateMachineProgress', () => {
  const line = (
    id: string,
    seq: number,
    barCount: number,
    segments: Array<[number, number]>,
    pi = '1',
    mat = '7',
  ): MachineProgressLine => ({
    id,
    productionInvoiceId: pi,
    materialId: mat,
    seq,
    barCount,
    segments: segments.map(([cutLengthMm, countPerBar]) => ({ cutLengthMm, countPerBar })),
  });
  const rep = (entries: Array<[string, string, number, number]>) =>
    new Map(entries.map(([pi, mat, len, qty]) => [reportedSegmentKey(pi, mat, len), qty]));

  it('2 dòng cùng lệnh ăn chung pool theo thứ tự seq', () => {
    // dòng A (seq 1): 10 cây × 2 đoạn 425; dòng B (seq 2): 10 cây × 2 đoạn 425; báo 30 đoạn = 15
    // cây
    const r = estimateMachineProgress(
      [line('B', 2, 10, [[425, 2]]), line('A', 1, 10, [[425, 2]])],
      rep([['1', '7', 425, 30]]),
    );
    expect(r.lines).toEqual([
      { id: 'A', barsDone: 10, barsLeft: 0 },
      { id: 'B', barsDone: 5, barsLeft: 5 },
    ]);
    expect(r).toMatchObject({ totalBars: 20, barsDone: 15, barsLeft: 5 });
  });

  it('cắt dở 1 cây: đoạn lẻ không thành cây; cây xong theo cỡ đoạn thiếu nhất', () => {
    const r = estimateMachineProgress(
      [
        line('A', 1, 10, [
          [425, 2],
          [300, 1],
        ]),
      ],
      rep([
        ['1', '7', 425, 7],
        ['1', '7', 300, 9],
      ]),
    );
    // 425: floor(7/2)=3; 300: floor(9/1)=9 -> 3 cây
    expect(r.lines).toEqual([{ id: 'A', barsDone: 3, barsLeft: 7 }]);
  });

  it('báo dư không vượt barCount; phần dư chuyển cho dòng sau', () => {
    const r = estimateMachineProgress(
      [line('A', 1, 3, [[425, 2]]), line('B', 2, 5, [[425, 2]])],
      rep([['1', '7', 425, 100]]),
    );
    expect(r.lines.map((l) => l.barsDone)).toEqual([3, 5]);
    expect(r.barsLeft).toBe(0);
  });

  it('báo của lệnh / loại sắt / cỡ khác không tính', () => {
    const r = estimateMachineProgress(
      [line('A', 1, 10, [[425, 2]])],
      rep([
        ['2', '7', 425, 40],
        ['1', '8', 425, 40],
        ['1', '7', 300, 40],
      ]),
    );
    expect(r.lines).toEqual([{ id: 'A', barsDone: 0, barsLeft: 10 }]);
  });

  it('không có dòng nào', () => {
    expect(estimateMachineProgress([], new Map())).toEqual({
      lines: [],
      totalBars: 0,
      barsDone: 0,
      barsLeft: 0,
    });
  });

  it('khoá cỡ đoạn làm tròn 1 số lẻ', () => {
    expect(reportedSegmentKey(1n, 7n, 425)).toBe('1|7|425.0');
  });
});

describe('cutMachineStatus', () => {
  it('EMPTY / IDLE / LOW / BUSY', () => {
    expect(cutMachineStatus(0, 0)).toBe('EMPTY');
    expect(cutMachineStatus(3, 0)).toBe('IDLE');
    expect(cutMachineStatus(3, 1)).toBe('LOW');
    expect(cutMachineStatus(3, CUT_MACHINE_LOW_WORK_BARS)).toBe('LOW');
    expect(cutMachineStatus(3, CUT_MACHINE_LOW_WORK_BARS + 1)).toBe('BUSY');
  });
});

describe('remainingLoadByMachine', () => {
  const row = (
    id: string,
    machineId: string,
    seq: number,
    barCount: number,
    pi = '1',
  ): LoadRow => ({
    id,
    machineId,
    productionInvoiceId: pi,
    materialId: '7',
    seq,
    barCount,
    segments: [{ cutLengthMm: 425, countPerBar: 2 }],
  });
  const reported = (machineId: string, qty: number, pi = '1') =>
    new Map([[machineId, new Map([[reportedSegmentKey(pi, '7', 425), qty]])]]);

  it('tải = số cây còn lại: máy cắt hết dòng có tải 0, máy còn dòng chưa cắt tải lớn hơn', () => {
    const rows = [row('A', 'm1', 1, 10), row('B', 'm2', 1, 10)];
    // m1 đã báo 20 đoạn = 10 cây; m2 chưa báo gì.
    const load = remainingLoadByMachine(rows, reported('m1', 20));
    expect(load.get('m1')).toBe(0);
    expect(load.get('m2')).toBe(10);
  });

  it('cắt dở: chỉ tính phần còn lại của dòng', () => {
    const load = remainingLoadByMachine([row('A', 'm1', 1, 10)], reported('m1', 8));
    expect(load.get('m1')).toBe(6);
  });

  it('include: ước tiến độ trên mọi dòng nhưng chỉ cộng dòng được tính', () => {
    // Dòng A (seq 1, tự chia) ăn 20 đoạn trước; dòng B (seq 2, sửa tay) chưa cắt gì.
    const rows = [row('A', 'm1', 1, 10), row('B', 'm1', 2, 4)];
    const load = remainingLoadByMachine(rows, reported('m1', 20), (r) => r.id === 'B');
    expect(load.get('m1')).toBe(4);
  });

  it('máy không có dòng -> không có khoá', () => {
    expect(remainingLoadByMachine([], new Map()).size).toBe(0);
  });
});
