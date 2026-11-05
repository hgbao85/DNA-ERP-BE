import { milestoneOrderWarnings } from './milestone-order.util';

describe('milestoneOrderWarnings', () => {
  it('đúng thứ tự (và bỏ qua mốc null) -> không cảnh báo', () => {
    expect(
      milestoneOrderWarnings({
        materialDeadline: '2026-11-01',
        'stage.FRAME_PHOI': '2026-11-10',
        'stage.FRAME_HAN': null,
        'stage.FRAME_SON': '2026-11-12',
        'stage.PACKAGING': '2026-11-20',
        finishedMaterialDeadline: '2026-11-13',
        deliveryDeadline: '2026-11-25',
      }),
    ).toEqual([]);
  });

  it('Hàn sớm hơn Phôi -> 1 câu', () => {
    expect(
      milestoneOrderWarnings({
        'stage.FRAME_PHOI': '2026-11-13',
        'stage.FRAME_HAN': '2026-11-12',
        'stage.FRAME_SON': '2026-11-14',
      }),
    ).toEqual(['Hàn (12/11) sớm hơn Phôi (13/11)']);
  });

  it('mốc lệch không kéo cảnh báo dây chuyền cho các mốc sau', () => {
    const w = milestoneOrderWarnings({
      'stage.FRAME_PHOI': '2026-11-13',
      'stage.FRAME_HAN': '2026-11-05',
      'stage.FRAME_SON': '2026-11-14',
    });
    expect(w).toHaveLength(1);
  });

  it('Đóng gói sau Hạn giao + Mua VT còn lại sau Bắt đầu đóng gói', () => {
    const w = milestoneOrderWarnings({
      'stage.PACKAGING_START': '2026-11-10',
      'stage.PACKAGING': '2026-11-12',
      finishedMaterialDeadline: '2026-11-11',
      deliveryDeadline: '2026-11-11',
    });
    expect(w).toEqual([
      'Hạn giao (11/11) sớm hơn Đóng gói (12/11)',
      'Mua VT còn lại (11/11) muộn hơn Bắt đầu đóng gói (10/11)',
    ]);
  });

  it('nhiều mốc sau cùng sớm hơn 1 mốc → gộp 1 câu (dời Hàn ra sau Sơn, Khung, Hạn giao)', () => {
    expect(
      milestoneOrderWarnings({
        'stage.FRAME_PHOI': '2026-11-05',
        'stage.FRAME_HAN': '2026-12-07',
        'stage.FRAME_SON': '2026-11-09',
        'stage.FRAME': '2026-11-09',
        deliveryDeadline: '2026-11-30',
      }),
    ).toEqual([
      'Hàn (07/12) muộn hơn các mốc sau nó: Sơn (09/11), Khung (09/11), Hạn giao (30/11)',
    ]);
  });

  it('Mua VT còn lại so với Đóng gói khi không có Bắt đầu đóng gói', () => {
    expect(
      milestoneOrderWarnings({
        'stage.PACKAGING': '2026-11-10',
        finishedMaterialDeadline: '2026-11-12',
      }),
    ).toEqual(['Mua VT còn lại (12/11) muộn hơn Đóng gói (10/11)']);
  });
});
