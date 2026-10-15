import { BadRequestException } from '@nestjs/common';

/**
 * Chuẩn hoá "địa chỉ ERP dùng cho tem QR" (SystemConfig.floorPublicUrl) về dạng gốc `scheme://host[:port]`:
 * - để trống -> null (dùng địa chỉ trình duyệt đang mở);
 * - thiếu `http(s)://` -> coi là https;
 * - dán cả đường dẫn (vd `https://erpdna.vercel.app/login`) thì bỏ phần đường dẫn / tham số, chỉ giữ địa chỉ gốc - tem tự thêm `/floor?ws=...`;
 * - chỉ nhận http/https, không nhận tài khoản:mật khẩu nhúng trong địa chỉ.
 */
export function normalizePublicUrl(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new BadRequestException('Địa chỉ không hợp lệ - nhập dạng https://erp.congty.vn');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new BadRequestException(
      'Địa chỉ phải bắt đầu bằng https:// (hoặc http:// cho mạng nội bộ)',
    );
  }
  if (url.username || url.password) {
    throw new BadRequestException('Địa chỉ không được chứa tên đăng nhập/mật khẩu');
  }
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') {
    throw new BadRequestException('Địa chỉ thiếu tên miền - nhập dạng https://erp.congty.vn');
  }
  return url.origin;
}
