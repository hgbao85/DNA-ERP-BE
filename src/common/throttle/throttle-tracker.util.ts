import { createHash } from 'node:crypto';

/**
 * Khoá đếm của bộ giới hạn request (B3, danh sách lỗi 16/11 - 17/11/2026).
 *
 * Cả nhà máy đi ra Internet qua CÙNG 1 IP công cộng (NAT): đếm theo IP như trước thì 8 lần đăng nhập / phút và 100 request /
 * phút là của CẢ xưởng - đầu ca vài chục người đăng nhập là bị 429 hàng loạt. Nay chia 2 bộ đếm:
 *  - `default` - đếm theo NGƯỜI: request đã đăng nhập theo id trong access token (đã kiểm chữ ký); đăng nhập / đặt PIN / hỏi
 *    PIN theo (IP, tên đăng nhập); làm mới token theo chính refresh token; còn lại theo IP.
 *  - `perIp` - trần chung theo IP (rộng), chặn dò mật khẩu rải trên nhiều tài khoản từ 1 máy. Route đăng nhập tự đặt trần
 *    riêng chặt hơn qua @Throttle({ perIp: ... }).
 */

export const PER_IP_THROTTLER = 'perIp';

/** Route đăng nhập theo tài khoản - đếm theo (IP, tên đăng nhập). */
const ACCOUNT_ROUTE = /\/auth\/(login|pin-setup|pin-status)\/?$/;
const REFRESH_ROUTE = /\/auth\/(refresh|logout)\/?$/;

export interface ThrottleRequestLike {
  ip?: string;
  originalUrl?: string;
  url?: string;
  body?: unknown;
  headers?: Record<string, unknown>;
  socket?: { remoteAddress?: string };
}

export function throttleIp(req: ThrottleRequestLike): string {
  return String(req.ip ?? req.socket?.remoteAddress ?? 'unknown');
}

const bodyField = (req: ThrottleRequestLike, field: string): string | null => {
  const body = req.body as Record<string, unknown> | undefined;
  const v = body?.[field];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

const shortHash = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 24);

/**
 * Khoá của bộ đếm `default`. `verifyAccessToken` trả `sub` khi token hợp lệ (đúng chữ ký, chưa hết hạn), null nếu không -
 * token giả / hết hạn rơi về đếm theo IP (không lách được giới hạn bằng cách bịa id).
 */
export function accountThrottleTracker(
  req: ThrottleRequestLike,
  verifyAccessToken: (token: string) => string | null,
): string {
  const ip = throttleIp(req);
  const path = String(req.originalUrl ?? req.url ?? '').split('?')[0];

  if (ACCOUNT_ROUTE.test(path)) {
    const username = bodyField(req, 'username');
    if (username) return `acct:${ip}:${username.toLowerCase()}`;
  }
  if (REFRESH_ROUTE.test(path)) {
    const refreshToken = bodyField(req, 'refreshToken');
    if (refreshToken) return `rt:${shortHash(refreshToken)}`;
  }
  const auth = req.headers?.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const sub = verifyAccessToken(auth.slice('Bearer '.length).trim());
    if (sub) return `user:${sub}`;
  }
  return `ip:${ip}`;
}
