import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';
import { AppConfig } from '../../config/configuration';
import { UsersService } from '../users/users.service';
import { LIVE_AUTH_TTL_MS, LiveAuthService } from './live-auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

/** B5 (danh sách lỗi 16/11): khoá / đổi quyền tài khoản có hiệu lực ngay, không đợi access token hết hạn 15 phút. */
describe('LiveAuthService + JwtStrategy', () => {
  const profile = (o: Record<string, unknown> = {}) => ({
    id: 'u1',
    isActive: true,
    mfgRole: 'HAN',
    roles: [
      {
        role: {
          name: 'HAN_STAFF',
          permissions: [{ permission: { module: 'PRODUCTION_BATCH', action: 'VIEW' } }],
        },
      },
    ],
    ...o,
  });
  const payload: JwtPayload = {
    sub: 'u1',
    username: 'han',
    email: null,
    roles: ['ADMIN'], // token cũ còn vai trò đã bị gỡ
    permissions: ['USER:DELETE'],
    mfgRole: 'PHOI',
    warehouseScope: 'phoi-son-han',
  };

  let users: { findAuthProfileById: jest.Mock };
  let live: LiveAuthService;
  let strategy: JwtStrategy;

  beforeEach(() => {
    users = { findAuthProfileById: jest.fn().mockResolvedValue(profile()) };
    live = new LiveAuthService(users as unknown as UsersService);
    strategy = new JwtStrategy(
      { get: () => 'test-secret' } as unknown as ConfigService<AppConfig, true>,
      { set: jest.fn() } as unknown as ClsService<AppClsStore>,
      live,
    );
  });

  it('vai trò / quyền / tổ lấy theo DB, không theo token cũ; phạm vi kho vẫn theo token', async () => {
    const user = await strategy.validate(payload);
    expect(user).toMatchObject({
      id: 'u1',
      roles: ['HAN_STAFF'],
      permissions: ['PRODUCTION_BATCH:VIEW'],
      mfgRole: 'HAN',
      warehouseScope: 'phoi-son-han',
    });
  });

  it('tài khoản đã khoá hoặc đã xoá -> 401 ngay', async () => {
    users.findAuthProfileById.mockResolvedValue(profile({ isActive: false }));
    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    live.invalidate('u1');
    users.findAuthProfileById.mockResolvedValue(null);
    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
  });

  it('đọc DB tối đa 1 lần / 30 giây / tài khoản; quá hạn thì đọc lại', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-17T08:00:00Z') });
    try {
      await strategy.validate(payload);
      await strategy.validate(payload);
      expect(users.findAuthProfileById).toHaveBeenCalledTimes(1);
      jest.setSystemTime(Date.now() + LIVE_AUTH_TTL_MS + 1);
      await strategy.validate(payload);
      expect(users.findAuthProfileById).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
