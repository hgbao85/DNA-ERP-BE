/**
 * Registry of module names usable in Permission.module.
 * `module` is a plain string column (not a DB enum) so future ERP modules
 * (INVENTORY, PURCHASE, PRODUCTION, ...) can register permissions without a migration.
 * Add new modules here to keep them centrally documented and typo-free.
 */
export const PERMISSION_MODULES = {
  USER: 'USER',
  ROLE: 'ROLE',
  PERMISSION: 'PERMISSION',
  AUDIT_LOG: 'AUDIT_LOG',
  NOTIFICATION: 'NOTIFICATION',
  SYSTEM_CONFIG: 'SYSTEM_CONFIG',
  // --- Phase 2 (Danh mục / Master Data) ---
  MATERIAL_GROUP: 'MATERIAL_GROUP',
  SUPPLIER: 'SUPPLIER',
  DEFECT_REASON: 'DEFECT_REASON',
  WEAVING_POINT: 'WEAVING_POINT',
  WAREHOUSE: 'WAREHOUSE',
  CUSTOMER: 'CUSTOMER',
  PRODUCT: 'PRODUCT',
  MATERIAL: 'MATERIAL',
  SEGMENT_SPEC: 'SEGMENT_SPEC',
  BOM_REVISION: 'BOM_REVISION',
  // --- Sales Order + Production Order domain ---
  SALES_ORDER: 'SALES_ORDER',
  PLAN_FORM: 'PLAN_FORM',
  PRODUCTION_INVOICE: 'PRODUCTION_INVOICE',
} as const;

export type PermissionModule = (typeof PERMISSION_MODULES)[keyof typeof PERMISSION_MODULES];
