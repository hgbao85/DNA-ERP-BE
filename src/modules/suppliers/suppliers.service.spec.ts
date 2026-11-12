import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { SuppliersService } from './suppliers.service';

describe('SuppliersService', () => {
  let service: SuppliersService;
  let prisma: {
    supplier: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  const existingSupplier = {
    id: 1n,
    name: 'NCC Sat Thanh Cong',
    phone: null,
    address: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    prisma = {
      supplier: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new SuppliersService(prisma as unknown as PrismaServiceType);
  });

  describe('create', () => {
    it('creates a supplier and checks duplicate names among non-deleted rows', async () => {
      prisma.supplier.create.mockResolvedValue(existingSupplier);

      const result = await service.create({ name: 'NCC Sat Thanh Cong' });

      expect(result.id).toBe('1');
      expect(prisma.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deletedAt: null } }) as unknown,
      );
    });

    it('passes isActive through when given (test tay 09/11 điểm 21)', async () => {
      prisma.supplier.create.mockResolvedValue(existingSupplier);

      await service.create({ name: 'A', isActive: false });

      expect(prisma.supplier.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ isActive: false }) as unknown,
      });
    });

    it('lưu mã số thuế + người liên hệ và trả về (12/11/2026)', async () => {
      prisma.supplier.create.mockResolvedValue({
        ...existingSupplier,
        taxCode: '0312345678',
        contactName: 'Chị Lan',
      });

      const res = await service.create({
        name: 'A',
        taxCode: '0312345678',
        contactName: 'Chị Lan',
      });

      expect(prisma.supplier.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ taxCode: '0312345678', contactName: 'Chị Lan' }) as unknown,
      });
      expect(res).toMatchObject({ taxCode: '0312345678', contactName: 'Chị Lan' });
    });

    it('rejects a duplicate name ignoring case and extra spaces with 409 (điểm 20)', async () => {
      prisma.supplier.findMany.mockResolvedValue([{ name: 'Thép Kim Phát' }]);

      const p = service.create({ name: '  thép   KIM phát ' });

      await expect(p).rejects.toThrow(ConflictException);
      await expect(p).rejects.toThrow(
        'Đã có nhà cung cấp tên "thép KIM phát" - kiểm tra lại, không tạo trùng',
      );
      expect(prisma.supplier.create).not.toHaveBeenCalled();
    });
  });

  describe('update name', () => {
    it('excludes the supplier itself when checking duplicates', async () => {
      prisma.supplier.findUnique.mockResolvedValue(existingSupplier);
      prisma.supplier.update.mockResolvedValue(existingSupplier);

      await service.update('1', { name: 'NCC Sat Thanh Cong' });

      expect(prisma.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deletedAt: null, id: { not: 1n } } }),
      );
    });

    it('rejects renaming to another supplier name with 409', async () => {
      prisma.supplier.findUnique.mockResolvedValue(existingSupplier);
      prisma.supplier.findMany.mockResolvedValue([{ name: 'Khac' }]);

      await expect(service.update('1', { name: 'khac' })).rejects.toThrow(ConflictException);
      expect(prisma.supplier.update).not.toHaveBeenCalled();
    });
  });

  describe('name DTO validation (điểm 19)', () => {
    it('trims the name and rejects a blank-only name with the Vietnamese message', async () => {
      const dto = plainToInstance(CreateSupplierDto, { name: '   ' });
      expect(dto.name).toBe('');
      const errors = await validate(dto);
      expect(errors[0].constraints?.isNotEmpty).toBe('Tên nhà cung cấp không được để trống');
    });
  });

  describe('findOne', () => {
    it('throws 404 for a non-existent id', async () => {
      prisma.supplier.findUnique.mockResolvedValue(null);

      await expect(service.findOne('999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('calls a real Prisma delete() - hard delete, not a manual isActive flip (soft-delete pending)', async () => {
      prisma.supplier.findUnique.mockResolvedValue(existingSupplier);

      await service.remove('1');

      expect(prisma.supplier.delete).toHaveBeenCalledWith({ where: { id: 1n } });
      expect(prisma.supplier.update).not.toHaveBeenCalled();
    });

    it('throws 404 when the supplier does not exist', async () => {
      prisma.supplier.findUnique.mockResolvedValue(null);

      await expect(service.remove('999')).rejects.toThrow(NotFoundException);
      expect(prisma.supplier.delete).not.toHaveBeenCalled();
    });
  });
});
