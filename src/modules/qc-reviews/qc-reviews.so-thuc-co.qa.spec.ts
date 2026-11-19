import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { stepsOverCutCap } from '../steel-issues/phoi-need.util';
import { MaterialYieldRecipeProductionService } from '../material-yield-recipes/material-yield-recipe-production.service';
import { ProductionBatchesService } from '../production-batches/production-batches.service';
import { SegmentProductionService } from '../segment-stock/segment-production.service';
import { SteelIssuesService } from '../steel-issues/steel-issues.service';
import { CloudinaryService } from '../uploads/cloudinary.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaintTransferReminderService } from '../warehouse-transfers/paint-transfer-reminder.service';
import { queueWorkshopIdOfPi } from '../floor/floor-queue-workshop.util';
import { RealtimeService } from '../../realtime/realtime.service';
import { CreateQcReviewDto } from './dto/create-qc-review.dto';
import { CreateSteelIssueQcReviewDto } from './dto/create-steel-issue-qc-review.dto';
import { QcReviewsService } from './qc-reviews.service';

jest.mock('../floor/floor-queue-workshop.util', () => ({ queueWorkshopIdOfPi: jest.fn() }));

/**
 * UB7 (QA, P1 "KCS tự chuyển") - KCS ghi "Thực có" (số thiếu) khi chấm: AC27, AC29, AC30, AC32, AC34 / MF8, AC35, AC37,
 * AC40, AC43, D6 / R1, biên Q4. Bổ sung cho qc-reviews.service.spec.ts của Dev (không chép lại ca đã có): ở đây mock có
 * TRẠNG THÁI (đợt chỉ chấm được 1 lần, reportedQty đổi theo từng bước) để kiểm hành vi, không chỉ lời gọi.
 */

const decimal = (n: number) => ({ toNumber: () => n, toString: () => String(n) });
const MM_OF: Record<string, number> = { '30': 441, '31': 355, '32': 500 };
const SPECS = [
  { id: 30n, materialId: 30n, cutLengthMm: decimal(441) },
  { id: 31n, materialId: 30n, cutLengthMm: decimal(355) },
  { id: 32n, materialId: 30n, cutLengthMm: decimal(500) },
];

const DUP = 'Đợt này vừa được KCS khác chấm xong - tải lại trang.';
const SHORT_SENTENCE = 'đã trừ, không tính lỗi, không cần làm bù';

interface CreateArgs {
  data: {
    failedQty: number;
    shortQty?: number;
    segments?: { create: { segmentSpecId: bigint; failedQty: number }[] };
  };
}
type Emit = [string, { params: Record<string, unknown> }];

