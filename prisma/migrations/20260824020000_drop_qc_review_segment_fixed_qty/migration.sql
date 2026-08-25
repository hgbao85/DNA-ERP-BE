-- Bỏ fixedQty: Phôi cắt bù trực tiếp qua recordCutBatch (đợt cắt mới) thay vì báo "đã sửa"
-- riêng - xem doc comment QcReviewSegment (schema.prisma).
ALTER TABLE "qc_review_segments" DROP COLUMN "fixedQty";
