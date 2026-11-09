/**
 * Phần A – Đợt 9 (YC2): file Excel kế hoạch - XUẤT các dòng SKU CHƯA BẮT ĐẦU SẢN XUẤT (chưa có lệnh SX, hoặc lệnh SX `floorStage` = PENDING:
 * chưa cắt phôi - Đợt 9 phần 2 Q9-3; gồm cả dòng chưa duyệt lẫn dòng Sếp đã duyệt mà chưa cắt) ra .xlsx để KHSX sửa ngày mốc hàng loạt, rồi ĐỌC lại file đó
 * thành bản xem trước (`DeadlineImportPreview`). Việc kiểm luật + ghi là của lõi (`DeadlineChangesPort`), file này chỉ lo định dạng.
 *
 * QUY ƯỚC NGÀY TRONG EXCEL: ô ngày là kiểu Date, giá trị = NỬA ĐÊM UTC của NGÀY LỊCH VN (ghi `new Date(Date.UTC(y, m-1, d))`, đọc bằng
 * `getUTC*`). Excel không có múi giờ nên số serial chính là "ngày lịch" - ghi/đọc theo UTC thì ngày không bao giờ lệch dù máy chạy
 * ở TZ nào (khác với vnDayStart = 00:00 giờ VN = 17:00 UTC hôm trước, sẽ lệch 1 ngày nếu ghi thẳng).
 *
 * BỐ CỤC (v3, 06/11 - xếp theo file "Kế hoạch cắt sắt" KHSX đang dùng): sheet "Kế hoạch" (dòng 1 tiêu đề, đóng băng) · A Lệnh SX · B Số PO
 * · C Mã IEA · D Tên SKU · E SL · F Số cont · G Nệm · H Xưởng · I Trạng thái · J..T 11 mốc theo DEADLINE_FIELDS (tiêu đề theo tên KHSX gọi,
 * `EXCEL_FIELD_HEADER`) · U Hạn giao (chỉ xem) · V (ẨN) mã dòng · W (ẨN) JSON giá trị mốc lúc xuất. Sheet ẨN "_dna" giữ dấu file.
 * Sheet được khoá (không mật khẩu): chỉ ô mốc của dòng sửa được là mở khoá; dòng đang chờ Sếp duyệt lại khoá hết.
 * Ô mốc để TRỐNG = giữ nguyên; ô ĐỔI = khác giá trị lúc xuất (cột T).
 *
 * Phần A – Đợt 9 phần 2 (Q9-1 = B): mốc sản xuất (khoá `stage.*`) của dòng sửa được xuất dưới dạng CÔNG THỨC `<ô mốc sản xuất gần nhất phía
 * trước>±<số ngày>` để KHSX thấy mốc sau tự dời ngay trong Excel. Khi đọc, ô có công thức KHỚP đúng công thức kỳ vọng của dòng = mốc tự dời
 * (không phải ô gõ); mọi ô khác (giá trị, công thức lạ, ô trống = gõ lại ngày cũ) là ô KHSX gõ → `resolveAutoShift` ra bộ mốc cuối cùng.
 */
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { contEquivalent } from '../../../common/utils/container-load.util';
import { loadLenhDisplayCodes } from '../../../common/utils/lenh-code.util';
import { VN_OFFSET_MS, vnDayKey } from '../../../common/utils/floor-stats.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../../prisma/prisma.service';
import { DeadlineChangesPort } from './deadline-changes.port';
import {
  DEADLINE_FIELDS,
  DeadlineEntryCheck,
  DeadlineEntryInput,
  DeadlineFieldKey,
  DeadlineImportPreview,
  DeadlineImportRow,
  DeadlinePlanScope,
  DeadlineValues,
} from './deadline-changes.types';
import {
  AUTO_SHIFT_KEYS,
  daysBetween,
  resolveAutoShift,
  valuesOfItem,
} from './deadline-values.util';

export const PLAN_SHEET_NAME = 'Kế hoạch';
export const MARKER_SHEET_NAME = '_dna';
export const MARKER_KIND = 'dna-erp-deadline-plan';
/**
 * Phần A – Đợt 9 phần 2: v2 = có công thức mốc tự dời. v3 (06/11) = đổi vị trí cột theo file KHSX → file v1/v2 đọc theo cột mới sẽ lệch
 * nên KHÔNG nhận nữa (báo tải file mới, `OLD_MARKER_VERSIONS`).
 */
