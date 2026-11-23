-- Phiếu đề xuất (23/11/2026): lưu nhu cầu theo định mức của dòng mua lúc tính, để in cột "Số lượng theo Định mức".
-- Cột thêm mới, cho phép null (dòng cũ) - không ghi lại bảng.
ALTER TABLE "purchase_proposal_items" ADD COLUMN "requiredQty" DECIMAL(14,4);
