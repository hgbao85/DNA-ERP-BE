-- "Bù đủ" cho nhánh Hàn/Sơn/VTTP (productionBatchId) - additive-only, không đụng dữ liệu cũ.
-- resolvedQty mặc định 0 cho MỌI dòng hiện có (kể cả nhánh steelIssueId/cutBundleId, luôn giữ 0 ở
-- đó vì outstanding của Sắt nằm ở qc_review_segments, không phải bảng này).
ALTER TABLE "qc_reviews" ADD COLUMN "resolvedQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "qc_reviews" ADD COLUMN "phoiReportedAt" TIMESTAMP(3);
ALTER TABLE "qc_reviews" ADD COLUMN "phoiReportedQty" INTEGER;
