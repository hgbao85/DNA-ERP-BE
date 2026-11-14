import { classifyPatternMachines } from './pattern-machine-class.util';

const sumBars = (groups: { bars: number }[]) => groups.reduce((n, g) => n + g.bars, 0);

describe('classifyPatternMachines', () => {
  it('không có đoạn dập: mọi kiểu là 1 nhóm TU_DONG đủ số cây', () => {
    const r = classifyPatternMachines({
      patterns: [{ key: 'a', barCount: 7, segments: [{ cutLengthMm: 425, countPerBar: 3 }] }],
      punchedDemand: [],
    });
    expect(r.get('a')).toEqual([{ bars: 7, machineClass: 'TU_DONG', punchedSegments: [] }]);
  });

  it('số đoạn dập lẻ: cây đầy đoạn dập + cây còn lại là LASER, phần còn lại tự động', () => {
    // 15 cây, mỗi cây 2 đoạn 425; cần dập 3 đoạn -> cây 1 mang 2 đoạn, cây 2 mang 1 đoạn (đều
    // LASER).
    const r = classifyPatternMachines({
      patterns: [{ key: 'a', barCount: 15, segments: [{ cutLengthMm: 425, countPerBar: 2 }] }],
      punchedDemand: [{ cutLengthMm: 425, count: 3 }],
    });
    const g = r.get('a')!;
    expect(g.map((x) => [x.machineClass, x.bars])).toEqual([
      ['LASER', 1],
      ['LASER', 1],
      ['TU_DONG', 13],
    ]);
    expect(g[0].punchedSegments).toEqual([{ cutLengthMm: 425, countPerBar: 2 }]);
    expect(g[1].punchedSegments).toEqual([{ cutLengthMm: 425, countPerBar: 1 }]);
    expect(sumBars(g)).toBe(15);
  });

  it('1 đoạn dập (1 lỗ) giờ là LASER, không còn ưu tiên laze', () => {
    const g = classifyPatternMachines({
      patterns: [{ key: 'a', barCount: 4, segments: [{ cutLengthMm: 600, countPerBar: 1 }] }],
      punchedDemand: [{ cutLengthMm: 600, count: 1 }],
    }).get('a')!;
    expect(g).toEqual([
      { bars: 1, machineClass: 'LASER', punchedSegments: [{ cutLengthMm: 600, countPerBar: 1 }] },
      { bars: 3, machineClass: 'TU_DONG', punchedSegments: [] },
    ]);
  });

  it('cây cùng chữ ký đoạn dập gộp thành 1 nhóm', () => {
    const g = classifyPatternMachines({
      patterns: [{ key: 'a', barCount: 5, segments: [{ cutLengthMm: 600, countPerBar: 1 }] }],
      punchedDemand: [{ cutLengthMm: 600, count: 3 }],
    }).get('a')!;
    expect(g.map((x) => [x.machineClass, x.bars])).toEqual([
      ['LASER', 3],
      ['TU_DONG', 2],
    ]);
  });

  it('dập ở 2 chiều dài khác nhau dồn vào cùng cây', () => {
    const g = classifyPatternMachines({
      patterns: [
        {
          key: 'a',
          barCount: 5,
          segments: [
            { cutLengthMm: 800, countPerBar: 1 },
            { cutLengthMm: 500, countPerBar: 2 },
          ],
        },
      ],
      punchedDemand: [
        { cutLengthMm: 800, count: 1 },
        { cutLengthMm: 500, count: 1 },
      ],
    }).get('a')!;
    expect(g[0].machineClass).toBe('LASER');
    expect(g[0].bars).toBe(1);
    expect(g[0].punchedSegments.map((s) => s.cutLengthMm)).toEqual([800, 500]);
    expect(sumBars(g)).toBe(5);
  });

  it('cầu dập lớn hơn số đoạn cắt ra: cắt bớt, không lỗi, tổng cây vẫn khớp', () => {
    const g = classifyPatternMachines({
      patterns: [{ key: 'a', barCount: 2, segments: [{ cutLengthMm: 425, countPerBar: 1 }] }],
      punchedDemand: [{ cutLengthMm: 425, count: 50 }],
    }).get('a')!;
    expect(g.map((x) => [x.machineClass, x.bars])).toEqual([['LASER', 2]]);
  });

  it('nhiều kiểu: kiểu hút nhiều đoạn dập hơn được chọn trước (ít cây laze nhất)', () => {
    const r = classifyPatternMachines({
      patterns: [
        { key: 'a', barCount: 3, segments: [{ cutLengthMm: 425, countPerBar: 1 }] },
        { key: 'b', barCount: 3, segments: [{ cutLengthMm: 425, countPerBar: 3 }] },
      ],
      punchedDemand: [{ cutLengthMm: 425, count: 3 }],
    });
    // Kiểu b hút 3 đoạn trong 1 cây -> chỉ 1 cây laze, kiểu a không phải laze.
    expect(r.get('b')!.map((x) => [x.machineClass, x.bars])).toEqual([
      ['LASER', 1],
      ['TU_DONG', 2],
    ]);
    expect(r.get('a')!.map((x) => [x.machineClass, x.bars])).toEqual([['TU_DONG', 3]]);
  });
});
