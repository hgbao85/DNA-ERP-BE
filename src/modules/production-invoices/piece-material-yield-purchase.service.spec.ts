import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PurchaseProposalSource, PurchaseProposalStatus } from '../../generated/prisma/client';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { ProductionBatchesService } from '../production-batches/production-batches.service';
import { PieceMaterialYieldPurchaseService } from './piece-material-yield-purchase.service';

describe('PieceMaterialYieldPurchaseService', () => {
  let service: PieceMaterialYieldPurchaseService;
  let prisma: {
    productionInvoice: { findUnique: jest.Mock };
    productionOrder: { findMany: jest.Mock };
    bomPiece: { findMany: jest.Mock };
    pieceMaterialYield: { findMany: jest.Mock };
    purchaseProposal: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
    purchaseProposalItem: { update: jest.Mock };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let productionBatchesService: { getReadyPoolQty: jest.Mock };

  const pi = { id: 1n };
  const chanNhom = { id: 40n }; // piece "chân nhôm" (needsHan=false)
  const thanhNhom = { id: 80n, code: 'NHOM-01', warehouse: { id: 95n, code: 'kho-nhom' } };

  const qtyRow = (qty: number) => Promise.resolve([{ qty: { toNumber: () => qty } }]);

  beforeEach(() => {
    prisma = {
      productionInvoice: { findUnique: jest.fn().mockResolvedValue(pi) },
      productionOrder: {
        findMany: jest.fn().mockResolvedValue([{ id: 10n, bomRevisionId: 5n, quantity: 100 }]),
      },
      bomPiece: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { bomRevisionId: 5n, pieceId: chanNhom.id, qtyPerUnit: 1, needsHan: false },
          ]),
      },
      pieceMaterialYield: {
        findMany: jest.fn().mockResolvedValue([
          {
            bomRevisionId: 5n,
            pieceId: chanNhom.id,
            materialId: thanhNhom.id,
            piecesPerBar: 12,
            material: thanhNhom,
          },
        ]),
      },
      purchaseProposal: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 900n, status: PurchaseProposalStatus.NEW }),
        update: jest.fn().mockResolvedValue({ id: 900n, status: PurchaseProposalStatus.PURCHASED }),
      },
      purchaseProposalItem: { update: jest.fn() },
      $queryRaw: jest.fn(() => qtyRow(0)),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    productionBatchesService = { getReadyPoolQty: jest.fn().mockResolvedValue(new Map()) };
    service = new PieceMaterialYieldPurchaseService(
      prisma as unknown as PrismaServiceType,
      productionBatchesService as unknown as ProductionBatchesService,
    );
  });

  it('trả [] khi PI chưa có ProductionOrder nào (chưa có SKU nào được Sếp duyệt)', async () => {
    prisma.productionOrder.findMany.mockResolvedValue([]);

    const result = await service.computeAndUpsertProposals('1');

    expect(result).toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('trả [] khi không có bomPiece needsHan=false nào (PI chỉ toàn mảnh sắt)', async () => {
    prisma.bomPiece.findMany.mockResolvedValue([]);

    const result = await service.computeAndUpsertProposals('1');

    expect(result).toEqual([]);
  });

  it('bỏ qua piece chưa khai PieceMaterialYield - không chặn PI, không tạo đề xuất', async () => {
    prisma.pieceMaterialYield.findMany.mockResolvedValue([]);

    const result = await service.computeAndUpsertProposals('1');

    expect(result).toEqual([]);
    expect(prisma.purchaseProposal.create).not.toHaveBeenCalled();
  });

  it('không đủ tồn - tính đúng số cây làm tròn lên, tạo PurchaseProposal NEW', async () => {
    // required = qtyPerUnit(1) × quantity(100) = 100 chân. onHand pool = 20 chân -> net = 80.
    // piecesPerBar = 12 -> barsNeeded = ceil(80/12) = 7. actualStock (thanh nhôm) = 0 -> buyQty = 7.
    productionBatchesService.getReadyPoolQty.mockResolvedValue(new Map([['40', 20]]));

    const result = await service.computeAndUpsertProposals('1');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      materialId: '80',
      materialCode: 'NHOM-01',
      requiredPieces: 100,
      onHandPieces: 20,
      piecesPerBar: 12,
      barsNeeded: 7,
      actualStock: 0,
      buyQty: 7,
      purchaseProposalId: '900',
    });
    expect(prisma.purchaseProposal.create).toHaveBeenCalledWith({
      data: {
        sourceType: PurchaseProposalSource.PIECE_MATERIAL_YIELD,
        productionInvoiceId: 1n,
        warehouseCode: 'kho-nhom',
        items: { create: [{ materialId: 80n, buyQty: 7, actualStock: 0 }] },
      },
    });
  });

  it('tồn nguyên liệu đã đủ (buyQty=0) - tạo proposal ở trạng thái PURCHASED ngay, không kẹt NEW', async () => {
    // required = 100, onHand pool = 0 -> net=100 -> barsNeeded = ceil(100/12) = 9.
    // actualStock (thanh nhôm) = 9 -> buyQty = 0.
    prisma.$queryRaw.mockResolvedValue(await qtyRow(9));

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

  it('đã có proposal NEW cho đúng (PI, material) - cập nhật lại item thay vì tạo mới', async () => {
    prisma.purchaseProposal.findFirst.mockResolvedValue({
      id: 900n,
      status: PurchaseProposalStatus.NEW,
      items: [{ id: 950n, materialId: 80n }],
    });
    productionBatchesService.getReadyPoolQty.mockResolvedValue(new Map([['40', 20]]));

    const result = await service.computeAndUpsertProposals('1');

    expect(prisma.purchaseProposal.create).not.toHaveBeenCalled();
    expect(prisma.purchaseProposalItem.update).toHaveBeenCalledWith({
      where: { id: 950n },
      data: { buyQty: 7, actualStock: 0 },
    });
    expect(result[0].purchaseProposalId).toBe('900');
  });

  it('proposal đã qua NEW (SUBMITTED) - findFirst chỉ khớp status=NEW nên tạo mới, không sửa đề xuất đã gửi duyệt', async () => {
    // findFirst mock mặc định lọc where.status=NEW ở tầng DB thật; ở unit test findFirst luôn
    // trả về giá trị mock bất kể where - test này xác nhận đúng where đã truyền đi.
    await service.computeAndUpsertProposals('1');

    expect(prisma.purchaseProposal.findFirst).toHaveBeenCalledWith({
      where: {
        productionInvoiceId: 1n,
        sourceType: PurchaseProposalSource.PIECE_MATERIAL_YIELD,
        status: PurchaseProposalStatus.NEW,
        items: { some: { materialId: 80n } },
      },
      include: { items: true },
    });
  });

  it('ném BadRequestException khi material chưa được cấu hình Kho', async () => {
    prisma.pieceMaterialYield.findMany.mockResolvedValue([
      {
        bomRevisionId: 5n,
        pieceId: chanNhom.id,
        materialId: thanhNhom.id,
        piecesPerBar: 12,
        material: { id: 80n, code: 'NHOM-01', warehouse: null },
      },
    ]);

    await expect(service.computeAndUpsertProposals('1')).rejects.toThrow(BadRequestException);
  });

  it('ném NotFoundException khi PI không tồn tại', async () => {
    prisma.productionInvoice.findUnique.mockResolvedValue(null);

    await expect(service.computeAndUpsertProposals('999')).rejects.toThrow(NotFoundException);
  });
});
