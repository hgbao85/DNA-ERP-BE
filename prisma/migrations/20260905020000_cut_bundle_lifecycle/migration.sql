-- Vòng đời RIÊNG cho từng ĐỢT CẮT (2026-09-05, yêu cầu nghiệp vụ DEC/PO-52).
--
-- Vấn đề đang có: trạng thái nằm ở LÔ NHẬN (steel_issues.status), nên (a) phải cắt xong TOÀN BỘ
-- số cây kho giao mới bấm "Báo cắt xong" gửi KCS được, và (b) sắt kho giao BÙ sau đó không cắt
-- tiếp được nếu lô đã rời RECEIVED (SteelIssuesService.recordCutBatch chặn cứng, và không có
-- đường quay lại RECEIVED trừ khi KCS bắt lỗi sinh đợt rework).
--
-- Cách sửa: hạ vòng đời xuống cut_bundles (mỗi lần Phôi bấm "Lưu đợt cắt" = 1 dòng). Mỗi đợt cắt
-- tự đi CUTTING -> AWAITING_QC -> QC_PASSED, các đợt khác của cùng lô vẫn cắt bình thường.
--
-- CHỈ THÊM, KHÔNG PHÁ: mọi cột/ràng buộc cũ giữ nguyên (kể cả CHECK qc_reviews_goods_xor_chk -
-- dòng KCS nhánh Phôi vẫn ghi steelIssueId như trước, cutBundleId là cột PHỤ để lọc theo đợt).
-- Dữ liệu đang chạy trên production (vd PO-52) không phải sửa gì, chỉ backfill status bên dưới.

CREATE TYPE "CutBundleStatus" AS ENUM ('CUTTING', 'AWAITING_QC', 'QC_PASSED');

ALTER TABLE "cut_bundles"
  ADD COLUMN "status"         "CutBundleStatus" NOT NULL DEFAULT 'CUTTING',
  ADD COLUMN "completedSteps" "ProcessStep"[]   NOT NULL DEFAULT ARRAY[]::"ProcessStep"[],
  ADD COLUMN "completedAt"    TIMESTAMP(3),
  ADD COLUMN "createdAt"      TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- barCount/mauNguyenMm không còn bắt Phôi khai (bỏ 2 ô nhập, 2026-09-05) - cho DEFAULT 0 để dòng
-- mới không phải gửi. Dữ liệu CŨ giữ nguyên số đã khai, không đụng tới.
ALTER TABLE "cut_bundles" ALTER COLUMN "barCount" SET DEFAULT 0;

ALTER TABLE "step_batches" ADD COLUMN "cutBundleId" BIGINT;
ALTER TABLE "qc_reviews"   ADD COLUMN "cutBundleId" BIGINT;

CREATE INDEX "cut_bundles_status_idx"        ON "cut_bundles" ("status");
CREATE INDEX "step_batches_cutBundleId_step_idx" ON "step_batches" ("cutBundleId", "step");
CREATE INDEX "qc_reviews_cutBundleId_idx"    ON "qc_reviews" ("cutBundleId");

ALTER TABLE "step_batches" ADD CONSTRAINT "step_batches_cutBundleId_fkey"
  FOREIGN KEY ("cutBundleId") REFERENCES "cut_bundles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_cutBundleId_fkey"
  FOREIGN KEY ("cutBundleId") REFERENCES "cut_bundles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: đợt cắt CŨ thừa hưởng trạng thái của lô nhận cha, để màn Phôi/KCS không thấy mọi đợt
-- cũ nhảy ngược về "đang cắt". completedSteps/completedAt cũng chép xuống theo cùng lý do.
UPDATE "cut_bundles" b SET
  "status" = CASE i."status"
    WHEN 'QC_PASSED'   THEN 'QC_PASSED'::"CutBundleStatus"
    WHEN 'AWAITING_QC' THEN 'AWAITING_QC'::"CutBundleStatus"
    ELSE 'CUTTING'::"CutBundleStatus"
  END,
  "completedSteps" = i."completedSteps",
  "completedAt"    = i."completedAt"
FROM "steel_issues" i
WHERE b."steelIssueId" = i."id";
