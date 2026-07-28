// jest's `expect.objectContaining` is typed `any`, which trips no-unsafe-assignment on
// every `toHaveBeenCalledWith(expect.objectContaining({...}))` below - standard jest usage.
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let usersService: UsersService;
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock };
    refreshToken: { updateMany: jest.Mock };
    $transaction: jest.Mock;
  };

  const existingUser = { id: 'user-1', username: 'nv01', password: 'OLD_HASH' };
  const newPassword = 'BrandNewPassword456!';

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      refreshToken: { updateMany: jest.fn() },
      // Run the callback synchronously against the same mock, mirroring auth.service.spec.
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
    };

    usersService = new UsersService(prisma as unknown as PrismaServiceType);
  });

  describe('resetPassword', () => {
    it('hashes the new password, stores it, and revokes the user live refresh tokens', async () => {
      prisma.user.findUnique.mockResolvedValue(existingUser);

      await usersService.resetPassword('user-1', { newPassword });

      // Password is written to the target user...
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({ password: expect.any(String) }),
        }),
      );

      // ...as a real argon2 hash, never the plaintext.
      const updateMock = prisma.user.update as jest.Mock<unknown, [{ data: { password: string } }]>;
      const stored = updateMock.mock.calls[0][0].data.password;
      expect(stored).not.toBe(newPassword);
      await expect(argon2.verify(stored, newPassword)).resolves.toBe(true);

      // ...and every live refresh token of that user is revoked (old sessions die).
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', revokedAt: null },
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );
    });

    it('throws NotFound and writes nothing when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(usersService.resetPassword('missing-user', { newPassword })).rejects.toThrow(
        NotFoundException,
      );

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });
  });
});
