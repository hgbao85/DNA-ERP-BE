-- DropForeignKey
ALTER TABLE "cutting_proposals" DROP CONSTRAINT "cutting_proposals_productionOrderId_fkey";

-- AlterTable
ALTER TABLE "cutting_proposals" ADD COLUMN     "productionInvoiceId" BIGINT,
ALTER COLUMN "productionOrderId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "production_invoice_items" ADD COLUMN     "salesOrderId" BIGINT;

-- AlterTable
ALTER TABLE "production_invoices" ADD COLUMN     "isMerged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mergedAt" TIMESTAMP(3),
ADD COLUMN     "mergedById" TEXT;

-- CreateIndex
CREATE INDEX "cutting_proposals_productionInvoiceId_status_idx" ON "cutting_proposals"("productionInvoiceId", "status");

-- CreateIndex
CREATE INDEX "production_invoice_items_salesOrderId_idx" ON "production_invoice_items"("salesOrderId");

-- AddForeignKey
ALTER TABLE "production_invoices" ADD CONSTRAINT "production_invoices_mergedById_fkey" FOREIGN KEY ("mergedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_invoice_items" ADD CONSTRAINT "production_invoice_items_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_proposals" ADD CONSTRAINT "cutting_proposals_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_proposals" ADD CONSTRAINT "cutting_proposals_productionInvoiceId_fkey" FOREIGN KEY ("productionInvoiceId") REFERENCES "production_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill production_invoice_items.salesOrderId từ PI cha.
-- BẮT BUỘC chạy cùng migration này: tới trước bản này, PO của 1 SKU chỉ suy ngược được qua
-- productionInvoice.salesOrder (1 PI = 1 PO). Từ bản này PI có thể gộp nhiều PO nên đường suy
-- ngược đó không còn đúng - mọi SKU đã tồn tại phải được ghim PO gốc NGAY, nếu không màn
-- "Lệnh sản xuất mới" và phần gộp đợt cắt sẽ hiện PO rỗng cho toàn bộ dữ liệu cũ.
UPDATE "production_invoice_items" i
SET "salesOrderId" = pi."salesOrderId"
FROM "production_invoices" pi
WHERE pi."id" = i."productionInvoiceId"
  AND pi."salesOrderId" IS NOT NULL
  AND i."salesOrderId" IS NULL;
