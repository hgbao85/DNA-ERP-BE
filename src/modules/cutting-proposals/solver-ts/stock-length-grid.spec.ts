import {
  resolveMaterialStockLengths,
  roundUpToStockGrid,
  STOCK_LENGTH_GRID_MM,
} from './stock-length-grid';

describe('stock-length-grid (cây đặt riêng tròn 5 cm)', () => {
  it('STOCK_LENGTH_GRID_MM = 50', () => {
    expect(STOCK_LENGTH_GRID_MM).toBe(50);
  });

  it.each([
    [5360, 5400],
    [5410, 5450],
    [5411, 5450],
    [5450, 5450],
    [5460, 5500],
    [5010, 5050],
    [5910, 5950],
    [5960, 6000],
    [6000, 6000],
    [5360.4, 5400],
  ])('roundUpToStockGrid(%s) = %s', (input, expected) => {
    expect(roundUpToStockGrid(input)).toBe(expected);
  });

  it('chiều dài riêng được làm tròn lên bội 50', () => {
    expect(resolveMaterialStockLengths(5360, [6000])).toEqual([5400]);
    expect(resolveMaterialStockLengths(5450, [6000])).toEqual([5450]);
  });

  it('không chọn riêng (undefined, null, 0) thì dùng chiều dài chuẩn', () => {
    expect(resolveMaterialStockLengths(undefined, [6000])).toEqual([6000]);
    expect(resolveMaterialStockLengths(null, [6000])).toEqual([6000]);
    expect(resolveMaterialStockLengths(0, [6000])).toEqual([6000]);
  });

  it('chiều dài chuẩn trong defaults không bị đổi', () => {
    expect(resolveMaterialStockLengths(undefined, [5990])).toEqual([5990]);
  });
});
