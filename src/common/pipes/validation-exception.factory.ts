import { BadRequestException } from '@nestjs/common';
import { ValidationError } from 'class-validator';

/** Có chữ tiếng Việt có dấu => câu do người viết DTO tự đặt (`message: '...'`), giữ nguyên. */
const VI_CHAR = /[À-ỹ]/;

/** Số/chuỗi tham số nằm cuối câu mặc định của class-validator (vd "must not be less than 1" -> "1"). */
function tail(msg: string, marker: RegExp): string {
  return msg.match(marker)?.[1]?.trim() ?? '';
}

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

/** Đường dẫn trường cho người đọc: `items.0.quantity` -> `"items › dòng 1 › quantity"`. */
function fieldLabel(path: string[]): string {
  const parts = path.map((p) => (/^\d+$/.test(p) ? `dòng ${Number(p) + 1}` : p));
  return `"${parts.join(' › ')}"`;
}

/** Một câu lỗi của một constraint: câu tiếng Việt tự đặt giữ nguyên, còn lại dịch theo tên constraint. */
export function translateConstraint(key: string, message: string, path: string[]): string {
  if (VI_CHAR.test(message)) return message;
  // `{ each: true }`: "each value in tags must be a string" -> "Mỗi giá trị trong "tags" phải là chữ".
  const field = message.startsWith('each value in ')
    ? `Mỗi giá trị trong ${fieldLabel(path)}`
    : fieldLabel(path);
  const rule = RULES[key];
  return rule ? rule(field, message) : `${field} không hợp lệ`;
}

/** Dàn phẳng cây lỗi (kể cả ValidateNested) thành danh sách câu tiếng Việt, bỏ câu trùng. */
export function flattenValidationErrors(
  errors: ValidationError[],
  parent: string[] = [],
): string[] {
  const out: string[] = [];
  for (const err of errors) {
    const path = err.property ? [...parent, err.property] : parent;
    for (const [key, message] of Object.entries(err.constraints ?? {})) {
      out.push(translateConstraint(key, message, path));
    }
    if (err.children?.length) out.push(...flattenValidationErrors(err.children, path));
  }
  return [...new Set(out)];
}

/**
 * `exceptionFactory` cho ValidationPipe toàn cục (main.ts): giữ đúng dạng Nest mặc định (400, `message` là mảng câu)
 * nhưng câu mặc định tiếng Anh của class-validator ("quantity must be an integer number") đổi sang tiếng Việt để
 * người dùng đọc được ngay trên màn hình.
 */
export function validationExceptionFactory(errors: ValidationError[]): BadRequestException {
  return new BadRequestException(flattenValidationErrors(errors));
}
