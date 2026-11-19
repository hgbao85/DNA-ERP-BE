import { WorkshopScopeService } from '../../common/workshop-scope/workshop-scope.service';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { FloorAdminService } from './floor-admin.service';
import { KCS_STALE_HOURS } from './kcs-pending.util';

/**
 * UB12 (P1 "KCS tự chuyển", tester-unit #3) - GET /floor/summary = { open, awaitingKcs, stale } theo tổ.
 *
 * Spec của Dev (floor-admin.service.spec.ts, khối "summary") giả lập listKcsPendingItems. Ở đây chạy FloorAdminService.summary +
 * kcs-pending.util + WorkshopScopeService THẬT trên DB giả: mốc chờ đi từ giờ lần báo thật (kể cả lần báo đã bị hủy), lọc xưởng
 * theo quy tắc hàng đợi thật (Sơn nhờ xưởng khác), `now` truyền vào để không chờ 4 giờ thật (AC16, AC17, AC11, MF5, MF6).
 */

const H = 3_600_000;
const NOW = new Date('2026-11-18T12:00:00Z');
const ago = (hours: number, from = NOW) => new Date(from.getTime() - hours * H);
const PHU_AN = 1n;
const PHUOC_AN = 2n;

type Rep = { id: number; at: Date; reversed?: boolean; isReversal?: boolean };
/** Tương đương điều kiện LIVE_REPORT + orderBy createdAt asc + take 1 của kcs-pending: lần báo còn hiệu lực đầu tiên. */
const firstLive = (reports: Rep[]) =>
  [...reports]
    .filter((r) => !r.reversed && !r.isReversal)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, 1)
    .map((r) => ({ createdAt: r.at }));

interface Fx {
  cut: {
    status: 'CUTTING' | 'AWAITING_QC' | 'QC_DONE';
    pi: bigint;
    reports: Rep[];
    createdAt?: Date;
  }[];
  stepBatches: { pi: bigint; order: bigint | null; worker: string; at: Date }[];
  stepBundles: { pi: bigint; at: Date }[];
  batches: {
    stage: 'PHOI' | 'HAN' | 'SON';
    status: 'OPEN' | 'AWAITING_QC' | 'QC_DONE';
    pi: bigint;
    reports: Rep[];
  }[];
  pieceStepBatches: { pi: bigint; at: Date; step?: string }[];
  yieldBatches: { pi: bigint; at: Date }[];
  /** PI còn SKU ACTIVE. */
  activePis: bigint[];
  skuCount: Record<string, number>;
  /** Xưởng của từng PI (ProductionInvoiceItem.workshopId). */
  workshopOfPi: Record<string, bigint>;
}
const fx = (over: Partial<Fx> = {}): Fx => ({
  cut: [],
  stepBatches: [],
  stepBundles: [],
  batches: [],
  pieceStepBatches: [],
  yieldBatches: [],
  activePis: [45n, 46n],
  skuCount: {},
  workshopOfPi: { '45': PHU_AN, '46': PHUOC_AN },
  ...over,
});

