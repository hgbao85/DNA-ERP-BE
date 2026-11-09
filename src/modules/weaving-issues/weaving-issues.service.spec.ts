import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { WeavingIssuesService } from './weaving-issues.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { loadSkuPriorityHoldback } from '../stock/sku-priority.util';

// YC11: mặc định không có SKU sớm hơn cần chừa - test riêng từng ca ở 'YC11' bên dưới; logic chừa thật test ở sku-priority.util.spec.
jest.mock('../stock/sku-priority.util', () => ({
  ...jest.requireActual<Record<string, unknown>>('../stock/sku-priority.util'),
  loadSkuPriorityHoldback: jest.fn(() => Promise.resolve({ qty: 0, holders: [] })),
}));

describe('WeavingIssuesService', () => {
  let service: WeavingIssuesService;
  let prisma: {
    weavingIssue: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      aggregate: jest.Mock;
    };
    weavingReceipt: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      aggregate: jest.Mock;
    };
    productionOrder: { findUnique: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock };
    productionInvoiceItem: {
      findUniqueOrThrow: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
    };
    productionBatch: { aggregate: jest.Mock; findMany: jest.Mock };
    issueSlipLine: { aggregate: jest.Mock; findMany: jest.Mock };
    piece: { findUnique: jest.Mock };
    weavingPoint: { findUnique: jest.Mock; findMany: jest.Mock };
    bomPiece: { findUnique: jest.Mock; findMany: jest.Mock };
    materialGroup: { findMany: jest.Mock };
    pieceMaterialItem: { findMany: jest.Mock };
    bomOption: { findMany: jest.Mock };
    material: { findUnique: jest.Mock };
    warehouse: {
      findUniqueOrThrow: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
    };
    weavingIssueMaterial: { create: jest.Mock; findMany: jest.Mock };
    stockQuant: { findMany: jest.Mock };
    warehouseTransferPieceItem: { findMany: jest.Mock; aggregate: jest.Mock };
    $executeRaw: jest.Mock;
    $queryRaw: jest.Mock;
    auditLog: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let stockLedgerService: { postEntry: jest.Mock };
  let stockReservationsService: { getAvailableQty: jest.Mock; drainPoolBestEffort: jest.Mock };
  let notificationsService: { emit: jest.Mock; resolve: jest.Mock };

  const order = {
    id: 1n,
    poNumber: 'PO-31-1',
    bomRevisionId: 5n,
    quantity: 10,
    productionInvoiceItemId: 21n,
    productionInvoiceItem: { salesOrder: { orderCode: 'PO-31' } },
    mfgProduct: { name: 'Ghế xoay demo' },
  };
  const piece = { id: 20n, code: 'MANH-DAN', name: 'Mảnh Đan', isWoven: true };
  const weavingPoint = { id: 40n, code: 'DIEM-A', fullName: 'Điểm đan A', isActive: true };
  // isWoven ở đây là SNAPSHOT trên BomPiece (theo đúng bomRevisionId), không phải piece.isWoven
  // (global) - xem findBomPieceOrThrow/getIssuePlan.
  const bomPieceRow = { id: 1n, bomRevisionId: 5n, pieceId: 20n, qtyPerUnit: 4, isWoven: true }; // plannedQty = 4*10 = 40

  const issueRow = {
    id: 100n,
    productionOrderId: 1n,
    pieceId: 20n,
    weavingPointId: 40n,
    qty: 10,
    idempotencyKey: null,
    issuedAt: new Date(),
    issuedById: 'user-1',
    productionOrder: order,
    piece,
    weavingPoint,
  };

  const receiptRow = {
    id: 200n,
    productionOrderId: 1n,
    pieceId: 20n,
    weavingPointId: 40n,
    qty: 5,
    idempotencyKey: null,
    receivedAt: new Date(),
    receivedById: 'user-1',
    productionOrder: order,
    piece,
    weavingPoint,
  };

  beforeEach(() => {
    prisma = {
      weavingIssue: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _sum: { qty: null } }),
      },
      weavingReceipt: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _sum: { qty: null } }),
      },
      // findFirst mặc định trả về 1 order ACTIVE - đa số test case không quan tâm gate
      // assertItemPiHasActiveFloor() (2026-08-31).
      productionOrder: {
        findUnique: jest.fn().mockResolvedValue(order),
        findFirst: jest.fn().mockResolvedValue({ id: 9n }),
        // Mặc định 1 order duy nhất - describe('getIssuePlanBatch') bên dưới tự override cho case
        // nhiều order.
        findMany: jest.fn().mockResolvedValue([order]),
      },
      productionInvoiceItem: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ productionInvoiceId: 500n }),
        findUnique: jest.fn().mockResolvedValue({ productionInvoiceId: 500n }),
        // Xưởng của lệnh (WorkshopWarehouseResolver) - mặc định chưa gắn xưởng.
        findFirst: jest.fn().mockResolvedValue(null),
      },
      productionBatch: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { reportedQty: null } }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      issueSlipLine: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { qty: null } }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      piece: { findUnique: jest.fn().mockResolvedValue(piece) },
      weavingPoint: {
        findUnique: jest.fn().mockResolvedValue(weavingPoint),
        findMany: jest.fn().mockResolvedValue([weavingPoint]),
      },
      bomPiece: {
        findUnique: jest.fn().mockResolvedValue(bomPieceRow),
        findMany: jest.fn().mockResolvedValue([]),
      },
      // getIssuePlan()/getIssuePlanBatch() luôn truy vấn kèm định mức Dây/Đinh (xem
      // getWovenMaterialLinesByPiece, 2026-09-11) - mặc định rỗng, các test case về wire/nail
      // tự override.
      materialGroup: { findMany: jest.fn().mockResolvedValue([]) },
      pieceMaterialItem: { findMany: jest.fn().mockResolvedValue([]) },
      // Tick loại dây/nệm của định mức - mặc định không tick gì (không lọc dòng nào).
      bomOption: { findMany: jest.fn().mockResolvedValue([]) },
      // Vật tư THẬT mang kèm mảnh (2026-09-11, issueMaterialsForWeaving) - mặc định rỗng/không
      // gọi tới, các test case về materials tự override.
      material: { findUnique: jest.fn() },
      warehouse: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 999n, code: 'PRODUCTION' }),
        findMany: jest.fn().mockResolvedValue([{ code: 'thanh-pham' }]),
        // Kho giữ mảnh (Sơn) - mặc định có 1 kho Sơn.
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 70n, code: 'phoi-son-han-son-pa', kind: 'SON', workshopId: 1n }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      weavingIssueMaterial: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      stockQuant: { findMany: jest.fn().mockResolvedValue([]) },
      // Số mảnh đã CONFIRMED từ Phân phối nội bộ (2026-09-12, sumReceivedForPiece/receivedByPiece)
      // - create() mặc định dư dả (không chặn test case cũ không quan tâm ràng buộc mới này);
      // getIssuePlan()/getIssuePlanBatch() mặc định rỗng (canIssueQty=0), test case riêng tự override.
      warehouseTransferPieceItem: {
        findMany: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: null } }),
      },
      $executeRaw: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn().mockResolvedValue([]),
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(prisma))),
    };
    stockLedgerService = { postEntry: jest.fn().mockResolvedValue(undefined) };
    stockReservationsService = {
      getAvailableQty: jest.fn().mockResolvedValue(1_000_000),
      drainPoolBestEffort: jest.fn().mockResolvedValue(undefined),
    };
    notificationsService = {
      emit: jest.fn().mockResolvedValue(undefined),
      resolve: jest.fn().mockResolvedValue(undefined),
    };
    const realtimeStub = { publishEntityChanged: jest.fn(), publishNotificationCreated: jest.fn() };
    service = new WeavingIssuesService(
      prisma as unknown as PrismaServiceType,
      stockLedgerService as never,
      stockReservationsService as never,
      notificationsService as never,
      realtimeStub as unknown as RealtimeService,
      { isActive: jest.fn().mockReturnValue(false), get: jest.fn() } as never,
    );
  });

  // Xuất đan 2 phiếu (anh Nhân 09/11/2026): phiếu mảnh từ kho giữ mảnh (kho Sơn) + phiếu vật tư kèm từ kho Phụ kiện. Ghi thật
  // nằm ở IssueSlipsService (cấp số, ảnh ký) - ở đây test phần kiểm và ghi trong transaction.
  describe('xuất đan 2 phiếu', () => {
    const sonWarehouse = { id: 70n, code: 'phoi-son-han-son-pa', kind: 'SON', workshopId: 1n };
    const prepared = () =>
      ({
        order: order as never,
        pieceId: 20n,
        pieceName: 'Mảnh Đan',
        weavingPointId: 40n,
        qty: 10,
        plannedQty: 40,
        finalStage: 'SON' as never,
        warehouse: { id: 70n, code: 'phoi-son-han-son-pa' },
      }) satisfies Parameters<WeavingIssuesService['assertPieceCapInTx']>[1];

    beforeEach(() => {
      prisma.bomPiece.findUnique.mockResolvedValue({
        ...bomPieceRow,
        needsHan: true,
        needsSon: true,
      });
      prisma.productionInvoiceItem.findUnique.mockResolvedValue({ productionInvoiceId: 500n });
      prisma.productionInvoiceItem.findFirst.mockResolvedValue({ workshopId: 1n });
      prisma.warehouse.findFirst.mockResolvedValue(sonWarehouse);
    });

    describe('prepareWeavingPiece', () => {
      it('mảnh cần sơn: xuất từ kho Sơn, định mức = qtyPerUnit × SL lệnh', async () => {
        const p = await service.prepareWeavingPiece('1', '20', 40n, 10, 'phoi-son-han-son-pa');
        expect(p.warehouse).toEqual({ id: 70n, code: 'phoi-son-han-son-pa' });
        expect(p.plannedQty).toBe(40);
        expect(p.finalStage).toBe('SON');
      });

      it('thủ kho khác kho giữ mảnh (vd kho Phụ kiện) bị chặn', async () => {
        await expect(service.prepareWeavingPiece('1', '20', 40n, 10, 'vat-tu-tp')).rejects.toThrow(
          ForbiddenException,
        );
      });

      it('mảnh không đan trong định mức của lệnh -> 400', async () => {
        prisma.bomPiece.findUnique.mockResolvedValue({
          ...bomPieceRow,
          isWoven: false,
          needsHan: true,
          needsSon: true,
        });
        await expect(service.prepareWeavingPiece('1', '20', 40n, 10, null)).rejects.toThrow(
          BadRequestException,
        );
      });

      it('mảnh không có trong định mức -> 404', async () => {
        prisma.bomPiece.findUnique.mockResolvedValue(null);
        await expect(service.prepareWeavingPiece('1', '20', 40n, 10, null)).rejects.toThrow(
          NotFoundException,
        );
      });

      it('số mảnh không nguyên / điểm đan ngừng hoạt động -> 400', async () => {
        await expect(service.prepareWeavingPiece('1', '20', 40n, 1.5, null)).rejects.toThrow(
          BadRequestException,
        );
        prisma.weavingPoint.findUnique.mockResolvedValue({ ...weavingPoint, isActive: false });
        await expect(service.prepareWeavingPiece('1', '20', 40n, 10, null)).rejects.toThrow(
          BadRequestException,
        );
      });

      it('QLSX chưa bấm "Bắt đầu" cho PI -> 409', async () => {
        prisma.productionOrder.findFirst.mockResolvedValue(null);
        await expect(service.prepareWeavingPiece('1', '20', 40n, 10, null)).rejects.toThrow(
          ConflictException,
        );
      });
    });

    describe('assertPieceCapInTx', () => {
      beforeEach(() => {
        // Đã qua KCS Sơn 30 mảnh, chưa xuất, chưa có phiếu nào.
        prisma.productionBatch.aggregate.mockResolvedValue({ _sum: { reportedQty: 30 } });
      });

      it('đủ định mức và đủ mảnh ở kho -> qua, có khoá advisory', async () => {
        await expect(
          service.assertPieceCapInTx(prisma as never, prepared(), null),
        ).resolves.toBeUndefined();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest mock.calls typing
        const rawCall = prisma.$executeRaw.mock.calls[0][0] as TemplateStringsArray;
        expect(rawCall.join('')).toContain('pg_advisory_xact_lock');
        expect(prisma.productionBatch.aggregate).toHaveBeenCalledWith(
          expect.objectContaining({
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
            where: expect.objectContaining({ stage: 'SON', status: 'QC_DONE' }),
          }),
        );
      });

      it('vượt định mức (đã xuất 35 / 40) -> 400', async () => {
        prisma.weavingIssue.aggregate.mockResolvedValue({ _sum: { qty: 35 } });
        prisma.productionBatch.aggregate.mockResolvedValue({ _sum: { reportedQty: 100 } });
        await expect(service.assertPieceCapInTx(prisma as never, prepared(), null)).rejects.toThrow(
          /vượt định mức còn lại 5/,
        );
      });

      it('vượt số mảnh đã qua KCS còn ở kho -> 400', async () => {
        prisma.productionBatch.aggregate.mockResolvedValue({ _sum: { reportedQty: 8 } });
        await expect(service.assertPieceCapInTx(prisma as never, prepared(), null)).rejects.toThrow(
          /vượt số mảnh đã qua KCS còn ở kho phoi-son-han-son-pa \(còn 8\)/,
        );
      });

      it('mảnh trên phiếu chờ ký khác + phiếu đã xuất cùng trừ vào phần ở kho', async () => {
        // 30 qua KCS: 12 trên phiếu chờ ký khác, 10 trên phiếu đã xuất -> còn 8 < 10.
        prisma.issueSlipLine.aggregate
          .mockResolvedValueOnce({ _sum: { qty: { toNumber: () => 12 } } })
          .mockResolvedValueOnce({ _sum: { qty: { toNumber: () => 10 } } });
        await expect(service.assertPieceCapInTx(prisma as never, prepared(), 9n)).rejects.toThrow(
          /còn 8/,
        );
        expect(prisma.issueSlipLine.aggregate).toHaveBeenCalledWith(
          expect.objectContaining({
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
            where: expect.objectContaining({
              kind: 'WEAVING_PIECE',
              slip: { status: 'DRAFT', id: { not: 9n } },
            }),
          }),
        );
      });

      it('mảnh đã chuyển sang kho Phụ kiện theo luồng cũ không tính là còn ở kho Sơn', async () => {
        prisma.warehouseTransferPieceItem.aggregate.mockResolvedValue({ _sum: { quantity: 25 } });
        await expect(service.assertPieceCapInTx(prisma as never, prepared(), null)).rejects.toThrow(
          /còn 5/,
        );
      });
    });

    it('createPieceIssueInTx: tạo WeavingIssue + trừ tồn mảnh kho Sơn -> PRODUCTION', async () => {
      prisma.weavingIssue.create.mockResolvedValue(issueRow);
      await service.createPieceIssueInTx(
        prisma as never,
        prepared(),
        'user-1',
        'issue-slip:9:line:1',
      );
      expect(prisma.weavingIssue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
          data: expect.objectContaining({
            productionOrderId: 1n,
            pieceId: 20n,
            weavingPointId: 40n,
            qty: 10,
            idempotencyKey: 'issue-slip:9:line:1',
          }),
        }),
      );
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          fromWarehouseId: 70n,
          toWarehouseId: 999n,
          pieceId: 20n,
          qty: 10,
          refType: 'WEAVING_ISSUE',
          refId: '100',
        }),
        expect.anything(),
      );
    });

    describe('vật tư kèm (phiếu 2)', () => {
      beforeEach(() => {
        prisma.materialGroup.findMany.mockResolvedValue([{ id: 7n, systemKey: 'WIRE' }]);
        prisma.pieceMaterialItem.findMany.mockResolvedValue([
          {
            bomRevisionId: 5n,
            pieceId: 20n,
            materialId: 60n,
            qtyPerPiece: { toNumber: () => 1.5 },
            includeInWeaving: false,
            material: {
              code: 'DAY-2LY',
              name: 'Dây 2 ly',
              spec: null,
              unit: 'kg',
              materialGroupId: 7n,
              warehouseId: 900n,
            },
          },
        ]);
        prisma.material.findUnique.mockResolvedValue({
          code: 'DAY-2LY',
          warehouseId: 900n,
          warehouse: { code: 'vat-tu-tp' },
        });
      });

      it('prepareWeavingMaterial: vật tư đúng danh sách đi kèm, đúng kho Phụ kiện', async () => {
        const p = await service.prepareWeavingMaterial('1', '20', '60', 40n, 15, 'vat-tu-tp');
        expect(p).toEqual(
          expect.objectContaining({
            materialId: 60n,
            warehouseId: 900n,
            productionInvoiceId: 500n,
            qty: 15,
          }),
        );
      });

      it('prepareWeavingMaterial: vật tư không đi kèm mảnh này -> 400; kho khác -> 403', async () => {
        await expect(
          service.prepareWeavingMaterial('1', '20', '61', 40n, 15, null),
        ).rejects.toThrow(BadRequestException);
        await expect(
          service.prepareWeavingMaterial('1', '20', '60', 40n, 15, 'phoi-son-han-son-pa'),
        ).rejects.toThrow(ForbiddenException);
      });

      const preparedMaterial = () => ({
        order: order as never,
        productionInvoiceId: 500n,
        pieceId: 20n,
        weavingPointId: 40n,
        materialId: 60n,
        materialCode: 'DAY-2LY',
        warehouseId: 900n,
        qty: 15,
      });

      it('createMaterialIssueInTx: trừ tồn thật, ghi WeavingIssueMaterial theo lệnh/mảnh/điểm đan, trả giữ chỗ', async () => {
        prisma.$queryRaw.mockResolvedValue([{ qty: { toNumber: () => 50 } }]);
        stockReservationsService.getAvailableQty.mockResolvedValue(45);
        prisma.weavingIssueMaterial.create.mockResolvedValue({ id: 300n });

        await service.createMaterialIssueInTx(prisma as never, preparedMaterial(), 'user-1', 'k-1');

        expect(stockReservationsService.getAvailableQty).toHaveBeenCalledWith(
          expect.anything(),
          900n,
          60n,
          50,
          undefined,
          500n,
        );
        expect(prisma.weavingIssueMaterial.create).toHaveBeenCalledWith({
          data: {
            productionOrderId: 1n,
            pieceId: 20n,
            weavingPointId: 40n,
            materialId: 60n,
            qty: 15,
          },
        });
        expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
          expect.objectContaining({
            fromWarehouseId: 900n,
            toWarehouseId: 999n,
            materialId: 60n,
            qty: 15,
            refType: 'WEAVING_ISSUE_MATERIAL',
            refId: '300',
            idempotencyKey: 'k-1',
          }),
          expect.anything(),
        );
        expect(stockReservationsService.drainPoolBestEffort).toHaveBeenCalledWith(
          expect.anything(),
          {
            productionInvoiceId: 500n,
            materialId: 60n,
            qty: 15,
          },
        );
      });

      it('createMaterialIssueInTx: tồn khả dụng thiếu -> 409, không ghi', async () => {
        prisma.$queryRaw.mockResolvedValue([{ qty: { toNumber: () => 10 } }]);
        stockReservationsService.getAvailableQty.mockResolvedValue(10);
        await expect(
          service.createMaterialIssueInTx(prisma as never, preparedMaterial(), 'user-1', 'k-1'),
        ).rejects.toThrow(ConflictException);
        expect(prisma.weavingIssueMaterial.create).not.toHaveBeenCalled();
      });

      it('createMaterialIssueInTx: YC11 chừa phần SKU sớm hơn -> 409', async () => {
        prisma.$queryRaw.mockResolvedValue([{ qty: { toNumber: () => 20 } }]);
        stockReservationsService.getAvailableQty.mockResolvedValue(20);
        (loadSkuPriorityHoldback as jest.Mock).mockResolvedValueOnce({
          qty: 8,
          holders: [
            {
              productionOrderId: '2',
              lenhCode: 'MY-313',
              deadline: new Date('2026-11-10T00:00:00+07:00'),
              qty: 8,
            },
          ],
        });
        const err = await service
          .createMaterialIssueInTx(prisma as never, preparedMaterial(), 'user-1', 'k-1')
          .catch((e: Error) => e);
        expect(err).toBeInstanceOf(ConflictException);
        expect(prisma.weavingIssueMaterial.create).not.toHaveBeenCalled();
      });
    });
  });

  describe('receive', () => {
    it('happy path - tạo đợt nhập đan mới', async () => {
      prisma.weavingIssue.aggregate.mockResolvedValue({ _sum: { qty: 10 } });
      prisma.weavingReceipt.create.mockResolvedValue(receiptRow);

      const result = await service.receive(
        '1',
        { pieceId: '20', weavingPointId: '40', qty: 5 },
        'user-1',
        null,
      );

      expect(prisma.weavingReceipt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({
            productionOrderId: 1n,
            pieceId: 20n,
            weavingPointId: 40n,
            qty: 5,
          }),
        }),
      );
      expect(result.id).toBe('200');
    });

    it('idempotency short-circuit - trả về đợt cũ, không tạo mới', async () => {
      prisma.weavingReceipt.findUnique.mockResolvedValue(receiptRow);

      const result = await service.receive(
        '1',
        { pieceId: '20', weavingPointId: '40', qty: 5 },
        'user-1',
        null,
        'idem-key-1',
      );

      expect(prisma.weavingReceipt.create).not.toHaveBeenCalled();
      expect(result.id).toBe('200');
    });

    it('chặn caller bị giới hạn ở kho khác kho thành phẩm (nhận đan khác kho với xuất đan)', async () => {
      await expect(
        service.receive(
          '1',
          { pieceId: '20', weavingPointId: '40', qty: 5 },
          'user-1',
          'vat-tu-tp',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.weavingReceipt.create).not.toHaveBeenCalled();
    });

    it('cho phép caller giới hạn ở kho thành phẩm nhận đan (2026-08-31 - trước đây bị chặn nhầm do dùng chung hằng số kho với create())', async () => {
      prisma.weavingIssue.aggregate.mockResolvedValue({ _sum: { qty: 10 } });
      prisma.weavingReceipt.create.mockResolvedValue(receiptRow);
      await expect(
        service.receive(
          '1',
          { pieceId: '20', weavingPointId: '40', qty: 5 },
          'user-1',
          'thanh-pham',
        ),
      ).resolves.toBeDefined();
    });

    it('cho phép caller giới hạn ở kho thành phẩm PHỤ nhận đan (2026-09-03 - trước đây so literal nên chỉ đúng "thanh-pham" gốc mới qua được)', async () => {
      prisma.weavingIssue.aggregate.mockResolvedValue({ _sum: { qty: 10 } });
      prisma.weavingReceipt.create.mockResolvedValue(receiptRow);
      await expect(
        service.receive(
          '1',
          { pieceId: '20', weavingPointId: '40', qty: 5 },
          'user-1',
          'thanh-pham-1735689000000',
        ),
      ).resolves.toBeDefined();
    });

    it('ném NotFoundException khi production order/mảnh/điểm đan không tồn tại', async () => {
      prisma.productionOrder.findUnique.mockResolvedValue(null);
      await expect(
        service.receive('1', { pieceId: '20', weavingPointId: '40', qty: 5 }, 'user-1', null),
      ).rejects.toThrow(NotFoundException);
    });

    it('ném BadRequestException khi vượt quá số lượng điểm đan còn giữ', async () => {
      // đã xuất 10, đã nhập 8 tại điểm này -> remaining = 2
      prisma.weavingIssue.aggregate.mockResolvedValue({ _sum: { qty: 10 } });
      prisma.weavingReceipt.aggregate.mockResolvedValue({ _sum: { qty: 8 } });

      await expect(
        service.receive('1', { pieceId: '20', weavingPointId: '40', qty: 3 }, 'user-1', null),
      ).rejects.toThrow(BadRequestException);
    });

    it('cho phép nhập đúng bằng remaining-tại-điểm (biên)', async () => {
      prisma.weavingIssue.aggregate.mockResolvedValue({ _sum: { qty: 10 } });
      prisma.weavingReceipt.aggregate.mockResolvedValue({ _sum: { qty: 8 } });
      prisma.weavingReceipt.create.mockResolvedValue(receiptRow);

      await expect(
        service.receive('1', { pieceId: '20', weavingPointId: '40', qty: 2 }, 'user-1', null),
      ).resolves.toBeDefined();
    });

    it('cách ly theo điểm đan - cap luôn tính riêng cho weavingPointId trong dto, không lẫn điểm khác', async () => {
      // Điểm B đã xuất 10, đã nhập đủ 10 (remaining = 0) - phải chặn nhập thêm dù điểm A khác
      // còn dư rất nhiều, vì aggregate luôn được gọi với where.weavingPointId = điểm trong dto.
      prisma.weavingIssue.aggregate.mockResolvedValue({ _sum: { qty: 10 } });
      prisma.weavingReceipt.aggregate.mockResolvedValue({ _sum: { qty: 10 } });

      await expect(
        service.receive('1', { pieceId: '20', weavingPointId: '41', qty: 1 }, 'user-1', null),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.weavingIssue.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          where: expect.objectContaining({ weavingPointId: 41n }),
        }),
      );
      expect(prisma.weavingReceipt.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          where: expect.objectContaining({ weavingPointId: 41n }),
        }),
      );
    });

    it('khoá advisory theo (order, piece, weavingPoint) TRONG transaction trước khi đọc remaining (H4 fix - chặn race đọc-rồi-ghi)', async () => {
      prisma.weavingIssue.aggregate.mockResolvedValue({ _sum: { qty: 10 } });
      prisma.weavingReceipt.create.mockResolvedValue(receiptRow);

      await service.receive('1', { pieceId: '20', weavingPointId: '40', qty: 5 }, 'user-1', null);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.$executeRaw).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest mock.calls typing
      const rawCall = prisma.$executeRaw.mock.calls[0][0] as TemplateStringsArray;
      expect(rawCall.join('')).toContain('pg_advisory_xact_lock');
    });
  });

  describe('create/receive - QLSX "Bắt đầu" gate (assertItemPiHasActiveFloor, 2026-08-31)', () => {
    it('receive: ném ConflictException khi PI của order chưa có SKU nào ACTIVE', async () => {
      prisma.productionOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.receive('1', { pieceId: '20', weavingPointId: '40', qty: 5 }, 'user-1', null),
      ).rejects.toThrow(ConflictException);
      expect(prisma.weavingReceipt.create).not.toHaveBeenCalled();
    });
  });

  describe('notify WEAVING_ISSUE_TO_POINT (nhóm 7.5-iv, xuất/nhận đan)', () => {
    it('afterPieceIssue(): emit() với entityId/dedupeKey ghép + outstandingQty tính lại SAU commit (thấy cả lần xuất vừa tạo)', async () => {
      prisma.weavingIssue.aggregate.mockResolvedValue({ _sum: { qty: 10 } });

      await service.afterPieceIssue(issueRow as never, 'user-1');

      expect(notificationsService.emit).toHaveBeenCalledWith(
        'WEAVING_ISSUE_TO_POINT',
        expect.objectContaining({
          entityId: '1:20:40',
          actorId: 'user-1',
          dedupeKey: 'WEAVING_ISSUE_TO_POINT:1:20:40',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          params: expect.objectContaining({
            poNumber: 'PO-31-1',
            pieceName: 'Mảnh Đan',
            weavingPointName: 'Điểm đan A',
            outstandingQty: 10,
            warehouseCodes: ['thanh-pham'],
          }),
        }),
      );
    });

    it('receive(): resolve() khi outstanding tại điểm đan về ĐÚNG 0 sau khi nhận', async () => {
      prisma.weavingReceipt.create.mockResolvedValue(receiptRow);
      prisma.weavingIssue.aggregate.mockResolvedValue({ _sum: { qty: 10 } });
      // Gọi 1 (trong tx, receivedAtPoint TRƯỚC lần nhận này) = 5 -> remaining = 5, đủ cho qty = 5.
      // Gọi 2 (ngoài tx, recompute SAU KHI đã commit, đã thấy dòng vừa tạo) = 10 -> outstanding = 0.
      prisma.weavingReceipt.aggregate
        .mockResolvedValueOnce({ _sum: { qty: 5 } })
        .mockResolvedValueOnce({ _sum: { qty: 10 } });

      await service.receive('1', { pieceId: '20', weavingPointId: '40', qty: 5 }, 'user-1', null);

      expect(notificationsService.resolve).toHaveBeenCalledWith({
        entityType: 'WEAVING_ALLOCATION',
        entityId: '1:20:40',
        types: ['WEAVING_ISSUE_TO_POINT'],
      });
    });

    it('receive(): KHÔNG resolve() khi mới nhận MỘT PHẦN (outstanding còn > 0)', async () => {
      prisma.weavingReceipt.create.mockResolvedValue(receiptRow);
      prisma.weavingIssue.aggregate.mockResolvedValue({ _sum: { qty: 10 } });
      prisma.weavingReceipt.aggregate
        .mockResolvedValueOnce({ _sum: { qty: 0 } })
        .mockResolvedValueOnce({ _sum: { qty: 5 } });

      await service.receive('1', { pieceId: '20', weavingPointId: '40', qty: 5 }, 'user-1', null);

      expect(notificationsService.resolve).not.toHaveBeenCalled();
    });

    it('receive(): idempotency short-circuit - KHÔNG resolve lại', async () => {
      prisma.weavingReceipt.findUnique.mockResolvedValue(receiptRow);

      await service.receive(
        '1',
        { pieceId: '20', weavingPointId: '40', qty: 5 },
        'user-1',
        null,
        'idem-key-1',
      );

      expect(notificationsService.resolve).not.toHaveBeenCalled();
    });
  });

  describe('getIssuePlan', () => {
    it('loại bỏ mảnh không thuộc công đoạn Đan (isWoven=false trên snapshot BomPiece)', async () => {
      prisma.bomPiece.findMany.mockResolvedValue([{ ...bomPieceRow, isWoven: false, piece }]);

      const result = await service.getIssuePlan('1');
      expect(result).toHaveLength(0);
    });

    it('mảnh có đan nhưng chưa xuất gì vẫn trả về 1 dòng', async () => {
      prisma.bomPiece.findMany.mockResolvedValue([{ ...bomPieceRow, piece }]);

      const result = await service.getIssuePlan('1');
      expect(result).toHaveLength(1);
      expect(result[0].totalQty).toBe(40);
      expect(result[0].issuedQty).toBe(0);
      expect(result[0].remainingToIssue).toBe(40);
      expect(result[0].allocations).toHaveLength(0);
    });

    it('09/11/2026: canIssueQty = min(định mức còn lại, mảnh qua KCS Sơn còn ở kho Sơn) - trừ cả phiếu chờ ký', async () => {
      // Định mức 40; Sơn QC_DONE 15; đã xuất 5 qua phiếu, 3 đang trên phiếu chờ ký -> còn ở kho 15-5-3 = 7.
      prisma.bomPiece.findMany.mockResolvedValue([
        { ...bomPieceRow, needsHan: true, needsSon: true, piece },
      ]);
      prisma.weavingIssue.findMany.mockResolvedValue([
        { productionOrderId: 1n, pieceId: 20n, weavingPointId: 40n, qty: 5, weavingPoint },
      ]);
      prisma.productionBatch.findMany.mockResolvedValue([
        { productionOrderId: 1n, pieceId: 20n, stage: 'SON', reportedQty: 15 },
        { productionOrderId: 1n, pieceId: 20n, stage: 'HAN', reportedQty: 30 },
      ]);
      prisma.issueSlipLine.findMany.mockResolvedValue([
        {
          productionOrderId: 1n,
          pieceId: 20n,
          qty: { toNumber: () => 5 },
          slip: { status: 'ISSUED' },
        },
        {
          productionOrderId: 1n,
          pieceId: 20n,
          qty: { toNumber: () => 3 },
          slip: { status: 'DRAFT' },
        },
      ]);

      const result = await service.getIssuePlan('1');
      expect(result[0].remainingToIssue).toBe(35);
      expect(result[0].onDraftQty).toBe(3);
      expect(result[0].canIssueQty).toBe(7);
      expect(result[0].sourceWarehouseCode).toBe('phoi-son-han-son-pa');
    });

    it('2026-09-12: canIssueQty không âm khi đã xuất vượt số đã nhận (dữ liệu lịch sử/race hiếm)', async () => {
      prisma.bomPiece.findMany.mockResolvedValue([{ ...bomPieceRow, piece }]);
      prisma.weavingIssue.findMany.mockResolvedValue([
        { pieceId: 20n, weavingPointId: 40n, qty: 20, weavingPoint, materials: [] },
      ]);
      prisma.warehouseTransferPieceItem.findMany.mockResolvedValue([
        { pieceId: 20n, quantity: 15 },
      ]);

      const result = await service.getIssuePlan('1');
      expect(result[0].canIssueQty).toBe(0);
    });

    it('allocations group đúng theo từng điểm đan khi có ≥2 điểm', async () => {
      const pointB = { id: 41n, code: 'DIEM-B', fullName: 'Điểm đan B', isActive: true };
      prisma.bomPiece.findMany.mockResolvedValue([{ ...bomPieceRow, piece }]);
      prisma.weavingIssue.findMany.mockResolvedValue([
        { productionOrderId: 1n, pieceId: 20n, weavingPointId: 40n, qty: 15, weavingPoint },
        { productionOrderId: 1n, pieceId: 20n, weavingPointId: 41n, qty: 20, weavingPoint: pointB },
      ]);
      prisma.weavingReceipt.findMany.mockResolvedValue([
        { productionOrderId: 1n, pieceId: 20n, weavingPointId: 40n, qty: 5, weavingPoint },
      ]);

      const result = await service.getIssuePlan('1');
      expect(result).toHaveLength(1);
      expect(result[0].issuedQty).toBe(35);
      expect(result[0].remainingToIssue).toBe(5);
      expect(result[0].allocations).toHaveLength(2);

      const allocA = result[0].allocations.find((a) => a.weavingPointId === '40');
      expect(allocA?.issuedQty).toBe(15);
      expect(allocA?.receivedQty).toBe(5);
      expect(allocA?.remainingToReceive).toBe(10);

      const allocB = result[0].allocations.find((a) => a.weavingPointId === '41');
      expect(allocB?.issuedQty).toBe(20);
      expect(allocB?.receivedQty).toBe(0);
      expect(allocB?.remainingToReceive).toBe(20);
    });

    it('2026-09-11: trả kèm định mức Dây/Đinh của mảnh (wire/nail) đúng nhóm, không lẫn nhóm khác', async () => {
      prisma.bomPiece.findMany.mockResolvedValue([{ ...bomPieceRow, piece }]);
      prisma.materialGroup.findMany.mockResolvedValue([
        { id: 900n, systemKey: 'WIRE' },
        { id: 901n, systemKey: 'NAIL' },
      ]);
      prisma.pieceMaterialItem.findMany.mockResolvedValue([
        {
          bomRevisionId: 5n,
          pieceId: 20n,
          materialId: 60n,
          qtyPerPiece: { toNumber: () => 3 },
          material: {
            code: 'DAY-2LY',
            name: 'Dây 2 ly',
            spec: null,
            unit: 'm',
            materialGroupId: 900n,
          },
        },
        {
          bomRevisionId: 5n,
          pieceId: 20n,
          materialId: 61n,
          qtyPerPiece: { toNumber: () => 4 },
          material: {
            code: 'DINH-01',
            name: 'Đinh 01',
            spec: null,
            unit: 'cái',
            materialGroupId: 901n,
          },
        },
        // Nhóm khác (Tán rút/Nút nhựa) - KHÔNG được lẫn vào wire/nail.
        {
          bomRevisionId: 5n,
          pieceId: 20n,
          materialId: 62n,
          qtyPerPiece: { toNumber: () => 1 },
          material: {
            code: 'TAN-01',
            name: 'Tán rút',
            spec: null,
            unit: 'cái',
            materialGroupId: 902n,
          },
        },
      ]);

      const result = await service.getIssuePlan('1');
      expect(result).toHaveLength(1);
      expect(result[0].wire).toEqual([
        {
          materialId: '60',
          materialCode: 'DAY-2LY',
          materialName: 'Dây 2 ly',
          materialSpec: null,
          materialUnit: 'm',
          qtyPerPiece: 3,
          issuedQty: 0,
          onHandQty: 0,
        },
      ]);
      expect(result[0].nail).toEqual([
        {
          materialId: '61',
          materialCode: 'DINH-01',
          materialName: 'Đinh 01',
          materialSpec: null,
          materialUnit: 'cái',
          qtyPerPiece: 4,
          issuedQty: 0,
          onHandQty: 0,
        },
      ]);
    });

    it('2026-09-11: chỉ trả dòng Nút nhựa (plasticButton) đã tick includeInWeaving=true, bỏ qua dòng chưa tick', async () => {
      prisma.bomPiece.findMany.mockResolvedValue([{ ...bomPieceRow, piece }]);
      prisma.materialGroup.findMany.mockResolvedValue([{ id: 905n, systemKey: 'PLASTIC_BUTTON' }]);
      prisma.pieceMaterialItem.findMany.mockResolvedValue([
        {
          bomRevisionId: 5n,
          pieceId: 20n,
          materialId: 70n,
          qtyPerPiece: { toNumber: () => 8 },
          includeInWeaving: true,
          material: {
            code: 'NUT-01',
            name: 'Nút nhựa đi đan',
            spec: null,
            unit: 'cái',
            materialGroupId: 905n,
          },
        },
        {
          bomRevisionId: 5n,
          pieceId: 20n,
          materialId: 71n,
          qtyPerPiece: { toNumber: () => 2 },
          includeInWeaving: false,
          material: {
            code: 'NUT-02',
            name: 'Nút nhựa không đan',
            spec: null,
            unit: 'cái',
            materialGroupId: 905n,
          },
        },
      ]);

      const result = await service.getIssuePlan('1');
      expect(result[0].plasticButton).toEqual([
        {
          materialId: '70',
          materialCode: 'NUT-01',
          materialName: 'Nút nhựa đi đan',
          materialSpec: null,
          materialUnit: 'cái',
          qtyPerPiece: 8,
          issuedQty: 0,
          onHandQty: 0,
        },
      ]);
    });

    it('mảnh chưa có dòng vật tư Dây/Đinh nào - wire/nail trả mảng rỗng, không throw', async () => {
      prisma.bomPiece.findMany.mockResolvedValue([{ ...bomPieceRow, piece }]);

      const result = await service.getIssuePlan('1');
      expect(result[0].wire).toEqual([]);
      expect(result[0].nail).toEqual([]);
      expect(result[0].plasticButton).toEqual([]);
    });

    it('2026-09-11: issuedQty = Σ WeavingIssueMaterial.qty của MỌI điểm đan cho đúng materialId, onHandQty = StockQuant.qty của đúng kho vật tư', async () => {
      prisma.bomPiece.findMany.mockResolvedValue([{ ...bomPieceRow, piece }]);
      prisma.materialGroup.findMany.mockResolvedValue([{ id: 900n, systemKey: 'WIRE' }]);
      prisma.pieceMaterialItem.findMany.mockResolvedValue([
        {
          bomRevisionId: 5n,
          pieceId: 20n,
          materialId: 60n,
          qtyPerPiece: { toNumber: () => 3 },
          material: {
            code: 'DAY-2LY',
            name: 'Dây 2 ly',
            spec: null,
            unit: 'm',
            materialGroupId: 900n,
            warehouseId: 900n,
          },
        },
      ]);
      prisma.stockQuant.findMany.mockResolvedValue([
        { warehouseId: 900n, materialId: 60n, qty: { toNumber: () => 120 } },
      ]);
      // 2 lần cấp kèm (2 điểm đan khác nhau) cho cùng mảnh - issuedQty phải CỘNG DỒN cả 2; dòng của lệnh khác không tính.
      prisma.weavingIssueMaterial.findMany.mockResolvedValue([
        { productionOrderId: 1n, pieceId: 20n, materialId: 60n, qty: { toNumber: () => 15 } },
        { productionOrderId: 1n, pieceId: 20n, materialId: 60n, qty: { toNumber: () => 9 } },
        { productionOrderId: 2n, pieceId: 20n, materialId: 60n, qty: { toNumber: () => 100 } },
      ]);

      const result = await service.getIssuePlan('1');
      expect(result[0].wire).toEqual([
        expect.objectContaining({ materialId: '60', issuedQty: 24, onHandQty: 120 }),
      ]);
    });
  });

  // Loại dây Sales chọn cho từng lệnh (bom_option): kế hoạch xuất đan chỉ hiện dây đã chọn, và
  // không cho mang kèm dây khác. Đinh/nút nhựa không nằm trong tick nên luôn hiện.
  describe('lọc theo loại dây đã chọn (bom_option)', () => {
    const wireLine = (materialId: bigint, code: string, qty: number) => ({
      bomRevisionId: 5n,
      pieceId: 20n,
      materialId,
      qtyPerPiece: { toNumber: () => qty },
      includeInWeaving: false,
      material: {
        code,
        name: code,
        spec: null,
        unit: 'kg',
        materialGroupId: 900n,
        warehouseId: null,
      },
    });
    const nailLine = {
      bomRevisionId: 5n,
      pieceId: 20n,
      materialId: 70n,
      qtyPerPiece: { toNumber: () => 4 },
      includeInWeaving: false,
      material: {
        code: 'DINH-01',
        name: 'Đinh',
        spec: null,
        unit: 'cái',
        materialGroupId: 901n,
        warehouseId: null,
      },
    };
    const opt = (materialId: bigint) => ({ bomRevisionId: 5n, kind: 'WIRE', materialId });

    beforeEach(() => {
      prisma.bomPiece.findMany.mockResolvedValue([{ ...bomPieceRow, piece }]);
      prisma.materialGroup.findMany.mockResolvedValue([
        { id: 900n, systemKey: 'WIRE' },
        { id: 901n, systemKey: 'NAIL' },
      ]);
      prisma.pieceMaterialItem.findMany.mockResolvedValue([
        wireLine(60n, 'SHT08', 3),
        wireLine(61n, 'SHT29', 5),
        nailLine,
      ]);
      prisma.bomOption.findMany.mockResolvedValue([opt(60n), opt(61n)]);
    });

    it('getIssuePlan: chỉ trả dây lệnh đã chọn, vẫn trả đinh', async () => {
      prisma.productionOrder.findUnique.mockResolvedValue({ ...order, wireMaterialId: 61n });
      prisma.productionOrder.findMany.mockResolvedValue([{ ...order, wireMaterialId: 61n }]);

      const [item] = await service.getIssuePlan('1');

      expect(item.wire.map((w) => w.materialCode)).toEqual(['SHT29']);
      expect(item.wire[0].qtyPerPiece).toBe(5);
      expect(item.nail.map((n) => n.materialCode)).toEqual(['DINH-01']);
    });

    it('getIssuePlan: lệnh chưa chọn dây (đơn cũ) giữ hành vi cũ - hiện mọi dây', async () => {
      prisma.productionOrder.findUnique.mockResolvedValue({ ...order, wireMaterialId: null });

      const [item] = await service.getIssuePlan('1');

      expect(item.wire.map((w) => w.materialCode)).toEqual(['SHT08', 'SHT29']);
    });

    it('getIssuePlanBatch: 2 lệnh CÙNG SKU/revision khác dây nhận đúng dây của riêng mình', async () => {
      const orderA = { ...order, id: 1n, wireMaterialId: 60n, cushionMaterialId: null };
      const orderB = { ...order, id: 2n, wireMaterialId: 61n, cushionMaterialId: null };
      prisma.productionOrder.findMany.mockResolvedValue([orderA, orderB]);

      const result = await service.getIssuePlanBatch(['1', '2']);

      expect(result['1'][0].wire.map((w) => w.materialCode)).toEqual(['SHT08']);
      expect(result['2'][0].wire.map((w) => w.materialCode)).toEqual(['SHT29']);
      expect(result['1'][0].nail).toHaveLength(1);
      expect(result['2'][0].nail).toHaveLength(1);
      // Dùng chung 1 lần nạp tick cho cả batch (cùng revision), không query theo từng lệnh.
      expect(prisma.bomOption.findMany).toHaveBeenCalledTimes(1);
    });

    it('prepareWeavingMaterial: từ chối cấp kèm dây không thuộc loại đã chọn cho lệnh (400)', async () => {
      prisma.productionOrder.findUnique.mockResolvedValue({ ...order, wireMaterialId: 61n });
      prisma.bomPiece.findUnique.mockResolvedValue({
        ...bomPieceRow,
        needsHan: true,
        needsSon: true,
      });

      await expect(
        service.prepareWeavingMaterial('1', '20', '60', 40n, 3, 'vat-tu-tp'),
      ).rejects.toThrow(/không thuộc màu dây\/vải nệm đã chọn/);
    });
  });

  describe('getIssuePlanBatch (2026-08-31 - gộp nhiều order 1 lần cho Bảng thống kê)', () => {
    it('mảng rỗng - trả {} ngay, không query gì', async () => {
      const result = await service.getIssuePlanBatch([]);

      expect(result).toEqual({});
      expect(prisma.productionOrder.findMany).not.toHaveBeenCalled();
    });

    it('mọi id truyền vào đều pre-seed [] kể cả khi order không có mảnh đan nào', async () => {
      prisma.productionOrder.findMany.mockResolvedValue([order]);
      prisma.bomPiece.findMany.mockResolvedValue([]);

      const result = await service.getIssuePlanBatch(['1', '2']);

      expect(result).toEqual({ '1': [], '2': [] });
    });

    it('loại bỏ mảnh không thuộc công đoạn Đan (isWoven=false), khớp hành vi getIssuePlan', async () => {
      prisma.productionOrder.findMany.mockResolvedValue([order]);
      prisma.bomPiece.findMany.mockResolvedValue([{ ...bomPieceRow, isWoven: false, piece }]);

      const result = await service.getIssuePlanBatch(['1']);

      expect(result['1']).toHaveLength(0);
    });

    it('2 order khác nhau CÙNG bomRevisionId - dùng chung 1 query bomPiece nhưng KHÔNG lẫn issue/receipt của nhau', async () => {
      const order2 = { ...order, id: 2n, poNumber: 'PO-32-1', quantity: 5 };
      prisma.productionOrder.findMany.mockResolvedValue([order, order2]);
      prisma.bomPiece.findMany.mockResolvedValue([{ ...bomPieceRow, piece }]);
      prisma.weavingIssue.findMany.mockResolvedValue([
        { productionOrderId: 1n, pieceId: 20n, weavingPointId: 40n, qty: 15, weavingPoint },
        { productionOrderId: 2n, pieceId: 20n, weavingPointId: 40n, qty: 3, weavingPoint },
      ]);
      prisma.weavingReceipt.findMany.mockResolvedValue([]);

      const result = await service.getIssuePlanBatch(['1', '2']);

      expect(result['1']).toHaveLength(1);
      expect(result['1'][0].issuedQty).toBe(15);
      expect(result['1'][0].totalQty).toBe(40); // qtyPerUnit(4) × order.quantity(10)
      expect(result['2']).toHaveLength(1);
      expect(result['2'][0].issuedQty).toBe(3);
      expect(result['2'][0].totalQty).toBe(20); // qtyPerUnit(4) × order2.quantity(5)
      // Cùng bomRevisionId (5n) cho cả 2 order - chỉ query bomPiece.findMany đúng 1 lần cho cả batch.
      expect(prisma.bomPiece.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.bomPiece.findMany).toHaveBeenCalledWith({
        where: { bomRevisionId: { in: [5n] } },
        include: { piece: true },
      });
    });

    it('2026-09-12: canIssueQty tính RIÊNG theo từng (productionOrderId, pieceId) - 2 lệnh sản xuất khác nhau CÙNG dùng chung 1 tên mảnh (pieceId=20) KHÔNG được gộp số đã nhận/đã xuất của nhau', async () => {
      const order2 = { ...order, id: 2n, poNumber: 'PO-32-1', quantity: 5 };
      prisma.productionOrder.findMany.mockResolvedValue([order, order2]);
      prisma.bomPiece.findMany.mockResolvedValue([{ ...bomPieceRow, piece }]);
      prisma.bomPiece.findMany.mockResolvedValue([
        { ...bomPieceRow, needsHan: true, needsSon: true, piece },
      ]);
      // Order 1: qua KCS Sơn 15, đã xuất 5 qua phiếu -> canIssueQty = 10.
      // Order 2: qua KCS Sơn 100, chưa xuất -> canIssueQty = 20 (bị chặn bởi định mức 20) - nếu code
      // lỡ gộp nhầm theo pieceId toàn cục, order 1 sẽ ăn ké số 100 của order 2.
      prisma.weavingIssue.findMany.mockResolvedValue([
        { productionOrderId: 1n, pieceId: 20n, weavingPointId: 40n, qty: 5, weavingPoint },
      ]);
      prisma.weavingReceipt.findMany.mockResolvedValue([]);
      prisma.productionBatch.findMany.mockResolvedValue([
        { productionOrderId: 1n, pieceId: 20n, stage: 'SON', reportedQty: 15 },
        { productionOrderId: 2n, pieceId: 20n, stage: 'SON', reportedQty: 100 },
      ]);
      prisma.issueSlipLine.findMany.mockResolvedValue([
        {
          productionOrderId: 1n,
          pieceId: 20n,
          qty: { toNumber: () => 5 },
          slip: { status: 'ISSUED' },
        },
      ]);

      const result = await service.getIssuePlanBatch(['1', '2']);

      expect(result['1'][0].canIssueQty).toBe(10); // min(40-5=35, 15-5=10)
      expect(result['2'][0].canIssueQty).toBe(20); // min(20-0=20, 100-0=100)
    });

    it('allocations group đúng theo từng điểm đan trong 1 order của batch, khớp getIssuePlan', async () => {
      const pointB = { id: 41n, code: 'DIEM-B', fullName: 'Điểm đan B', isActive: true };
      prisma.productionOrder.findMany.mockResolvedValue([order]);
      prisma.bomPiece.findMany.mockResolvedValue([{ ...bomPieceRow, piece }]);
      prisma.weavingIssue.findMany.mockResolvedValue([
        { productionOrderId: 1n, pieceId: 20n, weavingPointId: 40n, qty: 15, weavingPoint },
        { productionOrderId: 1n, pieceId: 20n, weavingPointId: 41n, qty: 20, weavingPoint: pointB },
      ]);
      prisma.weavingReceipt.findMany.mockResolvedValue([
        { productionOrderId: 1n, pieceId: 20n, weavingPointId: 40n, qty: 5, weavingPoint },
      ]);

      const result = await service.getIssuePlanBatch(['1']);

      expect(result['1'][0].allocations).toHaveLength(2);
      const allocA = result['1'][0].allocations.find((a) => a.weavingPointId === '40');
      expect(allocA?.remainingToReceive).toBe(10);
    });
  });

  describe('findAllGroupedByPoint', () => {
    it('trả về mảng rỗng khi chưa có WeavingIssue/WeavingReceipt nào', async () => {
      const result = await service.findAllGroupedByPoint();
      expect(result).toHaveLength(0);
    });

    it('gộp 1 (PO, mảnh) tại 1 điểm đan - quantity/completed/holding đúng', async () => {
      prisma.weavingIssue.findMany.mockResolvedValue([{ ...issueRow, qty: 15 }]);
      prisma.weavingReceipt.findMany.mockResolvedValue([{ ...receiptRow, qty: 5 }]);

      const result = await service.findAllGroupedByPoint();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('40');
      expect(result[0].code).toBe('DIEM-A');
      expect(result[0].assignments).toHaveLength(1);
      expect(result[0].assignments[0].poNumber).toBe('PO-31'); // ưu tiên salesOrder.orderCode
      expect(result[0].assignments[0].productLabel).toBe('Ghế xoay demo');
      expect(result[0].assignments[0].quantity).toBe(15);
      expect(result[0].assignments[0].completed).toBe(5);
      expect(result[0].assignments[0].holding).toBe(10);
      expect(result[0].totalHolding).toBe(10);
    });

    it('tách riêng 2 điểm đan khác nhau, không lẫn assignment', async () => {
      const pointB = { id: 41n, code: 'DIEM-B', fullName: 'Điểm đan B', phone: null };
      prisma.weavingIssue.findMany.mockResolvedValue([
        { ...issueRow, qty: 15 },
        { ...issueRow, weavingPointId: 41n, weavingPoint: pointB, qty: 8 },
      ]);
      prisma.weavingPoint.findMany.mockResolvedValue([weavingPoint, pointB]);

      const result = await service.findAllGroupedByPoint();
      expect(result).toHaveLength(2);
      const groupA = result.find((g) => g.id === '40')!;
      const groupB = result.find((g) => g.id === '41')!;
      expect(groupA.assignments).toHaveLength(1);
      expect(groupA.totalHolding).toBe(15);
      expect(groupB.assignments).toHaveLength(1);
      expect(groupB.totalHolding).toBe(8);
    });

    it('fallback poNumber về ProductionOrder.poNumber khi không có salesOrder (PO gộp tự tạo)', async () => {
      const orderNoSales = { ...order, productionInvoiceItem: { salesOrder: null } };
      prisma.weavingIssue.findMany.mockResolvedValue([
        { ...issueRow, productionOrder: orderNoSales },
      ]);

      const result = await service.findAllGroupedByPoint();
      expect(result[0].assignments[0].poNumber).toBe('PO-31-1');
    });
  });
});
