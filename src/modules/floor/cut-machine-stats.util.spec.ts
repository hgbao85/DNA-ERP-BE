import {
  barLengthKey,
  computeCutMachineStats,
  gapMinutesExcludingLunch,
  lineBars,
  median,
  ratePerHour,
  type CutMachineStatsInput,
  type StatsMachine,
  type StatsReport,
} from './cut-machine-stats.util';

/** Giờ VN (UTC+7) -> Date. */
const vn = (ymd: string, hm: string) => new Date(`${ymd}T${hm}:00+07:00`);

const LASER: StatsMachine = {
  id: '1',
  code: 'L1',
  name: 'Laze 1',
  machineType: 'laser',
  isActive: true,
};
const AUTO: StatsMachine = {
  id: '2',
  code: 'T1',
  name: 'Tự động 1',
  machineType: 'tu_dong',
  isActive: true,
};

const base = {
  blade: { laser: 1, tu_dong: 2.5 },
  trim: { laser: 10, tu_dong: 10 },
  defaultBarLengthMm: 6000,
  barLengths: new Map<string, number>(),
};

/** 1 lần báo, 1 loại sắt: `qty` đoạn dài `cut` mm - số cây = qty × (cut + lưỡi) / (6000 − tề). */
const rep = (
  machineId: string,
  at: Date,
  qty: number,
  over: Partial<StatsReport> = {},
  materialId = '7',
  cut = 1000,
): StatsReport => ({
  machineId,
  createdAt: at,
  productionInvoiceId: null,
  lines: [{ materialId, label: `Sắt ${materialId}`, cutLengthMm: cut, qty }],
  ...over,
});

const run = (reports: StatsReport[], over: Partial<CutMachineStatsInput> = {}) =>
  computeCutMachineStats({ ...base, machines: [LASER, AUTO], reports, ...over });

