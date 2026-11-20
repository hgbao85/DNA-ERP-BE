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
import { validationExceptionFactory } from '../src/common/pipes/validation-exception.factory';
import {
  CuttingProposalStatus,
  MfgRole,
  PermissionAction,
  StepBundleStatus,
} from '../src/generated/prisma/client';
import { StockLedgerService } from '../src/modules/stock/stock-ledger.service';
import { PRISMA_SERVICE, PrismaServiceType } from '../src/prisma/prisma.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { ApiEnvelope } from './api-envelope.type';
import { P1World, ensureRoleRow, purgeRoleRows } from './integration/p1-kcs.fixture';

/**
 * Mục 4 chuẩn ERP (20/11/2026) - kiểm qua HTTP thật (AppModule + supertest, DB test, ValidationPipe dựng ĐÚNG như src/main.ts).
 *  T3-5   POST /segment-stock/recompute chỉ Admin (cả xem thử): vai khác 403, Admin qua lớp quyền
 *  T1-8   URL ảnh bằng chứng KCS / Chuyền kiểm: chỉ nhận tệp Cloudinary của hệ thống (javascript:, http, host lạ, cloud lạ -> 400)
 *  T4-10  signedSlipUrls phiếu xuất kho: cùng bộ kiểm, 400 cả lô khi một giá trị sai
 *  T2-5   activeOnly / includeCancelled sai kiểu -> 400; from > to -> 400; body sai kiểu -> 400
 *  T3-9   sửa tồn + nhập kho: cùng khoá khác nội dung / khác người -> 422; cùng khoá cùng nội dung -> trả bản cũ, không nhân đôi
 *  T1-9   POST /notifications cùng khoá -> 1 bản; khác nội dung -> 422; khoá quá dài -> 400
 *  XOA-SKU (A) / T4-7 / T2-6 / T2-2 / T3-12 / T4-5 / T4-8
 *
 * KHÔNG dựng được qua HTTP (ghi rõ để Lead biết): T4-4 (báo sản lượng qua QR cần hàng đợi lệnh + máy + sắt đã nhận; phủ bởi
 * unit của dev và test/integration/p1-chan-vuot-race), T3-9 nhập kho "phiếu mới" (cần đề xuất mua đã duyệt + kho NCC: dựng sẵn
 * phiếu đã ghi rồi gửi lại cùng khoá), XOA-SKU xoá kèm ảnh Cloudinary thật.
 *
 * Vai tạo theo hằng số role-permissions.constant.ts (chỉ tạo vai chưa có; ADMIN có sẵn thì bù quyền thiếu rồi gỡ đúng phần mình thêm).
 * Dữ liệu có tiền tố riêng, tự dọn (kể cả audit_logs). Chạy được trên DB mới tinh. Mật khẩu thử sinh ngẫu nhiên lúc chạy.
 */
jest.setTimeout(60_000);

const ROLE_MSG = 'Tài khoản không có vai trò được làm việc này';
const GONE = '999999999';
const URL_MSG = 'tệp đã tải lên hệ thống';
const CLOUD = 'dna-test-cloud-muc4';
const OK_IMG = `https://res.cloudinary.com/${CLOUD}/image/upload/v1700000000/dna-erp/muc4/anh-1.jpg`;
const OK_RAW = `https://res.cloudinary.com/${CLOUD}/raw/upload/v1/dna-erp/muc4/phieu-1.pdf`;
const BAD_URLS = [
  'javascript:alert(1)',
  'data:text/html;base64,PHNjcmlwdD4=',
  `http://res.cloudinary.com/${CLOUD}/image/upload/v1/dna-erp/a.jpg`,
  'https://evil.example.com/image/upload/v1/dna-erp/a.jpg',
  `https://res.cloudinary.com/cloud-khac/image/upload/v1/dna-erp/a.jpg`,
  `https://res.cloudinary.com/${CLOUD}/image/upload/v1/thu-muc-khac/a.jpg`,
  `https://res.cloudinary.com/${CLOUD}/image/upload/v1/dna-erp/a.jpg?x=1`,
  // 20/11/2026 (QA): '?' / '#' rỗng ở cuối - URL.search / URL.hash trả chuỗi rỗng nên check cũ bỏ sót.
  `${OK_IMG}?`,
  `${OK_IMG}#`,
  '/uploads/anh-tu-go.jpg',
];

type Who = 'admin' | 'whs' | 'kcs';

