export const DEFAULT_ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
} as const;

export type DefaultRole = (typeof DEFAULT_ROLES)[keyof typeof DEFAULT_ROLES];

/**
 * MES/ERP business roles seeded as empty shells (no permissions assigned yet -
 * each phase's module grants its own permissions to the relevant role as it lands,
 * per the backend roadmap). Together with DEFAULT_ROLES this makes up the 12 roles
 * seeded at Phase 1.
 */
export const BUSINESS_ROLES = {
  BOSS: 'BOSS',
  SALES_STAFF: 'SALES_STAFF',
  PRODUCTION_MANAGER: 'PRODUCTION_MANAGER',
  PHOI_STAFF: 'PHOI_STAFF',
  HAN_STAFF: 'HAN_STAFF',
  SON_STAFF: 'SON_STAFF',
  KCS_STAFF: 'KCS_STAFF',
  WEAVING_MANAGER: 'WEAVING_MANAGER',
  WAREHOUSE_STAFF: 'WAREHOUSE_STAFF',
  PURCHASER: 'PURCHASER',
} as const;

export type BusinessRole = (typeof BUSINESS_ROLES)[keyof typeof BUSINESS_ROLES];
