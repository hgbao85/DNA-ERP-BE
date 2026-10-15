-- Báo cáo sản lượng đạt KCS (2026-10-15): lọc theo khoảng ngày KCS duyệt.
-- CreateIndex
CREATE INDEX "qc_reviews_reviewedAt_idx" ON "qc_reviews"("reviewedAt");
