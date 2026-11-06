-- Đợt 6 (2026-11-06, YC4): phiếu xuất XK nhiều dòng 2 bước, bộ đếm số phiếu NK/XK theo ngày, số NK giữ lúc in. Chỉ thêm bảng/cột/enum.
-- CreateEnum
CREATE TYPE "IssueSlipStatus" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IssueSlipLineKind" AS ENUM ('STEEL', 'CONSUMABLE', 'SHARED');

-- AlterEnum
ALTER TYPE "StockLedgerRefType" ADD VALUE 'ISSUE_SLIP_SHARED';

-- AlterTable
ALTER TABLE "purchase_receipts" ADD COLUMN     "code" TEXT;

-- CreateTable
CREATE TABLE "warehouse_slip_counters" (
    "kind" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "lastSeq" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_slip_counters_pkey" PRIMARY KEY ("kind","day")
);

-- CreateTable
CREATE TABLE "reserved_slip_codes" (
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "reserved_slip_codes_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "issue_slips" (
    "id" BIGSERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "warehouseId" BIGINT NOT NULL,
    "status" "IssueSlipStatus" NOT NULL DEFAULT 'DRAFT',
    "recipientName" TEXT,
    "note" TEXT,
    "signedSlipUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT,
    "issuedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "confirmKey" TEXT,

    CONSTRAINT "issue_slips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_slip_lines" (
    "id" BIGSERIAL NOT NULL,
    "slipId" BIGINT NOT NULL,
    "kind" "IssueSlipLineKind" NOT NULL,
    "materialId" BIGINT NOT NULL,
    "productionInvoiceId" BIGINT,
    "productionOrderId" BIGINT,
    "stage" "MfgStage",
    "barLengthMm" INTEGER,
    "qty" DECIMAL(14,4) NOT NULL,
    "note" TEXT,
    "steelIssueId" BIGINT,
    "materialIssueId" BIGINT,

    CONSTRAINT "issue_slip_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reserved_slip_codes_createdById_usedAt_idx" ON "reserved_slip_codes"("createdById", "usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "issue_slips_code_key" ON "issue_slips"("code");

-- CreateIndex
CREATE UNIQUE INDEX "issue_slips_confirmKey_key" ON "issue_slips"("confirmKey");

-- CreateIndex
CREATE INDEX "issue_slips_status_warehouseId_idx" ON "issue_slips"("status", "warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "issue_slip_lines_steelIssueId_key" ON "issue_slip_lines"("steelIssueId");

-- CreateIndex
CREATE UNIQUE INDEX "issue_slip_lines_materialIssueId_key" ON "issue_slip_lines"("materialIssueId");

-- CreateIndex
CREATE INDEX "issue_slip_lines_slipId_idx" ON "issue_slip_lines"("slipId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_receipts_code_key" ON "purchase_receipts"("code");

-- AddForeignKey
ALTER TABLE "issue_slips" ADD CONSTRAINT "issue_slips_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_slips" ADD CONSTRAINT "issue_slips_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_slips" ADD CONSTRAINT "issue_slips_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_slip_lines" ADD CONSTRAINT "issue_slip_lines_slipId_fkey" FOREIGN KEY ("slipId") REFERENCES "issue_slips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_slip_lines" ADD CONSTRAINT "issue_slip_lines_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

