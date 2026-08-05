import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { WarehousesService } from './warehouses.service';

describe('WarehousesService', () => {
  let service: WarehousesService;
  let prisma: {
    warehouse: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock };
  };

  const protectedWarehouse = {
    id: 1n,
    code: 'sat',
    name: 'Kho sat',
    isVirtual: false,
    note: null,
    isActive: true,
  };

  const ordinaryWarehouse = {
    id: 2n,
    code: 'kho-phu-1',
    name: 'Kho phu 1',
    isVirtual: false,
    note: null,
    isActive: true,
  };

  beforeEach(() => {
    prisma = {
      warehouse: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new WarehousesService(prisma as unknown as PrismaServiceType);
  });

  describe('create', () => {
    it('creates a warehouse when the code is free', async () => {
      prisma.warehouse.findUnique.mockResolvedValue(null);
      prisma.warehouse.create.mockResolvedValue(ordinaryWarehouse);

      const result = await service.create({ code: 'kho-phu-1', name: 'Kho phu 1' });

      expect(result.id).toBe('2');
    });

    it('rejects a duplicate code with 409', async () => {
      prisma.warehouse.findUnique.mockResolvedValue(ordinaryWarehouse);

      await expect(service.create({ code: 'kho-phu-1', name: 'x' } as any)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('remove - PROTECTED_WAREHOUSE_CODES', () => {
    it('blocks deleting a protected warehouse code with 403, never touches the DB write', async () => {
      prisma.warehouse.findUnique.mockResolvedValue(protectedWarehouse);

      await expect(service.remove('1')).rejects.toThrow(ForbiddenException);
      expect(prisma.warehouse.delete).not.toHaveBeenCalled();
    });

    it('allows deleting an ordinary (non-protected) warehouse via a real delete()', async () => {
      prisma.warehouse.findUnique.mockResolvedValue(ordinaryWarehouse);

      await service.remove('2');

      expect(prisma.warehouse.delete).toHaveBeenCalledWith({ where: { id: 2n } });
      expect(prisma.warehouse.update).not.toHaveBeenCalled();
    });

    it('throws 404 when the warehouse does not exist', async () => {
      prisma.warehouse.findUnique.mockResolvedValue(null);

      await expect(service.remove('999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update - PROTECTED_WAREHOUSE_CODES', () => {
    it('blocks renaming (changing code) of a protected warehouse with 403', async () => {
      prisma.warehouse.findUnique.mockResolvedValue(protectedWarehouse);

      await expect(service.update('1', { code: 'sat-moi' } as any)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.warehouse.update).not.toHaveBeenCalled();
    });

    it('allows updating other fields (e.g. name) of a protected warehouse without touching its code', async () => {
      prisma.warehouse.findUnique.mockResolvedValue(protectedWarehouse);
      prisma.warehouse.update.mockResolvedValue({ ...protectedWarehouse, name: 'Kho sat moi' });

      await expect(service.update('1', { name: 'Kho sat moi' } as any)).resolves.toBeDefined();
      expect(prisma.warehouse.update).toHaveBeenCalled();
    });

    it('never forwards isVirtual to Prisma, even if a caller smuggles it into the DTO', async () => {
      prisma.warehouse.findUnique.mockResolvedValue(ordinaryWarehouse);
      prisma.warehouse.update.mockResolvedValue({ ...ordinaryWarehouse, isVirtual: true });

      await service.update('2', { name: 'Kho phu 1', isVirtual: true } as any);

      expect(prisma.warehouse.update).toHaveBeenCalledWith({
        where: { id: 2n },
        data: {
          code: undefined,
          name: 'Kho phu 1',
          note: undefined,
          isActive: undefined,
        },
      });
    });
  });
});
