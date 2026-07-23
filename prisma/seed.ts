import { PrismaClient, PermissionAction } from '@prisma/client';
import * as argon2 from 'argon2';
import { PERMISSION_MODULES } from '../src/common/constants/permission-modules.constant';
import { DEFAULT_ROLES } from '../src/common/constants/roles.constant';

const prisma = new PrismaClient();

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
      permissions: {
        create: permissions.map((permission) => ({ permissionId: permission.id })),
      },
    },
  });

  const viewOnlyPermissions = permissions.filter((p) => p.action === PermissionAction.VIEW);
  await prisma.role.upsert({
    where: { name: DEFAULT_ROLES.ADMIN },
    update: {},
    create: {
      name: DEFAULT_ROLES.ADMIN,
      description: 'Read-only administrative access (starter role, extend as needed)',
      permissions: {
        create: viewOnlyPermissions.map((permission) => ({ permissionId: permission.id })),
      },
    },
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
