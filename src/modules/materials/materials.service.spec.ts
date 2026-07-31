import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { MaterialsService } from './materials.service';

describe('MaterialsService', () => {
  let service: MaterialsService;
  let prisma: {
    material: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock };
  };

  const existingMaterial = {
    id: 1n,
    code: 'SAT-01',
    name: 'Sat cay',
    kind: 'STEEL_BAR',
    unit: 'kg',
    materialGroupId: null,
    khoUnitFactor: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    prisma = {
      material: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new MaterialsService(prisma as unknown as PrismaServiceType);
  });

  describe('create', () => {
    it('creates a material when the code is free', async () => {
      prisma.material.findUnique.mockResolvedValue(null);
      prisma.material.create.mockResolvedValue(existingMaterial);

      const result = await service.create({ code: 'SAT-01', name: 'Sat cay', unit: 'kg' });

      expect(result.id).toBe('1');
      expect(prisma.material.create).toHaveBeenCalled();
    });

    it('rejects a duplicate code with 409, does not write', async () => {
      prisma.material.findUnique.mockResolvedValue(existingMaterial);

      await expect(
        service.create({ code: 'SAT-01', name: 'Trung code', unit: 'kg' } as any),
      ).rejects.toThrow(ConflictException);
      expect(prisma.material.create).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('throws 404 for a non-existent id', async () => {
      prisma.material.findUnique.mockResolvedValue(null);

      await expect(service.findOne('999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('rejects renaming to a code already used by a different material', async () => {
      prisma.material.findUnique
        .mockResolvedValueOnce(existingMaterial) // findOneOrThrow(id)
        .mockResolvedValueOnce({ ...existingMaterial, id: 2n, code: 'SAT-02' }); // code clash check

      await expect(service.update('1', { code: 'SAT-02' } as any)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.material.update).not.toHaveBeenCalled();
    });

    it('allows keeping the same code on the same record (no false-positive clash)', async () => {
      prisma.material.findUnique
        .mockResolvedValueOnce(existingMaterial)
        .mockResolvedValueOnce(existingMaterial);
      prisma.material.update.mockResolvedValue(existingMaterial);

      await expect(
        service.update('1', { code: 'SAT-01', name: 'Renamed' } as any),
      ).resolves.toBeDefined();
    });
  });

  describe('remove', () => {
    it('calls a real Prisma delete() - hard delete, not a manual isActive flip (soft-delete pending)', async () => {
      prisma.material.findUnique.mockResolvedValue(existingMaterial);

      await service.remove('1');

      expect(prisma.material.delete).toHaveBeenCalledWith({ where: { id: 1n } });
      expect(prisma.material.update).not.toHaveBeenCalled();
    });

    it('throws 404 when the material does not exist', async () => {
      prisma.material.findUnique.mockResolvedValue(null);

      await expect(service.remove('999')).rejects.toThrow(NotFoundException);
      expect(prisma.material.delete).not.toHaveBeenCalled();
    });
  });
});
