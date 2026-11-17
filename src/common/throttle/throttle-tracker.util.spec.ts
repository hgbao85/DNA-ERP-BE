import { accountThrottleTracker, throttleIp } from './throttle-tracker.util';

/** B3 (danh sách lỗi 16/11): cả nhà máy chung 1 IP - bộ đếm `default` đếm theo người, không theo IP. */
describe('accountThrottleTracker', () => {
  const FACTORY_IP = '113.161.1.2';
  const verify = (token: string) => (token === 'good-token' ? 'user-1' : null);

  it('đăng nhập / đặt PIN / hỏi PIN: theo (IP, tên đăng nhập) - 2 người cùng IP nhà máy là 2 bộ đếm khác nhau', () => {
    const a = accountThrottleTracker(
      { ip: FACTORY_IP, originalUrl: '/api/v1/auth/login', body: { username: 'Phoi.A ' } },
      verify,
    );
    const b = accountThrottleTracker(
      { ip: FACTORY_IP, originalUrl: '/api/v1/auth/login', body: { username: 'phoi.b' } },
      verify,
    );
    expect(a).toBe(`acct:${FACTORY_IP}:phoi.a`);
    expect(b).not.toBe(a);
    expect(
      accountThrottleTracker(
        { ip: FACTORY_IP, originalUrl: '/api/v1/auth/pin-setup?x=1', body: { username: 'phoi.a' } },
        verify,
      ),
    ).toBe(a);
  });

  it('request đã đăng nhập: theo id trong access token đã kiểm chữ ký', () => {
    expect(
      accountThrottleTracker(
        {
          ip: FACTORY_IP,
          originalUrl: '/api/v1/floor/review',
          headers: { authorization: 'Bearer good-token' },
        },
        verify,
      ),
    ).toBe('user:user-1');
  });

  it('token giả / hết hạn: rơi về theo IP (không lách giới hạn bằng cách bịa id)', () => {
    expect(
      accountThrottleTracker(
        {
          ip: FACTORY_IP,
          originalUrl: '/api/v1/skus',
          headers: { authorization: 'Bearer forged' },
        },
        verify,
      ),
    ).toBe(`ip:${FACTORY_IP}`);
  });

  it('làm mới token: theo chính refresh token (băm), không lộ token trong khoá', () => {
    const key = accountThrottleTracker(
      { ip: FACTORY_IP, originalUrl: '/api/v1/auth/refresh', body: { refreshToken: 'rt-secret' } },
      verify,
    );
    expect(key).toMatch(/^rt:[0-9a-f]{24}$/);
    expect(key).not.toContain('rt-secret');
  });

  it('route khác không có tên đăng nhập / token: theo IP', () => {
    expect(
      accountThrottleTracker({ ip: FACTORY_IP, originalUrl: '/api/v1/auth/login' }, verify),
    ).toBe(`ip:${FACTORY_IP}`);
  });

  it('throttleIp: dùng req.ip, thiếu thì socket', () => {
    expect(throttleIp({ socket: { remoteAddress: '10.0.0.5' } })).toBe('10.0.0.5');
  });
});
