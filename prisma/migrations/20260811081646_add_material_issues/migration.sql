-- CreateEnum
CREATE TYPE "MaterialIssueStatus" AS ENUM ('ISSUED', 'RECEIVED');

-- CreateTable
CREATE TABLE "material_issues" (
    "id" BIGSERIAL NOT NULL,
    "stage" "MfgStage" NOT NULL,
    "productionOrderId" BIGINT NOT NULL,
    "materialId" BIGINT NOT NULL,
    "issuedQty" DECIMAL(14,4) NOT NULL,
    "status" "MaterialIssueStatus" NOT NULL DEFAULT 'ISSUED',
    "idempotencyKey" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT NOT NULL,
    "receivedQty" DECIMAL(14,4),
    "receivedAt" TIMESTAMP(3),
    "receivedById" TEXT,

    CONSTRAINT "material_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "material_issues_idempotencyKey_key" ON "material_issues"("idempotencyKey");

-- CreateIndex
CREATE INDEX "material_issues_productionOrderId_stage_materialId_idx" ON "material_issues"("productionOrderId", "stage", "materialId");

-- CreateIndex
CREATE INDEX "material_issues_status_idx" ON "material_issues"("status");

-- AddForeignKey
ALTER TABLE "material_issues" ADD CONSTRAINT "material_issues_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_issues" ADD CONSTRAINT "material_issues_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_issues" ADD CONSTRAINT "material_issues_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_issues" ADD CONSTRAINT "material_issues_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
