/**
 * 6 khoá kỹ thuật cố định seed sẵn cho MaterialGroup.systemKey (xem prisma/seed.ts và
 * schema.prisma MaterialGroup) - thay cho enum MaterialKind cũ đã bị xoá. Mọi logic nghiệp
 * vụ (segment-specs, bom-revisions, skus - 4 trang Spec Sắt/Dây-Đinh-Sơn/Phụ kiện/
 * Bao bì) match theo cột `systemKey` này, KHÔNG BAO GIỜ theo `MaterialGroup.name` - admin
 * đổi tên nhóm trong Admin > Nhóm vật tư thoải mái mà không làm hỏng lọc.
 *
 * Nhóm do admin tự tạo thêm có systemKey = null, vô hình với mọi logic Spec.
 *
 * QUAN TRỌNG: frontend định nghĩa lại y hệt 6 giá trị này ở
 * d:\DNA-ERP\src\constants\materialGroupSystemKeys.ts (2 repo tách rời, không import chung
 * được) - sửa ở đây thì phải sửa bên đó theo.
 */
export const MATERIAL_GROUP_SYSTEM_KEYS = {
  STEEL_BAR: 'STEEL_BAR',
  WIRE: 'WIRE',
  NAIL: 'NAIL',
  PAINT: 'PAINT',
  ACCESSORY: 'ACCESSORY',
  PACKAGING: 'PACKAGING',
} as const;

export type MaterialGroupSystemKey =
  (typeof MATERIAL_GROUP_SYSTEM_KEYS)[keyof typeof MATERIAL_GROUP_SYSTEM_KEYS];
