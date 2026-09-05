import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { StockReservationsService } from './stock-reservations.service';

const decimal = (n: number) => ({ toNumber: () => n });

/** Dòng CuttingProposal fixture cho loadPool() - neo vào 1 PO có `deadline` (materialDeadline). */
const proposalWithDeadline = (id: bigint, deadline: Date | null) => ({
  id,
  productionOrder: {
    productionInvoiceItem: {
      materialDeadline: deadline,
      stages: [],
      productionInvoice: { deadline: null },
    },
  },
});

describe('StockReservationsService', () => {
  let service: StockReservationsService;
  let prisma: {
    stockReservation: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    cuttingProposal: { findMany: jest.Mock };
    warehouseTransferReservation: { findMany: jest.Mock };
    $queryRaw: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      stockReservation: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      // loadPool() chỉ gọi tới khi pool có >1 dòng (xem test riêng) - mặc định rỗng, vô hại cho
      // mọi test pool có 0-1 dòng.
      cuttingProposal: { findMany: jest.fn().mockResolvedValue([]) },
      warehouseTransferReservation: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    service = new StockReservationsService(prisma as unknown as PrismaServiceType);
  });

  describe('reserve', () => {
    it('tạo dòng giữ chỗ mới khi chưa từng gọi cho (refType, refId, materialId) này', async () => {
      prisma.stockReservation.create.mockResolvedValue({ id: 1n, quantity: decimal(5) });

      const result = await service.reserve(
        { warehouseId: 800n, materialId: 30n, qty: 5, refType: 'CUTTING_PROPOSAL', refId: '22' },
        prisma as unknown as PrismaTx,
      );

      expect(prisma.stockReservation.create).toHaveBeenCalledWith({
        data: {
          warehouseId: 800n,
          materialId: 30n,
          quantity: 5,
          refType: 'CUTTING_PROPOSAL',
          refId: '22',
          productionInvoiceId: undefined,
          note: undefined,
          createdById: undefined,
          idempotencyKey: 'CUTTING_PROPOSAL:22:material:30',
          stockLengthMm: 0,
        },
      });
      expect(result.id).toBe(1n);
      expect(result.quantity.toNumber()).toBe(5);
    });

    it('lưu đúng stockLengthMm khi caller truyền vào (audit chiều dài đã chốt)', async () => {
      prisma.stockReservation.create.mockResolvedValue({ id: 1n, quantity: decimal(5) });

      await service.reserve(
        {
          warehouseId: 800n,
          materialId: 30n,
          qty: 5,
          refType: 'CUTTING_PROPOSAL',
          refId: '22',
          stockLengthMm: 5900,
        },
        prisma as unknown as PrismaTx,
      );

      expect(prisma.stockReservation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ stockLengthMm: 5900 }) as unknown,
      });
    });

    // L5 (2026-08-26): productionInvoiceId đi kèm dòng giữ chỗ ngay từ lúc tạo - đây là thứ
    // loadPool()/creditPool()/drainPool() dùng để gộp nhiều dòng CUTTING_PROPOSAL (nhiều SKU)
    // của CÙNG 1 PI thành 1 pool.
    it('lưu kèm productionInvoiceId khi caller truyền vào', async () => {
      prisma.stockReservation.create.mockResolvedValue({ id: 1n, quantity: decimal(5) });

      await service.reserve(
        {
          warehouseId: 800n,
          materialId: 30n,
          qty: 5,
          refType: 'CUTTING_PROPOSAL',
          refId: '22',
          productionInvoiceId: 50n,
        },
        prisma as unknown as PrismaTx,
      );

      expect(prisma.stockReservation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ productionInvoiceId: 50n }) as unknown,
      });
    });

    // Idempotent - gọi lại (retry mất mạng) với đúng (refType, refId, materialId) phải trả về
    // dòng ĐÃ TẠO, không cộng dồn/tạo trùng - khác hẳn creditPool() (cố ý cộng dồn).
    it('idempotent - gọi lại không tạo trùng, trả về dòng cũ nguyên vẹn', async () => {
      prisma.stockReservation.findUnique.mockResolvedValue({ id: 1n, quantity: decimal(5) });

      const result = await service.reserve(
        { warehouseId: 800n, materialId: 30n, qty: 5, refType: 'CUTTING_PROPOSAL', refId: '22' },
        prisma as unknown as PrismaTx,
      );

      expect(prisma.stockReservation.create).not.toHaveBeenCalled();
      expect(result.id).toBe(1n);
      expect(result.quantity.toNumber()).toBe(5);
    });

    it('ném BadRequestException nếu qty <= 0', async () => {
      await expect(
        service.reserve(
          { warehouseId: 800n, materialId: 30n, qty: 0, refType: 'CUTTING_PROPOSAL', refId: '22' },
          prisma as unknown as PrismaTx,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.stockReservation.create).not.toHaveBeenCalled();
    });
  });

  describe('getAvailableQty', () => {
    it('available = onHand khi không có gì đang giữ chỗ ở cả 2 bảng', async () => {
      const result = await service.getAvailableQty(prisma as unknown as PrismaTx, 800n, 30n, 20);
      expect(result).toBe(20);
    });

    it('trừ đúng phần CÒN GIỮ (quantity - consumedQty) của StockReservation ACTIVE, bỏ qua đã tiêu hết', async () => {
      prisma.stockReservation.findMany.mockResolvedValue([
        { quantity: decimal(10), consumedQty: decimal(3) }, // còn giữ 7
        { quantity: decimal(5), consumedQty: decimal(5) }, // đã tiêu hết, không trừ thêm
      ]);
      const result = await service.getAvailableQty(prisma as unknown as PrismaTx, 800n, 30n, 20);
      expect(result).toBe(13); // 20 - 7
    });

    // Lỗ #6 (mục 13.4 changelog): PHẢI cộng cả 2 bảng, không chỉ StockReservation - nếu không,
    // cắt sắt và chuyển kho sẽ giành nhau cùng lô hàng mà không ai phát hiện.
    it('cộng CẢ HAI bảng giữ chỗ (StockReservation + WarehouseTransferReservation)', async () => {
      prisma.stockReservation.findMany.mockResolvedValue([
        { quantity: decimal(10), consumedQty: decimal(0) },
      ]);
      prisma.warehouseTransferReservation.findMany.mockResolvedValue([{ quantity: decimal(4) }]);
      const result = await service.getAvailableQty(prisma as unknown as PrismaTx, 800n, 30n, 20);
      expect(result).toBe(6); // 20 - 10 - 4
    });

    it('không trả về âm khi giữ chỗ vượt quá onHand (ca dữ liệu lệch)', async () => {
      prisma.stockReservation.findMany.mockResolvedValue([
        { quantity: decimal(30), consumedQty: decimal(0) },
      ]);
      const result = await service.getAvailableQty(prisma as unknown as PrismaTx, 800n, 30n, 20);
      expect(result).toBe(0);
    });

    // 2026-09-05: onHand do caller truyền vào đã tự khoá/lọc đúng bucket chiều dài rồi (xem
    // CuttingProposalsService.approve()) - phần trừ StockReservation ở đây PHẢI lọc khớp chiều dài
    // đó, không trộn giữ chỗ của chiều dài KHÁC vào (nếu không "available" sẽ bị trừ nhầm/thiếu).
    it('lọc StockReservation ĐÚNG bucket chiều dài truyền vào, không trộn chiều dài khác', async () => {
      await service.getAvailableQty(prisma as unknown as PrismaTx, 800n, 30n, 20, 6000);
      expect(prisma.stockReservation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ stockLengthMm: 6000 }) as unknown,
        }),
      );
    });

    it('không truyền stockLengthMm -> mặc định lọc bucket 0 (giữ nguyên hành vi cũ)', async () => {
      await service.getAvailableQty(prisma as unknown as PrismaTx, 800n, 30n, 20);
      expect(prisma.stockReservation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ stockLengthMm: 0 }) as unknown,
        }),
      );
    });

    // Chủ đích: warehouse-transfers chưa có input chiều dài (luôn ghi 0) - lọc riêng theo chiều dài
    // cụ thể sẽ làm ẩn mất phần nó đang giữ, cho cắt sắt và chuyển kho giành nhau cùng lô hàng.
    it('KHÔNG lọc WarehouseTransferReservation theo chiều dài dù gọi với stockLengthMm cụ thể', async () => {
      prisma.warehouseTransferReservation.findMany.mockResolvedValue([{ quantity: decimal(4) }]);
      const result = await service.getAvailableQty(
        prisma as unknown as PrismaTx,
        800n,
        30n,
        20,
        6000,
      );
      expect(result).toBe(16); // 20 - 4, vẫn trừ dù gọi với chiều dài 6000
      expect(prisma.warehouseTransferReservation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { warehouseId: 800n, materialId: 30n, status: 'ACTIVE' },
        }),
      );
    });
  });

  describe('creditPool (L5, 2026-08-26 - thay topUpFromReceipt)', () => {
    it('pool có 1 dòng - cộng thẳng vào dòng đó, không cần tính hạn', async () => {
      prisma.stockReservation.findMany.mockResolvedValue([
        {
          id: 900n,
          refType: 'CUTTING_PROPOSAL',
          refId: '22',
          warehouseId: 800n,
          quantity: decimal(10),
          consumedQty: decimal(0),
        },
      ]);

      await service.creditPool(prisma as unknown as PrismaTx, {
        productionInvoiceId: 50n,
        materialId: 30n,
        warehouseId: 800n,
        qty: 5,
      });

      expect(prisma.cuttingProposal.findMany).not.toHaveBeenCalled();
      expect(prisma.stockReservation.update).toHaveBeenCalledWith({
        where: { id: 900n },
        data: { quantity: { increment: 5 } },
      });
      expect(prisma.stockReservation.create).not.toHaveBeenCalled();
    });

    // ĐÂY là test xác nhận L5 đã sửa: 2 SKU (Ghế A duyệt trước hạn xa, Bàn B duyệt sau hạn gần)
    // cùng dùng 1 loại sắt trong 1 PI - hàng mua về phải cộng vào dòng ưu tiên cao nhất (Bàn B,
    // hạn gần hơn), KHÔNG phải dòng "duyệt sau cùng" hay "id lớn hơn" như cơ chế cũ
    // (PurchaseProposal.cuttingProposalId bị ghi đè) từng làm.
    it('pool có 2 dòng (2 SKU) - cộng vào dòng SKU có hạn GẦN HƠN, không phải dòng tạo sau', async () => {
      prisma.stockReservation.findMany.mockResolvedValue([
        {
          id: 900n, // Ghế A - duyệt trước, id nhỏ hơn, nhưng hạn XA hơn
          refType: 'CUTTING_PROPOSAL',
          refId: '10',
          warehouseId: 800n,
          quantity: decimal(20),
          consumedQty: decimal(0),
        },
        {
          id: 901n, // Bàn B - duyệt sau, id lớn hơn, hạn GẦN hơn -> phải được ưu tiên
          refType: 'CUTTING_PROPOSAL',
          refId: '11',
          warehouseId: 800n,
          quantity: decimal(15),
          consumedQty: decimal(0),
        },
      ]);
      prisma.cuttingProposal.findMany.mockResolvedValue([
        proposalWithDeadline(10n, new Date('2026-12-01')), // Ghế A - xa
        proposalWithDeadline(11n, new Date('2026-09-01')), // Bàn B - gần hơn
      ]);

      await service.creditPool(prisma as unknown as PrismaTx, {
        productionInvoiceId: 50n,
        materialId: 30n,
        warehouseId: 800n,
        qty: 5,
      });

      expect(prisma.stockReservation.update).toHaveBeenCalledWith({
        where: { id: 901n },
        data: { quantity: { increment: 5 } },
      });
    });

    // Ca hiếm: approve() không giữ chỗ gì cho vật tư này (consumeQty=0 lúc duyệt, phải mua 100%
    // nhu cầu) nên reserve() chưa từng chạy cho PI này - creditPool() phải tự tạo dòng mới, gắn
    // thẳng vào PI (không có cuttingProposalId cụ thể nào để gắn).
    it('pool rỗng - tạo dòng mới refType=PRODUCTION_INVOICE gắn thẳng vào PI', async () => {
      prisma.stockReservation.findMany.mockResolvedValue([]);

      await service.creditPool(prisma as unknown as PrismaTx, {
        productionInvoiceId: 50n,
        materialId: 30n,
        warehouseId: 800n,
        qty: 5,
      });

      expect(prisma.stockReservation.create).toHaveBeenCalledWith({
        data: {
          warehouseId: 800n,
          materialId: 30n,
          productionInvoiceId: 50n,
          quantity: 5,
          refType: 'PRODUCTION_INVOICE',
          refId: '50',
          idempotencyKey: 'PRODUCTION_INVOICE:50:material:30',
        },
      });
    });

    it('ném BadRequestException nếu qty <= 0', async () => {
      await expect(
        service.creditPool(prisma as unknown as PrismaTx, {
          productionInvoiceId: 50n,
          materialId: 30n,
          warehouseId: 800n,
          qty: 0,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.stockReservation.update).not.toHaveBeenCalled();
      expect(prisma.stockReservation.create).not.toHaveBeenCalled();
    });
  });

  describe('drainPool (L5, 2026-08-26 - thay lookup 1-dòng cố định trong SteelIssuesService)', () => {
    // `$queryRaw` giả lập ĐÚNG khoá-rồi-đọc-lại thật (drainPool khoá TỪNG dòng bằng FOR UPDATE rồi
    // đọc lại quantity/consumedQty MỚI NHẤT, KHÔNG dùng số đã đọc ở loadPool - xem docstring). Mô
    // phỏng bằng cách tra lại đúng dòng theo id truyền vào template, dùng CHUNG dữ liệu với
    // findMany() vì test không mô phỏng ai khác ghi đè giữa 2 lần đọc.
    const mockRowLocks = (
      rows: { id: bigint; warehouseId: bigint; quantity: unknown; consumedQty: unknown }[],
    ) => {
      const byId = new Map(rows.map((r) => [r.id, r]));
      prisma.$queryRaw.mockImplementation((..._args: unknown[]) => {
        const id = _args.find((a) => typeof a === 'bigint');
        const row = id != null ? byId.get(id) : undefined;
        return Promise.resolve(
          row
            ? [
                {
                  warehouseId: row.warehouseId,
                  quantity: row.quantity,
                  consumedQty: row.consumedQty,
                },
              ]
            : [],
        );
      });
    };

    it('rút đủ từ 1 dòng duy nhất', async () => {
      const rows = [
        {
          id: 900n,
          refType: 'CUTTING_PROPOSAL',
          refId: '22',
          warehouseId: 800n,
          quantity: decimal(10),
          consumedQty: decimal(2),
        },
      ];
      prisma.stockReservation.findMany.mockResolvedValue(rows);
      mockRowLocks(rows);

      const result = await service.drainPool(prisma as unknown as PrismaTx, {
        productionInvoiceId: 50n,
        materialId: 30n,
        qty: 5,
      });

      expect(result.warehouseId).toBe(800n);
      expect(prisma.stockReservation.update).toHaveBeenCalledWith({
        where: { id: 900n },
        data: { consumedQty: { increment: 5 } },
      });
    });

    // Kịch bản chính của L5: dòng ưu tiên cao nhất (hạn gần) không đủ - phải RÚT VẮT sang dòng
    // tiếp theo trong pool thay vì chặn cứng dù tổng cả pool vẫn đủ.
    it('rút vắt qua nhiều dòng khi dòng ưu tiên cao nhất không đủ', async () => {
      const rows = [
        {
          id: 901n, // Bàn B - hạn gần hơn, chỉ còn giữ 3
          refType: 'CUTTING_PROPOSAL',
          refId: '11',
          warehouseId: 800n,
          quantity: decimal(3),
          consumedQty: decimal(0),
        },
        {
          id: 900n, // Ghế A - hạn xa hơn, còn giữ 20
          refType: 'CUTTING_PROPOSAL',
          refId: '10',
          warehouseId: 800n,
          quantity: decimal(20),
          consumedQty: decimal(0),
        },
      ];
      prisma.stockReservation.findMany.mockResolvedValue(rows);
      mockRowLocks(rows);
      prisma.cuttingProposal.findMany.mockResolvedValue([
        proposalWithDeadline(11n, new Date('2026-09-01')), // Bàn B - gần hơn, rút trước
        proposalWithDeadline(10n, new Date('2026-12-01')), // Ghế A - xa hơn, rút phần còn thiếu
      ]);

      const result = await service.drainPool(prisma as unknown as PrismaTx, {
        productionInvoiceId: 50n,
        materialId: 30n,
        qty: 8, // 3 (hết dòng 901) + 5 (lấy thêm từ dòng 900)
      });

      expect(result.warehouseId).toBe(800n);
      expect(prisma.stockReservation.update).toHaveBeenNthCalledWith(1, {
        where: { id: 901n },
        data: { consumedQty: { increment: 3 } },
      });
      expect(prisma.stockReservation.update).toHaveBeenNthCalledWith(2, {
        where: { id: 900n },
        data: { consumedQty: { increment: 5 } },
      });
    });

    it('ném ConflictException khi pool rỗng (chưa từng giữ chỗ, hoặc mọi phương án đã supersede/huỷ)', async () => {
      prisma.stockReservation.findMany.mockResolvedValue([]);

      await expect(
        service.drainPool(prisma as unknown as PrismaTx, {
          productionInvoiceId: 50n,
          materialId: 30n,
          qty: 5,
        }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.stockReservation.update).not.toHaveBeenCalled();
    });

    it('ném BadRequestException khi xuất vượt TỔNG còn giữ của cả pool (chặn cứng, không dung sai)', async () => {
      const rows = [
        {
          id: 900n,
          refType: 'CUTTING_PROPOSAL',
          refId: '10',
          warehouseId: 800n,
          quantity: decimal(5),
          consumedQty: decimal(0),
        },
      ];
      prisma.stockReservation.findMany.mockResolvedValue(rows);
      mockRowLocks(rows);

      await expect(
        service.drainPool(prisma as unknown as PrismaTx, {
          productionInvoiceId: 50n,
          materialId: 30n,
          qty: 6,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.stockReservation.update).not.toHaveBeenCalled();
    });

    it('ném BadRequestException nếu qty <= 0', async () => {
      await expect(
        service.drainPool(prisma as unknown as PrismaTx, {
          productionInvoiceId: 50n,
          materialId: 30n,
          qty: 0,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('releaseByRef', () => {
    // B4 Đợt 3b (lỗ #4): CuttingProposalsService.approve() gọi hàm này khi supersede anh em -
    // release MỌI dòng ACTIVE của phương án cũ, không chỉ 1 vật tư (updateMany theo refType/refId
    // thuần, không lọc materialId - 1 phương án có thể giữ chỗ nhiều loại sắt cùng lúc).
    it('đánh RELEASED mọi dòng ACTIVE khớp (refType, refId) - không lọc theo materialId', async () => {
      await service.releaseByRef(prisma as unknown as PrismaTx, {
        refType: 'CUTTING_PROPOSAL',
        refId: '18',
      });

      expect(prisma.stockReservation.updateMany).toHaveBeenCalledWith({
        where: { refType: 'CUTTING_PROPOSAL', refId: '18', status: 'ACTIVE' },
        data: { status: 'RELEASED', releasedAt: expect.any(Date) as Date },
      });
    });
  });
});
