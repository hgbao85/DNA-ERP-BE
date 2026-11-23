import { join } from 'path';
import ExcelJS from 'exceljs';

/**
 * Phiếu đề xuất mua theo ĐƠN ĐẶT HÀNG NCC (2026-11-04, bản v8 mục 7.6, 7.8, 7.11) - điền vào đúng
 * mẫu PHIEU_DE_XUAT_MAU_TRONG_IEA.xlsx anh Nhân gửi 30/10 (templates/phieu-de-xuat-mau.xlsx), giữ
 * nguyên định dạng mẫu.
 *
 * - Mỗi vật tư (cùng mã + quy cách + chiều dài cây) 1 dòng, cộng dồn qua mọi lệnh trong đơn; cột
 *   "Số lệnh sản xuất (ĐH)" ghi "lệnh: số đề xuất" (vd PI-2026-031: 3; PI-2026-032: 1).
 * - 3 cột số (23/11/2026, anh chốt):
 *   - Tồn kho = tồn vật lý LÚC TÍNH dòng mua (không phải tồn lúc in - lúc in đã gồm cả hàng mua về cho chính dòng này).
 *   - Định mức = nhu cầu theo định mức thuần (chưa trừ tồn, chưa cộng hao hụt), xem `PrintItemInput.requiredQty`.
 *   - Đề xuất = số thật sự đặt mua (gồm cả mua dư) - bỏ dòng "Mua dư → nhập tồn" riêng như trước.
 *   - Hao hụt khi mua ghi ở cột Ghi chú ("Hao hụt 1.5%: +0.3").
 * - Mẫu có 15 dòng; hết 15 dòng thì sang trang (sheet) tiếp, vẫn cùng 1 số đơn.
 * - Đơn đã "THAY PHIẾU" thì tiêu đề ghi "THAY PHIẾU lần n".
 */

export const ROWS_PER_PAGE = 15;
const FIRST_ITEM_ROW = 13;
const TEMPLATE_PATH = join(__dirname, 'templates', 'phieu-de-xuat-mau.xlsx');

export interface PrintItemInput {
  materialCode: string;
  materialName: string;
  spec: string | null;
  stockLengthMm: number | null;
  unit: string;
  /** Mã lệnh hiển thị (số LSX khi có, chưa có thì mã PI). */
  orderCode: string;
  /** Số cần mua (đã trừ tồn khả dụng, đã cộng hao hụt). */
  buyQty: number;
  /** Số đặt mua (cần mua hoặc số người mua sửa cao hơn). */
  purchaseQty: number;
  /** Tồn vật lý lúc tính dòng mua. */
  actualStock: number;
  /** Nhu cầu theo định mức lúc tính; null = dòng tạo trước 23/11/2026 (suy ra từ cần mua, xem requiredOf). */
  requiredQty: number | null;
  /** % hao hụt khi mua đã áp cho dòng (dòng cũ chưa lưu thì lấy % hiện tại của vật tư). */
  wastePct: number;
}

/**
 * Định mức của 1 dòng. Dòng cũ chưa lưu: suy ngược cần mua = định mức × (1 + hao hụt) − tồn khả dụng, coi phần tồn = 0 -
 * đúng khi lúc tính không lấy hàng từ tồn (trường hợp phổ biến, vd Sơn bột đơn PB NCC Sơn 1/2026: 20.3 / 1.015 = 20).
 */
function requiredOf(it: PrintItemInput): number {
  if (it.requiredQty != null) return it.requiredQty;
  return round4(it.buyQty / (1 + it.wastePct / 100));
}

export interface PrintRow {
  name: string;
  unit: string;
  stock: number | null;
  normQty: number | null;
  proposedQty: number;
  orders: string;
  note: string;
}

