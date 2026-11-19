import { BadRequestException, Logger } from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { fieldLabelOf, UNKNOWN_FIELD_LABEL } from './validation-field-labels';

/** Có chữ tiếng Việt có dấu => câu do người viết DTO tự đặt (`message: '...'`), giữ nguyên. */
const VI_CHAR = /[À-ỹ]/;

/** Số/chuỗi tham số nằm cuối câu mặc định của class-validator (vd "must not be less than 1" -> "1"). */
function tail(msg: string, marker: RegExp): string {
  return msg.match(marker)?.[1]?.trim() ?? '';
}

/** `field` là nhãn viết thường ("số lượng"); câu trả về được viết hoa đầu câu ở bước ghép (`compose`). */
type Translate = (field: string, msg: string) => string;

/**
 * Câu tiếng Việt theo tên constraint của class-validator 0.14. Tham số (min, max, độ dài, danh sách giá trị...) lấy
 * lại từ câu tiếng Anh mặc định vì ValidationError chỉ giữ câu, không giữ giá trị ràng buộc.
 */
const RULES: Record<string, Translate> = {
  isString: (f) => `${f} phải là chữ`,
  isNotEmpty: (f) => `${f} không được để trống`,
  isDefined: (f) => `Thiếu ${f}`,
  isInt: (f) => `${f} phải là số nguyên`,
  isNumber: (f) => `${f} phải là số`,
  isNumberString: (f) => `${f} phải là số`,
  isPositive: (f) => `${f} phải lớn hơn 0`,
  min: (f, m) => `${f} không được nhỏ hơn ${tail(m, /less than (.+)$/)}`,
  max: (f, m) => `${f} không được lớn hơn ${tail(m, /greater than (.+)$/)}`,
  minLength: (f, m) => `${f} phải có ít nhất ${tail(m, /or equal to (\d+)/)} ký tự`,
  maxLength: (f, m) => `${f} chỉ được tối đa ${tail(m, /or equal to (\d+)/)} ký tự`,
  isLength: (f, m) =>
    /longer/.test(m)
      ? `${f} phải có ít nhất ${tail(m, /or equal to (\d+)/)} ký tự`
      : `${f} chỉ được tối đa ${tail(m, /or equal to (\d+)/)} ký tự`,
  isEnum: (f, m) => `${f} phải là một trong các giá trị: ${tail(m, /following values: (.+)$/)}`,
  isIn: (f, m) => `${f} phải là một trong các giá trị: ${tail(m, /following values: (.+)$/)}`,
  isBoolean: (f) => `${f} phải là đúng/sai (true/false)`,
  isBooleanString: (f) => `${f} phải là đúng/sai (true/false)`,
  isDateString: (f) => `${f} phải là ngày hợp lệ (dạng YYYY-MM-DD)`,
  isIso8601: (f) => `${f} phải là ngày hợp lệ (dạng YYYY-MM-DD)`,
  isDate: (f) => `${f} phải là ngày hợp lệ`,
  isUuid: (f) => `${f} phải là mã UUID hợp lệ`,
  isArray: (f) => `${f} phải là danh sách`,
  arrayNotEmpty: (f) => `${f} không được để trống`,
  arrayMinSize: (f, m) => `${f} phải có ít nhất ${tail(m, /at least (\d+)/)} dòng`,
  arrayMaxSize: (f, m) => `${f} chỉ được tối đa ${tail(m, /no more than (\d+)/)} dòng`,
  arrayUnique: (f) => `${f} có giá trị bị trùng`,
  matches: (f) => `${f} sai định dạng`,
  isEmail: (f) => `${f} phải là email hợp lệ`,
  isUrl: (f) => `${f} phải là đường dẫn (URL) hợp lệ`,
  isObject: (f) => `${f} phải là một đối tượng`,
  isNotEmptyObject: (f) => `${f} không được để trống`,
  nestedValidation: (f) => `${f} sai cấu trúc dữ liệu`,
  whitelistValidation: (f) => `Không được gửi ${f} (trường này không dùng ở đây)`,
  unknownValue: () => 'Dữ liệu gửi lên không hợp lệ',
};

