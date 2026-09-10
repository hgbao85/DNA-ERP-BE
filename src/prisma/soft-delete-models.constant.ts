/**
 * Models that carry a `deletedAt` column and are soft-deleted instead of hard-deleted
 * (see extensions/soft-delete.extension.ts). Shared with the audit-log extension so it
 * can skip its `delete` hook for these models - their deletion always resolves to an
 * `update` under the hood, which is where it gets logged instead. Without this, both
 * hooks fire for the same logical delete and produce two audit rows for one action.
 *
 * 10/09: `SalesOrder` bỏ khỏi danh sách này theo yêu cầu người dùng - xoá PO giờ phải xoá thật
 * (hard-delete), không để lại bản ghi ẩn + dữ liệu sản xuất mồ côi không còn PO đứng sau. Vẫn giữ
 * đủ dấu vết lịch sử: `SalesOrder` đã có sẵn trong AUDITED_MODELS (audit-log.extension.ts), hook
 * `delete` ở đó tự tính `shouldAudit = AUDITED_MODELS.has(model) && !SOFT_DELETE_MODELS.has(model)`
 * - bỏ khỏi set này là ĐỦ để hook tự chụp snapshot trước khi xoá + ghi 1 dòng AuditAction.DELETE
 * thật vào audit_logs, không cần sửa gì thêm ở đó. Xem SalesOrdersService.remove() cho phần cascade
 * xoá/gỡ liên kết các bảng con trước khi xoá thật.
 */
export const SOFT_DELETE_MODELS = new Set(['User', 'Role']);
