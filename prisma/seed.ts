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
import { PermissionAction, PrismaClient } from '../src/generated/prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const ALL_ACTIONS = Object.values(PermissionAction);
const ALL_MODULES = Object.values(PERMISSION_MODULES);

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

  // 7. Super admin user.
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
  console.log(`Seed complete. Roles synced: ${roleCount}. Admin: ${adminEmail}`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
