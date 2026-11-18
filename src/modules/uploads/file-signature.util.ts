/**
 * B5 (danh sách lỗi 16/11, 17/11/2026): kiểm loại file theo NỘI DUNG (vài byte đầu - "magic bytes") thay vì tin
 * `file.mimetype` do trình duyệt / client tự khai. Trước đây gửi 1 file HTML/script mà khai "image/png" vẫn lọt.
 * Không thêm thư viện: chỉ cần đúng các loại endpoint upload cho phép.
 */

const startsWith = (buf: Buffer, bytes: number[], offset = 0): boolean =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

/** Loại file thật theo nội dung; null = không nhận ra (không phải loại nào được phép). */
export function sniffFileType(buf: Buffer): string | null {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(buf, ascii('GIF87a')) || startsWith(buf, ascii('GIF89a'))) return 'image/gif';
  if (startsWith(buf, ascii('RIFF')) && startsWith(buf, ascii('WEBP'), 8)) return 'image/webp';
  if (startsWith(buf, ascii('%PDF-'))) return 'application/pdf';
  // .xlsx là gói ZIP; .xls là tệp OLE (Compound File).
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) return 'zip';
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole';
  return null;
}

/** Loại khai báo nào thì nội dung phải ra loại nào. */
const EXPECTED_SNIFF: Record<string, string> = {
  'image/jpeg': 'image/jpeg',
  'image/png': 'image/png',
  'image/gif': 'image/gif',
  'image/webp': 'image/webp',
  'application/pdf': 'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'zip',
  'application/vnd.ms-excel': 'ole',
};

/** Nội dung file có đúng loại đã khai không (loại khai phải nằm trong danh sách hỗ trợ). */
export function contentMatchesDeclaredType(buf: Buffer, declaredMime: string): boolean {
  const expected = EXPECTED_SNIFF[declaredMime];
  return !!expected && sniffFileType(buf) === expected;
}
