-- Xóa needsHan/needsSon khỏi piece_bom - field chết: FE chưa từng có UI để đặt giá trị này
-- (luôn gửi undefined -> BE tự default true), và không nơi nào trong hệ thống đọc lại giá trị
-- này để routing bỏ qua công đoạn Hàn/Sơn. 13 dòng dữ liệu hiện có đều là giá trị mặc định true,
-- không mang ý nghĩa nghiệp vụ thật.
ALTER TABLE "piece_bom" DROP COLUMN "needsHan";
ALTER TABLE "piece_bom" DROP COLUMN "needsSon";
