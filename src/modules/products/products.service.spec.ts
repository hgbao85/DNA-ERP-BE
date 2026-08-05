import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { ProductsService } from './products.service';

describe('ProductsService', () => {
  let service: ProductsService;
  let prisma: {
    mfgProduct: { findUnique: jest.Mock; create: jest.Mock; delete: jest.Mock };
    productVariant: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
    };
  };

  const existingProduct = { id: 1n, factoryCode: 'SP-01', name: 'San pham 01', description: null };
  const existingVariant = {
    id: 10n,
    mfgProductId: 1n,
    customerId: null,
    colorCode: 'RED',
    description: null,
    isActive: true,
  };

  beforeEach(() => {
    prisma = {
      mfgProduct: { findUnique: jest.fn(), create: jest.fn(), delete: jest.fn() },
      productVariant: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
    };
    service = new ProductsService(prisma as unknown as PrismaServiceType);
  });

  describe('create (MfgProduct)', () => {
    it('creates a product when factoryCode is free', async () => {
      prisma.mfgProduct.findUnique.mockResolvedValue(null);
      prisma.mfgProduct.create.mockResolvedValue(existingProduct);

      const result = await service.create({ factoryCode: 'SP-01', name: 'San pham 01' });

      expect(result.id).toBe('1');
    });

    it('rejects a duplicate factoryCode with 409', async () => {
      prisma.mfgProduct.findUnique.mockResolvedValue(existingProduct);

      await expect(service.create({ factoryCode: 'SP-01', name: 'x' } as any)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('remove (MfgProduct)', () => {
    it('is a real hard delete - MfgProduct has no soft-delete column, relies on ON DELETE RESTRICT FKs instead', async () => {
      prisma.mfgProduct.findUnique.mockResolvedValue(existingProduct);
      prisma.productVariant.count.mockResolvedValue(0);

      await service.remove('1');

      expect(prisma.mfgProduct.delete).toHaveBeenCalledWith({ where: { id: 1n } });
    });

    it('throws 404 when the product does not exist', async () => {
      prisma.mfgProduct.findUnique.mockResolvedValue(null);

      await expect(service.remove('999')).rejects.toThrow(NotFoundException);
    });

    it('rejects with 409 when the product still has active variants, without touching the DB delete', async () => {
      prisma.mfgProduct.findUnique.mockResolvedValue(existingProduct);
      prisma.productVariant.count.mockResolvedValue(2);

      await expect(service.remove('1')).rejects.toThrow(ConflictException);
      expect(prisma.productVariant.count).toHaveBeenCalledWith({
        where: { mfgProductId: 1n, isActive: true },
      });
      expect(prisma.mfgProduct.delete).not.toHaveBeenCalled();
    });

    it('allows deleting a product whose variants are all inactive', async () => {
      prisma.mfgProduct.findUnique.mockResolvedValue(existingProduct);
      prisma.productVariant.count.mockResolvedValue(0);

      await service.remove('1');

      expect(prisma.mfgProduct.delete).toHaveBeenCalledWith({ where: { id: 1n } });
    });
  });

  describe('removeVariant', () => {
    it('calls a real Prisma delete() on the variant - hard delete, not isActive:false (soft-delete pending)', async () => {
      prisma.mfgProduct.findUnique.mockResolvedValue(existingProduct);
      prisma.productVariant.findUnique.mockResolvedValue(existingVariant);

      await service.removeVariant('1', '10');

      expect(prisma.productVariant.delete).toHaveBeenCalledWith({ where: { id: 10n } });
      expect(prisma.productVariant.update).not.toHaveBeenCalled();
    });

    it('throws 404 when the variant belongs to a different product than the route param', async () => {
      prisma.mfgProduct.findUnique.mockResolvedValue(existingProduct);
      prisma.productVariant.findUnique.mockResolvedValue({ ...existingVariant, mfgProductId: 2n });

      await expect(service.removeVariant('1', '10')).rejects.toThrow(NotFoundException);
      expect(prisma.productVariant.delete).not.toHaveBeenCalled();
    });

    it('throws 404 when the variant does not exist at all', async () => {
      prisma.mfgProduct.findUnique.mockResolvedValue(existingProduct);
      prisma.productVariant.findUnique.mockResolvedValue(null);

      await expect(service.removeVariant('1', '999')).rejects.toThrow(NotFoundException);
    });
  });
});
