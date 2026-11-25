import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { CutBundleStatus, ProcessStep, SteelIssueStatus } from '../../generated/prisma/client';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { StockReservationsService } from '../stock/stock-reservations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { SteelIssuesService } from './steel-issues.service';

/**
 * UB3 (QA, P1-T3-U1) - KCS chốt đợt cắt / nhóm công đoạn, tiến độ, steelBalance, roll-up trạng thái lô sắt.
 * AC1 (không phát CUT_BUNDLE_TO_KCS khi chốt), AC6 / AC7 / AC52 (chốt trùng, chốt đúng lúc hủy, đợt đã xoá),
 * AC11 (cổng lệnh dừng với nhãn "chốt để chấm"), AC25 (maxNow của tiến độ = số lớn nhất BE nhận), AC26, AC51, AC54, AC60.
 * Sổ dữ liệu là bộ nhớ có trạng thái, đọc theo điều kiện where (không theo thứ tự gọi).
 */

jest.mock('../../common/utils/pi-workshop-lock.util', () => ({
  ...jest.requireActual<typeof import('../../common/utils/pi-workshop-lock.util')>(
    '../../common/utils/pi-workshop-lock.util',
  ),
  lockPisForIssue: jest.fn(() => Promise.resolve(new Map())),
  workshopsOfPis: jest.fn(() => Promise.resolve(new Map())),
  assertWorkshopUnchanged: jest.fn(),
}));

const decimal = (n: number) => ({ toNumber: () => n, toString: () => String(n) });

const PI = 1n;
const MAT = 30n;
const SPEC = 30n;
const SKU_A = 1n;
const SKU_B = 2n;

interface CutRow {
  qty: number;
  order: bigint | null;
  status?: CutBundleStatus;
}
interface CutQcRow {
  failed: number;
  short: number;
  order: bigint | null;
}
interface StepRow {
  qty: number;
  step: string;
  order: bigint | null;
  bundleStatus?: string | null;
}
interface StepQcRow {
  failed: number;
  short: number;
  scrap: number;
  step: string;
  order: bigint | null;
}
interface World {
  orders: { id: bigint; bomRevisionId: bigint; quantity: number; floorStage: 'ACTIVE' }[];
  qtyPerPiece: number;
  processSteps: ProcessStep[];
  cut: CutRow[];
  cutQc: CutQcRow[];
  step: StepRow[];
  stepQc: StepQcRow[];
  issues: Record<string, unknown>[];
  reservations: Record<string, unknown>[];
  bundles: Map<bigint, { status: CutBundleStatus }>;
}

function newWorld(over: Partial<World> = {}): World {
  return {
    orders: [{ id: SKU_A, bomRevisionId: 5n, quantity: 1, floorStage: 'ACTIVE' }],
    qtyPerPiece: 1180,
    processSteps: [ProcessStep.CAT, ProcessStep.UON],
    cut: [],
    cutQc: [],
    step: [],
    stepQc: [],
    issues: [],
    reservations: [],
    bundles: new Map([[7n, { status: CutBundleStatus.CUTTING }]]),
    ...over,
  };
}

function inScope(where: unknown, order: bigint | null): boolean {
  const w = where as { OR?: { productionOrderId: bigint | null }[] } | undefined;
  if (!w?.OR) return true;
  return w.OR.some((c) => c.productionOrderId === order);
}

type MockGroup = Record<string, jest.Mock>;
interface FakePrisma {
  $executeRaw: jest.Mock;
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
  steelIssue: MockGroup;
  floorReport: MockGroup;
  productionInvoice: MockGroup;
  productionOrder: MockGroup;
  pieceBom: MockGroup;
  bomPiece: MockGroup;
  segmentSpec: MockGroup;
  cutPatternSegment: MockGroup;
  qcReviewSegment: MockGroup;
  stepBatchSegment: MockGroup;
  cutBundle: MockGroup;
  stepBatch: MockGroup;
  stepBundle: MockGroup;
  material: MockGroup;
  systemConfig: MockGroup;
  cuttingProposalLine: MockGroup;
  stockReservation: MockGroup;
  steelReturn: MockGroup;
  cuttingPlanCoverage: MockGroup;
}

