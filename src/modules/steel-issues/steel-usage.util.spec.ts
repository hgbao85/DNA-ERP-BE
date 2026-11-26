import { steelReportLimitMm, steelUsage } from './steel-usage.util';

describe('steel-usage.util - cân bằng sắt nhận / đoạn đã báo', () => {
  it('dùng được theo số thực nhận (rơi về barCount), trừ tề đầu; đoạn cộng mạch cắt', () => {
    const u = steelUsage({
      bars: [
        { barCount: 10, receivedBarCount: 9, barLengthMm: 6000 },
        { barCount: 2, receivedBarCount: null, barLengthMm: 3000 },
      ],
      segments: [
        { cutLengthMm: 441, doneQty: 10 },
        { cutLengthMm: 355, doneQty: 4 },
      ],
      trimMm: 10,
      kerfMm: 3,
    });
    expect(u.receivedBarCount).toBe(11);
    expect(u.usableMm).toBe(9 * 5990 + 2 * 2990);
    expect(u.reportedMm).toBe(10 * 444 + 4 * 358);
  });

  it('tề đầu dài hơn cây -> cây đó dùng được 0', () => {
    expect(
      steelUsage({
        bars: [{ barCount: 1, receivedBarCount: 1, barLengthMm: 5 }],
        segments: [],
        trimMm: 10,
        kerfMm: 0,
      }).usableMm,
    ).toBe(0);
  });

  it('giới hạn = (1 + dung sai) × dùng được + mở chặn mm', () => {
    expect(steelReportLimitMm(1000, 0.02, 0)).toBeCloseTo(1020);
    expect(steelReportLimitMm(1000, 0.02, 500)).toBeCloseTo(1520);
  });
});
