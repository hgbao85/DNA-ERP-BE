-- C5 (danh sách lỗi 16/11): tổng hao hụt (mm) của phương án / dòng phương án cắt có thể tràn ở lệnh lớn chạy chế độ gấp
-- (Decimal(7,1) trần 999.999,9 mm cho 1 dòng). Nới lên Decimal(12,1). Tăng độ chính xác numeric không ghi lại bảng.
ALTER TABLE "cutting_proposals" ALTER COLUMN "totalWasteMm" SET DATA TYPE DECIMAL(12,1);
ALTER TABLE "cutting_proposal_lines" ALTER COLUMN "totalWasteMm" SET DATA TYPE DECIMAL(12,1);
