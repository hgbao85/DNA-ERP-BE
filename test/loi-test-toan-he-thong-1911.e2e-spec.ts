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
import { MfgRole, PermissionAction, StockLedgerRefType } from '../src/generated/prisma/client';
import { PRISMA_SERVICE, PrismaServiceType } from '../src/prisma/prisma.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { ApiEnvelope } from './api-envelope.type';
import { ensureRoleRow, purgeRoleRows } from './integration/p1-kcs.fixture';

/**
 * Lỗi đợt test toàn hệ thống 19/11/2026 - kiểm qua HTTP thật (AppModule + supertest, DB test chung).
 *  T4-1   tách quyền ghi định mức mảnh (SPEC_STEEL_STAFF) / chi tiết (SPEC_ACCESSORY_PACKAGING_STAFF); Admin qua cả hai; route review không đổi
 *  T1-1   DELETE /warehouses/:id: kho trống 204 NHANH (không treo); kho còn tham chiếu 409 tiếng Việt, tài khoản gắn kho không bị xoá mềm
 *  T1-2   DELETE /material-groups/:id: nhóm còn vật tư 409 (vật tư giữ nhóm); nhóm trống 204
 *  T1-3   PUT /system-config: hao hụt / lưỡi laze / email / điện thoại sai 400 tiếng Việt; hợp lệ 200 (trả lại cấu hình cũ sau test)
 *  T1-5 / T1-6 / T1-7 / T3-10   trước đây 500 nay 400 (id quá lớn: 400 hoặc 404); sổ kho lọc theo ngày thuần tính giờ VN
 *  T3-15  thiếu trường bắt buộc: một câu "Thiếu ..." mỗi trường, không còn tên thuộc tính tiếng Anh
 *
 * ValidationPipe dựng ĐÚNG như src/main.ts (có exceptionFactory). Vai tạo theo hằng số role-permissions.constant.ts: chỉ tạo vai chưa có
 * trong DB test (DB mới tinh chỉ có migration), ADMIN có sẵn thì bù quyền thiếu rồi gỡ đúng phần mình thêm. Dữ liệu có tiền tố riêng,
 * tự dọn. Mật khẩu thử sinh ngẫu nhiên lúc chạy.
 */
const ROLE_MSG = 'Tài khoản không có vai trò được làm việc này';
const GONE = '999999999';

type Who = 'steel' | 'detail' | 'admin';
const USERS: Record<Who, { role: string; mfgRole: MfgRole | null }> = {
  steel: { role: BUSINESS_ROLES.SPEC_STEEL_STAFF, mfgRole: MfgRole.SPEC_STEEL },
  detail: { role: BUSINESS_ROLES.SPEC_ACCESSORY_PACKAGING_STAFF, mfgRole: MfgRole.SPEC_ACCESSORY },
  admin: { role: DEFAULT_ROLES.ADMIN, mfgRole: null },
};

