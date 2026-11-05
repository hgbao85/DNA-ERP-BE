import {
  addDays,
  diffDays,
  frameDaysOf,
  packagingDaysOf,
  suggestTimeline,
  timelineWarnings,
  type TimelineInput,
} from './timeline-suggest.util';

// Bộ ví dụ dùng CHUNG với FE `src/utils/phuAnTimeline.test.ts` - sửa ví dụ thì sửa cả hai.
const P = { capacityContPerDay: 1.3, daysPerContPhuocAn: 4 };
const phuAn = (quantity: number, loadCont: number | null, rest: Partial<TimelineInput> = {}) =>
  suggestTimeline({ quantity, loadCont, capacityMode: 'CONT_PER_DAY', ...rest }, P);

describe('frameDaysOf / packagingDaysOf (v8 10.16)', () => {
  it('Phú An: 160 bộ load 80 = 2 cont -> 2 ngày; 240 -> 3; 400 -> 4', () => {
    expect(frameDaysOf(160, 80, 'CONT_PER_DAY', P)).toBe(2);
    expect(frameDaysOf(240, 80, 'CONT_PER_DAY', P)).toBe(3);
    expect(frameDaysOf(400, 80, 'CONT_PER_DAY', P)).toBe(4);
  });

  it('tính bằng số nguyên: 208 bộ load 80 = 2,6 cont ÷ 1,3 đúng 2 ngày (số thực ra 3)', () => {
    expect(frameDaysOf(208, 80, 'CONT_PER_DAY', P)).toBe(2);
    expect(frameDaysOf(104, 80, 'CONT_PER_DAY', P)).toBe(1);
    expect(frameDaysOf(105, 80, 'CONT_PER_DAY', P)).toBe(2);
  });

  it('Phước An: 1,5 cont -> 4 × 1,5 = 6 ngày; 0,2 cont -> 1 ngày', () => {
    expect(frameDaysOf(120, 80, 'DAYS_PER_CONT', P)).toBe(6);
    expect(frameDaysOf(16, 80, 'DAYS_PER_CONT', P)).toBe(1);
    expect(frameDaysOf(17, 80, 'DAYS_PER_CONT', P)).toBe(1);
    expect(frameDaysOf(21, 80, 'DAYS_PER_CONT', P)).toBe(2);
  });

  it('chưa có load cont / số lượng 0 -> 1 ngày; đóng gói luôn theo cont/ngày', () => {
    expect(frameDaysOf(240, null, 'CONT_PER_DAY', P)).toBe(1);
    expect(frameDaysOf(0, 80, 'DAYS_PER_CONT', P)).toBe(1);
    expect(packagingDaysOf(240, 80, P)).toBe(3);
    expect(packagingDaysOf(120, 80, P)).toBe(2);
  });

  it('năng lực Admin đổi 2 cont/ngày: 240 bộ load 80 = 3 cont -> 2 ngày', () => {
    expect(
      frameDaysOf(240, 80, 'CONT_PER_DAY', { capacityContPerDay: 2, daysPerContPhuocAn: 4 }),
    ).toBe(2);
  });
});

