import { Logger } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { NOTIFICATION_TYPES } from '../notifications/notification-types';
import { NotificationsService } from '../notifications/notifications.service';
import { RecipientResolverService } from '../notifications/recipient-resolver.service';
import { PaintTransferReminderService } from '../warehouse-transfers/paint-transfer-reminder.service';
import { CutAllocationFollowUpService } from './cut-allocation-follow-up.service';
import { CutAllocationService } from './cut-allocation.service';
import { FloorAdminService } from './floor-admin.service';
import { FloorStageService } from './floor-stage.service';
import { FloorAlertsService } from './floor-alerts.service';

/**
 * UB11 (P1 "KCS tự chuyển", tester-unit #3) - tin KCS_BATCH_STALE qua nhiều lượt quét liên tiếp.
 *
 * Spec của Dev (floor-alerts.service.spec.ts) giả lập listKcsPendingItems và kiểm từng lời gọi emit / resolve. Ở đây:
 * - kcs-pending.util + groupStaleByQueueWorkshop THẬT trên DB giả (mốc 4 giờ đi từ giờ lần báo + `now` truyền vào);
 * - kho tin nhắn giả CÓ TRẠNG THÁI (emit / updateOpenContent / resolve làm đổi tin đang mở) nên kiểm được kết quả cuối của cả
 *   chuỗi "quét -> thêm đợt -> quét -> chấm hết -> quét" như AC18 mô tả, thay vì từng lời gọi rời (AC17, AC18, D2 / MF2, MF6).
 */

const H = 3_600_000;
const NOW = new Date('2026-11-18T12:00:00Z');
const ago = (hours: number, from = NOW) => new Date(from.getTime() - hours * H);
const PHU_AN = 1n;
const PHUOC_AN = 2n;

type Rep = { at: Date; reversed?: boolean };
const firstLive = (reports: Rep[]) =>
  [...reports]
    .filter((r) => !r.reversed)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, 1)
    .map((r) => ({ createdAt: r.at }));

interface Fx {
  cut: { status: 'CUTTING' | 'AWAITING_QC' | 'QC_DONE'; pi: bigint; reports: Rep[] }[];
  stepBatches: { pi: bigint; order: bigint | null; worker: string; at: Date }[];
  batches: {
    stage: 'PHOI' | 'HAN' | 'SON';
    status: 'OPEN' | 'AWAITING_QC' | 'QC_DONE';
    pi: bigint;
    reports: Rep[];
  }[];
  pieceStepBatches: { pi: bigint; at: Date }[];
  yieldBatches: { pi: bigint; at: Date }[];
  activePis: bigint[];
  skuCount: Record<string, number>;
  workshopOfPi: Record<string, bigint>;
}

type Notif = {
  id: number;
  type: string;
  entityType: string;
  entityId: string;
  dedupeKey: string;
  data: Record<string, unknown>;
  open: boolean;
};

