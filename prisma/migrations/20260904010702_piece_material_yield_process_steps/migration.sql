-- Công đoạn phôi chi tiết (cắt/uốn/dập/đục lỗ/tán/tóp đầu/xẻ) cho vật tư thành phẩm - cùng ý
-- nghĩa với PieceBom.processSteps (Sắt) nhưng lưu riêng trên bảng này vì PieceMaterialYield
-- không có SegmentSpec để gắn vào. Default '{}' giữ nguyên hành vi mọi dòng đã có (chưa từng
-- khai công đoạn = mảng rỗng, không phải NULL).
ALTER TABLE "piece_material_yield" ADD COLUMN "processSteps" "ProcessStep"[] NOT NULL DEFAULT '{}';
