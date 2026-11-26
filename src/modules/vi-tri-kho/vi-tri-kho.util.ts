/**
 * Vị trí kho Thành phẩm (25/11/2026, docs THIET-KE-VI-TRI-KHO-LOAD-CONT, V1-V9) - phần thuần (không DB) để test riêng:
 * mã ô, khai hàng loạt, gợi ý lấy hàng theo ô, nhắc trộn bộ 3, điều kiện đóng cont, đối chiếu số xuất với hàng đã đóng cont.
 * Bản FE cùng luật: src/modules/pages/InboundWarehouse/viTriKho/viTriKhoModel.ts - đổi 2 bên cùng lúc.
 */

/** Bộ 3 khoá (V9): SKU - LSX (dòng SKU của lệnh) - PO (dòng đơn). */
export interface Triple {
  productionInvoiceItemId: bigint;
  mfgProductId: bigint;
  salesOrderItemId: bigint | null;
}

export const sameTriple = (a: Triple, b: Triple): boolean =>
  a.productionInvoiceItemId === b.productionInvoiceItemId &&
  a.mfgProductId === b.mfgProductId &&
  (a.salesOrderItemId ?? null) === (b.salesOrderItemId ?? null);

/** Khoá advisory theo bộ 3 (1 dòng SKU của lệnh xác định đủ SKU + PO, nên khoá theo id dòng). */
export const tripleLockKey = (productionInvoiceItemId: bigint): string =>
  `vtk-triple:${productionInvoiceItemId.toString()}`;
export const locationLockKey = (locationId: bigint): string => `vtk-loc:${locationId.toString()}`;
/** Cùng khoá booking của BookingsService / BookingShipmentsService (sửa, huỷ, xuất). */
export const bookingLockKey = (bookingId: bigint): string => `booking:${bookingId.toString()}`;

export const MAX_BULK_LOCATIONS = 500;
const ZONE_RE = /^[A-Z0-9]{1,4}$/;

/** Khu: 1-4 chữ / số in hoa ("a" -> "A"). null = không hợp lệ. */
export function normalizeZone(raw: string): string | null {
  const z = raw.trim().toUpperCase();
  return ZONE_RE.test(z) ? z : null;
}