export interface PrintHeader {
  supplierName: string;
  orderCode: string;
  revision: number;
  date: Date;
  buyerName: string;
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Chiều cao hàng vật tư của mẫu (1 dòng) và chiều cao 1 dòng chữ Times New Roman 12 (pt). */
const ITEM_ROW_HEIGHT = 24;
const LINE_HEIGHT_PT = 16;

/**
 * Số dòng Excel cần để hiện `text` trong ô tự xuống dòng rộng `colWidth` (đơn vị độ rộng cột ~ 1 ký tự). Ngắt theo từ như
 * Excel, chừa 1 ký tự lề; từ dài hơn cả dòng thì cắt ngang. Ước lượng hơi dư (thừa chỗ trống còn hơn bị che chữ).
 */
export function wrappedLineCount(text: string, colWidth: number): number {
  const perLine = Math.max(1, Math.floor(colWidth) - 1);
  let lines = 0;
  for (const para of text.split('\n')) {
    let used = 0;
    let paraLines = 1;
    for (const word of para.split(' ').filter(Boolean)) {
      const len = word.length;
      if (used === 0) {
        paraLines += Math.ceil(len / perLine) - 1;
        used = len % perLine || perLine;
      } else if (used + 1 + len <= perLine) {
        used += 1 + len;
      } else {
        paraLines += Math.ceil(len / perLine);
        used = len % perLine || perLine;
      }
    }
    lines += paraLines;
  }
  return Math.max(1, lines);
}

/**
 * Gộp các dòng đơn thành dòng phiếu. Trong 1 nhóm vật tư:
 * - nhiều dòng của CÙNG 1 lệnh (dòng đã ký + dòng phần thêm) cùng mang nhu cầu của cả lệnh nên lấy lớn nhất, không cộng;
 *   khác lệnh thì cộng;
 * - tồn lúc tính là cùng một kho nên lấy lớn nhất, không cộng.
 */
export function buildPrintRows(items: PrintItemInput[]): PrintRow[] {
  const groups = new Map<string, PrintItemInput[]>();
  for (const it of items) {
    const key = `${it.materialCode}|${it.spec ?? ''}|${it.stockLengthMm ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), it]);
  }
  const rows: PrintRow[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    const requiredByOrder = new Map<string, number>();
    const wasteByOrder = new Map<string, number>();
    const proposedByOrder = new Map<string, number>();
    for (const it of group) {
      const req = requiredOf(it);
      if (req >= (requiredByOrder.get(it.orderCode) ?? -1)) {
        requiredByOrder.set(it.orderCode, req);
        wasteByOrder.set(it.orderCode, (req * it.wastePct) / 100);
      }
      proposedByOrder.set(it.orderCode, (proposedByOrder.get(it.orderCode) ?? 0) + it.purchaseQty);
    }
    const normQty = round4([...requiredByOrder.values()].reduce((s, n) => s + n, 0));
    const wasteQty = round4([...wasteByOrder.values()].reduce((s, n) => s + n, 0));
    const proposedQty = round4(group.reduce((s, it) => s + it.purchaseQty, 0));
    const name = [
      first.materialName,
      first.spec,
      first.stockLengthMm != null ? `cây ${first.stockLengthMm}mm` : null,
    ]
      .filter(Boolean)
      .join(' - ');
    const wastePct = Math.max(...group.map((it) => it.wastePct));
    rows.push({
      name,
      unit: first.unit,
      stock: round4(Math.max(...group.map((it) => it.actualStock))),
      normQty,
      proposedQty,
      orders: [...proposedByOrder].map(([code, qty]) => `${code}: ${round4(qty)}`).join('; '),
      // Ghi chú chỉ ghi hao hụt (anh bỏ mã hàng 23/11); không có hao hụt thì để trống.
      note: wastePct > 0 && wasteQty > 0 ? `Hao hụt ${round4(wastePct)}%: +${wasteQty}` : '',
    });
  }
  return rows;
}

const dd = (n: number) => String(n).padStart(2, '0');

/** Điền mẫu, trả file .xlsx. Mỗi 15 dòng 1 sheet (trang), mọi trang cùng số đơn. */
export async function renderPrintWorkbook(header: PrintHeader, rows: PrintRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE_PATH);
  const base = wb.worksheets[0];
  const baseModel = base.model;
  const pageCount = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  // Ngày theo giờ VN (UTC+7), cùng quy ước số đơn.
  const vn = new Date(header.date.getTime() + 7 * 60 * 60 * 1000);
  const title =
    header.revision > 0 ? `PHIẾU ĐỀ XUẤT - THAY PHIẾU LẦN ${header.revision}` : 'PHIẾU ĐỀ XUẤT';

  for (let page = 0; page < pageCount; page++) {
    let ws = base;
    if (page > 0) {
      ws = wb.addWorksheet(`Trang ${page + 1}`);
      ws.model = { ...baseModel, name: `Trang ${page + 1}` };
    } else if (pageCount > 1) {
      ws.name = 'Trang 1';
    }
    // Bố cục theo ảnh mẫu phiếu thật (23/11/2026): hàng 3 tiêu đề, hàng 4 ngày "dd/mm/yyyy", hàng 6-7 "Kính gửi", nhãn hàng 8-9
    // ở cột A còn giá trị ở cột C (thẳng hàng "- Giám đốc ..."), hàng 10 nội dung, bảng từ hàng 12.
    ws.getCell('A3').value = title;
    ws.getCell('A4').value =
      `Ngày ${dd(vn.getUTCDate())}/${dd(vn.getUTCMonth() + 1)}/${vn.getUTCFullYear()}`;
    ws.getCell('C8').value = header.buyerName;
    ws.getCell('C9').value = 'Mua hàng';
    ws.getCell('A10').value =
      `Nội dung đề xuất: Mua vật tư - Đơn đặt hàng ${header.supplierName} - Số ${header.orderCode}` +
      (pageCount > 1 ? ` (trang ${page + 1}/${pageCount})` : '');
    const slice = rows.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE);
    slice.forEach((row, i) => {
      const r = FIRST_ITEM_ROW + i;
      ws.getCell(`A${r}`).value = page * ROWS_PER_PAGE + i + 1;
      ws.getCell(`B${r}`).value = row.name;
      ws.getCell(`C${r}`).value = row.unit;
      ws.getCell(`D${r}`).value = row.stock;
      ws.getCell(`E${r}`).value = row.normQty;
      ws.getCell(`F${r}`).value = row.proposedQty;
      ws.getCell(`G${r}`).value = row.orders;
      ws.getCell(`H${r}`).value = row.note;
      let lines = 1;
      for (const col of ['B', 'G', 'H']) {
        ws.getCell(`${col}${r}`).alignment = {
          ...ws.getCell(`${col}${r}`).alignment,
          wrapText: true,
          vertical: 'middle',
        };
        const text = ws.getCell(`${col}${r}`).text;
        lines = Math.max(lines, wrappedLineCount(text, ws.getColumn(col).width ?? 10));
      }
      // 23/11/2026: hàng vật tư của mẫu cao cố định 24pt (vừa 1 dòng Times New Roman 12) - ô tự xuống dòng (tên dài, nhiều
      // lệnh "PBG-1 + PBG-2: 20.3") bị che mất phần dưới. Excel không tự giãn hàng đã đặt chiều cao, nên tự tính.
      if (lines > 1) ws.getRow(r).height = Math.max(ITEM_ROW_HEIGHT, lines * LINE_HEIGHT_PT + 6);
    });
    // Dòng trống còn lại của trang: xoá số thứ tự in sẵn của mẫu (1..15) để phiếu không có STT thừa.
    for (let i = slice.length; i < ROWS_PER_PAGE; i++) {
      ws.getCell(`A${FIRST_ITEM_ROW + i}`).value = null;
    }
    // Tên người đề xuất dưới chỗ ký - gộp A36:C36 cho cân với tên Giám đốc (F36:H36 của mẫu), cột A
    // của mẫu quá hẹp, để riêng thì tên bị cắt.
    if (!ws.getCell('A36').isMerged) ws.mergeCells('A36:C36');
    ws.getCell('A36').value = header.buyerName;
    ws.getCell('A36').font = { ...ws.getCell('F36').font };
    ws.getCell('A36').alignment = { horizontal: 'center' };
  }

  // 23/11/2026 - file tải về mở bằng Excel ra TRẮNG: mẫu có cả <outlinePr> lẫn <pageSetUpPr fitToPage> trong <sheetPr>,
  // exceljs ghi lại 2 thẻ này SAI thứ tự chuẩn OOXML (pageSetUpPr trước outlinePr) -> Excel coi file hỏng, không mở / sửa
  // thành trang trắng (LibreOffice, openpyxl vẫn đọc được nên trước đây không lộ). outlinePr của mẫu chỉ là giá trị mặc định
  // (summaryBelow/Right = 1) nên bỏ đi không mất gì.
  for (const sheet of wb.worksheets) {
    delete (sheet.properties as { outlineProperties?: unknown }).outlineProperties;
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
