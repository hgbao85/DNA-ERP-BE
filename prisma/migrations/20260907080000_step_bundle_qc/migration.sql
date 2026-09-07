-- QC theo TỪNG CÔNG ĐOẠN PHỤ cho Sắt (Uốn/Dập/Đục lỗ/Tán/..., 2026-09-07) - thay cờ tự khai
-- (CutBundle.completedSteps, không qua KCS) bằng "gửi KCS riêng" cho từng công đoạn, KHÔNG chờ
-- công đoạn khác (quyết định nghiệp vụ, Sếp Trương Văn Nhân: "Cắt xong thì qua KCS, qua từng công
-- đoạn thì đều phải qua KCS"). Mirror StepBundle/PieceStepBundle (VTTP) nhưng bóc theo CỠ ĐOẠN qua
-- StepBatchSegment (đã có sẵn) thay vì số lượng phẳng.
--
-- CHỈ THÊM, KHÔNG PHÁ: mọi cột/ràng buộc cũ giữ nguyên, kể cả CHECK qc_reviews_goods_xor_chk
-- (stepBundleId là cột lọc PHỤ như cutBundleId, KHÔNG nằm trong XOR - không cần đổi CHECK).

CREATE TYPE "StepBundleStatus" AS ENUM ('AWAITING_QC', 'QC_PASSED');

CREATE TABLE "step_bundles" (
    "id"            BIGSERIAL PRIMARY KEY,
    "cutBundleId"   BIGINT NOT NULL,
    "step"          "ProcessStep" NOT NULL,
    "status"        "StepBundleStatus" NOT NULL DEFAULT 'AWAITING_QC',
    "submittedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedById" TEXT NOT NULL
);

ALTER TABLE "step_bundles" ADD CONSTRAINT "step_bundles_cutBundleId_fkey"
  FOREIGN KEY ("cutBundleId") REFERENCES "cut_bundles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "step_bundles" ADD CONSTRAINT "step_bundles_submittedById_fkey"
  FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "step_bundles_cutBundleId_step_idx" ON "step_bundles" ("cutBundleId", "step");
CREATE INDEX "step_bundles_status_idx" ON "step_bundles" ("status");

ALTER TABLE "step_batches" ADD COLUMN "stepBundleId" BIGINT;
CREATE INDEX "step_batches_stepBundleId_idx" ON "step_batches" ("stepBundleId");
ALTER TABLE "step_batches" ADD CONSTRAINT "step_batches_stepBundleId_fkey"
  FOREIGN KEY ("stepBundleId") REFERENCES "step_bundles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "qc_reviews" ADD COLUMN "stepBundleId" BIGINT;
CREATE INDEX "qc_reviews_stepBundleId_idx" ON "qc_reviews" ("stepBundleId");
ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_stepBundleId_fkey"
  FOREIGN KEY ("stepBundleId") REFERENCES "step_bundles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
