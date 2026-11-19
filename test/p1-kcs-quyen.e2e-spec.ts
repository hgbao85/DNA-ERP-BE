import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PERMISSION_MODULES } from '../src/common/constants/permission-modules.constant';
import {
  ModuleGrant,
  ROLE_GRANTS,
  UNIVERSAL_BUSINESS_GRANTS,
} from '../src/common/constants/role-permissions.constant';
import { BUSINESS_ROLES } from '../src/common/constants/roles.constant';
import { MfgRole, PermissionAction, StepBundleStatus } from '../src/generated/prisma/client';
import { LiveAuthService } from '../src/modules/auth/live-auth.service';
import { StockLedgerService } from '../src/modules/stock/stock-ledger.service';
import { PRISMA_SERVICE, PrismaServiceType } from '../src/prisma/prisma.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { ApiEnvelope } from './api-envelope.type';
import { P1World, ensureRoleRow, purgeRoleRows } from './integration/p1-kcs.fixture';

/**
 * HT1 (P1, 18/11/2026) - bảng VAI x ROUTE qua HTTP thật (AppModule + supertest, DB test chung).
 *  AC3   KCS có FLOOR_REPORT:VIEW sau migration 100100: token cấp TRƯỚC migration vẫn 200 sau khi bộ nhớ LiveAuth hết hạn / bị xoá
 *        (bản thật hết hạn sau <= 30 giây, LIVE_AUTH_TTL_MS; ở đây gọi invalidate thay vì chờ); KCS gọi được GET /floor/review và 5 route
 *        close (không 403); /floor/summary, /floor/queue, /floor/workers, /floor/scan/*  -> 403; QLSX, Sếp (BOSS), công nhân gọi route close -> 403
 *  AC13  3 route send-kcs -> 403 đúng câu "Từ nay KCS tự chấm ..."; route báo cũ trả câu mới ở legacy-floor-report.constant.ts
 *  AC28 / AC32 / AC47 (phần API)  shortQty âm -> 400 (ValidationPipe thật); công đoạn phụ có lỗi mà thiếu scrapQty -> 400 "... tải lại trang"
 *  AC56  POST steel-issues/cut-bundles/:id/undo-last-batch -> 404
 *
 * Vai được tạo THEO hằng số role-permissions.constant.ts (đọc hằng số, không liệt kê quyền bằng tay) - chỉ tạo vai chưa có trong DB test và
 * chỉ dọn đúng vai mình tạo. Câu SQL của migration 100100 đọc từ file thật. Mật khẩu thử sinh ngẫu nhiên lúc chạy, không ghi ở đâu.
 */
const MIGRATION_100100 = '20261118100100_kcs_floor_report_view';
const SEND_KCS_REMOVED =
  'Từ nay KCS tự chấm các đợt công nhân vừa báo - QLSX không cần gửi KCS nữa. Tải lại trang.';

