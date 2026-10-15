import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AccessoryItemKind } from '../../generated/prisma/client';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { BomRevisionsService } from './bom-revisions.service';

/** Đọc `{ data }` từ 1 lệnh gọi `prisma.auditLog.create.mock.calls[n]` không qua `any` - jest.Mock
 *  không giữ type tham số thật của hàm giả lập, nên tự khai type tối thiểu cần dùng ở test dưới. */
function auditLogCreateData(call: unknown[]): {
  tableName: string;
  recordId: string;
  oldValue: Record<string, unknown>;
  newValue: Record<string, unknown>;
} {
  return (
    call[0] as {
      data: {
        tableName: string;
        recordId: string;
        oldValue: Record<string, unknown>;
        newValue: Record<string, unknown>;
      };
    }
  ).data;
}

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
    auditLog: { create: jest.Mock };
    $transaction: jest.Mock;
    $executeRawUnsafe: jest.Mock;
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
      auditLog: { create: jest.fn() },
      // Admin-override path (withAdminOverride) chạy qua $transaction thật - mock chạy callback
      // với chính `prisma` giả này làm `tx` (đủ dùng vì tx chỉ cần có cùng shape delegate), và
      // $executeRawUnsafe (SET LOCAL escape hatch) chỉ cần no-op.
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
      $executeRawUnsafe: jest.fn(),
    };
    const cls = { isActive: jest.fn().mockReturnValue(false), get: jest.fn(), getId: jest.fn() };
    service = new BomRevisionsService(
      prisma as unknown as PrismaServiceType,
      cls as unknown as ClsService<AppClsStore>,
    );
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

  // Admin override (2026-10-15): sửa SỐ LƯỢNG trên 1 bản đã ACTIVE, không cần quay lại DRAFT/duyệt
  // lại - xem BomRevisionsService.assertDraftOrAdminOverride()/withAdminOverride(). Chỉ update
  // được cho phép, create/remove vẫn chặn tuyệt đối dù actorRoles có ADMIN hay không (các describe
  // create*/remove* ở trên không truyền actorRoles nên luôn đi nhánh "không override").
  describe('updateBomAccessoryItem (admin override trên bản đã ACTIVE)', () => {
    const existingRow = () => ({
      id: 1n,
      bomRevisionId: 10n,
      materialId: 80n,
      kind: 'ACCESSORY',
      qtyPerUnit: { toNumber: () => 5 },
      material: { code: 'PK-01' },
    });

    it('rejects khi revision không còn DRAFT và actor KHÔNG phải ADMIN', async () => {
      prisma.bomRevision.findUnique.mockResolvedValue(draftRevision({ status: 'ACTIVE' }));
      prisma.bomAccessoryItem.findUnique.mockResolvedValue(existingRow());

      await expect(
        service.updateBomAccessoryItem('10', '1', { qtyPerUnit: 9 }, ['PURCHASER']),
      ).rejects.toThrow(ConflictException);
      expect(prisma.bomAccessoryItem.update).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('vẫn rejects khi KHÔNG truyền actorRoles (mặc định [])', async () => {
      prisma.bomRevision.findUnique.mockResolvedValue(draftRevision({ status: 'ACTIVE' }));
      prisma.bomAccessoryItem.findUnique.mockResolvedValue(existingRow());

      await expect(service.updateBomAccessoryItem('10', '1', { qtyPerUnit: 9 })).rejects.toThrow(
        ConflictException,
      );
    });

    it('cho phép ADMIN sửa qua escape hatch DB + ghi AuditLog tay khi revision đã ACTIVE', async () => {
      prisma.bomRevision.findUnique.mockResolvedValue(draftRevision({ status: 'ACTIVE' }));
      prisma.bomAccessoryItem.findUnique.mockResolvedValue(existingRow());
      prisma.bomAccessoryItem.update.mockResolvedValue({
        ...existingRow(),
        qtyPerUnit: { toNumber: () => 9 },
      });

      const result = await service.updateBomAccessoryItem('10', '1', { qtyPerUnit: 9 }, ['ADMIN']);

      expect(result.qtyPerUnit).toBe(9);
      // Phải mở escape hatch TRONG transaction, không update thẳng ngoài transaction.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        `SET LOCAL "dna.bom_maintenance" = 'on'`,
      );
      expect(prisma.bomAccessoryItem.update).toHaveBeenCalledWith({
        where: { id: 1n },
        data: { qtyPerUnit: 9 },
        include: { material: true },
      });
      // AuditLog tay - bomAccessoryItem không nằm trong AUDITED_MODELS tự động.
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
      const auditArgs = auditLogCreateData(prisma.auditLog.create.mock.calls[0]);
      expect(auditArgs.tableName).toBe('BomAccessoryItem');
      expect(auditArgs.recordId).toBe('1');
      expect(auditArgs.oldValue.__adminOverrideOnActiveRevision).toBe(true);
      expect(auditArgs.newValue.qtyPerUnit).toBe(9);
    });

    it('vẫn update bình thường (không transaction/audit) khi revision còn DRAFT', async () => {
      prisma.bomRevision.findUnique.mockResolvedValue(draftRevision());
      prisma.bomAccessoryItem.findUnique.mockResolvedValue(existingRow());
      prisma.bomAccessoryItem.update.mockResolvedValue({
        ...existingRow(),
        qtyPerUnit: { toNumber: () => 9 },
      });

      const result = await service.updateBomAccessoryItem('10', '1', { qtyPerUnit: 9 }, ['ADMIN']);

      expect(result.qtyPerUnit).toBe(9);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
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

    it('rejects a duplicate (bomRevisionId, pieceId, materialId) row - CÙNG material trên CÙNG piece', async () => {
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

    // 2026-10-03: đảo ngược ràng buộc "luôn đúng 1 material/piece" (2026-08-22) - piece giờ được
    // phép có NHIỀU dòng Tự tính miễn là KHÁC material. Trước đây findUnique trả về {id:1n} (dòng
    // của material 80) sẽ chặn CẢ dòng material khác trên cùng piece - giờ query đi theo đúng 3
    // cột (bomRevisionId, pieceId, materialId) nên dòng material 80 không còn chặn material 81.
    it('cho phép 1 piece có 2 dòng Tự tính KHÁC material (vd "Pat" vừa Tấm sắt la vừa Sắt phi)', async () => {
      const materialSatPhi = { id: 81n, code: 'SAT-001' };
      prisma.bomRevision.findUnique.mockResolvedValue(draftRevision());
      prisma.piece.findUnique.mockResolvedValue(piece40);
      prisma.bomPiece.findUnique.mockResolvedValue({ needsHan: false });
      prisma.material.findUnique.mockResolvedValue(materialSatPhi);
      // Không còn dòng nào trùng ĐÚNG (piece 40, material 81) dù piece 40 đã có dòng material 80.
      prisma.pieceMaterialYield.findUnique.mockResolvedValue(null);
      prisma.pieceMaterialYield.create.mockResolvedValue({
        id: 3n,
        bomRevisionId: 10n,
        pieceId: 40n,
        materialId: 81n,
        piecesPerBar: 4,
        piece: piece40,
        material: materialSatPhi,
      });

      const result = await service.createPieceMaterialYield('10', {
        pieceId: '40',
        materialId: '81',
        piecesPerBar: 4,
      });

      expect(result.materialCode).toBe('SAT-001');
      expect(prisma.pieceMaterialYield.findUnique).toHaveBeenCalledWith({
        where: {
          bomRevisionId_pieceId_materialId: { bomRevisionId: 10n, pieceId: 40n, materialId: 81n },
        },
      });
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