function isEmptyValue(v: unknown): boolean {
  if (typeof v === 'string') return v.trim() === '';
  return Array.isArray(v) && v.length === 0;
}

const lastName = (path: string[]): string =>
  [...path].reverse().find((p) => !/^\d+$/.test(p)) ?? '';

const logger = new Logger('Validation');

const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
const upperFirst = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Nhãn + tiền tố dòng cho người đọc (19/11/2026): `items.0.qty` -> nhãn "số lượng", tiền tố "dòng 1".
 * Chỉ in nhãn tiếng Việt; tên không có trong bảng nhãn thì nói chung, không lộ tên tiếng Anh.
 */
function describePath(path: string[]): { label: string; rows: string } {
  const rows = path.filter((p) => /^\d+$/.test(p)).map((p) => `dòng ${Number(p) + 1}`);
  const leaf = [...path].reverse().find((p) => !/^\d+$/.test(p)) ?? '';
  return { label: fieldLabelOf(leaf), rows: rows.join(', ') };
}

/** Ghép tiền tố dòng: có dòng thì "Dòng 1: <câu, chữ đầu viết thường>", không thì viết hoa đầu câu. */
function compose(body: string, rows: string): string {
  return rows ? `${upperFirst(rows)}: ${lowerFirst(body)}` : upperFirst(body);
}

/** Một câu lỗi của một constraint: câu tiếng Việt tự đặt giữ nguyên, còn lại dịch theo tên constraint. */
export function translateConstraint(key: string, message: string, path: string[]): string {
  if (VI_CHAR.test(message)) return message;
  const { label, rows } = describePath(path);
  // `{ each: true }`: "each value in tags must be a string" -> "Mỗi giá trị trong <nhãn> phải là chữ".
  const field = message.startsWith('each value in ') ? `mỗi giá trị trong ${label}` : label;
  const rule = RULES[key];
  return compose(rule ? rule(field, message) : `${field} không hợp lệ`, rows);
}

/** Câu "thiếu" cho trường chưa nhập (undefined / null / chuỗi rỗng / mảng rỗng của trường bắt buộc nhập). */
function missingSentence(path: string[]): string {
  const { label, rows } = describePath(path);
  return compose(`Thiếu ${label}`, rows);
}

/** Ràng buộc "bắt buộc nhập": chuỗi rỗng / mảng rỗng vi phạm nó thì coi là thiếu. */
function isRequiredConstraint(key: string, message: string): boolean {
  switch (key) {
    case 'isDefined':
    case 'isNotEmpty':
    case 'arrayNotEmpty':
    case 'isNotEmptyObject':
      return true;
    case 'minLength':
      return Number(tail(message, /or equal to (\d+)/)) >= 1;
    case 'arrayMinSize':
      return Number(tail(message, /at least (\d+)/)) >= 1;
    default:
      return false;
  }
}

/** Thứ tự ưu tiên khi một trường vi phạm nhiều ràng buộc: kiểu dữ liệu -> định dạng / enum -> khoảng / độ dài. */
const PRIORITY = [
  'isDefined',
  'isNotEmpty',
  'arrayNotEmpty',
  'isNotEmptyObject',
  'isArray',
  'isObject',
  'isString',
  'isBoolean',
  'isBooleanString',
  'isNumber',
  'isInt',
  'isNumberString',
  'isDate',
  'isDateString',
  'isIso8601',
  'isUuid',
  'isEmail',
  'isUrl',
  'isEnum',
  'isIn',
  'isPositive',
  'min',
  'max',
  'minLength',
  'maxLength',
  'isLength',
  'arrayMinSize',
  'arrayMaxSize',
  'arrayUnique',
  'matches',
  'nestedValidation',
];
const rank = (key: string): number => {
  const i = PRIORITY.indexOf(key);
  return i === -1 ? PRIORITY.length : i;
};

/** Câu tự đặt thêm tiền tố "Dòng N: " khi nằm trong dòng lồng nhau (trừ khi người viết đã tự ghi "Dòng N"). */
function composeCustom(message: string, path: string[]): string {
  const { rows } = describePath(path);
  if (!rows || /^dòng \d+/i.test(message)) return message;
  // Giữ nguyên chữ đầu nếu là từ viết tắt (vd "SKU").
  const body = /^[A-Z]{2}/.test(message) ? message : lowerFirst(message);
  return `${upperFirst(rows)}: ${body}`;
}

