import {
  KCS_STALE_HOURS,
  blockedReasonOf,
  countKcsByStage,
  listKcsPendingItems,
  piHasActiveSkuWhere,
  type KcsPendingItem,
} from './kcs-pending.util';

/**
 * P1 (18/11/2026) - kcs-pending.util: 5 loại đợt x (đang mở + đã chốt), PI 1 SKU / nhiều SKU, lệnh dừng,
 * mốc chờ (có / không có sổ báo, lần báo đã đảo không tính). Test thuần: db giả trả sẵn dữ liệu cho từng bảng.
 */
const T = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 18, h, m));

interface Fixture {
  cutBundle?: unknown[];
  stepBatch?: unknown[];
  stepBundle?: unknown[];
  productionBatch?: unknown[];
  pieceStepBatch?: unknown[];
  pieceStepBundle?: unknown[];
  materialYieldStepBatch?: unknown[];
  materialYieldStepBundle?: unknown[];
  /** PI đang có SKU ACTIVE (mọi PI khác coi là dừng). */
  activePis?: bigint[];
  /** Mọi SKU (lệnh sản xuất) của từng PI. */
  orders?: { id: bigint; pi: bigint }[];
}

function makeDb(f: Fixture) {
  const rows = (x?: unknown[]) => ({ findMany: jest.fn().mockResolvedValue(x ?? []) });
  return {
    cutBundle: rows(f.cutBundle),
    stepBatch: rows(f.stepBatch),
    stepBundle: rows(f.stepBundle),
    productionBatch: rows(f.productionBatch),
    pieceStepBatch: rows(f.pieceStepBatch),
    pieceStepBundle: rows(f.pieceStepBundle),
    materialYieldStepBatch: rows(f.materialYieldStepBatch),
    materialYieldStepBundle: rows(f.materialYieldStepBundle),
    productionInvoice: rows((f.activePis ?? []).map((id) => ({ id }))),
    productionOrder: rows(
      (f.orders ?? []).map((o) => ({
        id: o.id,
        productionInvoiceItem: { productionInvoiceId: o.pi },
      })),
    ),
  };
}

const run = (f: Fixture, opts?: { staleBefore?: Date }) =>
  listKcsPendingItems(makeDb(f) as never, opts);

const pbOrder = (pi: bigint) => ({ productionInvoiceItem: { productionInvoiceId: pi } });

describe('kcs-pending.util - hàm nhỏ', () => {
  it('KCS_STALE_HOURS = 4', () => {
    expect(KCS_STALE_HOURS).toBe(4);
  });

  it('piHasActiveSkuWhere: PI còn ít nhất 1 SKU ACTIVE (mẫu paint-transfer-reminder)', () => {
    expect(piHasActiveSkuWhere()).toEqual({
      items: { some: { productionOrder: { floorStage: 'ACTIVE' } } },
    });
  });

  it('blockedReasonOf: lệnh dừng thắng; chưa gắn SKU chỉ khi PI nhiều SKU', () => {
    expect(blockedReasonOf({ piActive: false, multiSku: true, productionOrderId: null })).toBe(
      'LENH_DUNG',
    );
    expect(blockedReasonOf({ piActive: true, multiSku: true, productionOrderId: null })).toBe(
      'CHUA_GAN_SKU',
    );
    expect(
      blockedReasonOf({ piActive: true, multiSku: false, productionOrderId: null }),
    ).toBeNull();
    expect(blockedReasonOf({ piActive: true, multiSku: true, productionOrderId: 5n })).toBeNull();
  });

  it('countKcsByStage: đếm theo tổ, bỏ dòng có blockedReason', () => {
    const mk = (stage: KcsPendingItem['stage'], blockedReason: KcsPendingItem['blockedReason']) =>
      ({
        stage,
        productionInvoiceId: 1n,
        kind: 'CUT',
        state: 'OPEN',
        waitingSince: T(1),
        blockedReason,
      }) as KcsPendingItem;
    expect(
      countKcsByStage([
        mk('PHOI', null),
        mk('PHOI', null),
        mk('PHOI', 'LENH_DUNG'),
        mk('HAN', null),
        mk('HAN', 'CHUA_GAN_SKU'),
        mk('SON', null),
      ]),
    ).toEqual({ phoi: 2, han: 1, son: 1 });
  });
});