function build() {
  const f: Fx = {
    cut: [],
    stepBatches: [],
    batches: [],
    pieceStepBatches: [],
    yieldBatches: [],
    activePis: [45n, 46n],
    skuCount: {},
    workshopOfPi: { '45': PHU_AN, '46': PHUOC_AN },
  };
  const store: Notif[] = [];
  let seq = 0;
  const inType = (t: unknown, type: string) =>
    typeof t === 'string'
      ? t === type
      : Array.isArray((t as { in?: string[] })?.in) && (t as { in: string[] }).in.includes(type);

  const find = <T>(fn: () => T[]) => jest.fn(() => Promise.resolve(fn()));
  const prisma = {
    // ── bảng đợt (kcs-pending.util thật) ──
    cutBundle: {
      findMany: jest.fn(({ where }: { where: { status: { in: string[] } } }) =>
        Promise.resolve(
          f.cut
            .filter((c) => where.status.in.includes(c.status))
            .map((c) => ({
              status: c.status,
              createdAt: ago(40),
              steelIssue: { productionInvoiceId: c.pi },
              floorReports: firstLive(c.reports),
            })),
        ),
      ),
    },
    stepBatch: {
      findMany: find(() =>
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
    stepBundle: { findMany: find(() => []) },
    productionBatch: {
      findMany: jest.fn(
        ({ where }: { where: { stage: { in: string[] }; status: { in: string[] } } }) =>
          Promise.resolve(
            f.batches
              .filter((b) => where.stage.in.includes(b.stage) && where.status.in.includes(b.status))
              .map((b) => ({
                stage: b.stage,
                status: b.status,
                reportedAt: ago(40),
                productionOrder: { productionInvoiceItem: { productionInvoiceId: b.pi } },
                floorReports: firstLive(b.reports),
              })),
          ),
      ),
    },
    pieceStepBatch: {
      findMany: find(() =>
        f.pieceStepBatches.map((p) => ({
          productionOrderId: p.pi * 100n,
          pieceId: 5n,
          step: 'DAP',
          reportedAt: p.at,
          productionOrder: { productionInvoiceItem: { productionInvoiceId: p.pi } },
        })),
      ),
    },
    pieceStepBundle: { findMany: find(() => []) },
    materialYieldStepBatch: {
      findMany: find(() =>
        f.yieldBatches.map((y) => ({
          productionInvoiceId: y.pi,
          recipeId: 3n,
          step: 'CAT',
          reportedAt: y.at,
        })),
      ),
    },
    materialYieldStepBundle: { findMany: find(() => []) },
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
    // ── xưởng hàng đợi ──
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
      findMany: jest.fn(({ where }: { where: { id: { in: bigint[] } } }) =>
        Promise.resolve(
          [
            { id: PHU_AN, name: 'Phú An', paintWorkshopId: null },
            { id: PHUOC_AN, name: 'Phước An', paintWorkshopId: PHU_AN },
          ].filter((w) => where.id.in.includes(w.id)),
        ),
      ),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    warehouse: { findUnique: jest.fn().mockResolvedValue(null) },
    // ── các bước khác của evaluate(): để trống ──
    floorQueueEntry: { findMany: jest.fn().mockResolvedValue([]) },
    workstation: { findMany: jest.fn().mockResolvedValue([]) },
    // ── kho tin nhắn có trạng thái ──
    notification: {
      findFirst: jest.fn(({ where }: { where: { type: string; dedupeKey?: string } }) => {
        const n = store.find(
          (x) =>
            x.open &&
            inType(where.type, x.type) &&
            (!where.dedupeKey || x.dedupeKey === where.dedupeKey),
        );
        return Promise.resolve(n ? { id: n.id, data: n.data } : null);
      }),
      findMany: jest.fn(({ where }: { where: { type: unknown } }) =>
        Promise.resolve(
          store
            .filter((x) => x.open && inType(where.type, x.type))
            .map((x) => ({ entityId: x.entityId })),
        ),
      ),
    },
  };
  const notifications = {
    emit: jest.fn(
      (
        type: string,
        o: { entityId: string; dedupeKey: string; params: Record<string, unknown> },
      ) => {
        store.push({
          id: ++seq,
          type,
          entityType: (NOTIFICATION_TYPES as Record<string, { entityType: string }>)[type]
            .entityType,
          entityId: o.entityId,
          dedupeKey: o.dedupeKey,
          data: { ...o.params },
          open: true,
        });
        return Promise.resolve(undefined);
      },
    ),
    updateOpenContent: jest.fn(
      (type: string, dedupeKey: string, params: Record<string, unknown>) => {
        const n = store.find((x) => x.open && x.type === type && x.dedupeKey === dedupeKey);
        if (!n) return Promise.resolve(false);
        n.data = { ...params };
        return Promise.resolve(true);
      },
    ),
    resolve: jest.fn((o: { entityType: string; entityId: string; types?: string[] }) => {
      for (const n of store) {
        if (
          n.open &&
          n.entityType === o.entityType &&
          n.entityId === o.entityId &&
          (!o.types || o.types.includes(n.type))
        ) {
          n.open = false;
        }
      }
      return Promise.resolve(undefined);
    }),
  };
  const service = new FloorAlertsService(
    prisma as unknown as PrismaServiceType,
    { autoCompletePhoi: jest.fn() } as unknown as FloorAdminService,
    { progressMap: jest.fn().mockResolvedValue(new Map()) } as unknown as FloorStageService,
    notifications as unknown as NotificationsService,
    {
      machineProgressByWorkshop: jest.fn().mockResolvedValue([]),
      autoPull: jest.fn().mockResolvedValue(null),
      steelGapsByPi: jest.fn().mockResolvedValue(new Map()),
      startedAllocationPiIds: jest.fn().mockResolvedValue([]),
    } as unknown as CutAllocationService,
    { publishEntityChanged: jest.fn() } as unknown as RealtimeService,
    {
      afterAllocated: jest.fn().mockResolvedValue(undefined),
    } as unknown as CutAllocationFollowUpService,
    { syncAll: jest.fn().mockResolvedValue(undefined) } as unknown as PaintTransferReminderService,
  );
  const open = (type = 'KCS_BATCH_STALE') => store.filter((n) => n.open && n.type === type);
  return { f, store, prisma, notifications, service, open };
}

const rep = (hoursAgo: number, from = NOW): Rep => ({ at: ago(hoursAgo, from) });
const cut = (pi: bigint, hours: number, status: 'CUTTING' | 'AWAITING_QC' = 'CUTTING') => ({
  status,
  pi,
  reports: [rep(hours)],
});
const hanBatch = (pi: bigint, hours: number, status: 'OPEN' | 'AWAITING_QC' = 'OPEN') => ({
  stage: 'HAN' as const,
  status,
  pi,
  reports: [rep(hours)],
});

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  delete process.env.FLOOR_ALERTS;
  delete process.env.CUT_AUTO_PULL;
});
afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.FLOOR_ALERTS;
  jest.useRealTimers();
});

