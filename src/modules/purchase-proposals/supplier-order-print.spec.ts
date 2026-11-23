import ExcelJS from 'exceljs';
import {
  buildPrintRows,
  PrintItemInput,
  renderPrintWorkbook,
  wrappedLineCount,
} from './supplier-order-print';

const item = (overrides: Partial<PrintItemInput> = {}): PrintItemInput => ({
  materialCode: 'KHI-CO2',
  materialName: 'Khí CO2',
  spec: null,
  stockLengthMm: null,
  unit: 'bình',
  orderCode: 'PI-2026-031',
  buyQty: 2,
  purchaseQty: 2,
  actualStock: 0,
  requiredQty: 2,
  wastePct: 0,
  ...overrides,
});

describe('buildPrintRows (bản v8 mục 7.8, 3 cột số theo anh chốt 23/11)', () => {
  it('gộp cùng vật tư qua nhiều lệnh: định mức cộng theo lệnh, đề xuất = số đặt mua (gồm mua dư), cột lệnh ghi số đề xuất', () => {
    const rows = buildPrintRows([
      item({ orderCode: 'PI-2026-031', buyQty: 2, requiredQty: 2 }),
      item({ orderCode: 'PI-2026-032', buyQty: 1, purchaseQty: 1, requiredQty: 1 }),
      item({ orderCode: 'PI-2026-035', buyQty: 3, purchaseQty: 7, requiredQty: 3 }),
    ]);

    expect(rows).toEqual([
      {
        name: 'Khí CO2',
        unit: 'bình',
        stock: 0,
        normQty: 6,
        proposedQty: 10,
        orders: 'PI-2026-031: 2; PI-2026-032: 1; PI-2026-035: 7',
        note: '',
      },
    ]);
  });

  it('tồn = tồn LÚC TÍNH (lớn nhất, không cộng); định mức chưa trừ tồn; hao hụt ghi vào ghi chú', () => {
    // Định mức 100, lúc tính tồn 30, hao hụt 2%: cần mua = 100×1.02 − 30 = 72.
    const rows = buildPrintRows([
      item({ requiredQty: 100, actualStock: 30, buyQty: 72, purchaseQty: 72, wastePct: 2 }),
    ]);
    expect(rows[0]).toMatchObject({
      stock: 30,
      normQty: 100,
      proposedQty: 72,
      note: 'Hao hụt 2%: +2',
    });
  });

  it('dòng cũ chưa lưu định mức: suy từ cần mua ÷ (1 + hao hụt) (Sơn bột PB NCC Sơn 1/2026: 20.3 → 20)', () => {
    const rows = buildPrintRows([
      item({
        materialCode: 'VTK-004',
        requiredQty: null,
        buyQty: 20.3,
        purchaseQty: 20.3,
        wastePct: 1.5,
      }),
    ]);
    expect(rows[0]).toMatchObject({
      stock: 0,
      normQty: 20,
      proposedQty: 20.3,
      note: 'Hao hụt 1.5%: +0.3',
    });
  });

  it('2 dòng CÙNG lệnh (dòng đã ký + dòng phần thêm) không cộng trùng định mức', () => {
    const rows = buildPrintRows([
      item({ orderCode: 'L1', requiredQty: 10, buyQty: 6, purchaseQty: 6 }),
      item({ orderCode: 'L1', requiredQty: 10, buyQty: 4, purchaseQty: 4 }),
    ]);
    expect(rows[0]).toMatchObject({ normQty: 10, proposedQty: 10, orders: 'L1: 10' });
  });

  it('tách dòng theo quy cách / chiều dài cây, tên kèm chiều dài cây', () => {
    const rows = buildPrintRows([
      item({
        materialCode: 'SAT-25',
        materialName: 'Sắt hộp',
        spec: '25x25',
        stockLengthMm: 6000,
        unit: 'cây',
        actualStock: 12,
      }),
      item({
        materialCode: 'SAT-25',
        materialName: 'Sắt hộp',
        spec: '25x25',
        stockLengthMm: 5800,
        unit: 'cây',
      }),
    ]);

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
    const rows = buildPrintRows([item()]);
    const wb = await load(await renderPrintWorkbook(header, rows));
    const ws = wb.worksheets[0];

    expect(wb.worksheets).toHaveLength(1);
    // Bố cục theo ảnh mẫu phiếu thật (23/11/2026).
    expect(ws.getCell('A3').value).toBe('PHIẾU ĐỀ XUẤT');
    expect(ws.getCell('A4').value).toBe('Ngày 04/11/2026');
    expect(ws.getCell('A6').value).toBe('Kính gửi:');
    expect(ws.getCell('C6').value).toBe('- Giám đốc Công ty TNHH DV XNK Đông Nam Á');
    expect(ws.getCell('C7').value).toBeNull();
    expect(ws.getCell('A8').value).toBe('Nhân viên đề xuất:');
    expect(ws.getCell('C8').value).toBe('Trần Nghi');
    expect(ws.getCell('A9').value).toBe('Thuộc bộ phận:');
    expect(ws.getCell('C9').value).toBe('Mua hàng');
    expect(ws.getCell('A10').text).toContain('Kim Phát - Số 53/2026');
    expect(ws.getCell('B12').value).toBe('Tên vật tư, hàng hóa, thiết bị, kích thước,');
    expect(ws.getCell('B13').value).toBe('Khí CO2');
    expect(ws.getCell('F13').value).toBe(2);
    expect(ws.getCell('G13').value).toBe('PI-2026-031: 2');
    expect(ws.getCell('A14').value).toBeNull();
    expect(ws.getCell('A36').value).toBe('Trần Nghi');
  });

  it('hơn 15 dòng thì sang trang 2, cùng số đơn; thay phiếu ghi trên tiêu đề', async () => {
    const items = Array.from({ length: 17 }, (_, i) =>
      item({ materialCode: `VT-${i}`, materialName: `Vật tư ${i}` }),
    );
    const wb = await load(
      await renderPrintWorkbook({ ...header, revision: 2 }, buildPrintRows(items)),
    );

    expect(wb.worksheets.map((w) => w.name)).toEqual(['Trang 1', 'Trang 2']);
    const p2 = wb.worksheets[1];
    expect(p2.getCell('A3').value).toBe('PHIẾU ĐỀ XUẤT - THAY PHIẾU LẦN 2');
    expect(p2.getCell('A10').text).toContain('Số 53/2026 (trang 2/2)');
    expect(p2.getCell('A13').value).toBe(16);
    expect(p2.getCell('B14').value).toBe('Vật tư 16');
    expect(p2.getCell('A15').value).toBeNull();
  });

  it('23/11: ô tự xuống dòng (nhiều lệnh, tên dài) thì nâng chiều cao hàng; hàng 1 dòng giữ chiều cao mẫu', async () => {
    const rows = buildPrintRows([
      item({
        materialCode: 'VT-A',
        orderCode: 'PBG-1 + PBG-2',
        materialName:
          'Logo Patiojoy chữ khắc (gắn tựa) đối với hàng đi tất cả các nước, trừ Anh, Đức',
      }),
      item({ materialCode: 'VT-B', materialName: 'Khí' }),
    ]);
    // Hàng 2 ngắn gọn: bỏ cột lệnh để chắc chắn chỉ 1 dòng.
    rows[1].orders = 'P1';
    const ws = (await load(await renderPrintWorkbook(header, rows))).worksheets[0];

    // Cột lệnh nay rộng 25 như mẫu: chữ ngắn thì 1 dòng - dùng tên vật tư dài để buộc xuống dòng.
    expect(ws.getCell('G13').text).toBe('PBG-1 + PBG-2: 2');
    expect(ws.getRow(13).height).toBeGreaterThan(24);
    expect(ws.getRow(14).height).toBe(24);
  });

  // 23/11/2026: file tải về mở bằng Excel ra trắng - exceljs ghi <pageSetUpPr> TRƯỚC <outlinePr> trong <sheetPr> (sai thứ tự
  // chuẩn OOXML), Excel coi file hỏng. exceljs đọc lại vẫn được nên test trên không bắt được: phải soi XML thô.
  it('<sheetPr> của mọi trang đúng thứ tự Excel đòi (outlinePr trước pageSetUpPr), vẫn giữ "vừa 1 trang ngang"', async () => {
    const items = Array.from({ length: 17 }, (_, i) =>
      item({ materialCode: `VT-${i}`, materialName: `Vật tư ${i}` }),
    );
    const buf = await renderPrintWorkbook(header, buildPrintRows(items));
    // jszip là phụ thuộc của exceljs (không khai riêng ở package.json) - lấy qua đường của exceljs.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const JSZip = require(require.resolve('jszip', { paths: [require.resolve('exceljs')] })) as {
      loadAsync(b: Buffer): Promise<{
        files: Record<string, { async(t: 'string'): Promise<string> }>;
      }>;
    };
    const zip = await JSZip.loadAsync(buf);
    const sheets = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
    expect(sheets).toHaveLength(2);
    for (const name of sheets) {
      const xml = await zip.files[name].async('string');
      const sheetPr = /<sheetPr[^>]*>(.*?)<\/sheetPr>/.exec(xml)?.[1] ?? '';
      const outline = sheetPr.indexOf('<outlinePr');
      const pageSetUp = sheetPr.indexOf('<pageSetUpPr');
      if (outline >= 0 && pageSetUp >= 0) expect(outline).toBeLessThan(pageSetUp);
      expect(sheetPr).toContain('fitToPage="1"');
    }
  });
});

describe('wrappedLineCount (23/11)', () => {
  it('ngắt theo từ như Excel, chừa 1 ký tự lề', () => {
    expect(wrappedLineCount('', 12)).toBe(1);
    expect(wrappedLineCount('VTK-004', 12)).toBe(1);
    // Cột lệnh rộng 12: "PBG-1 +" / "PBG-2: 20.3"
    expect(wrappedLineCount('PBG-1 + PBG-2: 20.3', 12)).toBe(2);
    expect(wrappedLineCount('PI-2026-031: 3; PI-2026-032: 1', 12)).toBe(4);
  });

  it('từ dài hơn cả dòng thì cắt ngang; xuống dòng sẵn trong chữ được tính', () => {
    expect(wrappedLineCount('ABCDEFGHIJKLMNOPQRSTUVW', 12)).toBe(3);
    expect(wrappedLineCount('a\nb', 12)).toBe(2);
  });
});
