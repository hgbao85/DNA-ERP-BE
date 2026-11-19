// `jest.Mock#mock.calls` và `where` truyền cho Prisma được jest gõ `any` -> chạm no-unsafe-*; cùng lý do floor-stats.service.spec.ts.
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { WorkshopScopeService } from '../../common/workshop-scope/workshop-scope.service';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { FloorStatsService } from './floor-stats.service';

/**
 * UB14 (P1 "KCS tự chuyển", tester-unit #1) - AC27: "Đạt KCS" của công nhân A cộng đúng số báo - lỗi - thiếu.
 * Bổ sung cho floor-stats.service.spec.ts của Dev (không lặp: Cắt 120-3-5, công đoạn phụ kẹp 0): ở đây là kịch bản AC27 nhìn từ
 * công nhân A (nhiều lần báo cùng đợt, nhiều tổ, "Sản lượng của tôi"), bất biến báo = đạt + lỗi + thiếu, thiếu KHÔNG vào cột lỗi,
 * số bỏ (scrapQty) không đổi đạt / lỗi, và cỡ lạ trong phiếu chấm không làm hỏng báo cáo.
 */
describe('UB14 FloorStatsService: đạt KCS = báo − lỗi − thiếu (AC27, QA)', () => {
  let prisma: {
    qcReview: { findMany: jest.Mock };
    cutPatternSegment: { findMany: jest.Mock };
    stepBatchSegment: { findMany: jest.Mock };
    productionBatch: { findMany: jest.Mock };
    productionInvoiceItem: { findMany: jest.Mock };
    workshop: { findMany: jest.Mock; findFirst: jest.Mock };
  };
  let service: FloorStatsService;

  const T = new Date('2026-10-15T03:00:00Z'); // 10:00 15/10 giờ VN
  const A = { id: 'u-a', lastName: 'Nguyễn', firstName: 'An', username: 'u-a' };
  const B = { id: 'u-b', lastName: 'Trần', firstName: 'Bình', username: 'u-b' };
  const nameOf = (u: typeof A) => ({
    firstName: u.firstName,
    lastName: u.lastName,
    username: u.username,
  });
  const spec = (id: number, mm: string) => ({
    segmentSpecId: BigInt(id),
    segmentSpec: { cutLengthMm: { toString: () => mm }, material: { name: 'Sắt phi 4' } },
  });
  type Seg = { id: number; failedQty: number; shortQty: number; scrapQty?: number };
  const qcSegs = (segs: Seg[]) =>
    segs.map((s) => ({
      segmentSpecId: BigInt(s.id),
      failedQty: s.failedQty,
      shortQty: s.shortQty,
      ...(s.scrapQty !== undefined ? { scrapQty: s.scrapQty } : {}),
    }));

  const cutReview = (
    by: typeof A,
    bundleSegs: { id: number; mm: string; qty: number }[],
    qc: Seg[],
  ) => ({
    reviewedAt: T,
    segments: qcSegs(qc),
    cutBundle: {
      openedById: by.id,
      openedBy: nameOf(by),
      segments: bundleSegs.map((s) => ({ ...spec(s.id, s.mm), qty: s.qty })),
    },
  });
  /** Đợt công đoạn phụ gom nhiều lần báo (mỗi phần tử `batches` = 1 lần báo, mỗi lần có thể nhiều cỡ). */
  const stepReview = (
    by: typeof A,
    step: string,
    batches: { id: number; mm: string; qty: number }[][],
    qc: Seg[],
  ) => ({
    reviewedAt: T,
    segments: qcSegs(qc),
    stepBundle: {
      step,
      reportedById: by.id,
      reportedBy: nameOf(by),
      batches: batches.map((segs) => ({
        segments: segs.map((s) => ({ ...spec(s.id, s.mm), qty: s.qty })),
      })),
    },
  });
  const batchReview = (stage: string, passed: number, failedQty: number, by = A) => ({
    reviewedAt: T,
    failedQty,
    productionBatch: {
      stage,
      reportedQty: passed,
      reportedById: by.id,
      reportedBy: nameOf(by),
      piece: { name: 'Mê ngồi' },
    },
  });

  const reviews = (r: { cut?: unknown[]; step?: unknown[]; batch?: unknown[] }) =>
    prisma.qcReview.findMany.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(
        where.cutBundleId
          ? (r.cut ?? [])
          : where.stepBundleId
            ? (r.step ?? [])
            : where.productionBatchId
              ? (r.batch ?? [])
              : [],
      ),
    );

  beforeEach(() => {
    prisma = {
      qcReview: { findMany: jest.fn().mockResolvedValue([]) },
      cutPatternSegment: { findMany: jest.fn().mockResolvedValue([]) },
      stepBatchSegment: { findMany: jest.fn().mockResolvedValue([]) },
      productionBatch: { findMany: jest.fn().mockResolvedValue([]) },
      productionInvoiceItem: { findMany: jest.fn().mockResolvedValue([]) },
      workshop: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const scope = {
      getScope: jest
        .fn()
        .mockResolvedValue({ workshopId: null, workshopName: null, visibleWorkshopIds: null }),
    };
    service = new FloorStatsService(
      prisma as unknown as PrismaServiceType,
      scope as unknown as WorkshopScopeService,
    );
  });

  const range = { from: '2026-10-15', to: '2026-10-15' };

  it('AC27 công đoạn phụ: A báo Uốn 2 lần 60 + 60 trong 1 đợt, KCS thiếu 5 lỗi 3 -> A đạt 112, lỗi 3 (cộng các lần báo rồi mới trừ)', async () => {
    reviews({
      step: [
        stepReview(
          A,
          'UON',
          [[{ id: 1, mm: '441', qty: 60 }], [{ id: 1, mm: '441', qty: 60 }]],
          [{ id: 1, failedQty: 3, shortQty: 5 }],
        ),
      ],
    });
    const r = await service.getStats(range);
    expect(r.rows).toEqual([
      expect.objectContaining({
        op: 'UON',
        workerId: 'u-a',
        label: '441mm · Sắt phi 4',
        passed: 112,
        failed: 3,
      }),
    ]);
  });

  it('AC27 "Sản lượng của tôi": getMyStats(A) trả đúng dòng đạt 112 / lỗi 3 của A, hỏi DB với workerId = A ở nhánh cắt lẫn công đoạn phụ', async () => {
    reviews({
      cut: [cutReview(A, [{ id: 1, mm: '441', qty: 120 }], [{ id: 1, failedQty: 3, shortQty: 5 }])],
    });
    const r = await service.getMyStats('u-a', { ...range });
    expect(r.rows).toEqual([
      expect.objectContaining({ op: 'CAT', workerId: 'u-a', passed: 112, failed: 3 }),
    ]);
    const wheres = (prisma.qcReview.findMany.mock.calls as unknown[][]).map(
      (c) => (c[0] as { where: Record<string, unknown> }).where,
    );
    expect(wheres.find((w) => w.cutBundleId)).toMatchObject({ cutBundle: { openedById: 'u-a' } });
    expect(wheres.find((w) => w.stepBundleId)).toMatchObject({
      stepBundle: { reportedById: 'u-a' },
    });
  });

  it('AC27: A và B cùng ngày, cùng cỡ - mỗi người một dòng, số của người này không lẫn người kia (A: 112 / 3, B: 50 / 0)', async () => {
    reviews({
      cut: [
        cutReview(A, [{ id: 1, mm: '441', qty: 120 }], [{ id: 1, failedQty: 3, shortQty: 5 }]),
        cutReview(B, [{ id: 1, mm: '441', qty: 50 }], []),
      ],
    });
    const r = await service.getStats(range);
    const byWorker = Object.fromEntries(r.rows.map((x) => [x.workerId, [x.passed, x.failed]]));
    expect(byWorker).toEqual({ 'u-a': [112, 3], 'u-b': [50, 0] });
  });

  it('AC27: thiếu KHÔNG vào cột lỗi - Cắt thiếu 5 lỗi 0 -> đạt 115, lỗi 0 (không phải lỗi 5)', async () => {
    reviews({
      cut: [cutReview(A, [{ id: 1, mm: '441', qty: 120 }], [{ id: 1, failedQty: 0, shortQty: 5 }])],
    });
    const r = await service.getStats(range);
    expect(r.rows).toEqual([expect.objectContaining({ passed: 115, failed: 0 })]);
  });

  it.each([
    // [báo, lỗi, thiếu, đạt mong đợi]
    [120, 3, 5, 112],
    [120, 0, 0, 120],
    [120, 120, 0, 0],
    [120, 0, 120, 0],
    [120, 60, 60, 0],
    [1, 0, 1, 0],
    [0, 0, 0, 0],
  ])(
    'AC27 bất biến: báo %i, lỗi %i, thiếu %i -> đạt %i; đạt + lỗi + thiếu = báo ở cả Cắt lẫn công đoạn phụ, không số âm',
    async (reported, failedQty, shortQty, passed) => {
      reviews({
        cut: [
          cutReview(A, [{ id: 1, mm: '441', qty: reported }], [{ id: 1, failedQty, shortQty }]),
        ],
        step: [
          stepReview(
            A,
            'DAP',
            [[{ id: 1, mm: '441', qty: reported }]],
            [{ id: 1, failedQty, shortQty }],
          ),
        ],
      });
      const r = await service.getStats(range);
      expect(r.rows).toHaveLength(2);
      for (const row of r.rows) {
        expect(row.passed).toBe(passed);
        expect(row.failed).toBe(failedQty);
        expect(row.passed).toBeGreaterThanOrEqual(0);
        expect(row.passed + row.failed + shortQty).toBe(reported);
      }
    },
  );

  it('AC27: lỗi BỎ (scrapQty) vẫn là lỗi, không đổi đạt - Uốn lỗi 3 (bỏ 3) thiếu 0: đạt 117, lỗi 3; lỗi 3 (bỏ 1) cũng cùng số', async () => {
    reviews({
      step: [
        stepReview(
          A,
          'UON',
          [[{ id: 1, mm: '441', qty: 120 }]],
          [{ id: 1, failedQty: 3, shortQty: 0, scrapQty: 3 }],
        ),
        stepReview(
          B,
          'UON',
          [[{ id: 1, mm: '441', qty: 120 }]],
          [{ id: 1, failedQty: 3, shortQty: 0, scrapQty: 1 }],
        ),
      ],
    });
    const r = await service.getStats(range);
    expect(r.rows.map((x) => [x.workerId, x.passed, x.failed])).toEqual([
      ['u-a', 117, 3],
      ['u-b', 117, 3],
    ]);
  });

  it('AC27: 2 cỡ trong 1 đợt cắt, chỉ 1 cỡ bị thiếu / lỗi -> cỡ kia giữ nguyên số báo (đạt = báo)', async () => {
    reviews({
      cut: [
        cutReview(
          A,
          [
            { id: 1, mm: '441', qty: 120 },
            { id: 2, mm: '355', qty: 40 },
          ],
          [{ id: 1, failedQty: 3, shortQty: 5 }],
        ),
      ],
    });
    const r = await service.getStats(range);
    const byLabel = Object.fromEntries(r.rows.map((x) => [x.label, [x.passed, x.failed]]));
    expect(byLabel).toEqual({
      '441mm · Sắt phi 4': [112, 3],
      '355mm · Sắt phi 4': [40, 0],
    });
  });

  it('AC27: phiếu chấm có cỡ KHÔNG nằm trong đợt (dữ liệu lệch) -> bỏ qua, không ném lỗi, số cỡ có trong đợt không đổi', async () => {
    reviews({
      cut: [
        cutReview(
          A,
          [{ id: 1, mm: '441', qty: 120 }],
          [
            { id: 1, failedQty: 3, shortQty: 5 },
            { id: 9, failedQty: 7, shortQty: 7 },
          ],
        ),
      ],
    });
    const r = await service.getStats(range);
    expect(r.rows).toEqual([expect.objectContaining({ passed: 112, failed: 3 })]);
  });

  it('AC27: Hàn / Sơn - reportedQty đã là phần ĐẠT (KCS ghi đè = báo − lỗi − thiếu = 112), lỗi lấy từ phiếu (3); thiếu không vào cột lỗi', async () => {
    reviews({ batch: [batchReview('HAN', 112, 3), batchReview('SON', 112, 3)] });
    const r = await service.getStats({ ...range, stage: undefined });
    expect(r.rows.map((x) => [x.op, x.passed, x.failed])).toEqual([
      ['HAN', 112, 3],
      ['SON', 112, 3],
    ]);
  });

  it('AC27: chỉ tính phiếu KCS DUYỆT trong kỳ - truy vấn lọc theo reviewedAt (giờ VN) ở cả 3 nhánh, đợt chưa chấm không vào báo cáo "đạt"', async () => {
    reviews({});
    await service.getStats(range);
    const wheres = (prisma.qcReview.findMany.mock.calls as unknown[][]).map(
      (c) => (c[0] as { where: { reviewedAt: { gte: Date; lt: Date } } }).where,
    );
    expect(wheres).toHaveLength(3);
    for (const w of wheres) {
      expect(w.reviewedAt.gte).toEqual(new Date('2026-10-14T17:00:00.000Z')); // 00:00 15/10 VN
      expect(w.reviewedAt.lt).toEqual(new Date('2026-10-15T17:00:00.000Z')); // hết ngày 15/10 VN
    }
  });
});
