import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { PERMISSION_MODULES } from '../src/common/constants/permission-modules.constant';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../src/common/constants/roles.constant';
import { PrismaClient, PermissionAction } from '../src/generated/prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const ALL_ACTIONS = Object.values(PermissionAction);
const ALL_MODULES = Object.values(PERMISSION_MODULES);

async function main() {
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

  const superAdminRole = await prisma.role.upsert({
    where: { name: DEFAULT_ROLES.SUPER_ADMIN },
    update: {},
    create: {
      name: DEFAULT_ROLES.SUPER_ADMIN,
      description: 'Full access to every module and action',
    },
  });
  // Re-linked on every run (not just at role creation) so that permissions for newly
  // added modules (e.g. Phase 1's NOTIFICATION/SYSTEM_CONFIG) get attached to an
  // already-existing SUPER_ADMIN role instead of silently staying unassigned.
  await prisma.rolePermission.createMany({
    data: permissions.map((permission) => ({
      roleId: superAdminRole.id,
      permissionId: permission.id,
    })),
    skipDuplicates: true,
  });

  const viewOnlyPermissions = permissions.filter((p) => p.action === PermissionAction.VIEW);
  const adminRole = await prisma.role.upsert({
    where: { name: DEFAULT_ROLES.ADMIN },
    update: {},
    create: {
      name: DEFAULT_ROLES.ADMIN,
      description: 'Read-only administrative access (starter role, extend as needed)',
    },
  });
  await prisma.rolePermission.createMany({
    data: viewOnlyPermissions.map((permission) => ({
      roleId: adminRole.id,
      permissionId: permission.id,
    })),
    skipDuplicates: true,
  });

  // Business roles seeded as empty shells - each phase's module grants its own
  // permissions to the relevant role as it lands (see backend roadmap doc).
  await Promise.all(
    Object.values(BUSINESS_ROLES).map((name) =>
      prisma.role.upsert({
        where: { name },
        update: {},
        create: { name, description: `Business role: ${name} (permissions granted per phase)` },
      }),
    ),
  );

  await prisma.systemConfig.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, companyName: process.env.SEED_COMPANY_NAME ?? 'DNA ERP' },
  });

  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set to seed the admin user');
  }

  const hashedPassword = await argon2.hash(adminPassword);
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      password: hashedPassword,
      firstName: 'Super',
      lastName: 'Admin',
      roles: {
        create: { roleId: superAdminRole.id },
      },
    },
  });

  console.log(`Seed complete. Super admin: ${adminEmail}`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
