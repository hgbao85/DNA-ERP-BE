import { ProdItemStageType } from '../../generated/prisma/client';
import {
  PurchaseDeadlineItem,
  frameDeadlineOf,
  purchaseDeadlineOf,
  purchaseGroupOf,
} from './frame-deadline.util';

const d = (s: string) => new Date(`${s}T00:00:00+07:00`);
const iso = (x: Date | null) => (x ? x.toISOString() : null);

function item(
  over: Partial<Omit<PurchaseDeadlineItem, 'stages'>> & { stages?: [ProdItemStageType, string][] },
): PurchaseDeadlineItem {
  const { stages, ...rest } = over;
  return {
    materialDeadline: null,
    finishedMaterialDeadline: null,
    productionInvoice: null,
    ...rest,
    stages: (stages ?? []).map(([stageType, day]) => ({ stageType, deadline: d(day) })),
  };
}

describe('purchaseDeadlineOf (Phần A – Đợt 4, V4-3)', () => {
  describe('nhóm FRAME', () => {
    it('hạn Mua VT khung đã lưu thắng mọi thứ', () => {
      const it1 = item({
        materialDeadline: d('2026-11-01'),
        stages: [
          [ProdItemStageType.PHOI_START, '2026-11-10'],
          [ProdItemStageType.FRAME, '2026-11-20'],
        ],
      });
      expect(iso(purchaseDeadlineOf(it1, 'FRAME'))).toBe(iso(d('2026-11-01')));
    });

    it('chưa có hạn mua: ngày bắt đầu Phôi trừ 1 ngày', () => {
      const it1 = item({
        stages: [
          [ProdItemStageType.PHOI_START, '2026-11-10'],
          [ProdItemStageType.FRAME, '2026-11-20'],
        ],
      });
      expect(iso(purchaseDeadlineOf(it1, 'FRAME'))).toBe(iso(d('2026-11-09')));
    });

    it('trừ qua đầu tháng', () => {
      const it1 = item({ stages: [[ProdItemStageType.PHOI_START, '2026-12-01']] });
      expect(iso(purchaseDeadlineOf(it1, 'FRAME'))).toBe(iso(d('2026-11-30')));
    });

    it('không có Phôi bắt đầu: rơi về hạn Khung, rồi hạn PI', () => {
      const withFrame = item({
        stages: [[ProdItemStageType.FRAME, '2026-11-20']],
        productionInvoice: { deadline: d('2026-12-30') },
      });
      expect(iso(purchaseDeadlineOf(withFrame, 'FRAME'))).toBe(iso(d('2026-11-20')));
      const piOnly = item({ productionInvoice: { deadline: d('2026-12-30') } });
      expect(iso(purchaseDeadlineOf(piOnly, 'FRAME'))).toBe(iso(d('2026-12-30')));
      expect(purchaseDeadlineOf(item({}), 'FRAME')).toBeNull();
    });

    it('frameDeadlineOf KHÔNG đổi: bỏ qua ngày bắt đầu Phôi', () => {
      const it1 = item({
        stages: [
          [ProdItemStageType.PHOI_START, '2026-11-10'],
          [ProdItemStageType.FRAME, '2026-11-20'],
        ],
      });
      expect(iso(frameDeadlineOf(it1))).toBe(iso(d('2026-11-20')));
    });
  });

  describe('nhóm FINISHED', () => {
    it('hạn Mua VT còn lại đã lưu thắng mọi thứ', () => {
      const it1 = item({
        finishedMaterialDeadline: d('2026-11-02'),
        stages: [[ProdItemStageType.PACKAGING_START, '2026-11-20']],
      });
      expect(iso(purchaseDeadlineOf(it1, 'FINISHED'))).toBe(iso(d('2026-11-02')));
    });

    it('chưa có hạn mua: ngày bắt đầu Đóng gói trừ 7 ngày', () => {
      const it1 = item({
        stages: [
          [ProdItemStageType.PACKAGING_START, '2026-11-20'],
          [ProdItemStageType.PACKAGING, '2026-11-25'],
        ],
      });
      expect(iso(purchaseDeadlineOf(it1, 'FINISHED'))).toBe(iso(d('2026-11-13')));
    });

    it('không có Đóng gói bắt đầu: hạn Đóng gói, rồi hạn PI', () => {
      const withPack = item({
        stages: [[ProdItemStageType.PACKAGING, '2026-11-25']],
        productionInvoice: { deadline: d('2026-12-30') },
      });
      expect(iso(purchaseDeadlineOf(withPack, 'FINISHED'))).toBe(iso(d('2026-11-25')));
      const piOnly = item({ productionInvoice: { deadline: d('2026-12-30') } });
      expect(iso(purchaseDeadlineOf(piOnly, 'FINISHED'))).toBe(iso(d('2026-12-30')));
      expect(purchaseDeadlineOf(item({}), 'FINISHED')).toBeNull();
    });
  });

  it('purchaseGroupOf: phụ kiện / nệm / bao bì là FINISHED, còn lại FRAME', () => {
    expect(purchaseGroupOf('ACCESSORY')).toBe('FINISHED');
    expect(purchaseGroupOf('CUSHION')).toBe('FINISHED');
    expect(purchaseGroupOf('PACKAGING')).toBe('FINISHED');
    expect(purchaseGroupOf(null)).toBe('FRAME');
  });
});
