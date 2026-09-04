-- Xuất kho nguyên liệu thô Vật tư thành phẩm (Sắt La → Pat, Thanh nhôm → chân nhôm) cho Phôi -
-- mirror material_issues (KHÔNG mirror steel_issues): xuất TỰ DO theo tồn kho thực tế, KHÔNG cần
-- qua bước đề xuất/duyệt phương án trước (khác Sắt bắt buộc CuttingProposal đã duyệt). Mỗi đợt
-- CHỈ có số lượng, KHÔNG có "chiều dài" như steel_issues.barLengthMm. Không có cột "stage" (khác
-- material_issues dùng chung HAN/SON) vì luôn PHÔI. Chỉ ISSUED -> RECEIVED.
CREATE TYPE "MaterialYieldIssueStatus" AS ENUM ('ISSUED', 'RECEIVED');

CREATE TABLE "material_yield_issues" (
    "id" BIGSERIAL NOT NULL,
    "productionOrderId" BIGINT NOT NULL,
    "materialId" BIGINT NOT NULL,
    "issuedQty" DECIMAL(14,4) NOT NULL,
    "status" "MaterialYieldIssueStatus" NOT NULL DEFAULT 'ISSUED',
    "idempotencyKey" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT NOT NULL,
    "receivedQty" DECIMAL(14,4),
    "receivedAt" TIMESTAMP(3),
    "receivedById" TEXT,

    CONSTRAINT "material_yield_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "material_yield_issues_idempotencyKey_key" ON "material_yield_issues"("idempotencyKey");

-- CreateIndex
CREATE INDEX "material_yield_issues_productionOrderId_materialId_idx" ON "material_yield_issues"("productionOrderId", "materialId");

-- CreateIndex
CREATE INDEX "material_yield_issues_status_idx" ON "material_yield_issues"("status");

-- AddForeignKey
ALTER TABLE "material_yield_issues" ADD CONSTRAINT "material_yield_issues_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_yield_issues" ADD CONSTRAINT "material_yield_issues_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_yield_issues" ADD CONSTRAINT "material_yield_issues_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_yield_issues" ADD CONSTRAINT "material_yield_issues_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
