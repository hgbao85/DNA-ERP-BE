-- Phần A – Đợt 10a (YC5, phần Sales): Booking / Lịch xuất hàng. Điểm ghép ④ với người B (10b ghi booking_lines.shippedQty).
-- Chỉ THÊM bảng/enum mới, không đổi bảng có sẵn.
-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'SHIPPED', 'CANCELLED');

-- CreateTable
CREATE TABLE "bookings" (
    "id" BIGSERIAL NOT NULL,
    "bookingNo" TEXT NOT NULL,
    "customerId" BIGINT NOT NULL,
    "containerType" TEXT NOT NULL DEFAULT '40HC',
    "containerQty" INTEGER NOT NULL DEFAULT 1,
    "pod" TEXT NOT NULL,
    "cutSiAt" TIMESTAMP(3),
    "pickupDate" DATE,
    "cutOffAt" TIMESTAMP(3),
    "etd" DATE,
    "pickupPlace" TEXT,
    "vesselVoyage" TEXT,
    "warehouseCode" TEXT,
    "note" TEXT,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "status" "BookingStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_lines" (
    "id" BIGSERIAL NOT NULL,
    "bookingId" BIGINT NOT NULL,
    "productionInvoiceItemId" BIGINT NOT NULL,
    "salesOrderItemId" BIGINT NOT NULL,
    "qty" INTEGER NOT NULL,
    "shippedQty" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bookings_customerId_idx" ON "bookings"("customerId");

-- CreateIndex
CREATE INDEX "bookings_status_idx" ON "bookings"("status");

-- CreateIndex
CREATE INDEX "bookings_pickupDate_idx" ON "bookings"("pickupDate");

-- CreateIndex
CREATE INDEX "bookings_cutOffAt_idx" ON "bookings"("cutOffAt");

-- CreateIndex
CREATE INDEX "bookings_bookingNo_idx" ON "bookings"("bookingNo");

-- CreateIndex
CREATE INDEX "booking_lines_productionInvoiceItemId_idx" ON "booking_lines"("productionInvoiceItemId");

-- CreateIndex
CREATE INDEX "booking_lines_salesOrderItemId_idx" ON "booking_lines"("salesOrderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "booking_lines_bookingId_productionInvoiceItemId_key" ON "booking_lines"("bookingId", "productionInvoiceItemId");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "sales_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_lines" ADD CONSTRAINT "booking_lines_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_lines" ADD CONSTRAINT "booking_lines_productionInvoiceItemId_fkey" FOREIGN KEY ("productionInvoiceItemId") REFERENCES "production_invoice_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_lines" ADD CONSTRAINT "booking_lines_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "sales_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

