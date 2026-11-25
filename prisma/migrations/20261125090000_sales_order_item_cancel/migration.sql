-- Huỷ lệnh câu 2 (anh Nhân 24/11/2026): Sales huỷ 1 dòng đơn bán khi khách huỷ hẳn. Chỉ thêm cột, không đổi dữ liệu cũ.

-- AlterTable
ALTER TABLE "sales_order_items" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT;
