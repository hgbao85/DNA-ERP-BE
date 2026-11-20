import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
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
    salesOrder: { count: jest.Mock };
    booking: { count: jest.Mock };
    $transaction: jest.Mock;
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
      salesOrder: { count: jest.fn().mockResolvedValue(0) },
      booking: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(prisma))),
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

    // 20/11/2026 (T2-2): khách còn đơn / booking thì 409 nêu lý do, không để lộ lỗi khoá ngoại.
    it('409 nêu số đơn hàng khi khách còn đơn; không xoá', async () => {
      prisma.customer.findUnique.mockResolvedValue(customer);
      prisma.salesOrder.count.mockResolvedValue(2);

      const p = service.remove('1');
      await expect(p).rejects.toThrow(ConflictException);
      await expect(p).rejects.toThrow(
        'Khách hàng "Cong ty ABC" đang có 2 đơn hàng - không xoá được',
      );
      expect(prisma.customer.delete).not.toHaveBeenCalled();
    });

    it('409 chỉ nêu booking khi khách chỉ có booking', async () => {
      prisma.customer.findUnique.mockResolvedValue(customer);
      prisma.booking.count.mockResolvedValue(1);

      await expect(service.remove('1')).rejects.toThrow(
        'Khách hàng "Cong ty ABC" đang có 1 booking - không xoá được',
      );
    });

    it('409 ghép cả đơn hàng và booking', async () => {
      prisma.customer.findUnique.mockResolvedValue(customer);
      prisma.salesOrder.count.mockResolvedValue(2);
      prisma.booking.count.mockResolvedValue(3);

      await expect(service.remove('1')).rejects.toThrow(
        'Khách hàng "Cong ty ABC" đang có 2 đơn hàng, 3 booking - không xoá được',
      );
    });

    it('P2003 lúc xoá -> 409 "đang được dùng ở chứng từ khác"', async () => {
      prisma.customer.findUnique.mockResolvedValue(customer);
      prisma.customer.delete.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 'x' }),
      );

      await expect(service.remove('1')).rejects.toThrow(
        'Khách hàng đang được dùng ở chứng từ khác - không xoá được',
      );
    });

    it('throws 404 and never deletes when the customer does not exist', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(service.remove('999')).rejects.toThrow(NotFoundException);
      expect(prisma.customer.delete).not.toHaveBeenCalled();
    });
  });
});
