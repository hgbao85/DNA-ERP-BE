-- Phân loại "Nệm" cho vật tư nhóm "Vật tư khác".
--
-- Nhóm "Vật tư khác" + phân loại Phụ kiện có hàng trăm mục (mặt bàn, bản lề...), còn nệm là thứ Sales chọn
-- theo từng SKU (xem BomOption kind CUSHION, migration 20261022100000) - cần phân loại riêng để lọc ra đúng
-- các loại nệm thay vì đoán theo tên. Nệm vẫn lưu trong định mức như phụ kiện (BomAccessoryItem kind ACCESSORY).
--
-- CHỈ thêm giá trị enum, không đổi dữ liệu cũ. Việc gán phân loại Nệm cho các vật tư hiện có làm ở tầng
-- ứng dụng/Admin (không UPDATE ở đây: Postgres không cho dùng giá trị enum vừa thêm trong cùng transaction).

-- AlterEnum
ALTER TYPE "MaterialDetailKind" ADD VALUE 'CUSHION';
