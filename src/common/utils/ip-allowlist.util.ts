import { isIP } from 'node:net';
import { BadRequestException } from '@nestjs/common';
import { MfgRole } from '../../generated/prisma/client';
import { BUSINESS_ROLES } from '../constants/roles.constant';

/**
 * Giới hạn mạng công ty cho tài khoản công nhân (2026-10-13, Sếp chốt "công nhân thôi, ai có chức năng quét mã"):
 * danh sách IP công cộng được phép nằm ở SystemConfig.floorAllowedIps (Admin quản lý). RỖNG = không giới hạn.
 */

/** `::ffff:1.2.3.4` (IPv4 bọc trong IPv6 - Node trả dạng này khi nghe trên socket dual-stack) -> `1.2.3.4`. */
export function unwrapMappedIpv4(ip: string): string {
  const m = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip.trim());
  return m ? m[1] : ip.trim();
}

/** IPv6 về dạng chuẩn (rút gọn, chữ thường) để so sánh - `2001:0DB8:0:0:0:0:0:1` và `2001:db8::1` là một. */
function canonicalIpv6(ip: string): string {
  try {
    return new URL(`http://[${ip}]`).hostname.slice(1, -1);
  } catch {
    return ip.toLowerCase();
  }
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0);
}

/** Ghi chú sau dấu `#` của mỗi dòng (vd `203.0.113.5 # Văn phòng Quy Nhơn`) - để Admin phân biệt các địa điểm. */
const NOTE_MAX = 60;

/** Tách `IP[/dải] [# ghi chú]` thành địa chỉ và ghi chú (null nếu không có). Không kiểm tra hợp lệ. */
export function splitAllowedEntry(entry: string): { addr: string; note: string | null } {
  const i = entry.indexOf('#');
  if (i < 0) return { addr: entry.trim(), note: null };
  return { addr: entry.slice(0, i).trim(), note: entry.slice(i + 1).trim() || null };
}

/**
 * Chuẩn hoá 1 dòng người dùng nhập: IPv4 (`203.0.113.5`), IPv4 CIDR (`203.0.113.0/24`, /8–/32) hoặc IPv6 cụ thể, có thể kèm ghi chú
 * sau `#` (tối đa 60 ký tự; lưu dạng `IP # ghi chú`). Ném 400 nêu rõ dòng sai. CIDR /0–/7 bị từ chối (gần như "cho cả Internet" -
 * nhập nhầm rất nguy hiểm); IPv6 chưa hỗ trợ CIDR.
 */
export function normalizeAllowedIpEntry(raw: string): string {
  const { addr: rawAddr, note } = splitAllowedEntry(raw);
  const text = rawAddr.toLowerCase();
  if (!text) throw new BadRequestException('Có dòng IP trống');
  if (note && note.length > NOTE_MAX) {
    throw new BadRequestException(`Ghi chú quá dài (tối đa ${NOTE_MAX} ký tự): ${raw.trim()}`);
  }
  const parts = text.split('/');
  if (parts.length > 2) throw new BadRequestException(`IP không hợp lệ: ${raw.trim()}`);
  const addr = unwrapMappedIpv4(parts[0]);
  const version = isIP(addr);
  if (version === 0) throw new BadRequestException(`IP không hợp lệ: ${raw.trim()}`);
  let normalized: string;
  if (parts.length === 1) {
    normalized = version === 6 ? canonicalIpv6(addr) : addr;
  } else {
    if (version === 6) {
      throw new BadRequestException(`IPv6 chỉ nhận địa chỉ cụ thể, không nhận dải: ${raw.trim()}`);
    }
    if (!/^\d{1,2}$/.test(parts[1]) || Number(parts[1]) < 8 || Number(parts[1]) > 32) {
      throw new BadRequestException(
        `Dải IP không hợp lệ: ${raw.trim()} (độ dài tiền tố phải từ /8 đến /32)`,
      );
    }
    normalized = `${addr}/${Number(parts[1])}`;
  }
  return note ? `${normalized} # ${note}` : normalized;
}

/**
 * Chuẩn hoá cả danh sách, bỏ trùng THEO ĐỊA CHỈ (ghi chú không tính), giữ thứ tự. Trùng địa chỉ thì giữ dòng có ghi chú.
 */
export function normalizeAllowedIps(list: string[]): string[] {
  const byAddr = new Map<string, string>();
  for (const raw of list) {
    const entry = normalizeAllowedIpEntry(raw);
    const { addr, note } = splitAllowedEntry(entry);
    const existing = byAddr.get(addr);
    if (!existing || (note && !splitAllowedEntry(existing).note)) byAddr.set(addr, entry);
  }
  return [...byAddr.values()];
}

/**
 * IP khách có nằm trong danh sách? Danh sách RỖNG = tính năng tắt = luôn cho phép. Không biết IP khách (undefined) mà danh sách có
 * giá trị = từ chối (không đoán).
 */
export function isIpAllowed(clientIp: string | undefined | null, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  if (!clientIp) return false;
  const ip = unwrapMappedIpv4(clientIp.toLowerCase());
  const version = isIP(ip);
  if (version === 0) return false;
  const ipCanon = version === 6 ? canonicalIpv6(ip) : ip;
  for (const rawEntry of allowed) {
    const entry = splitAllowedEntry(rawEntry).addr; // bỏ ghi chú sau #
    if (entry.includes('/')) {
      if (version !== 4) continue;
      const [net, bitsText] = entry.split('/');
      const bits = Number(bitsText);
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      if ((ipv4ToInt(ip) & mask) >>> 0 === (ipv4ToInt(net) & mask) >>> 0) return true;
    } else if (entry === ipCanon) {
      return true;
    }
  }
  return false;
}

/** IP nội bộ/loopback - BE thấy IP này khi chưa cấu hình tin cậy proxy (TRUST_PROXY_HOPS) hoặc đang chạy local. */
export function isPrivateOrLoopbackIp(ip: string): boolean {
  const a = unwrapMappedIpv4(ip.toLowerCase());
  if (isIP(a) === 4) return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(a);
  return a === '::1' || /^(fc|fd|fe80)/.test(a);
}

/**
 * Tài khoản bị giới hạn mạng công ty = ai có chức năng quét mã: công nhân (role FLOOR_WORKER) và tài khoản tổ Phôi/Hàn/Sơn (cũng
 * quét/báo được). KHÔNG áp cho Sếp, QLSX, KCS, thủ kho, Admin... (họ không quét mã, Admin còn cần vào từ ngoài để sửa danh sách IP).
 */
export function isNetworkRestrictedAccount(account: {
  roles: string[];
  mfgRole: string | null;
}): boolean {
  return (
    account.roles.includes(BUSINESS_ROLES.FLOOR_WORKER) ||
    account.mfgRole === MfgRole.PHOI ||
    account.mfgRole === MfgRole.HAN ||
    account.mfgRole === MfgRole.SON
  );
}
