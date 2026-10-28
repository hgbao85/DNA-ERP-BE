-- "Mua VT còn lại" (Sếp chốt 2026-10-27): hạn chót vật tư thành phẩm về kho, đề xuất = Đóng gói − 7. Cột mới, nullable - không đụng dữ liệu cũ.
ALTER TABLE "production_invoice_items" ADD COLUMN     "finishedMaterialDeadline" TIMESTAMP(3);