export const MARKER_VERSION = 3;
const MARKER_VERSIONS_ACCEPTED = [3];
const OLD_MARKER_VERSIONS = [1, 2];
export const GUIDE_SHEET_NAME = 'Hướng dẫn';
export const MAX_PLAN_ROWS = 2000;
export const MAX_PLAN_FILE_BYTES = 2 * 1024 * 1024;

/** Vị trí cột (1-based). Cột mốc = COL_FIRST_DEADLINE + chỉ số trong DEADLINE_FIELDS. */
const COL_LENH = 1;
const COL_PO = 2;
const COL_SKU = 3;
const COL_SKU_NAME = 4;
const COL_QTY = 5;
const COL_CONT = 6;
const COL_CUSHION = 7;
const COL_WORKSHOP = 8;
const COL_STATUS = 9;
const COL_FIRST_DEADLINE = 10;
const COL_DELIVERY = COL_FIRST_DEADLINE + DEADLINE_FIELDS.length;
const COL_ITEM_ID = COL_DELIVERY + 1;
const COL_EXPORTED_JSON = COL_DELIVERY + 2;

const STATUS_DRAFT = 'Chưa duyệt';
const STATUS_APPROVED = 'Đã duyệt, chưa cắt – sửa cần Sếp duyệt lại';
const STATUS_PENDING = 'Đang chờ Sếp duyệt lại – không sửa được';

/**
 * Tiêu đề cột mốc trong file = tên KHSX quen gọi ở file "Kế hoạch cắt sắt", trong ngoặc là tên trên phần mềm khi khác (người dùng giải thích
 * 06/11: xuất đan = giao khung đã sơn + dây, đinh, vật tư đan cho bên đan; "hàng trần" = hàng không đan, sơn xong nhập kho đóng gói).
 * Chỉ dùng cho file Excel (tiêu đề + câu lỗi theo ô); màn hình / bản xem trước vẫn dùng `fieldLabel`.
 */
export const EXCEL_FIELD_HEADER: Record<DeadlineFieldKey, string> = {
  materialDeadline: 'Mua VT khung & đan',
  'stage.PHOI_START': 'Bắt đầu Phôi',
  'stage.FRAME_PHOI': 'Phôi xong',
  'stage.FRAME_HAN': 'Hàn xong',
  'stage.FRAME_SON': 'Sơn xong',
  'stage.FRAME': 'Xuất đan xong (Khung)',
  'stage.WEAVING': 'Nhập kho (Nhập đan)',
  'stage.TRANSFER_CHECK': 'Chuyền kiểm',
  finishedMaterialDeadline: 'NK đủ vật tư đóng gói (Mua VT còn lại)',
  'stage.PACKAGING_START': 'Bắt đầu đóng gói',
  'stage.PACKAGING': 'Đóng gói xong',
};

const DATE_FORMAT = 'dd/mm/yyyy';
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' -> Date nửa đêm UTC của đúng ngày đó (quy ước Excel ở đầu file). */
export function dayToExcelDate(day: string): Date | null {
  const m = DAY_RE.exec(day);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** Date nửa đêm UTC (quy ước Excel) -> 'YYYY-MM-DD'. */
function excelDateToDay(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function buildDay(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2999) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return excelDateToDay(t);
}

export type ParsedDateCell =
  { kind: 'empty' } | { kind: 'ok'; day: string } | { kind: 'bad'; raw: string };

/**
 * Đọc 1 ô ngày: Date, số serial Excel, chuỗi `d/m/yyyy` · `dd/mm/yyyy` · `d-m-yyyy` · `d.m.yyyy` · `yyyy-mm-dd`. Trống = giữ nguyên.
 * Số serial: 1 = 01/01/1900 theo cách tính của Excel (đã bù lỗi năm nhuận 1900 → mốc 30/12/1899 cho serial ≥ 61).
 */
export function parseDateCell(value: unknown): ParsedDateCell {
  const v = unwrapCell(value);
  if (v === null || v === undefined) return { kind: 'empty' };
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return { kind: 'bad', raw: 'ngày không hợp lệ' };
    return { kind: 'ok', day: excelDateToDay(v) };
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 61 || v > 2958465)
      return { kind: 'bad', raw: typeof v === 'boolean' ? String(v) : 'giá trị lạ' };
    const ms = Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000;
    return { kind: 'ok', day: excelDateToDay(new Date(ms)) };
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === '') return { kind: 'empty' };
    let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
    if (m) {
      const day = buildDay(Number(m[3]), Number(m[2]), Number(m[1]));
      return day ? { kind: 'ok', day } : { kind: 'bad', raw: s };
    }
    m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (m) {
      const day = buildDay(Number(m[1]), Number(m[2]), Number(m[3]));
      return day ? { kind: 'ok', day } : { kind: 'bad', raw: s };
    }
    return { kind: 'bad', raw: s };
  }
  return { kind: 'bad', raw: typeof v === 'boolean' ? String(v) : 'giá trị lạ' };
}

