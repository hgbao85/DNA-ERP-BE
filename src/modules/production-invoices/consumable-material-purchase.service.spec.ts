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
    purchaseProposal: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
    purchaseProposalItem: { update: jest.Mock };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };

  const pi = { id: 1n };
  const day = { id: 60n, code: 'DAY-01', warehouse: { id: 91n, code: 'kho-day-dinh' } };
  const son = { id: 61n, code: 'SON-DO', warehouse: { id: 92n, code: 'kho-son' } };

  const qtyRow = (qty: number) => Promise.resolve([{ qty: { toNumber: () => qty } }]);

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
        create: jest.fn().mockResolvedValue({ id: 900n, status: PurchaseProposalStatus.NEW }),
        update: jest.fn().mockResolvedValue({ id: 900n, status: PurchaseProposalStatus.PURCHASED }),
      },
      purchaseProposalItem: { update: jest.fn() },
      $queryRaw: jest.fn(() => qtyRow(0)),
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

  it('tồn đã đủ (buyQty=0) - tạo proposal PURCHASED ngay, không kẹt NEW', async () => {
    prisma.$queryRaw.mockResolvedValue(await qtyRow(200));

    const result = await service.computeAndUpsertProposals('1');

    expect(result[0].buyQty).toBe(0);
    expect(prisma.purchaseProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PurchaseProposalStatus.PURCHASED,
          purchasedAt: expect.any(Date) as Date,
        }) as unknown,
      }),
    );
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

  it('đã có proposal NEW cho đúng (PI, material) - cập nhật lại item thay vì tạo mới', async () => {
    prisma.purchaseProposal.findFirst.mockResolvedValue({
      id: 900n,
      status: PurchaseProposalStatus.NEW,
      items: [{ id: 950n, materialId: 60n }],
    });

    const result = await service.computeAndUpsertProposals('1');

    expect(prisma.purchaseProposal.create).not.toHaveBeenCalled();
    expect(prisma.purchaseProposalItem.update).toHaveBeenCalledWith({
      where: { id: 950n },
      data: { buyQty: 120, actualStock: 0 },
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
