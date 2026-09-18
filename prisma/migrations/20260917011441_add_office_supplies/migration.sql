-- CreateEnum
CREATE TYPE "OfficeSupplyLedgerReason" AS ENUM ('INITIAL', 'IMPORT', 'EXPORT', 'ADJUST');

-- CreateTable
CREATE TABLE "office_supplies" (
    "id" BIGSERIAL NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "office_supplies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "office_supply_ledger_entries" (
    "id" BIGSERIAL NOT NULL,
    "officeSupplyId" BIGINT NOT NULL,
    "changeQty" DECIMAL(14,3) NOT NULL,
    "quantityAfter" DECIMAL(14,3) NOT NULL,
    "reason" "OfficeSupplyLedgerReason" NOT NULL,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "office_supply_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "office_supplies_code_key" ON "office_supplies"("code");

-- CreateIndex
CREATE INDEX "office_supply_ledger_entries_officeSupplyId_createdAt_idx" ON "office_supply_ledger_entries"("officeSupplyId", "createdAt");

-- AddForeignKey
ALTER TABLE "office_supply_ledger_entries" ADD CONSTRAINT "office_supply_ledger_entries_officeSupplyId_fkey" FOREIGN KEY ("officeSupplyId") REFERENCES "office_supplies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "office_supply_ledger_entries" ADD CONSTRAINT "office_supply_ledger_entries_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
