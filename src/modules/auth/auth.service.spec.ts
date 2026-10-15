// jest's `expect.objectContaining` is typed `any`, which trips no-unsafe-assignment
// on every `toHaveBeenCalledWith(expect.objectContaining({...}))` below - standard
// jest usage, not a real type-safety gap.
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AppConfig } from '../../config/configuration';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { NetworkAccessService } from '../../common/network/network-access.service';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let authService: AuthService;
  let usersService: jest.Mocked<
    Pick<UsersService, 'findAuthProfileByUsername' | 'findAuthProfileById'>
  >;
  let prisma: {
    refreshToken: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    user: {
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let jwtService: jest.Mocked<Pick<JwtService, 'signAsync'>>;
  let configService: { get: jest.Mock };
  let network: { assertAccountAllowed: jest.Mock; isAccountAllowed: jest.Mock };

  const rawPassword = 'CorrectHorseBatteryStaple123!';
  let hashedPassword: string;

  const buildUser = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'user-1',
    username: 'admin',
    email: 'admin@dna-erp.local',
    password: hashedPassword,
    isActive: true,
    roles: [
      {
        role: {
          name: 'ADMIN',
          permissions: [{ permission: { module: 'USER', action: 'CREATE' } }],
        },
      },
    ],
    ...overrides,
  });

  beforeAll(async () => {
    hashedPassword = await argon2.hash(rawPassword);
  });

  beforeEach(() => {
    usersService = {
      findAuthProfileByUsername: jest.fn(),
      findAuthProfileById: jest.fn(),
    };

    prisma = {
      refreshToken: {
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'refresh-token-1' }),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      user: {
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
    };

    jwtService = { signAsync: jest.fn().mockResolvedValue('signed.access.token') };
    network = {
      assertAccountAllowed: jest.fn().mockResolvedValue(undefined),
      isAccountAllowed: jest.fn().mockResolvedValue(true),
    };

    configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          'jwt.accessSecret': 'access-secret',
          'jwt.accessExpiresIn': '15m',
          'jwt.refreshExpiresIn': '7d',
        };
        return values[key];
      }),
    };

    authService = new AuthService(
      usersService as unknown as UsersService,
      prisma as unknown as PrismaServiceType,
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService<AppConfig, true>,
      network as unknown as NetworkAccessService,
    );
  });

  describe('login', () => {
    it('issues an access + refresh token pair for valid credentials', async () => {
      usersService.findAuthProfileByUsername.mockResolvedValue(buildUser() as never);

      const result = await authService.login(
        { username: 'admin', password: rawPassword },
        '127.0.0.1',
      );

      expect(result.accessToken).toBe('signed.access.token');
      expect(result.refreshToken).toEqual(expect.any(String));
      expect(prisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'user-1', createdByIp: '127.0.0.1' }),
        }),
      );
    });

    it('rejects an unknown email', async () => {
      usersService.findAuthProfileByUsername.mockResolvedValue(null);

      await expect(
        authService.login({ username: 'nobody', password: rawPassword }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a wrong password', async () => {
      usersService.findAuthProfileByUsername.mockResolvedValue(buildUser() as never);

      await expect(
        authService.login({ username: 'admin', password: 'wrong-password' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an inactive user', async () => {
      usersService.findAuthProfileByUsername.mockResolvedValue(
        buildUser({ isActive: false }) as never,
      );

      await expect(authService.login({ username: 'admin', password: rawPassword })).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('tài khoản công nhân xưởng (PIN 6 số)', () => {
    const worker = (overrides: Partial<Record<string, unknown>> = {}) =>
      buildUser({
        username: 'phoi.a',
        roles: [{ role: { name: 'FLOOR_WORKER', permissions: [] } }],
        failedLoginCount: 0,
        lockedUntil: null,
        pinPending: false,
        pinClaimExpiresAt: null,
        ...overrides,
      });

    it('chưa có PIN (pinPending) -> 403 PIN_SETUP_REQUIRED để FE chuyển sang màn đặt PIN, không thử mật khẩu', async () => {
      usersService.findAuthProfileByUsername.mockResolvedValue(
        worker({ pinPending: true, pinClaimExpiresAt: new Date(Date.now() + 1e6) }) as never,
      );
      await expect(
        authService.login({ username: 'phoi.a', password: rawPassword }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('sai PIN: tăng bộ đếm; chưa đủ 5 lần thì chưa khoá', async () => {
      usersService.findAuthProfileByUsername.mockResolvedValue(worker() as never);
      prisma.user.update.mockResolvedValue({ failedLoginCount: 3 });
      await expect(
        authService.login({ username: 'phoi.a', password: 'wrong-pin' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { failedLoginCount: { increment: 1 } } }),
      );
    });

    it('sai lần 3-4: báo còn bao nhiêu lần thử trước khi khoá; lần 1-2 báo chung', async () => {
      usersService.findAuthProfileByUsername.mockResolvedValue(worker() as never);
      prisma.user.update.mockResolvedValue({ failedLoginCount: 4 });
      await expect(
        authService.login({ username: 'phoi.a', password: 'wrong-pin' }),
      ).rejects.toThrow(/còn 1 lần thử/);
      prisma.user.update.mockResolvedValue({ failedLoginCount: 1 });
      await expect(
        authService.login({ username: 'phoi.a', password: 'wrong-pin' }),
      ).rejects.toThrow('Invalid credentials');
    });

    it('sai lần thứ 5: khoá tạm 15 phút và đếm lại từ 0', async () => {
      usersService.findAuthProfileByUsername.mockResolvedValue(worker() as never);
      prisma.user.update.mockResolvedValue({ failedLoginCount: 5 });
      await expect(
        authService.login({ username: 'phoi.a', password: 'wrong-pin' }),
      ).rejects.toThrow(/khoá tạm/); // báo khoá NGAY ở lần sai thứ 5
      const lockCall = (prisma.user.update.mock.calls as unknown[][])[1][0] as {
        data: { failedLoginCount: number; lockedUntil: Date };
      };
      expect(lockCall.data.failedLoginCount).toBe(0);
      const minutes = (lockCall.data.lockedUntil.getTime() - Date.now()) / 60000;
      expect(minutes).toBeGreaterThan(14.9);
      expect(minutes).toBeLessThanOrEqual(15);
    });

    it('đang bị khoá: từ chối KỂ CẢ nhập đúng PIN, và báo còn bao nhiêu phút', async () => {
      usersService.findAuthProfileByUsername.mockResolvedValue(
        worker({ lockedUntil: new Date(Date.now() + 10 * 60000) }) as never,
      );
      await expect(
        authService.login({ username: 'phoi.a', password: rawPassword }),
      ).rejects.toThrow(/khoá tạm.*\d+ phút/);
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('hết hạn khoá + nhập đúng: vào được và xoá bộ đếm', async () => {
      usersService.findAuthProfileByUsername.mockResolvedValue(
        worker({ failedLoginCount: 2, lockedUntil: new Date(Date.now() - 1000) }) as never,
      );
      const r = await authService.login({ username: 'phoi.a', password: rawPassword });
      expect(r.accessToken).toBe('signed.access.token');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { failedLoginCount: 0, lockedUntil: null } }),
      );
    });

    it('tài khoản KHÔNG phải công nhân (vd admin) không bị khoá khi sai mật khẩu', async () => {
      usersService.findAuthProfileByUsername.mockResolvedValue(buildUser() as never);
      await expect(
        authService.login({ username: 'admin', password: 'wrong-password' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('pinStatus (màn đăng nhập hỏi: đã có PIN hay phải tự đặt)', () => {
    const NONE = { needsPin: false, expired: false };
    const waiting = (overrides: Partial<Record<string, unknown>> = {}) =>
      buildUser({
        username: 'phoi.a',
        roles: [{ role: { name: 'FLOOR_WORKER', permissions: [] } }],
        pinPending: true,
        pinClaimExpiresAt: new Date(Date.now() + 3600_000),
        ...overrides,
      });

    it('công nhân đang chờ đặt PIN + trong mạng công ty -> needsPin (tên được chuẩn hoá thường/cắt khoảng trắng)', async () => {
      usersService.findAuthProfileByUsername.mockResolvedValue(waiting() as never);
      const r = await authService.pinStatus('  Phoi.A ', '10.0.0.1');
      expect(r).toEqual({ needsPin: true, expired: false });
      expect(usersService.findAuthProfileByUsername).toHaveBeenCalledWith('phoi.a');
      expect(network.isAccountAllowed).toHaveBeenCalledWith(
        expect.objectContaining({ roles: ['FLOOR_WORKER'] }),
        '10.0.0.1',
      );
    });

    it('đang chờ nhưng QUÁ HẠN đặt PIN -> needsPin + expired (FE báo ngay, khỏi để gõ PIN xong mới bị từ chối)', async () => {
      usersService.findAuthProfileByUsername.mockResolvedValue(
        waiting({ pinClaimExpiresAt: new Date(Date.now() - 1000) }) as never,
      );
      expect(await authService.pinStatus('phoi.a')).toEqual({ needsPin: true, expired: true });
    });

    it('đã có PIN -> chỉ nhập PIN (needsPin false)', async () => {
      usersService.findAuthProfileByUsername.mockResolvedValue(
        waiting({ pinPending: false, pinClaimExpiresAt: null }) as never,
      );
      expect(await authService.pinStatus('phoi.a')).toEqual(NONE);
    });

    it('CHỐNG DÒ TÀI KHOẢN: tên không tồn tại / đã khoá / không phải công nhân / ngoài mạng công ty đều trả ĐÚNG như "đã có PIN"', async () => {
      // không tồn tại
      usersService.findAuthProfileByUsername.mockResolvedValue(null);
      expect(await authService.pinStatus('khong.co')).toEqual(NONE);
      // đã khoá
      usersService.findAuthProfileByUsername.mockResolvedValue(
        waiting({ isActive: false }) as never,
      );
      expect(await authService.pinStatus('phoi.a')).toEqual(NONE);
      // không phải công nhân dù pinPending bật
      usersService.findAuthProfileByUsername.mockResolvedValue(
        waiting({ roles: [{ role: { name: 'ADMIN', permissions: [] } }] }) as never,
      );
      expect(await authService.pinStatus('admin')).toEqual(NONE);
      // đang chờ đặt PIN nhưng người hỏi ở NGOÀI mạng công ty: không tiết lộ trạng thái
      usersService.findAuthProfileByUsername.mockResolvedValue(waiting() as never);
      network.isAccountAllowed.mockResolvedValue(false);
      expect(await authService.pinStatus('phoi.a', '8.8.8.8')).toEqual(NONE);
    });

    it('không ghi gì vào DB và không tạo token', async () => {
      usersService.findAuthProfileByUsername.mockResolvedValue(waiting() as never);
      await authService.pinStatus('phoi.a');
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });
  });

  describe('pinSetup (công nhân tự đặt PIN lần đầu)', () => {
    const pending = (overrides: Partial<Record<string, unknown>> = {}) =>
      buildUser({
        username: 'phoi.a',
        roles: [{ role: { name: 'FLOOR_WORKER', permissions: [] } }],
        pinPending: true,
        pinClaimExpiresAt: new Date(Date.now() + 3600_000),
        ...overrides,
      });
    const dto = { username: 'Phoi.A', pin: '483920', confirmPin: '483920' };

    it('đặt PIN hợp lệ: lưu hash (không lưu PIN thô), hết chờ, rồi đăng nhập luôn', async () => {
      usersService.findAuthProfileByUsername.mockResolvedValue(pending() as never);
      usersService.findAuthProfileById.mockResolvedValue(pending({ pinPending: false }) as never);

      const r = await authService.pinSetup(dto, '10.0.0.1');

      const data = (
        (prisma.user.updateMany.mock.calls as unknown[][])[0][0] as { data: { password: string } }
      ).data;
      expect(data.password).not.toBe('483920');
      expect(await argon2.verify(data.password, '483920')).toBe(true);
      expect(prisma.user.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-1', pinPending: true } }),
      );
      expect(usersService.findAuthProfileByUsername).toHaveBeenCalledWith('phoi.a');
      expect(r.accessToken).toBe('signed.access.token');
    });

    it('2 lần nhập khác nhau -> 400, không đụng DB', async () => {
      await expect(authService.pinSetup({ ...dto, confirmPin: '483921' })).rejects.toThrow(
        BadRequestException,
      );
      expect(usersService.findAuthProfileByUsername).not.toHaveBeenCalled();
    });

    it('PIN quá dễ đoán (123456, 000000, 121212) -> 400', async () => {
      for (const pin of ['123456', '000000', '121212']) {
        await expect(authService.pinSetup({ ...dto, pin, confirmPin: pin })).rejects.toThrow(
          /dễ đoán/,
        );
      }
    });

    it('tài khoản không chờ đặt PIN / không phải công nhân / quá hạn -> 400 và không ghi gì', async () => {
      usersService.findAuthProfileByUsername.mockResolvedValue(
        pending({ pinPending: false }) as never,
      );
      await expect(authService.pinSetup(dto)).rejects.toThrow(BadRequestException);
      usersService.findAuthProfileByUsername.mockResolvedValue(buildUser() as never); // admin
      await expect(authService.pinSetup(dto)).rejects.toThrow(BadRequestException);
      usersService.findAuthProfileByUsername.mockResolvedValue(null);
      await expect(authService.pinSetup(dto)).rejects.toThrow(BadRequestException);
      usersService.findAuthProfileByUsername.mockResolvedValue(
        pending({ pinClaimExpiresAt: new Date(Date.now() - 1000) }) as never,
      );
      await expect(authService.pinSetup(dto)).rejects.toThrow(/quá hạn/);
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('2 người cùng đặt PIN 1 tài khoản: người đến sau (updateMany count 0) bị từ chối', async () => {
      usersService.findAuthProfileByUsername.mockResolvedValue(pending() as never);
      prisma.user.updateMany.mockResolvedValue({ count: 0 });
      await expect(authService.pinSetup(dto)).rejects.toThrow(/vừa được đặt PIN/);
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });
  });

  describe('giới hạn mạng công ty (công nhân + tổ Phôi/Hàn/Sơn)', () => {
    const worker = (overrides: Partial<Record<string, unknown>> = {}) =>
      buildUser({
        username: 'phoi.a',
        roles: [{ role: { name: 'FLOOR_WORKER', permissions: [] } }],
        mfgRole: 'PHOI',
        failedLoginCount: 0,
        lockedUntil: null,
        pinPending: false,
        ...overrides,
      });
    const outside = () =>
      network.assertAccountAllowed.mockRejectedValue(new ForbiddenException('ngoài mạng công ty'));

    it('đúng PIN nhưng ngoài mạng công ty -> 403, KHÔNG cấp token, và KHÔNG tính là nhập sai', async () => {
      usersService.findAuthProfileByUsername.mockResolvedValue(worker() as never);
      outside();

      await expect(
        authService.login({ username: 'phoi.a', password: rawPassword }, '8.8.8.8'),
      ).rejects.toThrow(ForbiddenException);

      expect(network.assertAccountAllowed).toHaveBeenCalledWith(
        expect.objectContaining({ roles: ['FLOOR_WORKER'], mfgRole: 'PHOI' }),
        '8.8.8.8',
      );
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled(); // không tăng bộ đếm sai PIN
    });

    it('kiểm tra mạng SAU khi PIN đúng: sai PIN vẫn là lỗi thường (người ngoài không phân biệt được tài khoản công nhân)', async () => {
      usersService.findAuthProfileByUsername.mockResolvedValue(worker() as never);
      prisma.user.update.mockResolvedValue({ failedLoginCount: 1 });
      outside();

      await expect(
        authService.login({ username: 'phoi.a', password: 'sai-pin' }, '8.8.8.8'),
      ).rejects.toThrow('Invalid credentials');
      expect(network.assertAccountAllowed).not.toHaveBeenCalled();
    });

    it('trong mạng công ty -> đăng nhập bình thường', async () => {
      usersService.findAuthProfileByUsername.mockResolvedValue(worker() as never);

      const r = await authService.login(
        { username: 'phoi.a', password: rawPassword },
        '203.0.113.5',
      );

      expect(r.accessToken).toBe('signed.access.token');
      expect(network.assertAccountAllowed).toHaveBeenCalledTimes(1);
    });

    it('tài khoản tổ Phôi (không phải FLOOR_WORKER, nhưng có mfgRole PHOI) cũng bị kiểm tra', async () => {
      usersService.findAuthProfileByUsername.mockResolvedValue(
        buildUser({
          roles: [{ role: { name: 'PHOI_STAFF', permissions: [] } }],
          mfgRole: 'PHOI',
        }) as never,
      );
      outside();
      await expect(
        authService.login({ username: 'admin', password: rawPassword }, '8.8.8.8'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Admin/Sếp/QLSX: KHÔNG gọi kiểm tra mạng (không bao giờ bị giới hạn)', async () => {
      usersService.findAuthProfileByUsername.mockResolvedValue(buildUser() as never); // ADMIN
      await authService.login({ username: 'admin', password: rawPassword }, '8.8.8.8');
      expect(network.assertAccountAllowed).not.toHaveBeenCalled();
    });

    it('chưa có PIN + ngoài mạng -> 403 mạng (không cho người ngoài vào luồng đặt PIN)', async () => {
      usersService.findAuthProfileByUsername.mockResolvedValue(
        worker({ pinPending: true, pinClaimExpiresAt: new Date(Date.now() + 1e6) }) as never,
      );
      outside();
      await expect(
        authService.login({ username: 'phoi.a', password: rawPassword }, '8.8.8.8'),
      ).rejects.toThrow('ngoài mạng công ty');
    });

    it('đặt PIN lần đầu ngoài mạng -> 403 và KHÔNG ghi PIN', async () => {
      usersService.findAuthProfileByUsername.mockResolvedValue(
        worker({ pinPending: true, pinClaimExpiresAt: new Date(Date.now() + 1e6) }) as never,
      );
      outside();
      await expect(
        authService.pinSetup(
          { username: 'phoi.a', pin: '483920', confirmPin: '483920' },
          '8.8.8.8',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('gia hạn phiên (refresh) ngoài mạng -> từ chối, KHÔNG xoay/thu hồi token (về lại mạng công ty dùng tiếp được)', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 't1',
        userId: 'user-1',
        revokedAt: null,
        replacedByTokenId: null,
        expiresAt: new Date(Date.now() + 1e6),
      });
      usersService.findAuthProfileById.mockResolvedValue(worker() as never);
      outside();

      await expect(authService.refresh('refresh-token', '8.8.8.8')).rejects.toThrow(
        ForbiddenException,
      );

      expect(prisma.refreshToken.update).not.toHaveBeenCalled();
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('rotates a valid refresh token: revokes the old one and issues a new pair', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'old-token-id',
        userId: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      usersService.findAuthProfileById.mockResolvedValue(buildUser() as never);

      const result = await authService.refresh('some-refresh-token', '127.0.0.1');

      expect(result.accessToken).toBe('signed.access.token');
      expect(prisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'old-token-id' },
          data: expect.objectContaining({ replacedByTokenId: 'refresh-token-1' }),
        }),
      );
    });

    it('rejects a token that does not exist', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(authService.refresh('missing-token')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a revoked token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'old-token-id',
        userId: 'user-1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });

      await expect(authService.refresh('revoked-token')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an expired token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'old-token-id',
        userId: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() - 60_000),
      });

      await expect(authService.refresh('expired-token')).rejects.toThrow(UnauthorizedException);
    });

    // Medium fix: token đã bị revoke BỞI CHÍNH lượt rotate trước đó (replacedByTokenId có giá
    // trị) mà bị dùng lại - dấu hiệu đã bị lộ (kẻ tấn công đua với chủ tài khoản thật). Khác
    // token bị revoke do logout/đổi mật khẩu (replacedByTokenId null) - đó không phải reuse.
    it('detects reuse of an already-ROTATED token (replacedByTokenId set) and revokes every live token for that user', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'old-token-id',
        userId: 'user-1',
        revokedAt: new Date(),
        replacedByTokenId: 'newer-token-id',
        expiresAt: new Date(Date.now() + 60_000),
      });

      await expect(authService.refresh('stolen-but-already-rotated-token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', revokedAt: null },
          data: expect.objectContaining({ revokedAt: expect.any(Date) as Date }),
        }),
      );
      // Không phát hành cặp token mới cho kẻ đang dùng token cũ.
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('does NOT treat a logout-revoked token (replacedByTokenId null) as reuse - just rejects normally', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'old-token-id',
        userId: 'user-1',
        revokedAt: new Date(),
        replacedByTokenId: null,
        expiresAt: new Date(Date.now() + 60_000),
      });

      await expect(authService.refresh('logged-out-token')).rejects.toThrow(UnauthorizedException);
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('revokes a valid, unrevoked refresh token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({ id: 'token-id', revokedAt: null });

      await authService.logout('some-token', '127.0.0.1');

      expect(prisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'token-id' },
          data: expect.objectContaining({ revokedByIp: '127.0.0.1' }),
        }),
      );
    });

    it('is a no-op when the token is unknown or already revoked', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await authService.logout('unknown-token');

      expect(prisma.refreshToken.update).not.toHaveBeenCalled();
    });
  });

  describe('changePassword', () => {
    it('updates the hash and revokes every live refresh token when the current password is correct', async () => {
      usersService.findAuthProfileById.mockResolvedValue(buildUser() as never);

      await authService.changePassword('user-1', {
        currentPassword: rawPassword,
        newPassword: 'BrandNewPassword456!',
      });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({ password: expect.any(String) }),
        }),
      );
      const updateMock = prisma.user.update as jest.Mock<unknown, [{ data: { password: string } }]>;
      expect(updateMock.mock.calls[0][0].data.password).not.toBe(hashedPassword);

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', revokedAt: null },
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );
    });

    it('rejects a wrong current password and does not touch the DB', async () => {
      usersService.findAuthProfileById.mockResolvedValue(buildUser() as never);

      await expect(
        authService.changePassword('user-1', {
          currentPassword: 'wrong-password',
          newPassword: 'BrandNewPassword456!',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('rejects when the user no longer exists', async () => {
      usersService.findAuthProfileById.mockResolvedValue(null);

      await expect(
        authService.changePassword('missing-user', {
          currentPassword: rawPassword,
          newPassword: 'BrandNewPassword456!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
