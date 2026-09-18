import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OfficeSupplyLedgerReason } from '../../generated/prisma/client';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { OfficeSuppliesService } from './office-supplies.service';

/** `data`/`where` truyền cho lệnh gọi gần nhất trên 1 jest.Mock chưa gõ kiểu (jest.Mock trần ->
 *  `.mock.calls` là any[][]) - cast tường minh 1 chỗ duy nhất thay vì lặp lại
 *  `expect.objectContaining` lồng nhau ở từng test (bị @typescript-eslint/no-unsafe-assignment
 *  chặn commit vì TS không suy được kiểu qua nhiều lớp objectContaining lồng nhau) - cùng idiom
 *  `createdCode()` ở materials.service.spec.ts. */
function lastCallField(mock: jest.Mock, field: 'data' | 'where'): unknown {
  const calls = mock.mock.calls as Array<[{ data?: unknown; where?: unknown }]>;
  return calls.at(-1)?.[0]?.[field];
}

describe('OfficeSuppliesService', () => {
  let service: OfficeSuppliesService;
  let prisma: {
    officeSupply: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    officeSupplyLedgerEntry: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    warehouse: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };

  const warehousePsh = { id: 1n, code: 'phoi-son-han', name: 'Kho Phôi Sơn Hàn' };
  const warehouseTp = { id: 2n, code: 'thanh-pham', name: 'Kho Thành Phẩm' };

  const existingSupply = {
    id: 1n,
    warehouseId: warehousePsh.id,
    warehouse: warehousePsh,
    code: 'VP-001',
    name: 'Bút bi',
    unit: 'cái',
    quantity: 10,
    note: null,
    isActive: true,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    prisma = {
      officeSupply: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      officeSupplyLedgerEntry: {
        create: jest.fn().mockResolvedValue(undefined),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      warehouse: { findUnique: jest.fn().mockResolvedValue(warehousePsh) },
      // Mock $transaction chạy callback với chính `prisma` giả này làm `tx` - đủ để test logic
      // nghiệp vụ trong adjustQuantity() mà không cần Prisma thật (khớp idiom MaterialsService.spec).
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    service = new OfficeSuppliesService(prisma as unknown as PrismaServiceType);
  });

  describe('create', () => {
    it('creates in caller own warehouse (scoped), ignoring body warehouseCode', async () => {
      prisma.officeSupply.create.mockResolvedValue({ ...existingSupply, quantity: 0 });

      await service.create(
        { name: 'Bút bi', unit: 'cái', warehouseCode: 'thanh-pham' },
        'phoi-son-han',
      );

      expect(prisma.warehouse.findUnique).toHaveBeenCalledWith({ where: { code: 'phoi-son-han' } });
      expect(lastCallField(prisma.officeSupply.create, 'data')).toMatchObject({
        warehouseId: warehousePsh.id,
      });
    });

    it('requires warehouseCode when caller has no scope (Boss/Admin)', async () => {
      await expect(service.create({ name: 'Bút bi', unit: 'cái' }, null)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.officeSupply.create).not.toHaveBeenCalled();
    });

    it('resolves warehouseCode from body when caller has no scope', async () => {
      prisma.warehouse.findUnique.mockResolvedValue(warehouseTp);
      prisma.officeSupply.create.mockResolvedValue({
        ...existingSupply,
        warehouse: warehouseTp,
        warehouseId: warehouseTp.id,
      });

      await service.create({ name: 'Bút bi', unit: 'cái', warehouseCode: 'thanh-pham' }, null);

      expect(lastCallField(prisma.officeSupply.create, 'data')).toMatchObject({
        warehouseId: warehouseTp.id,
      });
    });

    it('creates a 0-quantity item with no ledger entry when no openingQty given', async () => {
      prisma.officeSupply.create.mockResolvedValue({ ...existingSupply, quantity: 0 });

      const result = await service.create({ name: 'Bút bi', unit: 'cái' }, 'phoi-son-han');

      expect(result.quantity).toBe(0);
      expect(prisma.officeSupplyLedgerEntry.create).not.toHaveBeenCalled();
    });

    it('creates an INITIAL ledger entry when openingQty > 0', async () => {
      prisma.officeSupply.create.mockResolvedValue(existingSupply);

      await service.create({ name: 'Bút bi', unit: 'cái', openingQty: 10 }, 'phoi-son-han');

      expect(lastCallField(prisma.officeSupplyLedgerEntry.create, 'data')).toMatchObject({
        changeQty: 10,
        quantityAfter: 10,
        reason: OfficeSupplyLedgerReason.INITIAL,
      });
    });

    it('rejects when name/unit is missing', async () => {
      await expect(service.create({ name: '', unit: 'cái' }, 'phoi-son-han')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a duplicate code within the same warehouse', async () => {
      prisma.officeSupply.findUnique.mockResolvedValue(existingSupply);

      await expect(
        service.create({ name: 'Bút bi', unit: 'cái', code: 'VP-001' }, 'phoi-son-han'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('warehouse scope enforcement', () => {
    it('allows the matching warehouseScope to read/update/delete', async () => {
      prisma.officeSupply.findUnique.mockResolvedValue(existingSupply);
      await expect(service.findOne('1', 'phoi-son-han')).resolves.toBeDefined();
    });

    it('rejects a different warehouseScope from touching the item', async () => {
      prisma.officeSupply.findUnique.mockResolvedValue(existingSupply);
      await expect(service.findOne('1', 'thanh-pham')).rejects.toThrow(ForbiddenException);
    });

    it('null scope (Boss/Admin) can touch any warehouse', async () => {
      prisma.officeSupply.findUnique.mockResolvedValue(existingSupply);
      await expect(service.findOne('1', null)).resolves.toBeDefined();
    });
  });

  describe('findAll', () => {
    it('forces the filter to the caller own warehouse, ignoring query.warehouseCode', async () => {
      await service.findAll(
        { warehouseCode: 'thanh-pham', skip: 0, limit: 20, page: 1 } as never,
        'phoi-son-han',
      );

      expect(prisma.warehouse.findUnique).toHaveBeenCalledWith({ where: { code: 'phoi-son-han' } });
      expect(lastCallField(prisma.officeSupply.findMany, 'where')).toMatchObject({
        warehouseId: warehousePsh.id,
      });
    });

    it('with no scope and no warehouseCode, lists across every warehouse', async () => {
      await service.findAll({ skip: 0, limit: 20, page: 1 } as never, null);

      expect(prisma.warehouse.findUnique).not.toHaveBeenCalled();
      expect(lastCallField(prisma.officeSupply.findMany, 'where')).not.toHaveProperty(
        'warehouseId',
      );
    });

    it('excludes soft-deleted items by default', async () => {
      await service.findAll({ skip: 0, limit: 20, page: 1 } as never, 'phoi-son-han');

      expect(lastCallField(prisma.officeSupply.findMany, 'where')).toMatchObject({
        deletedAt: null,
      });
    });

    it('includeDeleted=true drops the deletedAt filter (Admin xem lại vật tư đã xóa)', async () => {
      await service.findAll(
        { includeDeleted: 'true', skip: 0, limit: 20, page: 1 } as never,
        'phoi-son-han',
      );

      expect(lastCallField(prisma.officeSupply.findMany, 'where')).not.toHaveProperty('deletedAt');
    });
  });

  describe('adjustQuantity', () => {
    it('increments quantity and writes a ledger entry on import', async () => {
      prisma.officeSupply.findUnique.mockResolvedValue(existingSupply);
      prisma.officeSupply.updateMany.mockResolvedValue({ count: 1 });
      prisma.officeSupply.findUniqueOrThrow.mockResolvedValue({ ...existingSupply, quantity: 15 });

      const result = await service.adjustQuantity(
        '1',
        { changeQty: 5, reason: OfficeSupplyLedgerReason.IMPORT },
        'user-1',
        'phoi-son-han',
      );

      expect(result.quantity).toBe(15);
      expect(lastCallField(prisma.officeSupplyLedgerEntry.create, 'data')).toMatchObject({
        changeQty: 5,
        quantityAfter: 15,
        createdByUserId: 'user-1',
      });
    });

    it('rejects a caller scoped to a different warehouse before touching quantity', async () => {
      prisma.officeSupply.findUnique.mockResolvedValue(existingSupply);

      await expect(
        service.adjustQuantity(
          '1',
          { changeQty: 5, reason: OfficeSupplyLedgerReason.IMPORT },
          'user-1',
          'thanh-pham',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.officeSupply.updateMany).not.toHaveBeenCalled();
    });

    it('rejects export that would go negative (updateMany guard returns 0 rows)', async () => {
      prisma.officeSupply.findUnique.mockResolvedValue(existingSupply);
      prisma.officeSupply.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.adjustQuantity(
          '1',
          { changeQty: -100, reason: OfficeSupplyLedgerReason.EXPORT },
          'user-1',
          'phoi-son-han',
        ),
      ).rejects.toThrow(ConflictException);
      expect(prisma.officeSupplyLedgerEntry.create).not.toHaveBeenCalled();
    });

    it('rejects changeQty of 0', async () => {
      await expect(
        service.adjustQuantity(
          '1',
          { changeQty: 0, reason: OfficeSupplyLedgerReason.ADJUST },
          'user-1',
          'phoi-son-han',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.officeSupply.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('listLedger', () => {
    it('lists history for an active item', async () => {
      prisma.officeSupply.findUnique.mockResolvedValue(existingSupply);

      await expect(
        service.listLedger('1', { skip: 0, limit: 20, page: 1 } as never, 'phoi-son-han'),
      ).resolves.toBeDefined();
    });

    it('still lists history for a SOFT-DELETED item (dialog xóa hứa "vẫn giữ để tra cứu")', async () => {
      prisma.officeSupply.findUnique.mockResolvedValue({
        ...existingSupply,
        deletedAt: new Date(),
      });

      await expect(
        service.listLedger('1', { skip: 0, limit: 20, page: 1 } as never, 'phoi-son-han'),
      ).resolves.toBeDefined();
    });

    it('still enforces warehouse scope even on a deleted item', async () => {
      prisma.officeSupply.findUnique.mockResolvedValue({
        ...existingSupply,
        deletedAt: new Date(),
      });

      await expect(
        service.listLedger('1', { skip: 0, limit: 20, page: 1 } as never, 'thanh-pham'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update', () => {
    it('never touches quantity, even if smuggled in the dto', async () => {
      prisma.officeSupply.findUnique.mockResolvedValueOnce(existingSupply); // findOneOrThrow
      prisma.officeSupply.update.mockResolvedValue(existingSupply);

      await service.update('1', { name: 'Bút bi xanh' }, 'phoi-son-han');

      expect(lastCallField(prisma.officeSupply.update, 'data')).not.toHaveProperty('quantity');
    });
  });

  describe('remove', () => {
    it('soft-deletes instead of hard-deleting', async () => {
      prisma.officeSupply.findUnique.mockResolvedValue(existingSupply);
      prisma.officeSupply.update.mockResolvedValue({ ...existingSupply, deletedAt: new Date() });

      await service.remove('1', 'phoi-son-han');

      expect(lastCallField(prisma.officeSupply.update, 'data')).toMatchObject({ isActive: false });
    });

    it('throws NotFoundException for an already-deleted item', async () => {
      prisma.officeSupply.findUnique.mockResolvedValue({
        ...existingSupply,
        deletedAt: new Date(),
      });

      await expect(service.remove('1', 'phoi-son-han')).rejects.toThrow(NotFoundException);
    });
  });
});
