import { BadRequestException } from '@nestjs/common';
import { normalizePublicUrl } from './public-url.util';

describe('normalizePublicUrl', () => {
  it('để trống / chỉ khoảng trắng / null -> null (dùng địa chỉ trình duyệt đang mở)', () => {
    expect(normalizePublicUrl('')).toBeNull();
    expect(normalizePublicUrl('   ')).toBeNull();
    expect(normalizePublicUrl(null)).toBeNull();
    expect(normalizePublicUrl(undefined)).toBeNull();
  });

  it('dán cả trang đăng nhập -> chỉ giữ địa chỉ gốc', () => {
    expect(normalizePublicUrl('https://erpdna.vercel.app/login')).toBe('https://erpdna.vercel.app');
    expect(normalizePublicUrl(' https://erpdna.vercel.app/?m=production#x ')).toBe(
      'https://erpdna.vercel.app',
    );
    expect(normalizePublicUrl('https://erpdna.vercel.app/')).toBe('https://erpdna.vercel.app');
  });

  it('thiếu http(s):// -> coi là https; viết hoa tên miền được chuẩn hoá; giữ cổng', () => {
    expect(normalizePublicUrl('erpdna.vercel.app')).toBe('https://erpdna.vercel.app');
    expect(normalizePublicUrl('ERPDNA.Vercel.App')).toBe('https://erpdna.vercel.app');
    expect(normalizePublicUrl('http://192.168.1.20:3000/floor')).toBe('http://192.168.1.20:3000');
    expect(normalizePublicUrl('https://erp.congty.vn:8443')).toBe('https://erp.congty.vn:8443');
  });

  it('từ chối: giao thức lạ, nhúng mật khẩu, tên miền thiếu, rác', () => {
    for (const bad of [
      'ftp://erp.congty.vn',
      'javascript://x.y/%0Aalert(1)',
      'https://user:pw@erp.congty.vn',
      'https://erp',
      'https://',
    ]) {
      expect(() => normalizePublicUrl(bad)).toThrow(BadRequestException);
    }
  });
});
