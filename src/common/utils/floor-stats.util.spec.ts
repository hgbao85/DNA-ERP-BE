import {
  bucketKey,
  enumerateBuckets,
  MAX_SPAN_DAYS,
  spanDays,
  vnDayKey,
  vnDayStart,
} from './floor-stats.util';

describe('floor-stats.util - ngày giờ Việt Nam', () => {
  describe('vnDayStart', () => {
    it('00:00 giờ VN = 17:00 UTC của hôm trước', () => {
      expect(vnDayStart('2026-10-15')?.toISOString()).toBe('2026-10-14T17:00:00.000Z');
    });
    it('sai định dạng hoặc ngày không có thật -> null', () => {
      expect(vnDayStart('15/10/2026')).toBeNull();
      expect(vnDayStart('2026-10-5')).toBeNull();
      expect(vnDayStart('2026-02-30')).toBeNull();
      expect(vnDayStart('2026-13-01')).toBeNull();
      expect(vnDayStart('')).toBeNull();
    });
    it('năm nhuận: 29/02/2028 có, 29/02/2026 không', () => {
      expect(vnDayStart('2028-02-29')).not.toBeNull();
      expect(vnDayStart('2026-02-29')).toBeNull();
    });
  });

  describe('vnDayKey / bucketKey', () => {
    it('00:30 sáng 15/10 giờ VN (17:30Z ngày 14) vẫn thuộc ngày 15, không phải 14', () => {
      expect(vnDayKey(new Date('2026-10-14T17:30:00Z'))).toBe('2026-10-15');
    });
    it('16:59 UTC = 23:59 giờ VN cùng ngày; 17:00 UTC = 00:00 ngày kế', () => {
      expect(vnDayKey(new Date('2026-10-15T16:59:59.999Z'))).toBe('2026-10-15');
      expect(vnDayKey(new Date('2026-10-15T17:00:00Z'))).toBe('2026-10-16');
    });
    it('đổi tháng/năm theo giờ VN: 31/12 18:00Z đã là 01/01 năm sau', () => {
      const d = new Date('2026-12-31T18:00:00Z');
      expect(bucketKey(d, 'day')).toBe('2027-01-01');
      expect(bucketKey(d, 'month')).toBe('2027-01');
      expect(bucketKey(d, 'year')).toBe('2027');
    });
  });

  describe('spanDays', () => {
    it('gồm cả hai đầu', () => {
      expect(spanDays('2026-10-15', '2026-10-15')).toBe(1);
      expect(spanDays('2026-10-01', '2026-10-31')).toBe(31);
      expect(spanDays('2026-02-01', '2026-03-01')).toBe(29); // 2026 không nhuận: 28 + 1
    });
    it('ngày sai -> NaN', () => {
      expect(spanDays('x', '2026-10-15')).toBeNaN();
    });
  });

  describe('enumerateBuckets', () => {
    it('theo ngày: đủ từng ngày kể cả ngày không có số', () => {
      expect(enumerateBuckets('2026-10-14', '2026-10-17', 'day')).toEqual([
        '2026-10-14',
        '2026-10-15',
        '2026-10-16',
        '2026-10-17',
      ]);
    });
    it('theo tháng: mỗi tháng 1 khoá dù chỉ chạm 1 ngày', () => {
      expect(enumerateBuckets('2026-09-30', '2026-11-01', 'month')).toEqual([
        '2026-09',
        '2026-10',
        '2026-11',
      ]);
    });
    it('theo năm', () => {
      expect(enumerateBuckets('2025-12-31', '2027-01-01', 'year')).toEqual([
        '2025',
        '2026',
        '2027',
      ]);
    });
    it('khoảng ngược / sai -> rỗng', () => {
      expect(enumerateBuckets('2026-10-17', '2026-10-14', 'day')).toEqual([]);
      expect(enumerateBuckets('x', 'y', 'day')).toEqual([]);
    });
  });

  it('giới hạn khoảng: ngày ≤ 92, tháng ≤ 5 năm, năm ≤ 10 năm', () => {
    expect(MAX_SPAN_DAYS.day).toBe(92);
    expect(MAX_SPAN_DAYS.month).toBeGreaterThanOrEqual(5 * 365);
    expect(MAX_SPAN_DAYS.year).toBeGreaterThanOrEqual(10 * 365);
  });
});
