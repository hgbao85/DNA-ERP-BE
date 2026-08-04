-- DropForeignKey
ALTER TABLE "bom_accessory_items" DROP CONSTRAINT "bom_accessory_items_bomRevisionId_fkey";

-- DropForeignKey
ALTER TABLE "bom_part" DROP CONSTRAINT "bom_part_bomRevisionId_fkey";

-- DropForeignKey
ALTER TABLE "bom_piece" DROP CONSTRAINT "bom_piece_bomRevisionId_fkey";

-- DropForeignKey
ALTER TABLE "consumable_bom" DROP CONSTRAINT "consumable_bom_bomRevisionId_fkey";

-- DropForeignKey
ALTER TABLE "material_suppliers" DROP CONSTRAINT "material_suppliers_materialId_fkey";

-- DropForeignKey
ALTER TABLE "material_suppliers" DROP CONSTRAINT "material_suppliers_supplierId_fkey";

-- DropForeignKey
ALTER TABLE "packaging_bom" DROP CONSTRAINT "packaging_bom_productVariantId_fkey";

-- DropForeignKey
ALTER TABLE "part_bom" DROP CONSTRAINT "part_bom_bomRevisionId_mfgProductId_fkey";

-- DropForeignKey
ALTER TABLE "piece_bom" DROP CONSTRAINT "piece_bom_bomRevisionId_mfgProductId_fkey";

-- DropForeignKey
ALTER TABLE "plan_form_detail_reviews" DROP CONSTRAINT "plan_form_detail_reviews_planFormId_fkey";

-- DropForeignKey
ALTER TABLE "plan_form_manh_reviews" DROP CONSTRAINT "plan_form_manh_reviews_planFormId_fkey";

-- DropForeignKey
ALTER TABLE "plan_forms" DROP CONSTRAINT "plan_forms_salesOrderId_fkey";

-- DropForeignKey
ALTER TABLE "production_invoice_items" DROP CONSTRAINT "production_invoice_items_productionInvoiceId_fkey";

-- DropForeignKey
ALTER TABLE "sales_order_items" DROP CONSTRAINT "sales_order_items_salesOrderId_fkey";

-- AlterTable
ALTER TABLE "plan_forms" ADD COLUMN     "customerName" TEXT,
ALTER COLUMN "salesOrderId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "material_suppliers" ADD CONSTRAINT "material_suppliers_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_suppliers" ADD CONSTRAINT "material_suppliers_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_piece" ADD CONSTRAINT "bom_piece_bomRevisionId_fkey" FOREIGN KEY ("bomRevisionId") REFERENCES "bom_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_part" ADD CONSTRAINT "bom_part_bomRevisionId_fkey" FOREIGN KEY ("bomRevisionId") REFERENCES "bom_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_bom" ADD CONSTRAINT "piece_bom_bomRevisionId_mfgProductId_fkey" FOREIGN KEY ("bomRevisionId", "mfgProductId") REFERENCES "bom_revision"("id", "mfgProductId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_bom" ADD CONSTRAINT "part_bom_bomRevisionId_mfgProductId_fkey" FOREIGN KEY ("bomRevisionId", "mfgProductId") REFERENCES "bom_revision"("id", "mfgProductId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumable_bom" ADD CONSTRAINT "consumable_bom_bomRevisionId_fkey" FOREIGN KEY ("bomRevisionId") REFERENCES "bom_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_accessory_items" ADD CONSTRAINT "bom_accessory_items_bomRevisionId_fkey" FOREIGN KEY ("bomRevisionId") REFERENCES "bom_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packaging_bom" ADD CONSTRAINT "packaging_bom_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_forms" ADD CONSTRAINT "plan_forms_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_form_manh_reviews" ADD CONSTRAINT "plan_form_manh_reviews_planFormId_fkey" FOREIGN KEY ("planFormId") REFERENCES "plan_forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_form_detail_reviews" ADD CONSTRAINT "plan_form_detail_reviews_planFormId_fkey" FOREIGN KEY ("planFormId") REFERENCES "plan_forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_invoice_items" ADD CONSTRAINT "production_invoice_items_productionInvoiceId_fkey" FOREIGN KEY ("productionInvoiceId") REFERENCES "production_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
