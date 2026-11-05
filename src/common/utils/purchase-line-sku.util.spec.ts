import {
  PurchaseLineChoice,
  choiceMaterialIds,
  purchaseLineMatcher,
  purchaseLineUsedBy,
} from './purchase-line-sku.util';

const sku = (
  id: number,
  pi: number | null,
  wire: number | null = null,
  cushion: number | null = null,
): PurchaseLineChoice => ({
  id: BigInt(id),
  productionInvoiceId: pi == null ? null : BigInt(pi),
  wireMaterialId: wire == null ? null : BigInt(wire),
  cushionMaterialId: cushion == null ? null : BigInt(cushion),
});

describe('purchase-line-sku.util', () => {
  // PI 1: SKU 10 dùng dây 100 + nệm 200, SKU 11 dùng dây 101, SKU 12 (đã Kết thúc, không còn trên bảng) dùng nệm 201.
  const a = sku(10, 1, 100, 200);
  const b = sku(11, 1, 101);
  const c = sku(12, 1, null, 201);
  const other = sku(20, 2, 102);
  const approved = [a, b, c, other];

  it('choiceMaterialIds bỏ null, trả chuỗi', () => {
    expect(choiceMaterialIds(a)).toEqual(['100', '200']);
    expect(choiceMaterialIds(sku(1, 1))).toEqual([]);
  });

  it('vật tư dùng chung (sắt, đinh) thuộc mọi dòng SKU của PI', () => {
    for (const s of [a, b, c]) expect(purchaseLineUsedBy(s, '999', approved)).toBe(true);
  });

  it('dây / nệm của chính mình thì thuộc; của dòng khác trong PI thì không', () => {
    expect(purchaseLineUsedBy(a, '100', approved)).toBe(true);
    expect(purchaseLineUsedBy(a, '200', approved)).toBe(true);
    expect(purchaseLineUsedBy(a, '101', approved)).toBe(false);
    expect(purchaseLineUsedBy(b, '100', approved)).toBe(false);
    expect(purchaseLineUsedBy(b, '101', approved)).toBe(true);
  });

  it('dây riêng của dòng đã Kết thúc vẫn không bị tính sang dòng còn chạy', () => {
    expect(purchaseLineUsedBy(a, '201', approved)).toBe(false);
    expect(purchaseLineUsedBy(b, '201', approved)).toBe(false);
  });

  it('lựa chọn của PI khác không ảnh hưởng', () => {
    expect(purchaseLineUsedBy(a, '102', approved)).toBe(true);
  });

  it('cùng vật tư được cả hai dòng chọn: cả hai đều thuộc', () => {
    const x = sku(30, 3, 300);
    const y = sku(31, 3, 300);
    expect(purchaseLineUsedBy(x, '300', [x, y])).toBe(true);
    expect(purchaseLineUsedBy(y, '300', [x, y])).toBe(true);
  });

  it('matcher dựng 1 lần dùng nhiều lần, id dạng chuỗi hay bigint đều được', () => {
    const m = purchaseLineMatcher({ ...a, id: '10', productionInvoiceId: '1' }, approved);
    expect(m('101')).toBe(false);
    expect(m('100')).toBe(true);
  });
});