describe('UB11 AC18 - chuỗi: quét -> thêm đợt quá hạn -> quét -> KCS chấm hết -> quét', () => {
  it('AC18: tổ Hàn Phú An có 2 đợt quá 4 giờ (1 mở, 1 đã chốt), Phước An 0, còn tin FLOOR_BATCH_STALE cũ - 1 tin KCS_BATCH_STALE số 2 đúng xưởng, tin cũ bị đóng', async () => {
    const h = build();
    h.f.batches = [
      hanBatch(45n, 5),
      hanBatch(45n, 6, 'AWAITING_QC'),
      hanBatch(45n, 1),
      hanBatch(46n, 2),
    ];
    h.store.push({
      id: 900,
      type: 'FLOOR_BATCH_STALE',
      entityType: 'FLOOR_STAGE',
      entityId: 'HAN:1',
      dedupeKey: 'FLOOR_BATCH_STALE:HAN:1',
      data: { count: 1 },
      open: true,
    });

    await h.service.evaluate(NOW);

    const tins = h.open();
    expect(tins).toHaveLength(1);
    expect(tins[0]).toMatchObject({ entityId: 'HAN:1', dedupeKey: 'KCS_BATCH_STALE:HAN:1' });
    expect(tins[0].data).toMatchObject({
      stage: 'HAN',
      count: 2,
      hours: 4,
      workshopId: '1',
      workshopName: 'Phú An',
    });
    // tin kiểu cũ đóng, không phát lại
    expect(h.open('FLOOR_BATCH_STALE')).toHaveLength(0);
    expect(h.notifications.emit).not.toHaveBeenCalledWith('FLOOR_BATCH_STALE', expect.anything());
    // câu hiển thị
    const def = NOTIFICATION_TYPES.KCS_BATCH_STALE;
    const title = def.title(tins[0].data);
    expect(title).toContain('Tổ Hàn');
    expect(title).toContain('Phú An');
    expect(title).toContain('2 đợt chờ KCS chấm quá 4 giờ');
  });

  it('AC18: có thêm đợt quá hạn -> CHÍNH tin đó đổi số thành 3, không tạo tin mới; quét lần nữa không đổi gì', async () => {
    const h = build();
    h.f.batches = [hanBatch(45n, 5), hanBatch(45n, 6, 'AWAITING_QC')];
    await h.service.evaluate(NOW);
    const firstId = h.open()[0].id;

    h.f.batches.push(hanBatch(45n, 4.5));
    await h.service.evaluate(NOW);

    expect(h.store.filter((n) => n.type === 'KCS_BATCH_STALE')).toHaveLength(1);
    expect(h.open()[0].id).toBe(firstId);
    expect(h.open()[0].data.count).toBe(3);
    expect(h.notifications.emit).toHaveBeenCalledTimes(1);

    h.notifications.emit.mockClear();
    h.notifications.updateOpenContent.mockClear();
    await h.service.evaluate(NOW);
    expect(h.notifications.emit).not.toHaveBeenCalled();
    expect(h.notifications.updateOpenContent).not.toHaveBeenCalled();
  });

  it('AC18: KCS chấm hết -> tin tự đóng ở lượt quét kế; không còn tin mở', async () => {
    const h = build();
    h.f.batches = [hanBatch(45n, 5), hanBatch(45n, 6, 'AWAITING_QC')];
    await h.service.evaluate(NOW);
    expect(h.open()).toHaveLength(1);

    for (const b of h.f.batches) b.status = 'QC_DONE';
    await h.service.evaluate(NOW);

    expect(h.open()).toHaveLength(0);
    expect(h.store.filter((n) => n.type === 'KCS_BATCH_STALE')).toHaveLength(1);
  });

  it('AC18: đợt mới (chưa quá 4 giờ) không làm đổi tin; chỉ khi quá mốc mới được cộng', async () => {
    const h = build();
    h.f.batches = [hanBatch(45n, 5)];
    await h.service.evaluate(NOW);
    h.f.batches.push(hanBatch(45n, 0.5));

    await h.service.evaluate(NOW);

    expect(h.open()[0].data.count).toBe(1);
    // 4 giờ sau, đợt mới cũng quá hạn
    await h.service.evaluate(new Date(NOW.getTime() + 4 * H));
    expect(h.open()[0].data.count).toBe(2);
  });

  it('AC18: 5 loại đợt đều vào tin - đợt cắt, nhóm công đoạn, lô mảnh, pat, chân nhôm cùng ở Phú An tổ Phôi quá hạn = 1 tin số 5', async () => {
    const h = build();
    h.f.cut = [cut(45n, 5)];
    h.f.stepBatches = [{ pi: 45n, order: 4500n, worker: 'cn-an', at: ago(5) }];
    h.f.batches = [{ stage: 'PHOI', status: 'OPEN', pi: 45n, reports: [rep(5)] }];
    h.f.pieceStepBatches = [{ pi: 45n, at: ago(5) }];
    h.f.yieldBatches = [{ pi: 45n, at: ago(5) }];

    await h.service.evaluate(NOW);

    expect(h.open()).toHaveLength(1);
    expect(h.open()[0]).toMatchObject({ entityId: 'PHOI:1' });
    expect(h.open()[0].data.count).toBe(5);
  });
});

