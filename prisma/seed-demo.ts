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
  role: string;
  mfgRole?: MfgRole;
  warehouseScope?: string;
  isPurchaser?: boolean;
  isProductPlanner?: boolean;
  isSale?: boolean;
}

const DEMO_ACCOUNTS: DemoAccount[] = [
  // "admin_demo" (not "admin") - the production seed's admin (prisma/seed.ts) also
  // derives its username to "admin" by default; both scripts can run against the same
  // local dev database, so these must not collide.
  {
    username: 'admin_demo',
    email: 'admin@demo.com',
    name: 'Quản trị viên',
    role: DEFAULT_ROLES.ADMIN,
  },
  { username: 'boss', email: 'boss@demo.com', name: 'Giám đốc', role: BUSINESS_ROLES.BOSS },
  {
    username: 'sales',
    email: 'sales@demo.com',
    name: 'Sales',
    role: BUSINESS_ROLES.SALES_STAFF,
    isSale: true,
  },
  {
    username: 'khsx',
    email: 'khsx@demo.com',
    name: 'Kế hoạch sản xuất',
    role: BUSINESS_ROLES.PRODUCTION_PLANNER,
    isProductPlanner: true,
  },
  {
    username: 'qlsx',
    email: 'qlsx@demo.com',
    name: 'Quản lý sản xuất',
    role: BUSINESS_ROLES.PRODUCTION_MANAGER,
    mfgRole: MfgRole.PRODUCTION_MANAGER,
  },
  {
    username: 'khopsh',
    email: 'khopsh@demo.com',
    name: 'Kho phôi sơn hàn',
    role: BUSINESS_ROLES.WAREHOUSE_STAFF,
    warehouseScope: 'phoi-son-han',
  },
  {
    username: 'khovttp',
    email: 'khovttp@demo.com',
    name: 'Kho VTTP',
    role: BUSINESS_ROLES.WAREHOUSE_STAFF,
    warehouseScope: 'vat-tu-tp',
  },
  {
    username: 'khotp',
    email: 'khotp@demo.com',
    name: 'Kho thành phẩm',
    role: BUSINESS_ROLES.WAREHOUSE_STAFF,
    warehouseScope: 'thanh-pham',
  },
  {
    username: 'muapsh',
    email: 'muapsh@demo.com',
    name: 'NV mua hàng (kho phôi sơn hàn)',
    role: BUSINESS_ROLES.PURCHASER,
    isPurchaser: true,
    warehouseScope: 'phoi-son-han',
  },
  {
    username: 'muavttp',
    email: 'muavttp@demo.com',
    name: 'NV mua hàng (kho VTTP)',
    role: BUSINESS_ROLES.PURCHASER,
    isPurchaser: true,
    warehouseScope: 'vat-tu-tp',
  },
  {
    username: 'muatp',
    email: 'muatp@demo.com',
    name: 'NV mua hàng (kho thành phẩm)',
    role: BUSINESS_ROLES.PURCHASER,
    isPurchaser: true,
    warehouseScope: 'thanh-pham',
  },
  {
    username: 'phoi',
    email: 'phoi@demo.com',
    name: 'Phôi',
    role: BUSINESS_ROLES.PHOI_STAFF,
    mfgRole: MfgRole.PHOI,
  },
  {
    username: 'han',
    email: 'han@demo.com',
    name: 'Hàn',
    role: BUSINESS_ROLES.HAN_STAFF,
    mfgRole: MfgRole.HAN,
  },
  {
    username: 'son',
    email: 'son@demo.com',
    name: 'Sơn',
    role: BUSINESS_ROLES.SON_STAFF,
    mfgRole: MfgRole.SON,
  },
  {
    username: 'kcs',
    email: 'kcs@demo.com',
    name: 'KCS',
    role: BUSINESS_ROLES.KCS_STAFF,
    mfgRole: MfgRole.KCS,
  },
  {
    username: 'dinhmucsat',
    email: 'dinhmucsat@demo.com',
    name: 'Định mức sắt',
    role: BUSINESS_ROLES.SPEC_STEEL_STAFF,
    mfgRole: MfgRole.SPEC_STEEL,
  },
  {
    username: 'dinhmucdayson',
    email: 'dinhmucdayson@demo.com',
    name: 'Định mức dây/sơn/đinh',
    role: BUSINESS_ROLES.SPEC_WIRE_PAINT_STAFF,
    mfgRole: MfgRole.SPEC_WIRE_PAINT,
  },
  {
    // Covers both accessory + packaging; mfgRole is single-valued so we use SPEC_ACCESSORY.
    // Split into two accounts if the two spec areas must be gated separately.
    username: 'dinhmucpkbb',
    email: 'dinhmucpkbb@demo.com',
    name: 'Định mức phụ kiện/bao bì',
    role: BUSINESS_ROLES.SPEC_ACCESSORY_PACKAGING_STAFF,
    mfgRole: MfgRole.SPEC_ACCESSORY,
  },
];

async function main() {
  const password = process.env.SEED_DEMO_PASSWORD ?? 'demo1234';
  const hashedPassword = await argon2.hash(password);

  const roles = await prisma.role.findMany({ select: { id: true, name: true } });
  const roleIdByName = new Map(roles.map((r) => [r.name, r.id]));

  for (const acc of DEMO_ACCOUNTS) {
    const roleId = roleIdByName.get(acc.role);
    if (!roleId) {
      throw new Error(`Role "${acc.role}" not found - run \`pnpm seed\` first to create roles.`);
    }

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

    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId } },
      update: {},
      create: { userId: user.id, roleId },
    });
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
