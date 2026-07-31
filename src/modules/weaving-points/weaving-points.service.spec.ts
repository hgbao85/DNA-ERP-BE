import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { WeavingPointsService } from './weaving-points.service';

describe('WeavingPointsService', () => {
  let service: WeavingPointsService;
  let prisma: {
    weavingPoint: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  const existingPoint = {
    id: 1n,
    code: 'DD-01',
    fullName: 'Diem dan 01',
    aliasNote: null,
    phone: null,
    address: null,
    dayDaiPercent: null,
    ketThucPercent: null,
    hangQuanPercent: null,
    note: null,
    isActive: true,
  };

  beforeEach(() => {
    prisma = {
      weavingPoint: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new WeavingPointsService(prisma as unknown as PrismaServiceType);
  });

  describe('create', () => {
    it('creates a weaving point when the code is free', async () => {
      prisma.weavingPoint.findUnique.mockResolvedValue(null);
      prisma.weavingPoint.create.mockResolvedValue(existingPoint);

      const result = await service.create({ code: 'DD-01' });

      expect(result.id).toBe('1');
    });

    it('rejects a duplicate code with 409', async () => {
      prisma.weavingPoint.findUnique.mockResolvedValue(existingPoint);

      await expect(service.create({ code: 'DD-01' } as any)).rejects.toThrow(ConflictException);
      expect(prisma.weavingPoint.create).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('throws 404 for a non-existent id', async () => {
      prisma.weavingPoint.findUnique.mockResolvedValue(null);

      await expect(service.findOne('999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('calls a real Prisma delete() - hard delete, not a manual isActive flip (soft-delete pending)', async () => {
      prisma.weavingPoint.findUnique.mockResolvedValue(existingPoint);

      await service.remove('1');

      expect(prisma.weavingPoint.delete).toHaveBeenCalledWith({ where: { id: 1n } });
      expect(prisma.weavingPoint.update).not.toHaveBeenCalled();
    });

    it('throws 404 when the weaving point does not exist', async () => {
      prisma.weavingPoint.findUnique.mockResolvedValue(null);

      await expect(service.remove('999')).rejects.toThrow(NotFoundException);
      expect(prisma.weavingPoint.delete).not.toHaveBeenCalled();
    });
  });
});
