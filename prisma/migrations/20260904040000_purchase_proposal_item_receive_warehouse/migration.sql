-- Kho nhận hàng ghi đè, chỉ set cho vật tư đóng gói (BomAccessoryItem kind=PACKAGING) - trỏ về
-- kho thành phẩm QLSX đã chọn cho PI thay vì Material.warehouseId cố định. NULL cho mọi nhánh
-- khác (sắt/PieceMaterialYield/tiêu hao), giữ nguyên hành vi cũ.
ALTER TABLE "purchase_proposal_items" ADD COLUMN "receiveWarehouseCode" TEXT;
