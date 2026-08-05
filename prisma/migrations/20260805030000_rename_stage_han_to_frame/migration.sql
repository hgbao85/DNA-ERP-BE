-- Đổi tên enum value HAN -> FRAME ("Khung cơ khí" là mốc hoàn tất Phôi->Hàn->Sơn, không phải
-- riêng công đoạn Hàn). RENAME VALUE giữ nguyên dữ liệu hàng đã dùng giá trị cũ (khác cách
-- drop+add mặc định của `prisma migrate dev`, vốn chặn khi còn hàng dùng giá trị bị xoá).
ALTER TYPE "ProdItemStageType" RENAME VALUE 'HAN' TO 'FRAME';
