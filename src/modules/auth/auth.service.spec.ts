// jest's `expect.objectContaining` is typed `any`, which trips no-unsafe-assignment
// on every `toHaveBeenCalledWith(expect.objectContaining({...}))` below - standard
// jest usage, not a real type-safety gap.
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AppConfig } from '../../config/configuration';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let authService: AuthService;
  let usersService: jest.Mocked<
    Pick<UsersService, 'findAuthProfileByEmail' | 'findAuthProfileById'>
  >;
  let prisma: {
    refreshToken: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let jwtService: jest.Mocked<Pick<JwtService, 'signAsync'>>;
  let configService: { get: jest.Mock };

  const rawPassword = 'CorrectHorseBatteryStaple123!';
  let hashedPassword: string;

  const buildUser = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'user-1',
    email: 'admin@dna-erp.local',
    password: hashedPassword,
    isActive: true,
    roles: [
      {
        role: {
          name: 'SUPER_ADMIN',
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
      findAuthProfileByEmail: jest.fn(),
      findAuthProfileById: jest.fn(),
    };

    prisma = {
      refreshToken: {
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'refresh-token-1' }),
        update: jest.fn(),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
    };

    jwtService = { signAsync: jest.fn().mockResolvedValue('signed.access.token') };

    configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          'jwt.accessSecret': 'access-secret',
          'jwt.accessExpiresIn': '15m',
          'jwt.refreshSecret': 'refresh-secret',
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
    );
  });

  describe('login', () => {
    it('issues an access + refresh token pair for valid credentials', async () => {
      usersService.findAuthProfileByEmail.mockResolvedValue(buildUser() as never);

      const result = await authService.login(
        { email: 'admin@dna-erp.local', password: rawPassword },
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
      usersService.findAuthProfileByEmail.mockResolvedValue(null);

      await expect(
        authService.login({ email: 'nobody@dna-erp.local', password: rawPassword }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a wrong password', async () => {
      usersService.findAuthProfileByEmail.mockResolvedValue(buildUser() as never);

      await expect(
        authService.login({ email: 'admin@dna-erp.local', password: 'wrong-password' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an inactive user', async () => {
      usersService.findAuthProfileByEmail.mockResolvedValue(
        buildUser({ isActive: false }) as never,
      );

      await expect(
        authService.login({ email: 'admin@dna-erp.local', password: rawPassword }),
      ).rejects.toThrow(UnauthorizedException);
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
});
