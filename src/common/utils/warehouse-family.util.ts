/**
 * "Gia đình" kho = 1 trong 3 chặng gốc của chuỗi chuyển kho nội bộ (phoi-son-han → vat-tu-tp →
 * thanh-pham). Mỗi gia đình có thể có nhiều kho vật lý: kho gốc (code = đúng tên gia đình) và các
 * kho phụ do Admin tạo thêm dạng '{gia-đình}-{n}' (xem warehouses.service.ts, trước 2026-09-03
 * chỉ 'thanh-pham' được thiết kế đa-instance - nay mở rộng cho cả 3).
 */
export const WAREHOUSE_FAMILIES = ['phoi-son-han', 'vat-tu-tp', 'thanh-pham'] as const;
export type WarehouseFamily = (typeof WAREHOUSE_FAMILIES)[number];

/** code khớp đúng 1 gia đình nếu bằng chính tên gia đình, hoặc có prefix '{gia-đình}-'. */
export function warehouseFamilyOf(code: string | null | undefined): WarehouseFamily | null {
  if (!code) return null;
  return WAREHOUSE_FAMILIES.find((f) => code === f || code.startsWith(`${f}-`)) ?? null;
}

export function isFamilyScope(code: string | null | undefined, family: WarehouseFamily): boolean {
  return warehouseFamilyOf(code) === family;
}