describe('UB11 AC18 - người nhận: mọi KCS, QLSX cùng xưởng, QLSX không gắn xưởng; QLSX xưởng khác không nhận', () => {
  it('params của tin tổ Hàn - Phú An chạy qua bộ lọc người nhận thật: QLSX Phước An bị bỏ, KCS / QLSX Phú An / QLSX chung giữ', async () => {
    const h = build();
    h.f.batches = [hanBatch(45n, 5)];
    await h.service.evaluate(NOW);
    const tin = h.open()[0];
    const prisma = {
      user: {
        // chỉ QLSX ĐÃ gắn xưởng mới bị xét
        findMany: jest.fn().mockResolvedValue([
          { id: 'qlsx-phu', workshopId: PHU_AN },
          { id: 'qlsx-pa', workshopId: PHUOC_AN },
        ]),
      },
      productionInvoice: { findUnique: jest.fn() },
      productionOrder: { findUnique: jest.fn() },
      cuttingProposal: { findUnique: jest.fn() },
      productionInvoiceItem: { findMany: jest.fn() },
    };
    const resolver = new RecipientResolverService(prisma as never);

    const ids = await resolver.dropQlsxOfOtherWorkshops(
      ['kcs-1', 'kcs-2', 'qlsx-phu', 'qlsx-pa', 'qlsx-chung'],
      { entityType: tin.entityType, entityId: tin.entityId, params: tin.data },
    );

    expect(ids).toEqual(['kcs-1', 'kcs-2', 'qlsx-phu', 'qlsx-chung']);
  });

  it('tin của nhóm "none" (không suy ra được xưởng) không có workshopId: không loại QLSX nào', async () => {
    const h = build();
    h.f.workshopOfPi = {}; // PI không có xưởng, không có xưởng mặc định
    h.f.batches = [hanBatch(45n, 5)];
    await h.service.evaluate(NOW);
    const tin = h.open()[0];
    expect(tin.entityId).toBe('HAN:none');
    expect(tin.data).not.toHaveProperty('workshopId');
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'qlsx-phu', workshopId: PHU_AN }]),
      },
      productionInvoice: { findUnique: jest.fn() },
      productionOrder: { findUnique: jest.fn() },
      cuttingProposal: { findUnique: jest.fn() },
      productionInvoiceItem: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const resolver = new RecipientResolverService(prisma as never);

    const ids = await resolver.dropQlsxOfOtherWorkshops(['kcs-1', 'qlsx-phu', 'qlsx-chung'], {
      entityType: tin.entityType,
      entityId: tin.entityId,
      params: tin.data,
    });

    expect(ids).toEqual(['kcs-1', 'qlsx-phu', 'qlsx-chung']);
  });
});

