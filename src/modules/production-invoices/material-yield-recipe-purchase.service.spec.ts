import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PurchaseProposalSource, PurchaseProposalStatus } from '../../generated/prisma/client';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MaterialYieldRecipesService } from '../material-yield-recipes/material-yield-recipes.service';
import { StockReservationsService } from '../stock/stock-reservations.service';
import { MaterialYieldRecipePurchaseService } from './material-yield-recipe-purchase.service';

describe('MaterialYieldRecipePurchaseService', () => {
  let service: MaterialYieldRecipePurchaseService;
  let stockReservationsService: {
    getAvailableQty: jest.Mock;
    reserveOrAdjust: jest.Mock;
    shrinkToFloor: jest.Mock;
  };
  let materialYieldRecipesService: { getProductionDemand: jest.Mock };
  let prisma: {
    productionInvoice: { findUnique: jest.Mock };
    material: { findMany: jest.Mock };
    materialYieldRecipe: { findMany: jest.Mock };
    purchaseProposal: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    purchaseProposalItem: {
      update: jest.Mock;
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let notificationsService: { emit: jest.Mock; resolve: jest.Mock };

  const pi = { id: 1n };
  const chanNhom = { id: 40n, code: 'CHAN-NHOM-01' }; // outputMaterial
  const thanhNhom = { id: 80n, code: 'NHOM-01', warehouse: { id: 95n, code: 'kho-nhom' } }; // inputMaterial

  const qtyRow = (qty: number) => Promise.resolve([{ qty: { toNumber: () => qty } }]);
  const decimal = (n: number) => ({ toNumber: () => n });

  // Demand item mặc định: requiredOutputQty=100, onHand=20 -> shortfall=80, piecesPerBar=12 ->
  // requiredInputQty = ceil(80/12) = 7 (số đã lưu sẵn trong demand, KHÔNG tự tính lại ở service).
  const demandItem = (overrides: Partial<Record<string, unknown>> = {}) => ({
    recipeId: '5',
    outputMaterialId: chanNhom.id.toString(),
    outputMaterialCode: chanNhom.code,
    outputMaterialName: 'Chân nhôm',
    requiredOutputQty: 100,
    onHandOutputQty: 20,
    shortfallOutputQty: 80,
    inputMaterialId: thanhNhom.id.toString(),
    inputMaterialCode: thanhNhom.code,
    inputMaterialName: 'Thanh nhôm',
    requiredInputQty: 7,
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      productionInvoice: { findUnique: jest.fn().mockResolvedValue(pi) },
      material: { findMany: jest.fn().mockResolvedValue([thanhNhom]) },
      materialYieldRecipe: {
        findMany: jest.fn().mockResolvedValue([{ id: 5n, piecesPerBar: 12 }]),
      },
      purchaseProposal: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
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
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 900n,
          status: PurchaseProposalStatus.NEW,
          items: [{ id: 950n, materialId: 80n, buyQty: decimal(7) }],
        }),
      },
      purchaseProposalItem: {
        update: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([{ status: PurchaseProposalStatus.NEW }]),
        count: jest.fn().mockResolvedValue(0),
      },
      $queryRaw: jest.fn(() => qtyRow(0)),
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    materialYieldRecipesService = {
      getProductionDemand: jest.fn().mockResolvedValue([demandItem()]),
    };
    stockReservationsService = {
      getAvailableQty: jest.fn((_tx, _wh, _mat, onHand: number) => Promise.resolve(onHand)),
      reserveOrAdjust: jest.fn().mockResolvedValue(undefined),
      shrinkToFloor: jest.fn().mockResolvedValue(undefined),
    };
    notificationsService = {
      emit: jest.fn().mockResolvedValue(undefined),
      resolve: jest.fn().mockResolvedValue(undefined),
    };
    service = new MaterialYieldRecipePurchaseService(
      prisma as unknown as PrismaServiceType,
      materialYieldRecipesService as unknown as MaterialYieldRecipesService,
      stockReservationsService as unknown as StockReservationsService,
      notificationsService as unknown as NotificationsService,
    );
  });

  it('trả [] khi getProductionDemand trả [] (chưa có ProductionOrder/recipe nào áp dụng)', async () => {
    materialYieldRecipesService.getProductionDemand.mockResolvedValue([]);

    const result = await service.computeAndUpsertProposals('1');

    expect(result).toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('trả [] khi mọi requiredInputQty = 0 (tồn output đã đủ, không cần cắt thêm)', async () => {
    materialYieldRecipesService.getProductionDemand.mockResolvedValue([
      demandItem({ requiredInputQty: 0, shortfallOutputQty: 0 }),
    ]);

    const result = await service.computeAndUpsertProposals('1');

    expect(result).toEqual([]);
    expect(prisma.purchaseProposal.create).not.toHaveBeenCalled();
  });

  it('không đủ tồn nguyên liệu vào - tạo PurchaseProposal NEW với sourceType=MATERIAL_YIELD_RECIPE', async () => {
    // requiredInputQty=7 (đã tính sẵn trong demand), actualStock (thanh nhôm) = 0 -> buyQty = 7.
    const result = await service.computeAndUpsertProposals('1');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      recipeId: '5',
      outputMaterialCode: 'CHAN-NHOM-01',
      materialId: '80',
      materialCode: 'NHOM-01',
      piecesPerBar: 12,
      requiredInputQty: 7,
      actualStock: 0,
      buyQty: 7,
      purchaseProposalId: '900',
    });
    expect(prisma.purchaseProposal.create).toHaveBeenCalledWith({
      data: {
        sourceType: PurchaseProposalSource.MATERIAL_YIELD_RECIPE,
        productionInvoiceId: 1n,
        warehouseCode: 'kho-nhom',
        items: { create: [{ materialId: 80n, buyQty: 7, actualStock: 0 }] },
      },
      include: { items: true },
    });
  });

  it('gộp 2 recipe khác nhau dùng CHUNG 1 inputMaterialId - cộng dồn requiredInputQty', async () => {
    materialYieldRecipesService.getProductionDemand.mockResolvedValue([
      demandItem({ recipeId: '5', requiredInputQty: 7 }),
      demandItem({
        recipeId: '6',
        outputMaterialId: '41',
        outputMaterialCode: 'CHAN-INOX-01',
        requiredInputQty: 3,
      }),
    ]);
    prisma.materialYieldRecipe.findMany.mockResolvedValue([
      { id: 5n, piecesPerBar: 12 },
      { id: 6n, piecesPerBar: 20 },
    ]);

    const result = await service.computeAndUpsertProposals('1');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ requiredInputQty: 10, buyQty: 10 });
  });

  it('buyQty tính theo tồn KHẢ DỤNG (getAvailableQty), không phải tồn vật lý thô', async () => {
    prisma.$queryRaw.mockResolvedValue(await qtyRow(20)); // tồn vật lý dư dả...
    stockReservationsService.getAvailableQty.mockResolvedValue(4); // ...nhưng PI khác đã giữ chỗ phần lớn

    const result = await service.computeAndUpsertProposals('1');

    // requiredInputQty=7, available=4 -> consumeQty=4, buyQty=3.
    expect(result[0]).toMatchObject({ actualStock: 20, buyQty: 3 });
    expect(stockReservationsService.getAvailableQty).toHaveBeenCalledWith(
      expect.anything(),
      thanhNhom.warehouse.id,
      thanhNhom.id,
      20,
    );
  });

  it('giữ chỗ (reserveOrAdjust) đúng phần tồn đã dùng để che phủ demand, refType=MATERIAL_YIELD_RECIPE_PURCHASE', async () => {
    prisma.$queryRaw.mockResolvedValue(await qtyRow(20));
    stockReservationsService.getAvailableQty.mockResolvedValue(4);

    await service.computeAndUpsertProposals('1');

    expect(stockReservationsService.reserveOrAdjust).toHaveBeenCalledWith(expect.anything(), {
      warehouseId: thanhNhom.warehouse.id,
      materialId: thanhNhom.id,
      qty: 4,
      refType: 'MATERIAL_YIELD_RECIPE_PURCHASE',
      refId: '1',
      productionInvoiceId: 1n,
    });
  });

  it('co giữ chỗ của chính lượt tính TRƯỚC ĐÓ về floor (shrinkToFloor) TRƯỚC khi tính available', async () => {
    await service.computeAndUpsertProposals('1');

    expect(stockReservationsService.shrinkToFloor).toHaveBeenCalledWith(expect.anything(), {
      refType: 'MATERIAL_YIELD_RECIPE_PURCHASE',
      refId: '1',
      materialId: thanhNhom.id,
    });
  });

  it('đã có proposal NEW cho đúng (PI, material) - cập nhật lại item thay vì tạo mới', async () => {
    prisma.purchaseProposal.findFirst.mockResolvedValue({
      id: 900n,
      status: PurchaseProposalStatus.NEW,
      items: [{ id: 950n, materialId: 80n }],
    });

    const result = await service.computeAndUpsertProposals('1');

    expect(prisma.purchaseProposal.create).not.toHaveBeenCalled();
    expect(prisma.purchaseProposalItem.update).toHaveBeenCalledWith({
      where: { id: 950n },
      data: { buyQty: 7, actualStock: 0 },
    });
    expect(result[0].purchaseProposalId).toBe('900');
  });

  it('item đã PURCHASED nhưng buyQty tính lại cao hơn receivedQty - tách dòng NEW cho phần thiếu', async () => {
    prisma.purchaseProposal.findFirst.mockResolvedValue({
      id: 900n,
      status: PurchaseProposalStatus.QUOTING,
      items: [
        {
          id: 950n,
          materialId: 80n,
          status: PurchaseProposalStatus.PURCHASED,
          receivedQty: decimal(3),
        },
      ],
    });

    await service.computeAndUpsertProposals('1'); // buyQty tính lại = 7

    expect(prisma.purchaseProposalItem.update).not.toHaveBeenCalled();
    expect(prisma.purchaseProposalItem.create).toHaveBeenCalledWith({
      data: { proposalId: 900n, materialId: 80n, buyQty: 4, actualStock: 0 },
    });
  });

  it('findFirst gộp theo PI, còn mở (khác PURCHASED) - cùng khoá merge với 3 service kia', async () => {
    await service.computeAndUpsertProposals('1');

    expect(prisma.purchaseProposal.findFirst).toHaveBeenCalledWith({
      where: {
        productionInvoiceId: 1n,
        status: { not: PurchaseProposalStatus.PURCHASED },
      },
      include: { items: true },
    });
  });

  it('emit PURCHASE_PROPOSAL_CREATED sau khi tạo/gộp xong', async () => {
    prisma.purchaseProposal.findUnique.mockResolvedValue({
      id: 900n,
      status: PurchaseProposalStatus.NEW,
      productionInvoice: { code: 'PI-2026-020' },
    });
    // notifyPurchaseProposalCreated() đọc các dòng còn chờ + người mua của vật tư (N-4) bằng findMany(select material).
    const baseFindMany = prisma.purchaseProposalItem.findMany.getMockImplementation();
    prisma.purchaseProposalItem.findMany.mockImplementation(
      (args?: { select?: { material?: unknown } }) =>
        args?.select?.material
          ? [{ material: { buyerId: null } }]
          : baseFindMany
            ? (baseFindMany(args) as unknown)
            : [],
    );

    await service.computeAndUpsertProposals('1');

    expect(notificationsService.emit).toHaveBeenCalledWith(
      'PURCHASE_PROPOSAL_CREATED',
      expect.objectContaining({
        entityId: '900',
        dedupeKey: 'PURCHASE_PROPOSAL_CREATED:900',
        params: expect.objectContaining({ piCode: 'PI-2026-020', count: 1 }) as unknown,
      }),
    );
  });

  it('ném BadRequestException khi material đầu vào chưa được cấu hình Kho', async () => {
    prisma.material.findMany.mockResolvedValue([{ id: 80n, code: 'NHOM-01', warehouse: null }]);

    await expect(service.computeAndUpsertProposals('1')).rejects.toThrow(BadRequestException);
  });

  it('ném NotFoundException khi PI không tồn tại', async () => {
    prisma.productionInvoice.findUnique.mockResolvedValue(null);

    await expect(service.computeAndUpsertProposals('999')).rejects.toThrow(NotFoundException);
  });
});
