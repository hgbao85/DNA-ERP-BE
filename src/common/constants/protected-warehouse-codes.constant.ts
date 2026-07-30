/**
 * The 6 physical + 3 virtual warehouses seeded at Phase 2 (see prisma/seed.ts and
 * docs/dna-erp-db-schema.html "warehouses"). None of these codes may ever be deleted -
 * the virtual ones are permanent posting points for stock_ledger (P3) and the physical
 * ones are the only real storage locations the rest of MES assumes exist.
 *
 * A secondary physical warehouse an Admin creates later (e.g. "thanh-pham-2") is NOT
 * protected - only the fixed set below. The future warehouses.service.ts delete() must
 * reject any code in this list before touching the DB.
 */
export const PROTECTED_WAREHOUSE_CODES = [
  // Vật lý (6)
  'phu-kien',
  'sat',
  'day',
  'thanh-pham',
  'vat-tu-tp',
  'phoi-son-han',
  // Ảo (3) - điểm đến/đi cho stock_ledger, không có tồn vật lý
  'SUPPLIER',
  'PRODUCTION',
  'SCRAP',
] as const;

export type ProtectedWarehouseCode = (typeof PROTECTED_WAREHOUSE_CODES)[number];
