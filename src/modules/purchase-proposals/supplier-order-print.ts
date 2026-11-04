import { join } from 'path';
import ExcelJS from 'exceljs';

/**
 * Phiếu đề xuất mua theo ĐƠN ĐẶT HÀNG NCC (2026-11-04, bản v8 mục 7.6, 7.8, 7.11) - điền vào đúng
 * mẫu PHIEU_DE_XUAT_MAU_TRONG_IEA.xlsx anh Nhân gửi 30/10 (templates/phieu-de-xuat-mau.xlsx), giữ
 * nguyên định dạng mẫu.
 *
 * - Mỗi vật tư (cùng mã + quy cách + chiều dài cây) 1 dòng, cộng dồn qua mọi lệnh trong đơn; cột
 *   "Số lệnh sản xuất (ĐH)" ghi "lệnh: số cần" (vd PI-2026-031: 3; PI-2026-032: 1).
 * - Vật tư có mua dư (số mua > cần mua) thêm 1 dòng "Mua dư → nhập tồn" ngay dưới.
 * - Mẫu có 15 dòng; hết 15 dòng thì sang trang (sheet) tiếp, vẫn cùng 1 số đơn.
 * - Đơn đã "THAY PHIẾU" thì tiêu đề ghi "THAY PHIẾU lần n".
 */

export const ROWS_PER_PAGE = 15;
const FIRST_ITEM_ROW = 12;
const TEMPLATE_PATH = join(__dirname, 'templates', 'phieu-de-xuat-mau.xlsx');

export interface PrintItemInput {
  materialCode: string;
  materialName: string;
  spec: string | null;
  stockLengthMm: number | null;
  unit: string;
  /** Mã lệnh hiển thị (số LSX khi có, chưa có thì mã PI). */
  orderCode: string;
  buyQty: number;
  purchaseQty: number;
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

/** Gộp các dòng đơn thành dòng phiếu (vật tư + dòng mua dư). `stockOf` trả tồn kho hiện tại của vật tư. */
export function buildPrintRows(
  items: PrintItemInput[],
  stockOf: (item: PrintItemInput) => number | null,
): PrintRow[] {
  const groups = new Map<string, PrintItemInput[]>();
  for (const it of items) {
    const key = `${it.materialCode}|${it.spec ?? ''}|${it.stockLengthMm ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), it]);
  }
  const rows: PrintRow[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    const need = round4(group.reduce((s, it) => s + it.buyQty, 0));
    const extra = round4(group.reduce((s, it) => s + Math.max(0, it.purchaseQty - it.buyQty), 0));
    const byOrder = new Map<string, number>();
    for (const it of group) byOrder.set(it.orderCode, (byOrder.get(it.orderCode) ?? 0) + it.buyQty);
    const name = [
      first.materialName,
      first.spec,
      first.stockLengthMm != null ? `cây ${first.stockLengthMm}mm` : null,
    ]
      .filter(Boolean)
      .join(' - ');
    rows.push({
      name,
      unit: first.unit,
      stock: stockOf(first),
      normQty: need,
      proposedQty: need,
      orders: [...byOrder].map(([code, qty]) => `${code}: ${round4(qty)}`).join('; '),
      note: first.materialCode,
    });
    if (extra > 0) {
      rows.push({
        name: 'Mua dư → nhập tồn',
        unit: first.unit,
        stock: null,
        normQty: null,
        proposedQty: extra,
        orders: '',
        note: first.materialCode,
      });
    }
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
    ws.getCell('A2').value = title;
    ws.getCell('A3').value =
      `Ngày ${dd(vn.getUTCDate())} /${dd(vn.getUTCMonth() + 1)} /${vn.getUTCFullYear()}`;
    ws.getCell('A7').value = `Nhân viên đề xuất: ${header.buyerName}`;
    ws.getCell('A8').value = 'Thuộc bộ phận: Mua hàng';
    ws.getCell('A9').value =
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
      for (const col of ['B', 'G', 'H']) {
        ws.getCell(`${col}${r}`).alignment = {
          ...ws.getCell(`${col}${r}`).alignment,
          wrapText: true,
          vertical: 'middle',
        };
      }
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

  return Buffer.from(await wb.xlsx.writeBuffer());
}
