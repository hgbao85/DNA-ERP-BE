import { BadRequestException, Logger } from '@nestjs/common';
import { CutBundleStatus, ProcessStep, SteelIssueStatus } from '../../generated/prisma/client';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProductionBatchesService } from '../production-batches/production-batches.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { StockReservationsService } from '../stock/stock-reservations.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { SteelIssuesService } from '../steel-issues/steel-issues.service';
import { CutAllocationService } from './cut-allocation.service';
import { FloorScanService } from './floor-scan.service';

/**
 * UB13 (P1 "KCS tự chuyển", tester-unit #1) - màn quét chuyển NGUYÊN maxNow của tiến độ BE; số trên màn = số phép chặn nhận.
 * AC25 (báo đúng maxNow qua, maxNow + 1 bị chặn, CÙNG dữ liệu), AC26 (đã đủ / vượt: không số âm, còn 0), AC41 (myOutput.kcs),
 * lỗi QA [7] (PI 1 SKU, phiếu chấm cả lô kiểu cũ: màn "còn 10" và báo 10 phải qua).
 *
 * Khác spec của Dev (floor-scan.service.spec.ts): ở đó steelIssues là mock cố định số; ở đây SteelIssuesService là bản THẬT chạy
 * trên "sổ" bộ nhớ có trạng thái (đọc theo điều kiện where) nên số trên màn quét và phép chặn lúc báo đọc CÙNG 1 sổ, và báo xong thì
 * màn quét đọc lại thấy số mới. FloorScanService cũng là bản thật.
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

interface CutRow {
  qty: number;
  order: bigint | null;
  status?: CutBundleStatus;
}
interface CutQcRow {
  failed: number;
  short: number;
  order: bigint | null;
  /** Phiếu chấm cả lô kiểu cũ: cutBundleId NULL (chỉ gắn lô sắt). */
  oldStyle?: boolean;
}
interface StepRow {
  qty: number;
  step: string;
  order: bigint | null;
  bundleStatus: string | null;
}
interface StepQcRow {
  failed: number;
  short: number;
  scrap: number;
  step: string;
  order: bigint | null;
}
interface World {
  qtyPerPiece: number;
  processSteps: ProcessStep[];
  cut: CutRow[];
  cutQc: CutQcRow[];
  step: StepRow[];
  stepQc: StepQcRow[];
}

const newWorld = (over: Partial<World> = {}): World => ({
  qtyPerPiece: 1180,
  processSteps: [ProcessStep.CAT, ProcessStep.UON],
  cut: [],
  cutQc: [],
  step: [],
  stepQc: [],
  ...over,
});

/** Khoá skuScope: { OR: [{ productionOrderId: X }, ?{ productionOrderId: null }] }. */
function inScope(where: unknown, order: bigint | null): boolean {
  const w = where as { OR?: { productionOrderId: bigint | null }[] } | undefined;
  if (!w?.OR) return true;
  return w.OR.some((c) => c.productionOrderId === order);
}

type MockGroup = Record<string, jest.Mock>;

