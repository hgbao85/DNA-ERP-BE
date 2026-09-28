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
  // Quản lý vật tư (2026-09-28) - CRUD danh mục Material (Admin > Danh mục hệ thống > Vật tư),
  // KHÔNG phải PURCHASER (Mua hàng chỉ VIEW vật tư) và KHÔNG phải WAREHOUSE_STAFF (thủ kho không
  // được sửa/xoá vật tư gốc, xem comment MATERIAL ở PURCHASER bên role-permissions.constant.ts).
  MATERIALS_MANAGER: 'MATERIALS_MANAGER',
  // BOM spec editors (định mức) - đi cùng MfgRole.SPEC_* tương ứng.
  SPEC_STEEL_STAFF: 'SPEC_STEEL_STAFF', // định mức mảnh: sắt/dây/đinh/tán rút/nút nhựa (FE: "Sắt")
  SPEC_ACCESSORY_PACKAGING_STAFF: 'SPEC_ACCESSORY_PACKAGING_STAFF', // định mức chi tiết: sơn/phụ kiện/bao bì (FE: "Định mức chi tiết")
} as const;

export type BusinessRole = (typeof BUSINESS_ROLES)[keyof typeof BUSINESS_ROLES];
