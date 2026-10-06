-- 2026-10-06 (bug thật, test lần 7): KCS công đoạn PHỤ của sắt (Uốn/Dập/Đục lỗ, StepBundle) ghi
-- qc_reviews.stepBundleId nhưng CHECK qc_reviews_goods_xor_chk chỉ đếm 4 chân khác (không có
-- stepBundleId) -> 500 "violates check constraint" khi duyệt. Thêm stepBundleId làm chân thứ 5.
-- KHÔNG đưa cutBundleId vào: đường KCS đợt cắt ghi CẢ steelIssueId lẫn cutBundleId (xem
-- QcReviewsService cutBundle) nên đếm cutBundleId sẽ = 2 và vỡ.
ALTER TABLE "qc_reviews" DROP CONSTRAINT "qc_reviews_goods_xor_chk";
ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_goods_xor_chk"
  CHECK (num_nonnulls("steelIssueId", "productionBatchId", "pieceStepBundleId", "materialYieldStepBundleId", "stepBundleId") = 1);