describe('suggestTimeline', () => {
  it('hồi quy PI-2026-035 (X = 1): Khung 26/09 -> Mua 23/09, Phôi/Hàn/Sơn 24–26/09, Nhập đan 06/10, Đóng gói 08/10', () => {
    const s = phuAn(80, null, { saved: { FRAME: '2026-09-26' }, delivery: '2026-10-12' })!;
    expect(s.missingLoadCont).toBe(true);
    expect(s.nSource).toBe('FRAME');
    expect(s.dates).toEqual({
      materialDeadline: '2026-09-23',
      PHOI_START: '2026-09-24',
      FRAME_PHOI: '2026-09-24',
      FRAME_HAN: '2026-09-25',
      FRAME_SON: '2026-09-26',
      FRAME: '2026-09-26',
      WEAVING: '2026-10-06',
      TRANSFER_CHECK: '2026-10-07',
      PACKAGING_START: '2026-10-08',
      PACKAGING: '2026-10-08',
      finishedMaterialDeadline: '2026-10-01',
    });
  });

  it('hồi quy: chỉ có hạn giao 12/10 (X = 1) -> N 25/09, đóng gói xong 09/10 (trước hạn giao 3 ngày)', () => {
    const s = phuAn(80, null, { delivery: '2026-10-12' })!;
    expect(s.nSource).toBe('DELIVERY');
    expect(s.n).toBe('2026-09-25');
    expect(s.dates.PACKAGING).toBe('2026-10-09');
    expect(s.dates.materialDeadline).toBe('2026-09-24');
  });

  it('v8 ví dụ PI-040: 240 bộ load 80, M2 09/11 -> M1 08/11, Phôi xong 11/11, Hàn 12/11, Sơn 13/11', () => {
    const s = phuAn(240, 80, { saved: { PHOI_START: '2026-11-09' } })!;
    expect(s.frameDays).toBe(3);
    expect(s.cont).toBe(3);
    expect(s.dates.materialDeadline).toBe('2026-11-08');
    expect(s.dates.FRAME_PHOI).toBe('2026-11-11');
    expect(s.dates.FRAME_HAN).toBe('2026-11-12');
    expect(s.dates.FRAME_SON).toBe('2026-11-13');
    expect(s.dates.FRAME).toBe('2026-11-13');
    // Nhập đan / Chuyền kiểm / M4 không tự lùi theo X (v8 10.8)
    expect(s.dates.WEAVING).toBe('2026-11-21');
    expect(s.dates.TRANSFER_CHECK).toBe('2026-11-22');
    expect(s.dates.PACKAGING_START).toBe('2026-11-23');
    // Đóng gói 3 ngày: xong M4 + 2; M3 = M4 − 7
    expect(s.dates.PACKAGING).toBe('2026-11-25');
    expect(s.dates.finishedMaterialDeadline).toBe('2026-11-16');
  });

  it('Phước An 1,5 cont: Phôi [N, N+5], Hàn [N+1, N+6], Sơn ở Phú An xong N+7', () => {
    const s = suggestTimeline(
      {
        quantity: 120,
        loadCont: 80,
        capacityMode: 'DAYS_PER_CONT',
        saved: { PHOI_START: '2026-11-09' },
      },
      P,
    )!;
    expect(s.frameDays).toBe(6);
    expect(s.dates.FRAME_PHOI).toBe('2026-11-14');
    expect(s.dates.FRAME_HAN).toBe('2026-11-15');
    expect(s.dates.FRAME_SON).toBe('2026-11-16');
    expect(s.packagingDays).toBe(2);
  });

  it('N: PHOI_START > FRAME_PHOI − (X−1) > Khung − (X+1) > hạn giao − (Xđg+16); N KHSX gõ thắng tất cả', () => {
    expect(phuAn(240, 80, { saved: { FRAME_PHOI: '2026-11-11', FRAME: '2026-12-01' } })!.n).toBe(
      '2026-11-09',
    );
    expect(phuAn(240, 80, { saved: { FRAME: '2026-11-13' }, delivery: '2026-12-31' })!.n).toBe(
      '2026-11-09',
    );
    // 240 bộ: Xđg = 3 -> N = 12/12 − 19 = 23/11; đóng gói xong 23/11 + 14 + 2 = 09/12 (trước hạn giao 3 ngày)
    const byDelivery = phuAn(240, 80, { delivery: '2026-12-12' })!;
    expect(byDelivery.n).toBe('2026-11-23');
    expect(byDelivery.dates.PACKAGING).toBe('2026-12-09');
    const typed = suggestTimeline(
      {
        quantity: 240,
        loadCont: 80,
        capacityMode: 'CONT_PER_DAY',
        saved: { PHOI_START: '2026-11-09' },
      },
      P,
      { n: '2026-11-20' },
    )!;
    expect(typed.n).toBe('2026-11-20');
    expect(typed.dates.FRAME_PHOI).toBe('2026-11-22');
  });

  it('M4: gõ > PACKAGING_START đã lưu > Đóng gói đã lưu − (Xđg−1) > N + 14', () => {
    const base = { PHOI_START: '2026-11-09' };
    expect(
      phuAn(240, 80, { saved: { ...base, PACKAGING: '2026-11-30' } })!.dates.PACKAGING_START,
    ).toBe('2026-11-28');
    expect(
      phuAn(240, 80, {
        saved: { ...base, PACKAGING_START: '2026-11-26', PACKAGING: '2026-11-30' },
      })!.dates.PACKAGING,
    ).toBe('2026-11-28');
    const typed = suggestTimeline(
      { quantity: 240, loadCont: 80, capacityMode: 'CONT_PER_DAY', saved: base },
      P,
      { packagingStart: '2026-12-01' },
    )!;
    expect(typed.dates.PACKAGING).toBe('2026-12-03');
    expect(typed.dates.finishedMaterialDeadline).toBe('2026-11-24');
  });

  it('không có mốc nào và không có hạn giao -> null; ngày sai dạng bị bỏ qua', () => {
    expect(phuAn(240, 80)).toBeNull();
    expect(phuAn(240, 80, { saved: { FRAME: '2026-02-30' } })).toBeNull();
  });

  it('qua tháng, qua năm', () => {
    const s = phuAn(80, null, { delivery: '2027-01-10' })!;
    expect(s.dates.PHOI_START).toBe('2026-12-24');
    expect(s.dates.WEAVING).toBe('2027-01-05');
    expect(s.dates.PACKAGING).toBe('2027-01-07');
  });
});

