import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AccessoryItemKind } from '../../generated/prisma/client';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { BomRevisionsService } from './bom-revisions.service';

describe('BomRevisionsService', () => {
  let service: BomRevisionsService;
  let prisma: {
    mfgProduct: { findUnique: jest.Mock };
    bomRevision: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findFirstOrThrow: jest.Mock;
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
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    auditLog: { create: jest.Mock };
    $transaction: jest.Mock;
    $executeRawUnsafe: jest.Mock;
    $executeRaw: jest.Mock;
    $queryRaw: jest.Mock;
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
        findUniqueOrThrow: jest.fn(),
        findFirstOrThrow: jest.fn(),
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
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      auditLog: { create: jest.fn() },
      // $transaction chạy callback với chính `prisma` giả này làm `tx` (cùng shape delegate).
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
      $executeRawUnsafe: jest.fn(),
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn(),
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

  // L7 16/11: Admin ghi đè định mức SKU đã duyệt - sao chép bản ACTIVE sang bản mới, lệnh đang chạy giữ bản cũ.
  describe('forkForAdminOverride / activateForAdminOverride', () => {
    const TABLES = [
      'bom_piece',
      'bom_part',
      'piece_bom',
      'part_bom',
      'piece_material_item',
      'piece_material_yield',
      'consumable_bom',
      'bom_accessory_items',
      'bom_option',
    ];
    const active = () => draftRevision({ status: 'ACTIVE', sourcePlanFormId: 5n, revNo: 3 });

    it('khoá theo sản phẩm, chuyển sourcePlanFormId sang bản mới và sao chép đủ 9 bảng dòng con từ bản cũ', async () => {
      prisma.bomRevision.findUnique.mockResolvedValue(active());
      prisma.bomRevision.findUniqueOrThrow.mockResolvedValue(active());
      prisma.bomRevision.findFirstOrThrow.mockResolvedValue(draftRevision({ revNo: 4 }));
      prisma.bomRevision.create.mockResolvedValue(
        draftRevision({ id: 11n, revNo: 5, sourcePlanFormId: 5n }),
      );
      prisma.$queryRaw.mockResolvedValue(
        TABLES.flatMap((t) => [
          { table_name: t, column_name: 'qtyPerUnit' },
          { table_name: t, column_name: 'createdAt' },
        ]),
      );

      const newId = await service.forkForAdminOverride(prisma as any, 10n, 5n);

      expect(newId).toBe(11n);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1); // pg_advisory_xact_lock
      expect(prisma.bomRevision.update).toHaveBeenCalledWith({
        where: { id: 10n },
        data: { sourcePlanFormId: null },
      });
      expect(prisma.bomRevision.create).toHaveBeenCalledWith({
        data: { mfgProductId: 2n, revNo: 5, sourcePlanFormId: 5n },
      });
      // nhả sourcePlanFormId ở bản cũ TRƯỚC khi tạo bản mới (@unique)
      expect(prisma.bomRevision.update.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.bomRevision.create.mock.invocationCallOrder[0],
      );
      const copied = prisma.$executeRawUnsafe.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(copied).toHaveLength(TABLES.length);
      TABLES.forEach((t, i) => {
        expect(copied[i]).toBe(
          `INSERT INTO "${t}" ("qtyPerUnit", "createdAt", "bomRevisionId") SELECT "qtyPerUnit", "createdAt", $1 FROM "${t}" WHERE "bomRevisionId" = $2 ORDER BY id`,
        );
        expect((prisma.$executeRawUnsafe.mock.calls[i] as unknown[]).slice(1)).toEqual([11n, 10n]);
      });
      // không mở escape hatch - bản cũ không bị ghi dòng con nào
      expect(copied.some((q) => q.includes('bom_maintenance'))).toBe(false);
    });

    it('409 khi lần ghi đè khác vừa chuyển SKU sang bản mới (đọc lại sau khoá)', async () => {
      prisma.bomRevision.findUnique.mockResolvedValue(active());
      prisma.bomRevision.findUniqueOrThrow.mockResolvedValue(
        draftRevision({ status: 'RETIRED', sourcePlanFormId: null }),
      );

      await expect(service.forkForAdminOverride(prisma as any, 10n, 5n)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.bomRevision.create).not.toHaveBeenCalled();
      expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('409 khi bản SKU sở hữu đã RETIRED (SKU khác của sản phẩm đã có bản mới hơn đang dùng)', async () => {
      const retired = draftRevision({ status: 'RETIRED', sourcePlanFormId: 5n });
      prisma.bomRevision.findUnique.mockResolvedValue(retired);
      prisma.bomRevision.findUniqueOrThrow.mockResolvedValue(retired);

      await expect(service.forkForAdminOverride(prisma as any, 10n, 5n)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.bomRevision.update).not.toHaveBeenCalled();
    });

    it('activateForAdminOverride: kích hoạt bản DRAFT của phiếu đã APPROVED, bản ACTIVE cũ thành RETIRED', async () => {
      prisma.bomRevision.findUniqueOrThrow.mockResolvedValue(
        draftRevision({ id: 11n, sourcePlanFormId: 5n }),
      );
      prisma.planForm.findUnique.mockResolvedValue({ id: 5n, status: 'APPROVED' });
      prisma.bomRevision.update.mockResolvedValue(draftRevision({ id: 11n, status: 'ACTIVE' }));

      const result = await service.activateForAdminOverride(prisma as any, 11n);

      expect(result.status).toBe('ACTIVE');
      expect(prisma.bomRevision.updateMany).toHaveBeenCalledWith({
        where: { mfgProductId: 2n, status: 'ACTIVE' },
        data: { status: 'RETIRED' },
      });
    });

    it('activateForAdminOverride: 409 khi phiếu kế hoạch chưa APPROVED (không dùng để vượt luồng Sếp duyệt)', async () => {
      prisma.bomRevision.findUniqueOrThrow.mockResolvedValue(
        draftRevision({ id: 11n, sourcePlanFormId: 5n }),
      );
      prisma.planForm.findUnique.mockResolvedValue({ id: 5n, status: 'WAITING_BOSS_APPROVAL' });

      await expect(service.activateForAdminOverride(prisma as any, 11n)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.bomRevision.updateMany).not.toHaveBeenCalled();
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
      prisma.bomAccessoryItem.findFirst.mockResolvedValue(null);
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
      prisma.bomAccessoryItem.findFirst.mockResolvedValue({ id: 1n });

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

  // L7 16/11: route sửa từng dòng không còn cho Admin ghi đè bản đã duyệt - đổi định mức SKU đã duyệt đi qua màn định
  // mức SKU (SkusService), luồng đó tạo bản MỚI để lệnh đang chạy giữ bản cũ (xem forkForAdminOverride).
  describe('updateBomAccessoryItem (bản không còn DRAFT)', () => {
    const existingRow = () => ({
      id: 1n,
      bomRevisionId: 10n,
      materialId: 80n,
      kind: 'ACCESSORY',
      qtyPerUnit: { toNumber: () => 5 },
      material: { code: 'PK-01' },
    });

    it('rejects khi revision đã ACTIVE - kể cả Admin, không mở escape hatch DB', async () => {
      prisma.bomRevision.findUnique.mockResolvedValue(draftRevision({ status: 'ACTIVE' }));
      prisma.bomAccessoryItem.findUnique.mockResolvedValue(existingRow());

      await expect(service.updateBomAccessoryItem('10', '1', { qtyPerUnit: 9 })).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.bomAccessoryItem.update).not.toHaveBeenCalled();
      expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('vẫn update bình thường (không transaction/audit) khi revision còn DRAFT', async () => {
      prisma.bomRevision.findUnique.mockResolvedValue(draftRevision());
      prisma.bomAccessoryItem.findUnique.mockResolvedValue(existingRow());
      prisma.bomAccessoryItem.update.mockResolvedValue({
        ...existingRow(),
        qtyPerUnit: { toNumber: () => 9 },
      });

      const result = await service.updateBomAccessoryItem('10', '1', { qtyPerUnit: 9 });

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
