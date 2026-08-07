import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { PERMISSION_MODULES } from '../src/common/constants/permission-modules.constant';
import {
  ModuleGrant,
  ROLE_GRANTS,
  UNIVERSAL_BUSINESS_GRANTS,
} from '../src/common/constants/role-permissions.constant';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../src/common/constants/roles.constant';
import { PROTECTED_WAREHOUSE_CODES } from '../src/common/constants/protected-warehouse-codes.constant';
import {
  MATERIAL_GROUP_SYSTEM_KEYS,
  MaterialGroupSystemKey,
} from '../src/common/constants/material-group-system-keys.constant';
import { PermissionAction, PrismaClient } from '../src/generated/prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const ALL_ACTIONS = Object.values(PermissionAction);
const ALL_MODULES = Object.values(PERMISSION_MODULES);

/**
 * 3 kho vật lý (chuỗi chuyển kho nội bộ gốc) + 3 kho ảo bắt buộc phải seed sẵn
 * (docs/dna-erp-db-schema.html "warehouses"). Codes phải khớp 1-1 với
 * PROTECTED_WAREHOUSE_CODES - đây là danh sách duy nhất mà warehouses.service.ts chặn xoá.
 * "thanh-pham" là kho gốc duy nhất được phép có thêm instance khác (vd "thanh-pham-2") -
 * Admin tạo qua UI Kho như bình thường, không cần đụng tới seed này.
 */
const SEED_WAREHOUSES: { code: string; name: string; isVirtual: boolean; note?: string }[] = [
  {
    code: 'thanh-pham',
    name: 'Kho Bao bì/Thành phẩm',
    isVirtual: false,
    note: 'Bao bì đóng gói & thành phẩm hoàn chỉnh — cuối chuỗi chuyển kho nội bộ',
  },
  {
    code: 'vat-tu-tp',
    name: 'Kho Vật tư thành phẩm',
    isVirtual: false,
    note: 'Sơn, dây, vật tư tiêu hao sản xuất',
  },
  {
    code: 'phoi-son-han',
    name: 'Kho Phôi Sơn Hàn',
    isVirtual: false,
    note: 'Phôi kim loại, sơn, vật tư hàn — đầu chuỗi chuyển kho nội bộ',
  },
  {
    code: 'SUPPLIER',
    name: 'Nhà cung cấp (ảo)',
    isVirtual: true,
    note: 'Điểm xuất phát bút toán PURCHASE trên stock_ledger — không có tồn vật lý',
  },
  {
    code: 'PRODUCTION',
    name: 'Đang sản xuất (ảo)',
    isVirtual: true,
    note: 'Hàng đang trên chuyền — không có tồn vật lý',
  },
  {
    code: 'SCRAP',
    name: 'Phế liệu (ảo)',
    isVirtual: true,
    note: 'Điểm đến bút toán huỷ/phế — không có tồn vật lý',
  },
];

/**
 * 8 nhóm vật tư hệ thống bắt buộc phải seed sẵn - thay cho enum MaterialKind đã xoá (xem
 * material-group-system-keys.constant.ts). Trang Spec Sắt (Sắt/Dây/Đinh/Tán rút/Nút nhựa -
 * đều nhập chung trong 1 mảnh)/Sơn/Phụ kiện/Bao bì và skus.service.ts resolve group theo
 * `systemKey`, KHÔNG theo `name` - admin đổi tên nhóm trong Admin > Nhóm vật tư thoải mái
 * mà logic Spec vẫn đúng.
 */
const SEED_MATERIAL_GROUPS: { systemKey: MaterialGroupSystemKey; name: string }[] = [
  { systemKey: MATERIAL_GROUP_SYSTEM_KEYS.STEEL_BAR, name: 'Sắt' },
  { systemKey: MATERIAL_GROUP_SYSTEM_KEYS.WIRE, name: 'Dây' },
  { systemKey: MATERIAL_GROUP_SYSTEM_KEYS.NAIL, name: 'Đinh' },
  { systemKey: MATERIAL_GROUP_SYSTEM_KEYS.PAINT, name: 'Sơn' },
  { systemKey: MATERIAL_GROUP_SYSTEM_KEYS.ACCESSORY, name: 'Phụ kiện' },
  { systemKey: MATERIAL_GROUP_SYSTEM_KEYS.PACKAGING, name: 'Bao bì' },
  { systemKey: MATERIAL_GROUP_SYSTEM_KEYS.RIVET, name: 'Tán rút' },
  { systemKey: MATERIAL_GROUP_SYSTEM_KEYS.PLASTIC_BUTTON, name: 'Nút nhựa' },
];