describe('UB11 D2 / MF2 - cùng tổ, 2 xưởng', () => {
  it('xưởng B hết quá hạn: tin xưởng A KHÔNG bị đóng, KHÔNG sinh tin mới, chỉ tin của B đóng', async () => {
    const h = build();
    h.f.cut = [cut(45n, 5), cut(45n, 6), cut(46n, 7), cut(46n, 8), cut(46n, 9)];
    await h.service.evaluate(NOW);
    expect(
      h
        .open()
        .map((n) => [n.entityId, n.data.count])
        .sort(),
    ).toEqual([
      ['PHOI:1', 2],
      ['PHOI:2', 3],
    ]);
    const idA = h.open().find((n) => n.entityId === 'PHOI:1')!.id;
    h.notifications.emit.mockClear();

    // Phước An: KCS chấm hết
    h.f.cut = h.f.cut.filter((c) => c.pi === 45n);
    await h.service.evaluate(NOW);

    expect(h.open().map((n) => [n.entityId, n.id])).toEqual([['PHOI:1', idA]]);
    expect(h.notifications.emit).not.toHaveBeenCalled();
    expect(h.store.filter((n) => n.type === 'KCS_BATCH_STALE')).toHaveLength(2);
  });

  it('xưởng A đổi số trong khi xưởng B đứng yên: chỉ tin A đổi; tin B giữ nguyên số và id', async () => {
    const h = build();
    h.f.cut = [cut(45n, 5), cut(46n, 7)];
    await h.service.evaluate(NOW);
    const idB = h.open().find((n) => n.entityId === 'PHOI:2')!.id;

    h.f.cut.push(cut(45n, 6));
    await h.service.evaluate(NOW);

    const byEntity = Object.fromEntries(h.open().map((n) => [n.entityId, n]));
    expect(byEntity['PHOI:1'].data.count).toBe(2);
    expect(byEntity['PHOI:2'].data.count).toBe(1);
    expect(byEntity['PHOI:2'].id).toBe(idB);
  });

  it('lô Sơn của lệnh Phước An (sơn nhờ ở Phú An) vào tin SON:1 (xưởng sơn), không vào SON:2', async () => {
    const h = build();
    h.f.batches = [{ stage: 'SON', status: 'OPEN', pi: 46n, reports: [rep(5)] }];

    await h.service.evaluate(NOW);

    expect(h.open().map((n) => n.entityId)).toEqual(['SON:1']);
  });

  it('tin FLOOR_BATCH_STALE cũ ở BẤT KỲ khoá nào (kể cả kiểu cũ chỉ có tổ) đều đóng, kể cả khi không có đợt nào quá hạn', async () => {
    const h = build();
    for (const [i, id] of ['PHOI', 'HAN:1', 'SON:none'].entries()) {
      h.store.push({
        id: 800 + i,
        type: 'FLOOR_BATCH_STALE',
        entityType: 'FLOOR_STAGE',
        entityId: id,
        dedupeKey: `FLOOR_BATCH_STALE:${id}`,
        data: { count: 1 },
        open: true,
      });
    }

    await h.service.evaluate(NOW);

    expect(h.open('FLOOR_BATCH_STALE')).toHaveLength(0);
    expect(h.open()).toHaveLength(0);
  });
});

