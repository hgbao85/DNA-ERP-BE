import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  MaterialIssueStatus,
  MfgRole,
  MfgStage,
  StockLedgerRefType,
} from '../../generated/prisma/client';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { StockReservationsService } from '../stock/stock-reservations.service';
import { MaterialIssuesService } from './material-issues.service';

describe('MaterialIssuesService', () => {
  let service: MaterialIssuesService;
  let stockLedgerService: { postEntry: jest.Mock };
  let stockReservationsService: { getAvailableQty: jest.Mock };
  // Vấn đề #1 audit 26/08 - $queryRaw (khoá + đọc stock_quant) điều khiển bởi biến này, mặc định
  // dư dả để không ảnh hưởng các test có sẵn (chỉ quan tâm định mức BOM); test riêng cho check tồn
  // kho thật sẽ tự set lại giá trị thấp.
  let physicalStockQty: number;
  let prisma: {
    materialIssue: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      aggregate: jest.Mock;
    };
    productionOrder: { findUnique: jest.Mock };
    material: { findUnique: jest.Mock };
    consumableBom: { findUnique: jest.Mock; findMany: jest.Mock };
    warehouse: { findUniqueOrThrow: jest.Mock };
    $executeRaw: jest.Mock;
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };

  const order = {
    id: 1n,
    poNumber: 'PO-31-1',
    bomRevisionId: 5n,
    quantity: 10,
    productionInvoiceItem: { salesOrder: { code: 'PO-31' } },
  };
  const material = { id: 30n, code: 'CO2-25', name: 'Khí CO₂ (bình 25kg)' };
  const consumableBomRow = {
    id: 1n,
    bomRevisionId: 5n,
    stage: MfgStage.HAN,
    materialId: 30n,
    qtyPerUnit: { toNumber: () => 3 }, // plannedQty = 3*10 = 30
  };
  const vatTuTp = { id: 2n, code: 'vat-tu-tp', name: 'Kho Vật tư thành phẩm' };
  const production = { id: 9n, code: 'PRODUCTION', name: 'Đang sản xuất (ảo)' };

  const issueRow = {
    id: 100n,
    stage: MfgStage.HAN,
    productionOrderId: 1n,
    materialId: 30n,
    issuedQty: { toNumber: () => 5 },
    status: MaterialIssueStatus.ISSUED,
    idempotencyKey: null,
    issuedAt: new Date(),
    issuedById: 'user-1',
    receivedQty: null,
    receivedAt: null,
    receivedById: null,
    productionOrder: order,
    material,
  };

  beforeEach(() => {
    physicalStockQty = 9999;
    prisma = {
      materialIssue: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _sum: { issuedQty: null } }),
      },
      productionOrder: { findUnique: jest.fn().mockResolvedValue(order) },
      material: { findUnique: jest.fn().mockResolvedValue(material) },
      consumableBom: {
        findUnique: jest.fn().mockResolvedValue(consumableBomRow),
        findMany: jest.fn().mockResolvedValue([]),
      },
      warehouse: {
        findUniqueOrThrow: jest
          .fn()
          .mockImplementation(({ where }: { where: { code: string } }) =>
            Promise.resolve(where.code === 'vat-tu-tp' ? vatTuTp : production),
          ),
      },
      $executeRaw: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn(() => Promise.resolve([{ qty: { toNumber: () => physicalStockQty } }])),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(prisma))),
    };
    stockLedgerService = { postEntry: jest.fn().mockResolvedValue(undefined) };
    stockReservationsService = {
      getAvailableQty: jest.fn((_tx, _wh, _mat, onHand: number) => Promise.resolve(onHand)),
    };
    service = new MaterialIssuesService(
      prisma as unknown as PrismaServiceType,
      stockLedgerService as unknown as StockLedgerService,
      stockReservationsService as unknown as StockReservationsService,
    );
  });

  describe('create', () => {
    const dto = { stage: MfgStage.HAN, materialId: '30', issuedQty: 5 };

    it('happy path - tạo đợt xuất mới + ghi StockLedger', async () => {
      prisma.materialIssue.create.mockResolvedValue(issueRow);

      const result = await service.create('1', dto, 'user-1', null);

      expect(prisma.materialIssue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({
            stage: MfgStage.HAN,
            productionOrderId: 1n,
            materialId: 30n,
            issuedQty: 5,
          }),
        }),
      );
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          fromWarehouseId: 2n,
          toWarehouseId: 9n,
          materialId: 30n,
          qty: 5,
          refType: StockLedgerRefType.MATERIAL_ISSUE,
          refId: '100',
          idempotencyKey: 'material-issue:100',
        }),
      );
      expect(result.id).toBe('100');
    });

    it('idempotency short-circuit - trả về đợt cũ, không tạo mới, vẫn đảm bảo ledger đã ghi', async () => {
      prisma.materialIssue.findUnique.mockResolvedValue(issueRow);

      const result = await service.create('1', dto, 'user-1', null, 'idem-key-1');

      expect(prisma.materialIssue.create).not.toHaveBeenCalled();
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: 'material-issue:100' }),
      );
      expect(result.id).toBe('100');
    });

    it('chặn caller bị giới hạn ở kho khác kho vật tư-TP', async () => {
      await expect(service.create('1', dto, 'user-1', 'thanh-pham')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.materialIssue.create).not.toHaveBeenCalled();
    });

    it('cho phép caller không có warehouseScope (tổng kho)', async () => {
      prisma.materialIssue.create.mockResolvedValue(issueRow);
      await expect(service.create('1', dto, 'user-1', null)).resolves.toBeDefined();
    });

    it('ném BadRequestException khi stage không phải HAN/SON', async () => {
      await expect(
        service.create('1', { ...dto, stage: MfgStage.PHOI }, 'user-1', null),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.materialIssue.create).not.toHaveBeenCalled();
    });

    it('ném NotFoundException khi production order không tồn tại', async () => {
      prisma.productionOrder.findUnique.mockResolvedValue(null);
      await expect(service.create('1', dto, 'user-1', null)).rejects.toThrow(NotFoundException);
    });

    it('ném NotFoundException khi vật tư không tồn tại', async () => {
      prisma.material.findUnique.mockResolvedValue(null);
      await expect(service.create('1', dto, 'user-1', null)).rejects.toThrow(NotFoundException);
    });

    it('ném NotFoundException khi không có ConsumableBom cho (stage, material) này', async () => {
      prisma.consumableBom.findUnique.mockResolvedValue(null);
      await expect(service.create('1', dto, 'user-1', null)).rejects.toThrow(NotFoundException);
    });

    it('ném BadRequestException khi vượt quá số lượng còn có thể xuất', async () => {
      // plannedQty = 30, chưa xuất gì -> remaining = 30
      await expect(service.create('1', { ...dto, issuedQty: 31 }, 'user-1', null)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('cho phép xuất đúng bằng remaining (biên)', async () => {
      prisma.materialIssue.create.mockResolvedValue(issueRow);
      await expect(
        service.create('1', { ...dto, issuedQty: 30 }, 'user-1', null),
      ).resolves.toBeDefined();
    });

    it('cộng dồn đã xuất từ các đợt trước khi tính remaining', async () => {
      // đã xuất 27 -> remaining = 30 - 27 = 3
      prisma.materialIssue.aggregate.mockResolvedValue({
        _sum: { issuedQty: { toNumber: () => 27 } },
      });

      await expect(service.create('1', { ...dto, issuedQty: 4 }, 'user-1', null)).rejects.toThrow(
        BadRequestException,
      );

      prisma.materialIssue.create.mockResolvedValue(issueRow);
      await expect(
        service.create('1', { ...dto, issuedQty: 3 }, 'user-1', null),
      ).resolves.toBeDefined();
    });

    it('khoá advisory theo (order, stage, material) TRONG transaction trước khi đọc remaining (H2 fix - chặn race đọc-rồi-ghi)', async () => {
      prisma.materialIssue.create.mockResolvedValue(issueRow);

      await service.create('1', dto, 'user-1', null);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.$executeRaw).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest mock.calls typing
      const rawCall = prisma.$executeRaw.mock.calls[0][0] as TemplateStringsArray;
      expect(rawCall.join('')).toContain('pg_advisory_xact_lock');
    });

    // Vấn đề #1 audit 26/08 (Nghiêm trọng) - trước đây chỉ check định mức BOM, không đối chiếu
    // tồn kho vật lý, nên xuất vượt tồn thật vẫn được chấp nhận.
    it('ném ConflictException khi tồn kho thật không đủ dù trong định mức BOM (Vấn đề #1)', async () => {
      // định mức cho phép 30 (plannedQty), nhưng kho chỉ còn 2 - vẫn phải chặn.
      physicalStockQty = 2;
      await expect(service.create('1', { ...dto, issuedQty: 5 }, 'user-1', null)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.materialIssue.create).not.toHaveBeenCalled();
    });

    it('cho phép xuất khi tồn kho thật đủ, đúng bằng số cần xuất', async () => {
      physicalStockQty = 5;
      prisma.materialIssue.create.mockResolvedValue(issueRow);
      await expect(
        service.create('1', { ...dto, issuedQty: 5 }, 'user-1', null),
      ).resolves.toBeDefined();
    });

    it('khoá dòng stock_quant bằng FOR UPDATE trước khi đọc tồn (chặn race giữa 2 lệnh SX khác nhau)', async () => {
      prisma.materialIssue.create.mockResolvedValue(issueRow);
      await service.create('1', dto, 'user-1', null);

      expect(prisma.$queryRaw).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest mock.calls typing
      const rawCall = prisma.$queryRaw.mock.calls[0][0] as TemplateStringsArray;
      expect(rawCall.join('')).toContain('FOR UPDATE');
      expect(rawCall.join('')).toContain('stock_quant');
    });

    it('dùng getAvailableQty() (trừ giữ chỗ chuyển kho) thay vì tồn thô - vật tư đang bị giữ chỗ vẫn bị chặn dù tồn thô đủ', async () => {
      physicalStockQty = 100; // tồn thô dư dả...
      stockReservationsService.getAvailableQty.mockResolvedValue(3); // ...nhưng khả dụng chỉ còn 3 (đang chuyển kho)
      await expect(service.create('1', { ...dto, issuedQty: 5 }, 'user-1', null)).rejects.toThrow(
        ConflictException,
      );
      expect(stockReservationsService.getAvailableQty).toHaveBeenCalledWith(
        expect.anything(),
        2n,
        30n,
        100,
      );
    });
  });

  describe('receive', () => {
    beforeEach(() => {
      prisma.materialIssue.findUnique.mockResolvedValue(issueRow);
    });

    it('happy path - mfgRole null (quản lý) xác nhận nhận đủ như xuất', async () => {
      prisma.materialIssue.update.mockResolvedValue({
        ...issueRow,
        status: MaterialIssueStatus.RECEIVED,
        receivedQty: { toNumber: () => 5 },
        receivedAt: new Date(),
        receivedById: 'user-2',
      });

      const result = await service.receive('100', {}, 'user-2', null);

      expect(prisma.materialIssue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({
            status: MaterialIssueStatus.RECEIVED,
            receivedQty: 5,
            receivedById: 'user-2',
          }),
        }),
      );
      expect(result.status).toBe(MaterialIssueStatus.RECEIVED);
    });

    it('cho phép mfgRole khớp đúng stage (HAN)', async () => {
      prisma.materialIssue.update.mockResolvedValue(issueRow);
      await expect(service.receive('100', {}, 'user-2', MfgRole.HAN)).resolves.toBeDefined();
    });

    it('ném ForbiddenException khi mfgRole không khớp stage (SON xác nhận đợt HAN)', async () => {
      await expect(service.receive('100', {}, 'user-2', MfgRole.SON)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.materialIssue.update).not.toHaveBeenCalled();
    });

    it('ném ConflictException khi đợt không còn ở trạng thái ISSUED', async () => {
      prisma.materialIssue.findUnique.mockResolvedValue({
        ...issueRow,
        status: MaterialIssueStatus.RECEIVED,
      });
      await expect(service.receive('100', {}, 'user-2', null)).rejects.toThrow(ConflictException);
    });

    it('nhận thiếu (receivedQty < issuedQty) - hợp lệ', async () => {
      prisma.materialIssue.update.mockResolvedValue(issueRow);
      await expect(
        service.receive('100', { receivedQty: 3 }, 'user-2', null),
      ).resolves.toBeDefined();
      expect(prisma.materialIssue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({ receivedQty: 3 }),
        }),
      );
    });

    it('ném BadRequestException khi receivedQty vượt quá issuedQty', async () => {
      await expect(service.receive('100', { receivedQty: 6 }, 'user-2', null)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.materialIssue.update).not.toHaveBeenCalled();
    });
  });

  describe('getIssuePlan', () => {
    it('chưa xuất gì vẫn trả về 1 dòng với remainingToIssue = requiredQty', async () => {
      prisma.consumableBom.findMany.mockResolvedValue([{ ...consumableBomRow, material }]);

      const result = await service.getIssuePlan('1');
      expect(result).toHaveLength(1);
      expect(result[0].requiredQty).toBe(30);
      expect(result[0].issuedQty).toBe(0);
      expect(result[0].remainingToIssue).toBe(30);
    });

    it('tính đúng issuedQty cộng dồn nhiều đợt cùng (stage, material)', async () => {
      prisma.consumableBom.findMany.mockResolvedValue([{ ...consumableBomRow, material }]);
      prisma.materialIssue.findMany.mockResolvedValue([
        { stage: MfgStage.HAN, materialId: 30n, issuedQty: { toNumber: () => 5 } },
        { stage: MfgStage.HAN, materialId: 30n, issuedQty: { toNumber: () => 8 } },
      ]);

      const result = await service.getIssuePlan('1');
      expect(result[0].issuedQty).toBe(13);
      expect(result[0].remainingToIssue).toBe(17);
    });

    it('tách riêng theo material khác nhau dù cùng stage', async () => {
      const material2 = { id: 31n, code: 'DAY-HAN', name: 'Dây hàn CO₂ Ø1.0' };
      prisma.consumableBom.findMany.mockResolvedValue([
        { ...consumableBomRow, material },
        { ...consumableBomRow, id: 2n, materialId: 31n, material: material2 },
      ]);
      prisma.materialIssue.findMany.mockResolvedValue([
        { stage: MfgStage.HAN, materialId: 30n, issuedQty: { toNumber: () => 5 } },
      ]);

      const result = await service.getIssuePlan('1');
      expect(result).toHaveLength(2);
      const row1 = result.find((r) => r.materialId === '30');
      const row2 = result.find((r) => r.materialId === '31');
      expect(row1?.issuedQty).toBe(5);
      expect(row2?.issuedQty).toBe(0);
    });
  });
});