function makeService(f: Fx) {
  const find = <T>(rows: T[]) => jest.fn(() => Promise.resolve(rows));
  const prisma = {
    cutBundle: {
      findMany: jest.fn(({ where }: { where: { status: { in: string[] } } }) =>
        Promise.resolve(
          f.cut
            .filter((c) => where.status.in.includes(c.status))
            .map((c) => ({
              status: c.status,
              createdAt: c.createdAt ?? ago(30),
              steelIssue: { productionInvoiceId: c.pi },
              floorReports: firstLive(c.reports),
            })),
        ),
      ),
    },
    stepBatch: {
      findMany: find(
        f.stepBatches.map((s) => ({
          productionInvoiceId: s.pi,
          materialId: 7n,
          step: 'UON',
          productionOrderId: s.order,
          reportedById: s.worker,
          createdAt: s.at,
          floorReports: [{ createdAt: s.at }],
        })),
      ),
    },
    stepBundle: {
      findMany: find(
        f.stepBundles.map((s) => ({
          productionInvoiceId: s.pi,
          submittedAt: s.at,
          batches: [{ createdAt: s.at, floorReports: [{ createdAt: s.at }] }],
        })),
      ),
    },
    productionBatch: {
      findMany: jest.fn(
        ({ where }: { where: { stage: { in: string[] }; status: { in: string[] } } }) =>
          Promise.resolve(
            f.batches
              .filter((b) => where.stage.in.includes(b.stage) && where.status.in.includes(b.status))
              .map((b) => ({
                stage: b.stage,
                status: b.status,
                reportedAt: ago(30),
                productionOrder: { productionInvoiceItem: { productionInvoiceId: b.pi } },
                floorReports: firstLive(b.reports),
              })),
          ),
      ),
    },
    pieceStepBatch: {
      findMany: find(
        f.pieceStepBatches.map((p) => ({
          productionOrderId: p.pi * 100n,
          pieceId: 5n,
          step: p.step ?? 'DAP',
          reportedAt: p.at,
          productionOrder: { productionInvoiceItem: { productionInvoiceId: p.pi } },
        })),
      ),
    },
    pieceStepBundle: { findMany: find([]) },
    materialYieldStepBatch: {
      findMany: find(
        f.yieldBatches.map((y) => ({
          productionInvoiceId: y.pi,
          recipeId: 3n,
          step: 'CAT',
          reportedAt: y.at,
        })),
      ),
    },
    materialYieldStepBundle: { findMany: find([]) },
    productionInvoice: {
      findMany: jest.fn(({ where }: { where: { id: { in: bigint[] } } }) =>
        Promise.resolve(where.id.in.filter((id) => f.activePis.includes(id)).map((id) => ({ id }))),
      ),
    },
    productionOrder: {
      findMany: jest.fn(
        ({
          where,
        }: {
          where: { productionInvoiceItem: { productionInvoiceId: { in: bigint[] } } };
        }) =>
          Promise.resolve(
            where.productionInvoiceItem.productionInvoiceId.in.flatMap((pi) =>
              Array.from({ length: f.skuCount[pi.toString()] ?? 1 }, (_, i) => ({
                id: pi * 100n + BigInt(i),
                productionInvoiceItem: { productionInvoiceId: pi },
              })),
            ),
          ),
      ),
    },
    // Xưởng hàng đợi (floor-queue-workshop.util): xưởng của PI; Phước An (2) nhờ Phú An (1) sơn.
    productionInvoiceItem: {
      findMany: jest.fn(({ where }: { where: { productionInvoiceId: { in: bigint[] } } }) =>
        Promise.resolve(
          where.productionInvoiceId.in
            .filter((id) => f.workshopOfPi[id.toString()] != null)
            .map((id) => ({ productionInvoiceId: id, workshopId: f.workshopOfPi[id.toString()] })),
        ),
      ),
    },
    workshop: {
      findMany: jest.fn().mockResolvedValue([
        { id: PHU_AN, paintWorkshopId: null },
        { id: PHUOC_AN, paintWorkshopId: PHU_AN },
      ]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    warehouse: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const users: Record<string, unknown> = {
    'qlsx-phu': { workshopId: PHU_AN, workshop: { name: 'Phú An', paintsFor: [{ id: PHUOC_AN }] } },
    'qlsx-pa': { workshopId: PHUOC_AN, workshop: { name: 'Phước An', paintsFor: [] } },
  };
  const scope = new WorkshopScopeService({
    user: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(users[where.id] ?? null),
      ),
    },
  } as never);
  const service = new FloorAdminService(
    prisma as unknown as PrismaServiceType,
    {} as never,
    {} as never,
    scope,
  );
  return { service, prisma };
}

const rep = (hoursAgo: number, extra: Partial<Rep> = {}): Rep => ({
  id: Math.floor(Math.random() * 1e9),
  at: ago(hoursAgo),
  ...extra,
});

describe('UB12 AC16 - summary theo tổ cho QLSX gắn xưởng', () => {
  /** Phú An (PI 45): tổ Phôi 3 đợt đang mở (1 đợt lần báo đầu cách 5 giờ) + 1 đợt cắt đã chốt (6 giờ). Phước An (PI 46): 2 đợt Phôi quá 4 giờ. */
  const dataAc16 = () =>
    fx({
      cut: [
        { status: 'CUTTING', pi: 45n, reports: [rep(5)] },
        { status: 'CUTTING', pi: 45n, reports: [rep(1)] },
        { status: 'CUTTING', pi: 45n, reports: [rep(0.5)] },
        { status: 'AWAITING_QC', pi: 45n, reports: [rep(6)] },
        { status: 'CUTTING', pi: 46n, reports: [rep(7)] },
        { status: 'CUTTING', pi: 46n, reports: [rep(9)] },
      ],
    });

  it('AC16: QLSX Phú An nhận PHOI = { open: 3, awaitingKcs: 1, stale: 2 }, không lẫn đợt của Phước An', async () => {
    const { service } = makeService(dataAc16());

    const r = await service.summary('qlsx-phu', NOW);

    expect(r.PHOI).toEqual({ open: 3, awaitingKcs: 1, stale: 2 });
    expect(r.HAN).toEqual({ open: 0, awaitingKcs: 0, stale: 0 });
    expect(r.SON).toEqual({ open: 0, awaitingKcs: 0, stale: 0 });
  });

  it('AC16: số đỏ menu "Sản lượng xưởng" = Σ stale của 3 tổ ở Phú An = 2 (không tính 2 đợt quá hạn của Phước An)', async () => {
    const { service } = makeService(dataAc16());

    const r = await service.summary('qlsx-phu', NOW);

    expect(r.PHOI.stale + r.HAN.stale + r.SON.stale).toBe(2);
  });

  it('AC16: QLSX Phước An nhận PHOI = { open: 2, awaitingKcs: 0, stale: 2 } (đúng đợt của xưởng mình)', async () => {
    const { service } = makeService(dataAc16());

    expect((await service.summary('qlsx-pa', NOW)).PHOI).toEqual({
      open: 2,
      awaitingKcs: 0,
      stale: 2,
    });
  });

  it('AC16: QLSX KHÔNG gắn xưởng thấy đủ cả 2 xưởng: { open: 5, awaitingKcs: 1, stale: 4 }', async () => {
    const { service } = makeService(dataAc16());

    expect((await service.summary('qlsx-chung', NOW)).PHOI).toEqual({
      open: 5,
      awaitingKcs: 1,
      stale: 4,
    });
  });

  it('AC16: tổ Sơn - lô Sơn của lệnh Phước An (sơn nhờ ở Phú An) tính vào QLSX Phú An, KHÔNG tính vào QLSX Phước An', async () => {
    const { service } = makeService(
      fx({ batches: [{ stage: 'SON', status: 'OPEN', pi: 46n, reports: [rep(5)] }] }),
    );

    expect((await service.summary('qlsx-phu', NOW)).SON).toEqual({
      open: 1,
      awaitingKcs: 0,
      stale: 1,
    });
    expect((await service.summary('qlsx-pa', NOW)).SON).toEqual({
      open: 0,
      awaitingKcs: 0,
      stale: 0,
    });
  });

  it('AC16: khoá luôn đủ 3 tổ x 3 số kể cả khi không có đợt nào (FE không phải xử lý thiếu khoá)', async () => {
    const { service } = makeService(fx());

    expect(await service.summary('qlsx-phu', NOW)).toEqual({
      PHOI: { open: 0, awaitingKcs: 0, stale: 0 },
      HAN: { open: 0, awaitingKcs: 0, stale: 0 },
      SON: { open: 0, awaitingKcs: 0, stale: 0 },
    });
  });
});

describe('UB12 AC17 - mốc 4 giờ tính từ giờ lần báo đầu, `now` truyền vào', () => {
  const T0 = new Date('2026-11-18T08:02:00Z'); // lần báo đầu; 12:00 là 3 giờ 58 phút sau

  it('AC17: 3 giờ 58 phút - chưa tính; 4 giờ 01 phút - tính (chỉ đổi `now`, dữ liệu giữ nguyên)', async () => {
    const { service } = makeService(
      fx({ cut: [{ status: 'CUTTING', pi: 45n, reports: [{ id: 1, at: T0 }] }] }),
    );

    const at358 = new Date(T0.getTime() + (3 * 60 + 58) * 60_000);
    const at401 = new Date(T0.getTime() + (4 * 60 + 1) * 60_000);

    expect((await service.summary('qlsx-phu', at358)).PHOI.stale).toBe(0);
    expect((await service.summary('qlsx-phu', at401)).PHOI.stale).toBe(1);
    // đợt vẫn đang mở ở cả 2 thời điểm: "open" không phụ thuộc mốc
    expect((await service.summary('qlsx-phu', at358)).PHOI.open).toBe(1);
    expect((await service.summary('qlsx-phu', at401)).PHOI.open).toBe(1);
  });

  it('AC17: ngưỡng là KCS_STALE_HOURS = 4 giờ (đổi hằng số thì test này báo)', () => {
    expect(KCS_STALE_HOURS).toBe(4);
  });

  it('AC17: KCS chấm xong đợt quá hạn -> đợt rời danh sách, stale về 0 ở lần hỏi kế (FE nghe qc-reviews rồi gọi lại)', async () => {
    const f = fx({ cut: [{ status: 'AWAITING_QC', pi: 45n, reports: [rep(5)] }] });
    const { service } = makeService(f);
    expect((await service.summary('qlsx-phu', NOW)).PHOI).toEqual({
      open: 0,
      awaitingKcs: 1,
      stale: 1,
    });

    f.cut[0].status = 'QC_DONE';

    expect((await service.summary('qlsx-phu', NOW)).PHOI).toEqual({
      open: 0,
      awaitingKcs: 0,
      stale: 0,
    });
  });

  it('AC17: QLSX hủy lần báo ĐẦU (đã cũ) -> mốc chờ nhảy sang lần báo còn hiệu lực kế tiếp, stale giảm', async () => {
    const { service } = makeService(
      fx({
        cut: [
          {
            status: 'CUTTING',
            pi: 45n,
            reports: [rep(6, { reversed: true }), rep(5.5, { isReversal: true }), rep(1)],
          },
        ],
      }),
    );

    expect((await service.summary('qlsx-phu', NOW)).PHOI.stale).toBe(0);
  });

  it('AC17: đợt cắt không còn sổ báo nào (dữ liệu cũ) -> mốc = giờ tạo đợt, không NaN / không tự tính quá hạn', async () => {
    const { service } = makeService(
      fx({ cut: [{ status: 'CUTTING', pi: 45n, reports: [], createdAt: ago(2) }] }),
    );

    expect((await service.summary('qlsx-phu', NOW)).PHOI).toEqual({
      open: 1,
      awaitingKcs: 0,
      stale: 0,
    });
  });
});

describe('UB12 AC11 / MF6 - lệnh tạm dừng không vào số đỏ QLSX', () => {
  it('AC11: lô Hàn đang mở của lệnh đã Tạm dừng -> open 0, stale 0 dù lần báo đầu cách 10 giờ', async () => {
    const { service } = makeService(
      fx({
        activePis: [46n],
        batches: [{ stage: 'HAN', status: 'OPEN', pi: 45n, reports: [rep(10)] }],
      }),
    );

    expect((await service.summary('qlsx-phu', NOW)).HAN).toEqual({
      open: 0,
      awaitingKcs: 0,
      stale: 0,
    });
  });

  it('MF6 / Q3: đợt ĐÃ CHỐT rồi lệnh mới dừng -> không tính awaitingKcs và không tính stale (cả đợt cắt lẫn lô mảnh)', async () => {
    const { service } = makeService(
      fx({
        activePis: [46n],
        cut: [{ status: 'AWAITING_QC', pi: 45n, reports: [rep(8)] }],
        batches: [{ stage: 'HAN', status: 'AWAITING_QC', pi: 45n, reports: [rep(8)] }],
      }),
    );

    const r = await service.summary('qlsx-phu', NOW);

    expect(r.PHOI).toEqual({ open: 0, awaitingKcs: 0, stale: 0 });
    expect(r.HAN).toEqual({ open: 0, awaitingKcs: 0, stale: 0 });
  });

  it('AC11: Tiếp tục lệnh (PI active lại) -> các đợt quay lại số đỏ', async () => {
    const f = fx({
      activePis: [],
      batches: [{ stage: 'HAN', status: 'OPEN', pi: 45n, reports: [rep(5)] }],
    });
    const { service } = makeService(f);
    expect((await service.summary('qlsx-phu', NOW)).HAN.stale).toBe(0);

    f.activePis = [45n];

    expect((await service.summary('qlsx-phu', NOW)).HAN).toEqual({
      open: 1,
      awaitingKcs: 0,
      stale: 1,
    });
  });
});

describe('UB12 AC12 / MF5 - nhóm công đoạn phụ chưa gắn SKU', () => {
  const stepRows = (order: bigint | null) => [{ pi: 45n, order, worker: 'cn-an', at: ago(5) }];

  it('MF5: PI 1 SKU - dòng chưa gắn SKU gộp vào nhóm SKU duy nhất cùng người: open 1 (không phải 2), stale 1', async () => {
    const { service } = makeService(
      fx({
        skuCount: { '45': 1 },
        stepBatches: [...stepRows(null), { pi: 45n, order: 4500n, worker: 'cn-an', at: ago(1) }],
      }),
    );

    expect((await service.summary('qlsx-phu', NOW)).PHOI).toEqual({
      open: 1,
      awaitingKcs: 0,
      stale: 1,
    });
  });

  it('AC12: PI NHIỀU SKU - nhóm chưa gắn SKU là dòng xám: không vào open, không vào stale; nhóm có SKU vẫn tính', async () => {
    const { service } = makeService(
      fx({
        skuCount: { '45': 2 },
        stepBatches: [...stepRows(null), { pi: 45n, order: 4500n, worker: 'cn-an', at: ago(1) }],
      }),
    );

    // chỉ nhóm có SKU (1 giờ trước): open 1, stale 0. Nhóm null (5 giờ trước) bị loại cả khỏi stale.
    expect((await service.summary('qlsx-phu', NOW)).PHOI).toEqual({
      open: 1,
      awaitingKcs: 0,
      stale: 0,
    });
  });
});

describe('UB12 - pat / chân nhôm (không có sổ báo)', () => {
  it('pat và chân nhôm đang mở: KHÔNG vào open (không hủy được từng lần), vẫn vào stale khi quá 4 giờ', async () => {
    const { service } = makeService(
      fx({
        pieceStepBatches: [
          { pi: 45n, at: ago(6) },
          { pi: 45n, at: ago(1), step: 'KHOAN' },
        ],
        yieldBatches: [{ pi: 45n, at: ago(5) }],
      }),
    );

    expect((await service.summary('qlsx-phu', NOW)).PHOI).toEqual({
      open: 0,
      awaitingKcs: 0,
      stale: 2,
    });
  });
});
