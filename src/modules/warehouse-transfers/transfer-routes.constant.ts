/**
 * Chuỗi chuyển kho MỘT CHIỀU: value = kho ĐÍCH DUY NHẤT được phép nhận hàng từ key. Mirror
 * chính xác TRANSFER_ROUTES ở FE mock (d:\DNA-ERP\src\types\warehouse-transfer.ts) - theo
 * đúng chỉ dẫn của roadmap, không đoán thêm route nào ngoài route đã quan sát được trong mock.
 * 'thanh-pham' cố ý không có entry vì là kho cuối chuỗi - không được chuyển tiếp đi đâu.
 */
export const TRANSFER_ROUTES: Record<string, string> = {
  'phoi-son-han': 'vat-tu-tp',
  'vat-tu-tp': 'thanh-pham',
};

export function isValidTransferRoute(fromCode: string, toCode: string): boolean {
  return TRANSFER_ROUTES[fromCode] === toCode;
}