function build() {
  const calls: string[] = [];
  const state = {
    reviews: [] as CreateArgs['data'][],
    claimed: false, // đợt đã bị 1 KCS chấm (updateMany có điều kiện trạng thái chỉ khớp 1 lần)
    batchReported: 60,
    cutDone: { '30': 120, '31': 200, '32': 50 } as Record<string, number>,
  };
  const claim = (extra?: (d: Record<string, number>) => void) =>
    jest.fn((a: { data?: Record<string, number> }) => {
      if (state.claimed) return Promise.resolve({ count: 0 });
      state.claimed = true;
      if (a.data && extra) extra(a.data);
      return Promise.resolve({ count: 1 });
    });
  const doneRows = () =>
    Object.entries(state.cutDone).map(([id, qty]) => ({
      segmentSpecId: BigInt(id),
      _sum: { qty },
    }));

  const ref: { tx?: unknown } = {};
  const prisma = {
    qcReview: {
      create: jest.fn((a: CreateArgs) => {
        calls.push('create');
        state.reviews.push(a.data);
        return Promise.resolve({
          id: BigInt(500 + state.reviews.length),
          steelIssueId: null,
          productionBatchId: null,
          failedQty: a.data.failedQty,
          shortQty: a.data.shortQty ?? 0,
          defectReasonId: null,
          defectReason: null,
          reason: null,
          photoUrl: null,
          reviewedAt: new Date(),
          reviewedById: 'kcs-1',
          segments: (a.data.segments?.create ?? []).map((s) => ({
            ...s,
            shortQty: (s as { shortQty?: number }).shortQty ?? 0,
            scrapQty: (s as { scrapQty?: number }).scrapQty ?? 0,
            segmentSpec: { cutLengthMm: decimal(MM_OF[s.segmentSpecId.toString()]) },
          })),
        });
      }),
    },
    segmentSpec: { findMany: jest.fn().mockResolvedValue(SPECS) },
    cutPatternSegment: { groupBy: jest.fn(() => Promise.resolve(doneRows())) },
    stepBatchSegment: { groupBy: jest.fn(() => Promise.resolve(doneRows())) },
    steelIssue: { updateMany: claim(), findUnique: jest.fn() },
    cutBundle: {
      findUnique: jest.fn(),
      updateMany: claim(),
      count: jest.fn().mockResolvedValue(0),
    },
    stepBundle: { findUnique: jest.fn(), updateMany: claim() },
    productionBatch: {
      updateMany: jest.fn((a: { data: { reportedQty: number } }) => {
        if (state.claimed) return Promise.resolve({ count: 0 });
        state.claimed = true;
        state.batchReported = a.data.reportedQty;
        calls.push(`claim:${a.data.reportedQty}`);
        return Promise.resolve({ count: 1 });
      }),
      update: jest.fn((a: { data: { reportedQty: number } }) => {
        state.batchReported = a.data.reportedQty;
        calls.push(`update:${a.data.reportedQty}`);
        return Promise.resolve({});
      }),
    },
    pieceStepBundle: { updateMany: claim() },
    materialYieldStepBundle: { updateMany: claim() },
    productionOrder: {
      findFirst: jest.fn().mockResolvedValue({ id: 9n }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ productionInvoiceItemId: 20n }),
      findUnique: jest
        .fn()
        .mockResolvedValue({ productionInvoiceItem: { productionInvoiceId: 30n } }),
    },
    productionInvoiceItem: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ productionInvoiceId: 900n }),
    },
    productionInvoice: { findUnique: jest.fn().mockResolvedValue({ code: 'PI-900' }) },
    $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(ref.tx)),
  };

  const rows = {
    cut: {
      id: 1n,
      status: 'AWAITING_QC',
      steelIssueId: 100n,
      productionOrderId: 7n,
      steelIssue: {
        productionInvoiceId: 900n,
        materialId: 30n,
        material: { name: 'Sắt vuông', spec: '15' },
      },
    },
    step: {
      id: 2n,
      status: 'AWAITING_QC',
      productionInvoiceId: 900n,
      materialId: 30n,
      step: 'UON',
      material: { name: 'Sắt vuông', spec: null },
    },
    batch: {
      id: 700n,
      stage: 'HAN',
      productionOrderId: 1n,
      pieceId: 40n,
      reportedQty: 60,
      status: 'AWAITING_QC',
      productionOrder: { productionInvoiceItem: { productionInvoice: { code: 'PI-700' } } },
    },
    piece: {
      id: 800n,
      productionOrderId: 1n,
      pieceId: 40n,
      step: 'DAP',
      qty: 50,
      status: 'AWAITING_QC',
      productionOrder: {
        bomRevisionId: 5n,
        productionInvoiceItem: { productionInvoice: { code: 'PI-800' } },
      },
    },
    my: {
      id: 900n,
      productionInvoiceId: 900n,
      step: 'UON',
      qty: 50,
      status: 'AWAITING_QC',
    },
    issue: {
      id: 100n,
      materialId: 30n,
      status: 'AWAITING_QC',
      productionInvoiceId: 900n,
    },
  };
  ref.tx = prisma;
  prisma.cutBundle.findUnique.mockImplementation(() => Promise.resolve(rows.cut));
  prisma.stepBundle.findUnique.mockImplementation(() => Promise.resolve(rows.step));

  const steel = {
    findOneRowOrThrow: jest.fn().mockResolvedValue(rows.issue),
    syncIssueStatusFromBundles: jest.fn().mockResolvedValue(undefined),
    stepOveruseAfterCutShortage: jest.fn().mockResolvedValue([]),
  };
  const pb = {
    findOneRowOrThrow: jest.fn(() => Promise.resolve({ ...rows.batch })),
    findOnePieceStepBundleRowOrThrow: jest.fn().mockResolvedValue(rows.piece),
    autoFinalizePieceOutputIfLastStepComplete: jest.fn(() => {
      calls.push('autoFinalize');
      return Promise.resolve();
    }),
    postPieceOutputIfFinal: jest.fn((_tx: unknown, i: { qty: number }) => {
      calls.push(`post:${i.qty}`);
      return Promise.resolve();
    }),
    lockBatchKeysInTx: jest.fn(() => {
      calls.push('lock');
      return Promise.resolve();
    }),
    consumeSegmentsAtReviewInTx: jest.fn((...a: [unknown, bigint, number, string]) => {
      calls.push(`consume:${a[2]}:seen${state.batchReported}`);
      return Promise.resolve();
    }),
    afterReviewCommitted: jest.fn(() => {
      calls.push('afterReview');
      return Promise.resolve();
    }),
  };
  const my = {
    findOneBundleRowOrThrow: jest.fn().mockResolvedValue(rows.my),
    finalizeRecipeOutputIfLastStepComplete: jest.fn().mockResolvedValue(undefined),
  };
  const notif = {
    emit: jest.fn(() => {
      calls.push('emit');
      return Promise.resolve();
    }),
    resolve: jest.fn(() => {
      calls.push('resolve');
      return Promise.resolve();
    }),
  };
  const realtime = {
    publishEntityChanged: jest.fn(() => {
      calls.push('realtime');
    }),
    publishNotificationCreated: jest.fn(),
  };
  const recompute = { recomputeAfterQc: jest.fn().mockResolvedValue(undefined) };
  const paint = {
    refreshForOrder: jest.fn(() => {
      calls.push('refresh');
      return Promise.resolve();
    }),
  };
  (queueWorkshopIdOfPi as jest.Mock).mockReset().mockResolvedValue(null);

  const service = new QcReviewsService(
    prisma as unknown as PrismaServiceType,
    steel as unknown as SteelIssuesService,
    pb as unknown as ProductionBatchesService,
    my as unknown as MaterialYieldRecipeProductionService,
    { deleteByUrl: jest.fn() } as unknown as CloudinaryService,
    notif as unknown as NotificationsService,
    realtime as unknown as RealtimeService,
    recompute as unknown as SegmentProductionService,
    paint as unknown as PaintTransferReminderService,
  );
  return { service, prisma, state, calls, rows, steel, pb, my, notif, realtime, recompute, paint };
}

type Ctx = ReturnType<typeof build>;

async function errOf(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error('Lẽ ra phải ném lỗi');
}

const emitted = (c: Ctx, type: string): Record<string, unknown> | undefined =>
  (c.notif.emit.mock.calls as unknown as Emit[]).find((x) => x[0] === type)?.[1].params;

const seg = (id: string, failedQty: number, shortQty?: number, scrapQty?: number) => ({
  segmentSpecId: id,
  failedQty,
  ...(shortQty === undefined ? {} : { shortQty }),
  ...(scrapQty === undefined ? {} : { scrapQty }),
});

