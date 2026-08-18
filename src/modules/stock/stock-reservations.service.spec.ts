import { BadRequestException } from '@nestjs/common';
import { PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { StockReservationsService } from './stock-reservations.service';

const decimal = (n: number) => ({ toNumber: () => n });

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
          note: undefined,
          createdById: undefined,
          idempotencyKey: 'CUTTING_PROPOSAL:22:material:30',
        },
      });
      expect(result.id).toBe(1n);
      expect(result.quantity.toNumber()).toBe(5);
    });

    // Idempotent - gọi lại (retry mất mạng) với đúng (refType, refId, materialId) phải trả về
    // dòng ĐÃ TẠO, không cộng dồn/tạo trùng - khác hẳn topUpFromReceipt() (cố ý cộng dồn).
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
      const result = await service.getAvailableQty(
        prisma as unknown as PrismaTx,
        800n,
        30n,
        20,
      );
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
  });

  describe('topUpFromReceipt', () => {
    it('cộng thêm vào dòng giữ chỗ ĐÃ CÓ, ACTIVE (hàng mua về, có chủ) thay vì tạo dòng mới', async () => {
      prisma.$queryRaw.mockResolvedValue([{ id: 900n, status: 'ACTIVE' }]);

      await service.topUpFromReceipt(prisma as unknown as PrismaTx, {
        refType: 'CUTTING_PROPOSAL',
        refId: '22',
        materialId: 30n,
        warehouseId: 800n,
        qty: 5,
      });

      expect(prisma.stockReservation.update).toHaveBeenCalledWith({
        where: { id: 900n },
        data: { quantity: { increment: 5 } },
      });
      expect(prisma.stockReservation.create).not.toHaveBeenCalled();
    });

    // B4 Đợt 3b: phương án gốc đã bị supersede/huỷ TRONG LÚC hàng đang trên đường về - không được
    // tạo giữ chỗ MỚI dính vào phương án đã chết (tái tạo đúng lỗ #4 vừa vá, chỉ đổi hướng). Hàng
    // đã cộng vào stock_quant qua postEntry() ở receiveItem() rồi - coi như tồn chung tự do.
    it('KHÔNG tạo/cộng gì nếu dòng cũ đã RELEASED (phương án gốc đã chết) - hàng về thành tồn chung', async () => {
      prisma.$queryRaw.mockResolvedValue([{ id: 900n, status: 'RELEASED' }]);

      await service.topUpFromReceipt(prisma as unknown as PrismaTx, {
        refType: 'CUTTING_PROPOSAL',
        refId: '22',
        materialId: 30n,
        warehouseId: 800n,
        qty: 5,
      });

      expect(prisma.stockReservation.update).not.toHaveBeenCalled();
      expect(prisma.stockReservation.create).not.toHaveBeenCalled();
    });

    // Ca hiếm: approve() không giữ chỗ gì cho vật tư này (consumeQty=0 lúc duyệt, phải mua 100%
    // nhu cầu) nên reserve() chưa từng chạy - topUpFromReceipt() phải tự tạo dòng mới.
    it('tạo dòng mới nếu chưa từng có giữ chỗ nào (consumeQty=0 lúc duyệt, mua 100%)', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.topUpFromReceipt(prisma as unknown as PrismaTx, {
        refType: 'CUTTING_PROPOSAL',
        refId: '22',
        materialId: 30n,
        warehouseId: 800n,
        qty: 5,
      });

      expect(prisma.stockReservation.create).toHaveBeenCalledWith({
        data: {
          warehouseId: 800n,
          materialId: 30n,
          quantity: 5,
          refType: 'CUTTING_PROPOSAL',
          refId: '22',
          idempotencyKey: 'CUTTING_PROPOSAL:22:material:30',
        },
      });
    });

    it('ném BadRequestException nếu qty <= 0', async () => {
      await expect(
        service.topUpFromReceipt(prisma as unknown as PrismaTx, {
          refType: 'CUTTING_PROPOSAL',
          refId: '22',
          materialId: 30n,
          warehouseId: 800n,
          qty: 0,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.stockReservation.update).not.toHaveBeenCalled();
      expect(prisma.stockReservation.create).not.toHaveBeenCalled();
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
