import { NotFoundException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { SuppliersService } from './suppliers.service';

describe('SuppliersService', () => {
  let service: SuppliersService;
  let prisma: {
    supplier: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock };
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
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new SuppliersService(prisma as unknown as PrismaServiceType);
  });

  describe('create', () => {
    it('creates a supplier - no name-uniqueness constraint, 2 suppliers may share a name', async () => {
      prisma.supplier.create.mockResolvedValue(existingSupplier);

      const result = await service.create({ name: 'NCC Sat Thanh Cong' });

      expect(result.id).toBe('1');
      expect(prisma.supplier.findUnique).not.toHaveBeenCalled();
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
