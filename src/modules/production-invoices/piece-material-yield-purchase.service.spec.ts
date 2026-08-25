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
  let productionBatchesService: { getReadyPoolQty: jest.Mock };

  const pi = { id: 1n };
  const chanNhom = { id: 40n }; // piece "chân nhôm" (needsHan=false)
  const thanhNhom = { id: 80n, code: 'NHOM-01', warehouse: { id: 95n, code: 'kho-nhom' } };

  const qtyRow = (qty: number) => Promise.resolve([{ qty: { toNumber: () => qty } }]);
  const decimal = (n: number) => ({ toNumber: () => n });

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
        // items trả về derive THẲNG từ args.data.items.create - phản ánh đúng buyQty vừa tính,
        // để check allCovered đọc found.items ngay sau create() (không cần findUniqueOrThrow
        // riêng ở nhánh tạo mới, khác nhánh gộp vào proposal có sẵn bên dưới).
        create: jest.fn(
          (args: {
            data: {
              items: { create: { materialId: bigint; buyQty: number; actualStock: number }[] };
            };
          }) =>
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
          items: [{ id: 950n, materialId: 80n, buyQty: decimal(0) }],
        }),
        // Dùng ở nhánh "đã có proposal NEW" sau khi update/create item lẻ - re-fetch để đọc
        // allCovered trên TOÀN BỘ items mới nhất. Mặc định buyQty=7 khớp kịch bản chính (tồn
        // 20/100, chưa đủ) - test nào cần buyQty=0 tự override.
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 900n,
          status: PurchaseProposalStatus.NEW,
          items: [{ id: 950n, materialId: 80n, buyQty: decimal(7) }],
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
      // lockBusinessKey() (khoá gộp theo PI, 2026-08-25) dùng $executeRaw - no-op ở test.
      $executeRaw: jest.fn().mockResolvedValue(0),
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
      include: { items: true },
    });
  });

  it('tồn nguyên liệu đã đủ (buyQty=0) - item.status=PURCHASED ngay lúc tạo, rollup cấp proposal cũng PURCHASED', async () => {
    // required = 100, onHand pool = 0 -> net=100 -> barsNeeded = ceil(100/12) = 9.
    // actualStock (thanh nhôm) = 9 -> buyQty = 0.
    prisma.$queryRaw.mockResolvedValue(await qtyRow(9));
    // recomputeProposalStatus() đọc TƯƠI - mô phỏng đúng item vừa tạo với buyQty=0 -> PURCHASED.
    prisma.purchaseProposalItem.findMany.mockResolvedValue([
      { status: PurchaseProposalStatus.PURCHASED },
    ]);
    // findUniqueOrThrow() re-fetch SAU recomputeProposalStatus() - phải phản ánh đúng rollup mới.
    prisma.purchaseProposal.findUniqueOrThrow.mockResolvedValue({
      id: 900n,
      status: PurchaseProposalStatus.PURCHASED,
      items: [{ id: 950n, materialId: 80n, buyQty: decimal(0) }],
    });

    const result = await service.computeAndUpsertProposals('1');

    expect(result[0].buyQty).toBe(0);
    // 2026-08-25: item.status=PURCHASED được set NGAY lúc create() (không còn 1 lệnh update()
    // riêng gán thẳng status cấp cha như thiết kế cũ) - recomputeProposalStatus() mới là nơi ghi
    // rollup cấp proposal, cùng idiom ConsumableMaterialPurchaseService.
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
    expect(prisma.purchaseProposal.update).toHaveBeenCalledWith({
      where: { id: 900n },
      data: { status: PurchaseProposalStatus.PURCHASED },
    });
    expect(result[0].purchaseProposalStatus).toBe(PurchaseProposalStatus.PURCHASED);
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

  // 2026-08-25: findFirst KHÔNG còn lọc theo sourceType/items.some(materialId) - đề xuất giờ
  // gộp CHUNG theo cả PI (bất kể vật tư nào, nguồn nào), để merge được với đề xuất do
  // CuttingProposalsService/ConsumableMaterialPurchaseService tạo cho cùng PI (xem khoá
  // "purchase-proposal-merge:<piId>" dùng chung ở cả 3 nơi). CŨNG KHÔNG còn lọc cứng
  // status=NEW nữa (sửa cùng lúc với chuyển state machine xuống cấp item) - rollup rời NEW
  // ngay khi có 1 dòng bất kỳ được acknowledge, sớm hơn hẳn trước đây; lọc cứng NEW sẽ khiến
  // nguồn này ngừng gộp được vào đề xuất đã có ai bắt đầu xử lý. Đổi sang "còn mở" (khác
  // PURCHASED). findFirst mock mặc định trả về giá trị mock bất kể where - test này xác nhận
  // đúng where đã truyền đi.
  it('findFirst gộp theo PI, còn mở (khác PURCHASED) - không lọc theo sourceType/materialId/NEW riêng', async () => {
    await service.computeAndUpsertProposals('1');

    expect(prisma.purchaseProposal.findFirst).toHaveBeenCalledWith({
      where: {
        productionInvoiceId: 1n,
        status: { not: PurchaseProposalStatus.PURCHASED },
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