/** Prisma của SteelIssuesService THẬT (số cần / số đã tính / giới hạn vật lý đọc từ sổ `world`). */
function buildSteelPrisma(world: World) {
  let seq = 1000n;
  let lastStep: { id: bigint; qty: number } | null = null;
  const prisma: Record<string, MockGroup | jest.Mock> = {};
  prisma.$executeRaw = jest.fn().mockResolvedValue(0);
  prisma.$queryRaw = jest.fn((strings: TemplateStringsArray) => {
    const sql = strings.join('');
    if (sql.includes('production_orders')) return Promise.resolve([{ floorStage: 'ACTIVE' }]);
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
    findMany: jest.fn().mockResolvedValue([
      {
        productionInvoiceId: PI,
        materialId: MAT,
        barCount: 2,
        barLengthMm: 6000,
        status: SteelIssueStatus.RECEIVED,
        receivedBarCount: null,
        reworkOfId: null,
      },
    ]),
    update: jest.fn().mockResolvedValue({}),
  };
  prisma.floorReport = {
    create: jest.fn().mockImplementation(() => Promise.resolve({ id: ++seq })),
    findUnique: jest.fn().mockResolvedValue(null),
    findFirst: jest.fn().mockResolvedValue(null),
  };
  prisma.productionInvoice = {
    findUnique: jest.fn().mockResolvedValue({ id: PI, code: 'PI-1' }),
    findMany: jest.fn().mockResolvedValue([{ id: PI, code: 'PI-1' }]),
  };
  prisma.auditLog = { create: jest.fn().mockResolvedValue({}) };
  prisma.productionOrder = {
    findMany: jest.fn().mockImplementation(() =>
      Promise.resolve([
        {
          id: SKU_A,
          bomRevisionId: 5n,
          quantity: 1,
          floorStage: 'ACTIVE',
          productionInvoiceItem: { productionInvoiceId: PI },
        },
      ]),
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
      Promise.resolve([
        {
          bomRevisionId: 5n,
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
        },
      ]),
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
    count: jest.fn().mockResolvedValue(1),
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
        // Truy vấn đòi phiếu có đợt cắt (cutBundle / cutBundleId khác null) thì phiếu cũ cả lô KHÔNG lọt vào - như DB thật.
        const needsBundle = 'cutBundle' in qr || qr.cutBundleId != null;
        return Promise.resolve(
          world.cutQc
            .filter((r) => !(needsBundle && r.oldStyle))
            .filter((r) => r.oldStyle || inScope(qr.cutBundle, r.order))
            .map((r) => ({
              segmentSpecId: SPEC,
              failedQty: r.failed,
              shortQty: r.short,
              qcReview: {
                steelIssue: { productionInvoiceId: PI },
                cutBundle: r.oldStyle ? null : { productionOrderId: r.order },
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
        return Promise.resolve({ id: 1n });
      },
    ),
    findUnique: jest.fn().mockResolvedValue({
      id: 1n,
      steelIssueId: 100n,
      proposalPatternId: null,
      barCount: 0,
      mauNguyenMm: 0,
      scrapMm: 0,
      status: CutBundleStatus.CUTTING,
      completedSteps: [ProcessStep.CAT],
      completedAt: null,
      createdAt: new Date('2026-09-05T00:00:00.000Z'),
      segments: [],
      productionOrderId: null,
      steelIssue: { productionInvoiceId: PI, materialId: MAT },
    }),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    update: jest.fn(),
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
  };
  prisma.stepBatch = {
    create: jest.fn().mockImplementation(
      (a: {
        data: {
          productionOrderId: bigint;
          step: string;
          segments: { create: { segmentSpecId: bigint; qty: number }[] };
        };
      }) => {
        for (const s of a.data.segments.create) {
          world.step.push({
            qty: s.qty,
            step: a.data.step,
            order: a.data.productionOrderId,
            bundleStatus: null,
          });
          lastStep = { id: ++seq, qty: s.qty };
        }
        return Promise.resolve({ id: lastStep?.id ?? ++seq });
      },
    ),
    findUniqueOrThrow: jest.fn().mockImplementation(() =>
      Promise.resolve({
        id: lastStep?.id ?? 900n,
        step: ProcessStep.UON,
        segments: [
          {
            segmentSpecId: SPEC,
            qty: lastStep?.qty ?? 0,
            segmentSpec: { cutLengthMm: decimal(355) },
          },
        ],
      }),
    ),
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  prisma.stepBundle = { findUnique: jest.fn(), updateMany: jest.fn() };
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
  prisma.stockReservation = { findMany: jest.fn().mockResolvedValue([]) };
  return prisma;
}

const worker: AuthenticatedUser = {
  id: 'cn-1',
  username: 'phoi.a',
  email: null,
  roles: ['FLOOR_WORKER'],
  permissions: [],
  mfgRole: 'PHOI',
  warehouseScope: 'phoi-son-han',
};

/** FloorScanService thật + SteelIssuesService thật trên cùng 1 sổ. `kind` = loại máy đang quét. */
function build(world: World, kind: 'CUT' | 'STEP') {
  const steelPrisma = buildSteelPrisma(world);
  const steelIssues = new SteelIssuesService(
    steelPrisma as unknown as PrismaServiceType,
    {} as unknown as StockLedgerService,
    {} as unknown as StockReservationsService,
    {
      emit: jest.fn().mockResolvedValue(undefined),
      resolve: jest.fn().mockResolvedValue(undefined),
    } as unknown as NotificationsService,
    {
      publishEntityChanged: jest.fn(),
      publishNotificationCreated: jest.fn(),
    } as unknown as RealtimeService,
  );
  const machine = {
    id: 1n,
    code: kind === 'CUT' ? 'LASER-01' : 'UON-01',
    name: 'Máy',
    stage: 'PHOI',
    kind,
    processStep: kind === 'STEP' ? 'UON' : null,
    qrToken: 'tok',
    isActive: true,
  };
  const scanPrisma = {
    workstation: { findUnique: jest.fn().mockResolvedValue(machine) },
    floorQueueEntry: {
      findMany: jest.fn().mockResolvedValue([
        {
          status: 'RUNNING',
          productionInvoiceId: PI,
          productionInvoice: { code: 'PI-1' },
        },
      ]),
    },
    warehouse: { findUnique: jest.fn().mockResolvedValue({ workshopId: 1n }) },
    workshop: { findFirst: jest.fn().mockResolvedValue({ id: 1n }) },
    productionOrder: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: SKU_A,
          poNumber: 'PO-1',
          quantity: 1,
          floorStage: 'ACTIVE',
          mfgProduct: { name: 'SP-1', factoryCode: 'SKU-1' },
        },
      ]),
      findFirst: jest.fn().mockResolvedValue({ id: SKU_A }),
    },
    productionInvoice: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: PI, code: 'PI-1' }),
    },
    productionBatch: { groupBy: jest.fn().mockResolvedValue([]) },
    steelIssue: {
      // pickCutTargetIssue: 1 lần giao đã nhận (id 100), chưa có đợt cắt đang mở của người báo
      findMany: jest.fn().mockResolvedValue([{ id: 100n, bundles: [] }]),
      groupBy: jest.fn().mockResolvedValue([{ materialId: MAT, _count: { _all: 1 } }]),
    },
    floorReport: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const productionBatches = {
    getBatchPlanBatch: jest.fn().mockResolvedValue({}),
    recordProductionBatch: jest.fn(),
  };
  const cutAllocation = {
    getMachineWork: jest.fn().mockResolvedValue({ rows: [] }),
    getWorkshopAllocationPis: jest.fn().mockResolvedValue([]),
  };
  const service = new FloorScanService(
    scanPrisma as unknown as PrismaServiceType,
    steelIssues,
    productionBatches as unknown as ProductionBatchesService,
    cutAllocation as unknown as CutAllocationService,
  );
  return { service, scanPrisma, steelPrisma, productionBatches };
}

