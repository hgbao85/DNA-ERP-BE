import {
  allocateShortage,
  bookingDue,
  bookingDueDay,
  bookingTotals,
  lineM3,
  setVolumeM3,
} from './booking-calc.util';

describe('booking-calc.util (Phần A – Đợt 10a)', () => {
  describe('bookingDueDay', () => {
    it('lấy ngày sớm hơn giữa ngày lấy cont và ngày VN của CUT OFF', () => {
      // 2026-11-02T17:30Z = 03/11 00:30 giờ VN
      const cutOffAt = new Date('2026-11-02T17:30:00.000Z');
      expect(bookingDueDay({ pickupDate: new Date('2026-11-05'), cutOffAt })).toBe('2026-11-03');
      expect(bookingDueDay({ pickupDate: new Date('2026-11-01'), cutOffAt })).toBe('2026-11-01');
    });

    it('chỉ có 1 trong 2 -> lấy cái đó; không có -> null', () => {
      expect(bookingDueDay({ pickupDate: new Date('2026-11-05'), cutOffAt: null })).toBe(
        '2026-11-05',
      );
      expect(
        bookingDueDay({ pickupDate: null, cutOffAt: new Date('2026-11-02T17:30:00.000Z') }),
      ).toBe('2026-11-03');
      expect(bookingDueDay({ pickupDate: null, cutOffAt: null })).toBeNull();
    });

    it('bookingDue cho biết nguồn ngày hạn', () => {
      const cutOffAt = new Date('2026-11-02T17:30:00.000Z');
      expect(bookingDue({ pickupDate: new Date('2026-11-05'), cutOffAt })?.kind).toBe('CUT OFF');
      expect(bookingDue({ pickupDate: new Date('2026-11-01'), cutOffAt })?.kind).toBe('lấy cont');
    });
  });

  describe('allocateShortage', () => {
    it('hàng sẵn 100: booking B (04/11) 50 được trước, A (05/11) 80 thiếu 30', () => {
      const m = allocateShortage(100, [
        { bookingId: '1', dueDay: '2026-11-05', outstanding: 80 },
        { bookingId: '2', dueDay: '2026-11-04', outstanding: 50 },
      ]);
      expect(m.get('2')).toBe(0);
      expect(m.get('1')).toBe(30);
    });

    it('booking không có ngày xếp cuối; cùng ngày thì id nhỏ trước', () => {
      const m = allocateShortage(60, [
        { bookingId: '9', dueDay: null, outstanding: 50 },
        { bookingId: '11', dueDay: '2026-11-04', outstanding: 40 },
        { bookingId: '10', dueDay: '2026-11-04', outstanding: 40 },
      ]);
      expect(m.get('10')).toBe(0);
      expect(m.get('11')).toBe(20);
      expect(m.get('9')).toBe(50);
    });

    it('chỉ 1 booking: = max(0, outstanding - ready); ready 0 -> thiếu hết', () => {
      expect(
        allocateShortage(10, [{ bookingId: '1', dueDay: null, outstanding: 4 }]).get('1'),
      ).toBe(0);
      expect(allocateShortage(0, [{ bookingId: '1', dueDay: null, outstanding: 4 }]).get('1')).toBe(
        4,
      );
    });
  });

  describe('thể tích', () => {
    it('setVolumeM3 / lineM3 bằng số nguyên: 0,844 m³ × 80 bộ = 67,52', () => {
      expect(setVolumeM3(0.844, 1)).toBe(0.844);
      expect(lineM3(80, 0.844, 1)).toBe(67.52);
      expect(setVolumeM3(null, 1)).toBeNull();
      expect(lineM3(5, null, 1)).toBeNull();
    });

    it('80 bộ × 0,844 = 67,52 m³ = 99,3% cont 68', () => {
      const t = bookingTotals(
        [{ factoryCode: 'A', qty: 80, boxVolumeM3: 0.844, boxesPerSet: 1, shortQty: 0 }],
        68,
        1,
      );
      expect(t.totalM3).toBe(67.52);
      expect(t.capacityM3).toBe(68);
      expect(t.fillPct).toBe(99.3);
    });

    it('0,68 × 2 thùng/bộ × 50 = 68 m³ = 100,0%', () => {
      const t = bookingTotals(
        [{ factoryCode: 'A', qty: 50, boxVolumeM3: 0.68, boxesPerSet: 2, shortQty: 0 }],
        68,
        1,
      );
      expect(t.totalM3).toBe(68);
      expect(t.fillPct).toBe(100);
    });

    it('3 dòng, 1 SKU thiếu kích thước: bỏ khỏi m³, ghi vào missingVolumeSkus (không trùng)', () => {
      const t = bookingTotals(
        [
          { factoryCode: 'A', qty: 10, boxVolumeM3: 0.5, boxesPerSet: 1, shortQty: 0 },
          { factoryCode: 'B', qty: 5, boxVolumeM3: null, boxesPerSet: 1, shortQty: 5 },
          { factoryCode: 'B', qty: 3, boxVolumeM3: null, boxesPerSet: 1, shortQty: 0 },
        ],
        68,
        1,
      );
      expect(t.qty).toBe(18);
      expect(t.totalM3).toBe(5);
      expect(t.missingVolumeSkus).toEqual(['B']);
      expect(t.shortQty).toBe(5);
      expect(t.shortLines).toBe(1);
    });

    it('2 cont: capacity 136; capacity 0 -> fillPct null', () => {
      const t = bookingTotals(
        [{ factoryCode: 'A', qty: 68, boxVolumeM3: 1, boxesPerSet: 1, shortQty: 0 }],
        68,
        2,
      );
      expect(t.capacityM3).toBe(136);
      expect(t.fillPct).toBe(50);
      expect(bookingTotals([], 0, 1).fillPct).toBeNull();
    });
  });
});
