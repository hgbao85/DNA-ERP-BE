-- Luồng "Solve trước → tạo PI" (2026-09-30): lượt tính cắt sắt chạy TRƯỚC khi có PI/PO.
-- Thuần cộng thêm: 1 cột nullable + 1 bảng mới, không đụng dữ liệu hiện có.

-- AlterTable
ALTER TABLE "cutting_proposals" ADD COLUMN     "solverOptions" JSONB;

-- CreateTable
CREATE TABLE "cutting_proposal_items" (
    "id" BIGSERIAL NOT NULL,
    "cuttingProposalId" BIGINT NOT NULL,
    "productionInvoiceItemId" BIGINT NOT NULL,
    "mfgProductId" BIGINT NOT NULL,
    "bomRevisionId" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "cutting_proposal_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cutting_proposal_items_productionInvoiceItemId_idx" ON "cutting_proposal_items"("productionInvoiceItemId");

-- CreateIndex
CREATE UNIQUE INDEX "cutting_proposal_items_cuttingProposalId_productionInvoiceI_key" ON "cutting_proposal_items"("cuttingProposalId", "productionInvoiceItemId");

-- AddForeignKey
ALTER TABLE "cutting_proposal_items" ADD CONSTRAINT "cutting_proposal_items_cuttingProposalId_fkey" FOREIGN KEY ("cuttingProposalId") REFERENCES "cutting_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_proposal_items" ADD CONSTRAINT "cutting_proposal_items_productionInvoiceItemId_fkey" FOREIGN KEY ("productionInvoiceItemId") REFERENCES "production_invoice_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