function build(world: World) {
  let seq = 1000n;
  const prisma = {} as FakePrisma;
  prisma.$executeRaw = jest.fn().mockResolvedValue(0);
  prisma.$queryRaw = jest.fn((strings: TemplateStringsArray) => {
    const sql = strings.join('');
    if (sql.includes('production_orders')) return Promise.resolve([{ floorStage: 'ACTIVE' }]);
    if (sql.includes('cut_bundles') && sql.includes('openedById')) return Promise.resolve([]);
    return Promise.resolve([]);
  });
  prisma.$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(prisma));
  prisma.steelIssue = {
    findUnique: jest.fn().mockResolvedValue({
      id: 100n,
      productionInvoiceId: PI,
      materialId: MAT,
      barLengthMm: 6000,
      barCount: 20,
      status: SteelIssueStatus.RECEIVED,
      idempotencyKey: null,
      actualBarCount: null,
      issuedAt: new Date(),
      issuedById: 'u',
      completedAt: null,
      reworkOfId: null,
      completedSteps: [],
      productionInvoice: { code: 'PI-1', salesOrder: { orderCode: 'PO-1' } },
      material: { id: MAT, code: 'ST-18', name: 'Sắt' },
    }),
    findMany: jest.fn().mockImplementation(() => Promise.resolve(world.issues)),
    update: jest.fn().mockResolvedValue({}),
  };
  prisma.floorReport = {
    create: jest.fn().mockImplementation(() => Promise.resolve({ id: ++seq })),
    findUnique: jest.fn().mockResolvedValue(null),
  };
  prisma.productionInvoice = {
    findUnique: jest.fn().mockResolvedValue({ id: PI, code: 'PI-1' }),
    findMany: jest.fn().mockResolvedValue([{ id: PI, code: 'PI-1' }]),
  };
  prisma.productionOrder = {
    findMany: jest.fn().mockImplementation(() =>
      Promise.resolve(
        world.orders.map((o) => ({
          ...o,
          productionInvoiceItem: { productionInvoiceId: PI },
        })),
      ),
    ),
    findFirst: jest.fn().mockResolvedValue({ id: SKU_A }),
    findUnique: jest
      .fn()
      .mockImplementation((a: { where: { id: bigint } }) =>
        Promise.resolve({ mfgProduct: { factoryCode: `SKU-${a.where.id}` } }),
      ),
  };
  prisma.pieceBom = {
    findMany: jest.fn().mockImplementation(() =>
      Promise.resolve(
        [...new Set(world.orders.map((o) => o.bomRevisionId))].map((rev) => ({
          bomRevisionId: rev,
          pieceId: 20n,
          segmentSpecId: SPEC,
          qtyPerPiece: world.qtyPerPiece,
          processSteps: world.processSteps,
          segmentSpec: {
            id: SPEC,
            materialId: MAT,
            cutLengthMm: decimal(355),
            material: { id: MAT, code: 'ST-18', name: 'Sắt vuông', specification: null },
          },
        })),
      ),
    ),
  };
  prisma.bomPiece = {
    findMany: jest.fn().mockResolvedValue([{ bomRevisionId: 5n, pieceId: 20n, qtyPerUnit: 1 }]),
  };
  prisma.segmentSpec = {
    findMany: jest
      .fn()
      .mockResolvedValue([{ id: SPEC, materialId: MAT, cutLengthMm: decimal(355) }]),
  };
  prisma.cutPatternSegment = {
    findMany: jest.fn().mockImplementation((a: { where: { cutBundle?: unknown } }) =>
      Promise.resolve(
        world.cut
          .filter((r) => inScope(a.where.cutBundle, r.order))
          .map((r) => ({
            segmentSpecId: SPEC,
            qty: r.qty,
            cutBundle: {
              productionOrderId: r.order,
              status: r.status ?? CutBundleStatus.QC_PASSED,
              steelIssue: { productionInvoiceId: PI },
            },
          })),
      ),
    ),
    upsert: jest.fn(),
  };
  prisma.qcReviewSegment = {
    findMany: jest
      .fn()
      .mockImplementation((a: { where: { qcReview?: Record<string, unknown> } }) => {
        const qr = a.where.qcReview ?? {};
        if ('stepBundle' in qr) {
          return Promise.resolve(
            world.stepQc
              .filter((r) => inScope(qr.stepBundle, r.order))
              .map((r) => ({
                segmentSpecId: SPEC,
                failedQty: r.failed,
                shortQty: r.short,
                scrapQty: r.scrap,
                qcReview: {
                  stepBundle: { productionOrderId: r.order, step: r.step, productionInvoiceId: PI },
                },
              })),
          );
        }
        return Promise.resolve(
          world.cutQc
            .filter((r) => inScope(qr.cutBundle, r.order))
            .map((r) => ({
              segmentSpecId: SPEC,
              failedQty: r.failed,
              shortQty: r.short,
              qcReview: {
                steelIssue: { productionInvoiceId: PI },
                cutBundle: { productionOrderId: r.order },
              },
            })),
        );
      }),
  };
  prisma.stepBatchSegment = {
    findMany: jest.fn().mockImplementation((a: { where: { stepBatch?: { OR?: unknown } } }) =>
      Promise.resolve(
        world.step
          .filter((r) => inScope(a.where.stepBatch, r.order))
          .map((r) => ({
            segmentSpecId: SPEC,
            qty: r.qty,
            stepBatch: {
              productionOrderId: r.order,
              step: r.step,
              productionInvoiceId: PI,
              stepBundle: r.bundleStatus ? { status: r.bundleStatus } : null,
            },
          })),
      ),
    ),
  };
  prisma.cutBundle = {
    create: jest.fn().mockImplementation(
      (a: {
        data: {
          productionOrderId: bigint;
          segments: { create: { segmentSpecId: bigint; qty: number }[] };
        };
      }) => {
        for (const s of a.data.segments.create)
          world.cut.push({
            qty: s.qty,
            order: a.data.productionOrderId,
            status: CutBundleStatus.CUTTING,
          });
        world.bundles.set(1n, { status: CutBundleStatus.CUTTING });
        return Promise.resolve({ id: 1n });
      },
    ),
    findUnique: jest.fn().mockImplementation((a: { where: { id: bigint } }) => {
      const b = world.bundles.get(a.where.id);
      if (!b) return Promise.resolve(null);
      return Promise.resolve({
        id: a.where.id,
        steelIssueId: 100n,
        proposalPatternId: null,
        barCount: 0,
        mauNguyenMm: 0,
        scrapMm: 0,
        status: b.status,
        completedSteps: [ProcessStep.CAT],
        completedAt: null,
        createdAt: new Date('2026-09-05T00:00:00.000Z'),
        segments: [],
        productionOrderId: null,
        steelIssue: { productionInvoiceId: PI, materialId: MAT },
      });
    }),
    findUniqueOrThrow: jest.fn().mockImplementation((a: { where: { id: bigint } }) => {
      const b = world.bundles.get(a.where.id)!;
      return Promise.resolve({
        id: a.where.id,
        steelIssueId: 100n,
        proposalPatternId: null,
        barCount: 0,
        mauNguyenMm: 0,
        scrapMm: 0,
        status: b.status,
        completedSteps: [ProcessStep.CAT],
        completedAt: new Date(),
        createdAt: new Date(),
        segments: [],
      });
    }),
    updateMany: jest
      .fn()
      .mockImplementation(
        (a: {
          where: { id: bigint; status: CutBundleStatus };
          data: { status: CutBundleStatus };
        }) => {
          const b = world.bundles.get(a.where.id);
          if (!b || b.status !== a.where.status) return Promise.resolve({ count: 0 });
          b.status = a.data.status;
          return Promise.resolve({ count: 1 });
        },
      ),
    findMany: jest.fn().mockImplementation(() =>
      Promise.resolve(
        [...world.bundles.entries()].map(([id, b]) => ({
          id,
          status: b.status,
          completedAt: null,
        })),
      ),
    ),
    findFirst: jest.fn().mockResolvedValue(null),
  };
  prisma.stepBatch = {
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  prisma.stepBundle = {
    create: jest.fn().mockResolvedValue({
      id: 500n,
      productionInvoiceId: PI,
      materialId: MAT,
      step: ProcessStep.UON,
      status: 'AWAITING_QC',
      submittedAt: new Date(),
      submittedById: 'kcs',
      productionOrderId: SKU_A,
      reportedById: null,
    }),
  };
  prisma.material = {
    findUniqueOrThrow: jest.fn().mockResolvedValue({ id: MAT, code: 'ST-18', name: 'Sắt vuông' }),
  };
  prisma.systemConfig = {
    findUnique: jest.fn().mockResolvedValue({
      solverTrimStartMm: 10,
      solverBladeWidthMm: decimal(1),
      solverMctdTrimStartMm: 0,
      solverMctdBladeWidthMm: decimal(2.5),
    }),
  };
  prisma.cuttingProposalLine = { findMany: jest.fn().mockResolvedValue([]) };
  prisma.stockReservation = {
    findMany: jest.fn().mockImplementation(() => Promise.resolve(world.reservations)),
  };
  prisma.steelReturn = { findMany: jest.fn().mockResolvedValue([]) };
  prisma.cuttingPlanCoverage = { findMany: jest.fn().mockResolvedValue([]) };

  const notifications = {
    emit: jest.fn().mockResolvedValue(undefined),
    resolve: jest.fn().mockResolvedValue(undefined),
  };
  const service = new SteelIssuesService(
    prisma as unknown as PrismaServiceType,
    {} as unknown as StockLedgerService,
    {} as unknown as StockReservationsService,
    notifications as unknown as NotificationsService,
    {
      publishEntityChanged: jest.fn(),
      publishNotificationCreated: jest.fn(),
    } as unknown as RealtimeService,
  );
  return { prisma, service, notifications };
}

