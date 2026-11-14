/**
 * Mã quy cách sắt (13/11/2026, quy tắc chia sắt cho máy cắt của Sếp): `V<cạnh>` (sắt vuông),
 * `H<a>-<b>`
 * (sắt hộp, a ≤ b), `FI<đường kính>` (sắt phi). Độ dày (zem) không tham gia. Dùng làm khoá bảng số
 * cây/bó
 * của MC Tự động (`SystemConfig.solverBundleFactorsBySpec`).
 */

/** Khoá hợp lệ của bảng số cây/bó theo quy cách (đã viết hoa). */
export const STEEL_SPEC_KEY_REGEX = /^(V\d+(\.\d+)?|H\d+(\.\d+)?-\d+(\.\d+)?|FI\d+(\.\d+)?)$/;

const NUM = String.raw`\d+(?:[.,]\d+)?`;

/** Bỏ dấu, hạ chữ thường, "đ" -> "d", gộp khoảng trắng. */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * "12,70" / "12.7" / "20" -> "12.7" / "12.7" / "20" (chuẩn hoá số, null nếu không phải số dương).
 */
function canonNumber(raw: string): string | null {
  const n = Number(raw.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(n);
}

/**
 * Suy mã quy cách từ tên + quy cách của vật tư sắt. Trả null nếu không suy được (tên lạ, spec
 * rỗng/sai dạng).
 * Ví dụ: ("Sắt vuông 6zem", "20") -> "V20"; ("Sắt hộp 8zem", "13x26") -> "H13-26"; ("Sắt phi 6zem",
 * "Ø19") -> "FI19".
 */
export function steelSpecKey(
  name: string | null | undefined,
  spec: string | null | undefined,
): string | null {
  if (!name || !spec) return null;
  const n = fold(name);
  let kind: 'V' | 'H' | 'FI' | null = null;
  if (/(^|[^a-z])hop([^a-z]|$)/.test(n)) kind = 'H';
  else if (/(^|[^a-z])vuong([^a-z]|$)/.test(n)) kind = 'V';
  else if (/(^|[^a-z])(phi|fi)([^a-z]|$)/.test(n)) kind = 'FI';
  if (!kind) return null;

  // "Ø" không phải dấu kết hợp nên bỏ riêng; "phi"/"fi" đứng trước số cũng bỏ.
  const s = fold(spec)
    .replace(/^[øo]\s*(?=\d)/u, '')
    .replace(/^(phi|fi)\s*(?=\d)/, '')
    .replace(/\s*(mm)$/, '')
    .trim();

  if (kind === 'H') {
    const m = new RegExp(`^(${NUM})\\s*[x×*\\s]\\s*(${NUM})$`).exec(s);
    if (!m) return null;
    const a = canonNumber(m[1]);
    const b = canonNumber(m[2]);
    if (a == null || b == null) return null;
    return Number(a) <= Number(b) ? `H${a}-${b}` : `H${b}-${a}`;
  }
  const m = new RegExp(`^(${NUM})$`).exec(s);
  if (!m) return null;
  const d = canonNumber(m[1]);
  return d == null ? null : `${kind}${d}`;
}

/** Chuẩn hoá khoá người dùng nhập: viết hoa, bỏ khoảng trắng. */
export function normalizeSpecKey(key: string): string {
  return key.replace(/\s+/g, '').toUpperCase();
}

/**
 * Đọc `SystemConfig.solverBundleFactorsBySpec` (JSON `{ [mã quy cách]: số cây/bó[] }`). An toàn:
 * không phải
 * object -> {}; khoá chuẩn hoá viết hoa/bỏ khoảng trắng; giá trị lọc số nguyên > 1, khử trùng; mảng
 * rỗng thì bỏ khoá.
 */
export function parseBundleFactorsBySpec(raw: unknown): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const factors = [
      ...new Set(
        value.filter((v): v is number => typeof v === 'number' && Number.isInteger(v) && v > 1),
      ),
    ];
    if (factors.length === 0) continue;
    out[normalizeSpecKey(key)] = factors;
  }
  return out;
}

/**
 * Các loại sắt có quy cách KHÔNG nằm trong bảng số cây/bó của MC Tự động (13/11/2026, Sếp chốt câu
 * 3: chặn, hỏi Sếp số cây/bó
 * rồi Admin thêm vào bảng mới tính). Trả nhãn từng loại: `<mã quy cách> (<Tên · Quy cách>)`; không
 * suy được mã quy cách thì
 * chỉ `Tên · Quy cách`. Bảng rỗng -> [] (không áp luật). Khử trùng theo nhãn, giữ thứ tự đầu vào.
 */
export function findSteelSpecsOutsideBundleTable(
  materials: Array<{ id?: bigint | number | string; name: string | null; spec: string | null }>,
  bundleFactorsBySpec: Record<string, number[]>,
): string[] {
  if (Object.keys(bundleFactorsBySpec).length === 0) return [];
  const labels: string[] = [];
  for (const m of materials) {
    const specKey = steelSpecKey(m.name, m.spec);
    if (specKey && bundleFactorsBySpec[specKey]) continue;
    const full =
      [m.name?.trim(), m.spec?.trim()].filter(Boolean).join(' · ') || `vật tư ${m.id ?? ''}`.trim();
    const label = specKey ? `${specKey} (${full})` : full;
    if (!labels.includes(label)) labels.push(label);
  }
  return labels;
}

/**
 * Câu 400 tiếng Việt khi có quy cách ngoài bảng số cây/bó của MC Tự động (nguyên văn Sếp/KHSX đọc).
 */
export function bundleSpecMissingMessage(labels: string[]): string {
  return `Quy cách ${labels.join(', ')} chưa có trong bảng số cây/bó của MC Tự động. Hỏi Sếp số cây/bó rồi nhờ Admin thêm vào Cấu hình hệ thống › Máy cắt, sau đó tính lại.`;
}

/**
 * Đọc `SystemConfig.solverMachineByWorkshop` (JSON `{ [Workshop.code]: 'laser' | 'tu_dong' }`). An
 * toàn:
 * không phải object -> {}; giá trị ngoài enum bị bỏ qua (xưởng đó không bị khoá máy).
 */
export function parseMachineByWorkshop(raw: unknown): Record<string, 'laser' | 'tu_dong'> {
  const out: Record<string, 'laser' | 'tu_dong'> = {};
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [code, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === 'laser' || value === 'tu_dong') out[code] = value;
  }
  return out;
}
