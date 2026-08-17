-- CreateTable
CREATE TABLE "warehouse_transfer_piece_items" (
    "id" BIGSERIAL NOT NULL,
    "transferId" BIGINT NOT NULL,
    "productionOrderId" BIGINT NOT NULL,
    "pieceId" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "note" TEXT,

    CONSTRAINT "warehouse_transfer_piece_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "warehouse_transfer_piece_items_transferId_idx" ON "warehouse_transfer_piece_items"("transferId");

-- CreateIndex
CREATE INDEX "warehouse_transfer_piece_items_productionOrderId_pieceId_idx" ON "warehouse_transfer_piece_items"("productionOrderId", "pieceId");

-- AddForeignKey
ALTER TABLE "warehouse_transfer_piece_items" ADD CONSTRAINT "warehouse_transfer_piece_items_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "warehouse_transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transfer_piece_items" ADD CONSTRAINT "warehouse_transfer_piece_items_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transfer_piece_items" ADD CONSTRAINT "warehouse_transfer_piece_items_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "piece"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