/**
 * Make a role's permission set match `desiredIds` exactly: add the missing links and
 * remove the ones no longer wanted. This is what makes ROLE_GRANTS the source of truth -
 * dropping a grant from the map actually revokes it on the next seed run, rather than
 * lingering forever the way an append-only createMany would.
 *
 * Only ever called for seed-managed roles (DEFAULT_ROLES + BUSINESS_ROLES); roles created
 * at runtime via the admin API are never passed here, so their grants are left untouched.
 */
async function syncRolePermissions(roleId: string, desiredIds: Set<string>): Promise<void> {
  const existing = await prisma.rolePermission.findMany({
    where: { roleId },
    select: { permissionId: true },
  });
  const existingIds = new Set(existing.map((e) => e.permissionId));
  const toRemove = [...existingIds].filter((id) => !desiredIds.has(id));
  const toAdd = [...desiredIds].filter((id) => !existingIds.has(id));

  const ops = [];
  if (toRemove.length > 0) {
    ops.push(
      prisma.rolePermission.deleteMany({ where: { roleId, permissionId: { in: toRemove } } }),
    );
  }
  if (toAdd.length > 0) {
    ops.push(
      prisma.rolePermission.createMany({
        data: toAdd.map((permissionId) => ({ roleId, permissionId })),
        skipDuplicates: true,
      }),
    );
  }
  if (ops.length > 0) {
    await prisma.$transaction(ops);
  }
}

/** Turn declarative grants into concrete permission ids; throws loudly on a typo/unseeded module. */
function resolveGrants(grants: ModuleGrant[], permIdByKey: Map<string, string>): string[] {
  const ids: string[] = [];
  for (const grant of grants) {
    const actions = grant.actions === 'ALL' ? ALL_ACTIONS : grant.actions;
    for (const action of actions) {
      const key = `${grant.module}:${action}`;
      const id = permIdByKey.get(key);
      if (!id) {
        throw new Error(`ROLE_GRANTS references a permission that does not exist: ${key}`);
      }
      ids.push(id);
    }
  }
  return ids;
}

function upsertRole(name: string, description: string) {
  return prisma.role.upsert({
    where: { name },
    update: { description },
    create: { name, description },
  });
}

