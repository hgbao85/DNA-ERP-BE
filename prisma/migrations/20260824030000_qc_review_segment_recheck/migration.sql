-- KCS Phôi chỉ còn Đạt/Không đạt (2026-08-24, vòng 2) - xem doc comment QcReviewSegment
-- (schema.prisma). failedQty giữ bất biến; resolvedQty là phần KCS đã duyệt lại xác nhận đạt.
ALTER TABLE "qc_review_segments" ADD COLUMN "resolvedQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "qc_review_segments" ADD COLUMN "phoiReportedAt" TIMESTAMP(3);
