-- Thêm giá trị OPEN vào ProductionBatchStatus (2026-09-08) - CHỈ dùng cho ChotPanel VTTP (mảnh
-- KHÔNG khai processSteps): "Lưu đợt" tích luỹ vào 1 dòng OPEN, "Gửi KCS" mới chuyển AWAITING_QC.
-- Thuần THÊM giá trị enum (ALTER TYPE ... ADD VALUE) - không đổi/xoá dữ liệu, không có dòng nào bị
-- ảnh hưởng (an toàn tuyệt đối, khác hẳn bài học rút ra từ sự cố migration
-- 20260908010000_step_bundle_pi_wide_and_remove_bu_du cùng ngày).
ALTER TYPE "ProductionBatchStatus" ADD VALUE 'OPEN';
