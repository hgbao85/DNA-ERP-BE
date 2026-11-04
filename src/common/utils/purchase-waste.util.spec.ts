import { purchaseBuyQtyWithWaste } from './purchase-waste.util';

describe('purchaseBuyQtyWithWaste', () => {
  it.each([
    // [nhu cầu, tồn khả dụng, % hao hụt, số mua]
    [100, 0, 10, 110],
    [100, 50, 10, 60], // công thức cũ ra 55
    [100, 105, 10, 5], // công thức cũ ra 0
    [100, 110, 10, 0],
    [100, 200, 10, 0],
    [100, 40, 0, 60],
    [2, 0, 1.5, 2.03],
  ])('nhu cầu %d, tồn %d, hao hụt %d%% -> mua %d', (required, available, pct, expected) => {
    expect(purchaseBuyQtyWithWaste(required, available, pct)).toBe(expected);
  });

  it('khử sai số dấu phẩy động để ceil không nhảy thêm 1 đơn vị', () => {
    expect(Math.ceil(100 * (1 + 10 / 100))).toBe(111); // lỗi nếu không làm tròn trước
    expect(Math.ceil(purchaseBuyQtyWithWaste(100, 0, 10))).toBe(110);
  });

  it('tồn âm (dữ liệu lệch) coi như 0', () => {
    expect(purchaseBuyQtyWithWaste(10, -5, 0)).toBe(10);
  });
});