describe('UB11 AC17 - mốc 4 giờ với `now` truyền vào (không chờ thật)', () => {
  const T0 = new Date('2026-11-18T08:02:00Z');

  it('AC17: lần báo đầu cách 3 giờ 58 phút - chưa có tin; qua 4 giờ 01 phút - có tin', async () => {
    const h = build();
    h.f.cut = [{ status: 'CUTTING', pi: 45n, reports: [{ at: T0 }] }];

    await h.service.evaluate(new Date(T0.getTime() + (3 * 60 + 58) * 60_000));
    expect(h.open()).toHaveLength(0);
    expect(h.notifications.emit).not.toHaveBeenCalled();

    await h.service.evaluate(new Date(T0.getTime() + (4 * 60 + 1) * 60_000));
    expect(h.open()).toHaveLength(1);
    expect(h.open()[0].data.count).toBe(1);
  });

  it('AC17: KCS chấm xong đợt đó sau mốc -> lượt quét kế đóng tin', async () => {
    const h = build();
    h.f.cut = [{ status: 'CUTTING', pi: 45n, reports: [{ at: T0 }] }];
    const later = new Date(T0.getTime() + (4 * 60 + 1) * 60_000);
    await h.service.evaluate(later);
    expect(h.open()).toHaveLength(1);

    h.f.cut[0].status = 'QC_DONE';
    await h.service.evaluate(later);

    expect(h.open()).toHaveLength(0);
  });

  it('AC17: QLSX hủy lần báo đầu (đã cũ), còn lần báo mới - mốc tính từ lần còn hiệu lực, không có tin', async () => {
    const h = build();
    h.f.cut = [
      {
        status: 'CUTTING',
        pi: 45n,
        reports: [{ at: ago(9), reversed: true }, { at: ago(1) }],
      },
    ];

    await h.service.evaluate(NOW);

    expect(h.open()).toHaveLength(0);
  });
});

