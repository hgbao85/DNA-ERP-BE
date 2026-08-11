import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { StockLedgerRefType } from '../../generated/prisma/client';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { CloudinaryService } from '../uploads/cloudinary.service';
import { MaterialsService } from './materials.service';

/** `code` truyền cho lệnh gọi `create()`/`update()` gần nhất trên 1 jest.Mock chưa gõ kiểu
 * (jest.Mock trần -> .mock.calls là any[][]) - cast tường minh 1 chỗ duy nhất thay vì lặp lại
 * `expect.objectContaining` lồng nhau ở từng test (bị @typescript-eslint/no-unsafe-assignment
 * chặn commit vì TS không suy được kiểu qua nhiều lớp objectContaining lồng nhau). */
function createdCode(mock: jest.Mock): unknown {
  const calls = mock.mock.calls as Array<[{ data?: { code?: unknown } }]>;
  return calls.at(-1)?.[0]?.data?.code;
}

describe('MaterialsService', () => {
  let service: MaterialsService;
  let prisma: {
    material: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    materialGroup: { findUnique: jest.Mock };
    warehouse: { findUniqueOrThrow: jest.Mock };
  };
  let cloudinary: { deleteByUrl: jest.Mock };
  let stockLedger: { postEntry: jest.Mock };

  const existingMaterial = {
    id: 1n,
    code: 'SAT-01',
    name: 'Sat cay',
    unit: 'kg',
    materialGroupId: null,
    khoUnitFactor: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    prisma = {
      material: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      materialGroup: { findUnique: jest.fn() },
      warehouse: { findUniqueOrThrow: jest.fn() },
    };
    cloudinary = { deleteByUrl: jest.fn().mockResolvedValue(undefined) };
    stockLedger = { postEntry: jest.fn().mockResolvedValue(undefined) };
    service = new MaterialsService(
      prisma as unknown as PrismaServiceType,
      cloudinary as unknown as CloudinaryService,
      stockLedger as unknown as StockLedgerService,
    );
  });

  describe('create', () => {
    it('creates a material when the code is free', async () => {
      prisma.material.findUnique.mockResolvedValue(null);
      prisma.material.create.mockResolvedValue(existingMaterial);

      const result = await service.create({ code: 'SAT-01', name: 'Sat cay', unit: 'kg' });

      expect(result.id).toBe('1');
      expect(prisma.material.create).toHaveBeenCalled();
    });

    it('rejects a duplicate code with 409, does not write', async () => {
      prisma.material.findUnique.mockResolvedValue(existingMaterial);

      await expect(
        service.create({ code: 'SAT-01', name: 'Trung code', unit: 'kg' } as any),
      ).rejects.toThrow(ConflictException);
      expect(prisma.material.create).not.toHaveBeenCalled();
    });

    it('auto-generates a code when none is given (no group -> fallback prefix VT)', async () => {
      prisma.material.findMany.mockResolvedValue([]);
      prisma.material.findUnique.mockResolvedValue(null);
      prisma.material.create.mockResolvedValue({ ...existingMaterial, code: 'VT-001' });

      await service.create({ name: 'Khong co ma', unit: 'kg' });

      expect(prisma.materialGroup.findUnique).not.toHaveBeenCalled();
      expect(prisma.material.findMany).toHaveBeenCalledWith({
        where: { code: { startsWith: 'VT-' } },
        select: { code: true },
      });
      expect(createdCode(prisma.material.create)).toBe('VT-001');
    });

    it('treats a whitespace-only code as absent and auto-generates instead (no blank code written)', async () => {
      prisma.material.findMany.mockResolvedValue([]);
      prisma.material.findUnique.mockResolvedValue(null);
      prisma.material.create.mockResolvedValue({ ...existingMaterial, code: 'VT-001' });

      await service.create({ code: '   ', name: 'Whitespace code', unit: 'kg' });

      expect(createdCode(prisma.material.create)).toBe('VT-001');
    });

    it("auto-generates a code from the group's codePrefix, continuing past the highest used sequence", async () => {
      prisma.materialGroup.findUnique.mockResolvedValue({
        id: 7n,
        name: 'Sắt',
        systemKey: 'STEEL_BAR',
        codePrefix: 'SAT',
      });
      prisma.material.findMany.mockResolvedValue([{ code: 'SAT-001' }, { code: 'SAT-003' }]);
      prisma.material.findUnique.mockResolvedValue(null);
      prisma.material.create.mockResolvedValue({ ...existingMaterial, code: 'SAT-004' });

      await service.create({ name: 'Sat vuong', unit: 'cay', materialGroupId: '7' });

      expect(prisma.material.findMany).toHaveBeenCalledWith({
        where: { code: { startsWith: 'SAT-' } },
        select: { code: true },
      });
      expect(createdCode(prisma.material.create)).toBe('SAT-004');
    });

    it('rejects a missing name/unit with a clean 400', async () => {
      await expect(service.create({ code: 'SAT-03' } as any)).rejects.toThrow(BadRequestException);
      expect(prisma.material.create).not.toHaveBeenCalled();
    });

    it('posts an OPENING_BALANCE stock-ledger entry when openingQty + warehouseId are given', async () => {
      prisma.material.findUnique.mockResolvedValue(null);
      prisma.material.create.mockResolvedValue({ ...existingMaterial, id: 5n, warehouseId: 9n });
      prisma.warehouse.findUniqueOrThrow.mockResolvedValue({ id: 99n, code: 'OPENING_BALANCE' });

      await service.create({
        code: 'BULONG-01',
        name: 'Bu long',
        unit: 'cai',
        warehouseId: '9',
        openingQty: 50,
      });

      expect(prisma.warehouse.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { code: 'OPENING_BALANCE' },
      });
      expect(stockLedger.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          fromWarehouseId: 99n,
          toWarehouseId: 9n,
          materialId: 5n,
          qty: 50,
          refType: StockLedgerRefType.OPENING_BALANCE,
        }),
      );
    });

    it('does not post any stock-ledger entry when openingQty is absent', async () => {
      prisma.material.findUnique.mockResolvedValue(null);
      prisma.material.create.mockResolvedValue(existingMaterial);

      await service.create({
        code: 'SAT-01',
        name: 'Sat cay',
        unit: 'kg',
        warehouseId: '9',
      });

      expect(stockLedger.postEntry).not.toHaveBeenCalled();
    });

    it('rejects openingQty without warehouseId with a clean 400, does not write', async () => {
      await expect(
        service.create({ code: 'SAT-05', name: 'Sat cay', unit: 'kg', openingQty: 10 } as any),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.material.create).not.toHaveBeenCalled();
      expect(stockLedger.postEntry).not.toHaveBeenCalled();
    });

    // % hao hụt mang 2 nghĩa ngược chiều tuỳ nhóm (xem resolveWasteFields) - group STEEL_BAR
    // giữ maxCuttingWastePercentage, ép purchaseWastePercentage về null dù dto có gửi.
    it('vật tư nhóm Sắt (STEEL_BAR): giữ maxCuttingWastePercentage, ép purchaseWastePercentage về null (D.hao-hut-sat)', async () => {
      prisma.materialGroup.findUnique.mockResolvedValue({
        id: 7n,
        systemKey: 'STEEL_BAR',
        codePrefix: 'SAT',
      });
      prisma.material.findUnique.mockResolvedValue(null);
      prisma.material.create.mockResolvedValue(existingMaterial);

      await service.create({
        code: 'SAT-01',
        name: 'Sat cay',
        unit: 'kg',
        materialGroupId: '7',
        maxCuttingWastePercentage: 2,
        purchaseWastePercentage: 5, // gửi nhầm cho Sắt - phải bị ép null, không lọt xuống DB
      });

      const call = prisma.material.create.mock.calls[0] as unknown as [
        {
          data: {
            maxCuttingWastePercentage?: number | null;
            purchaseWastePercentage?: number | null;
          };
        },
      ];
      expect(call[0].data.maxCuttingWastePercentage).toBe(2);
      expect(call[0].data.purchaseWastePercentage).toBeNull();
    });

    // group KHÔNG phải STEEL_BAR (dùng WIRE để né bẫy detailKind bắt buộc của nhóm OTHER,
    // không liên quan tới field đang test) - ngược lại: giữ purchaseWastePercentage, ép
    // maxCuttingWastePercentage về null.
    it('vật tư nhóm khác Sắt: giữ purchaseWastePercentage, ép maxCuttingWastePercentage về null (D.hao-hut-sat)', async () => {
      prisma.materialGroup.findUnique.mockResolvedValue({
        id: 8n,
        systemKey: 'WIRE',
        codePrefix: 'DAY',
      });
      prisma.material.findUnique.mockResolvedValue(null);
      prisma.material.create.mockResolvedValue(existingMaterial);

      await service.create({
        code: 'DAY-01',
        name: 'Day thep',
        unit: 'kg',
        materialGroupId: '8',
        maxCuttingWastePercentage: 2, // gửi nhầm cho vật tư khác Sắt - phải bị ép null
        purchaseWastePercentage: 5,
      });

      const call = prisma.material.create.mock.calls[0] as unknown as [
        {
          data: {
            maxCuttingWastePercentage?: number | null;
            purchaseWastePercentage?: number | null;
          };
        },
      ];
      expect(call[0].data.maxCuttingWastePercentage).toBeNull();
      expect(call[0].data.purchaseWastePercentage).toBe(5);
    });
  });

  describe('findOne', () => {
    it('throws 404 for a non-existent id', async () => {
      prisma.material.findUnique.mockResolvedValue(null);

      await expect(service.findOne('999')).rejects.toThrow(NotFoundException);
    });

    it('trả maxCuttingWastePercentage/purchaseWastePercentage dạng number (Decimal.toNumber()), null khi vật tư không có (D.hao-hut-sat)', async () => {
      prisma.material.findUnique.mockResolvedValue({
        ...existingMaterial,
        maxCuttingWastePercentage: { toNumber: () => 2.5 },
        purchaseWastePercentage: null,
      });

      const result = await service.findOne('1');

      expect(result.maxCuttingWastePercentage).toBe(2.5);
      expect(result.purchaseWastePercentage).toBeNull();
    });
  });

  describe('update', () => {
    it('rejects renaming to a code already used by a different material', async () => {
      prisma.material.findUnique
        .mockResolvedValueOnce(existingMaterial) // findOneOrThrow(id)
        .mockResolvedValueOnce({ ...existingMaterial, id: 2n, code: 'SAT-02' }); // code clash check

      await expect(service.update('1', { code: 'SAT-02' } as any)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.material.update).not.toHaveBeenCalled();
    });

    it('allows keeping the same code on the same record (no false-positive clash)', async () => {
      prisma.material.findUnique
        .mockResolvedValueOnce(existingMaterial)
        .mockResolvedValueOnce(existingMaterial);
      prisma.material.update.mockResolvedValue(existingMaterial);

      await expect(
        service.update('1', { code: 'SAT-01', name: 'Renamed' } as any),
      ).resolves.toBeDefined();
    });

    it('deletes the old Cloudinary image when imageUrl is replaced by a different one', async () => {
      const withImage = {
        ...existingMaterial,
        imageUrl: 'https://res.cloudinary.com/x/image/upload/v1/old.jpg',
      };
      prisma.material.findUnique.mockResolvedValueOnce(withImage);
      prisma.material.update.mockResolvedValue({
        ...withImage,
        imageUrl: 'https://res.cloudinary.com/x/image/upload/v1/new.jpg',
      });

      await service.update('1', {
        imageUrl: 'https://res.cloudinary.com/x/image/upload/v1/new.jpg',
      });

      expect(cloudinary.deleteByUrl).toHaveBeenCalledWith(
        'https://res.cloudinary.com/x/image/upload/v1/old.jpg',
      );
    });

    it('deletes the old Cloudinary image when imageUrl is cleared (set to null)', async () => {
      const withImage = {
        ...existingMaterial,
        imageUrl: 'https://res.cloudinary.com/x/image/upload/v1/old.jpg',
      };
      prisma.material.findUnique.mockResolvedValueOnce(withImage);
      prisma.material.update.mockResolvedValue({ ...withImage, imageUrl: null });

      await service.update('1', { imageUrl: null } as any);

      expect(cloudinary.deleteByUrl).toHaveBeenCalledWith(
        'https://res.cloudinary.com/x/image/upload/v1/old.jpg',
      );
    });

    it('does not touch Cloudinary when imageUrl is left untouched', async () => {
      prisma.material.findUnique.mockResolvedValueOnce(existingMaterial);
      prisma.material.update.mockResolvedValue(existingMaterial);

      await service.update('1', { name: 'Renamed only' });

      expect(cloudinary.deleteByUrl).not.toHaveBeenCalled();
    });

    it('đổi nhóm STEEL_BAR -> nhóm khác thì tự ép maxCuttingWastePercentage về null dù dto không nhắc tới (D.hao-hut-sat)', async () => {
      prisma.material.findUnique.mockResolvedValueOnce({
        ...existingMaterial,
        materialGroupId: 7n,
        maxCuttingWastePercentage: { toNumber: () => 2 },
      });
      prisma.materialGroup.findUnique.mockResolvedValue({ id: 8n, systemKey: 'WIRE' });
      prisma.material.update.mockResolvedValue(existingMaterial);

      await service.update('1', { materialGroupId: '8' });

      const call = prisma.material.update.mock.calls[0] as unknown as [
        { data: { maxCuttingWastePercentage?: number | null } },
      ];
      expect(call[0].data.maxCuttingWastePercentage).toBeNull();
    });

    it('sửa vật tư mà không đụng field hao hụt thì giữ nguyên giá trị cũ (không ghi đè) (D.hao-hut-sat)', async () => {
      prisma.material.findUnique.mockResolvedValueOnce({
        ...existingMaterial,
        materialGroupId: 7n,
        maxCuttingWastePercentage: { toNumber: () => 2 },
      });
      prisma.materialGroup.findUnique.mockResolvedValue({ id: 7n, systemKey: 'STEEL_BAR' });
      prisma.material.update.mockResolvedValue(existingMaterial);

      await service.update('1', { name: 'Renamed only' });

      const call = prisma.material.update.mock.calls[0] as unknown as [
        { data: { maxCuttingWastePercentage?: number | null } },
      ];
      // undefined = Prisma KHÔNG đưa field này vào SET, giá trị cũ trong DB giữ nguyên -
      // khác hẳn ghi đè lại đúng giá trị cũ (2), vì service không có "giá trị cũ" ở dạng number
      // sẵn để so sánh tại đây - tin tưởng Prisma bỏ qua field undefined là đủ.
      expect(call[0].data.maxCuttingWastePercentage).toBeUndefined();
    });
  });

  describe('remove', () => {
    it('calls a real Prisma delete() - hard delete, not a manual isActive flip (soft-delete pending)', async () => {
      prisma.material.findUnique.mockResolvedValue(existingMaterial);

      await service.remove('1');

      expect(prisma.material.delete).toHaveBeenCalledWith({ where: { id: 1n } });
      expect(prisma.material.update).not.toHaveBeenCalled();
    });

    it('deletes the material image from Cloudinary when it has one', async () => {
      const withImage = {
        ...existingMaterial,
        imageUrl: 'https://res.cloudinary.com/x/image/upload/v1/old.jpg',
      };
      prisma.material.findUnique.mockResolvedValue(withImage);

      await service.remove('1');

      expect(cloudinary.deleteByUrl).toHaveBeenCalledWith(
        'https://res.cloudinary.com/x/image/upload/v1/old.jpg',
      );
    });

    it('throws 404 when the material does not exist', async () => {
      prisma.material.findUnique.mockResolvedValue(null);

      await expect(service.remove('999')).rejects.toThrow(NotFoundException);
      expect(prisma.material.delete).not.toHaveBeenCalled();
    });
  });
});
