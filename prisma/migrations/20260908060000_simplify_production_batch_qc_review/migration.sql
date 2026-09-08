-- Người dùng (2026-09-08, sau khi hỏi "sao duyệt KCS VTTP không giống Phôi") - đồng bộ bước duyệt
-- CUỐI CÙNG "Chốt & gửi KCS" (ProductionBatch, dùng chung Hàn/Sơn/VTTP) theo ĐÚNG pattern đã áp
-- dụng khắp nơi khác trong hệ thống: bỏ hẳn phân loại "Sửa được/Phế" (scrapQty) + cơ chế
-- "Bù đủ -> KCS duyệt lại" (resolvedQty/phoiReportedAt/phoiReportedQty) - "Lỗi" (failedQty) giờ là
-- số lịch sử duy nhất, Bù đủ chỉ tạo 1 ProductionBatch MỚI gửi duyệt lại bình thường.
--
-- ReplenishRequest ("cấp bù khi phế") chỉ được tạo từ scrapQty > 0 ở reviewProductionBatch() -
-- xác nhận qua code (Explore agent) đây là nơi DUY NHẤT tạo bảng này, và fulfillReplenishRequest()
-- vốn đã CHẶN CỨNG mọi request sinh từ nhánh Hàn/Sơn/VTTP (chỉ hỗ trợ nhánh Phôi, chưa từng dùng
-- tới - xem comment cũ "chưa có quyết định nghiệp vụ") - tức TOÀN BỘ request từng tạo ra đều
-- KHÔNG THỂ fulfill được, chỉ reject. Bỏ scrapQty kéo theo bỏ hẳn tính năng này (dead code, không
-- mất chức năng thật nào đang chạy).
--
-- Dev DB có đúng 1 dòng QcReview test (Chân Nhôm/TEST-BAN-A) dùng scrapQty/resolvedQty/
-- phoiReportedAt + 2 dòng ReplenishRequest (đều OPEN, không fulfill được) - đã xác nhận là dữ liệu
-- test, chấp nhận mất khi ALTER thẳng, không backfill.

-- qc_reviews: bỏ scrapQty/resolvedQty/phoiReportedAt/phoiReportedQty - failedQty là số lịch sử duy
-- nhất còn lại, đúng nghĩa như mọi nhánh khác (steelIssueId/cutBundleId/stepBundleId/
-- pieceStepBundleId) đã quy về từ trước.
ALTER TABLE "qc_reviews" DROP COLUMN "scrapQty";
ALTER TABLE "qc_reviews" DROP COLUMN "resolvedQty";
ALTER TABLE "qc_reviews" DROP COLUMN "phoiReportedAt";
ALTER TABLE "qc_reviews" DROP COLUMN "phoiReportedQty";

-- replenish_requests: xoá hẳn bảng + enum trạng thái - không còn nơi nào tạo dòng mới (xem giải
-- thích trên), giữ lại là dead code treo vô ích.
DROP TABLE "replenish_requests";
DROP TYPE "ReplenishRequestStatus";
