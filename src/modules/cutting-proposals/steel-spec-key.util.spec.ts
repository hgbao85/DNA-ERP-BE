import {
  bundleSpecMissingMessage,
  findSteelSpecsOutsideBundleTable,
  normalizeSpecKey,
  parseBundleFactorsBySpec,
  parseMachineByWorkshop,
  steelSpecKey,
} from './steel-spec-key.util';

describe('steel-spec-key.util', () => {
  describe('steelSpecKey', () => {
    it.each([
      ['Sắt vuông 6zem', '20', 'V20'],
      ['Sắt vuông 7zem', '50', 'V50'],
      ['Sắt hộp 8zem', '13x26', 'H13-26'],
      ['Sắt hộp 7zem', '25x50', 'H25-50'],
      ['Sắt phi 6zem', 'Ø19', 'FI19'],
    ])('dữ liệu thật %s + %s -> %s', (name, spec, key) => {
      expect(steelSpecKey(name, spec)).toBe(key);
    });

    it('so tên không phân biệt hoa/thường và bỏ dấu', () => {
      expect(steelSpecKey('SAT VUONG 6ZEM', '20')).toBe('V20');
      expect(steelSpecKey('sắt HỘP 8zem', '13x26')).toBe('H13-26');
      expect(steelSpecKey('Sat PHI 6zem', '19')).toBe('FI19');
    });

    it('spec hộp chấp nhận x, X, ×, *, khoảng trắng và đổi thứ tự để a <= b', () => {
      for (const spec of ['13x26', '13X26', '13×26', '13*26', '13 26', '13 x 26', '26x13']) {
        expect(steelSpecKey('Sắt hộp 8zem', spec)).toBe('H13-26');
      }
    });

    it('spec phi chấp nhận Ø/phi/fi đứng trước', () => {
      for (const spec of ['Ø19', 'ø19', 'phi19', 'Phi 19', 'fi19', 'Fi 19', '19']) {
        expect(steelSpecKey('Sắt phi 6zem', spec)).toBe('FI19');
      }
    });

    it('số thập phân giữ dạng "12.7" (dấu phẩy đổi thành chấm)', () => {
      expect(steelSpecKey('Sắt phi 6zem', 'Ø12.7')).toBe('FI12.7');
      expect(steelSpecKey('Sắt phi 6zem', '12,7')).toBe('FI12.7');
      expect(steelSpecKey('Sắt hộp 8zem', '12.7x25.4')).toBe('H12.7-25.4');
    });

    it('tên lạ, spec rỗng hoặc sai dạng -> null', () => {
      expect(steelSpecKey('Ván MDF', '20')).toBeNull();
      expect(steelSpecKey('Sắt vuông 6zem', '')).toBeNull();
      expect(steelSpecKey('Sắt vuông 6zem', null)).toBeNull();
      expect(steelSpecKey(null, '20')).toBeNull();
      expect(steelSpecKey('Sắt hộp 8zem', '25')).toBeNull();
      expect(steelSpecKey('Sắt vuông 6zem', '20x20')).toBeNull();
      expect(steelSpecKey('Sắt phi 6zem', 'abc')).toBeNull();
    });
  });

  describe('normalizeSpecKey', () => {
    it('viết hoa, bỏ khoảng trắng', () => {
      expect(normalizeSpecKey(' h13-26 ')).toBe('H13-26');
      expect(normalizeSpecKey('fi 19')).toBe('FI19');
    });
  });

  describe('parseBundleFactorsBySpec', () => {
    it('chuẩn hoá khoá, lọc số nguyên > 1, khử trùng, bỏ khoá mảng rỗng', () => {
      expect(
        parseBundleFactorsBySpec({
          v10: [60, 64, 64, 1, 0, 2.5, '8'],
          ' h10-20 ': [20],
          FI19: [],
          X: [1],
          Y: 'abc',
        }),
      ).toEqual({ V10: [60, 64], 'H10-20': [20] });
    });

    it('không phải object -> {}', () => {
      expect(parseBundleFactorsBySpec(undefined)).toEqual({});
      expect(parseBundleFactorsBySpec(null)).toEqual({});
      expect(parseBundleFactorsBySpec([60])).toEqual({});
      expect(parseBundleFactorsBySpec('x')).toEqual({});
    });
  });

  describe('parseMachineByWorkshop', () => {
    it('chỉ giữ laser | tu_dong', () => {
      expect(
        parseMachineByWorkshop({ PHUOC_AN: 'tu_dong', A: 'laser', B: 'abc', C: 1, D: null }),
      ).toEqual({ PHUOC_AN: 'tu_dong', A: 'laser' });
    });

    it('không phải object -> {}', () => {
      expect(parseMachineByWorkshop(undefined)).toEqual({});
      expect(parseMachineByWorkshop(['tu_dong'])).toEqual({});
      expect(parseMachineByWorkshop('x')).toEqual({});
    });
  });

  describe('findSteelSpecsOutsideBundleTable', () => {
    const table = { V20: [60], 'H20-40': [20] };

    it('bảng rỗng -> không áp luật', () => {
      expect(
        findSteelSpecsOutsideBundleTable([{ name: 'Sắt vuông 6zem', spec: '25' }], {}),
      ).toEqual([]);
    });

    it('quy cách có trong bảng -> không báo; ngoài bảng -> mã + tên', () => {
      expect(
        findSteelSpecsOutsideBundleTable(
          [
            { name: 'Sắt vuông 6zem', spec: '20' },
            { name: 'Sắt vuông 6zem', spec: '25' },
            { name: 'Sắt hộp 7zem', spec: '20x40' },
            { name: 'Sắt hộp 8zem', spec: '13x26' },
          ],
          table,
        ),
      ).toEqual(['V25 (Sắt vuông 6zem · 25)', 'H13-26 (Sắt hộp 8zem · 13x26)']);
    });

    it('không suy được mã quy cách -> chỉ Tên · Quy cách; khử trùng', () => {
      expect(
        findSteelSpecsOutsideBundleTable(
          [
            { name: 'Thép lạ', spec: 'abc' },
            { name: 'Thép lạ', spec: 'abc' },
          ],
          table,
        ),
      ).toEqual(['Thép lạ · abc']);
    });

    it('câu thông báo liệt kê quy cách', () => {
      expect(bundleSpecMissingMessage(['V25 (Sắt vuông 6zem · 25)'])).toBe(
        'Quy cách V25 (Sắt vuông 6zem · 25) chưa có trong bảng số cây/bó của MC Tự động. Hỏi Sếp số cây/bó rồi nhờ Admin thêm vào Cấu hình hệ thống › Máy cắt, sau đó tính lại.',
      );
    });
  });
});
