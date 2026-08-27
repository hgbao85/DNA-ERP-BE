-- L2 mức 2 (2026-08-27): ép bất biến "mỗi SKU chỉ được phủ bởi ĐÚNG 1 phương án cắt đang hiệu
-- lực" ở tầng DỮ LIỆU. PK là chính bất biến - không thể thêm dòng thứ 2 cho cùng 1 ProductionOrder
-- bằng bất kỳ đường nào (route mới, script migration, refactor sau này).
-- Xem doc comment model CuttingPlanCoverage trong schema.prisma.
CREATE TABLE "cutting_plan_coverage" (
    "productionOrderId" BIGINT NOT NULL,
    "cuttingProposalId" BIGINT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cutting_plan_coverage_pkey" PRIMARY KEY ("productionOrderId")
);

-- "Phương án này đang phủ những SKU nào" - dùng khi gỡ/chuyển chủ.
CREATE INDEX "cutting_plan_coverage_cuttingProposalId_idx"
  ON "cutting_plan_coverage" ("cuttingProposalId");

ALTER TABLE "cutting_plan_coverage"
  ADD CONSTRAINT "cutting_plan_coverage_productionOrderId_fkey"
  FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cutting_plan_coverage"
  ADD CONSTRAINT "cutting_plan_coverage_cuttingProposalId_fkey"
  FOREIGN KEY ("cuttingProposalId") REFERENCES "cutting_proposals"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
