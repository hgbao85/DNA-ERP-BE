-- floor_reports.productionInvoiceId (2026-10-13, mục 22): ghi thẳng PI của lần báo - đợt bị đảo hết thì bị xoá,
-- FK cutBundleId/stepBatchId về NULL mà "Sản lượng của tôi" vẫn cần biết PI. Backfill từ đợt còn tồn tại.
-- AlterTable
ALTER TABLE "floor_reports" ADD COLUMN     "productionInvoiceId" BIGINT;

-- CreateIndex
CREATE INDEX "floor_reports_productionInvoiceId_idx" ON "floor_reports"("productionInvoiceId");

-- AddForeignKey
ALTER TABLE "floor_reports" ADD CONSTRAINT "floor_reports_productionInvoiceId_fkey" FOREIGN KEY ("productionInvoiceId") REFERENCES "production_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill lần báo đã có (chỉ những dòng còn trỏ được về đợt).
UPDATE "floor_reports" fr SET "productionInvoiceId" = si."productionInvoiceId"
  FROM "cut_bundles" cb JOIN "steel_issues" si ON si."id" = cb."steelIssueId"
  WHERE fr."cutBundleId" = cb."id" AND fr."productionInvoiceId" IS NULL;
UPDATE "floor_reports" fr SET "productionInvoiceId" = sb."productionInvoiceId"
  FROM "step_batches" sb
  WHERE fr."stepBatchId" = sb."id" AND fr."productionInvoiceId" IS NULL;
UPDATE "floor_reports" fr SET "productionInvoiceId" = pii."productionInvoiceId"
  FROM "production_batches" pb
  JOIN "production_orders" po ON po."id" = pb."productionOrderId"
  JOIN "production_invoice_items" pii ON pii."id" = po."productionInvoiceItemId"
  WHERE fr."productionBatchId" = pb."id" AND fr."productionInvoiceId" IS NULL;
-- Dòng đảo lấy PI của lần báo gốc.
UPDATE "floor_reports" r SET "productionInvoiceId" = o."productionInvoiceId"
  FROM "floor_reports" o
  WHERE r."reversalOfId" = o."id" AND r."productionInvoiceId" IS NULL;
