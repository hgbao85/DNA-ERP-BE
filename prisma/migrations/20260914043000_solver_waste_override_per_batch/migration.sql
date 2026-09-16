-- Thay enum SolverAutoApproveMode (thêm sáng nay, 2 migration ngay trước) bằng 2 thông số ĐỘC LẬP.
-- Lý do: enum đó là một thang leo tuyến tính (auto_scan = mode !== FIXED_ONLY) nên không diễn đạt
-- nổi ca "chỉ mua cây chuẩn 6m NHƯNG chấp nhận hao hụt vượt ngưỡng vì khách gấp" - cây đặt riêng
-- phải chờ NCC cán, cây chuẩn mua được ngay. Tách làm 2 trục thì nói được cả 4 tổ hợp.
--
-- Ngưỡng đặc cách để dạng SỐ (không phải cờ bật/tắt) vì lúc Sếp duyệt mới chỉ có CẬN DƯỚI của hao
-- hụt - cờ bật/tắt là ký séc khống, còn con số là cái trần: vượt trần thì vẫn chặn tự duyệt.
--
-- An toàn: 2 cột bị drop mới thêm CÙNG NGÀY, chỉ tồn tại trên DB dev, chưa lên production.
ALTER TABLE "production_invoices" DROP COLUMN "solverAutoApproveMode",
ADD COLUMN     "solverAllowCustomLength" BOOLEAN,
ADD COLUMN     "solverMaxWastePctOverride" DECIMAL(5,2),
ADD COLUMN     "solverOverrideReason" TEXT;

-- default true = ĐÚNG hành vi đã chạy từ 2026-08-26 (auto_scan luôn bật), không đổi ngầm hành vi
-- của các đợt cắt hiện có.
ALTER TABLE "system_config" DROP COLUMN "solverAutoApproveMode",
ADD COLUMN     "solverAllowCustomLength" BOOLEAN NOT NULL DEFAULT true;

DROP TYPE "SolverAutoApproveMode";
