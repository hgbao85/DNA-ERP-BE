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
    service = new IssueSlipsService(
      prisma as unknown as PrismaServiceType,
      steel as unknown as SteelIssuesService,
      consumable as unknown as MaterialIssuesService,
      ledger as unknown as StockLedgerService,
      reservations as unknown as StockReservationsService,
      { publishEntityChanged: jest.fn() } as unknown as RealtimeService,
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
});
