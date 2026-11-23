import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  Logger,
  RequestMethod,
} from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { MfgRole, PermissionAction } from '../../generated/prisma/client';
import { ROLE_GRANTS } from '../../common/constants/role-permissions.constant';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../common/constants/roles.constant';
import { RoleGuard } from '../../common/guards/role.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { assertPiHasActiveFloor } from '../../common/utils/floor-gate.util';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { WorkshopScopeService } from '../../common/workshop-scope/workshop-scope.service';
import { MaterialYieldRecipeProductionService } from '../material-yield-recipes/material-yield-recipe-production.service';
import { ProductionBatchesService } from '../production-batches/production-batches.service';
import { SteelIssuesService } from '../steel-issues/steel-issues.service';
import { FloorController } from './floor.controller';
import { FloorReviewService } from './floor-review.service';
import { listKcsPendingItems } from './kcs-pending.util';

// stoppedPis đọc từ danh sách đợt chưa chấm của kcs-pending (đã có spec riêng): ở đây giả lập, giữ nguyên hàm thuần.
jest.mock('./kcs-pending.util', () => ({
  ...jest.requireActual<Record<string, unknown>>('./kcs-pending.util'),
  listKcsPendingItems: jest.fn().mockResolvedValue([]),
}));
const listPendingMock = listKcsPendingItems as jest.Mock;
beforeEach(() => listPendingMock.mockReset().mockResolvedValue([]));

/**
 * UB8 (P1 "KCS tự chuyển", tester-unit #3) - quyền route, listOpen, 5 hàm close, câu lỗi.
 * Bổ sung cho spec của Dev (floor.controller.spec / floor-review.service.spec / floor-review-list.service.spec):
 * không lặp ca đã có, tập trung vào hành vi nhìn từ ngoài:
 * - guard THẬT (RoleGuard + PermissionsGuard) chạy trên metadata THẬT của controller với quyền lấy từ ROLE_GRANTS THẬT (AC3);
 * - 2 lời gọi chốt chạy cùng lúc trên cổng chốt THẬT của pat / chân nhôm (AC6, AC9, AC11);
 * - nhãn cổng lệnh dừng đi qua hàm assertPiHasActiveFloor THẬT (AC11);
 * - listOpen: số liệu đợt cắt đang mở, KCS không lọc xưởng, PI 1 SKU / nhiều SKU, progress.reportedQty là số thô (AC1, AC10, AC12, MS1).
 */

const QLSX = BUSINESS_ROLES.PRODUCTION_MANAGER;
const KCS = BUSINESS_ROLES.KCS_STAFF;

// ─── AC3: guard thật trên controller thật ───────────────────────────────────────

/** Tập quyền "MODULE:ACTION" của 1 vai lấy từ ROLE_GRANTS thật ('ALL' = mọi action). */
function permissionsOf(role: string): string[] {
  const grants =
    (ROLE_GRANTS as Record<string, { module: string; actions: PermissionAction[] | 'ALL' }[]>)[
      role
    ] ?? [];
  const all = Object.values(PermissionAction);
  return grants.flatMap((g) =>
    (g.actions === 'ALL' ? all : g.actions).map((a) => `${g.module}:${a}`),
  );
}

function handlerOf(method: RequestMethod, path: string): object {
  const proto = FloorController.prototype as unknown as Record<string, object>;
  for (const name of Object.getOwnPropertyNames(proto)) {
    const h = proto[name];
    if (name === 'constructor' || typeof h !== 'function') continue;
    if (
      Reflect.getMetadata(METHOD_METADATA, h) === method &&
      Reflect.getMetadata(PATH_METADATA, h) === path
    ) {
      return h;
    }
  }
  throw new Error(`Không thấy route ${RequestMethod[method]} ${path}`);
}

/** true = qua cả 2 guard; false = 403 (ForbiddenException). Lỗi khác thì ném lại. */
function passesGuards(handler: object, roles: string[]): boolean {
  const reflector = new Reflector();
  const permissions = [...new Set(roles.flatMap(permissionsOf))];
  const ctx = {
    getHandler: () => handler,
    getClass: () => FloorController,
    switchToHttp: () => ({ getRequest: () => ({ user: { roles, permissions } }) }),
  } as unknown as ExecutionContext;
  try {
    return (
      new RoleGuard(reflector).canActivate(ctx) && new PermissionsGuard(reflector).canActivate(ctx)
    );
  } catch (e) {
    if (e instanceof ForbiddenException) return false;
    throw e;
  }
}

