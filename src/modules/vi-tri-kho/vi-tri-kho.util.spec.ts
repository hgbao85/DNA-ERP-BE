import { BadRequestException, ConflictException } from '@nestjs/common';
import { assertShipMatchesContainers } from './booking-ship-guard';
import { isViTriKhoEnabled } from './vi-tri-kho.config';
import { tokenFromScan } from './vi-tri-kho.read';
import {
  buildBulkLocations,
  buildLocation,
  compareLocationCode,
  containerCloseProblems,
  mixWarning,
  sameTriple,
  shipMismatches,
  suggestPicks,
} from './vi-tri-kho.util';

describe('vi-tri-kho util (V1-V9, thuần)', () => {
  describe('công tắc VI_TRI_KHO_ENABLED', () => {
    const prev = process.env.VI_TRI_KHO_ENABLED;
    afterEach(() => {
      if (prev === undefined) delete process.env.VI_TRI_KHO_ENABLED;
      else process.env.VI_TRI_KHO_ENABLED = prev;
    });
    it('mặc định tắt, chỉ "true" (không phân biệt hoa / khoảng trắng) là bật, đọc mỗi lần gọi', () => {
      delete process.env.VI_TRI_KHO_ENABLED;
      expect(isViTriKhoEnabled()).toBe(false);
      process.env.VI_TRI_KHO_ENABLED = ' TRUE ';
      expect(isViTriKhoEnabled()).toBe(true);
      process.env.VI_TRI_KHO_ENABLED = '1';
      expect(isViTriKhoEnabled()).toBe(false);
    });
  });

  it('V1: mã ô khu-dãy-ô, dãy / ô 2 chữ số, khu in hoa', () => {
    expect(buildLocation({ zone: ' a ', aisle: 1, slot: '2' })).toEqual({
      zone: 'A',
      aisle: '01',
      slot: '02',
      code: 'A-01-02',
    });
    expect(buildLocation({ zone: 'A-B', aisle: 1, slot: 1 })).toMatch(/Khu/);
    expect(buildLocation({ zone: 'A', aisle: 0, slot: 1 })).toMatch(/Dãy/);
    expect(buildLocation({ zone: 'A', aisle: 1, slot: 100 })).toMatch(/Ô/);
  });

  it('V1: khai hàng loạt khu A dãy 01-03 ô 01-10 = 30 ô theo dãy rồi ô; sai khoảng / quá 500 ô báo lỗi', () => {
    const list = buildBulkLocations({
      zone: 'A',
      aisleFrom: 1,
      aisleTo: 3,
      slotFrom: 1,
      slotTo: 10,
    });
    expect(Array.isArray(list) && list.length).toBe(30);
    if (!Array.isArray(list)) throw new Error('unreachable');
    expect(list[0].code).toBe('A-01-01');
    expect(list[10].code).toBe('A-02-01');
    expect(list[29].code).toBe('A-03-10');
    expect(
      buildBulkLocations({ zone: 'A', aisleFrom: 3, aisleTo: 1, slotFrom: 1, slotTo: 1 }),
    ).toMatch(/Dãy "từ"/);
    expect(
      buildBulkLocations({ zone: 'A', aisleFrom: 1, aisleTo: 99, slotFrom: 1, slotTo: 99 }),
    ).toMatch(/tối đa 500/);
  });

  it('V6: gợi ý lấy theo mã ô ổn định (A-01-02 trước A-01-10), lấy hết ô trước, báo thiếu', () => {
    expect(compareLocationCode('A-01-02', 'A-01-10')).toBeLessThan(0);
    const r = suggestPicks(7, [
      { locationId: '3', code: 'A-01-10', qty: 5 },
      { locationId: '1', code: 'A-01-02', qty: 4 },
      { locationId: '9', code: 'B-01-01', qty: 0 },
      { locationId: '2', code: 'A-02-01', qty: 6 },
    ]);
    expect(r.rows.map((x) => [x.code, x.suggestedQty])).toEqual([
      ['A-01-02', 4],
      ['A-01-10', 3],
      ['A-02-01', 0],
    ]);
    expect(r.shortQty).toBe(0);
    expect(suggestPicks(20, [{ locationId: '1', code: 'A-01-01', qty: 5 }]).shortQty).toBe(15);
    expect(
      suggestPicks(0, [{ locationId: '1', code: 'A-01-01', qty: 5 }]).rows[0].suggestedQty,
    ).toBe(0);
  });

  it('V9: bộ 3 khác nhau khi chỉ khác PO (cùng SKU, cùng lệnh)', () => {
    const a = { productionInvoiceItemId: 1n, mfgProductId: 5n, salesOrderItemId: 7n };
    expect(sameTriple(a, { ...a })).toBe(true);
    expect(sameTriple(a, { ...a, salesOrderItemId: 8n })).toBe(false);
    expect(sameTriple(a, { ...a, salesOrderItemId: null })).toBe(false);
    expect(sameTriple({ ...a, salesOrderItemId: null }, { ...a, salesOrderItemId: null })).toBe(
      true,
    );
  });

  it('V3: nhắc khi ô có bộ 3 khác (tối đa 3 dòng + "và N loại khác"), ô trống không nhắc', () => {
    expect(mixWarning('A-01-01', [])).toBeNull();
    expect(
      mixWarning('A-01-01', [{ lenhCode: 'MY-1', sku: 'S', poCode: null, qty: 0 }]),
    ).toBeNull();
    const w = mixWarning(
      'A-01-01',
      [1, 2, 3, 4].map((i) => ({ lenhCode: `MY-${i}`, sku: 'S', poCode: `PO${i}`, qty: i })),
    );
    expect(w).toMatch(/Ô A-01-01 đang có hàng khác: lệnh MY-1 · SKU S · PO PO1 \(1 bộ\)/);
    expect(w).toMatch(/và 1 loại khác/);
  });

  it('V7: đóng cont cần số cont, seal, ≥ 1 ảnh, ≥ 1 bộ', () => {
    expect(
      containerCloseProblems({ containerNo: ' ', sealNo: null, photoUrls: [' '], totalQty: 0 }),
    ).toEqual([
      'nhập số cont',
      'nhập số seal',
      'chụp ít nhất 1 ảnh load cont',
      'cont chưa có hàng',
    ]);
    expect(
      containerCloseProblems({ containerNo: 'MSKU1', sealNo: 'S1', photoUrls: ['u'], totalQty: 1 }),
    ).toEqual([]);
  });

  it('xuất booking: số thực xuất từng dòng phải bằng hàng đã đóng cont', () => {
    const lines = [
      { id: '1', label: 'SKU A' },
      { id: '2', label: 'SKU B' },
    ];
    expect(shipMismatches(lines, new Map([['1', 5]]), new Map([['1', 5]]))).toEqual([]);
    expect(
      shipMismatches(
        lines,
        new Map([['1', 5]]),
        new Map([
          ['1', 4],
          ['2', 1],
        ]),
      ),
    ).toEqual([
      'SKU A: đã đóng cont 5 bộ, đang xuất 4 bộ',
      'SKU B: đã đóng cont 0 bộ, đang xuất 1 bộ',
    ]);
  });

  it('tem ô: nhận nguyên link /floor?loc= hoặc token', () => {
    expect(tokenFromScan(' https://erp.x/floor?loc=abc_1 ')).toBe('abc_1');
    expect(tokenFromScan('abc_1')).toBe('abc_1');
    expect(tokenFromScan('https://erp.x/floor?ws=zz')).toBe('https://erp.x/floor?ws=zz');
  });

  describe('assertShipMatchesContainers', () => {
    const prev = process.env.VI_TRI_KHO_ENABLED;
    afterEach(() => {
      if (prev === undefined) delete process.env.VI_TRI_KHO_ENABLED;
      else process.env.VI_TRI_KHO_ENABLED = prev;
    });
    const booking = {
      id: 1n,
      bookingNo: 'BK1',
      lines: [{ id: 10n, productionInvoiceItem: { mfgProduct: { factoryCode: 'A' } } }],
    };
    const tx = (containers: unknown[]) => ({
      bookingContainer: { findMany: jest.fn().mockResolvedValue(containers) },
    });

    it('tắt công tắc: không đọc gì, không chặn', async () => {
      process.env.VI_TRI_KHO_ENABLED = 'false';
      const t = tx([]);
      await expect(
        assertShipMatchesContainers(t as never, booking, new Map()),
      ).resolves.toBeUndefined();
      expect(t.bookingContainer.findMany).not.toHaveBeenCalled();
    });

    it('bật: chưa có cont / còn cont mở / lệch số -> chặn; khớp -> qua', async () => {
      process.env.VI_TRI_KHO_ENABLED = 'true';
      const want = new Map([['10', 3]]);
      await expect(
        assertShipMatchesContainers(tx([]) as never, booking, want),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        assertShipMatchesContainers(
          tx([{ containerNo: 'C1', status: 'OPEN', lines: [] }]) as never,
          booking,
          want,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      const loaded = [
        { containerNo: 'C1', status: 'LOADED', lines: [{ bookingLineId: 10n, qty: 2 }] },
        { containerNo: 'C2', status: 'LOADED', lines: [{ bookingLineId: 10n, qty: 1 }] },
      ];
      await expect(
        assertShipMatchesContainers(tx(loaded) as never, booking, want),
      ).resolves.toBeUndefined();
      await expect(
        assertShipMatchesContainers(tx(loaded) as never, booking, new Map([['10', 2]])),
      ).rejects.toThrow(/đã đóng cont 3 bộ, đang xuất 2 bộ/);
    });
  });
});
