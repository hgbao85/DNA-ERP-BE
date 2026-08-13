import { NotFoundException } from '@nestjs/common';
import { MfgStage } from '../../generated/prisma/client';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { DefectReasonsService } from './defect-reasons.service';

describe('DefectReasonsService', () => {
  let service: DefectReasonsService;
  let prisma: {
    defectReason: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  const reason = { id: 1n, label: 'Cong meo', stageType: MfgStage.HAN };

  beforeEach(() => {
    prisma = {
      defectReason: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new DefectReasonsService(prisma as unknown as PrismaServiceType);
  });

  describe('create', () => {
    it('allows stageType to be omitted (applies to every stage)', async () => {
      prisma.defectReason.create.mockResolvedValue({ ...reason, stageType: null });

      const result = await service.create({ label: 'Loi chung' });

      expect(prisma.defectReason.create).toHaveBeenCalledWith({
        data: { label: 'Loi chung', stageType: undefined },
      });
      expect(result.stageType).toBeNull();
    });

    it('stringifies the bigint id on the response', async () => {
      prisma.defectReason.create.mockResolvedValue(reason);

      const result = await service.create({ label: 'Cong meo', stageType: MfgStage.HAN });

      expect(result.id).toBe('1');
    });
  });

  describe('findOne / update / remove', () => {
    it('throws 404 on findOne when missing', async () => {
      prisma.defectReason.findUnique.mockResolvedValue(null);

      await expect(service.findOne('999')).rejects.toThrow(NotFoundException);
    });

    it('throws 404 on update and never writes when missing', async () => {
      prisma.defectReason.findUnique.mockResolvedValue(null);

      await expect(service.update('999', { label: 'X' } as any)).rejects.toThrow(NotFoundException);
      expect(prisma.defectReason.update).not.toHaveBeenCalled();
    });

    it('deletes for real - this table has no isActive/deletedAt column', async () => {
      prisma.defectReason.findUnique.mockResolvedValue(reason);

      await service.remove('1');

      expect(prisma.defectReason.delete).toHaveBeenCalledWith({ where: { id: 1n } });
    });

    it('throws 404 on remove and never deletes when missing', async () => {
      prisma.defectReason.findUnique.mockResolvedValue(null);

      await expect(service.remove('999')).rejects.toThrow(NotFoundException);
      expect(prisma.defectReason.delete).not.toHaveBeenCalled();
    });
  });
});
