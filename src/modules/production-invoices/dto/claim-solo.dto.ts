import { SolverOverrideDto } from './solver-override.dto';

/**
 * "Tiến hành cắt riêng" (màn "Tối ưu cắt sắt", ProductionInvoicesService.claimSolo()) - body
 * optional, chỉ mang theo thông số cắt KHSX đề nghị cho SKU này. Không thêm field riêng nào: mọi
 * thứ đều nằm ở SolverOverrideDto, dùng chung với đường gộp để luật kiểm không lệch giữa 2 nút.
 */
export class ClaimSoloDto extends SolverOverrideDto {}
