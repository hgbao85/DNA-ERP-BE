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
    user: { findUnique: jest.Mock; findUniqueOrThrow: jest.Mock; update: jest.Mock };
    refreshToken: { updateMany: jest.Mock };
    $transaction: jest.Mock;
  };

  const existingUser = { id: 'user-1', username: 'nv01', password: 'OLD_HASH' };
  const newPassword = 'BrandNewPassword456!';

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
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

  // 2026-09-03: trước đây warehouseScope của floor role (PHOI/HAN/SON/KCS) luôn bị ép cứng về
  // literal 'phoi-son-han' bất kể caller gửi gì - không công nhân nào gán được vào kho phoi-son-han
  // PHỤ dù Admin đã tạo thêm. dto.mfgRole cố ý bỏ trống (undefined) ở mọi test dưới đây để nhánh
  // gán lại capability Role (cần mock role/userRole riêng) không chạy - chỉ test đúng phần quyết
  // định warehouseScope.
  describe('updateMfgAttributes', () => {
    const floorUser = { id: 'user-1', mfgRole: 'PHOI', warehouseScope: 'phoi-son-han' };

    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(floorUser);
      prisma.user.findUniqueOrThrow.mockResolvedValue({ ...floorUser, roles: [] });
    });

    it('tin warehouseScope caller gửi nếu thuộc đúng gia đình phoi-son-han (kho PHỤ)', async () => {
      await usersService.updateMfgAttributes('user-1', { warehouseScope: 'phoi-son-han-2' });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({ warehouseScope: 'phoi-son-han-2' }),
        }),
      );
    });

    it('fallback về kho gốc nếu caller không gửi warehouseScope nào', async () => {
      await usersService.updateMfgAttributes('user-1', {});

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ warehouseScope: 'phoi-son-han' }),
        }),
      );
    });

    it('fallback về kho gốc nếu caller gửi warehouseScope KHÔNG thuộc gia đình phoi-son-han (dữ liệu bất thường, không tin mù quáng)', async () => {
      await usersService.updateMfgAttributes('user-1', { warehouseScope: 'vat-tu-tp' });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ warehouseScope: 'phoi-son-han' }),
        }),
      );
    });
  });
});
