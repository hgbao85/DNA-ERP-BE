import { warehouseFamilyOf } from '../../common/utils/warehouse-family.util';

/**
 * Chuỗi chuyển kho MỘT CHIỀU theo GIA ĐÌNH: value = gia đình ĐÍCH DUY NHẤT được phép nhận hàng từ
 * gia đình key. Mirror chính xác FAMILY_ROUTES ở FE (d:\DNA-ERP\src\types\warehouse-transfer.ts).
 * 'thanh-pham' cố ý không có entry vì là kho cuối chuỗi - không được chuyển tiếp đi đâu.
 *
 * 2026-09-03: trước đây map theo ĐÚNG 1 code cố định (`{'phoi-son-han': 'vat-tu-tp', ...}`) - kho
 * phụ mới tạo (thanh-pham-2, rồi giờ cả phoi-son-han-2/vat-tu-tp-2) không có entry nên
 * isValidTransferRoute() luôn false, không tạo được phiếu chuyển đi/đến kho phụ. Đổi sang so khớp
 * theo GIA ĐÌNH (warehouseFamilyOf) - người tạo phiếu tự CHỌN kho đích cụ thể trong gia đình hợp lệ
 * (quyết định nghiệp vụ 2026-09-03: không tự động theo cặp cố định), route chỉ còn xác nhận "gia
 * đình đích có hợp lệ tiếp theo gia đình nguồn không" - không suy ra 1 kho đích duy nhất nữa.
 */
export const FAMILY_ROUTES: Record<string, string> = {
  'phoi-son-han': 'vat-tu-tp',
  'vat-tu-tp': 'thanh-pham',
};

export function isValidTransferRoute(fromCode: string, toCode: string): boolean {
  const fromFamily = warehouseFamilyOf(fromCode);
  const toFamily = warehouseFamilyOf(toCode);
  if (!fromFamily || !toFamily) return false;
  return FAMILY_ROUTES[fromFamily] === toFamily;
}
