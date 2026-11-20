import { registerDecorator, type ValidationOptions } from 'class-validator';

/** Tệp đã tải lên Cloudinary của hệ thống: loại tài nguyên + public_id (đủ thư mục `dna-erp/...`). */
export interface SystemUploadUrlParts {
  resourceType: 'image' | 'raw';
  publicId: string;
}

const MAX_URL_LENGTH = 2000;
const OWN_FOLDER = 'dna-erp';
/** Một đoạn đường dẫn: chữ, số, `_`, `-`, có thể kèm một đuôi `.xyz`. Không nhận đoạn rỗng, `.`, `..`, `%`. */
const SEGMENT = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9]+)?$/;
const VERSION = /^v\d+$/;

/**
 * 20/11/2026 (T1-8 / T4-10): chỉ nhận URL tệp do chính hệ thống tải lên:
 * `https://res.cloudinary.com/<cloud>/(image|raw)/upload/[v<số>/]dna-erp/<...>`.
 * Parse rồi so từng phần (không so tiền tố chuỗi thô) để chặn `javascript:`, `data:`, host lạ, `?query`, `#hash`,
 * `user:pass@`, cổng, `/../`. Ảnh (`image`) phải có đuôi (khớp `deleteByUrl`); tệp `raw` có hay không có đuôi đều được.
 * Thiếu tên cloud thì luôn từ chối (đóng an toàn).
 */
export function parseSystemUploadUrl(
  value: unknown,
  cloudName: string = process.env.CLOUDINARY_CLOUD_NAME ?? '',
): SystemUploadUrlParts | null {
  if (typeof value !== 'string' || !cloudName) return null;
  if (value.length === 0 || value.length > MAX_URL_LENGTH) return null;
  // 20/11/2026 (QA): '?' hoặc '#' dù rỗng ở cuối cũng từ chối (URL.search / URL.hash trả '' nên không bắt được).
  if (value.includes('?') || value.includes('#')) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  // href chuẩn hoá phải đúng bằng chuỗi gốc: loại viết hoa scheme / host, `/../`, ký tự lạ được tự mã hoá.
  if (url.href !== value) return null;
  if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com') return null;
  if (url.username || url.password || url.port || url.search || url.hash) return null;

  const segments = url.pathname.split('/');
  if (segments[0] !== '') return null;
  const parts = segments.slice(1);
  const [cloud, resourceType, upload] = parts;
  if (cloud !== cloudName) return null;
  if (resourceType !== 'image' && resourceType !== 'raw') return null;
  if (upload !== 'upload') return null;

  let rest = parts.slice(3);
  if (rest.length > 0 && VERSION.test(rest[0])) rest = rest.slice(1);
  if (rest.length < 2 || rest[0] !== OWN_FOLDER) return null;
  if (!rest.slice(1).every((s) => SEGMENT.test(s))) return null;
  const last = rest[rest.length - 1];
  const hasExt = last.includes('.');
  if (resourceType === 'image' && !hasExt) return null;

  const joined = rest.join('/');
  const publicId = resourceType === 'image' ? joined.replace(/\.[A-Za-z0-9]+$/, '') : joined;
  return { resourceType, publicId };
}

export function isSystemUploadUrl(value: unknown, cloudName?: string): boolean {
  return parseSystemUploadUrl(value, cloudName) !== null;
}

/**
 * Gắn vào trường URL tệp do client gửi. Chuỗi rỗng / chỉ khoảng trắng cho qua (service báo câu riêng như cũ);
 * null / undefined để `@IsOptional` xử lý (null vẫn nghĩa là xoá ở route cho phép). Hỗ trợ `{ each: true }`.
 * Câu lỗi tiếng Việt nằm ở `validation-exception.factory.ts` (RULES.isSystemUploadUrl).
 */
export function IsSystemUploadUrl(options?: ValidationOptions): PropertyDecorator {
  return (object, propertyName) => {
    registerDecorator({
      name: 'isSystemUploadUrl',
      target: object.constructor,
      propertyName: propertyName as string,
      options,
      validator: {
        validate: (value: unknown) => {
          if (typeof value !== 'string') return false;
          if (value.trim() === '') return true;
          return isSystemUploadUrl(value);
        },
        // Tiền tố "each value in" để bộ dịch ra "Mỗi giá trị trong <nhãn> ..." như các ràng buộc `each` khác.
        defaultMessage: (args) =>
          `${options?.each ? `each value in ${args?.property} ` : `${args?.property} `}must be a file uploaded to the system`,
      },
    });
  };
}
