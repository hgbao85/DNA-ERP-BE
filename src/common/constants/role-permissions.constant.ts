import { MfgRole, PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES, PermissionModule } from './permission-modules.constant';
import { BUSINESS_ROLES, BusinessRole } from './roles.constant';

/**
 * A grant = a module + which actions on it. `'ALL'` expands to every PermissionAction.
 * The `module` field is typed as PermissionModule, so a grant can only reference a module
 * that already exists in PERMISSION_MODULES - you literally cannot write a grant for a
 * module a future phase hasn't registered yet (it won't type-check). That is intentional.
 */
export interface ModuleGrant {
  module: PermissionModule;
  actions: PermissionAction[] | 'ALL';
}

/**
 * Granted to EVERY business role: any authenticated staff member can read the
 * notifications targeted at them. Keeps a freshly-seeded business role from being a
 * completely empty shell before its domain modules land.
 */
export const UNIVERSAL_BUSINESS_GRANTS: ModuleGrant[] = [
  { module: PERMISSION_MODULES.NOTIFICATION, actions: [PermissionAction.VIEW] },
];

/**
 * SINGLE SOURCE OF TRUTH for "what can role X do". As each backend phase lands and adds
 * its module to PERMISSION_MODULES, uncomment / add that module's grant to the relevant
 * role here - do NOT scatter permission-granting across modules/migrations. The seed
 * SYNCS each managed role to exactly this set (adds missing + removes extra) on every run.
 *
 * BOSS is intentionally NOT listed: it is derived in the seed as VIEW+APPROVE across every
 * module, so it auto-covers modules added by future phases without editing this file.
 *
 * At Phase 1 the only business modules that exist are NOTIFICATION / SYSTEM_CONFIG, so most
 * roles carry only the universal NOTIFICATION:VIEW. The commented blocks are the template
 * for the phase that introduces each module (module names must be added to
 * PERMISSION_MODULES first, or the grant won't compile).
 */
export const ROLE_GRANTS: Partial<Record<BusinessRole, ModuleGrant[]>> = {
  // --- Phase 4 (Sales) ---
  // [BUSINESS_ROLES.SALES_STAFF]: [
  //   { module: PERMISSION_MODULES.SALES_ORDER, actions: 'ALL' },
  //   { module: PERMISSION_MODULES.CUSTOMER, actions: 'ALL' },       // Phase 2
  //   { module: PERMISSION_MODULES.PRODUCT_VARIANT, actions: [PermissionAction.VIEW] },
  // ],
  // --- Phase 5/7/8 (Planning & Production Manager) ---
  // [BUSINESS_ROLES.PRODUCTION_PLANNER]: [
  //   { module: PERMISSION_MODULES.PLAN_FORM, actions: 'ALL' },
  // ],
  // [BUSINESS_ROLES.PRODUCTION_MANAGER]: [
  //   { module: PERMISSION_MODULES.PRODUCTION_ORDER, actions: 'ALL' },
  //   { module: PERMISSION_MODULES.INSPECTION_REQUEST, actions: 'ALL' },
  // ],
  // --- Phase 9 (MES-B execution) ---
  // [BUSINESS_ROLES.PHOI_STAFF]: [
  //   { module: PERMISSION_MODULES.STEEL_ISSUE, actions: 'ALL' },
  //   { module: PERMISSION_MODULES.PRODUCTION_BATCH, actions: 'ALL' },
  //   { module: PERMISSION_MODULES.MATERIAL_ISSUE, actions: 'ALL' },
  //   { module: PERMISSION_MODULES.WORK_SESSION, actions: 'ALL' },
  // ],
  // [BUSINESS_ROLES.KCS_STAFF]: [
  //   { module: PERMISSION_MODULES.QC_REVIEW, actions: 'ALL' },
  //   { module: PERMISSION_MODULES.REPLENISH_REQUEST, actions: 'ALL' },
  // ],
  // --- Phase 3/8 (Warehouse & Purchasing, + scope) ---
  // [BUSINESS_ROLES.WAREHOUSE_STAFF]: [
  //   { module: PERMISSION_MODULES.STOCK, actions: [PermissionAction.VIEW] },
  //   { module: PERMISSION_MODULES.WAREHOUSE_TRANSFER, actions: 'ALL' },
  // ],
  // [BUSINESS_ROLES.PURCHASER]: [
  //   { module: PERMISSION_MODULES.PURCHASE_PROPOSAL, actions: 'ALL' },
  //   { module: PERMISSION_MODULES.SUPPLIER, actions: 'ALL' },
  // ],
};

/**
 * Links the per-user `mfgRole` attribute (authorization layer 2 / scope) to the
 * capability Role (layer 1 / RBAC) that grants its permissions. Setting a user's mfgRole
 * can therefore also assign the matching Role in one place, keeping the two layers from
 * drifting apart (see the mfg-attributes endpoint). Not every MfgRole has a paired role
 * yet - only those with a seeded business role are listed.
 */
export const MFG_ROLE_TO_BUSINESS_ROLE: Partial<Record<MfgRole, BusinessRole>> = {
  [MfgRole.PRODUCTION_MANAGER]: BUSINESS_ROLES.PRODUCTION_MANAGER,
  [MfgRole.PHOI]: BUSINESS_ROLES.PHOI_STAFF,
  [MfgRole.HAN]: BUSINESS_ROLES.HAN_STAFF,
  [MfgRole.SON]: BUSINESS_ROLES.SON_STAFF,
  [MfgRole.KCS]: BUSINESS_ROLES.KCS_STAFF,
  [MfgRole.SPEC_STEEL]: BUSINESS_ROLES.SPEC_STEEL_STAFF,
  [MfgRole.SPEC_WIRE_PAINT]: BUSINESS_ROLES.SPEC_WIRE_PAINT_STAFF,
  [MfgRole.SPEC_ACCESSORY]: BUSINESS_ROLES.SPEC_ACCESSORY_PACKAGING_STAFF,
  [MfgRole.SPEC_PACKAGING]: BUSINESS_ROLES.SPEC_ACCESSORY_PACKAGING_STAFF,
};

/**
 * The 4 floor operations (Phôi/Hàn/Sơn/KCS) all live in a single physical warehouse.
 * A user assigned one of these mfgRoles must carry this exact warehouseScope - enforced
 * server-side (see UsersService.updateMfgAttributes) rather than trusted from the caller,
 * since any client with API access (not just the admin form) can hit this endpoint.
 */
export const MFG_FLOOR_WAREHOUSE_SCOPE = 'phoi-son-han';
export const MFG_FLOOR_ROLES: MfgRole[] = [MfgRole.PHOI, MfgRole.HAN, MfgRole.SON, MfgRole.KCS];
