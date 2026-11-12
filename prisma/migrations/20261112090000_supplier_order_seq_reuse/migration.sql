-- 12/11/2026 (anh Nhân trả lời quy trình mua hàng, điểm 10): đơn đặt hàng huỷ khi CHƯA TỪNG có phiếu Giám đốc ký thì số đơn
-- được cấp lại cho đơn kế tiếp của cùng NCC (không nhảy cóc). Đơn huỷ vẫn giữ seq để xem lịch sử, nên unique số đơn chỉ còn
-- áp cho đơn chưa huỷ (partial unique index - Prisma không khai báo được, xem ghi chú ở model SupplierOrder).
DROP INDEX "supplier_orders_supplierId_year_seq_key";
CREATE UNIQUE INDEX "supplier_orders_active_seq_key" ON "supplier_orders"("supplierId", "year", "seq") WHERE "status" <> 'CANCELLED';

-- Mốc Admin nạp: số của đơn huỷ chỉ cấp lại khi lớn hơn mốc này (số từ mốc trở xuống có thể đã dùng ngoài hệ thống).
ALTER TABLE "supplier_order_counters" ADD COLUMN "reuseFromSeq" INTEGER NOT NULL DEFAULT 0;
