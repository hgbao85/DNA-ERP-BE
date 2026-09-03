/**
 * "Gia đình" kho = 1 trong 3 chặng gốc của chuỗi chuyển kho nội bộ (phoi-son-han → vat-tu-tp →
 * thanh-pham). Mỗi gia đình có thể có nhiều kho vật lý: kho gốc (code = đúng tên gia đình) và các
 * kho phụ do Admin tạo thêm dạng '{gia-đình}-{n}' (xem warehouses.service.ts, trước 2026-09-03
 * chỉ 'thanh-pham' được thiết kế đa-instance - nay mở rộng cho cả 3).
 */
export const WAREHOUSE_FAMILIES = ['phoi-son-han', 'vat-tu-tp', 'thanh-pham'] as const;
export type WarehouseFamily = (typeof WAREHOUSE_FAMILIES)[number];

/** Chặng kế tiếp trong chuỗi - chỉ dùng để biết "gia đình nào là hợp lệ tiếp theo", KHÔNG dùng để
 *  suy ra 1 kho đích cụ thể (từ 2026-09-03, người tạo phiếu chuyển tự chọn kho đích cụ thể trong
 *  gia đình đó, xem warehouse-transfers/transfer-routes.constant.ts). 'thanh-pham' cố ý không có
 *  entry vì là chặng cuối. */
export const FAMILY_ROUTES: Partial<Record<WarehouseFamily, WarehouseFamily>> = {
  'phoi-son-han': 'vat-tu-tp',
  'vat-tu-tp': 'thanh-pham',
};

/** code khớp đúng 1 gia đình nếu bằng chính tên gia đình, hoặc có prefix '{gia-đình}-'. */
export function warehouseFamilyOf(code: string | null | undefined): WarehouseFamily | null {
  if (!code) return null;
  return WAREHOUSE_FAMILIES.find((f) => code === f || code.startsWith(`${f}-`)) ?? null;
}

export function isFamilyScope(code: string | null | undefined, family: WarehouseFamily): boolean {
  return warehouseFamilyOf(code) === family;
}

/** Alias tương thích ngược - mọi call site cũ gọi isThanhPhamScope() tiếp tục chạy đúng không cần
 *  sửa (xem thanh-pham-scope.util.ts, nay chỉ còn là re-export mỏng từ file này). */
export function isThanhPhamScope(code: string | null | undefined): boolean {
  return isFamilyScope(code, 'thanh-pham');
}