/** Dãy / ô: số 1-99 -> "01".."99". null = không hợp lệ. */
export function normalizeNumberPart(raw: string | number): string | null {
  const s = String(raw).trim();
  if (!/^\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= 99 ? String(n).padStart(2, '0') : null;
}

export const locationCode = (zone: string, aisle: string, slot: string): string =>
  `${zone}-${aisle}-${slot}`;

export interface LocationParts {
  zone: string;
  aisle: string;
  slot: string;
  code: string;
}

/** 1 ô: kiểm + chuẩn hoá. Trả lỗi tiếng Việt khi sai. */
export function buildLocation(input: {
  zone: string;
  aisle: string | number;
  slot: string | number;
}): LocationParts | string {
  const zone = normalizeZone(input.zone);
  if (!zone) return 'Khu là 1-4 chữ / số (vd A)';
  const aisle = normalizeNumberPart(input.aisle);
  if (!aisle) return 'Dãy là số từ 1 tới 99';
  const slot = normalizeNumberPart(input.slot);
  if (!slot) return 'Ô là số từ 1 tới 99';
  return { zone, aisle, slot, code: locationCode(zone, aisle, slot) };
}

/** Khai hàng loạt: khu A, dãy 01-03, ô 01-10 -> 30 ô, xếp theo dãy rồi ô. Trả lỗi tiếng Việt khi sai / quá nhiều. */
export function buildBulkLocations(input: {
  zone: string;
  aisleFrom: number;
  aisleTo: number;
  slotFrom: number;
  slotTo: number;
}): LocationParts[] | string {
  const zone = normalizeZone(input.zone);
  if (!zone) return 'Khu là 1-4 chữ / số (vd A)';
  const nums = [input.aisleFrom, input.aisleTo, input.slotFrom, input.slotTo];
  if (nums.some((n) => !Number.isInteger(n) || n < 1 || n > 99)) {
    return 'Dãy và ô là số từ 1 tới 99';
  }
  if (input.aisleFrom > input.aisleTo) return 'Dãy "từ" phải nhỏ hơn hoặc bằng dãy "đến"';
  if (input.slotFrom > input.slotTo) return 'Ô "từ" phải nhỏ hơn hoặc bằng ô "đến"';
  const count = (input.aisleTo - input.aisleFrom + 1) * (input.slotTo - input.slotFrom + 1);
  if (count > MAX_BULK_LOCATIONS) {
    return `Mỗi lần khai tối đa ${MAX_BULK_LOCATIONS} ô (đang chọn ${count})`;
  }
  const out: LocationParts[] = [];
  for (let a = input.aisleFrom; a <= input.aisleTo; a += 1) {
    for (let s = input.slotFrom; s <= input.slotTo; s += 1) {
      const aisle = String(a).padStart(2, '0');
      const slot = String(s).padStart(2, '0');
      out.push({ zone, aisle, slot, code: locationCode(zone, aisle, slot) });
    }
  }
  return out;
}

/** Thứ tự ổn định của ô: theo mã (số so theo giá trị: A-02 trước A-10). */
export const compareLocationCode = (a: string, b: string): number =>
  a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

export interface StockAtLocation {
  locationId: string;
  code: string;
  qty: number;
}

export interface PickSuggestion extends StockAtLocation {
  /** Số gợi ý lấy ở ô này (0 = không cần, vẫn liệt kê để lấy ô khác khi ô gợi ý bị chắn). */
  suggestedQty: number;
}

/**
 * V6: gợi ý lấy `need` bộ của 1 bộ 3 từ các ô đang giữ nó - theo mã ô (ổn định, đi 1 chiều trong kho), lấy hết ô trước rồi sang ô
 * sau. Ô tồn 0 bị bỏ. Không đủ hàng thì phần thiếu nằm ở `shortQty`.
 */
export function suggestPicks(
  need: number,
  stocks: StockAtLocation[],
): { rows: PickSuggestion[]; shortQty: number } {
  let left = Math.max(0, need);
  const rows = stocks
    .filter((s) => s.qty > 0)
    .sort((a, b) => compareLocationCode(a.code, b.code))
    .map((s) => {
      const take = Math.min(left, s.qty);
      left -= take;
      return { ...s, suggestedQty: take };
    });
  return { rows, shortQty: left };
}

export interface TripleLabel {
  lenhCode: string;
  sku: string;
  poCode: string | null;
}

export const tripleText = (t: TripleLabel): string =>
  `lệnh ${t.lenhCode} · SKU ${t.sku} · PO ${t.poCode ?? '—'}`;

/**
 * V3: nhắc nhẹ (không chặn) khi cất vào ô đang có bộ 3 KHÁC. `others` = các dòng tồn > 0 của ô, trừ bộ 3 đang cất.
 */
export function mixWarning(
  locationCodeText: string,
  others: (TripleLabel & { qty: number })[],
): string | null {
  const rows = others.filter((o) => o.qty > 0);
  if (rows.length === 0) return null;
  const list = rows
    .slice(0, 3)
    .map((o) => `${tripleText(o)} (${o.qty} bộ)`)
    .join('; ');
  const more = rows.length > 3 ? ` và ${rows.length - 3} loại khác` : '';
  return `Ô ${locationCodeText} đang có hàng khác: ${list}${more}. Xếp riêng, dán nhãn rõ để lấy không nhầm.`;
}

/** V7: lý do chưa đóng cont được (rỗng = đóng được). */
export function containerCloseProblems(c: {
  containerNo: string | null;
  sealNo: string | null;
  photoUrls: string[];
  totalQty: number;
}): string[] {
  const out: string[] = [];
  if (!c.containerNo?.trim()) out.push('nhập số cont');
  if (!c.sealNo?.trim()) out.push('nhập số seal');
  if (c.photoUrls.filter((u) => u.trim()).length === 0) out.push('chụp ít nhất 1 ảnh load cont');
  if (c.totalQty <= 0) out.push('cont chưa có hàng');
  return out;
}

/**
 * Bật vị trí kho: số thực xuất của booking phải đúng bằng hàng đã đóng cont từng dòng booking. Trả danh sách lệch (rỗng = khớp).
 * `containerByLine` / `wantByLine`: lineId -> số bộ; dòng không có trong map = 0.
 */
export function shipMismatches(
  lines: { id: string; label: string }[],
  containerByLine: Map<string, number>,
  wantByLine: Map<string, number>,
): string[] {
  const out: string[] = [];
  for (const l of lines) {
    const inCont = containerByLine.get(l.id) ?? 0;
    const want = wantByLine.get(l.id) ?? 0;
    if (inCont !== want) {
      out.push(`${l.label}: đã đóng cont ${inCont} bộ, đang xuất ${want} bộ`);
    }
  }
  return out;
}
