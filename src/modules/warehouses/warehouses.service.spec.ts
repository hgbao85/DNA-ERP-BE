import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { WarehousesService } from './warehouses.service';

const REF_MODELS = [
  'material',
  'stockQuant',
  'stockLedger',
  'stockReservation',
  'warehouseTransfer',
  'warehouseTransferReservation',
  'segmentReservation',
  'segmentOverage',
  'segmentProduction',
  'segmentProductionLeftover',
  'officeSupply',
  'issueSlip',
];

describe('WarehousesService', () => {
  let service: WarehousesService;
  let prisma: {
    warehouse: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock };
    user: { deleteMany: jest.Mock; updateMany: jest.Mock };
    $transaction: jest.Mock;
    material: { count: jest.Mock };
    stockLedger: { count: jest.Mock };
  };

  const protectedWarehouse = {
    id: 1n,
    code: 'phoi-son-han',
    name: 'Kho Phoi Son Han',
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
      user: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      ...(Object.fromEntries(
        REF_MODELS.map((m) => [m, { count: jest.fn().mockResolvedValue(0) }]),
      ) as { material: { count: jest.Mock }; stockLedger: { count: jest.Mock } }),
      // 19/11/2026: $transaction dạng callback (tx = chính mock prisma).
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(prisma))),
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

    it('xoá kho kèm xoá mềm mọi tài khoản (chưa xoá) gắn warehouseScope đúng kho này, bằng updateMany TRONG transaction (19/11: deleteMany của User bị extension xoá mềm chạy ngoài tx)', async () => {
      prisma.warehouse.findUnique.mockResolvedValue(ordinaryWarehouse);
      prisma.user.updateMany.mockResolvedValue({ count: 1 });

      await service.remove('2');

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { warehouseScope: 'kho-phu-1', deletedAt: null },
        data: { deletedAt: expect.any(Date) as Date },
      });
      expect(prisma.user.deleteMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function));
      expect(prisma.warehouse.delete).toHaveBeenCalledWith({ where: { id: 2n } });
    });

    it('T1-1: kho còn vật tư / bút toán sổ kho thì 409 tiếng Việt, không xoá tài khoản, không xoá kho', async () => {
      prisma.warehouse.findUnique.mockResolvedValue(ordinaryWarehouse);
      prisma.material.count.mockResolvedValue(3);
      prisma.stockLedger.count.mockResolvedValue(5);

      await expect(service.remove('2')).rejects.toThrow(
        'Kho còn 3 vật tư, 5 bút toán sổ kho - không xoá được',
      );
      await expect(service.remove('2')).rejects.toThrow(ConflictException);
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.user.deleteMany).not.toHaveBeenCalled();
      expect(prisma.warehouse.delete).not.toHaveBeenCalled();
    });

    it('vẫn ném lỗi khi bản thân việc xoá kho thất bại - xoá mềm tài khoản đi qua tx.user.updateMany nên lùi cùng transaction', async () => {
      prisma.warehouse.findUnique.mockResolvedValue(ordinaryWarehouse);
      prisma.warehouse.delete.mockRejectedValue(new Error('FK constraint violation'));

      await expect(service.remove('2')).rejects.toThrow('FK constraint violation');
    });
  });

  describe('update - PROTECTED_WAREHOUSE_CODES', () => {
    it('blocks renaming (changing code) of a protected warehouse with 403', async () => {
      prisma.warehouse.findUnique.mockResolvedValue(protectedWarehouse);

      await expect(service.update('1', { code: 'phoi-son-han-moi' } as any)).rejects.toThrow(
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
