-- CreateEnum
CREATE TYPE "ProdItemStageType" AS ENUM ('HAN', 'WEAVING', 'PACKAGING');

-- CreateTable
CREATE TABLE "production_invoice_item_stages" (
    "id" BIGSERIAL NOT NULL,
    "productionInvoiceItemId" BIGINT NOT NULL,
    "stageType" "ProdItemStageType" NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_invoice_item_stages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_invoice_item_stages_productionInvoiceItemId_stag_key" ON "production_invoice_item_stages"("productionInvoiceItemId", "stageType");

-- AddForeignKey
ALTER TABLE "production_invoice_item_stages" ADD CONSTRAINT "production_invoice_item_stages_productionInvoiceItemId_fkey" FOREIGN KEY ("productionInvoiceItemId") REFERENCES "production_invoice_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
