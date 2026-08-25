-- CutBundle: ghi đủ 2 vế cân bằng vật chất của 1 đợt cắt (2026-08-22, làm lại lần 2).
--
-- Phương trình (kiểm chứng khớp thực tế trên số liệu thật của PI-2026-046 lần build trước):
--   barCount × barLengthMm = barCount × trimStartMm + Σ(qty × cutLengthMm) + Σqty × bladeWidthMm
--                             + mauNguyenMm + scrapMm
-- scrapMm là phần dư của phép trừ, SERVICE TỰ TÍNH - không bắt Phôi gõ (không ai cân được đống
-- đầu mẩu). mauNguyenMm là mẩu sắt còn nguyên từ cây cắt dở - nhập lại kho, KHÔNG phải phế liệu.
ALTER TABLE "cut_bundles" ADD COLUMN "mauNguyenMm" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "cut_bundles" ADD COLUMN "scrapMm" INTEGER NOT NULL DEFAULT 0;

-- wastePerBarMm là con số của PATTERN (kế hoạch solver, gồm cả tề đầu) - không phải số đo thực tế
-- của đợt cắt, giữ lại chỉ gây nhầm với scrapMm. Bảng đã rỗng (xoá dòng test trước khi chạy
-- migration này), không mất dữ liệu thật nào.
ALTER TABLE "cut_bundles" DROP COLUMN "wastePerBarMm";
