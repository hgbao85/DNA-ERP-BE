export const DEFAULT_ROLES = {
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
  PRODUCTION_PLANNER: 'PRODUCTION_PLANNER', // KHSX - lập kế hoạch SX (isProductPlanner), khác QLSX
  PRODUCTION_MANAGER: 'PRODUCTION_MANAGER', // QLSX - quản lý SX
  PHOI_STAFF: 'PHOI_STAFF',
  HAN_STAFF: 'HAN_STAFF',
  SON_STAFF: 'SON_STAFF',
  KCS_STAFF: 'KCS_STAFF',
  WAREHOUSE_STAFF: 'WAREHOUSE_STAFF',
  PURCHASER: 'PURCHASER',
  // BOM spec editors (định mức) - đi cùng MfgRole.SPEC_* tương ứng.
  SPEC_STEEL_STAFF: 'SPEC_STEEL_STAFF', // định mức sắt (FE: "Sắt")
  SPEC_WIRE_PAINT_STAFF: 'SPEC_WIRE_PAINT_STAFF', // định mức dây/sơn/đinh (FE: "Vật tư/Phụ kiện")
  SPEC_ACCESSORY_PACKAGING_STAFF: 'SPEC_ACCESSORY_PACKAGING_STAFF', // định mức phụ kiện/bao bì (FE: "Bao bì/Đóng gói")
} as const;

export type BusinessRole = (typeof BUSINESS_ROLES)[keyof typeof BUSINESS_ROLES];
