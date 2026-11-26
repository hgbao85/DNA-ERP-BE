import {
  capacityWarning,
  nextPalletCodes,
  palletCodeNumber,
  palletLoadCap,
  resolvePaintQty,
  weavingPalletLimit,
} from './pallet.util';

const errorOf = (r: ReturnType<typeof resolvePaintQty>): string => ('error' in r ? r.error : '');

describe('pallet.util - pallet Sơn (24/11/2026)', () => {
  describe('palletLoadCap (P3: tổng pallet chờ sơn ≤ số Sơn còn báo được)', () => {
    it('chỉ theo kế hoạch khi không có cổng "Sơn đã nhận"', () => {
      expect(
        palletLoadCap({ plannedQty: 10, reportedQty: 3, receivedLeft: null, pendingQty: 4 }),
      ).toEqual({ reportableQty: 7, remainingQty: 3 });
    });

    it('lấy số nhỏ hơn giữa kế hoạch và hàng Sơn đã nhận', () => {
      expect(
        palletLoadCap({ plannedQty: 10, reportedQty: 0, receivedLeft: 3, pendingQty: 1 }),
      ).toEqual({ reportableQty: 3, remainingQty: 2 });
      expect(
        palletLoadCap({ plannedQty: 10, reportedQty: 8, receivedLeft: 6, pendingQty: 0 }),
      ).toEqual({ reportableQty: 2, remainingQty: 2 });
    });

    it('không bao giờ âm (báo vượt / pallet chờ sơn nhiều hơn số còn báo)', () => {
      expect(
        palletLoadCap({ plannedQty: 5, reportedQty: 7, receivedLeft: -2, pendingQty: 3 }),
      ).toEqual({ reportableQty: 0, remainingQty: 0 });
      expect(
        palletLoadCap({ plannedQty: 10, reportedQty: 2, receivedLeft: null, pendingQty: 9 }),
      ).toEqual({ reportableQty: 8, remainingQty: 0 });
    });
  });

  describe('capacityWarning (P2: chỉ cảnh báo)', () => {
    it.each([
      [10, null],
      [10, undefined],
      [10, 0],
      [10, 10],
      [5, 10],
    ])('xếp %s, sức chứa %s -> không cảnh báo', (qty, cap) => {
      expect(capacityWarning(qty, cap)).toBeNull();
    });

    it('vượt sức chứa -> câu cảnh báo có cả 2 số', () => {
      expect(capacityWarning(12, 10)).toContain('12 mảnh, vượt sức chứa 10');
    });
  });

  describe('mã pallet PL-NNN', () => {
    it('đọc số thứ tự, mã khác dạng -> null', () => {
      expect(palletCodeNumber('PL-007')).toBe(7);
      expect(palletCodeNumber(' pl-1234 ')).toBe(1234);
      expect(palletCodeNumber('PX-001')).toBeNull();
      expect(palletCodeNumber('PL-')).toBeNull();
    });

    it('cấp tiếp sau mã lớn nhất, đệm 3 chữ số', () => {
      expect(nextPalletCodes([], 2)).toEqual(['PL-001', 'PL-002']);
      expect(nextPalletCodes(['PL-001', 'PL-009', 'KHAC'], 2)).toEqual(['PL-010', 'PL-011']);
      expect(nextPalletCodes(['PL-999'], 1)).toEqual(['PL-1000']);
    });
  });

  describe('resolvePaintQty ("Sơn xong" / "Báo thiếu")', () => {
    it('không nhập số = đủ số trên pallet', () => {
      expect(resolvePaintQty(6, undefined, undefined)).toEqual({
        qty: 6,
        short: false,
        reason: null,
      });
      expect(resolvePaintQty(6, 6, 'bỏ qua')).toEqual({ qty: 6, short: false, reason: null });
    });

    it('báo thiếu cần lý do ≥ 3 ký tự', () => {
      expect(errorOf(resolvePaintQty(6, 4, '  '))).toContain('lý do');
      expect(errorOf(resolvePaintQty(6, 4, 'ab'))).toContain('lý do');
      expect(resolvePaintQty(6, 4, ' vỡ 2 mảnh ')).toEqual({
        qty: 4,
        short: true,
        reason: 'vỡ 2 mảnh',
      });
    });

    it('không báo hơn số trên pallet, không báo 0 / số lẻ', () => {
      expect(errorOf(resolvePaintQty(6, 7, 'x'))).toContain('chỉ có 6');
      expect(resolvePaintQty(6, 0, 'abc')).toHaveProperty('error');
      expect(resolvePaintQty(6, 2.5, 'abc')).toHaveProperty('error');
    });
  });

  it('weavingPalletLimit = tổng số đã sơn của các pallet trên dòng', () => {
    expect(weavingPalletLimit([])).toBe(0);
    expect(weavingPalletLimit([{ paintedQty: 4 }, { paintedQty: 3 }])).toBe(7);
  });
});
