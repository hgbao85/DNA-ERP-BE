-- Sắt -> 3 nhóm con (2026-10-01): Phần mềm (SOFTWARE, mặc định NULL) / Tự tính (SELF_CALC, vd sắt
-- lá -> Pat, dùng PieceMaterialYield y nguyên) / VTTP (FINISHED_COMPONENT, vd chân nhôm - KHÔNG gắn
-- piece, dùng MaterialYieldRecipe + MaterialYieldStepBatch/Bundle mới ở đây).
--
-- KHÔNG tạo thêm MaterialGroup con có systemKey riêng (đã thử làm "SAT_TU_TINH" thành nhóm hệ
-- thống thứ 7 ở commit DEC79-82 30/09, bị revert cùng ngày) - 3 nhóm trên vẫn cùng 1
-- materialGroupId (STEEL_BAR), chỉ thêm cột phân loại Material.steelSubGroup.
--
-- MaterialYieldStepBatch/Bundle mirror PieceStepBatch/PieceStepBundle nhưng khoá theo
-- (productionInvoiceId, recipeId, step) thay vì (productionOrderId, pieceId, step) - vật tư ra
-- (vd chân nhôm) không gắn 1 SKU/piece cụ thể nào.

-- CreateEnum
CREATE TYPE "SteelSubGroup" AS ENUM ('SOFTWARE', 'SELF_CALC', 'FINISHED_COMPONENT');

-- AlterTable
ALTER TABLE "materials" ADD COLUMN     "steelSubGroup" "SteelSubGroup";

-- AlterTable
ALTER TABLE "qc_reviews" ADD COLUMN     "materialYieldStepBundleId" BIGINT;

-- CreateTable
CREATE TABLE "material_yield_recipes" (
    "id" BIGSERIAL NOT NULL,
    "outputMaterialId" BIGINT NOT NULL,
    "inputMaterialId" BIGINT NOT NULL,
    "piecesPerBar" INTEGER NOT NULL,
    "processSteps" "ProcessStep"[] DEFAULT ARRAY[]::"ProcessStep"[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_yield_recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_yield_step_batches" (
    "id" BIGSERIAL NOT NULL,
    "productionInvoiceId" BIGINT NOT NULL,
    "recipeId" BIGINT NOT NULL,
    "step" "ProcessStep" NOT NULL,
    "qty" INTEGER NOT NULL,
    "materialYieldStepBundleId" BIGINT,
    "idempotencyKey" TEXT,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportedById" TEXT NOT NULL,

    CONSTRAINT "material_yield_step_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_yield_step_bundles" (
    "id" BIGSERIAL NOT NULL,
    "productionInvoiceId" BIGINT NOT NULL,
    "recipeId" BIGINT NOT NULL,
    "step" "ProcessStep" NOT NULL,
    "qty" INTEGER NOT NULL,
    "status" "PieceStepBundleStatus" NOT NULL DEFAULT 'AWAITING_QC',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedById" TEXT NOT NULL,

    CONSTRAINT "material_yield_step_bundles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "material_yield_recipes_outputMaterialId_key" ON "material_yield_recipes"("outputMaterialId");

-- CreateIndex
CREATE UNIQUE INDEX "material_yield_step_batches_idempotencyKey_key" ON "material_yield_step_batches"("idempotencyKey");

-- CreateIndex
CREATE INDEX "material_yield_step_batches_productionInvoiceId_recipeId_st_idx" ON "material_yield_step_batches"("productionInvoiceId", "recipeId", "step");

-- CreateIndex
CREATE INDEX "material_yield_step_batches_materialYieldStepBundleId_idx" ON "material_yield_step_batches"("materialYieldStepBundleId");

-- CreateIndex
CREATE INDEX "material_yield_step_bundles_productionInvoiceId_recipeId_st_idx" ON "material_yield_step_bundles"("productionInvoiceId", "recipeId", "step");

-- CreateIndex
CREATE INDEX "material_yield_step_bundles_status_idx" ON "material_yield_step_bundles"("status");

-- CreateIndex
CREATE INDEX "qc_reviews_materialYieldStepBundleId_idx" ON "qc_reviews"("materialYieldStepBundleId");

-- AddForeignKey
ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_materialYieldStepBundleId_fkey" FOREIGN KEY ("materialYieldStepBundleId") REFERENCES "material_yield_step_bundles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_yield_recipes" ADD CONSTRAINT "material_yield_recipes_outputMaterialId_fkey" FOREIGN KEY ("outputMaterialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_yield_recipes" ADD CONSTRAINT "material_yield_recipes_inputMaterialId_fkey" FOREIGN KEY ("inputMaterialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_yield_step_batches" ADD CONSTRAINT "material_yield_step_batches_productionInvoiceId_fkey" FOREIGN KEY ("productionInvoiceId") REFERENCES "production_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_yield_step_batches" ADD CONSTRAINT "material_yield_step_batches_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "material_yield_recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_yield_step_batches" ADD CONSTRAINT "material_yield_step_batches_materialYieldStepBundleId_fkey" FOREIGN KEY ("materialYieldStepBundleId") REFERENCES "material_yield_step_bundles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_yield_step_batches" ADD CONSTRAINT "material_yield_step_batches_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_yield_step_bundles" ADD CONSTRAINT "material_yield_step_bundles_productionInvoiceId_fkey" FOREIGN KEY ("productionInvoiceId") REFERENCES "production_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_yield_step_bundles" ADD CONSTRAINT "material_yield_step_bundles_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "material_yield_recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_yield_step_bundles" ADD CONSTRAINT "material_yield_step_bundles_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHỈ THÊM, KHÔNG PHÁ: mở rộng CHECK qc_reviews_goods_xor_chk thêm materialYieldStepBundleId làm
-- leg thứ 4 (mirror cách pieceStepBundleId được thêm ở migration 20260907060000) - dữ liệu hiện có
-- vẫn thoả vì mọi dòng cũ đúng "1 trong 4 khác NULL".
ALTER TABLE "qc_reviews" DROP CONSTRAINT "qc_reviews_goods_xor_chk";
ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_goods_xor_chk"
  CHECK (num_nonnulls("steelIssueId", "productionBatchId", "pieceStepBundleId", "materialYieldStepBundleId") = 1);
