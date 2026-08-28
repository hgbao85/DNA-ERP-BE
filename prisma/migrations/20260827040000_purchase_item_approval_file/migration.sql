-- "Sếp duyệt ngoài hệ thống" (2026-08-27): bỏ báo giá nhiều NCC + màn So sánh giá của Sếp.
-- Việc so sánh giá và phê duyệt giờ diễn ra trên phiếu Excel in ra, Sếp ký tay. Cột này lưu file
-- đã ký (Cloudinary secure_url) - bằng chứng DUY NHẤT trong hệ thống cho việc "đã được duyệt mua",
-- Kho chỉ nhận hàng cho dòng đã có nó.
--
-- Nullable, KHÔNG backfill: dòng cũ (duyệt qua màn Sếp trước 2026-08-27) để NULL là đúng - chúng
-- được duyệt bằng cơ chế khác, không có file nào để gán vào.
ALTER TABLE "purchase_proposal_items" ADD COLUMN "approvalFileUrl" TEXT;
