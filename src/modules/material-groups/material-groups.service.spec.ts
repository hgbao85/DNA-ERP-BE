import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { MaterialGroupsService } from './material-groups.service';

describe('MaterialGroupsService', () => {
  let service: MaterialGroupsService;
  let prisma: {
    materialGroup: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  const systemGroup = { id: 1n, name: 'Sat', systemKey: 'STEEL_BAR', codePrefix: 'SAT' };
  const ordinaryGroup = { id: 2n, name: 'Nhua', systemKey: null, codePrefix: 'NHU' };

  beforeEach(() => {
    prisma = {
      materialGroup: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new MaterialGroupsService(prisma as unknown as PrismaServiceType);
  });

  describe('create - uniqueness', () => {
    it('rejects a duplicate name with 409', async () => {
      prisma.materialGroup.findUnique.mockResolvedValueOnce(ordinaryGroup);

      await expect(service.create({ name: 'Nhua', codePrefix: 'NEW' } as any)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.materialGroup.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate codePrefix even when the name is free', async () => {
      prisma.materialGroup.findUnique
        .mockResolvedValueOnce(null) // name check passes
        .mockResolvedValueOnce(ordinaryGroup); // codePrefix check collides

      await expect(service.create({ name: 'Moi', codePrefix: 'NHU' } as any)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.materialGroup.create).not.toHaveBeenCalled();
    });

    it('creates when both name and codePrefix are free', async () => {
      prisma.materialGroup.findUnique.mockResolvedValue(null);
      prisma.materialGroup.create.mockResolvedValue(ordinaryGroup);

      const result = await service.create({ name: 'Nhua', codePrefix: 'NHU' });

      expect(result.id).toBe('2');
    });
  });

  describe('update - uniqueness excludes self', () => {
    it('allows saving a group with its own unchanged name/codePrefix', async () => {
      prisma.materialGroup.findUnique
        .mockResolvedValueOnce(ordinaryGroup) // findOneOrThrow
        .mockResolvedValueOnce(ordinaryGroup) // name check hits itself
        .mockResolvedValueOnce(ordinaryGroup); // codePrefix check hits itself
      prisma.materialGroup.update.mockResolvedValue(ordinaryGroup);

      await expect(
        service.update('2', { name: 'Nhua', codePrefix: 'NHU' } as any),
      ).resolves.toBeDefined();
      expect(prisma.materialGroup.update).toHaveBeenCalled();
    });

    it('rejects renaming to a name already used by a different group', async () => {
      prisma.materialGroup.findUnique
        .mockResolvedValueOnce(ordinaryGroup) // findOneOrThrow
        .mockResolvedValueOnce(systemGroup); // name collides with a different row

      await expect(service.update('2', { name: 'Sat' } as any)).rejects.toThrow(ConflictException);
      expect(prisma.materialGroup.update).not.toHaveBeenCalled();
    });
  });

  describe('remove - protects the 6 seeded system groups', () => {
    it('blocks deleting a group with a systemKey, never touches the DB write', async () => {
      prisma.materialGroup.findUnique.mockResolvedValue(systemGroup);

      await expect(service.remove('1')).rejects.toThrow(BadRequestException);
      expect(prisma.materialGroup.delete).not.toHaveBeenCalled();
    });

    it('allows deleting an ordinary (non-system) group', async () => {
      prisma.materialGroup.findUnique.mockResolvedValue(ordinaryGroup);

      await service.remove('2');

      expect(prisma.materialGroup.delete).toHaveBeenCalledWith({ where: { id: 2n } });
    });
  });
});
