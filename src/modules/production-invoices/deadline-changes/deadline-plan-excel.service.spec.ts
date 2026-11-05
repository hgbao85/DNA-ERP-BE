/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/require-await, @typescript-eslint/no-base-to-string -- prisma/port/response mock */
import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { DeadlineChangesPort } from './deadline-changes.port';
import { DEADLINE_FIELDS, DeadlineEntryCheck, DeadlineEntryInput } from './deadline-changes.types';
import {
  DeadlinePlanExcelService,
  dayToExcelDate,
  parseDateCell,
  planFileStamp,
} from './deadline-plan-excel.service';

const COL = { lenh: 1, sku: 2, status: 6, first: 7, itemId: 19, json: 20 };
const colOf = (key: string) => COL.first + DEADLINE_FIELDS.findIndex((f) => f.key === key);

const d = (s: string) => new Date(`${s}T00:00:00+07:00`);

function makeItem(over: Record<string, any> = {}) {
  return {
    id: 101n,
    productionInvoiceId: 1n,
    lsxCode: 'MY-313',
    quantity: 50,
    prodApprovalStatus: 'APPROVED',
    materialDeadline: d('2026-11-10'),
    finishedMaterialDeadline: d('2026-12-01'),
    deliveryDeadline: d('2026-12-20'),
    mfgProduct: { factoryCode: 'J55', name: 'Ghế J55' },
    workshop: { name: 'Xưởng 1' },
    stages: [
      { stageType: 'PHOI_START', deadline: d('2026-11-11') },
      { stageType: 'FRAME_PHOI', deadline: d('2026-11-12') },
      { stageType: 'FRAME_HAN', deadline: d('2026-11-13') },
      { stageType: 'FRAME_SON', deadline: d('2026-11-14') },
      { stageType: 'FRAME', deadline: d('2026-11-15') },
      { stageType: 'WEAVING', deadline: d('2026-11-16') },
      { stageType: 'TRANSFER_CHECK', deadline: d('2026-11-17') },
      { stageType: 'PACKAGING_START', deadline: d('2026-11-18') },
      { stageType: 'PACKAGING', deadline: d('2026-11-19') },
    ],
    productionInvoice: { deadline: null },
    ...over,
  };
}

function setup(items: any[], pendingIds: string[] = []) {
  const itemFindMany = jest.fn(async (args: any) => {
    // loadLenhDisplayCodes hỏi theo lsxCode; truy vấn export hỏi theo trạng thái.
    if (args?.where?.lsxCode) {
      return items
        .filter((i) => i.lsxCode)
        .map((i) => ({ productionInvoiceId: i.productionInvoiceId, lsxCode: i.lsxCode }));
    }
    return items;
  });
  const prisma = {
    productionInvoiceItem: { findMany: itemFindMany },
    productionInvoice: {
      findMany: jest.fn(async () =>
        [...new Set(items.map((i) => i.productionInvoiceId))].map((id) => ({
          id,
          code: `PI-2026-${String(id)}`,
        })),
      ),
    },
  };
  const port = {
    previewEntries: jest.fn(async (entries: DeadlineEntryInput[]): Promise<DeadlineEntryCheck[]> =>
      entries.map((e) => ({
        itemId: e.itemId,
        lenhCode: 'MY-313',
        skuCode: 'J55',
        kind: 'NEEDS_APPROVAL' as const,
        changes: [],
        errors: [],
        warnings: [],
      })),
    ),
    saveEntries: jest.fn(),
    pendingByItem: jest.fn(async () => new Map(pendingIds.map((id) => [id, { requestId: 'r1' }]))),
  };
  const service = new DeadlinePlanExcelService(
    prisma as any,
    port as unknown as DeadlineChangesPort,
  );
  return { service, prisma, port, itemFindMany };
}

