import { DEFAULT_TIMELINE_PARAMS } from '../../common/utils/timeline-suggest.util';
import { evaluateDailyOutput, fmtCont, unitsToCont, type OutputLine } from './daily-output.rules';
import type { StageRange } from './production-capacity.ranges';
import type { CapacityStage } from './production-capacity.types';

const range = (over: Partial<StageRange> = {}): StageRange => ({
  itemId: '1',
  piId: '7',
  displayCode: 'MY-313',
  skuCode: 'SKU-1',
  stage: 'HAN',
  stageLabel: 'Hàn',
  groupKind: 'WORKSHOP',
  groupCode: 'PHU_AN',
  groupName: 'Xưởng Phú An',
  mode: 'CONT_PER_DAY',
  from: '2026-11-01',
  to: '2026-11-05',
  days: 5,
  cont: 5,
  contPerDay: 1,
  ...over,
});

const line = (r: StageRange, doneByDay: Record<string, number>, estimated = false): OutputLine => ({
  range: r,
  doneByDay,
  estimated,
});

const P = DEFAULT_TIMELINE_PARAMS;

describe('daily-output.rules', () => {
  it('fmtCont: số kiểu VN, tối đa 2 số lẻ', () => {
    expect(fmtCont(0.6)).toBe('0,6');
    expect(fmtCont(1)).toBe('1');
    expect(fmtCont(0.12345)).toBe('0,12');
  });

  it('unitsToCont: tỷ lệ × cont; tổng cần 0 -> 0', () => {
    expect(unitsToCont(30, 100, 2)).toBeCloseTo(0.6);
    expect(unitsToCont(30, 0, 2)).toBe(0);
  });

  describe('CONT_PER_DAY (Phú An)', () => {
    it('làm 0,6 cont, còn lại ≥ 1 -> báo (ngưỡng 1)', () => {
      const out = evaluateDailyOutput('2026-11-03', [line(range(), { '2026-11-03': 0.6 })], P);
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        stage: 'HAN',
        mode: 'CONT_PER_DAY',
        doneCont: 0.6,
        thresholdCont: 1,
        estimated: false,
        itemIds: ['1'],
        message: 'Hàn · Xưởng Phú An 03/11: làm 0,6/1 cont - MY-313',
      });
    });

    it('làm đủ 1 cont -> không báo', () => {
      expect(evaluateDailyOutput('2026-11-03', [line(range(), { '2026-11-03': 1 })], P)).toEqual(
        [],
      );
    });

    it('ngày cuối còn 0,2 cont, làm đủ 0,2 -> không báo; làm 0,1 -> báo ngưỡng 0,2', () => {
      const r = range({ cont: 4.2, to: '2026-11-05' });
      const before = { '2026-11-01': 1, '2026-11-02': 1, '2026-11-03': 1, '2026-11-04': 1 };
      expect(
        evaluateDailyOutput('2026-11-05', [line(r, { ...before, '2026-11-05': 0.2 })], P),
      ).toEqual([]);
      const out = evaluateDailyOutput('2026-11-05', [line(r, { ...before, '2026-11-05': 0.1 })], P);
      expect(out).toHaveLength(1);
      expect(out[0].thresholdCont).toBeCloseTo(0.2);
      expect(out[0].message).toContain('làm 0,1/0,2 cont');
    });

    it('công đoạn đã xong trước ngày D -> không báo', () => {
      const r = range({ cont: 2 });
      expect(
        evaluateDailyOutput('2026-11-04', [line(r, { '2026-11-01': 1, '2026-11-02': 1 })], P),
      ).toEqual([]);
    });

    it('gom nhiều lệnh cùng xưởng × công đoạn: tổng làm được tính chung', () => {
      const a = line(range({ itemId: '1', displayCode: 'MY-313' }), { '2026-11-03': 0.6 });
      const b = line(range({ itemId: '2', displayCode: 'GP-176' }), { '2026-11-03': 0.5 });
      expect(evaluateDailyOutput('2026-11-03', [a, b], P)).toEqual([]); // 1,1 ≥ 1
      const c = line(range({ itemId: '2', displayCode: 'GP-176' }), { '2026-11-03': 0.2 });
      const out = evaluateDailyOutput('2026-11-03', [a, c], P);
      expect(out).toHaveLength(1);
      expect(out[0].itemIds).toEqual(['1', '2']);
      expect(out[0].message).toBe('Hàn · Xưởng Phú An 03/11: làm 0,8/1 cont - MY-313, GP-176');
    });

    it('lệnh đã xong không vào danh sách mã trong câu cảnh báo', () => {
      const done = line(range({ itemId: '2', displayCode: 'GP-176', cont: 1 }), {
        '2026-11-01': 1,
      });
      const open = line(range({ itemId: '1' }), { '2026-11-03': 0.3 });
      const out = evaluateDailyOutput('2026-11-03', [done, open], P);
      expect(out[0].itemIds).toEqual(['1']);
      expect(out[0].displayCodes).toEqual(['MY-313']);
    });

    it('khoảng không phủ ngày D -> bỏ qua', () => {
      expect(evaluateDailyOutput('2026-11-09', [line(range(), {})], P)).toEqual([]);
    });

    it('Phôi ước tính: câu có ghi chú "ước tính theo đoạn cắt"', () => {
      const r = range({ stage: 'PHOI', stageLabel: 'Phôi' });
      const out = evaluateDailyOutput('2026-11-03', [line(r, { '2026-11-03': 0.6 }, true)], P);
      expect(out[0].estimated).toBe(true);
      expect(out[0].message).toBe(
        'Phôi · Xưởng Phú An 03/11: làm 0,6/1 cont (ước tính theo đoạn cắt) - MY-313',
      );
    });

    it('nhóm kho đóng gói tách riêng theo kho và công đoạn', () => {
      const wh = (stage: CapacityStage, code: string) =>
        line(
          range({
            stage,
            groupKind: 'WAREHOUSE',
            groupCode: code,
            groupName: `Kho ${code}`,
            stageLabel: 'x',
          }),
          {},
        );
      const out = evaluateDailyOutput(
        '2026-11-03',
        [wh('DONG_GOI', 'A'), wh('DONG_GOI', 'B'), wh('CHUYEN_KIEM', 'A')],
        P,
      );
      expect(out).toHaveLength(3);
    });
  });

  describe('DAYS_PER_CONT (Phước An, khối 4 ngày)', () => {
    const pa = (over: Partial<StageRange> = {}) =>
      range({
        groupCode: 'PHUOC_AN',
        groupName: 'Xưởng Phước An',
        mode: 'DAYS_PER_CONT',
        from: '2026-11-03',
        to: '2026-11-10',
        days: 8,
        cont: 2,
        ...over,
      });

    it('chỉ kiểm vào ngày cuối khối; luỹ kế 0,5 < 1 -> báo', () => {
      const l = line(pa(), { '2026-11-03': 0.2, '2026-11-05': 0.3 });
      expect(evaluateDailyOutput('2026-11-05', [l], P)).toEqual([]); // ngày thứ 3 của khối
      const out = evaluateDailyOutput('2026-11-06', [l], P);
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        mode: 'DAYS_PER_CONT',
        doneCont: 0.5,
        thresholdCont: 1,
        message: 'Hàn · Xưởng Phước An tới 06/11: luỹ kế 0,5/1 cont sau 4 ngày - MY-313',
      });
    });

    it('khối 2 (ngày thứ 8): ngưỡng = min(2 khối, cont)', () => {
      const l = line(pa({ cont: 1.5 }), { '2026-11-03': 1 });
      const out = evaluateDailyOutput('2026-11-10', [l], P);
      expect(out[0]).toMatchObject({ thresholdCont: 1.5, doneCont: 1 });
    });

    it('luỹ kế đủ -> không báo', () => {
      const l = line(pa(), { '2026-11-03': 1 });
      expect(evaluateDailyOutput('2026-11-06', [l], P)).toEqual([]);
    });

    it('Phôi Phước An ước tính', () => {
      const l = line(pa({ stage: 'PHOI', stageLabel: 'Phôi' }), { '2026-11-04': 0.5 }, true);
      const out = evaluateDailyOutput('2026-11-06', [l], P);
      expect(out[0].message).toBe(
        'Phôi · Xưởng Phước An tới 06/11: luỹ kế 0,5/1 cont sau 4 ngày (ước tính theo đoạn cắt) - MY-313',
      );
    });

    it('tham số daysPerContPhuocAn đổi khối (3 ngày)', () => {
      const l = line(pa(), {});
      expect(evaluateDailyOutput('2026-11-05', [l], { ...P, daysPerContPhuocAn: 3 })).toHaveLength(
        1,
      );
      expect(evaluateDailyOutput('2026-11-06', [l], { ...P, daysPerContPhuocAn: 3 })).toEqual([]);
    });
  });
});
