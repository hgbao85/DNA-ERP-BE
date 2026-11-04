import {
  isValidLsxCode,
  lenhDisplayCode,
  lenhLsxCodes,
  loadLenhDisplayCodes,
  lsxPrefixOf,
  normalizeLsxCode,
  normalizeLsxPrefixes,
} from './lenh-code.util';

describe('lenh-code.util (Phần A – Đợt 2: số LSX)', () => {
  describe('normalizeLsxCode', () => {
    it.each([
      ['my 313', 'MY-313'],
      ['MY_313', 'MY-313'],
      ['my313', 'MY-313'],
      ['MY-313', 'MY-313'],
      [' gp-176 ', 'GP-176'],
      ['gp - 176', 'GP-176'],
    ])('"%s" -> "%s"', (raw, expected) => {
      expect(normalizeLsxCode(raw)).toBe(expected);
    });

    it('không bỏ số 0 đầu', () => {
      expect(normalizeLsxCode('my 0313')).toBe('MY-0313');
      expect(normalizeLsxCode('MY-0313')).toBe('MY-0313');
    });

    it('chuỗi sai dạng: giữ nguyên, in hoa, bỏ khoảng trắng (để nơi gọi báo lỗi bằng isValidLsxCode)', () => {
      expect(normalizeLsxCode(' my 3 1 3x ')).toBe('MY313X');
      expect(isValidLsxCode(normalizeLsxCode('my 3 1 3x'))).toBe(false);
      expect(normalizeLsxCode('313')).toBe('313');
    });
  });

  describe('isValidLsxCode', () => {
    it('biên: 1–6 chữ, 1–6 số', () => {
      expect(isValidLsxCode('M-1')).toBe(true);
      expect(isValidLsxCode('ABCDEF-123456')).toBe(true);
      expect(isValidLsxCode('ABCDEFG-1')).toBe(false); // 7 chữ
      expect(isValidLsxCode('MY-1234567')).toBe(false); // 7 số
    });

    it('thiếu gạch, thiếu số/chữ, chữ thường đều sai', () => {
      expect(isValidLsxCode('MY313')).toBe(false);
      expect(isValidLsxCode('MY-')).toBe(false);
      expect(isValidLsxCode('-313')).toBe(false);
      expect(isValidLsxCode('my-313')).toBe(false);
      expect(isValidLsxCode('MY-31A')).toBe(false);
      expect(isValidLsxCode('')).toBe(false);
    });
  });

  describe('lsxPrefixOf', () => {
    it('lấy tiền tố của mã hợp lệ, mã sai -> null', () => {
      expect(lsxPrefixOf('MY-313')).toBe('MY');
      expect(lsxPrefixOf('GP-176')).toBe('GP');
      expect(lsxPrefixOf('MY313')).toBeNull();
      expect(lsxPrefixOf('my-313')).toBeNull();
    });
  });

  describe('normalizeLsxPrefixes', () => {
    it('in hoa, bỏ trắng, bỏ trùng, bỏ rỗng, giữ thứ tự nhập', () => {
      expect(normalizeLsxPrefixes(['my', ' gp ', 'MY', '', '  ', 'ab'])).toEqual([
        'MY',
        'GP',
        'AB',
      ]);
    });

    it('rỗng -> rỗng', () => {
      expect(normalizeLsxPrefixes([])).toEqual([]);
    });
  });

  describe('lenhLsxCodes / lenhDisplayCode', () => {
    const pi = { code: 'PI-2026-009' };

    it('PI gộp 2 số khác nhau -> "MY-313 + MY-314"', () => {
      const items = [{ lsxCode: 'MY-313' }, { lsxCode: 'MY-314' }];
      expect(lenhLsxCodes(items)).toEqual(['MY-313', 'MY-314']);
      expect(lenhDisplayCode(pi, items)).toBe('MY-313 + MY-314');
    });

    it('trùng số chỉ hiện 1 lần', () => {
      const items = [{ lsxCode: 'MY-313' }, { lsxCode: 'MY-313' }, { lsxCode: 'GP-1' }];
      expect(lenhLsxCodes(items)).toEqual(['MY-313', 'GP-1']);
      expect(lenhDisplayCode(pi, items)).toBe('MY-313 + GP-1');
    });

    it('dòng null/rỗng/undefined bị bỏ', () => {
      const items = [{ lsxCode: null }, { lsxCode: '  ' }, {}, { lsxCode: 'MY-5' }];
      expect(lenhLsxCodes(items)).toEqual(['MY-5']);
      expect(lenhDisplayCode(pi, items)).toBe('MY-5');
    });

    it('không dòng nào có số -> mã PI', () => {
      expect(lenhDisplayCode(pi, [{ lsxCode: null }, {}])).toBe('PI-2026-009');
      expect(lenhDisplayCode(pi, [])).toBe('PI-2026-009');
    });

    it('giữ thứ tự dòng (không sắp xếp lại)', () => {
      expect(lenhDisplayCode(pi, [{ lsxCode: 'MY-9' }, { lsxCode: 'GP-1' }])).toBe('MY-9 + GP-1');
    });
  });

  describe('loadLenhDisplayCodes', () => {
    const makePrisma = (
      pis: { id: bigint; code: string }[],
      items: { productionInvoiceId: bigint; lsxCode: string }[],
    ) => ({
      productionInvoice: { findMany: jest.fn().mockResolvedValue(pis) },
      productionInvoiceItem: { findMany: jest.fn().mockResolvedValue(items) },
    });

    it('mảng rỗng: không gọi DB, trả Map rỗng', async () => {
      const prisma = makePrisma([], []);
      const r = await loadLenhDisplayCodes(prisma as never, []);
      expect(r.size).toBe(0);
      expect(prisma.productionInvoice.findMany).not.toHaveBeenCalled();
      expect(prisma.productionInvoiceItem.findMany).not.toHaveBeenCalled();
    });

    it('PI có LSX -> nối " + "; PI không dòng LSX -> mã PI; khoá là piId dạng chuỗi', async () => {
      const prisma = makePrisma(
        [
          { id: 1n, code: 'PI-2026-001' },
          { id: 2n, code: 'PI-2026-002' },
          { id: 3n, code: 'PI-2026-003' },
        ],
        [
          { productionInvoiceId: 1n, lsxCode: 'MY-313' },
          { productionInvoiceId: 1n, lsxCode: 'MY-314' },
          { productionInvoiceId: 3n, lsxCode: 'GP-176' },
        ],
      );
      const r = await loadLenhDisplayCodes(prisma as never, [1n, 2n, 3n]);
      expect(r.get('1')).toBe('MY-313 + MY-314');
      expect(r.get('2')).toBe('PI-2026-002');
      expect(r.get('3')).toBe('GP-176');
      expect(r.has('99')).toBe(false);
    });

    it('đúng 2 truy vấn, id trùng được gộp, dòng đọc theo id tăng dần và chỉ lấy dòng có LSX', async () => {
      const prisma = makePrisma([{ id: 5n, code: 'PI-5' }], []);
      await loadLenhDisplayCodes(prisma as never, [5n, 5n, 5n]);
      expect(prisma.productionInvoice.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.productionInvoiceItem.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.productionInvoice.findMany).toHaveBeenCalledWith({
        where: { id: { in: [5n] } },
        select: { id: true, code: true },
      });
      expect(prisma.productionInvoiceItem.findMany).toHaveBeenCalledWith({
        where: { productionInvoiceId: { in: [5n] }, lsxCode: { not: null } },
        select: { productionInvoiceId: true, lsxCode: true },
        orderBy: { id: 'asc' },
      });
    });
  });
});
