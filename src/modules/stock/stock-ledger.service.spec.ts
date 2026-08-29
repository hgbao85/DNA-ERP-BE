import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma, StockLedgerRefType } from '../../generated/prisma/client';
import { MATERIAL_GROUP_SYSTEM_KEYS } from '../../common/constants/material-group-system-keys.constant';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { StockLedgerService } from './stock-ledger.service';
import { StockReservationsService } from './stock-reservations.service';

describe('StockLedgerService', () => {
  let service: StockLedgerService;
  let prisma: {
    stockLedger: {
      findUnique: jest.Mock;
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    warehouse: { findMany: jest.Mock; findUniqueOrThrow: jest.Mock };
    material: { findUnique: jest.Mock };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let stockReservationsService: { getAvailableQty: jest.Mock };

  const fromWh = { id: 1n, code: 'phoi-son-han', name: 'Phoi Son Han' };
  const toWh = { id: 2n, code: 'vat-tu-tp', name: 'Vat tu TP' };
  const openingBalanceWh = { id: 3n, code: 'OPENING_BALANCE', name: 'Opening Balance' };
  const material = { id: 10n, code: 'SAT-25' };

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
      warehouse: {
        findMany: jest.fn().mockResolvedValue([fromWh, toWh]),
        findUniqueOrThrow: jest.fn().mockResolvedValue(openingBalanceWh),
      },
      // Mặc định null (không phải STEEL_BAR) -> resolveAdjustStockLengthMm() trả về 0 khi test
      // không truyền dto.stockLengthMm, giữ đúng hành vi cũ của mọi test adjust() có sẵn.
      material: { findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([{ qty: { toNumber: () => 100 } }]),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(prisma))),
    };
    // available mặc định = onHand (không giữ chỗ gì) - test rebucket() riêng ghi đè khi cần.
    stockReservationsService = {
      getAvailableQty: jest.fn((_tx, _wh, _mat, _bucket, onHand: number) =>
        Promise.resolve(onHand),
      ),
    };
    service = new StockLedgerService(
      prisma as unknown as PrismaServiceType,
      stockReservationsService as unknown as StockReservationsService,
    );
  });

  describe('postEntry - XOR 4 chân hàng', () => {
    it('rejects when no goods leg is set', async () => {
      await expect(
        service.postEntry({
          fromWarehouseId: 1n,
          toWarehouseId: 2n,
          stockLengthMm: 0,
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
          stockLengthMm: 0,
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
          stockLengthMm: 0,
          qty: 5,
          refType: StockLedgerRefType.ADJUST,
        }),
      ).resolves.toBeDefined();
    });

    it('rejects stockLengthMm khác 0 khi không có materialId (mirror CHECK constraint)', async () => {
      await expect(
        service.postEntry({
          fromWarehouseId: 1n,
          toWarehouseId: 2n,
          pieceId: 12n,
          stockLengthMm: 6000,
          qty: 5,
          refType: StockLedgerRefType.ADJUST,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.stockLedger.create).not.toHaveBeenCalled();
    });
  });

  describe('postEntry - business rules', () => {
    it('rejects fromWarehouseId === toWarehouseId', async () => {
      await expect(
        service.postEntry({
          fromWarehouseId: 1n,
          toWarehouseId: 1n,
          materialId: 10n,
          stockLengthMm: 0,
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
          stockLengthMm: 0,
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
        stockLengthMm: 0,
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
        stockLengthMm: 0,
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
        stockLengthMm: 0,
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
          stockLengthMm: 0,
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

    // Kế hoạch "chiều dài cây sắt" 2026-08-29, Bước 2 - quyết định thiết kế #4: vật tư nhóm
    // STEEL_BAR bị ép chọn rõ bucket, KHÔNG mặc định về 0 (khác mọi vật tư thường).
    describe('stockLengthMm', () => {
      it('CHẶN khi vật tư nhóm STEEL_BAR không truyền stockLengthMm - không được mặc định 0', async () => {
        prisma.material.findUnique.mockResolvedValue({
          id: 10n,
          code: 'SAT-25',
          materialGroup: { systemKey: MATERIAL_GROUP_SYSTEM_KEYS.STEEL_BAR },
        });

        await expect(
          service.adjust(
            { fromWarehouseId: '1', toWarehouseId: '2', materialId: '10', qty: 5, note: 'kiểm kê' },
            'idem-key-steel-1',
            'user-1',
            null,
          ),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.stockLedger.create).not.toHaveBeenCalled();
      });

      it('CHO QUA khi vật tư nhóm STEEL_BAR có truyền rõ stockLengthMm, ghi đúng bucket đó', async () => {
        prisma.material.findUnique.mockResolvedValue({
          id: 10n,
          code: 'SAT-25',
          materialGroup: { systemKey: MATERIAL_GROUP_SYSTEM_KEYS.STEEL_BAR },
        });
        prisma.stockLedger.findUnique.mockResolvedValue(null);
        prisma.stockLedger.create.mockResolvedValue(ledgerRow());

        await service.adjust(
          {
            fromWarehouseId: '1',
            toWarehouseId: '2',
            materialId: '10',
            stockLengthMm: 6000,
            qty: 5,
            note: 'kiểm kê',
          },
          'idem-key-steel-2',
          'user-1',
          null,
        );

        expect(prisma.stockLedger.create).toHaveBeenCalledWith(
          expect.objectContaining({
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
            data: expect.objectContaining({ stockLengthMm: 6000 }),
          }),
        );
      });

      it('vật tư thường (không phải STEEL_BAR) không truyền stockLengthMm - mặc định 0 như cũ', async () => {
        prisma.stockLedger.findUnique.mockResolvedValue(null);
        prisma.stockLedger.create.mockResolvedValue(ledgerRow());

        await service.adjust(
          { fromWarehouseId: '1', toWarehouseId: '2', materialId: '10', qty: 5, note: 'kiểm kê' },
          'idem-key-normal',
          'user-1',
          null,
        );

        expect(prisma.stockLedger.create).toHaveBeenCalledWith(
          expect.objectContaining({
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
            data: expect.objectContaining({ stockLengthMm: 0 }),
          }),
        );
      });

      it('optimistic lock: câu FOR UPDATE khoá ĐÚNG bucket đang sửa, không lẫn bucket khác của cùng vật tư', async () => {
        prisma.$queryRaw.mockResolvedValue([{ qty: { toNumber: () => 100 } }]);
        prisma.stockLedger.findUnique.mockResolvedValue(null);
        prisma.stockLedger.create.mockResolvedValue(ledgerRow());

        await service.adjust(
          {
            fromWarehouseId: '3',
            toWarehouseId: '2',
            materialId: '10',
            stockLengthMm: 6000,
            qty: 10,
            note: 'kiểm kê',
            expectedWarehouseId: '2',
            expectedCurrentQty: 100,
          },
          'idem-key-bucket',
          'user-1',
          null,
        );

        // $queryRaw gọi kiểu tagged-template - mock nhận (mảng chuỗi, ...giá trị nội suy). Giá trị
        // cuối cùng nội suy vào câu SQL phải đúng bucket 6000, không phải 0/bucket khác.
        const call = prisma.$queryRaw.mock.calls[0] as unknown[];
        expect(call[call.length - 1]).toBe(6000);
      });
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
  });

  // Bước 8 (kế hoạch "chiều dài cây sắt" 2026-08-29) - công cụ thủ kho khai lại cỡ cây cho tồn cũ.
  describe('rebucket', () => {
    beforeEach(() => {
      prisma.stockLedger.create.mockResolvedValue(ledgerRow());
    });

    it('ghi đúng 2 bút toán (xuất bucket cũ ra OPENING_BALANCE, nhập lại bucket mới) khi đủ tồn khả dụng', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ qty: { toNumber: () => 50 } }]) // bucket 0 (thấp hơn) - nguồn
        .mockResolvedValueOnce([{ qty: { toNumber: () => 0 } }]); // bucket 6000 (cao hơn) - đích

      const result = await service.rebucket(
        {
          warehouseId: '2',
          materialId: '10',
          fromStockLengthMm: 0,
          toStockLengthMm: 6000,
          qty: 10,
          note: 'kiểm kê 2026-09-01',
        },
        'idem-rebucket-1',
        'user-1',
        null,
      );

      expect(prisma.warehouse.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { code: 'OPENING_BALANCE' },
      });
      expect(prisma.stockLedger.create).toHaveBeenCalledTimes(2);
      expect(prisma.stockLedger.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
          data: expect.objectContaining({
            fromWarehouse: { connect: { id: 2n } },
            toWarehouse: { connect: { id: 3n } },
            stockLengthMm: 0,
            qty: 10,
            idempotencyKey: 'idem-rebucket-1:out',
          }),
        }),
      );
      expect(prisma.stockLedger.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
          data: expect.objectContaining({
            fromWarehouse: { connect: { id: 3n } },
            toWarehouse: { connect: { id: 2n } },
            stockLengthMm: 6000,
            qty: 10,
            idempotencyKey: 'idem-rebucket-1:in',
          }),
        }),
      );
      expect(result.from).toBeDefined();
      expect(result.to).toBeDefined();
    });

    // Không tự viết lại phép trừ - gọi thẳng StockReservationsService.getAvailableQty() (docstring
    // hàm đó: "ĐÚNG MỘT hàm được phép cộng 2 bảng"). Case cần chặn: PI dở dang đang giữ chỗ ACTIVE
    // ở bucket nguồn không được rút mất phần đã hứa.
    it('ném ConflictException khi khai vượt phần CHƯA bị giữ chỗ', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ qty: { toNumber: () => 50 } }])
        .mockResolvedValueOnce([{ qty: { toNumber: () => 0 } }]);
      stockReservationsService.getAvailableQty.mockResolvedValue(3); // 50 tồn, chỉ 3 chưa bị giữ chỗ

      await expect(
        service.rebucket(
          {
            warehouseId: '2',
            materialId: '10',
            fromStockLengthMm: 0,
            toStockLengthMm: 6000,
            qty: 10,
            note: 'kiểm kê',
          },
          'idem-rebucket-2',
          'user-1',
          null,
        ),
      ).rejects.toThrow(ConflictException);
      expect(prisma.stockLedger.create).not.toHaveBeenCalled();
    });

    it('ném BadRequestException khi fromStockLengthMm === toStockLengthMm (không có gì để khai lại)', async () => {
      await expect(
        service.rebucket(
          {
            warehouseId: '2',
            materialId: '10',
            fromStockLengthMm: 6000,
            toStockLengthMm: 6000,
            qty: 10,
            note: 'kiểm kê',
          },
          'idem-rebucket-3',
          'user-1',
          null,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.stockLedger.create).not.toHaveBeenCalled();
    });

    it('khoá 2 bucket theo thứ tự TĂNG DẦN bất kể from/to truyền theo chiều nào (chống deadlock)', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ qty: { toNumber: () => 0 } }]) // bucket thấp hơn (0) - khoá trước
        .mockResolvedValueOnce([{ qty: { toNumber: () => 20 } }]); // bucket cao hơn (6000) - khoá sau

      // Truyền NGƯỢC chiều: from=6000 (cao) -> to=0 (thấp) - vẫn phải khoá bucket 0 trước.
      await service.rebucket(
        {
          warehouseId: '2',
          materialId: '10',
          fromStockLengthMm: 6000,
          toStockLengthMm: 0,
          qty: 5,
          note: 'kiểm kê',
        },
        'idem-rebucket-4',
        'user-1',
        null,
      );

      const firstCallValues = prisma.$queryRaw.mock.calls[0] as unknown[];
      const secondCallValues = prisma.$queryRaw.mock.calls[1] as unknown[];
      expect(firstCallValues[firstCallValues.length - 1]).toBe(0);
      expect(secondCallValues[secondCallValues.length - 1]).toBe(6000);
    });
  });
});
