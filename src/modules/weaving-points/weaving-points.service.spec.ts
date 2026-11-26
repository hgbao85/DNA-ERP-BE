import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { WeavingPointsService } from './weaving-points.service';

describe('WeavingPointsService', () => {
  let service: WeavingPointsService;
  let prisma: {
    weavingPoint: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    weavingIssue: { count: jest.Mock; aggregate: jest.Mock };
    weavingReceipt: { count: jest.Mock; aggregate: jest.Mock };
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
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      weavingIssue: {
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { qty: 0 } }),
      },
      weavingReceipt: {
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { qty: 0 } }),
      },
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
  describe('Điều phối đan Đ3 (công tắc DIEU_PHOI_DAN_ENABLED)', () => {
    const coordinator = { roles: ['WEAVING_COORDINATOR'], warehouseScope: null };
    const phuKien = { roles: ['WAREHOUSE_STAFF'], warehouseScope: 'vat-tu-tp' };
    const prev = process.env.DIEU_PHOI_DAN_ENABLED;
    afterEach(() => {
      process.env.DIEU_PHOI_DAN_ENABLED = prev;
    });

    it('tắt: như cũ - thủ kho Phụ kiện sửa được, Điều phối đan bị chặn, không kiểm trùng tên / còn giữ', async () => {
      process.env.DIEU_PHOI_DAN_ENABLED = 'false';
      prisma.weavingPoint.findUnique.mockResolvedValue(null);
      prisma.weavingPoint.create.mockResolvedValue(existingPoint);
      await service.create({ code: 'DD-09' }, phuKien);
      await expect(service.create({ code: 'DD-10' }, coordinator)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.weavingPoint.findFirst).not.toHaveBeenCalled();
      prisma.weavingPoint.findUnique.mockResolvedValue(existingPoint);
      prisma.weavingPoint.update.mockResolvedValue({ ...existingPoint, isActive: false });
      prisma.weavingIssue.aggregate.mockResolvedValue({ _sum: { qty: 5 } });
      await service.update('1', { isActive: false }, admin);
      expect(prisma.weavingIssue.aggregate).not.toHaveBeenCalled();
    });

    it('bật: chỉ Admin + Điều phối đan; thủ kho Phụ kiện -> 403', async () => {
      process.env.DIEU_PHOI_DAN_ENABLED = 'true';
      prisma.weavingPoint.findUnique.mockResolvedValue(null);
      prisma.weavingPoint.create.mockResolvedValue(existingPoint);
      await service.create({ code: 'DD-11', contactPerson: 'Chị Lan' }, coordinator);
      expect(prisma.weavingPoint.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ contactPerson: 'Chị Lan' }) as unknown,
      });
      await expect(service.create({ code: 'DD-12' }, phuKien)).rejects.toThrow(ForbiddenException);
      prisma.weavingPoint.findUnique.mockResolvedValue(existingPoint);
      await expect(service.remove('1', phuKien)).rejects.toThrow(ForbiddenException);
    });

    it('bật: trùng tên (không phân biệt hoa thường) -> 409', async () => {
      process.env.DIEU_PHOI_DAN_ENABLED = 'true';
      prisma.weavingPoint.findUnique.mockResolvedValue(null);
      prisma.weavingPoint.findFirst.mockResolvedValue({ code: 'DD-01', fullName: 'Diem dan 01' });
      await expect(
        service.create({ code: 'dd-99', fullName: 'DIEM DAN 01' }, coordinator),
      ).rejects.toThrow(/Trùng tên/);
      expect(prisma.weavingPoint.create).not.toHaveBeenCalled();
    });

    it('bật: không ngừng được điểm đan còn giữ hàng; hết giữ thì ngừng được', async () => {
      process.env.DIEU_PHOI_DAN_ENABLED = 'true';
      prisma.weavingPoint.findUnique.mockResolvedValue(existingPoint);
      prisma.weavingIssue.aggregate.mockResolvedValue({ _sum: { qty: 10 } });
      prisma.weavingReceipt.aggregate.mockResolvedValue({ _sum: { qty: 4 } });
      await expect(service.update('1', { isActive: false }, coordinator)).rejects.toThrow(
        /còn giữ 6 mảnh/,
      );
      expect(prisma.weavingPoint.update).not.toHaveBeenCalled();
      prisma.weavingReceipt.aggregate.mockResolvedValue({ _sum: { qty: 10 } });
      prisma.weavingPoint.update.mockResolvedValue({ ...existingPoint, isActive: false });
      await service.update('1', { isActive: false }, coordinator);
      expect(prisma.weavingPoint.update).toHaveBeenCalled();
    });
  });
});
