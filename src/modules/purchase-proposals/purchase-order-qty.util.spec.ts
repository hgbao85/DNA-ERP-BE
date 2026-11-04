import { effectiveOrderQty, receiptQtyForPool } from './purchase-order-qty.util';

describe('effectiveOrderQty', () => {
  it.each([
    [6, null, 6],
    [6, undefined, 6],
    [6, 10, 10],
    [6, 6, 6],
    // Lượt tính lại đề xuất đẩy số cần mua vượt số mua đã chốt -> lấy số cần mua.
    [12, 10, 12],
  ])('cần mua %d, số mua %p -> %d', (buy, order, expected) => {
    expect(effectiveOrderQty(buy, order)).toBe(expected);
  });
});

describe('receiptQtyForPool', () => {
  it.each([
    [8, 0, 5, 5],
    [8, 3, 9, 5],
    [8, 8, 4, 0],
    [8, 10, 2, 0],
  ])('cần %d, đã nhận %d, về thêm %d -> giữ chỗ %d', (buy, before, inc, expected) => {
    expect(receiptQtyForPool(buy, before, inc)).toBe(expected);
  });
});
