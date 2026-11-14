-- Bảng "Chia máy cắt" của QLSX xưởng (13/11/2026, đợt B1 - quy tắc chia sắt 07/11, Sếp chốt 13/11 câu 8).
-- Chỉ là kế hoạch cho tổ Phôi: không đổi luồng quét QR, không đổi hàng đợi tổ.

-- CreateEnum
CREATE TYPE "CutMachineClass" AS ENUM ('TU_DONG', 'LASER');

-- CreateTable
CREATE TABLE "cut_allocations" (
    "id" BIGSERIAL NOT NULL,
    "workshopId" BIGINT NOT NULL,
    "workstationId" BIGINT NOT NULL,
    "productionInvoiceId" BIGINT NOT NULL,
    "cuttingProposalId" BIGINT NOT NULL,
    "patternId" BIGINT NOT NULL,
    "machineClass" "CutMachineClass" NOT NULL,
    "barCount" INTEGER NOT NULL,
    "punchedSegments" JSONB,
    "seq" INTEGER NOT NULL,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "cut_allocations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cut_allocations_bar_count_chk" CHECK ("barCount" > 0)
);

-- CreateIndex
CREATE INDEX "cut_allocations_workshopId_workstationId_seq_idx" ON "cut_allocations"("workshopId", "workstationId", "seq");

-- CreateIndex
CREATE INDEX "cut_allocations_productionInvoiceId_idx" ON "cut_allocations"("productionInvoiceId");

-- CreateIndex
CREATE INDEX "cut_allocations_cuttingProposalId_idx" ON "cut_allocations"("cuttingProposalId");

-- CreateIndex
CREATE INDEX "cut_allocations_patternId_idx" ON "cut_allocations"("patternId");

-- AddForeignKey
ALTER TABLE "cut_allocations" ADD CONSTRAINT "cut_allocations_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "workshops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cut_allocations" ADD CONSTRAINT "cut_allocations_workstationId_fkey" FOREIGN KEY ("workstationId") REFERENCES "workstations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cut_allocations" ADD CONSTRAINT "cut_allocations_productionInvoiceId_fkey" FOREIGN KEY ("productionInvoiceId") REFERENCES "production_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cut_allocations" ADD CONSTRAINT "cut_allocations_cuttingProposalId_fkey" FOREIGN KEY ("cuttingProposalId") REFERENCES "cutting_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cut_allocations" ADD CONSTRAINT "cut_allocations_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "cutting_proposal_patterns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cut_allocations" ADD CONSTRAINT "cut_allocations_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
