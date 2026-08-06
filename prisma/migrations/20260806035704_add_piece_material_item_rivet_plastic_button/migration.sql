-- DropForeignKey
ALTER TABLE "stock_ledger" DROP CONSTRAINT "stock_ledger_materialId_fkey";

-- DropForeignKey
ALTER TABLE "stock_ledger" DROP CONSTRAINT "stock_ledger_pieceId_fkey";

-- DropForeignKey
ALTER TABLE "stock_ledger" DROP CONSTRAINT "stock_ledger_productVariantId_fkey";

-- DropForeignKey
ALTER TABLE "stock_ledger" DROP CONSTRAINT "stock_ledger_segmentSpecId_fkey";

-- DropForeignKey
ALTER TABLE "stock_quant" DROP CONSTRAINT "stock_quant_materialId_fkey";

-- DropForeignKey
ALTER TABLE "stock_quant" DROP CONSTRAINT "stock_quant_pieceId_fkey";

-- DropForeignKey
ALTER TABLE "stock_quant" DROP CONSTRAINT "stock_quant_productVariantId_fkey";

-- DropForeignKey
ALTER TABLE "stock_quant" DROP CONSTRAINT "stock_quant_segmentSpecId_fkey";

-- DropForeignKey
ALTER TABLE "warehouse_transfer_items" DROP CONSTRAINT "warehouse_transfer_items_materialId_fkey";

-- DropForeignKey
ALTER TABLE "warehouse_transfer_items" DROP CONSTRAINT "warehouse_transfer_items_transferId_fkey";

-- DropForeignKey
ALTER TABLE "warehouse_transfer_reservations" DROP CONSTRAINT "warehouse_transfer_reservations_materialId_fkey";

-- DropForeignKey
ALTER TABLE "warehouse_transfer_reservations" DROP CONSTRAINT "warehouse_transfer_reservations_transferId_fkey";

-- CreateTable
CREATE TABLE "piece_material_item" (
    "id" BIGSERIAL NOT NULL,
    "bomRevisionId" BIGINT NOT NULL,
    "mfgProductId" BIGINT NOT NULL,
    "pieceId" BIGINT NOT NULL,
    "materialId" BIGINT NOT NULL,
    "qtyPerPiece" DECIMAL(14,4) NOT NULL,
    "note" TEXT,

    CONSTRAINT "piece_material_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "piece_material_item_bomRevisionId_pieceId_materialId_key" ON "piece_material_item"("bomRevisionId", "pieceId", "materialId");

-- AddForeignKey
ALTER TABLE "piece_material_item" ADD CONSTRAINT "piece_material_item_bomRevisionId_mfgProductId_fkey" FOREIGN KEY ("bomRevisionId", "mfgProductId") REFERENCES "bom_revision"("id", "mfgProductId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_material_item" ADD CONSTRAINT "piece_material_item_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "piece"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_material_item" ADD CONSTRAINT "piece_material_item_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_segmentSpecId_fkey" FOREIGN KEY ("segmentSpecId") REFERENCES "segment_spec"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "piece"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_quant" ADD CONSTRAINT "stock_quant_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_quant" ADD CONSTRAINT "stock_quant_segmentSpecId_fkey" FOREIGN KEY ("segmentSpecId") REFERENCES "segment_spec"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_quant" ADD CONSTRAINT "stock_quant_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "piece"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_quant" ADD CONSTRAINT "stock_quant_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transfer_items" ADD CONSTRAINT "warehouse_transfer_items_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "warehouse_transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transfer_items" ADD CONSTRAINT "warehouse_transfer_items_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transfer_reservations" ADD CONSTRAINT "warehouse_transfer_reservations_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "warehouse_transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transfer_reservations" ADD CONSTRAINT "warehouse_transfer_reservations_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;
