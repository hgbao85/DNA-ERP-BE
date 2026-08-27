-- L5 (2026-08-26): pool giữ chỗ theo PI thay vì theo 1 cuttingProposalId cố định.
-- Thêm enum value PRODUCTION_INVOICE (fallback create của creditPool khi pool rỗng).
ALTER TYPE "StockReservationRefType" ADD VALUE 'PRODUCTION_INVOICE';

-- Thêm cột productionInvoiceId - KHÔNG đổi refId hiện có (giữ nguyên cuttingProposalId gốc để
-- releaseByRef()/idempotencyKey không đổi hành vi).
ALTER TABLE "stock_reservations" ADD COLUMN "productionInvoiceId" BIGINT;

ALTER TABLE "stock_reservations"
  ADD CONSTRAINT "stock_reservations_productionInvoiceId_fkey"
  FOREIGN KEY ("productionInvoiceId") REFERENCES "production_invoices"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "stock_reservations_productionInvoiceId_materialId_status_idx"
  ON "stock_reservations" ("productionInvoiceId", "materialId", "status");
