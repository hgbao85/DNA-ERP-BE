-- Bằng chứng kèm lời xin ngưỡng hao hụt đặc cách, chụp lại lúc KHSX bấm gộp/cắt riêng:
--   { materialCode, estimatedWastePct, normalThresholdPct }
--
-- Sếp duyệt lệnh sản xuất TRƯỚC khi solver chạy, nên lúc duyệt chỉ có ước tính chứ chưa có số
-- thật. Không lưu lại thì callout duyệt chỉ nói được "KHSX xin 5%" mà không nói được "vì loại sắt
-- nào, đang ước tính bao nhiêu" - tức Sếp không có căn cứ để thấy con số xin là hợp lý hay thừa.
--
-- Thuần cộng thêm, nullable, không đụng dòng nào đang có.
ALTER TABLE "production_invoices" ADD COLUMN "solverOverrideEvidence" JSONB;
