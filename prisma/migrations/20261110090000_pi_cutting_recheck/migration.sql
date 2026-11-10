-- Cờ "cần kiểm lại phương án cắt" khi đổi xưởng lệnh đã có phương án cắt APPROVED.
-- AlterTable
ALTER TABLE "production_invoices" ADD COLUMN     "cuttingRecheckRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cuttingRecheckRequiredAt" TIMESTAMP(3),
ADD COLUMN     "cuttingRecheckedAt" TIMESTAMP(3),
ADD COLUMN     "cuttingRecheckedById" TEXT;

-- AddForeignKey
ALTER TABLE "production_invoices" ADD CONSTRAINT "production_invoices_cuttingRecheckedById_fkey" FOREIGN KEY ("cuttingRecheckedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
