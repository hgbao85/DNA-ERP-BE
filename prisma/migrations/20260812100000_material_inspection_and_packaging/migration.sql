-- CreateEnum
CREATE TYPE "PurchaseProposalSource" AS ENUM ('CUTTING_PROPOSAL', 'MATERIAL_INSPECTION');

-- CreateEnum
CREATE TYPE "InspectionKhoStatus" AS ENUM ('PENDING', 'SUBMITTED');

-- DropForeignKey
ALTER TABLE "purchase_proposals" DROP CONSTRAINT "purchase_proposals_cuttingProposalId_fkey";

-- AlterTable
ALTER TABLE "purchase_proposal_items" ALTER COLUMN "buyQty" SET DATA TYPE DECIMAL(14,4),
ALTER COLUMN "receivedQty" SET DEFAULT 0,
ALTER COLUMN "receivedQty" SET DATA TYPE DECIMAL(14,4),
ALTER COLUMN "actualStock" SET DEFAULT 0,
ALTER COLUMN "actualStock" SET DATA TYPE DECIMAL(14,4);

-- AlterTable
ALTER TABLE "purchase_proposals" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "inspectionKhoResultId" BIGINT,
ADD COLUMN     "sourceType" "PurchaseProposalSource" NOT NULL DEFAULT 'CUTTING_PROPOSAL',
ALTER COLUMN "cuttingProposalId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "packaging_records" (
    "id" BIGSERIAL NOT NULL,
    "productionInvoiceItemId" BIGINT NOT NULL,
    "boxesPacked" INTEGER NOT NULL,
    "note" TEXT,
    "packedById" TEXT NOT NULL,
    "packedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packaging_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_inspection_requests" (
    "id" BIGSERIAL NOT NULL,
    "planFormId" BIGINT NOT NULL,
    "productionOrderId" BIGINT NOT NULL,
    "productionStarted" BOOLEAN NOT NULL DEFAULT false,
    "productionStartedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_inspection_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_kho_results" (
    "id" BIGSERIAL NOT NULL,
    "requestId" BIGINT NOT NULL,
    "warehouseCode" TEXT NOT NULL,
    "status" "InspectionKhoStatus" NOT NULL DEFAULT 'PENDING',
    "submittedAt" TIMESTAMP(3),
    "submittedById" TEXT,

    CONSTRAINT "inspection_kho_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_kho_result_items" (
    "id" BIGSERIAL NOT NULL,
    "khoResultId" BIGINT NOT NULL,
    "materialId" BIGINT,
    "materialName" TEXT NOT NULL,
    "materialUnit" TEXT NOT NULL,
    "required" DECIMAL(14,4) NOT NULL,
    "actualStock" DECIMAL(14,4),

    CONSTRAINT "inspection_kho_result_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "packaging_records_productionInvoiceItemId_idx" ON "packaging_records"("productionInvoiceItemId");

-- CreateIndex
CREATE UNIQUE INDEX "material_inspection_requests_planFormId_key" ON "material_inspection_requests"("planFormId");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_kho_results_requestId_warehouseCode_key" ON "inspection_kho_results"("requestId", "warehouseCode");

-- CreateIndex
CREATE INDEX "inspection_kho_result_items_khoResultId_idx" ON "inspection_kho_result_items"("khoResultId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_proposals_inspectionKhoResultId_key" ON "purchase_proposals"("inspectionKhoResultId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_proposals_idempotencyKey_key" ON "purchase_proposals"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "packaging_records" ADD CONSTRAINT "packaging_records_productionInvoiceItemId_fkey" FOREIGN KEY ("productionInvoiceItemId") REFERENCES "production_invoice_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packaging_records" ADD CONSTRAINT "packaging_records_packedById_fkey" FOREIGN KEY ("packedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_proposals" ADD CONSTRAINT "purchase_proposals_cuttingProposalId_fkey" FOREIGN KEY ("cuttingProposalId") REFERENCES "cutting_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_proposals" ADD CONSTRAINT "purchase_proposals_inspectionKhoResultId_fkey" FOREIGN KEY ("inspectionKhoResultId") REFERENCES "inspection_kho_results"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_inspection_requests" ADD CONSTRAINT "material_inspection_requests_planFormId_fkey" FOREIGN KEY ("planFormId") REFERENCES "plan_forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_inspection_requests" ADD CONSTRAINT "material_inspection_requests_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_inspection_requests" ADD CONSTRAINT "material_inspection_requests_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_kho_results" ADD CONSTRAINT "inspection_kho_results_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "material_inspection_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_kho_results" ADD CONSTRAINT "inspection_kho_results_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_kho_result_items" ADD CONSTRAINT "inspection_kho_result_items_khoResultId_fkey" FOREIGN KEY ("khoResultId") REFERENCES "inspection_kho_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_kho_result_items" ADD CONSTRAINT "inspection_kho_result_items_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

