-- C4 (danh sách lỗi 16/11, 17/11/2026): phần dư đoạn của lệnh ở lại kho Phôi CŨ khi đổi xưởng - xem doc comment
-- model SegmentProductionLeftover. Chỉ thêm bảng mới, không đổi dữ liệu nào đang có.

CREATE TABLE "segment_production_leftovers" (
    "id" BIGSERIAL NOT NULL,
    "productionInvoiceId" BIGINT NOT NULL,
    "segmentSpecId" BIGINT NOT NULL,
    "segmentSteps" TEXT NOT NULL DEFAULT '',
    "warehouseId" BIGINT NOT NULL,
    "surplusQty" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "segment_production_leftovers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "segment_production_leftovers_qty_chk" CHECK ("surplusQty" >= 0),
    CONSTRAINT "segment_production_leftovers_steps_chk"
      CHECK ("segmentSteps" = '' OR "segmentSteps" ~ '^(UON|DAP|DUC_LO|TAN|TOP_DAU|XE|NHAN)(,(UON|DAP|DUC_LO|TAN|TOP_DAU|XE|NHAN))*$')
);

CREATE INDEX "segment_production_leftovers_warehouseId_idx" ON "segment_production_leftovers"("warehouseId");
CREATE UNIQUE INDEX "segment_production_leftovers_productionInvoiceId_segmentSpe_key" ON "segment_production_leftovers"("productionInvoiceId", "segmentSpecId", "segmentSteps", "warehouseId");

ALTER TABLE "segment_production_leftovers" ADD CONSTRAINT "segment_production_leftovers_productionInvoiceId_fkey" FOREIGN KEY ("productionInvoiceId") REFERENCES "production_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "segment_production_leftovers" ADD CONSTRAINT "segment_production_leftovers_segmentSpecId_fkey" FOREIGN KEY ("segmentSpecId") REFERENCES "segment_spec"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "segment_production_leftovers" ADD CONSTRAINT "segment_production_leftovers_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