type Built = ReturnType<typeof build>;
type SegmentCtx = {
  required: number;
  baseRequired: number;
  extraNeed: number;
  done: number;
  failed: number;
  shortQty: number;
  reportedQty: number;
  maxNow: number;
  physicalLeft: number | null;
  byOrder: Array<{ maxNow: number; done: number; required: number }>;
};

/** Mở màn quét và lấy dòng cỡ 355mm của loại sắt duy nhất - đúng số công nhân thấy trên màn. */
async function screenSegment(b: Built): Promise<SegmentCtx> {
  const ctx = (await b.service.getContext('tok', worker)) as {
    pi: { materials: Array<{ segments: SegmentCtx[] }> };
  };
  return ctx.pi.materials[0].segments[0];
}

const reportDto = (qty: number) => ({
  productionInvoiceId: '1',
  productionOrderId: '1',
  materialId: '30',
  segments: [{ segmentSpecId: '30', qty }],
});

async function errOf(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error('Lẽ ra phải ném lỗi');
}

describe('UB13 floor-scan: số trên màn quét = số phép chặn nhận (QA)', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  describe('AC25: báo đúng maxNow trên màn thì qua, maxNow + 1 bị chặn (cùng dữ liệu)', () => {
    it('AC25 Cắt: cần 1180 + 5 cắt lại, đã tính 1175 -> màn "còn 10"; báo 11 bị chặn 400, báo 10 qua; mở lại màn thấy 0 và báo thêm 1 bị chặn', async () => {
      const w = newWorld({
        cut: [{ qty: 1175, order: SKU_A }],
        stepQc: [{ failed: 5, short: 0, scrap: 5, step: 'UON', order: SKU_A }],
      });
      const b = build(w, 'CUT');
      const seg = await screenSegment(b);
      expect(seg.maxNow).toBe(10);
      expect(seg.byOrder[0].maxNow).toBe(10); // cấp SKU cùng số với cấp cỡ (PI 1 SKU)

      const err = await errOf(b.service.report('tok', worker, reportDto(seg.maxNow + 1), 'k-1'));
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toContain('tối đa 10');
      expect(w.cut).toHaveLength(1); // báo bị chặn không ghi gì
      await expect(
        b.service.report('tok', worker, reportDto(seg.maxNow), 'k-2'),
      ).resolves.toMatchObject({ kind: 'CUT' });

      const after = await screenSegment(b);
      expect(after.maxNow).toBe(0);
      await expect(b.service.report('tok', worker, reportDto(1), 'k-3')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('AC25 Uốn: số cần còn 8, vật lý còn 3 -> màn "còn 3" (physicalLeft 3 đi kèm); báo 4 bị chặn, báo 3 qua', async () => {
      const w = newWorld({
        cut: [{ qty: 1180, order: SKU_A }],
        step: [{ qty: 1180, step: 'UON', order: SKU_A, bundleStatus: 'QC_PASSED' }],
        stepQc: [{ failed: 8, short: 0, scrap: 5, step: 'UON', order: SKU_A }],
      });
      const b = build(w, 'STEP');
      const seg = await screenSegment(b);
      expect(seg.maxNow).toBe(3);
      expect(seg.physicalLeft).toBe(3);

      const err = await errOf(b.service.report('tok', worker, reportDto(seg.maxNow + 1), 'k-1'));
      expect(err).toBeInstanceOf(BadRequestException);
      // câu chặn vế vật lý chỉ chỗ gỡ: báo cắt thêm 1 đoạn 355mm
      expect(err.message).toContain('báo cắt thêm 1 đoạn 355mm');
      await expect(
        b.service.report('tok', worker, reportDto(seg.maxNow), 'k-2'),
      ).resolves.toMatchObject({ kind: 'STEP' });
      expect((await screenSegment(b)).maxNow).toBe(0);
    });

    it('AC25 biên: đã báo đủ cần (1180 / 1180, không có lỗi) -> màn "còn 0", báo 1 bị chặn; chưa báo gì -> màn "còn 1180", báo 1181 bị chặn, 1180 qua', async () => {
      const full = build(newWorld({ cut: [{ qty: 1180, order: SKU_A }] }), 'CUT');
      expect((await screenSegment(full)).maxNow).toBe(0);
      await expect(full.service.report('tok', worker, reportDto(1), 'k-1')).rejects.toThrow(
        BadRequestException,
      );

      const empty = build(newWorld(), 'CUT');
      const seg = await screenSegment(empty);
      expect(seg.maxNow).toBe(1180);
      await expect(
        empty.service.report('tok', worker, reportDto(seg.maxNow + 1), 'k-1'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        empty.service.report('tok', worker, reportDto(seg.maxNow), 'k-2'),
      ).resolves.toBeDefined();
    });

    it('AC25: KCS ghi thiếu 5 ở Cắt (đã cắt 1180) -> màn Cắt "còn 5" (thiếu phải cắt bù); màn Uốn bị chặn vật lý còn 0 dù số cần còn nhiều', async () => {
      const w = newWorld({
        cut: [{ qty: 1180, order: SKU_A }],
        cutQc: [{ failed: 0, short: 5, order: SKU_A }],
        step: [{ qty: 1175, step: 'UON', order: SKU_A, bundleStatus: 'QC_PASSED' }],
      });
      const cut = await screenSegment(build(w, 'CUT'));
      expect(cut.maxNow).toBe(5);
      const uon = build(w, 'STEP');
      const seg = await screenSegment(uon);
      // cần 1180, đã tính 1175 -> số cần còn 5; vật lý: cắt thực có 1175, Uốn đã dùng 1175 -> 0. Vế nhỏ hơn thắng.
      expect(seg.maxNow).toBe(0);
      await expect(uon.service.report('tok', worker, reportDto(1), 'k-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('AC26: đã đủ / vượt từ trước deploy - không số âm, còn 0', () => {
    it('AC26 Cắt: đã cắt 1190 trên số cần 1180 -> màn: cần 1180, đã tính 1190 (vượt 10), còn 0, KHÔNG số âm ở trường nào; báo thêm 1 nhận 400 "tối đa 0"', async () => {
      const b = build(newWorld({ cut: [{ qty: 1190, order: SKU_A }] }), 'CUT');
      const seg = await screenSegment(b);
      expect(seg).toMatchObject({ required: 1180, reportedQty: 1190, maxNow: 0 });
      // FE tự suy "vượt N" = đã tính - cần: số đã tính phải là 1190 (không bị kẹp về 1180) thì mới ra đúng 10
      expect(seg.done - seg.required).toBe(10);
      for (const v of [
        seg.required,
        seg.baseRequired,
        seg.extraNeed,
        seg.done,
        seg.failed,
        seg.shortQty,
        seg.reportedQty,
        seg.maxNow,
        seg.byOrder[0].maxNow,
        seg.byOrder[0].done,
        seg.byOrder[0].required,
      ]) {
        expect(v).toBeGreaterThanOrEqual(0);
      }
      const err = await errOf(b.service.report('tok', worker, reportDto(1), 'k-1'));
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toContain('tối đa 0');
      expect(err.message).not.toMatch(/tối đa -\d/);
    });

    it('AC26 Uốn: đã làm 1190 / cần 1180 (cắt 1190) -> còn 0, vượt 10, không số âm; báo thêm bị chặn', async () => {
      const b = build(
        newWorld({
          cut: [{ qty: 1190, order: SKU_A }],
          step: [{ qty: 1190, step: 'UON', order: SKU_A, bundleStatus: 'QC_PASSED' }],
        }),
        'STEP',
      );
      const seg = await screenSegment(b);
      expect(seg).toMatchObject({ required: 1180, maxNow: 0 });
      expect(seg.done - seg.required).toBe(10);
      for (const v of [seg.required, seg.done, seg.maxNow, seg.byOrder[0].maxNow]) {
        expect(v).toBeGreaterThanOrEqual(0);
      }
      await expect(b.service.report('tok', worker, reportDto(1), 'k-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('AC26 mảnh Hàn / Sơn: đã tính vượt kế hoạch (12 / 10) hoặc chờ + đang mở vượt -> maxNow 0, không âm; vừa đủ ranh giới còn 1', async () => {
      const b = build(newWorld(), 'CUT');
      b.scanPrisma.workstation.findUnique.mockResolvedValue({
        id: 8n,
        code: 'HAN-01',
        name: 'Hàn',
        stage: 'HAN',
        kind: 'PIECE',
        processStep: null,
        qrToken: 'tok',
        isActive: true,
        workshopId: 1n,
      });
      b.scanPrisma.floorQueueEntry.findMany.mockResolvedValue([
        { status: 'RUNNING', productionInvoiceId: PI, productionInvoice: { code: 'PI-1' } },
      ]);
      const item = (pieceId: string, over: Record<string, number>) => ({
        pieceId,
        pieceCode: `M${pieceId}`,
        plannedQty: 10,
        passedQty: 0,
        awaitingQcQty: 0,
        ...over,
      });
      b.productionBatches.getBatchPlanBatch.mockResolvedValue({
        '1': {
          items: [
            item('1', { passedQty: 12 }), // vượt từ trước
            item('2', { passedQty: 4, awaitingQcQty: 2 }), // + đang mở 4 = 10 -> 0
            item('3', { passedQty: 4, awaitingQcQty: 2 }), // + đang mở 3 -> 1
            item('4', { passedQty: 8, awaitingQcQty: 3 }), // 11 > 10, đang mở 0 -> 0 không âm
          ],
        },
      });
      b.scanPrisma.productionBatch.groupBy.mockResolvedValue([
        { productionOrderId: SKU_A, pieceId: 2n, _sum: { reportedQty: 4 } },
        { productionOrderId: SKU_A, pieceId: 3n, _sum: { reportedQty: 3 } },
      ]);
      const ctx = (await b.service.getContext('tok', { ...worker, mfgRole: 'HAN' })) as {
        pi: { piecePlans: Record<string, { items: { pieceId: string; maxNow: number }[] }> };
      };
      expect(ctx.pi.piecePlans['1'].items.map((i) => [i.pieceId, i.maxNow])).toEqual([
        ['1', 0],
        ['2', 0],
        ['3', 1],
        ['4', 0],
      ]);
    });
  });

  describe('lỗi QA [7]: PI 1 SKU, phiếu chấm cả lô kiểu cũ (cutBundleId NULL) lỗi 10', () => {
    it('[7] đã cắt 1180, phiếu cũ lỗi 10 -> màn "còn 10" (đã tính 1170); báo 10 phải qua (không bị chặn "tối đa 0"), báo 11 bị chặn', async () => {
      const w = newWorld({
        cut: [{ qty: 1180, order: SKU_A }],
        cutQc: [{ failed: 10, short: 0, order: null, oldStyle: true }],
      });
      const b = build(w, 'CUT');
      const seg = await screenSegment(b);
      expect(seg.maxNow).toBe(10);
      expect(seg.failed).toBe(10);
      expect(seg.done).toBe(1170);

      const tooMany = await errOf(
        b.service.report('tok', worker, reportDto(seg.maxNow + 1), 'k-1'),
      );
      expect(tooMany).toBeInstanceOf(BadRequestException);
      expect(tooMany.message).toContain('tối đa 10');
      await expect(
        b.service.report('tok', worker, reportDto(seg.maxNow), 'k-2'),
      ).resolves.toMatchObject({ kind: 'CUT' });
      expect((await screenSegment(b)).maxNow).toBe(0);
    });

    it('[7] phiếu cũ cả lô + thiếu 4: màn Cắt "còn 14" = báo 14 qua, 15 bị chặn (thiếu cũng phải cắt bù, cùng 1 nguồn số)', async () => {
      const w = newWorld({
        cut: [{ qty: 1180, order: SKU_A }],
        cutQc: [{ failed: 10, short: 4, order: null, oldStyle: true }],
      });
      const b = build(w, 'CUT');
      const seg = await screenSegment(b);
      expect(seg.maxNow).toBe(14);
      await expect(b.service.report('tok', worker, reportDto(15), 'k-1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(b.service.report('tok', worker, reportDto(14), 'k-2')).resolves.toBeDefined();
    });

    it('[7] không lẫn với phiếu có đợt: phiếu cũ lỗi 10 + phiếu mới (có đợt) lỗi 5 cùng SKU -> màn còn 15, báo 15 qua', async () => {
      const w = newWorld({
        cut: [{ qty: 1180, order: SKU_A }],
        cutQc: [
          { failed: 10, short: 0, order: null, oldStyle: true },
          { failed: 5, short: 0, order: SKU_A },
        ],
      });
      const b = build(w, 'CUT');
      const seg = await screenSegment(b);
      expect(seg.maxNow).toBe(15);
      await expect(b.service.report('tok', worker, reportDto(16), 'k-1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(b.service.report('tok', worker, reportDto(15), 'k-2')).resolves.toBeDefined();
    });
  });
});

// ─── AC41: Sản lượng của tôi - nhãn KCS theo đợt ───────────────────────────────────────────────

describe('UB13 floor-scan.myOutput: kcs của lần báo (AC41, QA)', () => {
  const at = new Date('2026-11-18T03:00:00Z');
  type Review = { failedQty: number; shortQty: number };
  const row = (id: bigint, o: Record<string, unknown>) => ({
    id,
    kind: 'CUT',
    createdAt: at,
    productionInvoice: null,
    workstation: { code: 'LASER-01', name: 'Máy laser 1' },
    lines: [],
    reversedBy: null,
    cutBundle: null,
    stepBatch: null,
    productionBatch: null,
    ...o,
  });
  const cutBundle = (status: string, qcReviews: Review[] = []) => ({
    status,
    qcReviews,
    steelIssue: { productionInvoice: { code: 'PI-45' } },
  });

  function buildOut(rows: unknown[]) {
    const prisma = { floorReport: { findMany: jest.fn().mockResolvedValue(rows) } };
    const service = new FloorScanService(
      prisma as unknown as PrismaServiceType,
      {} as unknown as SteelIssuesService,
      {} as unknown as ProductionBatchesService,
      {} as unknown as CutAllocationService,
    );
    return { service, prisma };
  }

  it('AC41: A có 1 đợt cắt đã chấm (thiếu 5, lỗi 3) với 2 lần báo + 1 đợt đang mở -> 2 lần báo của đợt đã chấm cùng nhãn kcs { failedQty 3, shortQty 5 }, lần báo đợt mở kcs null', async () => {
    const graded = cutBundle('QC_PASSED', [{ failedQty: 3, shortQty: 5 }]);
    const { service } = buildOut([
      row(3n, { cutBundle: cutBundle('CUTTING') }),
      row(2n, { cutBundle: graded }),
      row(1n, { cutBundle: graded }),
    ]);
    const out = await service.myOutput('cn-1');
    expect(out.map((r) => [r.id, r.state, r.kcs])).toEqual([
      ['3', 'OPEN', null],
      ['2', 'QC_DONE', { failedQty: 3, shortQty: 5 }],
      ['1', 'QC_DONE', { failedQty: 3, shortQty: 5 }],
    ]);
  });

  it('AC41 biên: đã chấm đạt hết (lỗi 0, thiếu 0) -> kcs { 0, 0 } (có phiếu chấm), KHÁC null (chưa chấm)', async () => {
    const { service } = buildOut([
      row(1n, { cutBundle: cutBundle('QC_PASSED', [{ failedQty: 0, shortQty: 0 }]) }),
    ]);
    const [r] = await service.myOutput('cn-1');
    expect(r.kcs).toEqual({ failedQty: 0, shortQty: 0 });
  });

  it('AC41: chỉ lấy lần báo CỦA MÌNH, không lấy lần hủy (reversalOfId null), đúng khoảng ngày; số lỗi / thiếu không lẫn của người khác', async () => {
    const { service, prisma } = buildOut([]);
    await service.myOutput('cn-1', '2026-11-10', '2026-11-18');
    const where = (prisma.floorReport.findMany.mock.calls as unknown[][])[0][0] as {
      where: { reportedById: string; reversalOfId: null; createdAt: { gte: Date; lte: Date } };
    };
    expect(where.where.reportedById).toBe('cn-1');
    expect(where.where.reversalOfId).toBeNull();
    expect(where.where.createdAt.gte).toEqual(new Date('2026-11-10'));
    expect(where.where.createdAt.lte).toEqual(new Date('2026-11-18'));
  });

  it('AC41: cắt đã chốt chờ chấm (AWAITING_QC) và công đoạn phụ đang chờ chấm đều "Chờ kiểm hàng" = kcs null, kể cả khi đã có phiếu nháp', async () => {
    const { service } = buildOut([
      row(1n, { cutBundle: cutBundle('AWAITING_QC', [{ failedQty: 2, shortQty: 2 }]) }),
      row(2n, {
        kind: 'STEP',
        stepBatch: {
          step: 'UON',
          stepBundle: { status: 'AWAITING_QC', qcReviews: [{ failedQty: 1, shortQty: 1 }] },
          productionInvoice: { code: 'PI-46' },
        },
      }),
    ]);
    const out = await service.myOutput('cn-1');
    expect(out.map((r) => r.kcs)).toEqual([null, null]);
    expect(out.map((r) => r.state)).toEqual(['AWAITING_QC', 'AWAITING_QC']);
  });

  it('AC41: nhiều phiếu chấm của 1 đợt (chấm làm 2 lần) -> cộng lỗi và thiếu của cả đợt', async () => {
    const { service } = buildOut([
      row(1n, {
        cutBundle: cutBundle('QC_PASSED', [
          { failedQty: 1, shortQty: 2 },
          { failedQty: 2, shortQty: 3 },
        ]),
      }),
    ]);
    const [r] = await service.myOutput('cn-1');
    expect(r.kcs).toEqual({ failedQty: 3, shortQty: 5 });
  });
});
