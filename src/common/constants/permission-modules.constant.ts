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
  SKU: 'SKU',
  PRODUCTION_INVOICE: 'PRODUCTION_INVOICE',
  // --- Phase 7 (Production Order & Cutting Proposal) ---
  PRODUCTION_ORDER: 'PRODUCTION_ORDER',
  CUTTING_PROPOSAL: 'CUTTING_PROPOSAL',
  // --- Phase 3 (Kho vận lõi / Ledger Core) ---
  STOCK: 'STOCK',
  WAREHOUSE_TRANSFER: 'WAREHOUSE_TRANSFER',
  // --- Phase 8 (Mua hàng) ---
  PURCHASE_PROPOSAL: 'PURCHASE_PROPOSAL',
  // Tách khỏi PURCHASE_PROPOSAL (2026-08-15, D.c4-warehouse-can-quote) - trước đó WAREHOUSE_STAFF
  // được PURCHASE_PROPOSAL:UPDATE để gọi .../receive, nhưng CÙNG action đó cũng mở khoá
  // acknowledge/quotes/submit/requote -> thủ kho gọi thẳng API là tự báo giá + tự gửi Sếp duyệt
  // được. Chỉ gác đúng 1 route POST .../items/:itemId/receive.
  PURCHASE_RECEIPT: 'PURCHASE_RECEIPT',
  // --- Phase 9 (MES-B execution - Phôi) ---
  STEEL_ISSUE: 'STEEL_ISSUE',
  QC_REVIEW: 'QC_REVIEW',
  // --- Phase 9b (MES-B execution - Đan) ---
  WEAVING_ISSUE: 'WEAVING_ISSUE',
  // --- Phase 9c (MES-B execution - vật tư tiêu hao Hàn/Sơn) ---
  MATERIAL_ISSUE: 'MATERIAL_ISSUE',
  // --- Phase 9d (MES-B execution - sản lượng Hàn/Sơn) ---
  PRODUCTION_BATCH: 'PRODUCTION_BATCH',
} as const;

export type PermissionModule = (typeof PERMISSION_MODULES)[keyof typeof PERMISSION_MODULES];
