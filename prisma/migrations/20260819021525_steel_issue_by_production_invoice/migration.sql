/*
  Warnings:

  - You are about to drop the column `pieceId` on the `steel_issues` table. All the data in the column will be lost.
  - You are about to drop the column `productionOrderId` on the `steel_issues` table. All the data in the column will be lost.
  - Added the required column `productionInvoiceId` to the `steel_issues` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "steel_issues" DROP CONSTRAINT "steel_issues_pieceId_fkey";

-- DropForeignKey
ALTER TABLE "steel_issues" DROP CONSTRAINT "steel_issues_productionOrderId_fkey";

-- DropIndex
DROP INDEX "steel_issues_productionOrderId_pieceId_idx";

-- AlterTable
ALTER TABLE "steel_issues" DROP COLUMN "pieceId",
DROP COLUMN "productionOrderId",
ADD COLUMN     "productionInvoiceId" BIGINT NOT NULL;

-- CreateIndex
CREATE INDEX "steel_issues_productionInvoiceId_materialId_idx" ON "steel_issues"("productionInvoiceId", "materialId");

-- AddForeignKey
ALTER TABLE "steel_issues" ADD CONSTRAINT "steel_issues_productionInvoiceId_fkey" FOREIGN KEY ("productionInvoiceId") REFERENCES "production_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