describe('cut-machine-stats.util', () => {
  describe('quy đổi ra cây', () => {
    it('lineBars: qty × (cắt + lưỡi) / (chiều dài cây − tề đầu)', () => {
      expect(lineBars({ qty: 10, cutLengthMm: 1000 }, 6000, 1, 10)).toBeCloseTo((10 * 1001) / 5990);
    });

    it('chiều dài cây − tề ≤ 0 thì 0 cây', () => {
      expect(lineBars({ qty: 10, cutLengthMm: 1000 }, 10, 1, 10)).toBe(0);
      expect(lineBars({ qty: 10, cutLengthMm: 1000 }, 5, 1, 10)).toBe(0);
    });

    it('lưỡi/tề theo loại máy: laser 1/10, tự động 2,5/10 (cùng số đoạn cho số cây khác nhau)', () => {
      const at = vn('2026-11-10', '08:00');
      const r = run([rep('1', at, 60), rep('2', at, 60)]);
      const laser = r.days.find((d) => d.machineId === '1')!;
      const auto = r.days.find((d) => d.machineId === '2')!;
      expect(laser.bars).toBe(Math.round(((60 * 1001) / 5990) * 10) / 10); // 10,0
      expect(auto.bars).toBe(Math.round(((60 * 1002.5) / 5990) * 10) / 10); // 10,0
      // lưỡi to hơn thấy rõ khi đoạn ngắn, số đoạn nhiều
      const many = run([rep('1', at, 6000, {}, '7', 100), rep('2', at, 6000, {}, '7', 100)]);
      expect(many.days.find((d) => d.machineId === '2')!.bars).toBeGreaterThan(
        many.days.find((d) => d.machineId === '1')!.bars,
      );
    });

    it('chiều dài cây lấy từ phương án của (PI, loại sắt); không có thì mặc định', () => {
      const at = vn('2026-11-10', '08:00');
      const lengths = new Map([[barLengthKey('100', '7'), 12000]]);
      const withPlan = run([rep('1', at, 100, { productionInvoiceId: '100' })], {
        barLengths: lengths,
      });
      expect(withPlan.days[0].bars).toBe(Math.round(((100 * 1001) / 11990) * 10) / 10); // 8,3
      // khác PI, khác loại sắt, không có PI -> mặc định 6000
      const otherPi = run([rep('1', at, 100, { productionInvoiceId: '101' })], {
        barLengths: lengths,
      });
      const otherMat = run([rep('1', at, 100, { productionInvoiceId: '100' }, '8')], {
        barLengths: lengths,
      });
      const noPi = run([rep('1', at, 100)], { barLengths: lengths });
      const dflt = Math.round(((100 * 1001) / 5990) * 10) / 10; // 16,7
      expect(otherPi.days[0].bars).toBe(dflt);
      expect(otherMat.days[0].bars).toBe(dflt);
      expect(noPi.days[0].bars).toBe(dflt);
      const custom = run([rep('1', at, 100)], { defaultBarLengthMm: 12000 });
      expect(custom.days[0].bars).toBe(Math.round(((100 * 1001) / 11990) * 10) / 10);
    });

    it('nhiều loại sắt trong 1 lần báo: chia cây theo từng loại, segments/meters cộng chung', () => {
      const at = vn('2026-11-10', '08:00');
      const r = run([
        {
          machineId: '1',
          createdAt: at,
          productionInvoiceId: '100',
          lines: [
            { materialId: '7', label: 'Sắt A', cutLengthMm: 1000, qty: 30 },
            { materialId: '8', label: 'Sắt B', cutLengthMm: 500, qty: 20 },
            { materialId: '7', label: 'Sắt A', cutLengthMm: 2000, qty: 10 },
          ],
        },
      ]);
      const d = r.days[0];
      expect(d.segments).toBe(60);
      expect(d.meters).toBe(60); // 30 + 10 + 20
      const a = (30 * 1001 + 10 * 2001) / 5990;
      const b = (20 * 501) / 5990;
      expect(d.materials).toEqual([
        { materialId: '7', label: 'Sắt A', bars: Math.round(a * 10) / 10 },
        { materialId: '8', label: 'Sắt B', bars: Math.round(b * 10) / 10 },
      ]);
      expect(d.bars).toBe(Math.round((a + b) * 10) / 10);
    });
  });

  describe('nghỉ trưa và khoảng cách giữa 2 lần báo', () => {
    it('11:00 -> 13:30 = 150 phút trừ 90 phút nghỉ = 60 phút', () => {
      expect(gapMinutesExcludingLunch(vn('2026-11-10', '11:00'), vn('2026-11-10', '13:30'))).toBe(
        60,
      );
    });

    it('khoảng nằm gọn trước/sau/trong nghỉ trưa', () => {
      expect(gapMinutesExcludingLunch(vn('2026-11-10', '09:00'), vn('2026-11-10', '10:00'))).toBe(
        60,
      );
      expect(gapMinutesExcludingLunch(vn('2026-11-10', '13:00'), vn('2026-11-10', '14:00'))).toBe(
        60,
      );
      expect(gapMinutesExcludingLunch(vn('2026-11-10', '11:40'), vn('2026-11-10', '12:30'))).toBe(
        0,
      );
      expect(gapMinutesExcludingLunch(vn('2026-11-10', '10:30'), vn('2026-11-10', '12:00'))).toBe(
        60,
      );
    });

    it('lần báo đầu ngày không vào rateBars; từ lần 2 mới có, gap tính phút', () => {
      const r = run([
        rep('1', vn('2026-11-10', '08:00'), 60), // đầu ngày
        rep('1', vn('2026-11-10', '09:00'), 60), // gap 60
        rep('1', vn('2026-11-10', '10:30'), 30), // gap 90
      ]);
      const d = r.days[0];
      expect(d.reports).toBe(3);
      expect(d.rateMinutes).toBe(150);
      expect(d.rateBars).toBe(Math.round(((90 * 1001) / 5990) * 10) / 10); // bars lần 2 + 3 = 15,0
      expect(d.bars).toBe(Math.round(((150 * 1001) / 5990) * 10) / 10);
      expect(d.firstAt).toBe(vn('2026-11-10', '08:00').toISOString());
      expect(d.lastAt).toBe(vn('2026-11-10', '10:30').toISOString());
    });

    it('trừ nghỉ trưa khi tính tốc độ (11:00 -> 13:30 chỉ 60 phút)', () => {
      const r = run([
        rep('1', vn('2026-11-10', '11:00'), 60),
        rep('1', vn('2026-11-10', '13:30'), 60),
      ]);
      expect(r.days[0].rateMinutes).toBe(60);
      expect(r.days[0].barsPerHour).toBe(Math.round(((60 * 1001) / 5990) * 10) / 10);
    });

    it('gap > 120 phút không tính (bắt đầu lại sau nghỉ); đúng 120 thì tính', () => {
      const over = run([
        rep('1', vn('2026-11-10', '08:00'), 60),
        rep('1', vn('2026-11-10', '10:01'), 60),
      ]);
      expect(over.days[0].rateMinutes).toBe(0);
      expect(over.days[0].rateBars).toBe(0);
      expect(over.days[0].barsPerHour).toBeNull();
      const edge = run([
        rep('1', vn('2026-11-10', '08:00'), 60),
        rep('1', vn('2026-11-10', '10:00'), 60),
      ]);
      expect(edge.days[0].rateMinutes).toBe(120);
    });

    it('2 lần báo cùng giờ (gap 0) không tính', () => {
      const at = vn('2026-11-10', '09:00');
      const r = run([rep('1', at, 10), rep('1', at, 10)]);
      expect(r.days[0].rateMinutes).toBe(0);
    });

    it('lần báo gửi không theo thứ tự vẫn được xếp theo giờ', () => {
      const r = run([
        rep('1', vn('2026-11-10', '09:00'), 60),
        rep('1', vn('2026-11-10', '08:30'), 10),
      ]);
      expect(r.days[0].rateMinutes).toBe(30);
      expect(r.days[0].rateBars).toBe(Math.round(((60 * 1001) / 5990) * 10) / 10);
    });

    it('ngày VN: 00:30 sáng 11/11 giờ VN (17:30 UTC ngày 10) thuộc ngày 11, không phải ngày 10', () => {
      const r = run([
        rep('1', vn('2026-11-11', '00:30'), 10),
        rep('1', vn('2026-11-10', '23:30'), 10),
      ]);
      expect(r.days.map((d) => d.day)).toEqual(['2026-11-10', '2026-11-11']);
      expect(r.days.every((d) => d.reports === 1)).toBe(true);
    });
  });

  describe('barsPerHour', () => {
    it('rateMinutes < 30 -> null; đủ 30 phút thì có', () => {
      expect(ratePerHour(5, 29.9)).toBeNull();
      expect(ratePerHour(5, 30)).toBe(10);
      const short = run([
        rep('1', vn('2026-11-10', '08:00'), 60),
        rep('1', vn('2026-11-10', '08:20'), 60),
      ]);
      expect(short.days[0].barsPerHour).toBeNull();
      expect(short.byMachine[0].barsPerHour).toBeNull();
    });
  });

  describe('tổng hợp', () => {
    it('trung vị: số lẻ lấy giữa, số chẵn lấy trung bình 2 giá trị giữa', () => {
      expect(median([5, 1, 3])).toBe(3);
      expect(median([4, 1, 3, 2])).toBe(2.5);
      expect(median([])).toBe(0);
    });

    it('byMachine: số ngày có số, tổng, trung bình, trung vị theo ngày; máy không có số thì không có dòng', () => {
      // ngày 1: 6 cây-ish (60 đoạn ~ 10 cây); ngày 2: 30 đoạn; ngày 3: 90 đoạn
      const r = run([
        rep('1', vn('2026-11-10', '08:00'), 60),
        rep('1', vn('2026-11-11', '08:00'), 30),
        rep('1', vn('2026-11-12', '08:00'), 90),
      ]);
      const one = (q: number) => (q * 1001) / 5990;
      expect(r.byMachine).toHaveLength(1);
      expect(r.byMachine[0]).toMatchObject({
        machineId: '1',
        daysWithData: 3,
        totalBars: Math.round((one(60) + one(30) + one(90)) * 10) / 10,
        barsPerDayAvg: Math.round(((one(60) + one(30) + one(90)) / 3) * 10) / 10,
        barsPerDayMedian: Math.round(one(60) * 10) / 10,
        barsPerHour: null,
      });
    });

    it('byMachine: trung vị số chẵn ngày; barsPerHour = Σ rateBars / (Σ phút / 60) trên mọi ngày', () => {
      const r = run([
        rep('1', vn('2026-11-10', '08:00'), 30),
        rep('1', vn('2026-11-10', '08:30'), 60), // gap 30
        rep('1', vn('2026-11-11', '08:00'), 30),
        rep('1', vn('2026-11-11', '09:00'), 60), // gap 60
      ]);
      const one = (q: number) => (q * 1001) / 5990;
      const day1 = one(30) + one(60);
      expect(r.byMachine[0].barsPerDayMedian).toBe(Math.round(day1 * 10) / 10); // 2 ngày bằng nhau
      expect(r.byMachine[0].barsPerHour).toBe(
        Math.round(((one(60) + one(60)) / (90 / 60)) * 10) / 10,
      );
    });

    it('byMachineType: chỉ loại có số, laser rồi tu_dong, đếm máy và (máy, ngày)', () => {
      const L2: StatsMachine = { ...LASER, id: '3', code: 'L2', name: 'Laze 2' };
      const r = run(
        [
          rep('2', vn('2026-11-10', '08:00'), 60),
          rep('1', vn('2026-11-10', '08:00'), 60),
          rep('3', vn('2026-11-10', '08:00'), 60),
          rep('3', vn('2026-11-11', '08:00'), 60),
        ],
        { machines: [LASER, AUTO, L2] },
      );
      expect(r.byMachineType.map((t) => [t.machineType, t.machines, t.machineDays])).toEqual([
        ['laser', 2, 3],
        ['tu_dong', 1, 1],
      ]);
      const onlyAuto = run([rep('2', vn('2026-11-10', '08:00'), 60)]);
      expect(onlyAuto.byMachineType.map((t) => t.machineType)).toEqual(['tu_dong']);
    });

    it('byMaterial: theo (loại máy, loại sắt), cây giảm dần, rateBars/rateMinutes/barsPerHour riêng từng loại', () => {
      const r = run([
        rep('1', vn('2026-11-10', '08:00'), 10, {}, '7'),
        rep('1', vn('2026-11-10', '08:40'), 120, {}, '7'), // gap 40, sắt 7
        rep('1', vn('2026-11-10', '09:20'), 30, {}, '8'), // gap 40, sắt 8
        rep('2', vn('2026-11-10', '08:00'), 10, {}, '9'),
      ]);
      expect(r.byMaterial.map((m) => [m.machineType, m.materialId])).toEqual([
        ['laser', '7'],
        ['laser', '8'],
        ['tu_dong', '9'],
      ]);
      const m7 = r.byMaterial[0];
      expect(m7.bars).toBe(Math.round(((130 * 1001) / 5990) * 10) / 10);
      expect(m7.rateBars).toBe(Math.round(((120 * 1001) / 5990) * 10) / 10);
      expect(m7.rateMinutes).toBe(40);
      expect(m7.barsPerHour).toBe(Math.round(((120 * 1001) / 5990 / (40 / 60)) * 10) / 10);
      const m9 = r.byMaterial[2];
      expect(m9.rateMinutes).toBe(0);
      expect(m9.barsPerHour).toBeNull();
    });

    it('gap của lần báo nhiều loại sắt được chia theo tỷ lệ cây (tổng phút các loại = gap)', () => {
      const r = run([
        rep('1', vn('2026-11-10', '08:00'), 10),
        {
          machineId: '1',
          createdAt: vn('2026-11-10', '09:00'),
          productionInvoiceId: null,
          lines: [
            { materialId: '7', label: 'A', cutLengthMm: 1000, qty: 30 },
            { materialId: '8', label: 'B', cutLengthMm: 1000, qty: 10 },
          ],
        },
      ]);
      const sum = r.byMaterial.reduce((s, m) => s + m.rateMinutes, 0);
      expect(Math.abs(sum - 60)).toBeLessThanOrEqual(1); // chỉ lệch do làm tròn từng dòng
      expect(r.byMaterial.find((m) => m.materialId === '7')!.rateMinutes).toBe(45);
      expect(r.byMaterial.find((m) => m.materialId === '8')!.rateMinutes).toBe(15);
    });

    it('days: ngày tăng dần rồi code máy; materials cây giảm dần', () => {
      const r = run([
        rep('2', vn('2026-11-11', '08:00'), 10),
        rep('2', vn('2026-11-10', '08:00'), 10),
        rep('1', vn('2026-11-10', '08:00'), 10),
        rep('1', vn('2026-11-11', '08:00'), 10),
      ]);
      expect(r.days.map((d) => `${d.day}/${d.machineId}`)).toEqual([
        '2026-11-10/1',
        '2026-11-10/2',
        '2026-11-11/1',
        '2026-11-11/2',
      ]);
    });

    it('làm tròn chỉ ở đầu ra: cộng dồn số chưa làm tròn', () => {
      // mỗi lần 1 đoạn: 1001/5990 = 0,1671 cây; 3 lần = 0,5014 -> 0,5 (cộng số đã làm tròn 0,2×3 = 0,6 sẽ sai)
      const r = run([
        rep('1', vn('2026-11-10', '08:00'), 1),
        rep('1', vn('2026-11-10', '08:10'), 1),
        rep('1', vn('2026-11-10', '08:20'), 1),
      ]);
      expect(r.days[0].bars).toBe(0.5);
      expect(r.days[0].meters).toBe(3); // 3 đoạn × 1 m
    });

    it('làm tròn: meters/bars 0,1; rateMinutes nguyên; barsPerHour 0,1', () => {
      const r = run([
        rep('1', vn('2026-11-10', '08:00'), 7, {}, '7', 333),
        rep('1', vn('2026-11-10', '08:45'), 7, {}, '7', 333),
      ]);
      const d = r.days[0];
      expect(d.meters).toBe(4.7); // 14 × 0,333 = 4,662
      expect(Number.isInteger(d.rateMinutes)).toBe(true);
      expect(d.rateMinutes).toBe(45);
      expect(d.barsPerHour).toBe(Math.round(((7 * 334) / 5990 / (45 / 60)) * 10) / 10);
    });

    it('bỏ lần báo của máy không thuộc danh sách và lần báo không có dòng nào', () => {
      const r = run([
        rep('99', vn('2026-11-10', '08:00'), 10),
        {
          machineId: '1',
          createdAt: vn('2026-11-10', '08:00'),
          productionInvoiceId: null,
          lines: [],
        },
      ]);
      expect(r.days).toEqual([]);
      expect(r.byMachine).toEqual([]);
      expect(r.byMachineType).toEqual([]);
      expect(r.byMaterial).toEqual([]);
    });
  });
});