describe('P1 HT1: vai x route KCS tự chuyển (e2e, DB test thật)', () => {
  let app: INestApplication;
  let prisma: PrismaServiceType;
  let liveAuth: LiveAuthService;
  let world: P1World;
  const password = `Pw-${randomUUID()}`;
  const sfx = Date.now();
  const createdRoleIds: string[] = [];
  const userIds: string[] = [];
  let kcsRoleId: string;
  let viewPermId: string;
  let linkExistedBefore = false;

  type Who = 'kcs' | 'qlsx' | 'boss' | 'worker' | 'phoi' | 'han';
  const ids = {} as Record<Who, string>;
  const tokens = {} as Record<Who, string>;

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];
  const bodyText = (res: request.Response): string => JSON.stringify(res.body);

  function call(who: Who, method: 'get' | 'post', path: string, body?: object) {
    const req = request(server())[method](`/api/v1${path}`);
    req.set('Authorization', `Bearer ${tokens[who]}`);
    return body ? req.send(body) : req;
  }

  /** Quyền (module:action) mà hằng số cấp cho 1 vai - cùng cách seed.ts dựng. */
  function grantsOf(role: string): Array<{ module: string; action: PermissionAction }> {
    const allActions = Object.values(PermissionAction);
    if (role === BUSINESS_ROLES.BOSS) {
      return Object.values(PERMISSION_MODULES).flatMap((module) =>
        [PermissionAction.VIEW, PermissionAction.APPROVE].map((action) => ({ module, action })),
      );
    }
    const grants: ModuleGrant[] = [
      ...UNIVERSAL_BUSINESS_GRANTS,
      ...(ROLE_GRANTS[role as keyof typeof ROLE_GRANTS] ?? []),
    ];
    return grants.flatMap((g) =>
      (g.actions === 'ALL' ? allActions : g.actions).map((action) => ({
        module: g.module,
        action,
      })),
    );
  }

  /** Vai có sẵn thì dùng nguyên; chưa có thì tạo theo hằng số (và nhớ để dọn). */
  async function ensureRole(name: string): Promise<string> {
    const { id, created } = await ensureRoleRow(prisma, name);
    if (!created) return id;
    const role = { id };
    createdRoleIds.push(id);
    for (const g of grantsOf(name)) {
      const perm = await prisma.permission.findUnique({
        where: { module_action: { module: g.module, action: g.action } },
      });
      if (perm) {
        await prisma.rolePermission.createMany({
          data: [{ roleId: role.id, permissionId: perm.id }],
          skipDuplicates: true,
        });
      }
    }
    return role.id;
  }

  async function makeUser(who: Who, roleName: string, mfgRole: MfgRole | null): Promise<void> {
    const roleId = await ensureRole(roleName);
    const u = await prisma.user.create({
      data: {
        username: `p1ht-${who}-${sfx}`,
        password: await argon2.hash(password),
        firstName: 'P1',
        lastName: who,
        mfgRole,
        warehouseScope: 'phoi-son-han',
        roles: { create: [{ roleId }] },
      },
    });
    ids[who] = u.id;
    userIds.push(u.id);
  }

  async function login(who: Who): Promise<void> {
    const res = await request(server())
      .post('/api/v1/auth/login')
      .send({ username: `p1ht-${who}-${sfx}`, password })
      .expect(200);
    tokens[who] = (res.body as ApiEnvelope<{ accessToken: string }>).data.accessToken;
  }

  const runMigration = async (): Promise<void> => {
    const sql = readFileSync(
      join(__dirname, '../prisma/migrations', MIGRATION_100100, 'migration.sql'),
      'utf8',
    )
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of sql) await prisma.$executeRawUnsafe(statement);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RealtimeService)
      .useValue({
        publishEntityChanged: jest.fn(),
        publishNotificationCreated: jest.fn(),
        publishNotificationChanged: jest.fn(),
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PRISMA_SERVICE);
    liveAuth = app.get(LiveAuthService);

    // quyền: đủ module x action (createMany bỏ qua dòng đã có)
    await prisma.permission.createMany({
      data: Object.values(PERMISSION_MODULES).flatMap((module) =>
        Object.values(PermissionAction).map((action) => ({ module, action })),
      ),
      skipDuplicates: true,
    });
    kcsRoleId = await ensureRole(BUSINESS_ROLES.KCS_STAFF);
    viewPermId = (
      await prisma.permission.findUniqueOrThrow({
        where: {
          module_action: {
            module: PERMISSION_MODULES.FLOOR_REPORT,
            action: PermissionAction.VIEW,
          },
        },
      })
    ).id;
    // trạng thái "TRƯỚC migration": KCS_STAFF chưa có FLOOR_REPORT:VIEW
    linkExistedBefore =
      (await prisma.rolePermission.count({
        where: { roleId: kcsRoleId, permissionId: viewPermId },
      })) > 0;
    await prisma.rolePermission.deleteMany({
      where: { roleId: kcsRoleId, permissionId: viewPermId },
    });

    await makeUser('kcs', BUSINESS_ROLES.KCS_STAFF, MfgRole.KCS);
    await makeUser('qlsx', BUSINESS_ROLES.PRODUCTION_MANAGER, MfgRole.PRODUCTION_MANAGER);
    await makeUser('boss', BUSINESS_ROLES.BOSS, null);
    await makeUser('worker', BUSINESS_ROLES.FLOOR_WORKER, MfgRole.HAN);
    await makeUser('phoi', BUSINESS_ROLES.PHOI_STAFF, MfgRole.PHOI);
    await makeUser('han', BUSINESS_ROLES.HAN_STAFF, MfgRole.HAN);
    for (const who of Object.keys(ids) as Who[]) await login(who); // token KCS cấp TRƯỚC migration

    world = new P1World({ prisma, ledger: app.get(StockLedgerService) }, `ht1-${sfx}`);
    await world.init();
  });

  afterAll(async () => {
    if (world) await world.cleanup();
    if (prisma) {
      // trả đúng trạng thái: vai có sẵn thì dòng quyền KCS (nếu có từ trước) phải còn; vai do test tạo thì xoá hẳn
      if (linkExistedBefore && kcsRoleId && viewPermId) {
        await prisma.rolePermission.createMany({
          data: [{ roleId: kcsRoleId, permissionId: viewPermId }],
          skipDuplicates: true,
        });
      }
      if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      if (createdRoleIds.length > 0) {
        await purgeRoleRows(prisma, createdRoleIds);
      }
    }
    if (app) await app.close();
  });

  // =====================================================================================
  // AC3: quyền KCS + token cấp trước migration
  // =====================================================================================
  describe('AC3: KCS_STAFF có FLOOR_REPORT:VIEW sau migration 100100', () => {
    it('đối chứng TRƯỚC migration: KCS chưa có FLOOR_REPORT:VIEW -> GET /floor/review 403', async () => {
      await call('kcs', 'get', '/floor/review?stage=PHOI').expect(403);
    });

    it('chạy SQL của migration: role_permissions có ĐÚNG 1 dòng KCS_STAFF - FLOOR_REPORT:VIEW (chạy lại không nhân đôi)', async () => {
      await runMigration();
      await runMigration();
      expect(
        await prisma.rolePermission.count({
          where: { roleId: kcsRoleId, permissionId: viewPermId },
        }),
      ).toBe(1);
    });

    it('token cấp TRƯỚC migration: sau khi bộ nhớ LiveAuth hết hạn (≤ 30 giây thật; ở đây xoá bộ nhớ) GET /floor/review -> 200, không cần đăng nhập lại', async () => {
      liveAuth.invalidate(ids.kcs);
      const res = await call('kcs', 'get', '/floor/review?stage=PHOI').expect(200);
      expect(res.body).toBeDefined();
    });

    it.each(['PHOI', 'HAN', 'SON'])('KCS gọi GET /floor/review?stage=%s -> 200', async (stage) => {
      await call('kcs', 'get', `/floor/review?stage=${stage}`).expect(200);
    });

    it('5 route close của KCS: 201 hoặc lỗi nghiệp vụ 4xx, KHÔNG 403 / 401 / 5xx (dữ liệu giả không tồn tại)', async () => {
      const gone = '999999999';
      const attempts: Array<[string, object | undefined]> = [
        [`/floor/kcs/cut-bundles/${gone}/close`, undefined],
        [
          '/floor/kcs/step-groups/close',
          {
            productionInvoiceId: gone,
            materialId: gone,
            step: 'UON',
            productionOrderId: gone,
            workerId: null,
          },
        ],
        [`/floor/kcs/production-batches/${gone}/close`, undefined],
        [
          '/floor/kcs/piece-step-groups/close',
          { productionOrderId: gone, pieceId: gone, step: 'DAP' },
        ],
        [
          '/floor/kcs/material-yield-groups/close',
          { productionInvoiceId: gone, recipeId: gone, step: 'CAT' },
        ],
      ];
      for (const [path, body] of attempts) {
        const res = await call('kcs', 'post', path, body);
        expect([201, 400, 404, 409]).toContain(res.status);
        expect(res.status).not.toBe(403);
      }
    });

    it.each(['/floor/summary', '/floor/queue?stage=PHOI', '/floor/workers', '/floor/workstations'])(
      'KCS gọi %s -> 403 (chỉ QLSX)',
      async (path) => {
        await call('kcs', 'get', path).expect(403);
      },
    );

    it('KCS không quét mã / báo tại máy: GET /floor/scan/:token và POST /floor/scan/:token/reports -> 403', async () => {
      await call('kcs', 'get', '/floor/scan/khong-co-ma').expect(403);
      await call('kcs', 'post', '/floor/scan/khong-co-ma/reports', { lines: [] }).expect(403);
    });

    it('KCS gọi GET /floor/my-output -> 200', async () => {
      await call('kcs', 'get', '/floor/my-output').expect(200);
    });

    it('QLSX: GET /floor/review và GET /floor/summary -> 200', async () => {
      await call('qlsx', 'get', '/floor/review?stage=HAN').expect(200);
      await call('qlsx', 'get', '/floor/summary').expect(200);
    });

    it.each(['qlsx', 'boss', 'worker'] as const)(
      '%s gọi 5 route close của KCS -> 403',
      async (who) => {
        const gone = '999999999';
        const paths: Array<[string, object | undefined]> = [
          [`/floor/kcs/cut-bundles/${gone}/close`, undefined],
          [
            '/floor/kcs/step-groups/close',
            {
              productionInvoiceId: gone,
              materialId: gone,
              step: 'UON',
              productionOrderId: gone,
              workerId: null,
            },
          ],
          [`/floor/kcs/production-batches/${gone}/close`, undefined],
          [
            '/floor/kcs/piece-step-groups/close',
            { productionOrderId: gone, pieceId: gone, step: 'DAP' },
          ],
          [
            '/floor/kcs/material-yield-groups/close',
            { productionInvoiceId: gone, recipeId: gone, step: 'CAT' },
          ],
        ];
        for (const [path, body] of paths) {
          const res = await call(who, 'post', path, body);
          expect({ who, path, status: res.status }).toEqual({ who, path, status: 403 });
        }
      },
    );
  });

  // =====================================================================================
  // AC13: 3 route send-kcs + route báo cũ
  // =====================================================================================
  describe('AC13: route gửi KCS cũ và route báo cũ', () => {
    it('3 route send-kcs của QLSX -> 403 đúng câu "Từ nay KCS tự chấm ..."', async () => {
      const gone = '999999999';
      const attempts: Array<[string, object | undefined]> = [
        [`/floor/review/cut-bundles/${gone}/send-kcs`, undefined],
        [`/floor/review/production-batches/${gone}/send-kcs`, undefined],
        [
          '/floor/review/step-groups/send-kcs',
          { productionInvoiceId: gone, materialId: gone, step: 'UON', productionOrderId: gone },
        ],
      ];
      for (const [path, body] of attempts) {
        const res = await call('qlsx', 'post', path, body);
        expect({ path, status: res.status }).toEqual({ path, status: 403 });
        expect(bodyText(res)).toContain(SEND_KCS_REMOVED);
      }
    });

    it('route báo Cắt / công đoạn phụ cũ của tài khoản thống kê Phôi -> 403 câu mới (KCS tự chấm; QLSX hủy lần báo sai ở "Sản lượng xưởng")', async () => {
      const routes: Array<[string, string]> = [
        ['post', '/steel-issues/1/cut-batches'],
        ['post', '/cut-bundles/1/finish'],
        ['post', '/production-invoices/1/step-batches'],
        ['post', '/production-invoices/1/step-bundles'],
      ];
      for (const [, path] of routes) {
        const res = await call('phoi', 'post', path);
        expect({ path, status: res.status }).toEqual({ path, status: 403 });
        const text = bodyText(res);
        expect(text).toContain('Báo cắt và công đoạn phụ làm bằng quét mã QR tại máy.');
        expect(text).toMatch(/KCS tự chấm; QLSX hủy lần báo sai ở .{1,3}Sản lượng xưởng/);
        expect(text).not.toContain('gửi KCS ở');
      }
    });

    it('route báo Hàn / Sơn cũ (production-batches) của tài khoản thống kê Hàn -> 403 câu mới', async () => {
      const res = await call('han', 'post', '/production-orders/1/production-batches', {
        stage: 'HAN',
        pieceId: '1',
        reportedQty: 1,
      });
      expect(res.status).toBe(403);
      const text = bodyText(res);
      expect(text).toContain('Báo sản lượng Hàn / Sơn làm bằng quét mã QR tại máy.');
      expect(text).toMatch(/KCS tự chấm; QLSX hủy lần báo sai ở .{1,3}Sản lượng xưởng/);
      expect(text).not.toContain('kiểm rồi gửi KCS');
    });
  });

  // =====================================================================================
  // AC56
  // =====================================================================================
  describe('AC56: route hoàn tác cũ đã xoá', () => {
    it.each(['phoi', 'qlsx'] as const)(
      '%s: POST /cut-bundles/:id/undo-last-batch -> 404',
      async (who) => {
        await call(who, 'post', '/cut-bundles/1/undo-last-batch').expect(404);
      },
    );
  });

  // =====================================================================================
  // AC28 / AC32 / AC47 (phần API): kiểm số ở route chấm, qua ValidationPipe thật
  // =====================================================================================
  describe('AC28 / AC32 / AC47: body của route chấm', () => {
    it('shortQty âm -> 400 ở cả 4 route chấm (ValidationPipe)', async () => {
      const seg = (shortQty: number) => ({
        segments: [{ segmentSpecId: '1', failedQty: 0, shortQty }],
      });
      const qty = { failedQty: 0, shortQty: -1 };
      const attempts: Array<[string, object]> = [
        ['/cut-bundles/1/qc-review', seg(-1)],
        ['/step-bundles/1/qc-review', seg(-1)],
        ['/production-batches/1/qc-review', qty],
        ['/piece-step-bundles/1/qc-review', qty],
        ['/material-yield-step-bundles/1/qc-review', qty],
      ];
      for (const [path, body] of attempts) {
        const res = await call('kcs', 'post', path, body);
        expect({ path, status: res.status }).toEqual({ path, status: 400 });
      }
    });

    it('công đoạn phụ có lỗi mà thiếu scrapQty -> 400 "chọn số đoạn lỗi phải bỏ ... tải lại trang"; scrapQty lớn hơn lỗi -> 400; đợt không đổi', async () => {
      const w = await world.newInvoice({ quantities: [10] });
      const bundleId = await world.seedStepBundle(w, {
        step: 'UON',
        status: StepBundleStatus.AWAITING_QC,
      });
      await world.seedStepBatch(w, {
        step: 'UON',
        segs: [{ specId: world.spec355, qty: 5 }],
        bundleId,
      });
      const path = `/step-bundles/${bundleId}/qc-review`;
      const noScrap = await call('kcs', 'post', path, {
        segments: [{ segmentSpecId: world.spec355.toString(), failedQty: 2 }],
      });
      expect(noScrap.status).toBe(400);
      expect(bodyText(noScrap)).toContain('chọn số đoạn lỗi phải bỏ');
      expect(bodyText(noScrap)).toContain('tải lại trang');

      const tooMuch = await call('kcs', 'post', path, {
        segments: [{ segmentSpecId: world.spec355.toString(), failedQty: 2, scrapQty: 3 }],
      });
      expect(tooMuch.status).toBe(400);
      expect(bodyText(tooMuch)).toContain('số bỏ (3) lớn hơn số lỗi (2)');

      expect(await world.qcReviews({ stepBundleId: bundleId })).toHaveLength(0);
      const bundle = await prisma.stepBundle.findUniqueOrThrow({ where: { id: bundleId } });
      expect(bundle.status).toBe(StepBundleStatus.AWAITING_QC);
    });

    it('chấm Cắt có kèm scrapQty -> 201 và lưu scrapQty = 0 (Cắt bỏ qua ô này)', async () => {
      const w = await world.newInvoice({ quantities: [10] });
      const issue = await world.newIssue(w.piId);
      const { bundleId } = await world.seedCutBundle(issue, w, {
        segs: [{ specId: world.spec441, qty: 5 }],
        status: 'AWAITING_QC',
      });
      const res = await call('kcs', 'post', `/cut-bundles/${bundleId}/qc-review`, {
        segments: [{ segmentSpecId: world.spec441.toString(), failedQty: 1, scrapQty: 1 }],
      });
      expect(res.status).toBe(201);
      const rows = await prisma.$queryRawUnsafe<Array<{ failedQty: number; scrapQty: number }>>(
        `SELECT s."failedQty", s."scrapQty" FROM "qc_review_segments" s JOIN "qc_reviews" r ON r."id" = s."qcReviewId" WHERE r."cutBundleId" = ${bundleId}`,
      );
      expect(rows).toEqual([{ failedQty: 1, scrapQty: 0 }]);
    });
  });
});
