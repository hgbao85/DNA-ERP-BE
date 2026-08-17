-- Hàn/Sơn báo sản lượng theo MẢNH (piece), khớp Phôi (steel_issue.pieceId) và Đan
-- (weaving_issues/weaving_receipts.pieceId) - chỉ Phôi làm theo từng thanh sắt cấu thành mảnh.
-- Trước đây production_batches gắn "part" (chi tiết, trục BOM riêng chưa từng có UI nhập liệu
-- thật - bomParts/partBoms luôn rỗng), đổi hẳn sang piece thay vì thêm trục song song.
-- Bảng production_batches hiện chưa có dữ liệu thật (0 dòng) nên đổi cột trực tiếp, an toàn.
ALTER TABLE "production_batches" DROP CONSTRAINT "production_batches_partId_fkey";
DROP INDEX "production_batches_productionOrderId_partId_idx";

ALTER TABLE "production_batches" RENAME COLUMN "partId" TO "pieceId";

CREATE INDEX "production_batches_productionOrderId_pieceId_idx" ON "production_batches"("productionOrderId", "pieceId");

ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "piece"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
