-- Cờ "dòng Nút nhựa này đi kèm mảnh khi xuất đan" (checkbox riêng từng dòng ở SpecSteelPage.tsx,
-- chỉ áp dụng cho nhóm PLASTIC_BUTTON - các nhóm khác luôn giữ mặc định false).
ALTER TABLE "piece_material_item" ADD COLUMN "includeInWeaving" BOOLEAN NOT NULL DEFAULT false;
