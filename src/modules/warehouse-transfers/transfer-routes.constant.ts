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
  // Anh Nhân 09/11/2026: mảnh KHÔNG đan chuyển thẳng từ kho Sơn (kho giữ mảnh) sang kho Thành phẩm của lệnh; mảnh cần đan xuất
  // đan thẳng từ kho Sơn (phiếu XK) - không còn chặng Phôi-Sơn-Hàn -> Phụ kiện -> Thành phẩm cho mảnh.
  'phoi-son-han': 'thanh-pham',
};

/**
 * Đợt 7 (user chốt 09/11): mảnh Phước An hàn xong chuyển sang kho Sơn Phú An bằng phiếu chuyển kho - phiếu NỘI BỘ trong nhóm
 * Phôi-Hàn-Sơn. Mọi chỗ đếm "mảnh đã chuyển / đã nhận" để đi đan, chuyền kiểm, đóng gói chỉ được tính phiếu chuyển RA KHỎI nhóm
 * này (lọc Prisma dưới đây), nếu không mảnh Phước An bị đếm 2 lần.
 */
export const PIECE_TRANSFER_LEAVES_FRAME = {
  toWarehouse: { NOT: { code: { startsWith: 'phoi-son-han' } } },
} as const;
/** Phiếu chuyển mảnh vào kho Sơn (chặng Hàn Phước An -> Sơn Phú An). */
export const PIECE_TRANSFER_TO_PAINT = { toWarehouse: { kind: 'SON' as const } } as const;

/** Mã xưởng trong số phiếu (anh/IT chốt 09/11/2026): Phú An = PA, Phước An = PHA. */
const WORKSHOP_SHORT: Record<string, string> = { PHU_AN: 'PA', PHUOC_AN: 'PHA' };
const KIND_SHORT: Record<string, string> = { PHOI: 'PHOI', HAN: 'HAN', SON: 'SON', PHU_KIEN: 'PK' };

/**
 * Mã kho giao trong số phiếu chuyển kho CK-<mã>-NNN (v8 4.8, ví dụ CK-PA.PHOI-001): PA.PHOI, PA.HAN, PA.SON, PA.PK,
 * PA.TP1/TP2/TP3 (số lấy theo tên kho), PHA.PHOI, PHA.HAN. Kho chưa phân loại dùng mã kho viết hoa.
 */
export function transferWarehouseShortCode(w: {
  code: string;
  name: string;
  kind: string | null;
  workshopCode: string | null;
}): string {
  const ws = (w.workshopCode && WORKSHOP_SHORT[w.workshopCode]) || 'PA';
  if (w.kind === 'THANH_PHAM') return `PA.TP${/(\d+)/.exec(w.name)?.[1] ?? '1'}`;
  if (w.kind && KIND_SHORT[w.kind]) {
    return w.kind === 'PHU_KIEN' ? `PA.${KIND_SHORT[w.kind]}` : `${ws}.${KIND_SHORT[w.kind]}`;
  }
  return w.code.toUpperCase();
}

export function isValidTransferRoute(fromCode: string, toCode: string): boolean {
  const fromFamily = warehouseFamilyOf(fromCode);
  const toFamily = warehouseFamilyOf(toCode);
  if (!fromFamily || !toFamily) return false;
  return FAMILY_ROUTES[fromFamily] === toFamily;
}
