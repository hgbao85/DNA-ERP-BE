import { barsByStockLength } from './pattern-stock-length.util';

describe('barsByStockLength (CS2 20/11/2026)', () => {
  it('tách số cây theo chiều dài từng kiểu cắt, tăng dần theo chiều dài', () => {
    const r = barsByStockLength({ bestStockLengthMm: 6000, totalBars: 6 }, [
      { stockLengthMm: 6000, barCount: 3 },
      { stockLengthMm: 5800, barCount: 1 },
      { stockLengthMm: 6000, barCount: 2 },
    ]);
    expect([...r]).toEqual([
      [5800, 1],
      [6000, 5],
    ]);
  });

  it('kiểu cắt cũ chưa lưu chiều dài -> theo chiều dài của dòng', () => {
    const r = barsByStockLength({ bestStockLengthMm: 5900, totalBars: 4 }, [
      { stockLengthMm: null, barCount: 4 },
    ]);
    expect([...r]).toEqual([[5900, 4]]);
  });

  it('không tải kiểu cắt / tổng kiểu cắt thiếu -> phần chênh vào chiều dài mua', () => {
    expect([...barsByStockLength({ bestStockLengthMm: 6000, totalBars: 8 }, undefined)]).toEqual([
      [6000, 8],
    ]);
    expect([
      ...barsByStockLength({ bestStockLengthMm: 6000, totalBars: 8 }, [
        { stockLengthMm: 5650, barCount: 2 },
      ]),
    ]).toEqual([
      [5650, 2],
      [6000, 6],
    ]);
  });

  it('dòng không có chiều dài mua và kiểu cắt không có chiều dài -> rỗng (nơi gọi tự xử lý)', () => {
    expect(barsByStockLength({ bestStockLengthMm: null, totalBars: 3 }, []).size).toBe(0);
  });
});