describe('kcs-pending.util - 5 loại đợt', () => {
  it('đợt cắt: CUTTING = OPEN, AWAITING_QC = AWAITING_QC, cùng tổ Phôi', async () => {
    const items = await run({
      cutBundle: [
        {
          status: 'CUTTING',
          createdAt: T(1),
          steelIssue: { productionInvoiceId: 1n },
          floorReports: [{ createdAt: T(2) }],
        },
        {
          status: 'AWAITING_QC',
          createdAt: T(1),
          steelIssue: { productionInvoiceId: 1n },
          floorReports: [{ createdAt: T(3) }],
        },
      ],
      activePis: [1n],
      orders: [{ id: 10n, pi: 1n }],
    });
    expect(items.map((i) => [i.kind, i.state, i.stage, i.blockedReason])).toEqual([
      ['CUT', 'OPEN', 'PHOI', null],
      ['CUT', 'AWAITING_QC', 'PHOI', null],
    ]);
    expect(items[0].waitingSince).toEqual(T(2));
  });

  it('nhóm công đoạn phụ: gom theo (PI, sắt, công đoạn, SKU, người); đã chốt tính từng bó', async () => {
    const base = { productionInvoiceId: 1n, materialId: 7n, step: 'UON' };
    const items = await run({
      stepBatch: [
        { ...base, productionOrderId: 10n, reportedById: 'u1', createdAt: T(1), floorReports: [] },
        { ...base, productionOrderId: 10n, reportedById: 'u1', createdAt: T(2), floorReports: [] },
        { ...base, productionOrderId: 10n, reportedById: 'u2', createdAt: T(2), floorReports: [] },
        { ...base, productionOrderId: 11n, reportedById: 'u1', createdAt: T(2), floorReports: [] },
      ],
      stepBundle: [
        {
          productionInvoiceId: 1n,
          submittedAt: T(5),
          batches: [{ createdAt: T(4), floorReports: [{ createdAt: T(4, 30) }] }],
        },
      ],
      activePis: [1n],
      orders: [
        { id: 10n, pi: 1n },
        { id: 11n, pi: 1n },
      ],
    });
    const open = items.filter((i) => i.kind === 'STEP' && i.state === 'OPEN');
    expect(open).toHaveLength(3);
    const awaiting = items.filter((i) => i.kind === 'STEP' && i.state === 'AWAITING_QC');
    expect(awaiting).toHaveLength(1);
    expect(awaiting[0].waitingSince).toEqual(T(4, 30));
  });

  it('lô mảnh: Phôi / Hàn / Sơn, OPEN và AWAITING_QC; tổ DAN bị bỏ', async () => {
    const items = await run({
      productionBatch: [
        {
          stage: 'HAN',
          status: 'OPEN',
          reportedAt: T(1),
          productionOrder: pbOrder(1n),
          floorReports: [],
        },
        {
          stage: 'SON',
          status: 'AWAITING_QC',
          reportedAt: T(1),
          productionOrder: pbOrder(1n),
          floorReports: [],
        },
        {
          stage: 'PHOI',
          status: 'OPEN',
          reportedAt: T(1),
          productionOrder: pbOrder(1n),
          floorReports: [],
        },
        {
          stage: 'DAN',
          status: 'OPEN',
          reportedAt: T(1),
          productionOrder: pbOrder(1n),
          floorReports: [],
        },
      ],
      activePis: [1n],
      orders: [{ id: 10n, pi: 1n }],
    });
    expect(items.map((i) => [i.kind, i.state, i.stage])).toEqual([
      ['PIECE_BATCH', 'OPEN', 'HAN'],
      ['PIECE_BATCH', 'AWAITING_QC', 'SON'],
      ['PIECE_BATCH', 'OPEN', 'PHOI'],
    ]);
  });

  it('pat: gom theo (lệnh, mảnh, công đoạn), mốc = giờ báo sớm nhất; bó đã chốt = AWAITING_QC', async () => {
    const row = (orderId: bigint, pieceId: bigint, step: string, at: Date) => ({
      productionOrderId: orderId,
      pieceId,
      step,
      reportedAt: at,
      productionOrder: pbOrder(1n),
    });
    const items = await run({
      pieceStepBatch: [
        row(10n, 1n, 'CAT', T(3)),
        row(10n, 1n, 'CAT', T(1)),
        row(10n, 1n, 'DUC_LO', T(2)),
        row(10n, 2n, 'CAT', T(2)),
      ],
      pieceStepBundle: [
        { submittedAt: T(6), productionOrder: pbOrder(1n), batches: [{ reportedAt: T(5) }] },
      ],
      activePis: [1n],
      orders: [{ id: 10n, pi: 1n }],
    });
    const open = items.filter((i) => i.kind === 'PIECE_STEP' && i.state === 'OPEN');
    expect(open).toHaveLength(3);
    expect(open[0].waitingSince).toEqual(T(1));
    const awaiting = items.filter((i) => i.kind === 'PIECE_STEP' && i.state === 'AWAITING_QC');
    expect(awaiting).toHaveLength(1);
    expect(awaiting[0].waitingSince).toEqual(T(5));
  });

  it('chân nhôm: gom theo (PI, công thức, công đoạn); bó đã chốt không có batch thì lấy giờ chốt', async () => {
    const items = await run({
      materialYieldStepBatch: [
        { productionInvoiceId: 1n, recipeId: 3n, step: 'CAT', reportedAt: T(4) },
        { productionInvoiceId: 1n, recipeId: 3n, step: 'CAT', reportedAt: T(2) },
        { productionInvoiceId: 1n, recipeId: 3n, step: 'TAN', reportedAt: T(2) },
      ],
      materialYieldStepBundle: [{ productionInvoiceId: 1n, submittedAt: T(7), batches: [] }],
      activePis: [1n],
      orders: [{ id: 10n, pi: 1n }],
    });
    const open = items.filter((i) => i.state === 'OPEN');
    expect(open.map((i) => i.kind)).toEqual(['MATERIAL_YIELD', 'MATERIAL_YIELD']);
    expect(open[0].waitingSince).toEqual(T(2));
    const awaiting = items.filter((i) => i.state === 'AWAITING_QC');
    expect(awaiting).toHaveLength(1);
    expect(awaiting[0].waitingSince).toEqual(T(7));
    expect(awaiting[0].stage).toBe('PHOI');
  });
});

