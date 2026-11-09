import { transferWarehouseShortCode } from './transfer-routes.constant';

// v8 4.8 + chốt 09/11/2026: mã kho giao trong số phiếu CK-<mã>-NNN, Phú An = PA, Phước An = PHA.
describe('transferWarehouseShortCode', () => {
  const w = (code: string, name: string, kind: string | null, workshopCode: string | null) => ({
    code,
    name,
    kind,
    workshopCode,
  });

  it.each([
    [w('phoi-son-han', 'Kho Phôi Phú An', 'PHOI', 'PHU_AN'), 'PA.PHOI'],
    [w('phoi-son-han-han-pa', 'Kho Hàn Phú An', 'HAN', 'PHU_AN'), 'PA.HAN'],
    [w('phoi-son-han-son-pa', 'Kho Sơn Phú An', 'SON', 'PHU_AN'), 'PA.SON'],
    [w('phoi-son-han-phoi-pha', 'Kho Phôi Phước An', 'PHOI', 'PHUOC_AN'), 'PHA.PHOI'],
    [w('phoi-son-han-han-pha', 'Kho Hàn Phước An', 'HAN', 'PHUOC_AN'), 'PHA.HAN'],
    [w('vat-tu-tp', 'Kho Phụ kiện', 'PHU_KIEN', null), 'PA.PK'],
    [w('thanh-pham', 'Kho thành phẩm', 'THANH_PHAM', null), 'PA.TP1'],
    [w('thanh-pham-178', 'Kho thành phẩm 2', 'THANH_PHAM', null), 'PA.TP2'],
    [w('thanh-pham-179', 'Kho thành phẩm 3', 'THANH_PHAM', null), 'PA.TP3'],
    [w('kho-le', 'Kho lẻ', null, null), 'KHO-LE'],
  ])('%o -> %s', (input, expected) => {
    expect(transferWarehouseShortCode(input)).toBe(expected);
  });
});