/**
 * MỘT câu cho một trường:
 * 1. whitelist -> "Không được gửi ...".
 * 2. Trường chưa nhập (undefined / null; chuỗi rỗng / mảng rỗng chỉ khi vi phạm ràng buộc bắt buộc nhập):
 *    câu tự đặt của chính ràng buộc bắt buộc (nếu có) > "Thiếu <nhãn>" > (nhãn chung) câu tự đặt theo rank.
 * 3. Còn lại: câu tự đặt (theo rank) > câu dịch của ràng buộc ưu tiên cao nhất.
 */
function oneSentenceFor(err: ValidationError, path: string[]): string | undefined {
  const entries = Object.entries(err.constraints ?? {});
  if (!entries.length) return undefined;
  const byRank = [...entries].sort((a, b) => rank(a[0]) - rank(b[0]));
  const forbidden = entries.find(([k]) => k === 'whitelistValidation');
  if (forbidden) return translateConstraint(forbidden[0], forbidden[1], path);
  const required = byRank.filter(([k, m]) => isRequiredConstraint(k, m));
  const nullish = err.value === undefined || err.value === null;
  const emptyRequired = isEmptyValue(err.value) && required.length > 0;
  if (nullish || emptyRequired) {
    const customRequired = required.find(([, m]) => VI_CHAR.test(m));
    if (customRequired) return composeCustom(customRequired[1], path);
    const customAny = byRank.find(([, m]) => VI_CHAR.test(m));
    if (customAny && fieldLabelOf(lastName(path)) === UNKNOWN_FIELD_LABEL) {
      return composeCustom(customAny[1], path);
    }
    return missingSentence(path);
  }
  const custom = byRank.find(([, m]) => VI_CHAR.test(m));
  if (custom) return composeCustom(custom[1], path);
  return translateConstraint(byRank[0][0], byRank[0][1], path);
}

/** Một dòng log cho mỗi trường lỗi: đường dẫn THẬT (tiếng Anh) + tên ràng buộc, KHÔNG ghi giá trị người dùng gửi. */
function collectViolations(errors: ValidationError[], parent: string[] = []): string[] {
  const out: string[] = [];
  for (const err of errors) {
    const path = err.property ? [...parent, err.property] : parent;
    const keys = Object.keys(err.constraints ?? {});
    if (keys.length) out.push(`${path.join('.')} [${keys.join(',')}]`);
    if (err.children?.length) out.push(...collectViolations(err.children, path));
  }
  return out;
}

/** Dàn phẳng cây lỗi (kể cả ValidateNested) thành danh sách câu tiếng Việt, mỗi trường một câu, bỏ câu trùng. */
export function flattenValidationErrors(
  errors: ValidationError[],
  parent: string[] = [],
): string[] {
  const out: string[] = [];
  for (const err of errors) {
    const path = err.property ? [...parent, err.property] : parent;
    const sentence = oneSentenceFor(err, path);
    if (sentence) out.push(sentence);
    if (err.children?.length) out.push(...flattenValidationErrors(err.children, path));
  }
  return [...new Set(out)];
}

/**
 * `exceptionFactory` cho ValidationPipe toàn cục (main.ts): giữ đúng dạng Nest mặc định (400, `message` là mảng câu)
 * nhưng câu mặc định tiếng Anh của class-validator đổi sang tiếng Việt, mỗi trường một câu, gọi bằng nhãn tiếng Việt
 * (không in tên thuộc tính tiếng Anh) để người dùng đọc được ngay trên màn hình.
 */
export function validationExceptionFactory(errors: ValidationError[]): BadRequestException {
  // Câu người dùng thấy dùng nhãn chung khi thiếu nhãn: ghi đường dẫn thật để dev dò (không ghi giá trị gửi lên).
  logger.warn(`Dữ liệu gửi lên không hợp lệ (400): ${collectViolations(errors).join('; ')}`);
  return new BadRequestException(flattenValidationErrors(errors));
}
