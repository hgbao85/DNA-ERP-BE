import { PrismaServiceType } from '../../prisma/prisma.service';
import { SegmentProductionService } from './segment-production.service';
import { SegmentStockService } from './segment-stock.service';

/**
 * UB4 (QA, P1-T3-U1) - AC38: tồn đoạn kho Phôi theo số KCS chấm mới (thiếu / bỏ / làm lại).
 * Tình huống AC30 + 1 đợt cắt cỡ 355 KCS ghi thiếu 2: Uốn lỗi 8 (bỏ 5, làm lại 3).
 * Sổ dữ liệu đọc theo ĐIỀU KIỆN where (không theo thứ tự gọi findMany).
 */

const OLD_ENV = process.env.SEGMENT_STOCK_ENABLED;

interface QcCut {
  failedQty: number;
  shortQty: number;
}
interface QcStep {
  failedQty: number;
  shortQty: number;
  scrapQty: number;
  step: string;
}
interface Data {
  pieceBoms: {
    bomRevisionId: bigint;
    pieceId: bigint;
    segmentSpecId: bigint;
    qtyPerPiece: number;
    processSteps: string[];
  }[];
  cutSegments: { segmentSpecId: bigint; qty: number; cutBundle: { status: string } }[];
  cutQc: QcCut[];
  stepSegments: {
    segmentSpecId: bigint;
    qty: number;
    stepBatch: { step: string; stepBundle: { status: string } | null };
  }[];
  stepQc: QcStep[];
}

const SPEC = 355n;
const line = (pieceId: bigint, qtyPerPiece: number, processSteps: string[]) => ({
  bomRevisionId: 5n,
  pieceId,
  segmentSpecId: SPEC,
  qtyPerPiece,
  processSteps,
});
const cutRow = (qty: number, status = 'QC_PASSED') => ({
  segmentSpecId: SPEC,
  qty,
  cutBundle: { status },
});
const stepRow = (qty: number, step: string, bundle: string | null = 'QC_PASSED') => ({
  segmentSpecId: SPEC,
  qty,
  stepBatch: { step, stepBundle: bundle ? { status: bundle } : null },
});

function setup(d: Data) {
  const syncOrderProduction = jest
    .fn()
    .mockResolvedValue({ productionInvoiceId: 900n, changes: [] });
  const prisma = {
    productionInvoice: {
      findUnique: jest.fn().mockResolvedValue({ id: 900n }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ status: 'PRODUCING' }),
    },
    productionOrder: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 1n, bomRevisionId: 5n, quantity: 10, floorStage: 'ACTIVE' }]),
    },
    bomPiece: {
      findMany: jest.fn().mockResolvedValue(
        [...new Set(d.pieceBoms.map((p) => p.pieceId))].map((pieceId) => ({
          bomRevisionId: 5n,
          pieceId,
          qtyPerUnit: 1,
        })),
      ),
    },
    pieceBom: { findMany: jest.fn().mockResolvedValue(d.pieceBoms) },
    segmentReservationLog: { findMany: jest.fn().mockResolvedValue([]) },
    cuttingPlanCoverage: { findMany: jest.fn().mockResolvedValue([]) },
    cutPatternSegment: { findMany: jest.fn().mockResolvedValue(d.cutSegments) },
    stepBatchSegment: { findMany: jest.fn().mockResolvedValue(d.stepSegments) },
    qcReviewSegment: {
      findMany: jest
        .fn()
        .mockImplementation((a: { where: { qcReview: Record<string, unknown> } }) => {
          if ('stepBundle' in a.where.qcReview) {
            return Promise.resolve(
              d.stepQc.map((r) => ({
                segmentSpecId: SPEC,
                failedQty: r.failedQty,
                shortQty: r.shortQty,
                scrapQty: r.scrapQty,
                qcReview: { stepBundle: { step: r.step } },
              })),
            );
          }
          return Promise.resolve(
            d.cutQc.map((r) => ({
              segmentSpecId: SPEC,
              failedQty: r.failedQty,
              shortQty: r.shortQty,
            })),
          );
        }),
    },
    segmentProduction: { findMany: jest.fn().mockResolvedValue([]) },
    productionInvoiceItem: { findFirst: jest.fn().mockResolvedValue({ workshopId: 3n }) },
    warehouse: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 7n, code: 'phoi-x', kind: 'PHOI', workshopId: 3n }),
      findUnique: jest.fn().mockResolvedValue({ id: 8n, code: 'phoi-son-han' }),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));
  const service = new SegmentProductionService(
    prisma as unknown as PrismaServiceType,
    { syncOrderProduction } as unknown as SegmentStockService,
  );
  return { service, syncOrderProduction };
}

