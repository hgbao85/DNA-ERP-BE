-- "Số mua" người mua chốt, chỉ được tăng so với "cần mua" (buyQty) - YC7 mục 7.2, 2026-11-04.
-- Chỉ THÊM 1 cột nullable, không đụng dữ liệu cũ.
ALTER TABLE "purchase_proposal_items" ADD COLUMN "orderQty" DECIMAL(14,4);
