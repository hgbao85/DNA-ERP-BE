import { WorkshopScopeService } from '../../common/workshop-scope/workshop-scope.service';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { loadMaterialYieldNeed } from '../material-yield-recipes/material-yield-need.util';
import { MaterialYieldRecipeProductionService } from '../material-yield-recipes/material-yield-recipe-production.service';
import { ProductionBatchesService } from '../production-batches/production-batches.service';
import { SteelIssuesService } from '../steel-issues/steel-issues.service';
import { FloorReviewService, pieceMaxNow, pieceStepMaxNow } from './floor-review.service';
import { listKcsPendingItems } from './kcs-pending.util';

// Danh sách đợt chưa chấm của kcs-pending (nguồn của stoppedPis) và số cần chân nhôm: giả lập, giữ nguyên hàm thuần.
jest.mock('./kcs-pending.util', () => ({
  ...jest.requireActual<Record<string, unknown>>('./kcs-pending.util'),
  listKcsPendingItems: jest.fn(),
}));
jest.mock('../material-yield-recipes/material-yield-need.util', () => ({
  loadMaterialYieldNeed: jest.fn(),
}));
const listKcsPendingMock = listKcsPendingItems as jest.Mock;
const yieldNeedMock = loadMaterialYieldNeed as jest.Mock;

