import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma, PurchaseProposalStatus } from '../../generated/prisma/client';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PurchaseProposalsService, ReceiveLine } from './purchase-proposals.service';
import { PurchaseReceiptsService } from './purchase-receipts.service';

const dec = (n: number) => new Prisma.Decimal(n);
const day = (s: string) => new Date(`${s}T00:00:00+07:00`);

function line(o: {
  itemId: bigint;
  proposalId?: bigint;
  buyQty: number;
  receivedQty?: number;
  deadline?: Date | null;
  status?: PurchaseProposalStatus;
  warehouseCode?: string;
  materialId?: bigint;
  supplierOrderId?: bigint | null;
  orderApprovalFile?: string | null;
  groupKey?: string;
}): ReceiveLine {
  const supplierOrderId = o.supplierOrderId === undefined ? 50n : o.supplierOrderId;
  return {
    proposal: { id: o.proposalId ?? o.itemId * 10n } as never,
    item: {
      id: o.itemId,
      materialId: o.materialId ?? 30n,
      spec: null,
      stockLengthMm: null,
      supplierOrderId,
      supplierOrder:
        supplierOrderId == null
          ? null
          : {
              approvalFileUrl:
                o.orderApprovalFile === undefined ? 'https://cdn/ky.pdf' : o.orderApprovalFile,
              seq: 52,
              year: 2026,
              supplier: { name: 'Kim Phát' },
            },
      status: o.status ?? PurchaseProposalStatus.PURCHASING,
      buyQty: dec(o.buyQty),
      orderQty: null,
      receivedQty: dec(o.receivedQty ?? 0),
      approvalFileUrl: null,
      material: {
        code: 'SAT-25',
        unit: 'cây',
        buyerId: 'buyer-1',
        materialGroup: { systemKey: o.groupKey ?? 'STEEL_BAR' },
      },
    } as never,
    deadline: o.deadline ?? null,
    approvedAt: null,
    lenhCode: `MY-${o.itemId}`,
    warehouseId: 800n,
    warehouseCode: o.warehouseCode ?? 'kho-phoi',
  };
}

const docs = {
  slipCode: 'NK-261106-001',
  supplierSlipUrls: ['https://cdn/giao.jpg'],
  receiptSlipUrls: ['https://cdn/nhap.jpg'],
  weighSlipUrls: ['https://cdn/can.jpg'],
};

