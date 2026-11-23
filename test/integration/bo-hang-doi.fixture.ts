import { randomUUID } from 'crypto';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PERMISSION_MODULES } from '../../src/common/constants/permission-modules.constant';
import {
  ModuleGrant,
  ROLE_GRANTS,
  UNIVERSAL_BUSINESS_GRANTS,
} from '../../src/common/constants/role-permissions.constant';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../src/common/constants/roles.constant';
import {
  CutBundleStatus,
  MfgRole,
  MfgStage,
  PermissionAction,
  ProductionBatchStatus,
  ProductionOrderFloorStage,
  WorkstationKind,
} from '../../src/generated/prisma/client';
import { FloorAlertsService } from '../../src/modules/floor/floor-alerts.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { StockLedgerService } from '../../src/modules/stock/stock-ledger.service';
import { PRISMA_SERVICE, PrismaServiceType } from '../../src/prisma/prisma.service';
import { RealtimeService } from '../../src/realtime/realtime.service';
import { ApiEnvelope } from '../api-envelope.type';
import { P1World, ensureRoleRow, purgeRoleRows } from './p1-kcs.fixture';

/**
 * Công cụ chung cho test tích hợp "bỏ hàng đợi xưởng" (23/11/2026). Dựng app Nest THẬT + HTTP (supertest) trên DB test; dữ liệu do
 * P1World (p1-kcs.fixture.ts) dựng và tự dọn. Mật khẩu thử sinh ngẫu nhiên lúc chạy, không ghi ở đâu.
 *
 * Quy ước dữ liệu (dùng chung 3 file bo-hang-doi-*.integration.spec.ts):
 *  - Mọi PI do `newPi()` tạo, SKU quantity = 10, floorStage ACTIVE, xưởng do test chọn (xưởng mới, không dính dữ liệu thật).
 *  - Bản định mức chung của P1World: Hàn cần 2 mảnh (pieceHan, pieceHan4) mỗi mảnh = quantity SKU; Sơn chưa có mảnh nào (needsSon = false).
 *  - "Phôi đạt KCS" = đợt cắt QC_PASSED cỡ 441 (không phiếu chấm) -> `seedPhoiPass`.
 *  - "Khung Hàn đạt KCS" = ProductionBatch stage HAN QC_DONE -> `seedHanPass`.
 */
export const QTY = 10;

export type Who =
  | 'admin'
  | 'boss'
  | 'qlsx' // QLSX không gắn xưởng
  | 'qlsxA' // QLSX gắn xưởng A (xưởng đầu tiên của file)
  | 'qlsxB' // QLSX gắn xưởng B
  | 'kcs'
  | 'phoiStaff'
  | 'hanStaff'
  | 'sonStaff'
  | 'hanWorker'
  | 'sonWorker'
  | 'phoiWorker';

export interface BhdCtx {
  app: INestApplication;
  prisma: PrismaServiceType;
  w: P1World;
  alerts: FloorAlertsService;
  notifications: NotificationsService;
  emitSpy: jest.SpyInstance;
  tokens: Partial<Record<Who, string>>;
  userIds: Partial<Record<Who, string>>;
  /** Gọi API với token của `who` (đường dẫn không gồm /api/v1). */
  call: (
    who: Who,
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    body?: object,
    headers?: Record<string, string>,
  ) => request.Test;
  addUser: (
    who: Who,
    roleName: string,
    mfgRole: MfgRole | null,
    workshopId?: bigint,
  ) => Promise<string>;
  makeStation: (
    workshopId: bigint | null,
    stage: MfgStage,
    kind?: WorkstationKind,
  ) => Promise<{ id: bigint; token: string }>;
  /** Một PI quantity = QTY, ACTIVE, ở xưởng `workshopId`, hạn giao `deadline`. */
  newPi: (
    workshopId: bigint,
    opts?: { deadline?: Date | null; floorStage?: ProductionOrderFloorStage },
  ) => Promise<Awaited<ReturnType<P1World['newInvoice']>>>;
  seedPhoiPass: (
    world: Awaited<ReturnType<P1World['newInvoice']>>,
    qty?: number,
  ) => Promise<{ bundleId: bigint }>;
  seedHanPass: (
    world: Awaited<ReturnType<P1World['newInvoice']>>,
    opts?: { qty?: number; both?: boolean },
  ) => Promise<bigint[]>;
  cleanup: () => Promise<void>;
}