describe('UB8 AC3 - quyền route /floor/* chạy bằng guard thật + quyền thật của từng vai', () => {
  const { GET, POST } = RequestMethod;
  const closeRoutes: [RequestMethod, string][] = [
    [POST, 'kcs/cut-bundles/:id/close'],
    [POST, 'kcs/step-groups/close'],
    [POST, 'kcs/production-batches/:id/close'],
    [POST, 'kcs/piece-step-groups/close'],
    [POST, 'kcs/material-yield-groups/close'],
  ];

  it.each(closeRoutes)('AC3: KCS gọi %s %s - qua guard (không 403)', (m, p) => {
    expect(passesGuards(handlerOf(m, p), [KCS])).toBe(true);
  });

  it.each(closeRoutes)(
    'AC3: QLSX / Sếp / Admin / công nhân / tổ gọi %s %s - 403 (chỉ KCS chốt)',
    (m, p) => {
      for (const role of [
        QLSX,
        BUSINESS_ROLES.BOSS,
        DEFAULT_ROLES.ADMIN,
        BUSINESS_ROLES.FLOOR_WORKER,
        BUSINESS_ROLES.PHOI_STAFF,
        BUSINESS_ROLES.HAN_STAFF,
        BUSINESS_ROLES.SON_STAFF,
      ]) {
        expect({ role, ok: passesGuards(handlerOf(m, p), [role]) }).toEqual({ role, ok: false });
      }
    },
  );

  it('AC3: KCS gọi GET review - qua; QLSX cũng qua; công nhân / Sếp - 403', () => {
    const h = handlerOf(GET, 'review');
    expect(passesGuards(h, [KCS])).toBe(true);
    expect(passesGuards(h, [QLSX])).toBe(true);
    expect(passesGuards(h, [BUSINESS_ROLES.FLOOR_WORKER])).toBe(false);
    expect(passesGuards(h, [BUSINESS_ROLES.BOSS])).toBe(false);
  });

  it.each([
    [GET, 'summary'],
    [GET, 'cut-allocation'],
    [GET, 'workers'],
  ] as [RequestMethod, string][])('AC3: KCS gọi GET %s %s - 403, QLSX qua', (m, p) => {
    expect(passesGuards(handlerOf(m, p), [KCS])).toBe(false);
    expect(passesGuards(handlerOf(m, p), [QLSX])).toBe(true);
  });

  it('AC3: KCS không có quyền ghi FLOOR_REPORT nào ngoài việc chốt: hủy lần báo (reports/:id/reverse) - 403', () => {
    expect(passesGuards(handlerOf(POST, 'reports/:id/reverse'), [KCS])).toBe(false);
    expect(passesGuards(handlerOf(POST, 'scan/:token/reports'), [KCS])).toBe(false);
  });

  it('AC13: 3 route send-kcs cũ vẫn đòi QLSX (KCS không gọi được) và trả 403 bằng lời, không 404', () => {
    for (const p of [
      'review/cut-bundles/:id/send-kcs',
      'review/production-batches/:id/send-kcs',
      'review/step-groups/send-kcs',
    ]) {
      expect(passesGuards(handlerOf(POST, p), [KCS])).toBe(false);
      expect(passesGuards(handlerOf(POST, p), [QLSX])).toBe(true);
    }
  });

  it('AC3: mfgRole KCS (token cũ chưa có quyền mới) - tập quyền KCS_STAFF thật có FLOOR_REPORT:VIEW và không có FLOOR_REPORT:CREATE', () => {
    const perms = permissionsOf(KCS);
    expect(perms).toContain('FLOOR_REPORT:VIEW');
    expect(perms).not.toContain('FLOOR_REPORT:CREATE');
    expect(perms).toContain('QC_REVIEW:CREATE');
    // MfgRole chỉ dùng để dựng ngữ cảnh: tổ KCS không phải tổ báo sản lượng.
    expect([MfgRole.PHOI, MfgRole.HAN, MfgRole.SON]).not.toContain(MfgRole.KCS);
  });
});

// ─── Dữ liệu giả cho listOpen ───────────────────────────────────────────────────

const at = (iso: string) => new Date(iso);
const user = (n: string) => ({ firstName: n, lastName: 'Họ', username: n.toLowerCase() });
const spec = (mm: number) => ({ cutLengthMm: { toString: () => String(mm) } });
const material = { id: 7n, code: 'SAT-12', name: 'Sắt 12' };
const piOf = (id: bigint) => ({ id, code: `PI-${id}` });
const orderOf = (id: bigint, sku = 'S') => ({
  id,
  poNumber: `PO-${id}`,
  mfgProduct: { factoryCode: sku },
});
const report = (id: number, createdAt: string, extra: Record<string, unknown> = {}) => ({
  id: BigInt(id),
  createdAt: at(createdAt),
  reversalOfId: null,
  reportedBy: user('An'),
  workstation: { code: 'M1', name: 'Máy 1' },
  lines: [{ qty: 5, segmentSpec: spec(441), piece: null }],
  reversedBy: null,
  ...extra,
});

function makeReviewHarness(
  opts: { workshopOfPi?: Record<string, bigint>; orders?: bigint[] } = {},
) {
  const orders = (opts.orders ?? [41n]).map((id) => ({
    ...orderOf(id),
    productionInvoiceItem: { productionInvoiceId: 45n },
  }));
  const prisma = {
    productionBatch: {
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    cutBundle: { findMany: jest.fn().mockResolvedValue([]) },
    stepBatch: { findMany: jest.fn().mockResolvedValue([]) },
    pieceStepBatch: { findMany: jest.fn().mockResolvedValue([]) },
    materialYieldStepBatch: { findMany: jest.fn().mockResolvedValue([]) },
    productionInvoice: {
      findMany: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: { in: bigint[] } } }) =>
          Promise.resolve(where.id.in.map((id) => ({ id, code: `PI-${id}` }))),
        ),
    },
    productionOrder: { findMany: jest.fn().mockResolvedValue(orders) },
    productionInvoiceItem: {
      findMany: jest.fn().mockResolvedValue(
        Object.entries(opts.workshopOfPi ?? {}).map(([pi, ws]) => ({
          productionInvoiceId: BigInt(pi),
          workshopId: ws,
        })),
      ),
    },
    workshop: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
    warehouse: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const getScope = jest.fn().mockResolvedValue({
    workshopId: 1n,
    workshopName: 'Phú An',
    visibleWorkshopIds: [1n],
  });
  const steelIssues = {
    getPhoiProgress: jest.fn().mockResolvedValue([]),
    getStepProgress: jest.fn().mockResolvedValue([]),
  };
  const productionBatches = { getBatchPlanBatch: jest.fn().mockResolvedValue({}) };
  const service = new FloorReviewService(
    prisma as unknown as PrismaServiceType,
    steelIssues as unknown as SteelIssuesService,
    productionBatches as unknown as ProductionBatchesService,
    { getScope } as unknown as WorkshopScopeService,
    {} as MaterialYieldRecipeProductionService,
  );
  return { prisma, getScope, steelIssues, service };
}