describe('kcs-pending.util - PI 1 SKU / nhiều SKU', () => {
  const nullOrderBatch = (reportedById = 'u1') => ({
    productionInvoiceId: 1n,
    materialId: 7n,
    step: 'UON',
    productionOrderId: null,
    reportedById,
    createdAt: T(1),
    floorReports: [],
  });

  it('PI 1 SKU: dòng chưa gắn SKU gộp vào SKU duy nhất, không bị chặn', async () => {
    const items = await run({
      stepBatch: [nullOrderBatch(), { ...nullOrderBatch(), productionOrderId: 10n }],
      activePis: [1n],
      orders: [{ id: 10n, pi: 1n }],
    });
    expect(items).toHaveLength(1);
    expect(items[0].blockedReason).toBeNull();
  });

  it('PI nhiều SKU: dòng chưa gắn SKU là CHUA_GAN_SKU, dòng đã gắn thì chấm được', async () => {
    const items = await run({
      stepBatch: [nullOrderBatch(), { ...nullOrderBatch(), productionOrderId: 10n }],
      activePis: [1n],
      orders: [
        { id: 10n, pi: 1n },
        { id: 11n, pi: 1n },
      ],
    });
    expect(items.map((i) => i.blockedReason)).toEqual(
      expect.arrayContaining([null, 'CHUA_GAN_SKU']),
    );
    expect(items).toHaveLength(2);
  });

  it('PI nhiều SKU: bó công đoạn đã chốt chưa gắn SKU vẫn chấm được (không CHUA_GAN_SKU)', async () => {
    const items = await run({
      stepBundle: [{ productionInvoiceId: 1n, submittedAt: T(1), batches: [] }],
      activePis: [1n],
      orders: [
        { id: 10n, pi: 1n },
        { id: 11n, pi: 1n },
      ],
    });
    expect(items[0].blockedReason).toBeNull();
  });
});

