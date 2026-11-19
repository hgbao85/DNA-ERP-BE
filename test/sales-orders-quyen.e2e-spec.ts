import { randomUUID } from 'crypto';
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
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../src/common/constants/roles.constant';
import { MfgRole, PermissionAction } from '../src/generated/prisma/client';
import { LiveAuthService } from '../src/modules/auth/live-auth.service';
import { PRISMA_SERVICE, PrismaServiceType } from '../src/prisma/prisma.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { ApiEnvelope } from './api-envelope.type';
import { ensureRoleRow, purgeRoleRows } from './integration/p1-kcs.fixture';

/**
 * Lỗi C1 (19/11/2026, phương án B) - bảng VAI x ROUTE GHI của /sales-orders qua HTTP thật (AppModule + supertest, DB test chung).
 *
 * 5 route ghi chỉ cho Sales + Admin (@RequireRole SALES_STAFF, ADMIN) dù WAREHOUSE_STAFF (vai nền của mọi tài khoản văn phòng)
 * vẫn giữ SALES_ORDER:UPDATE cho /booking-shipments:
 *   POST /sales-orders, PATCH /:id, DELETE /:id, POST /:id/items, PATCH /:id/items/:itemId
 * Không đổi: GET /sales-orders, GET /:id (VIEW, mọi vai nền xem được); POST /booking-shipments/slip-code của thủ kho thành phẩm.
 *
 * Câu 403 do chặn VAI: "Tài khoản không có vai trò được làm việc này". Ô nào tài khoản vốn THIẾU quyền (không có SALES_ORDER:<action>
 * của route) thì 403 có thể là câu "Tài khoản chưa được cấp quyền" (tuỳ thứ tự guard) - test chấp nhận 1 trong 2 câu ở ô đó và in bảng
 * câu thật ra console cuối file. Vai tạo THEO hằng số role-permissions.constant.ts (chỉ tạo vai chưa có trong DB test, chỉ dọn đúng
 * vai / dữ liệu mình tạo). Mật khẩu thử sinh ngẫu nhiên lúc chạy, không ghi ở đâu.
 */
const ROLE_MSG = 'Tài khoản không có vai trò được làm việc này';
const PERM_MSG = 'Tài khoản chưa được cấp quyền';

// custom = vai TỰ TẠO (không phải SALES_STAFF / ADMIN) được cấp đủ mọi quyền SALES_ORDER - chứng minh lớp chặn VAI có tác dụng cả ở
// route tạo / xoá đơn (các vai hệ thống khác vốn thiếu CREATE / DELETE nên ở 2 route đó bị chặn bởi quyền trước khi tới chặn vai).
type Who = 'sales' | 'admin' | 'wh' | 'buyer' | 'planner' | 'matmgr' | 'boss' | 'custom';
type Route = 'create' | 'update' | 'remove' | 'addItem' | 'updateItem';

const ROUTES: Route[] = ['create', 'update', 'remove', 'addItem', 'updateItem'];
const ROUTE_ACTION: Record<Route, PermissionAction> = {
  create: PermissionAction.CREATE,
  update: PermissionAction.UPDATE,
  remove: PermissionAction.DELETE,
  addItem: PermissionAction.UPDATE,
  updateItem: PermissionAction.UPDATE,
};

const USERS: Record<Who, { roles: string[]; scope: string | null; mfgRole: MfgRole | null }> = {
  sales: {
    roles: [BUSINESS_ROLES.SALES_STAFF, BUSINESS_ROLES.WAREHOUSE_STAFF],
    scope: null,
    mfgRole: null,
  },
  admin: { roles: [DEFAULT_ROLES.ADMIN], scope: null, mfgRole: null },
  wh: { roles: [BUSINESS_ROLES.WAREHOUSE_STAFF], scope: 'thanh-pham', mfgRole: null },
  buyer: {
    roles: [BUSINESS_ROLES.PURCHASER, BUSINESS_ROLES.WAREHOUSE_STAFF],
    scope: null,
    mfgRole: null,
  },
  planner: {
    roles: [BUSINESS_ROLES.PRODUCTION_PLANNER, BUSINESS_ROLES.WAREHOUSE_STAFF],
    scope: null,
    mfgRole: null,
  },
  matmgr: {
    roles: [BUSINESS_ROLES.MATERIALS_MANAGER, BUSINESS_ROLES.WAREHOUSE_STAFF],
    scope: null,
    mfgRole: null,
  },
  boss: { roles: [BUSINESS_ROLES.BOSS], scope: null, mfgRole: null },
  custom: { roles: [], scope: null, mfgRole: null }, // vai tự tạo gắn ở beforeAll
};

