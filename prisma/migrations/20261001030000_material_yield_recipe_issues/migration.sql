-- Xuất kho nguyên liệu vào (vd thanh nhôm) theo MaterialYieldRecipe - mirror material_yield_issues
-- nhưng khoá theo (productionInvoiceId, recipeId) thay vì (productionOrderId, materialId), vì vật tư
-- ra (vd chân nhôm) không gắn 1 SKU/piece cụ thể nào. Tái dùng enum MaterialYieldIssueStatus có sẵn
-- (ISSUED -> RECEIVED, không QC ở bước này - QC xảy ra sau ở material_yield_step_bundles).
CREATE TABLE "material_yield_recipe_issues" (
    "id" BIGSERIAL NOT NULL,
    "productionInvoiceId" BIGINT NOT NULL,
    "recipeId" BIGINT NOT NULL,
    "issuedQty" DECIMAL(14,4) NOT NULL,
    "status" "MaterialYieldIssueStatus" NOT NULL DEFAULT 'ISSUED',
    "idempotencyKey" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT NOT NULL,
    "receivedQty" DECIMAL(14,4),
    "receivedAt" TIMESTAMP(3),
    "receivedById" TEXT,

    CONSTRAINT "material_yield_recipe_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "material_yield_recipe_issues_idempotencyKey_key" ON "material_yield_recipe_issues"("idempotencyKey");

-- CreateIndex
CREATE INDEX "material_yield_recipe_issues_productionInvoiceId_recipeId_idx" ON "material_yield_recipe_issues"("productionInvoiceId", "recipeId");

-- CreateIndex
CREATE INDEX "material_yield_recipe_issues_status_idx" ON "material_yield_recipe_issues"("status");

-- AddForeignKey
ALTER TABLE "material_yield_recipe_issues" ADD CONSTRAINT "material_yield_recipe_issues_productionInvoiceId_fkey" FOREIGN KEY ("productionInvoiceId") REFERENCES "production_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_yield_recipe_issues" ADD CONSTRAINT "material_yield_recipe_issues_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "material_yield_recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_yield_recipe_issues" ADD CONSTRAINT "material_yield_recipe_issues_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_yield_recipe_issues" ADD CONSTRAINT "material_yield_recipe_issues_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
