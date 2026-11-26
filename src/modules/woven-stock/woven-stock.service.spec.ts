/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- mock prisma dạng jest.fn */
import { WOVEN_STOCK_AUTO_NOTE, WovenStockService } from './woven-stock.service';

/**
 * Q6 huỷ lệnh (anh Nhân 26/11/2026): khung đã đan của SKU huỷ thành tồn kho thành phẩm theo mảnh + màu dây; lệnh sau cần đúng loại
 * tự lấy tồn trước, chỉ xuất đan phần còn thiếu.
 */
describe('WovenStockService', () => {
  const req = (
    id: bigint,
    orderId: bigint,
    itemId: bigint,
    wc: string | null,
    wire: bigint | null,
  ) => ({
    id,
    productionOrder: {
      id: orderId,
      productionInvoiceItem: { id: itemId, warehouseCode: wc, wireMaterialId: wire },
    },
  });

  function make(data: {
    reqs?: any[];
    receipts?: any[];
    takenIn?: any[];
    takenOut?: any[];
    checked?: any[];
    targets?: any[];
    bomPieces?: any[];
    issued?: number;
    draft?: number;
    taken?: number;
  }) {
    const db: any = {
      productionOrderCancelRequest: { findMany: jest.fn().mockResolvedValue(data.reqs ?? []) },
      weavingReceipt: { groupBy: jest.fn().mockResolvedValue(data.receipts ?? []) },
      cancelledGoodsTransfer: {
        groupBy: jest.fn((args: any) =>
          Promise.resolve(
            args.by[0] === 'targetItemId' ? (data.takenIn ?? []) : (data.takenOut ?? []),
          ),
        ),
        aggregate: jest.fn().mockResolvedValue({ _sum: { qty: data.taken ?? 0 } }),
        create: jest.fn().mockResolvedValue({}),
      },
      transferCheckResult: { groupBy: jest.fn().mockResolvedValue(data.checked ?? []) },
      productionOrder: { findMany: jest.fn().mockResolvedValue(data.targets ?? []) },
      bomPiece: { findMany: jest.fn().mockResolvedValue(data.bomPieces ?? []) },
      weavingIssue: { aggregate: jest.fn().mockResolvedValue({ _sum: { qty: data.issued ?? 0 } }) },
      issueSlipLine: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { qty: data.draft ? { toNumber: () => data.draft } : null } }),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    db.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(db));
    const realtime = { publishEntityChanged: jest.fn() };
    return { svc: new WovenStockService(db, realtime as never), db, realtime };
  }

  it('tồn = đã nhận đan + đã lấy tồn vào − đã qua chuyền kiểm − đã lấy tồn ra, theo kho TP + mảnh + màu dây', async () => {
    const { svc, db } = make({
      reqs: [req(1n, 70n, 130n, 'thanh-pham-2', 7n), req(2n, 71n, 131n, null, 7n)],
      receipts: [
        { productionOrderId: 70n, pieceId: 20n, _sum: { qty: 10 } },
        { productionOrderId: 71n, pieceId: 20n, _sum: { qty: 4 } },
      ],
      takenIn: [{ targetItemId: 130n, pieceId: 20n, _sum: { qty: 2 } }],
      takenOut: [{ sourceItemId: 130n, pieceId: 20n, _sum: { qty: 3 } }],
      checked: [{ productionInvoiceItemId: 130n, pieceId: 20n, _sum: { checkedQty: 5 } }],
    });
    const out = await svc.loadStock(db);
    const byWc = Object.fromEntries(out.map((b) => [b.warehouseCode, b]));
    expect(byWc['thanh-pham-2'].qty).toBe(4); // 10 + 2 − 5 − 3
    expect(byWc['thanh-pham'].qty).toBe(4); // kho trống -> kho thành phẩm mặc định
    expect(byWc['thanh-pham'].wireMaterialId).toBe(7n);
  });

  it('lọc theo màu dây / kho: lệnh khác dây không vào', async () => {
    const { svc, db } = make({
      reqs: [req(1n, 70n, 130n, 'thanh-pham', 7n), req(2n, 71n, 131n, 'thanh-pham', null)],
      receipts: [
        { productionOrderId: 70n, pieceId: 20n, _sum: { qty: 3 } },
        { productionOrderId: 71n, pieceId: 20n, _sum: { qty: 5 } },
      ],
    });
    const out = await svc.loadStock(db, { wireMaterialId: null });
    expect(out).toHaveLength(1);
    expect(out[0].qty).toBe(5);
    expect(out[0].sources.map((s) => s.sourceItemId)).toEqual([131n]);
  });

  it('cấp tồn: lệnh cũ trước, mỗi lệnh tối đa phần còn thiếu, chia theo nguồn cũ trước', async () => {
    const { svc, db, realtime } = make({
      reqs: [req(1n, 70n, 130n, 'thanh-pham', 7n), req(2n, 71n, 131n, 'thanh-pham', 7n)],
      receipts: [
        { productionOrderId: 70n, pieceId: 20n, _sum: { qty: 3 } },
        { productionOrderId: 71n, pieceId: 20n, _sum: { qty: 4 } },
      ],
      targets: [
        { id: 80n, quantity: 5, bomRevisionId: 9n, productionInvoiceItemId: 140n },
        { id: 81n, quantity: 10, bomRevisionId: 9n, productionInvoiceItemId: 141n },
      ],
      bomPieces: [{ bomRevisionId: 9n, qtyPerUnit: 1 }],
      issued: 0,
    });
    const touched = await svc.allocateBucket('thanh-pham', 20n, 7n, 'u1');
    expect(touched).toEqual([80n, 81n]);
    const rows = db.cancelledGoodsTransfer.create.mock.calls.map((c: any[]) => c[0].data);
    // lệnh 80 cần 5: 3 của nguồn 130 + 2 của nguồn 131; lệnh 81 nhận 2 còn lại của nguồn 131
    expect(rows.map((r: any) => [r.sourceItemId, r.targetItemId, r.qty])).toEqual([
      [130n, 140n, 3],
      [131n, 140n, 2],
      [131n, 141n, 2],
    ]);
    expect(
      rows.every(
        (r: any) => r.kind === 'WOVEN' && r.pieceId === 20n && r.note === WOVEN_STOCK_AUTO_NOTE,
      ),
    ).toBe(true);
    expect(realtime.publishEntityChanged).toHaveBeenCalledTimes(2);
    // chỉ lệnh đang chạy, chưa huỷ, đúng dây + kho (kho mặc định nhận cả dòng chưa ghi kho)
    expect(db.productionOrder.findMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({
        floorStage: 'ACTIVE',
        productionInvoiceItem: {
          cancelledAt: null,
          wireMaterialId: 7n,
          OR: [{ warehouseCode: 'thanh-pham' }, { warehouseCode: null }],
        },
      }),
    );
  });

  it('cấp tồn: phần còn thiếu trừ đã xuất đan + phiếu chờ ký + đã lấy tồn; đủ rồi thì không lấy', async () => {
    const { svc, db } = make({
      reqs: [req(1n, 70n, 130n, 'thanh-pham', 7n)],
      receipts: [{ productionOrderId: 70n, pieceId: 20n, _sum: { qty: 6 } }],
      targets: [{ id: 80n, quantity: 5, bomRevisionId: 9n, productionInvoiceItemId: 140n }],
      bomPieces: [{ bomRevisionId: 9n, qtyPerUnit: 2 }],
      issued: 4,
      draft: 3,
      taken: 1,
    });
    await svc.allocateBucket('thanh-pham', 20n, 7n, 'u1');
    // cần 10 − 4 − 3 − 1 = 2
    expect(db.cancelledGoodsTransfer.create).toHaveBeenCalledTimes(1);
    expect(db.cancelledGoodsTransfer.create.mock.calls[0][0].data.qty).toBe(2);

    const full = make({
      reqs: [req(1n, 70n, 130n, 'thanh-pham', 7n)],
      receipts: [{ productionOrderId: 70n, pieceId: 20n, _sum: { qty: 6 } }],
      targets: [{ id: 80n, quantity: 5, bomRevisionId: 9n, productionInvoiceItemId: 140n }],
      bomPieces: [{ bomRevisionId: 9n, qtyPerUnit: 1 }],
      issued: 5,
    });
    expect(await full.svc.allocateBucket('thanh-pham', 20n, 7n, 'u1')).toEqual([]);
    expect(full.db.cancelledGoodsTransfer.create).not.toHaveBeenCalled();
  });

  it('cấp tồn: lệnh không có mảnh này là khung đan trong định mức thì bỏ qua', async () => {
    const { svc, db } = make({
      reqs: [req(1n, 70n, 130n, 'thanh-pham', 7n)],
      receipts: [{ productionOrderId: 70n, pieceId: 20n, _sum: { qty: 6 } }],
      targets: [{ id: 80n, quantity: 5, bomRevisionId: 9n, productionInvoiceItemId: 140n }],
      bomPieces: [],
    });
    expect(await svc.allocateBucket('thanh-pham', 20n, 7n, 'u1')).toEqual([]);
    expect(db.cancelledGoodsTransfer.create).not.toHaveBeenCalled();
  });
});
