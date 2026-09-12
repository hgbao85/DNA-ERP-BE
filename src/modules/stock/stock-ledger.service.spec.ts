import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma, StockLedgerRefType } from '../../generated/prisma/client';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { StockLedgerService } from './stock-ledger.service';

describe('StockLedgerService', () => {
  let service: StockLedgerService;
  let prisma: {
    stockLedger: {
      findUnique: jest.Mock;
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    warehouse: { findMany: jest.Mock };
    warehouseTransfer: { findMany: jest.Mock };
    productionBatch: { findMany: jest.Mock };
    materialIssue: { findMany: jest.Mock };
    packagingIssue: { findMany: jest.Mock };
    materialYieldIssue: { findMany: jest.Mock };
    weavingIssueMaterial: { findMany: jest.Mock };
    steelIssue: { findMany: jest.Mock };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };

  const fromWh = { id: 1n, code: 'phoi-son-han', name: 'Phoi Son Han' };
  const toWh = { id: 2n, code: 'vat-tu-tp', name: 'Vat tu TP' };
  const material = { id: 10n, code: 'SAT-25', name: 'Sắt hộp 25x50', unit: 'cây' };

  const ledgerRow = (overrides: Record<string, unknown> = {}) => ({
    id: 100n,
    fromWarehouseId: 1n,
    toWarehouseId: 2n,
    materialId: 10n,
    segmentSpecId: null,
    pieceId: null,
    productVariantId: null,
    qty: { toNumber: () => 5 } as unknown as Prisma.Decimal,
    refType: StockLedgerRefType.ADJUST,
    refId: null,
    idempotencyKey: null,
    note: null,
    createdAt: new Date('2026-08-05T00:00:00Z'),
    createdById: 'user-1',
    stockLengthMm: 6000,
    fromWarehouse: fromWh,
    toWarehouse: toWh,
    material,
    segmentSpec: null,
    piece: null,
    productVariant: null,
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      stockLedger: {
        findUnique: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      warehouse: { findMany: jest.fn().mockResolvedValue([fromWh, toWh]) },
      warehouseTransfer: { findMany: jest.fn().mockResolvedValue([]) },
      productionBatch: { findMany: jest.fn().mockResolvedValue([]) },
      materialIssue: { findMany: jest.fn().mockResolvedValue([]) },
      packagingIssue: { findMany: jest.fn().mockResolvedValue([]) },
      materialYieldIssue: { findMany: jest.fn().mockResolvedValue([]) },
      weavingIssueMaterial: { findMany: jest.fn().mockResolvedValue([]) },
      steelIssue: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([{ qty: { toNumber: () => 100 } }]),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(prisma))),
    };
    service = new StockLedgerService(prisma as unknown as PrismaServiceType);
  });

  describe('postEntry - XOR 4 chân hàng', () => {
    it('rejects when no goods leg is set', async () => {
      await expect(
        service.postEntry({
          fromWarehouseId: 1n,
          toWarehouseId: 2n,
          qty: 5,
          refType: StockLedgerRefType.ADJUST,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.stockLedger.create).not.toHaveBeenCalled();
    });

    it('rejects when 2 goods legs are set at once', async () => {
      await expect(
        service.postEntry({
          fromWarehouseId: 1n,
          toWarehouseId: 2n,
          materialId: 10n,
          pieceId: 20n,
          qty: 5,
          refType: StockLedgerRefType.ADJUST,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it.each([
      ['materialId', { materialId: 10n }],
      ['segmentSpecId', { segmentSpecId: 11n }],
      ['pieceId', { pieceId: 12n }],
      ['productVariantId', { productVariantId: 13n }],
    ])('accepts exactly 1 leg set (%s)', async (_label, leg) => {
      prisma.stockLedger.create.mockResolvedValue(ledgerRow(leg));

      await expect(
        service.postEntry({
          fromWarehouseId: 1n,
          toWarehouseId: 2n,
          ...leg,
          qty: 5,
          refType: StockLedgerRefType.ADJUST,
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('postEntry - business rules', () => {
    it('rejects fromWarehouseId === toWarehouseId', async () => {
      await expect(
        service.postEntry({
          fromWarehouseId: 1n,
          toWarehouseId: 1n,
          materialId: 10n,
          qty: 5,
          refType: StockLedgerRefType.ADJUST,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.stockLedger.create).not.toHaveBeenCalled();
    });

    it('rejects qty <= 0', async () => {
      await expect(
        service.postEntry({
          fromWarehouseId: 1n,
          toWarehouseId: 2n,
          materialId: 10n,
          qty: 0,
          refType: StockLedgerRefType.ADJUST,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('postEntry - idempotency (POST /stock-ledger/adjust)', () => {
    it('creates a new row when the idempotency key has not been used', async () => {
      prisma.stockLedger.findUnique.mockResolvedValue(null);
      prisma.stockLedger.create.mockResolvedValue(ledgerRow());

      const result = await service.postEntry({
        fromWarehouseId: 1n,
        toWarehouseId: 2n,
        materialId: 10n,
        qty: 5,
        refType: StockLedgerRefType.ADJUST,
        idempotencyKey: 'key-1',
      });

      expect(prisma.stockLedger.create).toHaveBeenCalledTimes(1);
      expect(result.id).toBe('100');
    });

    it('returns the existing row without creating a duplicate when the key was already used', async () => {
      prisma.stockLedger.findUnique.mockResolvedValue(ledgerRow());

      const result = await service.postEntry({
        fromWarehouseId: 1n,
        toWarehouseId: 2n,
        materialId: 10n,
        qty: 5,
        refType: StockLedgerRefType.ADJUST,
        idempotencyKey: 'key-1',
      });

      expect(prisma.stockLedger.create).not.toHaveBeenCalled();
      expect(result.id).toBe('100');
    });

    it('resolves to the winning row when 2 requests race on the same key (P2002)', async () => {
      prisma.stockLedger.findUnique
        .mockResolvedValueOnce(null) // pre-check: chưa thấy
        .mockResolvedValueOnce(ledgerRow()); // fetch lại sau khi thua race
      const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.9.0',
      });
      prisma.stockLedger.create.mockRejectedValue(p2002);

      const result = await service.postEntry({
        fromWarehouseId: 1n,
        toWarehouseId: 2n,
        materialId: 10n,
        qty: 5,
        refType: StockLedgerRefType.ADJUST,
        idempotencyKey: 'key-1',
      });

      expect(result.id).toBe('100');
    });

    it('rethrows a P2002 with no idempotencyKey involved (not a replay, a real conflict)', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.9.0',
      });
      prisma.stockLedger.create.mockRejectedValue(p2002);

      await expect(
        service.postEntry({
          fromWarehouseId: 1n,
          toWarehouseId: 2n,
          materialId: 10n,
          qty: 5,
          refType: StockLedgerRefType.ADJUST,
        }),
      ).rejects.toBe(p2002);
    });
  });

  describe('adjust', () => {
    it('posts an ADJUST entry carrying the caller and the idempotency key through', async () => {
      prisma.stockLedger.findUnique.mockResolvedValue(null);
      prisma.stockLedger.create.mockResolvedValue(ledgerRow());

      await service.adjust(
        { fromWarehouseId: '1', toWarehouseId: '2', materialId: '10', qty: 5, note: 'kiểm kê' },
        'idem-key-1',
        'user-1',
        null,
      );

      expect(prisma.stockLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
          data: expect.objectContaining({
            refType: StockLedgerRefType.ADJUST,
            note: 'kiểm kê',
            idempotencyKey: 'idem-key-1',
            createdBy: { connect: { id: 'user-1' } },
          }),
        }),
      );
    });

    it('allows a scoped caller whose warehouseScope matches one leg of the entry', async () => {
      prisma.stockLedger.findUnique.mockResolvedValue(null);
      prisma.stockLedger.create.mockResolvedValue(ledgerRow());

      await service.adjust(
        { fromWarehouseId: '1', toWarehouseId: '2', materialId: '10', qty: 5, note: 'kiểm kê' },
        'idem-key-2',
        'user-1',
        toWh.code,
      );

      expect(prisma.stockLedger.create).toHaveBeenCalled();
    });

    it('rejects a scoped caller whose warehouseScope touches neither leg of the entry', async () => {
      await expect(
        service.adjust(
          { fromWarehouseId: '1', toWarehouseId: '2', materialId: '10', qty: 5, note: 'kiểm kê' },
          'idem-key-3',
          'user-1',
          'thanh-pham',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.stockLedger.create).not.toHaveBeenCalled();
    });

    // Medium fix "Sửa nhanh tồn kho" - FE nhập số tuyệt đối rồi tự tính delta từ số cũ đã đọc
    // trước đó (client-side). Không khoá thì 2 người cùng thấy tồn=100 sửa gần như đồng thời cộng
    // dồn sai. expectedCurrentQty là optimistic-lock: FOR UPDATE stock_quant rồi so với tồn THẬT.
    describe('optimistic lock (expectedCurrentQty)', () => {
      it('không truyền expectedCurrentQty - giữ nguyên hành vi cũ, không mở transaction/khoá gì thêm', async () => {
        prisma.stockLedger.findUnique.mockResolvedValue(null);
        prisma.stockLedger.create.mockResolvedValue(ledgerRow());

        await service.adjust(
          { fromWarehouseId: '1', toWarehouseId: '2', materialId: '10', qty: 5, note: 'kiểm kê' },
          'idem-key-4',
          'user-1',
          null,
        );

        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.$queryRaw).not.toHaveBeenCalled();
        expect(prisma.stockLedger.create).toHaveBeenCalled();
      });

      it('cho qua khi tồn thật KHỚP expectedCurrentQty', async () => {
        prisma.$queryRaw.mockResolvedValue([{ qty: { toNumber: () => 100 } }]);
        prisma.stockLedger.findUnique.mockResolvedValue(null);
        prisma.stockLedger.create.mockResolvedValue(ledgerRow());

        await service.adjust(
          {
            fromWarehouseId: '3', // kho ảo opening-balance
            toWarehouseId: '2', // kho thật
            materialId: '10',
            qty: 10,
            note: 'kiểm kê',
            expectedWarehouseId: '2',
            expectedCurrentQty: 100,
          },
          'idem-key-5',
          'user-1',
          null,
        );

        expect(prisma.$transaction).toHaveBeenCalled();
        expect(prisma.stockLedger.create).toHaveBeenCalled();
      });

      it('CHẶN (409) khi tồn thật LỆCH expectedCurrentQty - người khác vừa sửa xong, không được cộng dồn sai', async () => {
        prisma.$queryRaw.mockResolvedValue([{ qty: { toNumber: () => 95 } }]); // ai đó vừa trừ về 95
        prisma.stockLedger.findUnique.mockResolvedValue(null);

        await expect(
          service.adjust(
            {
              fromWarehouseId: '3',
              toWarehouseId: '2',
              materialId: '10',
              qty: 10,
              note: 'kiểm kê',
              expectedWarehouseId: '2',
              expectedCurrentQty: 100, // client vẫn thấy 100 (đã cũ)
            },
            'idem-key-6',
            'user-1',
            null,
          ),
        ).rejects.toThrow(ConflictException);
        expect(prisma.stockLedger.create).not.toHaveBeenCalled();
      });

      it('CHẶN (400) khi expectedWarehouseId không trùng fromWarehouseId hoặc toWarehouseId', async () => {
        await expect(
          service.adjust(
            {
              fromWarehouseId: '1',
              toWarehouseId: '2',
              materialId: '10',
              qty: 10,
              note: 'kiểm kê',
              expectedWarehouseId: '999',
              expectedCurrentQty: 100,
            },
            'idem-key-7',
            'user-1',
            null,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('mặc định expectedWarehouseId = fromWarehouseId khi không truyền', async () => {
        prisma.$queryRaw.mockResolvedValue([{ qty: { toNumber: () => 100 } }]);
        prisma.stockLedger.findUnique.mockResolvedValue(null);
        prisma.stockLedger.create.mockResolvedValue(ledgerRow());

        await service.adjust(
          {
            fromWarehouseId: '2',
            toWarehouseId: '3',
            materialId: '10',
            qty: 5,
            note: 'kiểm kê',
            expectedCurrentQty: 100,
          },
          'idem-key-8',
          'user-1',
          null,
        );

        expect(prisma.$queryRaw).toHaveBeenCalled();
        expect(prisma.stockLedger.create).toHaveBeenCalled();
      });
    });
  });

  describe('findAll', () => {
    it('filters by warehouseId on either leg (from OR to)', async () => {
      prisma.stockLedger.findMany.mockResolvedValue([ledgerRow()]);
      prisma.stockLedger.count.mockResolvedValue(1);

      await service.findAll({
        page: 1,
        limit: 20,
        sortOrder: 'desc' as never,
        warehouseId: '1',
      } as never);

      expect(prisma.stockLedger.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
          where: expect.objectContaining({
            OR: [{ fromWarehouseId: 1n }, { toWarehouseId: 1n }],
          }),
        }),
      );
    });

    // 2026-09-12 (màn "Lịch sử kho"): tên/ĐVT vật tư, tên kho và chiều dài cây đã nằm sẵn trong
    // LEDGER_INCLUDE nhưng trước đây DTO không trả ra - màn lịch sử chỉ hiện được mã trần, không
    // biết "5" là 5 cây hay 5 kg, cũng không phân biệt được 2 lô cùng mã sắt khác chiều dài.
    it('trả kèm tên/ĐVT vật tư, tên 2 kho và chiều dài cây', async () => {
      prisma.stockLedger.findMany.mockResolvedValue([ledgerRow()]);
      prisma.stockLedger.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 20, sortOrder: 'desc' } as never);

      expect(result.data[0]).toEqual(
        expect.objectContaining({
          materialCode: 'SAT-25',
          materialName: 'Sắt hộp 25x50',
          materialUnit: 'cây',
          fromWarehouseName: 'Phoi Son Han',
          toWarehouseName: 'Vat tu TP',
          stockLengthMm: 6000,
        }),
      );
    });

    // Cột "Chứng từ" ở màn Lịch sử kho: CHỈ WarehouseTransfer có `code` đọc được, nguồn khác chỉ có
    // id số nên refCode = null (FE hiện nhãn loại chứng từ thay thế).
    it('tra mã phiếu ("CK-2026-010") cho bút toán chuyển kho, 1 query cho cả trang', async () => {
      prisma.stockLedger.findMany.mockResolvedValue([
        ledgerRow({ refType: StockLedgerRefType.WAREHOUSE_TRANSFER, refId: '77' }),
        ledgerRow({ id: 101n, refType: StockLedgerRefType.WAREHOUSE_TRANSFER, refId: '77' }),
        ledgerRow({ id: 102n, refType: StockLedgerRefType.STEEL_ISSUE, refId: '5' }),
      ]);
      prisma.stockLedger.count.mockResolvedValue(3);
      prisma.warehouseTransfer.findMany.mockResolvedValue([{ id: 77n, code: 'CK-2026-010' }]);

      const result = await service.findAll({ page: 1, limit: 20, sortOrder: 'desc' } as never);

      expect(result.data[0].refCode).toBe('CK-2026-010');
      expect(result.data[1].refCode).toBe('CK-2026-010');
      // Xuất sắt không có mã phiếu -> null, và KHÔNG bị tra nhầm sang bảng chuyển kho.
      expect(result.data[2].refCode).toBeNull();
      expect(prisma.warehouseTransfer.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.warehouseTransfer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: [77n] } } }),
      );
    });

    // "Đến: Tổ Phôi" thay vì chung chung "Xưởng sản xuất" - chỉ 2 refType có cột stage thật, các
    // loại khác tổ cố định theo nghiệp vụ nên FE tự suy (không query thừa).
    it('tra đúng tổ (stage) cho bút toán tiêu hao đoạn sắt và xuất vật tư tiêu hao', async () => {
      prisma.stockLedger.findMany.mockResolvedValue([
        ledgerRow({ refType: StockLedgerRefType.SEGMENT_CONSUME, refId: '9' }),
        ledgerRow({ id: 101n, refType: StockLedgerRefType.MATERIAL_ISSUE, refId: '4' }),
        ledgerRow({ id: 102n, refType: StockLedgerRefType.STEEL_ISSUE, refId: '5' }),
      ]);
      prisma.stockLedger.count.mockResolvedValue(3);
      prisma.productionBatch.findMany.mockResolvedValue([{ id: 9n, stage: 'HAN' }]);
      prisma.materialIssue.findMany.mockResolvedValue([{ id: 4n, stage: 'SON' }]);

      const result = await service.findAll({ page: 1, limit: 20, sortOrder: 'desc' } as never);

      expect(result.data[0].refStage).toBe('HAN');
      expect(result.data[1].refStage).toBe('SON');
      // Xuất sắt không có cột stage -> null (FE tự suy "Tổ Phôi").
      expect(result.data[2].refStage).toBeNull();
    });

    it('không query bảng chuyển kho khi trang không có bút toán chuyển kho nào', async () => {
      prisma.stockLedger.findMany.mockResolvedValue([ledgerRow()]);
      prisma.stockLedger.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 20, sortOrder: 'desc' } as never);

      expect(result.data[0].refCode).toBeNull();
      expect(prisma.warehouseTransfer.findMany).not.toHaveBeenCalled();
    });

    // Cột "Mã đơn hàng (PO)" ở màn Lịch sử kho (2026-09-12, theo yêu cầu Sếp) - tra
    // productionOrder.productionInvoiceItem.salesOrder.orderCode cho refType đi qua 1 Lệnh sản
    // xuất cụ thể; STEEL_ISSUE đi thẳng productionInvoice.salesOrder (không qua ProductionOrder).
    it('tra mã đơn hàng (PO) cho bút toán gắn với 1 Lệnh sản xuất cụ thể', async () => {
      prisma.stockLedger.findMany.mockResolvedValue([
        ledgerRow({ refType: StockLedgerRefType.MATERIAL_ISSUE, refId: '4' }),
        ledgerRow({ id: 101n, refType: StockLedgerRefType.STEEL_ISSUE, refId: '5' }),
        ledgerRow({ id: 102n, refType: StockLedgerRefType.PURCHASE, refId: null }),
      ]);
      prisma.stockLedger.count.mockResolvedValue(3);
      prisma.materialIssue.findMany.mockResolvedValue([
        {
          id: 4n,
          productionOrder: { productionInvoiceItem: { salesOrder: { orderCode: 'PO-KH-014' } } },
        },
      ]);
      prisma.steelIssue.findMany.mockResolvedValue([
        { id: 5n, productionInvoice: { salesOrder: null } },
      ]);

      const result = await service.findAll({ page: 1, limit: 20, sortOrder: 'desc' } as never);

      expect(result.data[0].poCode).toBe('PO-KH-014');
      // PI gộp (salesOrder null ở productionInvoice) -> không tra được, trả null thay vì lỗi.
      expect(result.data[1].poCode).toBeNull();
      // refType không gắn Lệnh sản xuất nào (mua hàng) -> null, không query gì thêm cho nó.
      expect(result.data[2].poCode).toBeNull();
    });

    // Cột "Lệnh sản xuất" ở màn Lịch sử kho (2026-09-12, theo yêu cầu Sếp) - "Lệnh sản xuất" LÀ
    // ProductionInvoice/PI trong toàn hệ thống, KHÁC poCode (SalesOrder.orderCode) ở test trên.
    it('tra mã Lệnh sản xuất (PI code) cho bút toán gắn với 1 PI cụ thể', async () => {
      prisma.stockLedger.findMany.mockResolvedValue([
        ledgerRow({ refType: StockLedgerRefType.MATERIAL_ISSUE, refId: '4' }),
        ledgerRow({ id: 101n, refType: StockLedgerRefType.STEEL_ISSUE, refId: '5' }),
        ledgerRow({ id: 102n, refType: StockLedgerRefType.PURCHASE, refId: null }),
      ]);
      prisma.stockLedger.count.mockResolvedValue(3);
      prisma.materialIssue.findMany.mockResolvedValue([
        {
          id: 4n,
          productionOrder: {
            productionInvoiceItem: { productionInvoice: { code: 'PI-2026-005' } },
          },
        },
      ]);
      prisma.steelIssue.findMany.mockResolvedValue([
        { id: 5n, productionInvoice: { code: 'PI-2026-001' } },
      ]);

      const result = await service.findAll({ page: 1, limit: 20, sortOrder: 'desc' } as never);

      expect(result.data[0].piCode).toBe('PI-2026-005');
      expect(result.data[1].piCode).toBe('PI-2026-001');
      // refType không gắn Lệnh sản xuất nào (mua hàng) -> null.
      expect(result.data[2].piCode).toBeNull();
    });
  });
});
