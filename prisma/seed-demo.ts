import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../src/common/constants/roles.constant';
import { MfgRole, PrismaClient } from '../src/generated/prisma/client';

/**
 * DEMO accounts - dev/demo environments only. Deliberately kept OUT of the production
 * seed (prisma/seed.ts) so a real deploy never creates fake logins. Run explicitly with
 * `pnpm seed:demo` after the main seed (it needs the business roles to already exist).
 *
 * All accounts share one password (SEED_DEMO_PASSWORD, default below). Each account sets
 * both its Role (capability / RBAC layer) AND its mfgRole/warehouseScope/flags (scope /
 * ABAC layer) so the two authorization layers stay consistent.
 *
 * warehouseScope values use the physical warehouse codes from the schema doc
 * (phoi-son-han / vat-tu-tp / thanh-pham). Since warehouseScope is a free string with no
 * FK, setting it now is fine even though the `warehouses` rows only arrive in Phase 2 -
 * but double-check these codes match the final Phase 2 warehouse seed.
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

interface DemoAccount {
  username: string;
  email: string;
  name: string;
  roles: string[];
  mfgRole?: MfgRole;
  warehouseScope?: string;
  isPurchaser?: boolean;
  isProductPlanner?: boolean;
  isSale?: boolean;
}

// Mirrors the accounts actually present in production as of 2026-07-28 (username/email/role
// combos drift over time via the admin UI - re-check against prod before relying on this list).
const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    username: 'admin',
    email: 'admin@demo.com',
    name: 'Quản trị viên',
    roles: [DEFAULT_ROLES.ADMIN],
  },
  {
    username: 'admin2',
    email: 'admin2@demo.com',
    name: 'Quản trị viên 2',
    roles: [DEFAULT_ROLES.ADMIN],
  },
  { username: 'boss', email: 'boss@demo.com', name: 'Giám đốc', roles: [BUSINESS_ROLES.BOSS] },
  {
    username: 'sales',
    email: 'sales@demo.com',
    name: 'Sales',
    roles: [BUSINESS_ROLES.WAREHOUSE_STAFF, BUSINESS_ROLES.SALES_STAFF],
    isSale: true,
  },
  {
    username: 'khsx',
    email: 'khsx@demo.com',
    name: 'Kế hoạch sản xuất',
    roles: [BUSINESS_ROLES.WAREHOUSE_STAFF, BUSINESS_ROLES.PRODUCTION_PLANNER],
    isProductPlanner: true,
  },
  {
    username: 'qlsx',
    email: 'qlsx@demo.com',
    name: 'Quản lý sản xuất',
    roles: [BUSINESS_ROLES.PRODUCTION_MANAGER],
    mfgRole: MfgRole.PRODUCTION_MANAGER,
  },
  {
    username: 'khopsh',
    email: 'khopsh@demo.com',
    name: 'Kho phôi sơn hàn',
    roles: [BUSINESS_ROLES.WAREHOUSE_STAFF],
    warehouseScope: 'phoi-son-han',
  },
  {
    username: 'khovttp',
    email: 'khovttp@demo.com',
    name: 'Kho VTTP',
    roles: [BUSINESS_ROLES.WAREHOUSE_STAFF],
    warehouseScope: 'vat-tu-tp',
  },
  {
    username: 'khotp',
    email: 'khotp@demo.com',
    name: 'Kho thành phẩm',
    roles: [BUSINESS_ROLES.WAREHOUSE_STAFF],
    warehouseScope: 'thanh-pham',
  },
  {
    username: 'muapsh',
    email: 'muapsh@demo.com',
    name: 'NV mua hàng (kho phôi sơn hàn)',
    roles: [BUSINESS_ROLES.WAREHOUSE_STAFF, BUSINESS_ROLES.PURCHASER],
    isPurchaser: true,
    warehouseScope: 'phoi-son-han',
  },
  {
    username: 'muavttp',
    email: 'muavttp@demo.com',
    name: 'NV mua hàng (kho VTTP)',
    roles: [BUSINESS_ROLES.WAREHOUSE_STAFF, BUSINESS_ROLES.PURCHASER],
    isPurchaser: true,
    warehouseScope: 'vat-tu-tp',
  },
  {
    username: 'muatp',
    email: 'muatp@demo.com',
    name: 'NV mua hàng (kho thành phẩm)',
    roles: [BUSINESS_ROLES.WAREHOUSE_STAFF, BUSINESS_ROLES.PURCHASER],
    isPurchaser: true,
    warehouseScope: 'thanh-pham',
  },
  {
    username: 'phoi',
    email: 'phoi@demo.com',
    name: 'Phôi',
    roles: [BUSINESS_ROLES.PHOI_STAFF],
    mfgRole: MfgRole.PHOI,
    warehouseScope: 'phoi-son-han',
  },
  {
    username: 'han',
    email: 'han@demo.com',
    name: 'Hàn',
    roles: [BUSINESS_ROLES.HAN_STAFF],
    mfgRole: MfgRole.HAN,
    warehouseScope: 'phoi-son-han',
  },
  {
    username: 'son',
    email: 'son@demo.com',
    name: 'Sơn',
    roles: [BUSINESS_ROLES.SON_STAFF],
    mfgRole: MfgRole.SON,
    warehouseScope: 'phoi-son-han',
  },
  {
    username: 'kcs',
    email: 'kcs@demo.com',
    name: 'KCS',
    roles: [BUSINESS_ROLES.KCS_STAFF],
    mfgRole: MfgRole.KCS,
    warehouseScope: 'phoi-son-han',
  },
  {
    username: 'dms',
    email: 'dms@demo.com',
    name: 'Định mức sắt',
    roles: [BUSINESS_ROLES.SPEC_STEEL_STAFF],
    mfgRole: MfgRole.SPEC_STEEL,
  },
  {
    // FE hiển thị vị trí này là "Vật tư/Phụ kiện" (nội dung nghiệp vụ vẫn là dây/sơn/đinh).
    username: 'dmvtpk',
    email: 'dmvtpk@demo.com',
    name: 'Định mức Vật tư/Phụ kiện (dây/sơn/đinh)',
    roles: [BUSINESS_ROLES.SPEC_WIRE_PAINT_STAFF],
    mfgRole: MfgRole.SPEC_WIRE_PAINT,
  },
  {
    // Covers both accessory + packaging; mfgRole is single-valued so we use SPEC_ACCESSORY.
    // Split into two accounts if the two spec areas must be gated separately.
    // FE hiển thị vị trí này là "Bao bì/Đóng gói" (nội dung nghiệp vụ vẫn là phụ kiện/bao bì).
    username: 'dmbbdg',
    email: 'dmbbdg@demo.com',
    name: 'Định mức Bao bì/Đóng gói (phụ kiện/bao bì)',
    roles: [BUSINESS_ROLES.SPEC_ACCESSORY_PACKAGING_STAFF],
    mfgRole: MfgRole.SPEC_ACCESSORY,
  },
];

async function main() {
  const password = process.env.SEED_DEMO_PASSWORD ?? 'demo1234';
  const hashedPassword = await argon2.hash(password);

  const roles = await prisma.role.findMany({ select: { id: true, name: true } });
  const roleIdByName = new Map(roles.map((r) => [r.name, r.id]));

  for (const acc of DEMO_ACCOUNTS) {
    const roleIds = acc.roles.map((roleName) => {
      const roleId = roleIdByName.get(roleName);
      if (!roleId) {
        throw new Error(`Role "${roleName}" not found - run \`pnpm seed\` first to create roles.`);
      }
      return roleId;
    });

    const attributes = {
      mfgRole: acc.mfgRole ?? null,
      warehouseScope: acc.warehouseScope ?? null,
      isPurchaser: acc.isPurchaser ?? false,
      isProductPlanner: acc.isProductPlanner ?? false,
      isSale: acc.isSale ?? false,
    };

    const user = await prisma.user.upsert({
      where: { email: acc.email },
      // reset shared demo password + attrs + username on re-run
      update: { ...attributes, username: acc.username, password: hashedPassword },
      create: {
        username: acc.username,
        email: acc.email,
        password: hashedPassword,
        firstName: acc.name,
        lastName: '(demo)',
        ...attributes,
      },
    });

    for (const roleId of roleIds) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId } },
        update: {},
        create: { userId: user.id, roleId },
      });
    }
  }

  console.log(`Demo seed complete: ${DEMO_ACCOUNTS.length} accounts (password: "${password}").`);
}

main()
  .catch((error) => {
    console.error('Demo seed failed:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
