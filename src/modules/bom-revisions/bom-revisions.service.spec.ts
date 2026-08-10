import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AccessoryItemKind } from '../../generated/prisma/client';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { BomRevisionsService } from './bom-revisions.service';

describe('BomRevisionsService', () => {
  let service: BomRevisionsService;
  let prisma: {
    mfgProduct: { findUnique: jest.Mock };
    bomRevision: { findUnique: jest.Mock; findFirst: jest.Mock; create: jest.Mock };
    material: { findUnique: jest.Mock };
    bomAccessoryItem: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  const draftRevision = (overrides: Record<string, unknown> = {}) => ({
    id: 10n,
    mfgProductId: 2n,
    revNo: 1,
    status: 'DRAFT',
    sourcePlanFormId: null,
    createdAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      mfgProduct: { findUnique: jest.fn() },
      bomRevision: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
      material: { findUnique: jest.fn() },
      bomAccessoryItem: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new BomRevisionsService(prisma as unknown as PrismaServiceType);
  });

  describe('create', () => {
    it('passes sourcePlanFormId through when provided (Việc 2 - PlanForm sở hữu revision)', async () => {
      prisma.mfgProduct.findUnique.mockResolvedValue({ id: 2n });
      prisma.bomRevision.findFirst.mockResolvedValue(null);
      prisma.bomRevision.create.mockResolvedValue(draftRevision({ sourcePlanFormId: 5n }));

      const result = await service.create('2', '5');

      expect(result.sourcePlanFormId).toBe('5');
      expect(prisma.bomRevision.create).toHaveBeenCalledWith({
        data: { mfgProductId: 2n, revNo: 1, sourcePlanFormId: 5n },
      });
    });

    it('creates without sourcePlanFormId when omitted (backward compatible)', async () => {
      prisma.mfgProduct.findUnique.mockResolvedValue({ id: 2n });
      prisma.bomRevision.findFirst.mockResolvedValue(null);
      prisma.bomRevision.create.mockResolvedValue(draftRevision());

      await service.create('2');

      expect(prisma.bomRevision.create).toHaveBeenCalledWith({
        data: { mfgProductId: 2n, revNo: 1, sourcePlanFormId: undefined },
      });
    });
  });

  describe('createBomAccessoryItem', () => {
    it('creates a row when the material belongs to the "Vật tư khác" (OTHER) group', async () => {
      prisma.bomRevision.findUnique.mockResolvedValue(draftRevision());
      prisma.material.findUnique.mockResolvedValue({
        id: 80n,
        code: 'PK-01',
        detailKind: 'ACCESSORY',
        materialGroup: { systemKey: 'OTHER' },
      });
      prisma.bomAccessoryItem.findUnique.mockResolvedValue(null);
      prisma.bomAccessoryItem.create.mockResolvedValue({
        id: 1n,
        bomRevisionId: 10n,
        materialId: 80n,
        kind: 'ACCESSORY',
        qtyPerUnit: { toNumber: () => 5 },
        material: { code: 'PK-01' },
      });

      const result = await service.createBomAccessoryItem('10', {
        materialId: '80',
        kind: AccessoryItemKind.ACCESSORY,
        qtyPerUnit: 5,
      });

      expect(result.materialCode).toBe('PK-01');
      expect(result.qtyPerUnit).toBe(5);
    });

    it('rejects a material that does not belong to the "Vật tư khác" group', async () => {
      prisma.bomRevision.findUnique.mockResolvedValue(draftRevision());
      prisma.material.findUnique.mockResolvedValue({
        id: 90n,
        code: 'SAT-01',
        materialGroup: { systemKey: 'STEEL_BAR' },
      });

      await expect(
        service.createBomAccessoryItem('10', {
          materialId: '90',
          kind: AccessoryItemKind.ACCESSORY,
          qtyPerUnit: 1,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a material with no group at all (materialGroupId null)', async () => {
      prisma.bomRevision.findUnique.mockResolvedValue(draftRevision());
      prisma.material.findUnique.mockResolvedValue({ id: 91n, code: 'XX-01', materialGroup: null });

      await expect(
        service.createBomAccessoryItem('10', {
          materialId: '91',
          kind: AccessoryItemKind.ACCESSORY,
          qtyPerUnit: 1,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a material whose detailKind does not match the requested kind (Bao bì material submitted as Phụ kiện)', async () => {
      prisma.bomRevision.findUnique.mockResolvedValue(draftRevision());
      prisma.material.findUnique.mockResolvedValue({
        id: 82n,
        code: 'BB-01',
        detailKind: 'PACKAGING',
        materialGroup: { systemKey: 'OTHER' },
      });

      await expect(
        service.createBomAccessoryItem('10', {
          materialId: '82',
          kind: AccessoryItemKind.ACCESSORY,
          qtyPerUnit: 1,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a duplicate (bomRevisionId, materialId) row', async () => {
      prisma.bomRevision.findUnique.mockResolvedValue(draftRevision());
      prisma.material.findUnique.mockResolvedValue({
        id: 80n,
        code: 'PK-01',
        detailKind: 'ACCESSORY',
        materialGroup: { systemKey: 'OTHER' },
      });
      prisma.bomAccessoryItem.findUnique.mockResolvedValue({ id: 1n });

      await expect(
        service.createBomAccessoryItem('10', {
          materialId: '80',
          kind: AccessoryItemKind.ACCESSORY,
          qtyPerUnit: 1,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects mutation once the revision is no longer DRAFT', async () => {
      prisma.bomRevision.findUnique.mockResolvedValue(draftRevision({ status: 'ACTIVE' }));

      await expect(
        service.createBomAccessoryItem('10', {
          materialId: '80',
          kind: AccessoryItemKind.ACCESSORY,
          qtyPerUnit: 1,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws 404 when the material does not exist', async () => {
      prisma.bomRevision.findUnique.mockResolvedValue(draftRevision());
      prisma.material.findUnique.mockResolvedValue(null);

      await expect(
        service.createBomAccessoryItem('10', {
          materialId: '999',
          kind: AccessoryItemKind.ACCESSORY,
          qtyPerUnit: 1,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeBomAccessoryItem', () => {
    it('throws 404 when the row belongs to a different revision', async () => {
      prisma.bomRevision.findUnique.mockResolvedValue(draftRevision());
      prisma.bomAccessoryItem.findUnique.mockResolvedValue({
        id: 1n,
        bomRevisionId: 999n,
        material: {},
      });

      await expect(service.removeBomAccessoryItem('10', '1')).rejects.toThrow(NotFoundException);
    });
  });
});
