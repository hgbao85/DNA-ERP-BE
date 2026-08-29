import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MfgRole, MfgStage, StockLedgerRefType } from '../../generated/prisma/client';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { ProductionBatchesService } from './production-batches.service';

describe('ProductionBatchesService', () => {
  let service: ProductionBatchesService;
  let prisma: {
    productionBatch: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
    };
    productionOrder: { findUnique: jest.Mock };
    bomPiece: { findUnique: jest.Mock; findMany: jest.Mock };
    pieceBom: { findMany: jest.Mock };
    pieceMaterialYield: { findUnique: jest.Mock; findMany: jest.Mock };
    stockQuant: { findMany: jest.Mock };
    warehouseTransferPieceItem: { findMany: jest.Mock };
    warehouse: { findUniqueOrThrow: jest.Mock };
    $transaction: jest.Mock;
  };
  let stockLedgerService: { postEntry: jest.Mock };

  const order = {
    id: 1n,
    poNumber: 'PO-31-1',
    bomRevisionId: 5n,
    quantity: 10,
    mfgProduct: { name: 'SP-1' },
    productionInvoiceItem: { salesOrder: { code: 'PO-31' } },
  };
  const piece = { id: 40n, code: 'MANH-TUA', name: 'Mảnh tựa' };
  const bomPieceRow = {
    id: 1n,
    bomRevisionId: 5n,
    pieceId: 40n,
    qtyPerUnit: 2,
    needsHan: true,
    needsSon: true,
  };
  const steelWarehouse = { id: 90n, code: 'phoi-son-han' };
  const productionWarehouse = { id: 91n, code: 'PRODUCTION' };

  const batchRow = {
    id: 700n,
    stage: MfgStage.HAN,
    productionOrderId: 1n,
    pieceId: 40n,
    reportedQty: 20,
    status: 'AWAITING_QC',
    idempotencyKey: null,
    reportedAt: new Date(),
    reportedById: 'user-han',
    reworkOfId: null,
    productionOrder: order,
    piece,
  };

  beforeEach(() => {
    prisma = {
      productionBatch: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
      },
      productionOrder: { findUnique: jest.fn().mockResolvedValue(order) },
      bomPiece: {
        findUnique: jest.fn().mockResolvedValue(bomPieceRow),
        findMany: jest.fn().mockResolvedValue([{ ...bomPieceRow, piece }]),
      },
      // Mặc định rỗng - đa số test case không quan tâm tới nhánh trừ tồn đoạn (mục "Trừ tồn đoạn
      // sắt (SEGMENT_CONSUME)" bên dưới mới override).
      pieceBom: { findMany: jest.fn().mockResolvedValue([]) },
      // Mặc định rỗng - đa số test case không quan tâm tới nhánh vật tư thành phẩm (định mức
      // PieceMaterialYield, xem mục "trừ tồn nguyên liệu" bên dưới mới override).
      pieceMaterialYield: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      stockQuant: { findMany: jest.fn().mockResolvedValue([]) },
      warehouseTransferPieceItem: { findMany: jest.fn().mockResolvedValue([]) },
      warehouse: {
        findUniqueOrThrow: jest
          .fn()
          .mockImplementation(({ where: { code } }: { where: { code: string } }) =>
            Promise.resolve(code === 'phoi-son-han' ? steelWarehouse : productionWarehouse),
          ),
      },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(prisma))),
    };
    stockLedgerService = { postEntry: jest.fn().mockResolvedValue({}) };
    service = new ProductionBatchesService(
      prisma as unknown as PrismaServiceType,
      stockLedgerService as unknown as StockLedgerService,
    );
  });

  describe('create', () => {
    const dto = { stage: MfgStage.HAN, pieceId: '40', reportedQty: 20 };

    it('happy path - mfgRole null (quản lý) tạo lô mới', async () => {
      prisma.productionBatch.create.mockResolvedValue(batchRow);

      const result = await service.create('1', dto, 'user-han', null);

      expect(prisma.productionBatch.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({
            stage: MfgStage.HAN,
            productionOrderId: 1n,
            pieceId: 40n,
            reportedQty: 20,
          }),
        }),
      );
      expect(result.id).toBe('700');
    });

    it('idempotency short-circuit - trả về lô cũ, không tạo mới, nhưng vẫn gọi lại postSegmentConsumeEntries (retry-safety)', async () => {
      prisma.productionBatch.findUnique.mockResolvedValue(batchRow);
      prisma.pieceBom.findMany.mockResolvedValue([
        { id: 1n, bomRevisionId: 5n, pieceId: 40n, segmentSpecId: 60n, qtyPerPiece: 3 },
      ]);

      const result = await service.create('1', dto, 'user-han', null, 'idem-key-1');

      expect(prisma.productionBatch.create).not.toHaveBeenCalled();
      expect(result.id).toBe('700');
      // Xem describe('trừ tồn đoạn sắt (SEGMENT_CONSUME)') bên dưới cho assertion đầy đủ của
      // postEntry - test này chỉ xác nhận retry-safety (vẫn gọi lại dù không tạo bản ghi mới).
      expect(stockLedgerService.postEntry).toHaveBeenCalled();
    });

    it('cho phép mfgRole khớp đúng stage (HAN)', async () => {
      prisma.productionBatch.create.mockResolvedValue(batchRow);
      await expect(service.create('1', dto, 'user-han', MfgRole.HAN)).resolves.toBeDefined();
    });

    it('ném ForbiddenException khi mfgRole không khớp stage (SON báo hộ HAN)', async () => {
      await expect(service.create('1', dto, 'user-son', MfgRole.SON)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.productionBatch.create).not.toHaveBeenCalled();
    });

    it('ném BadRequestException khi stage không phải PHOI/HAN/SON', async () => {
      await expect(
        service.create('1', { ...dto, stage: MfgStage.DAN }, 'user-1', null),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.productionBatch.create).not.toHaveBeenCalled();
    });

    // Thêm 21/08/2026: PHOI giờ là stage hợp lệ thứ 3, dành riêng cho mảnh needsHan=false ("vật
    // tư thành phẩm", vd chân nhôm - cắt xong là hết, không hàn). Xem
    // WarehouseTransfersService.getPieceTransferPlan() cho lý do cần luồng này (trước đây
    // needsHan=false hoàn toàn không có cách nào báo/chuyển kho).
    describe('stage PHOI - "vật tư thành phẩm" (needsHan=false)', () => {
      const phoiDto = { stage: MfgStage.PHOI, pieceId: '40', reportedQty: 20 };
      const phoiBatchRow = { ...batchRow, stage: MfgStage.PHOI, reportedById: 'user-phoi' };

      it('ném BadRequestException khi báo PHOI cho mảnh needsHan=true (mảnh thường, phải qua Hàn)', async () => {
        await expect(service.create('1', phoiDto, 'user-phoi', null)).rejects.toThrow(
          BadRequestException,
        );
        expect(prisma.productionBatch.create).not.toHaveBeenCalled();
      });

      it('happy path - báo PHOI cho mảnh needsHan=false thành công', async () => {
        prisma.bomPiece.findUnique.mockResolvedValue({
          ...bomPieceRow,
          needsHan: false,
          needsSon: false,
        });
        prisma.productionBatch.create.mockResolvedValue(phoiBatchRow);

        const result = await service.create('1', phoiDto, 'user-phoi', null);

        expect(prisma.productionBatch.create).toHaveBeenCalledWith(
          expect.objectContaining({
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
            data: expect.objectContaining({ stage: MfgStage.PHOI, pieceId: 40n, reportedQty: 20 }),
          }),
        );
        expect(result.id).toBe('700');
      });

      it('cho phép mfgRole khớp đúng stage (PHOI)', async () => {
        prisma.bomPiece.findUnique.mockResolvedValue({
          ...bomPieceRow,
          needsHan: false,
          needsSon: false,
        });
        prisma.productionBatch.create.mockResolvedValue(phoiBatchRow);
        await expect(
          service.create('1', phoiDto, 'user-phoi', MfgRole.PHOI),
        ).resolves.toBeDefined();
      });

      it('ném ForbiddenException khi mfgRole không khớp stage (HAN báo hộ PHOI)', async () => {
        await expect(service.create('1', phoiDto, 'user-han', MfgRole.HAN)).rejects.toThrow(
          ForbiddenException,
        );
        expect(prisma.productionBatch.create).not.toHaveBeenCalled();
      });

      // 2026-08-22: "pat" - needsHan=true NHƯNG có PieceMaterialYield (cắt từ tấm sắt lá theo tỷ
      // lệ cố định) - vẫn báo được ở PHOI (bước cắt), khác hẳn mảnh sắt bin-packing thường
      // (needsHan=true, KHÔNG có PieceMaterialYield) vẫn bị chặn ở test đầu tiên phía trên.
      it('cho phép báo PHOI cho piece needsHan=true CÓ PieceMaterialYield ("pat", vẫn cần Hàn sau khi cắt)', async () => {
        prisma.bomPiece.findUnique.mockResolvedValue({ ...bomPieceRow, needsHan: true });
        prisma.pieceMaterialYield.findUnique.mockResolvedValue({
          id: 5n,
          bomRevisionId: 5n,
          pieceId: 40n,
          materialId: 90n,
          piecesPerBar: 6,
          material: { warehouse: { id: 96n, code: 'kho-tam-sat-la' } },
        });
        prisma.productionBatch.create.mockResolvedValue(phoiBatchRow);

        await expect(service.create('1', phoiDto, 'user-phoi', null)).resolves.toBeDefined();
        expect(prisma.productionBatch.create).toHaveBeenCalled();
      });
    });

    it('ném NotFoundException khi production order không tồn tại', async () => {
      prisma.productionOrder.findUnique.mockResolvedValue(null);
      await expect(service.create('1', dto, 'user-han', null)).rejects.toThrow(NotFoundException);
    });

    it('ném NotFoundException khi mảnh không thuộc BOM của lệnh sản xuất này', async () => {
      prisma.bomPiece.findUnique.mockResolvedValue(null);
      await expect(service.create('1', dto, 'user-han', null)).rejects.toThrow(NotFoundException);
    });

    it('ném BadRequestException khi mảnh không cần qua đúng stage (needsHan=false báo HAN)', async () => {
      prisma.bomPiece.findUnique.mockResolvedValue({ ...bomPieceRow, needsHan: false });
      await expect(service.create('1', dto, 'user-han', null)).rejects.toThrow(BadRequestException);
      expect(prisma.productionBatch.create).not.toHaveBeenCalled();
    });

    it('ném BadRequestException khi mảnh không cần qua đúng stage (needsSon=false báo SON)', async () => {
      prisma.bomPiece.findUnique.mockResolvedValue({ ...bomPieceRow, needsSon: false });
      await expect(
        service.create('1', { ...dto, stage: MfgStage.SON }, 'user-son', null),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.productionBatch.create).not.toHaveBeenCalled();
    });
  });

  describe('create - trừ tồn đoạn sắt (SEGMENT_CONSUME)', () => {
    const dto = { stage: MfgStage.HAN, pieceId: '40', reportedQty: 20 };

    it('không có PieceBom nào cho mảnh - không gọi postEntry, không query warehouse', async () => {
      prisma.productionBatch.create.mockResolvedValue(batchRow);
      prisma.pieceBom.findMany.mockResolvedValue([]);

      await service.create('1', dto, 'user-han', null);

      expect(prisma.pieceBom.findMany).toHaveBeenCalledWith({
        where: { bomRevisionId: order.bomRevisionId, pieceId: 40n },
      });
      expect(prisma.warehouse.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    it('1 PieceBom - ghi đúng 1 dòng StockLedger, qty = qtyPerPiece × reportedQty', async () => {
      prisma.productionBatch.create.mockResolvedValue(batchRow);
      prisma.pieceBom.findMany.mockResolvedValue([
        { id: 1n, bomRevisionId: 5n, pieceId: 40n, segmentSpecId: 60n, qtyPerPiece: 3 },
      ]);

      await service.create('1', dto, 'user-han', null);

      expect(stockLedgerService.postEntry).toHaveBeenCalledTimes(1);
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        {
          fromWarehouseId: steelWarehouse.id,
          toWarehouseId: productionWarehouse.id,
          segmentSpecId: 60n,
          stockLengthMm: 0,
          qty: 60, // 3 × reportedQty(20)
          refType: StockLedgerRefType.SEGMENT_CONSUME,
          refId: '700',
          createdById: 'user-han',
          idempotencyKey: 'production-batch-segment-consume:700:60',
        },
        prisma, // tx - create() + postSegmentConsumeEntries giờ chạy trong cùng $transaction
      );
    });

    it('nhiều PieceBom (1 mảnh ghép từ nhiều cỡ đoạn) - ghi đủ N dòng StockLedger, mỗi dòng đúng segmentSpecId/qty riêng', async () => {
      prisma.productionBatch.create.mockResolvedValue(batchRow);
      prisma.pieceBom.findMany.mockResolvedValue([
        { id: 1n, bomRevisionId: 5n, pieceId: 40n, segmentSpecId: 60n, qtyPerPiece: 3 },
        { id: 2n, bomRevisionId: 5n, pieceId: 40n, segmentSpecId: 61n, qtyPerPiece: 1 },
      ]);

      await service.create('1', dto, 'user-han', null);

      expect(stockLedgerService.postEntry).toHaveBeenCalledTimes(2);
      expect(stockLedgerService.postEntry).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ segmentSpecId: 60n, qty: 60 }),
        prisma,
      );
      expect(stockLedgerService.postEntry).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ segmentSpecId: 61n, qty: 20 }),
        prisma,
      );
    });

    it('postEntry lỗi giữa chừng (dòng 2/3) - lỗi propagate ra ngoài, không nuốt (transaction bao ngoài sẽ rollback cả productionBatch.create)', async () => {
      prisma.productionBatch.create.mockResolvedValue(batchRow);
      prisma.pieceBom.findMany.mockResolvedValue([
        { id: 1n, bomRevisionId: 5n, pieceId: 40n, segmentSpecId: 60n, qtyPerPiece: 3 },
        { id: 2n, bomRevisionId: 5n, pieceId: 40n, segmentSpecId: 61n, qtyPerPiece: 1 },
      ]);
      stockLedgerService.postEntry
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('mất kết nối DB giữa chừng'));

      await expect(service.create('1', dto, 'user-han', null)).rejects.toThrow(
        'mất kết nối DB giữa chừng',
      );
      // create() + postSegmentConsumeEntries chạy trong CÙNG $transaction - lỗi ở dòng ledger thứ
      // 2 phải làm cả gọi $transaction() reject (Prisma thật sẽ rollback productionBatch.create
      // theo cùng cơ chế), không được để lộ ra thành công một phần.
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    // Quyết định nghiệp vụ #6 (docs/quy-doi-doan-phoi.md): tồn đoạn được phép âm khi báo sản
    // lượng vượt tồn thực tế. Không có test riêng cho "tồn không đủ" ở tầng unit vì service
    // KHÔNG gọi StockQuant để kiểm tra số dư trước khi postEntry() - test '1 PieceBom' ở trên
    // đã chứng minh điều này gián tiếp (không có nhánh throw/guard nào giữa lúc query PieceBom
    // và lúc gọi postEntry). Số dư âm thật sự chỉ quan sát được ở StockQuant sau khi trigger DB
    // materialize - thuộc phạm vi test tích hợp/E2E, không phải unit test service này.
  });

  describe('create - trừ tồn nguyên liệu vật tư thành phẩm (MATERIAL_YIELD_CONSUME)', () => {
    const phoiDto = { stage: MfgStage.PHOI, pieceId: '40', reportedQty: 24 };
    const phoiBatchRow = {
      ...batchRow,
      stage: MfgStage.PHOI,
      reportedById: 'user-phoi',
      reportedQty: 24,
    };
    const aluminumWarehouse = { id: 95n, code: 'kho-nhom' };

    beforeEach(() => {
      prisma.bomPiece.findUnique.mockResolvedValue({
        ...bomPieceRow,
        needsHan: false,
        needsSon: false,
      });
      prisma.pieceBom.findMany.mockResolvedValue([]); // rỗng -> rơi vào nhánh PieceMaterialYield
      prisma.productionBatch.create.mockResolvedValue(phoiBatchRow);
    });

    it('không có PieceMaterialYield cho piece - không gọi postEntry', async () => {
      prisma.pieceMaterialYield.findUnique.mockResolvedValue(null);

      await service.create('1', phoiDto, 'user-phoi', null);

      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    it('có PieceMaterialYield - trừ tồn material theo qty = reportedQty / piecesPerBar (phân số, không làm tròn)', async () => {
      prisma.pieceMaterialYield.findUnique.mockResolvedValue({
        materialId: 80n,
        piecesPerBar: 12,
        material: { warehouse: aluminumWarehouse },
      });

      await service.create('1', phoiDto, 'user-phoi', null);

      expect(stockLedgerService.postEntry).toHaveBeenCalledTimes(1);
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        {
          fromWarehouseId: aluminumWarehouse.id,
          toWarehouseId: productionWarehouse.id,
          materialId: 80n,
          stockLengthMm: 0,
          qty: 2, // 24 / 12
          refType: StockLedgerRefType.MATERIAL_YIELD_CONSUME,
          refId: '700',
          createdById: 'user-phoi',
          idempotencyKey: 'production-batch-material-yield-consume:700:80',
        },
        prisma,
      );
    });

    it('vật tư chưa cấu hình Kho - bỏ qua, không gọi postEntry', async () => {
      prisma.pieceMaterialYield.findUnique.mockResolvedValue({
        materialId: 80n,
        piecesPerBar: 12,
        material: { warehouse: null },
      });

      await service.create('1', phoiDto, 'user-phoi', null);

      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    // 2026-08-22: "pat" báo Hàn ở HAN (sau khi đã báo cắt ở PHOI, trừ tồn tấm sắt lá 1 lần rồi) -
    // KHÔNG được trừ tồn nguyên liệu lần 2 dù cũng không có PieceBom (pat không cắt từ đoạn sắt).
    // Trước fix này, postSegmentConsumeEntries không phân biệt stage nên sẽ trừ nhầm ở đây.
    it('KHÔNG trừ tồn nguyên liệu khi báo HAN cho piece không có PieceBom (tránh trừ tồn 2 lần cho "pat")', async () => {
      const hanDto = { stage: MfgStage.HAN, pieceId: '40', reportedQty: 24 };
      const hanBatchRow = { ...batchRow, stage: MfgStage.HAN, reportedQty: 24 };
      prisma.bomPiece.findUnique.mockResolvedValue({ ...bomPieceRow, needsHan: true });
      prisma.productionBatch.create.mockResolvedValue(hanBatchRow);
      // Vẫn có PieceMaterialYield hợp lệ (đã dùng ở PHOI trước đó) - nhưng KHÔNG được đụng tới ở HAN.
      prisma.pieceMaterialYield.findUnique.mockResolvedValue({
        materialId: 80n,
        piecesPerBar: 12,
        material: { warehouse: aluminumWarehouse },
      });

      await service.create('1', hanDto, 'user-han', null);

      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });
  });

  describe('getBatchPlan', () => {
    it('lọc bomPiece theo needsHan=true khi stage=HAN', async () => {
      await service.getBatchPlan('1', MfgStage.HAN);

      expect(prisma.bomPiece.findMany).toHaveBeenCalledWith({
        where: { bomRevisionId: order.bomRevisionId, needsHan: true },
        include: { piece: true },
      });
    });

    it('lọc bomPiece theo needsSon=true khi stage=SON', async () => {
      await service.getBatchPlan('1', MfgStage.SON);

      expect(prisma.bomPiece.findMany).toHaveBeenCalledWith({
        where: { bomRevisionId: order.bomRevisionId, needsSon: true },
        include: { piece: true },
      });
    });

    it('lọc bomPiece theo needsHan=false khi stage=PHOI ("vật tư thành phẩm")', async () => {
      await service.getBatchPlan('1', MfgStage.PHOI);

      expect(prisma.bomPiece.findMany).toHaveBeenCalledWith({
        where: { bomRevisionId: order.bomRevisionId, needsHan: false },
        include: { piece: true },
      });
    });

    it('trả về đúng mảnh khi có needsHan=true (không bị lọc mất)', async () => {
      const result = await service.getBatchPlan('1', MfgStage.HAN);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].pieceId).toBe('40');
    });

    it('stage=HAN không query PieceMaterialYield/StockQuant (rawMaterialOnHand luôn null)', async () => {
      const result = await service.getBatchPlan('1', MfgStage.HAN);

      expect(prisma.pieceMaterialYield.findMany).not.toHaveBeenCalled();
      expect(prisma.stockQuant.findMany).not.toHaveBeenCalled();
      expect(result.items[0].rawMaterialOnHand).toBeNull();
    });

    it('stage=PHOI với piece có PieceMaterialYield - trả rawMaterialOnHand = Σ StockQuant.qty của material đó', async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([
        { pieceId: 40n, materialId: 80n, piecesPerBar: 12 },
      ]);
      prisma.stockQuant.findMany.mockResolvedValue([
        { materialId: 80n, qty: { toNumber: () => 5 } },
        { materialId: 80n, qty: { toNumber: () => 3 } },
      ]);

      const result = await service.getBatchPlan('1', MfgStage.PHOI);

      expect(result.items[0].rawMaterialOnHand).toBe(8);
    });

    it('stage=PHOI không có PieceMaterialYield nào - rawMaterialOnHand null, không query StockQuant', async () => {
      prisma.pieceMaterialYield.findMany.mockResolvedValue([]);

      const result = await service.getBatchPlan('1', MfgStage.PHOI);

      expect(prisma.stockQuant.findMany).not.toHaveBeenCalled();
      expect(result.items[0].rawMaterialOnHand).toBeNull();
    });

    // 2026-08-22: "pat" - piece 41 needsHan=true, KHÔNG nằm trong kết quả needsHan=false, nhưng
    // vẫn phải xuất hiện ở danh sách báo PHOI vì có PieceMaterialYield (cắt từ tấm sắt lá).
    it('stage=PHOI gộp thêm piece needsHan=true CÓ PieceMaterialYield ("pat") vào danh sách, cạnh piece needsHan=false', async () => {
      const patPiece = { id: 41n, code: 'PAT-01', name: 'Pat' };
      const patBomPiece = {
        id: 2n,
        bomRevisionId: 5n,
        pieceId: 41n,
        qtyPerUnit: 3,
        needsHan: true,
        needsSon: false,
        piece: patPiece,
      };
      prisma.bomPiece.findMany
        // Cuộc gọi 1: needsHan=false (mock mặc định đã trả [{...bomPieceRow, piece}] - piece 40)
        .mockResolvedValueOnce([{ ...bomPieceRow, piece }])
        // Cuộc gọi 2 (extra, cho pieceId có yield nhưng chưa nằm trong needsHan=false): trả pat.
        .mockResolvedValueOnce([patBomPiece]);
      prisma.pieceMaterialYield.findMany.mockResolvedValue([
        { pieceId: 41n, materialId: 90n, piecesPerBar: 6 },
      ]);

      const result = await service.getBatchPlan('1', MfgStage.PHOI);

      expect(result.items.map((i) => i.pieceId)).toEqual(['40', '41']);
      expect(prisma.bomPiece.findMany).toHaveBeenNthCalledWith(2, {
        where: { bomRevisionId: order.bomRevisionId, pieceId: { in: [41n] } },
        include: { piece: true },
      });
    });
  });

  describe('getReadyPoolQty', () => {
    it('trả Map rỗng khi truyền mảng pieceIds rỗng - không query gì', async () => {
      const result = await service.getReadyPoolQty([]);

      expect(result.size).toBe(0);
      expect(prisma.productionBatch.findMany).not.toHaveBeenCalled();
    });

    it('gộp Σ reportedQty (QC_DONE, stage=PHOI) TOÀN HỆ THỐNG - không lọc theo productionOrderId, trừ đi phần đã chuyển kho', async () => {
      prisma.productionBatch.findMany.mockResolvedValue([
        { pieceId: 40n, reportedQty: 20 }, // đơn hàng A
        { pieceId: 40n, reportedQty: 15 }, // đơn hàng B khác - vẫn cộng chung 1 pool
      ]);
      prisma.warehouseTransferPieceItem.findMany.mockResolvedValue([
        { pieceId: 40n, quantity: 10 },
      ]);

      const result = await service.getReadyPoolQty([40n]);

      expect(result.get('40')).toBe(25); // (20 + 15) - 10
    });

    it('không âm - qty đã chuyển vượt qty QC_DONE thì kẹp về 0', async () => {
      prisma.productionBatch.findMany.mockResolvedValue([{ pieceId: 40n, reportedQty: 5 }]);
      prisma.warehouseTransferPieceItem.findMany.mockResolvedValue([{ pieceId: 40n, quantity: 8 }]);

      const result = await service.getReadyPoolQty([40n]);

      expect(result.get('40')).toBe(0);
    });
  });
});
