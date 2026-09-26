-- Sửa data lỗi: 21 thông báo cắt sắt cũ (migrate ở 20260925000000) đều bị gắn chung
-- category=RESULT/severity=INFO/type=NULL vì lúc đó không phân biệt được biến thể nào từ dữ liệu
-- lịch sử (xem comment migration đó). Thực ra 4 biến thể tạo ra 4 MẪU TIÊU ĐỀ cố định, khác biệt rõ
-- (NOTIFICATION_TYPES ở notification-types.ts) - đủ để suy ngược lại type/category/severity ĐÚNG
-- cho từng dòng bằng cách khớp tiêu đề. Phát hiện khi người dùng xem lại dữ liệu thật, thấy tiêu đề
-- "CẦN DUYỆT TAY"/"thất bại" nhưng category vẫn là RESULT (không phải ACTION_REQUIRED/ALERT).
--
-- Chỉ sửa type/category/severity/entityType - KHÔNG suy ra lại entityId (proposalId gốc không được
-- lưu trong dữ liệu cũ, không có cách khôi phục) và KHÔNG fan-out thêm người nhận mới (vd thêm BOSS
-- cho các dòng giờ thành CRITICAL) - đó là hành vi của emit() cho sự kiện MỚI, áp ngược cho lịch sử
-- sẽ khiến Sếp bỗng nhiên thấy hàng loạt "cảnh báo mới" cho việc đã xảy ra từ lâu, gây nhiễu hơn là
-- có ích. Chỉ cập nhật những dòng còn "type IS NULL" (dữ liệu cũ) - an toàn để chạy lại nhiều lần.

-- "...đã tính xong và tự động duyệt" -> CUTTING_PROPOSAL_AUTO_APPROVED (RESULT/SUCCESS)
UPDATE "notifications" SET
  "type" = 'CUTTING_PROPOSAL_AUTO_APPROVED',
  "category" = 'RESULT',
  "severity" = 'SUCCESS',
  "entityType" = 'CUTTING_PROPOSAL'
WHERE "type" IS NULL AND "title" LIKE '%và tự động duyệt';

-- "...đã tính xong - CẦN DUYỆT TAY" -> CUTTING_PROPOSAL_NEEDS_MANUAL_APPROVAL (ACTION_REQUIRED/WARNING)
UPDATE "notifications" SET
  "type" = 'CUTTING_PROPOSAL_NEEDS_MANUAL_APPROVAL',
  "category" = 'ACTION_REQUIRED',
  "severity" = 'WARNING',
  "entityType" = 'CUTTING_PROPOSAL'
WHERE "type" IS NULL AND "title" LIKE '%CẦN DUYỆT TAY%';

-- "...đã tính xong nhưng tự động duyệt thất bại" -> CUTTING_PROPOSAL_AUTO_APPROVE_FAILED (ALERT/CRITICAL)
-- Khớp TRƯỚC pattern "thất bại" chung ở dưới vì cụ thể hơn (không có dòng nào khớp ở dữ liệu hiện
-- tại, giữ lại cho đúng/đủ nếu môi trường khác có).
UPDATE "notifications" SET
  "type" = 'CUTTING_PROPOSAL_AUTO_APPROVE_FAILED',
  "category" = 'ALERT',
  "severity" = 'CRITICAL',
  "entityType" = 'CUTTING_PROPOSAL'
WHERE "type" IS NULL AND "title" LIKE '%nhưng tự động duyệt thất bại';

-- "Tính đề xuất cắt sắt thất bại..." -> CUTTING_PROPOSAL_CALCULATION_FAILED (ALERT/CRITICAL)
UPDATE "notifications" SET
  "type" = 'CUTTING_PROPOSAL_CALCULATION_FAILED',
  "category" = 'ALERT',
  "severity" = 'CRITICAL',
  "entityType" = 'CUTTING_PROPOSAL'
WHERE "type" IS NULL AND "title" LIKE 'Tính đề xuất cắt sắt thất bại%';