describe('UB11 AC11 / MF6 / AC12 / MF5 - dòng xám không vào tin', () => {
  it('AC11: lô mở của lệnh đang Tạm dừng, quá 10 giờ - không tin; Tiếp tục thì có tin', async () => {
    const h = build();
    h.f.activePis = [46n];
    h.f.batches = [hanBatch(45n, 10)];

    await h.service.evaluate(NOW);
    expect(h.open()).toHaveLength(0);

    h.f.activePis = [45n, 46n];
    await h.service.evaluate(NOW);
    expect(h.open().map((n) => n.entityId)).toEqual(['HAN:1']);
  });

  it('MF6 / Q3: đợt ĐÃ CHỐT rồi lệnh mới dừng - không tin; tin đang mở của đợt đó tự đóng ở lượt quét kế', async () => {
    const h = build();
    h.f.cut = [cut(45n, 8, 'AWAITING_QC')];
    await h.service.evaluate(NOW);
    expect(h.open()).toHaveLength(1);

    h.f.activePis = [46n]; // QLSX Tạm dừng lệnh 45
    await h.service.evaluate(NOW);

    expect(h.open()).toHaveLength(0);
  });

  it('AC12: PI nhiều SKU có nhóm chưa gắn SKU quá hạn - không tin; PI 1 SKU thì dòng đó gộp vào nhóm SKU duy nhất và tính 1', async () => {
    const h = build();
    h.f.skuCount = { '45': 2, '46': 1 };
    h.f.stepBatches = [
      { pi: 45n, order: null, worker: 'cn-an', at: ago(6) }, // PI nhiều SKU, chưa gắn SKU: xám
      { pi: 46n, order: null, worker: 'cn-an', at: ago(6) }, // PI 1 SKU: gộp
      { pi: 46n, order: 4600n, worker: 'cn-an', at: ago(5) },
    ];

    await h.service.evaluate(NOW);

    expect(h.open().map((n) => [n.entityId, n.data.count])).toEqual([['PHOI:2', 1]]);
  });
});

describe('UB11 - công tắc FLOOR_ALERTS=off', () => {
  it('requestEvaluate (thường lẫn urgent) không chạy lượt quét nào, không đụng tin đang mở; bỏ công tắc thì chạy', async () => {
    jest.useFakeTimers();
    const h = build();
    h.f.cut = [cut(45n, 5)];
    process.env.FLOOR_ALERTS = 'off';

    h.service.requestEvaluate();
    h.service.requestEvaluate({ urgent: true });
    await jest.advanceTimersByTimeAsync(120_000);

    expect(h.prisma.cutBundle.findMany).not.toHaveBeenCalled();
    expect(h.store).toHaveLength(0);

    // đối chứng: cùng dữ liệu, công tắc bật -> có chạy (test không "xanh vì chưa từng chạy")
    delete process.env.FLOOR_ALERTS;
    h.service.requestEvaluate({ urgent: true });
    await jest.advanceTimersByTimeAsync(120_000);
    expect(h.prisma.cutBundle.findMany).toHaveBeenCalled();
    h.service.onModuleDestroy();
  });

  it('onModuleInit với FLOOR_ALERTS=off không hẹn lượt quét định kỳ nào', async () => {
    jest.useFakeTimers();
    const h = build();
    process.env.FLOOR_ALERTS = 'off';
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production'; // NODE_ENV=test cũng thoát sớm - đổi để chỉ công tắc quyết định

    try {
      h.service.onModuleInit();
      await jest.advanceTimersByTimeAsync(30 * 60_000);
    } finally {
      process.env.NODE_ENV = prevEnv;
    }

    expect(h.prisma.cutBundle.findMany).not.toHaveBeenCalled();
    h.service.onModuleDestroy();

    // đối chứng: bỏ công tắc thì lượt đầu (sau 60 giây) có chạy
    delete process.env.FLOOR_ALERTS;
    const h2 = build();
    process.env.NODE_ENV = 'production';
    try {
      h2.service.onModuleInit();
      await jest.advanceTimersByTimeAsync(61_000);
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
    expect(h2.prisma.cutBundle.findMany).toHaveBeenCalled();
    h2.service.onModuleDestroy();
  });
});