const BLOCKED: Who[] = ['wh', 'buyer', 'planner', 'matmgr', 'boss'];

describe('C1: vai x route ghi của /sales-orders (e2e, DB test thật)', () => {
  let app: INestApplication;
  let prisma: PrismaServiceType;
  let liveAuth: LiveAuthService;
  const password = `Pw-${randomUUID()}`;
  const sfx = Date.now();
  const tag = `c1q-${sfx}`;
  const createdRoleIds: string[] = [];
  const addedLinks: Array<{ roleId: string; permissionId: string }> = [];
  const userIds: string[] = [];
  const ids = {} as Record<Who, string>;
  const tokens = {} as Record<Who, string>;
  const seen: string[] = [];

  let customerId: string;
  let productA: string;
  let productB: string;
  let productC: string;
  let orderId: string;
  let itemId: string;
  let orderCodeSeq = 0;

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];
  const bodyText = (res: request.Response): string => JSON.stringify(res.body);
  const nextCode = (): string => `${tag}-${++orderCodeSeq}`;

  function grantsOf(role: string): Array<{ module: string; action: PermissionAction }> {
    const allActions = Object.values(PermissionAction);
    if (role === DEFAULT_ROLES.ADMIN) {
      return Object.values(PERMISSION_MODULES).flatMap((module) =>
        allActions.map((action) => ({ module, action })),
      );
    }
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

  /** Vai có sẵn thì dùng nguyên (ADMIN: bù đủ quyền, nhớ để gỡ); chưa có thì tạo theo hằng số (và nhớ để dọn). */
  async function ensureRole(name: string): Promise<string> {
    const { id, created } = await ensureRoleRow(prisma, name);
    if (created) createdRoleIds.push(id);
    if (!created && name !== DEFAULT_ROLES.ADMIN) return id;
    for (const g of grantsOf(name)) {
      const perm = await prisma.permission.findUnique({
        where: { module_action: { module: g.module, action: g.action } },
      });
      if (!perm) continue;
      const exists = await prisma.rolePermission.count({
        where: { roleId: id, permissionId: perm.id },
      });
      if (exists > 0) continue;
      await prisma.rolePermission.create({ data: { roleId: id, permissionId: perm.id } });
      if (!created) addedLinks.push({ roleId: id, permissionId: perm.id });
    }
    return id;
  }

  async function makeUser(who: Who): Promise<void> {
    const spec = USERS[who];
    const roleIds: string[] = [];
    for (const r of spec.roles) roleIds.push(await ensureRole(r));
    const u = await prisma.user.create({
      data: {
        username: `${tag}-${who}`,
        password: await argon2.hash(password),
        firstName: 'C1',
        lastName: who,
        mfgRole: spec.mfgRole,
        warehouseScope: spec.scope,
        isSale: who === 'sales',
        isPurchaser: who === 'buyer',
        isProductPlanner: who === 'planner',
        roles: { create: roleIds.map((roleId) => ({ roleId })) },
      },
    });
    ids[who] = u.id;
    userIds.push(u.id);
  }

  async function login(who: Who): Promise<void> {
    const res = await request(server())
      .post('/api/v1/auth/login')
      .send({ username: `${tag}-${who}`, password })
      .expect(200);
    tokens[who] = (res.body as ApiEnvelope<{ accessToken: string }>).data.accessToken;
  }

  /** Tài khoản có thật sự mang quyền SALES_ORDER:<action> không (đọc DB, gộp mọi vai của tài khoản). */
  async function hasPerm(who: Who, action: PermissionAction): Promise<boolean> {
    const n = await prisma.rolePermission.count({
      where: {
        permission: { module: PERMISSION_MODULES.SALES_ORDER, action },
        role: { users: { some: { userId: ids[who] } } },
      },
    });
    return n > 0;
  }

  const auth = (who: Who, req: request.Test): request.Test =>
    req.set('Authorization', `Bearer ${tokens[who]}`);

  const itemBody = (productId: string, qty = 2) => ({
    mfgProductId: productId,
    skuName: `${tag}-sku`,
    totalQty: qty,
    deliveryDate: '2026-12-31',
  });

  /** Gọi 1 trong 5 route ghi. `target` = đơn / dòng dùng chung của test. */
  function callRoute(who: Who, route: Route, target: { order: string; item: string }) {
    const base = '/api/v1/sales-orders';
    switch (route) {
      case 'create':
        return auth(
          who,
          request(server())
            .post(base)
            .send({
              orderCode: nextCode(),
              customerId,
              orderDate: '2026-11-19',
              items: [itemBody(productC)],
            }),
        );
      case 'update':
        return auth(
          who,
          request(server())
            .patch(`${base}/${target.order}`)
            .send({ depositConfirmed: true, note: `${tag}-doi` }),
        );
      case 'remove':
        return auth(who, request(server()).delete(`${base}/${target.order}`));
      case 'addItem':
        return auth(
          who,
          request(server()).post(`${base}/${target.order}/items`).send(itemBody(productB, 3)),
        );
      case 'updateItem':
        return auth(
          who,
          request(server()).patch(`${base}/${target.order}/items/${target.item}`).send({
            totalQty: 99,
          }),
        );
    }
  }

  async function snapshot(id: string) {
    const o = await prisma.salesOrder.findUnique({
      where: { id: BigInt(id) },
      include: { items: { orderBy: { id: 'asc' } } },
    });
    if (!o) return null;
    return {
      note: o.note,
      depositConfirmed: o.depositConfirmed,
      isActive: o.isActive,
      items: o.items.map((i) => ({ id: i.id.toString(), totalQty: i.totalQty })),
    };
  }

  /** Tạo 1 đơn riêng bằng tài khoản Sales (đơn dùng 1 lần, vd cho ca xoá). */
  async function createOrderAsSales(): Promise<{ order: string; item: string }> {
    const res = await auth(
      'sales',
      request(server())
        .post('/api/v1/sales-orders')
        .send({
          orderCode: nextCode(),
          customerId,
          orderDate: '2026-11-19',
          items: [itemBody(productA)],
        }),
    );
    expect({ status: res.status, body: bodyText(res) }).toMatchObject({ status: 201 });
    const d = (
      res.body as ApiEnvelope<{ id: string | number; items: Array<{ id: string | number }> }>
    ).data;
    return { order: String(d.id), item: String(d.items[0].id) };
  }

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

    await prisma.permission.createMany({
      data: Object.values(PERMISSION_MODULES).flatMap((module) =>
        Object.values(PermissionAction).map((action) => ({ module, action })),
      ),
      skipDuplicates: true,
    });

    for (const who of Object.keys(USERS) as Who[]) await makeUser(who);
    // Vai tự tạo: đủ mọi quyền SALES_ORDER, tên không phải SALES_STAFF / ADMIN (dọn bằng purgeRoleRows như vai test khác).
    const customRole = await ensureRoleRow(prisma, `${tag}-vai-tu-tao`);
    if (customRole.created) createdRoleIds.push(customRole.id);
    const soPerms = await prisma.permission.findMany({
      where: { module: PERMISSION_MODULES.SALES_ORDER },
    });
    await prisma.rolePermission.createMany({
      data: soPerms.map((p) => ({ roleId: customRole.id, permissionId: p.id })),
      skipDuplicates: true,
    });
    await prisma.userRole.create({ data: { userId: ids.custom, roleId: customRole.id } });
    for (const who of Object.keys(USERS) as Who[]) await login(who);

    const customer = await prisma.customer.create({ data: { name: `${tag}-khach` } });
    customerId = customer.id.toString();
    const mk = async (n: string) =>
      (
        await prisma.mfgProduct.create({
          data: { factoryCode: `${tag}-${n}`, name: `${tag}-${n}` },
        })
      ).id.toString();
    productA = await mk('A');
    productB = await mk('B');
    productC = await mk('C');

    const o = await createOrderAsSales();
    orderId = o.order;
    itemId = o.item;
  });

  afterAll(async () => {
    if (prisma) {
      const orders = await prisma.salesOrder.findMany({
        where: { orderCode: { startsWith: tag } },
        select: { id: true },
      });
      const oids = orders.map((o) => o.id);
      if (oids.length > 0) {
        await prisma.bookingLine.deleteMany({
          where: { salesOrderItem: { salesOrderId: { in: oids } } },
        });
        await prisma.productionInvoiceItem.deleteMany({ where: { salesOrderId: { in: oids } } });
        await prisma.productionInvoice.deleteMany({ where: { salesOrderId: { in: oids } } });
        await prisma.salesOrderItem.deleteMany({ where: { salesOrderId: { in: oids } } });
        await prisma.salesOrder.deleteMany({ where: { id: { in: oids } } });
      }
      await prisma.mfgProduct.deleteMany({ where: { factoryCode: { startsWith: tag } } });
      await prisma.customer.deleteMany({ where: { name: { startsWith: tag } } });
      if (userIds.length > 0) {
        await prisma.reservedSlipCode.deleteMany({ where: { createdById: { in: userIds } } });
      }
      for (const l of addedLinks) {
        await prisma.rolePermission.deleteMany({
          where: { roleId: l.roleId, permissionId: l.permissionId },
        });
      }
      if (userIds.length > 0) {
        // xoá CỨNG (User là mô hình xoá mềm) để không để lại dòng trong DB test
        await prisma.$executeRaw`DELETE FROM "user_roles" WHERE "userId" = ANY(${userIds}::text[])`;
        await prisma.$executeRaw`DELETE FROM "users" WHERE "id" = ANY(${userIds}::text[])`;
      }
      if (createdRoleIds.length > 0) await purgeRoleRows(prisma, createdRoleIds);
    }
    if (app) await app.close();
    console.info(`Bảng câu 403 thật (vai/route -> loại câu):\n${seen.join('\n')}`);
  });

  // =====================================================================================
  describe('Sales (+ WAREHOUSE_STAFF nền) và Admin: KHÔNG 403 ở cả 5 route ghi', () => {
    it('sales: POST tạo đơn 201', async () => {
      const res = await callRoute('sales', 'create', { order: orderId, item: itemId });
      expect(res.status).toBe(201);
    });

    it('sales: PATCH /:id 200 và dữ liệu đổi', async () => {
      const res = await callRoute('sales', 'update', { order: orderId, item: itemId });
      expect(res.status).toBe(200);
      const snap = await snapshot(orderId);
      expect(snap).toMatchObject({ depositConfirmed: true, note: `${tag}-doi` });
    });

    it('sales: POST /:id/items 201', async () => {
      const res = await callRoute('sales', 'addItem', { order: orderId, item: itemId });
      expect(res.status).toBe(201);
    });

    it('sales: PATCH /:id/items/:itemId 200 và totalQty đổi', async () => {
      const res = await callRoute('sales', 'updateItem', { order: orderId, item: itemId });
      expect(res.status).toBe(200);
      const snap = await snapshot(orderId);
      expect(snap?.items.find((i) => i.id === itemId)?.totalQty).toBe(99);
    });

    it('sales: DELETE /:id 204 (đơn riêng) và đơn biến mất', async () => {
      const own = await createOrderAsSales();
      const res = await callRoute('sales', 'remove', own);
      expect(res.status).toBe(204);
      expect(await snapshot(own.order)).toBeNull();
    });

    // QA 19/11: đòi đúng mã thành công (trước chỉ "không 403"); mỗi route chạy trên 1 đơn riêng do Sales tạo.
    const ADMIN_OK: Record<Route, number> = {
      create: 201,
      update: 200,
      remove: 204,
      addItem: 201,
      updateItem: 200,
    };
    it.each(ROUTES)('admin: %s -> đúng mã thành công trên đơn riêng', async (route) => {
      const own = await createOrderAsSales();
      const res = await callRoute('admin', route, own);
      expect({ route, status: res.status, body: bodyText(res) }).toMatchObject({
        route,
        status: ADMIN_OK[route],
      });
    });

    it('admin: PATCH /:id 200 và DELETE /:id 204 (đối chứng 2xx thật)', async () => {
      const own = await createOrderAsSales();
      await callRoute('admin', 'update', own).expect(200);
      await callRoute('admin', 'remove', own).expect(204);
      expect(await snapshot(own.order)).toBeNull();
    });
  });

  // =====================================================================================
  describe('Vai KHÔNG phải Sales / Admin: 403 ở cả 5 route ghi, dữ liệu không đổi', () => {
    it.each(BLOCKED)('%s: 5 route ghi -> 403, đơn trong DB không đổi', async (who) => {
      liveAuth.invalidate(ids[who]);
      for (const route of ROUTES) {
        const before = await snapshot(orderId);
        const codeCount = await prisma.salesOrder.count({
          where: { orderCode: { startsWith: tag } },
        });
        const res = await callRoute(who, route, { order: orderId, item: itemId });
        const text = bodyText(res);
        expect({ who, route, status: res.status }).toEqual({ who, route, status: 403 });

        const hasPermission = await hasPerm(who, ROUTE_ACTION[route]);
        const isRoleMsg = text.includes(ROLE_MSG);
        const isPermMsg = text.includes(PERM_MSG);
        seen.push(
          `${who} ${route}: ${isRoleMsg ? 'CHẶN VAI' : isPermMsg ? 'THIẾU QUYỀN' : 'KHÁC'}`,
        );
        if (hasPermission) {
          // có đủ quyền mà vẫn 403 -> chỉ có thể do chặn vai, phải đúng câu
          expect(text).toContain(ROLE_MSG);
        } else {
          expect(isRoleMsg || isPermMsg).toBe(true);
        }

        expect(await snapshot(orderId)).toEqual(before);
        expect(await prisma.salesOrder.count({ where: { orderCode: { startsWith: tag } } })).toBe(
          codeCount,
        );
      }
    });

    it.each(['wh', 'buyer', 'planner', 'matmgr'] as const)(
      '%s: có SALES_ORDER:UPDATE (nền WAREHOUSE_STAFF) nhưng PATCH /:id, POST items, PATCH item bị chặn VAI đúng câu',
      async (who) => {
        expect(await hasPerm(who, PermissionAction.UPDATE)).toBe(true);
        for (const route of ['update', 'addItem', 'updateItem'] as const) {
          const res = await callRoute(who, route, { order: orderId, item: itemId });
          expect({ who, route, status: res.status }).toEqual({ who, route, status: 403 });
          expect(bodyText(res)).toContain(ROLE_MSG);
        }
      },
    );

    it('custom (vai tự tạo đủ mọi quyền SALES_ORDER): 5 route ghi -> 403 đúng câu chặn VAI, đơn còn nguyên', async () => {
      liveAuth.invalidate(ids.custom);
      for (const action of [
        PermissionAction.CREATE,
        PermissionAction.UPDATE,
        PermissionAction.DELETE,
      ]) {
        expect(await hasPerm('custom', action)).toBe(true);
      }
      for (const route of ROUTES) {
        const own = await createOrderAsSales();
        const before = await snapshot(own.order);
        const codeCount = await prisma.salesOrder.count({
          where: { orderCode: { startsWith: tag } },
        });
        const res = await callRoute('custom', route, own);
        expect({ route, status: res.status }).toEqual({ route, status: 403 });
        expect(bodyText(res)).toContain(ROLE_MSG);
        seen.push(`custom ${route}: CHẶN VAI`);
        expect(await snapshot(own.order)).toEqual(before);
        expect(await prisma.salesOrder.count({ where: { orderCode: { startsWith: tag } } })).toBe(
          codeCount,
        );
      }
    });

    it('wh: bị chặn khi đơn chưa có depositConfirmed - đối chứng đọc lại: đơn riêng vẫn depositConfirmed=false', async () => {
      const own = await createOrderAsSales();
      const res = await callRoute('wh', 'update', own);
      expect(res.status).toBe(403);
      expect((await snapshot(own.order))?.depositConfirmed).toBe(false);
    });
  });

  // =====================================================================================
  describe('Không đổi: route đọc và đường xuất hàng', () => {
    it.each(['wh', 'planner', 'sales', 'buyer', 'matmgr', 'boss', 'admin'] as const)(
      '%s: GET /sales-orders và GET /sales-orders/:id -> 200',
      async (who) => {
        const list = await auth(who, request(server()).get('/api/v1/sales-orders?limit=5'));
        expect(list.status).toBe(200);
        const one = await auth(who, request(server()).get(`/api/v1/sales-orders/${orderId}`));
        expect(one.status).toBe(200);
      },
    );

    it('wh (thủ kho thành phẩm): POST /booking-shipments/slip-code -> không 403 (đường xuất hàng không bị chặn)', async () => {
      const res = await auth(
        'wh',
        request(server()).post('/api/v1/booking-shipments/slip-code').send({}),
      );
      expect({ status: res.status, body: bodyText(res) }).toMatchObject({ status: 200 });
      expect(res.status).not.toBe(403);
    });
  });
});
