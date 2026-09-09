import { ConflictException, NotFoundException } from '@nestjs/common';
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
    qcReview: { count: jest.Mock };
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
      // Mặc định "chưa từng dùng" - test riêng cho race/protect-lịch-sử tự override.
      qcReview: { count: jest.fn().mockResolvedValue(0) },
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

      expect(prisma.qcReview.count).toHaveBeenCalledWith({ where: { defectReasonId: 1n } });
      expect(prisma.defectReason.delete).toHaveBeenCalledWith({ where: { id: 1n } });
    });

    it('throws 404 on remove and never deletes when missing', async () => {
      prisma.defectReason.findUnique.mockResolvedValue(null);

      await expect(service.remove('999')).rejects.toThrow(NotFoundException);
      expect(prisma.defectReason.delete).not.toHaveBeenCalled();
    });

    // Trung bình, audit toàn diện 09/09/2026: QcReview.defectReasonId có FK "ON DELETE SET NULL"
    // (migration 20260811063513) - trước đây remove() xoá thẳng không kiểm, thành công lặng lẽ và
    // NULL hoá defectReasonId của MỌI lần duyệt KCS quá khứ từng dùng lý do đó, mất khả năng tra
    // cứu "lỗi nào xảy ra bao nhiêu lần" mà không có cảnh báo nào.
    it('chặn xoá (409) khi lý do lỗi đang được dùng trong lịch sử KCS - không âm thầm SET NULL', async () => {
      prisma.defectReason.findUnique.mockResolvedValue(reason);
      prisma.qcReview.count.mockResolvedValue(3);

      await expect(service.remove('1')).rejects.toThrow(ConflictException);
      expect(prisma.defectReason.delete).not.toHaveBeenCalled();
    });
  });
});