describe('Lỗi test toàn hệ thống 19/11 (e2e, DB test thật)', () => {
  let app: INestApplication;
  let prisma: PrismaServiceType;
  const password = `Pw-${randomUUID()}`;
  const sfx = Date.now();
  const tag = `l1911-${sfx}`;
  const short = String(sfx).slice(-6);
  const createdRoleIds: string[] = [];
  const addedLinks: Array<{ roleId: string; permissionId: string }> = [];
  const userIds: string[] = [];
  const tokens = {} as Record<Who, string>;

  // dữ liệu dọn cuối
  const warehouseIds: bigint[] = [];
  const groupIds: bigint[] = [];
  const materialIds: bigint[] = [];
  const scopedUserIds: string[] = [];
  const newPermissionIds: string[] = [];
  let createdSystemConfig = false;
  let configSnapshot: Record<string, unknown> | null = null;

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];
  const bodyText = (res: request.Response): string => JSON.stringify(res.body);
  const messages = (res: request.Response): string[] => {
    const m = (res.body as { message?: string | string[] }).message;
    return Array.isArray(m) ? m : m ? [m] : [];
  };

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

  async function makeUser(who: Who): Promise<void> {
    const roleId = await ensureRole(USERS[who].role);
    const u = await prisma.user.create({
      data: {
        username: `${tag}-${who}`,
        password: await argon2.hash(password),
        firstName: 'L1911',
        lastName: who,
        mfgRole: USERS[who].mfgRole,
        roles: { create: [{ roleId }] },
      },
    });
    userIds.push(u.id);
    const res = await request(server())
      .post('/api/v1/auth/login')
      .send({ username: `${tag}-${who}`, password })
      .expect(200);
    tokens[who] = (res.body as ApiEnvelope<{ accessToken: string }>).data.accessToken;
  }

  function call(
    who: Who,
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    body?: object,
  ) {
    const req = request(server())
      [method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${tokens[who]}`);
    return body ? req.send(body) : req;
  }

  async function newWarehouse(code: string): Promise<bigint> {
    const w = await prisma.warehouse.create({ data: { code, name: `Kho thử ${code}` } });
    warehouseIds.push(w.id);
    return w.id;
  }

  async function newScopedUser(code: string): Promise<string> {
    const u = await prisma.user.create({
      data: {
        username: `${tag}-scope-${code}`,
        password: await argon2.hash(password),
        firstName: 'L1911',
        lastName: 'scope',
        warehouseScope: code,
      },
    });
    scopedUserIds.push(u.id);
    return u.id;
  }

  async function userDeletedAt(id: string): Promise<Date | null> {
    const rows = await prisma.$queryRaw<{ deletedAt: Date | null }[]>`
      SELECT "deletedAt" FROM "users" WHERE "id" = ${id}`;
    return rows[0].deletedAt;
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
    for (const who of Object.keys(USERS) as Who[]) await makeUser(who);

    // Cấu hình hệ thống (singleton): DB mới tinh chưa có dòng nào -> tạo tạm, xoá cuối; có sẵn thì chụp lại để trả.
    const cfg = await prisma.systemConfig.findUnique({ where: { id: 1 } });
    if (cfg) {
      configSnapshot = {
        companyName: cfg.companyName,
        companyPhone: cfg.companyPhone,
        companyEmail: cfg.companyEmail,
        solverBladeWidthMm: cfg.solverBladeWidthMm,
        solverMaxWastePercentage: cfg.solverMaxWastePercentage,
      };
    } else {
      await prisma.systemConfig.create({ data: { id: 1, companyName: `Cong ty thu ${tag}` } });
      createdSystemConfig = true;
    }
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      if (createdSystemConfig) {
        await prisma.$executeRawUnsafe('DELETE FROM "system_config" WHERE "id" = 1').catch(() => 0);
      } else if (configSnapshot) {
        await prisma.systemConfig.update({ where: { id: 1 }, data: configSnapshot });
      }
      const allUsers = [...userIds, ...scopedUserIds];
      const wh = warehouseIds.map((i) => i.toString());
      const mats = materialIds.map((i) => i.toString());
      const grs = groupIds.map((i) => i.toString());
      if (wh.length > 0) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM "stock_ledger" WHERE "fromWarehouseId" IN (${wh.join(',')}) OR "toWarehouseId" IN (${wh.join(',')})`,
        );
        await prisma.$executeRawUnsafe(
          `DELETE FROM "stock_quant" WHERE "warehouseId" IN (${wh.join(',')})`,
        );
      }
      if (mats.length > 0) {
        await prisma.$executeRawUnsafe(`DELETE FROM "materials" WHERE "id" IN (${mats.join(',')})`);
      }
      if (grs.length > 0) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM "material_groups" WHERE "id" IN (${grs.join(',')})`,
        );
      }
      if (wh.length > 0) {
        await prisma.$executeRawUnsafe(`DELETE FROM "warehouses" WHERE "id" IN (${wh.join(',')})`);
      }
      if (allUsers.length > 0) {
        await prisma.$executeRaw`DELETE FROM "user_roles" WHERE "userId" = ANY(${allUsers}::text[])`;
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

      // Quyền chính file này tạo ra (chưa có trước đó) và không còn vai nào dùng.
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
        ...mats,
        ...grs,
        ...createdRoleIds,
        ...(createdSystemConfig ? ['1'] : []),
      ];
      await prisma.$executeRaw`DELETE FROM "audit_logs" WHERE "userId" = ANY(${allUsers}::text[])
        OR "recordId" = ANY(${recordIds}::text[])`.catch(() => 0);
    }
    if (app) await app.close();
  }, 120_000);

  // =====================================================================================
  // T4-1
  // =====================================================================================
  describe('T4-1: tách quyền ghi định mức mảnh / chi tiết', () => {
    const MANH: Array<['post' | 'patch' | 'delete', string, object | undefined]> = [
      ['post', `/skus/${GONE}/manh-quota`, { pieces: [] }],
      ['patch', `/skus/${GONE}/manh-quota/draft`, { data: {}, savedBy: 'x' }],
      ['delete', `/skus/${GONE}/manh-quota/draft`, undefined],
    ];
    const DETAIL: Array<['post' | 'patch' | 'delete', string, object | undefined]> = [
      ['post', `/skus/${GONE}/detail-quota`, { detailLines: [] }],
      ['patch', `/skus/${GONE}/detail-quota/draft`, { data: {}, savedBy: 'x' }],
      ['delete', `/skus/${GONE}/detail-quota/draft`, undefined],
    ];

    it.each(DETAIL.map((r) => [r[0], r[1]] as const))(
      'NV định mức mảnh gọi %s %s (route chi tiết) -> 403 câu chặn vai',
      async (method, path) => {
        const body = DETAIL.find((r) => r[1] === path)![2];
        const res = await call('steel', method, path.replace('/api/v1', ''), body);
        expect(res.status).toBe(403);
        expect(bodyText(res)).toContain(ROLE_MSG);
      },
    );

    it.each(MANH.map((r) => [r[0], r[1]] as const))(
      'NV định mức chi tiết gọi %s %s (route mảnh) -> 403 câu chặn vai',
      async (method, path) => {
        const body = MANH.find((r) => r[1] === path)![2];
        const res = await call('detail', method, path, body);
        expect(res.status).toBe(403);
        expect(bodyText(res)).toContain(ROLE_MSG);
      },
    );

    it.each(MANH.map((r) => [r[0], r[1]] as const))(
      'NV định mức mảnh gọi đúng route của mình %s %s -> KHÔNG 403 (qua lớp quyền)',
      async (method, path) => {
        const body = MANH.find((r) => r[1] === path)![2];
        const res = await call('steel', method, path, body);
        expect(res.status).not.toBe(403);
        expect(res.status).toBeLessThan(500);
      },
    );

    it.each(DETAIL.map((r) => [r[0], r[1]] as const))(
      'NV định mức chi tiết gọi đúng route của mình %s %s -> KHÔNG 403 (qua lớp quyền)',
      async (method, path) => {
        const body = DETAIL.find((r) => r[1] === path)![2];
        const res = await call('detail', method, path, body);
        expect(res.status).not.toBe(403);
        expect(res.status).toBeLessThan(500);
      },
    );

    it.each([...MANH, ...DETAIL].map((r) => [r[0], r[1]] as const))(
      'Admin gọi %s %s -> KHÔNG 403',
      async (method, path) => {
        const body = [...MANH, ...DETAIL].find((r) => r[1] === path && r[0] === method)![2];
        const res = await call('admin', method, path, body);
        expect(res.status).not.toBe(403);
        expect(res.status).toBeLessThan(500);
      },
    );

    it('route review không đổi: không bị chặn bởi câu chặn vai mới (ai có quyền duyệt thì qua, không thì chặn quyền)', async () => {
      for (const path of [`/skus/${GONE}/manh-quota/review`, `/skus/${GONE}/detail-quota/review`]) {
        const admin = await call('admin', 'post', path, { approved: true });
        expect(bodyText(admin)).not.toContain(ROLE_MSG);
        expect(admin.status).not.toBe(403);
        expect(admin.status).toBeLessThan(500);
        for (const who of ['steel', 'detail'] as const) {
          const res = await call(who, 'post', path, { approved: true });
          expect(bodyText(res)).not.toContain(ROLE_MSG);
        }
      }
    });
  });

  // =====================================================================================
  // T1-1
  // =====================================================================================
  describe('T1-1: xoá kho', () => {
    it('kho trống: DELETE -> 204 NHANH (không treo), kho biến mất', async () => {
      const code = `K${short}A`;
      const id = await newWarehouse(code);
      const t0 = Date.now();
      await call('admin', 'delete', `/warehouses/${id}`).timeout(10_000).expect(204);
      expect(Date.now() - t0).toBeLessThan(10_000);
      const left = await prisma.$queryRawUnsafe<{ n: number }[]>(
        `SELECT COUNT(*)::int AS n FROM "warehouses" WHERE "id" = ${id} AND "deletedAt" IS NULL`,
      );
      expect(left[0].n).toBe(0);
    }, 20_000);

    it('kho còn vật tư + bút toán sổ kho: 409 câu tiếng Việt, kho còn, tài khoản gắn kho KHÔNG bị xoá mềm', async () => {
      const code = `K${short}B`;
      const dst = await newWarehouse(code);
      const src = await newWarehouse(`K${short}S`);
      const uid = await newScopedUser(code);
      const mat = await prisma.material.create({
        data: { code: `${tag}-m1`, name: 'Vat tu thu', unit: 'cai', warehouseId: dst },
      });
      materialIds.push(mat.id);
      await prisma.stockLedger.create({
        data: {
          fromWarehouseId: src,
          toWarehouseId: dst,
          materialId: mat.id,
          qty: 5,
          refType: StockLedgerRefType.OPENING_BALANCE,
        },
      });

      const res = await call('admin', 'delete', `/warehouses/${dst}`).timeout(10_000);
      expect(res.status).toBe(409);
      const text = messages(res).join(' ');
      expect(text).toMatch(/^Kho còn /);
      expect(text).toContain('vật tư');
      expect(text).toContain('bút toán sổ kho');
      expect(text).toContain('không xoá được');

      const still = await prisma.$queryRawUnsafe<{ n: number }[]>(
        `SELECT COUNT(*)::int AS n FROM "warehouses" WHERE "id" = ${dst} AND "deletedAt" IS NULL`,
      );
      expect(still[0].n).toBe(1);
      expect(await userDeletedAt(uid)).toBeNull();
    }, 30_000);
  });

  // =====================================================================================
  // T1-2
  // =====================================================================================
  describe('T1-2: xoá nhóm vật tư', () => {
    it('nhóm còn vật tư: 409, vật tư vẫn giữ nhóm; nhóm trống: 204', async () => {
      const created = await call('admin', 'post', '/material-groups', {
        name: `Nhom thu ${tag}`,
        codePrefix: `G${short}`,
      });
      expect(created.status).toBe(201);
      const gid = BigInt((created.body as ApiEnvelope<{ id: string }>).data.id);
      groupIds.push(gid);
      const mat = await prisma.material.create({
        data: { code: `${tag}-m2`, name: 'Vat tu nhom', unit: 'cai', materialGroupId: gid },
      });
      materialIds.push(mat.id);

      const res = await call('admin', 'delete', `/material-groups/${gid}`);
      expect(res.status).toBe(409);
      expect(messages(res).join(' ')).toMatch(/Nhóm còn 1 vật tư/);
      const after = await prisma.material.findUniqueOrThrow({ where: { id: mat.id } });
      expect(after.materialGroupId).toBe(gid);

      const empty = await call('admin', 'post', '/material-groups', {
        name: `Nhom trong ${tag}`,
        codePrefix: `H${short}`,
      });
      expect(empty.status).toBe(201);
      const eid = (empty.body as ApiEnvelope<{ id: string }>).data.id;
      groupIds.push(BigInt(eid));
      await call('admin', 'delete', `/material-groups/${eid}`).expect(204);
    });
  });

  // =====================================================================================
  // T1-3
  // =====================================================================================
  describe('T1-3: PUT /system-config', () => {
    const base = () => ({ companyName: `Cong ty thu ${tag}` });
    const put = (extra: object) => call('admin', 'put', '/system-config', { ...base(), ...extra });

    it('hao hụt 150 -> 400 "Ngưỡng hao hụt tối đa phải từ 0,01% đến 100%"', async () => {
      const res = await put({ solverMaxWastePercentage: 150 });
      expect(res.status).toBe(400);
      expect(messages(res)).toContain('Ngưỡng hao hụt tối đa phải từ 0,01% đến 100%');
    });

    it('hao hụt 0 -> 400', async () => {
      await put({ solverMaxWastePercentage: 0 }).expect(400);
    });

    it('lưỡi laze 50 mm -> 400 "Bề rộng lưỡi cắt laze phải từ 0 đến 10 mm"', async () => {
      const res = await put({ solverBladeWidthMm: 50 });
      expect(res.status).toBe(400);
      expect(messages(res)).toContain('Bề rộng lưỡi cắt laze phải từ 0 đến 10 mm');
    });

    it('email sai -> 400 tiếng Việt', async () => {
      const res = await put({ companyEmail: 'khong-phai-email' });
      expect(res.status).toBe(400);
      expect(messages(res).join(' ')).toContain('Email công ty không đúng định dạng');
    });

    it('điện thoại có chữ -> 400 tiếng Việt', async () => {
      const res = await put({ companyPhone: 'abc' });
      expect(res.status).toBe(400);
      expect(messages(res).join(' ')).toContain('Số điện thoại chỉ gồm chữ số');
    });

    it('giá trị hợp lệ -> 200 và đã lưu; email / điện thoại rỗng (FE xoá ô) cũng 200', async () => {
      const ok = await put({
        solverMaxWastePercentage: 5,
        solverBladeWidthMm: 2,
        companyEmail: 'lienhe@congty.vn',
        companyPhone: '0901 234 567',
      });
      expect(ok.status).toBe(200);
      const row = await prisma.systemConfig.findUniqueOrThrow({ where: { id: 1 } });
      expect(Number(row.solverMaxWastePercentage)).toBe(5);
      expect(row.companyEmail).toBe('lienhe@congty.vn');
      await put({ companyEmail: '', companyPhone: '' }).expect(200);
    });
  });

  // =====================================================================================
  // T1-5 / T1-6 / T1-7 / T3-10
  // =====================================================================================
  describe('Trước đây 500, nay 400 / 404 tiếng Việt', () => {
    it('T1-5: GET /notifications?category=ZZZ và POST /notifications/read-all?category=ZZZ -> 400 "Loại thông báo không hợp lệ"', async () => {
      const list = await call('admin', 'get', '/notifications?category=ZZZ');
      expect(list.status).toBe(400);
      expect(messages(list).join(' ')).toContain('Loại thông báo không hợp lệ');
      const all = await call('admin', 'post', '/notifications/read-all?category=ZZZ');
      expect(all.status).toBe(400);
      expect(messages(all).join(' ')).toContain('Loại thông báo không hợp lệ');
      await call('admin', 'get', '/notifications?category=INFO').expect(200);
    });

    it('T1-6: GET /cut-bundles?status=ZZZ -> 400 "Trạng thái đợt cắt không hợp lệ"; status đúng -> 200', async () => {
      const res = await call('admin', 'get', '/cut-bundles?status=ZZZ');
      expect(res.status).toBe(400);
      expect(messages(res).join(' ')).toContain('Trạng thái đợt cắt không hợp lệ');
      await call('admin', 'get', '/cut-bundles?status=CUTTING').expect(200);
    });

    it('T1-7: POST /materials với detailKind / steelSubGroup lạ -> 400 tiếng Việt (không 500)', async () => {
      const a = await call('admin', 'post', '/materials', { detailKind: 'ZZZ' });
      expect(a.status).toBe(400);
      expect(messages(a).join(' ')).toContain('Loại chi tiết vật tư không hợp lệ');
      const b = await call('admin', 'post', '/materials', { steelSubGroup: 'ZZZ' });
      expect(b.status).toBe(400);
      expect(messages(b).join(' ')).toContain('Nhóm con của sắt không hợp lệ');
      const c = await call('admin', 'patch', `/materials/${GONE}`, { detailKind: 'ZZZ' });
      expect(c.status).toBe(400);
    });

    it('T3-10: id quá lớn -> 400 hoặc 404 tiếng Việt, không 5xx', async () => {
      const huge = '99999999999999999999999';
      for (const path of [
        `/warehouses/${huge}`,
        `/material-groups/${huge}`,
        `/materials/${huge}`,
      ]) {
        const res = await call('admin', 'get', path);
        expect({ path, ok: [400, 404].includes(res.status) }).toEqual({ path, ok: true });
        expect(bodyText(res)).toMatch(/không hợp lệ|Không tìm thấy/);
      }
      const del = await call('admin', 'delete', `/warehouses/${huge}`);
      expect([400, 404]).toContain(del.status);
    });

    it('T3-10 (bước gốc): GET /stock-ledger?materialId=99999999999999999999 -> 400 tiếng Việt, không 5xx', async () => {
      const res = await call('admin', 'get', '/stock-ledger?materialId=99999999999999999999');
      expect(res.status).toBe(400);
      expect(res.status).toBeLessThan(500);
      expect(messages(res).join(' ')).toMatch(/không hợp lệ/);
      expect(bodyText(res)).not.toMatch(/must be|should not|Internal/);
    });

    it('T3-10: sổ kho lọc ngày thuần YYYY-MM-DD theo giờ VN (toDate gồm trọn ngày, fromDate từ 00:00 VN)', async () => {
      const src = await newWarehouse(`K${short}L1`);
      const dst = await newWarehouse(`K${short}L2`);
      const mat = await prisma.material.create({
        data: { code: `${tag}-m3`, name: 'Vat tu so kho', unit: 'cai' },
      });
      materialIds.push(mat.id);
      const mk = (iso: string) =>
        prisma.stockLedger.create({
          data: {
            fromWarehouseId: src,
            toWarehouseId: dst,
            materialId: mat.id,
            qty: 1,
            refType: StockLedgerRefType.OPENING_BALANCE,
            createdAt: new Date(iso),
          },
        });
      // 20:00 giờ VN ngày 18/11 và 01:00 giờ VN ngày 19/11
      const evening18 = await mk('2026-11-18T13:00:00.000Z');
      const early19 = await mk('2026-11-18T18:00:00.000Z');
      const ids = async (qs: string): Promise<string[]> => {
        const res = await call('admin', 'get', `/stock-ledger?warehouseId=${dst}&limit=100&${qs}`);
        expect(res.status).toBe(200);
        const d = (res.body as ApiEnvelope<unknown>).data;
        const rows = (Array.isArray(d) ? d : (d as { data: unknown[] }).data) as Array<{
          id: string;
        }>;
        return rows.map((r) => String(r.id));
      };
      const e = evening18.id.toString();
      const m = early19.id.toString();
      expect(await ids('toDate=2026-11-18')).toEqual(expect.arrayContaining([e]));
      expect(await ids('toDate=2026-11-18')).not.toContain(m);
      expect(await ids('fromDate=2026-11-19')).toContain(m);
      expect(await ids('fromDate=2026-11-19')).not.toContain(e);
      expect(await ids('fromDate=2026-11-18&toDate=2026-11-18')).toEqual(
        expect.arrayContaining([e]),
      );
      // chuỗi sai -> 400 tiếng Việt
      const bad = await call('admin', 'get', '/stock-ledger?toDate=khong-phai-ngay');
      expect(bad.status).toBe(400);
    }, 30_000);
  });

  // =====================================================================================
  // T3-15
  // =====================================================================================
  describe('T3-15: thiếu trường bắt buộc -> một câu "Thiếu ..." mỗi trường, không tên tiếng Anh', () => {
    it('POST /warehouse-transfers/:id/reject thiếu lý do -> đúng 1 câu "Thiếu lý do từ chối"', async () => {
      const res = await call('admin', 'post', '/warehouse-transfers/1/reject', {});
      expect(res.status).toBe(400);
      expect(messages(res)).toEqual(['Thiếu lý do từ chối']);
      expect(bodyText(res)).not.toMatch(/rejectionReason|must be|should not/);
    });

    it('POST /warehouses thiếu mã và tên -> mỗi trường 1 câu "Thiếu ...", không "code" / "name"', async () => {
      const res = await call('admin', 'post', '/warehouses', {});
      expect(res.status).toBe(400);
      const ms = messages(res);
      expect(ms).toHaveLength(2);
      expect(ms).toEqual(expect.arrayContaining(['Thiếu mã', 'Thiếu tên']));
      expect(bodyText(res)).not.toMatch(/"[A-Za-z]+"\s|\bcode\b|\bname\b|must be|should not/);
    });

    it('POST /warehouse-transfers/1/confirm có dòng thiếu receivedQty -> "Dòng 1: thiếu ...", không tên tiếng Anh', async () => {
      // Từ 20/11 ảnh phiếu ký phải là tệp hệ thống đã tải lên (IsSystemUploadUrl) - dùng URL hợp lệ để chỉ còn đúng lỗi thiếu số
      // thực nhận (Sang báo 23/11: URL giả làm ra thêm câu "ảnh phiếu đã ký phải là tệp đã tải lên...").
      const prevCloud = process.env.CLOUDINARY_CLOUD_NAME;
      process.env.CLOUDINARY_CLOUD_NAME = 'dna-test-cloud-1911';
      let res: Awaited<ReturnType<typeof call>>;
      try {
        res = await call('admin', 'post', '/warehouse-transfers/1/confirm', {
          signedSlipUrls: [
            'https://res.cloudinary.com/dna-test-cloud-1911/image/upload/v1/dna-erp/t315/phieu.jpg',
          ],
          items: [{ id: '1' }],
        });
      } finally {
        if (prevCloud === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
        else process.env.CLOUDINARY_CLOUD_NAME = prevCloud;
      }
      expect(res.status).toBe(400);
      const ms = messages(res);
      expect(ms).toHaveLength(1);
      expect(ms[0]).toMatch(/^Dòng 1: thiếu /);
      expect(bodyText(res)).not.toMatch(/receivedQty|must be|should not/);
    });

    it('trường tuỳ chọn gửi chuỗi rỗng (GET /stock-ledger?fromDate=) -> 400 KHÔNG ra "Thiếu ..."', async () => {
      const res = await call('admin', 'get', '/stock-ledger?fromDate=');
      expect(res.status).toBe(400);
      expect(messages(res).length).toBeGreaterThan(0);
      expect(messages(res)).toEqual(['Từ ngày phải là ngày hợp lệ (dạng YYYY-MM-DD)']);
      expect(messages(res).join(' ')).not.toMatch(/Thiếu|fromDate|must be/);
    });

    it('trường lạ vẫn báo "Không được gửi ...", không nhầm thành "Thiếu"', async () => {
      const res = await call('admin', 'post', '/warehouse-transfers/1/reject', {
        rejectionReason: 'x',
        zzz: 1,
      });
      expect(res.status).toBe(400);
      expect(messages(res).join(' ')).toContain('Không được gửi');
    });
  });
});
