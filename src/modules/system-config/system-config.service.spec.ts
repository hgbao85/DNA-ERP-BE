import { NotFoundException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { SystemConfigService } from './system-config.service';

describe('SystemConfigService', () => {
  let service: SystemConfigService;
  let prisma: { systemConfig: { findUnique: jest.Mock; update: jest.Mock } };

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
    purchaseOverReceiptTolerancePercent: mockDecimal(0),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => {
    prisma = { systemConfig: { findUnique: jest.fn(), update: jest.fn() } };
    service = new SystemConfigService(prisma as unknown as PrismaServiceType);
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
  });
});
