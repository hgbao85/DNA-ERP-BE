/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any -- mock prisma dạng jest.fn, gọi hàm private */
import { OrderCancellationService, orderCancelPiLockKey } from './order-cancellation.service';

/**
 * 2 lỗi Cao của huỷ lệnh đợt 1 (review Sang 23/11, còn ở main 02016a3):
 *  1. Sếp duyệt huỷ 2 SKU của cùng lệnh gộp gần như cùng lúc -> lệnh thành DONE thay vì CANCELLED.
 *  2. SKU còn lại đã Kết thúc mà vẫn tính lại phương án / dòng mua sau khi đã nhả giữ chỗ.
 */
describe('OrderCancellationService - 2 lỗi Cao đợt 1', () => {
  function make(overrides: Record<string, any> = {}) {
    const prisma: any = {
      productionInvoice: {
        findUnique: jest.fn().mockResolvedValue({ status: 'PRODUCING', isMerged: true }),
      },
      productionOrder: { count: jest.fn().mockResolvedValue(1) },
      purchaseProposalItem: { count: jest.fn().mockResolvedValue(0) },
      cuttingProposal: { count: jest.fn().mockResolvedValue(1) },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn({})),
      ...overrides,
    };
    const cuttingProposals: any = {
      releaseForInvoice: jest.fn().mockResolvedValue(undefined),
      requestForInvoice: jest.fn().mockResolvedValue({ id: '900' }),
      approveCancellationReplan: jest.fn().mockResolvedValue({ approved: true }),
    };
    const productionOrders: any = {
      releaseReservationsIfPiFinished: jest.fn().mockResolvedValue(undefined),
    };
    const productionInvoices: any = {
      computeNonSteelPurchaseProposals: jest.fn().mockResolvedValue(undefined),
    };
    const segmentProduction: any = { recomputeAfterQc: jest.fn().mockResolvedValue(undefined) };
    const svc = new OrderCancellationService(
      prisma,
      {} as never,
      { emit: jest.fn(), resolve: jest.fn() } as never,
      { publishEntityChanged: jest.fn() } as never,
      cuttingProposals,
      productionOrders,
      productionInvoices,
      segmentProduction,
      {} as never,
    );
    return { svc: svc as any, prisma, cuttingProposals, productionOrders, productionInvoices };
  }
  const outcome = (over: Record<string, unknown> = {}) => ({
    orderId: 70n,
    itemId: 130n,
    productionInvoiceId: 89n,
    invoiceCancelled: false,
    steelIssued: false,
    signedLineCount: 0,
    replanNote: undefined as string | undefined,
    closedDeadlineBatchIds: [] as bigint[],
    ...over,
  });

  it('lỗi 1: duyệt huỷ khoá theo LỆNH (PI) trước rồi mới khoá dòng lệnh SX', async () => {
    const { svc } = make();
    const calls: string[] = [];
    const tx: any = {
      productionOrder: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValueOnce({ productionInvoiceItem: { productionInvoiceId: 89n } })
          // dừng sớm sau khi đã khoá (lệnh đã huỷ) - chỉ cần thứ tự khoá
          .mockResolvedValueOnce({
            status: 'CANCELLED',
            floorStage: 'FINISHED',
            productionInvoiceItem: {},
          }),
      },
      $executeRaw: jest.fn((strings: TemplateStringsArray, ...vals: unknown[]) => {
        calls.push(`advisory:${String(vals[0])}`);
        return Promise.resolve(1);
      }),
      $queryRaw: jest.fn((strings: TemplateStringsArray) => {
        calls.push(strings.join('?').includes('production_orders') ? 'order-row' : 'other');
        return Promise.resolve([]);
      }),
    };
    await expect(svc.approveInTx(tx, { id: 'u1' }, 5n, 70n, undefined)).rejects.toThrow(
      'Lệnh này đã huỷ',
    );
    expect(calls).toEqual([`advisory:${orderCancelPiLockKey(89n)}`, 'order-row']);
  });

  it('lỗi 1: lượt khác vừa huỷ hẳn cả lệnh -> đi nhánh "cả lệnh huỷ" (gỡ phương án chưa duyệt, đóng dòng mua), không tính lại', async () => {
    const { svc, prisma, cuttingProposals, productionInvoices } = make();
    prisma.productionInvoice.findUnique.mockResolvedValue({ status: 'CANCELLED', isMerged: true });
    svc.closePurchaseLinesOfCancelledInvoice = jest.fn().mockResolvedValue(2);
    const o = outcome();
    await svc.afterApproved(o, 'u1');
    expect(o.invoiceCancelled).toBe(true);
    expect(cuttingProposals.releaseForInvoice).toHaveBeenCalled();
    expect(svc.closePurchaseLinesOfCancelledInvoice).toHaveBeenCalledWith(89n);
    expect(o.signedLineCount).toBe(2);
    expect(o.replanNote).toMatch(/cả lệnh đã huỷ/);
    expect(cuttingProposals.requestForInvoice).not.toHaveBeenCalled();
    expect(productionInvoices.computeNonSteelPurchaseProposals).not.toHaveBeenCalled();
  });

  it('lỗi 2: mọi SKU còn lại đã Kết thúc -> nhả giữ chỗ, KHÔNG tính lại phương án / dòng mua', async () => {
    const { svc, prisma, cuttingProposals, productionOrders, productionInvoices } = make();
    prisma.productionOrder.count.mockResolvedValue(0);
    const o = outcome();
    await svc.afterApproved(o, 'u1');
    expect(productionOrders.releaseReservationsIfPiFinished).toHaveBeenCalledWith(130n);
    expect(cuttingProposals.requestForInvoice).not.toHaveBeenCalled();
    expect(productionInvoices.computeNonSteelPurchaseProposals).not.toHaveBeenCalled();
    expect(o.replanNote).toMatch(/đã Kết thúc/);
    // đếm SKU chưa Kết thúc: bỏ lệnh đã huỷ và lệnh FINISHED
    expect(prisma.productionOrder.count).toHaveBeenCalledWith({
      where: {
        productionInvoiceItem: { productionInvoiceId: 89n },
        status: { not: 'CANCELLED' },
        floorStage: { not: 'FINISHED' },
      },
    });
  });

  it('còn SKU chạy, đã xuất sắt -> giữ phương án, vẫn tính lại dòng mua ngoài sắt', async () => {
    const { svc, cuttingProposals, productionInvoices } = make();
    const o = outcome({ steelIssued: true });
    await svc.afterApproved(o, 'u1');
    expect(cuttingProposals.requestForInvoice).not.toHaveBeenCalled();
    expect(productionInvoices.computeNonSteelPurchaseProposals).toHaveBeenCalledWith(
      89n,
      'huỷ lệnh 70',
      {
        lowerSignedOnDrop: true,
      },
    );
  });

  it('lỗi 1: lệnh bị huỷ hẳn ngay trước bước tính lại dòng mua -> bỏ bước đó', async () => {
    const { svc, prisma, productionInvoices } = make();
    prisma.productionInvoice.findUnique
      .mockResolvedValueOnce({ status: 'PRODUCING', isMerged: true }) // đầu afterApproved
      .mockResolvedValueOnce({ status: 'CANCELLED', isMerged: true }); // ngay trước khi tính mua
    await svc.afterApproved(outcome({ steelIssued: true }), 'u1');
    expect(productionInvoices.computeNonSteelPurchaseProposals).not.toHaveBeenCalled();
  });

  it('lỗi 1: phương án tính lại xong mà lệnh đã huỷ hẳn -> không duyệt thay, không tính mua', async () => {
    const { svc, prisma, cuttingProposals, productionInvoices } = make();
    let onComplete: (() => Promise<void>) | undefined;
    cuttingProposals.requestForInvoice.mockImplementation((_pi: bigint, opts: any) => {
      onComplete = opts.onComplete;
      return Promise.resolve({ id: '900' });
    });
    await svc.afterApproved(outcome(), 'u1');
    expect(cuttingProposals.requestForInvoice).toHaveBeenCalled();
    prisma.productionInvoice.findUnique.mockResolvedValue({ status: 'CANCELLED', isMerged: true });
    await onComplete!();
    expect(cuttingProposals.approveCancellationReplan).not.toHaveBeenCalled();
    expect(productionInvoices.computeNonSteelPurchaseProposals).not.toHaveBeenCalled();
  });
});
