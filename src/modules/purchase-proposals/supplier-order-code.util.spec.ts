import { supplierOrderCode, vnYear } from './supplier-order-code.util';

describe('supplierOrderCode / vnYear', () => {
  it('in số đơn dạng số/năm', () => {
    expect(supplierOrderCode(52, 2026)).toBe('52/2026');
  });

  it('năm tính theo giờ Việt Nam: 31/12 17:30 UTC đã là năm mới ở VN', () => {
    expect(vnYear(new Date('2026-12-31T16:59:00Z'))).toBe(2026);
    expect(vnYear(new Date('2026-12-31T17:30:00Z'))).toBe(2027);
  });
});
