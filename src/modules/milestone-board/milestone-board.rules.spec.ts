import { ProdItemStageType } from '../../generated/prisma/client';
import { purchaseDeadlineOf, purchaseGroupOf } from '../../common/utils/frame-deadline.util';
import {
  DUE_SOON_DAYS,
  averagePercent,
  combineProgress,
  daysBetween,
  goodCapped,
  milestoneStatus,
  percentOf,
  worstStatus,
} from './milestone-board.rules';

describe('milestone-board.rules', () => {
  const TODAY = '2026-10-29';
  const open = { known: true, need: 10, done: 4 };

  it('daysBetween: âm khi hạn đã qua, qua ranh giới tháng', () => {
    expect(daysBetween(TODAY, '2026-10-29')).toBe(0);
    expect(daysBetween(TODAY, '2026-10-27')).toBe(-2);
    expect(daysBetween(TODAY, '2026-11-02')).toBe(4);
    expect(() => daysBetween(TODAY, '29/10/2026')).toThrow();
  });

  it('chưa biết / không cần / xong đứng trước so hạn', () => {
    expect(milestoneStatus({ known: false, need: 0, done: 0 }, '2026-10-01', TODAY).status).toBe(
      'UNKNOWN',
    );
    expect(milestoneStatus({ known: true, need: 0, done: 0 }, '2026-10-01', TODAY).status).toBe(
      'NA',
    );
    expect(milestoneStatus({ known: true, need: 10, done: 10 }, '2026-10-01', TODAY).status).toBe(
      'DONE',
    );
  });

  it('chưa đặt hạn thì không báo trễ', () => {
    expect(milestoneStatus(open, null, TODAY)).toEqual({ status: 'NO_DEADLINE', daysLeft: null });
  });

  it(`trễ / sắp tới hạn (≤ ${DUE_SOON_DAYS} ngày, gồm hôm nay) / đúng hạn`, () => {
    expect(milestoneStatus(open, '2026-10-28', TODAY)).toEqual({ status: 'LATE', daysLeft: -1 });
    expect(milestoneStatus(open, '2026-10-29', TODAY)).toEqual({ status: 'DUE_SOON', daysLeft: 0 });
    expect(milestoneStatus(open, '2026-10-31', TODAY)).toEqual({ status: 'DUE_SOON', daysLeft: 2 });
    expect(milestoneStatus(open, '2026-11-01', TODAY)).toEqual({ status: 'ON_TRACK', daysLeft: 3 });
  });

  it('percentOf: làm tròn xuống, đã làm tối thiểu 1, không quá 100', () => {
    expect(percentOf({ known: true, need: 1000, done: 999 })).toBe(99);
    expect(percentOf({ known: true, need: 1000, done: 1 })).toBe(1);
    expect(percentOf({ known: true, need: 10, done: 15 })).toBe(100);
    expect(percentOf({ known: true, need: 0, done: 0 })).toBe(0);
  });

  it('averagePercent: trung bình % các phần có việc (như getStagePercent FE), làm tròn xuống, đã làm tối thiểu 1', () => {
    const p = (need: number, done: number) => ({ known: true, need, done });
    // "Theo lệnh" ở test thật 32.27: Phôi 16%, Hàn 8%, Sơn 0% -> 8%.
    expect(averagePercent([p(100, 16), p(100, 8), p(100, 0)])).toBe(8);
    expect(averagePercent([p(100, 50), p(0, 0)])).toBe(50);
    expect(averagePercent([p(1000, 1), p(1000, 0)])).toBe(1);
    expect(averagePercent([p(0, 0)])).toBe(0);
  });

  it('purchaseDeadlineOf: VT khung đã lưu → Khung → PI; VT còn lại đã lưu → Đóng gói → PI (chung với Theo dõi mua hàng)', () => {
    const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
    const base = {
      materialDeadline: null,
      finishedMaterialDeadline: null,
      stages: [
        { stageType: ProdItemStageType.FRAME, deadline: d('2026-11-05') },
        { stageType: ProdItemStageType.PACKAGING, deadline: d('2026-11-20') },
      ],
      productionInvoice: { deadline: d('2026-11-30') },
    };
    expect(purchaseDeadlineOf({ ...base, materialDeadline: d('2026-11-01') }, 'FRAME')).toEqual(
      d('2026-11-01'),
    );
    expect(purchaseDeadlineOf(base, 'FRAME')).toEqual(d('2026-11-05'));
    expect(
      purchaseDeadlineOf({ ...base, finishedMaterialDeadline: d('2026-11-12') }, 'FINISHED'),
    ).toEqual(d('2026-11-12'));
    expect(purchaseDeadlineOf(base, 'FINISHED')).toEqual(d('2026-11-20'));
    expect(purchaseDeadlineOf({ ...base, stages: [] }, 'FINISHED')).toEqual(d('2026-11-30'));
    expect(purchaseGroupOf('PACKAGING')).toBe('FINISHED');
    expect(purchaseGroupOf(null)).toBe('FRAME');
  });

  it('combineProgress: Khung = Phôi + Hàn + Sơn, phần không cần bỏ qua, 1 phần chưa biết thì cả cụm chưa biết', () => {
    const phoi = { known: true, need: 500, done: 500 };
    const han = { known: true, need: 50, done: 20 };
    const sonNa = { known: true, need: 0, done: 0 };
    expect(combineProgress([phoi, han, sonNa])).toEqual({ known: true, need: 550, done: 520 });
    expect(combineProgress([phoi, { known: false, need: 0, done: 0 }]).known).toBe(false);
    // Làm dư ở phần này không bù cho phần khác còn thiếu.
    expect(combineProgress([{ known: true, need: 10, done: 30 }, han])).toEqual({
      known: true,
      need: 60,
      done: 30,
    });
  });

  it('worstStatus: trễ > sắp tới hạn > đúng hạn > chưa đặt hạn > chưa biết > xong > không cần', () => {
    expect(worstStatus(['DONE', 'ON_TRACK', 'DUE_SOON'])).toBe('DUE_SOON');
    expect(worstStatus(['NA', 'DONE'])).toBe('DONE');
    expect(worstStatus(['LATE', 'UNKNOWN'])).toBe('LATE');
    expect(worstStatus([])).toBe('NA');
  });

  it('goodCapped: trừ lỗi KCS, chặn trần theo cần', () => {
    expect(goodCapped(100, 120, 0)).toBe(100);
    expect(goodCapped(100, 80, 10)).toBe(70);
    expect(goodCapped(100, 5, 10)).toBe(0);
  });
});
