import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import {
  CutBundleStatus,
  FloorReportKind,
  ProcessStep,
  SteelIssueStatus,
} from '../../generated/prisma/client';
import { FLOOR_REPORT_REVERSED_REPLAY_MESSAGE } from '../../common/utils/floor-report.util';
import {
  IdempotencyKeyInUseException,
  IdempotencyKeyReusedException,
} from '../../common/utils/idempotency.util';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { StockReservationsService } from '../stock/stock-reservations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { SteelIssuesService } from './steel-issues.service';

/**
 * UB2 (QA, P1-T3-U1) - báo cắt / công đoạn bị chặn vượt, X3, gán SKU, gửi lại sau hủy.
 * AC19, AC21, AC26, AC33, AC42, AC53 + luật khoá (cut-cap trước cut-report; step-batch trước FOR UPDATE production_orders).
 *
 * Khác spec của dev: "sổ" dữ liệu là bộ nhớ có trạng thái (lần ghi trước hiện ra ở lần đọc sau, đọc theo ĐIỀU KIỆN where chứ
 * không theo thứ tự gọi), nên test nói về hành vi: báo 10 xong thì báo thêm 1 bị chặn, v.v.
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

interface CutRow {
  spec: bigint;
  qty: number;
  order: bigint | null;
}
interface CutQcRow {
  spec: bigint;
  failed: number;
  short: number;
  order: bigint | null;
}
interface StepRow {
  spec: bigint;
  qty: number;
  step: string;
  order: bigint | null;
}
interface StepQcRow {
  spec: bigint;
  failed: number;
  short: number;
  scrap: number;
  step: string;
  order: bigint | null;
}

const PI = 1n;
const MAT = 30n;
const SPEC = 30n;
const SKU_A = 1n;
const SKU_B = 2n;

/** Số liệu sổ của 1 PI (đọc bởi loadNeedIndex qua các findMany). */
interface World {
  orders: { id: bigint; bomRevisionId: bigint; quantity: number; floorStage: 'ACTIVE' }[];
  /** qtyPerPiece x qtyPerUnit mỗi SKU = need cỡ 30 (đã cho quantity = 1 nên need = qtyPerPiece). */
  qtyPerPiece: number;
  processSteps: ProcessStep[];
  cut: CutRow[];
  cutQc: CutQcRow[];
  step: StepRow[];
  stepQc: StepQcRow[];
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
    ...over,
  };
}

/** Lọc dòng theo điều kiện skuScope: { OR: [{ productionOrderId: X }, ?{ productionOrderId: null }] }. */
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
  auditLog: MockGroup;
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
}

