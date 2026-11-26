import { ConflictException } from '@nestjs/common';
import type { PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { ViTriKhoService } from './vi-tri-kho.service';

/** tx giả: đủ các bảng loadFlows đọc + findMany ô; mỗi bảng trả số cho SKU 5. */
function fakeTx(f: { packed: number; inBins: number; cont?: number; codes?: string[] }) {
  return {
    $executeRaw: jest.fn().mockResolvedValue(1),
    packagingRecord: {
      groupBy: jest
        .fn()
        .mockResolvedValue([{ productionInvoiceItemId: 5n, _sum: { boxesPacked: f.packed } }]),
    },
    locationStock: {
      groupBy: jest
        .fn()
        .mockResolvedValue([{ productionInvoiceItemId: 5n, _sum: { qty: f.inBins } }]),
      findMany: jest
        .fn()
        .mockResolvedValue((f.codes ?? []).map((code) => ({ location: { code } }))),
    },
    bookingContainerLine: {
      findMany: jest.fn().mockResolvedValue(
        f.cont
          ? [
              {
                productionInvoiceItemId: 5n,
                qty: f.cont,
                container: { booking: { status: 'OPEN' } },
              },
            ]
          : [],
      ),
    },
    bookingLine: { groupBy: jest.fn().mockResolvedValue([]) },
  };
}

describe('ViTriKhoService.assertCancelKeepsBinStockInTx (huỷ lần báo đóng gói cũ chưa gắn ô)', () => {
  const prev = process.env.VI_TRI_KHO_ENABLED;
  const service = new ViTriKhoService({} as unknown as PrismaServiceType);
  const run = (tx: ReturnType<typeof fakeTx>) =>
    service.assertCancelKeepsBinStockInTx(tx as unknown as PrismaTx, { id: 5n });
  afterAll(() => {
    if (prev === undefined) delete process.env.VI_TRI_KHO_ENABLED;
    else process.env.VI_TRI_KHO_ENABLED = prev;
  });

  describe('công tắc bật', () => {
    beforeEach(() => {
      process.env.VI_TRI_KHO_ENABLED = 'true';
    });

    it('chặn khi số còn lại sau huỷ nhỏ hơn số đang ở ô, câu nêu tên ô', async () => {
      const tx = fakeTx({ packed: 6, inBins: 10, codes: ['A-01-02'] });
      const err = await run(tx).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).message).toBe(
        'Hàng của lần báo này đã cất vào ô A-01-02. Lấy hàng ra khỏi ô trước rồi mới huỷ.',
      );
    });

    it('cho huỷ khi số còn lại vẫn đủ phủ hàng đã cất ô', async () => {
      await expect(run(fakeTx({ packed: 10, inBins: 10 }))).resolves.toBeUndefined();
      // còn thừa hàng chưa cất
      await expect(run(fakeTx({ packed: 12, inBins: 4 }))).resolves.toBeUndefined();
    });

    it('chặn khi hàng đã lấy vào cont làm số còn lại không đủ (không có hàng ở ô)', async () => {
      await expect(run(fakeTx({ packed: 3, inBins: 0, cont: 5 }))).rejects.toThrow(
        'đã lấy vào cont',
      );
    });
  });

  it('công tắc tắt: không kiểm gì, không chạm DB (giữ hành vi cũ)', async () => {
    delete process.env.VI_TRI_KHO_ENABLED;
    const tx = fakeTx({ packed: 0, inBins: 10, codes: ['A-01-02'] });
    await expect(run(tx)).resolves.toBeUndefined();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.packagingRecord.groupBy).not.toHaveBeenCalled();
  });
});
