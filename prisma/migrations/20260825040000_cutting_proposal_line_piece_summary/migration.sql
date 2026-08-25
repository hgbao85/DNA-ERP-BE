-- Tổng kết theo cỡ đoạn (demand/produced + tên mảnh) để in "TỔNG KẾT CẮT" giống MC Laser.
-- Thuần hiển thị, không FK nào cần tới -> JSONB đúng tiền lệ "lengthComparison" cùng bảng.
-- Dòng cũ để NULL, lấp bằng prisma/backfill-piece-summary.ts (không gọi lại solver).
ALTER TABLE "cutting_proposal_lines" ADD COLUMN "pieceSummary" JSONB;
