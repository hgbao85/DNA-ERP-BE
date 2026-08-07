import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { MaterialsService } from './materials.service';

/** `code` truyền cho lệnh gọi `create()`/`update()` gần nhất trên 1 jest.Mock chưa gõ kiểu
 * (jest.Mock trần -> .mock.calls là any[][]) - cast tường minh 1 chỗ duy nhất thay vì lặp lại
 * `expect.objectContaining` lồng nhau ở từng test (bị @typescript-eslint/no-unsafe-assignment
 * chặn commit vì TS không suy được kiểu qua nhiều lớp objectContaining lồng nhau). */
function createdCode(mock: jest.Mock): unknown {
  const calls = mock.mock.calls as Array<[{ data?: { code?: unknown } }]>;
  return calls.at(-1)?.[0]?.data?.code;
}

describe('MaterialsService', () => {
  let service: MaterialsService;
  let prisma: {
    material: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    materialGroup: { findUnique: jest.Mock };
  };

  const existingMaterial = {
    id: 1n,
    code: 'SAT-01',
    name: 'Sat cay',
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
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      materialGroup: { findUnique: jest.fn() },
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

    it('auto-generates a code when none is given (no group -> fallback prefix VT)', async () => {
      prisma.material.findMany.mockResolvedValue([]);
      prisma.material.findUnique.mockResolvedValue(null);
      prisma.material.create.mockResolvedValue({ ...existingMaterial, code: 'VT-001' });

      await service.create({ name: 'Khong co ma', unit: 'kg' });

      expect(prisma.materialGroup.findUnique).not.toHaveBeenCalled();
      expect(prisma.material.findMany).toHaveBeenCalledWith({
        where: { code: { startsWith: 'VT-' } },
        select: { code: true },
      });
      expect(createdCode(prisma.material.create)).toBe('VT-001');
    });

    it('treats a whitespace-only code as absent and auto-generates instead (no blank code written)', async () => {
      prisma.material.findMany.mockResolvedValue([]);
      prisma.material.findUnique.mockResolvedValue(null);
      prisma.material.create.mockResolvedValue({ ...existingMaterial, code: 'VT-001' });

      await service.create({ code: '   ', name: 'Whitespace code', unit: 'kg' });

      expect(createdCode(prisma.material.create)).toBe('VT-001');
    });

    it("auto-generates a code from the group's codePrefix, continuing past the highest used sequence", async () => {
      prisma.materialGroup.findUnique.mockResolvedValue({
        id: 7n,
        name: 'Sắt',
        systemKey: 'STEEL_BAR',
        codePrefix: 'SAT',
      });
      prisma.material.findMany.mockResolvedValue([{ code: 'SAT-001' }, { code: 'SAT-003' }]);
      prisma.material.findUnique.mockResolvedValue(null);
      prisma.material.create.mockResolvedValue({ ...existingMaterial, code: 'SAT-004' });

      await service.create({ name: 'Sat vuong', unit: 'cay', materialGroupId: '7' });

      expect(prisma.material.findMany).toHaveBeenCalledWith({
        where: { code: { startsWith: 'SAT-' } },
        select: { code: true },
      });
      expect(createdCode(prisma.material.create)).toBe('SAT-004');
    });

    it('rejects a missing name/unit with a clean 400', async () => {
      await expect(service.create({ code: 'SAT-03' } as any)).rejects.toThrow(BadRequestException);
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
