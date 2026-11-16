/**
 * Lịch sử duyệt SKU (16/11/2026) - "ai làm bước nào, lúc nào" trên 1 PlanForm: nộp định mức, KHSX
 * duyệt/từ chối từng nhánh, gửi Sếp, Sếp duyệt/từ chối, Admin ghi đè định mức đã duyệt.
 *
 * Trước đây FE tự ghi các bước này vào localStorage (AuditLogContext) - mỗi trình duyệt chỉ thấy thao
 * tác của chính nó. Không dùng được audit tự động của bảng PlanForm vì (1) phần lớn dòng PlanForm là
 * lưu nháp tự động, (2) quyết định duyệt từng nhánh nằm ở bảng con PlanFormManhReview/DetailReview
 * (không auto-audit), (3) GET /audit-logs chỉ ADMIN/BOSS đọc được còn KHSX/Spec cũng cần xem.
 *
 * Ghi vào chính bảng audit_logs (tableName = SKU_HISTORY_TABLE, recordId = PlanForm.id, newValue =
 * { event, note }) - không cần migration, vẫn hiện ở trang Admin "Nhật ký hoạt động". Đọc qua
 * GET /skus/:id/history (quyền SKU:VIEW).
 */
export const SKU_HISTORY_TABLE = 'SkuHistory';

/** Khớp key AUDIT_ACTIONS phía FE (src/context/AuditLogContext.tsx) - đổi ở đây phải đổi cả FE. */
export type SkuHistoryEvent =
  | 'sku.created'
  | 'sku.updated'
  | 'sku.manh_submitted'
  | 'sku.detail_submitted'
  | 'sku.parts_section_approved'
  | 'sku.parts_section_rejected'
  | 'sku.detail_section_approved'
  | 'sku.detail_section_rejected'
  | 'sku.parts_approved'
  | 'sku.detail_approved'
  | 'sku.sent_for_boss_approval'
  | 'sku.boss_approved'
  | 'sku.boss_rejected'
  | 'sku.admin_override';

export interface SkuHistoryEntryDto {
  id: string;
  event: string;
  note: string | null;
  actorId: string | null;
  actorName: string;
  at: string;
}