describe('UB8 AC1 / MS1 - listOpen đợt cắt đang mở (CUTTING)', () => {
  const cutBundle = (reports: unknown[]) => ({
    id: 53n,
    createdAt: at('2026-11-18T01:00:00Z'),
    productionOrderId: 41n,
    openedBy: user('An'),
    segments: [{ segmentSpecId: 63n, qty: 120, segmentSpec: spec(441) }],
    steelIssue: { material, productionInvoice: piOf(45n) },
    productionOrder: orderOf(41n),
    floorReports: reports,
  });

  it('AC1: đợt CUTTING hiện ngay với người mở, SKU, cỡ x số đoạn, giờ lần báo đầu CÒN HIỆU LỰC + danh sách lần báo (không có dòng ghi hủy)', async () => {
    const { prisma, service } = makeReviewHarness();
    prisma.cutBundle.findMany.mockResolvedValue([
      cutBundle([
        // lần báo đầu đã bị QLSX hủy -> mốc chờ phải nhảy sang lần báo sau
        report(1, '2026-11-18T01:00:00Z', {
          reversedBy: {
            id: 90n,
            reason: 'nhầm',
            createdAt: at('2026-11-18T01:05:00Z'),
            reportedBy: user('Q'),
          },
        }),
        report(2, '2026-11-18T01:10:00Z', {
          lines: [{ qty: 120, segmentSpec: spec(441), piece: null }],
        }),
        // dòng ghi hủy (âm) - không phải lần báo của công nhân
        report(3, '2026-11-18T01:05:00Z', { reversalOfId: 1n }),
      ]),
    ]);

    const r = await service.listOpen('PHOI', undefined, 'kcs-1', false);

    expect(r.cutBundles).toHaveLength(1);
    const b = r.cutBundles[0];
    expect(b.cutBundleId).toBe('53');
    expect(b.openedByName).toBe('Họ An');
    expect(b.order?.sku).toBe('S');
    expect(b.material.name).toBe('Sắt 12');
    expect(b.segments).toEqual([{ cutLengthMm: 441, qty: 120 }]);
    expect(b.waitingSince).toEqual(at('2026-11-18T01:10:00Z'));
    expect(b.blockedReason).toBeNull();
    expect(b.reports.map((x) => x.floorReportId)).toEqual(['1', '2']);
    expect(b.reports[0].reversed?.reason).toBe('nhầm');
  });

  it('AC1: đợt CUTTING không có sổ báo nào còn hiệu lực -> mốc chờ = giờ mở đợt (không phải bây giờ, không Invalid Date)', async () => {
    const { prisma, service } = makeReviewHarness();
    prisma.cutBundle.findMany.mockResolvedValue([cutBundle([])]);

    const r = await service.listOpen('PHOI', undefined, 'kcs-1', false);

    expect(r.cutBundles[0].waitingSince).toEqual(at('2026-11-18T01:00:00Z'));
  });

  it('MS1: progress.reportedQty là số THÔ (đã báo), done là số ĐÃ TÍNH (thô - lỗi - thiếu), không lấy nhầm done của API', async () => {
    const { prisma, steelIssues, service } = makeReviewHarness();
    prisma.cutBundle.findMany.mockResolvedValue([cutBundle([report(1, '2026-11-18T01:00:00Z')])]);
    // Tiến độ BE sau khi KCS chấm đợt cũ: thô 120, thiếu 5, lỗi 3 -> API done = thô - thiếu = 115 (vẫn gồm lỗi).
    steelIssues.getPhoiProgress.mockResolvedValue([
      {
        materialId: '7',
        steelBalance: null,
        segments: [
          {
            segmentSpecId: '63',
            required: 1180,
            baseRequired: 1180,
            extraNeed: 0,
            reportedQty: 120,
            done: 115,
            failed: 3,
            shortQty: 5,
            maxNow: 1068,
            byOrder: [],
          },
        ],
      },
    ]);

    const r = await service.listOpen('PHOI', undefined, 'kcs-1', false);

    const p = r.cutBundles[0].progress[0];
    expect(p.reportedQty).toBe(120);
    expect(p.done).toBe(112);
    expect(p.failed).toBe(3);
    expect(p.shortQty).toBe(5);
    expect(p.maxNow).toBe(1068);
    expect(p.reportedQty).not.toBe(p.done);
  });

  it('MS1: số cần 1180, đã báo thô 1190 -> over 10, "còn báo được" 0, không có số âm ở done / over / maxNow (AC26)', async () => {
    const { prisma, steelIssues, service } = makeReviewHarness();
    prisma.cutBundle.findMany.mockResolvedValue([cutBundle([report(1, '2026-11-18T01:00:00Z')])]);
    steelIssues.getPhoiProgress.mockResolvedValue([
      {
        materialId: '7',
        steelBalance: null,
        segments: [
          {
            segmentSpecId: '63',
            required: 1180,
            baseRequired: 1180,
            extraNeed: 0,
            reportedQty: 1190,
            done: 1190,
            failed: 0,
            shortQty: 0,
            maxNow: 0,
            byOrder: [],
          },
        ],
      },
    ]);

    const p = (await service.listOpen('PHOI', undefined, 'kcs-1', false)).cutBundles[0].progress[0];

    expect(p).toMatchObject({ reportedQty: 1190, done: 1190, over: 10, maxNow: 0 });
    for (const v of [p.done, p.over, p.maxNow, p.required]) expect(v).toBeGreaterThanOrEqual(0);
  });
});

