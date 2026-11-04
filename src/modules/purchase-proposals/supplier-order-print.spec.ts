import ExcelJS from 'exceljs';
import { buildPrintRows, PrintItemInput, renderPrintWorkbook } from './supplier-order-print';

const item = (overrides: Partial<PrintItemInput> = {}): PrintItemInput => ({
  materialCode: 'KHI-CO2',
  materialName: 'Khí CO2',
  spec: null,
  stockLengthMm: null,
  unit: 'bình',
  orderCode: 'PI-2026-031',
  buyQty: 2,
  purchaseQty: 2,
  ...overrides,
});

describe('buildPrintRows (bản v8 mục 7.8)', () => {
  it('gộp cùng vật tư qua nhiều lệnh, cột lệnh ghi "lệnh: số cần", thêm dòng mua dư', () => {
    const rows = buildPrintRows(
      [
        item({ orderCode: 'PI-2026-031', buyQty: 2 }),
        item({ orderCode: 'PI-2026-032', buyQty: 1, purchaseQty: 1 }),
        item({ orderCode: 'PI-2026-035', buyQty: 3, purchaseQty: 7 }),
      ],
      () => 0,
    );

    expect(rows).toEqual([
      {
        name: 'Khí CO2',
        unit: 'bình',
        stock: 0,
        normQty: 6,
        proposedQty: 6,
        orders: 'PI-2026-031: 2; PI-2026-032: 1; PI-2026-035: 3',
        note: 'KHI-CO2',
      },
      {
        name: 'Mua dư → nhập tồn',
        unit: 'bình',
        stock: null,
        normQty: null,
        proposedQty: 4,
        orders: '',
        note: 'KHI-CO2',
      },
    ]);
  });

  it('tách dòng theo quy cách / chiều dài cây, tên kèm chiều dài cây', () => {
    const rows = buildPrintRows(
      [
        item({
          materialCode: 'SAT-25',
          materialName: 'Sắt hộp',
          spec: '25x25',
          stockLengthMm: 6000,
          unit: 'cây',
        }),
        item({
          materialCode: 'SAT-25',
          materialName: 'Sắt hộp',
          spec: '25x25',
          stockLengthMm: 5800,
          unit: 'cây',
        }),
      ],
      () => 12,
    );

    expect(rows.map((r) => r.name)).toEqual([
      'Sắt hộp - 25x25 - cây 6000mm',
      'Sắt hộp - 25x25 - cây 5800mm',
    ]);
    expect(rows[0].stock).toBe(12);
  });
});

describe('renderPrintWorkbook', () => {
  const header = {
    supplierName: 'Kim Phát',
    orderCode: '53/2026',
    revision: 0,
    date: new Date('2026-11-04T03:00:00Z'),
    buyerName: 'Trần Nghi',
  };

  const load = async (buf: Buffer) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    return wb;
  };

  it('điền đúng mẫu: số đơn, người đề xuất, dòng vật tư; xoá STT thừa của dòng trống', async () => {
    const rows = buildPrintRows([item()], () => 5);
    const wb = await load(await renderPrintWorkbook(header, rows));
    const ws = wb.worksheets[0];

    expect(wb.worksheets).toHaveLength(1);
    expect(ws.getCell('A2').value).toBe('PHIẾU ĐỀ XUẤT');
    expect(ws.getCell('A3').value).toBe('Ngày 04 /11 /2026');
    expect(ws.getCell('A9').text).toContain('Kim Phát - Số 53/2026');
    expect(ws.getCell('A7').value).toBe('Nhân viên đề xuất: Trần Nghi');
    expect(ws.getCell('B12').value).toBe('Khí CO2');
    expect(ws.getCell('F12').value).toBe(2);
    expect(ws.getCell('G12').value).toBe('PI-2026-031: 2');
    expect(ws.getCell('A13').value).toBeNull();
    expect(ws.getCell('A36').value).toBe('Trần Nghi');
  });

  it('hơn 15 dòng thì sang trang 2, cùng số đơn; thay phiếu ghi trên tiêu đề', async () => {
    const items = Array.from({ length: 17 }, (_, i) =>
      item({ materialCode: `VT-${i}`, materialName: `Vật tư ${i}` }),
    );
    const wb = await load(
      await renderPrintWorkbook(
        { ...header, revision: 2 },
        buildPrintRows(items, () => 0),
      ),
    );

    expect(wb.worksheets.map((w) => w.name)).toEqual(['Trang 1', 'Trang 2']);
    const p2 = wb.worksheets[1];
    expect(p2.getCell('A2').value).toBe('PHIẾU ĐỀ XUẤT - THAY PHIẾU LẦN 2');
    expect(p2.getCell('A9').text).toContain('Số 53/2026 (trang 2/2)');
    expect(p2.getCell('A12').value).toBe(16);
    expect(p2.getCell('B13').value).toBe('Vật tư 16');
    expect(p2.getCell('A14').value).toBeNull();
  });
});
