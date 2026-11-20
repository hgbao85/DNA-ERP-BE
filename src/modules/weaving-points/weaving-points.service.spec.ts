import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
    weavingIssue: { count: jest.Mock };
    weavingReceipt: { count: jest.Mock };
    weavingIssueMaterial: { count: jest.Mock };
    issueSlip: { count: jest.Mock };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
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

  // 19/11: người gọi route ghi - mặc định Admin (các test cũ không quan tâm quyền).
  const admin = { roles: ['ADMIN'], warehouseScope: null };

  beforeEach(() => {
    prisma = {
      weavingPoint: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      weavingIssue: { count: jest.fn().mockResolvedValue(0) },
      weavingReceipt: { count: jest.fn().mockResolvedValue(0) },
      weavingIssueMaterial: { count: jest.fn().mockResolvedValue(0) },
      issueSlip: { count: jest.fn().mockResolvedValue(0) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(prisma))),
    };
    service = new WeavingPointsService(prisma as unknown as PrismaServiceType);
  });

  describe('create', () => {
    it('creates a weaving point when the code is free', async () => {
      prisma.weavingPoint.findUnique.mockResolvedValue(null);
      prisma.weavingPoint.create.mockResolvedValue(existingPoint);

      const result = await service.create({ code: 'DD-01' }, admin);

      expect(result.id).toBe('1');
    });

    it('rejects a duplicate code with 409', async () => {
      prisma.weavingPoint.findUnique.mockResolvedValue(existingPoint);

      await expect(service.create({ code: 'DD-01' }, admin)).rejects.toThrow(ConflictException);
      expect(prisma.weavingPoint.create).not.toHaveBeenCalled();
    });
  });

  describe('19/11: chỉ Admin và thủ kho Phụ kiện được thêm / sửa / xoá', () => {
    it.each([
      ['thủ kho kho khác', { roles: ['WAREHOUSE_STAFF'], warehouseScope: 'phoi-son-han' }],
      ['tài khoản văn phòng chưa gán kho', { roles: ['WAREHOUSE_STAFF'], warehouseScope: null }],
      ['Giám đốc (chỉ xem)', { roles: ['BOSS'], warehouseScope: null }],
    ])('%s -> 403 ở cả tạo / sửa / xoá, không ghi gì', async (_label, actor) => {
      prisma.weavingPoint.findUnique.mockResolvedValue(existingPoint);
      await expect(service.create({ code: 'DD-02' }, actor)).rejects.toThrow(ForbiddenException);
      await expect(service.update('1', { phone: '0900' }, actor)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.remove('1', actor)).rejects.toThrow(ForbiddenException);
      expect(prisma.weavingPoint.create).not.toHaveBeenCalled();
      expect(prisma.weavingPoint.update).not.toHaveBeenCalled();
      expect(prisma.weavingPoint.delete).not.toHaveBeenCalled();
    });

    it('thủ kho Phụ kiện (cả kho phụ vat-tu-tp-2) -> được', async () => {
      prisma.weavingPoint.findUnique.mockResolvedValue(null);
      prisma.weavingPoint.create.mockResolvedValue(existingPoint);
      await service.create(
        { code: 'DD-03' },
        { roles: ['WAREHOUSE_STAFF'], warehouseScope: 'vat-tu-tp' },
      );
      await service.create(
        { code: 'DD-04' },
        { roles: ['WAREHOUSE_STAFF'], warehouseScope: 'vat-tu-tp-2' },
      );
      expect(prisma.weavingPoint.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('findOne', () => {
    it('throws 404 for a non-existent id', async () => {
      prisma.weavingPoint.findUnique.mockResolvedValue(null);

      await expect(service.findOne('999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('chưa có phiếu nào -> xoá thật (hard delete) trong giao dịch, sau khi khoá dòng điểm đan', async () => {
      prisma.weavingPoint.findUnique.mockResolvedValue(existingPoint);

      await service.remove('1', admin);

      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(prisma.weavingPoint.delete).toHaveBeenCalledWith({ where: { id: 1n } });
      expect(prisma.weavingPoint.update).not.toHaveBeenCalled();
    });

    it('19/11: đã có phiếu XK nháp gắn điểm đan -> 409, không xoá (trước đây phiếu âm thầm mất điểm đan)', async () => {
      prisma.weavingPoint.findUnique.mockResolvedValue(existingPoint);
      prisma.issueSlip.count.mockResolvedValue(1);

      await expect(service.remove('1', admin)).rejects.toThrow(/không xoá được/);
      expect(prisma.weavingPoint.delete).not.toHaveBeenCalled();
    });

    it('throws 404 when the weaving point does not exist', async () => {
      prisma.weavingPoint.findUnique.mockResolvedValue(null);

      await expect(service.remove('999', admin)).rejects.toThrow(NotFoundException);
      expect(prisma.weavingPoint.delete).not.toHaveBeenCalled();
    });
  });
});
