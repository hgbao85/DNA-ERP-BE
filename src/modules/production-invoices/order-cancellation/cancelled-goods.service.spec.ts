/* eslint-disable @typescript-eslint/no-unsafe-assignment -- expect.objectContaining trả any */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CancelledGoodsService } from './cancelled-goods.service';

/**
 * Huỷ lệnh đợt 2 - Q5 / Q6 (anh Nhân 24/11/2026): KHSX chuyển hàng của SKU đã huỷ sang 1 dòng SKU đang chạy. Kiểm các luật chặn
 * và phần ghi (bản ghi chuyển + dòng đóng gói của đích cho hàng đã đóng gói; chỉ bản ghi chuyển cho khung đan).
 */
describe('CancelledGoodsService.transfer (Q5/Q6)', () => {
  const SRC = {
    id: 105n,
    productionInvoiceId: 85n,
    mfgProductId: 128n,
    wireMaterialId: 7n,
    cushionMaterialId: 9n,
    mfgProduct: { factoryCode: 'PB-SP2' },
    wireMaterial: { name: 'Dây đen' },
    cushionMaterial: { name: 'Nệm xám' },
  };
  const target = (over: Record<string, unknown> = {}) => ({
    id: 106n,
    cancelledAt: null,
    mfgProductId: 128n,
    wireMaterialId: 7n,
    cushionMaterialId: 9n,
    productionOrder: {
      id: 70n,
      status: 'RELEASED',
      floorStage: 'ACTIVE',
      quantity: 10,
      bomRevisionId: 5n,
    },
    ...over,
  });

  function setup(
    opts: {
      status?: string;
      target?: ReturnType<typeof target> | null;
      packed?: number;
      shipped?: number;
      receipts?: { pieceId: bigint; qty: number }[];
      transfersOut?: { kind: string; pieceId: bigint | null; qty: number }[];
      targetPacked?: number;
      bomPiece?: { qtyPerUnit: number; isWoven: boolean } | null;
      targetReceived?: number;
      targetIn?: number;
    } = {},
  ) {
    const tx = {
      $executeRaw: jest.fn(),
      productionInvoiceItem: {
        findUnique: jest.fn().mockResolvedValue(opts.target === undefined ? target() : opts.target),
      },
      packagingRecord: {
        aggregate: jest
          .fn()
          // lần 1: nguồn (availability), lần 2: đích
          .mockResolvedValueOnce({ _sum: { boxesPacked: opts.packed ?? 0 } })
          .mockResolvedValueOnce({ _sum: { boxesPacked: opts.targetPacked ?? 0 } }),
        create: jest.fn(),
      },
      bookingLine: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { shippedQty: opts.shipped ?? 0 } }),
      },
      weavingReceipt: {
        groupBy: jest
          .fn()
          .mockResolvedValue(
            (opts.receipts ?? []).map((r) => ({ pieceId: r.pieceId, _sum: { qty: r.qty } })),
          ),
        aggregate: jest.fn().mockResolvedValue({ _sum: { qty: opts.targetReceived ?? 0 } }),
      },
      cancelledGoodsTransfer: {
        findMany: jest.fn().mockResolvedValue(opts.transfersOut ?? []),
        aggregate: jest.fn().mockResolvedValue({ _sum: { qty: opts.targetIn ?? 0 } }),
        create: jest.fn().mockResolvedValue({ id: 900n }),
      },
      bomPiece: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            opts.bomPiece === undefined ? { qtyPerUnit: 1, isWoven: true } : opts.bomPiece,
          ),
      },
    };
    const prisma = {
      productionOrderCancelRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: 7n,
          status: opts.status ?? 'APPROVED',
          productionOrder: { id: 66n, productionInvoiceItem: SRC },
        }),
      },
      $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const realtime = { publishEntityChanged: jest.fn() };
    const svc = new CancelledGoodsService(prisma as never, realtime as never);
    // Phần đọc lại sau khi chuyển không phải đối tượng test.
    (svc as unknown as { buildRow: jest.Mock }).buildRow = jest
      .fn()
      .mockResolvedValue({ ok: true });
    return { svc, tx, realtime };
  }

  const packed = (qty: number, targetItemId = '106') => ({
    kind: 'PACKED' as const,
    targetItemId,
    qty,
  });

  it('chỉ chuyển hàng của đề nghị huỷ Sếp đã duyệt', async () => {
    const { svc } = setup({ status: 'PENDING' });
    await expect(svc.transfer('u1', '7', packed(1))).rejects.toThrow(ConflictException);
  });

  it('khung đan phải chọn mảnh', async () => {
    const { svc } = setup();
    await expect(
      svc.transfer('u1', '7', { kind: 'WOVEN', targetItemId: '106', qty: 1 }),
    ).rejects.toThrow('phải chọn mảnh');
  });

  it('đích không tồn tại / chính là nguồn -> 404', async () => {
    await expect(setup({ target: null }).svc.transfer('u1', '7', packed(1))).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      setup({ target: target({ id: 105n }) }).svc.transfer('u1', '7', packed(1)),
    ).rejects.toThrow(NotFoundException);
  });

  it('đích đã huỷ / đã Kết thúc -> 409', async () => {
    await expect(
      setup({ target: target({ cancelledAt: new Date() }) }).svc.transfer('u1', '7', packed(1)),
    ).rejects.toThrow(ConflictException);
    const t = target();
    t.productionOrder.floorStage = 'FINISHED';
    await expect(setup({ target: t }).svc.transfer('u1', '7', packed(1))).rejects.toThrow(
      'đã Kết thúc',
    );
  });

  it('khác sản phẩm / khác màu dây / (đã đóng gói) khác vải nệm -> 400', async () => {
    await expect(
      setup({ target: target({ mfgProductId: 127n }) }).svc.transfer('u1', '7', packed(1)),
    ).rejects.toThrow('Khác sản phẩm');
    await expect(
      setup({ target: target({ wireMaterialId: 8n }) }).svc.transfer('u1', '7', packed(1)),
    ).rejects.toThrow('Khác màu dây');
    await expect(
      setup({ target: target({ cushionMaterialId: null }), packed: 5 }).svc.transfer(
        'u1',
        '7',
        packed(1),
      ),
    ).rejects.toThrow('Khác vải nệm');
  });

  it('khung đan: khác vải nệm vẫn chuyển được (chỉ cần cùng sản phẩm + màu dây)', async () => {
    const { svc, tx } = setup({
      target: target({ cushionMaterialId: null }),
      receipts: [{ pieceId: 20n, qty: 4 }],
    });
    await svc.transfer('u1', '7', { kind: 'WOVEN', targetItemId: '106', pieceId: '20', qty: 3 });
    expect(tx.cancelledGoodsTransfer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'WOVEN', pieceId: 20n, qty: 3, targetItemId: 106n }),
    });
    expect(tx.packagingRecord.create).not.toHaveBeenCalled();
  });

  it('đã đóng gói: còn = đã đóng − đã giao − đã chuyển; vượt -> 400', async () => {
    const { svc } = setup({
      packed: 5,
      shipped: 1,
      transfersOut: [{ kind: 'PACKED', pieceId: null, qty: 2 }],
    });
    await expect(svc.transfer('u1', '7', packed(3))).rejects.toThrow('Chỉ còn 2 bộ');
  });

  it('đã đóng gói: đích không nhận quá số bộ của lệnh', async () => {
    const { svc } = setup({ packed: 5, targetPacked: 9 });
    await expect(svc.transfer('u1', '7', packed(2))).rejects.toThrow('nhận thêm tối đa 1 bộ');
  });

  it('đã đóng gói hợp lệ: ghi bản chuyển + dòng đóng gói của đích gắn transferId, khoá nguồn rồi đích, phát realtime', async () => {
    const { svc, tx, realtime } = setup({ packed: 3 });
    await svc.transfer('u1', '7', { ...packed(2), note: ' khách khác lấy ' });
    expect(tx.cancelledGoodsTransfer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cancelRequestId: 7n,
        kind: 'PACKED',
        sourceItemId: 105n,
        targetItemId: 106n,
        qty: 2,
        note: 'khách khác lấy',
        createdById: 'u1',
      }),
    });
    expect(tx.packagingRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productionInvoiceItemId: 106n,
        boxesPacked: 2,
        transferId: 900n,
      }),
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(realtime.publishEntityChanged).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'PRODUCTION_ORDER', entityId: 66n }),
    );
  });

  it('khung đan: mảnh không phải khung đan trong định mức đích -> 400', async () => {
    const { svc } = setup({ receipts: [{ pieceId: 20n, qty: 4 }], bomPiece: null });
    await expect(
      svc.transfer('u1', '7', { kind: 'WOVEN', targetItemId: '106', pieceId: '20', qty: 1 }),
    ).rejects.toThrow('không phải khung đan');
  });

  it('khung đan: vượt số đã nhận còn lại / vượt số đích cần -> 400', async () => {
    await expect(
      setup({
        receipts: [{ pieceId: 20n, qty: 4 }],
        transfersOut: [{ kind: 'WOVEN', pieceId: 20n, qty: 3 }],
      }).svc.transfer('u1', '7', { kind: 'WOVEN', targetItemId: '106', pieceId: '20', qty: 2 }),
    ).rejects.toThrow('Chỉ còn 1 khung');
    await expect(
      setup({ receipts: [{ pieceId: 20n, qty: 4 }], targetReceived: 8, targetIn: 1 }).svc.transfer(
        'u1',
        '7',
        { kind: 'WOVEN', targetItemId: '106', pieceId: '20', qty: 2 },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
