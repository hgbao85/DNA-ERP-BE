import {
  AUTO_SHIFT_KEYS,
  addDays,
  daysBetween,
  isFloorStarted,
  resolveAutoShift,
} from './deadline-values.util';
import { DeadlineValues } from './deadline-changes.types';

// Phần A – Đợt 9 phần 2: luật tự dời mốc sau (Q9-1 = B) + "đã bắt đầu sản xuất" (Q9-3).
describe('deadline-values.util (Đợt 9 phần 2)', () => {
  const OLD: DeadlineValues = {
    materialDeadline: '2026-11-09',
    'stage.PHOI_START': '2026-11-10',
    'stage.FRAME_PHOI': '2026-11-11',
    'stage.FRAME_HAN': '2026-11-12',
    'stage.FRAME_SON': '2026-11-13',
    'stage.FRAME': '2026-11-13',
    'stage.WEAVING': '2026-11-16',
    'stage.TRANSFER_CHECK': '2026-11-20',
    finishedMaterialDeadline: '2026-11-15',
    'stage.PACKAGING_START': '2026-11-22',
    'stage.PACKAGING': '2026-11-24',
  };

  it('daysBetween / addDays qua tháng, năm, âm', () => {
    expect(daysBetween('2026-11-10', '2026-11-13')).toBe(3);
    expect(daysBetween('2026-11-13', '2026-11-10')).toBe(-3);
    expect(addDays('2026-11-29', 3)).toBe('2026-12-02');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('AUTO_SHIFT_KEYS chỉ gồm mốc sản xuất, đúng thứ tự', () => {
    expect(AUTO_SHIFT_KEYS).toEqual([
      'stage.PHOI_START',
      'stage.FRAME_PHOI',
      'stage.FRAME_HAN',
      'stage.FRAME_SON',
      'stage.FRAME',
      'stage.WEAVING',
      'stage.TRANSFER_CHECK',
      'stage.PACKAGING_START',
      'stage.PACKAGING',
    ]);
  });

  it('dời Bắt đầu Phôi +3 → mọi mốc sản xuất sau +3, Mua VT giữ nguyên', () => {
    const r = resolveAutoShift(OLD, { 'stage.PHOI_START': '2026-11-13' });
    expect(r.values['stage.PHOI_START']).toBe('2026-11-13');
    expect(r.values['stage.FRAME_HAN']).toBe('2026-11-15');
    expect(r.values['stage.PACKAGING']).toBe('2026-11-27');
    expect(r.values.materialDeadline).toBe('2026-11-09');
    expect(r.values.finishedMaterialDeadline).toBe('2026-11-15');
    expect(r.autoKeys).toEqual(AUTO_SHIFT_KEYS.slice(1));
  });

  it('mốc trước mốc đã gõ không dời', () => {
    const r = resolveAutoShift(OLD, { 'stage.WEAVING': '2026-11-18' });
    expect(r.values['stage.FRAME']).toBe('2026-11-13');
    expect(r.values['stage.TRANSFER_CHECK']).toBe('2026-11-22');
    expect(r.autoKeys).toEqual([
      'stage.TRANSFER_CHECK',
      'stage.PACKAGING_START',
      'stage.PACKAGING',
    ]);
  });

  it('nhiều ô gõ: mốc sau theo ô gõ GẦN NHẤT phía trước; gõ lại ngày cũ = 0 ngày', () => {
    const r = resolveAutoShift(OLD, {
      'stage.PHOI_START': '2026-11-13', // +3
      'stage.FRAME': '2026-11-18', // +5
      'stage.PACKAGING': '2026-11-24', // gõ lại ngày cũ → giữ
    });
    expect(r.values['stage.FRAME_HAN']).toBe('2026-11-15'); // +3
    expect(r.values['stage.WEAVING']).toBe('2026-11-21'); // +5
    expect(r.values['stage.PACKAGING_START']).toBe('2026-11-27'); // +5
    expect(r.values['stage.PACKAGING']).toBe('2026-11-24');
    expect(r.autoKeys).not.toContain('stage.PACKAGING');
  });

  it('dời sớm lại (số âm)', () => {
    const r = resolveAutoShift(OLD, { 'stage.FRAME_SON': '2026-11-11' }); // −2
    expect(r.values['stage.FRAME']).toBe('2026-11-11');
    expect(r.values['stage.PACKAGING']).toBe('2026-11-22');
  });

  it('mốc chưa có ngày không tự sinh; gõ mốc chưa có ngày không dời mốc sau', () => {
    const old: DeadlineValues = { ...OLD, 'stage.FRAME_HAN': null, 'stage.FRAME_SON': null };
    const a = resolveAutoShift(old, { 'stage.PHOI_START': '2026-11-12' }); // +2
    expect(a.values['stage.FRAME_HAN']).toBeNull();
    expect(a.values['stage.FRAME']).toBe('2026-11-15');
    const b = resolveAutoShift(old, { 'stage.FRAME_HAN': '2026-11-20' });
    expect(b.values['stage.FRAME']).toBe('2026-11-13');
    expect(b.autoKeys).toEqual([]);
  });

  it('chỉ gõ Mua VT: không dời mốc nào', () => {
    const r = resolveAutoShift(OLD, {
      materialDeadline: '2026-11-05',
      finishedMaterialDeadline: '2026-11-18',
    });
    expect(r.autoKeys).toEqual([]);
    expect(r.values['stage.PHOI_START']).toBe('2026-11-10');
    expect(r.values.finishedMaterialDeadline).toBe('2026-11-18');
  });

  it('không gõ gì → giữ nguyên, đủ mọi khoá', () => {
    const r = resolveAutoShift({ 'stage.PHOI_START': '2026-11-10' }, {});
    expect(r.autoKeys).toEqual([]);
    expect(r.values['stage.PHOI_START']).toBe('2026-11-10');
    expect(r.values.materialDeadline).toBeNull();
    expect(Object.keys(r.values)).toHaveLength(11);
  });

  it('isFloorStarted: chỉ PENDING / chưa có lệnh SX là chưa bắt đầu', () => {
    expect(isFloorStarted(null)).toBe(false);
    expect(isFloorStarted(undefined)).toBe(false);
    expect(isFloorStarted('PENDING')).toBe(false);
    expect(isFloorStarted('ACTIVE')).toBe(true);
    expect(isFloorStarted('PAUSED')).toBe(true);
    expect(isFloorStarted('FINISHED')).toBe(true);
  });
});