/** Quyền (module:action) mà hằng số cấp cho 1 vai - cùng cách seed.ts dựng (chép từ test/p1-kcs-quyen.e2e-spec.ts). */
function grantsOf(role: string): Array<{ module: string; action: PermissionAction }> {
  const allActions = Object.values(PermissionAction);
  if (role === BUSINESS_ROLES.BOSS || role === DEFAULT_ROLES.ADMIN) {
    return Object.values(PERMISSION_MODULES).flatMap((module) =>
      (role === DEFAULT_ROLES.ADMIN
        ? allActions
        : [PermissionAction.VIEW, PermissionAction.APPROVE]
      ).map((action) => ({ module, action })),
    );
  }
  const grants: ModuleGrant[] = [
    ...UNIVERSAL_BUSINESS_GRANTS,
    ...(ROLE_GRANTS[role as keyof typeof ROLE_GRANTS] ?? []),
  ];
  return grants.flatMap((g) =>
    (g.actions === 'ALL' ? allActions : g.actions).map((action) => ({ module: g.module, action })),
  );
}

export async function createBhdCtx(
  tag: string,
  opts: { realEmit?: boolean } = {},
): Promise<BhdCtx> {
  process.env.SEGMENT_STOCK_ENABLED = 'false'; // báo mảnh không cần tồn đoạn trong kho test
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RealtimeService)
    .useValue({
      publishEntityChanged: jest.fn(),
      publishNotificationCreated: jest.fn(),
      publishNotificationChanged: jest.fn(),
    })
    .compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  const prisma: PrismaServiceType = app.get(PRISMA_SERVICE);
  const notifications = app.get(NotificationsService);
  const emitSpy = jest.spyOn(notifications, 'emit');
  if (!opts.realEmit) emitSpy.mockResolvedValue(undefined);

  await prisma.permission.createMany({
    data: Object.values(PERMISSION_MODULES).flatMap((module) =>
      Object.values(PermissionAction).map((action) => ({ module, action })),
    ),
    skipDuplicates: true,
  });

  const sfx = `${tag}-${Date.now()}`;
  const w = new P1World({ prisma, ledger: app.get(StockLedgerService) }, sfx);
  await w.init();
  const password = `Pw-${randomUUID()}`;
  const createdRoleIds: string[] = [];
  const userIds: Partial<Record<Who, string>> = {};
  const tokens: Partial<Record<Who, string>> = {};
  const stationIds: bigint[] = [];
  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  const ensureRole = async (name: string): Promise<string> => {
    const { id, created } = await ensureRoleRow(prisma, name);
    if (!created) return id;
    createdRoleIds.push(id);
    for (const g of grantsOf(name)) {
      const perm = await prisma.permission.findUnique({
        where: { module_action: { module: g.module, action: g.action } },
      });
      if (perm) {
        await prisma.rolePermission.createMany({
          data: [{ roleId: id, permissionId: perm.id }],
          skipDuplicates: true,
        });
      }
    }
    return id;
  };

  const addUser: BhdCtx['addUser'] = async (who, roleName, mfgRole, workshopId) => {
    const roleId = await ensureRole(roleName);
    const username = `bhd-${who}-${sfx}`;
    const u = await prisma.user.create({
      data: {
        username,
        password: await argon2.hash(password),
        firstName: 'BHD',
        lastName: who,
        mfgRole,
        warehouseScope: 'phoi-son-han',
        ...(workshopId ? { workshopId } : {}),
        roles: { create: [{ roleId }] },
      },
    });
    userIds[who] = u.id;
    const res = await request(server()).post('/api/v1/auth/login').send({ username, password });
    if (res.status !== 200) throw new Error(`Đăng nhập thử thất bại (${who}): ${res.status}`);
    tokens[who] = (res.body as ApiEnvelope<{ accessToken: string }>).data.accessToken;
    return u.id;
  };

  const call: BhdCtx['call'] = (who, method, path, body, headers) => {
    const req = request(server())[method](`/api/v1${path}`);
    req.set('Authorization', `Bearer ${tokens[who]}`);
    for (const [k, v] of Object.entries(headers ?? {})) req.set(k, v);
    return body ? req.send(body) : req;
  };

  const makeStation: BhdCtx['makeStation'] = async (workshopId, stage, kind) => {
    const token = `bhd-${sfx}-${randomUUID()}`;
    const st = await prisma.workstation.create({
      data: {
        code: w.code(`BHDMC`),
        name: `May ${stage}`,
        stage,
        kind: kind ?? WorkstationKind.PIECE,
        qrToken: token,
        ...(workshopId ? { workshopId } : {}),
      },
    });
    stationIds.push(st.id);
    return { id: st.id, token };
  };

  const newPi: BhdCtx['newPi'] = async (workshopId, o = {}) => {
    const world = await w.newInvoice({ quantities: [QTY], workshopId, floorStage: o.floorStage });
    if (o.deadline !== undefined) {
      await prisma.productionInvoice.update({
        where: { id: world.piId },
        data: { deadline: o.deadline },
      });
    }
    return world;
  };

  const seedPhoiPass: BhdCtx['seedPhoiPass'] = async (world, qty = 6) => {
    const issue = await w.newIssue(world.piId);
    const { bundleId } = await w.seedCutBundle(issue, world, {
      segs: [{ specId: w.spec441, qty }],
      status: CutBundleStatus.QC_PASSED,
      withReport: false,
    });
    return { bundleId };
  };

  const seedHanPass: BhdCtx['seedHanPass'] = async (world, o = {}) => {
    const qty = o.qty ?? QTY;
    const pieces = o.both === false ? [w.pieceHan] : [w.pieceHan, w.pieceHan4];
    const out: bigint[] = [];
    for (const pieceId of pieces) {
      const { batchId } = await w.seedPieceBatch(world, {
        pieceId,
        stage: MfgStage.HAN,
        qty,
        status: ProductionBatchStatus.QC_DONE,
        withReport: false,
      });
      out.push(batchId);
    }
    return out;
  };

  const cleanup = async (): Promise<void> => {
    const piIds = w.ids.pis;
    if (piIds.length > 0) {
      await prisma.floorReportLine.deleteMany({
        where: { floorReport: { productionInvoiceId: { in: piIds } } },
      });
      await prisma.floorReport.deleteMany({ where: { productionInvoiceId: { in: piIds } } });
    }
    if (stationIds.length > 0) {
      await prisma.floorReport.deleteMany({ where: { workstationId: { in: stationIds } } });
      await prisma.workstation.deleteMany({ where: { id: { in: stationIds } } });
    }
    const mine = Object.values(userIds);
    if (mine.length > 0) {
      await prisma.notification.deleteMany({
        where: { recipients: { some: { userId: { in: mine } } } },
      });
      await prisma.auditLog.deleteMany({ where: { userId: { in: mine } } });
    }
    await w.cleanup();
    if (mine.length > 0) await prisma.user.deleteMany({ where: { id: { in: mine } } });
    if (createdRoleIds.length > 0) await purgeRoleRows(prisma, createdRoleIds);
    emitSpy.mockRestore();
    await app.close();
  };

  return {
    app,
    prisma,
    w,
    alerts: app.get(FloorAlertsService),
    notifications,
    emitSpy,
    tokens,
    userIds,
    call,
    addUser,
    makeStation,
    newPi,
    seedPhoiPass,
    seedHanPass,
    cleanup,
  };
}

/** Đọc cột mới `production_invoices.phoiDoneAt` bằng SQL thô (không phụ thuộc Prisma client đã sinh lại hay chưa). */
export async function phoiDoneAtOf(prisma: PrismaServiceType, piId: bigint): Promise<Date | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{ phoiDoneAt: Date | null }>>(
    `SELECT "phoiDoneAt" FROM "production_invoices" WHERE "id" = ${piId.toString()}`,
  );
  return rows[0]?.phoiDoneAt ?? null;
}

export async function setPhoiDoneAt(
  prisma: PrismaServiceType,
  piId: bigint,
  at: Date | null,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE "production_invoices" SET "phoiDoneAt" = ${at ? `'${at.toISOString()}'` : 'NULL'} WHERE "id" = ${piId.toString()}`,
  );
}

export interface StagePi {
  productionInvoiceId: string;
  code: string;
  deadline: string | null;
  missingPieces: number;
}

export const dataOf = <T>(res: request.Response): T => (res.body as ApiEnvelope<T>).data;