/** listOpen: đợt chờ gửi KCS + số "đã báo/cần" + gom công đoạn phụ theo công nhân (2026-10-13, mục 26). */
describe('FloorReviewService.listOpen', () => {
  let prisma: {
    productionBatch: { findMany: jest.Mock; groupBy: jest.Mock };
    cutBundle: { findMany: jest.Mock };
    stepBatch: { findMany: jest.Mock };
    pieceStepBatch: { findMany: jest.Mock };
    materialYieldStepBatch: { findMany: jest.Mock };
    productionInvoice: { findMany: jest.Mock };
    productionOrder: { findMany: jest.Mock };
  };
  let getScope: jest.Mock;
  let steelIssues: {
    getPhoiProgress: jest.Mock;
    getStepProgress: jest.Mock;
  };
  let productionBatches: { getBatchPlanBatch: jest.Mock };
  let service: FloorReviewService;

  const user = (n: string) => ({ firstName: n, lastName: 'Họ', username: n.toLowerCase() });
  const at = (iso: string) => new Date(iso);
  const report = (id: number, createdAt: string, extra: Record<string, unknown> = {}) => ({
    id: BigInt(id),
    createdAt: at(createdAt),
    reversalOfId: null,
    reportedBy: user('An'),
    workstation: { code: 'M1', name: 'Máy 1' },
    lines: [{ qty: 5, segmentSpec: { cutLengthMm: { toString: () => '441' } }, piece: null }],
    reversedBy: null,
    ...extra,
  });
  const material = { id: 7n, code: 'SAT-12', name: 'Sắt 12' };
  const pi = { id: 45n, code: 'PI-45' };
  const order = { id: 41n, poNumber: 'PO-41', mfgProduct: { factoryCode: 'GHE' } };
  const spec = (cutLengthMm: number) => ({ cutLengthMm: { toString: () => String(cutLengthMm) } });

  /** Số liệu tiến độ của 1 cỡ đoạn theo nghĩa API mới: done = thô - thiếu (vẫn gồm lỗi), reportedQty = thô. */
  const row = (o: {
    required: number;
    done: number;
    failed?: number;
    shortQty?: number;
    reportedQty?: number;
    maxNow?: number;
    extraNeed?: number;
  }) => ({
    baseRequired: o.required - (o.extraNeed ?? 0),
    extraNeed: o.extraNeed ?? 0,
    failed: o.failed ?? 0,
    shortQty: o.shortQty ?? 0,
    reportedQty: o.reportedQty ?? o.done + (o.shortQty ?? 0),
    maxNow: o.maxNow ?? 0,
    ...o,
  });
  /** Dòng progress mong đợi ở floor/review (qty = số của đợt). */
  const prog = (o: Record<string, unknown>) => ({
    cutLengthMm: 441,
    qty: 4,
    baseRequired: o.required,
    extraNeed: 0,
    shortQty: 0,
    maxNow: 0,
    failed: 0,
    ...o,
  });

  const progressItem = (over = 0) => ({
    materialId: '7',
    steelBalance: { receivedBarCount: 11, usableMm: 46640, reportedMm: 50880, overMm: 4240 },
    segments: [
      {
        segmentSpecId: '63',
        ...row({ required: 100, done: 120 }),
        byOrder: [{ productionOrderId: '41', ...row({ required: 60, done: 60 + over }) }],
      },
    ],
  });

  beforeEach(() => {
    prisma = {
      productionBatch: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      cutBundle: { findMany: jest.fn().mockResolvedValue([]) },
      stepBatch: { findMany: jest.fn().mockResolvedValue([]) },
      pieceStepBatch: { findMany: jest.fn().mockResolvedValue([]) },
      materialYieldStepBatch: { findMany: jest.fn().mockResolvedValue([]) },
      // Mặc định PI 45 còn SKU đang chạy; PI có 1 SKU (lệnh 41).
      productionInvoice: { findMany: jest.fn().mockResolvedValue([{ id: 45n }]) },
      productionOrder: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ ...order, productionInvoiceItem: { productionInvoiceId: 45n } }]),
      },
    };
    steelIssues = {
      getPhoiProgress: jest.fn().mockResolvedValue([]),
      getStepProgress: jest.fn().mockResolvedValue([]),
    };
    productionBatches = { getBatchPlanBatch: jest.fn().mockResolvedValue({}) };
    listKcsPendingMock.mockReset().mockResolvedValue([]);
    yieldNeedMock.mockReset().mockResolvedValue(new Map());
    getScope = jest
      .fn()
      .mockResolvedValue({ workshopId: null, workshopName: null, visibleWorkshopIds: null });
    service = new FloorReviewService(
      prisma as unknown as PrismaServiceType,
      steelIssues as unknown as SteelIssuesService,
      productionBatches as unknown as ProductionBatchesService,
      { getScope } as unknown as WorkshopScopeService,
      {} as MaterialYieldRecipeProductionService,
    );
  });

  const stepBatch = (
    id: number,
    workerId: string | null,
    workerName: string,
    qty: number,
    reportAt: string,
  ) => ({
    id: BigInt(id),
    productionInvoiceId: 45n,
    materialId: 7n,
    step: 'UON',
    productionOrderId: 41n,
    createdAt: at(reportAt),
    reportedById: workerId,
    reportedBy: workerId ? user(workerName) : null,
    material,
    productionInvoice: pi,
    productionOrder: order,
    segments: [{ segmentSpecId: 63n, qty, segmentSpec: spec(441) }],
    floorReports: [report(id, reportAt)],
  });

  it('công đoạn phụ: MỖI CÔNG NHÂN 1 NHÓM RIÊNG (kể cả cùng PI/loại sắt/công đoạn/SKU), đợt cũ chưa biết người là nhóm riêng', async () => {
    prisma.stepBatch.findMany.mockResolvedValue([
      stepBatch(1, 'cn-an', 'An', 5, '2026-10-13T01:00:00Z'),
      stepBatch(2, 'cn-an', 'An', 2, '2026-10-13T02:00:00Z'),
      stepBatch(3, 'cn-binh', 'Binh', 3, '2026-10-13T01:30:00Z'),
      stepBatch(4, null, 'x', 4, '2026-10-12T01:00:00Z'),
    ]);

    const r = await service.listOpen('PHOI');

    expect(r.stepGroups).toHaveLength(3);
    const an = r.stepGroups.find((g) => g.workerId === 'cn-an')!;
    expect(an.segments).toEqual([{ cutLengthMm: 441, qty: 7 }]); // 5 + 2 cộng dồn trong nhóm của An
    expect(an.workerName).toBe('Họ An');
    expect(r.stepGroups.find((g) => g.workerId === 'cn-binh')!.segments).toEqual([
      { cutLengthMm: 441, qty: 3 },
    ]);
    expect(r.stepGroups.find((g) => g.workerId === null)!.workerName).toBeNull();
  });

  it('X4 16/11: QLSX gắn xưởng chỉ thấy nhóm công đoạn của PI thuộc xưởng mình', async () => {
    const other = {
      ...stepBatch(2, 'cn-binh', 'Binh', 3, '2026-10-13T01:30:00Z'),
      productionInvoiceId: 46n,
    };
    prisma.stepBatch.findMany.mockResolvedValue([
      stepBatch(1, 'cn-an', 'An', 5, '2026-10-13T01:00:00Z'),
      other,
    ]);
    const scoped = new FloorReviewService(
      {
        ...prisma,
        // PI 45 ở xưởng 1, PI 46 ở xưởng 2.
        productionInvoiceItem: {
          findMany: jest.fn().mockResolvedValue([
            { productionInvoiceId: 45n, workshopId: 1n },
            { productionInvoiceId: 46n, workshopId: 2n },
          ]),
        },
      } as unknown as PrismaServiceType,
      steelIssues as unknown as SteelIssuesService,
      productionBatches as unknown as ProductionBatchesService,
      {
        getScope: jest
          .fn()
          .mockResolvedValue({ workshopId: 1n, workshopName: 'Xưởng 1', visibleWorkshopIds: [1n] }),
      } as unknown as WorkshopScopeService,
      {} as MaterialYieldRecipeProductionService,
    );

    const r = await scoped.listOpen('PHOI', undefined, 'qlsx-xuong-1');

    expect(r.stepGroups.map((g) => g.workerId)).toEqual(['cn-an']);
  });

  it('"chờ bao lâu" tính từ lần báo CÒN HIỆU LỰC đầu tiên - bỏ lần đã bị đảo', async () => {
    const b = stepBatch(1, 'cn-an', 'An', 5, '2026-10-13T05:00:00Z');
    b.floorReports = [
      report(10, '2026-10-13T01:00:00Z', {
        reversedBy: {
          id: 99n,
          reason: 'x',
          createdAt: at('2026-10-13T01:05:00Z'),
          reportedBy: user('Q'),
        },
      }),
      report(11, '2026-10-13T05:00:00Z'),
    ];
    prisma.stepBatch.findMany.mockResolvedValue([b]);

    const r = await service.listOpen('PHOI');

    expect(r.stepGroups[0].waitingSince).toEqual(at('2026-10-13T05:00:00Z'));
  });

  it('đợt cắt: số cần/đã cắt của ĐÚNG SKU (không phải cả PI) + phần vượt + sắt vào–đoạn ra', async () => {
    prisma.cutBundle.findMany.mockResolvedValue([
      {
        id: 52n,
        productionOrderId: 41n,
        createdAt: at('2026-10-13T01:00:00Z'),
        openedBy: user('An'),
        segments: [{ segmentSpecId: 63n, qty: 4, segmentSpec: spec(441) }],
        steelIssue: { material, productionInvoice: pi },
        productionOrder: order,
        floorReports: [report(1, '2026-10-13T01:10:00Z')],
      },
    ]);
    steelIssues.getPhoiProgress.mockResolvedValue([progressItem(18)]);

    const r = await service.listOpen('PHOI');

    expect(r.cutBundles[0].progress).toEqual([
      prog({ required: 60, done: 78, over: 18, reportedQty: 78 }),
    ]);
    expect(r.cutBundles[0].steelBalance).toEqual(
      expect.objectContaining({ receivedBarCount: 11, overMm: 4240 }),
    );
    expect(r.cutBundles[0].waitingSince).toEqual(at('2026-10-13T01:10:00Z'));
  });

  it('đợt cắt CŨ không gắn SKU -> dùng số cả PI', async () => {
    prisma.cutBundle.findMany.mockResolvedValue([
      {
        id: 50n,
        productionOrderId: null,
        createdAt: at('2026-10-13T01:00:00Z'),
        openedBy: null,
        segments: [{ segmentSpecId: 63n, qty: 4, segmentSpec: spec(441) }],
        steelIssue: { material, productionInvoice: pi },
        productionOrder: null,
        floorReports: [],
      },
    ]);
    steelIssues.getPhoiProgress.mockResolvedValue([progressItem()]);

    const r = await service.listOpen('PHOI');

    expect(r.cutBundles[0].progress).toEqual([
      prog({ required: 100, done: 120, over: 20, reportedQty: 120 }),
    ]);
    // không có lần báo nào trong sổ -> tuổi tính từ lúc mở đợt
    expect(r.cutBundles[0].waitingSince).toEqual(at('2026-10-13T01:00:00Z'));
  });

  describe('17/11 số được tính = đã báo - lỗi KCS (báo bù không bị coi là vượt)', () => {
    const item = (o: Parameters<typeof row>[0], pi = o) => ({
      materialId: '7',
      steelBalance: null,
      segments: [
        {
          segmentSpecId: '63',
          ...row(pi),
          byOrder: [{ productionOrderId: '41', ...row(o) }],
        },
      ],
    });
    const cutBundle = (orderId: bigint | null) => ({
      id: 52n,
      productionOrderId: orderId,
      createdAt: at('2026-10-13T01:00:00Z'),
      openedBy: user('An'),
      segments: [{ segmentSpecId: 63n, qty: 4, segmentSpec: spec(441) }],
      steelIssue: { material, productionInvoice: pi },
      productionOrder: orderId ? order : null,
      floorReports: [],
    });
    const cutProgress = async () => (await service.listOpen('PHOI')).cutBundles[0].progress;

    beforeEach(() => {
      prisma.cutBundle.findMany.mockResolvedValue([cutBundle(41n)]);
    });

    it('AC2: đã báo 1192, lỗi 12, cần 1180 -> done 1180, over 0', async () => {
      steelIssues.getPhoiProgress.mockResolvedValue([
        item({ required: 1180, done: 1192, failed: 12 }),
      ]);
      expect(await cutProgress()).toEqual([
        prog({ required: 1180, done: 1180, over: 0, failed: 12, reportedQty: 1192 }),
      ]);
    });

    it('P1: done = thô - lỗi - thiếu (đã tính); shortQty / baseRequired / extraNeed / maxNow lấy từ tiến độ BE', async () => {
      steelIssues.getPhoiProgress.mockResolvedValue([
        item({
          required: 1185,
          extraNeed: 5,
          done: 1190, // API phoi-progress: thô 1195 - thiếu 5
          shortQty: 5,
          failed: 10,
          reportedQty: 1195,
          maxNow: 7,
        }),
      ]);
      expect(await cutProgress()).toEqual([
        {
          cutLengthMm: 441,
          qty: 4,
          required: 1185,
          baseRequired: 1180,
          extraNeed: 5,
          done: 1180, // 1195 - 10 - 5
          failed: 10,
          shortQty: 5,
          reportedQty: 1195,
          over: 0,
          maxNow: 7,
        },
      ]);
    });

    it('AC3: báo vượt thật (1200, lỗi 12, cần 1180) -> done 1188, over 8', async () => {
      steelIssues.getPhoiProgress.mockResolvedValue([
        item({ required: 1180, done: 1200, failed: 12 }),
      ]);
      expect(await cutProgress()).toEqual([
        prog({ required: 1180, done: 1188, over: 8, failed: 12, reportedQty: 1200 }),
      ]);
    });

    it('AC4: nhóm công đoạn phụ (Uốn): đã báo 1185, lỗi 5, cần 1180 -> over 0', async () => {
      prisma.stepBatch.findMany.mockResolvedValue([
        stepBatch(1, 'cn-an', 'An', 5, '2026-10-13T01:00:00Z'),
      ]);
      steelIssues.getStepProgress.mockResolvedValue([
        item({ required: 1180, done: 1185, failed: 5 }),
      ]);
      const r = await service.listOpen('PHOI');
      expect(r.stepGroups[0].progress).toEqual([
        prog({ qty: 5, required: 1180, done: 1180, over: 0, failed: 5, reportedQty: 1185 }),
      ]);
    });

    it('AC5: thiếu failed -> done = số thô, failed 0, không NaN', async () => {
      const bare = { required: 60, done: 70 };
      steelIssues.getPhoiProgress.mockResolvedValue([
        {
          materialId: '7',
          steelBalance: null,
          segments: [
            {
              segmentSpecId: '63',
              ...bare,
              byOrder: [{ productionOrderId: '41', ...bare, reportedQty: 70 }],
            },
          ],
        },
      ]);
      expect(await cutProgress()).toEqual([
        prog({ required: 60, done: 70, over: 10, reportedQty: 70, baseRequired: 0 }),
      ]);
    });

    it('AC6: đợt cũ không gắn SKU -> số cả PI trừ lỗi cả PI', async () => {
      prisma.cutBundle.findMany.mockResolvedValue([cutBundle(null)]);
      steelIssues.getPhoiProgress.mockResolvedValue([
        item({ required: 60, done: 60, failed: 1 }, { required: 100, done: 112, failed: 12 }),
      ]);
      expect(await cutProgress()).toEqual([
        prog({ required: 100, done: 100, over: 0, failed: 12, reportedQty: 112 }),
      ]);
    });
  });

  it('lấy tiến độ lỗi -> danh sách đợt VẪN trả về, chỉ không có số cần (required = 0, steelBalance null)', async () => {
    prisma.cutBundle.findMany.mockResolvedValue([
      {
        id: 52n,
        productionOrderId: 41n,
        createdAt: at('2026-10-13T01:00:00Z'),
        openedBy: user('An'),
        segments: [{ segmentSpecId: 63n, qty: 4, segmentSpec: spec(441) }],
        steelIssue: { material, productionInvoice: pi },
        productionOrder: order,
        floorReports: [],
      },
    ]);
    steelIssues.getPhoiProgress.mockRejectedValue(new Error('boom'));

    const r = await service.listOpen('PHOI');

    expect(r.cutBundles).toHaveLength(1);
    expect(r.cutBundles[0].progress).toEqual([
      prog({ required: 0, done: 0, over: 0, reportedQty: 0 }),
    ]);
    expect(r.cutBundles[0].steelBalance).toBeNull();
  });

  it('mảnh Hàn/Sơn: đã báo = đã KCS + chờ KCS + đang mở (mọi người); vượt so với kế hoạch', async () => {
    prisma.productionBatch.findMany.mockResolvedValue([
      {
        id: 106n,
        stage: 'HAN',
        productionOrderId: 41n,
        pieceId: 73n,
        reportedQty: 4,
        reportedAt: at('2026-10-13T01:00:00Z'),
        reportedBy: user('Hai'),
        piece: { code: 'KT', name: 'Khung tựa' },
        productionOrder: { ...order, productionInvoiceItem: { productionInvoice: pi } },
        floorReports: [
          report(5, '2026-10-13T01:20:00Z', {
            lines: [{ qty: 4, segmentSpec: null, piece: { code: 'KT', name: 'Khung tựa' } }],
          }),
        ],
      },
    ]);
    productionBatches.getBatchPlanBatch.mockResolvedValue({
      '41': { items: [{ pieceId: '73', plannedQty: 60, passedQty: 40, awaitingQcQty: 10 }] },
    });
    prisma.productionBatch.groupBy.mockResolvedValue([
      { productionOrderId: 41n, pieceId: 73n, _sum: { reportedQty: 20 } },
    ]);

    const r = await service.listOpen('HAN');

    // required 60, đã tính 70 (40 + 10 + 20), vượt 10, báo thêm được 0 (S6: max(0, 60 - 40 - 10 - 20) -> 0 vì đã hết)
    expect(r.pieceBatches[0].progress).toEqual({ required: 60, reported: 70, over: 10, maxNow: 0 });
  });

  // ─── P1 (18/11/2026): KCS xem đợt đang mở, không lọc xưởng; piActive / blockedReason; pat + chân nhôm; stoppedPis ───

  describe('P1 - phạm vi xưởng', () => {
    const scopedTo1 = () =>
      getScope.mockResolvedValue({
        workshopId: 1n,
        workshopName: 'Xưởng 1',
        visibleWorkshopIds: [1n],
      });
    const twoPis = () => {
      prisma.stepBatch.findMany.mockResolvedValue([
        stepBatch(1, 'cn-an', 'An', 5, '2026-10-13T01:00:00Z'),
        {
          ...stepBatch(2, 'cn-binh', 'Binh', 3, '2026-10-13T01:30:00Z'),
          productionInvoiceId: 46n,
          productionInvoice: { id: 46n, code: 'PI-46' },
        },
      ]);
      // PI 45 ở xưởng 1, PI 46 ở xưởng 2.
      (prisma as Record<string, unknown>).productionInvoiceItem = {
        findMany: jest.fn().mockResolvedValue([
          { productionInvoiceId: 45n, workshopId: 1n },
          { productionInvoiceId: 46n, workshopId: 2n },
        ]),
      };
    };

    it('QLSX (mặc định) gắn xưởng: hỏi phạm vi và chỉ thấy PI xưởng mình', async () => {
      scopedTo1();
      twoPis();
      const r = await service.listOpen('PHOI', undefined, 'qlsx-1');
      expect(getScope).toHaveBeenCalledWith('qlsx-1');
      expect(r.stepGroups.map((g) => g.pi.productionInvoiceId)).toEqual(['45']);
    });

    it('KCS không có vai QLSX (limitToWorkshop = false): KHÔNG hỏi phạm vi, thấy cả 2 xưởng dù có gắn xưởng', async () => {
      scopedTo1();
      twoPis();
      const r = await service.listOpen('PHOI', undefined, 'kcs-1', false);
      expect(getScope).not.toHaveBeenCalled();
      expect(r.stepGroups.map((g) => g.pi.productionInvoiceId).sort()).toEqual(['45', '46']);
    });
  });

  describe('P1 - piActive / blockedReason', () => {
    const cut = (orderId: bigint | null = 41n) => ({
      id: 52n,
      productionOrderId: orderId,
      createdAt: at('2026-10-13T01:00:00Z'),
      openedBy: user('An'),
      segments: [{ segmentSpecId: 63n, qty: 4, segmentSpec: spec(441) }],
      steelIssue: { material, productionInvoice: pi },
      productionOrder: orderId ? order : null,
      floorReports: [report(1, '2026-10-13T01:10:00Z')],
    });
    const order2 = {
      id: 42n,
      poNumber: 'PO-42',
      mfgProduct: { factoryCode: 'BAN' },
      productionInvoiceItem: { productionInvoiceId: 45n },
    };
    const multiSku = () =>
      prisma.productionOrder.findMany.mockResolvedValue([
        { ...order, productionInvoiceItem: { productionInvoiceId: 45n } },
        order2,
      ]);
    const nullSku = (id: number, workerId: string | null, qty: number, reportAt: string) => ({
      ...stepBatch(id, workerId, 'An', qty, reportAt),
      productionOrderId: null,
      productionOrder: null,
    });

    it('PI còn SKU đang chạy: piActive true, blockedReason null cho mọi loại đợt', async () => {
      prisma.cutBundle.findMany.mockResolvedValue([cut()]);
      prisma.stepBatch.findMany.mockResolvedValue([
        stepBatch(1, 'cn-an', 'An', 5, '2026-10-13T01:00:00Z'),
      ]);
      const r = await service.listOpen('PHOI');
      expect(r.cutBundles[0]).toEqual(
        expect.objectContaining({ piActive: true, blockedReason: null }),
      );
      expect(r.stepGroups[0]).toEqual(
        expect.objectContaining({ piActive: true, blockedReason: null }),
      );
    });

    it('lệnh đã dừng / kết thúc (PI không còn SKU ACTIVE) -> piActive false, blockedReason LENH_DUNG ở cả đợt cắt, nhóm công đoạn, lô mảnh', async () => {
      prisma.productionInvoice.findMany.mockResolvedValue([]);
      prisma.cutBundle.findMany.mockResolvedValue([cut()]);
      prisma.stepBatch.findMany.mockResolvedValue([
        stepBatch(1, 'cn-an', 'An', 5, '2026-10-13T01:00:00Z'),
      ]);
      prisma.productionBatch.findMany.mockResolvedValue([
        {
          id: 106n,
          stage: 'PHOI',
          productionOrderId: 41n,
          pieceId: 73n,
          reportedQty: 4,
          reportedAt: at('2026-10-13T01:00:00Z'),
          reportedBy: user('Hai'),
          piece: { code: 'KT', name: 'Khung tựa' },
          productionOrder: { ...order, productionInvoiceItem: { productionInvoice: pi } },
          floorReports: [],
        },
      ]);

      const r = await service.listOpen('PHOI');

      const stopped = { piActive: false, blockedReason: 'LENH_DUNG' };
      expect(r.cutBundles[0]).toEqual(expect.objectContaining(stopped));
      expect(r.stepGroups[0]).toEqual(expect.objectContaining(stopped));
      expect(r.pieceBatches[0]).toEqual(expect.objectContaining(stopped));
      // câu hỏi "PI còn SKU ACTIVE" dùng đúng điều kiện của kcs-pending
      const activeQuery = (prisma.productionInvoice.findMany.mock.calls as unknown[][])[0][0] as {
        where: Record<string, unknown>;
      };
      expect(activeQuery.where.items).toEqual({
        some: { productionOrder: { floorStage: 'ACTIVE' } },
      });
    });

    it('PI NHIỀU SKU: nhóm công đoạn chưa gắn SKU = CHUA_GAN_SKU, nhóm đã gắn SKU = null', async () => {
      multiSku();
      prisma.stepBatch.findMany.mockResolvedValue([
        nullSku(1, 'cn-an', 5, '2026-10-13T01:00:00Z'),
        stepBatch(2, 'cn-an', 'An', 3, '2026-10-13T02:00:00Z'),
      ]);
      const r = await service.listOpen('PHOI');
      expect(r.stepGroups).toHaveLength(2);
      const unassigned = r.stepGroups.find((g) => g.order === null)!;
      expect(unassigned.blockedReason).toBe('CHUA_GAN_SKU');
      expect(r.stepGroups.find((g) => g.order !== null)!.blockedReason).toBeNull();
    });

    it('PI 1 SKU: dòng cũ chưa gắn SKU gộp vào nhóm của SKU duy nhất (cùng công nhân) - 1 nhóm, không xám', async () => {
      prisma.stepBatch.findMany.mockResolvedValue([
        nullSku(1, 'cn-an', 20, '2026-10-13T01:00:00Z'),
        stepBatch(2, 'cn-an', 'An', 80, '2026-10-13T02:00:00Z'),
      ]);
      const r = await service.listOpen('PHOI');
      expect(r.stepGroups).toHaveLength(1);
      expect(r.stepGroups[0].segments).toEqual([{ cutLengthMm: 441, qty: 100 }]);
      expect(r.stepGroups[0].order?.productionOrderId).toBe('41');
      expect(r.stepGroups[0].blockedReason).toBeNull();
    });

    it('PI 1 SKU chỉ có dòng cũ chưa gắn SKU: nhóm lấy SKU duy nhất, KHÔNG bị khoá mãi (chốt được)', async () => {
      prisma.stepBatch.findMany.mockResolvedValue([
        nullSku(1, 'cn-an', 20, '2026-10-13T01:00:00Z'),
      ]);
      const r = await service.listOpen('PHOI');
      expect(r.stepGroups[0].order?.sku).toBe('GHE');
      expect(r.stepGroups[0].blockedReason).toBeNull();
    });

    it('LENH_DUNG thắng CHUA_GAN_SKU khi vừa PI dừng vừa chưa gắn SKU', async () => {
      multiSku();
      prisma.productionInvoice.findMany.mockResolvedValue([]);
      prisma.stepBatch.findMany.mockResolvedValue([nullSku(1, 'cn-an', 5, '2026-10-13T01:00:00Z')]);
      const r = await service.listOpen('PHOI');
      expect(r.stepGroups[0].blockedReason).toBe('LENH_DUNG');
    });

    it('waitingSince của nhóm không có sổ báo = giờ tạo sớm nhất của dòng (không phải giờ hiện tại)', async () => {
      const a = stepBatch(1, 'cn-an', 'An', 5, '2026-10-13T05:00:00Z');
      a.floorReports = [];
      Object.assign(a, { createdAt: at('2026-10-13T03:00:00Z') });
      prisma.stepBatch.findMany.mockResolvedValue([a]);
      const r = await service.listOpen('PHOI');
      expect(r.stepGroups[0].waitingSince).toEqual(at('2026-10-13T03:00:00Z'));
    });
  });

  describe('P1 - stoppedPis (MF2)', () => {
    const pending = (stage: string, piId: bigint | null, blockedReason: string | null) => ({
      stage,
      productionInvoiceId: piId,
      kind: 'PIECE_BATCH',
      state: 'AWAITING_QC',
      waitingSince: at('2026-10-13T01:00:00Z'),
      blockedReason,
    });

    it('trả { productionInvoiceId, code } của PI của tổ có đợt chờ KCS mà lệnh đã dừng - bỏ PI khác tổ, PI chưa gắn SKU, PI trùng', async () => {
      listKcsPendingMock.mockResolvedValue([
        pending('HAN', 45n, 'LENH_DUNG'),
        pending('HAN', 45n, 'LENH_DUNG'),
        pending('HAN', 47n, 'LENH_DUNG'),
        pending('HAN', 48n, 'CHUA_GAN_SKU'),
        pending('HAN', 49n, null),
        pending('SON', 50n, 'LENH_DUNG'),
        pending('HAN', null, 'LENH_DUNG'),
      ]);
      prisma.productionInvoice.findMany.mockImplementation(
        ({ where }: { where: { items?: unknown; id: { in: bigint[] } } }) =>
          where.items
            ? Promise.resolve([])
            : Promise.resolve(where.id.in.map((id) => ({ id, code: `PI-${id}` }))),
      );

      const r = await service.listOpen('HAN');

      expect(r.stoppedPis).toEqual([
        { productionInvoiceId: '45', code: 'PI-45' },
        { productionInvoiceId: '47', code: 'PI-47' },
      ]);
    });

    it('không có PI dừng -> mảng rỗng, không tra mã PI; lọc theo productionInvoiceId khi được hỏi riêng 1 PI', async () => {
      listKcsPendingMock.mockResolvedValue([pending('HAN', 49n, null)]);
      expect((await service.listOpen('HAN')).stoppedPis).toEqual([]);

      listKcsPendingMock.mockResolvedValue([
        pending('HAN', 45n, 'LENH_DUNG'),
        pending('HAN', 47n, 'LENH_DUNG'),
      ]);
      prisma.productionInvoice.findMany.mockImplementation(
        ({ where }: { where: { items?: unknown; id: { in: bigint[] } } }) =>
          Promise.resolve(where.items ? [] : where.id.in.map((id) => ({ id, code: `PI-${id}` }))),
      );
      const r = await service.listOpen('HAN', '47');
      expect(r.stoppedPis).toEqual([{ productionInvoiceId: '47', code: 'PI-47' }]);
    });
  });

  describe('P1 - tổ Hàn / Sơn không có pat, chân nhôm', () => {
    it('tổ HAN: pieceStepGroups / materialYieldGroups rỗng và không đọc bảng pat / chân nhôm', async () => {
      const r = await service.listOpen('HAN');
      expect(r.pieceStepGroups).toEqual([]);
      expect(r.materialYieldGroups).toEqual([]);
      expect(r.cutBundles).toEqual([]);
      expect(r.stepGroups).toEqual([]);
      expect(prisma.pieceStepBatch.findMany).not.toHaveBeenCalled();
      expect(prisma.materialYieldStepBatch.findMany).not.toHaveBeenCalled();
    });
  });

  describe('P1 - pat (pieceStepGroups) và chân nhôm (materialYieldGroups) của tổ Phôi', () => {
    const pieceStepRow = (id: number, qty: number, reportAt: string, over = {}) => ({
      id: BigInt(id),
      productionOrderId: 41n,
      pieceId: 73n,
      step: 'DUC_LO',
      qty,
      reportedAt: at(reportAt),
      reportedBy: user('An'),
      piece: { code: 'PAT-1', name: 'Pat chân' },
      productionOrder: { ...order, productionInvoiceItem: { productionInvoice: pi } },
      ...over,
    });
    const yieldRow = (id: number, qty: number, reportAt: string, over = {}) => ({
      id: BigInt(id),
      productionInvoiceId: 45n,
      recipeId: 3n,
      step: 'DAP',
      qty,
      reportedAt: at(reportAt),
      reportedBy: user('Binh'),
      productionInvoice: pi,
      recipe: { outputMaterial: { id: 9n, code: 'CHAN-NHOM', name: 'Chân nhôm' } },
      ...over,
    });

    it('pat: gom theo (lệnh, mảnh, công đoạn), cộng số, mốc chờ = lần báo sớm nhất, progress theo số cần / lỗi / thiếu', async () => {
      prisma.pieceStepBatch.findMany.mockResolvedValue([
        pieceStepRow(1, 3, '2026-10-13T03:00:00Z'),
        pieceStepRow(2, 4, '2026-10-13T01:00:00Z', { reportedBy: user('Binh') }),
        pieceStepRow(3, 9, '2026-10-13T02:00:00Z', { step: 'TAN' }),
      ]);
      productionBatches.getBatchPlanBatch.mockResolvedValue({
        '41': {
          items: [
            {
              pieceId: '73',
              plannedQty: 100,
              passedQty: 0,
              awaitingQcQty: 0,
              stepProgress: [
                { step: 'DUC_LO', requiredQty: 100, doneQty: 90, failedQty: 5, shortQty: 3 },
                { step: 'TAN', requiredQty: 100, doneQty: 9, failedQty: 0, shortQty: 0 },
              ],
            },
          ],
        },
      });

      const r = await service.listOpen('PHOI');

      expect(r.pieceStepGroups).toHaveLength(2);
      const duc = r.pieceStepGroups.find((g) => g.step === 'DUC_LO')!;
      expect(duc).toEqual(
        expect.objectContaining({
          productionOrderId: '41',
          pieceId: '73',
          piece: { code: 'PAT-1', name: 'Pat chân' },
          qty: 7,
          reportedByNames: ['Họ An', 'Họ Binh'],
          waitingSince: at('2026-10-13T01:00:00Z'),
          piActive: true,
          blockedReason: null,
          pi: { productionInvoiceId: '45', code: 'PI-45' },
          order: { productionOrderId: '41', poNumber: 'PO-41', sku: 'GHE' },
        }),
      );
      // đã tính = 90 - 5 - 3 = 82; còn báo được 100 - 82 = 18
      expect(duc.progress).toEqual({
        required: 100,
        reportedQty: 90,
        done: 82,
        failed: 5,
        shortQty: 3,
        over: 0,
        maxNow: 18,
      });
      expect(r.pieceStepGroups.find((g) => g.step === 'TAN')!.progress.maxNow).toBe(91);
      // lấy kế hoạch của lệnh có pat (không chỉ lệnh có lô mảnh)
      expect(productionBatches.getBatchPlanBatch).toHaveBeenCalledWith(['41'], 'PHOI');
    });

    it('pat của PI đã dừng -> LENH_DUNG; không có kế hoạch -> progress toàn 0, không lỗi', async () => {
      prisma.productionInvoice.findMany.mockResolvedValue([]);
      prisma.pieceStepBatch.findMany.mockResolvedValue([
        pieceStepRow(1, 3, '2026-10-13T03:00:00Z'),
      ]);
      const r = await service.listOpen('PHOI');
      expect(r.pieceStepGroups[0].blockedReason).toBe('LENH_DUNG');
      expect(r.pieceStepGroups[0].progress).toEqual({
        required: 0,
        reportedQty: 0,
        done: 0,
        failed: 0,
        shortQty: 0,
        over: 0,
        maxNow: 0,
      });
    });

    it('pat: lọc theo PI khi được hỏi riêng 1 PI', async () => {
      await service.listOpen('PHOI', '45');
      expect(prisma.pieceStepBatch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            pieceStepBundleId: null,
            productionOrder: { productionInvoiceItem: { productionInvoiceId: 45n } },
          },
        }),
      );
      expect(prisma.materialYieldStepBatch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { materialYieldStepBundleId: null, productionInvoiceId: 45n },
        }),
      );
    });

    it('chân nhôm: gom theo (PI, công thức, công đoạn), số cần / đã tính từ loadMaterialYieldNeed', async () => {
      prisma.materialYieldStepBatch.findMany.mockResolvedValue([
        yieldRow(1, 10, '2026-10-13T02:00:00Z'),
        yieldRow(2, 5, '2026-10-13T01:00:00Z'),
        yieldRow(3, 7, '2026-10-13T01:30:00Z', { step: 'UON' }),
      ]);
      yieldNeedMock.mockResolvedValue(
        new Map([
          ['45:3:DAP', { required: 480, counted: 475 }],
          ['45:3:UON', { required: 480, counted: 490 }],
        ]),
      );

      const r = await service.listOpen('PHOI');

      expect(r.materialYieldGroups).toHaveLength(2);
      const dap = r.materialYieldGroups.find((g) => g.step === 'DAP')!;
      expect(dap).toEqual(
        expect.objectContaining({
          productionInvoiceId: '45',
          recipeId: '3',
          material: { materialId: '9', code: 'CHAN-NHOM', name: 'Chân nhôm' },
          qty: 15,
          waitingSince: at('2026-10-13T01:00:00Z'),
          piActive: true,
          blockedReason: null,
        }),
      );
      expect(dap.progress).toEqual({ required: 480, done: 475, over: 0, maxNow: 5 });
      expect(r.materialYieldGroups.find((g) => g.step === 'UON')!.progress).toEqual({
        required: 480,
        done: 490,
        over: 10,
        maxNow: 0,
      });
      expect(yieldNeedMock).toHaveBeenCalledWith(prisma, [45n]);
    });

    it('chân nhôm: tra số cần lỗi -> danh sách vẫn trả về, progress 0; PI dừng -> LENH_DUNG', async () => {
      prisma.productionInvoice.findMany.mockResolvedValue([]);
      prisma.materialYieldStepBatch.findMany.mockResolvedValue([
        yieldRow(1, 10, '2026-10-13T02:00:00Z'),
      ]);
      yieldNeedMock.mockRejectedValue(new Error('boom'));
      const r = await service.listOpen('PHOI');
      expect(r.materialYieldGroups[0].blockedReason).toBe('LENH_DUNG');
      expect(r.materialYieldGroups[0].progress).toEqual({
        required: 0,
        done: 0,
        over: 0,
        maxNow: 0,
      });
    });
  });

  describe('P1 - lô mảnh: maxNow (S6)', () => {
    const batch = {
      id: 106n,
      stage: 'HAN',
      productionOrderId: 41n,
      pieceId: 73n,
      reportedQty: 4,
      reportedAt: at('2026-10-13T01:00:00Z'),
      reportedBy: user('Hai'),
      piece: { code: 'KT', name: 'Khung tựa' },
      productionOrder: { ...order, productionInvoiceItem: { productionInvoice: pi } },
      floorReports: [],
    };

    it('báo thêm được = kế hoạch - đã KCS - chờ KCS - đang mở', async () => {
      prisma.productionBatch.findMany.mockResolvedValue([batch]);
      productionBatches.getBatchPlanBatch.mockResolvedValue({
        '41': { items: [{ pieceId: '73', plannedQty: 100, passedQty: 40, awaitingQcQty: 10 }] },
      });
      prisma.productionBatch.groupBy.mockResolvedValue([
        { productionOrderId: 41n, pieceId: 73n, _sum: { reportedQty: 20 } },
      ]);
      const r = await service.listOpen('HAN');
      expect(r.pieceBatches[0].progress).toEqual({
        required: 100,
        reported: 70,
        over: 0,
        maxNow: 30,
      });
    });

    it('không có kế hoạch (thẻ không có số cần): maxNow 0', async () => {
      prisma.productionBatch.findMany.mockResolvedValue([batch]);
      const r = await service.listOpen('HAN');
      expect(r.pieceBatches[0].progress).toEqual({ required: 0, reported: 0, over: 0, maxNow: 0 });
    });

    it('pieceMaxNow / pieceStepMaxNow: không bao giờ âm, trừ lỗi và thiếu của pat', () => {
      expect(pieceMaxNow({ plannedQty: 60, passedQty: 40, awaitingQcQty: 10, openQty: 20 })).toBe(
        0,
      );
      expect(pieceMaxNow({ plannedQty: 60, passedQty: 40, awaitingQcQty: 10, openQty: 5 })).toBe(5);
      expect(pieceStepMaxNow({ requiredQty: 100, doneQty: 90, failedQty: 5, shortQty: 3 })).toBe(
        18,
      );
      expect(pieceStepMaxNow({ requiredQty: 100, doneQty: 120, failedQty: 0, shortQty: 0 })).toBe(
        0,
      );
      expect(pieceStepMaxNow({ requiredQty: 100, doneQty: 2, failedQty: 5, shortQty: 3 })).toBe(
        100,
      );
    });
  });
});
