-- Quy cách của NỆM theo từng SKU (không lưu ở vật tư).
--
-- Nệm có quy cách linh hoạt giữa các SKU (cùng 1 màu nệm, SKU A 50x50x5, SKU B 45x45x4) nên quy cách KHÔNG nằm ở
-- Material.spec mà ở chính dòng định mức của SKU (bom_accessory_items.spec) và đi theo xuống đề xuất mua
-- (purchase_proposal_items.spec) để Mua hàng tách dòng mua theo quy cách. Tồn kho vẫn tính chung theo loại vật tư.
--
-- CHỈ thêm 2 cột tuỳ chọn (NULL = không có quy cách riêng, dùng như cũ), không đổi hay xoá dữ liệu cũ.

-- AlterTable
ALTER TABLE "bom_accessory_items" ADD COLUMN "spec" TEXT;

-- AlterTable
ALTER TABLE "purchase_proposal_items" ADD COLUMN "spec" TEXT;
