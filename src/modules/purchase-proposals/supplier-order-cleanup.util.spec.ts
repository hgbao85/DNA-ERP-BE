import { cancelEmptiedDraftOrders } from './supplier-order-cleanup.util';

describe('cancelEmptiedDraftOrders (MUA5 19/11 - tính lại "đủ tồn" gỡ dòng cuối khỏi đơn nháp)', () => {
  const makeTx = (statusById: Record<string, string>, itemsLeftById: Record<string, number>) => {
    const locked: bigint[] = [];
    return {
      locked,
      $queryRaw: jest.fn((_sql: TemplateStringsArray, id: bigint) => {
        locked.push(id);
        const st = statusById[id.toString()];
        return Promise.resolve(st ? [{ status: st }] : []);
      }),
      purchaseProposalItem: {
        count: jest.fn((args: { where: { supplierOrderId: bigint } }) =>
          Promise.resolve(itemsLeftById[args.where.supplierOrderId.toString()] ?? 0),
        ),
      },
      supplierOrder: { update: jest.fn().mockResolvedValue({}) },
    };
  };

  it('huỷ đúng đơn nháp không còn dòng; giữ đơn còn dòng / đơn đã duyệt; bỏ id trùng và null; khoá theo id tăng dần', async () => {
    const tx = makeTx({ '5': 'DRAFT', '3': 'DRAFT', '7': 'APPROVED' }, { '3': 2, '5': 0, '7': 0 });
    const cancelled = await cancelEmptiedDraftOrders(tx as never, [
      5n,
      null,
      3n,
      undefined,
      5n,
      7n,
    ]);
    expect(tx.locked).toEqual([3n, 5n, 7n]);
    expect(cancelled).toEqual([5n]);
    expect(tx.supplierOrder.update).toHaveBeenCalledTimes(1);
    expect(tx.supplierOrder.update).toHaveBeenCalledWith({
      where: { id: 5n },
      data: {
        status: 'CANCELLED',
        cancelledAt: expect.any(Date) as Date,
        cancelReason: 'Tính lại nhu cầu: mọi dòng đã đủ tồn',
      },
    });
  });

  it('không có đơn nào -> không truy vấn gì', async () => {
    const tx = makeTx({}, {});
    await expect(cancelEmptiedDraftOrders(tx as never, [null, undefined])).resolves.toEqual([]);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});
