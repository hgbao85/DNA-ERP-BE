-- CutPatternSegment.countPerBar -> qty (2026-08-22, làm lại lần 2 sau rollback 08-21).
--
-- Phôi giờ khai THẲNG tổng số đoạn thực cắt được theo từng cỡ (mỗi cây trong 1 đợt có thể cắt
-- khác nhau - cắt hỏng, cây cong, dừng giữa chừng), không còn chọn 1 kiểu cắt đã duyệt rồi để FE
-- bung ra danh sách đoạn như cũ. "Trên mỗi cây" không còn ý nghĩa khi số liệu là đếm tay.
--
-- An toàn: bảng đang RỖNG (xác nhận lại trước khi viết migration này, cùng như lần trước).
ALTER TABLE "cut_pattern_segments" RENAME COLUMN "countPerBar" TO "qty";
