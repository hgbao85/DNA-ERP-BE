-- Nhật ký sửa tay bảng "Chia máy cắt" (đợt C, 14/11/2026; Sếp chốt câu 6 + 10):
-- hệ thống lưu lại các lần chia/tách/đổi máy để thống kê "lệnh có điều chuyển" (QLSX điều tiết).

-- CreateEnum
CREATE TYPE "CutAllocationLogAction" AS ENUM ('ADD', 'SPLIT', 'MOVE', 'BARS', 'REMOVE');

-- CreateEnum
CREATE TYPE "CutAllocationChangeReason" AS ENUM ('MACHINE_BROKEN', 'OTHER');

-- CreateTable
CREATE TABLE "cut_allocation_logs" (
    "id" BIGSERIAL NOT NULL,
    "workshopId" BIGINT NOT NULL,
    "productionInvoiceId" BIGINT NOT NULL,
    "cutAllocationId" BIGINT,
    "patternId" BIGINT,
    "action" "CutAllocationLogAction" NOT NULL,
    "fromWorkstationId" BIGINT,
    "toWorkstationId" BIGINT,
    "barCount" INTEGER NOT NULL,
    "previousBarCount" INTEGER,
    "isBundle" BOOLEAN NOT NULL DEFAULT false,
    "reason" "CutAllocationChangeReason",
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cut_allocation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cut_allocation_logs_workshopId_createdAt_idx" ON "cut_allocation_logs"("workshopId", "createdAt");

-- CreateIndex
CREATE INDEX "cut_allocation_logs_productionInvoiceId_idx" ON "cut_allocation_logs"("productionInvoiceId");

-- AddForeignKey
ALTER TABLE "cut_allocation_logs" ADD CONSTRAINT "cut_allocation_logs_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "workshops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cut_allocation_logs" ADD CONSTRAINT "cut_allocation_logs_productionInvoiceId_fkey" FOREIGN KEY ("productionInvoiceId") REFERENCES "production_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cut_allocation_logs" ADD CONSTRAINT "cut_allocation_logs_cutAllocationId_fkey" FOREIGN KEY ("cutAllocationId") REFERENCES "cut_allocations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cut_allocation_logs" ADD CONSTRAINT "cut_allocation_logs_fromWorkstationId_fkey" FOREIGN KEY ("fromWorkstationId") REFERENCES "workstations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cut_allocation_logs" ADD CONSTRAINT "cut_allocation_logs_toWorkstationId_fkey" FOREIGN KEY ("toWorkstationId") REFERENCES "workstations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cut_allocation_logs" ADD CONSTRAINT "cut_allocation_logs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
