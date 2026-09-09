-- Deadline con Phôi/Hàn/Sơn lồng trong Khung cơ khí (FRAME), 2026-09-09 - theo yêu cầu người dùng.
-- Thuần THÊM (cột nullable + giá trị enum mới) - không đổi/xoá dữ liệu nào đang có, an toàn tuyệt
-- đối (rút kinh nghiệm từ sự cố migration 20260908010000 cùng phiên làm việc trước đó).

-- ProductionInvoiceItemStage.startDate - CHỈ có ý nghĩa cho FRAME (giờ là khoảng, không chỉ 1 mốc)
-- và 3 mốc con FRAME_PHOI/FRAME_HAN/FRAME_SON bên dưới. NULL cho WEAVING/TRANSFER_CHECK/PACKAGING.
ALTER TABLE "production_invoice_item_stages" ADD COLUMN "startDate" TIMESTAMP(3);

-- 3 giá trị enum mới - mốc kế hoạch con lồng trong FRAME. Mỗi ALTER TYPE ADD VALUE là 1 câu lệnh
-- riêng (Postgres không cho gộp nhiều giá trị trong 1 câu).
ALTER TYPE "ProdItemStageType" ADD VALUE 'FRAME_PHOI';
ALTER TYPE "ProdItemStageType" ADD VALUE 'FRAME_HAN';
ALTER TYPE "ProdItemStageType" ADD VALUE 'FRAME_SON';
