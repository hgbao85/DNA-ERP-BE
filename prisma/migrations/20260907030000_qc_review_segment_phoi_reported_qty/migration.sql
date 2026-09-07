-- Thêm cột "phoiReportedQty" (nullable) vào qc_review_segments - Phôi tự khai số đoạn đã sửa xong
-- khi bấm "Bù đủ" (2026-09-07), THUẦN THAM KHẢO cho KCS xem trước khi tự đếm lại ở recheck().
-- Additive-only, không đụng dữ liệu cũ (mọi dòng hiện có mặc định NULL = chưa từng khai qty).
ALTER TABLE "qc_review_segments" ADD COLUMN "phoiReportedQty" INTEGER;
