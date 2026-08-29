-- Sửa lỗi tự phát hiện ngay sau khi chạy migration 20260829072018_stock_length_bucket: 2 trong 4
-- index mới có tên đầy đủ vượt quá 63 byte (giới hạn NAMEDATALEN của Postgres) - Postgres KHÔNG
-- báo lỗi, chỉ ÂM THẦM cắt bớt ký tự cuối khi tạo index, nên tên thật lưu trong pg_indexes khác
-- với tên đã viết trong migration.sql:
--   "stock_reservations_warehouseId_materialId_stockLengthMm_status_idx" (66 byte)
--     -> bị cắt còn "stock_reservations_warehouseId_materialId_stockLengthMm_status_" (mất "idx")
--   "warehouse_transfer_reservations_warehouseId_materialId_stockLengthMm_idx" (72 byte)
--     -> bị cắt còn "warehouse_transfer_reservations_warehouseId_materialId_stockLen" (cắt giữa từ)
-- Không sửa lại migration cũ đã chạy (đổi migration đã áp dụng làm lệch checksum, hỏng
-- `prisma migrate status` cho bất kỳ ai khác đã áp dụng migration đó) - forward-fix bằng cách drop
-- 2 index bị cắt tên (theo đúng tên THẬT đang có, không phải tên dự định ban đầu) rồi tạo lại với
-- tên ngắn tường minh (khớp `map:` mới thêm ở schema.prisma cho 2 @@index này).
DROP INDEX "stock_reservations_warehouseId_materialId_stockLengthMm_status_";
DROP INDEX "warehouse_transfer_reservations_warehouseId_materialId_stockLen";

CREATE INDEX "stock_reservations_wh_mat_len_status_idx"
  ON "stock_reservations"("warehouseId", "materialId", "stockLengthMm", "status");

CREATE INDEX "warehouse_transfer_reservations_wh_mat_len_idx"
  ON "warehouse_transfer_reservations"("warehouseId", "materialId", "stockLengthMm");