function build(world: World) {
  const idemp = new Map<
    string,
    { kind: FloorReportKind; cutBundleId: bigint | null; stepBatchId: bigint | null }
  >();
  let seq = 1000n;
  const prisma = {} as FakePrisma;
  prisma.$executeRaw = jest.fn().mockResolvedValue(0);
  prisma.$queryRaw = jest.fn((strings: TemplateStringsArray) => {
    const sql = strings.join('');
    if (sql.includes('production_orders')) return Promise.resolve([{ floorStage: 'ACTIVE' }]);
    if (sql.includes('cut_bundles') && sql.includes('openedById')) return Promise.resolve([]);
    if (sql.includes('cut_bundles'))
      return Promise.resolve([{ status: CutBundleStatus.CUTTING, productionOrderId: null }]);
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
  };
  prisma.floorReport = {
    create: jest
      .fn()
      .mockImplementation(
        (args: { data: { idempotencyKey: string | null; kind: FloorReportKind } }) => {
          if (args.data.idempotencyKey)
            idemp.set(args.data.idempotencyKey, {
              kind: args.data.kind,
              cutBundleId: 1n,
              stepBatchId: 1n,
            });
          return Promise.resolve({ id: ++seq });
        },
      ),
    findUnique: jest
      .fn()
      .mockImplementation((args: { where: { idempotencyKey: string } }) =>
        Promise.resolve(idemp.get(args.where.idempotencyKey) ?? null),
      ),
    findFirst: jest.fn().mockResolvedValue(null),
  };
  prisma.productionInvoice = {
    findUnique: jest.fn().mockResolvedValue({ id: PI, code: 'PI-1' }),
    findMany: jest.fn().mockResolvedValue([{ id: PI, code: 'PI-1' }]),
  };
  prisma.auditLog = { create: jest.fn().mockResolvedValue({}) };
  prisma.productionOrder = {
    findMany: jest.fn().mockImplementation(() => Promise.resolve(world.orders)),
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
    findMany: jest
      .fn()
      .mockImplementation((a: { where: { cutBundle?: unknown; cutBundleId?: bigint } }) => {
        if (a.where.cutBundleId !== undefined) return Promise.resolve([]);
        return Promise.resolve(
          world.cut
            .filter((r) => inScope((a.where.cutBundle as { OR?: unknown }) ?? undefined, r.order))
            .map((r) => ({
              segmentSpecId: r.spec,
              qty: r.qty,
              cutBundle: { productionOrderId: r.order },
            })),
        );
      }),
    upsert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn().mockResolvedValue(1),
  };
  prisma.qcReviewSegment = {
    findMany: jest
      .fn()
      .mockImplementation((a: { where: { qcReview?: Record<string, unknown> } }) => {
        const qr = a.where.qcReview ?? {};
        // Phiếu chấm Cắt: từ lỗi QA [5]/[7] (19/11) loadNeedIndex lọc theo lô sắt (`steelIssue`, `stepBundleId: null`) như
        // loadPhoiInputs, không lọc theo đợt cắt / SKU nữa - SKU gán ở buildPhoiNeedIndex. Giữ nhánh `cutBundle` cho truy vấn khác.
        if ('steelIssue' in qr || 'cutBundle' in qr) {
          return Promise.resolve(
            world.cutQc
              .filter((r) => !('cutBundle' in qr) || inScope(qr.cutBundle, r.order))
              .map((r) => ({
                segmentSpecId: r.spec,
                failedQty: r.failed,
                shortQty: r.short,
                qcReview: { cutBundle: { productionOrderId: r.order } },
              })),
          );
        }
        if ('stepBundle' in qr) {
          const sb = qr.stepBundle as { OR?: unknown };
          return Promise.resolve(
            world.stepQc
              .filter((r) => inScope(sb, r.order))
              .map((r) => ({
                segmentSpecId: r.spec,
                failedQty: r.failed,
                shortQty: r.short,
                scrapQty: r.scrap,
                qcReview: { stepBundle: { productionOrderId: r.order, step: r.step } },
              })),
          );
        }
        return Promise.resolve([]);
      }),
  };
  prisma.stepBatchSegment = {
    findMany: jest.fn().mockImplementation((a: { where: { stepBatch?: { OR?: unknown } } }) =>
      Promise.resolve(
        world.step
          .filter((r) => inScope(a.where.stepBatch, r.order))
          .map((r) => ({
            segmentSpecId: r.spec,
            qty: r.qty,
            stepBatch: { productionOrderId: r.order, step: r.step },
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
          world.cut.push({ spec: s.segmentSpecId, qty: s.qty, order: a.data.productionOrderId });
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
        for (const s of a.data.segments.create)
          world.step.push({
            spec: s.segmentSpecId,
            qty: s.qty,
            step: a.data.step,
            order: a.data.productionOrderId,
          });
        return Promise.resolve({ id: ++seq });
      },
    ),
    findUniqueOrThrow: jest.fn().mockResolvedValue({
      id: 900n,
      step: ProcessStep.UON,
      segments: [{ segmentSpecId: SPEC, qty: 1, segmentSpec: { cutLengthMm: decimal(355) } }],
    }),
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  prisma.stepBundle = {
    findUnique: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };

  const service = new SteelIssuesService(
    prisma as unknown as PrismaServiceType,
    {} as unknown as StockLedgerService,
    {} as unknown as StockReservationsService,
    { emit: jest.fn(), resolve: jest.fn() } as unknown as NotificationsService,
    {
      publishEntityChanged: jest.fn(),
      publishNotificationCreated: jest.fn(),
    } as unknown as RealtimeService,
  );
  return { prisma, service };
}

const cutDto = (qty: number, order = '1') => ({
  productionOrderId: order,
  segments: [{ segmentSpecId: SPEC.toString(), qty }],
});
const stepDto = (qty: number, step: ProcessStep = ProcessStep.UON) => ({
  productionOrderId: '1',
  materialId: MAT.toString(),
  step,
  segments: [{ segmentSpecId: SPEC.toString(), qty }],
});

async function errOf(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error('Lẽ ra phải ném lỗi');
}

describe('UB2 steel-issues chặn báo vượt / X3 / gán SKU / gửi lại (QA)', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  describe('AC19: báo CẮT vượt số cần', () => {
    it('AC19: cần 1180, đã báo 1180, KCS lỗi 10 -> báo 10 lưu được, rồi báo thêm 1 nhận 400 đủ cần / đã tính / tối đa / bạn nhập, không ghi gì mới, 1 dòng logger.warn', async () => {
      const w = newWorld({
        cut: [{ spec: SPEC, qty: 1180, order: SKU_A }],
        cutQc: [{ spec: SPEC, failed: 10, short: 0, order: SKU_A }],
      });
      const { prisma, service } = build(w);

      await expect(service.recordCutBatch('100', cutDto(10), 'cn-1')).resolves.toBeDefined();
      expect(prisma.cutBundle.create).toHaveBeenCalledTimes(1);
      expect(prisma.floorReport.create).toHaveBeenCalledTimes(1);
      expect(warn).not.toHaveBeenCalled();

      const err = await errOf(service.recordCutBatch('100', cutDto(1), 'cn-1'));
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toContain('cần 1180');
      expect(err.message).toContain('đã tính 1180');
      expect(err.message).toContain('tối đa 0');
      expect(err.message).toContain('bạn nhập 1');
      expect(err.message).toContain('Số cần sai thì báo QLSX.');
      // không ghi thêm gì
      expect(prisma.cutBundle.create).toHaveBeenCalledTimes(1);
      expect(prisma.floorReport.create).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String((warn.mock.calls as unknown[][])[0][0]);
      expect(line).toMatch(/PI 1/);
      expect(line).toMatch(/SKU-1/);
      expect(line).toMatch(/355mm/);
      expect(line).toMatch(/cần 1180/);
      expect(line).toMatch(/đã tính 1180/);
      expect(line).toMatch(/số nhập 1/);
    });

    it('AC19: báo ĐÚNG phần còn lại thì qua, hơn 1 thì chặn (biên maxNow / maxNow+1)', async () => {
      const w = newWorld({ cut: [{ spec: SPEC, qty: 1175, order: SKU_A }] });
      const { service } = build(w);
      await expect(service.recordCutBatch('100', cutDto(6), 'cn-1')).rejects.toThrow('tối đa 5');
      await expect(service.recordCutBatch('100', cutDto(5), 'cn-1')).resolves.toBeDefined();
    });

    it('AC26: dòng đã báo vượt từ trước deploy (cắt 1190 / cần 1180) -> báo thêm 1 bị chặn, câu không có số âm', async () => {
      const w = newWorld({ cut: [{ spec: SPEC, qty: 1190, order: SKU_A }] });
      const { service } = build(w);
      const err = await errOf(service.recordCutBatch('100', cutDto(1), 'cn-1'));
      expect(err.message).toContain('tối đa 0');
      expect(err.message).not.toMatch(/tối đa -\d/);
    });

    it('biên: số nhập 0 không bị chặn kể cả khi đã đủ', async () => {
      // 0 không qua được DTO thật (Min 1) nhưng hàm không được ném lỗi chặn vượt vì chuyện đó
      const w = newWorld({ cut: [{ spec: SPEC, qty: 1180, order: SKU_A }] });
      const { service } = build(w);
      await expect(service.recordCutBatch('100', cutDto(0), 'cn-1')).resolves.toBeDefined();
    });

    it('AC60: PI nhiều SKU còn đợt cắt cũ chưa gắn SKU 30 đoạn -> báo cắt SKU A không bị chặn theo phần đó (vẫn tối đa 1180)', async () => {
      const w = newWorld({
        orders: [
          { id: SKU_A, bomRevisionId: 5n, quantity: 1, floorStage: 'ACTIVE' },
          { id: SKU_B, bomRevisionId: 5n, quantity: 1, floorStage: 'ACTIVE' },
        ],
        cut: [{ spec: SPEC, qty: 30, order: null }],
      });
      const { service } = build(w);
      await expect(service.recordCutBatch('100', cutDto(1180), 'cn-1')).resolves.toBeDefined();
      await expect(service.recordCutBatch('100', cutDto(1), 'cn-1')).rejects.toThrow('tối đa 0');
    });

    it('PI 1 SKU: đợt cũ chưa gắn SKU tính cho SKU duy nhất (còn 1150 chứ không phải 1180)', async () => {
      const w = newWorld({ cut: [{ spec: SPEC, qty: 30, order: null }] });
      const { service } = build(w);
      await expect(service.recordCutBatch('100', cutDto(1151), 'cn-1')).rejects.toThrow(
        'tối đa 1150',
      );
    });

    it('luật khoá: cut-cap lấy TRƯỚC cut-report; mọi lần lấy khoá nằm trước câu FOR UPDATE đợt', async () => {
      const { prisma, service } = build(newWorld());
      await service.recordCutBatch('100', cutDto(1), 'cn-1');
      const keys = prisma.$executeRaw.mock.calls.map((c: unknown[]) => String(c[1]));
      expect(keys.indexOf('cut-cap:1:30:1')).toBeGreaterThanOrEqual(0);
      expect(keys.findIndex((k) => k.startsWith('cut-report:'))).toBeGreaterThan(
        keys.indexOf('cut-cap:1:30:1'),
      );
      const execOrder = prisma.$executeRaw.mock.invocationCallOrder;
      const rawOrder = prisma.$queryRaw.mock.invocationCallOrder[0];
      expect(Math.max(...execOrder)).toBeLessThan(rawOrder);
    });
  });

  describe('AC21 / AC25 / AC34: báo CÔNG ĐOẠN vượt', () => {
    it('AC21: Uốn cần 1180, đã tính 1180 -> báo Uốn 1 nhận 400 "cần Uốn 1180 ... tối đa 0", không tạo dòng báo', async () => {
      const w = newWorld({
        cut: [{ spec: SPEC, qty: 1180, order: SKU_A }],
        step: [{ spec: SPEC, qty: 1180, step: 'UON', order: SKU_A }],
      });
      const { prisma, service } = build(w);
      const err = await errOf(service.recordStepBatch('1', stepDto(1), 'cn-1'));
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toContain('cần Uốn 1180');
      expect(err.message).toContain('tối đa 0');
      expect(prisma.stepBatch.create).not.toHaveBeenCalled();
      expect(prisma.floorReport.create).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('AC21: ca 2 người (còn 5): người 1 báo 4 qua, người 2 báo 4 bị chặn "tối đa 1"', async () => {
      const w = newWorld({
        cut: [{ spec: SPEC, qty: 1185, order: SKU_A }],
        step: [{ spec: SPEC, qty: 1175, step: 'UON', order: SKU_A }],
      });
      const { service } = build(w);
      await expect(service.recordStepBatch('1', stepDto(4), 'cn-1')).resolves.toBeDefined();
      const err = await errOf(service.recordStepBatch('1', stepDto(4), 'cn-2'));
      expect(err.message).toContain('tối đa 1');
    });

    it('AC25: cần còn 8, vật lý còn 3 -> báo 3 qua, báo 4 bị chặn bằng câu vật lý "báo cắt thêm 1 đoạn 355mm"', async () => {
      const w = newWorld({
        cut: [{ spec: SPEC, qty: 1180, order: SKU_A }],
        step: [{ spec: SPEC, qty: 1180, step: 'UON', order: SKU_A }],
        stepQc: [{ spec: SPEC, failed: 8, short: 0, scrap: 5, step: 'UON', order: SKU_A }],
      });
      const { service } = build(w);
      const err = await errOf(service.recordStepBatch('1', stepDto(4), 'cn-1'));
      expect(err.message).toContain('báo cắt thêm 1 đoạn 355mm');
      expect(err.message).toContain('tối đa 3');
      await expect(service.recordStepBatch('1', stepDto(3), 'cn-1')).resolves.toBeDefined();
    });

    it('AC21 luật chọn câu: cả 2 vế cùng chặn, vế số cần nhỏ hơn -> câu số cần ("cần Uốn"), không phải câu vật lý', async () => {
      // cần 1180, đã tính 1178 (room 2); đã cắt 1185 (vật lý còn 7); báo 9 chặn cả 2 vế
      const w = newWorld({
        cut: [{ spec: SPEC, qty: 1185, order: SKU_A }],
        step: [{ spec: SPEC, qty: 1178, step: 'UON', order: SKU_A }],
      });
      const { service } = build(w);
      const err = await errOf(service.recordStepBatch('1', stepDto(9), 'cn-1'));
      expect(err.message).toContain('cần Uốn 1180');
      expect(err.message).toContain('tối đa 2');
      expect(err.message).not.toContain('báo cắt thêm');
    });

    it('AC34 (số mới): Uốn cần 1200, cắt 1180 (A 120 thiếu 5), Uốn báo 1180 -> báo Uốn 1 nhận câu vật lý có "KCS ghi thiếu 5 đoạn cắt"; cắt thêm 6 thì Uốn 1 qua', async () => {
      const w = newWorld({
        qtyPerPiece: 1200,
        cut: [{ spec: SPEC, qty: 1180, order: SKU_A }],
        cutQc: [{ spec: SPEC, failed: 0, short: 5, order: SKU_A }],
        step: [{ spec: SPEC, qty: 1180, step: 'UON', order: SKU_A }],
      });
      const { service } = build(w);
      const err = await errOf(service.recordStepBatch('1', stepDto(1), 'cn-1'));
      expect(err.message).toContain('KCS ghi thiếu 5 đoạn cắt');
      expect(err.message).not.toContain('cần Uốn 1200');
      w.cut.push({ spec: SPEC, qty: 6, order: SKU_A });
      await expect(service.recordStepBatch('1', stepDto(1), 'cn-1')).resolves.toBeDefined();
      await expect(service.recordStepBatch('1', stepDto(1), 'cn-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('AC31: Dập bỏ 4 -> Uốn bù 4 chỉ báo được sau khi đã cắt 4; báo Dập trước Uốn vẫn được', async () => {
      const w = newWorld({
        qtyPerPiece: 100,
        processSteps: [ProcessStep.CAT, ProcessStep.UON, ProcessStep.DAP],
        cut: [{ spec: SPEC, qty: 100, order: SKU_A }],
        step: [
          { spec: SPEC, qty: 100, step: 'UON', order: SKU_A },
          { spec: SPEC, qty: 100, step: 'DAP', order: SKU_A },
        ],
        stepQc: [{ spec: SPEC, failed: 4, short: 0, scrap: 4, step: 'DAP', order: SKU_A }],
      });
      const { service } = build(w);
      // Uốn cần 104 (100 + 4) nhưng đoạn cắt thực có chỉ 100, dùng 100 -> chưa cắt thì chưa bù được
      const err = await errOf(service.recordStepBatch('1', stepDto(4), 'cn-1'));
      expect(err.message).toMatch(/báo cắt thêm 4 đoạn 355mm/);
      w.cut.push({ spec: SPEC, qty: 4, order: SKU_A });
      await expect(service.recordStepBatch('1', stepDto(4), 'cn-1')).resolves.toBeDefined();
      // Dập bù 4 (sau cắt 4) cũng qua
      await expect(
        service.recordStepBatch('1', stepDto(4, ProcessStep.DAP), 'cn-1'),
      ).resolves.toBeDefined();
    });

    it('luật khoá MF3: khoá advisory step-batch TRƯỚC câu FOR UPDATE production_orders (khoá dòng lệnh sau cùng)', async () => {
      const { prisma, service } = build(newWorld({ cut: [{ spec: SPEC, qty: 10, order: SKU_A }] }));
      await service.recordStepBatch('1', stepDto(1), 'cn-1');
      const advisory = prisma.$executeRaw.mock.invocationCallOrder[0];
      const forUpdateIdx = (prisma.$queryRaw.mock.calls as unknown[][]).findIndex((c) =>
        (c[0] as string[]).join('').includes('production_orders'),
      );
      expect(forUpdateIdx).toBeGreaterThanOrEqual(0);
      expect(prisma.$queryRaw.mock.invocationCallOrder[forUpdateIdx]).toBeGreaterThan(advisory);
      expect(String((prisma.$executeRaw.mock.calls as unknown[][])[0][1])).toBe(
        'step-batch:1:30:UON:1',
      );
    });
  });

  describe('AC53: gửi lại cùng Idempotency-Key sau khi QLSX hủy hết', () => {
    // Dòng sổ đã ghi, vân tay khớp với cutDto(1) / stepDto(1) do 'cn-1' gửi (lô sắt 100, PI 1, SKU 1, vật tư 30, Uốn).
    const prevCutReport = (over: Record<string, unknown> = {}) => ({
      kind: FloorReportKind.CUT,
      reportedById: 'cn-1',
      workstationId: null,
      cutBundleId: null,
      stepBatchId: null,
      lines: [{ segmentSpecId: SPEC, pieceId: null, qty: 1 }],
      stepBatch: null,
      cutBundle: null,
      productionBatch: null,
      ...over,
    });
    const prevStepReport = (over: Record<string, unknown> = {}) => ({
      ...prevCutReport(),
      kind: FloorReportKind.STEP,
      stepBatch: {
        productionInvoiceId: PI,
        materialId: MAT,
        step: ProcessStep.UON,
        productionOrderId: SKU_A,
      },
      ...over,
    });

    it('báo Uốn: khoá thuộc lần báo đã bị hủy (stepBatchId null) -> 409 FLOOR_REPORT_REVERSED_REPLAY_MESSAGE, không ghi dòng sổ mới', async () => {
      const { prisma, service } = build(newWorld({ cut: [{ spec: SPEC, qty: 10, order: SKU_A }] }));
      prisma.floorReport.findUnique.mockResolvedValue(prevStepReport({ stepBatch: null }));
      const err = await errOf(service.recordStepBatch('1', stepDto(1), 'cn-1', 'K-1'));
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe(FLOOR_REPORT_REVERSED_REPLAY_MESSAGE);
      expect(prisma.stepBatch.create).not.toHaveBeenCalled();
      expect(prisma.floorReport.create).not.toHaveBeenCalled();
    });

    it('báo cắt: khoá thuộc lần báo đã bị hủy (cutBundleId null) -> 409 cùng câu, không ghi gì', async () => {
      const { prisma, service } = build(newWorld());
      prisma.floorReport.findUnique.mockResolvedValue(prevCutReport());
      const err = await errOf(service.recordCutBatch('100', cutDto(1), 'cn-1', 'K-2'));
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe(FLOOR_REPORT_REVERSED_REPLAY_MESSAGE);
      expect(prisma.cutBundle.create).not.toHaveBeenCalled();
      expect(prisma.floorReport.create).not.toHaveBeenCalled();
    });

    it('khoá đã dùng cho loại báo khác -> 422 IdempotencyKeyReusedException (T4-4: trước đây 409), không phải câu "đã bị hủy"', async () => {
      const { prisma, service } = build(newWorld());
      prisma.floorReport.findUnique.mockResolvedValue(prevStepReport({ stepBatchId: 5n }));
      const err = await errOf(service.recordCutBatch('100', cutDto(1), 'cn-1', 'K-3'));
      expect(err).toBeInstanceOf(IdempotencyKeyReusedException);
      expect(err.message).not.toBe(FLOOR_REPORT_REVERSED_REPLAY_MESSAGE);
    });

    it('đua khoá (P2002 ở lần ghi), lần đọc lại thấy lần báo đã bị hủy -> 409 câu hủy, không 500', async () => {
      const { Prisma } = await import('../../generated/prisma/client');
      const { prisma, service } = build(newWorld({ cut: [{ spec: SPEC, qty: 10, order: SKU_A }] }));
      prisma.floorReport.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null) // đọc lại trong transaction (sau try-lock): chưa có
        .mockResolvedValueOnce(prevStepReport({ stepBatch: null }));
      prisma.floorReport.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
          meta: { target: ['idempotencyKey'] },
        }),
      );
      const err = await errOf(service.recordStepBatch('1', stepDto(1), 'cn-1', 'K-4'));
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe(FLOOR_REPORT_REVERSED_REPLAY_MESSAGE);
    });
  });

  describe('QA 20/11/2026: try-lock khoá chống trùng là câu ĐẦU transaction của báo cắt / báo công đoạn', () => {
    const tryLockOrder = (prisma: FakePrisma): number => {
      const idx = (prisma.$queryRaw.mock.calls as unknown[][]).findIndex((c) =>
        (c[0] as TemplateStringsArray).join('').includes('pg_try_advisory_xact_lock'),
      );
      expect(idx).toBeGreaterThanOrEqual(0);
      return prisma.$queryRaw.mock.invocationCallOrder[idx];
    };

    it('báo cắt có khoá: try-lock chạy TRƯỚC khoá cut-cap (lockBusinessKey)', async () => {
      const { prisma, service } = build(newWorld());
      await service.recordCutBatch('100', cutDto(1), 'cn-1', 'K-10');
      expect(tryLockOrder(prisma)).toBeLessThan(prisma.$executeRaw.mock.invocationCallOrder[0]);
    });

    it('báo công đoạn có khoá: try-lock chạy TRƯỚC khoá step-batch', async () => {
      const { prisma, service } = build(newWorld({ cut: [{ spec: SPEC, qty: 10, order: SKU_A }] }));
      await service.recordStepBatch('1', stepDto(1), 'cn-1', 'K-11');
      expect(tryLockOrder(prisma)).toBeLessThan(prisma.$executeRaw.mock.invocationCallOrder[0]);
    });

    it.each([
      ['báo cắt', 'cut'],
      ['báo công đoạn', 'step'],
    ])(
      '%s: bản trùng đang chạy (try-lock thất bại) -> 409 IdempotencyKeyInUseException, không ghi',
      async (_l, kind) => {
        const { prisma, service } = build(
          newWorld({ cut: [{ spec: SPEC, qty: 10, order: SKU_A }] }),
        );
        const orig = prisma.$queryRaw.getMockImplementation() as (
          s: TemplateStringsArray,
        ) => Promise<unknown>;
        prisma.$queryRaw.mockImplementation((strings: TemplateStringsArray) =>
          strings.join('').includes('pg_try_advisory_xact_lock')
            ? Promise.resolve([{ ok: false }])
            : orig(strings),
        );
        const call =
          kind === 'cut'
            ? service.recordCutBatch('100', cutDto(1), 'cn-1', 'K-12')
            : service.recordStepBatch('1', stepDto(1), 'cn-1', 'K-12');
        const err = await errOf(call);
        expect(err).toBeInstanceOf(IdempotencyKeyInUseException);
        expect(prisma.floorReport.create).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['báo cắt', 'cut'],
      ['báo công đoạn', 'step'],
    ])(
      '%s: đọc lại trong khoá thấy lần báo vừa commit (đã bị hủy) -> trả câu 409 hủy, không ghi',
      async (_l, kind) => {
        const { prisma, service } = build(
          newWorld({ cut: [{ spec: SPEC, qty: 10, order: SKU_A }] }),
        );
        const prev = {
          kind: kind === 'cut' ? FloorReportKind.CUT : FloorReportKind.STEP,
          reportedById: 'cn-1',
          workstationId: null,
          cutBundleId: null,
          stepBatchId: null,
          lines: [{ segmentSpecId: SPEC, pieceId: null, qty: 1 }],
          stepBatch: null,
          cutBundle: null,
          productionBatch: null,
        };
        prisma.floorReport.findUnique
          .mockResolvedValueOnce(null) // đọc nhanh ngoài transaction
          .mockResolvedValue(prev); // trong khoá và lần so vân tay sau transaction
        const call =
          kind === 'cut'
            ? service.recordCutBatch('100', cutDto(1), 'cn-1', 'K-13')
            : service.recordStepBatch('1', stepDto(1), 'cn-1', 'K-13');
        const err = await errOf(call);
        expect(err).toBeInstanceOf(ConflictException);
        expect(err.message).toBe(FLOOR_REPORT_REVERSED_REPLAY_MESSAGE);
        expect(prisma.floorReport.create).not.toHaveBeenCalled();
        expect(prisma.cutBundle.create).not.toHaveBeenCalled();
        expect(prisma.stepBatch.create).not.toHaveBeenCalled();
      },
    );
  });

  describe('AC33: X3 hủy lần báo cắt (assertStepsWithinCutAfterReduceInTx)', () => {
    const makeTx = (w: World) => {
      const { prisma, service } = build(w);
      prisma.cutBundle.findUnique.mockResolvedValue({
        productionOrderId: SKU_A,
        steelIssue: { productionInvoiceId: PI, materialId: MAT },
      });
      return { tx: prisma, service };
    };
    const world = () =>
      newWorld({
        cut: [{ spec: SPEC, qty: 1180, order: SKU_A }],
        step: [{ spec: SPEC, qty: 1180, step: 'UON', order: SKU_A }],
        stepQc: [{ spec: SPEC, failed: 3, short: 0, scrap: 0, step: 'UON', order: SKU_A }],
      });

    it('AC33: Cắt 1180, Uốn 1180, KCS làm lại 3 (đã dùng 1177): hủy cắt 5 -> 400 (còn 1175 < 1177)', async () => {
      const { tx, service } = makeTx(world());
      const err = await errOf(
        service.assertStepsWithinCutAfterReduceInTx(tx as never, 7n, [
          { segmentSpecId: SPEC, qty: 5 },
        ]),
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toContain('355mm');
      expect(err.message).toContain('chỉ còn 1175');
      expect(err.message).toContain('1177');
    });

    it('AC33: hủy cắt 3 -> được (1177 <= 1177)', async () => {
      const { tx, service } = makeTx(world());
      await expect(
        service.assertStepsWithinCutAfterReduceInTx(tx as never, 7n, [
          { segmentSpecId: SPEC, qty: 3 },
        ]),
      ).resolves.toBeUndefined();
    });

    it('AC34: số đoạn thiếu của Cắt cũng tính: cắt 1180 thiếu 2, Uốn dùng 1178 -> hủy 1 bị chặn', async () => {
      const w = newWorld({
        cut: [{ spec: SPEC, qty: 1180, order: SKU_A }],
        cutQc: [{ spec: SPEC, failed: 0, short: 2, order: SKU_A }],
        step: [{ spec: SPEC, qty: 1178, step: 'UON', order: SKU_A }],
      });
      const { tx, service } = makeTx(w);
      await expect(
        service.assertStepsWithinCutAfterReduceInTx(tx as never, 7n, [
          { segmentSpecId: SPEC, qty: 1 },
        ]),
      ).rejects.toThrow(BadRequestException);
    });

    it('biên: số hủy 0 hoặc âm không đọc gì; chưa có công đoạn phụ nào thì hủy bao nhiêu cũng qua', async () => {
      const { tx, service } = makeTx(newWorld({ cut: [{ spec: SPEC, qty: 10, order: SKU_A }] }));
      await expect(
        service.assertStepsWithinCutAfterReduceInTx(tx as never, 7n, [
          { segmentSpecId: SPEC, qty: 0 },
        ]),
      ).resolves.toBeUndefined();
      await expect(
        service.assertStepsWithinCutAfterReduceInTx(tx as never, 7n, [
          { segmentSpecId: SPEC, qty: 10 },
        ]),
      ).resolves.toBeUndefined();
    });
  });

  describe('AC42: gán SKU cho đợt cắt cũ (assignCutBundleOrder)', () => {
    const twoSkus = () =>
      newWorld({
        orders: [
          { id: SKU_A, bomRevisionId: 5n, quantity: 1, floorStage: 'ACTIVE' },
          { id: SKU_B, bomRevisionId: 5n, quantity: 1, floorStage: 'ACTIVE' },
        ],
      });
    const bundleRow = (productionOrderId: bigint | null) => ({
      id: 7n,
      steelIssueId: 100n,
      proposalPatternId: null,
      barCount: 0,
      mauNguyenMm: 0,
      scrapMm: 0,
      status: CutBundleStatus.CUTTING,
      completedSteps: [ProcessStep.CAT],
      completedAt: null,
      createdAt: new Date(),
      segments: [],
      productionOrderId,
      steelIssue: { productionInvoiceId: PI, materialId: MAT },
    });

    it('AC42: SKU đích đã đủ số cần vẫn gán được (không chặn vượt ở SKU đích), đúng 1 transaction, có audit log', async () => {
      const w = twoSkus();
      w.cut.push({ spec: SPEC, qty: 1180, order: SKU_B });
      const { prisma, service } = build(w);
      prisma.cutBundle.findUnique.mockResolvedValue(bundleRow(null));
      prisma.cutPatternSegment.findMany.mockResolvedValue([
        { segmentSpecId: SPEC, qty: 30, segmentSpec: { cutLengthMm: decimal(355) } },
      ]);
      await expect(service.assignCutBundleOrder('7', '2', 'admin-1')).resolves.toBeDefined();
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.cutBundle.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { productionOrderId: SKU_B } }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('AC42: thứ tự khoá khi sửa SKU 2 -> 1: cut-cap theo id TĂNG DẦN (1 rồi 2), rồi mới FOR UPDATE dòng đợt cắt', async () => {
      const { prisma, service } = build(twoSkus());
      prisma.cutBundle.findUnique.mockResolvedValue(bundleRow(SKU_B));
      prisma.$queryRaw.mockImplementation(() =>
        Promise.resolve([{ status: CutBundleStatus.CUTTING, productionOrderId: SKU_B }]),
      );
      prisma.cutPatternSegment.findMany.mockResolvedValue([]);
      await service.assignCutBundleOrder('7', '1', 'admin-1', true);
      const keys = (prisma.$executeRaw.mock.calls as unknown[][]).map((c) => String(c[1]));
      const caps = keys.filter((k) => k.startsWith('cut-cap:'));
      expect(caps).toEqual(['cut-cap:1:30:1', 'cut-cap:1:30:2']);
      const lastCap = Math.max(
        ...prisma.$executeRaw.mock.invocationCallOrder.slice(0, caps.length),
      );
      expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeGreaterThan(lastCap);
    });

    it('AC42: đợt vừa bị QLSX hủy hết (dòng khoá trả rỗng) -> 409 "vừa bị QLSX hủy hết", KHÔNG phải câu "gắn SKU bởi người khác"; không updateMany', async () => {
      const { prisma, service } = build(twoSkus());
      prisma.cutBundle.findUnique.mockResolvedValue(bundleRow(null));
      prisma.$queryRaw.mockImplementation(() => Promise.resolve([]));
      const err = await errOf(service.assignCutBundleOrder('7', '1', 'admin-1'));
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toContain('vừa bị QLSX hủy hết');
      expect(err.message).not.toContain('gắn SKU bởi người khác');
      expect(prisma.cutBundle.updateMany).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('AC42: người khác vừa gắn SKU cho đợt (SKU trong khoá khác SKU đã đọc) -> 409 "gắn SKU bởi người khác"', async () => {
      const { prisma, service } = build(twoSkus());
      prisma.cutBundle.findUnique.mockResolvedValue(bundleRow(null));
      prisma.$queryRaw.mockImplementation(() =>
        Promise.resolve([{ status: CutBundleStatus.CUTTING, productionOrderId: SKU_A }]),
      );
      await expect(service.assignCutBundleOrder('7', '2', 'admin-1')).rejects.toThrow(
        'vừa được gắn SKU bởi người khác',
      );
    });

    it('AC42 (ca thêm): công nhân vừa báo thêm cỡ không có trong định mức SKU đích lúc ta chờ khoá -> 400 "không có trong định mức", không đổi SKU', async () => {
      const { prisma, service } = build(twoSkus());
      prisma.cutBundle.findUnique.mockResolvedValue(bundleRow(null));
      prisma.$queryRaw.mockImplementation(() =>
        Promise.resolve([{ status: CutBundleStatus.CUTTING, productionOrderId: null }]),
      );
      prisma.cutPatternSegment.findMany.mockResolvedValue([
        { segmentSpecId: 99n, qty: 4, segmentSpec: { cutLengthMm: decimal(471) } },
      ]);
      const err = await errOf(service.assignCutBundleOrder('7', '2', 'admin-1'));
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toContain('471mm không có trong định mức');
      expect(prisma.cutBundle.updateMany).not.toHaveBeenCalled();
    });

    it('AC42: gán lần 2 không phải reassign -> 409; reassign cho đợt chưa gắn -> 400; SKU mới trùng SKU cũ -> 400', async () => {
      const { prisma, service } = build(twoSkus());
      prisma.cutBundle.findUnique.mockResolvedValue(bundleRow(SKU_A));
      await expect(service.assignCutBundleOrder('7', '2', 'a')).rejects.toThrow(ConflictException);
      await expect(service.assignCutBundleOrder('7', '1', 'a', true)).rejects.toThrow(
        'SKU mới trùng SKU hiện tại',
      );
      prisma.cutBundle.findUnique.mockResolvedValue(bundleRow(null));
      await expect(service.assignCutBundleOrder('7', '2', 'a', true)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('AC42 + AC33: sửa SKU của đợt cắt đang bị công đoạn phụ dùng hết -> bị X3 chặn, không updateMany, không audit', async () => {
      const w = twoSkus();
      w.cut.push({ spec: SPEC, qty: 10, order: SKU_B });
      w.step.push({ spec: SPEC, qty: 10, step: 'UON', order: SKU_B });
      const { prisma, service } = build(w);
      prisma.cutBundle.findUnique.mockResolvedValue(bundleRow(SKU_B));
      prisma.$queryRaw.mockImplementation(() =>
        Promise.resolve([{ status: CutBundleStatus.CUTTING, productionOrderId: SKU_B }]),
      );
      prisma.cutPatternSegment.findMany.mockImplementation(
        (a: { where: { cutBundleId?: bigint } }) =>
          a.where.cutBundleId !== undefined
            ? Promise.resolve([
                { segmentSpecId: SPEC, qty: 4, segmentSpec: { cutLengthMm: decimal(355) } },
              ])
            : Promise.resolve(
                w.cut.map((r) => ({
                  segmentSpecId: r.spec,
                  qty: r.qty,
                  cutBundle: { productionOrderId: r.order },
                })),
              ),
      );
      const err = await errOf(service.assignCutBundleOrder('7', '1', 'admin-1', true));
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toContain('355mm');
      expect(prisma.cutBundle.updateMany).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });
  });
});
