import { WorkshopScopeService } from '../../common/workshop-scope/workshop-scope.service';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { ProductionBatchesService } from '../production-batches/production-batches.service';
import { SteelIssuesService } from '../steel-issues/steel-issues.service';
import { FloorReviewService } from './floor-review.service';

/** listOpen: đợt chờ gửi KCS + số "đã báo/cần" + gom công đoạn phụ theo công nhân (2026-10-13, mục 26). */
describe('FloorReviewService.listOpen / sendStepGroup', () => {
  let prisma: {
    productionBatch: { findMany: jest.Mock; groupBy: jest.Mock };
    cutBundle: { findMany: jest.Mock };
    stepBatch: { findMany: jest.Mock };
  };
  let steelIssues: {
    getPhoiProgress: jest.Mock;
    getStepProgress: jest.Mock;
    submitStepBundle: jest.Mock;
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

  const progressItem = (over = 0) => ({
    materialId: '7',
    steelBalance: { receivedBarCount: 11, usableMm: 46640, reportedMm: 50880, overMm: 4240 },
    segments: [
      {
        segmentSpecId: '63',
        required: 100,
        done: 120,
        byOrder: [{ productionOrderId: '41', required: 60, done: 60 + over }],
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
    };
    steelIssues = {
      getPhoiProgress: jest.fn().mockResolvedValue([]),
      getStepProgress: jest.fn().mockResolvedValue([]),
      submitStepBundle: jest.fn().mockResolvedValue({ id: '1' }),
    };
    productionBatches = { getBatchPlanBatch: jest.fn().mockResolvedValue({}) };
    service = new FloorReviewService(
      prisma as unknown as PrismaServiceType,
      steelIssues as unknown as SteelIssuesService,
      productionBatches as unknown as ProductionBatchesService,
      {
        getScope: jest
          .fn()
          .mockResolvedValue({ workshopId: null, workshopName: null, visibleWorkshopIds: null }),
      } as unknown as WorkshopScopeService,
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
      { cutLengthMm: 441, qty: 4, required: 60, done: 78, over: 18, failed: 0, reportedQty: 78 },
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
      { cutLengthMm: 441, qty: 4, required: 100, done: 120, over: 20, failed: 0, reportedQty: 120 },
    ]);
    // không có lần báo nào trong sổ -> tuổi tính từ lúc mở đợt
    expect(r.cutBundles[0].waitingSince).toEqual(at('2026-10-13T01:00:00Z'));
  });

  describe('17/11 số được tính = đã báo - lỗi KCS (báo bù không bị coi là vượt)', () => {
    const item = (o: { required: number; done: number; failed?: number }, pi = o) => ({
      materialId: '7',
      steelBalance: null,
      segments: [
        {
          segmentSpecId: '63',
          required: pi.required,
          done: pi.done,
          ...(pi.failed === undefined ? {} : { failed: pi.failed }),
          byOrder: [{ productionOrderId: '41', ...o }],
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
        {
          cutLengthMm: 441,
          qty: 4,
          required: 1180,
          done: 1180,
          over: 0,
          failed: 12,
          reportedQty: 1192,
        },
      ]);
    });

    it('AC3: báo vượt thật (1200, lỗi 12, cần 1180) -> done 1188, over 8', async () => {
      steelIssues.getPhoiProgress.mockResolvedValue([
        item({ required: 1180, done: 1200, failed: 12 }),
      ]);
      expect(await cutProgress()).toEqual([
        {
          cutLengthMm: 441,
          qty: 4,
          required: 1180,
          done: 1188,
          over: 8,
          failed: 12,
          reportedQty: 1200,
        },
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
        {
          cutLengthMm: 441,
          qty: 5,
          required: 1180,
          done: 1180,
          over: 0,
          failed: 5,
          reportedQty: 1185,
        },
      ]);
    });

    it('AC5: thiếu failed -> done = số thô, failed 0, không NaN', async () => {
      steelIssues.getPhoiProgress.mockResolvedValue([item({ required: 60, done: 70 })]);
      expect(await cutProgress()).toEqual([
        { cutLengthMm: 441, qty: 4, required: 60, done: 70, over: 10, failed: 0, reportedQty: 70 },
      ]);
    });

    it('AC6: đợt cũ không gắn SKU -> số cả PI trừ lỗi cả PI', async () => {
      prisma.cutBundle.findMany.mockResolvedValue([cutBundle(null)]);
      steelIssues.getPhoiProgress.mockResolvedValue([
        item({ required: 60, done: 60, failed: 1 }, { required: 100, done: 112, failed: 12 }),
      ]);
      expect(await cutProgress()).toEqual([
        {
          cutLengthMm: 441,
          qty: 4,
          required: 100,
          done: 100,
          over: 0,
          failed: 12,
          reportedQty: 112,
        },
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
      { cutLengthMm: 441, qty: 4, required: 0, done: 0, over: 0, failed: 0, reportedQty: 0 },
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

    expect(r.pieceBatches[0].progress).toEqual({ required: 60, reported: 70, over: 10 });
  });

  it('sendStepGroup: truyền công nhân của nhóm (kể cả null = đợt cũ); không truyền = gom hết như màn Phôi cũ', async () => {
    const base = {
      productionInvoiceId: '45',
      materialId: '7',
      step: 'UON' as const,
      productionOrderId: '41',
    };

    await service.sendStepGroup({ ...base, workerId: 'cn-an' }, 'qlsx-1');
    await service.sendStepGroup({ ...base, workerId: null }, 'qlsx-1');
    await service.sendStepGroup(base, 'qlsx-1');

    const calls = steelIssues.submitStepBundle.mock.calls as unknown[][];
    expect(calls[0][5]).toEqual({ id: 'cn-an' });
    expect(calls[1][5]).toEqual({ id: null });
    expect(calls[2][5]).toBeUndefined();
  });
});
