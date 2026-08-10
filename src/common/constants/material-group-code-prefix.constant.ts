import {
  MATERIAL_GROUP_SYSTEM_KEYS,
  MaterialGroupSystemKey,
} from './material-group-system-keys.constant';

/**
 * Tiền tố mã vật tư tự sinh theo nhóm khi tạo vật tư mà không nhập `code` (xem
 * MaterialsService.generateMaterialCode). Nhóm admin tự tạo (systemKey null) không có tiền tố
 * cố định ở đây - service tự suy tiền tố từ tên nhóm; chưa chọn nhóm nào thì dùng
 * MATERIAL_CODE_FALLBACK_PREFIX.
 */
export const MATERIAL_GROUP_CODE_PREFIX: Record<MaterialGroupSystemKey, string> = {
  [MATERIAL_GROUP_SYSTEM_KEYS.STEEL_BAR]: 'SAT',
  [MATERIAL_GROUP_SYSTEM_KEYS.WIRE]: 'DAY',
  [MATERIAL_GROUP_SYSTEM_KEYS.NAIL]: 'DINH',
  [MATERIAL_GROUP_SYSTEM_KEYS.RIVET]: 'TR',
  [MATERIAL_GROUP_SYSTEM_KEYS.PLASTIC_BUTTON]: 'NN',
  [MATERIAL_GROUP_SYSTEM_KEYS.OTHER]: 'VTK',
};

export const MATERIAL_CODE_FALLBACK_PREFIX = 'VT';