describe('UB4 segment-production theo KCS mới (QA, AC38)', () => {
  beforeEach(() => {
    process.env.SEGMENT_STOCK_ENABLED = 'true';
  });
  afterAll(() => {
    if (OLD_ENV === undefined) delete process.env.SEGMENT_STOCK_ENABLED;
    else process.env.SEGMENT_STOCK_ENABLED = OLD_ENV;
  });

  // AC30: Cắt 1180 đã chấm, Uốn 1180 đã chấm lỗi 8 (bỏ 5, làm lại 3); thêm 1 đợt cắt (10 đoạn) KCS ghi thiếu 2.
  const ac38 = (over: Partial<Data> = {}): Data => ({
    pieceBoms: [line(20n, 118, ['UON'])], // 118 x 1 x 10 SKU = 1180
    cutSegments: [cutRow(1180), cutRow(10)],
    cutQc: [{ failedQty: 0, shortQty: 2 }],
    stepSegments: [stepRow(1180, 'UON')],
    stepQc: [{ failedQty: 8, shortQty: 0, scrapQty: 5, step: 'UON' }],
    ...over,
  });

  it('AC38: số đoạn cắt đạt của cỡ 355 trừ 5 (bỏ) và 2 (thiếu); số đoạn đủ công đoạn Uốn trừ 8 (lỗi, đã gồm bỏ - không trừ 2 lần)', async () => {
    const { service } = setup(ac38());
    const r = await service.recomputeForPi(900n, { reason: 'x', dryRun: true });
    expect(r.specs[0].cutPassedQty).toBe(1190 - 5 - 2);
    expect(r.specs[0].stepPassedQty).toEqual({ UON: 1172 });
  });

  it('AC38: chạy recomputeAfterQc thật -> ghi vào sổ tồn đoạn đúng số mới (Uốn giữ 1172, không ghi số cũ 1180)', async () => {
    const { service, syncOrderProduction } = setup(ac38());
    await service.recomputeAfterQc(900n, 'kcs-1', 'QC_STEP_BUNDLE:9');
    expect(syncOrderProduction).toHaveBeenCalledTimes(1);
    const arg = (
      syncOrderProduction.mock.calls as unknown as [
        [
          unknown,
          {
            targets: { segmentSteps: string; heldQty: number; surplusQty: number }[];
            reason: string;
          },
        ],
      ]
    )[0][1];
    expect(arg.reason).toBe('QC_STEP_BUNDLE:9');
    const uon = arg.targets.find((t) => t.segmentSteps === 'UON')!;
    expect(uon.heldQty).toBe(1172);
    expect(uon.surplusQty).toBe(0);
  });

  it('AC38: kho Phôi không hiện đoạn trơn dư ảo - đoạn KCS bỏ / thiếu không còn là đoạn trơn (có dòng trơn cần 10: chỉ 3 đoạn trơn thật)', async () => {
    // Cắt thực có = 1190 - 5 - 2 = 1183; Uốn đạt 1172; 8 đoạn Uốn còn phải làm / cắt lại -> trơn thật = 1183 - 1172 - 8 = 3.
    const { service, syncOrderProduction } = setup(
      ac38({ pieceBoms: [line(20n, 118, ['UON']), line(21n, 1, [])] }),
    );
    await service.recomputeAfterQc(900n, 'kcs-1', 'QC_CUT_BUNDLE:3');
    const targets = (
      syncOrderProduction.mock.calls as unknown as [
        [unknown, { targets: { segmentSteps: string; heldQty: number; surplusQty: number }[] }],
      ]
    )[0][1].targets;
    const tron = targets.find((t) => t.segmentSteps === '')!;
    expect(tron.heldQty).toBe(3);
    expect(tron.surplusQty).toBe(0);
  });

  it('AC38: công đoạn có thiếu của CHÍNH nó: Uốn lỗi 8 (bỏ 5) + thiếu 2 -> đạt 1170', async () => {
    const { service } = setup(
      ac38({ stepQc: [{ failedQty: 8, shortQty: 2, scrapQty: 5, step: 'UON' }] }),
    );
    const r = await service.recomputeForPi(900n, { reason: 'x', dryRun: true });
    expect(r.specs[0].stepPassedQty).toEqual({ UON: 1170 });
    expect(r.specs[0].cutPassedQty).toBe(1190 - 5 - 2);
  });

  it('AC38 (công đoạn sau bỏ -> công đoạn trước phải trừ): Uốn + Dập cùng 1 dòng, Dập bỏ 4 -> Uốn đạt trừ 4, Dập trừ lỗi của nó; Uốn bỏ không trừ Dập', async () => {
    const both = {
      pieceBoms: [line(20n, 10, ['UON', 'DAP'])],
      cutSegments: [cutRow(100)],
      cutQc: [],
      stepSegments: [stepRow(100, 'UON'), stepRow(100, 'DAP')],
    };
    const dapScrap = setup({
      ...both,
      stepQc: [{ failedQty: 4, shortQty: 0, scrapQty: 4, step: 'DAP' }],
    });
    const a = await dapScrap.service.recomputeForPi(900n, { reason: 'x', dryRun: true });
    expect(a.specs[0].stepPassedQty).toEqual({ UON: 96, DAP: 96 });
    expect(a.specs[0].cutPassedQty).toBe(96);

    const uonScrap = setup({
      ...both,
      stepQc: [{ failedQty: 4, shortQty: 0, scrapQty: 4, step: 'UON' }],
    });
    const b = await uonScrap.service.recomputeForPi(900n, { reason: 'x', dryRun: true });
    expect(b.specs[0].stepPassedQty).toEqual({ UON: 96, DAP: 100 });
    expect(b.specs[0].cutPassedQty).toBe(96);
  });

  it('biên: đợt đang cắt / chờ KCS không tính vào đoạn đạt; số bỏ lớn hơn số đã cắt không cho số âm', async () => {
    const { service } = setup({
      pieceBoms: [line(20n, 10, ['UON'])],
      cutSegments: [cutRow(20), cutRow(5, 'CUTTING'), cutRow(3, 'AWAITING_QC')],
      cutQc: [],
      stepSegments: [
        stepRow(9, 'UON', 'QC_PASSED'),
        stepRow(4, 'UON', null),
        stepRow(2, 'UON', 'AWAITING_QC'),
      ],
      stepQc: [{ failedQty: 30, shortQty: 0, scrapQty: 30, step: 'UON' }],
    });
    const r = await service.recomputeForPi(900n, { reason: 'x', dryRun: true });
    expect(r.specs[0].cutPassedQty).toBe(0); // 28 - 30 bỏ -> kẹp về 0, rồi trừ đợt mở: vẫn 0
    expect(r.specs[0].stepPassedQty.UON ?? 0).toBe(0);
  });

  it('biên: chưa có KCS nào chấm (không thiếu, không bỏ) -> số đạt đúng như trước P1', async () => {
    const { service } = setup({
      pieceBoms: [line(20n, 10, ['UON'])],
      cutSegments: [cutRow(100)],
      cutQc: [],
      stepSegments: [stepRow(60, 'UON')],
      stepQc: [],
    });
    const r = await service.recomputeForPi(900n, { reason: 'x', dryRun: true });
    expect(r.specs[0].cutPassedQty).toBe(100);
    expect(r.specs[0].stepPassedQty).toEqual({ UON: 60 });
  });

  it('công tắc tồn đoạn tắt: recomputeAfterQc không đọc / không ghi gì', async () => {
    process.env.SEGMENT_STOCK_ENABLED = 'false';
    const { service, syncOrderProduction } = setup(ac38());
    await service.recomputeAfterQc(900n, 'kcs-1', 'QC_STEP_BUNDLE:9');
    expect(syncOrderProduction).not.toHaveBeenCalled();
  });
});
