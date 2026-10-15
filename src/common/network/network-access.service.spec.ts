import { ForbiddenException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { NETWORK_NOT_ALLOWED_MESSAGE, NetworkAccessService } from './network-access.service';

describe('NetworkAccessService', () => {
  let prisma: { systemConfig: { findUnique: jest.Mock } };
  let service: NetworkAccessService;

  const worker = { roles: ['FLOOR_WORKER'], mfgRole: 'PHOI' };
  const boss = { roles: ['BOSS'], mfgRole: null };

  beforeEach(() => {
    prisma = { systemConfig: { findUnique: jest.fn().mockResolvedValue({ floorAllowedIps: [] }) } };
    service = new NetworkAccessService(prisma as unknown as PrismaServiceType);
  });

  it('danh sách rỗng = TẮT: mọi tài khoản, mọi IP đều qua', async () => {
    await expect(service.assertAccountAllowed(worker, '8.8.8.8')).resolves.toBeUndefined();
    expect(await service.isEnforced()).toBe(false);
  });

  it('có danh sách: công nhân ngoài mạng bị 403 với thông báo rõ; trong mạng thì qua', async () => {
    prisma.systemConfig.findUnique.mockResolvedValue({ floorAllowedIps: ['203.0.113.0/24'] });

    await expect(service.assertAccountAllowed(worker, '8.8.8.8')).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.assertAccountAllowed(worker, '8.8.8.8')).rejects.toThrow(
      NETWORK_NOT_ALLOWED_MESSAGE,
    );
    await expect(service.assertAccountAllowed(worker, '203.0.113.77')).resolves.toBeUndefined();
    expect(await service.isEnforced()).toBe(true);
  });

  it('isAccountAllowed: bản KHÔNG ném lỗi - dùng cho việc hỏi trạng thái mà không lộ thông tin', async () => {
    prisma.systemConfig.findUnique.mockResolvedValue({ floorAllowedIps: ['203.0.113.0/24'] });
    expect(await service.isAccountAllowed(worker, '203.0.113.9')).toBe(true);
    expect(await service.isAccountAllowed(worker, '8.8.8.8')).toBe(false);
    expect(await service.isAccountAllowed(worker, undefined)).toBe(false);
    expect(await service.isAccountAllowed(boss, '8.8.8.8')).toBe(true); // không thuộc diện giới hạn
    prisma.systemConfig.findUnique.mockResolvedValue({ floorAllowedIps: [] });
    service.invalidate();
    expect(await service.isAccountAllowed(worker, '8.8.8.8')).toBe(true); // danh sách rỗng = tắt
  });

  it('Sếp/Admin/QLSX không bao giờ bị chặn dù ở ngoài mạng', async () => {
    prisma.systemConfig.findUnique.mockResolvedValue({ floorAllowedIps: ['203.0.113.5'] });
    await expect(service.assertAccountAllowed(boss, '8.8.8.8')).resolves.toBeUndefined();
    await expect(
      service.assertAccountAllowed({ roles: ['ADMIN'], mfgRole: null }, undefined),
    ).resolves.toBeUndefined();
  });

  it('không đọc được IP khách mà giới hạn đang bật -> chặn công nhân (không đoán)', async () => {
    prisma.systemConfig.findUnique.mockResolvedValue({ floorAllowedIps: ['203.0.113.5'] });
    await expect(service.assertAccountAllowed(worker, undefined)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('danh sách được nhớ 30 giây (không đọc DB mỗi request); invalidate() đọc lại ngay', async () => {
    jest.useFakeTimers();
    try {
      prisma.systemConfig.findUnique.mockResolvedValue({ floorAllowedIps: ['1.1.1.1'] });
      await service.allowedIps();
      await service.allowedIps();
      expect(prisma.systemConfig.findUnique).toHaveBeenCalledTimes(1);

      service.invalidate();
      prisma.systemConfig.findUnique.mockResolvedValue({ floorAllowedIps: ['2.2.2.2'] });
      expect(await service.allowedIps()).toEqual(['2.2.2.2']);

      jest.advanceTimersByTime(31_000);
      prisma.systemConfig.findUnique.mockResolvedValue({ floorAllowedIps: ['3.3.3.3'] });
      expect(await service.allowedIps()).toEqual(['3.3.3.3']);
    } finally {
      jest.useRealTimers();
    }
  });

  it('DB lỗi thoáng qua: dùng bản đã nhớ (không đổi quyết định đột ngột); chưa có gì thì ném lỗi', async () => {
    jest.useFakeTimers();
    try {
      prisma.systemConfig.findUnique.mockRejectedValue(new Error('db down'));
      await expect(service.allowedIps()).rejects.toThrow('db down');

      prisma.systemConfig.findUnique.mockResolvedValue({ floorAllowedIps: ['1.1.1.1'] });
      await service.allowedIps();
      jest.advanceTimersByTime(31_000);
      prisma.systemConfig.findUnique.mockRejectedValue(new Error('db down'));
      expect(await service.allowedIps()).toEqual(['1.1.1.1']);
    } finally {
      jest.useRealTimers();
    }
  });
});
