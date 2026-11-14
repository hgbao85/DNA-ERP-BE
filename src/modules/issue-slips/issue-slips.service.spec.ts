import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import {
  IssueSlipLineKind,
  IssueSlipStatus,
  MfgStage,
  Prisma,
} from '../../generated/prisma/client';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { MaterialIssuesService } from '../material-issues/material-issues.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { StockReservationsService } from '../stock/stock-reservations.service';
import { SteelIssuesService } from '../steel-issues/steel-issues.service';
import { IssueSlipsService } from './issue-slips.service';

const dec = (n: number) => new Prisma.Decimal(n);

describe('IssueSlipsService - phiếu xuất XK (Đợt 6, bản v8 YC4)', () => {
  let service: IssueSlipsService;
  let prisma: Record<string, Record<string, jest.Mock>> & {
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let steel: {
    prepareIssue: jest.Mock;
    createInTx: jest.Mock;
    afterCreate: jest.Mock;
    assertWarehouseScope: jest.Mock;
  };
  let consumable: { prepareIssue: jest.Mock; createInTx: jest.Mock; afterCreate: jest.Mock };
  let ledger: { postEntry: jest.Mock };
  let reservations: { getAvailableQty: jest.Mock };
  let weaving: Record<string, jest.Mock>;
  let packaging: Record<string, jest.Mock>;
  let yieldIssues: Record<string, jest.Mock>;
  let recipeIssues: Record<string, jest.Mock>;
  let floorAlerts: { requestEvaluate: jest.Mock };

  const steelLine = (o: Record<string, unknown> = {}) => ({
    id: 11n,
    kind: IssueSlipLineKind.STEEL,
    materialId: 33n,
    productionInvoiceId: 500n,
    productionOrderId: null,
    stage: null,
    barLengthMm: 6000,
    qty: dec(10),
    note: null,
    material: { code: 'SAT-001', name: 'Sắt', unit: 'cây' },
    ...o,
  });
  const consLine = (o: Record<string, unknown> = {}) => ({
    id: 12n,
    kind: IssueSlipLineKind.CONSUMABLE,
    materialId: 20n,
    productionInvoiceId: null,
    productionOrderId: 70n,
    stage: MfgStage.SON,
    barLengthMm: null,
    qty: dec(5),
    note: null,
    material: { code: 'SON-01', name: 'Sơn', unit: 'kg' },
    ...o,
  });
  const slip = (o: Record<string, unknown> = {}) => ({
    id: 9n,
    code: 'XK-261106-001',
    status: IssueSlipStatus.DRAFT,
    warehouseId: 6n,
    warehouse: { code: 'phoi-son-han', name: 'Phôi Sơn Hàn' },
    recipientName: null,
    note: null,
    signedSlipUrls: [],
    createdBy: { firstName: 'A', lastName: 'Kho' },
    createdAt: new Date(),
    issuedBy: null,
    issuedAt: null,
    cancelledAt: null,
    cancelReason: null,
    confirmKey: null,
    lines: [consLine(), steelLine()],
    ...o,
  });

  beforeEach(() => {
    prisma = {
      issueSlip: {
        create: jest.fn().mockResolvedValue({ id: 9n }),
        findUnique: jest.fn().mockResolvedValue(slip()),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      issueSlipLine: { update: jest.fn() },
      material: {
        findUnique: jest.fn().mockResolvedValue({
          code: 'X',
          warehouseId: 6n,
          warehouse: { code: 'phoi-son-han' },
          materialGroup: { systemKey: null },
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ code: 'GAS-01' }),
      },
      warehouse: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 99n }),
        findUnique: jest.fn(({ where }: { where: { code: string } }) =>
          Promise.resolve({ id: 11n, code: where.code }),
        ),
      },
      productionOrder: { findMany: jest.fn().mockResolvedValue([]) },
      productionInvoice: { findMany: jest.fn().mockResolvedValue([]) },
      productionInvoiceItem: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([{ lastSeq: 1, status: IssueSlipStatus.DRAFT }]),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    } as never;
    steel = {
      prepareIssue: jest.fn(
        (pi: string, dto: { materialId: string; barLengthMm: number; barCount: number }) =>
          Promise.resolve({
            productionInvoiceId: BigInt(pi),
            materialId: BigInt(dto.materialId),
            barLengthMm: dto.barLengthMm,
            barCount: dto.barCount,
            isPostCutover: true,
            warehouse: { id: 6n, code: 'phoi-son-han' },
          }),
      ),
      createInTx: jest.fn().mockResolvedValue({ id: 301n }),
      afterCreate: jest.fn(),
      assertWarehouseScope: jest.fn(),
    };
    consumable = {
      prepareIssue: jest.fn((orderId: string, dto: { materialId: string }) =>
        Promise.resolve({
          order: { id: BigInt(orderId) },
          materialBigId: BigInt(dto.materialId),
          warehouse: { id: 6n, code: 'phoi-son-han' },
          dto,
        }),
      ),
      createInTx: jest.fn().mockResolvedValue({ id: 401n }),
      afterCreate: jest.fn(),
    };
    ledger = { postEntry: jest.fn() };
    reservations = { getAvailableQty: jest.fn().mockResolvedValue(100) };
    weaving = {
      prepareWeavingPiece: jest.fn(
        (orderId: string, pieceId: string, weavingPointId: bigint, qty: number) =>
          Promise.resolve({
            order: { id: BigInt(orderId), productionInvoiceItemId: 21n },
            pieceId: BigInt(pieceId),
            pieceName: 'Mảnh Đan',
            weavingPointId,
            qty,
            plannedQty: 40,
            finalStage: 'SON',
            warehouse: { id: 8n, code: 'phoi-son-han-son-pa' },
          }),
      ),
      assertPieceCapInTx: jest.fn().mockResolvedValue(undefined),
      createPieceIssueInTx: jest.fn().mockResolvedValue({ id: 500n }),
      afterPieceIssue: jest.fn().mockResolvedValue(undefined),
      prepareWeavingMaterial: jest.fn(
        (
          orderId: string,
          pieceId: string,
          materialId: string,
          weavingPointId: bigint,
          qty: number,
        ) =>
          Promise.resolve({
            order: { id: BigInt(orderId) },
            productionInvoiceId: 500n,
            pieceId: BigInt(pieceId),
            weavingPointId,
            materialId: BigInt(materialId),
            materialCode: 'DAY-2LY',
            warehouseId: 900n,
            qty,
          }),
      ),
      createMaterialIssueInTx: jest.fn().mockResolvedValue({ id: 600n }),
      assertMaterialStockForSlip: jest.fn().mockResolvedValue(undefined),
      getWovenMaterialLinesByPiece: jest.fn().mockResolvedValue(new Map()),
    };
    packaging = {
      prepareIssue: jest.fn((orderId: string, dto: { materialId: string }) =>
        Promise.resolve({
          order: { id: BigInt(orderId) },
          materialBigId: BigInt(dto.materialId),
          sourceWarehouse: { id: 900n, code: 'vat-tu-tp' },
          dto,
        }),
      ),
      createInTx: jest.fn().mockResolvedValue({ id: 701n }),
      assertStockForSlip: jest.fn().mockResolvedValue(undefined),
      afterCreate: jest.fn(),
    };
    yieldIssues = {
      prepareIssue: jest.fn((orderId: string, dto: { materialId: string }) =>
        Promise.resolve({
          order: { id: BigInt(orderId) },
          materialBigId: BigInt(dto.materialId),
          materialName: 'Sắt la',
          warehouse: { id: 6n, code: 'phoi-son-han' },
          dto,
        }),
      ),
      createInTx: jest.fn().mockResolvedValue({ id: 702n }),
      afterCreate: jest.fn(),
    };
    recipeIssues = {
      prepareIssue: jest.fn((piId: string, dto: { recipeId: string; issuedQty: number }) =>
        Promise.resolve({
          piId: BigInt(piId),
          recipeBigId: BigInt(dto.recipeId),
          inputMaterial: { id: 44n, name: 'Thanh nhôm' },
          warehouse: { id: 6n, code: 'phoi-son-han' },
          issuedQty: dto.issuedQty,
        }),
      ),
      createInTx: jest.fn().mockResolvedValue({ id: 703n }),
      afterCreate: jest.fn(),
    };
    floorAlerts = { requestEvaluate: jest.fn() };
    service = new IssueSlipsService(
      prisma as unknown as PrismaServiceType,
      steel as unknown as SteelIssuesService,
      consumable as unknown as MaterialIssuesService,
      ledger as unknown as StockLedgerService,
      reservations as unknown as StockReservationsService,
      { publishEntityChanged: jest.fn() } as unknown as RealtimeService,
      weaving as never,
      { emit: jest.fn(), resolve: jest.fn() } as never,
      packaging as never,
      yieldIssues as never,
      recipeIssues as never,
      floorAlerts as never,
    );
  });

  describe('create (bước 1: cấp số, chưa trừ tồn)', () => {
    const dto = {
      lines: [
        {
          kind: IssueSlipLineKind.STEEL,
          materialId: '33',
          productionInvoiceId: '500',
          barLengthMm: 6000,
          qty: 10,
        },
        {
          kind: IssueSlipLineKind.CONSUMABLE,
          materialId: '20',
          productionOrderId: '70',
          stage: MfgStage.SON,
          qty: 5,
        },
      ],
      recipientName: ' Tổ Sơn ',
    };

    it('kiểm từng dòng bằng lõi cũ, cấp số XK theo ngày, ghi dòng - KHÔNG gọi phần trừ tồn', async () => {
      await service.create(dto, 'kho-1', 'phoi-son-han');
      expect(steel.prepareIssue).toHaveBeenCalledWith('500', {
        materialId: '33',
        barLengthMm: 6000,
        barCount: 10,
      });
      expect(consumable.prepareIssue).toHaveBeenCalledWith(
        '70',
        { stage: MfgStage.SON, materialId: '20', issuedQty: 5 },
        'phoi-son-han',
      );
      const data = (prisma.issueSlip.create.mock.calls[0] as [{ data: Record<string, unknown> }])[0]
        .data;
      expect(data.code).toMatch(/^XK-\d{6}-001$/);
      expect(data.recipientName).toBe('Tổ Sơn');
      expect(data.warehouseId).toBe(6n);
      expect((data.lines as { create: unknown[] }).create).toEqual([
        expect.objectContaining({
          kind: 'STEEL',
          productionInvoiceId: 500n,
          barLengthMm: 6000,
          qty: 10,
          stage: null,
        }),
        expect.objectContaining({
          kind: 'CONSUMABLE',
          productionOrderId: 70n,
          stage: 'SON',
          barLengthMm: null,
          qty: 5,
        }),
      ]);
      expect(steel.createInTx).not.toHaveBeenCalled();
      expect(consumable.createInTx).not.toHaveBeenCalled();
    });

    it('mỗi phiếu chỉ 1 kho: dòng ở 2 kho khác nhau -> 400', async () => {
      consumable.prepareIssue.mockResolvedValueOnce({
        order: { id: 70n },
        materialBigId: 20n,
        warehouse: { id: 7n, code: 'vat-tu-tp' },
        dto: {},
      });
      await expect(service.create(dto, 'kho-1', null)).rejects.toThrow('chỉ cho một kho');
      expect(prisma.issueSlip.create).not.toHaveBeenCalled();
    });

    it('sắt: số cây phải nguyên, thủ kho ngoài họ phoi-son-han không xuất được', async () => {
      await expect(
        service.create({ lines: [{ ...dto.lines[0], qty: 2.5 }] }, 'kho-1', null),
      ).rejects.toThrow(BadRequestException);
      await expect(service.create({ lines: [dto.lines[0]] }, 'kho-1', 'vat-tu-tp')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('Đợt 7: thủ kho Hàn xuất "Dùng chung" vật tư kho mặc định kho Phôi (đá cắt đã chuyển sang) từ CHÍNH kho Hàn', async () => {
      await service.create(
        { lines: [{ kind: IssueSlipLineKind.SHARED, materialId: '50', qty: 2 }] },
        'kho-han',
        'phoi-son-han-han-pa',
      );
      expect(
        (prisma.issueSlip.create.mock.calls[0] as [{ data: { warehouseId: bigint } }])[0].data
          .warehouseId,
      ).toBe(11n);
    });

    it('dòng "Dùng chung": không cần lệnh; sắt không được xuất dùng chung; kho khác phạm vi -> 403', async () => {
      await service.create(
        { lines: [{ kind: IssueSlipLineKind.SHARED, materialId: '50', qty: 2 }] },
        'kho-1',
        null,
      );
      expect(
        (prisma.issueSlip.create.mock.calls[0] as [{ data: { lines: { create: unknown[] } } }])[0]
          .data.lines.create,
      ).toEqual([
        expect.objectContaining({
          kind: 'SHARED',
          productionInvoiceId: null,
          productionOrderId: null,
        }),
      ]);
      prisma.material.findUnique.mockResolvedValueOnce({
        code: 'SAT-001',
        warehouseId: 6n,
        warehouse: { code: 'phoi-son-han' },
        materialGroup: { systemKey: 'STEEL_BAR' },
      });
      await expect(
        service.create(
          { lines: [{ kind: IssueSlipLineKind.SHARED, materialId: '33', qty: 2 }] },
          'kho-1',
          null,
        ),
      ).rejects.toThrow('không xuất dùng chung');
      await expect(
        service.create(
          { lines: [{ kind: IssueSlipLineKind.SHARED, materialId: '50', qty: 2 }] },
          'kho-1',
          'vat-tu-tp',
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('confirm (bước 2: ảnh phiếu ký -> trừ tồn mọi dòng)', () => {
    it('ghi mọi dòng trong 1 transaction theo thứ tự vật tư, gắn issue vào dòng, phiếu ISSUED kèm ảnh; báo sau commit', async () => {
      const order: string[] = [];
      steel.createInTx.mockImplementation(() => {
        order.push('steel');
        return Promise.resolve({ id: 301n });
      });
      consumable.createInTx.mockImplementation(() => {
        order.push('cons');
        return Promise.resolve({ id: 401n });
      });
      await service.confirm('9', [' https://cdn/ky.jpg '], 'kho-1', null, 'key-1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // Vật tư 20 (sơn) trước vật tư 33 (sắt) - khoá theo thứ tự materialId.
      expect(order).toEqual(['cons', 'steel']);
      expect(steel.createInTx).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ productionInvoiceId: 500n, barCount: 10 }),
        'kho-1',
        'issue-slip:9:line:11',
      );
      expect(prisma.issueSlipLine.update).toHaveBeenCalledWith({
        where: { id: 11n },
        data: { steelIssueId: 301n },
      });
      expect(prisma.issueSlipLine.update).toHaveBeenCalledWith({
        where: { id: 12n },
        data: { materialIssueId: 401n },
      });
      expect(prisma.issueSlip.update).toHaveBeenCalledWith({
        where: { id: 9n },
        data: expect.objectContaining({
          status: IssueSlipStatus.ISSUED,
          signedSlipUrls: ['https://cdn/ky.jpg'],
          issuedById: 'kho-1',
          confirmKey: 'key-1',
        }) as unknown,
      });
      expect(steel.afterCreate).toHaveBeenCalledWith({ id: 301n }, 'kho-1');
      expect(consumable.afterCreate).toHaveBeenCalledWith({ id: 401n }, 'kho-1');
    });

    describe('quét nhắc việc sớm sau khi xuất sắt', () => {
      it('phiếu có dòng sắt: gọi requestEvaluate({ urgent: true }) sau khi commit', async () => {
        await service.confirm('9', ['u'], 'kho-1', null, 'k-steel');
        expect(floorAlerts.requestEvaluate).toHaveBeenCalledTimes(1);
        expect(floorAlerts.requestEvaluate).toHaveBeenCalledWith({ urgent: true });
        // Gọi sau commit: transaction đã chạy xong trước đó.
        expect(prisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
          floorAlerts.requestEvaluate.mock.invocationCallOrder[0],
        );
      });

      it('phiếu không có dòng sắt: không gọi', async () => {
        prisma.issueSlip.findUnique.mockResolvedValue(slip({ lines: [consLine()] }));
        await service.confirm('9', ['u'], 'kho-1', null, 'k-cons');
        expect(floorAlerts.requestEvaluate).not.toHaveBeenCalled();
      });

      it('phiếu bị từ chối (lỗi trước khi commit): không gọi', async () => {
        prisma.$queryRaw.mockResolvedValueOnce([{ status: IssueSlipStatus.CANCELLED }]);
        await expect(service.confirm('9', ['u'], 'kho-1', null, 'k')).rejects.toThrow(
          ConflictException,
        );
        expect(floorAlerts.requestEvaluate).not.toHaveBeenCalled();
      });

      it('requestEvaluate ném lỗi: xác nhận phiếu vẫn trả kết quả', async () => {
        floorAlerts.requestEvaluate.mockImplementation(() => {
          throw new Error('boom');
        });
        await expect(service.confirm('9', ['u'], 'kho-1', null, 'k-throw')).resolves.toBeDefined();
        expect(steel.afterCreate).toHaveBeenCalled();
      });
    });

    it('không có ảnh phiếu ký -> 400, không ghi gì (khoá cứng)', async () => {
      await expect(service.confirm('9', ['  '], 'kho-1', null, 'k')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('phiếu vừa bị xuất/huỷ ở nơi khác (khoá lại thấy không còn DRAFT) -> 409; phiếu đã huỷ -> 409', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ status: IssueSlipStatus.CANCELLED }]);
      await expect(service.confirm('9', ['u'], 'kho-1', null, 'k')).rejects.toThrow(
        ConflictException,
      );
      expect(steel.createInTx).not.toHaveBeenCalled();

      prisma.issueSlip.findUnique.mockResolvedValue(slip({ status: IssueSlipStatus.CANCELLED }));
      await expect(service.confirm('9', ['u'], 'kho-1', null, 'k')).rejects.toThrow('đã huỷ');
    });

    it('gửi lại cùng Idempotency-Key sau khi đã xuất: trả phiếu, không xuất lần 2', async () => {
      prisma.issueSlip.findUnique.mockResolvedValue(
        slip({ status: IssueSlipStatus.ISSUED, confirmKey: 'key-1' }),
      );
      const res = await service.confirm('9', ['u'], 'kho-1', null, 'key-1');
      expect(res.status).toBe(IssueSlipStatus.ISSUED);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('dòng "Dùng chung": chỉ lấy từ tồn chưa giữ (trừ MỌI giữ chỗ), đủ thì ghi sổ ISSUE_SLIP_SHARED', async () => {
      const shared = {
        id: 13n,
        kind: IssueSlipLineKind.SHARED,
        materialId: 50n,
        productionInvoiceId: null,
        productionOrderId: null,
        stage: null,
        barLengthMm: null,
        qty: dec(3),
        note: null,
        material: { code: 'GAS-01', name: 'Khí', unit: 'bình' },
      };
      prisma.issueSlip.findUnique.mockResolvedValue(slip({ lines: [shared] }));
      prisma.$queryRaw
        .mockResolvedValueOnce([{ status: IssueSlipStatus.DRAFT }])
        .mockResolvedValueOnce([{ qty: dec(10) }]);
      reservations.getAvailableQty.mockResolvedValueOnce(2);
      await expect(service.confirm('9', ['u'], 'kho-1', null, 'k')).rejects.toThrow('tồn chưa giữ');
      expect(reservations.getAvailableQty).toHaveBeenCalledWith(prisma, 6n, 50n, 10);
      expect(ledger.postEntry).not.toHaveBeenCalled();

      prisma.$queryRaw
        .mockResolvedValueOnce([{ status: IssueSlipStatus.DRAFT }])
        .mockResolvedValueOnce([{ qty: dec(10) }]);
      reservations.getAvailableQty.mockResolvedValueOnce(5);
      await service.confirm('9', ['u'], 'kho-1', null, 'k2');
      expect(ledger.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          fromWarehouseId: 6n,
          toWarehouseId: 99n,
          materialId: 50n,
          qty: 3,
          refType: 'ISSUE_SLIP_SHARED',
          refId: '13',
        }),
        prisma,
      );
    });
  });

  describe('cancel', () => {
    it('huỷ phiếu chưa xuất kèm lý do; phiếu đã xuất thì không huỷ được', async () => {
      await service.cancel('9', ' In sai ', 'kho-1', null);
      expect(prisma.issueSlip.updateMany).toHaveBeenCalledWith({
        where: { id: 9n, status: IssueSlipStatus.DRAFT },
        data: expect.objectContaining({
          status: IssueSlipStatus.CANCELLED,
          cancelReason: 'In sai',
        }) as unknown,
      });
      prisma.issueSlip.findUnique.mockResolvedValue(slip({ status: IssueSlipStatus.ISSUED }));
      await expect(service.cancel('9', 'x y z', 'kho-1', null)).rejects.toThrow('đã xuất');
    });
  });

  // Xuất đan 2 phiếu - phiếu mảnh (kho Sơn) + phiếu vật tư kèm (kho Phụ kiện) cùng điểm đan.
  describe('phiếu xuất đan', () => {
    const pieceLine = (o: Record<string, unknown> = {}) => ({
      id: 21n,
      kind: IssueSlipLineKind.WEAVING_PIECE,
      materialId: null,
      pieceId: 20n,
      productionInvoiceId: null,
      productionOrderId: 70n,
      stage: null,
      barLengthMm: null,
      qty: dec(10),
      note: null,
      material: null,
      piece: { code: 'M-DAN', name: 'Mảnh Đan' },
      ...o,
    });
    const materialLine = (o: Record<string, unknown> = {}) => ({
      ...pieceLine(),
      id: 22n,
      kind: IssueSlipLineKind.WEAVING_MATERIAL,
      materialId: 60n,
      qty: dec(15),
      material: { code: 'DAY-2LY', name: 'Dây 2 ly', unit: 'kg' },
      ...o,
    });
    const pieceSlip = (o: Record<string, unknown> = {}) =>
      slip({
        warehouseId: 8n,
        warehouse: { code: 'phoi-son-han-son-pa', name: 'Kho Sơn Phú An' },
        weavingPointId: 40n,
        weavingPoint: { code: 'DIEM-A', fullName: 'Điểm đan A' },
        pairedSlipId: null,
        pairedSlip: null,
        createdById: 'u-son',
        lines: [pieceLine()],
        pairedBy: [],
        ...o,
      });

    beforeEach(() => {
      prisma.weavingPoint = {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 40n, code: 'DIEM-A', fullName: 'Điểm đan A' }),
      };
      prisma.issueSlip.findUnique.mockResolvedValue(pieceSlip());
    });

    it('phiếu mảnh: cần điểm đan; kiểm trần trong transaction cấp số; người nhận = điểm đan; báo kho vật tư kèm', async () => {
      await expect(
        service.create(
          {
            lines: [
              {
                kind: IssueSlipLineKind.WEAVING_PIECE,
                productionOrderId: '70',
                pieceId: '20',
                qty: 10,
              },
            ],
          },
          'u-son',
          'phoi-son-han-son-pa',
        ),
      ).rejects.toThrow('cần chọn điểm đan');

      weaving.getWovenMaterialLinesByPiece.mockResolvedValue(new Map());
      await service.create(
        {
          weavingPointId: '40',
          lines: [
            {
              kind: IssueSlipLineKind.WEAVING_PIECE,
              productionOrderId: '70',
              pieceId: '20',
              qty: 10,
            },
          ],
        },
        'u-son',
        'phoi-son-han-son-pa',
      );
      expect(weaving.prepareWeavingPiece).toHaveBeenCalledWith(
        '70',
        '20',
        40n,
        10,
        'phoi-son-han-son-pa',
      );
      expect(weaving.assertPieceCapInTx).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ qty: 10 }),
        null,
      );
      const data = (
        prisma.issueSlip.create.mock.calls[0] as [{ data: { lines: { create: unknown[] } } }]
      )[0].data;
      expect(data).toEqual(
        expect.objectContaining({
          warehouseId: 8n,
          weavingPointId: 40n,
          pairedSlipId: null,
          recipientName: 'Điểm đan A',
        }),
      );
      expect(data.lines.create).toEqual([
        expect.objectContaining({
          kind: 'WEAVING_PIECE',
          materialId: null,
          pieceId: 20n,
          productionOrderId: 70n,
        }),
      ]);
      expect(weaving.createPieceIssueInTx).not.toHaveBeenCalled();
    });

    it('không trộn dòng xuất đan với sắt/tiêu hao; vật tư kèm cần phiếu mảnh cùng chuyến và đúng mảnh trên phiếu đó', async () => {
      await expect(
        service.create(
          {
            weavingPointId: '40',
            lines: [
              {
                kind: IssueSlipLineKind.WEAVING_PIECE,
                productionOrderId: '70',
                pieceId: '20',
                qty: 10,
              },
              { kind: IssueSlipLineKind.SHARED, materialId: '5', qty: 1 },
            ],
          },
          'u',
          null,
        ),
      ).rejects.toThrow('không trộn');
      await expect(
        service.create(
          {
            lines: [
              {
                kind: IssueSlipLineKind.WEAVING_MATERIAL,
                materialId: '60',
                productionOrderId: '70',
                pieceId: '20',
                qty: 15,
              },
            ],
          },
          'u',
          'vat-tu-tp',
        ),
      ).rejects.toThrow('phiếu mảnh đi cùng chuyến');
      await expect(
        service.create(
          {
            pairedSlipId: '9',
            lines: [
              {
                kind: IssueSlipLineKind.WEAVING_MATERIAL,
                materialId: '60',
                productionOrderId: '70',
                pieceId: '99',
                qty: 15,
              },
            ],
          },
          'u',
          'vat-tu-tp',
        ),
      ).rejects.toThrow('theo đúng mảnh');
      prisma.issueSlip.findUnique.mockResolvedValue(
        pieceSlip({ status: IssueSlipStatus.CANCELLED }),
      );
      await expect(
        service.create(
          {
            pairedSlipId: '9',
            lines: [
              {
                kind: IssueSlipLineKind.WEAVING_MATERIAL,
                materialId: '60',
                productionOrderId: '70',
                pieceId: '20',
                qty: 15,
              },
            ],
          },
          'u',
          'vat-tu-tp',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('phiếu vật tư kèm: lấy điểm đan của phiếu mảnh, ghi pairedSlipId', async () => {
      weaving.getWovenMaterialLinesByPiece.mockResolvedValue(new Map());
      await service.create(
        {
          pairedSlipId: '9',
          lines: [
            {
              kind: IssueSlipLineKind.WEAVING_MATERIAL,
              materialId: '60',
              productionOrderId: '70',
              pieceId: '20',
              qty: 15,
            },
          ],
        },
        'u-pk',
        'vat-tu-tp',
      );
      expect(weaving.prepareWeavingMaterial).toHaveBeenCalledWith(
        '70',
        '20',
        '60',
        40n,
        15,
        'vat-tu-tp',
      );
      expect((prisma.issueSlip.create.mock.calls[0] as [{ data: unknown }])[0].data).toEqual(
        expect.objectContaining({ warehouseId: 900n, weavingPointId: 40n, pairedSlipId: 9n }),
      );
    });

    it('xác nhận phiếu mảnh: kiểm lại trần (không đếm chính phiếu này), ghi WeavingIssue, gắn vào dòng; báo sau commit', async () => {
      await service.confirm('9', ['u1'], 'u-son', 'phoi-son-han-son-pa', 'key-1');
      expect(weaving.assertPieceCapInTx).toHaveBeenCalledWith(prisma, expect.anything(), 9n);
      expect(weaving.createPieceIssueInTx).toHaveBeenCalledWith(
        prisma,
        expect.anything(),
        'u-son',
        'issue-slip:9:line:21',
      );
      expect(prisma.issueSlipLine.update).toHaveBeenCalledWith({
        where: { id: 21n },
        data: { weavingIssueId: 500n },
      });
      expect(weaving.afterPieceIssue).toHaveBeenCalledWith({ id: 500n }, 'u-son');
    });

    it('xác nhận phiếu vật tư kèm: ghi WeavingIssueMaterial qua lõi xuất đan; phiếu mảnh đã huỷ thì chặn', async () => {
      prisma.issueSlip.findUnique.mockResolvedValue(
        pieceSlip({
          warehouseId: 900n,
          warehouse: { code: 'vat-tu-tp', name: 'Kho Phụ kiện' },
          pairedSlipId: 5n,
          pairedSlip: { id: 5n, code: 'XK-261109-001', status: IssueSlipStatus.ISSUED },
          lines: [materialLine()],
        }),
      );
      await service.confirm('9', ['u1'], 'u-pk', 'vat-tu-tp', 'key-2');
      expect(weaving.createMaterialIssueInTx).toHaveBeenCalledWith(
        prisma,
        expect.anything(),
        'u-pk',
        'issue-slip:9:line:22',
      );
      expect(prisma.issueSlipLine.update).toHaveBeenCalledWith({
        where: { id: 22n },
        data: { weavingIssueMaterialId: 600n },
      });

      prisma.issueSlip.findUnique.mockResolvedValue(
        pieceSlip({
          pairedSlipId: 5n,
          pairedSlip: { id: 5n, code: 'XK-261109-001', status: IssueSlipStatus.CANCELLED },
          lines: [materialLine()],
        }),
      );
      await expect(service.confirm('9', ['u1'], 'u-pk', 'vat-tu-tp', 'key-3')).rejects.toThrow(
        'đã huỷ',
      );
    });

    it('vật tư cần cấp kèm = định mức/mảnh × số mảnh − đã trên phiếu vật tư cùng chuyến; chỉ vật tư kho mình', async () => {
      prisma.issueSlip.findMany.mockResolvedValue([
        pieceSlip({
          status: IssueSlipStatus.DRAFT,
          pairedBy: [
            {
              code: 'XK-261109-002',
              status: IssueSlipStatus.DRAFT,
              lines: [{ productionOrderId: 70n, pieceId: 20n, materialId: 60n, qty: dec(5) }],
            },
          ],
        }),
      ]);
      prisma.productionOrder.findMany.mockResolvedValue([
        {
          id: 70n,
          bomRevisionId: 3n,
          wireMaterialId: null,
          cushionMaterialId: null,
          poNumber: 'PO-1',
          mfgProduct: { factoryCode: 'GP-1' },
          productionInvoiceItem: {
            lsxCode: 'MY-313',
            productionInvoiceId: 500n,
            productionInvoice: { code: 'PI-1' },
          },
        },
      ]);
      prisma.bomOption = { findMany: jest.fn().mockResolvedValue([]) };
      const line = (materialId: string, code: string, qtyPerPiece: number) => ({
        materialId,
        materialCode: code,
        materialName: code,
        materialSpec: null,
        materialUnit: 'kg',
        qtyPerPiece,
        issuedQty: 0,
        onHandQty: 100,
      });
      weaving.getWovenMaterialLinesByPiece.mockResolvedValue(
        new Map([
          [
            '3:20',
            {
              wire: [line('60', 'DAY', 1.5)],
              nail: [line('61', 'DINH', 4)],
              plasticButton: [],
              finishedComponent: [],
            },
          ],
        ]),
      );
      prisma.material.findMany = jest.fn().mockResolvedValue([
        { id: 60n, warehouse: { code: 'vat-tu-tp' } },
        { id: 61n, warehouse: { code: 'kho-khac' } },
      ]);

      const [d] = await service.getWeavingMaterialDemand('vat-tu-tp');
      expect(d.slipCode).toBe('XK-261106-001');
      expect(d.weavingPointName).toBe('Điểm đan A');
      expect(d.lines).toEqual([
        expect.objectContaining({
          materialCode: 'DAY',
          pieceQty: 10,
          demandQty: 15,
          coveredQty: 5,
          remainingQty: 10,
          lenhCode: 'MY-313',
          sku: 'GP-1',
        }),
      ]);
    });
  });

  // Xuất đóng gói và xuất vật tư TP cho Phôi cũng đi phiếu XK có ảnh ký (route xuất thẳng đã gỡ).
  describe('dòng đóng gói / vật tư TP', () => {
    it('tạo phiếu: kiểm từng dòng bằng lõi của từng luồng, ghi recipeId + vật tư đầu vào cho dòng công thức', async () => {
      await service.create(
        {
          lines: [
            {
              kind: IssueSlipLineKind.MATERIAL_YIELD,
              materialId: '33',
              productionOrderId: '70',
              qty: 4,
            },
            {
              kind: IssueSlipLineKind.MATERIAL_YIELD_RECIPE,
              productionInvoiceId: '500',
              recipeId: '9',
              qty: 2,
            },
          ],
        },
        'u',
        'phoi-son-han',
      );
      expect(yieldIssues.prepareIssue).toHaveBeenCalledWith(
        '70',
        { materialId: '33', issuedQty: 4 },
        'phoi-son-han',
      );
      expect(recipeIssues.prepareIssue).toHaveBeenCalledWith(
        '500',
        { recipeId: '9', issuedQty: 2 },
        'phoi-son-han',
      );
      const data = (
        prisma.issueSlip.create.mock.calls[0] as [{ data: { lines: { create: unknown[] } } }]
      )[0].data;
      expect(data.lines.create).toEqual([
        expect.objectContaining({
          kind: 'MATERIAL_YIELD',
          materialId: 33n,
          productionOrderId: 70n,
        }),
        expect.objectContaining({
          kind: 'MATERIAL_YIELD_RECIPE',
          materialId: 44n,
          recipeId: 9n,
          productionInvoiceId: 500n,
        }),
      ]);
    });

    it('lập phiếu đóng gói: kiểm tồn khả dụng ngay lúc lập; thiếu tồn thì không cấp số, không tạo phiếu (RPK.2)', async () => {
      const dto = {
        lines: [
          { kind: IssueSlipLineKind.PACKAGING, materialId: '20', productionOrderId: '70', qty: 8 },
        ],
      };
      await service.create(dto, 'u', 'thanh-pham');
      expect(packaging.assertStockForSlip).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ dto: expect.objectContaining({ issuedQty: 8 }) as unknown }),
      );

      prisma.issueSlip.create.mockClear();
      packaging.assertStockForSlip.mockRejectedValueOnce(new ConflictException('thiếu tồn'));
      await expect(service.create(dto, 'u', 'thanh-pham')).rejects.toThrow(ConflictException);
      expect(prisma.issueSlip.create).not.toHaveBeenCalled();
    });

    it('xác nhận: ghi trong transaction qua createInTx, gắn id lần xuất vào dòng, báo sau commit', async () => {
      prisma.issueSlip.findUnique.mockResolvedValue(
        slip({
          warehouseId: 900n,
          warehouse: { code: 'vat-tu-tp', name: 'Kho Phụ kiện' },
          lines: [
            consLine({
              id: 31n,
              kind: IssueSlipLineKind.PACKAGING,
              materialId: 20n,
              productionOrderId: 70n,
              stage: null,
            }),
          ],
        }),
      );
      await service.confirm('9', ['u1'], 'u-pk', 'vat-tu-tp', 'k-p');
      expect(packaging.prepareIssue).toHaveBeenCalledWith(
        '70',
        expect.objectContaining({ materialId: '20', issuedQty: 5 }),
        'vat-tu-tp',
      );
      expect(packaging.createInTx).toHaveBeenCalledWith(
        prisma,
        expect.anything(),
        'u-pk',
        'issue-slip:9:line:31',
      );
      expect(prisma.issueSlipLine.update).toHaveBeenCalledWith({
        where: { id: 31n },
        data: { packagingIssueId: 701n },
      });
      expect(packaging.afterCreate).toHaveBeenCalledWith({ id: 701n }, 'u-pk');
    });

    it('xác nhận dòng công thức: kiểm lại theo lệnh + công thức', async () => {
      prisma.issueSlip.findUnique.mockResolvedValue(
        slip({
          lines: [
            steelLine({
              id: 32n,
              kind: IssueSlipLineKind.MATERIAL_YIELD_RECIPE,
              materialId: 44n,
              recipeId: 9n,
              barLengthMm: null,
              qty: dec(2),
            }),
          ],
        }),
      );
      await service.confirm('9', ['u1'], 'u', 'phoi-son-han', 'k-r');
      expect(recipeIssues.prepareIssue).toHaveBeenCalledWith(
        '500',
        { recipeId: '9', issuedQty: 2 },
        'phoi-son-han',
      );
      expect(prisma.issueSlipLine.update).toHaveBeenCalledWith({
        where: { id: 32n },
        data: { materialYieldRecipeIssueId: 703n },
      });
      expect(recipeIssues.afterCreate).toHaveBeenCalled();
    });
  });
});