describe('UB8 AC10 - KCS không lọc xưởng; QLSX vẫn lọc', () => {
  // PI 45 = Phú An (1), PI 46 = Phước An (2). Tổ Sơn: Phước An nhờ sơn ở Phú An (workshop 2 -> paintWorkshopId 1).
  const pieceBatch = (id: number, pi: bigint, stage: 'HAN' | 'SON') => ({
    id: BigInt(id),
    stage,
    productionOrderId: pi === 45n ? 41n : 42n,
    pieceId: 5n,
    reportedQty: 20,
    reportedAt: at('2026-11-18T02:00:00Z'),
    reportedBy: user('Binh'),
    piece: { code: 'TL', name: 'Tựa lưng' },
    productionOrder: {
      ...orderOf(pi === 45n ? 41n : 42n),
      productionInvoiceItem: { productionInvoice: piOf(pi) },
    },
    floorReports: [report(id, '2026-11-18T02:00:00Z')],
  });
  const setup = () => {
    const h = makeReviewHarness({ workshopOfPi: { '45': 1n, '46': 2n } });
    h.prisma.workshop.findMany.mockResolvedValue([
      { id: 1n, paintWorkshopId: null },
      { id: 2n, paintWorkshopId: 1n },
    ]);
    h.prisma.productionBatch.findMany.mockImplementation(
      ({ where }: { where: { stage: 'HAN' | 'SON' } }) =>
        Promise.resolve([pieceBatch(1, 45n, where.stage), pieceBatch(2, 46n, where.stage)]),
    );
    return h;
  };

  it.each(['HAN', 'SON'] as const)(
    'AC10: KCS có gắn xưởng Phú An mở tổ %s - thấy đủ lô của CẢ 2 xưởng, không hỏi phạm vi xưởng',
    async (stage) => {
      const { service, getScope } = setup();
      const r = await service.listOpen(stage, undefined, 'kcs-pa', false);
      expect(r.pieceBatches.map((b) => b.pi?.productionInvoiceId).sort()).toEqual(['45', '46']);
      expect(getScope).not.toHaveBeenCalled();
    },
  );

  it('AC10: KCS thấy lô Sơn của lệnh Phước An sơn ở Phú An; QLSX Phước An (gắn xưởng 2) thì KHÔNG thấy lô Sơn đó', async () => {
    const h = setup();
    expect((await h.service.listOpen('SON', undefined, 'kcs', false)).pieceBatches).toHaveLength(2);
    h.getScope.mockResolvedValue({
      workshopId: 2n,
      workshopName: 'Phước An',
      visibleWorkshopIds: [2n],
    });
    const r = await h.service.listOpen('SON', undefined, 'qlsx-pa', true);
    // Lô Sơn của Phước An nằm ở xưởng sơn = Phú An (1): QLSX Phước An không thấy; lô của PI Phú An cũng không phải của xưởng 2.
    expect(r.pieceBatches).toHaveLength(0);
  });

  it('AC10: QLSX Phú An (gắn xưởng 1) mở tổ Sơn - thấy lô Sơn của cả Phú An lẫn Phước An (xưởng sơn = Phú An)', async () => {
    const h = setup();
    const r = await h.service.listOpen('SON', undefined, 'qlsx-phu', true);
    expect(h.getScope).toHaveBeenCalledWith('qlsx-phu');
    expect(r.pieceBatches.map((b) => b.pi?.productionInvoiceId).sort()).toEqual(['45', '46']);
  });

  it('AC10: QLSX Phú An mở tổ Hàn - chỉ thấy lô Hàn của Phú An, KHÔNG thấy lô Hàn Phước An', async () => {
    const h = setup();
    const r = await h.service.listOpen('HAN', undefined, 'qlsx-phu', true);
    expect(r.pieceBatches.map((b) => b.pi?.productionInvoiceId)).toEqual(['45']);
  });
});

