import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AccessoryItemKind } from '../../generated/prisma/client';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { BomRevisionsService } from './bom-revisions.service';

describe('BomRevisionsService', () => {
  let service: BomRevisionsService;
  let prisma: {
    mfgProduct: { findUnique: jest.Mock };
    bomRevision: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
    };
    planForm: { findUnique: jest.Mock };
    material: { findUnique: jest.Mock };
    piece: { findUnique: jest.Mock };
    bomPiece: { findUnique: jest.Mock };
    pieceMaterialYield: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
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
      bomRevision: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
      planForm: { findUnique: jest.fn() },
      material: { findUnique: jest.fn() },
      piece: { findUnique: jest.fn() },
      bomPiece: { findUnique: jest.fn() },
      pieceMaterialYield: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
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

  describe('activateInTransaction', () => {
    it('rejects a revision with no sourcePlanFormId (raw product-scoped create(), sự cố Ghế J55 2026-08-22)', async () => {
      prisma.bomRevision.findUnique.mockResolvedValue(draftRevision({ sourcePlanFormId: null }));

      await expect(service.activateInTransaction(prisma as any, '10')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.planForm.findUnique).not.toHaveBeenCalled();
      expect(prisma.bomRevision.updateMany).not.toHaveBeenCalled();
    });

    it('rejects when the source plan form is not WAITING_BOSS_APPROVAL', async () => {
      prisma.bomRevision.findUnique.mockResolvedValue(draftRevision({ sourcePlanFormId: 5n }));
      prisma.planForm.findUnique.mockResolvedValue({ id: 5n, status: 'IN_PROGRESS' });

      await expect(service.activateInTransaction(prisma as any, '10')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.bomRevision.updateMany).not.toHaveBeenCalled();
    });

    it('rejects when the source plan form no longer exists', async () => {
      prisma.bomRevision.findUnique.mockResolvedValue(draftRevision({ sourcePlanFormId: 5n }));
      prisma.planForm.findUnique.mockResolvedValue(null);

      await expect(service.activateInTransaction(prisma as any, '10')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('activates when the source plan form is WAITING_BOSS_APPROVAL (đường duyệt chuẩn qua SKU)', async () => {
      prisma.bomRevision.findUnique.mockResolvedValue(draftRevision({ sourcePlanFormId: 5n }));
      prisma.planForm.findUnique.mockResolvedValue({ id: 5n, status: 'WAITING_BOSS_APPROVAL' });
      prisma.bomRevision.updateMany.mockResolvedValue({ count: 1 });
      prisma.bomRevision.update.mockResolvedValue(
        draftRevision({ sourcePlanFormId: 5n, status: 'ACTIVE' }),
      );

      const result = await service.activateInTransaction(prisma as any, '10');

      expect(result.status).toBe('ACTIVE');
      expect(prisma.bomRevision.updateMany).toHaveBeenCalledWith({
        where: { mfgProductId: 2n, status: 'ACTIVE' },
        data: { status: 'RETIRED' },
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

  describe('createPieceMaterialYield', () => {
    const piece40 = { id: 40n, mfgProductId: 2n, code: 'CHAN-NHOM' };
    const materialNhom = { id: 80n, code: 'NHOM-01' };

    it('creates a row when the piece has bom_piece.needsHan=false on this revision', async () => {
      prisma.bomRevision.findUnique.mockResolvedValue(draftRevision());
      prisma.piece.findUnique.mockResolvedValue(piece40);
      prisma.bomPiece.findUnique.mockResolvedValue({ needsHan: false });
      prisma.material.findUnique.mockResolvedValue(materialNhom);
      prisma.pieceMaterialYield.findUnique.mockResolvedValue(null);
      prisma.pieceMaterialYield.create.mockResolvedValue({
        id: 1n,
        bomRevisionId: 10n,
        pieceId: 40n,
        materialId: 80n,
        piecesPerBar: 12,
        piece: piece40,
        material: materialNhom,
      });

      const result = await service.createPieceMaterialYield('10', {
        pieceId: '40',
        materialId: '80',
        piecesPerBar: 12,
      });

      expect(result.piecesPerBar).toBe(12);
      expect(result.materialCode).toBe('NHOM-01');
    });

    it('rejects when the piece has no bom_piece row yet on this revision', async () => {
      prisma.bomRevision.findUnique.mockResolvedValue(draftRevision());
      prisma.piece.findUnique.mockResolvedValue(piece40);
      prisma.bomPiece.findUnique.mockResolvedValue(null);

      await expect(
        service.createPieceMaterialYield('10', {
          pieceId: '40',
          materialId: '80',
          piecesPerBar: 12,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    // 2026-08-22: needsHan=true KHÔNG còn bị chặn - "pat" (cắt từ tấm sắt lá theo tỷ lệ cố định,
    // vẫn cần Hàn sau khi cắt) là vd thật. needsHan chỉ còn quyết định piece có báo thêm ở HAN
    // hay không, không còn quyết định piece có dùng PieceMaterialYield được hay không.
    it('cho phép piece có bom_piece.needsHan=true ("pat", cắt từ tấm sắt lá nhưng vẫn cần Hàn)', async () => {
      prisma.bomRevision.findUnique.mockResolvedValue(draftRevision());
      prisma.piece.findUnique.mockResolvedValue(piece40);
      prisma.bomPiece.findUnique.mockResolvedValue({ needsHan: true });
      prisma.material.findUnique.mockResolvedValue(materialNhom);
      prisma.pieceMaterialYield.findUnique.mockResolvedValue(null);
      prisma.pieceMaterialYield.create.mockResolvedValue({
        id: 2n,
        bomRevisionId: 10n,
        pieceId: 40n,
        materialId: 80n,
        piecesPerBar: 8,
        piece: piece40,
        material: materialNhom,
      });

      const result = await service.createPieceMaterialYield('10', {
        pieceId: '40',
        materialId: '80',
        piecesPerBar: 8,
      });

      expect(result.piecesPerBar).toBe(8);
    });

    it('rejects a piece belonging to a different product than the revision', async () => {
      prisma.bomRevision.findUnique.mockResolvedValue(draftRevision());
      prisma.piece.findUnique.mockResolvedValue({ ...piece40, mfgProductId: 999n });

      await expect(
        service.createPieceMaterialYield('10', {
          pieceId: '40',
          materialId: '80',
          piecesPerBar: 12,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a duplicate (bomRevisionId, pieceId) row', async () => {
      prisma.bomRevision.findUnique.mockResolvedValue(draftRevision());
      prisma.piece.findUnique.mockResolvedValue(piece40);
      prisma.bomPiece.findUnique.mockResolvedValue({ needsHan: false });
      prisma.material.findUnique.mockResolvedValue(materialNhom);
      prisma.pieceMaterialYield.findUnique.mockResolvedValue({ id: 1n });

      await expect(
        service.createPieceMaterialYield('10', {
          pieceId: '40',
          materialId: '80',
          piecesPerBar: 12,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects mutation once the revision is no longer DRAFT', async () => {
      prisma.bomRevision.findUnique.mockResolvedValue(draftRevision({ status: 'ACTIVE' }));

      await expect(
        service.createPieceMaterialYield('10', {
          pieceId: '40',
          materialId: '80',
          piecesPerBar: 12,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws 404 when the piece does not exist', async () => {
      prisma.bomRevision.findUnique.mockResolvedValue(draftRevision());
      prisma.piece.findUnique.mockResolvedValue(null);

      await expect(
        service.createPieceMaterialYield('10', {
          pieceId: '999',
          materialId: '80',
          piecesPerBar: 12,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 404 when the material does not exist', async () => {
      prisma.bomRevision.findUnique.mockResolvedValue(draftRevision());
      prisma.piece.findUnique.mockResolvedValue(piece40);
      prisma.bomPiece.findUnique.mockResolvedValue({ needsHan: false });
      prisma.material.findUnique.mockResolvedValue(null);

      await expect(
        service.createPieceMaterialYield('10', {
          pieceId: '40',
          materialId: '999',
          piecesPerBar: 12,
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
