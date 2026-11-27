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
      transfersOut?: { kind: string; pieceId: bigint | null; qty: number }[];
      targetPacked?: number;
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
      cancelledGoodsTransfer: {
        findMany: jest.fn().mockResolvedValue(opts.transfersOut ?? []),
        create: jest.fn().mockResolvedValue({ id: 900n }),
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
    const wovenStock = { loadStock: jest.fn().mockResolvedValue([]) };
    const svc = new CancelledGoodsService(prisma as never, realtime as never, wovenStock as never);
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

  it('Q6 1b (26/11): khung đã đan không chuyển tay - đã vào tồn khung đan kho thành phẩm', async () => {
    const { svc, tx } = setup();
    await expect(
      svc.transfer('u1', '7', { kind: 'WOVEN', targetItemId: '106', pieceId: '20', qty: 1 }),
    ).rejects.toThrow('tồn khung đan');
    expect(tx.cancelledGoodsTransfer.create).not.toHaveBeenCalled();
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
});

/** Khung đan lấy khác kho TP: thủ kho nơi nhận nhập số thực nhận; phần không nhận về lại kho nguồn (Nhân 27/11 cách 2). */
describe('CancelledGoodsService.confirmWovenReceived', () => {
  function setup(opts: { qty?: number; status?: string; orderStatus?: string } = {}) {
    const tx = {
      $executeRaw: jest.fn(),
      cancelledGoodsTransfer: {
        findUnique: jest.fn().mockResolvedValue({
          receiveStatus: opts.status ?? 'PENDING',
          toWarehouseCode: 'thanh-pham-2',
          targetItemId: 109n,
          pieceId: 334n,
          qty: opts.qty ?? 3,
        }),
        update: jest.fn(),
        delete: jest.fn(),
      },
      productionOrder: {
        findFirst: jest.fn().mockResolvedValue({ id: 70n, status: opts.orderStatus ?? 'RELEASED' }),
      },
    };
    const prisma = {
      $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const realtime = { publishEntityChanged: jest.fn() };
    const wovenStock = { allocateAll: jest.fn() };
    const svc = new CancelledGoodsService(prisma as never, realtime as never, wovenStock as never);
    (svc as unknown as { listWovenInTransit: jest.Mock }).listWovenInTransit = jest
      .fn()
      .mockResolvedValue([]);
    return { svc, tx, wovenStock };
  }
  const SLIP = ['https://x/phieu.jpg'];

  it('bỏ trống số = nhận đủ, không cấp tồn lại khi lệnh nhận còn chạy', async () => {
    const { svc, tx, wovenStock } = setup();
    await svc.confirmWovenReceived('u1', '5', SLIP, 'thanh-pham-2');
    expect(tx.cancelledGoodsTransfer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ qty: 3, receiveStatus: 'RECEIVED' }),
      }),
    );
    expect(wovenStock.allocateAll).not.toHaveBeenCalled();
  });

  it('nhận thiếu: dòng còn đúng số thực nhận, phần thiếu về kho nguồn rồi cấp tồn lại', async () => {
    const { svc, tx, wovenStock } = setup();
    await svc.confirmWovenReceived('u1', '5', SLIP, 'thanh-pham-2', 1);
    expect(tx.cancelledGoodsTransfer.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ qty: 1 }) }),
    );
    expect(wovenStock.allocateAll).toHaveBeenCalledWith('u1', { pieceId: 334n });
  });

  it('lệnh nhận đã huỷ: phần nhận thành tồn kho này, cấp tồn lại', async () => {
    const { svc, wovenStock } = setup({ orderStatus: 'CANCELLED' });
    await svc.confirmWovenReceived('u1', '5', SLIP, 'thanh-pham-2', 3);
    expect(wovenStock.allocateAll).toHaveBeenCalledWith('u1', { pieceId: 334n });
  });

  it('nhận 0: bỏ dòng, không cần ảnh phiếu', async () => {
    const { svc, tx } = setup({ orderStatus: 'CANCELLED' });
    await svc.confirmWovenReceived('u1', '5', [], 'thanh-pham-2', 0);
    expect(tx.cancelledGoodsTransfer.delete).toHaveBeenCalledWith({ where: { id: 5n } });
    expect(tx.cancelledGoodsTransfer.update).not.toHaveBeenCalled();
  });

  it('chặn: nhận > 0 mà không ảnh phiếu, nhận vượt số đang chuyển, dòng đã nhận', async () => {
    await expect(
      setup().svc.confirmWovenReceived('u1', '5', [], 'thanh-pham-2', 2),
    ).rejects.toThrow(BadRequestException);
    await expect(
      setup().svc.confirmWovenReceived('u1', '5', SLIP, 'thanh-pham-2', 4),
    ).rejects.toThrow(BadRequestException);
    await expect(
      setup({ status: 'RECEIVED' }).svc.confirmWovenReceived('u1', '5', SLIP, 'thanh-pham-2'),
    ).rejects.toThrow(ConflictException);
  });
});
