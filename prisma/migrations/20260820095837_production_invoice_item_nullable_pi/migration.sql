-- ProductionInvoiceItem.productionInvoiceId trở thành nullable: item được tạo ngay lúc Sales lưu
-- PO nhưng không còn tự động bọc trong 1 ProductionInvoice - NULL nghĩa là "chưa được KHSX gom"
-- (xem GomDotCatPage.tsx "Xác nhận gộp"/"Tiến hành cắt riêng"). An toàn với dữ liệu hiện có: mọi
-- dòng hiện tại đều đã có productionInvoiceId thật.
ALTER TABLE "production_invoice_items" ALTER COLUMN "productionInvoiceId" DROP NOT NULL;
