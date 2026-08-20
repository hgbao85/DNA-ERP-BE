import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { SegmentSpecsService } from './segment-specs.service';

/** Mô phỏng `Prisma.Decimal` tối thiểu (2026-08-19, cutLengthMm giờ Decimal(7,1)) - đủ cho cả
 *  `.toNumber()` LẪN ép kiểu `Number(x)` (dùng .valueOf) mà code service gọi tới. */
const mockDecimal = (n: number) => ({
  toNumber: () => n,
  valueOf: () => n,
  toString: () => String(n),
});

describe('SegmentSpecsService', () => {
  let service: SegmentSpecsService;
  let prisma: {
    segmentSpec: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock };
    material: { findUnique: jest.Mock };
  };

  const steelMaterial = {
    id: 10n,
    code: 'SAT-001',
    materialGroup: { systemKey: 'STEEL_BAR' },
  };
  const nonSteelMaterial = {
    id: 20n,
    code: 'SON-001',
    materialGroup: { systemKey: 'PAINT' },
  };

  const existingSpec = {
    id: 1n,
    materialId: 10n,
    cutLengthMm: mockDecimal(930),
    material: steelMaterial,
  };

  beforeEach(() => {
    prisma = {
      segmentSpec: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      material: { findUnique: jest.fn() },
    };
    service = new SegmentSpecsService(prisma as unknown as PrismaServiceType);
  });

  describe('create - materialId must be a STEEL_BAR material', () => {
    it('throws 404 when the material does not exist', async () => {
      prisma.material.findUnique.mockResolvedValue(null);

      await expect(service.create({ materialId: '999', cutLengthMm: 930 } as any)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.segmentSpec.create).not.toHaveBeenCalled();
    });

    it('throws 400 when the material belongs to a non-STEEL_BAR group (this rule has no DB CHECK)', async () => {
      prisma.material.findUnique.mockResolvedValue(nonSteelMaterial);

      await expect(service.create({ materialId: '20', cutLengthMm: 930 } as any)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.segmentSpec.create).not.toHaveBeenCalled();
    });

    it('throws 409 when the same (materialId, cutLengthMm) pair already exists', async () => {
      prisma.material.findUnique.mockResolvedValue(steelMaterial);
      prisma.segmentSpec.findUnique.mockResolvedValue(existingSpec);

      await expect(service.create({ materialId: '10', cutLengthMm: 930 } as any)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.segmentSpec.create).not.toHaveBeenCalled();
    });

    it('creates when the material is STEEL_BAR and the length is free', async () => {
      prisma.material.findUnique.mockResolvedValue(steelMaterial);
      prisma.segmentSpec.findUnique.mockResolvedValue(null);
      prisma.segmentSpec.create.mockResolvedValue(existingSpec);

      const result = await service.create({ materialId: '10', cutLengthMm: 930 });

      expect(result.materialCode).toBe('SAT-001');
    });
  });

  describe('update - only re-validates what actually changed', () => {
    it('throws 404 and never writes when the spec does not exist', async () => {
      prisma.segmentSpec.findUnique.mockResolvedValue(null);

      await expect(service.update('999', { cutLengthMm: 1000 } as any)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.segmentSpec.update).not.toHaveBeenCalled();
    });

    it('changing only cutLengthMm never re-checks the steel-group rule, only the free-length check', async () => {
      prisma.segmentSpec.findUnique
        .mockResolvedValueOnce(existingSpec) // findOneOrThrow
        .mockResolvedValueOnce(null); // assertSpecFree: new length is free
      prisma.segmentSpec.update.mockResolvedValue({ ...existingSpec, cutLengthMm: 1000 });

      await service.update('1', { cutLengthMm: 1000 });

      expect(prisma.material.findUnique).not.toHaveBeenCalled();
      expect(prisma.segmentSpec.update).toHaveBeenCalledWith({
        where: { id: 1n },
        data: { materialId: undefined, cutLengthMm: 1000 },
        include: { material: true },
      });
    });

    it('changing materialId re-validates the new material is STEEL_BAR', async () => {
      prisma.segmentSpec.findUnique
        .mockResolvedValueOnce(existingSpec) // findOneOrThrow
        .mockResolvedValueOnce(null); // assertSpecFree
      prisma.material.findUnique.mockResolvedValue(nonSteelMaterial);

      await expect(service.update('1', { materialId: '20' } as any)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.segmentSpec.update).not.toHaveBeenCalled();
    });

    it('does not treat a spec as conflicting with itself when the length is left unchanged', async () => {
      prisma.segmentSpec.findUnique.mockResolvedValueOnce(existingSpec); // findOneOrThrow only

      prisma.segmentSpec.update.mockResolvedValue(existingSpec);

      await service.update('1', {});

      // Neither materialId nor cutLengthMm changed -> assertSpecFree is skipped entirely.
      expect(prisma.segmentSpec.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.segmentSpec.update).toHaveBeenCalled();
    });

    it('throws 409 when the new length collides with a different spec for the same material', async () => {
      const otherSpec = { ...existingSpec, id: 2n };
      prisma.segmentSpec.findUnique
        .mockResolvedValueOnce(existingSpec) // findOneOrThrow
        .mockResolvedValueOnce(otherSpec); // assertSpecFree hits a different row

      await expect(service.update('1', { cutLengthMm: 930 } as any)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.segmentSpec.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('throws 404 and never deletes when the spec does not exist', async () => {
      prisma.segmentSpec.findUnique.mockResolvedValue(null);

      await expect(service.remove('999')).rejects.toThrow(NotFoundException);
      expect(prisma.segmentSpec.delete).not.toHaveBeenCalled();
    });

    it('deletes an existing spec', async () => {
      prisma.segmentSpec.findUnique.mockResolvedValue(existingSpec);

      await service.remove('1');

      expect(prisma.segmentSpec.delete).toHaveBeenCalledWith({ where: { id: 1n } });
    });
  });
});
