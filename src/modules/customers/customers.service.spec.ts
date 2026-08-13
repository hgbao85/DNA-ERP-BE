import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { CustomersService } from './customers.service';

describe('CustomersService', () => {
  let service: CustomersService;
  let prisma: {
    customer: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  const customer = {
    id: 1n,
    name: 'Cong ty ABC',
    phone: null,
    email: null,
    address: null,
    country: null,
    market: null,
    contactName: null,
    note: null,
    createdAt: new Date('2026-01-01'),
  };

  beforeEach(() => {
    prisma = {
      customer: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new CustomersService(prisma as unknown as PrismaServiceType);
  });

  describe('create', () => {
    it('stringifies the bigint id on the response, unlike the raw Prisma row', async () => {
      prisma.customer.create.mockResolvedValue(customer);

      const result = await service.create({ name: 'Cong ty ABC' });

      expect(result.id).toBe('1');
      expect(typeof result.id).toBe('string');
    });
  });

  describe('id parsing', () => {
    it('rejects a non-numeric id with 400 before ever touching Prisma', async () => {
      await expect(service.findOne('not-a-number')).rejects.toThrow(BadRequestException);
      expect(prisma.customer.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('throws 404 when the customer does not exist', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(service.findOne('999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('throws 404 and never writes when the customer does not exist', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(service.update('999', { name: 'X' } as any)).rejects.toThrow(NotFoundException);
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });
  });

  describe('remove - no soft-delete by design', () => {
    it('issues a real DELETE, not a status flip (this table has no isActive/deletedAt column)', async () => {
      prisma.customer.findUnique.mockResolvedValue(customer);

      await service.remove('1');

      expect(prisma.customer.delete).toHaveBeenCalledWith({ where: { id: 1n } });
    });

    it('throws 404 and never deletes when the customer does not exist', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(service.remove('999')).rejects.toThrow(NotFoundException);
      expect(prisma.customer.delete).not.toHaveBeenCalled();
    });
  });
});
