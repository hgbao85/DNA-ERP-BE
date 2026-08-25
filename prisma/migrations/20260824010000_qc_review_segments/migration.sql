-- KCS chấm PHÔI theo TỪNG CỠ ĐOẠN (Đợt 1) - xem doc comment QcReviewSegment (schema.prisma).
-- Chỉ áp dụng nhánh QcReview.steelIssueId, KHÔNG đổi gì ở QcReview/Hàn/Sơn.
CREATE TABLE "qc_review_segments" (
    "id" BIGSERIAL NOT NULL,
    "qcReviewId" BIGINT NOT NULL,
    "segmentSpecId" BIGINT NOT NULL,
    "failedQty" INTEGER NOT NULL,
    "fixedQty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "qc_review_segments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "qc_review_segments_qcReviewId_idx" ON "qc_review_segments"("qcReviewId");

CREATE UNIQUE INDEX "qc_review_segments_qcReviewId_segmentSpecId_key"
    ON "qc_review_segments"("qcReviewId", "segmentSpecId");

ALTER TABLE "qc_review_segments" ADD CONSTRAINT "qc_review_segments_qcReviewId_fkey"
    FOREIGN KEY ("qcReviewId") REFERENCES "qc_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "qc_review_segments" ADD CONSTRAINT "qc_review_segments_segmentSpecId_fkey"
    FOREIGN KEY ("segmentSpecId") REFERENCES "segment_spec"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
