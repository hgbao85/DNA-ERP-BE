import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  AccessoryItemKind,
  PurchaseProposalSource,
  PurchaseProposalStatus,
} from '../../generated/prisma/client';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StockReservationsService } from '../stock/stock-reservations.service';
import { ConsumableMaterialPurchaseService } from './consumable-material-purchase.service';

describe('ConsumableMaterialPurchaseService', () => {
  let service: ConsumableMaterialPurchaseService;
  let stockReservationsService: {
    getAvailableQty: jest.Mock;
    reserveOrAdjust: jest.Mock;
    shrinkToFloor: jest.Mock;
  };
  let notificationsService: { emit: jest.Mock; resolve: jest.Mock };
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

  const pi = { id: 1n };
  const day = { id: 60n, code: 'DAY-01', warehouse: { id: 91n, code: 'kho-day-dinh' } };
  const son = { id: 61n, code: 'SON-DO', warehouse: { id: 92n, code: 'kho-son' } };
  // Kho mặc định đã thuộc họ "thanh-pham" (vd Bì zipper/Nhãn, xem Admin > Vật tư) - vật tư
  // NHÓM NÀY mới bị receiveWarehouseCode ghi đè (2026-09-04, sửa lại sau khi phát hiện qua test
  // sống: ghi đè theo BomAccessoryItem.kind=PACKAGING là SAI, phải theo kho MẶC ĐỊNH của vật tư).
  const baoBi = { id: 62n, code: 'BAO-BI-01', warehouse: { id: 93n, code: 'thanh-pham' } };

  const qtyRow = (qty: number) => Promise.resolve([{ qty: { toNumber: () => qty } }]);
  const decimal = (n: number) => ({ toNumber: () => n });

  beforeEach(() => {
    prisma = {
      productionInvoice: { findUnique: jest.fn().mockResolvedValue(pi) },
      productionOrder: {
        // productionInvoiceItem.warehouseCode (2026-09-04) - kho thành phẩm QLSX đã chọn cho PI,
        // đọc để ghi đè receiveWarehouseCode cho vật tư đóng gói (BomAccessoryItem kind=PACKAGING).
        // Mặc định về 'thanh-pham' (kho gốc) - test riêng cho việc ghi đè tự đặt giá trị khác.
        findMany: jest.fn().mockResolvedValue([
          {
            id: 10n,
            bomRevisionId: 5n,
            quantity: 20,
            productionInvoiceItem: { warehouseCode: 'thanh-pham' },
          },
        ]),
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
        // notifyPurchaseProposalCreated() (best-effort, NGOÀI transaction) đọc lại proposal sau khi
        // commit - null mặc định để hàm đó tự bỏ qua êm (not found), test riêng cho notification tự
        // override. Không liên quan tới `findFirst` ở trên (đọc TRONG transaction, việc khác).
        findUnique: jest.fn().mockResolvedValue(null),
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
        count: jest.fn().mockResolvedValue(0),
      },
      $queryRaw: jest.fn(() => qtyRow(0)),
      // lockBusinessKey() (khoá gộp theo PI, 2026-08-25) dùng $executeRaw - no-op ở test, chỉ cần
      // tồn tại để không throw "not a function".
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    // 2026-09-23: buyQty giờ tính theo tồn KHẢ DỤNG (getAvailableQty), không đọc thẳng actualStock -
    // mặc định trả về ĐÚNG actualStock truyền vào (không giữ chỗ nào khác) để mọi test buyQty=
    // required-actualStock có sẵn không phải sửa; reserveOrAdjust/shrinkToFloor no-op mặc định, test
    // riêng cho race condition tự override.
    stockReservationsService = {
      getAvailableQty: jest.fn((_tx, _wh, _mat, onHand: number) => Promise.resolve(onHand)),
      reserveOrAdjust: jest.fn().mockResolvedValue(undefined),
      shrinkToFloor: jest.fn().mockResolvedValue(undefined),
    };
    notificationsService = {
      emit: jest.fn().mockResolvedValue(undefined),
      resolve: jest.fn().mockResolvedValue(undefined),
    };
    service = new ConsumableMaterialPurchaseService(
      prisma as unknown as PrismaServiceType,
      stockReservationsService as unknown as StockReservationsService,
      notificationsService as unknown as NotificationsService,
    );
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
        items: {
          create: [
            {
              materialId: 60n,
              buyQty: 120,
              actualStock: 0,
              receiveWarehouseCode: null,
              status: undefined,
              purchasedAt: undefined,
            },
          ],
        },
      },
      include: { items: true },
    });
  });

  // Phase 3a, mục 7.4 changelog 2026-09-25/26 - notifyPurchaseProposalCreated() (util dùng chung,
  // best-effort) đọc lại proposal SAU KHI computeAndUpsertProposals() đã commit.
  it('emit PURCHASE_PROPOSAL_CREATED sau khi tạo/gộp xong, khi rollup còn cần Mua hàng xử lý', async () => {
    prisma.purchaseProposal.findUnique.mockResolvedValue({
      id: 900n,
      status: PurchaseProposalStatus.NEW,
      productionInvoice: { code: 'PI-2026-020' },
    });
    prisma.purchaseProposalItem.count.mockResolvedValue(1);

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

  it('KHÔNG emit gì khi rollup đã PURCHASING/PURCHASED ngay lúc tạo (mọi vật tư đã đủ tồn, buyQty=0)', async () => {
    prisma.purchaseProposal.findUnique.mockResolvedValue({
      id: 900n,
      status: PurchaseProposalStatus.PURCHASED,
      productionInvoice: { code: 'PI-2026-020' },
    });

    await service.computeAndUpsertProposals('1');

    expect(notificationsService.emit).not.toHaveBeenCalled();
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

  // Đính chính audit độc lập 09/09 (rà soát nốt nhánh fixbug-28-08): trước đây `locked[0]?.qty` chỉ
  // lấy 1 dòng BẤT KỲ - nếu vật tư có ≥2 dòng stock_quant (nhiều bucket stockLengthMm), các dòng
  // còn lại bị ÂM THẦM BỎ QUA, tính thiếu tồn thực có -> đề xuất mua nhiều hơn cần thiết.
  it('cộng dồn MỌI dòng stock_quant trả về (không chỉ lấy dòng đầu) khi vật tư có nhiều bucket', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { qty: { toNumber: () => 30 } },
      { qty: { toNumber: () => 15.5 } },
    ]);

    const result = await service.computeAndUpsertProposals('1');

    // required=120, actualStock=30+15.5=45.5 -> buyQty=74.5, khớp đúng test "45.5 dồn 1 dòng" ở trên.
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

  it('vật tư có kho MẶC ĐỊNH đã thuộc họ "thanh-pham" (vd Bì zipper) ghi receiveWarehouseCode = kho thành phẩm QLSX đã chọn (2026-09-04)', async () => {
    prisma.pieceMaterialItem.findMany.mockResolvedValue([]); // loại nhánh Dây/Đinh khỏi phép tính
    prisma.bomAccessoryItem.findMany.mockResolvedValue([
      {
        bomRevisionId: 5n,
        materialId: baoBi.id,
        qtyPerUnit: { toNumber: () => 2 },
        kind: AccessoryItemKind.PACKAGING,
      },
    ]);
    prisma.material.findMany.mockResolvedValue([baoBi]);
    prisma.productionOrder.findMany.mockResolvedValue([
      {
        id: 10n,
        bomRevisionId: 5n,
        quantity: 20,
        productionInvoiceItem: { warehouseCode: 'thanh-pham-1788485485362' }, // "Kho thành phẩm 2"
      },
    ]);

    await service.computeAndUpsertProposals('1');

    expect(prisma.purchaseProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          items: {
            create: [
              expect.objectContaining({
                materialId: baoBi.id,
                receiveWarehouseCode: 'thanh-pham-1788485485362',
              }) as unknown,
            ],
          },
        }) as unknown,
      }),
    );
  });

  it('vật tư có kho MẶC ĐỊNH KHÔNG thuộc họ thanh-pham (vd vat-tu-tp) - KHÔNG ghi đè receiveWarehouseCode dù kind=PACKAGING và PI đã chọn kho thành phẩm phụ - vật tư này BẮT BUỘC nằm ở kho trung chuyển để bước Đóng gói lấy ra được (2026-09-04, sửa lại sau khi phát hiện qua test sống)', async () => {
    prisma.pieceMaterialItem.findMany.mockResolvedValue([]);
    prisma.bomAccessoryItem.findMany.mockResolvedValue([
      {
        bomRevisionId: 5n,
        materialId: day.id,
        qtyPerUnit: { toNumber: () => 2 },
        kind: AccessoryItemKind.PACKAGING,
      },
    ]);
    prisma.productionOrder.findMany.mockResolvedValue([
      {
        id: 10n,
        bomRevisionId: 5n,
        quantity: 20,
        productionInvoiceItem: { warehouseCode: 'thanh-pham-1788485485362' },
      },
    ]);

    await service.computeAndUpsertProposals('1');

    expect(prisma.purchaseProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          items: {
            create: [
              expect.objectContaining({ materialId: 60n, receiveWarehouseCode: null }) as unknown,
            ],
          },
        }) as unknown,
      }),
    );
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
      data: { buyQty: 120, actualStock: 0, receiveWarehouseCode: null },
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
      data: {
        proposalId: 900n,
        materialId: 60n,
        buyQty: 120,
        actualStock: 0,
        receiveWarehouseCode: null,
        status: undefined,
        purchasedAt: undefined,
      },
    });
    expect(result[0].purchaseProposalId).toBe('900');
  });

  // 2026-09-23 (vá race "2 PI cùng tính đề xuất mua gần nhau, cùng thấy 1 tồn kho đủ, cả 2 cùng
  // buyQty=0 dù tồn thật chỉ đủ cho 1 PI"): buyQty giờ tính qua getAvailableQty() (trừ phần giữ chỗ
  // của PI/luồng khác), không đọc thẳng actualStock (tồn vật lý) nữa.
  it('buyQty tính theo tồn KHẢ DỤNG (getAvailableQty), không phải tồn vật lý thô - phần đã bị PI khác giữ chỗ vẫn phải mua thêm dù tồn vật lý đủ', async () => {
    prisma.$queryRaw.mockResolvedValue(await qtyRow(200)); // tồn vật lý dư dả (200 >= required 120)...
    stockReservationsService.getAvailableQty.mockResolvedValue(50); // ...nhưng PI khác đã giữ chỗ phần lớn, chỉ còn khả dụng 50

    const result = await service.computeAndUpsertProposals('1');

    // required=120, available=50 -> consumeQty=50, buyQty=70 (KHÔNG phải 0 dù actualStock=200 thừa).
    expect(result[0]).toMatchObject({ required: 120, actualStock: 200, buyQty: 70 });
    expect(stockReservationsService.getAvailableQty).toHaveBeenCalledWith(
      expect.anything(),
      day.warehouse.id,
      day.id,
      200,
    );
  });

  it('giữ chỗ (reserveOrAdjust) ĐÚNG phần tồn đã dùng để che phủ demand (consumeQty), refType=CONSUMABLE_MATERIAL_PURCHASE, refId=productionInvoiceId', async () => {
    prisma.$queryRaw.mockResolvedValue(await qtyRow(200));
    stockReservationsService.getAvailableQty.mockResolvedValue(50);

    await service.computeAndUpsertProposals('1');

    expect(stockReservationsService.reserveOrAdjust).toHaveBeenCalledWith(expect.anything(), {
      warehouseId: day.warehouse.id,
      materialId: day.id,
      qty: 50, // consumeQty = min(required=120, available=50)
      refType: 'CONSUMABLE_MATERIAL_PURCHASE',
      refId: '1', // piBigId (KHÔNG phải PurchaseProposalItem.id - dòng đó chưa tồn tại lúc này)
      productionInvoiceId: 1n,
    });
  });

  it('co giữ chỗ của chính lượt tính TRƯỚC ĐÓ về floor (shrinkToFloor) TRƯỚC khi tính available - tránh tự xung đột với chính mình qua các lần tính lại', async () => {
    await service.computeAndUpsertProposals('1');

    expect(stockReservationsService.shrinkToFloor).toHaveBeenCalledWith(expect.anything(), {
      refType: 'CONSUMABLE_MATERIAL_PURCHASE',
      refId: '1',
      materialId: day.id,
    });
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