async function main() {
  // 1. Permissions = every MODULE x ACTION.
  const permissions = await Promise.all(
    ALL_MODULES.flatMap((module) =>
      ALL_ACTIONS.map((action) =>
        prisma.permission.upsert({
          where: { module_action: { module, action } },
          update: {},
          create: { module, action },
        }),
      ),
    ),
  );
  const permIdByKey = new Map(permissions.map((p) => [`${p.module}:${p.action}`, p.id]));
  const allIds = new Set(permissions.map((p) => p.id));

  // 2. ADMIN = full access to every module and action (single top-level admin role).
  const admin = await upsertRole(DEFAULT_ROLES.ADMIN, 'Full access to every module and action');
  await syncRolePermissions(admin.id, allIds);

  // 3. BOSS = VIEW + APPROVE across EVERY module (derived -> auto-covers future phases).
  const boss = await upsertRole(BUSINESS_ROLES.BOSS, 'Approve everywhere + view everything');
  const bossIds = new Set(
    permissions
      .filter((p) => p.action === PermissionAction.VIEW || p.action === PermissionAction.APPROVE)
      .map((p) => p.id),
  );
  await syncRolePermissions(boss.id, bossIds);

  // 5. Other business roles = UNIVERSAL grants + their explicit ROLE_GRANTS entry.
  for (const name of Object.values(BUSINESS_ROLES)) {
    if (name === BUSINESS_ROLES.BOSS) continue; // handled above
    const role = await upsertRole(name, `Business role: ${name}`);
    const grants = [...UNIVERSAL_BUSINESS_GRANTS, ...(ROLE_GRANTS[name] ?? [])];
    await syncRolePermissions(role.id, new Set(resolveGrants(grants, permIdByKey)));
  }

  // 6. SystemConfig singleton (id pinned to 1 by CHECK constraint).
  await prisma.systemConfig.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, companyName: process.env.SEED_COMPANY_NAME ?? 'DNA ERP' },
  });

  // 7. Warehouses (Phase 2) — 6 vật lý + 3 ảo, seed cố định, không bao giờ xoá. Đặt trước
  // bước 8 (admin user) có chủ đích: danh mục/role không được phép phụ thuộc vào việc có
  // set SEED_ADMIN_EMAIL/PASSWORD hay không - 2 việc độc lập nhau.
  if (SEED_WAREHOUSES.length !== PROTECTED_WAREHOUSE_CODES.length) {
    throw new Error('SEED_WAREHOUSES phải khớp 1-1 với PROTECTED_WAREHOUSE_CODES');
  }
  for (const wh of SEED_WAREHOUSES) {
    if (!(PROTECTED_WAREHOUSE_CODES as readonly string[]).includes(wh.code)) {
      throw new Error(
        `SEED_WAREHOUSES có code lạ, không nằm trong PROTECTED_WAREHOUSE_CODES: ${wh.code}`,
      );
    }
    await prisma.warehouse.upsert({
      where: { code: wh.code },
      update: { name: wh.name, isVirtual: wh.isVirtual, note: wh.note },
      create: wh,
    });
  }

  // 7.5. Material groups hệ thống - cùng lý do đặt trước bước 8 như warehouses. KHÔNG dùng
  // upsert({ where: { systemKey } }) đơn giản: nếu nhóm đã tồn tại từ trước dưới đúng tên
  // mặc định (vd tạo tay qua Admin > Nhóm vật tư trước khi có systemKey) thì ADOPT (gán
  // systemKey vào, giữ nguyên id + mọi vật tư đang trỏ tới), không tạo trùng theo `name`
  // @unique. Nhóm đã có systemKey thì bỏ qua hẳn - KHÔNG ghi đè `name` mỗi lần chạy như
  // warehouse ở trên, vì sẽ xoá tác dụng nếu admin đã đổi tên hiển thị.
  if (SEED_MATERIAL_GROUPS.length !== Object.keys(MATERIAL_GROUP_SYSTEM_KEYS).length) {
    throw new Error('SEED_MATERIAL_GROUPS phải khớp 1-1 với MATERIAL_GROUP_SYSTEM_KEYS');
  }
  for (const g of SEED_MATERIAL_GROUPS) {
    const bySystemKey = await prisma.materialGroup.findUnique({
      where: { systemKey: g.systemKey },
    });
    if (bySystemKey) continue;

    const byName = await prisma.materialGroup.findUnique({ where: { name: g.name } });
    if (byName) {
      await prisma.materialGroup.update({
        where: { id: byName.id },
        data: { systemKey: g.systemKey },
      });
    } else {
      await prisma.materialGroup.create({ data: { name: g.name, systemKey: g.systemKey } });
    }
  }

  // 8. Super admin user.
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set to seed the admin user');
  }
  // Optional so existing deploys that haven't set this env var yet don't break;
  // falls back to the email's local-part (e.g. "admin@dna-erp.local" -> "admin").
  const adminUsername = process.env.SEED_ADMIN_USERNAME ?? adminEmail.split('@')[0];
  const hashedPassword = await argon2.hash(adminPassword);
  const user = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { username: adminUsername },
    create: {
      username: adminUsername,
      email: adminEmail,
      password: hashedPassword,
      firstName: 'Super',
      lastName: 'Admin',
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: admin.id } },
    update: {},
    create: { userId: user.id, roleId: admin.id },
  });

  const roleCount = 1 + Object.values(BUSINESS_ROLES).length; // ADMIN + business
  console.log(
    `Seed complete. Roles synced: ${roleCount}. Warehouses synced: ${SEED_WAREHOUSES.length}. Material groups synced: ${SEED_MATERIAL_GROUPS.length}. Admin: ${adminEmail}`,
  );
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