describe('kcs-pending.util - lệnh dừng', () => {
  it('LENH_DUNG áp cho cả đợt đang mở lẫn đợt đã chốt; PI còn SKU ACTIVE thì không', async () => {
    const items = await run({
      cutBundle: [
        {
          status: 'CUTTING',
          createdAt: T(1),
          steelIssue: { productionInvoiceId: 1n },
          floorReports: [],
        },
        {
          status: 'AWAITING_QC',
          createdAt: T(1),
          steelIssue: { productionInvoiceId: 1n },
          floorReports: [],
        },
        {
          status: 'CUTTING',
          createdAt: T(1),
          steelIssue: { productionInvoiceId: 2n },
          floorReports: [],
        },
      ],
      activePis: [2n],
      orders: [
        { id: 10n, pi: 1n },
        { id: 20n, pi: 2n },
      ],
    });
    expect(items.map((i) => [i.productionInvoiceId, i.state, i.blockedReason])).toEqual([
      [1n, 'OPEN', 'LENH_DUNG'],
      [1n, 'AWAITING_QC', 'LENH_DUNG'],
      [2n, 'OPEN', null],
    ]);
    expect(countKcsByStage(items)).toEqual({ phoi: 1, han: 0, son: 0 });
  });

  it('lệnh dừng thắng CHUA_GAN_SKU ở nhóm công đoạn chưa gắn SKU', async () => {
    const items = await run({
      stepBatch: [
        {
          productionInvoiceId: 1n,
          materialId: 7n,
          step: 'UON',
          productionOrderId: null,
          reportedById: 'u1',
          createdAt: T(1),
          floorReports: [],
        },
      ],
      activePis: [],
      orders: [
        { id: 10n, pi: 1n },
        { id: 11n, pi: 1n },
      ],
    });
    expect(items[0].blockedReason).toBe('LENH_DUNG');
  });
});

describe('kcs-pending.util - mốc chờ waitingSince', () => {
  it('có sổ báo còn hiệu lực: lấy lần báo đầu tiên (nguồn đã lọc lần báo bị đảo)', async () => {
    const db = makeDb({
      cutBundle: [
        {
          status: 'CUTTING',
          createdAt: T(1),
          steelIssue: { productionInvoiceId: 1n },
          floorReports: [{ createdAt: T(3) }, { createdAt: T(2) }],
        },
      ],
      activePis: [1n],
      orders: [{ id: 10n, pi: 1n }],
    });
    const items = await listKcsPendingItems(db as never);
    expect(items[0].waitingSince).toEqual(T(2));
  });

  it('truy vấn chỉ lấy lần báo CHƯA bị đảo và không phải dòng đảo (lần đã đảo không làm mốc)', async () => {
    const db = makeDb({});
    await listKcsPendingItems(db as never);
    const arg = (db.cutBundle.findMany.mock.calls as unknown[][])[0][0] as {
      select: { floorReports: { where: unknown; take: number } };
    };
    expect(arg.select.floorReports.where).toEqual({
      reversalOfId: null,
      reversedBy: { is: null },
    });
    for (const m of ['stepBatch', 'productionBatch'] as const) {
      const a = (db[m].findMany.mock.calls as unknown[][])[0][0] as {
        select: { floorReports: { where: unknown } };
      };
      expect(a.select.floorReports.where).toEqual({ reversalOfId: null, reversedBy: { is: null } });
    }
  });

  it('không còn lần báo nào còn hiệu lực: lấy giờ tạo của đợt', async () => {
    const items = await run({
      cutBundle: [
        {
          status: 'CUTTING',
          createdAt: T(1),
          steelIssue: { productionInvoiceId: 1n },
          floorReports: [],
        },
      ],
      productionBatch: [
        {
          stage: 'HAN',
          status: 'OPEN',
          reportedAt: T(2),
          productionOrder: pbOrder(1n),
          floorReports: [],
        },
      ],
      activePis: [1n],
      orders: [{ id: 10n, pi: 1n }],
    });
    expect(items[0].waitingSince).toEqual(T(1));
    expect(items[1].waitingSince).toEqual(T(2));
  });

  it('staleBefore: chỉ giữ dòng có waitingSince quá mốc', async () => {
    const f: Fixture = {
      productionBatch: [
        {
          stage: 'HAN',
          status: 'OPEN',
          reportedAt: T(1),
          productionOrder: pbOrder(1n),
          floorReports: [],
        },
        {
          stage: 'HAN',
          status: 'AWAITING_QC',
          reportedAt: T(9),
          productionOrder: pbOrder(1n),
          floorReports: [],
        },
      ],
      activePis: [1n],
      orders: [{ id: 10n, pi: 1n }],
    };
    expect(await run(f)).toHaveLength(2);
    const stale = await run(f, { staleBefore: T(5) });
    expect(stale).toHaveLength(1);
    expect(stale[0].state).toBe('OPEN');
  });

  it('không có dữ liệu thì trả mảng rỗng và không tra PI', async () => {
    const db = makeDb({});
    expect(await listKcsPendingItems(db as never)).toEqual([]);
    expect(db.productionInvoice.findMany).not.toHaveBeenCalled();
  });
});