/** Gỡ lớp bọc của exceljs: công thức (`result`), rich text, hyperlink... → giá trị thô. */
function unwrapCell(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if ('result' in o) return unwrapCell(o.result);
    if (Array.isArray(o.richText)) {
      return (o.richText as { text?: string }[]).map((t) => t.text ?? '').join('');
    }
    if (typeof o.text === 'string') return o.text;
    return null;
  }
  return value;
}

function cellText(value: unknown): string {
  const v = unwrapCell(value);
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return excelDateToDay(v);
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
    ? String(v).trim()
    : '';
}

/** Số cột (1-based) → chữ cột Excel (1 → A, 27 → AA). */
export function columnLetter(n: number): string {
  let s = '';
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/**
 * Phần A – Đợt 9 phần 2 (Q9-1): công thức kỳ vọng của ô mốc sản xuất `key` ở dòng `rowNumber` = ô mốc sản xuất GẦN NHẤT phía trước có ngày
 * (theo DEADLINE_FIELDS) ± số ngày cách nhau lúc xuất. null = ô này ghi giá trị thường (không phải mốc sản xuất, mốc trống, hoặc là mốc
 * sản xuất đầu tiên có ngày). Dùng chung cho xuất (ghi công thức) và đọc (nhận ra ô tự dời).
 */
export function expectedShiftFormula(
  exported: DeadlineValues,
  key: DeadlineFieldKey,
  rowNumber: number,
): string | null {
  if (!AUTO_SHIFT_KEYS.includes(key)) return null;
  const cur = exported[key] ?? null;
  if (cur === null) return null;
  const idx = AUTO_SHIFT_KEYS.indexOf(key);
  for (let j = idx - 1; j >= 0; j--) {
    const pk = AUTO_SHIFT_KEYS[j];
    const pv = exported[pk] ?? null;
    if (pv === null) continue;
    const col = columnLetter(COL_FIRST_DEADLINE + DEADLINE_FIELDS.findIndex((f) => f.key === pk));
    const gap = daysBetween(pv, cur);
    return `${col}${rowNumber}${gap < 0 ? '-' : '+'}${Math.abs(gap)}`;
  }
  return null;
}

/** Bỏ `=`, `$`, khoảng trắng, viết hoa - để so công thức đọc từ file với công thức kỳ vọng. */
function normalizeFormula(f: string): string {
  return f.replace(/^=/, '').replace(/[$\s]/g, '').toUpperCase();
}

/** Công thức của ô (shared formula: exceljs đã dịch theo ô); chuỗi rỗng nếu ô không có công thức. */
function formulaOf(cell: ExcelJS.Cell): string {
  const f = (cell as unknown as { formula?: unknown }).formula;
  return typeof f === 'string' ? f : '';
}

/** Đổi 'YYYY-MM-DD' của giờ VN thành dòng tên file `YYYYMMDD-HHmm`. */
export function planFileStamp(now: Date): string {
  const t = new Date(now.getTime() + VN_OFFSET_MS);
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}-${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}`;
}

@Injectable()
export class DeadlinePlanExcelService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly port: DeadlineChangesPort,
  ) {}

  // ─── Xuất ────────────────────────────────────────────────────────────────────────────────────

  async exportPlan(
    scope: DeadlinePlanScope,
    now: Date = new Date(),
  ): Promise<{ fileName: string; buffer: Buffer }> {
    const items = await this.prisma.productionInvoiceItem.findMany({
      where: {
        productionInvoiceId: { not: null },
        productionInvoice: { is: { status: { not: 'CANCELLED' } } },
        // Đơn bán còn sống; SKU tạo tay không gắn đơn thì vẫn tính.
        AND: [
          {
            OR: [
              { salesOrderId: null },
              { salesOrder: { is: { deletedAt: null, isActive: true } } },
            ],
          },
          // Đợt 9 phần 2 (Q9-3): chỉ lệnh CHƯA BẮT ĐẦU SẢN XUẤT - chưa có lệnh SX, hoặc lệnh SX còn PENDING (chưa cắt phôi).
          {
            OR: [
              { productionOrder: { is: null } },
              { productionOrder: { is: { floorStage: 'PENDING' } } },
            ],
          },
        ],
        ...(scope === 'approved' ? { prodApprovalStatus: 'APPROVED' as const } : {}),
      },
      select: {
        id: true,
        productionInvoiceId: true,
        lsxCode: true,
        quantity: true,
        prodApprovalStatus: true,
        materialDeadline: true,
        finishedMaterialDeadline: true,
        deliveryDeadline: true,
        mfgProduct: { select: { factoryCode: true, name: true, loadCont: true } },
        workshop: { select: { name: true } },
        salesOrder: { select: { orderCode: true } },
        cushionMaterial: { select: { name: true } },
        stages: { select: { stageType: true, deadline: true } },
        productionInvoice: { select: { deadline: true } },
      },
      orderBy: { id: 'asc' },
    });

    const piIds = items.map((i) => i.productionInvoiceId).filter((id): id is bigint => id !== null);
    const [lenhCodes, pending] = await Promise.all([
      loadLenhDisplayCodes(this.prisma, piIds),
      this.port.pendingByItem(items.map((i) => i.id)),
    ]);

    const rows = items
      .map((it) => ({
        it,
        lenh: it.lsxCode?.trim() || lenhCodes.get(String(it.productionInvoiceId)) || '',
        isPending: pending.has(it.id.toString()),
      }))
      .sort(
        (a, b) =>
          a.lenh.localeCompare(b.lenh, 'vi') ||
          a.it.mfgProduct.factoryCode.localeCompare(b.it.mfgProduct.factoryCode, 'vi') ||
          Number(a.it.id - b.it.id),
      );

    const wb = new ExcelJS.Workbook();
    wb.created = now;
    const ws = wb.addWorksheet(PLAN_SHEET_NAME, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { width: 16 },
      { width: 24 }, // Số PO (PO khách dài, vd FSD2026092900068)
      { width: 18 },
      { width: 30 },
      { width: 7 },
      { width: 8 },
      { width: 18 },
      { width: 17 }, // Xưởng ("Xưởng Phước An")
      { width: 34 },
      ...DEADLINE_FIELDS.map(() => ({ width: 14 })),
      { width: 14 },
      { width: 10, hidden: true },
      { width: 10, hidden: true },
    ];

    const header = ws.getRow(1);
    header.getCell(COL_LENH).value = 'Lệnh SX';
    header.getCell(COL_PO).value = 'Số PO';
    header.getCell(COL_SKU).value = 'Mã IEA';
    header.getCell(COL_SKU_NAME).value = 'Tên SKU';
    header.getCell(COL_QTY).value = 'SL';
    header.getCell(COL_CONT).value = 'Số cont';
    header.getCell(COL_CUSHION).value = 'Nệm';
    header.getCell(COL_WORKSHOP).value = 'Xưởng';
    header.getCell(COL_STATUS).value = 'Trạng thái';
    DEADLINE_FIELDS.forEach((f, i) => {
      header.getCell(COL_FIRST_DEADLINE + i).value = EXCEL_FIELD_HEADER[f.key];
    });
    header.getCell(COL_DELIVERY).value = 'Hạn giao (chỉ xem)';
    header.getCell(COL_ITEM_ID).value = 'Mã dòng';
    header.getCell(COL_EXPORTED_JSON).value = 'Giá trị lúc xuất';
    header.font = { bold: true };
    header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    // Tiêu đề dài nhất ("NK đủ vật tư đóng gói (Mua VT còn lại)") xuống 3 dòng ở cột rộng 14.
    header.height = 48;
    header.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
    });

    rows.forEach(({ it, lenh, isPending }, idx) => {
      const row = ws.getRow(idx + 2);
      const values = valuesOfItem(it);
      const status = isPending
        ? STATUS_PENDING
        : it.prodApprovalStatus === 'APPROVED'
          ? STATUS_APPROVED
          : STATUS_DRAFT;
      row.getCell(COL_LENH).value = lenh;
      row.getCell(COL_PO).value = it.salesOrder?.orderCode ?? '';
      row.getCell(COL_SKU).value = it.mfgProduct.factoryCode;
      row.getCell(COL_SKU_NAME).value = it.mfgProduct.name;
      row.getCell(COL_QTY).value = it.quantity;
      // Số cont quy đổi = SL ÷ load cont của SKU (Đợt 1), 2 số lẻ như file KHSX (1,3 · 1,6); SKU chưa có load cont thì để trống.
      const cont = contEquivalent(it.quantity, it.mfgProduct.loadCont);
      row.getCell(COL_CONT).value = cont === null ? null : Math.round(cont * 100) / 100;
      row.getCell(COL_CUSHION).value = it.cushionMaterial?.name ?? '';
      row.getCell(COL_WORKSHOP).value = it.workshop?.name ?? '';
      row.getCell(COL_STATUS).value = status;
      DEADLINE_FIELDS.forEach((f, i) => {
        const cell = row.getCell(COL_FIRST_DEADLINE + i);
        const day = values[f.key];
        // Đợt 9 phần 2 (Q9-1): dòng sửa được → mốc sản xuất ghi công thức theo mốc sản xuất gần nhất phía trước; dòng chờ duyệt giữ giá trị.
        const formula = isPending ? null : expectedShiftFormula(values, f.key, idx + 2);
        const asDate = day ? dayToExcelDate(day) : null;
        cell.value = formula && asDate ? { formula, result: asDate } : asDate;
        cell.numFmt = DATE_FORMAT;
        cell.alignment = { horizontal: 'center' };
        // Mặc định mọi ô bị khoá khi bật bảo vệ sheet; chỉ mở ô mốc của dòng sửa được.
        cell.protection = { locked: isPending };
        if (!isPending) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9E5' } };
        }
      });
      const delivery = it.deliveryDeadline ?? it.productionInvoice?.deadline ?? null;
      const deliveryCell = row.getCell(COL_DELIVERY);
      deliveryCell.value = delivery ? dayToExcelDate(vnDayKey(delivery)) : null;
      deliveryCell.numFmt = DATE_FORMAT;
      deliveryCell.alignment = { horizontal: 'center' };
      row.getCell(COL_ITEM_ID).value = it.id.toString();
      row.getCell(COL_EXPORTED_JSON).value = JSON.stringify(values);
      if (isPending) {
        row.eachCell({ includeEmpty: true }, (c) => {
          c.font = { color: { argb: 'FF808080' } };
        });
      }
    });

    // Khoá sheet, không mật khẩu - chặn sửa nhầm ô khác nhưng vẫn cho chỉnh độ rộng cột / sắp xếp.
    await ws.protect('', {
      selectLockedCells: true,
      selectUnlockedCells: true,
      formatColumns: true,
      formatRows: true,
    });

    this.addGuideSheet(wb);

    const marker = wb.addWorksheet(MARKER_SHEET_NAME);
    marker.state = 'hidden';
    marker.getCell('A1').value = JSON.stringify({
      kind: MARKER_KIND,
      v: MARKER_VERSION,
      exportedAt: now.toISOString(),
    });

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return { fileName: `ke-hoach-san-xuat-${planFileStamp(now)}.xlsx`, buffer };
  }

  /** Đợt 9 phần 2: sheet "Hướng dẫn" (chữ thường, không thuật ngữ IT) đặt sau "Kế hoạch", trước "_dna". */
  private addGuideSheet(wb: ExcelJS.Workbook): void {
    const g = wb.addWorksheet(GUIDE_SHEET_NAME);
    g.columns = [{ width: 110 }];
    const lines = [
      'Cách sửa file kế hoạch',
      'File chỉ có lệnh CHƯA bắt đầu sản xuất (chưa cắt phôi). Lệnh đã bắt đầu cắt không sửa mốc được nữa.',
      'Chỉ sửa được các ô ngày tô vàng. Cột Lệnh SX, Số PO, Mã IEA, Tên SKU, SL, Số cont, Nệm, Xưởng, Hạn giao chỉ để xem.',
      'Tên cột ngày theo cách gọi của Kế hoạch, trong ngoặc là tên trên phần mềm: Xuất đan xong (Khung) = ngày giao khung đã sơn cùng dây, đinh, vật tư đan cho bên đan; Nhập kho (Nhập đan) = ngày hàng đan về nhập kho, hàng trần (không đan) là ngày sơn xong nhập kho; NK đủ vật tư đóng gói (Mua VT còn lại) = ngày vật tư đóng gói về đủ.',
      'Sửa 1 mốc sản xuất (Bắt đầu Phôi … Đóng gói xong) thì các mốc sản xuất sau nó tự dời cùng số ngày. 2 cột Mua VT (Mua VT khung & đan, NK đủ vật tư đóng gói) và Hạn giao không tự dời.',
      'Muốn giữ 1 mốc phía sau không dời: gõ lại đúng ngày cũ vào ô đó.',
      'Ô để trống = giữ nguyên mốc cũ (không xoá mốc qua file). Ngày có nửa ngày (vd cộng 1,5) thì phần mềm lấy đúng ngày đang hiện trong ô.',
      'Mốc sau sớm hơn mốc trước (vd Hàn trước Phôi, Đóng gói sau Hạn giao) thì dòng đó không lưu được – sửa lại cho đúng thứ tự.',
      "Dòng 'Chưa duyệt' lưu ngay khi Xác nhận; dòng 'Đã duyệt, chưa cắt' sửa xong phải chờ Sếp duyệt lại; dòng 'Đang chờ Sếp duyệt lại' không sửa được.",
      'Không thêm / xoá dòng, không đổi chỗ cột. File để lâu thì tải file mới.',
    ];
    lines.forEach((text, i) => {
      const c = g.getCell(i + 1, 1);
      c.value = text;
      c.alignment = { wrapText: true, vertical: 'top' };
      c.font = i === 0 ? { bold: true, size: 14 } : { size: 12 };
    });
  }

  // ─── Đọc + xem trước ─────────────────────────────────────────────────────────────────────────

  async preview(buffer: Buffer, fileName: string): Promise<DeadlineImportPreview> {
    if (buffer.length > MAX_PLAN_FILE_BYTES) {
      throw new BadRequestException('File quá lớn (tối đa 2 MB)');
    }
    // .xlsx là file zip: bắt đầu bằng "PK".
    if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      throw new BadRequestException('Chỉ nhận file Excel .xlsx');
    }

    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException('Không đọc được file Excel (file hỏng hoặc không phải .xlsx)');
    }

    this.assertMarker(wb);
    const ws = wb.getWorksheet(PLAN_SHEET_NAME);
    if (!ws) throw new BadRequestException('Không phải file kế hoạch tải từ hệ thống');

    // Gom dòng dữ liệu (bỏ dòng trống hẳn).
    interface RawRow {
      rowNumber: number;
      itemIdRaw: string;
      lenh: string;
      sku: string;
      exportedRaw: string;
      cells: unknown[];
      formulas: string[];
    }
    const raws: RawRow[] = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const cells: unknown[] = DEADLINE_FIELDS.map(
        (_, i) => row.getCell(COL_FIRST_DEADLINE + i).value,
      );
      const formulas = DEADLINE_FIELDS.map((_, i) =>
        formulaOf(row.getCell(COL_FIRST_DEADLINE + i)),
      );
      const itemIdRaw = cellText(row.getCell(COL_ITEM_ID).value);
      const exportedRaw = cellText(row.getCell(COL_EXPORTED_JSON).value);
      const lenh = cellText(row.getCell(COL_LENH).value);
      const sku = cellText(row.getCell(COL_SKU).value);
      const anyContent =
        itemIdRaw !== '' ||
        exportedRaw !== '' ||
        lenh !== '' ||
        sku !== '' ||
        cells.some((c) => cellText(c) !== '');
      if (!anyContent) return;
      raws.push({ rowNumber, itemIdRaw, lenh, sku, exportedRaw, cells, formulas });
    });
    if (raws.length > MAX_PLAN_ROWS) {
      throw new BadRequestException(`File có ${raws.length} dòng, tối đa ${MAX_PLAN_ROWS} dòng`);
    }

    // Mã dòng trùng → lỗi cả hai dòng.
    const rowsByItem = new Map<string, number[]>();
    for (const r of raws) {
      if (!/^\d+$/.test(r.itemIdRaw)) continue;
      const list = rowsByItem.get(r.itemIdRaw) ?? [];
      list.push(r.rowNumber);
      rowsByItem.set(r.itemIdRaw, list);
    }

    const results: DeadlineImportRow[] = [];
    const entries: {
      rowNumber: number;
      entry: DeadlineEntryInput;
      raw: RawRow;
      autoKeys: DeadlineFieldKey[];
    }[] = [];

    for (const r of raws) {
      const base = {
        rowNumber: r.rowNumber,
        itemId: r.itemIdRaw,
        lenhCode: r.lenh,
        skuCode: r.sku,
      };
      const fail = (errors: string[]) =>
        results.push({ ...base, kind: 'ERROR', changes: [], errors, warnings: [] });

      if (!/^\d+$/.test(r.itemIdRaw)) {
        fail(['dòng không có mã dòng – không phải dòng tải từ hệ thống, bỏ qua']);
        continue;
      }
      const dupRows = rowsByItem.get(r.itemIdRaw) ?? [];
      if (dupRows.length > 1) {
        fail([`mã dòng bị trùng ở các dòng ${dupRows.join(', ')} của file`]);
        continue;
      }
      const exported = this.parseExported(r.exportedRaw);
      if (!exported) {
        fail(['dòng thiếu hoặc hỏng giá trị lúc xuất – hãy tải lại file kế hoạch mới']);
        continue;
      }

      // Đợt 9 phần 2 (Q9-1): phân loại từng ô → ô KHSX gõ (`explicit`) hay mốc tự dời (công thức khớp kỳ vọng của đúng dòng này).
      const explicit: DeadlineValues = {};
      const errors: string[] = [];
      DEADLINE_FIELDS.forEach((f, i) => {
        const old = exported[f.key] ?? null;
        const formula = r.formulas[i];
        if (formula !== '') {
          const expected = expectedShiftFormula(exported, f.key, r.rowNumber);
          if (expected !== null && normalizeFormula(formula) === expected) return; // mốc tự dời
          // Công thức lạ do KHSX tự viết: lấy kết quả đã lưu làm ô gõ.
          const pf = parseDateCell(r.cells[i]);
          if (pf.kind === 'ok') explicit[f.key] = pf.day;
          else if (pf.kind === 'empty')
            errors.push(
              `ô ${EXCEL_FIELD_HEADER[f.key]} có công thức không ra ngày – gõ ngày vào ô`,
            );
          else errors.push(`ô ${EXCEL_FIELD_HEADER[f.key]} không phải ngày hợp lệ: '${pf.raw}'`);
          return;
        }
        const parsed = parseDateCell(r.cells[i]);
        if (parsed.kind === 'empty') {
          // Ô trống = giữ nguyên = coi như gõ lại ngày cũ (mốc sau nó không bị dời theo).
          if (old !== null) explicit[f.key] = old;
          return;
        }
        if (parsed.kind === 'bad') {
          errors.push(`ô ${EXCEL_FIELD_HEADER[f.key]} không phải ngày hợp lệ: '${parsed.raw}'`);
          return;
        }
        explicit[f.key] = parsed.day;
      });
      const { values: resolved, autoKeys } = resolveAutoShift(exported, explicit);
      const newValues: DeadlineValues = {};
      const expectedOld: DeadlineValues = {};
      for (const f of DEADLINE_FIELDS) {
        const v = resolved[f.key];
        const old = exported[f.key] ?? null;
        if (v !== null && v !== old) {
          newValues[f.key] = v;
          expectedOld[f.key] = old;
        }
      }
      if (errors.length > 0) {
        fail(errors);
        continue;
      }
      if (Object.keys(newValues).length === 0) {
        results.push({ ...base, kind: 'NO_CHANGE', changes: [], errors: [], warnings: [] });
        continue;
      }
      entries.push({
        rowNumber: r.rowNumber,
        raw: r,
        entry: { itemId: r.itemIdRaw, newValues, expectedOld },
        autoKeys,
      });
    }

    // Lõi kiểm luật các dòng có đổi.
    const commitItems: DeadlineEntryInput[] = [];
    if (entries.length > 0) {
      const checks = await this.port.previewEntries(entries.map((e) => e.entry));
      const byItem = new Map<string, DeadlineEntryCheck>(checks.map((c) => [c.itemId, c]));
      for (const e of entries) {
        const check = byItem.get(e.entry.itemId);
        if (!check) {
          results.push({
            rowNumber: e.rowNumber,
            itemId: e.entry.itemId,
            lenhCode: e.raw.lenh,
            skuCode: e.raw.sku,
            kind: 'ERROR',
            changes: [],
            errors: ['không kiểm được dòng này, thử lại'],
            warnings: [],
          });
          continue;
        }
        // Gắn `auto: true` cho mốc tự dời (copy, không sửa mảng dùng chung của cổng).
        const autoSet = new Set<DeadlineFieldKey>(e.autoKeys);
        const changes = check.changes.map((c) => (autoSet.has(c.key) ? { ...c, auto: true } : c));
        results.push({ ...check, changes, rowNumber: e.rowNumber });
        if (check.kind === 'APPLY' || check.kind === 'NEEDS_APPROVAL') commitItems.push(e.entry);
      }
    }

    results.sort((a, b) => a.rowNumber - b.rowNumber);
    const counts = { apply: 0, needsApproval: 0, noChange: 0, error: 0 };
    for (const r of results) {
      if (r.kind === 'APPLY') counts.apply++;
      else if (r.kind === 'NEEDS_APPROVAL') counts.needsApproval++;
      else if (r.kind === 'NO_CHANGE') counts.noChange++;
      else counts.error++;
    }

    return {
      fileName,
      totalRows: raws.length,
      counts,
      rows: results.filter((r) => r.kind !== 'NO_CHANGE' || r.warnings.length > 0),
      commitPayload: { fileName, items: commitItems },
    };
  }

  private assertMarker(wb: ExcelJS.Workbook): void {
    const err = new BadRequestException('Không phải file kế hoạch tải từ hệ thống');
    const sheet = wb.getWorksheet(MARKER_SHEET_NAME);
    if (!sheet) throw err;
    let parsed: { kind?: unknown; v?: unknown };
    try {
      parsed = JSON.parse(cellText(sheet.getCell('A1').value)) as typeof parsed;
    } catch {
      throw err;
    }
    if (!parsed || parsed.kind !== MARKER_KIND || typeof parsed.v !== 'number') throw err;
    if (OLD_MARKER_VERSIONS.includes(parsed.v)) {
      throw new BadRequestException(
        'File kế hoạch mẫu cũ (trước khi đổi cột theo file Kế hoạch cắt sắt) – hãy tải file kế hoạch mới rồi sửa lại',
      );
    }
    if (!MARKER_VERSIONS_ACCEPTED.includes(parsed.v)) throw err;
  }

  /** Giá trị mốc lúc xuất từ cột ẩn; null nếu hỏng / thiếu khoá. */
  private parseExported(raw: string): Record<DeadlineFieldKey, string | null> | null {
    if (!raw) return null;
    let obj: unknown;
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const o = obj as Record<string, unknown>;
    const out = {} as Record<DeadlineFieldKey, string | null>;
    for (const f of DEADLINE_FIELDS) {
      const v = o[f.key];
      if (v === null || v === undefined) out[f.key] = null;
      else if (typeof v === 'string' && buildDayFromKey(v)) out[f.key] = v;
      else return null;
    }
    return out;
  }
}

function buildDayFromKey(s: string): boolean {
  const m = DAY_RE.exec(s);
  return !!m && buildDay(Number(m[1]), Number(m[2]), Number(m[3])) === s;
}
