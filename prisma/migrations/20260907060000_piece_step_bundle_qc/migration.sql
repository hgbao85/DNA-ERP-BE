-- QC theo TỪNG CÔNG ĐOẠN cho vật tư thành phẩm (2026-09-07) - thay ràng buộc CŨ "phải xong hết mọi
-- công đoạn mới gửi KCS" bằng: mỗi công đoạn tự gửi KCS riêng, KHÔNG chờ công đoạn khác (quyết
-- định nghiệp vụ, Sếp Trương Văn Nhân: "để cho đơn giản thì không cần ràng buộc, cứ để thoải mái").
--
-- CHỈ THÊM, KHÔNG PHÁ: mọi cột/ràng buộc cũ giữ nguyên, kể cả CHECK qc_reviews_goods_xor_chk (drop
-- rồi tạo lại rộng hơn - dữ liệu hiện có vẫn thoả vì mọi dòng cũ vẫn đúng "1 trong 3 khác NULL").

CREATE TYPE "PieceStepBundleStatus" AS ENUM ('AWAITING_QC', 'QC_PASSED');

CREATE TABLE "piece_step_bundles" (
    "id"                BIGSERIAL PRIMARY KEY,
    "productionOrderId" BIGINT NOT NULL,
    "pieceId"           BIGINT NOT NULL,
    "step"              "ProcessStep" NOT NULL,
    "qty"               INTEGER NOT NULL,
    "status"            "PieceStepBundleStatus" NOT NULL DEFAULT 'AWAITING_QC',
    "submittedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedById"     TEXT NOT NULL
);

ALTER TABLE "piece_step_bundles" ADD CONSTRAINT "piece_step_bundles_productionOrderId_fkey"
  FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "piece_step_bundles" ADD CONSTRAINT "piece_step_bundles_pieceId_fkey"
  FOREIGN KEY ("pieceId") REFERENCES "piece"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "piece_step_bundles" ADD CONSTRAINT "piece_step_bundles_submittedById_fkey"
  FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "piece_step_bundles_productionOrderId_pieceId_step_idx" ON "piece_step_bundles" ("productionOrderId", "pieceId", "step");
CREATE INDEX "piece_step_bundles_status_idx" ON "piece_step_bundles" ("status");

ALTER TABLE "piece_step_batches" ADD COLUMN "pieceStepBundleId" BIGINT;
CREATE INDEX "piece_step_batches_pieceStepBundleId_idx" ON "piece_step_batches" ("pieceStepBundleId");
ALTER TABLE "piece_step_batches" ADD CONSTRAINT "piece_step_batches_pieceStepBundleId_fkey"
  FOREIGN KEY ("pieceStepBundleId") REFERENCES "piece_step_bundles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "qc_reviews" ADD COLUMN "pieceStepBundleId" BIGINT;
CREATE INDEX "qc_reviews_pieceStepBundleId_idx" ON "qc_reviews" ("pieceStepBundleId");
ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_pieceStepBundleId_fkey"
  FOREIGN KEY ("pieceStepBundleId") REFERENCES "piece_step_bundles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "qc_reviews" DROP CONSTRAINT "qc_reviews_goods_xor_chk";
ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_goods_xor_chk"
  CHECK (num_nonnulls("steelIssueId", "productionBatchId", "pieceStepBundleId") = 1);