describe('Mục 4 chuẩn ERP 20/11 (e2e, DB test thật)', () => {
  let app: INestApplication;
  let prisma: PrismaServiceType;
  let world: P1World;
  const password = `Pw-${randomUUID()}`;
  const sfx = Date.now();
  const tag = `m4-${sfx}`;
  const short = String(sfx).slice(-6);
  const createdRoleIds: string[] = [];
  const addedLinks: Array<{ roleId: string; permissionId: string }> = [];
  const newPermissionIds: string[] = [];
  const startedAt = new Date();
  const userIds: string[] = [];
  const tokens = {} as Record<Who, string>;
  const ids = {} as Record<Who, string>;
  const prevCloud = process.env.CLOUDINARY_CLOUD_NAME;

  // dữ liệu dọn cuối
  const warehouseIds: bigint[] = [];
  const materialIds: bigint[] = [];
  const mfgProductIds: bigint[] = [];
  const planFormIds: bigint[] = [];
  const inspectionPlanFormIds: bigint[] = [];
  const supplierIds: string[] = [];
  const customerIds: string[] = [];
  const orderIds: string[] = [];
  const proposalIds: bigint[] = [];
  const notificationIds: string[] = [];
  const officeSupplyIds: bigint[] = [];
  const defectReasonIds: bigint[] = [];
  const receiptKeys: string[] = [];
  const adjustKeys: string[] = [];
  let whsScope = '';
  let realWh!: bigint;
  let virtualWh!: bigint;
  let adjMaterial!: bigint;

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];
  const bodyText = (res: request.Response): string => JSON.stringify(res.body);
  const data = <T>(res: request.Response): T => (res.body as ApiEnvelope<T>).data;
  const errName = (res: request.Response): string =>
    String((res.body as { error?: string }).error ?? '');

  function grantsOf(role: string): Array<{ module: string; action: PermissionAction }> {
    const allActions = Object.values(PermissionAction);
    if (role === DEFAULT_ROLES.ADMIN) {
      return Object.values(PERMISSION_MODULES).flatMap((module) =>
        allActions.map((action) => ({ module, action })),
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

  async function makeUser(
    who: Who,
    role: string,
    mfgRole: MfgRole | null,
    warehouseScope: string | null,
  ): Promise<void> {
    const roleId = await ensureRole(role);
    const u = await prisma.user.create({
      data: {
        username: `${tag}-${who}`,
        password: await argon2.hash(password),
        firstName: 'M4',
        lastName: who,
        mfgRole,
        warehouseScope,
        roles: { create: [{ roleId }] },
      },
    });
    userIds.push(u.id);
    ids[who] = u.id;
    const res = await request(server())
      .post('/api/v1/auth/login')
      .send({ username: `${tag}-${who}`, password })
      .expect(200);
    tokens[who] = data<{ accessToken: string }>(res).accessToken;
  }

  function call(
    who: Who | null,
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    body?: object,
    headers: Record<string, string> = {},
  ) {
    let req = request(server())[method](`/api/v1${path}`);
    if (who) req = req.set('Authorization', `Bearer ${tokens[who]}`);
    for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
    return body ? req.send(body) : req;
  }

  async function newWarehouse(code: string, isVirtual = false): Promise<bigint> {
    const w = await prisma.warehouse.create({
      data: { code, name: `Kho thử ${code}`, isVirtual },
    });
    warehouseIds.push(w.id);
    return w.id;
  }

  async function stockQty(warehouseId: bigint, materialId: bigint): Promise<number> {
    const rows = await prisma.stockQuant.findMany({ where: { warehouseId, materialId } });
    return rows.reduce((s, r) => s + r.qty.toNumber(), 0);
  }

  beforeAll(async () => {
    process.env.CLOUDINARY_CLOUD_NAME = CLOUD;
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
    // Giống src/main.ts (kể cả exceptionFactory tiếng Việt).
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
        exceptionFactory: validationExceptionFactory,
      }),
    );
    await app.init();
    prisma = app.get(PRISMA_SERVICE);

    const permsBefore = new Set(
      (await prisma.permission.findMany({ select: { id: true } })).map((p) => p.id),
    );
    await prisma.permission.createMany({
      data: Object.values(PERMISSION_MODULES).flatMap((module) =>
        Object.values(PermissionAction).map((action) => ({ module, action })),
      ),
      skipDuplicates: true,
    });
    for (const p of await prisma.permission.findMany({ select: { id: true } })) {
      if (!permsBefore.has(p.id)) newPermissionIds.push(p.id);
    }

    // Kho thật + kho ảo (cân đối) + vật tư cho ca sửa tồn.
    whsScope = `M4${short}R`;
    realWh = await newWarehouse(whsScope);
    virtualWh = await newWarehouse(`M4${short}V`, true);
    const mat = await prisma.material.create({
      data: { code: `${tag}-m1`, name: 'Vat tu thu muc 4', unit: 'cai' },
    });
    materialIds.push(mat.id);
    adjMaterial = mat.id;

    await makeUser('admin', DEFAULT_ROLES.ADMIN, null, null);
    await makeUser('whs', BUSINESS_ROLES.WAREHOUSE_STAFF, null, whsScope);
    await makeUser('kcs', BUSINESS_ROLES.KCS_STAFF, MfgRole.KCS, 'phoi-son-han');

    world = new P1World({ prisma, ledger: app.get(StockLedgerService) }, tag);
    await world.init();
  }, 180_000);

  afterAll(async () => {
    if (prisma) {
      const sql = (s: string) => prisma.$executeRawUnsafe(s).catch(() => 0);
      const list = (a: Array<bigint | string>) => a.map((i) => `'${i.toString()}'`).join(',');
      const allUsers = userIds;

      // --- giai đoạn 1: dữ liệu tham chiếu tới world (đơn, lượt tính, SKU) ---
      if (proposalIds.length > 0) {
        await sql(
          `DELETE FROM "cutting_proposal_items" WHERE "cuttingProposalId" IN (${proposalIds.join(',')})`,
        );
        await sql(`DELETE FROM "cutting_proposals" WHERE "id" IN (${proposalIds.join(',')})`);
      }
      if (orderIds.length > 0) {
        await sql(
          `DELETE FROM "cutting_proposal_items" WHERE "productionInvoiceItemId" IN (SELECT "id" FROM "production_invoice_items" WHERE "salesOrderId" IN (${orderIds.join(',')}))`,
        );
        await sql(
          `DELETE FROM "production_invoice_items" WHERE "salesOrderId" IN (${orderIds.join(',')})`,
        );
        await sql(
          `DELETE FROM "sales_order_items" WHERE "salesOrderId" IN (${orderIds.join(',')})`,
        );
        await sql(`DELETE FROM "sales_orders" WHERE "id" IN (${orderIds.join(',')})`);
      }
      if (customerIds.length > 0) {
        await sql(`DELETE FROM "sales_customers" WHERE "id" IN (${customerIds.join(',')})`);
      }
      if (inspectionPlanFormIds.length > 0) {
        await sql(
          `DELETE FROM "material_inspection_requests" WHERE "planFormId" IN (${inspectionPlanFormIds.join(',')})`,
        );
      }
      if (planFormIds.length > 0) {
        await sql(
          `DELETE FROM "plan_form_manh_reviews" WHERE "planFormId" IN (${planFormIds.join(',')})`,
        );
        await sql(
          `DELETE FROM "plan_form_detail_reviews" WHERE "planFormId" IN (${planFormIds.join(',')})`,
        );
        await sql(`DELETE FROM "plan_forms" WHERE "id" IN (${planFormIds.join(',')})`);
      }
      if (mfgProductIds.length > 0) {
        await sql(
          `DELETE FROM "bom_revision" WHERE "mfgProductId" IN (${mfgProductIds.join(',')})`,
        );
        await sql(`DELETE FROM "mfg_products" WHERE "id" IN (${mfgProductIds.join(',')})`);
      }
      if (world) await world.cleanup().catch(() => undefined);

      // --- giai đoạn 2: phần còn lại ---
      if (receiptKeys.length > 0) {
        const ks = receiptKeys.map((k) => `'${k}'`).join(',');
        await sql(
          `DELETE FROM "purchase_receipt_logs" WHERE "receiptId" IN (SELECT "id" FROM "purchase_receipts" WHERE "idempotencyKey" IN (${ks}))`,
        );
        await sql(`DELETE FROM "purchase_receipts" WHERE "idempotencyKey" IN (${ks})`);
      }
      if (notificationIds.length > 0) {
        await sql(
          `DELETE FROM "notification_recipients" WHERE "notificationId" IN (${list(notificationIds)})`,
        );
        await sql(`DELETE FROM "notifications" WHERE "id" IN (${list(notificationIds)})`);
      }
      if (allUsers.length > 0) {
        await sql(
          `DELETE FROM "notifications" WHERE "createdBy" IN (${list(allUsers)}) OR "idempotencyKey" LIKE '${tag}%'`,
        );
      }
      if (officeSupplyIds.length > 0) {
        await sql(
          `DELETE FROM "office_supply_ledger_entries" WHERE "officeSupplyId" IN (${officeSupplyIds.join(',')})`,
        );
        await sql(`DELETE FROM "office_supplies" WHERE "id" IN (${officeSupplyIds.join(',')})`);
      }
      if (defectReasonIds.length > 0) {
        await sql(`DELETE FROM "defect_reasons" WHERE "id" IN (${defectReasonIds.join(',')})`);
      }
      if (supplierIds.length > 0) {
        await sql(`DELETE FROM "suppliers" WHERE "id" IN (${supplierIds.join(',')})`);
      }
      const wh = warehouseIds.map((i) => i.toString());
      if (wh.length > 0) {
        await sql(
          `DELETE FROM "stock_ledger" WHERE "fromWarehouseId" IN (${wh.join(',')}) OR "toWarehouseId" IN (${wh.join(',')})`,
        );
        await sql(`DELETE FROM "stock_quant" WHERE "warehouseId" IN (${wh.join(',')})`);
      }
      if (materialIds.length > 0) {
        await sql(`DELETE FROM "materials" WHERE "id" IN (${materialIds.join(',')})`);
      }
      if (wh.length > 0) {
        await sql(`DELETE FROM "warehouses" WHERE "id" IN (${wh.join(',')})`);
      }
      if (allUsers.length > 0) {
        await prisma.$executeRaw`DELETE FROM "user_roles" WHERE "userId" = ANY(${allUsers}::text[])`.catch(
          () => 0,
        );
        await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "userId" = ANY(${allUsers}::text[])`.catch(
          () => 0,
        );
        await prisma.$executeRaw`DELETE FROM "users" WHERE "id" = ANY(${allUsers}::text[])`.catch(
          async () => {
            await prisma.user.deleteMany({ where: { id: { in: allUsers } } });
          },
        );
      }
      for (const l of addedLinks) {
        await prisma.rolePermission.deleteMany({
          where: { roleId: l.roleId, permissionId: l.permissionId },
        });
      }
      await purgeRoleRows(prisma, createdRoleIds);
      if (newPermissionIds.length > 0) {
        await prisma.$executeRaw`DELETE FROM "permissions" WHERE "id" = ANY(${newPermissionIds}::text[])
          AND NOT EXISTS (SELECT 1 FROM "role_permissions" rp WHERE rp."permissionId" = "permissions"."id")`.catch(
          () => 0,
        );
      }
      // Nhật ký kiểm toán do dữ liệu thử sinh ra: theo người thực hiện (tài khoản thử) hoặc theo bản ghi thử.
      const recordIds = [
        ...allUsers,
        ...wh,
        ...materialIds.map(String),
        ...mfgProductIds.map(String),
        ...planFormIds.map(String),
        ...supplierIds,
        ...customerIds,
        ...orderIds,
        ...proposalIds.map(String),
        ...officeSupplyIds.map(String),
        ...defectReasonIds.map(String),
        ...notificationIds,
        ...createdRoleIds,
      ];
      await prisma.$executeRaw`DELETE FROM "audit_logs" WHERE "userId" = ANY(${allUsers}::text[])
        OR "recordId" = ANY(${recordIds}::text[])`.catch(() => 0);
    }
    if (prisma) {
      // Nhật ký của dòng quyền do ensureRole tạo (recordId = 'unknown', không có người thực hiện) từ lúc file này bắt đầu chạy.
      await prisma.$executeRaw`DELETE FROM "audit_logs" WHERE "tableName" = 'RolePermission'
        AND "recordId" = 'unknown' AND "userId" IS NULL AND "createdAt" >= ${startedAt}`.catch(
        () => 0,
      );
    }
    if (prevCloud === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
    else process.env.CLOUDINARY_CLOUD_NAME = prevCloud;
    if (app) await app.close();
  }, 180_000);

  // =====================================================================================
  // T3-5
  // =====================================================================================
  describe('T3-5: tính lại tồn đoạn chỉ Admin', () => {
    it.each([false, true])(
      'vai thủ kho (có STOCK:UPDATE) gọi recompute dryRun=%s -> 403 câu chặn vai',
      async (dryRun) => {
        const res = await call('whs', 'post', '/segment-stock/recompute', {
          productionInvoiceId: GONE,
          dryRun,
        });
        expect(res.status).toBe(403);
        expect(bodyText(res)).toContain(ROLE_MSG);
      },
    );

    it('KCS gọi recompute -> 403; không đăng nhập -> 401', async () => {
      const kcs = await call('kcs', 'post', '/segment-stock/recompute', {
        productionInvoiceId: GONE,
      });
      expect(kcs.status).toBe(403);
      const anon = await call(null, 'post', '/segment-stock/recompute', {
        productionInvoiceId: GONE,
      });
      expect(anon.status).toBe(401);
    });

    it.each([true, false])(
      'Admin qua lớp quyền (dryRun=%s): lệnh không có -> 404 tiếng Việt, không 403',
      async (dryRun) => {
        const res = await call('admin', 'post', '/segment-stock/recompute', {
          productionInvoiceId: GONE,
          dryRun,
        });
        expect(res.status).toBe(404);
        expect(bodyText(res)).toContain('Không tìm thấy lệnh sản xuất');
      },
    );

    it('Admin gửi mã lệnh không phải số -> 400 "Mã lệnh sản xuất phải là chuỗi số"', async () => {
      const res = await call('admin', 'post', '/segment-stock/recompute', {
        productionInvoiceId: 'abc',
      });
      expect(res.status).toBe(400);
      expect(bodyText(res)).toContain('Mã lệnh sản xuất phải là chuỗi số');
    });
  });

  // =====================================================================================
  // T1-8 / T4-10
  // =====================================================================================
  describe('T1-8: URL ảnh bằng chứng KCS / Chuyền kiểm', () => {
    it.each(BAD_URLS)(
      'PATCH /qc-reviews/:id/photo với "%s" -> 400 câu "tệp đã tải lên hệ thống"',
      async (url) => {
        const res = await call('admin', 'patch', `/qc-reviews/${GONE}/photo`, { photoUrl: url });
        expect(res.status).toBe(400);
        expect(bodyText(res)).toContain(URL_MSG);
      },
    );

    it('URL Cloudinary đúng mẫu (image và raw) -> không 400 do URL (id lạ ra 404)', async () => {
      for (const url of [OK_IMG, OK_RAW.replace('.pdf', '.jpg')]) {
        const res = await call('admin', 'patch', `/qc-reviews/${GONE}/photo`, { photoUrl: url });
        expect(res.status).toBe(404);
        expect(bodyText(res)).not.toContain(URL_MSG);
      }
    });

    it('null và chuỗi rỗng (xoá ảnh) vẫn qua kiểm URL', async () => {
      for (const photoUrl of [null, '']) {
        const res = await call('admin', 'patch', `/qc-reviews/${GONE}/photo`, { photoUrl });
        expect(bodyText(res)).not.toContain(URL_MSG);
        expect(res.status).toBe(404);
      }
    });

    it('thiếu CLOUDINARY_CLOUD_NAME -> từ chối cả URL đúng mẫu (an toàn khi cấu hình thiếu)', async () => {
      delete process.env.CLOUDINARY_CLOUD_NAME;
      try {
        const res = await call('admin', 'patch', `/qc-reviews/${GONE}/photo`, { photoUrl: OK_IMG });
        expect(res.status).toBe(400);
        expect(bodyText(res)).toContain(URL_MSG);
      } finally {
        process.env.CLOUDINARY_CLOUD_NAME = CLOUD;
      }
    });

    it('POST cut-bundles/:id/qc-review và steel-issues/:id/qc-review với photoUrl javascript: -> 400', async () => {
      const cut = await call('kcs', 'post', `/cut-bundles/${GONE}/qc-review`, {
        segments: [{ segmentSpecId: '1', failedQty: 0 }],
        photoUrl: 'javascript:alert(1)',
      });
      expect(cut.status).toBe(400);
      expect(bodyText(cut)).toContain(URL_MSG);
      const steel = await call('kcs', 'post', `/steel-issues/${GONE}/qc-review`, {
        photoUrl: 'javascript:alert(1)',
        segments: [{ segmentSpecId: '1', failedQty: 0 }],
      });
      expect(steel.status).toBe(400);
      expect(bodyText(steel)).toContain(URL_MSG);
    });

    it('Chuyền kiểm: ảnh lỗi dòng 2 sai -> 400 nêu "Dòng 2:"; PATCH ảnh lỗi sai -> 400', async () => {
      const res = await call(
        'admin',
        'post',
        `/production-invoices/${GONE}/items/${GONE}/transfer-check`,
        {
          pieceId: '1',
          checkedQty: 1,
          defects: [
            { reason: 'Cong', imageUrl: OK_IMG },
            { reason: 'Mốc', imageUrl: 'javascript:alert(1)' },
          ],
        },
      );
      expect(res.status).toBe(400);
      expect(bodyText(res)).toContain('Dòng 2:');
      expect(bodyText(res)).toContain(URL_MSG);

      const patch = await call(
        'admin',
        'patch',
        `/production-invoices/transfer-check/defects/${GONE}/photo`,
        {
          imageUrl: 'http://res.cloudinary.com/x/image/upload/a.jpg',
        },
      );
      expect(patch.status).toBe(400);
      expect(bodyText(patch)).toContain(URL_MSG);
    });
  });

  describe('T4-10: signedSlipUrls phiếu xuất kho', () => {
    const confirm = (urls: unknown) =>
      call(
        'admin',
        'post',
        `/issue-slips/${GONE}/confirm`,
        { signedSlipUrls: urls },
        {
          'Idempotency-Key': randomUUID(),
        },
      );

    it.each(BAD_URLS)('signedSlipUrls = ["%s"] -> 400', async (url) => {
      const res = await confirm([url]);
      expect(res.status).toBe(400);
      expect(bodyText(res)).toContain(URL_MSG);
    });

    it('một giá trị sai trong lô -> 400 cả lô; giá trị đúng mẫu -> không 400 do URL (phiếu lạ 404)', async () => {
      const mixed = await confirm([OK_IMG, 'javascript:alert(1)']);
      expect(mixed.status).toBe(400);
      expect(bodyText(mixed)).toContain(URL_MSG);

      const good = await confirm([OK_IMG, OK_RAW]);
      expect(good.status).toBe(404);
      expect(bodyText(good)).not.toContain(URL_MSG);
    });

    it('mảng rỗng vẫn 400 (cần ít nhất 1 ảnh)', async () => {
      const res = await confirm([]);
      expect(res.status).toBe(400);
    });
  });

  // =====================================================================================
  // T2-5
  // =====================================================================================
  describe('T2-5: ép kiểu tham số và khoảng ngày', () => {
    it('GET /purchase-proposals?activeOnly=abc -> 400; true / false -> 200 và false không ít hơn true', async () => {
      const bad = await call('admin', 'get', '/purchase-proposals?activeOnly=abc');
      expect(bad.status).toBe(400);
      const t = await call('admin', 'get', '/purchase-proposals?activeOnly=true');
      const f = await call('admin', 'get', '/purchase-proposals?activeOnly=false');
      expect(t.status).toBe(200);
      expect(f.status).toBe(200);
      const total = (r: request.Response) =>
        Number((r.body as { meta?: { total?: number } }).meta?.total ?? 0);
      expect(total(f)).toBeGreaterThanOrEqual(total(t));
    });

    it('GET /bookings?includeCancelled: abc -> 400; 1 / 0 / true / false -> 200', async () => {
      expect((await call('admin', 'get', '/bookings?includeCancelled=abc')).status).toBe(400);
      for (const v of ['1', '0', 'true', 'false']) {
        const res = await call('admin', 'get', `/bookings?includeCancelled=${v}`);
        expect({ v, status: res.status }).toEqual({ v, status: 200 });
      }
    });

    it('GET /purchase-receipts/over-stats: to < from -> 400 câu tiếng Việt; hợp lệ -> 200', async () => {
      const bad = await call(
        'admin',
        'get',
        '/purchase-receipts/over-stats?from=2026-11-10&to=2026-11-01',
      );
      expect(bad.status).toBe(400);
      expect(bodyText(bad)).toContain('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc');
      for (const q of [
        'from=2026-11-01&to=2026-11-10',
        'from=2026-11-05&to=2026-11-05',
        'from=2026-11-01',
      ]) {
        const ok = await call('admin', 'get', `/purchase-receipts/over-stats?${q}`);
        expect({ q, status: ok.status }).toEqual({ q, status: 200 });
      }
    });

    it('POST /suppliers: isActive "abc" -> 400, true -> 201; PATCH isActive "abc" -> 400', async () => {
      const bad = await call('admin', 'post', '/suppliers', {
        name: `NCC ${tag} a`,
        isActive: 'abc',
      });
      expect(bad.status).toBe(400);
      const ok = await call('admin', 'post', '/suppliers', {
        name: `NCC ${tag} b`,
        isActive: true,
      });
      expect(ok.status).toBe(201);
      const id = data<{ id: string }>(ok).id;
      supplierIds.push(id);
      const patch = await call('admin', 'patch', `/suppliers/${id}`, { isActive: 'abc' });
      expect(patch.status).toBe(400);
    });
  });

  // =====================================================================================
  // T3-9
  // =====================================================================================
  describe('T3-9: sửa tồn - chống trùng theo khoá', () => {
    const adjustBody = (qty: number, note = 'Kiểm đếm thực tế') => ({
      fromWarehouseId: virtualWh.toString(),
      toWarehouseId: realWh.toString(),
      materialId: adjMaterial.toString(),
      qty,
      note,
    });
    const adjust = (who: Who, key: string | null, body: object) =>
      call(who, 'post', '/stock-ledger/adjust', body, key ? { 'Idempotency-Key': key } : {});
    const ledgerRows = (key: string) =>
      prisma.stockLedger.count({ where: { idempotencyKey: key } });

    it('thiếu header Idempotency-Key -> 400', async () => {
      const res = await adjust('admin', null, adjustBody(1));
      expect(res.status).toBe(400);
    });

    it('cùng khoá cùng nội dung -> trả lại đúng bút toán cũ, tồn chỉ cộng 1 lần; đổi ghi chú vẫn là bản cũ', async () => {
      const key = `${tag}-adj-a`;
      adjustKeys.push(key);
      const before = await stockQty(realWh, adjMaterial);
      const first = await adjust('admin', key, adjustBody(5));
      expect(first.status).toBe(201);
      const second = await adjust('admin', key, adjustBody(5));
      expect(second.status).toBe(201);
      const third = await adjust('admin', key, adjustBody(5, 'Ghi chú khác lần gửi lại'));
      expect(third.status).toBe(201);
      expect(data<{ id: string }>(second).id).toBe(data<{ id: string }>(first).id);
      expect(data<{ id: string }>(third).id).toBe(data<{ id: string }>(first).id);
      expect(await ledgerRows(key)).toBe(1);
      expect(await stockQty(realWh, adjMaterial)).toBe(before + 5);
    });

    it('cùng khoá khác số lượng -> 422 IdempotencyKeyReusedException, không còn câu "Giá trị đã tồn tại", tồn không đổi', async () => {
      const key = `${tag}-adj-a`;
      const before = await stockQty(realWh, adjMaterial);
      const res = await adjust('admin', key, adjustBody(7));
      expect(res.status).toBe(422);
      expect(errName(res)).toBe('IdempotencyKeyReusedException');
      expect(bodyText(res)).not.toContain('idempotencyKey');
      expect(bodyText(res)).toContain('Mã chống trùng');
      expect(await stockQty(realWh, adjMaterial)).toBe(before);
      expect(await ledgerRows(key)).toBe(1);
    });

    it('người khác dùng lại khoá của người này -> 422', async () => {
      const key = `${tag}-adj-a`;
      const res = await adjust('whs', key, adjustBody(5));
      expect(res.status).toBe(422);
      expect(errName(res)).toBe('IdempotencyKeyReusedException');
    });

    it('3 lần gửi SONG SONG cùng khoá cùng nội dung: chỉ 1 bút toán, tồn cộng đúng 1 lần, không 5xx', async () => {
      const key = `${tag}-adj-par`;
      adjustKeys.push(key);
      const before = await stockQty(realWh, adjMaterial);
      const results = await Promise.all([1, 2, 3].map(() => adjust('admin', key, adjustBody(3))));
      const statuses = results.map((r) => r.status);
      for (const s of statuses) expect([201, 409]).toContain(s);
      expect(statuses).toContain(201);
      for (const r of results.filter((x) => x.status === 409)) {
        expect(errName(r)).toBe('IdempotencyKeyInUseException');
      }
      const okIds = new Set(
        results.filter((r) => r.status === 201).map((r) => data<{ id: string }>(r).id),
      );
      expect(okIds.size).toBe(1);
      expect(await ledgerRows(key)).toBe(1);
      expect(await stockQty(realWh, adjMaterial)).toBe(before + 3);
      // gửi lại sau khi xong: trả bản cũ
      const again = await adjust('admin', key, adjustBody(3));
      expect(again.status).toBe(201);
      expect(data<{ id: string }>(again).id).toBe([...okIds][0]);
      expect(await stockQty(realWh, adjMaterial)).toBe(before + 3);
    });
  });

  describe('T3-9: nhập kho (purchase-receipts) - gửi lại theo khoá', () => {
    const slip = `NK-${short}-001`;
    const key = `${tag}-rcv-a`;
    const body = (over: Partial<Record<string, unknown>> = {}) => ({
      slipCode: slip,
      itemIds: ['111'],
      unitRateQty: 5,
      deliveredQty: 5,
      supplierSlipUrls: [],
      receiptSlipUrls: [],
      ...over,
    });
    const receive = (who: Who, k: string, b: object) =>
      call(who, 'post', '/purchase-receipts', b, { 'Idempotency-Key': k });
    let receiptId!: bigint;

    beforeAll(async () => {
      receiptKeys.push(key);
      // Phiếu đã ghi từ lần gửi đầu (dựng sẵn vì luồng đầy đủ cần đề xuất mua đã duyệt).
      const r = await prisma.purchaseReceipt.create({
        data: {
          code: slip,
          materialId: adjMaterial,
          warehouseCode: whsScope,
          status: 'RECEIVED',
          unitRateQty: 5,
          supplierUnitQty: 1,
          deliveredQty: 5,
          receivedQty: 5,
          supplierSlipUrls: [],
          approvalFileUrls: [],
          receiptSlipUrls: [],
          weighSlipUrls: [],
          rejectFileUrls: [],
          autoAllocation: [{ itemId: '111', qty: 5 }],
          allocation: [],
          idempotencyKey: key,
          createdById: ids.admin,
        },
      });
      receiptId = r.id;
    });

    it('cùng khoá cùng nội dung -> 201 trả phiếu cũ (cùng id), không tạo phiếu mới', async () => {
      const res = await receive('admin', key, body());
      expect(res.status).toBe(201);
      expect(data<{ id: string }>(res).id).toBe(receiptId.toString());
      expect(await prisma.purchaseReceipt.count({ where: { idempotencyKey: key } })).toBe(1);
      expect(await prisma.purchaseReceipt.count({ where: { code: slip } })).toBe(1);
    });

    it('cùng khoá khác số lượng nhận -> 422 IdempotencyKeyReusedException (trước đây trả nhầm phiếu cũ)', async () => {
      const res = await receive('admin', key, body({ unitRateQty: 9, deliveredQty: 9 }));
      expect(res.status).toBe(422);
      expect(errName(res)).toBe('IdempotencyKeyReusedException');
    });

    it('cùng khoá khác nhóm dòng hoặc khác số phiếu NK -> 422', async () => {
      expect((await receive('admin', key, body({ itemIds: ['222'] }))).status).toBe(422);
      expect((await receive('admin', key, body({ slipCode: `NK-${short}-777` }))).status).toBe(422);
    });

    it('người khác dùng lại khoá -> 422 (không còn 409 "Khoá chống trùng...")', async () => {
      const res = await receive('whs', key, body());
      expect([422, 403]).toContain(res.status);
      if (res.status === 422) expect(errName(res)).toBe('IdempotencyKeyReusedException');
    });

    it('thiếu header Idempotency-Key -> 400', async () => {
      const res = await call('admin', 'post', '/purchase-receipts', body());
      expect(res.status).toBe(400);
    });
  });

  // =====================================================================================
  // T1-9
  // =====================================================================================
  describe('T1-9: thông báo chung chống phát 2 lần', () => {
    const payload = (message = 'Nội dung thông báo thử') => ({
      title: `Thông báo thử ${tag}`,
      message,
      audience: 'BOSS',
    });
    const send = (key: string | null, body: object) =>
      call('admin', 'post', '/notifications', body, key ? { 'Idempotency-Key': key } : {});
    const rows = (key: string) => prisma.notification.count({ where: { idempotencyKey: key } });

    it('cùng khoá cùng nội dung: lần 2 trả đúng bản cũ (cùng id), DB chỉ 1 dòng', async () => {
      const key = `${tag}-ntf-a`;
      const first = await send(key, payload());
      expect(first.status).toBe(201);
      notificationIds.push(data<{ id: string }>(first).id);
      const second = await send(key, payload());
      expect(second.status).toBe(201);
      expect(data<{ id: string }>(second).id).toBe(data<{ id: string }>(first).id);
      expect(await rows(key)).toBe(1);
    });

    it('cùng khoá khác nội dung -> 422 IdempotencyKeyReusedException; vẫn 1 dòng', async () => {
      const key = `${tag}-ntf-a`;
      const res = await send(key, payload('Nội dung KHÁC'));
      expect(res.status).toBe(422);
      expect(errName(res)).toBe('IdempotencyKeyReusedException');
      expect(await rows(key)).toBe(1);
    });

    it('khoá dài 256 ký tự -> 400', async () => {
      const res = await send('k'.repeat(256), payload());
      expect(res.status).toBe(400);
    });

    it('không gửi khoá: chạy như cũ, mỗi lần một bản mới', async () => {
      const a = await send(null, payload('không khoá 1'));
      const b = await send(null, payload('không khoá 1'));
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      notificationIds.push(data<{ id: string }>(a).id, data<{ id: string }>(b).id);
      expect(data<{ id: string }>(a).id).not.toBe(data<{ id: string }>(b).id);
    });

    it('3 lần gửi SONG SONG cùng khoá: đúng 1 bản, không 5xx', async () => {
      const key = `${tag}-ntf-par`;
      const results = await Promise.all([1, 2, 3].map(() => send(key, payload('song song'))));
      for (const r of results) expect([201, 409]).toContain(r.status);
      expect(results.map((r) => r.status)).toContain(201);
      for (const r of results.filter((x) => x.status === 409)) {
        expect(errName(r)).toBe('IdempotencyKeyInUseException');
      }
      for (const r of results.filter((x) => x.status === 201)) {
        notificationIds.push(data<{ id: string }>(r).id);
      }
      expect(await rows(key)).toBe(1);
    });
  });

  // =====================================================================================
  // XOA-SKU (A) / T4-7 / T2-6
  // =====================================================================================
  describe('XOA-SKU phần A / T4-7 / T2-6', () => {
    async function newPlanForm(label: string): Promise<{ pfId: bigint; productId: bigint }> {
      const product = await prisma.mfgProduct.create({
        data: { factoryCode: `${tag}-${label}`, name: `SKU thử ${label}` },
      });
      mfgProductIds.push(product.id);
      const pf = await prisma.planForm.create({
        data: { mfgProductId: product.id, createdById: ids.admin },
      });
      planFormIds.push(pf.id);
      return { pfId: pf.id, productId: product.id };
    }
    const deleteAudits = (pfId: bigint) =>
      prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "audit_logs"
        WHERE "tableName" = 'PlanForm' AND "recordId" = ${pfId.toString()}
        AND "action"::text = 'DELETE'`;

    it('SKU còn lệnh kiểm tra vật tư -> 409 câu rõ, SKU còn nguyên; gỡ lệnh rồi xoá -> 204 nhanh, 1 dòng audit DELETE', async () => {
      const { pfId } = await newPlanForm('a');
      const w = await world.newInvoice({ quantities: [3] });
      await prisma.materialInspectionRequest.create({
        data: { planFormId: pfId, productionOrderId: w.orderIds[0], createdById: ids.admin },
      });
      inspectionPlanFormIds.push(pfId);

      const blocked = await call('admin', 'delete', `/skus/${pfId}`);
      expect(blocked.status).toBe(409);
      expect(bodyText(blocked)).toMatch(/còn 1 lệnh kiểm tra vật tư - không xoá được/);
      expect(bodyText(blocked)).not.toMatch(/P2003|Foreign key|foreign key|Prisma/);
      expect(await prisma.planForm.count({ where: { id: pfId } })).toBe(1);

      await prisma.materialInspectionRequest.deleteMany({ where: { planFormId: pfId } });
      const t0 = Date.now();
      const done = await call('admin', 'delete', `/skus/${pfId}`).timeout(10_000);
      expect(done.status).toBe(204);
      expect(Date.now() - t0).toBeLessThan(10_000);
      expect(await prisma.planForm.count({ where: { id: pfId } })).toBe(0);
      expect(Number((await deleteAudits(pfId))[0].n)).toBe(1);
    });

    it('xoá SKU không tồn tại -> 404; SKU trống (không lệnh) -> 204', async () => {
      expect((await call('admin', 'delete', `/skus/${GONE}`)).status).toBe(404);
      const { pfId } = await newPlanForm('b');
      expect((await call('admin', 'delete', `/skus/${pfId}`)).status).toBe(204);
    });

    it('T4-7: manh-quota với pieces rỗng -> 400 "Cần ít nhất 1 mảnh", không sinh bản định mức nào', async () => {
      const { pfId, productId } = await newPlanForm('c');
      const before = await prisma.bomRevision.count({ where: { mfgProductId: productId } });
      const res = await call('admin', 'post', `/skus/${pfId}/manh-quota`, {
        pieces: [],
        enteredBy: 'Tester',
      });
      expect(res.status).toBe(400);
      expect(bodyText(res)).toContain('Cần ít nhất 1 mảnh');
      expect(await prisma.bomRevision.count({ where: { mfgProductId: productId } })).toBe(before);
      const pf = await prisma.planForm.findUniqueOrThrow({ where: { id: pfId } });
      expect(pf.manhData).toBeNull();
    });

    it('T2-6: cutting-batch-preview với id không tồn tại -> 404 "Không tìm thấy SKU"', async () => {
      const res = await call('admin', 'post', '/cutting-batch-preview', {
        productionInvoiceItemIds: [GONE],
      });
      expect(res.status).toBe(404);
      expect(bodyText(res)).toContain('Không tìm thấy SKU');
    });

    it('T2-6: id có thật nhưng chưa chờ tính lẫn id lạ -> vẫn 404 (id lạ thắng)', async () => {
      const w = await world.newInvoice({ quantities: [2] });
      const res = await call('admin', 'post', '/cutting-batch-preview', {
        productionInvoiceItemIds: [w.itemIds[0].toString(), GONE],
      });
      expect(res.status).toBe(404);
      expect(bodyText(res)).toContain(GONE);
    });
  });

  // =====================================================================================
  // T2-2 (+ T2-5 body của đơn)
  // =====================================================================================
  describe('T2-2: xoá khách / xoá đơn có tham chiếu', () => {
    let customerId = '';
    let orderId = '';
    let piItemId!: bigint;
    let proposalId!: bigint;

    beforeAll(async () => {
      const cust = await call('admin', 'post', '/customers', { name: `Khach thu ${tag}` });
      expect(cust.status).toBe(201);
      customerId = data<{ id: string }>(cust).id;
      customerIds.push(customerId);
      const order = await call('admin', 'post', '/sales-orders', {
        orderCode: `${tag}-PO1`,
        customerId,
        orderDate: '2026-11-20',
        items: [
          { mfgProductId: world.mfgProductId.toString(), totalQty: 4, deliveryDate: '2026-12-20' },
        ],
      });
      expect([200, 201]).toContain(order.status);
      orderId = data<{ id: string }>(order).id;
      orderIds.push(orderId);
      const pi = await prisma.productionInvoiceItem.findFirstOrThrow({
        where: { salesOrderId: BigInt(orderId) },
      });
      piItemId = pi.id;
    }, 60_000);

    it('xoá khách đang có đơn -> 409 nêu số đơn, khách còn nguyên', async () => {
      const res = await call('admin', 'delete', `/customers/${customerId}`);
      expect(res.status).toBe(409);
      expect(bodyText(res)).toMatch(/đang có 1 đơn hàng/);
      expect(bodyText(res)).not.toMatch(/P2003|Foreign key|Prisma/);
      expect(await prisma.customer.count({ where: { id: BigInt(customerId) } })).toBe(1);
    });

    it('T2-5 body đơn: note số, depositConfirmed / isActive chuỗi lạ -> 400; note chuỗi -> 200', async () => {
      for (const b of [{ note: 123 }, { depositConfirmed: 'abc' }, { isActive: 'abc' }]) {
        const res = await call('admin', 'patch', `/sales-orders/${orderId}`, b);
        expect({ b, status: res.status }).toEqual({ b, status: 400 });
      }
      const ok = await call('admin', 'patch', `/sales-orders/${orderId}`, { note: 'Ghi chú thử' });
      expect(ok.status).toBe(200);
      expect(data<{ note: string }>(ok).note).toBe('Ghi chú thử');
    });

    it('đơn có dòng trong lượt tính chưa dùng -> deleteBlockedReason + xoá 409 câu "lượt tính phương án cắt chưa dùng"', async () => {
      const proposal = await prisma.cuttingProposal.create({
        data: { status: CuttingProposalStatus.DRAFT },
      });
      proposalId = proposal.id;
      proposalIds.push(proposal.id);
      await prisma.cuttingProposalItem.create({
        data: {
          cuttingProposalId: proposal.id,
          productionInvoiceItemId: piItemId,
          mfgProductId: world.mfgProductId,
          bomRevisionId: world.bomRevisionId,
          quantity: 4,
        },
      });
      const detail = await call('admin', 'get', `/sales-orders/${orderId}`);
      expect(detail.status).toBe(200);
      expect(String(data<{ deleteBlockedReason?: string }>(detail).deleteBlockedReason)).toContain(
        'lượt tính phương án cắt chưa dùng',
      );
      const res = await call('admin', 'delete', `/sales-orders/${orderId}`);
      expect(res.status).toBe(409);
      expect(bodyText(res)).toContain('lượt tính phương án cắt chưa dùng');
      expect(bodyText(res)).toContain('Tối ưu cắt sắt');
      expect(await prisma.salesOrder.count({ where: { id: BigInt(orderId) } })).toBe(1);
    });

    it('lượt tính đã bị thay (SUPERSEDED): xoá đơn -> 204, dòng ghim được dọn, lượt tính vẫn còn', async () => {
      await prisma.cuttingProposal.update({
        where: { id: proposalId },
        data: { status: CuttingProposalStatus.SUPERSEDED },
      });
      const res = await call('admin', 'delete', `/sales-orders/${orderId}`);
      expect(res.status).toBe(204);
      expect(await prisma.salesOrder.count({ where: { id: BigInt(orderId) } })).toBe(0);
      expect(
        await prisma.cuttingProposalItem.count({ where: { cuttingProposalId: proposalId } }),
      ).toBe(0);
      expect(await prisma.cuttingProposal.count({ where: { id: proposalId } })).toBe(1);
    });

    it('hết đơn thì xoá khách -> 204', async () => {
      const res = await call('admin', 'delete', `/customers/${customerId}`);
      expect(res.status).toBe(204);
      expect(await prisma.customer.count({ where: { id: BigInt(customerId) } })).toBe(0);
    });
  });

  // =====================================================================================
  // T3-12
  // =====================================================================================
  describe('T3-12: văn phòng phẩm', () => {
    const create = (b: object) =>
      call('admin', 'post', '/office-supplies', { warehouseCode: whsScope, ...b });
    const code = `VP${short}`;
    let supplyId = '';

    it('tên hoặc đơn vị rỗng / toàn dấu cách -> 400 câu rõ, không tạo', async () => {
      const a = await create({ name: '   ', unit: 'cái' });
      expect(a.status).toBe(400);
      expect(bodyText(a)).toContain('Tên vật tư không được để trống');
      const b = await create({ name: 'Bút', unit: '  ' });
      expect(b.status).toBe(400);
      expect(bodyText(b)).toContain('Đơn vị tính không được để trống');
      const n = await prisma.officeSupply.count({ where: { warehouse: { code: whsScope } } });
      expect(n).toBe(0);
    });

    it('tạo kèm tồn đầu -> dòng INITIAL có người tạo; tên được cắt khoảng trắng', async () => {
      const res = await create({ code, name: '  Bút bi thử  ', unit: ' cái ', openingQty: 5 });
      expect(res.status).toBe(201);
      supplyId = data<{ id: string }>(res).id;
      officeSupplyIds.push(BigInt(supplyId));
      expect(data<{ name: string }>(res).name).toBe('Bút bi thử');
      const led = await prisma.officeSupplyLedgerEntry.findMany({
        where: { officeSupplyId: BigInt(supplyId) },
      });
      expect(led).toHaveLength(1);
      expect(led[0].reason).toBe('INITIAL');
      expect(led[0].createdByUserId).toBe(ids.admin);
    });

    it('dấu số lượng theo loại: IMPORT <= 0 và EXPORT >= 0 -> 400; ADJUST nhận âm; số 0 -> 400', async () => {
      const path = `/office-supplies/${supplyId}/adjust`;
      const imp = await call('admin', 'post', path, { changeQty: -1, reason: 'IMPORT' });
      expect(imp.status).toBe(400);
      expect(bodyText(imp)).toContain('Nhập kho: số lượng phải lớn hơn 0');
      const exp = await call('admin', 'post', path, { changeQty: 2, reason: 'EXPORT' });
      expect(exp.status).toBe(400);
      expect(bodyText(exp)).toContain('Xuất kho: số lượng phải ghi số âm');
      expect((await call('admin', 'post', path, { changeQty: 0, reason: 'ADJUST' })).status).toBe(
        400,
      );
      const adj = await call('admin', 'post', path, { changeQty: -1, reason: 'ADJUST' });
      expect([200, 201]).toContain(adj.status);
      const okExp = await call('admin', 'post', path, { changeQty: -1, reason: 'EXPORT' });
      expect([200, 201]).toContain(okExp.status);
      const s = await prisma.officeSupply.findUniqueOrThrow({ where: { id: BigInt(supplyId) } });
      expect(s.quantity.toNumber()).toBe(3);
    });

    it('mã trùng vật tư đã xoá (tạo mới và sửa) -> 409 nêu tên cũ; mã còn dùng giữ câu cũ', async () => {
      const del = await call('admin', 'delete', `/office-supplies/${supplyId}`);
      expect(del.status).toBe(204);

      const dup = await create({ code, name: 'Bút khác', unit: 'cái' });
      expect(dup.status).toBe(409);
      expect(bodyText(dup)).toContain(
        `Mã \\"${code}\\" đã dùng cho vật tư văn phòng đã xoá \\"Bút bi thử\\"`,
      );

      const other = await create({ code: `${code}B`, name: 'Thước', unit: 'cái' });
      expect(other.status).toBe(201);
      const otherId = data<{ id: string }>(other).id;
      officeSupplyIds.push(BigInt(otherId));
      const patch = await call('admin', 'patch', `/office-supplies/${otherId}`, { code });
      expect(patch.status).toBe(409);
      expect(bodyText(patch)).toContain('đã dùng cho vật tư văn phòng đã xoá');

      const live = await create({ code: `${code}B`, name: 'Thước 2', unit: 'cái' });
      expect(live.status).toBe(409);
      expect(bodyText(live)).toContain('đã tồn tại trong kho này');
    });
  });

  // =====================================================================================
  // T4-5 / T4-8
  // =====================================================================================
  describe('T4-5: KCS chấm có phần không đạt phải có nguyên nhân', () => {
    it('failedQty > 0 thiếu defectReasonId -> 400 câu rõ, không ghi phiếu, đợt vẫn chờ KCS; kèm nguyên nhân -> 201', async () => {
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
      const noReason = await call('kcs', 'post', path, {
        segments: [{ segmentSpecId: world.spec355.toString(), failedQty: 2, scrapQty: 2 }],
      });
      expect(noReason.status).toBe(400);
      expect(bodyText(noReason)).toContain(
        'Có số lượng không đạt - phải chọn nguyên nhân không đạt',
      );
      expect(await world.qcReviews({ stepBundleId: bundleId })).toHaveLength(0);
      const still = await prisma.stepBundle.findUniqueOrThrow({ where: { id: bundleId } });
      expect(still.status).toBe(StepBundleStatus.AWAITING_QC);

      const ok = await call('kcs', 'post', path, {
        segments: [{ segmentSpecId: world.spec355.toString(), failedQty: 2, scrapQty: 2 }],
        defectReasonId: world.defectReasonId.toString(),
      });
      expect(ok.status).toBe(201);
      expect(await world.qcReviews({ stepBundleId: bundleId })).toHaveLength(1);
    });

    it('đạt hết (failedQty 0) không đòi nguyên nhân', async () => {
      const w = await world.newInvoice({ quantities: [10] });
      const bundleId = await world.seedStepBundle(w, {
        step: 'UON',
        status: StepBundleStatus.AWAITING_QC,
      });
      await world.seedStepBatch(w, {
        step: 'UON',
        segs: [{ specId: world.spec355, qty: 4 }],
        bundleId,
      });
      const ok = await call('kcs', 'post', `/step-bundles/${bundleId}/qc-review`, {
        segments: [],
      });
      expect(ok.status === 201 ? 'OK' : bodyText(ok)).toBe('OK');
    });
  });

  describe('T4-8: lý do lỗi KCS tối đa 100 ký tự', () => {
    it('tạo 101 ký tự -> 400; 100 ký tự -> 201; sửa thành 101 ký tự -> 400', async () => {
      const long = 'x'.repeat(101);
      const bad = await call('admin', 'post', '/defect-reasons', { label: long });
      expect(bad.status).toBe(400);
      expect(bodyText(bad)).toContain('Tên lý do lỗi chỉ được tối đa 100 ký tự');

      const ok = await call('admin', 'post', '/defect-reasons', { label: 'y'.repeat(100) });
      expect(ok.status).toBe(201);
      const id = data<{ id: string }>(ok).id;
      defectReasonIds.push(BigInt(id));

      const patch = await call('admin', 'patch', `/defect-reasons/${id}`, { label: long });
      expect(patch.status).toBe(400);
      expect(bodyText(patch)).toContain('Tên lý do lỗi chỉ được tối đa 100 ký tự');
      const row = await prisma.defectReason.findUniqueOrThrow({ where: { id: BigInt(id) } });
      expect(row.label).toHaveLength(100);
    });
  });
});
