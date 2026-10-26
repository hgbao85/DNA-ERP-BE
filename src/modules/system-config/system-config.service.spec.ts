import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { NetworkAccessService } from '../../common/network/network-access.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SystemConfigService } from './system-config.service';

describe('SystemConfigService', () => {
  let service: SystemConfigService;
  let prisma: {
    systemConfig: { findUnique: jest.Mock; update: jest.Mock };
    user: { findUnique: jest.Mock };
  };
  let notifications: { emit: jest.Mock };
  let network: {
    invalidate: jest.Mock;
    isEnforced: jest.Mock;
    isAllowed: jest.Mock;
  };

  /** Mô phỏng `Prisma.Decimal` tối thiểu - đủ cho `.toNumber()` mà findOne()/update() gọi. */
  const mockDecimal = (n: number) => ({ toNumber: () => n });

  const seededConfig = {
    id: 1,
    companyName: 'DNA Steel',
    companyAddress: null,
    companyPhone: null,
    companyEmail: null,
    taxCode: null,
    defaultCurrency: 'VND',
    solverStockLengths: [6000, 5800],
    solverTrimStartMm: 10,
    solverBladeWidthMm: mockDecimal(3),
    solverMaxWastePercentage: mockDecimal(5),
    solverMaxSurplus: 2,
    solverMinLengthMm: 100,
    solverMaxLengthMm: 6000,
    solverLengthStepMm: 10,
    solverTimeLimitSeconds: 30,
    solverAllowCustomLength: true,
    solverMachine: 'laser',
    solverMctdBladeWidthMm: mockDecimal(2.5),
    solverMctdTrimStartMm: 0,
    solverBundleFactors: [14, 16, 18, 20],
    solverMaxManualCuts: 5,
    solverMaxSizesPerPattern: 5,
    solverMergeWindowDays: 3,
    solverMergeMaxSkus: 5,
    purchaseOverReceiptTolerancePercent: mockDecimal(0),
    floorPublicUrl: null,
    floorAllowedIps: [],
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => {
    prisma = {
      systemConfig: { findUnique: jest.fn(), update: jest.fn() },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ firstName: 'Sang', lastName: 'Trần', username: 'khsx' }),
      },
    };
    notifications = { emit: jest.fn().mockResolvedValue(undefined) };
    network = {
      invalidate: jest.fn(),
      isEnforced: jest.fn().mockResolvedValue(false),
      isAllowed: jest.fn().mockResolvedValue(true),
    };
    service = new SystemConfigService(
      prisma as unknown as PrismaServiceType,
      notifications as unknown as NotificationsService,
      network as unknown as NetworkAccessService,
    );
  });

  describe('findOne', () => {
    it('throws 404 when the singleton row has never been seeded', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(null);

      await expect(service.findOne()).rejects.toThrow(NotFoundException);
    });

    it('always reads the pinned singleton id, regardless of caller input', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(seededConfig);

      await service.findOne();

      expect(prisma.systemConfig.findUnique).toHaveBeenCalledWith({ where: { id: 1 } });
    });

    it('casts the JSON solverStockLengths column back into a number array', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(seededConfig);

      const result = await service.findOne();

      expect(result.solverStockLengths).toEqual([6000, 5800]);
    });

    it('passes solverAllowCustomLength through untouched (mặc định công ty cho đặt cây ngoài chuẩn)', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(seededConfig);

      const result = await service.findOne();

      expect(result.solverAllowCustomLength).toBe(true);
    });

    it('máy cắt (2026-10-23): Decimal lưỡi MCTĐ -> number, JSON hệ số bó -> mảng số, còn lại giữ nguyên', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(seededConfig);

      const result = await service.findOne();

      expect(result.solverMachine).toBe('laser');
      expect(result.solverMctdBladeWidthMm).toBe(2.5);
      expect(result.solverMctdTrimStartMm).toBe(0);
      expect(result.solverBundleFactors).toEqual([14, 16, 18, 20]);
      expect(result.solverMaxManualCuts).toBe(5);
      expect(result.solverMaxSizesPerPattern).toBe(5);
    });
  });

  describe('update', () => {
    it('throws 404 and never writes when the singleton has not been seeded yet (no upsert)', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(null);

      await expect(service.update({ companyName: 'DNA Steel' } as any)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.systemConfig.update).not.toHaveBeenCalled();
    });

    it('always targets the pinned singleton id, ignoring any id the caller might smuggle in', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(seededConfig);
      prisma.systemConfig.update.mockResolvedValue({ ...seededConfig, companyName: 'DNA Steel 2' });

      await service.update({ id: 999, companyName: 'DNA Steel 2' } as any);

      expect(prisma.systemConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 } }),
      );
    });

    // 2026-10-13: địa chỉ ERP in lên tem QR máy xưởng - Admin đặt ở đây, QLSX chỉ đọc (FloorAdminService.getSettings).
    it('floorPublicUrl: chuẩn hoá về scheme://host (dán cả /login cũng được) trước khi lưu', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(seededConfig);
      prisma.systemConfig.update.mockResolvedValue({
        ...seededConfig,
        floorPublicUrl: 'https://erpdna.vercel.app',
      });

      const r = await service.update({
        companyName: 'DNA Steel',
        floorPublicUrl: ' https://erpdna.vercel.app/login ',
      });

      expect(prisma.systemConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ floorPublicUrl: 'https://erpdna.vercel.app' }) as unknown,
        }),
      );
      expect(r.floorPublicUrl).toBe('https://erpdna.vercel.app');
    });

    it('floorPublicUrl rỗng -> lưu null (xoá cài đặt); không gửi field -> KHÔNG đụng tới cột này', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(seededConfig);
      prisma.systemConfig.update.mockResolvedValue(seededConfig);

      await service.update({ companyName: 'DNA Steel', floorPublicUrl: '' });
      await service.update({ companyName: 'DNA Steel' });

      const calls = prisma.systemConfig.update.mock.calls as { data: Record<string, unknown> }[][];
      expect(calls[0][0].data.floorPublicUrl).toBeNull();
      expect('floorPublicUrl' in calls[1][0].data).toBe(false);
    });

    it('floorPublicUrl không hợp lệ (ftp://, nhúng mật khẩu) -> 400 và không ghi gì', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(seededConfig);

      await expect(
        service.update({ companyName: 'DNA Steel', floorPublicUrl: 'ftp://erp.congty.vn' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.systemConfig.update).not.toHaveBeenCalled();
    });

    // 2026-10-13: mạng công ty được phép đăng nhập (công nhân) - Admin quản lý ở Cấu hình hệ thống.
    it('floorAllowedIps: chuẩn hoá + bỏ trùng trước khi lưu, rồi xoá bộ nhớ đệm để có hiệu lực ngay', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(seededConfig);
      prisma.systemConfig.update.mockResolvedValue({
        ...seededConfig,
        floorAllowedIps: ['203.0.113.5', '198.51.100.0/24'],
      });

      const r = await service.update({
        companyName: 'DNA Steel',
        floorAllowedIps: [' 203.0.113.5 ', '203.0.113.5', '198.51.100.0/24'],
      });

      const calls = prisma.systemConfig.update.mock.calls as { data: Record<string, unknown> }[][];
      expect(calls[0][0].data.floorAllowedIps).toEqual(['203.0.113.5', '198.51.100.0/24']);
      expect(network.invalidate).toHaveBeenCalledTimes(1);
      expect(r.floorAllowedIps).toEqual(['203.0.113.5', '198.51.100.0/24']);
    });

    it('floorAllowedIps rỗng = tắt giới hạn (lưu mảng rỗng); không gửi field = KHÔNG đụng và không xoá cache', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(seededConfig);
      prisma.systemConfig.update.mockResolvedValue(seededConfig);

      await service.update({ companyName: 'DNA Steel', floorAllowedIps: [] });
      await service.update({ companyName: 'DNA Steel' });

      const calls = prisma.systemConfig.update.mock.calls as { data: Record<string, unknown> }[][];
      expect(calls[0][0].data.floorAllowedIps).toEqual([]);
      expect('floorAllowedIps' in calls[1][0].data).toBe(false);
      expect(network.invalidate).toHaveBeenCalledTimes(1);
    });

    it('floorAllowedIps có dòng sai / dải quá rộng -> 400, không ghi gì, không xoá cache', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(seededConfig);

      await expect(
        service.update({ companyName: 'DNA Steel', floorAllowedIps: ['203.0.113.5', 'rác'] }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.update({ companyName: 'DNA Steel', floorAllowedIps: ['0.0.0.0/0'] }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.systemConfig.update).not.toHaveBeenCalled();
      expect(network.invalidate).not.toHaveBeenCalled();
    });

    it('getNetworkInfo: trả IP BE thấy, cờ IP nội bộ (chưa khai TRUST_PROXY_HOPS), trạng thái giới hạn', async () => {
      network.isEnforced.mockResolvedValue(true);
      network.isAllowed.mockResolvedValue(false);

      expect(await service.getNetworkInfo('10.0.0.5')).toEqual({
        ip: '10.0.0.5',
        isPrivate: true,
        enforced: true,
        allowed: false,
      });
      expect(await service.getNetworkInfo('203.0.113.5')).toEqual(
        expect.objectContaining({ isPrivate: false }),
      );
      expect((await service.getNetworkInfo(undefined)).ip).toBeNull();
    });

    it('lưu được solverAllowCustomLength = false (cấm đặt cây ngoài chuẩn cho toàn hệ thống)', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(seededConfig);
      prisma.systemConfig.update.mockResolvedValue({
        ...seededConfig,
        solverAllowCustomLength: false,
      });

      const result = await service.update({
        companyName: 'DNA Steel',
        solverAllowCustomLength: false,
      });

      expect(prisma.systemConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ solverAllowCustomLength: false }) as unknown,
        }),
      );
      expect(result.solverAllowCustomLength).toBe(false);
    });

    it('lưu cấu hình máy cắt (đổi mặc định sang MC Tự động + tham số bó) và trả lại đã ép kiểu', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(seededConfig);
      prisma.systemConfig.update.mockResolvedValue({
        ...seededConfig,
        solverMachine: 'tu_dong',
        solverMctdBladeWidthMm: mockDecimal(3),
        solverMctdTrimStartMm: 5,
        solverBundleFactors: [10, 12],
        solverMaxManualCuts: 8,
        solverMaxSizesPerPattern: 4,
      });

      const result = await service.update({
        companyName: 'DNA Steel',
        solverMachine: 'tu_dong',
        solverMctdBladeWidthMm: 3,
        solverMctdTrimStartMm: 5,
        solverBundleFactors: [10, 12],
        solverMaxManualCuts: 8,
        solverMaxSizesPerPattern: 4,
      });

      expect(prisma.systemConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            solverMachine: 'tu_dong',
            solverBundleFactors: [10, 12],
          }) as unknown,
        }),
      );
      expect(result.solverMachine).toBe('tu_dong');
      expect(result.solverMctdBladeWidthMm).toBe(3);
      expect(result.solverBundleFactors).toEqual([10, 12]);
      expect(result.solverMaxSizesPerPattern).toBe(4);
    });
  });
  // ─── KHSX tự đổi ngưỡng hao hụt mặc định (2026-09-30) ──────────────────────────────────────
  describe('cutting defaults (KHSX đổi ngưỡng hao hụt mặc định)', () => {
    it('getCuttingDefaults trả đúng số hiện tại, dạng number (không phải Decimal)', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue({
        ...seededConfig,
        solverMaxWastePercentage: mockDecimal(1.5),
      });

      const result = await service.getCuttingDefaults();

      expect(result.solverMaxWastePercentage).toBe(1.5);
    });

    it('getCuttingDefaults trả kèm máy cắt mặc định để KHSX (không có quyền đọc /system-config) hiện "Theo mặc định (MC …)"', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue({
        ...seededConfig,
        solverMachine: 'tu_dong',
      });

      const result = await service.getCuttingDefaults();

      expect(result.solverMachine).toBe('tu_dong');
    });

    it('getCuttingDefaults trả kèm thông số 2 máy cắt (KHSX chỉ XEM, Admin sửa) - Decimal ra number', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(seededConfig);

      const result = await service.getCuttingDefaults();

      expect(result).toMatchObject({
        solverStockLengths: [6000, 5800],
        solverMaxSurplus: 2,
        solverTrimStartMm: 10,
        solverBladeWidthMm: 3,
        solverMctdTrimStartMm: 0,
        solverMctdBladeWidthMm: 2.5,
        solverBundleFactors: [14, 16, 18, 20],
        solverMaxManualCuts: 5,
        solverMaxSizesPerPattern: 5,
      });
    });

    it('CHỈ ghi đúng cột solverMaxWastePercentage - không đụng tham số solver/công ty nào khác', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(seededConfig); // hiện tại 5
      prisma.systemConfig.update.mockResolvedValue({
        ...seededConfig,
        solverMaxWastePercentage: mockDecimal(1.5),
      });

      const result = await service.updateMaxWastePercentage(
        { solverMaxWastePercentage: 1.5 },
        'user-khsx',
      );

      expect(prisma.systemConfig.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { solverMaxWastePercentage: 1.5 },
      });
      expect(result.solverMaxWastePercentage).toBe(1.5);
      expect(result.previous).toBe(5);
    });

    it('báo Sếp + QLSX kèm số cũ/mới, người đổi và lý do', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(seededConfig);
      prisma.systemConfig.update.mockResolvedValue({
        ...seededConfig,
        solverMaxWastePercentage: mockDecimal(2),
      });

      await service.updateMaxWastePercentage(
        { solverMaxWastePercentage: 2, reason: 'Đơn Goplus gấp' },
        'user-khsx',
      );

      expect(notifications.emit).toHaveBeenCalledWith('CUTTING_WASTE_DEFAULT_CHANGED', {
        entityId: 'system-config',
        actorId: 'user-khsx',
        params: { actorName: 'Trần Sang', previous: 5, next: 2, reason: 'Đơn Goplus gấp' },
      });
    });

    it('giá trị KHÔNG đổi -> không ghi DB, không báo (tránh nhiễu audit/thông báo)', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(seededConfig); // 5

      const result = await service.updateMaxWastePercentage(
        { solverMaxWastePercentage: 5 },
        'user-khsx',
      );

      expect(prisma.systemConfig.update).not.toHaveBeenCalled();
      expect(notifications.emit).not.toHaveBeenCalled();
      expect(result.solverMaxWastePercentage).toBe(5);
    });

    it('lỗi gửi thông báo KHÔNG làm hỏng việc đổi đã ghi (best-effort)', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(seededConfig);
      prisma.systemConfig.update.mockResolvedValue({
        ...seededConfig,
        solverMaxWastePercentage: mockDecimal(3),
      });
      notifications.emit.mockRejectedValue(new Error('db down'));

      await expect(
        service.updateMaxWastePercentage({ solverMaxWastePercentage: 3 }, 'user-khsx'),
      ).resolves.toMatchObject({ solverMaxWastePercentage: 3, previous: 5 });
    });

    it('báo 404 khi chưa seed cấu hình', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(null);

      await expect(
        service.updateMaxWastePercentage({ solverMaxWastePercentage: 3 }, 'user-khsx'),
      ).rejects.toThrow(NotFoundException);
      await expect(service.getCuttingDefaults()).rejects.toThrow(NotFoundException);
    });
  });
});
