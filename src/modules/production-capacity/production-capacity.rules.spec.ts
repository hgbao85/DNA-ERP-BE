import { DEFAULT_TIMELINE_PARAMS } from '../../common/utils/timeline-suggest.util';
import type { StageRange } from './production-capacity.ranges';
import { aggregateCapacity, formatVnNumber } from './production-capacity.rules';

const range = (extra: Partial<StageRange>): StageRange => ({
  itemId: '1',
  piId: '10',
  displayCode: 'MY-313',
  skuCode: 'SKU-1',
  stage: 'PHOI',
  stageLabel: 'Phôi',
  groupKind: 'WORKSHOP',
  groupCode: 'PHU_AN',
  groupName: 'Xưởng Phú An',
  mode: 'CONT_PER_DAY',
  from: '2026-11-12',
  to: '2026-11-12',
  days: 1,
  cont: 1,
  contPerDay: 1,
  ...extra,
});

describe('formatVnNumber', () => {
  it('dùng dấu phẩy, tối đa 2 số lẻ', () => {
    expect(formatVnNumber(1.8)).toBe('1,8');
    expect(formatVnNumber(2)).toBe('2');
    expect(formatVnNumber(1.333)).toBe('1,33');
  });
});

describe('aggregateCapacity', () => {
  it('2 lệnh Phú An cùng ngày 1 + 0,8 cont -> over + cảnh báo', () => {
    const { rows, warnings } = aggregateCapacity(
      [
        range({ itemId: '1', displayCode: 'MY-313' }),
        range({ itemId: '2', displayCode: 'GP-176', cont: 0.8, contPerDay: 0.8 }),
      ],
      '2026-11-10',
      '2026-11-14',
      DEFAULT_TIMELINE_PARAMS,
    );
    expect(rows).toHaveLength(1);
    const cell = rows[0].days.find((d) => d.day === '2026-11-12')!;
    expect(cell.cont).toBe(1.8);
    expect(cell.over).toBe(true);
    expect(cell.orders).toHaveLength(2);
    expect(rows[0].capacity).toBe(1.3);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toBe('Phôi · Xưởng Phú An 12/11: 1,8 cont > 1,3 (MY-313, GP-176)');
    expect(warnings[0].day).toBe('2026-11-12');
    expect(warnings[0].itemIds).toEqual(['1', '2']);
  });

  it('đúng bằng trần thì không over', () => {
    const { warnings, rows } = aggregateCapacity(
      [range({ contPerDay: 1.3, cont: 1.3 })],
      '2026-11-12',
      '2026-11-12',
      DEFAULT_TIMELINE_PARAMS,
    );
    expect(rows[0].days[0].over).toBe(false);
    expect(warnings).toEqual([]);
  });

  it('DAYS_PER_CONT: 2 lệnh chồng 1 ngày -> over dù cont nhỏ', () => {
    const base = {
      groupCode: 'PHUOC_AN',
      groupName: 'Xưởng Phước An',
      mode: 'DAYS_PER_CONT' as const,
      cont: 0.2,
      contPerDay: 0.1,
      days: 3,
    };
    const { rows, warnings } = aggregateCapacity(
      [
        range({
          ...base,
          itemId: '1',
          displayCode: 'MY-313',
          from: '2026-11-10',
          to: '2026-11-12',
        }),
        range({
          ...base,
          itemId: '2',
          piId: '20',
          displayCode: 'GP-176',
          from: '2026-11-12',
          to: '2026-11-14',
        }),
      ],
      '2026-11-10',
      '2026-11-14',
      DEFAULT_TIMELINE_PARAMS,
    );
    expect(rows[0].capacity).toBeNull();
    expect(rows[0].days.filter((d) => d.over).map((d) => d.day)).toEqual(['2026-11-12']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toBe(
      'Phôi · Xưởng Phước An 12/11: 2 lệnh cùng chiếm ngày (MY-313, GP-176)',
    );
  });

  it('DAYS_PER_CONT: lệnh gộp 2 SKU (cùng PI, cắt chung) không tự chồng với chính nó', () => {
    const base = {
      groupCode: 'PHUOC_AN',
      groupName: 'Xưởng Phước An',
      mode: 'DAYS_PER_CONT' as const,
      piId: '30',
      displayCode: 'MY-401 + MY-402',
      cont: 0.2,
      contPerDay: 0.1,
      days: 2,
      from: '2026-11-12',
      to: '2026-11-13',
    };
    const { rows, warnings } = aggregateCapacity(
      [range({ ...base, itemId: '1' }), range({ ...base, itemId: '2', skuCode: 'SKU-2' })],
      '2026-11-12',
      '2026-11-13',
      DEFAULT_TIMELINE_PARAMS,
    );
    expect(rows[0].days.some((d) => d.over)).toBe(false);
    expect(warnings).toEqual([]);
  });

  it('Sơn Phước An cộng vào Sơn Phú An (cùng nhóm)', () => {
    const { rows, warnings } = aggregateCapacity(
      [
        range({ itemId: '1', stage: 'SON', stageLabel: 'Sơn', contPerDay: 1, cont: 1 }),
        range({
          itemId: '2',
          stage: 'SON',
          stageLabel: 'Sơn',
          contPerDay: 0.5,
          cont: 0.5,
          displayCode: 'GP-176',
        }),
      ],
      '2026-11-12',
      '2026-11-12',
      DEFAULT_TIMELINE_PARAMS,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].groupCode).toBe('PHU_AN');
    expect(rows[0].days[0].cont).toBe(1.5);
    expect(warnings).toHaveLength(1);
  });

  it('ô trống có đủ mọi ngày (cont 0, orders [])', () => {
    const { rows } = aggregateCapacity(
      [range({})],
      '2026-11-10',
      '2026-11-14',
      DEFAULT_TIMELINE_PARAMS,
    );
    expect(rows[0].days.map((d) => d.day)).toEqual([
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
    ]);
    expect(rows[0].days[0]).toEqual({ day: '2026-11-10', cont: 0, orders: [], over: false });
  });

  it('khoảng không giao [from, to] thì không tạo dòng', () => {
    const { rows } = aggregateCapacity(
      [range({ from: '2026-12-01', to: '2026-12-03' })],
      '2026-11-10',
      '2026-11-14',
      DEFAULT_TIMELINE_PARAMS,
    );
    expect(rows).toEqual([]);
  });

  it('khoảng chỉ giao một phần vẫn cộng đúng ngày trong cửa sổ', () => {
    const { rows } = aggregateCapacity(
      [range({ from: '2026-11-08', to: '2026-11-11', days: 4, cont: 4, contPerDay: 1 })],
      '2026-11-10',
      '2026-11-12',
      DEFAULT_TIMELINE_PARAMS,
    );
    expect(rows[0].days.map((d) => d.cont)).toEqual([1, 1, 0]);
  });

  it('sắp xếp: xưởng trước kho, Phú An trước Phước An, đúng thứ tự công đoạn', () => {
    const { rows } = aggregateCapacity(
      [
        range({
          stage: 'DONG_GOI',
          stageLabel: 'Đóng gói',
          groupKind: 'WAREHOUSE',
          groupCode: 'KHO_A',
          groupName: 'Kho A',
        }),
        range({ stage: 'SON', stageLabel: 'Sơn' }),
        range({ groupCode: 'PHUOC_AN', groupName: 'Xưởng Phước An', mode: 'DAYS_PER_CONT' }),
        range({ stage: 'HAN', stageLabel: 'Hàn' }),
        range({}),
      ],
      '2026-11-12',
      '2026-11-12',
      DEFAULT_TIMELINE_PARAMS,
    );
    expect(rows.map((r) => `${r.groupCode}:${r.stage}`)).toEqual([
      'PHU_AN:PHOI',
      'PHU_AN:HAN',
      'PHU_AN:SON',
      'PHUOC_AN:PHOI',
      'KHO_A:DONG_GOI',
    ]);
  });

  it('gộp ô over liên tiếp cùng tập lệnh thành 1 cảnh báo (day đầu, cont lớn nhất)', () => {
    const a = range({
      itemId: '1',
      displayCode: 'MY-313',
      from: '2026-11-12',
      to: '2026-11-14',
      days: 3,
      cont: 3,
      contPerDay: 1,
    });
    const b = range({
      itemId: '2',
      displayCode: 'GP-176',
      from: '2026-11-12',
      to: '2026-11-14',
      days: 3,
      cont: 1.2,
      contPerDay: 0.4,
    });
    const { warnings } = aggregateCapacity(
      [a, b],
      '2026-11-10',
      '2026-11-16',
      DEFAULT_TIMELINE_PARAMS,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].day).toBe('2026-11-12');
    expect(warnings[0].cont).toBe(1.4);
    expect(warnings[0].message).toBe(
      'Phôi · Xưởng Phú An 12/11–14/11: 1,4 cont > 1,3 (MY-313, GP-176)',
    );
  });

  it('tập lệnh đổi giữa chừng -> tách cảnh báo', () => {
    const a = range({
      itemId: '1',
      displayCode: 'A-1',
      from: '2026-11-12',
      to: '2026-11-14',
      days: 3,
      cont: 3,
      contPerDay: 1,
    });
    const b = range({
      itemId: '2',
      displayCode: 'B-2',
      from: '2026-11-12',
      to: '2026-11-12',
      cont: 0.8,
      contPerDay: 0.8,
    });
    const c = range({
      itemId: '3',
      displayCode: 'C-3',
      from: '2026-11-13',
      to: '2026-11-14',
      days: 2,
      cont: 0.8,
      contPerDay: 0.4,
    });
    const { warnings } = aggregateCapacity(
      [a, b, c],
      '2026-11-10',
      '2026-11-16',
      DEFAULT_TIMELINE_PARAMS,
    );
    expect(warnings.map((w) => w.day)).toEqual(['2026-11-12', '2026-11-13']);
    expect(warnings[0].itemIds).toEqual(['1', '2']);
    expect(warnings[1].itemIds).toEqual(['1', '3']);
  });
});
