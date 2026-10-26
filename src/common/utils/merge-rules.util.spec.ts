import { ProdItemStageType } from '../../generated/prisma/client';
import { checkMergeRules, ownSteelDeadlineOf, skuLabel } from './merge-rules.util';

const item = (label: string, materialDeadline: string | null, frame: string | null = null) => ({
  label,
  materialDeadline: materialDeadline ? new Date(materialDeadline) : null,
  stages: frame ? [{ stageType: ProdItemStageType.FRAME, deadline: new Date(frame) }] : [],
});
const cfg = { windowDays: 3, maxSkus: 5 };

describe('merge-rules.util', () => {
  it('mốc cần sắt = hạn mua hàng, không có thì hạn khung, không có cả hai = null', () => {
    expect(ownSteelDeadlineOf(item('A', '2026-11-12', '2026-11-20'))?.toISOString()).toContain(
      '2026-11-12',
    );
    expect(ownSteelDeadlineOf(item('A', null, '2026-11-20'))?.toISOString()).toContain(
      '2026-11-20',
    );
    expect(ownSteelDeadlineOf(item('A', null))).toBeNull();
  });

  it('khung 3 ngày tính cả ngày đầu: ngày 1 gộp được ngày 3, KHÔNG gộp với ngày 4 (Sếp Nhân 2026-10-24)', () => {
    expect(checkMergeRules([item('A', '2026-11-01'), item('B', '2026-11-03')], cfg).ok).toBe(true);
    const day4 = checkMergeRules([item('A', '2026-11-01'), item('B', '2026-11-04')], cfg);
    expect(day4).toMatchObject({ ok: false, spanDays: 3 });
    expect(day4.reason).toContain('chênh tối đa 2 ngày');
  });

  it('vi phạm thì nêu SKU sớm nhất/muộn nhất', () => {
    const r = checkMergeRules(
      [item('A', '2026-11-12'), item('C', '2026-11-13'), item('B', '2026-11-16')],
      cfg,
    );
    expect(r).toMatchObject({ ok: false, spanDays: 4 });
    expect(r.reason).toContain('cách nhau 4 ngày');
    expect(r.reason).toContain('12/11 – A');
    expect(r.reason).toContain('16/11 – B');
    expect(r.reason).toContain('trong khung 3 ngày');
  });

  it('SKU chưa có mốc không bị chặn và không làm sai khoảng cách', () => {
    const r = checkMergeRules(
      [item('A', '2026-11-12'), item('X', null), item('B', '2026-11-14')],
      cfg,
    ); // chênh 2 ngày = ngày 1 với ngày 3
    expect(r).toMatchObject({ ok: true, spanDays: 2 });
  });

  it('quá số SKU -> chặn ở đợt; lệnh gộp đang sửa hạn thì không kiểm số SKU', () => {
    const six = ['A', 'B', 'C', 'D', 'E', 'F'].map((l) => item(l, null));
    expect(checkMergeRules(six, cfg).reason).toContain('Đợt gồm 6 SKU, tối đa 5 SKU');
    expect(checkMergeRules(six.slice(0, 3), { windowDays: 3, maxSkus: 2 }).reason).toContain(
      'tối đa 2 SKU',
    );
    expect(checkMergeRules(six, cfg, 'invoice').ok).toBe(true);
  });

  it('câu báo lệnh gộp khuyên dời mốc / tách SKU', () => {
    const r = checkMergeRules([item('A', '2026-11-01'), item('B', '2026-11-20')], cfg, 'invoice');
    expect(r.reason).toContain('trong lệnh gộp');
    expect(r.reason).toContain('tách SKU ra lệnh riêng');
  });

  it('nhãn câu báo kèm mã PO - nhiều đơn cùng SKU mới phân biệt được', () => {
    expect(skuLabel('GHE-J55', 'RP-633975')).toBe('GHE-J55 (RP-633975)');
    expect(skuLabel('GHE-J55', null)).toBe('GHE-J55');
  });
});
