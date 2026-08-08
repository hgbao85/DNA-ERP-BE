-- CreateEnum
CREATE TYPE "PurchaseProposalStatus" AS ENUM ('NEW', 'QUOTING', 'SUBMITTED', 'PURCHASING', 'PURCHASED', 'REJECTED');

-- CreateTable
CREATE TABLE "purchase_proposals" (
    "id" BIGSERIAL NOT NULL,
    "cuttingProposalId" BIGINT NOT NULL,
    "warehouseCode" TEXT NOT NULL,
    "status" "PurchaseProposalStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "purchasedAt" TIMESTAMP(3),

    CONSTRAINT "purchase_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_proposal_items" (
    "id" BIGSERIAL NOT NULL,
    "proposalId" BIGINT NOT NULL,
    "materialId" BIGINT NOT NULL,
    "buyQty" INTEGER NOT NULL,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_proposal_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_proposal_quotes" (
    "id" BIGSERIAL NOT NULL,
    "itemId" BIGINT NOT NULL,
    "supplierId" BIGINT,
    "supplierName" TEXT NOT NULL,
    "unitPrice" DECIMAL(14,2),
    "expectedDate" TIMESTAMP(3),
    "note" TEXT,
    "isChosen" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "purchase_proposal_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_proposals_status_idx" ON "purchase_proposals"("status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_proposals_cuttingProposalId_warehouseCode_key" ON "purchase_proposals"("cuttingProposalId", "warehouseCode");

-- CreateIndex
CREATE INDEX "purchase_proposal_items_proposalId_idx" ON "purchase_proposal_items"("proposalId");

-- CreateIndex
CREATE INDEX "purchase_proposal_quotes_itemId_idx" ON "purchase_proposal_quotes"("itemId");

-- AddForeignKey
ALTER TABLE "purchase_proposals" ADD CONSTRAINT "purchase_proposals_cuttingProposalId_fkey" FOREIGN KEY ("cuttingProposalId") REFERENCES "cutting_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_proposals" ADD CONSTRAINT "purchase_proposals_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_proposal_items" ADD CONSTRAINT "purchase_proposal_items_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "purchase_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_proposal_items" ADD CONSTRAINT "purchase_proposal_items_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_proposal_quotes" ADD CONSTRAINT "purchase_proposal_quotes_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "purchase_proposal_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_proposal_quotes" ADD CONSTRAINT "purchase_proposal_quotes_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
