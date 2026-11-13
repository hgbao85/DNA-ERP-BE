-- 13/11/2026: lưu % hao hụt khi mua đã dùng lúc tính số cần mua của từng dòng (hiển thị đúng ở Lệnh mua vật tư).
ALTER TABLE "purchase_proposal_items" ADD COLUMN "appliedWastePct" DECIMAL(6,3);