describe('PurchaseReceiptsService', () => {
  let service: PurchaseReceiptsService;
  let prisma: {
    purchaseReceipt: { findUnique: jest.Mock; create: jest.Mock };
    reservedSlipCode: { updateMany: jest.Mock; findUnique: jest.Mock; create: jest.Mock };
    purchaseProposalItem: { findMany: jest.Mock };
    warehouse: { findUniqueOrThrow: jest.Mock };
    $executeRaw: jest.Mock;
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let proposals: {
    loadReceiveLines: jest.Mock;
    applyItemReceipt: jest.Mock;
    afterItemReceipt: jest.Mock;
  };
  let notifications: { emit: jest.Mock };

  // 3 lệnh của đơn gộp sắt 25x25 - ví dụ YC8 trong bản v8.
  const group = () => [
    line({ itemId: 3n, buyQty: 100, deadline: day('2026-11-08') }),
    line({ itemId: 1n, buyQty: 120, deadline: day('2026-11-03') }),
    line({ itemId: 2n, buyQty: 80, deadline: day('2026-11-05') }),
  ];

  beforeEach(() => {
    prisma = {
      purchaseReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 900n }),
      },
      purchaseProposalItem: { findMany: jest.fn() },
      reservedSlipCode: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ lastSeq: 4 }]),
      warehouse: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 700n }) },
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    proposals = {
      loadReceiveLines: jest.fn(),
      applyItemReceipt: jest.fn((_tx: unknown, input: { line: ReceiveLine }) =>
        Promise.resolve({ id: input.line.item.id }),
      ),
      afterItemReceipt: jest.fn().mockResolvedValue(undefined),
    };
    notifications = { emit: jest.fn().mockResolvedValue(undefined) };
    service = new PurchaseReceiptsService(
      prisma as unknown as PrismaServiceType,
      proposals as unknown as PurchaseProposalsService,
      notifications as unknown as NotificationsService,
    );
  });

  const appliedCalls = () =>
    proposals.applyItemReceipt.mock.calls as [unknown, { line: ReceiveLine; qty: number }][];
  const appliedQty = () => appliedCalls().map(([, a]) => [String(a.line.item.id), a.qty]);

  const freshFrom = (lines: ReceiveLine[]) =>
    prisma.purchaseProposalItem.findMany.mockResolvedValue(
      lines.map((l) => ({
        id: l.item.id,
        receivedQty: l.item.receivedQty,
        status: l.item.status,
      })),
    );

  describe('preview', () => {
    it('chia theo ngày cần sớm nhất - 150 cây: 120 / 30 / 0', async () => {
      proposals.loadReceiveLines.mockResolvedValue(group());
      const res = await service.preview({ itemIds: ['3', '1', '2'], qty: 150 }, null);
      expect(res.map((r) => [r.itemId, r.lenhCode, r.qty])).toEqual([
        ['1', 'MY-1', 120],
        ['2', 'MY-2', 30],
        ['3', 'MY-3', 0],
      ]);
    });

    it('chặn gộp các dòng khác vật tư / khác kho / khác đơn đặt hàng', async () => {
      proposals.loadReceiveLines.mockResolvedValue([
        line({ itemId: 1n, buyQty: 10 }),
        line({ itemId: 2n, buyQty: 10, materialId: 31n }),
      ]);
      await expect(service.preview({ itemIds: ['1', '2'], qty: 5 }, null)).rejects.toThrow(
        BadRequestException,
      );
      proposals.loadReceiveLines.mockResolvedValue([
        line({ itemId: 1n, buyQty: 10, supplierOrderId: null }),
        line({ itemId: 2n, buyQty: 10, supplierOrderId: null }),
      ]);
      await expect(service.preview({ itemIds: ['1', '2'], qty: 5 }, null)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('chặn dòng chưa tới lượt nhận (không PURCHASING) - 409', async () => {
      proposals.loadReceiveLines.mockResolvedValue([
        line({ itemId: 1n, buyQty: 10, status: PurchaseProposalStatus.NEW }),
      ]);
      await expect(service.preview({ itemIds: ['1'], qty: 5 }, null)).rejects.toThrow(
        ConflictException,
      );
    });

    it('thủ kho kho khác không xem/nhận được (403); tổng kho (null) và đúng kho thì qua', async () => {
      proposals.loadReceiveLines.mockResolvedValue([line({ itemId: 1n, buyQty: 10 })]);
      await expect(service.preview({ itemIds: ['1'], qty: 5 }, 'kho-son')).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.preview({ itemIds: ['1'], qty: 5 }, 'kho-phoi')).resolves.toHaveLength(
        1,
      );
      await expect(service.preview({ itemIds: ['1'], qty: 5 }, null)).resolves.toHaveLength(1);
    });
  });

  describe('receive', () => {
    const base = { itemIds: ['3', '1', '2'], unitRateQty: 150, deliveredQty: 150, ...docs };

    it('1 phiếu cho cả đơn gộp: tự chia rồi ghi từng lệnh có phần chia > 0, trong 1 transaction', async () => {
      const lines = group();
      proposals.loadReceiveLines.mockResolvedValue(lines);
      freshFrom(lines);

      const res = await service.receive(base, 'kho-1', 'key-1', null);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(proposals.applyItemReceipt).toHaveBeenCalledTimes(2);
      expect(appliedQty()).toEqual([
        ['1', 120],
        ['2', 30],
      ]);
      expect(appliedCalls()[0][1]).toEqual(
        expect.objectContaining({
          receiptId: 900n,
          supplierWarehouseId: 700n,
          idempotencyKey: 'key-1',
        }),
      );
      expect(prisma.purchaseReceipt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'RECEIVED',
          receivedQty: 150,
          deliveredQty: 150,
          supplierOrderId: 50n,
          approvalFileUrls: ['https://cdn/ky.pdf'],
          allocationAdjusted: false,
          idempotencyKey: 'key-1',
        }) as unknown,
      });
      expect(proposals.afterItemReceipt).toHaveBeenCalledTimes(2);
      expect(res.allocation.map((a) => a.qty)).toEqual([120, 30, 0]);
    });

    it('số thực nhận phải bằng số phiếu giao (không dung sai) - lệch thì 400, không ghi gì', async () => {
      proposals.loadReceiveLines.mockResolvedValue(group());
      await expect(
        service.receive({ ...base, deliveredQty: 149.5 }, 'kho-1', 'key-1', null),
      ).rejects.toThrow(/phiếu giao/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('có quy đổi (Ô2): đối chiếu phiếu giao với Ô2, số vào kho = Ô1 × Ô2, chia phần Ô2 theo tỷ lệ', async () => {
      const lines = [line({ itemId: 1n, buyQty: 10000, groupKey: 'OTHER' })];
      proposals.loadReceiveLines.mockResolvedValue(lines);
      freshFrom(lines);

      await service.receive(
        {
          itemIds: ['1'],
          unitRateQty: 130,
          supplierUnitQty: 50,
          deliveredQty: 50,
          ...docs,
          weighSlipUrls: [],
        },
        'kho-1',
        'key-1',
        null,
      );

      expect(appliedCalls()[0][1]).toEqual(
        expect.objectContaining({ qty: 6500, unitRateQty: 130, supplierUnitShare: 50 }),
      );
    });

    it('thiếu chứng từ thì không cho nhập - báo đủ các ô còn thiếu', async () => {
      proposals.loadReceiveLines.mockResolvedValue([
        line({ itemId: 1n, buyQty: 10, orderApprovalFile: null }),
      ]);
      await expect(
        service.receive(
          {
            itemIds: ['1'],
            slipCode: 'NK-261106-001',
            unitRateQty: 5,
            deliveredQty: 5,
            supplierSlipUrls: [],
            receiptSlipUrls: [' '],
          },
          'kho-1',
          'key-1',
          null,
        ),
      ).rejects.toThrow(
        'Thiếu ảnh chứng từ: phiếu giao hàng của NCC, phiếu nhập kho nhà máy, phiếu đề xuất Giám đốc ký, phiếu cân xe (bắt buộc với sắt).',
      );
      expect(prisma.purchaseReceipt.create).not.toHaveBeenCalled();
    });

    it('đơn chưa có file Giám đốc ký thì dùng file thủ kho tải; vật tư không phải sắt không cần phiếu cân xe', async () => {
      const lines = [line({ itemId: 1n, buyQty: 10, orderApprovalFile: null, groupKey: 'OTHER' })];
      proposals.loadReceiveLines.mockResolvedValue(lines);
      freshFrom(lines);

      await service.receive(
        {
          itemIds: ['1'],
          slipCode: 'NK-261106-001',
          unitRateQty: 5,
          deliveredQty: 5,
          supplierSlipUrls: ['a'],
          receiptSlipUrls: ['b'],
          approvalFileUrls: ['tai-tay.jpg'],
        },
        'kho-1',
        'key-1',
        null,
      );
      expect(prisma.purchaseReceipt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          approvalFileUrls: ['tai-tay.jpg'],
          weighSlipUrls: [],
        }) as unknown,
      });
    });

    it('thủ kho chỉnh phân bổ: ghi đúng số đã chỉnh, lưu cả phân bổ tự động, đánh dấu đã chỉnh', async () => {
      const lines = group();
      proposals.loadReceiveLines.mockResolvedValue(lines);
      freshFrom(lines);

      const res = await service.receive(
        {
          ...base,
          allocation: [
            { itemId: '1', qty: 100 },
            { itemId: '2', qty: 50 },
          ],
        },
        'kho-1',
        'key-1',
        null,
      );

      expect(appliedQty()).toEqual([
        ['1', 100],
        ['2', 50],
      ]);
      expect(prisma.purchaseReceipt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          allocationAdjusted: true,
          autoAllocation: [
            { itemId: '1', qty: 120 },
            { itemId: '2', qty: 30 },
            { itemId: '3', qty: 0 },
          ],
        }) as unknown,
      });
      expect(res.allocationAdjusted).toBe(true);
    });

    it('phân bổ chỉnh tay phải cộng đủ số thực nhận và chỉ gồm dòng của lần nhận này', async () => {
      proposals.loadReceiveLines.mockResolvedValue(group());
      freshFrom(group());
      await expect(
        service.receive(
          { ...base, allocation: [{ itemId: '1', qty: 100 }] },
          'kho-1',
          'key-1',
          null,
        ),
      ).rejects.toThrow(/Tổng phân bổ/);
      await expect(
        service.receive(
          { ...base, allocation: [{ itemId: '99', qty: 150 }] },
          'kho-1',
          'key-2',
          null,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(proposals.applyItemReceipt).not.toHaveBeenCalled();
    });

    it('chia theo số đã nhận MỚI NHẤT đọc sau khi khoá, không theo số đọc trước', async () => {
      const lines = group();
      proposals.loadReceiveLines.mockResolvedValue(lines);
      // Lệnh 1 vừa được nhận 120 ở 1 phiếu khác chạy trước (giả lập dòng vẫn còn chờ nhận phần mua dư).
      prisma.purchaseProposalItem.findMany.mockResolvedValue([
        { id: 1n, receivedQty: dec(120), status: PurchaseProposalStatus.PURCHASING },
        { id: 2n, receivedQty: dec(0), status: PurchaseProposalStatus.PURCHASING },
        { id: 3n, receivedQty: dec(0), status: PurchaseProposalStatus.PURCHASING },
      ]);

      await service.receive(base, 'kho-1', 'key-1', null);

      expect(appliedQty()).toEqual([
        ['2', 80],
        ['3', 70],
      ]);
    });

    it('dòng vừa bị đóng/xử lý bởi thao tác khác trong lúc chờ khoá -> 409, không ghi phiếu', async () => {
      proposals.loadReceiveLines.mockResolvedValue(group());
      prisma.purchaseProposalItem.findMany.mockResolvedValue([
        { id: 1n, receivedQty: dec(120), status: PurchaseProposalStatus.PURCHASED },
        { id: 2n, receivedQty: dec(0), status: PurchaseProposalStatus.PURCHASING },
        { id: 3n, receivedQty: dec(0), status: PurchaseProposalStatus.PURCHASING },
      ]);
      await expect(service.receive(base, 'kho-1', 'key-1', null)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.purchaseReceipt.create).not.toHaveBeenCalled();
    });

    it('gửi lại cùng Idempotency-Key: trả phiếu đã có, không nhập lần 2', async () => {
      prisma.purchaseReceipt.findUnique.mockResolvedValue({
        id: 900n,
        status: 'RECEIVED',
        receivedQty: dec(150),
        overQty: dec(0),
        allocation: [],
        allocationAdjusted: false,
      });
      const res = await service.receive(base, 'kho-1', 'key-1', null);
      expect(res.id).toBe('900');
      expect(proposals.loadReceiveLines).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('số phiếu nhập NK (Đợt 6, 4.8)', () => {
    const base = { itemIds: ['3', '1', '2'], unitRateQty: 150, deliveredQty: 150, ...docs };

    it('gắn số NK đã giữ vào phiếu nhận và đánh dấu đã dùng, trong cùng transaction', async () => {
      const lines = group();
      proposals.loadReceiveLines.mockResolvedValue(lines);
      freshFrom(lines);
      const res = await service.receive(base, 'kho-1', 'key-nk', null);
      expect(res.code).toBe('NK-261106-001');
      expect(prisma.reservedSlipCode.updateMany).toHaveBeenCalledWith({
        where: { code: 'NK-261106-001', kind: 'NK', usedAt: null },
        data: { usedAt: expect.any(Date) as unknown },
      });
      expect(prisma.purchaseReceipt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ code: 'NK-261106-001' }) as unknown,
      });
    });

    it('số NK chưa giữ hoặc đã dùng -> 400, không ghi phiếu', async () => {
      const lines = group();
      proposals.loadReceiveLines.mockResolvedValue(lines);
      freshFrom(lines);
      prisma.reservedSlipCode.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.receive(base, 'kho-1', 'key-nk', null)).rejects.toThrow('In phiếu nhập');
      expect(prisma.purchaseReceipt.create).not.toHaveBeenCalled();
      expect(proposals.applyItemReceipt).not.toHaveBeenCalled();
    });

    it('"In phiếu nhập": cấp số NK mới; in lại cùng lần nhận thì dùng lại số chưa dùng của chính mình', async () => {
      const first = await service.reserveSlipCode('kho-1');
      expect(first.code).toMatch(/^NK-\d{6}-004$/);
      expect(prisma.reservedSlipCode.create).toHaveBeenCalledWith({
        data: { code: first.code, kind: 'NK', createdById: 'kho-1' },
      });

      prisma.reservedSlipCode.findUnique.mockResolvedValue({
        code: 'NK-261106-002',
        kind: 'NK',
        usedAt: null,
        createdById: 'kho-1',
      });
      expect(await service.reserveSlipCode('kho-1', 'NK-261106-002')).toEqual({
        code: 'NK-261106-002',
      });
      // Số của người khác / đã dùng thì cấp số mới.
      prisma.reservedSlipCode.findUnique.mockResolvedValue({
        code: 'NK-261106-002',
        kind: 'NK',
        usedAt: new Date(),
        createdById: 'kho-1',
      });
      expect((await service.reserveSlipCode('kho-1', 'NK-261106-002')).code).not.toBe(
        'NK-261106-002',
      );
    });
  });

  describe('nhận vượt (4.12)', () => {
    // Đơn gộp còn lại 100 + 120 + 80 = 300; giao 310 -> vượt 10.
    const over = { itemIds: ['3', '1', '2'], unitRateQty: 310, deliveredQty: 310, ...docs };

    it('vượt số còn lại của đơn mà không có lý do -> 400, không ghi phiếu', async () => {
      const lines = group();
      proposals.loadReceiveLines.mockResolvedValue(lines);
      freshFrom(lines);
      const err = await service.receive(over, 'kho-1', 'key-o', null).catch((e: Error) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as Error).message).toContain('Nhận vượt 10');
      expect(prisma.purchaseReceipt.create).not.toHaveBeenCalled();
      expect(proposals.applyItemReceipt).not.toHaveBeenCalled();
    });

    it('có lý do: ghi số vượt + lý do + ảnh vào phiếu, báo người mua phụ trách', async () => {
      const lines = group();
      proposals.loadReceiveLines.mockResolvedValue(lines);
      freshFrom(lines);
      const res = await service.receive(
        { ...over, overReason: '  NCC giao nguyên bó  ', overFileUrls: ['https://cdn/bo.jpg'] },
        'kho-1',
        'key-o',
        null,
      );
      expect(res.overQty).toBe(10);
      expect(prisma.purchaseReceipt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          receivedQty: 310,
          overQty: 10,
          overReason: 'NCC giao nguyên bó',
          overFileUrls: ['https://cdn/bo.jpg'],
        }) as unknown,
      });
      expect(notifications.emit).toHaveBeenCalledWith(
        'PURCHASE_OVER_RECEIVED',
        expect.objectContaining({
          actorId: 'kho-1',
          params: expect.objectContaining({
            materialCode: 'SAT-25',
            receivedQty: 310,
            overQty: 10,
            reason: 'NCC giao nguyên bó',
            orderCode: 'Kim Phát – Số 52/2026',
            buyerIds: ['buyer-1'],
          }) as unknown,
        }),
      );
    });

    it('số còn lại tính theo số đã nhận MỚI NHẤT sau khoá: lệnh đã nhận 50 thì giao 260 đã là vượt 10', async () => {
      const lines = group();
      proposals.loadReceiveLines.mockResolvedValue(lines);
      prisma.purchaseProposalItem.findMany.mockResolvedValue(
        lines.map((l) => ({
          id: l.item.id,
          receivedQty: dec(l.item.id === 1n ? 50 : 0),
          status: l.item.status,
        })),
      );
      const err = await service
        .receive({ ...over, unitRateQty: 260, deliveredQty: 260 }, 'kho-1', 'key-o', null)
        .catch((e: Error) => e);
      expect((err as Error).message).toContain('Nhận vượt 10');
    });

    it('nhận đúng bằng số còn lại: không cần lý do, overQty 0, không báo nhận vượt', async () => {
      const lines = group();
      proposals.loadReceiveLines.mockResolvedValue(lines);
      freshFrom(lines);
      const res = await service.receive(
        { ...over, unitRateQty: 300, deliveredQty: 300, overReason: 'thừa' },
        'kho-1',
        'key-o',
        null,
      );
      expect(res.overQty).toBe(0);
      expect(prisma.purchaseReceipt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          overQty: 0,
          overReason: null,
          overFileUrls: [],
        }) as unknown,
      });
      expect(notifications.emit).not.toHaveBeenCalledWith(
        'PURCHASE_OVER_RECEIVED',
        expect.anything(),
      );
    });
  });

  describe('reject (Từ chối nhận)', () => {
    it('ghi phiếu REJECTED, không cộng tồn, báo đúng người mua phụ trách', async () => {
      proposals.loadReceiveLines.mockResolvedValue([line({ itemId: 1n, buyQty: 10 })]);

      const res = await service.reject(
        {
          itemIds: ['1'],
          deliveredQty: 12,
          reason: 'Cân lại thiếu 2 kg',
          fileUrls: ['https://cdn/x.jpg'],
        },
        'kho-1',
        'key-r',
        null,
      );

      expect(res.status).toBe('REJECTED');
      expect(prisma.purchaseReceipt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'REJECTED',
          receivedQty: 0,
          rejectReason: 'Cân lại thiếu 2 kg',
          rejectFileUrls: ['https://cdn/x.jpg'],
        }) as unknown,
      });
      expect(proposals.applyItemReceipt).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(notifications.emit).toHaveBeenCalledWith(
        'PURCHASE_RECEIPT_REJECTED',
        expect.objectContaining({
          params: expect.objectContaining({
            buyerIds: ['buyer-1'],
            orderCode: 'Kim Phát – Số 52/2026',
            deliveredQty: 12,
          }) as unknown,
        }),
      );
    });
  });
});
