-- Phần A – Đợt 3 (YC10, 2026-11-04): 2 mốc NGÀY BẮT ĐẦU - M2 bắt đầu Phôi, M4 bắt đầu Đóng gói. Các mốc cũ giữ nghĩa "ngày phải
-- xong". Migration RIÊNG chỉ thêm giá trị enum: Postgres không cho dùng giá trị enum vừa ADD VALUE trong cùng transaction.
ALTER TYPE "ProdItemStageType" ADD VALUE IF NOT EXISTS 'PHOI_START';
ALTER TYPE "ProdItemStageType" ADD VALUE IF NOT EXISTS 'PACKAGING_START';