describe('timelineWarnings (v8 10.14 - chỉ cảnh báo, không chặn)', () => {
  it('đúng thứ tự -> không cảnh báo; cùng ngày không tính là sớm hơn', () => {
    const s = phuAn(240, 80, { saved: { PHOI_START: '2026-11-09' }, delivery: '2026-12-31' })!;
    expect(timelineWarnings({ ...s.dates, delivery: '2026-12-31' })).toEqual([]);
    expect(timelineWarnings({ FRAME_SON: '2026-11-13', WEAVING: '2026-11-13' })).toEqual([]);
  });

  it('Nhập đan sớm hơn Sơn xong (Sơn thiếu thì so Khung), Chuyền kiểm sớm hơn Nhập đan, Đóng gói xong sau hạn giao', () => {
    const codes = timelineWarnings({
      FRAME: '2026-11-25',
      WEAVING: '2026-11-21',
      TRANSFER_CHECK: '2026-11-20',
      PACKAGING_START: '2026-11-19',
      PACKAGING: '2026-11-18',
      PHOI_START: '2026-11-10',
      FRAME_PHOI: '2026-11-09',
      delivery: '2026-11-17',
    }).map((w) => w.code);
    expect(codes).toEqual([
      'PHOI_END_BEFORE_START',
      'WEAVING_BEFORE_SON',
      'TRANSFER_CHECK_BEFORE_WEAVING',
      'PACKAGING_START_BEFORE_TRANSFER_CHECK',
      'PACKAGING_END_BEFORE_START',
      'PACKAGING_AFTER_DELIVERY',
    ]);
  });

  it('câu cảnh báo có ngày dd/MM', () => {
    expect(timelineWarnings({ FRAME_SON: '2026-11-13', WEAVING: '2026-11-12' })[0].message).toBe(
      'Mốc Nhập đan (12/11) sớm hơn ngày xong Sơn (13/11)',
    );
  });
});

describe('addDays / diffDays', () => {
  it('qua năm nhuận', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(diffDays('2026-12-30', '2027-01-02')).toBe(3);
  });
});
