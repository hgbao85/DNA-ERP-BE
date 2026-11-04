import type { PrismaServiceType } from '../../prisma/prisma.service';

/**
 * Phần A – Đợt 2 (V3-1): số LSX nhà máy (vd MY-313, GP-176) làm MÃ LỆNH hiển thị chính. Điểm ghép ① với người B (in phiếu,
 * chia kho dùng `lenhDisplayCode`/`loadLenhDisplayCodes`). Bản FE cùng luật: `src/utils/lenhCode.ts` - đổi 2 bên cùng lúc.
 *
 * - LSX gắn với DÒNG SKU (`ProductionInvoiceItem.lsxCode`, unique toàn hệ thống - người dùng chốt 04/11): "lệnh gốc" trong v8
 *   là 1 dòng SKU, lệnh gộp (PI gộp 2 dòng) hiện đủ số của 2 lệnh gốc.
 * - Mã hiển thị của 1 PI = các LSX KHÁC NHAU của các dòng trong PI, giữ thứ tự dòng, nối " + "; PI chưa dòng nào có LSX (lệnh cũ)
 *   thì dùng mã PI (PI-2026-xxx).
 */

/** Dạng chuẩn sau khi chuẩn hoá: 1–6 chữ cái in hoa, gạch ngang, 1–6 chữ số. */
export const LSX_CODE_PATTERN = /^[A-Z]{1,6}-\d{1,6}$/;
/** Tiền tố hợp lệ (Admin khai ở SystemConfig.lsxPrefixes). */
export const LSX_PREFIX_PATTERN = /^[A-Z]{1,6}$/;
export const LENH_CODE_SEPARATOR = ' + ';

/**
 * Chuẩn hoá chuỗi người dùng gõ: bỏ khoảng trắng 2 đầu, in hoa, và cho phép gõ "my 313" / "MY_313" / "my313" -> "MY-313".
 * Không tự bỏ số 0 đầu (giữ đúng số xưởng ghi). Trả lại chuỗi đã in hoa/bỏ trắng nếu không khớp dạng - nơi gọi kiểm bằng
 * `isValidLsxCode` để báo lỗi.
 */
export function normalizeLsxCode(raw: string): string {
  const s = raw.trim().toUpperCase();
  const m = /^([A-Z]{1,6})[\s_-]*(\d{1,6})$/.exec(s);
  return m ? `${m[1]}-${m[2]}` : s.replace(/\s+/g, '');
}

export function isValidLsxCode(code: string): boolean {
  return LSX_CODE_PATTERN.test(code);
}

/** "MY-313" -> "MY". Chuỗi không đúng dạng -> null. */
export function lsxPrefixOf(code: string): string | null {
  return isValidLsxCode(code) ? code.slice(0, code.indexOf('-')) : null;
}

/** Chuẩn hoá danh sách tiền tố Admin nhập: bỏ trắng, in hoa, bỏ trùng, bỏ rỗng (giữ thứ tự nhập). */
export function normalizeLsxPrefixes(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (const r of raw) {
    const p = r.trim().toUpperCase();
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

/** Các LSX khác nhau (khác rỗng) của các dòng, giữ thứ tự dòng. */
export function lenhLsxCodes(items: readonly { lsxCode?: string | null }[]): string[] {
  const out: string[] = [];
  for (const it of items) {
    const c = it.lsxCode?.trim();
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/** Mã lệnh hiển thị: LSX của các dòng nối " + ", chưa có thì mã PI. */
export function lenhDisplayCode(
  pi: { code: string },
  items: readonly { lsxCode?: string | null }[],
): string {
  const codes = lenhLsxCodes(items);
  return codes.length > 0 ? codes.join(LENH_CODE_SEPARATOR) : pi.code;
}

/**
 * Mã lệnh hiển thị cho nhiều PI trong 1 lần đọc (2 truy vấn, không lặp theo PI) - dùng ở nơi chỉ có piId (bảng mốc, in phiếu,
 * thông báo...). Khoá Map = piId dạng chuỗi. PI không tồn tại thì không có khoá. Dòng xếp theo id tăng dần (= thứ tự dòng).
 */
export async function loadLenhDisplayCodes(
  prisma: Pick<PrismaServiceType, 'productionInvoice' | 'productionInvoiceItem'>,
  piIds: readonly bigint[],
): Promise<Map<string, string>> {
  const ids = [...new Set(piIds.map((id) => id.toString()))].map((id) => BigInt(id));
  const result = new Map<string, string>();
  if (ids.length === 0) return result;
  const [pis, items] = await Promise.all([
    prisma.productionInvoice.findMany({
      where: { id: { in: ids } },
      select: { id: true, code: true },
    }),
    prisma.productionInvoiceItem.findMany({
      where: { productionInvoiceId: { in: ids }, lsxCode: { not: null } },
      select: { productionInvoiceId: true, lsxCode: true },
      orderBy: { id: 'asc' },
    }),
  ]);
  const byPi = new Map<string, { lsxCode: string | null }[]>();
  for (const it of items) {
    const key = it.productionInvoiceId!.toString();
    const list = byPi.get(key) ?? [];
    list.push({ lsxCode: it.lsxCode });
    byPi.set(key, list);
  }
  for (const pi of pis) {
    const key = pi.id.toString();
    result.set(key, lenhDisplayCode(pi, byPi.get(key) ?? []));
  }
  return result;
}