async function errOf(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error('Lẽ ra phải ném lỗi');
}

const issueRow = (over: Record<string, unknown> = {}) => ({
  productionInvoiceId: PI,
  materialId: MAT,
  barCount: 2,
  barLengthMm: 6000,
  status: SteelIssueStatus.RECEIVED,
  receivedBarCount: null,
  reworkOfId: null,
  ...over,
});

describe('UB3 steel-issues KCS chốt / tiến độ / steelBalance (QA)', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  describe('finishCutBundle - KCS chốt đợt cắt (AC1, AC6, AC11, AC52)', () => {
    it('AC1: notifyKcs false thì KHÔNG phát CUT_BUNDLE_TO_KCS; mặc định (QLSX gửi) vẫn phát', async () => {
      const a = build(newWorld());
      await a.service.finishCutBundle('7', { notifyKcs: false, gateLabel: 'chốt để chấm' });
      expect(a.notifications.emit).not.toHaveBeenCalled();
      const b = build(newWorld());
      await b.service.finishCutBundle('7');
      expect(b.notifications.emit).toHaveBeenCalledWith(
        'CUT_BUNDLE_TO_KCS',
        expect.objectContaining({ entityId: '7' }),
      );
    });

    it('AC6: chốt xong chuyển AWAITING_QC và lô sắt roll-up thành AWAITING_QC (AC54: đọc đợt SAU khi lấy khoá)', async () => {
      const { prisma, service } = build(newWorld());
      await service.finishCutBundle('7', { notifyKcs: false, gateLabel: 'chốt để chấm' });
      expect(prisma.steelIssue.update).toHaveBeenCalledWith({
        where: { id: 100n },
        data: { status: SteelIssueStatus.AWAITING_QC, completedAt: null },
      });
      const lock = prisma.$executeRaw.mock.invocationCallOrder[0];
      const forUpdate = prisma.$queryRaw.mock.invocationCallOrder[0];
      const readBundles = prisma.cutBundle.findMany.mock.invocationCallOrder[0];
      expect(String((prisma.$executeRaw.mock.calls as unknown[][])[0][1])).toBe(
        'steel-issue-rollup:100',
      );
      expect(lock).toBeLessThan(forUpdate);
      expect(forUpdate).toBeLessThan(readBundles);
    });

    it('AC6: 2 lời gọi chốt cùng lúc (cùng đọc thấy CUTTING) -> đúng 1 thành công, lời kia 409 "vừa được chốt để chấm"; giờ chốt chỉ ghi 1 lần', async () => {
      const w = newWorld();
      const { prisma, service } = build(w);
      const opts = { notifyKcs: false, gateLabel: 'chốt để chấm' };
      const results = await Promise.allSettled([
        service.finishCutBundle('7', opts),
        service.finishCutBundle('7', opts),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(failed.reason).toBeInstanceOf(ConflictException);
      expect((failed.reason as Error).message).toBe(
        'Đợt cắt này vừa được chốt để chấm - tải lại trang.',
      );
      const writes = prisma.cutBundle.updateMany.mock.results as {
        value: Promise<{ count: number }>;
      }[];
      const counts = await Promise.all(writes.map((r) => r.value));
      expect(counts.filter((c) => c.count === 1)).toHaveLength(1);
    });

    it('AC6: đợt đã AWAITING_QC lúc đọc -> 409 ngay, không updateMany', async () => {
      const w = newWorld({ bundles: new Map([[7n, { status: CutBundleStatus.AWAITING_QC }]]) });
      const { prisma, service } = build(w);
      await expect(service.finishCutBundle('7', { notifyKcs: false })).rejects.toThrow(
        'Đợt cắt này vừa được chốt để chấm - tải lại trang.',
      );
      expect(prisma.cutBundle.updateMany).not.toHaveBeenCalled();
    });

    it('AC52: đợt vừa bị QLSX hủy hết (xoá đúng lúc giữa lúc đọc và lúc ghi) -> 409 "vừa bị QLSX hủy hết số - không còn gì để chấm, tải lại trang."', async () => {
      const w = newWorld();
      const { prisma, service } = build(w);
      // đọc lần đầu thấy đợt, rồi đợt bị xoá trước khi updateMany
      const read = prisma.cutBundle.findUnique.getMockImplementation()! as (
        a: unknown,
      ) => Promise<unknown>;
      prisma.cutBundle.findUnique.mockImplementationOnce(async (a: unknown) => {
        const r = await read(a);
        w.bundles.delete(7n);
        return r;
      });
      const err = await errOf(service.finishCutBundle('7', { notifyKcs: false }));
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe(
        'Đợt cắt này vừa bị QLSX hủy hết số - không còn gì để chấm, tải lại trang.',
      );
    });

    it('AC52 (ghi nhận): đợt đã xoá TRƯỚC khi đọc thì finishCutBundle còn NotFound - việc đổi thành 409 thuộc BE-4a', async () => {
      const { service } = build(newWorld({ bundles: new Map() }));
      await expect(service.finishCutBundle('7', { notifyKcs: false })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('AC11: lệnh dừng (không còn SKU ACTIVE) -> 409 câu floor-gate với nhãn "chốt để chấm", đợt giữ CUTTING', async () => {
      const w = newWorld();
      const { prisma, service } = build(w);
      prisma.productionOrder.findFirst.mockResolvedValue(null);
      const err = await errOf(
        service.finishCutBundle('7', { notifyKcs: false, gateLabel: 'chốt để chấm' }),
      );
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe(
        'PI 1 chưa có SKU nào được QLSX bấm "Bắt đầu" (hoặc đã "Kết thúc") - chưa/không thể chốt để chấm',
      );
      expect(w.bundles.get(7n)!.status).toBe(CutBundleStatus.CUTTING);
      expect(prisma.cutBundle.updateMany).not.toHaveBeenCalled();
    });

    it('AC11: không truyền nhãn thì dùng nhãn cũ "báo cắt xong" (đường QLSX cũ không đổi chữ)', async () => {
      const { prisma, service } = build(newWorld());
      prisma.productionOrder.findFirst.mockResolvedValue(null);
      await expect(service.finishCutBundle('7')).rejects.toThrow('chưa/không thể báo cắt xong');
    });
  });

  describe('submitStepBundle - KCS chốt nhóm công đoạn (AC6, AC7, AC11, AC12)', () => {
    const NONE_LEFT =
      'Nhóm Uốn này không còn lần báo nào chưa chấm (có thể vừa được chốt hoặc vừa bị hủy) - tải lại trang.';
    const stepBatchRow = (id: bigint, qty: number) => ({
      id,
      step: ProcessStep.UON,
      segments: [{ segmentSpecId: SPEC, qty, segmentSpec: { cutLengthMm: decimal(355) } }],
    });
    const lockedRows = (prisma: FakePrisma, rows: { id: bigint }[]) =>
      prisma.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
        const sql = strings.join('');
        if (sql.includes('production_orders')) return Promise.resolve([{ floorStage: 'ACTIVE' }]);
        if (sql.includes('step_batches')) return Promise.resolve(rows);
        return Promise.resolve([]);
      });
    const sqlOf = (prisma: FakePrisma) => {
      const call = (prisma.$queryRaw.mock.calls as unknown[][]).find((c) =>
        (c[0] as string[]).join('').includes('step_batches'),
      )!;
      const strings = call[0] as string[];
      const vals = call.slice(1);
      return strings
        .map((str, i) => {
          const v = vals[i] as { sql?: string } | undefined;
          return (
            str + (i < vals.length ? (v && typeof v === 'object' && 'sql' in v ? v.sql : '?') : '')
          );
        })
        .join('');
    };

    it('AC7: QLSX hủy lần 40 trước khi chốt - nhóm còn lần 80: step_bundle chỉ gom dòng 80 (không gom dòng đã xoá), kết quả trả đúng 80', async () => {
      const { prisma, service } = build(newWorld());
      lockedRows(prisma, [{ id: 11n }]);
      prisma.stepBatch.findMany.mockResolvedValue([stepBatchRow(11n, 80)]);
      const res = await service.submitStepBundle(
        '1',
        '30',
        ProcessStep.UON,
        'kcs-1',
        '1',
        undefined,
        {
          gateLabel: 'chốt để chấm',
        },
      );
      expect(prisma.stepBatch.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: [11n] }, stepBundleId: null } }),
      );
      expect(res.segments.reduce((t, s) => t + s.qty, 0)).toBe(80);
    });

    it('AC7 / AC6: QLSX đã hủy hết (không còn dòng chờ) -> 400 đúng câu, KHÔNG tạo step_bundle', async () => {
      const { prisma, service } = build(newWorld());
      lockedRows(prisma, []);
      const err = await errOf(
        service.submitStepBundle('1', '30', ProcessStep.UON, 'kcs-1', '1', undefined, {
          gateLabel: 'chốt để chấm',
        }),
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe(NONE_LEFT);
      expect(prisma.stepBundle.create).not.toHaveBeenCalled();
    });

    it('AC7: updateMany gán 0 dòng (bị chốt chen) hoặc đọc lại thấy 0 dòng -> 400 để rollback, không để step_bundle rỗng', async () => {
      const a = build(newWorld());
      lockedRows(a.prisma, [{ id: 11n }]);
      a.prisma.stepBatch.updateMany.mockResolvedValue({ count: 0 });
      a.prisma.stepBatch.findMany.mockResolvedValue([]);
      await expect(
        a.service.submitStepBundle('1', '30', ProcessStep.UON, 'kcs-1', '1'),
      ).rejects.toThrow(NONE_LEFT);
      const b = build(newWorld());
      lockedRows(b.prisma, [{ id: 11n }]);
      b.prisma.stepBatch.updateMany.mockResolvedValue({ count: 1 });
      b.prisma.stepBatch.findMany.mockResolvedValue([]);
      await expect(
        b.service.submitStepBundle('1', '30', ProcessStep.UON, 'kcs-1', '1'),
      ).rejects.toThrow(NONE_LEFT);
    });

    it('AC6: 2 lời gọi chốt nối tiếp -> lời sau nhận 400 "không còn lần báo nào chưa chấm"', async () => {
      const { prisma, service } = build(newWorld());
      const rows = [{ id: 11n }];
      lockedRows(prisma, rows);
      prisma.stepBatch.findMany.mockResolvedValue([stepBatchRow(11n, 80)]);
      await service.submitStepBundle('1', '30', ProcessStep.UON, 'kcs-1', '1');
      rows.length = 0; // dòng đã có stepBundleId nên không còn "chờ"
      await expect(
        service.submitStepBundle('1', '30', ProcessStep.UON, 'kcs-2', '1'),
      ).rejects.toThrow(NONE_LEFT);
      expect(prisma.stepBundle.create).toHaveBeenCalledTimes(1);
    });

    it('AC11: lệnh dừng -> 409 câu floor-gate nhãn "chốt để chấm", nằm TRONG khoá (sau khoá advisory), không đọc dòng chờ', async () => {
      const { prisma, service } = build(newWorld());
      prisma.productionOrder.findFirst.mockResolvedValue({ id: SKU_A });
      prisma.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
        if (strings.join('').includes('production_orders'))
          return Promise.resolve([{ floorStage: 'DONE' }]);
        return Promise.resolve([{ id: 11n }]);
      });
      const err = await errOf(
        service.submitStepBundle('1', '30', ProcessStep.UON, 'kcs-1', '1', undefined, {
          gateLabel: 'chốt để chấm',
        }),
      );
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe(
        'PI 1 chưa có SKU nào được QLSX bấm "Bắt đầu" (hoặc đã "Kết thúc") - chưa/không thể chốt để chấm',
      );
      expect(String((prisma.$executeRaw.mock.calls as unknown[][])[0][1])).toBe(
        'step-bundle:1:30:UON:1',
      );
      expect(prisma.stepBundle.create).not.toHaveBeenCalled();
    });

    it('AC12: PI 1 SKU - dòng step_batches null gộp vào nhóm của SKU duy nhất; PI nhiều SKU - chỉ dòng đã gán SKU', async () => {
      const one = build(newWorld());
      lockedRows(one.prisma, [{ id: 11n }]);
      one.prisma.stepBatch.findMany.mockResolvedValue([stepBatchRow(11n, 5)]);
      await one.service.submitStepBundle('1', '30', ProcessStep.UON, 'kcs', '1');
      expect(sqlOf(one.prisma)).toContain('IS NULL');

      const multi = build(
        newWorld({
          orders: [
            { id: SKU_A, bomRevisionId: 5n, quantity: 1, floorStage: 'ACTIVE' },
            { id: SKU_B, bomRevisionId: 5n, quantity: 1, floorStage: 'ACTIVE' },
          ],
        }),
      );
      lockedRows(multi.prisma, [{ id: 11n }]);
      multi.prisma.stepBatch.findMany.mockResolvedValue([stepBatchRow(11n, 5)]);
      await multi.service.submitStepBundle('1', '30', ProcessStep.UON, 'kcs', '1');
      expect(sqlOf(multi.prisma)).not.toContain('"productionOrderId" IS NULL');
    });

    it('theo người: worker.id null gom dòng chưa biết người; có worker.id thì gom đúng người đó', async () => {
      const a = build(newWorld());
      lockedRows(a.prisma, [{ id: 11n }]);
      a.prisma.stepBatch.findMany.mockResolvedValue([stepBatchRow(11n, 5)]);
      await a.service.submitStepBundle('1', '30', ProcessStep.UON, 'kcs', '1', { id: null });
      expect(sqlOf(a.prisma)).toContain('"reportedById" IS NULL');
      const b = build(newWorld());
      lockedRows(b.prisma, [{ id: 11n }]);
      b.prisma.stepBatch.findMany.mockResolvedValue([stepBatchRow(11n, 5)]);
      await b.service.submitStepBundle('1', '30', ProcessStep.UON, 'kcs', '1', { id: 'cn-9' });
      expect(sqlOf(b.prisma)).toContain('"reportedById" = ?');
    });

    it('SKU không thuộc PI -> 400, không khoá, không tạo gì', async () => {
      const { prisma, service } = build(newWorld());
      await expect(
        service.submitStepBundle('1', '30', ProcessStep.UON, 'kcs', '99'),
      ).rejects.toThrow('không thuộc PI này');
      expect(prisma.stepBundle.create).not.toHaveBeenCalled();
    });
  });

  describe('syncIssueStatusFromBundles - roll-up (AC54)', () => {
    const bundle = (id: bigint, status: CutBundleStatus, completedAt: Date | null = null) => ({
      id,
      status,
      completedAt,
    });

    it('AC54: đợt A vừa chốt (AWAITING_QC), đợt B vừa chấm xong (QC_PASSED) -> lô sắt AWAITING_QC (còn đợt chờ chấm thắng)', async () => {
      const { prisma, service } = build(newWorld());
      prisma.cutBundle.findMany.mockResolvedValue([
        bundle(1n, CutBundleStatus.AWAITING_QC),
        bundle(2n, CutBundleStatus.QC_PASSED, new Date('2026-11-18T01:00:00Z')),
      ]);
      await service.syncIssueStatusFromBundles(100n);
      expect(prisma.steelIssue.update).toHaveBeenCalledWith({
        where: { id: 100n },
        data: { status: SteelIssueStatus.AWAITING_QC, completedAt: null },
      });
    });

    it('mọi đợt QC_PASSED -> QC_PASSED, completedAt = mới nhất; còn đợt CUTTING (không đợt chờ) -> RECEIVED; không có đợt -> không ghi', async () => {
      const { prisma, service } = build(newWorld());
      prisma.cutBundle.findMany.mockResolvedValue([
        bundle(1n, CutBundleStatus.QC_PASSED, new Date('2026-11-17T01:00:00Z')),
        bundle(2n, CutBundleStatus.QC_PASSED, new Date('2026-11-18T01:00:00Z')),
      ]);
      await service.syncIssueStatusFromBundles(100n);
      expect(prisma.steelIssue.update).toHaveBeenLastCalledWith({
        where: { id: 100n },
        data: { status: SteelIssueStatus.QC_PASSED, completedAt: new Date('2026-11-18T01:00:00Z') },
      });
      prisma.cutBundle.findMany.mockResolvedValue([
        bundle(1n, CutBundleStatus.QC_PASSED, new Date()),
        bundle(2n, CutBundleStatus.CUTTING),
      ]);
      await service.syncIssueStatusFromBundles(100n);
      expect(prisma.steelIssue.update).toHaveBeenLastCalledWith({
        where: { id: 100n },
        data: { status: SteelIssueStatus.RECEIVED, completedAt: null },
      });
      prisma.steelIssue.update.mockClear();
      prisma.cutBundle.findMany.mockResolvedValue([]);
      await service.syncIssueStatusFromBundles(100n);
      expect(prisma.steelIssue.update).not.toHaveBeenCalled();
    });
  });

  describe('getPhoiProgress / getStepProgress (AC25, AC26, AC60)', () => {
    it('AC25: maxNow của tiến độ Cắt = số lớn nhất recordCutBatch nhận lúc đó (maxNow qua, maxNow+1 bị chặn), cùng dữ liệu', async () => {
      const w = newWorld({
        issues: [issueRow()],
        cut: [{ qty: 1175, order: SKU_A }],
        step: [],
        stepQc: [{ failed: 5, short: 0, scrap: 5, step: 'UON', order: SKU_A }],
      });
      const { service } = build(w);
      const [item] = await service.getPhoiProgress('1');
      const maxNow = item.segments[0].maxNow;
      expect(maxNow).toBe(10); // cần 1180 + 5 cắt lại - đã tính 1175
      const dto = (qty: number) => ({
        productionOrderId: '1',
        segments: [{ segmentSpecId: '30', qty }],
      });
      await expect(service.recordCutBatch('100', dto(maxNow + 1), 'cn-1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.recordCutBatch('100', dto(maxNow), 'cn-1')).resolves.toBeDefined();
    });

    it('AC25: maxNow của tiến độ Uốn = số lớn nhất recordStepBatch nhận (số cần còn 8, vật lý còn 3 -> 3), cùng dữ liệu', async () => {
      const w = newWorld({
        issues: [issueRow()],
        cut: [{ qty: 1180, order: SKU_A }],
        step: [{ qty: 1180, step: 'UON', order: SKU_A, bundleStatus: 'QC_PASSED' }],
        stepQc: [{ failed: 8, short: 0, scrap: 5, step: 'UON', order: SKU_A }],
      });
      const { service, prisma } = build(w);
      prisma.stepBatch.findUniqueOrThrow = jest.fn().mockResolvedValue({
        id: 900n,
        step: ProcessStep.UON,
        segments: [{ segmentSpecId: SPEC, qty: 3, segmentSpec: { cutLengthMm: decimal(355) } }],
      });
      prisma.stepBatch.create = jest.fn().mockResolvedValue({ id: 900n });
      const [item] = await service.getStepProgress('1', ProcessStep.UON);
      const seg = item.segments[0];
      expect(seg.maxNow).toBe(3);
      expect(seg.physicalLeft).toBe(3);
      const dto = (qty: number) => ({
        productionOrderId: '1',
        materialId: '30',
        step: ProcessStep.UON,
        segments: [{ segmentSpecId: '30', qty }],
      });
      await expect(service.recordStepBatch('1', dto(seg.maxNow + 1), 'cn-1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.recordStepBatch('1', dto(seg.maxNow), 'cn-1')).resolves.toBeDefined();
    });

    it('AC26: dòng đã vượt (cắt 1190 / cần 1180): maxNow 0, required 1180, không số âm ở bất kỳ trường nào', async () => {
      const w = newWorld({ issues: [issueRow()], cut: [{ qty: 1190, order: SKU_A }] });
      const { service } = build(w);
      const [item] = await service.getPhoiProgress('1');
      const seg = item.segments[0];
      expect(seg.maxNow).toBe(0);
      expect(seg.required).toBe(1180);
      expect(seg.reportedQty).toBe(1190);
      for (const v of [seg.required, seg.done, seg.maxNow, seg.baseRequired, seg.extraNeed]) {
        expect(v).toBeGreaterThanOrEqual(0);
      }
    });

    it('nghĩa done: Cắt done = thô - thiếu (vẫn gồm lỗi); shortQty tách riêng với failed', async () => {
      const w = newWorld({
        issues: [issueRow()],
        cut: [{ qty: 100, order: SKU_A }],
        cutQc: [{ failed: 4, short: 3, order: SKU_A }],
      });
      const { service } = build(w);
      const seg = (await service.getPhoiProgress('1'))[0].segments[0];
      expect(seg.reportedQty).toBe(100);
      expect(seg.done).toBe(97);
      expect(seg.failed).toBe(4);
      expect(seg.shortQty).toBe(3);
    });

    it('AC60: PI nhiều SKU, đợt cắt cũ 30 đoạn chưa gắn SKU -> dòng byOrder productionOrderId null với required 0, maxNow 0; số cần / maxNow tổng của cỡ chỉ tính theo SKU', async () => {
      const w = newWorld({
        orders: [
          { id: SKU_A, bomRevisionId: 5n, quantity: 1, floorStage: 'ACTIVE' },
          { id: SKU_B, bomRevisionId: 5n, quantity: 1, floorStage: 'ACTIVE' },
        ],
        issues: [issueRow()],
        cut: [{ qty: 30, order: null }],
      });
      const { service } = build(w);
      const seg = (await service.getPhoiProgress('1'))[0].segments[0];
      expect(seg.required).toBe(2360);
      expect(seg.maxNow).toBe(2360);
      const none = seg.byOrder.find((o) => o.productionOrderId === null)!;
      expect(none.required).toBe(0);
      expect(none.maxNow).toBe(0);
      expect(none.reportedQty).toBe(30);
      expect(seg.byOrder.filter((o) => o.productionOrderId !== null).map((o) => o.maxNow)).toEqual([
        1180, 1180,
      ]);
    });

    it('openQty / awaitingQcQty tách theo trạng thái đợt; PI không có lệnh nào -> rỗng', async () => {
      const w = newWorld({
        issues: [issueRow()],
        cut: [
          { qty: 5, order: SKU_A, status: CutBundleStatus.CUTTING },
          { qty: 3, order: SKU_A, status: CutBundleStatus.AWAITING_QC },
          { qty: 2, order: SKU_A, status: CutBundleStatus.QC_PASSED },
        ],
      });
      const { service } = build(w);
      const seg = (await service.getPhoiProgress('1'))[0].segments[0];
      expect(seg.openQty).toBe(5);
      expect(seg.awaitingQcQty).toBe(3);
      expect(seg.reportedQty).toBe(10);
      const empty = build(newWorld({ orders: [] }));
      await expect(empty.service.getPhoiProgress('1')).resolves.toEqual([]);
    });
  });

  describe('steelBalance (AC51)', () => {
    // 2 cây 6000, tề đầu 10 -> dùng được 11980mm. Cắt 355 + lưỡi 1 = 356mm / đoạn.
    const base = (over: Partial<World> = {}) =>
      newWorld({
        qtyPerPiece: 100,
        issues: [issueRow()],
        ...over,
      });

    it('thiếu sắt: cần 100 đoạn = 35600mm, còn sắt đã nhận 11980, không giữ chỗ -> shortMm 23620, issuableMm 0', async () => {
      const { service } = build(base());
      const b = (await service.getPhoiProgress('1'))[0].steelBalance!;
      expect(b.receivedBarCount).toBe(2);
      expect(b.usableMm).toBe(11980);
      expect(b.remainingSegments).toBe(100);
      expect(b.remainingNeedMm).toBe(35600);
      expect(b.leftoverReceivedMm).toBe(11980);
      expect(b.issuableMm).toBe(0);
      expect(b.shortMm).toBe(23620);
    });

    it('đủ sắt: có giữ chỗ còn xuất 5 cây x 6000 -> issuableMm 30000, shortMm 0', async () => {
      const { service } = build(
        base({
          reservations: [
            {
              productionInvoiceId: PI,
              materialId: MAT,
              quantity: decimal(5),
              consumedQty: decimal(0),
              stockLengthMm: 6000,
            },
          ],
        }),
      );
      const b = (await service.getPhoiProgress('1'))[0].steelBalance!;
      expect(b.issuableMm).toBe(30000);
      expect(b.shortMm).toBe(0);
    });

    it('issuableMm null khi không rõ chiều dài cây của phần còn giữ chỗ (không coi là 0)', async () => {
      const { service } = build(
        base({
          reservations: [
            {
              productionInvoiceId: PI,
              materialId: MAT,
              quantity: decimal(5),
              consumedQty: decimal(0),
              stockLengthMm: 0,
            },
          ],
        }),
      );
      const b = (await service.getPhoiProgress('1'))[0].steelBalance!;
      expect(b.issuableMm).toBeNull();
    });

    it('giữ chỗ đã dùng hết (consumed = quantity) không tính; không còn đoạn nào cần cắt -> shortMm 0', async () => {
      const { service } = build(
        base({
          cut: [{ qty: 100, order: SKU_A }],
          reservations: [
            {
              productionInvoiceId: PI,
              materialId: MAT,
              quantity: decimal(5),
              consumedQty: decimal(5),
              stockLengthMm: 6000,
            },
          ],
        }),
      );
      const b = (await service.getPhoiProgress('1'))[0].steelBalance!;
      expect(b.issuableMm).toBe(0);
      expect(b.remainingSegments).toBe(0);
      expect(b.remainingNeedMm).toBe(0);
      expect(b.shortMm).toBe(0);
    });

    it('KCS bỏ đoạn làm tăng phần cần cắt lại: Uốn bỏ 5 -> remainingSegments +5, recutSegments 5', async () => {
      const { service } = build(
        base({
          cut: [{ qty: 100, order: SKU_A }],
          step: [{ qty: 100, step: 'UON', order: SKU_A, bundleStatus: 'QC_PASSED' }],
          stepQc: [{ failed: 5, short: 0, scrap: 5, step: 'UON', order: SKU_A }],
        }),
      );
      const b = (await service.getPhoiProgress('1'))[0].steelBalance!;
      expect(b.remainingSegments).toBe(5);
      expect(b.recutSegments).toBe(5);
    });

    it('đợt xuất chưa nhận (ISSUED) không tính vào sắt đã nhận -> không có steelBalance', async () => {
      const { service } = build(base({ issues: [issueRow({ status: SteelIssueStatus.ISSUED })] }));
      const item = (await service.getPhoiProgress('1'))[0];
      expect(item.steelBalance).toBeNull();
    });
  });
});
