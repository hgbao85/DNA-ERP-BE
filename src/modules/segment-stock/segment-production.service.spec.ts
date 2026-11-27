import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { SegmentProductionService } from './segment-production.service';
import { SegmentStockService } from './segment-stock.service';

const dec = (n: number) => ({ toNumber: () => n });

describe('SegmentProductionService', () => {
  let service: SegmentProductionService;
  let segmentStock: { syncOrderProduction: jest.Mock };
  let prisma: {
    productionInvoice: { findUnique: jest.Mock; findUniqueOrThrow: jest.Mock };
    productionOrder: { findMany: jest.Mock };
    bomPiece: { findMany: jest.Mock };
    pieceBom: { findMany: jest.Mock };
    segmentReservationLog: { findMany: jest.Mock };
    cuttingPlanCoverage: { findMany: jest.Mock };
    cutPatternSegment: { findMany: jest.Mock };
    stepBatchSegment: { findMany: jest.Mock };
    qcReviewSegment: { findMany: jest.Mock };
    segmentProduction: { findMany: jest.Mock };
    productionInvoiceItem: { findFirst: jest.Mock };
    warehouse: { findFirst: jest.Mock; findUnique: jest.Mock };
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let order: string[];
  const OLD_ENV = process.env.SEGMENT_STOCK_ENABLED;

  // Lệnh 900: 1 SKU x 10 bộ, bomRevision 5; mảnh 20 cần 5 đoạn cỡ 30 mỗi bộ, trơn (qtyPerPiece 5 × qtyPerUnit 1 × 10 = 50) và
  // 5 đoạn cỡ 30 có Dập (processSteps ['DAP']) cho mảnh 21 -> cần trơn 50, DAP 50.
  const pieceBoms = [
    { bomRevisionId: 5n, pieceId: 20n, segmentSpecId: 30n, qtyPerPiece: 5, processSteps: [] },
    { bomRevisionId: 5n, pieceId: 21n, segmentSpecId: 30n, qtyPerPiece: 5, processSteps: ['DAP'] },
  ];

  const setData = (over: Record<string, unknown> = {}) => {
    const d = {
      invoice: { status: 'PRODUCING' },
      orders: [{ id: 1n, bomRevisionId: 5n, quantity: 10, floorStage: 'ACTIVE' }],
      bomPieces: [
        { bomRevisionId: 5n, pieceId: 20n, qtyPerUnit: 1 },
        { bomRevisionId: 5n, pieceId: 21n, qtyPerUnit: 1 },
      ],
      pieceBoms,
      // Đã cắt 120 (đều đã KCS), lỗi cắt 0.
      cutSegments: [{ segmentSpecId: 30n, qty: 120, cutBundle: { status: 'QC_PASSED' } }],
      cutQc: [] as unknown[],
      // Dập 20 đã KCS.
      stepSegments: [
        {
          segmentSpecId: 30n,
          qty: 20,
          stepBatch: { step: 'DAP', stepBundle: { status: 'QC_PASSED' } },
        },
      ],
      stepQc: [] as unknown[],
      ...over,
    };
    prisma.productionInvoice.findUniqueOrThrow.mockResolvedValue(d.invoice);
    // Ghi vết thứ tự đọc để kiểm "khoá trước, đọc sau".
    prisma.productionOrder.findMany.mockImplementation(() => {
      order.push('read');
      return Promise.resolve(d.orders);
    });
    prisma.bomPiece.findMany.mockResolvedValue(d.bomPieces);
    prisma.pieceBom.findMany.mockResolvedValue(d.pieceBoms);
    prisma.cutPatternSegment.findMany.mockResolvedValue(d.cutSegments);
    prisma.stepBatchSegment.findMany.mockResolvedValue(d.stepSegments);
    // qcReviewSegment.findMany được gọi 2 lần theo thứ tự: lỗi cắt rồi lỗi công đoạn.
    prisma.qcReviewSegment.findMany.mockReset();
    prisma.qcReviewSegment.findMany.mockResolvedValueOnce(d.cutQc).mockResolvedValueOnce(d.stepQc);
  };

  beforeEach(() => {
    order = [];
    process.env.SEGMENT_STOCK_ENABLED = 'true';
    segmentStock = {
      syncOrderProduction: jest.fn().mockImplementation(() => {
        order.push('sync');
        return Promise.resolve({ productionInvoiceId: 900n, changes: [] });
      }),
    };
    prisma = {
      productionInvoice: {
        findUnique: jest.fn().mockResolvedValue({ id: 900n }),
        findUniqueOrThrow: jest.fn(),
      },
      productionOrder: { findMany: jest.fn() },
      bomPiece: { findMany: jest.fn() },
      pieceBom: { findMany: jest.fn() },
      segmentReservationLog: { findMany: jest.fn().mockResolvedValue([]) },
      cuttingPlanCoverage: { findMany: jest.fn().mockResolvedValue([]) },
      cutPatternSegment: { findMany: jest.fn() },
      stepBatchSegment: { findMany: jest.fn() },
      qcReviewSegment: { findMany: jest.fn() },
      segmentProduction: {
        findMany: jest.fn().mockResolvedValue([
          {
            segmentSpecId: 30n,
            segmentSteps: '',
            warehouseId: 7n,
            heldQty: dec(10),
            surplusQty: dec(0),
          },
        ]),
      },
      productionInvoiceItem: { findFirst: jest.fn().mockResolvedValue({ workshopId: 3n }) },
      warehouse: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 7n, code: 'phoi-x', kind: 'PHOI', workshopId: 3n }),
        findUnique: jest.fn().mockResolvedValue({ id: 8n, code: 'phoi-son-han' }),
      },
      $executeRaw: jest.fn().mockImplementation(() => {
        order.push('lock');
        return Promise.resolve(1);
      }),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    service = new SegmentProductionService(
      prisma as unknown as PrismaServiceType,
      segmentStock as unknown as SegmentStockService,
    );
    setData();
  });

  afterAll(() => {
    if (OLD_ENV === undefined) delete process.env.SEGMENT_STOCK_ENABLED;
    else process.env.SEGMENT_STOCK_ENABLED = OLD_ENV;
  });

  it('dryRun: tính đúng số, không khoá, không ghi, chạy được cả khi công tắc tắt', async () => {
    process.env.SEGMENT_STOCK_ENABLED = 'false';
    setData();

    const r = await service.recomputeForPi(900n, { reason: 'ADMIN_RECOMPUTE', dryRun: true });

    expect(r.dryRun).toBe(true);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(segmentStock.syncOrderProduction).not.toHaveBeenCalled();
    expect(r.specs).toHaveLength(1);
    const s = r.specs[0];
    expect(s.cutPassedQty).toBe(120);
    expect(s.stepPassedQty).toEqual({ DAP: 20 });
    // Cần DAP 50, trơn 50; cắt 120, DAP 20 -> DAP giữ 20, trơn giữ 50 (dư 50), chờ 30.
    expect(s.variants).toEqual([
      { segmentSteps: 'DAP', needQty: 50, heldQty: 20, surplusQty: 0 },
      { segmentSteps: '', needQty: 50, heldQty: 50, surplusQty: 20 },
    ]);
    expect(s.wipQty).toBe(30);
    expect(r.current).toEqual([
      { segmentSpecId: 30n, segmentSteps: '', warehouseId: 7n, heldQty: 10, surplusQty: 0 },
    ]);
    expect(r.warehouseId).toBe(7n);
  });

  it('PI không tồn tại -> NotFoundException', async () => {
    prisma.productionInvoice.findUnique.mockResolvedValue(null);
    await expect(service.recomputeForPi(1n, { reason: 'x', dryRun: true })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('ghi thật: công tắc tắt -> ConflictException, không mở transaction', async () => {
    process.env.SEGMENT_STOCK_ENABLED = 'false';
    await expect(service.recomputeForPi(900n, { reason: 'x' })).rejects.toThrow(
      /SEGMENT_STOCK_ENABLED/,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('ghi thật: khoá TRƯỚC khi đọc số liệu, rồi gọi syncOrderProduction với đủ mọi dòng đích', async () => {
    setData();
    order.length = 0;

    const r = await service.recomputeForPi(900n, { actorId: 'u1', reason: 'QC_CUT_BUNDLE:1' });

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 10_000,
      timeout: 30_000,
    });
    expect(order.indexOf('lock')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('lock')).toBeLessThan(order.indexOf('sync'));
    expect(segmentStock.syncOrderProduction).toHaveBeenCalledWith(prisma, {
      productionInvoiceId: 900n,
      warehouseId: 7n,
      targets: [
        { segmentSpecId: 30n, segmentSteps: '', heldQty: 50, surplusQty: 20 },
        { segmentSpecId: 30n, segmentSteps: 'DAP', heldQty: 20, surplusQty: 0 },
      ],
      actorId: 'u1',
      reason: 'QC_CUT_BUNDLE:1',
    });
    expect(r.dryRun).toBe(false);
    expect(r.changes).toEqual([]);
  });

  it('rà soát 14/11 TĐ8: ghi thật giữ khoá chuyển đổi dữ liệu cũ (dùng chung) TRƯỚC khoá lệnh', async () => {
    setData();
    await service.recomputeForPi(900n, { actorId: 'u1', reason: 'QC_CUT_BUNDLE:1' });
    const calls = prisma.$executeRaw.mock.calls as [TemplateStringsArray, string][];
    expect(calls[0][0].join('?')).toContain('pg_advisory_xact_lock_shared');
    expect(calls[0][1]).toBe('segment-legacy-conversion');
    expect(calls[1][1]).toBe('segment-production:900');
  });

  it('ghi thật: lệnh đã kết thúc (DONE) -> ConflictException, không gọi sync', async () => {
    setData({ invoice: { status: 'DONE' } });
    await expect(service.recomputeForPi(900n, { reason: 'x' })).rejects.toThrow(ConflictException);
    expect(segmentStock.syncOrderProduction).not.toHaveBeenCalled();
  });

  it('ghi thật: mọi SKU FINISHED -> coi là đã kết thúc', async () => {
    setData({
      orders: [{ id: 1n, bomRevisionId: 5n, quantity: 10, floorStage: 'FINISHED' }],
    });
    await expect(service.recomputeForPi(900n, { reason: 'x' })).rejects.toThrow(ConflictException);
  });

  // Huỷ lệnh đợt 2 - Q2 (nghiệp vụ 24/11/2026): đoạn của SKU huỷ tự vào dư kho Phôi.
  it('Q2: SKU đã huỷ không tính số cần - đích giữ chỉ theo SKU còn hiệu lực', async () => {
    setData({
      orders: [
        { id: 1n, bomRevisionId: 5n, quantity: 10, floorStage: 'ACTIVE', status: 'RELEASED' },
        { id: 2n, bomRevisionId: 5n, quantity: 10, floorStage: 'FINISHED', status: 'CANCELLED' },
      ],
    });
    await service.recomputeForPi(900n, { reason: 'x' });
    expect(segmentStock.syncOrderProduction).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        targets: [
          { segmentSpecId: 30n, segmentSteps: '', heldQty: 50, surplusQty: 20 },
          { segmentSpecId: 30n, segmentSteps: 'DAP', heldQty: 20, surplusQty: 0 },
        ],
      }),
    );
  });

  it('Q2: lệnh đã đóng có SKU huỷ -> vẫn ghi, không giữ gì (mọi đoạn đạt vào dư)', async () => {
    setData({
      orders: [
        { id: 2n, bomRevisionId: 5n, quantity: 10, floorStage: 'FINISHED', status: 'CANCELLED' },
      ],
    });
    await service.recomputeForPi(900n, { reason: 'PO_CANCELLED:2' });
    const arg = (
      segmentStock.syncOrderProduction.mock.calls[0] as [
        unknown,
        { targets: { heldQty: number; surplusQty: number }[] },
      ]
    )[1];
    expect(arg.targets.every((t) => t.heldQty === 0)).toBe(true);
    expect(arg.targets.reduce((sum, t) => sum + t.surplusQty, 0)).toBeGreaterThan(0);
  });

  it('công thức đạt KCS: trừ lỗi, trừ đợt đang cắt / chờ KCS; lỗi công đoạn tính theo step', async () => {
    setData({
      cutSegments: [
        { segmentSpecId: 30n, qty: 100, cutBundle: { status: 'QC_PASSED' } },
        { segmentSpecId: 30n, qty: 20, cutBundle: { status: 'CUTTING' } },
        { segmentSpecId: 30n, qty: 10, cutBundle: { status: 'AWAITING_QC' } },
      ],
      cutQc: [{ segmentSpecId: 30n, failedQty: 5 }],
      stepSegments: [
        {
          segmentSpecId: 30n,
          qty: 40,
          stepBatch: { step: 'DAP', stepBundle: { status: 'QC_PASSED' } },
        },
        { segmentSpecId: 30n, qty: 6, stepBatch: { step: 'DAP', stepBundle: null } },
        {
          segmentSpecId: 30n,
          qty: 9,
          stepBatch: { step: 'UON', stepBundle: { status: 'QC_PASSED' } },
        },
        { segmentSpecId: 30n, qty: 99, stepBatch: { step: 'CAT', stepBundle: null } },
      ],
      stepQc: [
        { segmentSpecId: 30n, failedQty: 4, qcReview: { stepBundle: { step: 'DAP' } } },
        { segmentSpecId: 30n, failedQty: 2, qcReview: { stepBundle: { step: 'UON' } } },
      ],
    });

    const r = await service.recomputeForPi(900n, { reason: 'x', dryRun: true });

    // Cắt: max(0, 130 - 5) - 20 - 10 = 95. DAP: max(0, 46 - 4) - 6 = 36. UON: 9 - 2 = 7. CAT bỏ.
    expect(r.specs[0].cutPassedQty).toBe(95);
    expect(r.specs[0].stepPassedQty).toEqual({ UON: 7, DAP: 36 });
  });

  it('P1 AC38: KCS ghi thiếu / bỏ - cắt trừ thiếu Cắt và Σ bỏ ở mọi công đoạn phụ, công đoạn trừ thiếu của chính nó', async () => {
    setData({
      cutSegments: [{ segmentSpecId: 30n, qty: 120, cutBundle: { status: 'QC_PASSED' } }],
      cutQc: [{ segmentSpecId: 30n, failedQty: 0, shortQty: 2, scrapQty: 0 }],
      stepSegments: [
        {
          segmentSpecId: 30n,
          qty: 20,
          stepBatch: { step: 'DAP', stepBundle: { status: 'QC_PASSED' } },
        },
      ],
      // Dập: lỗi 5 (bỏ 4, làm lại 1) và thiếu 3.
      stepQc: [
        {
          segmentSpecId: 30n,
          failedQty: 5,
          shortQty: 3,
          scrapQty: 4,
          qcReview: { stepBundle: { step: 'DAP' } },
        },
      ],
    });

    const r = await service.recomputeForPi(900n, { reason: 'x', dryRun: true });

    // Cắt: 120 - thiếu 2 - bỏ 4 (Dập, mọi công đoạn phụ) = 114. Dập: 20 - (lỗi 5 + thiếu 3) = 12 (phần bỏ đã nằm trong lỗi).
    expect(r.specs[0].cutPassedQty).toBe(114);
    expect(r.specs[0].stepPassedQty).toEqual({ DAP: 12 });
  });

  it('P1 AC38: phần bỏ ở công đoạn sau chỉ trừ công đoạn đứng trước khi có dòng định mức cần cả 2', async () => {
    const both = [
      {
        bomRevisionId: 5n,
        pieceId: 20n,
        segmentSpecId: 30n,
        qtyPerPiece: 5,
        processSteps: ['DAP', 'UON'],
      },
    ];
    const stepRows = [
      {
        segmentSpecId: 30n,
        qty: 50,
        stepBatch: { step: 'UON', stepBundle: { status: 'QC_PASSED' } },
      },
      {
        segmentSpecId: 30n,
        qty: 50,
        stepBatch: { step: 'DAP', stepBundle: { status: 'QC_PASSED' } },
      },
    ];
    const dapScrap = [
      {
        segmentSpecId: 30n,
        failedQty: 4,
        shortQty: 0,
        scrapQty: 4,
        qcReview: { stepBundle: { step: 'DAP' } },
      },
    ];
    // Dòng cần cả Uốn lẫn Dập (Uốn đứng trước Dập): Uốn bị trừ 4 vì Dập bỏ 4.
    setData({ pieceBoms: both, stepSegments: stepRows, stepQc: dapScrap });
    const withBoth = await service.recomputeForPi(900n, { reason: 'x', dryRun: true });
    expect(withBoth.specs[0].stepPassedQty).toEqual({ UON: 46, DAP: 46 });
    expect(withBoth.specs[0].cutPassedQty).toBe(116);

    // Uốn và Dập ở 2 dòng khác nhau: Uốn không phải làm bù, chỉ Cắt bị trừ.
    setData({
      pieceBoms: [
        {
          bomRevisionId: 5n,
          pieceId: 20n,
          segmentSpecId: 30n,
          qtyPerPiece: 5,
          processSteps: ['UON'],
        },
        {
          bomRevisionId: 5n,
          pieceId: 21n,
          segmentSpecId: 30n,
          qtyPerPiece: 5,
          processSteps: ['DAP'],
        },
      ],
      stepSegments: stepRows,
      stepQc: dapScrap,
    });
    const separate = await service.recomputeForPi(900n, { reason: 'x', dryRun: true });
    expect(separate.specs[0].stepPassedQty).toEqual({ UON: 50, DAP: 46 });
    expect(separate.specs[0].cutPassedQty).toBe(116);
  });

  it('recomputeAfterQc: công tắc tắt -> return ngay, không truy vấn gì', async () => {
    process.env.SEGMENT_STOCK_ENABLED = 'false';
    await service.recomputeAfterQc(900n, 'u1', 'QC_CUT_BUNDLE:1');
    expect(prisma.productionInvoice.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('recomputeAfterQc: lỗi bất kỳ chỉ log, không ném', async () => {
    setData();
    segmentStock.syncOrderProduction.mockRejectedValue(new Error('boom'));
    await expect(service.recomputeAfterQc(900n, 'u1', 'QC_CUT_BUNDLE:1')).resolves.toBeUndefined();
  });

  it('recomputeAfterQc: lệnh đã kết thúc -> bỏ qua êm, không ghi', async () => {
    setData({ invoice: { status: 'CANCELLED' } });
    await expect(service.recomputeAfterQc(900n, null, 'QC_STEP_BUNDLE:2')).resolves.toBeUndefined();
    expect(segmentStock.syncOrderProduction).not.toHaveBeenCalled();
  });

  it('recomputeAfterQc: chạy được thì gọi sync với actorId và reason', async () => {
    setData();
    await service.recomputeAfterQc(900n, 'u9', 'QC_STEEL_ISSUE:5');
    expect(segmentStock.syncOrderProduction).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ actorId: 'u9', reason: 'QC_STEEL_ISSUE:5' }),
    );
  });
});
