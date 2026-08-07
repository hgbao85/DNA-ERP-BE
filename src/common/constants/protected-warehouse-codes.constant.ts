/**
 * The 3 physical + 3 virtual warehouses seeded at Phase 2 (see prisma/seed.ts and
 * docs/dna-erp-db-schema.html "warehouses"). None of these codes may ever be deleted -
 * the virtual ones are permanent posting points for stock_ledger (P3), and the 3
 * physical ones are the backbone internal-transfer chain phoi-son-han -> vat-tu-tp ->
 * thanh-pham that the rest of MES assumes exists (see transfer-routes.constant.ts).
 *
 * "thanh-pham" is a multi-instance root: Admin may create further finished-goods
 * warehouses later (e.g. "thanh-pham-2") - those are NOT protected, only the fixed
 * set below is. warehouses.service.ts delete()/update() rejects any code in this list.
 */
export const PROTECTED_WAREHOUSE_CODES = [
  // Vật lý (3) - chuỗi chuyển kho nội bộ gốc
  'thanh-pham',
  'vat-tu-tp',
  'phoi-son-han',
  // Ảo (3) - điểm đến/đi cho stock_ledger, không có tồn vật lý
  'SUPPLIER',
  'PRODUCTION',
  'SCRAP',
] as const;

export type ProtectedWarehouseCode = (typeof PROTECTED_WAREHOUSE_CODES)[number];