describe('UB7 qc-reviews: KCS ghi Thực có / thiếu (QA)', () => {
  let errLog: jest.SpyInstance;
  beforeEach(() => {
    errLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => errLog.mockRestore());

  describe('AC27: chấm Cắt - Thực có 115 / Đã báo 120, lỗi 3', () => {
    it('AC27: lưu failedQty 3 + shortQty 5 + scrapQty 0 ở cả dòng cỡ và tổng; response trả đúng', async () => {
      const c = build();
      const res = await c.service.reviewCutBundle('1', { segments: [seg('30', 3, 5)] }, 'kcs-1');
      expect(c.state.reviews).toHaveLength(1);
      expect(c.state.reviews[0]).toMatchObject({ failedQty: 3, shortQty: 5 });
      expect(c.state.reviews[0].segments?.create).toEqual([
        { segmentSpecId: 30n, failedQty: 3, shortQty: 5, scrapQty: 0 },
      ]);
      expect(res.failedQty).toBe(3);
      expect(res.shortQty).toBe(5);
      expect(res.segments[0]).toMatchObject({
        cutLengthMm: 441,
        failedQty: 3,
        shortQty: 5,
        scrapQty: 0,
      });
    });

    it('AC27: tin QC_FAILED nêu "3 đoạn 441mm lỗi" và câu thiếu 5 đoạn; failedQty của tin = 3 (thiếu KHÔNG cộng vào lỗi, không phải 8)', async () => {
      const c = build();
      await c.service.reviewCutBundle('1', { segments: [seg('30', 3, 5)] }, 'kcs-1');
      const p = emitted(c, 'QC_FAILED')!;
      expect(p.failedQty).toBe(3);
      expect(p.piCode).toBe('PI-900');
      expect(String(p.detail)).toContain('3 đoạn 441mm lỗi');
      expect(String(p.detail)).toContain('KCS ghi thiếu 5 đoạn');
      expect(String(p.detail)).toContain(SHORT_SENTENCE);
      expect(JSON.stringify(p)).not.toMatch(/\b8 đoạn/);
      expect(emitted(c, 'QC_PASSED')).toBeUndefined();
    });

    it('AC27 biên: thiếu = đúng 120 đoạn của đợt qua; 121 bị 400; không ghi gì', async () => {
      const ok = build();
      await expect(
        ok.service.reviewCutBundle('1', { segments: [seg('30', 0, 120)] }, 'kcs-1'),
      ).resolves.toBeDefined();
      const bad = build();
      const err = await errOf(
        bad.service.reviewCutBundle('1', { segments: [seg('30', 0, 121)] }, 'kcs-1'),
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect(bad.prisma.qcReview.create).not.toHaveBeenCalled();
      expect(bad.notif.emit).not.toHaveBeenCalled();
    });

    it('AC27 biên: lỗi + thiếu cộng đúng bằng số đoạn (115 + 5 = 120) qua; 116 + 5 bị chặn', async () => {
      const ok = build();
      await expect(
        ok.service.reviewCutBundle('1', { segments: [seg('30', 115, 5)] }, 'kcs-1'),
      ).resolves.toBeDefined();
      const bad = build();
      await expect(
        bad.service.reviewCutBundle('1', { segments: [seg('30', 116, 5)] }, 'kcs-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('AC27 / tin Cắt: việc cho lỗi Cắt luôn là cắt lại, không có ý "Làm lại" của công đoạn phụ', async () => {
      const c = build();
      await c.service.reviewCutBundle('1', { segments: [seg('30', 3, 5)] }, 'kcs-1');
      const todo = String(emitted(c, 'QC_FAILED')!.todo);
      expect(todo).toContain('cắt lại 3 đoạn 441mm');
      expect(todo).not.toContain('Làm lại');
    });
  });

  describe('AC29: lỗi + thiếu vượt số đã báo - 2 câu 400 nguyên văn của AC', () => {
    it('AC29: đợt công đoạn có cỡ 441mm báo 120, thiếu 5 + lỗi 118 -> 400 "Cỡ 441mm: thiếu 5 + lỗi 118 vượt số đã báo trong đợt (120)"', async () => {
      const c = build();
      const err = await errOf(
        c.service.reviewStepBundle('2', { segments: [seg('30', 118, 5, 0)] }, 'kcs-1'),
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toContain('Cỡ 441mm: thiếu 5 + lỗi 118 vượt số đã báo trong đợt (120)');
      expect(c.prisma.qcReview.create).not.toHaveBeenCalled();
    });

    it('AC29: lô Hàn báo 60, thiếu 10 + không đạt 55 -> 400 "Thiếu (10) + không đạt (55) vượt số đã báo (60)"', async () => {
      const c = build();
      const err = await errOf(
        c.service.reviewProductionBatch('700', { failedQty: 55, shortQty: 10 }, 'kcs-1'),
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toContain('Thiếu (10) + không đạt (55) vượt số đã báo (60)');
      expect(c.prisma.$transaction).not.toHaveBeenCalled();
      expect(c.prisma.qcReview.create).not.toHaveBeenCalled();
    });

    it('AC29 biên: lô Hàn báo 60, thiếu 10 + không đạt 50 = đúng 60 qua (không câu lỗi)', async () => {
      const c = build();
      await expect(
        c.service.reviewProductionBatch('700', { failedQty: 50, shortQty: 10 }, 'kcs-1'),
      ).resolves.toBeDefined();
    });

    it('AC29 biên: đợt công đoạn thiếu 5 + lỗi 115 (scrap 0) = đúng 120 qua', async () => {
      const c = build();
      await expect(
        c.service.reviewStepBundle('2', { segments: [seg('30', 115, 5, 0)] }, 'kcs-1'),
      ).resolves.toBeDefined();
    });
  });

  describe('AC30 / Câu 1 B: tin QC_FAILED công đoạn phụ tách "Bỏ" và "Làm lại"', () => {
    it('AC30: Uốn 355mm lỗi 8 (bỏ 5, làm lại 3): lưu failed 8 / scrap 5; tin failedQty 8, hai ý tách riêng', async () => {
      const c = build();
      await c.service.reviewStepBundle('2', { segments: [seg('31', 8, 0, 5)] }, 'kcs-1');
      expect(c.state.reviews[0].segments?.create).toEqual([
        { segmentSpecId: 31n, failedQty: 8, shortQty: 0, scrapQty: 5 },
      ]);
      const p = emitted(c, 'QC_FAILED')!;
      expect(p.failedQty).toBe(8);
      const todo = String(p.todo);
      expect(todo).toMatch(/Bỏ 5 đoạn 355mm: cắt lại/);
      expect(todo).toMatch(/Làm lại 3 đoạn 355mm: Uốn lại chính các đoạn đó/);
      expect(String(p.detail)).toContain('8 đoạn 355mm lỗi');
    });

    it('Câu 1 B: scrapQty 0 + lỗi > 0 (kiểu phiếu cũ) được hiểu là làm lại - qua, lưu scrap 0, tin chỉ có ý "Làm lại"', async () => {
      const c = build();
      await c.service.reviewStepBundle('2', { segments: [seg('31', 5, 0, 0)] }, 'kcs-1');
      expect(c.state.reviews[0].segments?.create?.[0]).toMatchObject({ scrapQty: 0 });
      const todo = String(emitted(c, 'QC_FAILED')!.todo);
      expect(todo).toContain('Làm lại 5 đoạn 355mm');
      expect(todo).not.toContain('Bỏ');
    });

    it('AC30 biên: bỏ = lỗi (5 / 5) -> tin chỉ có ý "Bỏ", không có "Làm lại"', async () => {
      const c = build();
      await c.service.reviewStepBundle('2', { segments: [seg('31', 5, 0, 5)] }, 'kcs-1');
      const todo = String(emitted(c, 'QC_FAILED')!.todo);
      expect(todo).toContain('Bỏ 5 đoạn 355mm');
      expect(todo).not.toContain('Làm lại');
    });

    it('AC30: 2 cỡ - 355 (lỗi 8, bỏ 5) và 441 (lỗi 2, bỏ 0): "Bỏ" chỉ nêu 355; "Làm lại" gộp 3 đoạn 355 và 2 đoạn 441', async () => {
      const c = build();
      await c.service.reviewStepBundle(
        '2',
        { segments: [seg('31', 8, 0, 5), seg('30', 2, 0, 0)] },
        'kcs-1',
      );
      const p = emitted(c, 'QC_FAILED')!;
      expect(p.failedQty).toBe(10);
      const todo = String(p.todo);
      expect(todo).toContain('Bỏ 5 đoạn 355mm');
      expect(todo).not.toContain('441mm: cắt lại');
      expect(todo).toContain('Làm lại 3 đoạn 355mm, 2 đoạn 441mm');
    });
  });

  describe('AC32: luật "bỏ" của công đoạn phụ', () => {
    it('AC32: lỗi > 0 mà không gửi scrapQty -> 400 "Cỡ 441mm: chọn số đoạn lỗi phải bỏ (cắt lại)..." kèm "tải lại trang"; không ghi gì', async () => {
      const c = build();
      const err = await errOf(
        c.service.reviewStepBundle('2', { segments: [seg('30', 5, 0)] }, 'kcs-1'),
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toContain('Cỡ 441mm: chọn số đoạn lỗi phải bỏ (cắt lại)');
      expect(err.message).toContain('tải lại trang');
      expect(c.prisma.$transaction).not.toHaveBeenCalled();
      expect(c.prisma.qcReview.create).not.toHaveBeenCalled();
      expect(c.notif.emit).not.toHaveBeenCalled();
    });

    it('AC32: scrapQty 6 > lỗi 5 -> 400 "số bỏ (6) lớn hơn số lỗi (5)"', async () => {
      const c = build();
      const err = await errOf(
        c.service.reviewStepBundle('2', { segments: [seg('30', 5, 0, 6)] }, 'kcs-1'),
      );
      expect(err.message).toContain('số bỏ (6) lớn hơn số lỗi (5)');
      expect(c.prisma.qcReview.create).not.toHaveBeenCalled();
    });

    it('AC32 biên: chỉ thiếu (lỗi 0) mà có scrapQty 2 -> 400 (bỏ không thể lớn hơn lỗi 0)', async () => {
      const c = build();
      await expect(
        c.service.reviewStepBundle('2', { segments: [seg('30', 0, 3, 2)] }, 'kcs-1'),
      ).rejects.toThrow(/lớn hơn số lỗi \(0\)/);
    });

    it('AC32: chấm Cắt kèm scrapQty (kể cả lớn hơn lỗi) -> bỏ qua, lưu 0, không 400', async () => {
      const c = build();
      await c.service.reviewCutBundle('1', { segments: [seg('30', 2, 0, 9)] }, 'kcs-1');
      expect(c.state.reviews[0].segments?.create?.[0]).toMatchObject({
        failedQty: 2,
        scrapQty: 0,
      });
    });
  });

  describe('AC34 / MF8: notes[] lấy từ hàm export, không tính lại trong qc-reviews', () => {
    it('MF8: notes = đúng kết quả stepOveruseAfterCutShortage (số lạ cũng giữ nguyên, nhãn công đoạn theo step); gọi với PI, loại sắt, lệnh của đợt, CHỈ cỡ có thiếu', async () => {
      const c = build();
      c.steel.stepOveruseAfterCutShortage.mockResolvedValue([
        { step: 'UON', cutLengthMm: 355, overBy: 9, cutCap: 77 },
        { step: 'DAP', cutLengthMm: 355, overBy: 1, cutCap: 77 },
      ]);
      const res = await c.service.reviewCutBundle(
        '1',
        { segments: [seg('31', 1, 4), seg('30', 2, 0), seg('32', 0, 6)] },
        'kcs-1',
      );
      expect(c.steel.stepOveruseAfterCutShortage).toHaveBeenCalledTimes(1);
      expect(c.steel.stepOveruseAfterCutShortage).toHaveBeenCalledWith(900n, 30n, 7n, [31n, 32n]);
      expect(res.notes).toEqual([
        'Uốn cỡ 355mm đã báo nhiều hơn số đoạn cắt thực có (77) 9 đoạn - Uốn sẽ bị chặn tới khi cắt thêm hoặc KCS Uốn ghi thiếu',
        'Dập cỡ 355mm đã báo nhiều hơn số đoạn cắt thực có (77) 1 đoạn - Dập sẽ bị chặn tới khi cắt thêm hoặc KCS Dập ghi thiếu',
      ]);
    });

    it('AC34: dùng ĐÚNG hàm stepsOverCutCap của phoi-need: Cắt 1180 thô, thiếu 5 (Thực có 1175), Uốn đã báo 1180 -> 1 câu với số đoạn cắt thực có từ hàm; có trong response VÀ trong tin QLSX (QC_PASSED note); không vào qc_review', async () => {
      const c = build();
      c.steel.stepOveruseAfterCutShortage.mockImplementation(() =>
        Promise.resolve(
          stepsOverCutCap({
            baseByStep: { CAT: 1180, UON: 1180 },
            lineSteps: [['CAT', 'UON']],
            counts: {
              CAT: { raw: 1180, failed: 0, short: 5, scrap: 0 },
              UON: { raw: 1180, failed: 0, short: 0, scrap: 0 },
            },
          }).map((o) => ({ ...o, cutLengthMm: 355 })),
        ),
      );
      const res = await c.service.reviewCutBundle('1', { segments: [seg('31', 0, 5)] }, 'kcs-1');
      const note =
        'Uốn cỡ 355mm đã báo nhiều hơn số đoạn cắt thực có (1175) 5 đoạn - Uốn sẽ bị chặn tới khi cắt thêm hoặc KCS Uốn ghi thiếu';
      expect(res.notes).toEqual([note]);
      const passed = emitted(c, 'QC_PASSED')!;
      expect(String(passed.note)).toContain(note);
      expect(String(passed.note)).toContain('KCS ghi thiếu 5 đoạn');
      expect(
        JSON.stringify(c.state.reviews, (_k, v: unknown) =>
          typeof v === 'bigint' ? v.toString() : v,
        ),
      ).not.toContain('Uốn cỡ');
    });

    it('MF8: hàm trả [] -> notes = [] và tin không thêm chữ nào ngoài câu thiếu', async () => {
      const c = build();
      const res = await c.service.reviewCutBundle('1', { segments: [seg('31', 0, 5)] }, 'kcs-1');
      expect(res.notes).toEqual([]);
      expect(emitted(c, 'QC_PASSED')!.note).toBe(
        `KCS ghi thiếu 5 đoạn so với số báo (${SHORT_SENTENCE}).`,
      );
    });

    it('MF8: đợt cắt cũ chưa gắn lệnh (productionOrderId null) -> truyền null cho hàm', async () => {
      const c = build();
      c.rows.cut.productionOrderId = null as unknown as bigint;
      await c.service.reviewCutBundle('1', { segments: [seg('31', 0, 5)] }, 'kcs-1');
      expect(c.steel.stepOveruseAfterCutShortage).toHaveBeenCalledWith(900n, 30n, null, [31n]);
    });

    it('MF8: notes chỉ trả khi chấm Cắt - chấm công đoạn phụ, lô, pat, chân nhôm trả notes = [] và không gọi hàm', async () => {
      const c = build();
      const a = await c.service.reviewStepBundle('2', { segments: [seg('31', 0, 5)] }, 'kcs-1');
      expect(a.notes).toEqual([]);
      const b = build();
      const r2 = await b.service.reviewProductionBatch('700', { failedQty: 0, shortQty: 5 }, 'k');
      expect(r2.notes).toEqual([]);
      expect(c.steel.stepOveruseAfterCutShortage).not.toHaveBeenCalled();
      expect(b.steel.stepOveruseAfterCutShortage).not.toHaveBeenCalled();
    });
  });

  describe('AC35 / AC40: chấm lô mảnh theo Thực có - thứ tự và số ghi ở từng bước', () => {
    const POST_COMMIT = ['resolve', 'afterReview', 'emit', 'refresh', 'realtime'];

    it('AC35: báo 60, Thực có 56 (thiếu 4), không đạt 1 -> khoá, ghi báo-thiếu 56, trừ đoạn 56 (lúc đó lô đang ghi 56), hạ về 55, mảnh vào kho 55, rồi tạo review; sau commit theo thứ tự', async () => {
      const c = build();
      await c.service.reviewProductionBatch('700', { failedQty: 1, shortQty: 4 }, 'kcs-1');
      expect(c.calls).toEqual([
        'lock',
        'claim:56',
        'consume:56:seen56',
        'update:55',
        'post:55',
        'create',
        ...POST_COMMIT,
      ]);
      expect(c.state.batchReported).toBe(55);
      expect(c.state.reviews[0]).toMatchObject({ failedQty: 1, shortQty: 4 });
      expect(c.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        timeout: 20_000,
      });
    });

    it('AC35 biên: Thực có = Đã báo (thiếu 0), không lỗi -> trừ đoạn 60, KHÔNG ghi lần 2, mảnh vào kho 60', async () => {
      const c = build();
      await c.service.reviewProductionBatch('700', { failedQty: 0 }, 'kcs-1');
      expect(c.calls.slice(0, 5)).toEqual([
        'lock',
        'claim:60',
        'consume:60:seen60',
        'post:60',
        'create',
      ]);
      expect(c.prisma.productionBatch.update).not.toHaveBeenCalled();
      expect(c.state.batchReported).toBe(60);
    });

    it('AC35 biên: chỉ thiếu 4 (không lỗi) -> lô chốt 56, trừ đoạn 56, không update lần 2', async () => {
      const c = build();
      await c.service.reviewProductionBatch('700', { failedQty: 0, shortQty: 4 }, 'kcs-1');
      expect(c.calls.slice(0, 5)).toEqual([
        'lock',
        'claim:56',
        'consume:56:seen56',
        'post:56',
        'create',
      ]);
    });

    it('AC35 biên: thiếu hết 60 (Thực có 0) -> trừ đoạn 0, lô chốt 0, vẫn tạo review thiếu 60', async () => {
      const c = build();
      await c.service.reviewProductionBatch('700', { failedQty: 0, shortQty: 60 }, 'kcs-1');
      expect(c.calls.slice(0, 3)).toEqual(['lock', 'claim:0', 'consume:0:seen0']);
      expect(c.state.batchReported).toBe(0);
      expect(c.state.reviews[0]).toMatchObject({ failedQty: 0, shortQty: 60 });
    });

    it('AC35 biên: không đạt hết 60 (thiếu 0) -> trừ đoạn 60 (đoạn đã dùng), mảnh đạt hạ về 0', async () => {
      const c = build();
      await c.service.reviewProductionBatch('700', { failedQty: 60 }, 'kcs-1');
      expect(c.calls.slice(0, 5)).toEqual([
        'lock',
        'claim:60',
        'consume:60:seen60',
        'update:0',
        'post:0',
      ]);
    });

    it('AC35 biên: không đạt 61 trên báo 60 (thiếu 0) -> 400 câu cũ, chưa mở transaction', async () => {
      const c = build();
      const err = await errOf(c.service.reviewProductionBatch('700', { failedQty: 61 }, 'kcs-1'));
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe('Số không đạt (61) không được vượt số lượng đã báo (60)');
      expect(c.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('AC35: trừ đoạn ném lỗi (vd hết đoạn / lỗi kho) -> lỗi nổi lên, KHÔNG tạo review, KHÔNG tin, KHÔNG nhắc kho, KHÔNG realtime, KHÔNG afterReviewCommitted', async () => {
      const c = build();
      c.pb.consumeSegmentsAtReviewInTx.mockRejectedValue(new Error('kho lỗi'));
      await expect(
        c.service.reviewProductionBatch('700', { failedQty: 1, shortQty: 4 }, 'kcs-1'),
      ).rejects.toThrow('kho lỗi');
      expect(c.prisma.qcReview.create).not.toHaveBeenCalled();
      expect(c.pb.postPieceOutputIfFinal).not.toHaveBeenCalled();
      for (const m of [
        c.notif.emit,
        c.notif.resolve,
        c.paint.refreshForOrder,
        c.realtime.publishEntityChanged,
        c.pb.afterReviewCommitted,
      ]) {
        expect(m).not.toHaveBeenCalled();
      }
    });

    it('AC35: mảnh vào kho (postPieceOutputIfFinal) ném lỗi -> không tạo review, không tin sau commit', async () => {
      const c = build();
      c.pb.postPieceOutputIfFinal.mockRejectedValue(new Error('ghi kho mảnh lỗi'));
      await expect(
        c.service.reviewProductionBatch('700', { failedQty: 0 }, 'kcs-1'),
      ).rejects.toThrow('ghi kho mảnh lỗi');
      expect(c.prisma.qcReview.create).not.toHaveBeenCalled();
      expect(c.notif.emit).not.toHaveBeenCalled();
      expect(c.realtime.publishEntityChanged).not.toHaveBeenCalled();
    });

    it('AC40: mọi lần chấm lô (có / không thiếu, Hàn / Sơn) đều chạy trong transaction có timeout 20 giây, không dùng timeout mặc định', async () => {
      for (const [stage, o] of [
        ['HAN', { failedQty: 0, shortQty: 6 }],
        ['SON', { failedQty: 2 }],
      ] as const) {
        const c = build();
        c.rows.batch.stage = stage;
        await c.service.reviewProductionBatch('700', o, 'kcs-1');
        const opts = (c.prisma.$transaction.mock.calls as unknown[][])[0][1];
        expect(opts).toEqual({ timeout: 20_000 });
      }
    });
  });

  describe('AC37: pat / chân nhôm', () => {
    it('AC37: pat thiếu 3 + lỗi 1: review tạo TRƯỚC rồi mới autoFinalize (cùng transaction); autoFinalize ném lỗi thì không tin / realtime', async () => {
      const c = build();
      await c.service.reviewPieceStep('800', { failedQty: 1, shortQty: 3 }, 'kcs-1');
      expect(c.calls.slice(0, 2)).toEqual(['create', 'autoFinalize']);
      expect(c.state.reviews[0]).toMatchObject({ failedQty: 1, shortQty: 3 });

      const bad = build();
      bad.pb.autoFinalizePieceOutputIfLastStepComplete.mockRejectedValue(new Error('lỗi sinh lô'));
      await expect(
        bad.service.reviewPieceStep('800', { failedQty: 1, shortQty: 3 }, 'kcs-1'),
      ).rejects.toThrow('lỗi sinh lô');
      expect(bad.notif.emit).not.toHaveBeenCalled();
      expect(bad.realtime.publishEntityChanged).not.toHaveBeenCalled();
    });

    it('AC37: chân nhôm thiếu 3 + lỗi 1 -> finalize nhận 4 (lỗi + thiếu), không phải 1 hay 3; tin báo thiếu theo đơn vị "cái"', async () => {
      const c = build();
      await c.service.reviewMaterialYieldStep('900', { failedQty: 1, shortQty: 3 }, 'kcs-1');
      expect(c.my.finalizeRecipeOutputIfLastStepComplete).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        4,
        'kcs-1',
      );
      expect(String(emitted(c, 'QC_FAILED')!.detail)).toContain('KCS ghi thiếu 3 cái');
    });

    it('AC37 biên: pat lỗi + thiếu vượt 50 đã gửi -> 400, không ghi', async () => {
      const c = build();
      await expect(
        c.service.reviewPieceStep('800', { failedQty: 48, shortQty: 3 }, 'kcs-1'),
      ).rejects.toThrow(BadRequestException);
      expect(c.prisma.qcReview.create).not.toHaveBeenCalled();
    });
  });

  describe('AC43: chấm trùng - 1 người 201, người kia 409 lời thường, chỉ 1 qc_review', () => {
    const kinds: [string, (c: Ctx, who: string) => Promise<unknown>][] = [
      ['đợt cắt', (c, w) => c.service.reviewCutBundle('1', { segments: [] }, w)],
      ['đợt công đoạn phụ', (c, w) => c.service.reviewStepBundle('2', { segments: [] }, w)],
      ['lô mảnh', (c, w) => c.service.reviewProductionBatch('700', { failedQty: 0 }, w)],
      ['nhóm pat', (c, w) => c.service.reviewPieceStep('800', { failedQty: 0 }, w)],
      ['nhóm chân nhôm', (c, w) => c.service.reviewMaterialYieldStep('900', { failedQty: 0 }, w)],
    ];

    it.each(kinds)(
      'AC43: %s - 2 KCS cùng lưu: đúng 1 thành công, 1 nhận 409 câu chuẩn, 1 qc_review, 1 tin, 1 realtime',
      async (_n, run) => {
        const c = build();
        const res = await Promise.allSettled([run(c, 'kcs-1'), run(c, 'kcs-2')]);
        expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const lost = res.find((r) => r.status === 'rejected') as PromiseRejectedResult;
        expect(lost.reason).toBeInstanceOf(ConflictException);
        expect((lost.reason as Error).message).toBe(DUP);
        expect(c.state.reviews).toHaveLength(1);
        expect(c.notif.emit).toHaveBeenCalledTimes(1);
        expect(c.realtime.publishEntityChanged).toHaveBeenCalledTimes(1);
      },
    );

    it.each(kinds)(
      'AC43: %s - người thua (đợt đã bị chấm) KHÔNG ghi review, KHÔNG tin, KHÔNG realtime, KHÔNG tính lại tồn đoạn',
      async (_n, run) => {
        const c = build();
        c.state.claimed = true; // KCS kia đã commit trước
        await expect(run(c, 'kcs-2')).rejects.toThrow(DUP);
        expect(c.prisma.qcReview.create).not.toHaveBeenCalled();
        expect(c.notif.emit).not.toHaveBeenCalled();
        expect(c.realtime.publishEntityChanged).not.toHaveBeenCalled();
        expect(c.recompute.recomputeAfterQc).not.toHaveBeenCalled();
      },
    );

    it('AC43: lô mảnh - người thua không trừ đoạn lần 2 (consume chỉ chạy ở người thắng)', async () => {
      const c = build();
      await Promise.allSettled([
        c.service.reviewProductionBatch('700', { failedQty: 0, shortQty: 4 }, 'kcs-1'),
        c.service.reviewProductionBatch('700', { failedQty: 0, shortQty: 4 }, 'kcs-2'),
      ]);
      expect(c.pb.consumeSegmentsAtReviewInTx).toHaveBeenCalledTimes(1);
      expect(c.pb.postPieceOutputIfFinal).toHaveBeenCalledTimes(1);
    });

    it('AC43: đợt đã ở trạng thái chấm xong khi đọc (QC_PASSED / QC_DONE) -> cùng câu 409 lời thường', async () => {
      const cut = build();
      cut.rows.cut.status = 'QC_PASSED';
      await expect(cut.service.reviewCutBundle('1', { segments: [] }, 'k')).rejects.toThrow(DUP);
      const step = build();
      step.rows.step.status = 'QC_PASSED';
      await expect(step.service.reviewStepBundle('2', { segments: [] }, 'k')).rejects.toThrow(DUP);
      const batch = build();
      batch.rows.batch.status = 'QC_DONE';
      await expect(
        batch.service.reviewProductionBatch('700', { failedQty: 0 }, 'k'),
      ).rejects.toThrow(DUP);
      const piece = build();
      piece.rows.piece.status = 'QC_PASSED';
      await expect(piece.service.reviewPieceStep('800', { failedQty: 0 }, 'k')).rejects.toThrow(
        DUP,
      );
      const my = build();
      my.rows.my.status = 'QC_PASSED';
      await expect(
        my.service.reviewMaterialYieldStep('900', { failedQty: 0 }, 'k'),
      ).rejects.toThrow(DUP);
    });
  });

  describe('D6 / R1: giữ việc của N1 khi chấm lô', () => {
    it('R1: lô Sơn (Phước An sơn ở Phú An): tra xưởng sơn theo tổ SON của PI; tin QC_FAILED + thiếu mang workshopId; KHÔNG gọi nhắc chuyển mảnh', async () => {
      const c = build();
      c.rows.batch.stage = 'SON';
      (queueWorkshopIdOfPi as jest.Mock).mockResolvedValue(2n);
      await c.service.reviewProductionBatch('700', { failedQty: 2, shortQty: 3 }, 'kcs-1');
      expect(queueWorkshopIdOfPi).toHaveBeenCalledWith(expect.anything(), 'SON', 30n);
      const p = emitted(c, 'QC_FAILED')!;
      expect(p).toMatchObject({ workshopId: '2', failedQty: 2, senderRole: 'SON_STAFF' });
      expect(String(p.detail)).toContain('KCS ghi thiếu 3 mảnh');
      expect(c.paint.refreshForOrder).not.toHaveBeenCalled();
    });

    it('R1: lô Sơn nhưng không suy ra được xưởng sơn -> tin KHÔNG có khoá workshopId (không ghi null)', async () => {
      const c = build();
      c.rows.batch.stage = 'SON';
      await c.service.reviewProductionBatch('700', { failedQty: 0 }, 'kcs-1');
      expect(emitted(c, 'QC_PASSED')).not.toHaveProperty('workshopId');
    });

    it('R1: lô Hàn không tra xưởng sơn, tin không có workshopId', async () => {
      const c = build();
      await c.service.reviewProductionBatch('700', { failedQty: 1 }, 'kcs-1');
      expect(queueWorkshopIdOfPi).not.toHaveBeenCalled();
      expect(emitted(c, 'QC_FAILED')).not.toHaveProperty('workshopId');
    });

    it('D6: lô Hàn - luôn gọi paintReminder.refreshForOrder(id lệnh) sau commit, ở cả 3 kiểu chấm (đạt / thiếu / lỗi); refresh ném lỗi thì vẫn phát realtime và trả kết quả', async () => {
      for (const o of [{ failedQty: 0 }, { failedQty: 0, shortQty: 5 }, { failedQty: 3 }]) {
        const c = build();
        await c.service.reviewProductionBatch('700', o, 'kcs-1');
        expect(c.paint.refreshForOrder).toHaveBeenCalledTimes(1);
        expect(c.paint.refreshForOrder).toHaveBeenCalledWith('1');
        expect(c.calls.indexOf('refresh')).toBeGreaterThan(c.calls.indexOf('create'));
      }
      const bad = build();
      bad.paint.refreshForOrder.mockRejectedValue(new Error('nhắc lỗi'));
      const res = await bad.service.reviewProductionBatch('700', { failedQty: 0 }, 'kcs-1');
      expect(res.id).toBe('501');
      expect(bad.realtime.publishEntityChanged).toHaveBeenCalledTimes(1);
    });

    it('D6: lượt chấm bị 409 (chấm trùng) thì KHÔNG nhắc chuyển mảnh', async () => {
      const c = build();
      c.state.claimed = true;
      await expect(c.service.reviewProductionBatch('700', { failedQty: 0 }, 'k')).rejects.toThrow(
        DUP,
      );
      expect(c.paint.refreshForOrder).not.toHaveBeenCalled();
    });
  });

  describe('Q4 / AC28: số hợp lệ của DTO - thiếu < 0 bị chặn ở API', () => {
    const errorsOf = async <T extends object>(cls: new () => T, body: object) =>
      (await validate(plainToInstance(cls, body))).map((e) => e.property);

    it('AC28: shortQty = -1 (lô / pat / chân nhôm) -> lỗi dữ liệu; 0 và số dương hợp lệ; 1.5 và chữ bị chặn', async () => {
      expect(await errorsOf(CreateQcReviewDto, { failedQty: 0, shortQty: -1 })).toContain(
        'shortQty',
      );
      expect(await errorsOf(CreateQcReviewDto, { failedQty: 0, shortQty: 1.5 })).toContain(
        'shortQty',
      );
      expect(await errorsOf(CreateQcReviewDto, { failedQty: 0, shortQty: 'x' })).toContain(
        'shortQty',
      );
      expect(await errorsOf(CreateQcReviewDto, { failedQty: 0, shortQty: 0 })).toEqual([]);
      expect(await errorsOf(CreateQcReviewDto, { failedQty: 3, shortQty: 5 })).toEqual([]);
      expect(await errorsOf(CreateQcReviewDto, { failedQty: 0 })).toEqual([]);
    });

    it('AC28: failedQty âm bị chặn', async () => {
      expect(await errorsOf(CreateQcReviewDto, { failedQty: -1 })).toContain('failedQty');
    });

    it('AC28: dòng cỡ của Cắt / công đoạn phụ: shortQty -1 và scrapQty -1 bị chặn (lỗi nằm ở dòng segments)', async () => {
      const bad1 = await validate(
        plainToInstance(CreateSteelIssueQcReviewDto, {
          segments: [{ segmentSpecId: '30', failedQty: 0, shortQty: -1 }],
        }),
      );
      expect(bad1.length).toBeGreaterThan(0);
      const bad2 = await validate(
        plainToInstance(CreateSteelIssueQcReviewDto, {
          segments: [{ segmentSpecId: '30', failedQty: 2, scrapQty: -1 }],
        }),
      );
      expect(bad2.length).toBeGreaterThan(0);
      const ok = await validate(
        plainToInstance(CreateSteelIssueQcReviewDto, {
          segments: [{ segmentSpecId: '30', failedQty: 3, shortQty: 5, scrapQty: 0 }],
        }),
      );
      expect(ok).toEqual([]);
    });
  });
});
