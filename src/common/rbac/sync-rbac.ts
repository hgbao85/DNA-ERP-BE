import { PERMISSION_MODULES } from '../constants/permission-modules.constant';
import {
  ModuleGrant,
  ROLE_GRANTS,
  UNIVERSAL_BUSINESS_GRANTS,
} from '../constants/role-permissions.constant';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../constants/roles.constant';
import { PermissionAction } from '../../generated/prisma/client';

const ALL_ACTIONS = Object.values(PermissionAction);
const ALL_MODULES = Object.values(PERMISSION_MODULES);

/**
 * Hand-written structural slice of PrismaClient - just what this module touches. Deliberately
 * NOT `Pick<PrismaClient, ...>`: Prisma's `$extends()` (used by the app's real PRISMA_SERVICE,
 * see main.ts) returns delegates with different internal generic args than the plain
 * `PrismaClient` (prisma/seed.ts uses), so the two aren't mutually assignable even though both
 * support the exact same calls below. A plain hand-rolled interface sidesteps that generic
 * mismatch entirely - both client shapes structurally satisfy this.
 */
interface RbacPrismaClient {
  permission: {
    upsert(args: {
      where: { module_action: { module: string; action: PermissionAction } };
      update: Record<string, never>;
      create: { module: string; action: PermissionAction };
    }): Promise<{ id: string; module: string; action: PermissionAction }>;
  };
  role: {
    upsert(args: {
      where: { name: string };
      update: { description: string };
      create: { name: string; description: string };
    }): Promise<{ id: string }>;
  };
  rolePermission: {
    findMany(args: {
      where: { roleId: string };
      select: { permissionId: true };
    }): Promise<{ permissionId: string }[]>;
    deleteMany(args: {
      where: { roleId: string; permissionId: { in: string[] } };
    }): Promise<unknown>;
    createMany(args: {
      data: { roleId: string; permissionId: string }[];
      skipDuplicates: true;
    }): Promise<unknown>;
  };
  $transaction(ops: Promise<unknown>[]): Promise<unknown>;
}

/**
 * Make a role's permission set match `desiredIds` exactly: add the missing links and
 * remove the ones no longer wanted. This is what makes ROLE_GRANTS the source of truth -
 * dropping a grant from the map actually revokes it here, rather than lingering forever
 * the way an append-only createMany would.
 */
async function syncRolePermissions(
  prisma: RbacPrismaClient,
  roleId: string,
  desiredIds: Set<string>,
): Promise<void> {
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

function upsertRole(prisma: RbacPrismaClient, name: string, description: string) {
  return prisma.role.upsert({
    where: { name },
    update: { description },
    create: { name, description },
  });
}

/**
 * Makes `Permission`/`Role`/`RolePermission` match `role-permissions.constant.ts` exactly -
 * the DB-side half of RBAC. Pure function of the constants module, no env vars or seed data
 * required, safe to call on every boot (see `main.ts`) so permission edits take effect
 * immediately without anyone remembering to run `npm run seed` by hand - real incident this
 * fixes (2026-08-10): WAREHOUSE_STAFF got MATERIAL:VIEW added to the constant, but this DB
 * never got re-seeded, so `muapsh` (PURCHASER+WAREHOUSE_STAFF) kept 403-ing on GET /materials
 * until someone noticed and ran `npm run seed` by hand.
 *
 * Deliberately excludes the rest of `prisma/seed.ts` (SystemConfig, warehouses, material
 * groups, the super-admin user) - those need `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` and are
 * genuinely one-time-per-environment setup, not something to silently redo on every boot.
 */
export async function syncRbac(prisma: RbacPrismaClient): Promise<void> {
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

  const admin = await upsertRole(
    prisma,
    DEFAULT_ROLES.ADMIN,
    'Full access to every module and action',
  );
  await syncRolePermissions(prisma, admin.id, allIds);

  const boss = await upsertRole(
    prisma,
    BUSINESS_ROLES.BOSS,
    'Approve everywhere + view everything',
  );
  const bossIds = new Set(
    permissions
      .filter((p) => p.action === PermissionAction.VIEW || p.action === PermissionAction.APPROVE)
      .map((p) => p.id),
  );
  await syncRolePermissions(prisma, boss.id, bossIds);

  for (const name of Object.values(BUSINESS_ROLES)) {
    if (name === BUSINESS_ROLES.BOSS) continue; // handled above
    const role = await upsertRole(prisma, name, `Business role: ${name}`);
    const grants = [...UNIVERSAL_BUSINESS_GRANTS, ...(ROLE_GRANTS[name] ?? [])];
    await syncRolePermissions(prisma, role.id, new Set(resolveGrants(grants, permIdByKey)));
  }
}
