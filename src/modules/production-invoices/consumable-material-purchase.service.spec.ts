import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PurchaseProposalSource, PurchaseProposalStatus } from '../../generated/prisma/client';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { ConsumableMaterialPurchaseService } from './consumable-material-purchase.service';

describe('ConsumableMaterialPurchaseService', () => {
  let service: ConsumableMaterialPurchaseService;
  let prisma: {
    productionInvoice: { findUnique: jest.Mock };
    productionOrder: { findMany: jest.Mock };
    bomPiece: { findMany: jest.Mock };
    pieceMaterialItem: { findMany: jest.Mock };
    consumableBom: { findMany: jest.Mock };
    bomAccessoryItem: { findMany: jest.Mock };
    material: { findMany: jest.Mock };
    purchaseProposal: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    purchaseProposalItem: { update: jest.Mock; create: jest.Mock; findMany: jest.Mock };
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
  };

  const pi = { id: 1n };
  const day = { id: 60n, code: 'DAY-01', warehouse: { id: 91n, code: 'kho-day-dinh' } };
  const son = { id: 61n, code: 'SON-DO', warehouse: { id: 92n, code: 'kho-son' } };

  const qtyRow = (qty: number) => Promise.resolve([{ qty: { toNumber: () => qty } }]);
  const decimal = (n: number) => ({ toNumber: () => n });

  beforeEach(() => {
    prisma = {
      productionInvoice: { findUnique: jest.fn().mockResolvedValue(pi) },
      productionOrder: {
        findMany: jest.fn().mockResolvedValue([{ id: 10n, bomRevisionId: 5n, quantity: 20 }]),
      },
      bomPiece: {
        findMany: jest.fn().mockResolvedValue([
          { bomRevisionId: 5n, pieceId: 40n, qtyPerUnit: 2 }, // 2 mảnh/SKU
        ]),
      },
      pieceMaterialItem: {
        findMany: jest.fn().mockResolvedValue([
          {
            bomRevisionId: 5n,
            pieceId: 40n,
            materialId: day.id,
            qtyPerPiece: { toNumber: () => 3 },
          },
        ]),
      },
      consumableBom: { findMany: jest.fn().mockResolvedValue([]) },
      bomAccessoryItem: { findMany: jest.fn().mockResolvedValue([]) },
      material: { findMany: jest.fn().mockResolvedValue([day]) },
      purchaseProposal: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(
          (args: { data: { items: { create: { materialId: bigint; buyQty: number }[] } } }) =>
            Promise.resolve({
              id: 900n,
              status: PurchaseProposalStatus.NEW,
              items: args.data.items.create.map((it, i) => ({
                id: 950n + BigInt(i),
                materialId: it.materialId,
                buyQty: decimal(it.buyQty),
              })),
            }),
        ),
        update: jest.fn().mockResolvedValue({
          id: 900n,
          status: PurchaseProposalStatus.PURCHASED,
          items: [{ id: 950n, materialId: 60n, buyQty: decimal(0) }],
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 900n,
          status: PurchaseProposalStatus.NEW,
          items: [{ id: 950n, materialId: 60n, buyQty: decimal(120) }],
        }),
      },
      purchaseProposalItem: {
        update: jest.fn(),
        create: jest.fn(),
        // recomputeProposalStatus() (purchase-proposal-status.util.ts) đọc TƯƠI status của mọi
        // item sau khi create/update xong - mặc định 1 dòng NEW, test nào cần kiểm rollup cụ thể
        // (vd "buyQty=0 -> PURCHASED") tự override.
        findMany: jest.fn().mockResolvedValue([{ status: PurchaseProposalStatus.NEW }]),
      },
      $queryRaw: jest.fn(() => qtyRow(0)),
      // lockBusinessKey() (khoá gộp theo PI, 2026-08-25) dùng $executeRaw - no-op ở test, chỉ cần
      // tồn tại để không throw "not a function".
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    service = new ConsumableMaterialPurchaseService(prisma as unknown as PrismaServiceType);
  });

  it('trả [] khi PI chưa có ProductionOrder nào', async () => {
    prisma.productionOrder.findMany.mockResolvedValue([]);

    expect(await service.computeAndUpsertProposals('1')).toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('trả [] khi không có định mức vật tư tiêu hao nào (chỉ có mảnh sắt)', async () => {
    prisma.pieceMaterialItem.findMany.mockResolvedValue([]);

    expect(await service.computeAndUpsertProposals('1')).toEqual([]);
  });

  it('Dây/Đinh (PieceMaterialItem) - nhân đủ 3 tầng: BomPiece.qtyPerUnit × order.quantity × qtyPerPiece', async () => {
    // required = qtyPerUnit(2 mảnh/SKU) × quantity(20 SKU) × qtyPerPiece(3 dây/mảnh) = 120.
    const result = await service.computeAndUpsertProposals('1');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      materialId: '60',
      materialCode: 'DAY-01',
      required: 120,
      actualStock: 0,
      buyQty: 120,
    });
    expect(prisma.purchaseProposal.create).toHaveBeenCalledWith({
      data: {
        sourceType: PurchaseProposalSource.CONSUMABLE_AUTO_CALC,
        productionInvoiceId: 1n,
        warehouseCode: 'kho-day-dinh',
        items: { create: [{ materialId: 60n, buyQty: 120, actualStock: 0 }] },
      },
      include: { items: true },
    });
  });

  it('Sơn (ConsumableBom) - phẳng, KHÔNG nhân qua BomPiece (khác PieceMaterialItem)', async () => {
    prisma.pieceMaterialItem.findMany.mockResolvedValue([]);
    prisma.consumableBom.findMany.mockResolvedValue([
      { bomRevisionId: 5n, materialId: son.id, qtyPerUnit: { toNumber: () => 0.5 } }, // 0.5 lít/SKU
    ]);
    prisma.material.findMany.mockResolvedValue([son]);

    const result = await service.computeAndUpsertProposals('1');

    // required = 0.5 × quantity(20) = 10, không nhân BomPiece.qtyPerUnit.
    expect(result[0]).toMatchObject({ materialId: '61', required: 10 });
  });

  it('buyQty là số thập phân, KHÔNG làm tròn lên (khác PieceMaterialYieldPurchaseService)', async () => {
    prisma.$queryRaw.mockResolvedValue(await qtyRow(45.5));

    const result = await service.computeAndUpsertProposals('1');

    // required=120, actualStock=45.5 -> buyQty=74.5 (giữ nguyên phân số).
    expect(result[0].buyQty).toBe(74.5);
  });

  it('tồn đã đủ (buyQty=0) - item.status=PURCHASED ngay lúc tạo, rollup cấp proposal cũng PURCHASED', async () => {
    prisma.$queryRaw.mockResolvedValue(await qtyRow(200));
    // recomputeProposalStatus() đọc TƯƠI - mô phỏng đúng item vừa tạo với buyQty=0 -> PURCHASED.
    prisma.purchaseProposalItem.findMany.mockResolvedValue([
      { status: PurchaseProposalStatus.PURCHASED },
    ]);
    // findUniqueOrThrow() re-fetch SAU recomputeProposalStatus() - phải phản ánh đúng rollup mới.
    prisma.purchaseProposal.findUniqueOrThrow.mockResolvedValue({
      id: 900n,
      status: PurchaseProposalStatus.PURCHASED,
      items: [{ id: 950n, materialId: 60n, buyQty: decimal(0) }],
    });

    const result = await service.computeAndUpsertProposals('1');

    expect(result[0].buyQty).toBe(0);
    expect(prisma.purchaseProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          items: {
            create: [
              expect.objectContaining({
                status: PurchaseProposalStatus.PURCHASED,
                purchasedAt: expect.any(Date) as Date,
              }) as unknown,
            ],
          },
        }) as unknown,
      }),
    );
    // recomputeProposalStatus() - rollup CẤP PROPOSAL suy ra từ status mọi item (mock ở trên).
    expect(prisma.purchaseProposal.update).toHaveBeenCalledWith({
      where: { id: 900n },
      data: { status: PurchaseProposalStatus.PURCHASED },
    });
    expect(result[0].purchaseProposalStatus).toBe(PurchaseProposalStatus.PURCHASED);
  });

  it('gộp cả 3 nguồn (PieceMaterialItem + ConsumableBom + BomAccessoryItem) khi CÙNG 1 materialId', async () => {
    prisma.consumableBom.findMany.mockResolvedValue([
      { bomRevisionId: 5n, materialId: day.id, qtyPerUnit: { toNumber: () => 1 } },
    ]);
    prisma.bomAccessoryItem.findMany.mockResolvedValue([
      { bomRevisionId: 5n, materialId: day.id, qtyPerUnit: { toNumber: () => 2 } },
    ]);

    const result = await service.computeAndUpsertProposals('1');

    // PieceMaterialItem: 120, ConsumableBom: 1×20=20, BomAccessoryItem: 2×20=40 -> tổng 180.
    expect(result).toHaveLength(1);
    expect(result[0].required).toBe(180);
  });

  it('gộp NHIỀU vật tư khác kho vào CÙNG 1 proposal (Khác kho vẫn gộp chung theo 1 PI)', async () => {
    prisma.consumableBom.findMany.mockResolvedValue([
      { bomRevisionId: 5n, materialId: son.id, qtyPerUnit: { toNumber: () => 0.5 } },
    ]);
    prisma.material.findMany.mockResolvedValue([day, son]);

    const result = await service.computeAndUpsertProposals('1');

    expect(result).toHaveLength(2);
    // 1 lần create duy nhất cho CẢ 2 vật tư (khác kho: kho-day-dinh vs kho-son) - không tách proposal.
    expect(prisma.purchaseProposal.create).toHaveBeenCalledTimes(1);
    const [createArgs] = prisma.purchaseProposal.create.mock.calls[0] as unknown as [
      { data: { items: { create: unknown[] } } },
    ];
    expect(createArgs.data.items.create).toHaveLength(2);
    expect(new Set(result.map((r) => r.purchaseProposalId))).toEqual(new Set(['900']));
  });

  it('đã có proposal NEW cho PI - cập nhật item đã có, tạo mới item chưa có, KHÔNG tạo proposal mới', async () => {
    prisma.purchaseProposal.findFirst.mockResolvedValue({
      id: 900n,
      status: PurchaseProposalStatus.NEW,
      items: [{ id: 950n, materialId: 60n, buyQty: decimal(0) }],
    });

    const result = await service.computeAndUpsertProposals('1');

    expect(prisma.purchaseProposal.create).not.toHaveBeenCalled();
    expect(prisma.purchaseProposalItem.update).toHaveBeenCalledWith({
      where: { id: 950n },
      data: { buyQty: 120, actualStock: 0 },
    });
    expect(prisma.purchaseProposalItem.create).not.toHaveBeenCalled();
    expect(result[0].purchaseProposalId).toBe('900');
  });

  it('proposal NEW đã có nhưng CHƯA có item của vật tư mới - tạo thêm item vào proposal đó', async () => {
    prisma.purchaseProposal.findFirst.mockResolvedValue({
      id: 900n,
      status: PurchaseProposalStatus.NEW,
      items: [{ id: 951n, materialId: 61n, buyQty: decimal(5) }], // item của Sơn, khác Dây
    });

    const result = await service.computeAndUpsertProposals('1');

    expect(prisma.purchaseProposal.create).not.toHaveBeenCalled();
    expect(prisma.purchaseProposalItem.create).toHaveBeenCalledWith({
      data: { proposalId: 900n, materialId: 60n, buyQty: 120, actualStock: 0 },
    });
    expect(result[0].purchaseProposalId).toBe('900');
  });

  it('ném BadRequestException khi material chưa được cấu hình Kho', async () => {
    prisma.material.findMany.mockResolvedValue([{ ...day, warehouse: null }]);

    await expect(service.computeAndUpsertProposals('1')).rejects.toThrow(BadRequestException);
  });

  it('ném NotFoundException khi PI không tồn tại', async () => {
    prisma.productionInvoice.findUnique.mockResolvedValue(null);

    await expect(service.computeAndUpsertProposals('999')).rejects.toThrow(NotFoundException);
  });
});
