-- QR tại máy (2026-10-13) - xem changelog-2026-10-08-ke-hoach-tem-qr-bo-sat-phoi.md mục 22.
-- Chỉ THÊM bảng/cột nullable + nới users.email thành NULL được; không đụng dữ liệu cũ.
-- CreateEnum
CREATE TYPE "WorkstationKind" AS ENUM ('CUT', 'STEP', 'PIECE', 'STEEL_RECEIVE');

-- CreateEnum
CREATE TYPE "FloorQueueStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE');

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;

-- AlterTable
ALTER TABLE "cut_bundles" ADD COLUMN     "openedById" TEXT;

-- AlterTable
ALTER TABLE "floor_reports" ADD COLUMN     "reason" TEXT,
ADD COLUMN     "workstationId" BIGINT;

-- CreateTable
CREATE TABLE "workstations" (
    "id" BIGSERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stage" "MfgStage" NOT NULL,
    "kind" "WorkstationKind" NOT NULL,
    "processStep" "ProcessStep",
    "qrToken" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workstations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floor_queue_entries" (
    "id" BIGSERIAL NOT NULL,
    "stage" "MfgStage" NOT NULL,
    "productionInvoiceId" BIGINT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "FloorQueueStatus" NOT NULL DEFAULT 'QUEUED',
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "queuedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "startedById" TEXT,
    "endedAt" TIMESTAMP(3),
    "endedById" TEXT,

    CONSTRAINT "floor_queue_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workstations_code_key" ON "workstations"("code");

-- CreateIndex
CREATE UNIQUE INDEX "workstations_qrToken_key" ON "workstations"("qrToken");

-- CreateIndex
CREATE INDEX "workstations_stage_idx" ON "workstations"("stage");

-- CreateIndex
CREATE INDEX "floor_queue_entries_stage_status_position_idx" ON "floor_queue_entries"("stage", "status", "position");

-- CreateIndex
CREATE UNIQUE INDEX "floor_queue_entries_stage_productionInvoiceId_key" ON "floor_queue_entries"("stage", "productionInvoiceId");

-- CreateIndex
CREATE INDEX "floor_reports_workstationId_idx" ON "floor_reports"("workstationId");

-- AddForeignKey
ALTER TABLE "cut_bundles" ADD CONSTRAINT "cut_bundles_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_reports" ADD CONSTRAINT "floor_reports_workstationId_fkey" FOREIGN KEY ("workstationId") REFERENCES "workstations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_queue_entries" ADD CONSTRAINT "floor_queue_entries_productionInvoiceId_fkey" FOREIGN KEY ("productionInvoiceId") REFERENCES "production_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_queue_entries" ADD CONSTRAINT "floor_queue_entries_queuedById_fkey" FOREIGN KEY ("queuedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_queue_entries" ADD CONSTRAINT "floor_queue_entries_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_queue_entries" ADD CONSTRAINT "floor_queue_entries_endedById_fkey" FOREIGN KEY ("endedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Mỗi tổ ĐÚNG 1 PI đang chạy (Prisma không mô tả được partial unique index - viết tay).
CREATE UNIQUE INDEX "floor_queue_entries_one_running_per_stage" ON "floor_queue_entries"("stage") WHERE "status" = 'RUNNING';

-- STEP <=> có công đoạn phụ (khác CAT); máy cắt/công đoạn phụ/nhận sắt chỉ thuộc tổ Phôi; không có tổ Đan.
ALTER TABLE "workstations" ADD CONSTRAINT "workstations_step_chk"
  CHECK (("kind" = 'STEP') = ("processStep" IS NOT NULL AND "processStep" <> 'CAT'));
ALTER TABLE "workstations" ADD CONSTRAINT "workstations_stage_chk"
  CHECK ("stage" <> 'DAN' AND ("kind" = 'PIECE' OR "stage" = 'PHOI'));
