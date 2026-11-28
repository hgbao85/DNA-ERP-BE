/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call -- prisma mock */
import { BadRequestException } from '@nestjs/common';
import { PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SegmentStockService } from '../segment-stock/segment-stock.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { PreparedFrameHandover, StageHandoverService } from './stage-handover.service';

const dec = (n: number) => ({ toNumber: () => n });

/**
 * Đợt 2 lượt 1 (28/11/2026), lỗi câu 1: giao khung Hàn -> Sơn trước đây chỉ kiểm tồn mảnh của CẢ kho Hàn (chung mọi SKU). 2 SKU dùng
 * chung mảnh thì SKU A giao lố sang khung của SKU B. Nay chặn thêm theo SKU.
 */
describe('assertFrameCapInTx - trần theo SKU', () => {
  // Kho Hàn có 10 mảnh 8 (của 2 SKU). SKU 70 mới có 4 mảnh đạt KCS Hàn vào kho, đã giao Sơn 1.
  const build = (opts: { handed?: number; draftOther?: number } = {}) => {
    const db: any = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([{ qty: dec(10) }]),
      issueSlipLine: {
        aggregate: jest.fn(({ where }: any) => {
          // Trần vật lý: dòng giao + xuất đan chờ ký của cả kho.
          if (where.kind?.in) return Promise.resolve({ _sum: { qty: dec(0) } });
          if (where.slip.status === 'ISSUED')
            return Promise.resolve({ _sum: { qty: dec(opts.handed ?? 1) } });
          return Promise.resolve({ _sum: { qty: dec(opts.draftOther ?? 0) } });
        }),
      },
      warehouseTransferPieceItem: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
      },
      productionBatch: { findMany: jest.fn().mockResolvedValue([{ id: 501n }]) },
      stockLedger: { aggregate: jest.fn().mockResolvedValue({ _sum: { qty: dec(4) } }) },
    };
    const service = new StageHandoverService(
      db as PrismaServiceType,
      {} as SegmentStockService,
      {} as StockLedgerService,
      {} as NotificationsService,
    );
    return { db, service };
  };
  const p = (qty: number): PreparedFrameHandover => ({
    productionInvoiceId: 100n,
    productionOrderId: 70n,
    pieceId: 8n,
    pieceName: 'Khung lưng',
    qty,
    warehouse: { id: 3n, code: 'han-phu-an' },
    toWarehouse: { id: 4n, code: 'son-phu-an' },
  });

  it('kho còn 10 nhưng SKU chỉ còn 4 − 1 = 3: giao 3 được, giao 4 bị chặn và nói rõ phần còn lại là của SKU khác', async () => {
    const { service, db } = build();
    await expect(service.assertFrameCapInTx(db as PrismaTx, p(3), null)).resolves.toBeUndefined();
    const { service: s2, db: db2 } = build();
    const err = await s2.assertFrameCapInTx(db2 as PrismaTx, p(4), null).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toMatch(/còn giao được 3, phiếu ghi 4.*SKU khác/);
  });

  it('phiếu chờ ký khác của cùng SKU cũng trừ; phiếu đang xác nhận thì không', async () => {
    const { service, db } = build({ draftOther: 2 });
    await expect(service.assertFrameCapInTx(db as PrismaTx, p(2), 9n)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const draftCall = db.issueSlipLine.aggregate.mock.calls.find(
      ([a]: any[]) => a.where.productionOrderId === 70n && a.where.slip.status === 'DRAFT',
    );
    expect(draftCall[0].where.slip.id).toEqual({ not: 9n });
    await expect(service.assertFrameCapInTx(db as PrismaTx, p(1), 9n)).resolves.toBeUndefined();
  });

  it('mảnh đạt KCS chỉ tính lô Hàn của đúng SKU + mảnh, ghi vào đúng kho Hàn', async () => {
    const { service, db } = build();
    await service.assertFrameCapInTx(db as PrismaTx, p(1), null);
    expect(db.productionBatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ productionOrderId: 70n, pieceId: 8n, stage: 'HAN' }),
      }),
    );
    expect(db.stockLedger.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ toWarehouseId: 3n, pieceId: 8n, refId: { in: ['501'] } }),
      }),
    );
  });
});