describe('UB8 AC12 / MF5 - dòng công đoạn phụ chưa gắn SKU', () => {
  const stepRow = (
    id: number,
    qty: number,
    order: ReturnType<typeof orderOf> | null,
    pi = 45n,
  ) => ({
    id: BigInt(id),
    productionInvoiceId: pi,
    materialId: 7n,
    step: 'UON',
    productionOrderId: order?.id ?? null,
    createdAt: at(`2026-11-18T0${id}:00:00Z`),
    reportedById: 'cn-an',
    reportedBy: user('An'),
    material,
    productionInvoice: piOf(pi),
    productionOrder: order,
    segments: [{ segmentSpecId: 63n, qty, segmentSpec: spec(355) }],
    floorReports: [report(id, `2026-11-18T0${id}:00:00Z`)],
  });

  it('MF5: PI 1 SKU có dòng chưa gắn SKU 20 + nhóm của SKU đó 80 (cùng người) -> CHỈ 1 dòng 100, không xám', async () => {
    const { prisma, service } = makeReviewHarness({ orders: [41n] });
    prisma.stepBatch.findMany.mockResolvedValue([
      stepRow(1, 20, null),
      stepRow(2, 80, orderOf(41n)),
    ]);

    const r = await service.listOpen('PHOI', undefined, 'kcs-1', false);

    expect(r.stepGroups).toHaveLength(1);
    expect(r.stepGroups[0].segments).toEqual([{ cutLengthMm: 355, qty: 100 }]);
    expect(r.stepGroups[0].blockedReason).toBeNull();
    expect(r.stepGroups[0].order?.productionOrderId).toBe('41');
    expect(r.stepGroups[0].waitingSince).toEqual(at('2026-11-18T01:00:00Z'));
  });

  it('AC12: PI NHIỀU SKU - dòng chưa gắn SKU là nhóm RIÊNG xám CHUA_GAN_SKU (20), nhóm SKU 80 vẫn chấm được; số hai nhóm không trộn', async () => {
    const { prisma, service } = makeReviewHarness({ orders: [41n, 42n] });
    prisma.stepBatch.findMany.mockResolvedValue([
      stepRow(1, 20, null),
      stepRow(2, 80, orderOf(41n)),
    ]);

    const r = await service.listOpen('PHOI', undefined, 'kcs-1', false);

    const byReason = Object.fromEntries(r.stepGroups.map((g) => [g.blockedReason ?? 'OK', g]));
    expect(Object.keys(byReason).sort()).toEqual(['CHUA_GAN_SKU', 'OK']);
    expect(byReason.CHUA_GAN_SKU.segments).toEqual([{ cutLengthMm: 355, qty: 20 }]);
    expect(byReason.CHUA_GAN_SKU.order).toBeNull();
    expect(byReason.OK.segments).toEqual([{ cutLengthMm: 355, qty: 80 }]);
  });

  it('AC12: LENH_DUNG thắng CHUA_GAN_SKU - dòng chưa gắn SKU của PI dừng chỉ báo "lệnh dừng"', async () => {
    const { prisma, service } = makeReviewHarness({ orders: [41n, 42n] });
    // không PI nào còn SKU ACTIVE
    prisma.productionInvoice.findMany.mockResolvedValue([]);
    prisma.stepBatch.findMany.mockResolvedValue([stepRow(1, 20, null)]);

    const r = await service.listOpen('PHOI', undefined, 'kcs-1', false);

    expect(r.stepGroups[0].blockedReason).toBe('LENH_DUNG');
    expect(r.stepGroups[0].piActive).toBe(false);
  });
});

// ─── Cổng chốt THẬT của pat / chân nhôm trên DB giả có trạng thái ─────────────

type Row = { id: bigint; qty: number; bundleId: bigint | null };

/**
 * DB giả có trạng thái cho 2 hàm chốt thật (ProductionBatchesService.submitPieceStep, MaterialYieldRecipeProductionService.submitStep).
 * `$transaction` chạy lần lượt từng giao dịch (mô phỏng khoá advisory giữ tới hết giao dịch) nên 2 lời gọi cùng lúc thấy đúng thứ tự
 * "bên trước chốt xong, bên sau thấy hết dòng chưa gom". Phần khoá thật của Postgres do IT2 kiểm.
 */
function makeStatefulDb(initialQty: number[], active = true) {
  const state = {
    active,
    rows: initialQty.map((qty, i): Row => ({ id: BigInt(i + 1), qty, bundleId: null })),
    bundles: [] as { id: bigint; qty: number }[],
  };
  let chain: Promise<unknown> = Promise.resolve();
  const pending = () => state.rows.filter((r) => r.bundleId == null);
  const mark = ({
    where,
    data,
  }: {
    where: { id: { in: bigint[] } };
    data: Record<string, bigint>;
  }) => {
    const bundleId = Object.values(data)[0];
    let count = 0;
    for (const r of state.rows) {
      if (where.id.in.includes(r.id) && r.bundleId == null) {
        r.bundleId = bundleId;
        count += 1;
      }
    }
    return Promise.resolve({ count });
  };
  const create = ({ data }: { data: { qty: number } }) => {
    const b = { id: BigInt(state.bundles.length + 1), qty: data.qty };
    state.bundles.push(b);
    return Promise.resolve({
      ...b,
      status: 'AWAITING_QC',
      submittedAt: at('2026-11-18T05:00:00Z'),
      submittedById: 'u',
      productionInvoiceId: 9n,
      recipeId: 3n,
      pieceId: 5n,
      step: 'DAP',
      productionInvoice: { code: 'PI-9' },
      recipe: { outputMaterial: { code: 'CN', name: 'Chân nhôm' } },
      piece: { code: 'PAT', name: 'Pat' },
      productionOrderId: 41n,
      productionOrder: {
        poNumber: 'PO-41',
        productionInvoiceItem: { salesOrder: null, productionInvoice: { code: 'PI-9' } },
      },
    });
  };
  const db: Record<string, unknown> = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    $queryRaw: jest
      .fn()
      .mockImplementation(() => Promise.resolve(state.active ? [{ floorStage: 'ACTIVE' }] : [])),
    productionOrder: {
      findUnique: jest.fn().mockResolvedValue({ id: 41n, productionInvoiceItemId: 77n }),
      findFirst: jest
        .fn()
        .mockImplementation(() => Promise.resolve(state.active ? { id: 41n } : null)),
    },
    productionInvoiceItem: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ productionInvoiceId: 9n }),
    },
    piece: { findUnique: jest.fn().mockResolvedValue({ code: 'PAT' }) },
    materialYieldRecipe: {
      findUnique: jest.fn().mockResolvedValue({ outputMaterial: { code: 'CN' } }),
    },
    pieceStepBatch: {
      findMany: jest.fn().mockImplementation(() => Promise.resolve(pending())),
      updateMany: jest.fn().mockImplementation(mark),
    },
    pieceStepBundle: { create: jest.fn().mockImplementation(create) },
    materialYieldStepBatch: {
      findMany: jest.fn().mockImplementation(() => Promise.resolve(pending())),
      updateMany: jest.fn().mockImplementation(mark),
    },
    materialYieldStepBundle: { create: jest.fn().mockImplementation(create) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  db.$transaction = jest.fn((cb: (t: unknown) => Promise<unknown>) => {
    const run = chain.then(() => cb(db));
    chain = run.catch(() => undefined);
    return run;
  });
  return { db, state };
}

