-- Phần A – Đợt 9 (YC2): lô yêu cầu đổi mốc của dòng SKU đã Sếp duyệt (Sếp duyệt lại). Chỉ THÊM bảng / enum mới.
-- CreateEnum
CREATE TYPE "DeadlineChangeSource" AS ENUM ('MANUAL', 'EXCEL');

-- CreateEnum
CREATE TYPE "DeadlineChangeBatchStatus" AS ENUM ('PENDING', 'DECIDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeadlineChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "deadline_change_batches" (
    "id" BIGSERIAL NOT NULL,
    "source" "DeadlineChangeSource" NOT NULL,
    "status" "DeadlineChangeBatchStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "note" TEXT,
    "idempotencyKey" TEXT,

    CONSTRAINT "deadline_change_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deadline_change_requests" (
    "id" BIGSERIAL NOT NULL,
    "batchId" BIGINT NOT NULL,
    "productionInvoiceItemId" BIGINT NOT NULL,
    "status" "DeadlineChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "oldValues" JSONB NOT NULL,
    "newValues" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "deadline_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deadline_change_batches_idempotencyKey_key" ON "deadline_change_batches"("idempotencyKey");

-- CreateIndex
CREATE INDEX "deadline_change_batches_status_idx" ON "deadline_change_batches"("status");

-- CreateIndex
CREATE INDEX "deadline_change_requests_productionInvoiceItemId_status_idx" ON "deadline_change_requests"("productionInvoiceItemId", "status");

-- CreateIndex
CREATE INDEX "deadline_change_requests_batchId_idx" ON "deadline_change_requests"("batchId");

-- Mỗi dòng SKU chỉ có tối đa 1 yêu cầu đang chờ (viết tay: Prisma không khai được unique index có WHERE).
CREATE UNIQUE INDEX "deadline_change_requests_one_pending_per_item" ON "deadline_change_requests"("productionInvoiceItemId") WHERE "status" = 'PENDING';

-- AddForeignKey
ALTER TABLE "deadline_change_batches" ADD CONSTRAINT "deadline_change_batches_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deadline_change_batches" ADD CONSTRAINT "deadline_change_batches_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deadline_change_requests" ADD CONSTRAINT "deadline_change_requests_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "deadline_change_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deadline_change_requests" ADD CONSTRAINT "deadline_change_requests_productionInvoiceItemId_fkey" FOREIGN KEY ("productionInvoiceItemId") REFERENCES "production_invoice_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