async function editWorkbook(
  buffer: Buffer,
  fn: (ws: ExcelJS.Worksheet, wb: ExcelJS.Workbook) => void,
) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  fn(wb.getWorksheet('Kế hoạch')!, wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('DeadlinePlanExcelService - xuất', () => {
  it('tên file theo giờ VN và đúng bố cục cột / ẩn / dấu file', async () => {
    const { service } = setup([makeItem()]);
    const now = new Date('2026-11-05T17:30:00Z'); // 00:30 06/11 giờ VN
    const { fileName, buffer } = await service.exportPlan('all', now);
    expect(fileName).toBe('ke-hoach-san-xuat-20261106-0030.xlsx');
    expect(planFileStamp(now)).toBe('20261106-0030');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const ws = wb.getWorksheet('Kế hoạch')!;
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(ws.getRow(1).values).toEqual(
      expect.arrayContaining(['Mã lệnh', 'SKU', 'Phôi', 'Mua VT còn lại', 'Hạn giao (chỉ xem)']),
    );
    expect(ws.getCell(1, colOf('stage.FRAME_PHOI')).value).toBe('Phôi');
    expect(ws.getCell(2, COL.lenh).value).toBe('MY-313');
    expect(ws.getCell(2, COL.status).value).toBe('Đã duyệt – sửa cần Sếp duyệt lại');
    expect(ws.getColumn(COL.itemId).hidden).toBe(true);
    expect(ws.getColumn(COL.json).hidden).toBe(true);
    expect(ws.getCell(2, COL.itemId).value).toBe('101');
    expect(ws.getCell(2, colOf('stage.FRAME_PHOI')).numFmt).toBe('dd/mm/yyyy');
    expect((ws as any).sheetProtection?.sheet).toBe(true);
    // Ô mốc mở khoá, ô SKU khoá.
    expect(ws.getCell(2, colOf('materialDeadline')).protection?.locked).toBe(false);
    expect(ws.getCell(2, COL.sku).protection?.locked ?? true).toBe(true);

    const marker = wb.getWorksheet('_dna')!;
    expect(marker.state).toBe('hidden');
    expect(JSON.parse(String(marker.getCell('A1').value))).toMatchObject({
      kind: 'dna-erp-deadline-plan',
      v: 1,
    });
  });

  it('chưa có LSX thì dùng mã lệnh hiển thị (không mã PI khi PI có LSX khác); dòng chờ duyệt bị khoá hết', async () => {
    const a = makeItem({ id: 5n, lsxCode: null, productionInvoiceId: 7n });
    const b = makeItem({ id: 6n, lsxCode: 'AA-1', productionInvoiceId: 8n });
    const { service, port } = setup([a, b], ['5']);
    const { buffer } = await service.exportPlan('all');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const ws = wb.getWorksheet('Kế hoạch')!;
    // Xếp theo mã lệnh: 'AA-1' trước 'PI-2026-7'.
    expect(ws.getCell(2, COL.lenh).value).toBe('AA-1');
    expect(ws.getCell(3, COL.lenh).value).toBe('PI-2026-7');
    expect(ws.getCell(3, COL.status).value).toBe('Đang chờ Sếp duyệt lại – không sửa được');
    expect(ws.getCell(3, colOf('stage.FRAME')).protection?.locked ?? true).toBe(true);
    expect(ws.getCell(2, colOf('stage.FRAME')).protection?.locked).toBe(false);
    expect(port.pendingByItem).toHaveBeenCalledWith([5n, 6n]);
  });

  it('dòng chưa duyệt ghi "Chưa duyệt"; scope=approved lọc theo prodApprovalStatus', async () => {
    const { service, itemFindMany } = setup([makeItem({ prodApprovalStatus: 'WAITING_BOSS' })]);
    const all = await service.exportPlan('all');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(all.buffer as any);
    expect(wb.getWorksheet('Kế hoạch')!.getCell(2, COL.status).value).toBe('Chưa duyệt');
    expect(itemFindMany.mock.calls[0][0].where.prodApprovalStatus).toBeUndefined();

    await service.exportPlan('approved');
    const approvedCall = itemFindMany.mock.calls.find(
      (c) => c[0].where.prodApprovalStatus === 'APPROVED',
    );
    expect(approvedCall).toBeDefined();
    // Điều kiện chung vẫn còn: PI không huỷ, lệnh chưa Kết thúc.
    expect(approvedCall![0].where.productionInvoice).toEqual({
      is: { status: { not: 'CANCELLED' } },
    });
    expect(JSON.stringify(approvedCall![0].where.AND)).toContain('FINISHED');
  });
});

describe('DeadlinePlanExcelService - xem trước', () => {
  it('xuất rồi đọc lại không sửa gì = 0 dòng đổi, không gọi cổng', async () => {
    const { service, port } = setup([makeItem(), makeItem({ id: 102n, lsxCode: 'MY-314' })]);
    const { buffer } = await service.exportPlan('all');
    const res = await service.preview(buffer, 'a.xlsx');
    expect(res.totalRows).toBe(2);
    expect(res.counts).toEqual({ apply: 0, needsApproval: 0, noChange: 2, error: 0 });
    expect(res.rows).toEqual([]);
    expect(res.commitPayload).toEqual({ fileName: 'a.xlsx', items: [] });
    expect(port.previewEntries).not.toHaveBeenCalled();
  });

  it('sửa 1 ô = đúng 1 entry với expectedOld là giá trị lúc xuất; ô trống = giữ nguyên', async () => {
    const { service, port } = setup([makeItem(), makeItem({ id: 102n, lsxCode: 'MY-314' })]);
    const { buffer } = await service.exportPlan('all');
    const edited = await editWorkbook(buffer, (ws) => {
      ws.getCell(2, colOf('stage.FRAME_HAN')).value = dayToExcelDate('2026-11-20');
      ws.getCell(3, colOf('stage.FRAME_SON')).value = null; // xoá ô = giữ nguyên
    });
    const res = await service.preview(edited, 'b.xlsx');
    expect(port.previewEntries).toHaveBeenCalledTimes(1);
    const sent = port.previewEntries.mock.calls[0][0];
    expect(sent).toEqual([
      {
        itemId: '101',
        newValues: { 'stage.FRAME_HAN': '2026-11-20' },
        expectedOld: { 'stage.FRAME_HAN': '2026-11-13' },
      },
    ]);
    expect(res.counts).toMatchObject({ needsApproval: 1, noChange: 1, error: 0 });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({ rowNumber: 2, itemId: '101', kind: 'NEEDS_APPROVAL' });
    expect(res.commitPayload.items).toEqual(sent);
  });

  it('dòng cổng báo ERROR thì không vào commitPayload; cảnh báo ở dòng không đổi vẫn hiện', async () => {
    const { service, port } = setup([makeItem()]);
    port.previewEntries.mockImplementationOnce(async (entries: DeadlineEntryInput[]) => [
      {
        itemId: entries[0].itemId,
        lenhCode: 'MY-313',
        skuCode: 'J55',
        kind: 'ERROR' as const,
        changes: [],
        errors: ['lệnh đã Kết thúc'],
        warnings: [],
      },
    ]);
    const { buffer } = await service.exportPlan('all');
    const edited = await editWorkbook(buffer, (ws) => {
      ws.getCell(2, colOf('materialDeadline')).value = dayToExcelDate('2026-11-01');
    });
    const res = await service.preview(edited, 'c.xlsx');
    expect(res.counts.error).toBe(1);
    expect(res.commitPayload.items).toEqual([]);
    expect(res.rows[0].errors).toEqual(['lệnh đã Kết thúc']);
  });

  it('đọc được chuỗi d/m/yyyy, dd/mm/yyyy, yyyy-mm-dd và số serial Excel', async () => {
    const { service, port } = setup([makeItem()]);
    const { buffer } = await service.exportPlan('all');
    const edited = await editWorkbook(buffer, (ws) => {
      ws.getCell(2, colOf('materialDeadline')).value = '1/12/2026';
      ws.getCell(2, colOf('stage.PHOI_START')).value = '02/12/2026';
      ws.getCell(2, colOf('stage.FRAME_PHOI')).value = '2026-12-03';
      ws.getCell(2, colOf('stage.FRAME_HAN')).value = 46360; // serial của 04/12/2026
    });
    await service.preview(edited, 'd.xlsx');
    const nv = port.previewEntries.mock.calls[0][0][0].newValues;
    expect(nv).toEqual({
      materialDeadline: '2026-12-01',
      'stage.PHOI_START': '2026-12-02',
      'stage.FRAME_PHOI': '2026-12-03',
      'stage.FRAME_HAN': '2026-12-04',
    });
  });

  it('parseDateCell: serial 61 = 01/03/1900, sai ngày / ký tự lạ = bad, trống = empty', () => {
    expect(parseDateCell(46360)).toEqual({ kind: 'ok', day: '2026-12-04' });
    expect(parseDateCell(null)).toEqual({ kind: 'empty' });
    expect(parseDateCell('  ')).toEqual({ kind: 'empty' });
    expect(parseDateCell('31/02/2026')).toEqual({ kind: 'bad', raw: '31/02/2026' });
    expect(parseDateCell('abc')).toEqual({ kind: 'bad', raw: 'abc' });
    expect(parseDateCell({ formula: 'A1', result: new Date(Date.UTC(2026, 10, 10)) })).toEqual({
      kind: 'ok',
      day: '2026-11-10',
    });
    expect(parseDateCell({ richText: [{ text: '10/11/' }, { text: '2026' }] })).toEqual({
      kind: 'ok',
      day: '2026-11-10',
    });
  });

  it('ô sai ngày = lỗi dòng, không gọi cổng cho dòng đó', async () => {
    const { service, port } = setup([makeItem()]);
    const { buffer } = await service.exportPlan('all');
    const edited = await editWorkbook(buffer, (ws) => {
      ws.getCell(2, colOf('stage.FRAME_PHOI')).value = 'abc';
    });
    const res = await service.preview(edited, 'e.xlsx');
    expect(res.counts.error).toBe(1);
    expect(res.rows[0].errors).toEqual(["ô Phôi không phải ngày hợp lệ: 'abc'"]);
    expect(port.previewEntries).not.toHaveBeenCalled();
  });

  it('thiếu dấu _dna / file không phải xlsx / dấu sai => 400', async () => {
    const { service } = setup([makeItem()]);
    const { buffer } = await service.exportPlan('all');

    const noMarker = await editWorkbook(buffer, (_ws, wb) => {
      wb.removeWorksheet(wb.getWorksheet('_dna')!.id);
    });
    await expect(service.preview(noMarker, 'x.xlsx')).rejects.toThrow(
      'Không phải file kế hoạch tải từ hệ thống',
    );

    const wrongKind = await editWorkbook(buffer, (_ws, wb) => {
      wb.getWorksheet('_dna')!.getCell('A1').value = JSON.stringify({ kind: 'khac', v: 1 });
    });
    await expect(service.preview(wrongKind, 'x.xlsx')).rejects.toBeInstanceOf(BadRequestException);

    await expect(service.preview(Buffer.from('hello world'), 'x.xlsx')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('mã dòng thiếu / hỏng JSON / trùng => lỗi dòng', async () => {
    const { service, port } = setup([
      makeItem(),
      makeItem({ id: 102n, lsxCode: 'MY-314' }),
      makeItem({ id: 103n, lsxCode: 'MY-315' }),
      makeItem({ id: 104n, lsxCode: 'MY-316' }),
    ]);
    const { buffer } = await service.exportPlan('all');
    const edited = await editWorkbook(buffer, (ws) => {
      ws.getCell(2, COL.itemId).value = null; // thiếu mã dòng
      ws.getCell(3, COL.json).value = '{không phải json'; // hỏng
      ws.getCell(5, COL.itemId).value = '103'; // trùng dòng 4
    });
    const res = await service.preview(edited, 'f.xlsx');
    expect(res.counts.error).toBe(4);
    const byRow = new Map(res.rows.map((r) => [r.rowNumber, r]));
    expect(byRow.get(2)!.errors[0]).toMatch(/^dòng không có mã dòng/);
    expect(byRow.get(3)!.errors[0]).toMatch(/giá trị lúc xuất/);
    expect(byRow.get(4)!.errors[0]).toMatch(/trùng ở các dòng 4, 5/);
    expect(byRow.get(5)!.errors[0]).toMatch(/trùng ở các dòng 4, 5/);
    expect(port.previewEntries).not.toHaveBeenCalled();
  });

  it('quá 2.000 dòng => 400; file quá 2 MB => 400', async () => {
    const { service } = setup([makeItem()]);
    const { buffer } = await service.exportPlan('all');
    const big = await editWorkbook(buffer, (ws) => {
      for (let r = 3; r <= 2002; r++) ws.getCell(r, COL.lenh).value = `X-${r}`;
    });
    await expect(service.preview(big, 'g.xlsx')).rejects.toThrow(/tối đa 2000 dòng/);

    const huge = Buffer.alloc(2 * 1024 * 1024 + 1, 0x50);
    await expect(service.preview(huge, 'h.xlsx')).rejects.toThrow(/2 MB/);
  });

  it('đúng 2.000 dòng dữ liệu thì chấp nhận', async () => {
    const { service } = setup([makeItem()]);
    const { buffer } = await service.exportPlan('all');
    const ok = await editWorkbook(buffer, (ws) => {
      for (let r = 3; r <= 2001; r++) {
        ws.getCell(r, COL.itemId).value = String(1000 + r);
        ws.getCell(r, COL.json).value = ws.getCell(2, COL.json).value;
      }
    });
    const res = await service.preview(ok, 'i.xlsx');
    expect(res.totalRows).toBe(2000);
  });
});

describe('ngày không lệch múi giờ', () => {
  const original = process.env.TZ;
  afterEach(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it.each(['Asia/Ho_Chi_Minh', 'UTC', 'America/Los_Angeles'])(
    '2026-11-10 ghi rồi đọc lại vẫn 2026-11-10 (TZ=%s)',
    async (tz) => {
      process.env.TZ = tz;
      const { service, port } = setup([makeItem({ materialDeadline: d('2026-11-10') })]);
      const { buffer } = await service.exportPlan('all');

      // Ô lưu đúng nửa đêm UTC của ngày VN.
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as any);
      const cell = wb.getWorksheet('Kế hoạch')!.getCell(2, colOf('materialDeadline')).value;
      expect((cell as Date).toISOString()).toBe('2026-11-10T00:00:00.000Z');

      // Vòng tròn: không sửa => không đổi; sửa sang ngày khác => đúng ngày đó.
      expect((await service.preview(buffer, 'tz.xlsx')).counts.noChange).toBe(1);
      const edited = await editWorkbook(buffer, (ws) => {
        ws.getCell(2, colOf('materialDeadline')).value = dayToExcelDate('2026-11-12');
      });
      await service.preview(edited, 'tz.xlsx');
      expect(port.previewEntries.mock.calls[0][0][0]).toMatchObject({
        newValues: { materialDeadline: '2026-11-12' },
        expectedOld: { materialDeadline: '2026-11-10' },
      });
    },
  );
});