function makeRealCloseHarness(initialQty: number[], active = true) {
  const { db, state } = makeStatefulDb(initialQty, active);
  const notifications = { emit: jest.fn().mockResolvedValue(undefined) };
  const cls = { get: jest.fn() };
  const batches = new ProductionBatchesService(
    db as never,
    {} as never,
    {} as never,
    notifications as never,
    { publishEntityChanged: jest.fn() } as never,
    {} as never,
  );
  const yieldSvc = new MaterialYieldRecipeProductionService(
    db as never,
    {} as never,
    {} as never,
    {} as never,
    notifications as never,
    cls as never,
  );
  const review = new FloorReviewService(
    db as never,
    {} as never,
    batches,
    { getScope: jest.fn() } as never,
    yieldSvc,
  );
  return { review, batches, yieldSvc, state, notifications, db };
}

describe('UB8 AC6 / AC9 - chốt pat và chân nhôm: ai bấm trước thì chốt, bên kia nhận 400 lời thường', () => {
  const yieldDto = { productionInvoiceId: '9', recipeId: '3', step: 'DAP' as never };
  const pieceDto = { productionOrderId: '41', pieceId: '5', step: 'DAP' as never };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('AC9: KCS chốt nhóm chân nhôm - gom đủ 50, KHÔNG phát MATERIAL_YIELD_STEP_BUNDLE_TO_KCS', async () => {
    const h = makeRealCloseHarness([30, 20]);

    await h.review.closeMaterialYieldGroup(yieldDto, 'kcs-1');

    expect(h.state.bundles).toEqual([expect.objectContaining({ qty: 50 })]);
    expect(h.state.rows.every((r) => r.bundleId != null)).toBe(true);
    expect(h.notifications.emit).not.toHaveBeenCalledWith(
      'MATERIAL_YIELD_STEP_BUNDLE_TO_KCS',
      expect.anything(),
    );
  });

  it('AC9: nút "Gửi KCS" của tài khoản thống kê vẫn dùng được và vẫn báo KCS (đường cũ không đổi)', async () => {
    const h = makeRealCloseHarness([50]);

    await h.yieldSvc.submitStep('9', { recipeId: '3', step: 'DAP' }, 'thong-ke', 'PHOI');

    expect(h.state.bundles).toHaveLength(1);
    expect(h.notifications.emit).toHaveBeenCalledWith(
      'MATERIAL_YIELD_STEP_BUNDLE_TO_KCS',
      expect.objectContaining({ params: { piCode: 'PI-9' } }),
    );
  });

  it('AC9: KCS chốt trước, tài khoản thống kê bấm "Gửi KCS" sau - 400 "không còn lần báo nào chưa chấm", không bundle thứ 2', async () => {
    const h = makeRealCloseHarness([50]);
    await h.review.closeMaterialYieldGroup(yieldDto, 'kcs-1');

    const err = await h.yieldSvc
      .submitStep('9', { recipeId: '3', step: 'DAP' }, 'thong-ke', 'PHOI')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toMatch(/không còn lần báo nào chưa chấm.*tải lại trang/);
    expect(h.state.bundles).toHaveLength(1);
  });

  it('AC9: tài khoản thống kê chốt pat trước, KCS bấm Chấm sau - 400 lời thường, không bundle thứ 2', async () => {
    const h = makeRealCloseHarness([50]);
    await h.batches.submitPieceStep('41', { pieceId: '5', step: 'DAP' }, 'thong-ke', 'PHOI');

    const err = await h.review.closePieceStepGroup(pieceDto, 'kcs-1').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toMatch(/không còn lần báo nào chưa chấm.*tải lại trang/);
    expect(h.state.bundles).toHaveLength(1);
  });

  it('AC6: 2 KCS (hoặc 1 KCS bấm 2 lần) chốt chân nhôm CÙNG LÚC - đúng 1 thành công, 1 bị 400, đúng 1 bundle với đủ số', async () => {
    const h = makeRealCloseHarness([30, 20]);

    const results = await Promise.allSettled([
      h.review.closeMaterialYieldGroup(yieldDto, 'kcs-1'),
      h.review.closeMaterialYieldGroup(yieldDto, 'kcs-2'),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(BadRequestException);
    expect(h.state.bundles).toEqual([expect.objectContaining({ qty: 50 })]);
  });

  it('AC6: 2 lời gọi chốt pat cùng lúc - đúng 1 thành công, bên kia 400, không bundle rỗng', async () => {
    const h = makeRealCloseHarness([10, 10, 10]);

    const results = await Promise.allSettled([
      h.review.closePieceStepGroup(pieceDto, 'kcs-1'),
      h.review.closePieceStepGroup(pieceDto, 'kcs-1'),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(h.state.bundles).toEqual([expect.objectContaining({ qty: 30 })]);
    expect(h.state.bundles.every((b) => b.qty > 0)).toBe(true);
  });

  it('AC6: nhóm không có dòng chưa gom nào (QLSX vừa hủy hết) - 400, KHÔNG tạo bundle rỗng, không 404 / 500', async () => {
    const h = makeRealCloseHarness([]);

    for (const call of [
      () => h.review.closePieceStepGroup(pieceDto, 'kcs-1'),
      () => h.review.closeMaterialYieldGroup(yieldDto, 'kcs-1'),
    ]) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
    }
    expect(h.state.bundles).toHaveLength(0);
  });
});

describe('UB8 AC11 / MF7 - lệnh tạm dừng: close trả 409 bằng câu của cổng sàn, nhãn "chốt để chấm"', () => {
  const stoppedPrisma = {
    productionOrder: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const GATE =
    /chưa có SKU nào được QLSX bấm "Bắt đầu" \(hoặc đã "Kết thúc"\) - chưa\/không thể chốt để chấm$/;

  it('pat: lệnh dừng -> 409 câu floor-gate "... chưa/không thể chốt để chấm", không tạo bundle, không gom dòng nào', async () => {
    const h = makeRealCloseHarness([50], false);

    const err = await h.review
      .closePieceStepGroup({ productionOrderId: '41', pieceId: '5', step: 'DAP' }, 'kcs-1')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toMatch(GATE);
    expect(h.state.bundles).toHaveLength(0);
    expect(h.state.rows[0].bundleId).toBeNull();
  });

  it('chân nhôm: lệnh dừng -> 409 cùng câu, không tạo bundle, không phát tin', async () => {
    const h = makeRealCloseHarness([50], false);

    const err = await h.review
      .closeMaterialYieldGroup({ productionInvoiceId: '9', recipeId: '3', step: 'DAP' }, 'kcs-1')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toMatch(GATE);
    expect(h.state.bundles).toHaveLength(0);
    expect(h.notifications.emit).not.toHaveBeenCalled();
  });

  it('đợt cắt / nhóm công đoạn / lô mảnh: nhãn cổng KCS truyền xuống đi qua assertPiHasActiveFloor THẬT ra đúng câu "chốt để chấm"', async () => {
    // Mỗi hàm chốt cũ nhận opts.gateLabel rồi gọi assertPiHasActiveFloor(prisma, pi, gateLabel) - giả lập đúng việc đó.
    const gate = (label: string | undefined, fallback: string) =>
      assertPiHasActiveFloor(stoppedPrisma as never, 9n, label ?? fallback);
    const steelIssues = {
      finishCutBundle: jest.fn((_id: string, o?: { gateLabel?: string }) =>
        gate(o?.gateLabel, 'báo cắt xong'),
      ),
      submitStepBundle: jest.fn(
        (
          _a: string,
          _b: string,
          _c: string,
          _d: string,
          _e: string | null,
          _w: unknown,
          o?: { gateLabel?: string },
        ) => gate(o?.gateLabel, 'gửi KCS công đoạn'),
      ),
    };
    const productionBatches = {
      finishProductionBatch: jest.fn(
        (_id: string, _a: string, _s: string, _w: null, o?: { gateLabel?: string }) =>
          gate(o?.gateLabel, 'gửi KCS'),
      ),
    };
    const prisma = {
      productionBatch: { findUnique: jest.fn().mockResolvedValue({ stage: 'HAN' }) },
      productionOrder: { findMany: jest.fn() },
    };
    const review = new FloorReviewService(
      prisma as never,
      steelIssues as never,
      productionBatches as never,
      {} as never,
      {} as never,
    );

    const calls = [
      () => review.closeCutBundle('53', 'kcs-1'),
      () =>
        review.closeStepGroup(
          {
            productionInvoiceId: '9',
            materialId: '7',
            step: 'UON',
            productionOrderId: '41',
          },
          'kcs-1',
        ),
      () => review.closeProductionBatch('12', 'kcs-1'),
    ];
    for (const call of calls) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as Error).message).toMatch(GATE);
      expect((err as Error).message).not.toMatch(/báo cắt xong|gửi KCS/);
    }
  });
});

describe('UB8 AC6 / MF7 - các câu lỗi của hàm chốt cũ ra tới KCS nguyên văn, không đổi mã', () => {
  const build = () => {
    const steelIssues = { finishCutBundle: jest.fn(), submitStepBundle: jest.fn() };
    const productionBatches = { finishProductionBatch: jest.fn(), submitPieceStep: jest.fn() };
    const yieldSvc = { submitStep: jest.fn() };
    const prisma = {
      productionBatch: { findUnique: jest.fn().mockResolvedValue({ stage: 'SON' }) },
    };
    const review = new FloorReviewService(
      prisma as never,
      steelIssues as never,
      productionBatches as never,
      {} as never,
      yieldSvc as never,
    );
    return { review, steelIssues, productionBatches, yieldSvc };
  };
  const dup = new ConflictException('Đợt cắt này vừa được chốt để chấm - tải lại trang.');
  const none = new BadRequestException('Đợt này không còn lần báo nào chưa chấm - tải lại trang.');

  it('AC6: lô mảnh - bên chốt sau nhận 409 "vừa được chốt để chấm" / 400 "không còn lần báo" của hàm cũ, đúng mã', async () => {
    const h = build();
    h.productionBatches.finishProductionBatch.mockRejectedValueOnce(dup);
    await expect(h.review.closeProductionBatch('12', 'k')).rejects.toBe(dup);
    h.productionBatches.finishProductionBatch.mockRejectedValueOnce(none);
    await expect(h.review.closeProductionBatch('12', 'k')).rejects.toBe(none);
  });

  it('AC6: nhóm công đoạn phụ - 400 "không còn lần báo nào chưa chấm" ném lại nguyên đối tượng (không đổi thành 404 / 500)', async () => {
    const h = build();
    h.steelIssues.submitStepBundle.mockRejectedValueOnce(none);
    await expect(
      h.review.closeStepGroup(
        {
          productionInvoiceId: '9',
          materialId: '7',
          step: 'UON',
          productionOrderId: '41',
        },
        'k',
      ),
    ).rejects.toBe(none);
  });

  it('AC6: đợt cắt - chốt 2 lần: lần 2 nhận đúng 409 của hàm cũ, giờ chốt không bị ghi đè (hàm chốt chỉ gọi 1 lần mỗi lời gọi, không tự thử lại)', async () => {
    const h = build();
    h.steelIssues.finishCutBundle.mockResolvedValueOnce({ id: '53', status: 'AWAITING_QC' });
    h.steelIssues.finishCutBundle.mockRejectedValueOnce(dup);

    await expect(h.review.closeCutBundle('53', 'k1')).resolves.toMatchObject({
      status: 'AWAITING_QC',
    });
    await expect(h.review.closeCutBundle('53', 'k2')).rejects.toBe(dup);
    expect(h.steelIssues.finishCutBundle).toHaveBeenCalledTimes(2);
  });

  it('MF7: lô mảnh vừa bị QLSX hủy hết - 409 "vừa bị QLSX hủy hết số", KHÔNG phải NotFound, lô đã mất trước khi tra thì không gọi hàm chốt', async () => {
    const h = build();
    // mất trước khi tra
    (
      h.review as unknown as { prisma: { productionBatch: { findUnique: jest.Mock } } }
    ).prisma.productionBatch.findUnique.mockResolvedValueOnce(null);
    const err1 = await h.review.closeProductionBatch('12', 'k').catch((e: unknown) => e);
    expect(err1).toBeInstanceOf(ConflictException);
    expect((err1 as Error).message).toBe(
      'Lô này vừa bị QLSX hủy hết số - không còn gì để chấm, tải lại trang.',
    );
    expect(h.productionBatches.finishProductionBatch).not.toHaveBeenCalled();
  });
});

describe('UB8 AC2 - route close gọi đúng hàm chốt (controller -> FloorReviewService -> hàm chốt cũ)', () => {
  it('POST kcs/cut-bundles/:id/close chuyển id đợt, hàm chốt cũ nhận notifyKcs=false (không tin CUT_BUNDLE_TO_KCS)', async () => {
    const steelIssues = { finishCutBundle: jest.fn().mockResolvedValue({ status: 'AWAITING_QC' }) };
    const review = new FloorReviewService(
      {} as never,
      steelIssues as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const controller = new FloorController(
      {} as never,
      {} as never,
      review,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const res = await controller.closeCutBundle('53', 'kcs-1');

    expect(res).toEqual({ status: 'AWAITING_QC' });
    expect(steelIssues.finishCutBundle).toHaveBeenCalledTimes(1);
    expect(steelIssues.finishCutBundle).toHaveBeenCalledWith('53', {
      notifyKcs: false,
      gateLabel: 'chốt để chấm',
    });
  });
});

describe('UB8 AC11 - QLSX vẫn hủy được lần báo của lệnh đang tạm dừng', () => {
  it('hủy lần báo lô mảnh của PI không còn SKU ACTIVE: không bị cổng lệnh dừng chặn, ghi dòng đảo + trừ số', async () => {
    const tx = {
      $executeRaw: jest.fn(),
      floorReport: { create: jest.fn() },
      productionBatch: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 12n, status: 'OPEN', reportedQty: 20 }),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    const prisma = {
      floorReport: {
        findUnique: jest.fn().mockResolvedValue({
          id: 11n,
          kind: 'PIECE',
          reversalOfId: null,
          reversedBy: null,
          cutBundleId: null,
          stepBatchId: null,
          productionBatchId: 12n,
          workstationId: null,
          productionInvoiceId: 45n,
          lines: [{ segmentSpecId: null, pieceId: 5n, qty: 20 }],
        }),
      },
      productionBatch: {
        findUnique: jest.fn().mockResolvedValue({
          id: 12n,
          productionOrderId: 41n,
          pieceId: 5n,
          stage: 'HAN',
          status: 'OPEN',
        }),
      },
      // Lệnh dừng: không có SKU ACTIVE - nếu hàm đảo có đi qua cổng thì findFirst này làm nó ném 409.
      productionOrder: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const review = new FloorReviewService(
      prisma as never,
      {} as never,
      {} as never,
      {
        getScope: jest
          .fn()
          .mockResolvedValue({ workshopId: null, workshopName: null, visibleWorkshopIds: null }),
      } as never,
      {} as never,
    );

    await expect(review.reverse('11', 'công nhân báo nhầm', 'qlsx-1')).resolves.toEqual({
      ok: true,
    });

    expect(tx.floorReport.create).toHaveBeenCalledTimes(1);
    expect(tx.productionBatch.delete).toHaveBeenCalledTimes(1);
    expect(prisma.productionOrder.findFirst).not.toHaveBeenCalled();
  });
});
